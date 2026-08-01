import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger, serializeError } from "./logger";
import { initErrorTracking, requestContext } from "./observability";
import { healthRoutes } from "./health";
import { detectLockoutColumns, hasCredential } from "@sentire-books/db";
import { setPassword } from "./password";
import { authRoutes } from "./routes/auth";
import { userRoutes } from "./routes/users";
import { journalRoutes } from "./routes/journal";
import { accountRoutes } from "./routes/accounts";
import { reportRoutes } from "./routes/reports";
import { taxRegistryRoutes } from "./routes/taxRegistry";
import { contactRoutes } from "./routes/contacts";
import { voucherRoutes } from "./routes/vouchers";
import { settingsRoutes } from "./routes/settings";
import { dataAdminRoutes } from "./routes/dataAdmin";
import { checkbookRoutes, checkRoutes } from "./routes/checks";
import { disbursementRoutes } from "./routes/disbursements";
import {
  taxRateRoutes,
  taxGroupRoutes,
  purposeCategoryRoutes,
  paymentTermRoutes,
  bankBalanceRoutes,
  bankTransactionRoutes,
  bankReconciliationRoutes,
} from "./routes/referenceData";
import {
  billingStatementRoutes,
  serviceInvoiceRoutes,
  collectionRoutes,
  paymentScheduleRoutes,
  schedulePaymentRoutes,
} from "./routes/billingAr";
import {
  loanRoutes,
  loanPaymentRoutes,
  assetTypeRoutes,
  fixedAssetRoutes,
  assetInstallmentPaymentRoutes,
  assetDeprPostingRoutes,
  weeklyProjectionRoutes,
  creditLineRoutes,
} from "./routes/financial";
import {
  workspaceResetBootNotice,
  authConfigErrors,
  authConfigWarnings,
  corsConfigErrors,
  corsConfigWarnings,
  parseCorsOrigins,
  corsOriginResolver,
} from "./config";

const app = new Hono();

// Error tracking is a no-op unless SENTRY_DSN is set.
initErrorTracking();
app.use("*", requestContext);

// The browser-facing web app is a different origin (the portal vs this API), so
// cross-origin requests need CORS. Allowed origins come from CORS_ORIGIN
// (comma-separated) and OVERRIDE these defaults when set; the defaults cover the
// custom domain, the Sliplane portal host, and local Vite.
const allowedOrigins = parseCorsOrigins();

app.use(
  "*",
  cors({
    origin: corsOriginResolver(allowedOrigins),
    allowHeaders: ["content-type", "authorization", "x-user-id", "x-org-id"],
    allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  }),
);

// Root + health identify the service, so hitting this host in a browser makes it
// obvious it's the API (JSON) and not the web app (which would render the SPA).
app.get("/", (c) =>
  c.json({ service: "sentire-books-api", ok: true, docs: "/health" }),
);
// Liveness (/live) and readiness (/health) — see health.ts for why they are
// separate. The platform restart probe must use /live; the uptime monitor and
// any load balancer must use /health.
app.route("/", healthRoutes);

app.route("/auth", authRoutes);
app.route("/users", userRoutes);
app.route("/accounts", accountRoutes);
app.route("/journal-entries", journalRoutes);
app.route("/reports", reportRoutes);
app.route("/reports", taxRegistryRoutes);
app.route("/contacts", contactRoutes);
app.route("/vouchers", voucherRoutes);
app.route("/settings/data", dataAdminRoutes);
app.route("/settings", settingsRoutes);
app.route("/checkbooks", checkbookRoutes);
app.route("/checks", checkRoutes);
app.route("/disbursement-reports", disbursementRoutes);
app.route("/tax-rates", taxRateRoutes);
app.route("/tax-groups", taxGroupRoutes);
app.route("/purpose-categories", purposeCategoryRoutes);
app.route("/payment-terms", paymentTermRoutes);
app.route("/bank-balances", bankBalanceRoutes);
app.route("/bank-transactions", bankTransactionRoutes);
app.route("/bank-reconciliations", bankReconciliationRoutes);
app.route("/billing-statements", billingStatementRoutes);
app.route("/service-invoices", serviceInvoiceRoutes);
app.route("/collections", collectionRoutes);
app.route("/payment-schedules", paymentScheduleRoutes);
app.route("/schedule-payments", schedulePaymentRoutes);
app.route("/loans", loanRoutes);
app.route("/loan-payments", loanPaymentRoutes);
app.route("/asset-types", assetTypeRoutes);
app.route("/fixed-assets", fixedAssetRoutes);
app.route("/asset-installment-payments", assetInstallmentPaymentRoutes);
app.route("/asset-depr-postings", assetDeprPostingRoutes);
app.route("/weekly-projections", weeklyProjectionRoutes);
app.route("/credit-lines", creditLineRoutes);

/**
 * Fail fast on a misconfiguration that would weaken authentication or widen
 * CORS. This runs BEFORE anything starts listening: a production API with no
 * signing secret, with the dev bypass enabled, or without a browser allow-list
 * must not serve a single request.
 */
function assertSafeConfig(): void {
  for (const w of [...authConfigWarnings(), ...corsConfigWarnings()]) logger.warn(w);
  const errors = [...authConfigErrors(), ...corsConfigErrors()];
  if (errors.length === 0) return;
  logger.fatal("refusing to start in production with an unsafe configuration");
  for (const e of errors) logger.fatal(e);
  // Exit SYNCHRONOUSLY: an async flush here would let boot()/serve() run first
  // and bind the port, breaking M0.2's "nothing listens on a fatal misconfig".
  // The errors are already on stderr, so losing a buffered Sentry event for a
  // config fault the process never served traffic under is the right trade.
  process.exit(1);
}

/**
 * Boot: report the sign-in lockout capability, and — on first run — seed a
 * password for the configured admin so there's a way in (BOOKS_ADMIN_EMAIL +
 * BOOKS_ADMIN_INITIAL_PASSWORD; the admin must already be on a workspace's user
 * list). Existing users get their passwords set by an admin afterwards. The
 * server still starts even if this fails, so /health stays up.
 */
async function boot(): Promise<void> {
  // Never let a destructive switch be silently on.
  logger.info(workspaceResetBootNotice());
  logger.info({ allowedOrigins }, "CORS allow-list");

  // Durable sign-in lockout needs the columns from migration 0022. If they are
  // absent the API stays up and throttles in memory only — a missed delta must
  // never cause a login outage — but it must be impossible to miss in the logs.
  if (await detectLockoutColumns()) {
    logger.info("sign-in lockout: durable (credentials.failed_attempts/locked_until present)");
  } else {
    logger.error(
      "[auth] ⚠ sign-in lockout is IN-MEMORY ONLY — credentials.failed_attempts / locked_until are " +
        "missing. Lockouts will not survive a restart. Apply setup/livedbdelta0022.sql (as the " +
        "database owner) or run migration 0022_credentials.sql.",
    );
  }
  const adminEmail = process.env.BOOKS_ADMIN_EMAIL?.trim().toLowerCase();
  const adminPassword = process.env.BOOKS_ADMIN_INITIAL_PASSWORD;
  if (adminEmail && adminPassword && !(await hasCredential(adminEmail))) {
    await setPassword(adminEmail, adminPassword);
    logger.info({ adminEmail }, "seeded initial credential");
  }
}

// Config assertions run first — a fatal one exits non-zero without listening.
assertSafeConfig();

boot()
  .catch((e) => logger.error({ err: serializeError(e) }, "boot failed"))
  .finally(() => {
    // Render (and most PaaS) inject PORT; fall back to API_PORT for local dev.
    const port = Number(process.env.PORT ?? process.env.API_PORT ?? 8787);
    serve({ fetch: app.fetch, port, hostname: "0.0.0.0" });
    logger.info({ port }, "sentire-books-api listening");
  });

export type AppType = typeof app;

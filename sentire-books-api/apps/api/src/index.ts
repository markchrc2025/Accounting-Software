import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { ensureAuthTables, hasCredential } from "@sentire-books/db";
import { setPassword } from "./password";
import { authRoutes } from "./routes/auth";
import { userRoutes } from "./routes/users";
import { journalRoutes } from "./routes/journal";
import { accountRoutes } from "./routes/accounts";
import { reportRoutes } from "./routes/reports";
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

const app = new Hono();

// The browser-facing web app is a different origin (the portal vs this API), so
// cross-origin requests need CORS. Allowed origins come from CORS_ORIGIN
// (comma-separated) and OVERRIDE these defaults when set; the defaults cover the
// custom domain, the Sliplane portal host, and local Vite.
const allowedOrigins = (
  process.env.CORS_ORIGIN ??
  "https://books.sentire.solutions,https://sentire-books.sliplane.app,http://localhost:5173"
)
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

app.use(
  "*",
  cors({
    origin: (origin) => (allowedOrigins.includes(origin) ? origin : (allowedOrigins[0] ?? "*")),
    allowHeaders: ["content-type", "authorization", "x-user-id", "x-org-id"],
    allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  }),
);

// Root + health identify the service, so hitting this host in a browser makes it
// obvious it's the API (JSON) and not the web app (which would render the SPA).
app.get("/", (c) =>
  c.json({ service: "sentire-books-api", ok: true, docs: "/health" }),
);
app.get("/health", (c) => c.json({ ok: true, service: "sentire-books-api" }));

app.route("/auth", authRoutes);
app.route("/users", userRoutes);
app.route("/accounts", accountRoutes);
app.route("/journal-entries", journalRoutes);
app.route("/reports", reportRoutes);
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
 * Boot: make sure the credentials table exists, and — on first run — seed a
 * password for the configured admin so there's a way in (BOOKS_ADMIN_EMAIL +
 * BOOKS_ADMIN_INITIAL_PASSWORD; the admin must already be on a workspace's user
 * list). Existing users get their passwords set by an admin afterwards. The
 * server still starts even if this fails, so /health stays up.
 */
async function boot(): Promise<void> {
  await ensureAuthTables();
  const adminEmail = process.env.BOOKS_ADMIN_EMAIL?.trim().toLowerCase();
  const adminPassword = process.env.BOOKS_ADMIN_INITIAL_PASSWORD;
  if (adminEmail && adminPassword && !(await hasCredential(adminEmail))) {
    await setPassword(adminEmail, adminPassword);
    console.log(`[auth] seeded initial credential for ${adminEmail}`);
  }
}

boot()
  .catch((e) => console.error("[boot] auth setup failed:", e))
  .finally(() => {
    // Render (and most PaaS) inject PORT; fall back to API_PORT for local dev.
    const port = Number(process.env.PORT ?? process.env.API_PORT ?? 8787);
    serve({ fetch: app.fetch, port, hostname: "0.0.0.0" });
    console.log(`sentire-books-api listening on :${port}`);
  });

export type AppType = typeof app;

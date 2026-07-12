/**
 * Admin data tools (Settings → Data): export a full JSON snapshot of the
 * workspace, reset it for go-live (wipe business data + restart every
 * document number at 0001), and restore a previously exported snapshot.
 *
 * All three run inside ONE org-scoped transaction. Reset/restore set the
 * transaction-local `app.allow_data_admin` GUC (see migration 0018) so the
 * posted-journal append-only triggers permit the wipe; RLS still confines
 * everything to the caller's workspace. Users, sign-in credentials, and org
 * settings are never wiped.
 */
import { Hono } from "hono";
import { ZodError, z } from "zod";
import { eq, sql } from "drizzle-orm";
import type { PgTable } from "drizzle-orm/pg-core";
import {
  withOrgContext,
  type Tx,
  accounts,
  contacts,
  taxRates,
  taxGroups,
  purposeCategories,
  paymentTerms,
  checkbooks,
  journalEntries,
  journalLines,
  vouchers,
  voucherLines,
  checkRegistry,
  disbursementReports,
  billingStatements,
  serviceInvoices,
  collections,
  paymentSchedules,
  schedulePayments,
  loans,
  loanPayments,
  assetTypes,
  fixedAssets,
  assetInstallmentPayments,
  assetDeprPostings,
  weeklyProjections,
  creditLines,
  dailyBankBalances,
  bankTransactions,
  bankReconciliations,
  documentCounters,
  orgSettings,
} from "@sentire-books/db";
import { requireAuth } from "../auth";

const EXPORT_FORMAT = "sentire-books-export";
const EXPORT_VERSION = 1;

type Registry = {
  key: string;
  table: PgTable;
  /** No org_id column — RLS scopes it via its parent, deletes cascade. */
  lineOf?: string;
  /** Same-table uuid references, restored in a second pass. */
  selfRefs?: string[];
  /** DB-computed columns that must not be inserted. */
  generated?: string[];
  /** Master data a reset can keep (grouped by flag name). */
  keepGroup?: "contacts" | "referenceData" | "checkbooks" | "chartOfAccounts";
};

// In INSERT order (parents before children). Wipes run in reverse.
const REGISTRY: Registry[] = [
  { key: "accounts", table: accounts, selfRefs: ["parentId"], keepGroup: "chartOfAccounts" },
  { key: "contacts", table: contacts, selfRefs: ["parentId"], keepGroup: "contacts" },
  { key: "taxRates", table: taxRates, keepGroup: "referenceData" },
  { key: "taxGroups", table: taxGroups, keepGroup: "referenceData" },
  { key: "purposeCategories", table: purposeCategories, keepGroup: "referenceData" },
  { key: "paymentTerms", table: paymentTerms, keepGroup: "referenceData" },
  { key: "assetTypes", table: assetTypes, keepGroup: "referenceData" },
  { key: "checkbooks", table: checkbooks, keepGroup: "checkbooks" },
  { key: "journalEntries", table: journalEntries, selfRefs: ["accrualReversalOf", "reversalOf"] },
  { key: "journalLines", table: journalLines, lineOf: "journalEntries" },
  { key: "vouchers", table: vouchers },
  { key: "voucherLines", table: voucherLines, lineOf: "vouchers" },
  { key: "checkRegistry", table: checkRegistry },
  { key: "disbursementReports", table: disbursementReports },
  { key: "billingStatements", table: billingStatements, generated: ["balanceCents"] },
  { key: "serviceInvoices", table: serviceInvoices, generated: ["balanceCents"] },
  { key: "collections", table: collections, generated: ["unappliedCents"] },
  { key: "paymentSchedules", table: paymentSchedules },
  { key: "schedulePayments", table: schedulePayments },
  { key: "loans", table: loans },
  { key: "loanPayments", table: loanPayments },
  { key: "fixedAssets", table: fixedAssets },
  { key: "assetInstallmentPayments", table: assetInstallmentPayments },
  { key: "assetDeprPostings", table: assetDeprPostings },
  { key: "weeklyProjections", table: weeklyProjections },
  { key: "creditLines", table: creditLines },
  { key: "dailyBankBalances", table: dailyBankBalances },
  { key: "bankTransactions", table: bankTransactions },
  { key: "bankReconciliations", table: bankReconciliations },
  { key: "documentCounters", table: documentCounters },
];

const CHUNK = 200;
const ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?$/;

async function enableDataAdmin(tx: Tx): Promise<void> {
  await tx.execute(sql`SELECT set_config('app.allow_data_admin', 'on', true)`);
}

/** Delete a registry entry's org rows; returns the wiped count. */
async function wipeEntry(tx: Tx, entry: Registry, orgId: string): Promise<number> {
  if (entry.lineOf) return 0; // cascades from its parent
  const rows = await tx
    .delete(entry.table)
    .where(eq((entry.table as never as { orgId: never }).orgId, orgId as never))
    .returning();
  return rows.length;
}

const zResetBody = z.object({
  confirm: z.literal("RESET"),
  keepContacts: z.boolean().default(true),
  keepReferenceData: z.boolean().default(true),
  keepCheckbooks: z.boolean().default(true),
});

const zImportBody = z.object({
  format: z.literal(EXPORT_FORMAT),
  version: z.literal(EXPORT_VERSION),
  tables: z.record(z.array(z.record(z.unknown()))),
  settings: z.record(z.unknown()).nullable().optional(),
});

export const dataAdminRoutes = new Hono();
dataAdminRoutes.use("*", requireAuth);
dataAdminRoutes.use("*", async (c, next) => {
  const auth = c.get("auth");
  if (auth.role !== "admin") {
    return c.json({ error: "forbidden", detail: "Admin role required" }, 403);
  }
  await next();
});

// ── Export: a faithful JSON snapshot of every org-scoped table ───────────────
dataAdminRoutes.get("/export", async (c) => {
  const auth = c.get("auth");
  const payload = await withOrgContext(
    { userId: auth.userId, orgId: auth.orgId, role: auth.role },
    async (tx) => {
      const tables: Record<string, unknown[]> = {};
      for (const entry of REGISTRY) {
        // RLS scopes every select to the org (line tables via their parent).
        tables[entry.key] = await tx.select().from(entry.table);
      }
      const [settings] = await tx
        .select()
        .from(orgSettings)
        .where(eq(orgSettings.orgId, auth.orgId));
      return {
        format: EXPORT_FORMAT,
        version: EXPORT_VERSION,
        exportedAt: new Date().toISOString(),
        org: { id: auth.orgId, name: auth.orgName, code: auth.orgCode },
        tables,
        settings: settings ?? null,
      };
    },
  );
  return c.json(payload);
});

// ── Reset: wipe business data + restart document numbering ───────────────────
dataAdminRoutes.post("/reset", async (c) => {
  const auth = c.get("auth");
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "invalid_json" }, 400);
  }
  try {
    const input = zResetBody.parse(body);
    const keep = (g: Registry["keepGroup"]) =>
      g === "chartOfAccounts" || // reset never touches the CoA
      (g === "contacts" && input.keepContacts) ||
      (g === "referenceData" && input.keepReferenceData) ||
      (g === "checkbooks" && input.keepCheckbooks);

    const wiped = await withOrgContext(
      { userId: auth.userId, orgId: auth.orgId, role: auth.role },
      async (tx) => {
        await enableDataAdmin(tx);
        const counts: Record<string, number> = {};
        for (const entry of [...REGISTRY].reverse()) {
          if (entry.keepGroup && keep(entry.keepGroup)) continue;
          const n = await wipeEntry(tx, entry, auth.orgId);
          if (n > 0) counts[entry.key] = n;
        }
        return counts;
      },
    );
    return c.json({ ok: true, wiped });
  } catch (err) {
    if (err instanceof ZodError) return c.json({ error: "validation_error", issues: err.issues }, 400);
    console.error("[workspaceReset]", err);
    return c.json({ error: "internal_error" }, 500);
  }
});

// ── Restore: full replace from a previously exported snapshot ────────────────
dataAdminRoutes.post("/import", async (c) => {
  const auth = c.get("auth");
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "invalid_json" }, 400);
  }
  try {
    const input = zImportBody.parse(body);
    const restored = await withOrgContext(
      { userId: auth.userId, orgId: auth.orgId, role: auth.role },
      async (tx) => {
        await enableDataAdmin(tx);

        // Full replace: wipe everything the snapshot covers (CoA included).
        for (const entry of [...REGISTRY].reverse()) {
          await wipeEntry(tx, entry, auth.orgId);
        }

        const counts: Record<string, number> = {};
        for (const entry of REGISTRY) {
          const rows = (input.tables[entry.key] ?? []) as Record<string, unknown>[];
          if (rows.length === 0) continue;

          const selfRefs = entry.selfRefs ?? [];
          const prepared = rows.map((r) => {
            const row: Record<string, unknown> = { ...r };
            for (const g of entry.generated ?? []) delete row[g];
            for (const s of selfRefs) delete row[s];
            // Snapshots restore only into the workspace that owns them.
            if ("orgId" in row) row.orgId = auth.orgId;
            // JSON round-trip: timestamptz values arrive as ISO strings, but
            // Date-mode timestamp columns need Date objects again.
            for (const [k, v] of Object.entries(row)) {
              if (typeof v === "string" && ISO_TIMESTAMP.test(v)) row[k] = new Date(v);
            }
            return row;
          });
          for (let i = 0; i < prepared.length; i += CHUNK) {
            await tx
              .insert(entry.table)
              .values(prepared.slice(i, i + CHUNK) as never);
          }
          // Second pass: same-table references (account/contact hierarchies,
          // journal reversal links) now that every row exists.
          if (selfRefs.length) {
            const idCol = (entry.table as never as { id: never }).id;
            for (const r of rows) {
              const patch: Record<string, unknown> = {};
              for (const s of selfRefs) if (r[s] != null) patch[s] = r[s];
              if (Object.keys(patch).length) {
                await tx
                  .update(entry.table)
                  .set(patch as never)
                  .where(eq(idCol, r.id as never));
              }
            }
          }
          counts[entry.key] = rows.length;
        }

        if (input.settings && typeof input.settings === "object") {
          const s = input.settings as Record<string, unknown>;
          const set = {
            profile: s.profile ?? null,
            approvalRouting: s.approvalRouting ?? null,
            docNumbering: s.docNumbering ?? null,
            modulePolicies: s.modulePolicies ?? null,
            updatedAt: new Date(),
          };
          await tx
            .insert(orgSettings)
            .values({ orgId: auth.orgId, ...set })
            .onConflictDoUpdate({ target: orgSettings.orgId, set });
        }
        return counts;
      },
    );
    return c.json({ ok: true, restored });
  } catch (err) {
    if (err instanceof ZodError) return c.json({ error: "validation_error", issues: err.issues }, 400);
    if (err && typeof err === "object" && "code" in err && (err as { code?: string }).code === "23503") {
      return c.json(
        { error: "fk_violation", detail: "The snapshot references records that no longer exist (e.g. a removed user)." },
        409,
      );
    }
    console.error("[workspaceImport]", err);
    return c.json({ error: "internal_error" }, 500);
  }
});

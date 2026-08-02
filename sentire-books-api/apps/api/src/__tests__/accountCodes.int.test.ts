/**
 * Account-code resolution (M2.0) — real Postgres, real routers, RLS-bound as
 * `sentire_books_app`. Skipped unless DATABASE_URL is set.
 *
 * Account `code` is not unique (0005_accounts_extend.sql moves uniqueness to
 * `name`), but posting resolves accounts BY CODE. The old `new Map(rows.map(r =>
 * [r.code, r.id]))` silently kept the last row, so a duplicate code sent a
 * posting line to whichever account the planner happened to return second.
 *
 * The default chart shipped exactly that: `2004002` was both "Opening Balance
 * Offset" (equity) and "Final Pay Payable Deployed" (liability), and
 * `OPENING_EQUITY_DEFAULT` is `2004002`. An opening-balance loan booking debited
 * the payroll liability. The entry BALANCED, so no ledger invariant fired and
 * the trial balance still reconciled to the centavo — only the balance sheet was
 * wrong. That is what makes this class of bug worth a dedicated test.
 *
 * Two properties:
 *   1. An ambiguous code fails closed — 409 naming every candidate, never a
 *      silent pick, and nothing is written.
 *   2. Opening-balance booking resolves `2004002` to Opening Balance Offset
 *      (equity), which is only true because the chart no longer collides.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Hono } from "hono";
import { and, eq, sql } from "drizzle-orm";
import {
  withOrgContext,
  accounts,
  loans,
  journalLines,
  DEMO_ORG_ID,
  DEMO_ADMIN_ID,
  DEMO_ADMIN_EMAIL,
} from "@sentire-books/db";
import { loanRoutes, fixedAssetRoutes } from "../routes/financial";
import { resolveAccountCodes, AmbiguousAccountCodeError } from "../ledger/resolveAccounts";

const RUN = !!process.env.DATABASE_URL;
const ctx = { userId: DEMO_ADMIN_ID, orgId: DEMO_ORG_ID, role: "admin" as const };

const OPENING_EQUITY = "2004002";
const LOANS_PAYABLE = "2001002";

const app = new Hono();
app.route("/loans", loanRoutes);
app.route("/fixed-assets", fixedAssetRoutes);

const call = (method: string, path: string, body?: unknown) =>
  app.request(path, {
    method,
    headers: {
      "content-type": "application/json",
      "x-user-id": DEMO_ADMIN_ID,
      "x-user-email": DEMO_ADMIN_EMAIL,
      "x-org-id": DEMO_ORG_ID,
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

/** Lines of a posted entry, joined to the account they actually hit. */
const linesOf = (entryId: string) =>
  withOrgContext(ctx, (tx) =>
    tx
      .select({
        code: accounts.code,
        name: accounts.name,
        type: accounts.type,
        debitCents: journalLines.debitCents,
        creditCents: journalLines.creditCents,
      })
      .from(journalLines)
      .innerJoin(accounts, eq(accounts.id, journalLines.accountId))
      .where(eq(journalLines.entryId, entryId)),
  );

describe.skipIf(!RUN)("M2.0 — account codes resolve unambiguously", () => {
  const saved = { secret: process.env.AUTH_JWT_SECRET, bypass: process.env.AUTH_DEV_BYPASS };
  const madeLoans: string[] = [];

  beforeAll(() => {
    delete process.env.AUTH_JWT_SECRET;
    process.env.AUTH_DEV_BYPASS = "true";
  });

  afterAll(async () => {
    // Loans are reverse-only through the API; tests clean up directly.
    for (const id of madeLoans) {
      await withOrgContext(ctx, (tx) => tx.delete(loans).where(eq(loans.id, id)));
    }
    if (saved.secret === undefined) delete process.env.AUTH_JWT_SECRET;
    else process.env.AUTH_JWT_SECRET = saved.secret;
    if (saved.bypass === undefined) delete process.env.AUTH_DEV_BYPASS;
    else process.env.AUTH_DEV_BYPASS = saved.bypass;
  });

  /* ── 1. The shipped chart is unambiguous ─────────────────────────────────── */

  describe("the default chart", () => {
    it("has no duplicate account codes at all", async () => {
      const dupes = (await withOrgContext(ctx, (tx) =>
        tx.execute(sql`
          SELECT code, string_agg(name || ' (' || type || ')', ', ') AS candidates
          FROM accounts WHERE org_id = ${DEMO_ORG_ID}
          GROUP BY code HAVING count(*) > 1 ORDER BY code
        `),
      )) as unknown as Array<{ code: string; candidates: string }>;

      expect(dupes, `duplicate codes: ${JSON.stringify(dupes)}`).toEqual([]);
    });

    it("resolves 2004002 to Opening Balance Offset, an equity account", async () => {
      const rows = await withOrgContext(ctx, (tx) =>
        tx
          .select({ name: accounts.name, type: accounts.type })
          .from(accounts)
          .where(and(eq(accounts.orgId, DEMO_ORG_ID), eq(accounts.code, OPENING_EQUITY))),
      );
      expect(rows).toHaveLength(1);
      expect(rows[0]!.name).toBe("Opening Balance Offset");
      expect(rows[0]!.type).toBe("equity");
    });

    it("carries the payroll liabilities at their renumbered codes", async () => {
      const rows = await withOrgContext(ctx, (tx) =>
        tx
          .select({ code: accounts.code, name: accounts.name })
          .from(accounts)
          .where(and(eq(accounts.orgId, DEMO_ORG_ID), sql`${accounts.code} LIKE '2005%'`)),
      );
      expect(new Map(rows.map((r) => [r.code, r.name]))).toEqual(
        new Map([
          ["2005001", "Salaries and Wages Payable"],
          ["2005002", "Final Pay Payable Deployed"],
          ["2005003", "Final Pay Payable"],
        ]),
      );
    });

    it("has the two accounts Milestone 2 needs", async () => {
      const rows = await withOrgContext(ctx, (tx) =>
        tx
          .select({ code: accounts.code, name: accounts.name, type: accounts.type })
          .from(accounts)
          .where(and(eq(accounts.orgId, DEMO_ORG_ID), sql`${accounts.code} IN ('1009002','2003004')`)),
      );
      expect(new Map(rows.map((r) => [r.code, `${r.name}|${r.type}`]))).toEqual(
        new Map([
          ["1009002", "Creditable Withholding Tax|asset"],
          ["2003004", "Percentage Tax Payable|liability"],
        ]),
      );
    });
  });

  /* ── 2. A duplicate code fails closed ────────────────────────────────────── */

  describe("a duplicate code is refused, not guessed", () => {
    /** Run `fn` with a deliberate collision on `code` in place. */
    const withDuplicate = async (code: string, fn: () => Promise<void>) => {
      const [clash] = await withOrgContext(ctx, (tx) =>
        tx
          .insert(accounts)
          .values({
            orgId: DEMO_ORG_ID,
            code,
            name: `Deliberate Clash ${Date.now()}`,
            type: "liability",
            subtype: "Other Current Liability",
            normalBalance: "credit",
            isActive: true,
          } as never)
          .returning(),
      );
      try {
        await fn();
      } finally {
        await withOrgContext(ctx, (tx) => tx.delete(accounts).where(eq(accounts.id, clash!.id)));
      }
    };

    it("throws AmbiguousAccountCodeError naming every candidate", async () => {
      await withDuplicate(OPENING_EQUITY, async () => {
        const err = await withOrgContext(ctx, (tx) =>
          resolveAccountCodes(tx, DEMO_ORG_ID, [OPENING_EQUITY]).then(
            () => null,
            (e: unknown) => e,
          ),
        );
        expect(err).toBeInstanceOf(AmbiguousAccountCodeError);
        const e = err as AmbiguousAccountCodeError;
        expect(e.code).toBe(OPENING_EQUITY);
        expect(e.candidates).toHaveLength(2);
        expect(e.candidateSummary).toContain("Opening Balance Offset (equity)");
        expect(e.candidateSummary).toContain("Deliberate Clash");
      });
    });

    it("409s an opening-balance loan registration and writes nothing", async () => {
      await withDuplicate(OPENING_EQUITY, async () => {
        const before = await withOrgContext(ctx, (tx) =>
          tx.select({ n: sql<number>`count(*)::int` }).from(loans).where(eq(loans.orgId, DEMO_ORG_ID)),
        );

        const res = await call("POST", "/loans/register", {
          name: "Ambiguity probe",
          principalCents: 500000,
          disbursementDate: "2026-03-01",
          liabilityAccountCode: LOANS_PAYABLE,
          bookingMode: "opening_balance",
        });

        expect(res.status).toBe(409);
        const body = (await res.json()) as {
          error?: string;
          detail?: string;
          code?: string;
          candidates?: { name: string; type: string }[];
        };
        expect(body.error).toBe("ambiguous_account_code");
        expect(body.code).toBe(OPENING_EQUITY);
        expect(body.candidates).toHaveLength(2);
        // The message has to be actionable — it must name what to disambiguate.
        expect(body.detail).toContain("Opening Balance Offset");
        expect(body.detail).toContain("Deliberate Clash");

        // The whole registration transaction rolled back — no orphan loan.
        const after = await withOrgContext(ctx, (tx) =>
          tx.select({ n: sql<number>`count(*)::int` }).from(loans).where(eq(loans.orgId, DEMO_ORG_ID)),
        );
        expect(after[0]!.n).toBe(before[0]!.n);
      });
    });

    it("409s a fixed-asset registration on the same collision", async () => {
      await withDuplicate(OPENING_EQUITY, async () => {
        const res = await call("POST", "/fixed-assets/register", {
          assetNo: `FA-A${Date.now() % 1e9}`, // assetNo is max 20 chars
          name: "Ambiguity probe",
          costCents: 250000,
          purchaseDate: "2026-03-01",
          fixedAssetAccount: "1003001",
          bookingMode: "opening_balance",
        });
        expect(res.status).toBe(409);
        expect(((await res.json()) as { error?: string }).error).toBe("ambiguous_account_code");
      });
    });

    it("does not fire for codes the caller never asked about", async () => {
      // The clash is on a payroll code no loan booking references, so a normal
      // disbursement booking must still succeed — this guards against the
      // resolver going fail-closed on the whole org.
      await withDuplicate("2005001", async () => {
        const res = await call("POST", "/loans/register", {
          name: "Unrelated clash",
          principalCents: 300000,
          disbursementDate: "2026-03-02",
          liabilityAccountCode: LOANS_PAYABLE,
          cashAccountCode: "1001640",
          bookingMode: "disbursement",
        });
        expect(res.status).toBe(201);
        madeLoans.push(((await res.json()) as { loan: { id: string } }).loan.id);
      });
    });
  });

  /* ── 3. The booking that was wrong is now right ──────────────────────────── */

  describe("opening-balance booking posts to equity", () => {
    it("debits Opening Balance Offset, not Final Pay Payable Deployed", async () => {
      const res = await call("POST", "/loans/register", {
        name: "Opening balance probe",
        principalCents: 1500000,
        disbursementDate: "2026-03-03",
        liabilityAccountCode: LOANS_PAYABLE,
        bookingMode: "opening_balance",
      });
      expect(res.status).toBe(201);
      const { loan, journalEntryNo } = (await res.json()) as {
        loan: { id: string; bookingJournalEntryId: string };
        journalEntryNo: string;
      };
      madeLoans.push(loan.id);
      expect(journalEntryNo).toMatch(/^JE202603-\d{4}$/);

      const lines = await linesOf(loan.bookingJournalEntryId);
      expect(lines).toHaveLength(2);

      const debit = lines.find((l) => l.debitCents > 0)!;
      expect(debit.code).toBe(OPENING_EQUITY);
      expect(debit.name).toBe("Opening Balance Offset");
      expect(debit.type).toBe("equity"); // the whole point — was 'liability'
      expect(debit.debitCents).toBe(1500000);

      const credit = lines.find((l) => l.creditCents > 0)!;
      expect(credit.code).toBe(LOANS_PAYABLE);
      expect(credit.name).toBe("Loans Payable");
      expect(credit.creditCents).toBe(1500000);

      // Balanced, as it always was — that is exactly why this needed a test.
      const dr = lines.reduce((s, l) => s + l.debitCents, 0);
      const cr = lines.reduce((s, l) => s + l.creditCents, 0);
      expect(dr).toBe(cr);
    });

    it("leaves the org's trial balance balanced to the centavo", async () => {
      const [row] = (await withOrgContext(ctx, (tx) =>
        tx.execute(sql`
          SELECT COALESCE(SUM(jl.debit_cents), 0)::bigint  AS debits,
                 COALESCE(SUM(jl.credit_cents), 0)::bigint AS credits
          FROM journal_lines jl
          JOIN journal_entries je ON je.id = jl.entry_id
          WHERE je.org_id = ${DEMO_ORG_ID} AND je.status IN ('posted','reversed')
        `),
      )) as unknown as Array<{ debits: string; credits: string }>;

      expect(BigInt(row!.debits)).toBe(BigInt(row!.credits));
    });
  });
});

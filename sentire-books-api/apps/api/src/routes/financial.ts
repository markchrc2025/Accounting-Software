/**
 * Financial management routes (Phase 6): loans, loan payments, fixed assets,
 * asset types, installment payments, depreciation-posting locks, weekly cash
 * projections, and credit lines — all factory-generated org-scoped CRUD. The
 * amortization/depreciation engines run client-side; the one-post-per-month
 * depreciation rule is the asset_depr_postings UNIQUE(org, period) constraint
 * (a duplicate post comes back as 409).
 */
import {
  zLoanInput,
  zLoanUpdate,
  zLoanPaymentInput,
  zLoanPaymentUpdate,
  zAssetTypeInput,
  zAssetTypeUpdate,
  zFixedAssetInput,
  zFixedAssetUpdate,
  zFixedAssetRegister,
  zFixedAssetBook,
  zAssetInstallmentPaymentInput,
  zAssetInstallmentPaymentUpdate,
  zAssetDeprPostingInput,
  zAssetDeprPostingUpdate,
  zWeeklyProjectionInput,
  zWeeklyProjectionUpdate,
  zCreditLineInput,
  zCreditLineUpdate,
  zLoanBook,
  zLoanRegister,
  zLoanPay,
} from "@sentire-books/domain";
import { and, eq, inArray, sql } from "drizzle-orm";
import { ZodError } from "zod";
import {
  withOrgContext,
  accounts,
  loans,
  loanPayments,
  checkRegistry,
  vouchers,
  assetTypes,
  fixedAssets,
  assetInstallmentPayments,
  assetDeprPostings,
  weeklyProjections,
  creditLines,
  type Tx,
} from "@sentire-books/db";
import { makeCrudRoutes, nextDocNo } from "./crudFactory";
import { requireAuth } from "../auth";
import { postJournalEntryCore, reverseJournalEntryCore } from "../ledger/postJournalEntry";
import { createVoucherDraftCore } from "../ledger/voucherWorkflow";
import { nextCheckNo } from "./checks";

export const loanRoutes = makeCrudRoutes({
  plural: "loans",
  singular: "loan",
  table: loans,
  createSchema: zLoanInput,
  updateSchema: zLoanUpdate,
  orderBy: [{ column: loans.createdAt, dir: "asc" }],
  docNo: { field: "loanNo", prefix: "LN", dateField: "disbursementDate" },
});

const OPENING_EQUITY_DEFAULT = "2004002"; // Opening Balance Offset

// Thrown to roll a registration transaction back when its auto-booking can't post.
class LoanBookError extends Error {
  constructor(public code: "already_booked" | "accounts_unset" | "nothing_to_book") { super(code); }
}

type BookInput = { mode: "disbursement" | "opening_balance"; date?: string | undefined; openingEquityAccountCode?: string | null | undefined; outstandingCents?: number | undefined };
type BookResult =
  | { ok: true; loan: typeof loans.$inferSelect; journalEntryNo: string }
  | { ok: false; error: "already_booked" | "accounts_unset" | "nothing_to_book" };

// Post a loan's origination entry inside an existing transaction and stamp the
// loan. Disbursement books real proceeds (DR Cash + DR Finance Cost, CR Loans
// Payable); opening-balance brings a pre-existing loan on (DR Opening Balance
// Offset, CR Loans Payable). Shared by /register (auto-book) and /:id/book.
async function bookLoanTx(tx: Tx, loan: typeof loans.$inferSelect, input: BookInput, orgId: string, userId: string): Promise<BookResult> {
  if (loan.bookingJournalEntryId) return { ok: false, error: "already_booked" };

  const codes = [
    loan.liabilityAccountCode,
    loan.financeCostAccountCode,
    loan.cashAccountCode,
    input.openingEquityAccountCode ?? OPENING_EQUITY_DEFAULT,
  ].filter((x): x is string => !!x);
  const accs = codes.length
    ? await tx.select({ id: accounts.id, code: accounts.code }).from(accounts)
        .where(and(eq(accounts.orgId, orgId), inArray(accounts.code, codes)))
    : [];
  const byCode = new Map(accs.map((a) => [a.code, a.id]));

  const principal = loan.principalCents;
  const fee = loan.processingFeeCents ?? 0;
  const liabilityId = loan.liabilityAccountCode ? byCode.get(loan.liabilityAccountCode) : undefined;
  if (!liabilityId) return { ok: false, error: "accounts_unset" };

  let lines: { accountId: string; debitCents: number; creditCents: number }[];
  if (input.mode === "opening_balance") {
    const eqCode = input.openingEquityAccountCode ?? OPENING_EQUITY_DEFAULT;
    const equityId = byCode.get(eqCode);
    if (!equityId) return { ok: false, error: "accounts_unset" };
    const outstanding = input.outstandingCents ?? principal;
    if (outstanding <= 0) return { ok: false, error: "nothing_to_book" };
    lines = [
      { accountId: equityId, debitCents: outstanding, creditCents: 0 },
      { accountId: liabilityId, debitCents: 0, creditCents: outstanding },
    ];
  } else {
    const cashId = loan.cashAccountCode ? byCode.get(loan.cashAccountCode) : undefined;
    const financeId = loan.financeCostAccountCode ? byCode.get(loan.financeCostAccountCode) : undefined;
    if (!cashId || (fee > 0 && !financeId) || principal <= 0) return { ok: false, error: "accounts_unset" };
    const netProceeds = principal - fee;
    lines = [
      { accountId: cashId, debitCents: netProceeds, creditCents: 0 },
      ...(fee > 0 && financeId ? [{ accountId: financeId, debitCents: fee, creditCents: 0 }] : []),
      { accountId: liabilityId, debitCents: 0, creditCents: principal },
    ];
  }

  const date = input.date ?? loan.disbursementDate ?? new Date().toISOString().slice(0, 10);
  const je = await postJournalEntryCore(
    tx,
    {
      orgId,
      entryDate: date,
      memo: `Loan booking — ${loan.name}${loan.loanNo ? ` (${loan.loanNo})` : ""}`,
      entryType: "Manual",
      reference: loan.loanNo ?? null,
      sourceType: "loan",
      sourceId: loan.id,
      post: true,
      lines,
    },
    { userId, orgId },
  );
  const [updated] = await tx.update(loans)
    .set({ bookingJournalEntryId: je.id, bookedAt: new Date(), bookingMode: input.mode })
    .where(eq(loans.id, loan.id)).returning();
  return { ok: true, loan: updated!, journalEntryNo: je.entryNo };
}

const bookErrorResponse = (error: "accounts_unset" | "nothing_to_book") =>
  error === "accounts_unset"
    ? { body: { error, detail: "Set the loan's liability, finance-cost and cash accounts before booking." }, status: 400 as const }
    : { body: { error, detail: "Outstanding amount must be greater than zero." }, status: 400 as const };

// Register a loan and post its origination entry atomically — booking is
// automatic (no separate step). Rolls back entirely if the entry can't post, so
// a registered loan is always on the books.
loanRoutes.post("/register", requireAuth, async (c) => {
  const auth = c.get("auth");
  let body: unknown;
  try { body = await c.req.json(); } catch { body = {}; }
  try {
    const { bookingMode, openingEquityAccountCode, outstandingCents, ...loanFields } = zLoanRegister.parse(body ?? {});
    const outcome = await withOrgContext(
      { userId: auth.userId, orgId: auth.orgId, role: auth.role },
      async (tx) => {
        const loanNo = loanFields.loanNo || (await nextDocNo(tx, auth.orgId, "LN", loanFields.disbursementDate ?? undefined));
        const [loan] = await tx.insert(loans)
          .values({ ...loanFields, orgId: auth.orgId, loanNo, createdBy: auth.userId } as never)
          .returning();
        const booked = await bookLoanTx(tx, loan!, { mode: bookingMode, openingEquityAccountCode, outstandingCents }, auth.orgId, auth.userId);
        if (!booked.ok) throw new LoanBookError(booked.error);
        return { loan: booked.loan, journalEntryNo: booked.journalEntryNo };
      },
    );
    return c.json(outcome, 201);
  } catch (err) {
    if (err instanceof ZodError) return c.json({ error: "validation_error", issues: err.issues }, 400);
    if (err instanceof LoanBookError && err.code !== "already_booked") {
      const { body: b, status } = bookErrorResponse(err.code);
      return c.json(b, status);
    }
    console.error("[registerLoan]", err);
    return c.json({ error: "internal_error" }, 500);
  }
});

// Book an existing (legacy / unbooked) loan to the ledger.
loanRoutes.post("/:id/book", requireAuth, async (c) => {
  const auth = c.get("auth");
  const id = c.req.param("id") ?? "";
  let body: unknown;
  try { body = await c.req.json(); } catch { body = {}; }
  try {
    const input = zLoanBook.parse(body ?? {});
    const outcome = await withOrgContext(
      { userId: auth.userId, orgId: auth.orgId, role: auth.role },
      async (tx) => {
        const [loan] = await tx.select().from(loans).where(and(eq(loans.orgId, auth.orgId), eq(loans.id, id)));
        if (!loan) return { error: "not_found" as const };
        return bookLoanTx(tx, loan, { mode: input.mode, date: input.date, openingEquityAccountCode: input.openingEquityAccountCode, outstandingCents: input.outstandingCents }, auth.orgId, auth.userId);
      },
    );
    if (!("ok" in outcome)) return c.json({ error: "not_found" }, 404);
    if (outcome.ok) return c.json({ loan: outcome.loan, journalEntryNo: outcome.journalEntryNo });
    if (outcome.error === "already_booked") return c.json({ error: "already_booked", detail: "This loan is already booked to the ledger." }, 409);
    const { body: b, status } = bookErrorResponse(outcome.error);
    return c.json(b, status);
  } catch (err) {
    if (err instanceof ZodError) return c.json({ error: "validation_error", issues: err.issues }, 400);
    console.error("[bookLoan]", err);
    return c.json({ error: "internal_error" }, 500);
  }
});

// Unbook — reverse the origination entry and clear the stamps so it can be re-booked.
loanRoutes.post("/:id/unbook", requireAuth, async (c) => {
  const auth = c.get("auth");
  const id = c.req.param("id") ?? "";
  try {
    const outcome = await withOrgContext(
      { userId: auth.userId, orgId: auth.orgId, role: auth.role },
      async (tx) => {
        const [loan] = await tx.select().from(loans).where(and(eq(loans.orgId, auth.orgId), eq(loans.id, id)));
        if (!loan) return { error: "not_found" as const };
        if (!loan.bookingJournalEntryId) return { error: "not_booked" as const };
        await reverseJournalEntryCore(tx, loan.bookingJournalEntryId, { userId: auth.userId, orgId: auth.orgId });
        const [updated] = await tx.update(loans)
          .set({ bookingJournalEntryId: null, bookedAt: null, bookingMode: null })
          .where(eq(loans.id, id)).returning();
        return { loan: updated };
      },
    );
    if (outcome.error === "not_found") return c.json({ error: "not_found" }, 404);
    if (outcome.error === "not_booked") return c.json({ error: "not_booked", detail: "This loan isn't booked yet." }, 400);
    return c.json(outcome);
  } catch (err) {
    console.error("[unbookLoan]", err);
    return c.json({ error: "internal_error" }, 500);
  }
});

// Cancel a loan — a registered loan is never deleted, only cancelled. Reverses
// its booking entry (if booked) and marks it Cancelled. Blocked while it still
// has recorded payments, so nothing is left orphaned.
loanRoutes.post("/:id/cancel", requireAuth, async (c) => {
  const auth = c.get("auth");
  const id = c.req.param("id") ?? "";
  try {
    const outcome = await withOrgContext(
      { userId: auth.userId, orgId: auth.orgId, role: auth.role },
      async (tx) => {
        const [loan] = await tx.select().from(loans).where(and(eq(loans.orgId, auth.orgId), eq(loans.id, id)));
        if (!loan) return { error: "not_found" as const };
        if (loan.status === "Cancelled") return { error: "already_cancelled" as const };
        const payCount = await tx.select({ count: sql<number>`count(*)::int` }).from(loanPayments)
          .where(and(eq(loanPayments.orgId, auth.orgId), eq(loanPayments.loanId, id)));
        if ((payCount[0]?.count ?? 0) > 0) return { error: "has_payments" as const };
        if (loan.bookingJournalEntryId) {
          await reverseJournalEntryCore(tx, loan.bookingJournalEntryId, { userId: auth.userId, orgId: auth.orgId });
        }
        const [updated] = await tx.update(loans)
          .set({ status: "Cancelled", bookingJournalEntryId: null, bookedAt: null, bookingMode: null })
          .where(eq(loans.id, id)).returning();
        return { loan: updated };
      },
    );
    if (outcome.error === "not_found") return c.json({ error: "not_found" }, 404);
    if (outcome.error === "already_cancelled") return c.json({ error: "already_cancelled", detail: "This loan is already cancelled." }, 409);
    if (outcome.error === "has_payments") return c.json({ error: "has_payments", detail: "This loan has recorded payments — void or remove them before cancelling." }, 409);
    return c.json(outcome);
  } catch (err) {
    console.error("[cancelLoan]", err);
    return c.json({ error: "internal_error" }, 500);
  }
});

// Record a loan payment — FM originates the disbursement instrument and links it
// to the payment (one loan_payment ↔ one voucher ↔ one JE). Bank Transfer / Cash
// / Online / Auto-Debit → a Payment Voucher whose JE posts at approval; Check
// → a Check Voucher + a Check Registry entry whose JE posts when the check
// clears. Both carry the same detail lines (DR Loans Payable + DR Finance Cost),
// with cash credited for the total — the loan payment's GL footprint.
loanRoutes.post("/:id/pay", requireAuth, async (c) => {
  const auth = c.get("auth");
  const id = c.req.param("id") ?? "";
  let body: unknown;
  try { body = await c.req.json(); } catch { body = {}; }
  try {
    const input = zLoanPay.parse(body ?? {});
    const outcome = await withOrgContext(
      { userId: auth.userId, orgId: auth.orgId, role: auth.role },
      async (tx) => {
        const [loan] = await tx.select().from(loans).where(and(eq(loans.orgId, auth.orgId), eq(loans.id, id)));
        if (!loan) return { error: "not_found" as const };

        const total = input.principalCents + input.interestCents + input.penaltyCents;
        if (total <= 0) return { error: "nothing_to_pay" as const };

        const liabilityCode = loan.liabilityAccountCode ?? null;
        const cashCode = input.cashAccountCode ?? loan.cashAccountCode ?? null;
        const financeCode = loan.financeCostAccountCode ?? null;
        const needFinance = input.interestCents + input.penaltyCents > 0;
        if (!liabilityCode || !cashCode || (needFinance && !financeCode)) {
          return { error: "accounts_unset" as const };
        }

        const codes = [liabilityCode, cashCode, ...(financeCode ? [financeCode] : [])];
        const accs = await tx.select({ id: accounts.id, code: accounts.code }).from(accounts)
          .where(and(eq(accounts.orgId, auth.orgId), inArray(accounts.code, codes)));
        const byCode = new Map(accs.map((a) => [a.code, a.id]));
        const liabilityId = byCode.get(liabilityCode);
        const cashId = byCode.get(cashCode);
        const financeId = financeCode ? byCode.get(financeCode) : undefined;
        if (!liabilityId || !cashId || (needFinance && !financeId)) return { error: "accounts_unset" as const };

        // Voucher detail lines (unsigned; debited at approval/clearing, cash credited).
        const lines: { accountId: string; amountCents: number; description?: string }[] = [];
        if (input.principalCents > 0) lines.push({ accountId: liabilityId, amountCents: input.principalCents, description: "Principal" });
        if (input.interestCents > 0) lines.push({ accountId: financeId!, amountCents: input.interestCents, description: "Interest" });
        if (input.penaltyCents > 0) lines.push({ accountId: financeId!, amountCents: input.penaltyCents, description: "Penalty" });

        const voucherDate = input.voucherDate ?? input.payDate;
        const isCheck = input.method === "Check";
        const voucherType = isCheck ? ("check" as const) : ("payment" as const);
        const label = `${loan.name}${loan.loanNo ? ` (${loan.loanNo})` : ""}`;
        const meta: Record<string, unknown> = {
          loanId: loan.id,
          loanNo: loan.loanNo ?? null,
          source: "loan_payment",
          ...(input.method === "Auto-Debit" ? { autoDebit: true } : {}),
        };

        const draft = await createVoucherDraftCore(
          tx,
          { type: voucherType, voucherDate, memo: `Loan payment — ${label}`, paymentFromAccountId: cashId, meta, lines },
          { userId: auth.userId, orgId: auth.orgId },
        );

        // PDC: register the physical check (Issued). Its JE posts on clearing; the
        // check voucher parks at 'pending' (an issued check isn't a free draft).
        let check: { id: string; checkNo: string } | undefined;
        if (isCheck) {
          const [chk] = await tx.insert(checkRegistry).values({
            orgId: auth.orgId,
            checkNo: await nextCheckNo(tx, auth.orgId),
            bankCode: cashCode,                         // resolves to the cash account when the check clears
            checkNumber: input.checkNumber ?? "",
            checkDate: input.checkDate ?? voucherDate,  // maturity
            issueDate: voucherDate,
            payeeName: input.payeeName ?? loan.name,
            amountCents: total,
            netAmountCents: total,
            status: "Issued",
            referenceType: "Check Voucher",
            referenceId: draft.voucherNo,
            voucherId: draft.id,
            meta: { loanId: loan.id, loanNo: loan.loanNo ?? null },
            createdBy: auth.userId,
          }).returning({ id: checkRegistry.id, checkNo: checkRegistry.checkNo });
          check = chk;
          await tx.update(vouchers).set({ status: "pending" }).where(eq(vouchers.id, draft.id));
        }

        const [payment] = await tx.insert(loanPayments).values({
          orgId: auth.orgId,
          loanId: loan.id,
          loanName: loan.name,
          payDate: input.payDate,
          interestCents: input.interestCents,
          principalCents: input.principalCents,
          penaltyCents: input.penaltyCents,
          totalCents: total,
          method: input.method,
          referenceNo: input.referenceNo ?? (isCheck ? input.checkNumber ?? null : null),
          bank: input.bank ?? null,
          voucherNo: draft.voucherNo,
          voucherDocId: draft.id,
          checkVoucherNo: isCheck ? draft.voucherNo : null,
          notes: input.notes ?? null,
          allocations: input.allocations ?? null,
          createdBy: auth.userId,
        }).returning();

        // Back-link the payment onto the voucher (and check) meta for reconciliation.
        await tx.update(vouchers)
          .set({ meta: { ...meta, loanPaymentId: payment!.id } })
          .where(eq(vouchers.id, draft.id));
        if (check) {
          await tx.update(checkRegistry)
            .set({ meta: { loanId: loan.id, loanNo: loan.loanNo ?? null, loanPaymentId: payment!.id } })
            .where(eq(checkRegistry.id, check.id));
        }

        return {
          payment,
          voucher: { id: draft.id, voucherNo: draft.voucherNo, type: voucherType },
          ...(check ? { check } : {}),
          postsAt: isCheck ? ("check_clearing" as const) : ("voucher_approval" as const),
        };
      },
    );
    if (outcome.error === "not_found") return c.json({ error: "not_found" }, 404);
    if (outcome.error === "nothing_to_pay") return c.json({ error: "nothing_to_pay", detail: "Payment total must be greater than zero." }, 400);
    if (outcome.error === "accounts_unset") return c.json({ error: "accounts_unset", detail: "Set the loan's liability, finance-cost and cash accounts before recording a payment." }, 400);
    return c.json(outcome, 201);
  } catch (err) {
    if (err instanceof ZodError) return c.json({ error: "validation_error", issues: err.issues }, 400);
    console.error("[payLoan]", err);
    return c.json({ error: "internal_error" }, 500);
  }
});

// Reconcile the loan sub-ledger against the GL Loans Payable control account.
// GL control = posted credit balance of the loans' liability accounts. FM's
// principal outstanding = Σ loan principal − Σ recorded principal payments. The
// gap is explained by (a) loans not yet booked and (b) payments whose voucher
// isn't approved / check isn't cleared; anything left over is unexplained drift.
loanRoutes.get("/reconciliation", requireAuth, async (c) => {
  const auth = c.get("auth");
  try {
    const result = await withOrgContext(
      { userId: auth.userId, orgId: auth.orgId, role: auth.role },
      async (tx) => {
        const loanRows = await tx.select().from(loans).where(eq(loans.orgId, auth.orgId));
        const payRows = await tx.select().from(loanPayments).where(eq(loanPayments.orgId, auth.orgId));

        // GL control: posted balance of the distinct liability accounts loans use.
        const liabilityCodes = [...new Set(loanRows.map((l) => l.liabilityAccountCode).filter((x): x is string => !!x))];
        let glControlCents = 0;
        if (liabilityCodes.length) {
          const codeList = sql.join(liabilityCodes.map((code) => sql`${code}`), sql`, `);
          const rows = (await tx.execute(sql`
            SELECT COALESCE(SUM(credit_cents - debit_cents), 0)::bigint AS control
            FROM v_account_postings
            WHERE org_id = ${auth.orgId} AND account_code IN (${codeList})
          `)) as unknown as Array<{ control: string }>;
          glControlCents = Number(rows[0]?.control ?? 0);
        }

        // Which payments have actually reached the GL: PV approved/paid/posted,
        // or a linked check that has cleared.
        const docIds = [...new Set(payRows.map((p) => p.voucherDocId).filter((x): x is string => !!x))];
        const vs = docIds.length
          ? await tx.select({ id: vouchers.id, status: vouchers.status }).from(vouchers)
              .where(and(eq(vouchers.orgId, auth.orgId), inArray(vouchers.id, docIds)))
          : [];
        const vStatus = new Map(vs.map((v) => [v.id, v.status]));
        const clearedVoucherIds = docIds.length
          ? new Set((await tx.select({ voucherId: checkRegistry.voucherId }).from(checkRegistry)
              .where(and(eq(checkRegistry.orgId, auth.orgId), eq(checkRegistry.status, "Cleared"), inArray(checkRegistry.voucherId, docIds))))
              .map((r) => r.voucherId))
          : new Set<string>();
        const POSTED_V = new Set(["approved", "paid", "posted"]);
        const isPosted = (p: typeof payRows[number]) => {
          if (!p.voucherDocId) return false;
          if (POSTED_V.has(vStatus.get(p.voucherDocId) ?? "")) return true;
          return clearedVoucherIds.has(p.voucherDocId);
        };

        const fmOutstandingCents =
          loanRows.reduce((s, l) => s + (l.principalCents ?? 0), 0) -
          payRows.reduce((s, p) => s + (p.principalCents ?? 0), 0);

        const unbooked = loanRows.filter((l) => !l.bookingJournalEntryId);
        const unbookedLoans = unbooked.map((l) => ({ id: l.id, name: l.name, loanNo: l.loanNo, principalCents: l.principalCents ?? 0 }));
        const unbookedCents = unbookedLoans.reduce((s, l) => s + l.principalCents, 0);

        const unposted = payRows.filter((p) => !isPosted(p));
        const unpostedPayments = unposted.map((p) => ({
          id: p.id, loanName: p.loanName, principalCents: p.principalCents ?? 0,
          method: p.method, state: p.voucherDocId ? ("in_flight" as const) : ("unlinked" as const),
        }));
        const unpostedCents = unpostedPayments.reduce((s, p) => s + p.principalCents, 0);

        // Identity: fmOutstanding = glControl + unbooked − unposted. Residual ≠ 0
        // means the GL moved in a way the sub-ledger can't explain (investigate).
        const residualCents = glControlCents - (fmOutstandingCents - unbookedCents + unpostedCents);
        const reconciled = unbookedCents === 0 && unpostedCents === 0 && residualCents === 0;

        return {
          glControlCents,
          fmOutstandingCents,
          unbookedCents,
          unpostedCents,
          residualCents,
          reconciled,
          unbookedLoans,
          unpostedPayments,
        };
      },
    );
    return c.json(result);
  } catch (err) {
    console.error("[loanReconciliation]", err);
    return c.json({ error: "internal_error" }, 500);
  }
});

export const loanPaymentRoutes = makeCrudRoutes({
  plural: "payments",
  singular: "payment",
  table: loanPayments,
  createSchema: zLoanPaymentInput,
  updateSchema: zLoanPaymentUpdate,
  orderBy: [{ column: loanPayments.payDate, dir: "desc" }],
});

export const assetTypeRoutes = makeCrudRoutes({
  plural: "types",
  singular: "type",
  table: assetTypes,
  createSchema: zAssetTypeInput,
  updateSchema: zAssetTypeUpdate,
  orderBy: [{ column: assetTypes.name, dir: "asc" }],
  stampCreatedBy: false,
});

export const fixedAssetRoutes = makeCrudRoutes({
  plural: "assets",
  singular: "asset",
  table: fixedAssets,
  createSchema: zFixedAssetInput,
  updateSchema: zFixedAssetUpdate,
  orderBy: [{ column: fixedAssets.assetNo, dir: "asc" }],
});

// ── Fixed asset acquisition booking ─────────────────────────────────────────
class AssetBookError extends Error {
  constructor(public code: "already_booked" | "accounts_unset" | "nothing_to_book") { super(code); }
}
type AssetBookInput = { mode: "cash" | "installment" | "opening_balance"; date?: string | undefined; openingEquityAccountCode?: string | null | undefined; accumDepreciationToDateCents?: number | undefined };
type AssetBookResult =
  | { ok: true; asset: typeof fixedAssets.$inferSelect; journalEntryNo: string }
  | { ok: false; error: "already_booked" | "accounts_unset" | "nothing_to_book" };

// Post a fixed asset's acquisition entry inside an existing transaction and
// stamp it. Cash: DR Fixed Asset / CR Cash. Installment: DR Fixed Asset /
// CR Fixed Assets Payable (financed) + CR Cash (down payment). Opening balance:
// DR Fixed Asset / CR Accumulated Depreciation (prior) + CR Opening Balance
// Offset (net book value). Shared by /register (auto-book) and /:id/book.
async function bookAssetTx(tx: Tx, asset: typeof fixedAssets.$inferSelect, input: AssetBookInput, orgId: string, userId: string): Promise<AssetBookResult> {
  if (asset.bookingJournalEntryId) return { ok: false, error: "already_booked" };
  const cost = asset.costCents;
  if (cost <= 0) return { ok: false, error: "nothing_to_book" };

  const codes = [
    asset.fixedAssetAccount,
    asset.cashAccountCode,
    asset.accumDeprecAccount,
    asset.installmentPayableAccount,
    input.openingEquityAccountCode ?? OPENING_EQUITY_DEFAULT,
  ].filter((x): x is string => !!x);
  const accs = codes.length
    ? await tx.select({ id: accounts.id, code: accounts.code }).from(accounts)
        .where(and(eq(accounts.orgId, orgId), inArray(accounts.code, codes)))
    : [];
  const byCode = new Map(accs.map((a) => [a.code, a.id]));
  const assetId = asset.fixedAssetAccount ? byCode.get(asset.fixedAssetAccount) : undefined;
  if (!assetId) return { ok: false, error: "accounts_unset" };
  const cashId = asset.cashAccountCode ? byCode.get(asset.cashAccountCode) : undefined;

  let lines: { accountId: string; debitCents: number; creditCents: number }[];
  if (input.mode === "opening_balance") {
    const eqCode = input.openingEquityAccountCode ?? OPENING_EQUITY_DEFAULT;
    const equityId = byCode.get(eqCode);
    const accumId = asset.accumDeprecAccount ? byCode.get(asset.accumDeprecAccount) : undefined;
    const accum = input.accumDepreciationToDateCents ?? 0;
    if (!equityId || (accum > 0 && !accumId)) return { ok: false, error: "accounts_unset" };
    const nbv = cost - accum;
    lines = [
      { accountId: assetId, debitCents: cost, creditCents: 0 },
      ...(accum > 0 && accumId ? [{ accountId: accumId, debitCents: 0, creditCents: accum }] : []),
      { accountId: equityId, debitCents: 0, creditCents: nbv },
    ];
  } else if (input.mode === "installment") {
    const payableId = asset.installmentPayableAccount ? byCode.get(asset.installmentPayableAccount) : undefined;
    const financed = asset.installmentPrincipalCents > 0 ? asset.installmentPrincipalCents : cost;
    const down = cost - financed;
    if (!payableId || financed <= 0 || financed > cost || (down > 0 && !cashId)) return { ok: false, error: "accounts_unset" };
    lines = [
      { accountId: assetId, debitCents: cost, creditCents: 0 },
      { accountId: payableId, debitCents: 0, creditCents: financed },
      ...(down > 0 && cashId ? [{ accountId: cashId, debitCents: 0, creditCents: down }] : []),
    ];
  } else {
    if (!cashId) return { ok: false, error: "accounts_unset" };
    lines = [
      { accountId: assetId, debitCents: cost, creditCents: 0 },
      { accountId: cashId, debitCents: 0, creditCents: cost },
    ];
  }

  const date = input.date ?? asset.purchaseDate ?? asset.deprecStartDate ?? new Date().toISOString().slice(0, 10);
  const je = await postJournalEntryCore(
    tx,
    {
      orgId,
      entryDate: date,
      memo: `Asset acquisition — ${asset.name}${asset.assetNo ? ` (${asset.assetNo})` : ""}`,
      entryType: "Manual",
      reference: asset.assetNo ?? null,
      sourceType: "fixed_asset",
      sourceId: asset.id,
      post: true,
      lines,
    },
    { userId, orgId },
  );
  const [updated] = await tx.update(fixedAssets)
    .set({ bookingJournalEntryId: je.id, bookedAt: new Date(), bookingMode: input.mode })
    .where(eq(fixedAssets.id, asset.id)).returning();
  return { ok: true, asset: updated!, journalEntryNo: je.entryNo };
}

const assetBookErrorResponse = (error: "accounts_unset" | "nothing_to_book") =>
  error === "accounts_unset"
    ? { body: { error, detail: "Set the asset's Fixed Asset account (and the cash / payable account for its basis) before booking." }, status: 400 as const }
    : { body: { error, detail: "Asset cost must be greater than zero." }, status: 400 as const };

// Register a fixed asset and post its acquisition entry atomically — booking is
// automatic. Rolls back entirely if the entry can't post, so a registered asset
// is always on the books.
fixedAssetRoutes.post("/register", requireAuth, async (c) => {
  const auth = c.get("auth");
  let body: unknown;
  try { body = await c.req.json(); } catch { body = {}; }
  try {
    const { bookingMode, openingEquityAccountCode, accumDepreciationToDateCents, ...assetFields } = zFixedAssetRegister.parse(body ?? {});
    const outcome = await withOrgContext(
      { userId: auth.userId, orgId: auth.orgId, role: auth.role },
      async (tx) => {
        const [asset] = await tx.insert(fixedAssets)
          .values({ ...assetFields, orgId: auth.orgId, createdBy: auth.userId } as never)
          .returning();
        const booked = await bookAssetTx(tx, asset!, { mode: bookingMode, openingEquityAccountCode, accumDepreciationToDateCents }, auth.orgId, auth.userId);
        if (!booked.ok) throw new AssetBookError(booked.error);
        return { asset: booked.asset, journalEntryNo: booked.journalEntryNo };
      },
    );
    return c.json(outcome, 201);
  } catch (err) {
    if (err instanceof ZodError) return c.json({ error: "validation_error", issues: err.issues }, 400);
    if (err instanceof AssetBookError && err.code !== "already_booked") {
      const { body: b, status } = assetBookErrorResponse(err.code);
      return c.json(b, status);
    }
    if (err && typeof err === "object" && "code" in err && (err as { code?: string }).code === "23505") {
      return c.json({ error: "duplicate", detail: "That asset number already exists." }, 409);
    }
    console.error("[registerAsset]", err);
    return c.json({ error: "internal_error" }, 500);
  }
});

// Book an existing (legacy / unbooked) fixed asset to the ledger.
fixedAssetRoutes.post("/:id/book", requireAuth, async (c) => {
  const auth = c.get("auth");
  const id = c.req.param("id") ?? "";
  let body: unknown;
  try { body = await c.req.json(); } catch { body = {}; }
  try {
    const input = zFixedAssetBook.parse(body ?? {});
    const outcome = await withOrgContext(
      { userId: auth.userId, orgId: auth.orgId, role: auth.role },
      async (tx) => {
        const [asset] = await tx.select().from(fixedAssets).where(and(eq(fixedAssets.orgId, auth.orgId), eq(fixedAssets.id, id)));
        if (!asset) return { error: "not_found" as const };
        return bookAssetTx(tx, asset, { mode: input.mode, date: input.date, openingEquityAccountCode: input.openingEquityAccountCode, accumDepreciationToDateCents: input.accumDepreciationToDateCents }, auth.orgId, auth.userId);
      },
    );
    if (!("ok" in outcome)) return c.json({ error: "not_found" }, 404);
    if (outcome.ok) return c.json({ asset: outcome.asset, journalEntryNo: outcome.journalEntryNo });
    if (outcome.error === "already_booked") return c.json({ error: "already_booked", detail: "This asset is already booked to the ledger." }, 409);
    const { body: b, status } = assetBookErrorResponse(outcome.error);
    return c.json(b, status);
  } catch (err) {
    if (err instanceof ZodError) return c.json({ error: "validation_error", issues: err.issues }, 400);
    console.error("[bookAsset]", err);
    return c.json({ error: "internal_error" }, 500);
  }
});

// Cancel a fixed asset — never deleted, only cancelled. Reverses its acquisition
// entry (if booked) and marks it Cancelled. Blocked while it still has recorded
// installment payments, so nothing is orphaned.
fixedAssetRoutes.post("/:id/cancel", requireAuth, async (c) => {
  const auth = c.get("auth");
  const id = c.req.param("id") ?? "";
  try {
    const outcome = await withOrgContext(
      { userId: auth.userId, orgId: auth.orgId, role: auth.role },
      async (tx) => {
        const [asset] = await tx.select().from(fixedAssets).where(and(eq(fixedAssets.orgId, auth.orgId), eq(fixedAssets.id, id)));
        if (!asset) return { error: "not_found" as const };
        if (asset.status === "Cancelled") return { error: "already_cancelled" as const };
        const payCount = await tx.select({ count: sql<number>`count(*)::int` }).from(assetInstallmentPayments)
          .where(and(eq(assetInstallmentPayments.orgId, auth.orgId), eq(assetInstallmentPayments.assetId, id)));
        if ((payCount[0]?.count ?? 0) > 0) return { error: "has_payments" as const };
        if (asset.bookingJournalEntryId) {
          await reverseJournalEntryCore(tx, asset.bookingJournalEntryId, { userId: auth.userId, orgId: auth.orgId });
        }
        const [updated] = await tx.update(fixedAssets)
          .set({ status: "Cancelled", bookingJournalEntryId: null, bookedAt: null, bookingMode: null })
          .where(eq(fixedAssets.id, id)).returning();
        return { asset: updated };
      },
    );
    if (outcome.error === "not_found") return c.json({ error: "not_found" }, 404);
    if (outcome.error === "already_cancelled") return c.json({ error: "already_cancelled", detail: "This asset is already cancelled." }, 409);
    if (outcome.error === "has_payments") return c.json({ error: "has_payments", detail: "This asset has recorded installment payments — void those before cancelling." }, 409);
    return c.json(outcome);
  } catch (err) {
    console.error("[cancelAsset]", err);
    return c.json({ error: "internal_error" }, 500);
  }
});

export const assetInstallmentPaymentRoutes = makeCrudRoutes({
  plural: "payments",
  singular: "payment",
  table: assetInstallmentPayments,
  createSchema: zAssetInstallmentPaymentInput,
  updateSchema: zAssetInstallmentPaymentUpdate,
  orderBy: [{ column: assetInstallmentPayments.createdAt, dir: "desc" }],
});

export const assetDeprPostingRoutes = makeCrudRoutes({
  plural: "postings",
  singular: "posting",
  table: assetDeprPostings,
  createSchema: zAssetDeprPostingInput,
  updateSchema: zAssetDeprPostingUpdate,
  orderBy: [{ column: assetDeprPostings.period, dir: "desc" }],
});

export const weeklyProjectionRoutes = makeCrudRoutes({
  plural: "projections",
  singular: "projection",
  table: weeklyProjections,
  createSchema: zWeeklyProjectionInput,
  updateSchema: zWeeklyProjectionUpdate,
  orderBy: [{ column: weeklyProjections.createdAt, dir: "desc" }],
  docNo: { field: "projNo", prefix: "WP", dateField: "startDate" },
});

export const creditLineRoutes = makeCrudRoutes({
  plural: "creditLines",
  singular: "creditLine",
  table: creditLines,
  createSchema: zCreditLineInput,
  updateSchema: zCreditLineUpdate,
  orderBy: [{ column: creditLines.displayName, dir: "asc" }],
});

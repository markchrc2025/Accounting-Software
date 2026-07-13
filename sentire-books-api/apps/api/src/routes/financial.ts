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
  zAssetInstallmentPaymentInput,
  zAssetInstallmentPaymentUpdate,
  zAssetDeprPostingInput,
  zAssetDeprPostingUpdate,
  zWeeklyProjectionInput,
  zWeeklyProjectionUpdate,
  zCreditLineInput,
  zCreditLineUpdate,
  zLoanBook,
  zLoanPay,
} from "@sentire-books/domain";
import { and, eq, inArray } from "drizzle-orm";
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
} from "@sentire-books/db";
import { makeCrudRoutes } from "./crudFactory";
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

// Book a loan to the ledger — posts its origination journal entry once and
// stamps the loan. Disbursement mode books the real proceeds (DR Cash + DR
// Finance Cost, CR Loans Payable); opening-balance mode brings a pre-existing
// loan onto the books (DR Opening Balance Offset, CR Loans Payable).
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
        if (loan.bookingJournalEntryId) return { error: "already_booked" as const };

        const codes = [
          loan.liabilityAccountCode,
          loan.financeCostAccountCode,
          loan.cashAccountCode,
          input.openingEquityAccountCode ?? OPENING_EQUITY_DEFAULT,
        ].filter((x): x is string => !!x);
        const accs = codes.length
          ? await tx.select({ id: accounts.id, code: accounts.code }).from(accounts)
              .where(and(eq(accounts.orgId, auth.orgId), inArray(accounts.code, codes)))
          : [];
        const byCode = new Map(accs.map((a) => [a.code, a.id]));

        const principal = loan.principalCents;
        const fee = loan.processingFeeCents ?? 0;
        const liabilityId = loan.liabilityAccountCode ? byCode.get(loan.liabilityAccountCode) : undefined;
        if (!liabilityId) return { error: "accounts_unset" as const };

        let lines: { accountId: string; debitCents: number; creditCents: number }[];
        if (input.mode === "opening_balance") {
          const eqCode = input.openingEquityAccountCode ?? OPENING_EQUITY_DEFAULT;
          const equityId = byCode.get(eqCode);
          if (!equityId) return { error: "accounts_unset" as const };
          const outstanding = input.outstandingCents ?? principal;
          if (outstanding <= 0) return { error: "nothing_to_book" as const };
          lines = [
            { accountId: equityId, debitCents: outstanding, creditCents: 0 },
            { accountId: liabilityId, debitCents: 0, creditCents: outstanding },
          ];
        } else {
          const cashId = loan.cashAccountCode ? byCode.get(loan.cashAccountCode) : undefined;
          const financeId = loan.financeCostAccountCode ? byCode.get(loan.financeCostAccountCode) : undefined;
          if (!cashId || (fee > 0 && !financeId) || principal <= 0) return { error: "accounts_unset" as const };
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
            orgId: auth.orgId,
            entryDate: date,
            memo: `Loan booking — ${loan.name}${loan.loanNo ? ` (${loan.loanNo})` : ""}`,
            entryType: "Manual",
            reference: loan.loanNo ?? null,
            sourceType: "loan",
            sourceId: loan.id,
            post: true,
            lines,
          },
          { userId: auth.userId, orgId: auth.orgId },
        );
        const [updated] = await tx.update(loans)
          .set({ bookingJournalEntryId: je.id, bookedAt: new Date(), bookingMode: input.mode })
          .where(eq(loans.id, id)).returning();
        return { loan: updated, journalEntryNo: je.entryNo };
      },
    );
    if (outcome.error === "not_found") return c.json({ error: "not_found" }, 404);
    if (outcome.error === "already_booked") return c.json({ error: "already_booked", detail: "This loan is already booked to the ledger." }, 409);
    if (outcome.error === "accounts_unset") return c.json({ error: "accounts_unset", detail: "Set the loan's liability, finance-cost and cash accounts before booking." }, 400);
    if (outcome.error === "nothing_to_book") return c.json({ error: "nothing_to_book", detail: "Outstanding amount must be greater than zero." }, 400);
    return c.json(outcome);
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

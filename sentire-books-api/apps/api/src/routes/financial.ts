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
} from "@sentire-books/domain";
import {
  loans,
  loanPayments,
  assetTypes,
  fixedAssets,
  assetInstallmentPayments,
  assetDeprPostings,
  weeklyProjections,
  creditLines,
} from "@sentire-books/db";
import { makeCrudRoutes } from "./crudFactory";

export const loanRoutes = makeCrudRoutes({
  plural: "loans",
  singular: "loan",
  table: loans,
  createSchema: zLoanInput,
  updateSchema: zLoanUpdate,
  orderBy: [{ column: loans.createdAt, dir: "asc" }],
  docNo: { field: "loanNo", prefix: "LN", dateField: "disbursementDate" },
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

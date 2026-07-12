/**
 * Sentire Books relational schema (Drizzle ORM / Postgres).
 *
 * Money columns are `bigint` CENTAVOS (integers), never floats.
 * Org-scoped: every business table carries `org_id` for multi-tenant isolation
 * (enforced by Row-Level Security policies — see migrations/0001_rls.sql).
 *
 * NOTE: the double-entry balance rule and append-only immutability are enforced
 * by Postgres triggers that Drizzle's schema DSL cannot express. They live in
 * migrations/0000_init_triggers.sql and MUST be applied with the generated DDL.
 */
import {
  pgEnum,
  pgTable,
  uuid,
  text,
  bigint,
  integer,
  boolean,
  date,
  timestamp,
  unique,
  index,
  check,
  jsonb,
  numeric,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

export const accountType = pgEnum("account_type", [
  "asset",
  "liability",
  "equity",
  "income",
  "expense",
]);

// Workflow states (0011): everything before 'posted' is mutable work-in-progress;
// 'posted' is append-only and must balance; 'reversed' still counts in reports.
export const entryStatus = pgEnum("entry_status", [
  "draft",
  "pending_review",
  "pending_approval",
  "for_clearing",
  "cleared",
  "for_posting",
  "posted",
  "rejected",
  "voided",
  "reversed",
]);

export const userRole = pgEnum("user_role", [
  "maker",
  "verifier",
  "approver",
  "poster",
  "admin",
]);

export const contactType = pgEnum("contact_type", ["vendor", "customer", "employee"]);

export const voucherType = pgEnum("voucher_type", [
  "payment",
  "receipt",
  "payroll",
  "final_pay",
  "loan",
  "check",
]);

// Approval workflow (0012): the JE posts at 'approved'; 'void' reverses it.
// 'for_disbursement' (0013): parked in a disbursement report, reverts on removal.
export const voucherStatus = pgEnum("voucher_status", [
  "draft",
  "pending",
  "for_verification",
  "verified",
  "for_approval",
  "approved",
  "for_disbursement",
  "paid",
  "rejected",
  "posted",
  "void",
]);

export const organizations = pgTable("organizations", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  // Tenant ID entered at login. Globally unique, case-insensitive (enforced by a
  // DB expression index on upper(code) — see migrations/0006_org_code.sql).
  code: text("code").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const appUsers = pgTable(
  "app_users",
  {
    // App-owned id (generated). Users are admitted by their verified EMAIL, not
    // this id — sign-in proves the email, Sentire owns the user allowlist.
    id: text("id")
      .primaryKey()
      .default(sql`gen_random_uuid()::text`),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    email: text("email").notNull(),
    fullName: text("full_name"),
    role: userRole("role").notNull().default("maker"),
    // Portal-owned extras: roles[], moduleAccess matrix, workEmail, signature.
    profile: jsonb("profile"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  // Unique PER workspace, not globally: one email may belong to many workspaces
  // (a bookkeeper serving several clients). Case-insensitivity is enforced by the
  // expression index app_users_org_email_lower_key — see 0009_multi_workspace.sql.
  (t) => [unique("app_users_org_email_key").on(t.orgId, t.email)],
);

export const accounts = pgTable(
  "accounts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    code: text("code").notNull(),
    name: text("name").notNull(),
    type: accountType("type").notNull(),
    // Real charts reuse codes across types, so the unique key is (org_id, name);
    // `code` is a non-unique display label. These extra columns carry a Zoho-style
    // export losslessly: a self-referencing hierarchy, a detailed subtype, a
    // description, and the account's normal balance side.
    parentId: uuid("parent_id"),
    subtype: text("subtype"),
    description: text("description"),
    normalBalance: text("normal_balance"),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("accounts_org_name_key").on(t.orgId, t.name),
    index("accounts_org_code_idx").on(t.orgId, t.code),
    index("accounts_org_parent_idx").on(t.orgId, t.parentId),
  ],
);

/** Atomic document-number sequences (PV202606-0001, etc.). One row per period. */
export const documentCounters = pgTable(
  "document_counters",
  {
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    periodKey: text("period_key").notNull(),
    seq: bigint("seq", { mode: "number" }).notNull().default(0),
  },
  (t) => [unique("document_counters_pk").on(t.orgId, t.periodKey)],
);

export const journalEntries = pgTable(
  "journal_entries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    entryNo: text("entry_no").notNull(),
    entryDate: date("entry_date").notNull(),
    memo: text("memo"),
    status: entryStatus("status").notNull().default("draft"),
    entryType: text("entry_type").notNull().default("Manual"),
    reference: text("reference"),
    accrualReversalOf: uuid("accrual_reversal_of"),
    sourceType: text("source_type"),
    sourceId: uuid("source_id"),
    reversalOf: uuid("reversal_of"),
    createdBy: text("created_by").references(() => appUsers.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    postedAt: timestamp("posted_at", { withTimezone: true }),
  },
  (t) => [
    unique("journal_entries_org_no_key").on(t.orgId, t.entryNo),
    index("journal_entries_org_date_idx").on(t.orgId, t.entryDate),
  ],
);

export const journalLines = pgTable(
  "journal_lines",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    entryId: uuid("entry_id")
      .notNull()
      .references(() => journalEntries.id, { onDelete: "cascade" }),
    lineNo: integer("line_no").notNull(),
    accountId: uuid("account_id")
      .notNull()
      .references(() => accounts.id),
    debitCents: bigint("debit_cents", { mode: "number" }).notNull().default(0),
    creditCents: bigint("credit_cents", { mode: "number" }).notNull().default(0),
    contactId: uuid("contact_id"),
    description: text("description"),
  },
  (t) => [
    unique("journal_lines_entry_line_key").on(t.entryId, t.lineNo),
    index("journal_lines_entry_idx").on(t.entryId),
    index("journal_lines_account_idx").on(t.accountId),
    check("debit_nonneg", sql`${t.debitCents} >= 0`),
    check("credit_nonneg", sql`${t.creditCents} >= 0`),
    check("one_side_only", sql`${t.debitCents} = 0 OR ${t.creditCents} = 0`),
    check("at_least_one_side", sql`${t.debitCents} > 0 OR ${t.creditCents} > 0`),
  ],
);

export const contacts = pgTable(
  "contacts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    // Canonical enum used by vouchers/filters; derived from `types` when the
    // rich portal labels are supplied (see 0010_contacts_extend.sql).
    type: contactType("type").notNull(),
    name: text("name").notNull(),
    tin: text("tin"),
    email: text("email"),
    phone: text("phone"),
    address: text("address"),
    // ── Rich portal fields (0010) ──
    contactNo: text("contact_no"),
    displayName: text("display_name"),
    parentId: uuid("parent_id"),
    types: text("types").array(),
    costCenter: text("cost_center"),
    category: text("category"),
    branch: text("branch"),
    department: text("department"),
    arAccountCode: text("ar_account_code"),
    apAccountCode: text("ap_account_code"),
    paymentTerms: text("payment_terms"),
    currency: text("currency"),
    creditLimitCents: bigint("credit_limit_cents", { mode: "number" }),
    openingBalanceCents: bigint("opening_balance_cents", { mode: "number" }),
    taxRef: text("tax_ref"),
    mobile: text("mobile"),
    website: text("website"),
    billingAddress: jsonb("billing_address"),
    shippingAddress: jsonb("shipping_address"),
    banks: jsonb("banks"),
    contactPersons: jsonb("contact_persons"),
    notes: text("notes"),
    internalRemarks: text("internal_remarks"),
    needsCompletion: boolean("needs_completion").notNull().default(false),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("contacts_org_type_idx").on(t.orgId, t.type),
    index("contacts_org_parent_idx").on(t.orgId, t.parentId),
  ],
);

export const vouchers = pgTable(
  "vouchers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    voucherNo: text("voucher_no").notNull(),
    voucherType: voucherType("voucher_type").notNull(),
    contactId: uuid("contact_id").references(() => contacts.id),
    voucherDate: date("voucher_date").notNull(),
    memo: text("memo"),
    status: voucherStatus("status").notNull().default("draft"),
    totalCents: bigint("total_cents", { mode: "number" }).notNull().default(0),
    journalEntryId: uuid("journal_entry_id").references(() => journalEntries.id),
    purposeCategory: text("purpose_category"),
    paymentFromAccountId: uuid("payment_from_account_id").references(() => accounts.id),
    notes: text("notes"),
    meta: jsonb("meta"),
    preDisbursementStatus: text("pre_disbursement_status"),
    disbursementRef: text("disbursement_ref"),
    createdBy: text("created_by").references(() => appUsers.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    postedAt: timestamp("posted_at", { withTimezone: true }),
  },
  (t) => [
    unique("vouchers_org_no_key").on(t.orgId, t.voucherNo),
    index("vouchers_org_date_idx").on(t.orgId, t.voucherDate),
  ],
);

/** The voucher's own persisted line items — they become journal_lines only at
 * approval. `meta` round-trips client-side per-line config (tax selections). */
export const voucherLines = pgTable(
  "voucher_lines",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    voucherId: uuid("voucher_id")
      .notNull()
      .references(() => vouchers.id, { onDelete: "cascade" }),
    lineNo: integer("line_no").notNull(),
    accountId: uuid("account_id")
      .notNull()
      .references(() => accounts.id),
    description: text("description"),
    amountCents: bigint("amount_cents", { mode: "number" }).notNull(),
    meta: jsonb("meta"),
  },
  (t) => [
    unique("voucher_lines_voucher_line_key").on(t.voucherId, t.lineNo),
    index("voucher_lines_voucher_idx").on(t.voucherId),
  ],
);

/** Org-level settings: company profile, approval routing, numbering (jsonb). */
export const orgSettings = pgTable("org_settings", {
  orgId: uuid("org_id")
    .primaryKey()
    .references(() => organizations.id, { onDelete: "cascade" }),
  profile: jsonb("profile"),
  approvalRouting: jsonb("approval_routing"),
  docNumbering: jsonb("doc_numbering"),
  modulePolicies: jsonb("module_policies"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const checkbooks = pgTable(
  "checkbooks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    bankCode: text("bank_code").notNull(),
    checkbookType: text("checkbook_type").notNull().default("Loose"),
    startingNumber: text("starting_number").notNull(),
    endingNumber: text("ending_number"),
    checksCount: integer("checks_count"),
    nextCheckNumber: text("next_check_number"),
    isActive: boolean("is_active").notNull().default(true),
    notes: text("notes"),
    createdBy: text("created_by").references(() => appUsers.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("checkbooks_org_bank_idx").on(t.orgId, t.bankCode)],
);

export const checkRegistry = pgTable(
  "check_registry",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    checkNo: text("check_no").notNull(),
    checkbookId: uuid("checkbook_id").references(() => checkbooks.id),
    bankCode: text("bank_code"),
    checkNumber: text("check_number").notNull(),
    checkDate: date("check_date"),
    issueDate: date("issue_date"),
    payeeName: text("payee_name"),
    amountCents: bigint("amount_cents", { mode: "number" }).notNull().default(0),
    netAmountCents: bigint("net_amount_cents", { mode: "number" }),
    status: text("status").notNull().default("Issued"),
    referenceType: text("reference_type"),
    referenceId: text("reference_id"),
    voucherId: uuid("voucher_id").references(() => vouchers.id),
    journalEntryId: uuid("journal_entry_id").references(() => journalEntries.id),
    isPartOfMultiple: boolean("is_part_of_multiple").notNull().default(false),
    lineNo: integer("line_no"),
    voidReason: text("void_reason"),
    clearedDate: date("cleared_date"),
    voidedDate: date("voided_date"),
    stoppedDate: date("stopped_date"),
    staleDate: date("stale_date"),
    notes: text("notes"),
    meta: jsonb("meta"),
    createdBy: text("created_by").references(() => appUsers.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("check_registry_org_status_idx").on(t.orgId, t.status),
    index("check_registry_org_bank_idx").on(t.orgId, t.bankCode, t.checkNumber),
  ],
);

export const disbursementReports = pgTable(
  "disbursement_reports",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    reportNo: text("report_no").notNull(),
    reportDate: date("report_date").notNull(),
    bankCode: text("bank_code"),
    totalCents: bigint("total_cents", { mode: "number" }).notNull().default(0),
    expectedCollectionCents: bigint("expected_collection_cents", { mode: "number" })
      .notNull()
      .default(0),
    status: text("status").notNull().default("Pending"),
    notes: text("notes"),
    bankBalances: jsonb("bank_balances"),
    lines: jsonb("lines"),
    meta: jsonb("meta"),
    createdBy: text("created_by").references(() => appUsers.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("disbursement_reports_org_no_key").on(t.orgId, t.reportNo),
    index("disbursement_reports_org_date_idx").on(t.orgId, t.reportDate),
  ],
);

// ── Tax subsystem (0014) ──
export const taxRates = pgTable(
  "tax_rates",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    rate: numeric("rate", { precision: 9, scale: 4 }).notNull().default("0"),
    trackingType: text("tracking_type").notNull().default("single"),
    taxAccountSingle: text("tax_account_single"),
    taxAccountSales: text("tax_account_sales"),
    taxAccountPurchases: text("tax_account_purchases"),
    isActive: boolean("is_active").notNull().default(true),
    createdBy: text("created_by").references(() => appUsers.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique("tax_rates_org_name_key").on(t.orgId, t.name)],
);

export const taxGroups = pgTable(
  "tax_groups",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    rateNames: text("rate_names").array().notNull().default([]),
    isActive: boolean("is_active").notNull().default(true),
    createdBy: text("created_by").references(() => appUsers.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique("tax_groups_org_name_key").on(t.orgId, t.name)],
);

export const purposeCategories = pgTable(
  "purpose_categories",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique("purpose_categories_org_name_key").on(t.orgId, t.name)],
);

// ── Bank management (0014) ──
export const dailyBankBalances = pgTable(
  "daily_bank_balances",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    bankCode: text("bank_code").notNull(),
    balanceDate: date("balance_date").notNull(),
    beginningCents: bigint("beginning_cents", { mode: "number" }).notNull().default(0),
    endingCents: bigint("ending_cents", { mode: "number" }).notNull().default(0),
    notes: text("notes"),
    createdBy: text("created_by").references(() => appUsers.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("daily_bank_balances_org_bank_date_idx").on(t.orgId, t.bankCode, t.balanceDate)],
);

export const bankTransactions = pgTable(
  "bank_transactions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    bankCode: text("bank_code").notNull(),
    txDate: date("tx_date").notNull(),
    description: text("description"),
    reference: text("reference"),
    debitCents: bigint("debit_cents", { mode: "number" }).notNull().default(0),
    creditCents: bigint("credit_cents", { mode: "number" }).notNull().default(0),
    txType: text("tx_type"),
    status: text("status"),
    source: text("source").notNull().default("Manual"),
    createdBy: text("created_by").references(() => appUsers.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("bank_transactions_org_bank_date_idx").on(t.orgId, t.bankCode, t.txDate)],
);

export const bankReconciliations = pgTable(
  "bank_reconciliations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    reconNo: text("recon_no").notNull(),
    bankCode: text("bank_code").notNull(),
    beginningCents: bigint("beginning_cents", { mode: "number" }).notNull().default(0),
    endingCents: bigint("ending_cents", { mode: "number" }).notNull().default(0),
    periodEnding: date("period_ending"),
    clearedCount: integer("cleared_count").notNull().default(0),
    meta: jsonb("meta"),
    createdBy: text("created_by").references(() => appUsers.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique("bank_reconciliations_org_no_key").on(t.orgId, t.reconNo)],
);

// ── Billing / AR (0015) ──
// balance_cents / unapplied_cents are Postgres GENERATED columns — declared
// plainly here and never written by the API, so selects return them while
// inserts/updates leave the computation to the database.
export const billingStatements = pgTable(
  "billing_statements",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    bsNo: text("bs_no").notNull(),
    contactId: uuid("contact_id").references(() => contacts.id),
    contactName: text("contact_name").notNull(),
    billingDate: date("billing_date").notNull(),
    dueDate: date("due_date"),
    creditTerm: integer("credit_term").notNull().default(30),
    periodStart: date("period_start"),
    periodEnd: date("period_end"),
    description: text("description"),
    grossCents: bigint("gross_cents", { mode: "number" }).notNull().default(0),
    taxGroupName: text("tax_group_name").notNull().default("VAT"),
    totalVatInclusiveCents: bigint("total_vat_inclusive_cents", { mode: "number" })
      .notNull()
      .default(0),
    netDueCents: bigint("net_due_cents", { mode: "number" }).notNull().default(0),
    appliedCents: bigint("applied_cents", { mode: "number" }).notNull().default(0),
    balanceCents: bigint("balance_cents", { mode: "number" }),
    incomeAccount: text("income_account"),
    lines: jsonb("lines"),
    notes: text("notes"),
    status: text("status").notNull().default("Draft"),
    reviewedBy: text("reviewed_by"),
    approvedBy: text("approved_by"),
    rejectReason: text("reject_reason"),
    createdBy: text("created_by").references(() => appUsers.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("billing_statements_org_bs_no_key").on(t.orgId, t.bsNo),
    index("billing_statements_org_date_idx").on(t.orgId, t.billingDate),
  ],
);

export const serviceInvoices = pgTable(
  "service_invoices",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    siNo: text("si_no").notNull(),
    contactId: uuid("contact_id").references(() => contacts.id),
    contactName: text("contact_name").notNull(),
    siDate: date("si_date").notNull(),
    dueDate: date("due_date"),
    amountCents: bigint("amount_cents", { mode: "number" }).notNull().default(0),
    taxType: text("tax_type").notNull().default("N/A"),
    ewtRate: numeric("ewt_rate", { precision: 9, scale: 4 }).notNull().default("0"),
    incomeAccountCode: text("income_account_code"),
    billingStatementId: text("billing_statement_id"),
    appliedCents: bigint("applied_cents", { mode: "number" }).notNull().default(0),
    balanceCents: bigint("balance_cents", { mode: "number" }),
    notes: text("notes"),
    status: text("status").notNull().default("Draft"),
    reviewedBy: text("reviewed_by"),
    approvedBy: text("approved_by"),
    rejectReason: text("reject_reason"),
    createdBy: text("created_by").references(() => appUsers.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("service_invoices_org_si_no_key").on(t.orgId, t.siNo),
    index("service_invoices_org_date_idx").on(t.orgId, t.siDate),
  ],
);

export const collections = pgTable(
  "collections",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    collectionNo: text("collection_no").notNull(),
    contactId: uuid("contact_id").references(() => contacts.id),
    contactName: text("contact_name").notNull(),
    collectionDate: date("collection_date").notNull(),
    amountReceivedCents: bigint("amount_received_cents", { mode: "number" })
      .notNull()
      .default(0),
    appliedCents: bigint("applied_cents", { mode: "number" }).notNull().default(0),
    unappliedCents: bigint("unapplied_cents", { mode: "number" }),
    method: text("method").notNull().default("Cash"),
    referenceNo: text("reference_no"),
    billingStatementId: text("billing_statement_id"),
    siId: text("si_id"),
    notes: text("notes"),
    status: text("status").notNull().default("Unposted"),
    postedBy: text("posted_by"),
    postedAt: timestamp("posted_at", { withTimezone: true, mode: "string" }),
    createdBy: text("created_by").references(() => appUsers.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("collections_org_collection_no_key").on(t.orgId, t.collectionNo),
    index("collections_org_date_idx").on(t.orgId, t.collectionDate),
  ],
);

export const paymentSchedules = pgTable(
  "payment_schedules",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    scheduleNo: text("schedule_no").notNull(),
    title: text("title").notNull(),
    contactId: uuid("contact_id").references(() => contacts.id),
    contactName: text("contact_name"),
    category: text("category"),
    frequency: text("frequency").notNull().default("Monthly"),
    amountCents: bigint("amount_cents", { mode: "number" }).notNull().default(0),
    dueDate: date("due_date"),
    startDate: date("start_date"),
    endDate: date("end_date"),
    dueDay: integer("due_day").notNull().default(0),
    status: text("status").notNull().default("Active"),
    notes: text("notes"),
    defaultExpenseAccountCode: text("default_expense_account_code"),
    defaultTaxRateId: text("default_tax_rate_id"),
    paymentMethod: text("payment_method"),
    pmConfig: jsonb("pm_config"),
    createdBy: text("created_by").references(() => appUsers.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique("payment_schedules_org_schedule_no_key").on(t.orgId, t.scheduleNo)],
);

export const schedulePayments = pgTable(
  "schedule_payments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    scheduleId: uuid("schedule_id").references(() => paymentSchedules.id, {
      onDelete: "set null",
    }),
    scheduleTitle: text("schedule_title"),
    dueDate: date("due_date"),
    payDate: date("pay_date").notNull(),
    amountCents: bigint("amount_cents", { mode: "number" }).notNull().default(0),
    method: text("method"),
    bank: text("bank"),
    checkId: text("check_id"),
    checkNumber: text("check_number"),
    checkRegisterId: text("check_register_id"),
    voucherNo: text("voucher_no"),
    voucherDocId: uuid("voucher_doc_id"),
    notes: text("notes"),
    createdBy: text("created_by").references(() => appUsers.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("schedule_payments_org_schedule_idx").on(t.orgId, t.scheduleId)],
);

// ── Loans (0016) ──
export const loans = pgTable(
  "loans",
  {
  id: uuid("id").primaryKey().defaultRandom(),
  orgId: uuid("org_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  loanNo: text("loan_no"),
  name: text("name").notNull(),
  loanType: text("loan_type").notNull().default("Term Loan"),
  disbursementDate: date("disbursement_date"),
  proceedsDate: date("proceeds_date"),
  termMonths: integer("term_months").notNull().default(60),
  annualRate: numeric("annual_rate", { precision: 9, scale: 4 }).notNull().default("0"),
  principalCents: bigint("principal_cents", { mode: "number" }).notNull().default(0),
  interestMethod: text("interest_method").notNull().default("Reducing Balance"),
  processingFeeCents: bigint("processing_fee_cents", { mode: "number" }).notNull().default(0),
  status: text("status").notNull().default("Active"),
  paymentFrequency: text("payment_frequency").notNull().default("Monthly"),
  payDayMode: text("pay_day_mode").notNull().default("Fixed"),
  payDay1: integer("pay_day1"),
  payDay2: integer("pay_day2"),
  payDaysPerMonth: jsonb("pay_days_per_month"),
  intervalDays: integer("interval_days").notNull().default(15),
  paymentMethod: text("payment_method"),
  pmConfig: jsonb("pm_config"),
  createdBy: text("created_by").references(() => appUsers.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique("loans_org_no_key").on(t.orgId, t.loanNo)],
);

export const loanPayments = pgTable(
  "loan_payments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    loanId: uuid("loan_id").references(() => loans.id, { onDelete: "set null" }),
    loanName: text("loan_name"),
    payDate: date("pay_date").notNull(),
    interestCents: bigint("interest_cents", { mode: "number" }).notNull().default(0),
    principalCents: bigint("principal_cents", { mode: "number" }).notNull().default(0),
    penaltyCents: bigint("penalty_cents", { mode: "number" }).notNull().default(0),
    totalCents: bigint("total_cents", { mode: "number" }).notNull().default(0),
    method: text("method"),
    referenceNo: text("reference_no"),
    bank: text("bank"),
    voucherNo: text("voucher_no"),
    voucherDocId: uuid("voucher_doc_id"),
    checkVoucherNo: text("check_voucher_no"),
    notes: text("notes"),
    allocations: jsonb("allocations"),
    createdBy: text("created_by").references(() => appUsers.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("loan_payments_org_loan_idx").on(t.orgId, t.loanId)],
);

// ── Fixed assets (0016) ──
export const assetTypes = pgTable(
  "asset_types",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    typeNo: text("type_no"),
    name: text("name").notNull(),
    depreciationMethod: text("depreciation_method").notNull().default("Straight Line"),
    usefulLifeMonths: integer("useful_life_months"),
    fixedAssetAccount: text("fixed_asset_account"),
    accumDeprecAccount: text("accum_deprec_account"),
    deprecExpenseAccount: text("deprec_expense_account"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique("asset_types_org_name_key").on(t.orgId, t.name)],
);

export const fixedAssets = pgTable(
  "fixed_assets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    assetNo: text("asset_no").notNull(),
    name: text("name").notNull(),
    assetType: text("asset_type"),
    purchaseDate: date("purchase_date"),
    deprecStartDate: date("deprec_start_date"),
    costCents: bigint("cost_cents", { mode: "number" }).notNull().default(0),
    residualCents: bigint("residual_cents", { mode: "number" }).notNull().default(0),
    usefulLifeMonths: integer("useful_life_months").notNull().default(0),
    depreciationMethod: text("depreciation_method").notNull().default("Straight Line"),
    computationType: text("computation_type").notNull().default("Non Pro Rata"),
    fixedAssetAccount: text("fixed_asset_account"),
    accumDeprecAccount: text("accum_deprec_account"),
    deprecExpenseAccount: text("deprec_expense_account"),
    status: text("status").notNull().default("Active"),
    disposalDate: date("disposal_date"),
    notes: text("notes"),
    isInstallment: boolean("is_installment").notNull().default(false),
    installmentPrincipalCents: bigint("installment_principal_cents", { mode: "number" })
      .notNull()
      .default(0),
    installmentStartDate: date("installment_start_date"),
    installmentTermMonths: integer("installment_term_months").notNull().default(0),
    installmentAnnualRate: numeric("installment_annual_rate", { precision: 9, scale: 4 })
      .notNull()
      .default("0"),
    installmentMethod: text("installment_method").notNull().default("Reducing Balance"),
    installmentPayableAccount: text("installment_payable_account"),
    installmentAmortizationAccount: text("installment_amortization_account"),
    paymentMethod: text("payment_method"),
    pmConfig: jsonb("pm_config"),
    createdBy: text("created_by").references(() => appUsers.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique("fixed_assets_org_asset_no_key").on(t.orgId, t.assetNo)],
);

export const assetInstallmentPayments = pgTable(
  "asset_installment_payments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    assetId: uuid("asset_id").references(() => fixedAssets.id, { onDelete: "set null" }),
    assetName: text("asset_name"),
    period: integer("period").notNull(),
    label: text("label"),
    payDate: date("pay_date").notNull(),
    principalCents: bigint("principal_cents", { mode: "number" }).notNull().default(0),
    interestCents: bigint("interest_cents", { mode: "number" }).notNull().default(0),
    totalCents: bigint("total_cents", { mode: "number" }).notNull().default(0),
    method: text("method"),
    bank: text("bank"),
    checkId: text("check_id"),
    checkNumber: text("check_number"),
    checkRegisterId: text("check_register_id"),
    voucherNo: text("voucher_no"),
    voucherDocId: uuid("voucher_doc_id"),
    notes: text("notes"),
    createdBy: text("created_by").references(() => appUsers.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("asset_installment_payments_org_asset_idx").on(t.orgId, t.assetId)],
);

export const assetDeprPostings = pgTable(
  "asset_depr_postings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    period: text("period").notNull(),
    journalEntryId: uuid("journal_entry_id"),
    totalCents: bigint("total_cents", { mode: "number" }).notNull().default(0),
    assetCount: integer("asset_count").notNull().default(0),
    createdBy: text("created_by").references(() => appUsers.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique("asset_depr_postings_org_period_key").on(t.orgId, t.period)],
);

// ── Weekly projections + credit lines (0016) ──
export const weeklyProjections = pgTable(
  "weekly_projections",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    projNo: text("proj_no").notNull(),
    weekCoverage: text("week_coverage"),
    startDate: date("start_date"),
    endDate: date("end_date"),
    status: text("status").notNull().default("Draft"),
    totalOutCents: bigint("total_out_cents", { mode: "number" }).notNull().default(0),
    totalInCents: bigint("total_in_cents", { mode: "number" }).notNull().default(0),
    notes: text("notes"),
    lines: jsonb("lines"),
    inflowLines: jsonb("inflow_lines"),
    createdBy: text("created_by").references(() => appUsers.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique("weekly_projections_org_proj_no_key").on(t.orgId, t.projNo)],
);

export const creditLines = pgTable("credit_lines", {
  id: uuid("id").primaryKey().defaultRandom(),
  orgId: uuid("org_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  bankCode: text("bank_code"),
  displayName: text("display_name").notNull(),
  creditLimitCents: bigint("credit_limit_cents", { mode: "number" }).notNull().default(0),
  interestRate: numeric("interest_rate", { precision: 9, scale: 4 }).notNull().default("0"),
  availableBalanceCents: bigint("available_balance_cents", { mode: "number" })
    .notNull()
    .default(0),
  asOfDate: date("as_of_date"),
  notes: text("notes"),
  createdBy: text("created_by").references(() => appUsers.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// ── Payment terms (0017) ──
export const paymentTerms = pgTable(
  "payment_terms",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    days: integer("days").notNull().default(0),
    description: text("description"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique("payment_terms_org_name_key").on(t.orgId, t.name)],
);

export type Organization = typeof organizations.$inferSelect;
export type Account = typeof accounts.$inferSelect;
export type JournalEntry = typeof journalEntries.$inferSelect;
export type JournalLine = typeof journalLines.$inferSelect;
export type Contact = typeof contacts.$inferSelect;
export type Voucher = typeof vouchers.$inferSelect;

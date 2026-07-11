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
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

export const accountType = pgEnum("account_type", [
  "asset",
  "liability",
  "equity",
  "income",
  "expense",
]);

export const entryStatus = pgEnum("entry_status", ["draft", "posted", "reversed"]);

export const userRole = pgEnum("user_role", [
  "maker",
  "verifier",
  "approver",
  "poster",
  "admin",
]);

export const contactType = pgEnum("contact_type", ["vendor", "customer", "employee"]);

export const voucherType = pgEnum("voucher_type", ["payment", "receipt"]);

export const voucherStatus = pgEnum("voucher_status", ["draft", "posted", "void"]);

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
    // this id — Authenticize authenticates, Sentire owns the user allowlist.
    id: text("id")
      .primaryKey()
      .default(sql`gen_random_uuid()::text`),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    email: text("email").notNull(),
    fullName: text("full_name"),
    role: userRole("role").notNull().default("maker"),
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
    type: contactType("type").notNull(),
    name: text("name").notNull(),
    tin: text("tin"),
    email: text("email"),
    phone: text("phone"),
    address: text("address"),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("contacts_org_type_idx").on(t.orgId, t.type)],
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
    createdBy: text("created_by").references(() => appUsers.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    postedAt: timestamp("posted_at", { withTimezone: true }),
  },
  (t) => [
    unique("vouchers_org_no_key").on(t.orgId, t.voucherNo),
    index("vouchers_org_date_idx").on(t.orgId, t.voucherDate),
  ],
);

export type Organization = typeof organizations.$inferSelect;
export type Account = typeof accounts.$inferSelect;
export type JournalEntry = typeof journalEntries.$inferSelect;
export type JournalLine = typeof journalLines.$inferSelect;
export type Contact = typeof contacts.$inferSelect;
export type Voucher = typeof vouchers.$inferSelect;

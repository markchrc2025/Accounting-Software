# Sentire Books — Capability & Feature Inventory

> **Purpose.** A complete, code-verified inventory of what Sentire Books actually is today, written
> as a handoff brief. Every claim here was checked against the source tree, not against design docs.
>
> **Status date:** 31 July 2026 · **Verified against:** `main`
> **Codebase:** `sentire-books-api/` (Hono + Drizzle + PostgreSQL) · `sentire-books/` (React + Vite SPA)
>
> **How to read this.** Where this document and any older design/roadmap document disagree,
> **this document wins** — the older docs (`docs/SYSTEM-DESIGN.md`, the six `Phase-*.md` roadmap
> files) predate the module build-out and are stale in specific, marked places. Statuses used
> throughout: **Built** (works end to end) · **Partial** (exists, with a named limitation) ·
> **Open** (absent — verified by search, not assumed).

---

## 1. System at a glance

Sentire Books is a **multi-tenant, double-entry bookkeeping platform for Philippine SMEs**. It is
not a ledger toy: the general ledger is enforced by the database itself, and every business module
is designed to feed that one ledger.

| | |
|---|---|
| **API** | Hono on Node 20, TypeScript run directly via `tsx` (no build step; `build` = `tsc --noEmit`) |
| **Database** | PostgreSQL 15+, plain SQL migrations (22 files, `0000`–`0021`), Drizzle ORM |
| **Portal** | React 18 + Vite SPA, `react-router-dom` v6, served by nginx |
| **Auth** | Locally-signed **HS256 JWT** (`jose`), scrypt password hashes, 8-hour tokens |
| **Multi-tenancy** | PostgreSQL **Row-Level Security**, one policy per table, keyed on a per-transaction GUC |
| **Money** | **Integer centavos (`bigint`) everywhere.** No floats in the ledger. |
| **Hosting** | Sliplane containers; portal at `books.sentire.solutions` |
| **Monorepo** | `sentire-books-api/` = pnpm + Turborepo workspace (`apps/api`, `packages/db`, `packages/domain`). `sentire-books/` = **separate** npm project, not in the workspace. |

**Scale of the thing:** 33 tables · 6 Postgres enums · 32 API routers · 22 portal routes ·
19 portal modules · 5 reports · 158-account default chart of accounts.

---

## 2. The ledger core — architecture and invariants

This is the most important section. Everything else is a feeder into it.

### 2.1 Single-writer principle

Every journal entry created by the API goes through **one function**:
`postJournalEntryCore()` in `apps/api/src/ledger/postJournalEntry.ts`. It:

1. Allocates an atomic per-org, per-period entry number from `document_counters` (`JE202607-0001`).
2. Inserts the header as `draft`, inserts all lines, then flips to `posted`.
3. Runs inside a **caller-supplied transaction**, so the database's deferred balance triggers fire
   once at `COMMIT` — meaning a module can create its own rows *and* the journal entry atomically.

Corrections never mutate history. `reverseJournalEntryCore()` writes a **new** `Reversing` entry
with debits/credits swapped, dated the same as the original, linked by `reversal_of`, and flips the
original to `reversed`.

### 2.2 Database-enforced invariants

These hold even if the application is wrong or bypassed:

| # | Invariant | Mechanism |
|---|---|---|
| 1 | Every posted entry balances and is non-zero | `assert_entry_balanced()` — **deferrable constraint triggers** on `journal_lines` and `journal_entries` |
| 2 | Posted entries are append-only | `prevent_posted_entry_mutation()` — only `posted → reversed` allowed; posted deletes raise `restrict_violation` |
| 3 | Line-level sanity | CHECK constraints: `debit_nonneg`, `credit_nonneg`, `one_side_only`, `at_least_one_side` |
| 4 | No duplicate or racing document numbers | `document_counters` PK `(org_id, period_key)` + `INSERT … ON CONFLICT DO UPDATE … RETURNING` |
| 5 | Org isolation | RLS `org_isolation` policy on every business table, predicate `current_org_id()` reading the `app.current_org_id` GUC set per transaction by `withOrgContext()` |
| 6 | Reversed postings stay in reports | `v_account_postings` selects `status IN ('posted','reversed')` so a reversal and its original both appear and net to zero |

Balance is checked **three times** — zod `.refine`, `assertBalanced()` in app code, and the DB
triggers — with the database as the real guard. `isBalanced` is exact integer comparison
(`debit === credit && debit > 0`), deliberately replacing a legacy float tolerance.

> **One documented escape hatch.** Migration `0018` lets both immutability triggers no-op when the
> transaction-local `app.allow_data_admin` GUC is set. This exists solely so the admin
> workspace-reset/restore tools can work. It is the only code path that writes journal rows outside
> the ledger core.

### 2.3 Journal entry state machine

`ENTRY_STATUSES` (10, a Postgres enum): `draft`, `pending_review`, `pending_approval`,
`for_clearing`, `cleared`, `for_posting`, `posted`, `rejected`, `voided`, `reversed`.

```
draft → pending_review → pending_approval → for_clearing → cleared → for_posting → posted
              ↘ rejected → draft            ↘ rejected      ↘ rejected   ↘ rejected
```

`ENTRY_TYPES`: Manual, Adjusting, Accrual, Closing, Reversing.
`EDITABLE_STATUSES` = everything pre-ledger. `DELETABLE_STATUSES` = `draft`, `rejected` only.
Transitions are whitelisted server-side (`JOURNAL_TRANSITIONS`); an illegal move returns
`409 invalid_transition`.

### 2.4 Every path that writes to the ledger

**Server-side (inside the ledger core):**

| Source | Entry posted |
|---|---|
| Manual JE — `POST /journal-entries` | As supplied; requires poster role to post directly |
| Workflow post — `POST /journal-entries/:id/status → posted` | The only path moving a draft into the ledger |
| Reversal — `POST /journal-entries/:id/reverse` | Mirror entry, type `Reversing` |
| Voucher approval — `POST /vouchers/:id/status → approved` | DR detail lines / CR cash (receipt vouchers invert) |
| Voucher void — `POST /vouchers/:id/void` | Reverses the linked JE |
| **Loan booking** — `POST /loans/register`, `/:id/book` | Disbursement: DR Cash + DR Finance Cost / CR Loans Payable · Opening balance: DR Opening Balance Offset / CR Loans Payable |
| **Loan unbook / cancel** | Reverses the booking entry |
| **Fixed-asset acquisition** — `POST /fixed-assets/register`, `/:id/book` | Cash: DR Asset / CR Cash · Installment: DR Asset / CR Fixed Assets Payable (+ CR Cash down payment) · Opening balance: DR Asset / CR Accum. Depr. / CR Opening Balance Offset |
| **Fixed-asset cancel** | Reverses the acquisition entry |

**Client-side (posted from the browser via `POST /journal-entries`)** — an architectural
inconsistency worth knowing about:

| Source | Entry posted |
|---|---|
| Monthly depreciation (Fixed Assets → Post Depreciation) | DR Depreciation Expense / CR Accumulated Depreciation, one JE per month, locked one-per-period by a unique constraint |
| Check clearing settlement | Liability derecognized on the settlement date |

**Indirect (originates a document, not an entry):**
`POST /loans/:id/pay` creates a Payment Voucher (Bank Transfer/Cash/Online/Auto-Debit) or a
Check Voucher + Check Registry entry (PDC). The JE posts later — at voucher approval or check clearing.

**⚠️ Does NOT post to the ledger:** Billing Statements, Service Invoices, Collections, Payment
Schedules, Schedule Payments. These are CRUD-only today. See §8.

---

## 3. Backend module inventory (32 routers)

Two unauthenticated service endpoints (`GET /`, `GET /health`). Everything else is behind
`requireAuth`, which resolves `{userId, orgId, role}` from the database **on every request** and
runs all queries inside `withOrgContext()` so RLS applies.

**12 routers are hand-written; 20 are generated** by `makeCrudRoutes()` (`crudFactory.ts`), which
provides list / create / update / delete, server-assigned document numbers, and optional
`adminWrites` gating.

### Core accounting

| Route | Type | Key capability |
|---|---|---|
| `/auth` | hand | `POST /auth/password` (public sign-in), `GET /auth/workspaces`, `GET /auth/me` |
| `/users` | hand | Workspace user allowlist — **all 5 endpoints admin-only**; includes `POST /:id/password` |
| `/accounts` | hand | Chart of accounts; reads open to members, writes admin-only; `POST /import` bulk import |
| `/journal-entries` | hand | Full CRUD + `POST /:id/status` (workflow) + `POST /:id/reverse`; rich filters, embedded enriched lines |
| `/reports` | hand | 5 read-only reports (§6) |
| `/contacts` | hand | Vendors / customers / employees, ~30 columns, `CNT{YYYYMM}-####` numbering |
| `/vouchers` | hand | Draft + legacy atomic modes, `POST /:id/status`, `POST /:id/void` |

### Disbursement

| Route | Type | Key capability |
|---|---|---|
| `/checkbooks` | hand | Checkbook master; enforces one active book per bank |
| `/checks` | hand | Check registry; single **or batch** create; `POST /:id/status` lifecycle (Issued → Cleared / Voided / Stopped / Stale) |
| `/disbursement-reports` | hand | Batches vouchers for payment; `claimVouchers` parks them at `for_disbursement` and can revert |

### Billing & AR

`/billing-statements` · `/service-invoices` · `/collections` · `/payment-schedules` ·
`/schedule-payments` — all factory CRUD with generated document numbers (`BS`, `IS`, `COL`, `PS`)
and DB-generated `balanceCents` / `unappliedCents` columns.

### Financial management

| Route | Type | Key capability |
|---|---|---|
| `/loans` | **hybrid** | Factory CRUD **+ 6 hand-written ledger endpoints**: `/register`, `/:id/book`, `/:id/unbook`, `/:id/cancel`, `/:id/pay`, `/reconciliation` |
| `/loan-payments` | factory | Payment records |
| `/fixed-assets` | **hybrid** | Factory CRUD **+ 3 ledger endpoints**: `/register`, `/:id/book`, `/:id/cancel` |
| `/asset-types`, `/asset-installment-payments`, `/asset-depr-postings` | factory | Asset masters, installments, per-month depreciation lock |
| `/weekly-projections`, `/credit-lines` | factory | Cash planning, bank credit lines |

### Reference data, bank, tax, settings

`/tax-rates` · `/tax-groups` (admin writes) · `/purpose-categories` · `/payment-terms` (admin writes) ·
`/bank-balances` · `/bank-transactions` · `/bank-reconciliations` ·
`/settings` (org profile, approval routing, doc numbering, module policies; `GET /counters`) ·
`/settings/data` (**admin-only**: `GET /export`, `POST /import`, `POST /reset`).

---

## 4. Portal module inventory (22 routes, 19 modules)

Shell: `TopBar` (company selector, ⌘K search trigger, approvals badge) + 80px icon `LeftRail`
(hover-flyout groups) + `CreateFlyout` + `CommandPalette`. Every route is wrapped in a
`ModuleGuard` that falls back to an `AccessDenied` screen.

| Module | Route | Tabs / notable features |
|---|---|---|
| **Dashboard** | `/dashboard` | Customisable widget grid (`react-grid-layout`, layout persisted), greeting bar, hub pills, privacy mode (`₱••••`) |
| **Vouchers** | `/vouchers` | 6 KPI cards, bulk submit/void/delete, jsPDF voucher printing |
| **My Approvals** | `/approvals` | **Unified queue across 5 document types**, bulk process/reject, routing-aware |
| **Weekly Projections** | `/projections` | 7 KPIs, approval workflow |
| **Payment Schedule** | `/pay-schedule` | Schedules · Payment Method · Calendar · History |
| **Disbursements** | `/disbursements` | Master disbursement reports, voucher claiming |
| **Check Registry** | `/checks` | Check Register · Analytics & Aging · Checkbook Management; PH peso amount-in-words PDF |
| **Journal** | `/journal` | Full workflow UI, bulk actions (Submit / Clear / Post / **Reverse** / **Void**), confirmations |
| **Bank** | `/bank` | Bank Balances · Credit Lines · Bank Transactions · Reconciliation |
| **Chart of Accounts** | `/coa` | Hierarchical COA, Excel import |
| **Tax** | `/tax` | Tax Entries · Tax Registry · Tax Summary |
| **Financial Management** | `/financial` | **7 tabs** — Dashboard · Loan Registry · Amortization · Payment History · Calendar · Reports · Settings. Client-side amortization engine (`loanMonitoring.js`), customisable dashboard scorecards, sub-ledger⇄GL reconciliation tile |
| **Fixed Assets** | `/assets` | **8 tabs** — Dashboard · Assets · Asset Types · Depreciation Schedule · Post Depreciation · Installments · Installment Calendar · Installment Payment |
| **Billing Book** | `/billing` | Billing statements + `/billing/:clientId` client view |
| **Service Invoices** | `/invoices` | Invoice lifecycle |
| **Collections** | `/collections` | AR receipts, applied/unapplied tracking |
| **Contacts** | `/contacts` | 7-tab contact modal (General · Financial · Contact Info · Addresses · Banks · Contact Persons · Notes) |
| **Reports** | `/reports` | Report catalogue with favourites + `/reports/builder/:type` |
| **Settings** | `/settings` | 8 sections in 4 groups (Organization · Module · Reference Data · Data) — admin-only |
| **Profile** | `/profile` | Read-only profile + "My Approval Routing" |

**Shared building blocks:** `AccountCombobox` (grouped/indented COA picker with inline account
creation), `ContactPicker` (with inline stub-contact creation), `MoneyText`, `StatusPill`,
`PeriodSelect`, 7 shadcn-style Radix primitives, `useApprovalCount` (60s polling badge),
`useDashboardLayout`, `issueCheck` utility, `schedulePrefill` session handoff.

---

## 5. Data model (33 tables)

**Tenancy & identity:** `organizations`, `app_users` (per-workspace email allowlist),
`org_settings` (profile / approval routing / doc numbering / module policies), `credentials`*.

**Ledger:** `accounts` (hierarchical, `parent_id`), `journal_entries`, `journal_lines`,
`document_counters`.

**Documents:** `contacts`, `vouchers`, `voucher_lines`, `checkbooks`, `check_registry`,
`disbursement_reports`.

**Billing & AR:** `billing_statements`, `service_invoices`, `collections`, `payment_schedules`,
`schedule_payments`.

**Financial:** `loans`, `loan_payments`, `fixed_assets`, `asset_types`,
`asset_installment_payments`, `asset_depr_postings`, `weekly_projections`, `credit_lines`.

**Bank & tax:** `daily_bank_balances`, `bank_transactions`, `bank_reconciliations`, `tax_rates`,
`tax_groups`, `purpose_categories`, `payment_terms`.

> **\*`credentials` is not in `schema.ts` and not in any migration.** It is created at API boot by
> `ensureAuthTables()` via raw `CREATE TABLE IF NOT EXISTS`. The password store is therefore outside
> version-controlled schema — worth fixing.

**Enums (6):** `account_type`, `entry_status`, `user_role` (maker/verifier/approver/poster/admin),
`contact_type`, `voucher_type` (payment/receipt/payroll/final_pay/loan/check),
`voucher_status` (11 states).

**Views:** `v_account_postings`, `v_trial_balance` — both `security_invoker`, so RLS applies to the
querying role automatically.

**SECURITY DEFINER functions:** `get_user_context(email, org_id)`, `get_user_workspaces(email)` —
the multi-workspace resolution path that intentionally bypasses RLS to answer "which orgs may this
email enter?"

**Document number prefixes:** `JE` · `PV` `RV` `PR` `FP` `LV` `CHK` (vouchers) · `CHK` (checks) ·
`DR` · `CNT` · `BS` `IS` `COL` `PS` · `LN` · `WP` · `RC` · `FA`/`FAT`.

---

## 6. Reports

All five hit the `v_account_postings` view, so RLS scoping is automatic and they reconcile to the
same source as the trial balance.

| Report | Endpoint |
|---|---|
| Trial Balance | `GET /reports/trial-balance?from&to` — per-account debit/credit, totals, `balanced` flag |
| General Ledger | `GET /reports/general-ledger?from&to` — opening balance, every posting with running balance |
| Income Statement | `GET /reports/income-statement` |
| Balance Sheet | `GET /reports/balance-sheet` |
| Profit & Loss | `GET /reports/profit-and-loss` |

The portal adds a report **catalogue** (favourites, search) and a **builder** with ~48 period
presets, cash/accrual toggle, and density controls.

---

## 7. Security & access control

**What is genuinely strong:**

- **Authorization is re-resolved from the database on every request.** The token proves only an
  email; role and org membership come from `get_user_context()` per call. A forged or stale role
  claim cannot escalate, and a role change or membership removal takes effect on the **next request**.
- **RLS is the backstop**, not the app. Queries run as a restricted role inside a transaction with
  org GUCs set.
- **Ledger integrity is in the database** (§2.2).
- Password hashing is scrypt, with a **timing-uniform** dummy-hash verify for unknown emails so
  response time does not leak account existence.
- CI runs integration tests as the RLS-bound `sentire_books_app` role — so RLS is actually exercised.

**Roles:** `maker` → `verifier` → `approver` → `poster` → `admin`. Voucher transitions differentiate
verifier from poster; journal workflow gates on `['poster','approver','admin']`.

**Verified security gaps** (searched for, not assumed — details in §8).

---

## 8. Roadmap reconciliation — what's built vs. what's open

The six roadmap phase documents were written earlier in the build and are **stale in specific
places**. All 53 claims below were independently and adversarially verified against the source —
"Open" means absence was *proven by search*, not assumed.

**Tally: 10 Built · 21 Partial · 22 Open.** (Updated as Milestone 0 lands.)

| Phase | Built | Partial | Open | Verdict |
|---|---|---|---|---|
| 1 · Pre-Launch Hardening | 1 | 3 | 5 | Mostly open — the real gate |
| 2 · AI Layer | 0 | 0 | 7 | Greenfield |
| 3 · Approvals & Controls | 0 | 7 | 2 | Machinery built, governance not |
| 4 · Sellable MVP Modules | 7 | 4 | 2 | Mostly built |
| 5 · Compliance & Trust | 0 | 2 | 4 | Mostly open |
| 6 · Scale & Operations | 2 | 5 | 2 | Mixed |

### Phase 1 — Pre-Launch Hardening → **mostly OPEN** (this is the real gate)

| Item | Status | Evidence |
|---|---|---|
| Observability / error tracking / structured logs | **Open** | No Sentry/OTel/pino; ~30 raw `console.error` calls with no org/user/request id |
| Rate limiting / abuse protection | **Open** | Zero matches for rate-limit/429/throttle. `POST /auth/password` has **no middleware at all** |
| Login lockout / backoff | **Open** | `credentials` has no attempt/lock columns; no counter on failure |
| CORS tight | **Partial** | List is explicit with no wildcards, **but** `CORS_ORIGIN=""` yields `allowedOrigins=[]` → falls back to literal `"*"`. Blast radius limited (no `credentials: true`; Bearer tokens) |
| MFA | **Open** | No TOTP anywhere; no factor columns |
| Session-revocation window | **Partial** | Role/membership changes: ~0 delay. **Identity revocation: up to 8h** — self-contained JWTs, no denylist/jti/token version; a password reset does not invalidate existing tokens. Nowhere documented |
| Backup / PITR / RPO / RTO / restore drill | **Open** | No backup, PITR, RPO, RTO or DR content in any doc |
| Boot assertion on auth misconfig | **Built** | ✅ **M0.2.** Production refuses to start (exit 1, nothing listening) when `AUTH_JWT_SECRET` is missing **or** `AUTH_DEV_BYPASS="true"` — treated as fatal independently, so the bypass cannot become reachable through a later edit. Boot also warns that `AUTH_JWKS_URL`/`AUTH_ISSUER` are read nowhere. The stale docs themselves remain TODO (M6.5) |
| Secret rotation note | **Partial** | One sentence in `.env.example`; no cadence, owner, or procedure |

### Phase 2 — AI Layer → **entirely OPEN** (greenfield)

No AI actor, endpoints, model calls, metering, caching, budgets, or entitlement gating exist
anywhere in the tree. The **"AI never posts directly, only drafts"** principle the roadmap proposes
is a natural fit — the single-writer design already makes it enforceable.

### Phase 3 — Approvals & Controls → **machinery built, governance not**

The roadmap calls this "defined but not enforced." That is stale in one direction and *understated*
in another: enforcement exists for the two ledger-bearing document types, but the configuration
layer above it turns out to be decorative.

| Item | Status |
|---|---|
| Document status machine (JE + vouchers) | **Partial** — return-to-maker is only `rejected → draft`; vouchers never reach `posted` via the graph (`approved` is the ledger event, `approved → paid` is terminal) |
| Transitions enforced server-side | **Partial** — true for journal entries and vouchers; **not** for disbursements, projections or the AR documents the same queue drives |
| Transitions enforced in the DB | **Partial** — the DB guards balance and post-immutability, not the approval graph |
| Only approved flows to posted, single writer | **Partial** — holds for workflow-driven documents; the direct create-and-post endpoints bypass approval by design, gated on role alone |
| Distinct Maker/Verifier/Approver authority | **Partial** — authority is coarse workspace-role, not per-document |
| **Self-approval blocked** | **Open** — one poster/approver/admin can create a voucher, verify it, approve it and post the JE **entirely alone** |
| "My Approvals" queue, bulk, remarks | **Partial** — unified queue and bulk actions work; required rejection remarks exist only for disbursements, and that reason is client-overwritable via a plain update |
| Configurable routing + delegates | **Partial** — **`org_settings.approval_routing` is never consulted by any handler.** It filters the queue and renders a settings screen; it is presentation metadata, not a control. No delegates |
| **Immutable workflow history** | **Open** — no per-transition rows; the nearest substitutes are mutable stamps, some in jsonb any member can overwrite |

### Phase 4 — Sellable MVP Modules → **mostly BUILT**, with one structural gap

| Item | Status |
|---|---|
| Trial Balance · General Ledger · Balance Sheet · Income Statement · P&L | **Built** |
| **AR Aging** | **Open** — no fetch branch, no API helper; renders empty. The balances and due dates it needs already exist, so it is unimplemented, not blocked |
| **Attachments / supporting documents** | **Open** — zero code, zero table, zero policy |
| Billing / Service Invoices | **Partial** — data model and screens are real; missing server-side tax computation, server-enforced lifecycle, and **any AR → GL posting** |
| Collections | **Built** — payment methods and applied/unapplied tracking work as specified (but post nothing to the ledger) |
| Bank module + reconciliation | **Partial** — records a beginning/ending snapshot per period but performs **no actual reconciliation**; a leftover Firestore call makes the reconciled date always render `—` |
| BIR tax registry | **Partial** — rates, groups and a 3-tab page, but the entries view **truncates at the 50 most recent vouchers** and covers only the purchases/EWT side, so **output VAT never appears** |
| Disbursement / vouchers / checks | **Built** |
| **Loans → GL** | **Built** — booking, payment origination, reconciliation tile |
| **Fixed assets → GL** | **Partial** — acquisition booking is solid across all three bases, but depreciation posts the JE **before** claiming the one-per-month lock, so a concurrent post leaves an **orphan entry on the ledger** and only then reports "Already posted" |

### Phase 5 — Compliance & Trust → **mostly OPEN**

Privacy Notice / DPA / breach procedure: **Open**. Field-level audit log: **Open**.
Tenant export: **Partial** — a real admin JSON snapshot of 30 tables exists
(`GET /settings/data/export`), but it is admin-only, not self-service, not CSV/Excel/PDF, and
excludes users/credentials. Offboarding/deletion: **Partial** — `POST /settings/data/reset` wipes a
workspace, but there is no export-then-delete process. API versioning: **Open** (no `/v1`).
Retention schedule: **Open**.

### Phase 6 — Scale & Operations → **mixed**

| Item | Status |
|---|---|
| Automated tenant provisioning | **Open** — the bootstrap SQL hard-codes a single tenant UUID and its admin-mapping insert is commented out, so it provisions exactly one org. No provisioning endpoint |
| Default chart seeding | **Partial** — 158 accounts, idempotent via the seed script; the reset path reinstalls them with a bare insert and no conflict handling |
| One email → many workspaces | **Partial** — membership substrate, workspace resolution and sign-in picker are real; every admin surface is still per-workspace |
| Connection pooling | **Built** — `prepare:false` makes a transaction pooler safe (the current deployment connects directly, with no pooler) |
| Workspace data admin | **Built** — export / import / factory reset across 30 tables. ✅ **Fixed in M0.1:** the reset switch is now fail-closed (enabled only when `ALLOW_WORKSPACE_RESET` is exactly `"true"`), confirmation is the caller's own workspace code, and the boot log always states whether reset is enabled |
| Region co-location | **Partial** — achieved de facto (API and Postgres on the same Sliplane host over a private network); the checked-in Render blueprint is dead config |
| HA / multi-instance | **Partial** — the app is stateless so it *could* scale out today, but nothing declares >1 instance and there is no shared rate-limit store |
| Vendor-exit note | **Open** — unwritten, though the migration off Supabase already happened |
| Cross-tenant admin portal | **Open** |

---

## 9. Known gaps, stubs, and rough edges

Being candid here is more useful than a clean scorecard.

**Control risks (segregation of duties)**

1. **Approval routing is decorative.** `org_settings.approval_routing` is configured, displayed and
   used to filter the queue — but **no handler ever reads it**. Authorization is coarse workspace
   role, so any poster/approver/admin can approve *any* document of *any* type, regardless of
   whether the routing rule names them.
2. **No self-approval prevention.** A single user holding poster/approver/admin can create a voucher
   draft, send it for verification, verify it, send it for approval, approve it and post the journal
   entry — alone. Every gate they cross passes.
3. **No workflow history.** The nearest substitutes are mutable single-value stamps; some live in
   jsonb blobs any member can overwrite via a plain update. You cannot prove who approved what.
4. Approval enforcement covers journal entries and vouchers only — **not** the disbursements,
   projections or AR documents the same Approvals queue drives.

**Correctness risks**

5. **Billing, Service Invoices and Collections never touch the general ledger.** Revenue and AR are
   invisible to the Balance Sheet. This is the biggest accounting gap — and the exact pattern
   already solved twice (loans, fixed assets). It also starves the tax registry of **output VAT**.
6. **Depreciation posting has an ordering bug.** The journal entry is posted *before* the
   one-per-month unique lock is claimed, so a duplicate or concurrent post creates a real
   depreciation entry, then catches the 409 and reports "Already posted" — **leaving an orphan
   entry on the ledger.**
7. **The loan and fixed-asset ledger endpoints carry no poster/approver role check** — unlike
   `/journal-entries/:id/status` and `/vouchers/:id/status`.
8. **The generic `DELETE /:id` is still reachable on `/loans` and `/fixed-assets`**, bypassing the
   "never deleted, only cancelled" + JE-reversal semantics the UI enforces.
9. Depreciation and check-clearing entries are **posted from the browser**, not the server.
10. The tax entries view **truncates at the 50 most recent vouchers**.

**Operational risks**

11. ~~**`ALLOW_WORKSPACE_RESET` is fail-open**~~ — **fixed in M0.1.** Reset is now enabled only when
    the variable is exactly `"true"`; unset, blank, `"1"`, `"yes"` and `"TRUE"` all disable it.
    Confirmation is the caller's own workspace code (not a static `"RESET"`), and boot logs the
    state. Note the underlying risk it amplified — **no backup/DR posture** (item 14) — is still open.
12. No rate limiting on the public sign-in endpoint; no lockout. Online password guessing is unbounded.
13. No error tracking or structured logging — an incident is invisible.
14. No backup/DR posture written or drilled.
15. `CORS_ORIGIN=""` degrades to `Access-Control-Allow-Origin: *`.
16. The `credentials` table lives outside migrations (created at boot by raw DDL).
17. Deploy docs still describe **JWKS/OIDC** auth the code no longer implements, and `render.yaml`
    pins stale hosts. **Partly mitigated in M0.2:** production now refuses to boot on any
    bypass-enabling combination, and boot warns that `AUTH_JWKS_URL`/`AUTH_ISSUER` are ignored — so
    following the stale docs fails loudly instead of silently. **Correcting the docs themselves is
    still open (M6.5).**
18. A leftover Firestore call (`.toDate?.()`) in the Bank UI makes the reconciled date always `—`.

**Product stubs (visible but not real)**

13. Dashboard `ProfitLossWidget`, `ExpensesWidget`, `BankAccountsWidget` are hardcoded zeros/stubs.
14. `PeriodSelect` appears on five widgets but no widget handles the change.
15. Reports `CustomisePanel` is pure skeleton; "Run report" has no handler.
16. AR Aging and Payment Schedule reports render empty.
17. `CommandPalette` ⌘K only *closes* an open palette — it cannot open it.
18. `FinancialPage`'s `MonitoringTab` is rendered but unreachable (not in the tabs array).
19. Dead code: `HomePage.jsx`, `StubPage.jsx`.

**Engineering hygiene**

20. **Frontend has zero tests and zero CI** — CI is path-filtered to `sentire-books-api/**`.
21. No ESLint/Prettier anywhere (a `lint` task exists but nothing implements it).
22. No `GET /:id` and no pagination/filtering on any of the 20 factory routers.
23. No repo-root README; no `docker-compose` for local dev.
24. Only 3 API integration test files (contacts, ledger, vouchers) + 7 domain unit test files.

---

## 10. Suggested next increments

Ordered by leverage, given everything above.

1. ~~**Make the destructive switches fail-closed.**~~ ✅ **Done — M0.1.** The reset guard is an
   allowlist (`ALLOW_WORKSPACE_RESET === "true"`), confirmation is the workspace code, and boot
   states the switch position. Covered by unit tests plus an RLS-bound integration test.
2. **Make approval routing actually govern.** Have the voucher/journal transition handlers consult
   `org_settings.approval_routing`, and block self-approval in the same change. This is the
   difference between having a workflow and having a *control* — and it is the feature SMEs and
   their auditors actually pay for.
3. **Billing/AR → GL** (largest correctness win). Invoice issuance posts DR AR / CR Revenue (+ VAT/EWT
   split); collections post DR Cash / CR AR. Reuse `postJournalEntryCore` and the loans/assets
   register-and-book pattern exactly. Add an AR sub-ledger⇄GL reconciliation like the loans tile.
   This also makes output VAT appear in the tax registry.
4. **Close the remaining ledger-write gaps** — role-gate the loan/asset booking endpoints, disable
   the generic DELETE on those two routers, and claim the depreciation month lock *before* posting
   so a concurrent run cannot orphan an entry.
5. **The Phase 1 gate** — ✅ the auth boot assertion landed in M0.2. Still open: rate limiting +
   lockout on `/auth/password` (M0.4), a `CORS_ORIGIN` non-empty assertion (M0.3), error tracking
   and structured logs (Milestone 1).
6. **Workflow history table** (append-only: who, when, from → to, remarks) — one table that Phase 3
   needs and Phase 5's audit log later extends. Build it once.
7. **Attachments**, then **AR Aging** — both small, both expected; AR Aging is the only catalogued
   report with no backend behind it.
8. **Fix or hide the stubs** — shipping visible zeros erodes trust faster than a missing feature.
9. **Correct the stale docs** (`SYSTEM-DESIGN.md`, `DEPLOY-SLIPLANE.md`, `render.yaml`) — they
   currently describe an auth model that does not exist.

---

## Appendix — running it

```bash
# API (pnpm workspace)
cd sentire-books-api
pnpm install
pnpm --filter @sentire-books/db seed          # idempotent: demo org + 158-account chart
pnpm --filter @sentire-books/api dev          # tsx watch, :8787

# Portal (separate npm project)
cd sentire-books
npm install && npm run dev                    # :5173

# Tests
pnpm --filter @sentire-books/domain test      # 7 unit files
DATABASE_URL=... pnpm --filter @sentire-books/api test:int   # 3 integration files (skip without DB)
```

**Environment variables that matter:** `DATABASE_URL` (as `sentire_books_app`),
`DATABASE_URL_DIRECT` (owner, for schema work), `AUTH_JWT_SECRET`, `CORS_ORIGIN`,
`ALLOW_WORKSPACE_RESET`, `BOOKS_ADMIN_EMAIL` / `BOOKS_ADMIN_INITIAL_PASSWORD`, `PORT`,
and `VITE_API_BASE_URL` (the **only** variable the frontend reads — baked in at build time).

**Database setup:** `sentire-books-api/setup/db-setup.sql` is the full bootstrap (all 22 migrations
concatenated). Incremental `livedbdelta00NN.sql` files exist for live databases — these must be run
**before or as** the API redeploys, since the API selects the new columns immediately.

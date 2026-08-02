# Milestone 2 — Billing / AR → General Ledger

**Status: APPROVED 2026-08-01. M2.0 landed; M2.1 not started.**

| Decision | Answer |
|---|---|
| VAT basis (§2.1) | **Accrual at issuance** (EOPT / RA 11976). Build T1/T2/T3 on that basis. |
| New accounts (§4) | `1009002` Creditable Withholding Tax, `2003004` Percentage Tax Payable. **`2003005` Deferred Output VAT is NOT added** — only if the basis ever changes to collection. |
| Duplicate-code renumbering (§0) | Payroll liabilities move; **equity keeps `2004001-3`**. |
| Production check queries (§0) | Owner is running them. **Correcting reversals are on hold** until that output arrives. |
| `collection_applications` (§5) | **Build it** — many-to-many collection ↔ invoice. |
| Billing statements (§8) | **Presentation-only. Never posted.** |
| Percentage tax (§2.3) | Accrued **on collection**. |
| Template selection | Driven by the invoice's own `vat_treatment` / `vat_cents` — **no org-level VAT flag**. See the note below §2.3. |

**M2.0 is complete** (fail-closed `resolveAccountCodes()`, three `financial.ts`
call sites repointed, chart collisions renumbered, the two new accounts added,
migration `0023_account_codes.sql`, 10 integration tests). Everything from §5
onward is still proposal.

Every account code, table column and behaviour described below was read out of the
repo or verified against a real Postgres instance with the 158-account chart
loaded. Nothing here is assumed. Where a number or rule could not be verified, it
is marked **CONFIRM**.

---

## 0. Read this first — a defect that blocks M2

> Standing instruction: *"If you uncover a new critical issue (a fail-open switch,
> an unguarded ledger write, an RLS gap), stop and surface it before continuing."*

### Three account codes in the default chart are duplicated, and the ledger resolves accounts by code

`setup/generate_coa_sql.py` states the design intent plainly:

> *"Real charts reuse the same numeric `code` across types, so the unique key is
> the account NAME; `code` is a non-unique display label."*

And `packages/db/migrations/0005_accounts_extend.sql:21-23` implements exactly
that — it **drops** uniqueness on `(org_id, code)` and puts it on `(org_id, name)`,
leaving `code` on a plain non-unique index.

But `bookLoanTx()` and `bookAssetTx()` resolve posting accounts *by code* into a
JavaScript `Map`, which silently keeps the **last** row for a duplicate key:

```ts
// apps/api/src/routes/financial.ts:95-98  (identical shape at :309 and :557)
const accs = await tx.select({ id: accounts.id, code: accounts.code }).from(accounts)
  .where(and(eq(accounts.orgId, orgId), inArray(accounts.code, codes)));
const byCode = new Map(accs.map((a) => [a.code, a.id]));   // ← last row wins
```

The default chart every org is provisioned with contains three collisions:

| Code | Account A | Account B |
|---|---|---|
| `2004001` | Owner's Equity *(equity)* | Salaries and Wages Payable *(liability)* |
| `2004002` | **Opening Balance Offset** *(equity)* | Final Pay Payable Deployed *(liability)* |
| `2004003` | Retained Earnings *(equity)* | Final Pay Payable *(liability)* |

`financial.ts:69` hardcodes `const OPENING_EQUITY_DEFAULT = "2004002"` — one of
the three.

**Verified against a real database** (migrations 0000–0022 applied, chart seeded,
158 accounts confirmed):

```
=== the exact lookup bookLoanTx/bookAssetTx runs for OPENING_EQUITY_DEFAULT ===
 id                                   | code    | name                       | type
 2d5c73ab-5c43-4b87-9820-622e90821e2d | 2004002 | Opening Balance Offset     | equity
 b9e1b269-d6fc-4e23-8173-23bdb1d5d92d | 2004002 | Final Pay Payable Deployed | liability
(2 rows)

=== JS Map(code -> id) keeps the LAST row; which account wins? ===
 map_winner                 | type
 Final Pay Payable Deployed | liability
```

So a loan or fixed asset booked in **opening-balance mode** posts:

```
DR  Final Pay Payable Deployed  (liability)   ← WRONG
    CR  Loans Payable           (liability)
```

instead of the intended `DR Opening Balance Offset (equity) / CR Loans Payable`.

**Why nothing caught it.** The entry *balances*. All six non-negotiable invariants
still hold — the trial balance reconciles to the centavo, the deferred balance
trigger passes, immutability holds, RLS is intact. The books are internally
consistent and externally wrong: a payroll liability is pushed toward a contra
balance and equity is overstated by the same amount. This is precisely the class
of error that balance-checking cannot detect, which is why it needs a structural
fix rather than another assertion.

**Blast radius today is small.** The only writers are Loans and Fixed Assets, both
deferred and sealed in M0.5 (`deferredModules.js`, plus poster-role gates and
generic `DELETE` → 405). The high-volume voucher/check path is **safe** — it
resolves accounts by `accountId` (UUID), never by code. Reads in `journal.ts` and
`vouchers.ts` only project `code` for display.

**Why it blocks M2.** Every account M2 needs is referenced *by code*:
`contacts.ar_account_code`, `service_invoices.income_account_code`. Building AR
posting on the same `Map`-by-code pattern would take a latent defect in two hidden
modules and put it on the live revenue path.

**Proposed fix — M2.0, before any AR code:**

1. A shared `resolveAccountCodes()` helper that **fails closed** on ambiguity —
   throws `AmbiguousAccountCodeError` → HTTP 409 naming both candidate accounts,
   rather than silently picking one. Invariant #4.
2. Repoint the three `financial.ts` call sites at it.
3. Rename the three colliding codes in `generate_coa_sql.py` + the generated chart
   so newly provisioned orgs are clean (equity keeps `2004001-3`; the payroll
   liabilities move to free codes — **CONFIRM** which side you want renumbered).
4. A read-only check for your existing production org, to run before M2.1:

```sql
-- Any duplicate codes in this workspace?
SELECT code, count(*), string_agg(name || ' [' || type || ']', ' | ') AS accounts
FROM accounts WHERE org_id = '<your-org-id>' GROUP BY code HAVING count(*) > 1;

-- Did any already-booked loan/asset hit the wrong side of a collision?
SELECT je.entry_no, je.entry_date, je.memo, a.code, a.name, a.type,
       jl.debit_cents, jl.credit_cents
FROM journal_entries je
JOIN journal_lines jl ON jl.entry_id = je.id
JOIN accounts a ON a.id = jl.account_id
WHERE je.org_id = '<your-org-id>'
  AND je.source_type IN ('loan','fixed_asset')
  AND a.code IN ('2004001','2004002','2004003')
ORDER BY je.entry_date;
```

If the second query returns rows where `a.type = 'liability'`, those entries need
a correcting **reversal** (never a mutation — invariant #2). I can prepare that as
part of M2.0 once you have run it.

---

## 1. What exists today (verified)

Billing/AR was migrated off Firestore in Phase 3 (`0015_billing_ar.sql`) as **pure
CRUD**. `apps/api/src/routes/billingAr.ts` is 75 lines of `makeCrudRoutes` calls
with **no ledger involvement whatsoever** — no `postJournalEntryCore` import, no
booking columns, no reconciliation.

| Table | Doc no. | State today |
|---|---|---|
| `billing_statements` | `BS{YYYYMM}-{NNNN}` | `gross_cents`, `tax_group_name`, `total_vat_inclusive_cents`, `net_due_cents` — all hand-typed in the portal, no arithmetic validation. `balance_cents` GENERATED. |
| `service_invoices` | `IS{YYYYMM}-{NNNN}` | Single `amount_cents` — **no VAT decomposition**. `tax_type text` default `'N/A'`, `ewt_rate numeric` default 0. `balance_cents` GENERATED. |
| `collections` | `COL{YYYYMM}-{NNNN}` | `amount_received_cents`, `applied_cents`, `unapplied_cents` GENERATED. Links to invoices via `si_id text` — a **soft link, no FK**. No EWT field. |
| `payment_schedules` / `schedule_payments` | `PS…` | Out of M2 scope (payables side). |

So the invoice record cannot currently answer "how much of this is VAT?" — which
is the first thing a posting engine needs.

**Useful things that already exist:** `contacts.ar_account_code` (added in
`0010_contacts_extend.sql`) — per-customer AR sub-account, exactly the hook the AR
control design needs. And `service_invoices.income_account_code` for the revenue
side.

---

## 2. Accounting basis — the decisions the templates rest on

### 2.1 VAT accrues at **invoice issuance**, not collection

This is the pivotal choice, and it is the one place I want your explicit sign-off.

Historically, Philippine VAT on **services** was due on *gross receipts* — i.e. on
collection — while VAT on **goods** was due on the sale. Under that rule, an
invoice would credit a *Deferred Output VAT* liability, reclassified to *Output
Tax* only when cash arrived. That is the more complex design.

The **Ease of Paying Taxes Act (RA 11976)**, effective January 2024, and RR
3-2024, amended Sec. 108 to replace "gross receipts" with "gross sales" for
services, adopting the invoice system for both goods and services. It also made
the **Invoice** the primary document for services in place of the Official
Receipt — which is why the module is already called `service_invoices`. Under that
rule, output VAT accrues on issuance.

**Proposal: accrue output VAT at issuance.** It matches current law as I
understand it, it matches the invoice-centric data model already built, and it
removes a whole reclassification step from the design.

**CONFIRM with your tax advisor before I implement.** If the answer is
collection-basis, the issuance template changes (`CR Deferred Output VAT`) and
collections gain a reclassification line — I have sized this as roughly +1 day and
one extra account, not a redesign.

**Not building in M2:** the RA 11976 §110(E) *output VAT credit on uncollected
receivables* relief. It is a quarterly VAT-return adjustment with conditions and
an add-back on recovery — it belongs with the BIR forms work, not here. Flagged so
it is not forgotten.

### 2.2 EWT is recognised on **collection**

Expanded withholding tax is recognised when the payor actually withholds and
issues **BIR Form 2307** — not at invoicing, when we cannot yet know. This is the
standard treatment and I propose no deviation.

Critically: **the EWT base is the amount NET of VAT.** Withholding on the
VAT-inclusive total is a common and expensive error; the templates below get this
right and the tests will assert it.

Typical rate for manpower/security services under RR 2-98 §2.57.2(E) is **2%**.
The rate is already a per-invoice field (`service_invoices.ewt_rate`), so nothing
is hardcoded.

### 2.3 Percentage tax is the **seller's expense**, never billed to the client

For a non-VAT tenant under Sec. 116, percentage tax (currently **3%**; the CREATE
Act's 1% concession lapsed 30 June 2023) is *not* added to the invoice and *not*
withheld from the client. It is the seller's own cost.

Consequence: **the non-VAT issuance JE has no tax line at all.** The tax is
accrued separately against receipts. This is a point people routinely get wrong by
analogy with VAT, so it is called out explicitly here.

**CONFIRM:** whether EOPT also moved Sec. 116 to an accrual/"gross sales" basis.
I propose accruing on collection (the conservative, long-standing reading) and
would rather your advisor confirm than have me guess.

### 2.4 Template selection comes from the invoice, not an org flag — confirmed sufficient

Asked and answered: **yes, `vat_treatment` + `vat_cents` are sufficient to pick
T1/T2/T3**, and per-invoice is the better choice.

| `vat_treatment` | `vat_cents` | Template | Percentage tax on collection? |
|---|---|---|---|
| `vatable` | > 0 | **T1** | no |
| `exempt` | 0 | **T3** | no |
| `zero_rated` | 0 | **T3** | no |
| `none` (non-VAT taxpayer) | 0 | **T2** | **yes → T2a** |

The four-value enum carries strictly more information than a boolean org flag
would. All three of `exempt`, `zero_rated` and `none` have `vat_cents = 0` and
produce an identical journal entry, but they diverge downstream — only `none`
triggers the percentage-tax accrual, and the VAT return splits the other two
apart. A single org-level "is VAT-registered" flag could not express that, and a
VAT-registered tenant can legitimately issue exempt or zero-rated sales.

Per-invoice also survives the case an org-level flag handles worst: a tenant
crossing the ₱3M VAT-registration threshold mid-year. Invoices issued before and
after the switch keep their own treatment, and history does not get rewritten by
a settings change.

**One thing the invoice cannot supply: the percentage-tax RATE** (currently 3%).
It is not a property of the invoice. Proposed for M2.2 — resolve it from the
existing `tax_rates` table, falling back to a documented constant, rather than
hardcoding. Flagging now because it is the one input this design does not
already have a home for.

---

## 3. Journal-entry templates

Worked example used throughout — a ₱100,000.00 service fee, EWT 2%:

| | Centavos | Pesos |
|---|---:|---:|
| Net (tax base) | `10,000,000` | ₱100,000.00 |
| Output VAT @ 12% | `1,200,000` | ₱12,000.00 |
| **Invoice total (gross)** | **`11,200,000`** | **₱112,000.00** |
| EWT @ 2% of **net** | `200,000` | ₱2,000.00 |
| Cash received | `11,000,000` | ₱110,000.00 |

All amounts are integer centavos. No floats anywhere in the path (invariant #6).

### T1 — Invoice issuance, VAT-registered (12%)

| | Account | Code | DR | CR |
|---|---|---|---:|---:|
| 1 | Trade Receivable – Client | `1001022` / `DO1xx` | `11,200,000` | |
| 2 | Manpower Service Revenue | `3001001` | | `10,000,000` |
| 3 | Output Tax | `2003003` | | `1,200,000` |

`Σ DR 11,200,000 = Σ CR 11,200,000` ✔

### T2 — Invoice issuance, non-VAT (percentage-tax tenant)

| | Account | Code | DR | CR |
|---|---|---|---:|---:|
| 1 | Trade Receivable – Client | `1001022` / `DO1xx` | `10,000,000` | |
| 2 | Manpower Service Revenue | `3001001` | | `10,000,000` |

`Σ DR 10,000,000 = Σ CR 10,000,000` ✔

**No tax line** — see §2.3. The percentage tax is accrued on collection (T2a).

### T2a — Percentage-tax accrual, on collection *(non-VAT tenants only)*

3% of the ₱100,000.00 collected = `300,000` centavos.

| | Account | Code | DR | CR |
|---|---|---|---:|---:|
| 1 | Taxes and Licenses | `5005` | `300,000` | |
| 2 | Percentage Tax Payable | ***MISSING — see §4*** | | `300,000` |

Posted as a **separate** entry from the collection, so the cash movement and the
tax accrual can be reversed independently.

### T3 — Invoice issuance, VAT-exempt

| | Account | Code | DR | CR |
|---|---|---|---:|---:|
| 1 | Trade Receivable – Client | `1001022` / `DO1xx` | `10,000,000` | |
| 2 | Manpower Service Revenue | `3001001` | | `10,000,000` |

Structurally identical to T2. **The difference is not in the ledger** — it is in
the VAT return, which must split sales into VATable / zero-rated / exempt.

That distinction therefore has to live on the invoice record
(`vat_treatment`), because it is **not recoverable from the journal entry**. This
is why §5 adds an explicit `vat_treatment` column rather than inferring exemption
from "VAT is zero".

### C1 — Collection: full, partial, and with EWT — one template

The three cases the brief asks for collapse into a single balanced template. Let
`received` = cash actually banked and `ewt` = the amount on the BIR 2307
(`0` when none):

| | Account | Code | DR | CR |
|---|---|---|---:|---:|
| 1 | Cash in Bank | `1001640` / `1002184` / `1004489` / … | `received` | |
| 2 | Creditable Withholding Tax | ***MISSING — see §4*** | `ewt` | |
| 3 | Trade Receivable – Client | `1001022` / `DO1xx` | | `received + ewt` |

Line 2 is **omitted entirely when `ewt = 0`** — no zero-value lines.

**C1a — full collection, no EWT** (client pays the whole ₱112,000.00):

| Account | Code | DR | CR |
|---|---|---:|---:|
| Cash in Bank | `1001640` | `11,200,000` | |
| Trade Receivable – Client | `1001022` | | `11,200,000` |

**C1b — partial collection, no EWT** (₱50,000.00 on account):

| Account | Code | DR | CR |
|---|---|---:|---:|
| Cash in Bank | `1001640` | `5,000,000` | |
| Trade Receivable – Client | `1001022` | | `5,000,000` |

Invoice `balance_cents` (GENERATED) carries the remaining `6,200,000`.

**C1c — full collection with 2% EWT withheld** (the manpower base case):

| Account | Code | DR | CR |
|---|---|---:|---:|
| Cash in Bank | `1001640` | `11,000,000` | |
| Creditable Withholding Tax | *missing* | `200,000` | |
| Trade Receivable – Client | `1001022` | | `11,200,000` |

`Σ DR 11,200,000 = Σ CR 11,200,000` ✔ — and note the EWT is `200,000`
(2% × **net** `10,000,000`), not `224,000` (2% × gross). That assertion is a test.

**C1d — partial collection with EWT.** The design decision that matters:
`ewt_cents` is **captured from the 2307, never derived.** A payor withholding on a
partial payment computes it their way; deriving it server-side would guarantee
disagreement with the certificate we are legally required to match. So the AR
relief is `received + ewt` as stated, validated against the invoice balance:

```
0 < received + ewt <= invoice.balance_cents      → else HTTP 409
```

### R1 — Corrections

There is no invoice or collection "edit" that touches a posted entry. Corrections
go through `reverseJournalEntryCore()` and a re-issue — invariant #2, exactly as
loans and fixed assets already behave (`/loans/:id/cancel`,
`/assets/:id/cancel`).

---

## 4. Account mapping — and three accounts that do not exist

### Present and verified (queried from a live seeded chart)

| Role in the template | Code | Name | Type | Normal |
|---|---|---|---|---|
| **AR control (parent)** | `1001022` | Trade Receivable - Client | asset | debit |
| **AR sub-accounts** | `DO101`–`DO129` | 29 per-client receivables | asset | debit |
| **Revenue (default)** | `3001001` | Manpower Service Revenue | income | credit |
| Revenue (alternates) | `3001002` / `3001003` / `3001004` / `3001006` | SaaS / Placement / Billable Expense / Other Services | income | credit |
| **Output VAT payable** | `2003003` | Output Tax | liability | credit |
| Cash | `1001640`, `1002184`, `1004489`, `1007923`, `1008317`, `1008928`, `1009336` | Cash in Bank — 7 accounts | asset | debit |
| Cash (in transit) | `1002004` | Undeposited Funds | asset | debit |
| Percentage-tax expense | `5005` | Taxes and Licenses | expense | debit |
| Write-off | `5004003` | Bad Debt | expense | debit |
| Discount | `3901001` | Discount | income | credit |

**On the AR control account.** It is a *parent* with 29 children — so "AR control"
is a subtree, not a single account. Posting to the parent while children carry
balances would double-count. Proposed resolution order, snapshotted onto the
invoice at issuance so later contact edits cannot retroactively move history:

```
contacts.ar_account_code  →  org default (settings)  →  1001022
```

The reconciliation tile (M2.3) and aging (M2.4) then sum **the whole subtree**,
which is also what makes them survive a tenant adding client #30.

### Missing — must be added before the templates can post

Confirmed absent by direct query against the seeded 158-account chart:

| Needed for | Account | Status |
|---|---|---|
| **C1 line 2** | **Creditable Withholding Tax** (asset — BIR 2307 credits) | **absent** |
| **T2a line 2** | **Percentage Tax Payable** (liability, Sec. 116) | **absent** |
| Collection-basis VAT *(only if §2.1 is answered "collection")* | Deferred Output VAT (liability) | absent |

The chart's every tax account with "tax"/"withholding" in its name:

```
 1009001 | Deferred Tax Asset                      | asset
 8000001 | Input Tax                               | asset
 2003    | Tax Payable                             | liability
 2003001 | Deferred Tax Liability                  | liability
 2003002 | Income Tax Payable                      | liability
 2003003 | Output Tax                              | liability
 2101    | Expanded Withholding Tax Payable        | liability
 2101001 | Withholding Tax on Compensation Payable | liability
 2101003 | Final Withholding Tax Payable           | liability
 5005    | Taxes and Licenses                      | expense
 5005001 | Business and Income Tax                 | expense
```

**Do not be tempted by the near-misses.** They are all wrong for this purpose:

- `2101` / `2101002` **Expanded Withholding Tax Payable** / **EWT Vendors** are
  *liabilities* — tax **we** withhold from **our vendors** and owe BIR. Line 2 of
  C1 is the mirror image: tax **our clients** withheld from **us**, which is an
  **asset** we credit against income tax due. Same statute, opposite sign.
- `1009001` **Deferred Tax Asset** is a PAS 12 timing-difference account. Using it
  for creditable withholding would corrupt income-tax disclosure.
- `8000001` **Input Tax** is purchase VAT — unrelated.
- `2003` **Tax Payable** is a summary parent.

**Proposed new accounts** (codes chosen to sit with their siblings; say the word
if you want different ones):

| Code | Name | Type | Subtype | Normal |
|---|---|---|---|---|
| `1009002` | Creditable Withholding Tax | asset | Tax Asset | debit |
| `2003004` | Percentage Tax Payable | liability | Tax Liability | credit |
| `2003005` | Deferred Output VAT *(only if collection-basis)* | liability | Tax Liability | credit |

Added to `generate_coa_sql.py` (the single source of truth for both the SQL seed
and `defaultChart.generated.ts`) plus an idempotent migration for existing orgs,
so new and existing workspaces converge.

Also absent: an **Allowance for Doubtful Accounts** contra-AR. The three
"allowance" hits in the chart are all payroll (`Employee Allowances Deployed`,
`Personnel Allowance`, `Clothing Allowance`). Direct write-off via `5004003 Bad
Debt` works for MVP; provisioning is a later concern. Noted, not proposed.

---

## 5. Schema changes

### `service_invoices` — make the VAT decomposition explicit and DB-enforced

```sql
ALTER TABLE service_invoices
  ADD COLUMN net_cents                 bigint  NOT NULL DEFAULT 0,
  ADD COLUMN vat_cents                 bigint  NOT NULL DEFAULT 0,
  ADD COLUMN vat_treatment             text    NOT NULL DEFAULT 'none',
      -- 'vatable' | 'exempt' | 'zero_rated' | 'none'  (drives the VAT return split)
  ADD COLUMN ar_account_code           text,   -- snapshotted at issuance
  ADD COLUMN output_vat_account_code   text,
  ADD COLUMN booking_journal_entry_id  uuid,
  ADD COLUMN booked_at                 timestamptz,
  ADD COLUMN booking_mode              text;
```

Backfill `net_cents = amount_cents` for existing rows, then add the arithmetic
guard:

```sql
ALTER TABLE service_invoices
  ADD CONSTRAINT service_invoices_amount_decomposed_chk
  CHECK (amount_cents = net_cents + vat_cents);
```

That constraint is the point. It puts the same "the database enforces it" property
behind AR that the balance triggers already give the ledger — the invoice total
and its parts cannot drift apart, in any code path, ever.

### `collections` — capture EWT and compute AR relief in the database

```sql
ALTER TABLE collections
  ADD COLUMN ewt_cents                bigint NOT NULL DEFAULT 0,
  ADD COLUMN cash_account_code        text,
  ADD COLUMN cwt_account_code         text,
  ADD COLUMN booking_journal_entry_id uuid,
  ADD COLUMN booked_at                timestamptz,
  ADD COLUMN booking_mode             text,
  ADD COLUMN ar_relief_cents bigint
    GENERATED ALWAYS AS (amount_received_cents + ewt_cents) STORED;
```

`ar_relief_cents` is exactly the credit on C1 line 3 — GENERATED, so the JE and the
sub-ledger read the same number from the same place.

### `collection_applications` — new

`collections.si_id text` is a soft link to one invoice. Real collections settle
several invoices at once, and AR aging (M2.4) needs invoice-level balances to be
trustworthy.

```sql
CREATE TABLE collection_applications (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        uuid   NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  collection_id uuid   NOT NULL REFERENCES collections(id)   ON DELETE CASCADE,
  invoice_id    uuid   NOT NULL REFERENCES service_invoices(id),
  applied_cents bigint NOT NULL CHECK (applied_cents >= 0),
  ewt_cents     bigint NOT NULL DEFAULT 0 CHECK (ewt_cents >= 0),
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (collection_id, invoice_id)
);
```

RLS + `org_isolation` policy + `GRANT … TO sentire_books_app` on every new table,
following the `0015` block verbatim. Integration-tested as `sentire_books_app`
(invariant #3).

If you would rather keep one-collection-to-one-invoice for now, say so and I will
drop this table from scope — but AR aging will be correspondingly approximate, and
I would rather tell you that up front than deliver an aging report that quietly
does not tie out.

---

## 6. How this reuses what is already built

### `postJournalEntryCore()` — no second writer

Every entry in §3 is posted by the **same** function loans and fixed assets use,
inside the caller's transaction. M2 adds **zero** new ledger writers (invariant
#1). The call is shaped exactly like `bookLoanTx` at `financial.ts:129`:

```ts
const je = await postJournalEntryCore(tx, {
  orgId,
  entryDate: invoice.siDate,
  memo: `Invoice — ${invoice.contactName} (${invoice.siNo})`,
  entryType: "Manual",
  reference: invoice.siNo,
  sourceType: "service_invoice",   // new discriminator, alongside 'loan' | 'fixed_asset'
  sourceId: invoice.id,
  post: true,
  lines,                            // T1 / T2 / T3
}, { userId, orgId });
```

`sourceType`/`sourceId` are existing columns — they already carry `'loan'` and
`'fixed_asset'`, and they are what makes the reconciliation tile and the drill-back
from a JE to its source document work without new plumbing.

### The register-and-book pattern — with one deliberate difference

Loans and fixed assets book **at registration** (`POST /loans/register` →
`bookLoanTx` in the same transaction, rolling back entirely if the entry cannot
post, so a registered loan is always on the books).

**Invoices must not.** They have a real approval workflow already in the schema —
`status`, `reviewed_by`, `approved_by`, `reject_reason` — and a Draft invoice must
not touch the general ledger. So the trigger point moves from *create* to *issue*:

| | Loans / Fixed Assets | Service Invoices (proposed) |
|---|---|---|
| Books at | `POST /register` (creation) | `POST /billing/invoices/:id/issue` |
| Guard | `requireWorkflowPoster` | `requireWorkflowPoster` + status is `Draft` |
| Atomicity | insert + post in one `withOrgContext` tx | status flip + post in one `withOrgContext` tx |
| Correction | `POST /:id/cancel` → reverse | `POST /:id/cancel` → reverse |
| Hard delete | `disableDelete: true` → 405 | `disableDelete: true` → 405 |
| Stamps | `booking_journal_entry_id`, `booked_at`, `booking_mode` | identical columns |

Everything else carries over unchanged: the `BookError` class that rolls the
transaction back on an unpostable entry, `bookErrorResponse()`'s 400 with an
actionable message, the `already_booked` 409, `disableDelete`, and cancel-reverses
-never-mutates.

Collections follow the same shape at `POST /billing/collections/:id/post`
(`Unposted → Posted`, which is the status vocabulary `0015` already defines).

### Reconciliation — the same identity as loans

M2.3 mirrors `GET /loans/reconciliation` (`financial.ts:419-498`) line for line:

```
residual = glControl − (arSubLedger − unissuedInvoices + unpostedCollections)
```

- `glControl` — posted debit balance of the AR subtree, from `v_account_postings`
- `arSubLedger` — Σ `balance_cents` over non-cancelled invoices
- `unissuedInvoices` — Draft invoices the GL does not have yet → subtract
- `unpostedCollections` — collections not yet posted; the GL still shows those
  receivables → add back
- `residual ≠ 0` → the GL moved in a way the sub-ledger cannot explain

Same tile treatment as loans: shown **only when there is an imbalance**.

---

## 7. Task breakdown

One task, one PR, pause for review — per the standing rules.

| Task | Deliverable | Acceptance check |
|---|---|---|
| **M2.0** | **Ambiguous-code fix** (§0) + the 3 new accounts (§4) | Integration test: a duplicate code returns 409, never a silent wrong pick. Loan opening-balance booking proven to hit `Opening Balance Offset`. |
| **M2.1** | Invoice issuance posts to GL — T1/T2/T3 + `/issue`, `/cancel` | RLS-bound integration test per template; **trial balance reconciles to the centavo** after each. |
| **M2.2** | Collections post to GL — C1 + applications + `/post`, `/void` | EWT-on-net asserted; over-application → 409; TB reconciles. |
| **M2.3** | AR sub-ledger ⇄ GL reconciliation tile | Identity holds across issued/unissued/posted/unposted permutations; residual 0. |
| **M2.4** | AR Aging backend (Current / 1–30 / 31–60 / 61–90 / 90+) | Aging total **equals** AR sub-ledger outstanding **equals** GL control when reconciled. |
| **M2.5** | Tax registry — remove the 50-voucher cap, surface output VAT | Server-side `GET /reports/tax-registry`; all periods present, no truncation. |

On **M2.5**, the current behaviour is worse than a cap. `TaxPage.jsx:79-95` fetches
500 vouchers, then filters to Payment/Check and `.slice(0, 50)` — and issues **one
`getVoucher()` round trip per voucher** to hydrate lines. So the tax registry is
both silently incomplete *and* an N+1 of up to 50 sequential requests. The fix is
one server endpoint that aggregates voucher-line tax metadata and (new) invoice
output VAT in a single query.

**Ledger-touching tasks are M2.1 and M2.2** — each proves trial-balance
reconciliation to the centavo before I hand it back.

---

## 8. What I am not building

Per the deferral list and to keep the milestone honest:

- **AI layer, Loans, Fixed Assets, cross-tenant admin, real bank reconciliation** —
  untouched. M2.0 fixes a defect *inside* loans/assets but adds no capability and
  does not un-hide them.
- **BIR form generation** (2550Q, 2307 issuance, 1601-EQ, sales book / relief
  DAT files). M2 produces the correct ledger and the tax registry that feeds them;
  the forms themselves are their own milestone.
- **RA 11976 §110(E) uncollected-receivable VAT credit** — §2.1.
- **Allowance for doubtful accounts / provisioning** — §4.
- **Multi-currency AR.** `contacts.currency` exists but there is no FX revaluation
  path, and inventing one here would be out of scope.
- **`billing_statements` → GL.** M2 posts **invoices**, not statements. Statements
  are a client-facing summary document whose totals are currently hand-typed;
  posting both would double-count revenue. Statements stay a presentation layer
  over invoices. **Flag if you disagree — it changes M2.1's shape.**

---

## 9. What I need from you before writing code

| # | Question | My recommendation |
|---|---|---|
| 1 | **VAT basis** — accrual at issuance (EOPT / RA 11976), or collection-basis? (§2.1) | **Accrual at issuance.** Confirm with your tax advisor. |
| 2 | **New account codes** `1009002` Creditable Withholding Tax, `2003004` Percentage Tax Payable — acceptable, or do you have preferred numbers? (§4) | As proposed. |
| 3 | **Duplicate-code renumbering** — when I clear the `2004001-3` collisions, which side moves: the equity accounts or the payroll liabilities? (§0) | Move the **payroll liabilities**; equity codes are more widely referenced. |
| 4 | Run the two production queries in §0 and send me the output. | Needed before M2.1 — it tells us whether existing entries need correcting reversals. |
| 5 | **`collection_applications`** — build it, or keep one-collection-one-invoice for now? (§5) | **Build it.** Otherwise AR aging will not tie out. |
| 6 | **Billing statements** stay presentation-only, not posted? (§8) | Yes — posting both double-counts revenue. |

Questions 1–3 and 5–6 can be answered from your side alone. Question 4 needs a
`psql` session against production, which I do not have from the sandbox.

I will not start M2.0 until you approve.

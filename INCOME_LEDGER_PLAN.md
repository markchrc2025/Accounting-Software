# Payroll Income Ledger — Architecture Overhaul

## Problem Statement

### Issue 1 — BIR Form 2316 Item 19 Mismatch

Item 19 ("Gross Compensation Income from Present Employer") is defined by the BIR as
**Item 38 + Item 52**. The current code sets it to `gross_present`, which is the raw HRIS
gross pay figure. These two values do not agree because several pay components
(overtime, night differential, holiday pay, allowances, incentives, adjustments) are
accumulated into `gross_present` but are never classified into any BIR Part IV-B line item.

**Example — Santocidad (userid 5, 2026):**

| Field | Amount |
|---|---|
| `gross_present` used for Item 19 | 70,160.66 |
| Item 38 (total non-taxable) | 65,445.19 |
| Item 52 (total taxable) | 250.00 |
| **Correct Item 19 = Item 38 + Item 52** | **65,695.19** |
| Unclassified gap | 4,465.47 |

### Issue 2 — Payroll Accrual JE Structural Imbalance

The accrual journal entry debits `totalgrosspay` (one HRIS figure) and credits
`payslipnetpay` (a different HRIS figure). These are independent values. The JE can only
balance by coincidence. Unclassified income components cause a silent DR/CR gap that
flows into the books unchecked.

### Root Cause (both issues)

`grosspay` is used as a black-box total. It needs to be a **verifiable sum of individually
named components**. There is no sheet in the current system that stores accumulated
income at component level — only `BIR2316Data`, which is a materialized view rebuilt by
wiping and rewriting, with no audit trail.

---

## Solution Overview

Introduce `EmployeeIncomeLedger` as the single source of truth for all employee income
at component level. All downstream systems (`BIR2316Data`, Payroll Accrual JE, PDF
generation) are re-sourced from this ledger.

---

## Data Flow — Before vs. After

### Before (broken)

```
HRIS Excel Upload
      │
      ▼
processPayrollRun()
      ├─► PayrollLines          ← raw dump, columns vary by HRIS version
      ├─► 13MDetails            ← nth month only
      ├─► DeminimisDetails      ← benefits.other JSON parsed
      └─► _rebuildBir2316Data_  ← gi() guesses columns; OT/ND/holiday/alw orphaned
                                   Item 19 = gross_present  ← WRONG

buildPayrollAccrualJE()
      ├─► DR uses totalgrosspay   ← black-box HRIS figure
      └─► CR uses payslipnetpay   ← different HRIS figure
          JE imbalance hidden silently
```

### After (fixed)

```
HRIS Excel Upload
      │
      ▼
processPayrollRun()  [modified]
      ├─► PayrollLines           ← unchanged (raw archive)
      ├─► 13MDetails             ← unchanged
      ├─► DeminimisDetails       ← unchanged
      └─► upsertToEmployeeIncomeLedger_()  ← NEW
                │  all pay components named, flat numeric
                │  gross_variance computed per employee
                │  BLOCKS pipeline if |variance| > ±1.00
                ▼
          AccrualWarnings sheet  (lists blocked employees)

      └─► _rebuildBir2316Data_  [modified — reads Ledger, not PayrollLines]
               Item 19 = Item 38 + Item 52  ← ALWAYS derived

buildPayrollAccrualJE()  [modified]
      ├─► DR: each named component → its own expense account
      ├─► CR: net pay + each deduction → its own liability account
      └─► Pre-write balance check: ΣDR = ΣCR enforced; blocks if not
```

---

## Full Pipeline Visual

```
                    HRIS Excel File
                          │
              ┌───────────▼───────────┐
              │   processPayrollRun   │
              └──────────┬────────────┘
                         │  parse rows
          ┌──────────────┼───────────────┐
          ▼              ▼               ▼
    PayrollLines    13MDetails    DeminimisDetails
    (raw archive)   (nth month)   (de minimis JSON
                                   already parsed)
          │              │               │
          └──────────────┴───────────────┘
                         │  join on userid + cutoffend
                         ▼
          ┌──────────────────────────────────┐
          │   upsertToEmployeeIncomeLedger_  │
          │                                  │
          │  Per employee per cutoff:         │
          │  ┌─ Audit identity               │
          │  ├─ Employee snapshot             │
          │  ├─ Period (cutoff_start/end)     │
          │  ├─ Pay components (named cols)   │
          │  │    regular / OT / ND / DOD /   │
          │  │    holidays / alw / adj /       │
          │  │    incentives / nth_month       │
          │  ├─ De minimis (9 types)          │
          │  ├─ Deductions (EE + ER)          │
          │  └─ Reconciliation                │
          │       computed_gross              │
          │       gross_variance              │
          │       net_variance                │
          └───────────────┬──────────────────┘
                          │
              ┌───────────┴───────────┐
              │                       │
     variance > ±1.00?          variance = 0
              │                       │
              ▼                       ▼
      AccrualWarnings          Continue pipeline
      (block JE write)
                                      │
              ┌───────────────────────┤
              │                       │
              ▼                       ▼
  _rebuildBir2316Data_      buildPayrollAccrualJE
  (reads Ledger)            (reads Ledger)
              │                       │
  ┌───────────┤           ┌───────────┤
  │ Item 29   │           │ DR: basic │
  │ Item 34   │           │ DR: OT    │
  │ Item 35   │           │ DR: ND    │
  │ Item 36   │           │ DR: hol   │
  │ Item 38 = │           │ DR: alw   │
  │  29+34    │           │ DR: demin │
  │  +35+36   │           │ DR: 13th  │
  │           │           │ DR: ER    │
  │ Item 39   │           │ ─────     │
  │ Item 44A  │           │ CR: net   │
  │ Item 48   │           │ CR: tax   │
  │ Item 52 = │           │ CR: EE    │
  │  39+44A   │           │    ded    │
  │  +48      │           │ CR: ER    │
  │           │           │    liab   │
  │ Item 19 = │           │ CR: 13th  │
  │ 38 + 52   │           │    pay.   │
  └─────┬─────┘           └─────┬─────┘
        │                       │
        ▼                       │  balance check
   BIR2316Data                  │  ΣDR = ΣCR?
   (correct figures)            │
                                ▼
                       Central Journal Lines
                       (posted only when balanced)
                                │
                                ▼
                       generate2316Pdf()
                       Item 19 = totalNTCalc
                              + totalTaxCalc
                       (never gross_present)
```

---

## EmployeeIncomeLedger Schema

One row per employee per cutoff period. Append-only. Corrections via amendment rows.

### Group A — Audit Identity

| Column | Source |
|---|---|
| `ledger_id` | Generated: `{batch_id}-{userid}-{cutoffend}` |
| `batch_id` | HRIS upload batch |
| `source_file` | Original filename |
| `uploaded_at` | `new Date()` at write time |
| `uploaded_by` | `Session.getActiveUser().getEmail()` |
| `is_amendment` | `FALSE`; `TRUE` only for correction rows |
| `amends_ledger_id` | Blank; points to original row on corrections |
| `amendment_reason` | Required text when `is_amendment = TRUE` |

### Group B — Employee Snapshot (captured at write time)

| Column | Source |
|---|---|
| `userid` | `userid` |
| `last_name` | `last_name` |
| `first_name` | `first_name` |
| `middlename` | `middlename` |
| `company_name` | `companyname` |
| `employment_type` | `employmenttype` |
| `work_region` | `workregion` |
| `is_mwe` | Looked up from Masterlist at write time |

### Group C — Period

| Column | Source |
|---|---|
| `cutoff_start` | `cutoffstart` |
| `cutoff_end` | `cutoffend` |
| `total_days` | `totaldays` |
| `fiscal_year` | Derived: `YEAR(cutoff_end)` |

### Group D — Pay Components (flat numeric, all from PayrollLines)

| Column | PayrollLines Source | BIR Destination |
|---|---|---|
| `regular_hours` | `regularday.hours` | — |
| `regular_rate` | `regularday.rate` | — |
| `regular_amount` | `regularday.amount` | Item 29 / 39 (basic salary) |
| `overtime_hours` | `regularovertime.hours` | — |
| `overtime_rate` | `regularovertime.rate` | — |
| `overtime_amount` | `regularovertime.amount` | Item 50 / 44A taxable |
| `nd_hours` | `nightdifferential.hours` | — |
| `nd_rate` | `nightdifferential.rate` | — |
| `nd_amount` | `nightdifferential.amount` | Item 32 (MWE) / Item 44A |
| `dod_hours` | `dayoffduty.hours` | — |
| `dod_rate` | `dayoffduty.rate` | — |
| `dod_amount` | `dayoffduty.amount` | Item 44A taxable |
| `dod_ot_hours` | `excessdayoffduty.hours` | — |
| `dod_ot_rate` | `excessdayoffduty.rate` | — |
| `dod_ot_amount` | `excessdayoffduty.amount` | Item 44A taxable |
| `spl_hol_amount` | `specialnonworkingholidaysummary` | Item 44A taxable |
| `spl_hol_ot_amount` | `specialnonworkingholidayovertimesummary` | Item 44A taxable |
| `spl_hol_dof_amount` | `specialnonworkingholidaydayoffsummary` *(currently lost)* | Item 44A |
| `spl_hol_dof_ot_amount` | `specialnonworkingholidaydayoffovertimesummary` *(currently lost)* | Item 44A |
| `lgl_hol_amount` | `legalholidaysummary` | Item 44A taxable |
| `lgl_hol_ot_amount` | `legalholidayovertimesummary` | Item 44A taxable |
| `lgl_hol_dof_amount` | `legalholidaydayoffsummary` *(currently lost)* | Item 44A |
| `lgl_hol_dof_ot_amount` | `legalholidaydayoffovertimesummary` *(currently lost)* | Item 44A |
| `training_days` | `trainingday` *(currently lost)* | — |
| `training_ot_amount` | `trainingovertime` *(currently lost)* | — |
| `training_lates_amount` | `traininglates.amount` *(currently lost)* | — |
| `incentives` | `incentives` *(currently lost)* | Item 44A taxable |
| `allowance` | `benefits.other` parsed total | Item 35 / 44A via de minimis rules |
| `adjustment` | `adjustments.0` + `adjustments.1` summed | Item 44A or correction |
| `nth_month_pay` | `nthmonthpaybillable` preferred, else `nthmonthpay` | Item 34 / 48 |
| `basic_salary_hris` | `basicsalary` | Reconciliation only — not used in BIR calc |
| `gross_pay_hris` | `grosspay` | Reconciliation only — not used in BIR calc |

### Group E — De Minimis Detail (from `benefits.other` JSON)

| Column | Source |
|---|---|
| `demin_rice_subsidy` | `benefits.other` → `rice_subsidy` |
| `demin_clothing` | `benefits.other` → `clothing` |
| `demin_medical_cash` | `benefits.other` → `medical_cash` |
| `demin_laundry` | `benefits.other` → `laundry` |
| `demin_daily_meal` | `benefits.other` → `daily_meal` |
| `demin_transport` | `benefits.other` → `transport` |
| `demin_meal` | `benefits.other` → `meal` |
| `demin_housing` | `benefits.other` → `housing` |
| `demin_other` | `benefits.other` → `other_benefits` |

### Group F — Deductions

| Column | PayrollLines Source |
|---|---|
| `sss_ee` | `deductions.sss` → `employeeContribution` |
| `sss_loan` | `deductions.sss` → `loan` |
| `phic_ee` | `deductions.philhealth` → `employeeContribution` |
| `hdmf_ee` | `deductions.pagibig` → `employeeContribution` |
| `hdmf_loan` | `deductions.pagibig` → `loan` |
| `withholding_tax` | `tax` |
| `total_ee_deduction` | `totaleededuction` |

### Group G — Employer Share

| Column | PayrollLines Source |
|---|---|
| `sss_er` | `deductions.sss` → `employerContribution` |
| `phic_er` | `deductions.philhealth` → `employerContribution` |
| `hdmf_er` | `deductions.pagibig` → `employerContribution` |

### Group H — Reconciliation (computed at write time, never changed)

| Column | Formula | Purpose |
|---|---|---|
| `computed_gross` | Sum of all Group D amounts | Should equal `gross_pay_hris` |
| `gross_variance` | `gross_pay_hris − computed_gross` | Non-zero = unclassified HRIS income |
| `net_pay_hris` | `netpay` from PayrollLines | |
| `computed_net` | `computed_gross − total_ee_deduction` | |
| `net_variance` | `net_pay_hris − computed_net` | Non-zero = rounding or adjustment gap |

> `gross_variance` is the key guard field. It would have exposed the ₱4,465 Item 19
> discrepancy before it ever reached BIR2316Data.

---

## BIR 2316 Rebuild — Component Mapping

All sourced from `EmployeeIncomeLedger` YTD sums per employee per fiscal year,
processed in `cutoff_end` ascending order to correctly apply annual caps.

| BIR Item | Formula |
|---|---|
| Item 29 `nontax_basic` | `min(Σ regular_amount, 250,000)` |
| Item 34 `nontax_13th` | `min(Σ nth_month_pay, 90,000)` |
| Item 35 `nontax_demin` | Per-type `min(Σ demin_*, statutory_cap)` |
| Item 36 `nontax_sss_phic_hdmf` | `Σ sss_ee + phic_ee + hdmf_ee` |
| **Item 38** | Sum of Items 29 + 34 + 35 + 36 |
| Item 39 `taxable_basic` | `max(0, Σ regular_amount − 250,000)` |
| Item 44A `taxable_other` | `Σ (overtime + nd + dod + dod_ot + all holiday cols + incentives + adj + demin excess)` |
| Item 48 `taxable_13th` | `max(0, Σ nth_month_pay − 90,000)` |
| **Item 52** | Sum of Items 39 + 44A + 48 |
| **Item 19** | **Item 38 + Item 52 — `gross_present` is NEVER used** |

---

## Payroll Accrual JE — Correct Structure

The identity that must hold at batch level before any JE line is written:

```
Σ (all pay components) = Σ net_pay + Σ all_EE_deductions + Σ ER_share_liabilities
```

| Side | Account | Source Column |
|---|---|---|
| DR | Salaries and Wages | `regular_amount` |
| DR | Overtime Pay Expense | `overtime_amount` |
| DR | Night Differential Expense | `nd_amount` |
| DR | Holiday Pay Expense | sum of all holiday columns |
| DR | Personnel Allowance | `allowance` |
| DR | De Minimis Benefits Expense | sum of all `demin_*` columns |
| DR | Adjustments Expense | `adjustment` |
| DR | 13th Month Pay | `nth_month_pay` |
| DR | SSS ER Share | `sss_er` |
| DR | PHIC ER Share | `phic_er` |
| DR | HDMF ER Share | `hdmf_er` |
| CR | Salaries and Wages Payable | `net_pay_hris` |
| CR | Withholding Tax Payable | `withholding_tax` |
| CR | SSS EE Contribution Payable | `sss_ee` |
| CR | SSS Loan Payable | `sss_loan` |
| CR | PHIC EE Contribution Payable | `phic_ee` |
| CR | HDMF EE Contribution Payable | `hdmf_ee` |
| CR | HDMF Loan Payable | `hdmf_loan` |
| CR | SSS ER Contribution Payable | `sss_er` (same as DR) |
| CR | PHIC ER Contribution Payable | `phic_er` (same as DR) |
| CR | HDMF ER Contribution Payable | `hdmf_er` (same as DR) |
| CR | 13th Month Payable | `nth_month_pay` (same as DR) |

**Pre-write balance check:** If `|ΣDR − ΣCR| > 1.00`, the JE is blocked and the
discrepancy is logged to `AccrualWarnings` with the offending employee rows.

---

## Sheets Affected in WRI Employee Masterlist Spreadsheet

| Sheet | Status | Change |
|---|---|---|
| `PayrollLines` (per-year SS) | Unchanged | Remains raw HRIS archive |
| `13MDetails` | Unchanged | Still sourced during BIR rebuild |
| `DeminimisDetails` | Unchanged | Still sourced during BIR rebuild |
| `BIR2316Data` | Modified | Re-sourced from Ledger; Item 19 fixed |
| `BIR2316Overrides` | Unchanged | Still applied as final override layer |
| **`EmployeeIncomeLedger`** | **New** | ~70 columns; append-only; source of truth |
| **`AccrualWarnings`** | **New** | Written when `gross_variance > ±1.00` |

---

## Functions to Change in `payroll.js`

| # | Function | Line (approx.) | Change |
|---|---|---|---|
| 1 | `processPayrollRun()` | 668 | Add `upsertToEmployeeIncomeLedger_()` call after `upsertToDeminimisDetails_()` |
| 2 | `rollbackHrisUpload_()` | 701 | Extend to delete ledger rows for rolled-back `batchId` |
| 3 | `upsertToEmployeeIncomeLedger_()` | — | **New function** |
| 4 | `_rebuildBir2316Data_()` | 6394 | Switch data source to Ledger; fix Item 19 formula |
| 5 | `buildPayrollAccrualJE()` | 4440 | Component-level DR lines; pre-write balance check |
| 6 | `_build2316HtmlV2_()` | 9183, 9621 | Item 19: `grossPresent` → `totalNTCalc + totalTaxCalc` |
| 7 | `_build2316Html_()` | 8743 | Same Item 19 fix |
| 8 | `_build2316HtmlFromTemplate_()` | 9095 | Same Item 19 fix |
| 9 | Re-upload path | ~6274 | Mirror changes from #1 |

---

## Impact on Existing Outputs

| Output | Impact |
|---|---|
| **BIR Form 2316 PDF** | Item 19 will change for employees with unclassified income. The new figure is lower and correct (e.g. Santocidad: 70,160.66 → 65,695.19). |
| **Payroll Accrual JE** | New DR lines appear for OT, ND, holiday, de minimis. Total DR is unchanged; it is now broken into auditable sub-lines. |
| **BIR2316Data sheet** | `total_nontaxable` and `total_taxable_present` will absorb components previously orphaned in `alw`. Row count unchanged. |
| **PayrollLines sheet** | Unchanged — remains the raw archive. Nothing deleted or modified. |
| **Disbursement / bank upload** | No change. Those flows read from voucher lines, not from the ledger. |
| **13MDetails / DeminimisDetails** | No change. Written on upload, read during BIR rebuild. |

---

## Implementation Order

| Step | Scope | Risk |
|---|---|---|
| 1 | Create `EmployeeIncomeLedger` schema + `upsertToEmployeeIncomeLedger_()` | Zero — additive only |
| 2 | Add call in `processPayrollRun()` and re-upload path | Low |
| 3 | Fix Item 19 in all 3 PDF renderers (3 one-line changes) | Zero downstream risk |
| 4 | Fix `_rebuildBir2316Data_()` to read Ledger | Run `bootstrapBir2316Data('all')` after to validate |
| 5 | Fix `buildPayrollAccrualJE()` + balance check | Test on one batch before enabling for all |
| 6 | Extend `rollbackHrisUpload_()` | Low |

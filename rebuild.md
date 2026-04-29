# WRI Employee Masterlist Full Rebuild — Implementation Plan

> **Status:** ALL PHASES COMPLETE ✅ (Phases 1–10 including 5b). Ready for verification.

---

## Background

One-time rebuild function `rebuildWriMasterlistFull()` that:
1. Migrates the Masterlist to a new unified 29-column set (absorbs BIR columns, adds `regulardayrate`, removes `smw_daily`)
2. Extends CompanyRegistry with per-company annual de minimis caps
3. Creates a new `DeminimisDetails` transaction log sheet
4. Rebuilds `BIR2316Data` with MWE-awareness and de minimis threshold logic
5. Rebuilds `13MDetails` from scratch across all PayrollLines years
6. Deletes `IncomeDetails` sheet (deprecated)

**Relevant file:** `code.js`

---

## Phase 1 — Update Constants & Core Column Definitions
**Target:** `code.js` ~L17–L21

### Step 1 — Replace `WRI_ML_HEADERS` (L17)
Old: 16 columns  
New: 29 columns

```
userid, first_name, middlename, last_name, accountnumber, workregion,
employmenttype, employer, companyname, employeestatus,
regulardayrate,                           ← NEW at index 10
salarystatus, finalpaystatus,             ← shifted +1 from old
last_seen_cutoffend, hiringdate, separationdate, last_modified,
tin, rdo_code, address, address_zip,      ← BIR cols absorbed (were dynamic)
local_address, local_address_zip,
date_of_birth, contact_number, nationality,
smw_monthly, is_mwe, is_substituted_filing
```

Key changes from old layout:
- `regulardayrate` inserted at index 10 → `salarystatus` shifts to 11, `finalpaystatus` to 12
- BIR columns are now fixed (no longer appended dynamically by `_ensureMasterlistBirColumns_`)
- `smw_daily` is permanently removed
- `smw_monthly = regulardayrate × 26` (26-day Philippine factor)

### Step 2 — Add new constants near L21
- Add `WRI_DEMIN_SHEET = 'DeminimisDetails'`
- Add `WRI_DEMIN_COLS` (see Phase 5b, Step 8)
- Mark `WRI_INCOME_SHEET` as deprecated with a comment

---

## Phase 2 — Fix Hardcoded Column Index References
**Target:** `code.js` ~L4880–L4975  
**Why:** Adding `regulardayrate` at index 10 shifts `salarystatus` from col 11→12 and `finalpaystatus` from col 12→13 in all sync functions.

### Step 3 — `syncWriMasterlistByUserid_` (~L4880)
Replace `getRange(i+1, 11)` → dynamic lookup for `salarystatus`  
Replace `getRange(i+1, 12)` → dynamic lookup for `finalpaystatus`  
Pattern: read `data[0]` (header row) and resolve column index by name.

### Step 4 — `syncWriMasterlistByNameCompany_` (~L4898)
Same dynamic lookup for cols 10 (`employeestatus`), 11 (`salarystatus`), 12 (`finalpaystatus`).

### Step 5 — `syncWriMasterlistByNameCompanyPayroll_` (~L4931)
Same dynamic lookup — identical pattern.

---

## Phase 3 — Update `upsertToWriMasterlist_`
**Target:** `code.js` ~L4722

### Step 6
- Add `regulardayrate` source mapping:  
  `let srIdx = mapH.indexOf('regulardayrate');`  
  (HRIS column is `regularday.rate`; `normalizeColName_` strips the dot → lookup key `regulardayrate`)
- Include `regulardayrate` in both the "update existing row" array and the `toAppend` row
- Persist only if incoming value is **non-zero AND `isNewer`** (latest-cutoffend wins)
- BIR columns (`ex[17]` through `ex[28]`) must be preserved from the existing row when updating

---

## Phase 4 — Update `updateEmployeeRecord`
**Target:** `code.js` ~L4772

### Step 7
- Add `regulardayrate` to payload destructure and `set()` calls
- Remove `set('smw_daily', birSmwDaily)` entirely
- Auto-compute: if `regulardayrate` provided and `is_mwe = 'TRUE'` → `smw_monthly = regulardayrate × 26`
- Note: `regulardayrate` is always persisted to the masterlist regardless of `is_mwe`; the `is_mwe` flag only controls whether Item 9 (SMW Daily) appears on the 2316 PDF — handled in the PDF generator, not here

---

## Phase 5 — CompanyRegistry De Minimis Caps
**Target:** `code.js` ~L5482 (`_ensureCompanyRegistry_`)

### Step 8
Extend `REGISTRY_HEADERS` with 9 annual cap columns:

| Column | Statutory Annual Cap (BIR RR 11-2018) |
|---|---|
| `demin_rice` | 24,000 |
| `demin_clothing` | 6,000 |
| `demin_medical` | 10,000 |
| `demin_laundry` | 3,600 |
| `demin_daily_meal` | 0 *(25% of regional min wage — admin sets)* |
| `demin_transport` | 0 *(not a BIR de minimis item — admin sets or 0)* |
| `demin_meal` | 0 |
| `demin_housing` | 0 |
| `demin_other` | 0 |

- Backfill statutory defaults only for **blank cells** in existing rows (never overwrite admin-set values)

---

## Phase 5b — New `DeminimisDetails` Sheet

### Step 9 — Define `WRI_DEMIN_COLS` constant
```
BatchID, UploadDate, UploadedBy, SourceFile,
userid, first_name, middlename, last_name, companyname,
cutoffstart, cutoffend,
rice_subsidy, clothing, medical_cash, laundry,
daily_meal, transport, meal, housing, other_benefits,
total_deminimis, billable_total, nonbillable_total
```
- `total_deminimis` = sum of all 9 typed columns
- `billable_total` = sum of items where `item.info.billabletoclient === "True"` (case-insensitive)
- `nonbillable_total` = `total_deminimis - billable_total`

### Step 10 — Fix existing bug in `parseBenefitsJson` (~L1480)
**Bug:** reducer reads `item.amount` (flat), but actual JSON structure is `item.info.amount` (nested) → always returns 0.

Actual `benefits.other` JSON structure:
```json
[
  {"id": 1, "info": {"name": "Clothing", "amount": "200", "billabletoclient": "True"}},
  {"id": 2, "info": {"name": "Rice Subsidy", "amount": "1500", "billabletoclient": "True"}}
]
```

Fix reducer:
```js
return obj.reduce((sum, item) => sum + (Number((item.info && item.info.amount) || item.amount || 0)), 0);
```

### Step 11 — New function `upsertToDeminimisDetails_`
- Called from `processPayrollRun` alongside `upsertToWri13MDetails_` (replace the `upsertToWriIncomeDetails_` call)
- Source: `benefits.other` JSON per PayrollLines row
- Name normalization rules (lowercase + trim `item.info.name`):

| Input | Maps to column |
|---|---|
| "rice subsidy", "rice" | `rice_subsidy` |
| "clothing", "uniform" | `clothing` |
| "medical", "medical cash" | `medical_cash` |
| "laundry" | `laundry` |
| "daily meal" | `daily_meal` |
| "transport", "transportation" | `transport` |
| "meal" *(not daily meal)* | `meal` |
| "housing" | `housing` |
| anything else | `other_benefits` |

- Dedup key: `batchId|userid|cutoffStart|cutoffEnd` (same pattern as `upsertToWri13MDetails_`)
- Batch-append; skip if key already seen

### Step 12 — New function `_rebuildDeminimisDetails_`
- Wipe `DeminimisDetails` sheet; re-write `WRI_DEMIN_COLS` header
- Iterate all years from YearlyDatabases register → scan PayrollLines for rows where `benefits.other` is non-empty
- Reconstruct `batchId` from `batchid` column (or file/cutoff composite if missing)
- Apply same name→column mapping as `upsertToDeminimisDetails_`
- Batch-append entire rebuild at once

---

## Phase 6 — Enhanced `_rebuildBir2316Data_`
**Target:** `code.js` ~L5557

### Step 13 — Load MWE data from Masterlist
Load `is_mwe` and `regulardayrate` from Masterlist into per-uid map (alongside existing `mlDates`).

### Step 14 — Load CompanyRegistry de minimis caps
Build a `companyName → caps` map using the 9 `demin_*` columns from Phase 5.  
Use statutory BIR defaults as fallback for any blank cap.

### Step 15 — Pre-load DeminimisDetails YTD totals
Instead of parsing `benefits.other` inline in the PayrollLines loop, read the `DeminimisDetails` sheet and aggregate per-uid per-type YTD totals (sum all rows for the year).

### Step 16 — Apply MWE + de minimis logic in row builder
- **MWE employee:** `nontax_basic = basic_salary_total`, `taxable_basic = 0`, `tax_due = 0`
- `nontax_salaries_other` = sum of `min(ytd_type_amount, cap_type)` across all 9 types
- `taxable_salaries_other` = sum of `max(0, ytd_type_amount - cap_type)` (excess over cap is taxable)

---

## Phase 7 — Rebuild `13MDetails`
**Target:** `code.js` ~L5265 area

### Step 17 — New function `_rebuildWri13MDetails_`
- Get years list from `YearlyDatabases` registry (same pattern as `_rebuildBir2316Data_`)
- Wipe `13MDetails` sheet; re-write `WRI_13M_COLS` header
- For each year: open yearly spreadsheet → read all PayrollLines rows where `nthmonthpaybillable > 0`
- Dedup key: `batchId|rowId|cutoffStart|cutoffEnd`
- Batch-append all rows at once (full rebuild, no incremental upsert)

---

## Phase 8 — Deprecate `IncomeDetails`
**Target:** `code.js` ~L633 and ~L5328

### Step 18
- Remove `upsertToWriIncomeDetails_` call from `processPayrollRun` (~L640)  
  Replace with: `try { upsertToDeminimisDetails_(...) } catch(e) {}`
- Add deprecation comment block at top of `upsertToWriIncomeDetails_` function (~L5328)  
  Do **not** delete the function yet

---

## Phase 9 — Migrate Masterlist Sheet (one-time data migration)
**Target:** new function `_migrateAndRebuildMasterlistSheet_(wriSS)`

### Step 19
1. Read existing sheet → build `columnName → value` map per row using old headers
2. Clear sheet contents
3. Write new `WRI_ML_HEADERS` header row (29 cols)
4. **Seed `regulardayrate`** from PayrollLines: scan all yearly sheets (YearlyDatabases), per uid track the row with the **latest `cutoffend`**, read `regularday.rate` (normalizes to `regulardayrate`)
5. Auto-compute `smw_monthly = regulardayrate × 26` for rows where `is_mwe = 'TRUE'`
6. Discard `smw_daily` data (column dropped)
7. Migrate `is_substituted_filing` from old dynamic column if present
8. Preserve all other data at new index positions

---

## Phase 10 — Orchestrator Function

### Step 20 — New top-level function `rebuildWriMasterlistFull()`
```js
function rebuildWriMasterlistFull() {
  const wriSS = SpreadsheetApp.openById(WRI_SPREADSHEET_ID);
  _migrateAndRebuildMasterlistSheet_(wriSS);   // Phase 9
  _ensureCompanyRegistry_(wriSS);              // Phase 5 — with de minimis caps
  _rebuildDeminimisDetails_();                 // Phase 5b — rebuild transaction log
  _rebuildWri13MDetails_();                    // Phase 7
  _rebuildBir2316Data_(wriSS, 'all');          // Phase 6 — reads DeminimisDetails
  const incSh = wriSS.getSheetByName('IncomeDetails');
  if (incSh) wriSS.deleteSheet(incSh);         // Phase 8
}
```
Callable from the Apps Script editor. Log progress at each phase.

---

## Verification Checklist

After running `rebuildWriMasterlistFull()`:

- [ ] Logger output shows no errors at any phase
- [ ] WRI Masterlist has exactly 29 columns; `regulardayrate` at col 11; BIR columns at fixed positions 18–29
- [ ] `13MDetails` rows rebuilt from all PayrollLines years; no duplicates
- [ ] `DeminimisDetails` sheet exists with correct column headers
- [ ] `IncomeDetails` sheet is gone
- [ ] BIR2316Data — MWE employee row: `nontax_basic = basic_salary_total`, `taxable_basic = 0`, `tax_due = 0`
- [ ] BIR2316Data — non-MWE employee: de minimis split correctly applied per CompanyRegistry caps
- [ ] Form 2316 PDF for MWE employee: Item 9 (SMW Daily) appears correctly
- [ ] Web app employee edit: `regulardayrate` saves; if `is_mwe = TRUE`, `smw_monthly` auto-fills as `regulardayrate × 26`
- [ ] `parseBenefitsJson` bug fixed: `alw` column no longer 0 for employees with benefits

---

## Code Location Reference

| Function | Line | Notes |
|---|---|---|
| `WRI_ML_HEADERS` constant | L17 | Replace with 29-col version |
| `WRI_13M_COLS` constant | L21 | Add `WRI_DEMIN_COLS` nearby |
| `parseBenefitsJson` | ~L1480 | Bug fix: `item.amount` → `item.info.amount` |
| `processPayrollRun` write calls | ~L633 | Remove IncomeDetails call; add DeminimisDetails call |
| `getWriMasterlistSheet_` | L4709 | No change (uses constant) |
| `upsertToWriMasterlist_` | L4722 | Add `regulardayrate`; expand to 29 cols |
| `updateEmployeeRecord` | L4772 | Replace `smw_daily` → `regulardayrate` |
| `syncWriMasterlistByUserid_` | L4880 | Dynamic col lookup |
| `syncWriMasterlistByNameCompany_` | L4898 | Dynamic col lookup |
| `syncWriMasterlistByNameCompanyPayroll_` | L4931 | Dynamic col lookup |
| `upsertToWri13MDetails_` | L5265 | No change |
| `upsertToWriIncomeDetails_` | L5328 | Add deprecation comment; remove call site |
| `_ensureCompanyRegistry_` | L5482 | Add 9 de minimis cap columns |
| `_rebuildBir2316Data_` | L5557 | MWE + de minimis enhancement |
| New: `upsertToDeminimisDetails_` | append | After `upsertToWri13MDetails_` |
| New: `_rebuildDeminimisDetails_` | append | After above |
| New: `_rebuildWri13MDetails_` | append | After above |
| New: `_migrateAndRebuildMasterlistSheet_` | append | After above |
| ~~New: `rebuildWriMasterlistFull`~~ | removed | See **Orchestrator Reference** section below |

---

## Orchestrator Reference — `rebuildWriMasterlistFull`

> This function was removed from `code.js` to save lines.
> To run a full rebuild, **copy the function below into the Apps Script editor**, run it once, then delete it again.
> Do NOT run while a payroll upload is in progress.

**When to use:** After any schema migration, bulk data import, or when any derived sheet
(`DeminimisDetails`, `13MDetails`, `BIR2316Data`) needs to be reconstructed from scratch.
Safe to re-run — each phase is idempotent or destructive-then-rebuild, so the final state
is always consistent.

### What each phase does

| Phase | Internal function | Description |
|---|---|---|
| 9 | `_migrateAndRebuildMasterlistSheet_(wriSS)` | Reads every Masterlist row into a header→value map, clears the sheet, rewrites it in canonical 29-column `WRI_ML_HEADERS` layout, seeds `regulardayrate` from the most recent PayrollLines `cutoffend` row per employee, permanently drops `smw_daily`. |
| 5b | `_rebuildDeminimisDetails_()` | Wipes DeminimisDetails and re-populates it by scanning every year's PayrollLines for `benefits.other` JSON (rice_subsidy, clothing, etc.). One row per employee per cutoff period. Source of truth for Phase 6 de minimis splits. |
| 7 | `_rebuildWri13MDetails_()` | Wipes 13MDetails and re-populates it from all PayrollLines rows where `nthmonthpaybillable > 0` across all years. Cutoff dates stored as `MM/dd/yyyy`. Dedup key: `batchId|rowId|cutoffstart|cutoffend`. |
| 6 | `_rebuildBir2316Data_(wriSS, 'all')` | Aggregates YTD gross pay, basic salary, 13th-month pay, SSS/PhilHealth/HDMF, and tax per employee per year. Applies MWE rules (full basic non-taxable, tax due = 0) and splits de minimis into non-taxable (within configurable per-category caps from **Settings → Income Tax**) and taxable excess. Caps fall back to BIR RR 11-2018 statutory defaults when no setting is saved. `nontax_salaries_other` (Item 37) = sum of min(ytd, cap) per type. `taxable_salaries_other` (Item 44) = sum of excess over cap per type. |
| 8 | Delete `IncomeDetails` sheet | Removes legacy IncomeDetails sheet if still present. Safe to skip if already deleted. |

### Full function code

```js
function rebuildWriMasterlistFull() {
  Logger.log('=== rebuildWriMasterlistFull START ===');
  var wriSS = SpreadsheetApp.openById(WRI_EMPLOYEE_MASTERLIST_ID);

  // Phase 9: Migrate Masterlist to canonical 29-column schema and seed regulardayrate.
  Logger.log('[Phase 9] Migrating Masterlist schema...');
  try { _migrateAndRebuildMasterlistSheet_(wriSS); Logger.log('[Phase 9] DONE'); }
  catch(e) { Logger.log('[Phase 9] ERROR: ' + e.message); }

  // Phase 5b: Rebuild de minimis transaction log from all years of PayrollLines.
  Logger.log('[Phase 5b] Rebuilding DeminimisDetails...');
  try { _rebuildDeminimisDetails_(); Logger.log('[Phase 5b] DONE'); }
  catch(e) { Logger.log('[Phase 5b] ERROR: ' + e.message); }

  // Phase 7: Rebuild 13th-month pay log from all years of PayrollLines.
  Logger.log('[Phase 7] Rebuilding 13MDetails...');
  try { _rebuildWri13MDetails_(); Logger.log('[Phase 7] DONE'); }
  catch(e) { Logger.log('[Phase 7] ERROR: ' + e.message); }

  // Phase 6: Rebuild BIR 2316 annual aggregates — reads DeminimisDetails and 13MDetails.
  // De minimis and 13th month caps are read from central Settings (Settings > Income Tax tab).
  // nontax_salaries_other (Item 37) = non-taxable de minimis within cap.
  // taxable_salaries_other (Item 44) = de minimis excess over cap.
  Logger.log('[Phase 6] Rebuilding BIR2316Data (all years)...');
  try {
    var rowsWritten = _rebuildBir2316Data_(wriSS, 'all');
    Logger.log('[Phase 6] DONE — ' + rowsWritten + ' rows written.');
  } catch(e) { Logger.log('[Phase 6] ERROR: ' + e.message); }

  // Phase 8: Remove the legacy IncomeDetails sheet if it still exists.
  // IncomeDetails is deprecated — data is now captured in DeminimisDetails.
  Logger.log('[Phase 8] Deleting legacy IncomeDetails sheet...');
  try {
    var incSh = wriSS.getSheetByName('IncomeDetails');
    if (incSh) { wriSS.deleteSheet(incSh); Logger.log('[Phase 8] IncomeDetails deleted.'); }
    else { Logger.log('[Phase 8] IncomeDetails already gone — nothing to do.'); }
  } catch(e) { Logger.log('[Phase 8] ERROR: ' + e.message); }

  Logger.log('=== rebuildWriMasterlistFull COMPLETE ===');
}
```

---

## Lightweight Refresh — `refreshBir2316DataOnly`

> Use this after changing **Settings → Income Tax** caps (or after any de minimis data fix)
> when a full schema migration is **not** needed. Much faster than `rebuildWriMasterlistFull`.

**When to use:**
- You updated de minimis caps or the 13th month cap in Settings
- You re-uploaded a payroll batch and want BIR2316Data recalculated
- You do **not** need to migrate the Masterlist schema or rebuild 13MDetails

**Data flow:**
```
DeminimisDetails  ←  rebuilt from PayrollLines benefits.other JSON
      ↓
BIR2316Data       ←  reads DeminimisDetails + Income Tax caps from Settings
```

```js
function refreshBir2316DataOnly() {
  Logger.log('=== refreshBir2316DataOnly START ===');
  var wriSS = SpreadsheetApp.openById(WRI_EMPLOYEE_MASTERLIST_ID);

  // Step 1: Rebuild de minimis transaction log (source of Item 37 / taxable_salaries_other).
  Logger.log('[1] Rebuilding DeminimisDetails...');
  try { _rebuildDeminimisDetails_(); Logger.log('[1] DONE'); }
  catch(e) { Logger.log('[1] ERROR: ' + e.message); }

  // Step 2: Rebuild BIR2316Data — reads DeminimisDetails + Income Tax caps from Settings.
  Logger.log('[2] Rebuilding BIR2316Data (all years)...');
  try {
    var rows = _rebuildBir2316Data_(wriSS, 'all');
    Logger.log('[2] DONE — ' + rows + ' rows written.');
  } catch(e) { Logger.log('[2] ERROR: ' + e.message); }

  Logger.log('=== refreshBir2316DataOnly COMPLETE ===');
}
```

---

## Key Decisions

- `smw_daily` permanently dropped; `regulardayrate` replaces it for all purposes
- `smw_monthly = regulardayrate × 26` (26-day Philippine factor)
- BIR columns folded into core `WRI_ML_HEADERS`; `_ensureMasterlistBirColumns_` becomes legacy (kept as guard but bypassed)
- `IncomeDetails` sheet deleted; `upsertToWriIncomeDetails_` call removed from `processPayrollRun`
- De minimis caps are now configurable per category via **Settings → Income Tax** tab (saved to `Modules` sheet in central settings). Statutory BIR RR 11-2018 values are used as fallback when no setting exists.
- `nontax_salaries_other` (Item 37) = sum of `min(ytd, cap)` per de minimis category
- `taxable_salaries_other` (Item 44) = sum of `max(0, ytd − cap)` per de minimis category (excess over cap)
- 13th month non-taxable cap is also configurable (default ₱90,000)
- `13MDetails` rebuilt from ALL years in YearlyDatabases
- `is_substituted_filing` retained in the new header set
- `regulardayrate` appears in 2316 Item 9 only when `is_mwe = TRUE` — enforced in the PDF generator

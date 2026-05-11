# Workscale Finance — GAS → Firebase Migration Plan

## Current Architecture Summary

| Module | GAS Backend | GAS Frontend | Data (Google Sheets) |
|---|---|---|---|
| Unified Portal | `unified.js` | `unified_index.html` | `MainLinks`, `Users` |
| Payroll | `payroll.js` | `payroll.html` | `PayrollLines`, `13MDetails`, `DeminimisDetails`, `BIR2316Data`, Employee Masterlist |
| Accounting | `acounting.js` | `accounting.html` | Transactions, `JournalLines`, Bank Ledger, COA |
| Billing Book | `billingbook.js` | `billingbook.html` | `BillingBooks`, `BillingComputations`, `RawBillingUploads` |
| Projections | `projections.js` | `projections.html` | `Profiles`, `Headcount Plan`, `SavedBudget` |
| Cosmos/Digits Billing | `cosmos_billing.js`, `digits_billing.js` | (Sheets menu) | Active spreadsheet |

---

## Target Firebase Architecture

```
Firebase Project: workscale-finance
│
├── Firebase Hosting         ← replaces GAS HtmlService
├── Cloud Firestore          ← replaces all Google Sheets databases
├── Firebase Authentication  ← replaces Session.getActiveUser()
├── Firebase Storage         ← replaces Google Drive folders
└── Cloud Functions (Node)   ← replaces all GAS server-side logic
```

---

## Proposed Folder Structure

```
workscale-finance/
├── firebase.json
├── .firebaserc
├── firestore.rules
├── firestore.indexes.json
├── storage.rules
│
├── functions/                         ← Cloud Functions (Node.js 20)
│   ├── package.json
│   ├── index.js                       ← exports all function groups
│   │
│   ├── payroll/
│   │   ├── processPayrollRun.js       ← HRIS Excel parse + Ledger upsert
│   │   ├── buildBir2316.js            ← BIR Form 2316 generation
│   │   ├── buildPayrollAccrualJE.js   ← balanced DR/CR journal entry
│   │   └── disbursement.js            ← bank file generation (BPI/UB)
│   │
│   ├── accounting/
│   │   ├── transactions.js            ← AP/AR CRUD
│   │   ├── journalEntries.js          ← JE builder + posting
│   │   ├── bankLedger.js              ← bank statement reconciliation
│   │   └── approvals.js               ← workflow routing
│   │
│   ├── billing/
│   │   ├── billingBook.js             ← client book management
│   │   ├── computations.js            ← fee + tax computation engine
│   │   ├── transformConfigs.js        ← per-client column mapping
│   │   └── cosmosDigits.js            ← Cosmos/Digits billing logic
│   │
│   ├── projections/
│   │   ├── profiles.js                ← projection profile CRUD
│   │   └── budget.js                  ← headcount + budget calculations
│   │
│   └── shared/
│       ├── auth.js                    ← user access check middleware
│       ├── pdf.js                     ← PDF generation (pdfkit/puppeteer)
│       └── excelParser.js             ← xlsx parsing (exceljs)
│
└── hosting/                           ← Firebase Hosting (SPA)
    ├── index.html
    ├── vite.config.js
    ├── package.json
    └── src/
        ├── main.js                    ← app entry point
        ├── firebase.js                ← Firebase SDK init
        ├── router.js                  ← client-side routing
        │
        ├── auth/
        │   ├── AuthGuard.jsx
        │   └── LoginPage.jsx
        │
        ├── layouts/
        │   └── AppShell.jsx           ← sidebar + topbar (from unified_index.html)
        │
        ├── modules/
        │   ├── payroll/
        │   ├── accounting/
        │   ├── billing/
        │   └── projections/
        │
        └── shared/
            ├── components/            ← cards, tables, modals, toasts
            └── hooks/                 ← useFirestore, useAuth, useStorage
```

---

## Firestore Collections Map

This is the direct translation of every Google Sheets tab:

```
/users/{uid}                           ← was: CentralSettings > Users sheet
/settings/global                       ← was: Script Properties / constants

/employees/{userId}                    ← was: WRI Employee Masterlist
  └── /incomeLedger/{periodId}         ← was: EmployeeIncomeLedger (new in rebuild plan)

/payrollBatches/{batchId}              ← was: PayrollLines (batch metadata)
  └── /lines/{lineId}                  ← was: PayrollLines rows

/bir2316Data/{userId}/years/{year}     ← was: BIR2316Data sheet
/thirteenthMonthDetails/{id}           ← was: 13MDetails sheet
/deminimisDetails/{id}                 ← was: DeminimisDetails sheet
/disbursements/{id}                    ← was: DISBURSEMENT_DB_ID spreadsheet
/accrualWarnings/{id}                  ← was: AccrualWarnings sheet

/transactions/{txId}                   ← was: Transactions sheet (Accounting)
/journalEntries/{jeId}                 ← was: JournalLines spreadsheet
  └── /lines/{lineId}
/chartOfAccounts/{accountId}           ← was: COA sheet
/bankLedger/{bankId}/entries/{id}      ← was: UnionBank/BPI/BDO TX spreadsheets

/billingBooks/{bookId}                 ← was: BillingBooks sheet
  └── /transactions/{txId}             ← was: BillingBookTrnx
/billingUploads/{uploadId}             ← was: RawBillingUploads
/billingComputations/{compId}          ← was: BillingComputations
/billingTransformConfigs/{configId}    ← was: BillingTransformConfigs
/billingDataList/{pushId}              ← was: BillingDataList

/projectionProfiles/{profileId}        ← was: Profiles sheet
  └── /headcount/{positionId}          ← was: HC_{id} sheet
  └── /budget/{lineId}                 ← was: SB_{id} sheet
```

---

## Authentication Migration

| GAS | Firebase |
|---|---|
| `Session.getActiveUser().getEmail()` | `firebase.auth().currentUser.email` |
| `checkUserAccess_(email)` in every `doGet()` | Firebase Auth + Firestore `/users` rule + `AuthGuard` component |
| `PORTAL_ALLOWED_EMAILS` constant | Firestore `users` collection with `role` field |
| Manual email list | Firebase Custom Claims (`admin`, `payroll_user`, `billing_user`) |

---

## Function Migration Map

| GAS `google.script.run.*` | Firebase Equivalent |
|---|---|
| `getPortalAppLinks()` | Removed — routing is client-side |
| `processPayrollRun()` | `functions/payroll/processPayrollRun` (callable) — triggered by Storage upload |
| `buildPayrollAccrualJE()` | `functions/payroll/buildPayrollAccrualJE` (callable) |
| `generateBir2316Pdf()` | `functions/payroll/buildBir2316` (callable) → PDF stored in Storage |
| `saveTransaction()` | Direct Firestore write from client (with security rules) |
| `postJournalEntry()` | `functions/accounting/journalEntries` (callable) — enforces DR=CR |
| `generateBillingComputation()` | `functions/billing/computations` (callable) |
| `getDisbursementBankFile()` | `functions/payroll/disbursement` (callable) → returns CSV download |

**Pattern change:** Every `google.script.run.myFn(callback)` becomes:

```js
// Before (GAS)
google.script.run.withSuccessHandler(cb).withFailureHandler(err).myFn(payload);

// After (Firebase)
const myFn = httpsCallable(functions, 'myFn');
const result = await myFn(payload);
```

---

## File Storage Migration

| GAS (Google Drive) | Firebase Storage Path |
|---|---|
| `PAYROLL_ARCHIVE_FOLDER_ID` | `payroll/hris/{batchId}/{filename}` |
| `PAYSHEETS_FOLDER_ID` | `payroll/paysheets/{batchId}/` |
| `YEARLY_DB_FOLDER_ID` | `payroll/yearlydb/{year}/` |
| `BIR2316_TEMPLATE_PDF_ID` | `templates/bir2316-template.pdf` |
| `BANK_STATEMENTS_FOLDER_ID` | `accounting/bank-statements/{bankId}/` |
| `SIGNATURES_FOLDER_ID` | `accounting/signatures/{userId}` |
| `ATD_FOLDER_ID` | `payroll/attendance/{batchId}/` |

---

## Recommended Tech Stack

| Layer | Technology | Reason |
|---|---|---|
| Frontend Framework | **React + Vite** | Existing HTML already uses a component-like structure; React maps cleanly |
| UI / CSS | **Tailwind CSS** (already in use) | Zero change — keep existing class names |
| Icons | **Font Awesome** (already in use) | No change |
| Charts | **Chart.js** (already in use) | No change |
| PDF client | **jsPDF** (already in use) | No change |
| Excel parsing | **ExcelJS** (Cloud Function) | Replaces Sheets `ImportData` + `getDataRange()` |
| Database | **Cloud Firestore** | Document model fits row-based Sheets data well |
| File storage | **Firebase Storage** | Direct replacement for Drive folders |
| Auth | **Firebase Auth (Google provider)** | SSO with existing Google accounts — no password changes for users |
| Server logic | **Cloud Functions v2 (Node 20)** | Replaces all GAS `.gs` server-side functions |
| Hosting | **Firebase Hosting** | CDN-backed, instant rollbacks, custom domain support |

---

## Firestore Security Rules (Sketch)

```js
// firestore.rules
rules_version = '2';
service cloud.firestore {
  match /databases/{db}/documents {

    // Only authenticated users present in the users collection
    function isAppUser() {
      return request.auth != null
        && exists(/databases/$(db)/documents/users/$(request.auth.uid));
    }
    function hasRole(role) {
      return isAppUser()
        && get(/databases/$(db)/documents/users/$(request.auth.uid)).data.role == role;
    }

    match /transactions/{id}     { allow read, write: if isAppUser(); }
    match /journalEntries/{id}   { allow read: if isAppUser();
                                   allow write: if hasRole('accountant') || hasRole('admin'); }
    match /employees/{id}        { allow read: if isAppUser();
                                   allow write: if hasRole('payroll') || hasRole('admin'); }
    match /users/{uid}           { allow read, write: if hasRole('admin'); }
  }
}
```

---

## Migration Phases

### Phase 1 — Foundation (1–2 weeks)
- Set up Firebase project, Authentication (Google provider), Firestore, Storage, and Hosting
- Port `unified_index.html` CSS + sidebar into React `AppShell` with client-side routing
- Migrate `users` and `settings` from Central Settings spreadsheet into Firestore

### Phase 2 — Accounting Module (2–3 weeks)
- Migrate Transactions, Journal Entries, and COA to Firestore
- Port `acounting.js` business logic to Cloud Functions
- Move bank statement files to Storage; port bank ledger reconciliation

### Phase 3 — Payroll Module (3–4 weeks)
- Migrate Employee Masterlist to Firestore `/employees`
- Port `processPayrollRun()` as a Storage-triggered Cloud Function (file upload → auto-process)
- Migrate `EmployeeIncomeLedger` as the Firestore source of truth (per the income ledger rebuild plan)
- Port BIR 2316 PDF generation; store output in Firebase Storage

### Phase 4 — Billing Module (2 weeks)
- Migrate `BillingBooks`, `BillingComputations`, and transform configs to Firestore
- Port Cosmos and Digits billing logic from Sheet-menu scripts into Cloud Functions

### Phase 5 — Projections Module (1 week)
- Migrate profiles, headcount plans, and budget lines to Firestore

### Phase 6 — Hardening
- Write Firestore security rules per role
- Set up Firebase App Check (anti-abuse)
- CI/CD via GitHub Actions → `firebase deploy`

---

## Key Risks & Recommendations

| Risk | Recommendation |
|---|---|
| **Excel parsing** — GAS uses Sheets natively; Firebase has no spreadsheet engine | Use `exceljs` in Cloud Functions. Test against all known HRIS column variants |
| **PDF generation** — `HtmlService` + Drive PDF export is unavailable | Use `pdfkit` for simple layouts or `puppeteer` (via Cloud Run) for the BIR 2316 template |
| **Data migration** — all historical Sheets data must be imported | Write one-time migration scripts using the Google Sheets API → batch-write to Firestore |
| **Cosmos/Digits billing** — currently bound to Sheets menus | Refactor as callable Cloud Functions + file upload flow; same logic, different trigger |
| **Real-time updates** — GAS has none | Firestore `onSnapshot()` gives live updates across all tabs for free |
| **Offline support** — GAS has none | Firestore persistence can be enabled so the app works offline and syncs on reconnect |

---

## What Stays the Same

- All HTML/CSS structure (Tailwind classes, sidebar layout, modals, toast pattern) — copy-paste with minimal edits
- Chart.js, jsPDF, and Font Awesome — all CDN libraries remain unchanged
- Business logic for BIR computation, payroll accrual JE, and disbursement generation — ported 1:1 to Cloud Functions with no algorithm changes

> The UI is already close to a proper SPA. The main work is replacing every `google.script.run` call with a Firebase SDK call and moving all spreadsheet reads/writes to Firestore.

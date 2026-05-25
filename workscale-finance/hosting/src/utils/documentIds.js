// Centralized atomic document ID generation.
//
// Format:   {PREFIX}{YYYY?}{MM?}-{NNNN}
// Examples: PV202605-0001, CV2026-0007, DR-0042 (when year/month disabled)
//
// Atomicity: a Firestore transaction increments a counter document at
// `documentCounters/{periodKey}` so that concurrent saves never collide.
// The "month" component is taken from the supplied document date
// (preparationDate / issueDate / etc.), matching the GAS Project behavior.

import {
  doc,
  getDoc,
  runTransaction,
  serverTimestamp,
} from 'firebase/firestore';
import { db } from '../firebase.js';

const SETTINGS_TTL_MS = 30_000;
let _settingsCache = null;
let _settingsTs = 0;

const DEFAULT_SETTINGS = {
  includeYear:  true,
  includeMonth: true,
  vcPrefix:  'PV',
  cvPrefix:  'CV',
  drPrefix:  'DR',
  wpPrefix:  'WP',
  isPrefix:  'IS',
  bsPrefix:  'BS',
  colPrefix: 'COL',
  cntPrefix: 'CNT',
  jePrefix:  'JE',
  btPrefix:  'BT',
  psPrefix:  'PS',
  brPrefix:  'BREC',
  prPrefix:  'PR',
  fpPrefix:  'FP',
  lvPrefix:  'LV',
  chkPrefix: 'CHK',
};

export async function getDocIdSettings(force = false) {
  if (!force && _settingsCache && Date.now() - _settingsTs < SETTINGS_TTL_MS) {
    return _settingsCache;
  }
  try {
    const snap = await getDoc(doc(db, 'settings', 'modules'));
    const d = snap.exists() ? snap.data() : {};
    _settingsCache = {
      includeYear:  d.includeYear  !== false,
      includeMonth: d.includeMonth !== false,
      vcPrefix:  (d.vcPrefix  || DEFAULT_SETTINGS.vcPrefix).toString().trim()  || DEFAULT_SETTINGS.vcPrefix,
      cvPrefix:  (d.cvPrefix  || DEFAULT_SETTINGS.cvPrefix).toString().trim()  || DEFAULT_SETTINGS.cvPrefix,
      drPrefix:  (d.drPrefix  || DEFAULT_SETTINGS.drPrefix).toString().trim()  || DEFAULT_SETTINGS.drPrefix,
      wpPrefix:  (d.wpPrefix  || DEFAULT_SETTINGS.wpPrefix).toString().trim()  || DEFAULT_SETTINGS.wpPrefix,
      isPrefix:  (d.isPrefix  || DEFAULT_SETTINGS.isPrefix).toString().trim()  || DEFAULT_SETTINGS.isPrefix,
      bsPrefix:  (d.bsPrefix  || DEFAULT_SETTINGS.bsPrefix).toString().trim()  || DEFAULT_SETTINGS.bsPrefix,
      colPrefix: (d.colPrefix || DEFAULT_SETTINGS.colPrefix).toString().trim() || DEFAULT_SETTINGS.colPrefix,
      cntPrefix: (d.cntPrefix || DEFAULT_SETTINGS.cntPrefix).toString().trim() || DEFAULT_SETTINGS.cntPrefix,
      jePrefix:  (d.jePrefix  || DEFAULT_SETTINGS.jePrefix).toString().trim()  || DEFAULT_SETTINGS.jePrefix,
      btPrefix:  (d.btPrefix  || DEFAULT_SETTINGS.btPrefix).toString().trim()  || DEFAULT_SETTINGS.btPrefix,
      psPrefix:  (d.psPrefix  || DEFAULT_SETTINGS.psPrefix).toString().trim()  || DEFAULT_SETTINGS.psPrefix,
      brPrefix:  (d.brPrefix  || DEFAULT_SETTINGS.brPrefix).toString().trim()  || DEFAULT_SETTINGS.brPrefix,
      prPrefix:  (d.prPrefix  || DEFAULT_SETTINGS.prPrefix).toString().trim()  || DEFAULT_SETTINGS.prPrefix,
      fpPrefix:  (d.fpPrefix  || DEFAULT_SETTINGS.fpPrefix).toString().trim()  || DEFAULT_SETTINGS.fpPrefix,
      lvPrefix:  (d.lvPrefix  || DEFAULT_SETTINGS.lvPrefix).toString().trim()  || DEFAULT_SETTINGS.lvPrefix,
      chkPrefix: (d.chkPrefix || DEFAULT_SETTINGS.chkPrefix).toString().trim() || DEFAULT_SETTINGS.chkPrefix,
    };
    _settingsTs = Date.now();
  } catch (e) {
    console.warn('[documentIds] failed to load settings, using defaults:', e?.message);
    _settingsCache = { ...DEFAULT_SETTINGS };
    _settingsTs = Date.now();
  }
  return _settingsCache;
}

// Allow Settings page to bust the cache after Save.
export function invalidateDocIdSettings() {
  _settingsCache = null;
  _settingsTs = 0;
}

function periodKeyFor(prefix, date, settings) {
  const d = date ? new Date(date) : new Date();
  // Guard against invalid dates → fall back to today.
  const safe = isNaN(d.getTime()) ? new Date() : d;
  let key = String(prefix || '').toUpperCase();
  if (settings.includeYear)  key += String(safe.getFullYear());
  if (settings.includeMonth) key += String(safe.getMonth() + 1).padStart(2, '0');
  return key;
}

// Sync helper so forms can show a placeholder before the user saves.
// Returns e.g. "PV202605-####" — the actual sequence is assigned atomically
// at save time by `nextDocumentId`.
export async function previewDocumentId(prefix, date) {
  const settings = await getDocIdSettings();
  return `${periodKeyFor(prefix, date, settings)}-####`;
}

// Atomically reserve and return the next document ID for the given prefix
// and document date. Safe under concurrent writes from multiple users.
export async function nextDocumentId(prefix, date) {
  const settings  = await getDocIdSettings();
  const periodKey = periodKeyFor(prefix, date, settings);
  const counterRef = doc(db, 'documentCounters', periodKey);

  const seq = await runTransaction(db, async (tx) => {
    const snap = await tx.get(counterRef);
    const cur  = snap.exists() ? Number(snap.data().seq || 0) : 0;
    const next = cur + 1;
    tx.set(counterRef, {
      prefix:    String(prefix || '').toUpperCase(),
      periodKey,
      seq:       next,
      updatedAt: serverTimestamp(),
    }, { merge: true });
    return next;
  });

  return `${periodKey}-${String(seq).padStart(4, '0')}`;
}

// Convenience helpers tied to specific document kinds. Each accepts the
// document's own date so the period component reflects the prepared date,
// not "today".
function voucherPrefixFor(voucherType, s) {
  return voucherType === 'PAYROLL'   ? s.prPrefix :
         voucherType === 'FINAL_PAY' ? s.fpPrefix :
         voucherType === 'LOAN'      ? s.lvPrefix :
         s.vcPrefix; // PAYMENT and any default
}

export async function nextVoucherId(voucherType, date) {
  const s = await getDocIdSettings();
  return nextDocumentId(voucherPrefixFor(voucherType, s), date);
}

export async function previewVoucherId(voucherType, date) {
  const s = await getDocIdSettings();
  return previewDocumentId(voucherPrefixFor(voucherType, s), date);
}

export async function nextCheckVoucherId(date) {
  const s = await getDocIdSettings();
  return nextDocumentId(s.cvPrefix, date);
}

export async function nextDisbursementReportId(date) {
  const s = await getDocIdSettings();
  return nextDocumentId(s.drPrefix, date);
}

export async function nextServiceInvoiceId(date) {
  const s = await getDocIdSettings();
  return nextDocumentId(s.isPrefix, date);
}

export async function nextBillingStatementId(date) {
  const s = await getDocIdSettings();
  return nextDocumentId(s.bsPrefix, date);
}

export async function nextCollectionId(date) {
  const s = await getDocIdSettings();
  return nextDocumentId(s.colPrefix, date);
}

export async function nextWeeklyProjectionId(date) {
  const s = await getDocIdSettings();
  return nextDocumentId(s.wpPrefix, date);
}

export async function nextContactId(date) {
  const s = await getDocIdSettings();
  return nextDocumentId(s.cntPrefix, date);
}

export async function nextJournalEntryId(date) {
  const s = await getDocIdSettings();
  return nextDocumentId(s.jePrefix, date);
}

// Accrual JE IDs are globally sequential (no year/month period), always ACJE-NNNN.
export async function nextAccrualJEId() {
  const counterRef = doc(db, 'documentCounters', 'ACJE');
  const seq = await runTransaction(db, async (tx) => {
    const snap = await tx.get(counterRef);
    const cur  = snap.exists() ? Number(snap.data().seq || 0) : 0;
    const next = cur + 1;
    tx.set(counterRef, { prefix: 'ACJE', periodKey: 'ACJE', seq: next, updatedAt: serverTimestamp() }, { merge: true });
    return next;
  });
  return `ACJE-${String(seq).padStart(4, '0')}`;
}

export async function nextBankTransactionId(date) {
  const s = await getDocIdSettings();
  return nextDocumentId(s.btPrefix, date);
}

export async function nextPaymentScheduleId(date) {
  const s = await getDocIdSettings();
  return nextDocumentId(s.psPrefix, date);
}

export async function nextBankReconciliationId(date) {
  const s = await getDocIdSettings();
  return nextDocumentId(s.brPrefix, date);
}

export async function nextCheckId(date) {
  const s = await getDocIdSettings();
  return nextDocumentId(s.chkPrefix, date);
}

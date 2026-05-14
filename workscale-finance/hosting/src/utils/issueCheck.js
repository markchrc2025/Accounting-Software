// Shared helper for issuing a check from the active checkbook.
// Used by Check Registry, Loan Payments (Financial Mgmt),
// Fixed Assets installment payments, and Payment Schedule.
//
// Writes a `checkRegister` doc and atomically advances the
// active `checkbookMaster` doc's nextCheckNumber for the bank.

import {
  collection, doc, getDocs, query, where,
  serverTimestamp, runTransaction,
} from 'firebase/firestore';
import { db } from '../firebase.js';

const today = () => new Date().toISOString().slice(0, 10);

function genCheckId(checkNumber, dateStr) {
  const d = dateStr ? new Date(dateStr) : new Date();
  const yyyy = d.getFullYear();
  const mm   = String(d.getMonth() + 1).padStart(2, '0');
  const dd   = String(d.getDate()).padStart(2, '0');
  return `CHK-${yyyy}${mm}${dd}-${checkNumber}`;
}

/**
 * Find the active checkbook for a given bank account code/id.
 * Returns null if none.
 */
export async function getActiveCheckbook(bankCode) {
  if (!bankCode) return null;
  const snap = await getDocs(query(collection(db, 'checkbookMaster'), where('bankCode', '==', bankCode)));
  const active = snap.docs.map(d => ({ id: d.id, ...d.data() })).find(cb => cb.isActive !== false);
  return active || null;
}

/**
 * Issue a check atomically:
 *   - validates checkbook range
 *   - writes a `checkRegister` document
 *   - advances `checkbookMaster.nextCheckNumber`
 *
 * @param {object} opts
 * @param {string} opts.bankCode        Bank account code (required)
 * @param {string} opts.payeeName       Payee display string (required)
 * @param {number} opts.amount          Gross check amount (required)
 * @param {number} [opts.netAmount]     Net cash amount (defaults to amount)
 * @param {string} [opts.issueDate]     ISO date (defaults to today)
 * @param {string} [opts.checkNumber]   Override; otherwise uses checkbook's next
 * @param {string} [opts.checkDate]     ISO date on the check (defaults to issueDate)
 * @param {string} [opts.payeeContactId]
 * @param {string} [opts.referenceType] e.g. 'Loan Payment', 'Installment', 'Schedule', 'Check Voucher'
 * @param {string} [opts.referenceId]   Source document id (loan id, asset id, schedule id, voucher id)
 * @param {string} [opts.voucherDocId]  Linked voucher doc id (so Cleared/Voided can update it)
 * @param {string} [opts.notes]
 * @param {string} [opts.user]          Email of issuer
 * @returns {Promise<{ checkId, checkNumber, checkbookId, checkRegisterId }>}
 */
export async function issueCheck(opts) {
  const {
    bankCode, payeeName, amount,
    netAmount, issueDate, checkNumber, checkDate,
    payeeContactId = '', referenceType = '', referenceId = '',
    voucherDocId = '', notes = '', user = '',
  } = opts;

  if (!bankCode)  throw new Error('Bank account is required to issue a check.');
  if (!payeeName) throw new Error('Payee name is required.');
  if (!(amount > 0)) throw new Error('Check amount must be greater than zero.');

  const cb = await getActiveCheckbook(bankCode);
  if (!cb) throw new Error('No active checkbook found for this bank. Open Check Registry → Checkbook Management to add one.');

  const start = parseInt(cb.startingNumber) || 0;
  const end   = parseInt(cb.endingNumber)   || 0;
  const next  = parseInt(cb.nextCheckNumber) || start;
  const padLen = String(end || start || '0').length;

  const assigned = checkNumber
    ? (parseInt(String(checkNumber).replace(/\D/g, '')) || next)
    : next;

  if (assigned > end) {
    throw new Error(`Checkbook exhausted (range ${cb.startingNumber}–${cb.endingNumber}). Add a new checkbook for this bank.`);
  }

  const issDate = issueDate || today();
  const chkDate = checkDate || issDate;
  const checkIdStr = genCheckId(assigned, issDate);

  const cbRef     = doc(db, 'checkbookMaster', cb.id);
  const regRef    = doc(collection(db, 'checkRegister'));

  await runTransaction(db, async (tx) => {
    const cbSnap = await tx.get(cbRef);
    if (!cbSnap.exists()) throw new Error('Checkbook no longer exists.');
    const live = cbSnap.data();
    const liveNext = parseInt(live.nextCheckNumber) || (parseInt(live.startingNumber) || 0);
    const liveEnd  = parseInt(live.endingNumber)    || 0;

    // If caller supplied a specific checkNumber that's already past, keep it,
    // but never let nextCheckNumber go backward.
    const newNext = Math.max(liveNext, assigned + 1);
    if (newNext > liveEnd + 1) throw new Error('Checkbook exhausted.');

    tx.set(regRef, {
      checkId: checkIdStr,
      checkbookId: cb.id,
      bankCode,
      checkNumber: String(assigned).padStart(padLen, '0'),
      issueDate: issDate,
      checkDate: chkDate,
      payeeContactId,
      payeeName,
      amount: Number(amount) || 0,
      netAmount: Number(netAmount ?? amount) || 0,
      status: 'Issued',
      referenceType,
      referenceId,
      voucherDocId,
      voidReason: '', clearedDate: '', voidedDate: '', stoppedDate: '', staleDate: '',
      notes,
      createdAt: serverTimestamp(), createdBy: user,
      updatedAt: serverTimestamp(), updatedBy: user,
    });

    tx.update(cbRef, {
      nextCheckNumber: String(newNext).padStart(padLen, '0'),
      updatedAt: serverTimestamp(),
      updatedBy: user,
    });
  });

  return {
    checkId:         checkIdStr,
    checkNumber:     String(assigned).padStart(padLen, '0'),
    checkbookId:     cb.id,
    checkRegisterId: regRef.id,
  };
}

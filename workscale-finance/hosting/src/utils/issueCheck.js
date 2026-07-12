// Shared helper for issuing a check from the active checkbook.
// Used by Payment Schedule (and, as they migrate, Loan Payments and Fixed
// Assets installment payments).
//
// Writes a check-registry row via the API and advances the active checkbook's
// nextCheckNumber, so Check Register & Checkbook Inventory stay authoritative.
// (Same client-orchestrated create + advance pattern as the Check Registry
// screen; the server stamps the actor from the session.)

import { listCheckbooks, createChecks, updateCheckbook } from '../lib/api.js';

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
  const books = await listCheckbooks();
  return books.find(cb => cb.bankCode === bankCode && cb.isActive !== false) || null;
}

/**
 * Issue a check:
 *   - validates checkbook range
 *   - creates a check-registry row (status defaults to Issued)
 *   - advances the checkbook's nextCheckNumber
 *
 * @param {object} opts
 * @param {string} opts.bankCode        Bank account code (required)
 * @param {string} opts.payeeName       Payee display string (required)
 * @param {number} opts.amount          Gross check amount in pesos (required)
 * @param {number} [opts.netAmount]     Net cash amount (defaults to amount)
 * @param {string} [opts.issueDate]     ISO date (defaults to today)
 * @param {string} [opts.checkNumber]   Override; otherwise uses checkbook's next
 * @param {string} [opts.checkDate]     ISO date on the check (defaults to issueDate)
 * @param {string} [opts.payeeContactId]
 * @param {string} [opts.referenceType] e.g. 'Loan Payment', 'Installment', 'Scheduled Payment'
 * @param {string} [opts.referenceId]   Source document id (loan id, asset id, schedule id)
 * @param {string} [opts.voucherDocId]  Linked voucher uuid (so Cleared/Voided can update it)
 * @param {string} [opts.notes]
 * @returns {Promise<{ checkId, checkNumber, checkbookId, checkRegisterId }>}
 */
export async function issueCheck(opts) {
  const {
    bankCode, payeeName, amount,
    netAmount, issueDate, checkNumber, checkDate,
    payeeContactId = '', referenceType = '', referenceId = '',
    voucherDocId = '', notes = '',
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

  // If caller supplied a specific checkNumber that's already past, keep it,
  // but never let nextCheckNumber go backward.
  const newNext = Math.max(next, assigned + 1);
  if (newNext > end + 1) throw new Error('Checkbook exhausted.');

  const issDate = issueDate || today();
  const chkDate = checkDate || issDate;
  const checkIdStr = genCheckId(assigned, issDate);
  const paddedNo = String(assigned).padStart(padLen, '0');

  const created = await createChecks([{
    checkNo: checkIdStr,
    checkbookId: cb.id,
    bankCode,
    checkNumber: paddedNo,
    issueDate: issDate,
    checkDate: chkDate,
    payeeName,
    amountCents: Math.round((Number(amount) || 0) * 100),
    netAmountCents: Math.round((Number(netAmount ?? amount) || 0) * 100),
    referenceType: referenceType || null,
    referenceId: referenceId || null,
    voucherId: voucherDocId && String(voucherDocId).length === 36 ? voucherDocId : null,
    notes: notes || null,
    meta: payeeContactId ? { payeeContactId } : null,
  }]);

  await updateCheckbook(cb.id, { nextCheckNumber: String(newNext).padStart(padLen, '0') });

  return {
    checkId:         checkIdStr,
    checkNumber:     paddedNo,
    checkbookId:     cb.id,
    checkRegisterId: created?.[0]?.id || '',
  };
}

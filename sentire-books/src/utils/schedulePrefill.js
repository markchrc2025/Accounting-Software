/**
 * Handoff utility — Payment Schedule → Voucher / Check Voucher.
 *
 * The Schedule page stashes a prefill payload in sessionStorage and
 * navigates to /vouchers or /checks. The target
 * page consumes the payload exactly once on mount and auto-opens its
 * "New" modal pre-populated.
 *
 * Shape:
 *   {
 *     target: 'voucher' | 'check',
 *     voucherType: 'PAYMENT'|'LOAN',     // for voucher target
 *     scheduleId, scheduleTitle, scheduleSource,  // 'manual'|'loan'|'asset'
 *     occurrenceDate,                    // YYYY-MM-DD
 *     contactId, contactName,
 *     amount, expenseAccountCode, taxRateId,
 *     bankCode, purposeCategory, notes,
 *     loanId,                            // for LOAN voucher
 *   }
 */

const KEY = 'wsf:schedulePrefill';

export function setSchedulePrefill(payload) {
  try {
    sessionStorage.setItem(KEY, JSON.stringify({ ...payload, _stamp: Date.now() }));
  } catch { /* ignore */ }
}

/** Consume (read + clear) the pending prefill payload, if any. */
export function consumeSchedulePrefill(target) {
  try {
    const raw = sessionStorage.getItem(KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (target && data.target !== target) return null;
    // Expire after 30s so a stale entry doesn't surprise the user.
    if (Date.now() - (data._stamp || 0) > 30_000) {
      sessionStorage.removeItem(KEY);
      return null;
    }
    sessionStorage.removeItem(KEY);
    return data;
  } catch {
    return null;
  }
}

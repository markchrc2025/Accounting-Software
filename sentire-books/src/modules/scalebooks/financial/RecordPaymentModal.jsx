import { useState, useEffect } from 'react';
import { payLoan, ApiError } from '../../../lib/api.js';

const fmtPHP = (n) => new Intl.NumberFormat('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n || 0);
const fmtCur = (n) => '₱' + fmtPHP(n);

const PAYMENT_METHODS = ['Check', 'Auto-Debit', 'Bank Transfer', 'Cash', 'Online'];

/**
 * Record a loan payment. FM is the source of truth: it ORIGINATES the
 * disbursement instrument and links it to the payment (POST /loans/:id/pay).
 *   • Bank Transfer / Cash / Online → Payment Voucher (JE posts at approval)
 *   • Auto-Debit                    → Payment Voucher tagged Auto-Debit
 *   • Check (PDC)                   → Check Voucher + Check Registry entry
 *                                     (JE posts when the check clears)
 * Every instrument carries DR Loans Payable (principal) + DR Finance Cost
 * (interest + penalty), crediting cash for the total. The loan's liability /
 * finance-cost / cash accounts (set when booking, in the GL Accounts section)
 * drive the entry; the cash account can be overridden per payment below.
 */
export default function RecordPaymentModal({ loan, loanState, bankAccounts = [], onClose, onSaved }) {
  const today = new Date().toISOString().slice(0, 10);
  const nextRow    = loanState?.schedule?.find(r => r.status !== 'paid');
  const nextDueInt = nextRow ? Math.max(0, nextRow.scheduledInterest  - nextRow.paidInterest)  : 0;
  const nextDuePri = nextRow ? Math.max(0, nextRow.scheduledPrincipal - nextRow.paidPrincipal) : 0;

  const defaultCash = loan.cashAccountCode || (bankAccounts[0]?.code || '');

  const [form, setForm] = useState({
    date: today,
    interest: nextDueInt ? nextDueInt.toFixed(2) : '',
    principal: nextDuePri ? nextDuePri.toFixed(2) : '',
    penalty: '',
    method: loan.paymentMethod || 'Bank Transfer',
    cashCode: defaultCash,
    referenceNo: '',
    checkNumber: '',
    checkDate: today,
    bank: loan.pmBtBank || loan.pmAdaBank || '',
    notes: nextRow ? `Payment for ${nextRow.label} (Period ${nextRow.period})` : '',
    appliedPeriod: nextRow ? nextRow.period : null,
  });
  const [saving, setSaving] = useState(false);
  const [error,  setError]  = useState('');

  useEffect(() => { setError(''); }, [form]);

  const total    = (Number(form.interest) || 0) + (Number(form.principal) || 0) + (Number(form.penalty) || 0);
  const setField = (k, v) => setForm(f => ({ ...f, [k]: v }));
  const isCheck  = form.method === 'Check';
  const cashLabel = (bankAccounts.find(a => a.code === form.cashCode)?.name) || form.cashCode || 'Cash';

  // Loan must carry a liability account before a payment can post to the ledger.
  const liabilitySet = !!loan.liabilityAccountCode;

  const fillNextDue = () => {
    if (!nextRow) return;
    setForm(f => ({
      ...f,
      interest:      nextDueInt.toFixed(2),
      principal:     nextDuePri.toFixed(2),
      appliedPeriod: nextRow.period,
      notes:         `Payment for ${nextRow.label} (Period ${nextRow.period})`,
    }));
  };

  // ── Save — originate the instrument + record the payment ────────────────────
  const handleSave = async () => {
    if (!form.date)         { setError('Payment date is required.'); return; }
    if (total <= 0)         { setError('Enter at least one of Interest / Principal / Penalty.'); return; }
    if (!liabilitySet)      { setError("Set this loan's Liability account first — open the loan and use the GL Accounts section (or Book it)."); return; }
    if (!form.cashCode)     { setError('Choose the cash / bank account this payment is drawn from.'); return; }
    if (isCheck && !form.checkNumber.trim()) { setError('Check number is required for a post-dated check.'); return; }
    setSaving(true);
    try {
      const res = await payLoan(loan.id, {
        payDate:        form.date,
        method:         form.method,
        interestCents:  Math.round((Number(form.interest)  || 0) * 100),
        principalCents: Math.round((Number(form.principal) || 0) * 100),
        penaltyCents:   Math.round((Number(form.penalty)   || 0) * 100),
        cashAccountCode: form.cashCode || undefined,
        bank:           form.bank || undefined,
        referenceNo:    (isCheck ? form.checkNumber : form.referenceNo) || undefined,
        checkNumber:    isCheck ? form.checkNumber : undefined,
        checkDate:      isCheck ? form.checkDate : undefined,
        payeeName:      loan.name || undefined,
        notes:          form.notes || undefined,
        allocations:    form.appliedPeriod
          ? [{ period: form.appliedPeriod, interest: Number(form.interest) || 0, principal: Number(form.principal) || 0, penalty: Number(form.penalty) || 0 }]
          : undefined,
      });
      onSaved && onSaved(res);
      onClose();
    } catch (e) {
      setError((e instanceof ApiError ? e.detail : e.message) || 'Failed to save.');
    } finally {
      setSaving(false);
    }
  };

  // ── Styles ────────────────────────────────────────────────────────────────
  const inpS = {
    border: '1px solid #e5e7eb', borderRadius: 8, padding: '8px 10px',
    fontSize: 13, width: '100%', boxSizing: 'border-box', fontFamily: 'inherit', background: '#fff',
  };
  const lblS = {
    fontSize: 10, fontWeight: 800, color: '#64748b',
    letterSpacing: '.06em', textTransform: 'uppercase',
  };

  const preview = isCheck
    ? `Creates a Check Voucher + registers the check (Issued). The journal entry posts when the check clears: DR Loans Payable + DR Finance Cost / CR ${cashLabel}.`
    : `Creates a Payment Voucher${form.method === 'Auto-Debit' ? ' tagged Auto-Debit' : ''}. Posts on approval: DR Loans Payable + DR Finance Cost / CR ${cashLabel}.`;

  return (
    <div
      style={{
        position: 'fixed', inset: 0, background: 'rgba(15,23,42,.45)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16, zIndex: 200,
      }}
      onClick={e => e.target === e.currentTarget && onClose()}
    >
      <div style={{
        width: 'min(660px,98vw)', maxHeight: '92vh', background: '#fff',
        borderRadius: 16, display: 'flex', flexDirection: 'column',
        overflow: 'hidden', boxShadow: '0 24px 64px rgba(0,0,0,.25)',
      }}>

        {/* Header */}
        <div style={{ background: '#f97316', color: '#fff', padding: '16px 20px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <strong style={{ fontSize: 16, fontWeight: 900 }}>💰 Record Loan Payment</strong>
            <button onClick={onClose} style={{
              background: 'rgba(255,255,255,.25)', border: 'none', color: '#fff',
              borderRadius: 8, width: 28, height: 28, cursor: 'pointer', fontSize: 14, fontWeight: 900,
            }}>✕</button>
          </div>
          <div style={{ fontSize: 12, opacity: .9, marginTop: 4, fontWeight: 600 }}>
            {loan.name || `Loan ${loan.id}`} · {loan.loanType || 'Term Loan'} · Outstanding {fmtCur(loanState?.outstandingPrincipal || 0)}
          </div>
        </div>

        {/* Body */}
        <div style={{ padding: '18px 20px', overflowY: 'auto', flex: 1 }}>

          {/* GL accounts guard */}
          {!liabilitySet && (
            <div style={{
              marginBottom: 14, padding: '10px 14px', borderRadius: 10,
              background: '#fef2f2', border: '1px solid #fecaca', borderLeft: '4px solid #dc2626',
              color: '#991b1b', fontSize: 12, lineHeight: 1.5,
            }}>
              This loan has no <strong>Liability account</strong> set, so a payment can’t post to the ledger.
              Open the loan and set its GL accounts (or <strong>Book</strong> it) first.
            </div>
          )}

          {/* Next due summary */}
          {nextRow && (
            <div style={{
              background: '#fff7ed', border: '1px solid #fed7aa', borderRadius: 10,
              padding: '10px 14px', marginBottom: 14, display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap',
            }}>
              <div style={{ flex: 1, minWidth: 200 }}>
                <div style={{ fontSize: 10, fontWeight: 800, color: '#9a3412', letterSpacing: '.05em', textTransform: 'uppercase' }}>
                  Next Due — {nextRow.label} (Period {nextRow.period})
                </div>
                <div style={{ fontSize: 12, color: '#7c2d12', marginTop: 3 }}>
                  Due {nextRow.dueDate} ·
                  Int <strong>{fmtCur(nextDueInt)}</strong> ·
                  Pri <strong>{fmtCur(nextDuePri)}</strong> ·
                  Total <strong>{fmtCur(nextDueInt + nextDuePri)}</strong>
                </div>
              </div>
              <button
                onClick={fillNextDue}
                style={{ background: '#f97316', color: '#fff', border: 'none', borderRadius: 8, padding: '6px 12px', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}
              >Fill Next Due</button>
            </div>
          )}

          {/* Row 1: date / method */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2,1fr)', gap: 12, marginBottom: 12 }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
              <label style={lblS}>Payment Date</label>
              <input type="date" style={inpS} value={form.date} onChange={e => setField('date', e.target.value)} />
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
              <label style={lblS}>Method</label>
              <select style={inpS} value={form.method} onChange={e => setField('method', e.target.value)}>
                {PAYMENT_METHODS.map(m => <option key={m}>{m}</option>)}
              </select>
            </div>
          </div>

          {/* Row 2: cash account / bank memo */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2,1fr)', gap: 12, marginBottom: 12 }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
              <label style={lblS}>Paid From (Cash / Bank Account)</label>
              <select style={inpS} value={form.cashCode} onChange={e => setField('cashCode', e.target.value)}>
                <option value="">— Select account —</option>
                {bankAccounts.map(a => <option key={a.id || a.code} value={a.code}>{a.code} · {a.name}</option>)}
              </select>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
              <label style={lblS}>Bank memo (optional)</label>
              <input style={inpS} value={form.bank} onChange={e => setField('bank', e.target.value)} placeholder="e.g. BDO 1234" />
            </div>
          </div>

          {/* Row 3: interest / principal / penalty */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 12, marginBottom: 12 }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
              <label style={lblS}>Interest ₱</label>
              <input type="number" step="0.01" style={{ ...inpS, textAlign: 'right' }}
                value={form.interest} onChange={e => setField('interest', e.target.value)} />
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
              <label style={lblS}>Principal ₱</label>
              <input type="number" step="0.01" style={{ ...inpS, textAlign: 'right' }}
                value={form.principal} onChange={e => setField('principal', e.target.value)} />
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
              <label style={lblS}>Penalty ₱</label>
              <input type="number" step="0.01" style={{ ...inpS, textAlign: 'right' }}
                value={form.penalty} onChange={e => setField('penalty', e.target.value)} />
            </div>
          </div>

          {/* Row 4: check specifics (PDC) or reference */}
          {isCheck ? (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2,1fr)', gap: 12, marginBottom: 12 }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                <label style={lblS}>Check No.</label>
                <input style={inpS} value={form.checkNumber} onChange={e => setField('checkNumber', e.target.value)} placeholder="Check #" />
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                <label style={lblS}>Check Date (maturity)</label>
                <input type="date" style={inpS} value={form.checkDate} onChange={e => setField('checkDate', e.target.value)} />
              </div>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 5, marginBottom: 12 }}>
              <label style={lblS}>Reference No. (optional)</label>
              <input style={inpS} value={form.referenceNo} onChange={e => setField('referenceNo', e.target.value)} placeholder="Txn No." />
            </div>
          )}

          {/* Notes */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 5, marginBottom: 8 }}>
            <label style={lblS}>Notes</label>
            <input style={inpS} value={form.notes} onChange={e => setField('notes', e.target.value)} />
          </div>

          {/* What will happen */}
          <div style={{
            marginTop: 6, padding: '10px 14px', borderRadius: 10,
            background: '#eff6ff', border: '1px solid #bfdbfe', color: '#1e40af', fontSize: 11.5, lineHeight: 1.5,
          }}>
            <span style={{ fontWeight: 800 }}>What happens:</span> {preview} It goes through the normal approval / disbursement review — nothing hits the ledger until then.
          </div>

          {/* Total */}
          <div style={{
            marginTop: 12, padding: '12px 16px', borderRadius: 12,
            background: '#0f172a', color: '#fff', display: 'flex',
            alignItems: 'center', justifyContent: 'space-between',
          }}>
            <span style={{ fontSize: 11, fontWeight: 800, color: '#94a3b8', letterSpacing: '.06em' }}>TOTAL PAYMENT</span>
            <strong style={{ fontSize: 20, fontWeight: 900 }}>{fmtCur(total)}</strong>
          </div>

          {error && (
            <div style={{
              marginTop: 12, padding: '9px 12px', borderRadius: 8,
              background: '#fef2f2', border: '1px solid #fecaca', color: '#b91c1c', fontSize: 12, fontWeight: 600,
            }}>{error}</div>
          )}
        </div>

        {/* Footer */}
        <div style={{
          display: 'flex', justifyContent: 'flex-end', gap: 10,
          padding: '14px 20px', borderTop: '1px solid #e5e7eb', background: '#f8fafc',
        }}>
          <button
            onClick={onClose}
            disabled={saving}
            style={{
              border: 0, borderRadius: 10, padding: '9px 16px', fontWeight: 700, fontSize: 13,
              background: '#f1f5f9', color: '#0b1220', cursor: 'pointer', fontFamily: 'inherit',
            }}
          >Cancel</button>
          <button
            onClick={handleSave}
            disabled={saving || total <= 0 || !liabilitySet}
            style={{
              border: 0, borderRadius: 10, padding: '9px 18px', fontWeight: 800, fontSize: 13,
              background: '#f97316', color: '#fff', fontFamily: 'inherit',
              cursor: (saving || total <= 0 || !liabilitySet) ? 'not-allowed' : 'pointer',
              opacity: (saving || total <= 0 || !liabilitySet) ? .5 : 1,
            }}
          >{saving ? 'Saving…' : 'Record Payment'}</button>
        </div>
      </div>
    </div>
  );
}

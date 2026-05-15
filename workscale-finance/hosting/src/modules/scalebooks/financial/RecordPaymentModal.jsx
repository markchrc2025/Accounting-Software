import { useState, useEffect } from 'react';
import { collection, addDoc, getDocs, serverTimestamp } from 'firebase/firestore';
import { db, auth } from '../../../firebase.js';
import { nextVoucherId } from '../../../utils/documentIds.js';
import { issueCheck, getActiveCheckbook } from '../../../utils/issueCheck.js';

const fmtPHP = (n) => new Intl.NumberFormat('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n || 0);
const fmtCur = (n) => '₱' + fmtPHP(n);

const PAYMENT_METHODS = ['Check', 'Auto-Debit', 'Bank Transfer', 'Cash', 'Online'];

/**
 * Modal to record an actual loan payment against a loan.
 * Writes a single document to `loanPayments` collection.
 *
 * Props:
 *   loan          — the loan object
 *   loanState     — output of recomputeLoanState(loan, payments)
 *   onClose()
 *   onSaved(payment)  — called after successful Firestore write
 */
export default function RecordPaymentModal({ loan, loanState, onClose, onSaved }) {
  const today = new Date().toISOString().slice(0, 10);
  const nextRow = loanState?.schedule?.find(r => r.status !== 'paid');
  const nextDueInt = nextRow ? Math.max(0, nextRow.scheduledInterest  - nextRow.paidInterest)  : 0;
  const nextDuePri = nextRow ? Math.max(0, nextRow.scheduledPrincipal - nextRow.paidPrincipal) : 0;

  const [form, setForm] = useState({
    date: today,
    interest: nextDueInt ? nextDueInt.toFixed(2) : '',
    principal: nextDuePri ? nextDuePri.toFixed(2) : '',
    penalty: '',
    method: loan.paymentMethod || 'Check',
    referenceNo: '',
    bank: loan.pmBtBank || loan.pmAdaBank || '',
    voucherId: '',
    autoVoucher: true,
    notes: nextRow ? `Payment for ${nextRow.label} (Period ${nextRow.period})` : '',
    appliedPeriod: nextRow ? nextRow.period : null,
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [bankAccounts, setBankAccounts] = useState([]);
  const [activeCb,     setActiveCb]     = useState(null);

  // Load bank/cash accounts for the bank dropdown
  useEffect(() => {
    (async () => {
      try {
        const snap = await getDocs(collection(db, 'coaAccounts'));
        const banks = snap.docs.map(d => ({ id:d.id, ...d.data() }))
          .filter(a => /cash|bank/i.test(a.parentName || a.category || a.name || ''));
        setBankAccounts(banks);
      } catch { /* ignore */ }
    })();
  }, []);

  // Whenever bank changes (and method is Check), look up active checkbook
  useEffect(() => {
    if (form.method !== 'Check' || !form.bank) { setActiveCb(null); return; }
    let cancel = false;
    getActiveCheckbook(form.bank).then(cb => { if (!cancel) setActiveCb(cb); }).catch(() => setActiveCb(null));
    return () => { cancel = true; };
  }, [form.bank, form.method]);

  // Auto-fill ref no with next check # when applicable
  useEffect(() => {
    if (form.method === 'Check' && activeCb && !form.referenceNo) {
      setForm(f => ({ ...f, referenceNo: String(activeCb.nextCheckNumber || '') }));
    }
  }, [activeCb, form.method]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { setError(''); }, [form]);

  const total = (Number(form.interest) || 0) + (Number(form.principal) || 0) + (Number(form.penalty) || 0);

  const setField = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const fillNextDue = () => {
    if (!nextRow) return;
    setForm(f => ({
      ...f,
      interest: nextDueInt.toFixed(2),
      principal: nextDuePri.toFixed(2),
      appliedPeriod: nextRow.period,
      notes: `Payment for ${nextRow.label} (Period ${nextRow.period})`,
    }));
  };

  const handleSave = async () => {
    if (!form.date) { setError('Payment date is required.'); return; }
    if (total <= 0) { setError('Enter at least one of Interest / Principal / Penalty.'); return; }
    if (form.method === 'Check' && !form.bank) { setError('Select a bank account to issue the check.'); return; }
    if (form.method === 'Check' && !activeCb)  { setError('No active checkbook for this bank. Open Check Registry → Checkbook Management.'); return; }
    setSaving(true);
    try {
      const user = auth.currentUser?.email || '';
      const loanLabel = loan.name || `Loan ${loan.id}`;

      // --- Auto-create Loan Voucher ---
      let finalVoucherId = form.voucherId || '';
      let voucherDocId   = '';
      if (form.autoVoucher) {
        const vLines = [];
        let lineNo = 1;
        if (Number(form.interest) > 0) {
          vLines.push({ lineNo: lineNo++, description: `Interest — ${loanLabel}`, amount: Number(form.interest) || 0, category: 'Finance Cost', expenseAccountCode: '', contactId: '', contact: loanLabel, taxType: 'N/A', taxRate: 0, taxAmt: 0 });
        }
        if (Number(form.principal) > 0) {
          vLines.push({ lineNo: lineNo++, description: `Principal — ${loanLabel}`, amount: Number(form.principal) || 0, category: 'Loans Payable', expenseAccountCode: '', contactId: '', contact: loanLabel, taxType: 'N/A', taxRate: 0, taxAmt: 0 });
        }
        if (Number(form.penalty) > 0) {
          vLines.push({ lineNo: lineNo++, description: `Penalty — ${loanLabel}`, amount: Number(form.penalty) || 0, category: 'Finance Cost', expenseAccountCode: '', contactId: '', contact: loanLabel, taxType: 'N/A', taxRate: 0, taxAmt: 0 });
        }
        const vId = await nextVoucherId('LOAN', form.date);
        const vRef = await addDoc(collection(db, 'vouchers'), {
          voucherId:              vId,
          voucherType:            'LOAN',
          preparationDate:        form.date,
          purposeCategory:        'Loan Payment',
          paymentFromAccountCode: form.bank || '',
          contactSummary:         loanLabel,
          totalAmount:            total,
          status:                 'Pending',
          notes:                  form.notes || '',
          loanId:                 loan.id,
          lines:                  vLines,
          createdAt:              serverTimestamp(),
          createdBy:              user,
          updatedAt:              serverTimestamp(),
          updatedBy:              user,
        });
        finalVoucherId = vId;
        voucherDocId   = vRef.id;
      }

      // --- Issue check from active checkbook ---
      let checkInfo = null;
      if (form.method === 'Check' && activeCb) {
        checkInfo = await issueCheck({
          bankCode:      form.bank,
          payeeName:     loanLabel,
          amount:        total,
          netAmount:     total,
          issueDate:     form.date,
          checkNumber:   form.referenceNo || undefined,
          referenceType: 'Loan Payment',
          referenceId:   loan.id,
          voucherDocId,
          notes:         form.notes || `Loan payment — ${loanLabel}`,
          user,
        });
      }

      // --- Save loan payment record ---
      const payload = {
        loanId: loan.id,
        loanName: loan.name || `Loan ${loan.id}`,
        date: form.date,
        interest: Number(form.interest) || 0,
        principal: Number(form.principal) || 0,
        penalty: Number(form.penalty) || 0,
        total,
        method: form.method,
        referenceNo: checkInfo?.checkNumber || form.referenceNo || '',
        bank: form.bank || '',
        voucherId: finalVoucherId,
        checkId:    checkInfo?.checkId        || '',
        checkRegisterId: checkInfo?.checkRegisterId || '',
        notes: form.notes || '',
        allocations: form.appliedPeriod
          ? [{
              period: form.appliedPeriod,
              interest:  Number(form.interest)  || 0,
              principal: Number(form.principal) || 0,
              penalty:   Number(form.penalty)   || 0,
            }]
          : [],
        createdAt: serverTimestamp(),
        createdBy: user,
      };
      const ref = await addDoc(collection(db, 'loanPayments'), payload);
      onSaved && onSaved({ id: ref.id, ...payload });
      onClose();
    } catch (e) {
      setError(e.message || 'Failed to save.');
    } finally {
      setSaving(false);
    }
  };

  const inpS = {
    border: '1px solid #e5e7eb', borderRadius: 8, padding: '8px 10px',
    fontSize: 13, width: '100%', boxSizing: 'border-box', fontFamily: 'inherit', background: '#fff',
  };
  const lblS = {
    fontSize: 10, fontWeight: 800, color: '#64748b',
    letterSpacing: '.06em', textTransform: 'uppercase',
  };

  return (
    <div
      style={{
        position: 'fixed', inset: 0, background: 'rgba(15,23,42,.45)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16, zIndex: 200,
      }}
      onClick={e => e.target === e.currentTarget && onClose()}
    >
      <div style={{
        width: 'min(640px,98vw)', maxHeight: '92vh', background: '#fff',
        borderRadius: 16, display: 'flex', flexDirection: 'column',
        overflow: 'hidden', boxShadow: '0 24px 64px rgba(0,0,0,.25)',
      }}>
        {/* Header */}
        <div style={{ background: '#f97316', color: '#fff', padding: '16px 20px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <strong style={{ fontSize: 16, fontWeight: 900 }}>💰 Record Loan Payment</strong>
            <button onClick={onClose} style={{
              background: 'rgba(255,255,255,.25)', border: 'none', color: '#fff',
              borderRadius: 8, width: 28, height: 28, cursor: 'pointer',
              fontSize: 14, fontWeight: 900,
            }}>✕</button>
          </div>
          <div style={{ fontSize: 12, opacity: .9, marginTop: 4, fontWeight: 600 }}>
            {loan.name || `Loan ${loan.id}`} · {loan.loanType || 'Term Loan'} · Outstanding {fmtCur(loanState?.outstandingPrincipal || 0)}
          </div>
        </div>

        {/* Body */}
        <div style={{ padding: '18px 20px', overflowY: 'auto', flex: 1 }}>
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
                style={{
                  background: '#f97316', color: '#fff', border: 'none', borderRadius: 8,
                  padding: '6px 12px', fontSize: 12, fontWeight: 700, cursor: 'pointer',
                }}
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

          {/* Checkbook banner shown when method is Check */}
          {form.method === 'Check' && form.bank && (
            activeCb ? (
              <div style={{
                background:'#eff6ff', border:'1px solid #bfdbfe', borderLeft:'4px solid #1d4ed8',
                borderRadius:8, padding:'8px 12px', marginBottom:12, fontSize:12, color:'#1e3a8a',
                display:'flex', flexWrap:'wrap', gap:10, alignItems:'center',
              }}>
                <span>📋 <strong>Active Checkbook</strong></span>
                <span>{activeCb.checkbookType}</span>
                <span>Range: <strong>{activeCb.startingNumber}–{activeCb.endingNumber}</strong></span>
                <span>Next: <strong style={{ color:'#f97316' }}>{activeCb.nextCheckNumber}</strong></span>
              </div>
            ) : (
              <div style={{
                background:'#fff7ed', border:'1px solid #fed7aa', borderLeft:'4px solid #f97316',
                borderRadius:8, padding:'8px 12px', marginBottom:12, fontSize:12, color:'#9a3412',
              }}>⚠️ No active checkbook for this bank. Open <strong>Check Registry → Checkbook Management</strong> to add one before issuing checks.</div>
            )
          )}

          {/* Row 2: interest / principal / penalty */}
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

          {/* Row 3: bank / reference / voucher */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 12, marginBottom: 12 }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
              <label style={lblS}>Bank / Account</label>
              {bankAccounts.length > 0 ? (
                <select style={inpS} value={form.bank} onChange={e => setField('bank', e.target.value)}>
                  <option value="">— Select —</option>
                  {bankAccounts.map(b => (
                    <option key={b.id} value={b.code || b.id}>{b.code} — {b.name}</option>
                  ))}
                </select>
              ) : (
                <input style={inpS} value={form.bank} onChange={e => setField('bank', e.target.value)} placeholder="e.g. BDO 1234" />
              )}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
              <label style={lblS}>{form.method === 'Check' ? 'Check No.' : 'Reference No.'}</label>
              <input style={inpS} value={form.referenceNo} onChange={e => setField('referenceNo', e.target.value)} placeholder={form.method === 'Check' ? 'Check #' : 'Txn No.'} />
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
              <label style={lblS}>Loan Voucher</label>
              {form.autoVoucher ? (
                <div style={{
                  ...inpS, display: 'flex', alignItems: 'center', gap: 8,
                  background: '#f0fdf4', borderColor: '#86efac', color: '#15803d', fontWeight: 600,
                }}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#15803d" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>
                  Auto-create LV on save
                </div>
              ) : (
                <input style={inpS} value={form.voucherId} onChange={e => setField('voucherId', e.target.value)} placeholder="e.g. LV202605-0001" />
              )}
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: '#64748b', cursor: 'pointer', marginTop: 2 }}>
                <input type="checkbox" checked={form.autoVoucher} onChange={e => setField('autoVoucher', e.target.checked)} style={{ margin: 0 }} />
                Auto-create Loan Voucher
              </label>
            </div>
          </div>

          {/* Notes */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 5, marginBottom: 8 }}>
            <label style={lblS}>Notes</label>
            <input style={inpS} value={form.notes} onChange={e => setField('notes', e.target.value)} />
          </div>

          {/* Total card */}
          <div style={{
            marginTop: 10, padding: '12px 16px', borderRadius: 12,
            background: '#0f172a', color: '#fff', display: 'flex',
            alignItems: 'center', justifyContent: 'space-between',
          }}>
            <span style={{ fontSize: 11, fontWeight: 800, color: '#94a3b8', letterSpacing: '.06em' }}>
              TOTAL PAYMENT
            </span>
            <strong style={{ fontSize: 20, fontWeight: 900 }}>{fmtCur(total)}</strong>
          </div>

          {error && (
            <div style={{
              marginTop: 12, padding: '9px 12px', borderRadius: 8,
              background: '#fef2f2', border: '1px solid #fecaca', color: '#b91c1c',
              fontSize: 12, fontWeight: 600,
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
            disabled={saving || total <= 0}
            style={{
              border: 0, borderRadius: 10, padding: '9px 18px', fontWeight: 800, fontSize: 13,
              background: '#f97316', color: '#fff', cursor: saving ? 'wait' : 'pointer',
              fontFamily: 'inherit', opacity: (saving || total <= 0) ? .6 : 1,
            }}
          >{saving ? 'Saving…' : 'Record Payment'}</button>
        </div>
      </div>
    </div>
  );
}

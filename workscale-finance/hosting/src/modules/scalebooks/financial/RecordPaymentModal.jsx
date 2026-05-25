import { useState, useEffect } from 'react';
import {
  collection, addDoc, getDocs, updateDoc, doc,
  query, where, serverTimestamp,
} from 'firebase/firestore';
import { db, auth } from '../../../firebase.js';

const fmtPHP = (n) => new Intl.NumberFormat('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n || 0);
const fmtCur = (n) => '₱' + fmtPHP(n);

const PAYMENT_METHODS = ['Check', 'Auto-Debit', 'Bank Transfer', 'Cash', 'Online'];

/**
 * Modal to record an actual loan payment against a loan.
 * Requires a pre-existing Loan Voucher (LV, voucherType:'PAYMENT') as pre-requisite.
 * If the LV has a linked Check Voucher (checkVoucherId), the associated check(s)
 * are automatically cleared and the CV is marked Paid when the payment is saved.
 */
export default function RecordPaymentModal({ loan, loanState, onClose, onSaved }) {
  const today = new Date().toISOString().slice(0, 10);
  const nextRow    = loanState?.schedule?.find(r => r.status !== 'paid');
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
    notes: nextRow ? `Payment for ${nextRow.label} (Period ${nextRow.period})` : '',
    appliedPeriod: nextRow ? nextRow.period : null,
  });
  const [saving,          setSaving]          = useState(false);
  const [error,           setError]           = useState('');
  const [lvs,             setLvs]             = useState([]);
  const [lvsLoading,      setLvsLoading]      = useState(true);
  const [selectedLvDocId, setSelectedLvDocId] = useState('');

  // Derived: currently selected LV object
  const selectedLv = lvs.find(l => l.docId === selectedLvDocId) || null;

  // ── Load available LVs (PAYMENT type, same loan, not yet consumed) ─────────
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const snap = await getDocs(query(
          collection(db, 'vouchers'),
          where('voucherType', '==', 'LOAN'),
        ));
        if (cancelled) return;
        const forLoan = snap.docs
          .map(d => ({ docId: d.id, ...d.data() }))
          .filter(v => String(v.loanId) === String(loan.id) && !v.loanPaymentId);
        setLvs(forLoan);
      } catch (e) {
        console.error('Failed to load LVs:', e);
      } finally {
        if (!cancelled) setLvsLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [loan.id]);

  // ── Auto-fill amounts when LV is selected ─────────────────────────────────
  useEffect(() => {
    if (!selectedLv) return;
    const lines = selectedLv.lines || [];
    let interest = 0, principal = 0, penalty = 0;
    lines.forEach(l => {
      const name = (l.category || l.description || '').toLowerCase();
      const code = l.expenseAccountCode || '';
      const amt  = Math.abs(Number(l.amount) || 0);
      if (name.includes('penalty'))                                                                  penalty  += amt;
      else if (name.includes('interest') || name.includes('finance cost') || code.startsWith('500')) interest += amt;
      else if (name.includes('principal') || name.includes('loans payable'))                         principal += amt;
    });
    setForm(f => ({
      ...f,
      interest:  interest  > 0 ? interest.toFixed(2)  : f.interest,
      principal: principal > 0 ? principal.toFixed(2) : f.principal,
      penalty:   penalty   > 0 ? penalty.toFixed(2)   : f.penalty,
      method: selectedLv.checkVoucherId ? 'Check' : f.method,
    }));
  }, [selectedLvDocId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { setError(''); }, [form]);

  const total    = (Number(form.interest) || 0) + (Number(form.principal) || 0) + (Number(form.penalty) || 0);
  const setField = (k, v) => setForm(f => ({ ...f, [k]: v }));

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

  // ── Save ──────────────────────────────────────────────────────────────────
  const handleSave = async () => {
    if (!form.date)       { setError('Payment date is required.');                                   return; }
    if (!selectedLvDocId) { setError('Select a Loan Voucher (LV) — required before recording.'); return; }
    if (total <= 0)       { setError('Enter at least one of Interest / Principal / Penalty.');       return; }
    setSaving(true);
    try {
      const user = auth.currentUser?.email || '';

      // 1. Write the loanPayments record referencing the LV (and CV if linked)
      const payload = {
        loanId:          loan.id,
        loanName:        loan.name || `Loan ${loan.id}`,
        date:            form.date,
        interest:        Number(form.interest)  || 0,
        principal:       Number(form.principal) || 0,
        penalty:         Number(form.penalty)   || 0,
        total,
        method:          form.method,
        referenceNo:     form.referenceNo || '',
        bank:            form.bank        || '',
        voucherId:       selectedLv.voucherId      || '',   // LV human-readable ID
        checkVoucherId:  selectedLv.checkVoucherId || '',   // CV human-readable ID (if any)
        checkId:         '',
        checkRegisterId: '',
        notes:           form.notes || '',
        allocations:     form.appliedPeriod
          ? [{ period: form.appliedPeriod, interest: Number(form.interest) || 0, principal: Number(form.principal) || 0, penalty: Number(form.penalty) || 0 }]
          : [],
        createdAt: serverTimestamp(),
        createdBy: user,
      };
      const lpRef = await addDoc(collection(db, 'loanPayments'), payload);

      // 2. Mark the LV as consumed so it cannot be used for another payment
      await updateDoc(doc(db, 'vouchers', selectedLvDocId), {
        loanPaymentId: lpRef.id,
        updatedAt: serverTimestamp(), updatedBy: user,
      });

      // 3. If LV is linked to a CV: clear the associated check(s) and mark the CV Paid
      if (selectedLv.checkVoucherId) {
        try {
          const crSnap = await getDocs(query(
            collection(db, 'checkRegister'),
            where('referenceId', '==', selectedLv.checkVoucherId),
          ));
          let cvFirestoreDocId = null;
          for (const crDoc of crSnap.docs) {
            const crData = crDoc.data();
            if (!cvFirestoreDocId && crData.voucherDocId) cvFirestoreDocId = crData.voucherDocId;
            const patch = { loanPaymentId: lpRef.id, updatedAt: serverTimestamp(), updatedBy: user };
            if (crData.status === 'Issued') {
              patch.status      = 'Cleared';
              patch.clearedDate = form.date;
            }
            await updateDoc(doc(db, 'checkRegister', crDoc.id), patch);
          }
          if (cvFirestoreDocId) {
            await updateDoc(doc(db, 'vouchers', cvFirestoreDocId), {
              status: 'Paid', updatedAt: serverTimestamp(), updatedBy: user,
            });
          }
        } catch (e) {
          console.warn('Could not auto-clear check:', e);
        }
      }

      onSaved && onSaved({ id: lpRef.id, ...payload });
      onClose();
    } catch (e) {
      setError(e.message || 'Failed to save.');
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

          {/* ── Step 1: Select Loan Voucher (pre-requisite) ─────────────── */}
          <div style={{
            marginBottom: 14, padding: '12px 14px',
            background: selectedLvDocId ? '#f0fdf4' : '#fef9c3',
            border: `1px solid ${selectedLvDocId ? '#86efac' : '#fde047'}`,
            borderLeft: `4px solid ${selectedLvDocId ? '#16a34a' : '#eab308'}`,
            borderRadius: 10,
          }}>
            <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: '.06em', textTransform: 'uppercase', marginBottom: 6, color: selectedLvDocId ? '#15803d' : '#854d0e' }}>
              Step 1 — Select Loan Voucher (LV) · Required
            </div>
            {lvsLoading ? (
              <div style={{ fontSize: 12, color: '#64748b' }}>Loading available vouchers…</div>
            ) : lvs.length === 0 ? (
              <div>
                <div style={{ fontSize: 12, color: '#92400e', fontWeight: 600, marginBottom: 4 }}>
                  No Loan Vouchers (LV) available for this loan.
                </div>
                <div style={{ fontSize: 11, color: '#78350f', lineHeight: 1.5 }}>
                  Go to <strong>Vouchers</strong> and create a new voucher with type <strong>PAYMENT</strong>, select this loan, and optionally link a Check Voucher (CV). Come back here once it is created.
                </div>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                <select
                  style={{ ...inpS, borderColor: selectedLvDocId ? '#86efac' : '#fde047', fontWeight: selectedLvDocId ? 700 : 400 }}
                  value={selectedLvDocId}
                  onChange={e => setSelectedLvDocId(e.target.value)}
                >
                  <option value="">— Select a Loan Voucher —</option>
                  {lvs.map(lv => (
                    <option key={lv.docId} value={lv.docId}>
                      {lv.voucherId || lv.docId}
                      {lv.checkVoucherId ? ` · CV: ${lv.checkVoucherId}` : ''}
                      {lv.totalAmount   ? ` · ${fmtCur(lv.totalAmount)}` : ''}
                      {lv.preparationDate ? ` · ${lv.preparationDate}` : ''}
                    </option>
                  ))}
                </select>
                {selectedLv && (
                  <div style={{ fontSize: 11, color: '#15803d', display: 'flex', flexWrap: 'wrap', gap: 10, marginTop: 2 }}>
                    <span>✓ LV: <strong>{selectedLv.voucherId}</strong></span>
                    {selectedLv.checkVoucherId
                      ? <span>· Linked CV: <strong>{selectedLv.checkVoucherId}</strong> — check will be auto-cleared on save</span>
                      : <span style={{ color: '#64748b' }}>· No linked CV (non-check payment)</span>
                    }
                  </div>
                )}
              </div>
            )}
          </div>

          {/* ── Next due summary ─────────────────────────────────────────── */}
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

          {/* ── Step 2: Payment details (dim until LV selected) ─────────── */}
          <div style={{ opacity: selectedLvDocId ? 1 : 0.4, pointerEvents: selectedLvDocId ? 'auto' : 'none', transition: 'opacity .2s' }}>

            {/* Row 1: date / method */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2,1fr)', gap: 12, marginBottom: 12 }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                <label style={lblS}>Payment Date</label>
                <input type="date" style={inpS} value={form.date} onChange={e => setField('date', e.target.value)} />
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                <label style={lblS}>Method</label>
                <select
                  style={{ ...inpS, ...(selectedLv?.checkVoucherId ? { background: '#f8fafc', color: '#64748b' } : {}) }}
                  value={form.method}
                  disabled={!!(selectedLv?.checkVoucherId)}
                  onChange={e => setField('method', e.target.value)}
                >
                  {PAYMENT_METHODS.map(m => <option key={m}>{m}</option>)}
                </select>
                {selectedLv?.checkVoucherId && (
                  <span style={{ fontSize: 10, color: '#94a3b8' }}>Locked to Check — linked CV detected</span>
                )}
              </div>
            </div>

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

            {/* Row 3: bank / reference */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2,1fr)', gap: 12, marginBottom: 12 }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                <label style={lblS}>Bank / Account</label>
                <input style={inpS} value={form.bank} onChange={e => setField('bank', e.target.value)} placeholder="e.g. BDO 1234" />
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                <label style={lblS}>{form.method === 'Check' ? 'Check No.' : 'Reference No.'}</label>
                <input style={inpS} value={form.referenceNo} onChange={e => setField('referenceNo', e.target.value)} placeholder={form.method === 'Check' ? 'Check #' : 'Txn No.'} />
              </div>
            </div>

            {/* Notes */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 5, marginBottom: 8 }}>
              <label style={lblS}>Notes</label>
              <input style={inpS} value={form.notes} onChange={e => setField('notes', e.target.value)} />
            </div>

          </div>{/* end step 2 */}

          {/* Total */}
          <div style={{
            marginTop: 10, padding: '12px 16px', borderRadius: 12,
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
            disabled={saving || total <= 0 || !selectedLvDocId || lvsLoading}
            style={{
              border: 0, borderRadius: 10, padding: '9px 18px', fontWeight: 800, fontSize: 13,
              background: '#f97316', color: '#fff', fontFamily: 'inherit',
              cursor: (saving || !selectedLvDocId) ? 'not-allowed' : 'pointer',
              opacity: (saving || total <= 0 || !selectedLvDocId) ? .5 : 1,
            }}
          >{saving ? 'Saving…' : 'Record Payment'}</button>
        </div>
      </div>
    </div>
  );
}

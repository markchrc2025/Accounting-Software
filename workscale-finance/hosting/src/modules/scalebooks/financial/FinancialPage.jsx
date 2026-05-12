import { useState, useEffect, useRef, useCallback } from 'react';
import { doc, onSnapshot, setDoc, serverTimestamp } from 'firebase/firestore';
import { db, auth } from '../../../firebase.js';

/* ─── Constants ─────────────────────────────────────────────────── */
const LOAN_TYPES = [
  'Term Loan','Revolving Credit','Mortgage','Equipment Financing',
  'Line of Credit','Balloon Loan','Bonds Payable','Other'
];
const INTEREST_METHODS = [
  'Reducing Balance','Straight-Line','Straight-Line (Monthly Rate)','Fixed','Balloon'
];
const PAYMENT_FREQS = ['Monthly','Semi-Monthly'];
const MONTH_NAMES   = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

const fmtPHP = (n) => new Intl.NumberFormat('en-PH',{minimumFractionDigits:2,maximumFractionDigits:2}).format(n||0);
const fmtCur = (n) => '₱' + fmtPHP(n);

/* ─── Amortization Engine (matches GAS fincMonthData) ────────────── */
function calcMonthData(loan, elapsed) {
  const P = loan.principal || 0;
  const r = (loan.annualRate || 0) / 100 / 12;
  const term = Math.max(loan.termMonths || 1, 1);
  if (elapsed < 0 || elapsed >= term) return null;
  if (P <= 0) return { principal:0, interest:0, balance:0 };
  if (loan.loanType === 'Revolving Credit') return { principal:0, interest:P*r, balance:P };
  if (loan.interestMethod === 'Balloon') {
    const isLast = elapsed === term - 1;
    return { principal: isLast ? P : 0, interest: P*r, balance: isLast ? 0 : P };
  }
  if (loan.interestMethod === 'Straight-Line') {
    const pp = P / term, bal = P - pp * elapsed;
    return { principal: pp, interest: bal * r, balance: bal - pp };
  }
  if (loan.interestMethod === 'Straight-Line (Monthly Rate)') {
    const rm = (loan.annualRate || 0) / 100, pp = P / term, bal = P - pp * elapsed;
    return { principal: pp, interest: bal * rm, balance: bal - pp };
  }
  if (loan.interestMethod === 'Fixed') {
    const pp = P / term, interest = P * (loan.annualRate||0) / 100 / 12;
    return { principal: pp, interest, balance: Math.max(P - pp * (elapsed+1), 0) };
  }
  // Reducing Balance (PMT) — default
  if (r === 0) { const pp = P/term; return { principal:pp, interest:0, balance:P - pp*(elapsed+1) }; }
  const pmt = P * r * Math.pow(1+r,term) / (Math.pow(1+r,term)-1);
  const bal0 = P * Math.pow(1+r,elapsed) - pmt * (Math.pow(1+r,elapsed)-1) / r;
  const interest = bal0 * r;
  const pp = pmt - interest;
  return { principal: Math.max(pp,0), interest: Math.max(interest,0), balance: Math.max(bal0-pp,0) };
}

/* Build array of 'Mon-YYYY' labels from disbursementDate over termMonths */
function buildLoanTimeline(loan) {
  if (!loan.disbursementDate || !loan.termMonths) return [];
  const d = new Date(loan.disbursementDate);
  if (isNaN(d.getTime())) return [];
  const months = [];
  for (let i = 0; i < loan.termMonths; i++) {
    const m = new Date(d.getFullYear(), d.getMonth() + i, 1);
    months.push(MONTH_NAMES[m.getMonth()] + '-' + m.getFullYear());
  }
  return months;
}

/* Build full amortization schedule for a loan */
function buildSchedule(loan) {
  const rows = [];
  for (let i = 0; i < (loan.termMonths||0); i++) {
    const d = calcMonthData(loan, i);
    if (!d) break;
    const base = new Date(loan.disbursementDate);
    const m = new Date(base.getFullYear(), base.getMonth() + i, 1);
    rows.push({
      period: i+1,
      label: MONTH_NAMES[m.getMonth()] + '-' + m.getFullYear(),
      ...d,
      fee: i === 0 ? (loan.processingFee||0) : 0
    });
  }
  return rows;
}

/* Total interest for a loan */
function loanTotalInterest(loan) {
  let total = parseFloat(loan.processingFee)||0;
  for (let i = 0; i < (loan.termMonths||0); i++) {
    const d = calcMonthData(loan, i);
    if (d) total += d.interest;
  }
  return total;
}

/* Get unique years covered by all active loans */
function allYears(loans) {
  const yrs = new Set();
  loans.forEach(l => {
    if (!l.disbursementDate || l.status==='Disposed') return;
    const d = new Date(l.disbursementDate);
    if (isNaN(d.getTime())) return;
    for (let i=0;i<(l.termMonths||0);i++) {
      const m = new Date(d.getFullYear(), d.getMonth()+i, 1);
      yrs.add(m.getFullYear());
    }
  });
  return [...yrs].sort((a,b)=>a-b);
}

/* ─── CSS ─────────────────────────────────────────────────────────── */

const CSS = `
  .fp-wrap   { display:flex; flex-direction:column; height:100%; overflow:hidden; font-family:Inter,system-ui,sans-serif; }
  .fp-topbar { display:flex; align-items:center; justify-content:space-between; padding:16px 22px 12px; flex-shrink:0; border-bottom:1px solid #e5e7eb; background:#fff; }
  .fp-body   { flex:1; overflow-y:auto; padding:16px 22px; }
  .input     { border:1px solid #e5e7eb; border-radius:10px; padding:9px 12px; font-size:13px; background:#fff; }
  .btn       { border:0; border-radius:10px; padding:9px 16px; font-weight:700; cursor:pointer; font-size:13px; font-family:inherit; }
  .btn-primary { background:#f97316; color:#fff; }
  .btn-ghost   { background:#f1f5f9; color:#0b1220; }
  .btn-ghost:hover { background:#e2e8f0; }
  .btn-sm    { padding:6px 12px; font-size:12px; }
  .card      { background:#fff; border:1px solid #e5e7eb; border-radius:14px; overflow:hidden; margin-bottom:12px; }
  .card-head { display:flex; justify-content:space-between; align-items:center; padding:13px 18px; background:#f8fafc; border-bottom:1px solid #e5e7eb; cursor:pointer; }
  .card-head:hover { background:#f1f5f9; }
  table      { width:100%; border-collapse:collapse; }
  th,td      { padding:10px 12px; border-bottom:1px solid #f1f5f9; font-size:13px; text-align:left; }
  th         { color:#64748b; font-weight:800; font-size:11px; letter-spacing:.05em; text-transform:uppercase; background:#f8fafc; }
  tr:hover td { background:#fafafa; }
  tr:last-child td { border-bottom:none; }
  .pill      { display:inline-block; padding:2px 9px; border-radius:999px; font-size:11px; font-weight:700; border:1px solid; }
  .pill-active { background:#f0fdf4; border-color:#bbf7d0; color:#15803d; }
  .pill-closed { background:#f8fafc; border-color:#e2e8f0; color:#94a3b8; }
  .pill-restructured { background:#fef9c3; border-color:#fde68a; color:#a16207; }
  .summary-bar { display:grid; grid-template-columns:repeat(4,1fr); gap:12px; margin-bottom:16px; }
  .scard     { background:#fff; border:1px solid #e5e7eb; border-radius:12px; padding:14px 16px; }
  .scard-label { font-size:9px; font-weight:800; color:#94a3b8; letter-spacing:.07em; text-transform:uppercase; margin-bottom:4px; }
  .scard-value { font-size:18px; font-weight:900; }
  .empty     { padding:48px; text-align:center; color:#94a3b8; }
  .backdrop  { position:fixed; inset:0; background:rgba(15,23,42,.45); display:flex; align-items:center; justify-content:center; padding:16px; z-index:100; }
  .modal     { width:min(720px,98vw); max-height:92vh; background:#fff; border-radius:16px; display:flex; flex-direction:column; overflow:hidden; box-shadow:0 24px 64px rgba(0,0,0,.25); }
  .modal-h   { display:flex; align-items:center; justify-content:space-between; padding:16px 20px; border-bottom:1px solid #e5e7eb; background:#f8fafc; flex-shrink:0; }
  .modal-b   { padding:20px; overflow-y:auto; flex:1; }
  .modal-f   { display:flex; justify-content:flex-end; gap:10px; padding:14px 20px; border-top:1px solid #e5e7eb; flex-shrink:0; }
  .grid4     { display:grid; grid-template-columns:repeat(4,1fr); gap:10px; margin-bottom:14px; }
  .col2      { grid-column:span 2; }
  .col4      { grid-column:span 4; }
  .field     { display:flex; flex-direction:column; gap:5px; }
  .field label { font-size:10px; font-weight:800; color:#64748b; letter-spacing:.06em; text-transform:uppercase; }
  .field input,.field select { width:100%; border:1px solid #e5e7eb; border-radius:10px; padding:9px 10px; font-size:13px; background:#fff; font-family:inherit; box-sizing:border-box; }
  .amort-table { font-size:11.5px; }
  .amort-table th,td { padding:8px 10px; }
  .toast { position:fixed; right:16px; bottom:16px; background:#0b1220; color:#fff; padding:12px 18px; border-radius:12px; font-size:13px; font-weight:600; z-index:999; }
`;

export default function FinancialPage() {
  const [loans, setLoans]     = useState([]);
  const [expanded, setExpanded] = useState(new Set());
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing]   = useState(null);
  const [form, setForm]         = useState({});
  const [saving, setSaving]     = useState(false);
  const [toast, setToast]       = useState('');
  const [filter, setFilter]     = useState('All');

  const showToast = (msg) => { setToast(msg); setTimeout(() => setToast(''), 3000); };

  useEffect(() => {
    const unsub = onSnapshot(query(collection(db,'financialLoans'), orderBy('createdAt','desc')), snap=>setLoans(snap.docs.map(d=>({id:d.id,...d.data()}))));
    return unsub;
  }, []);

  function toggle(id) { setExpanded(s=>{ const n=new Set(s); n.has(id)?n.delete(id):n.add(id); return n; }); }

  async function save() {
    if (!form.loanName || !form.loanType) return alert('Loan name and type are required.');
    setSaving(true);
    try {
      const payload = { ...form, principal:parseFloat(form.principal)||0, annualRate:parseFloat(form.annualRate)||0, termMonths:parseInt(form.termMonths)||0, updatedAt:serverTimestamp() };
      if (editing) { await updateDoc(doc(db,'financialLoans',editing), payload); showToast('Loan updated.'); }
      else { await addDoc(collection(db,'financialLoans'), {...payload, createdAt:serverTimestamp(), createdBy:auth.currentUser?.email}); showToast('Loan added.'); }
      setShowModal(false);
    } catch(e) { alert(e.message); }
    setSaving(false);
  }

  const filtered = loans.filter(l => filter==='All' || l.status===filter);
  const activeLoans = loans.filter(l => l.status==='Active');
  const totalPrincipal = activeLoans.reduce((s,l)=>s+(l.principal||0),0);

  const loanPill = (s) => {
    const m = { Active:'pill-active', Closed:'pill-closed', Restructured:'pill-restructured' };
    return `pill ${m[s]||'pill-active'}`;
  };

  return (
    <div className="fp-wrap">
      <style>{CSS}</style>
      <div className="fp-topbar">
        <div>
          <h1 style={{ margin:0, fontSize:18, fontWeight:900 }}>Financial (Loans)</h1>
          <p style={{ margin:0, fontSize:12, color:'#64748b' }}>{loans.length} loan{loans.length!==1?'s':''} · {activeLoans.length} active</p>
        </div>
        <button className="btn btn-primary" onClick={()=>{setEditing(null);setForm({status:'Active',interestMethod:'Amortizing (EMI)',paymentFrequency:'Monthly'});setShowModal(true);}}>+ New Loan</button>
      </div>

      <div className="fp-body">
        <div className="summary-bar">
          <div className="scard"><div className="scard-label">Active Loans</div><div className="scard-value">{activeLoans.length}</div></div>
          <div className="scard"><div className="scard-label">Total Principal</div><div className="scard-value" style={{fontSize:15,color:'#dc2626'}}>{fmt(totalPrincipal)}</div></div>
          <div className="scard"><div className="scard-label">Total Loans</div><div className="scard-value">{loans.length}</div></div>
          <div className="scard"><div className="scard-label">Closed</div><div className="scard-value">{loans.filter(l=>l.status==='Closed').length}</div></div>
        </div>

        <div style={{ display:'flex', gap:10, marginBottom:14 }}>
          {['All',...STATUSES].map(s=>(
            <button key={s} className={`btn btn-sm ${filter===s?'btn-primary':'btn-ghost'}`} onClick={()=>setFilter(s)}>{s}</button>
          ))}
        </div>

        {filtered.length===0 ? (
          <div className="card"><div className="empty">No loans found.</div></div>
        ) : filtered.map(l => {
          const schedule = expanded.has(l.id) ? computeAmortization(l.principal, l.annualRate, l.termMonths, l.interestMethod) : [];
          return (
            <div key={l.id} className="card">
              <div className="card-head" onClick={()=>toggle(l.id)}>
                <div style={{ display:'flex', alignItems:'center', gap:16 }}>
                  <span style={{ fontWeight:900 }}>{l.loanName}</span>
                  <span style={{ fontSize:12, color:'#64748b' }}>{l.loanType}</span>
                  <span className={loanPill(l.status)}>{l.status}</span>
                </div>
                <div style={{ display:'flex', alignItems:'center', gap:16 }}>
                  <div style={{ textAlign:'right' }}>
                    <div style={{ fontWeight:900, fontSize:14 }}>{fmt(l.principal)}</div>
                    <div style={{ fontSize:11, color:'#64748b' }}>{l.annualRate}% · {l.termMonths}mo · {l.interestMethod}</div>
                  </div>
                  <button className="btn btn-ghost btn-sm" onClick={e=>{e.stopPropagation();setEditing(l.id);setForm({...l});setShowModal(true);}}>Edit</button>
                  <span style={{ color:'#94a3b8', fontSize:11 }}>{expanded.has(l.id)?'▲':'▼'}</span>
                </div>
              </div>
              {expanded.has(l.id) && (
                <div style={{ padding:'0 0 12px' }}>
                  <div style={{ display:'grid', gridTemplateColumns:'repeat(4,1fr)', gap:14, padding:'12px 16px', borderBottom:'1px solid #f1f5f9', fontSize:12 }}>
                    <div><span style={{color:'#94a3b8'}}>First Payment: </span><strong>{l.firstPayment||'—'}</strong></div>
                    <div><span style={{color:'#94a3b8'}}>Proceeds Date: </span><strong>{l.proceedsDate||'—'}</strong></div>
                    <div><span style={{color:'#94a3b8'}}>Frequency: </span><strong>{l.paymentFrequency||'—'}</strong></div>
                    <div><span style={{color:'#94a3b8'}}>Notes: </span><strong>{l.notes||'—'}</strong></div>
                  </div>
                  <div style={{ padding:'0 16px', overflowX:'auto' }}>
                    <div style={{ fontSize:11, fontWeight:800, color:'#64748b', letterSpacing:'.07em', textTransform:'uppercase', padding:'12px 0 6px' }}>
                      Amortization Schedule{l.termMonths>60?' (first 60 periods shown)':''}
                    </div>
                    <table className="amort-table">
                      <thead><tr><th>#</th><th style={{textAlign:'right'}}>Principal</th><th style={{textAlign:'right'}}>Interest</th><th style={{textAlign:'right'}}>Total Payment</th><th style={{textAlign:'right'}}>Ending Balance</th></tr></thead>
                      <tbody>{schedule.map((row,i)=>(
                        <tr key={i}>
                          <td style={{color:'#94a3b8'}}>{row.period}</td>
                          <td style={{textAlign:'right'}}>{fmt(row.principal)}</td>
                          <td style={{textAlign:'right',color:'#dc2626'}}>{fmt(row.interest)}</td>
                          <td style={{textAlign:'right',fontWeight:800}}>{fmt(row.total)}</td>
                          <td style={{textAlign:'right',color:'#64748b'}}>{fmt(row.balance)}</td>
                        </tr>
                      ))}</tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {showModal && (
        <div className="backdrop" onClick={e=>e.target===e.currentTarget&&setShowModal(false)}>
          <div className="modal">
            <div className="modal-h"><strong>{editing?'Edit Loan':'New Loan'}</strong><button className="btn btn-ghost btn-sm" onClick={()=>setShowModal(false)}>✕</button></div>
            <div className="modal-b">
              <div className="grid4">
                <div className="field col2"><label>Loan Name *</label><input value={form.loanName||''} onChange={e=>setForm(f=>({...f,loanName:e.target.value}))} /></div>
                <div className="field col2"><label>Loan Type *</label><select value={form.loanType||''} onChange={e=>setForm(f=>({...f,loanType:e.target.value}))}><option value="">Select</option>{LOAN_TYPES.map(t=><option key={t}>{t}</option>)}</select></div>
                <div className="field"><label>Principal</label><input type="number" value={form.principal||''} onChange={e=>setForm(f=>({...f,principal:e.target.value}))} /></div>
                <div className="field"><label>Annual Rate (%)</label><input type="number" step="0.01" value={form.annualRate||''} onChange={e=>setForm(f=>({...f,annualRate:e.target.value}))} /></div>
                <div className="field"><label>Term (Months)</label><input type="number" value={form.termMonths||''} onChange={e=>setForm(f=>({...f,termMonths:e.target.value}))} /></div>
                <div className="field"><label>Status</label><select value={form.status||'Active'} onChange={e=>setForm(f=>({...f,status:e.target.value}))}>{STATUSES.map(s=><option key={s}>{s}</option>)}</select></div>
                <div className="field col2"><label>Interest Method</label><select value={form.interestMethod||'Amortizing (EMI)'} onChange={e=>setForm(f=>({...f,interestMethod:e.target.value}))}>{METHODS.map(m=><option key={m}>{m}</option>)}</select></div>
                <div className="field col2"><label>Payment Frequency</label><select value={form.paymentFrequency||'Monthly'} onChange={e=>setForm(f=>({...f,paymentFrequency:e.target.value}))}>{FREQUENCIES.map(f=><option key={f}>{f}</option>)}</select></div>
                <div className="field col2"><label>Proceeds Date</label><input type="date" value={form.proceedsDate||''} onChange={e=>setForm(f=>({...f,proceedsDate:e.target.value}))} /></div>
                <div className="field col2"><label>First Payment Date</label><input type="date" value={form.firstPayment||''} onChange={e=>setForm(f=>({...f,firstPayment:e.target.value}))} /></div>
                <div className="field col4"><label>Notes</label><input value={form.notes||''} onChange={e=>setForm(f=>({...f,notes:e.target.value}))} /></div>
              </div>
            </div>
            <div className="modal-f">
              <button className="btn btn-ghost" onClick={()=>setShowModal(false)}>Cancel</button>
              <button className="btn btn-primary" onClick={save} disabled={saving}>{saving?'Saving…':editing?'Save Changes':'Add Loan'}</button>
            </div>
          </div>
        </div>
      )}
      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}

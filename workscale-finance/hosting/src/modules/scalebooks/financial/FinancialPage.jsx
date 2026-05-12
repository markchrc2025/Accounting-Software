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
  .fp-topbar { display:flex; align-items:center; justify-content:space-between; padding:14px 22px 10px; flex-shrink:0; border-bottom:1px solid #e5e7eb; background:#fff; gap:12px; }
  .fp-tabs   { display:flex; gap:0; background:#fff; border-bottom:2px solid #e5e7eb; flex-shrink:0; overflow-x:auto; }
  .fp-tab    { padding:10px 18px; font-size:13px; font-weight:600; border:none; background:transparent; color:#64748b; cursor:pointer; white-space:nowrap; border-bottom:2px solid transparent; margin-bottom:-2px; font-family:inherit; }
  .fp-tab:hover { color:#0b1220; }
  .fp-tab-active { color:#f97316; border-bottom-color:#f97316; font-weight:800; }
  .fp-body   { flex:1; overflow-y:auto; padding:16px 22px; }
  .btn       { border:0; border-radius:10px; padding:9px 16px; font-weight:700; cursor:pointer; font-size:13px; font-family:inherit; }
  .btn-primary { background:#f97316; color:#fff; }
  .btn-ghost   { background:#f1f5f9; color:#0b1220; }
  .btn-ghost:hover { background:#e2e8f0; }
  .btn-sm    { padding:6px 12px; font-size:12px; }
  table      { width:100%; border-collapse:collapse; }
  th,td      { padding:9px 10px; border-bottom:1px solid #f1f5f9; font-size:12px; text-align:left; }
  th         { color:#64748b; font-weight:800; font-size:10px; letter-spacing:.05em; text-transform:uppercase; background:#f8fafc; position:sticky; top:0; z-index:1; }
  tr:hover td { background:#fafafa; }
  tr:last-child td { border-bottom:none; }
  tfoot td   { background:#f8fafc; font-weight:900; border-top:2px solid #e5e7eb; }
  .tbl-inp   { border:1px solid #e5e7eb; border-radius:6px; padding:5px 7px; font-size:12px; width:100%; min-width:80px; box-sizing:border-box; font-family:inherit; background:#fff; }
  .tbl-inp:focus { outline:none; border-color:#f97316; }
  .tbl-sel   { border:1px solid #e5e7eb; border-radius:6px; padding:5px 4px; font-size:12px; background:#fff; font-family:inherit; }
  .tbl-num   { text-align:right; }
  .pill      { display:inline-block; padding:2px 9px; border-radius:999px; font-size:11px; font-weight:700; border:1px solid; }
  .pill-sm   { padding:2px 7px; font-size:10px; cursor:pointer; }
  .pill-active { background:#f0fdf4; border-color:#bbf7d0; color:#15803d; }
  .pill-disposed { background:#f8fafc; border-color:#e2e8f0; color:#94a3b8; }
  .summary-bar { display:grid; grid-template-columns:repeat(4,1fr); gap:12px; margin-bottom:16px; }
  .scard     { background:#fff; border:1px solid #e5e7eb; border-radius:12px; padding:14px 16px; }
  .scard-label { font-size:9px; font-weight:800; color:#94a3b8; letter-spacing:.07em; text-transform:uppercase; margin-bottom:4px; }
  .scard-value { font-size:18px; font-weight:900; }
  .empty     { padding:48px; text-align:center; color:#94a3b8; }
  .backdrop  { position:fixed; inset:0; background:rgba(15,23,42,.45); display:flex; align-items:center; justify-content:center; padding:16px; z-index:100; }
  .modal     { width:min(680px,98vw); max-height:92vh; background:#fff; border-radius:16px; display:flex; flex-direction:column; overflow:hidden; box-shadow:0 24px 64px rgba(0,0,0,.25); }
  .modal-h   { display:flex; align-items:center; justify-content:space-between; padding:16px 20px; border-bottom:1px solid #e5e7eb; background:#f8fafc; flex-shrink:0; }
  .modal-b   { padding:20px; overflow-y:auto; flex:1; }
  .modal-f   { display:flex; justify-content:flex-end; gap:10px; padding:14px 20px; border-top:1px solid #e5e7eb; flex-shrink:0; }
  .grid4     { display:grid; grid-template-columns:repeat(4,1fr); gap:10px; margin-bottom:14px; }
  .col2      { grid-column:span 2; }
  .col4      { grid-column:span 4; }
  .field     { display:flex; flex-direction:column; gap:5px; }
  .field label { font-size:10px; font-weight:800; color:#64748b; letter-spacing:.06em; text-transform:uppercase; }
  .field input,.field select { width:100%; border:1px solid #e5e7eb; border-radius:10px; padding:9px 10px; font-size:13px; background:#fff; font-family:inherit; box-sizing:border-box; }
  .cal-grid  { display:grid; grid-template-columns:repeat(7,1fr); gap:3px; }
  .cal-cell  { min-height:80px; background:#fff; border:1px solid #e5e7eb; border-radius:8px; padding:5px; }
  .cal-cell-empty { background:transparent; border:none; }
  .cal-day   { font-size:11px; font-weight:700; margin-bottom:3px; }
  .cal-event { font-size:10px; background:#fff7ed; border:1px solid #fed7aa; border-radius:4px; padding:2px 4px; margin-bottom:2px; line-height:1.3; }
  .toast     { position:fixed; right:16px; bottom:16px; background:#0b1220; color:#fff; padding:12px 18px; border-radius:12px; font-size:13px; font-weight:600; z-index:999; }
`;

export default function FinancialPage() {
  const [loans, setLoans]           = useState([]);
  const [activeTab, setActiveTab]   = useState('loans');
  const [scheduleYear, setScheduleYear] = useState('all');
  const [pmModal, setPmModal]       = useState(null);  // loan.id
  const [payDaysModal, setPayDaysModal] = useState(null); // loan.id
  const [calMonth, setCalMonth]     = useState(new Date().getMonth());
  const [calYear, setCalYear]       = useState(new Date().getFullYear());
  const [nextId, setNextId]         = useState(1);
  const [saveStatus, setSaveStatus] = useState('');
  const [toast, setToast]           = useState('');
  const saveTimerRef = useRef(null);

  const showToast = (msg) => { setToast(msg); setTimeout(() => setToast(''), 3000); };

  /* ── Firestore ─────────────────────────────────────────────────── */
  useEffect(() => {
    const unsub = onSnapshot(doc(db, 'finc', 'profile'), snap => {
      const data = snap.data() || {};
      const ls = Array.isArray(data.loans) ? data.loans : [];
      setLoans(ls);
      setNextId(ls.reduce((m, l) => Math.max(m, l.id || 0), 0) + 1);
    });
    return unsub;
  }, []);

  const saveToFirestore = useCallback(async (ls) => {
    setSaveStatus('saving');
    try {
      await setDoc(doc(db, 'finc', 'profile'), {
        loans: ls,
        updatedAt: serverTimestamp(),
        updatedBy: auth.currentUser?.email || '',
      });
      setSaveStatus('saved');
      setTimeout(() => setSaveStatus(''), 2000);
    } catch (e) {
      setSaveStatus('error');
      console.error(e);
    }
  }, []);

  const debounceSave = useCallback((ls) => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => saveToFirestore(ls), 1400);
  }, [saveToFirestore]);

  const updateLoan = useCallback((id, field, value) => {
    setLoans(prev => {
      const next = prev.map(l => l.id === id ? { ...l, [field]: value } : l);
      debounceSave(next);
      return next;
    });
  }, [debounceSave]);

  const addLoan = useCallback(() => {
    const iso = new Date().toISOString().slice(0, 7) + '-01';
    setLoans(prev => {
      const id = prev.reduce((m, l) => Math.max(m, l.id || 0), 0) + 1;
      const newLoan = {
        id, name: '', loanType: 'Term Loan',
        disbursementDate: iso, proceedsDate: '',
        termMonths: 60, annualRate: 6,
        interestMethod: 'Reducing Balance', processingFee: 0,
        status: 'Active', paymentFrequency: 'Monthly',
        payDayMode: 'Fixed', payDays: '', payDaysPerMonth: {},
        paymentMethod: 'Check', pmChecks: [],
        pmAdaDay: '', pmAdaBank: '', pmBtBank: '', pmAutoVoucher: false,
      };
      const next = [...prev, newLoan];
      debounceSave(next);
      return next;
    });
  }, [debounceSave]);

  const deleteLoan = useCallback((id) => {
    if (!confirm('Delete this loan?')) return;
    setLoans(prev => {
      const next = prev.filter(l => l.id !== id);
      debounceSave(next);
      return next;
    });
  }, [debounceSave]);

  const activeLoans    = loans.filter(l => l.status === 'Active');
  const totalPrincipal = activeLoans.reduce((s, l) => s + (parseFloat(l.principal) || 0), 0);
  const totalInterest  = activeLoans.reduce((s, l) => s + loanTotalInterest(l), 0);

  const TABS = [
    { key: 'loans',    label: 'Loan Registry' },
    { key: 'schedule', label: 'Amortization Schedule' },
    { key: 'summary',  label: 'Summary' },
    { key: 'calendar', label: 'Calendar' },
    { key: 'payment',  label: 'Payment Method' },
  ];

  /* ── Tab: Loan Registry ────────────────────────────────────────── */
  function LoansTab() {
    return (
      <div>
        <div style={{ display:'flex', gap:10, alignItems:'center', marginBottom:12, flexWrap:'wrap' }}>
          <button className="btn btn-primary btn-sm" onClick={addLoan}>+ Add Loan</button>
          <button className="btn btn-ghost btn-sm" onClick={() => saveToFirestore(loans)}>💾 Save</button>
          {saveStatus && (
            <span style={{ fontSize:11, color: saveStatus==='error'?'#dc2626':'#15803d' }}>
              {saveStatus==='saving' ? 'Saving…' : saveStatus==='saved' ? 'Saved ✓' : 'Save Error'}
            </span>
          )}
          <span style={{ marginLeft:'auto', fontSize:12, color:'#64748b' }}>
            {activeLoans.length} active · Principal: <strong>{fmtCur(totalPrincipal)}</strong>
          </span>
        </div>
        {loans.length === 0 ? (
          <div className="empty">No loans yet. Click "+ Add Loan" to begin.</div>
        ) : (
          <div style={{ overflowX:'auto' }}>
            <datalist id="fp-lender-list">
              {[...new Set(loans.map(l => l.name).filter(Boolean))].map(n => <option key={n} value={n} />)}
            </datalist>
            <table>
              <thead>
                <tr>
                  <th style={{width:28}}>#</th>
                  <th style={{minWidth:140}}>Contact / Lender</th>
                  <th style={{minWidth:120}}>Loan Type</th>
                  <th style={{minWidth:120}}>First Payment</th>
                  <th style={{minWidth:110}}>Principal ₱</th>
                  <th style={{width:70}}>Term Mo.</th>
                  <th style={{width:80}}>Rate %</th>
                  <th style={{minWidth:150}}>Interest Method</th>
                  <th style={{minWidth:110}}>Processing Fee ₱</th>
                  <th style={{minWidth:120}}>Proceeds Date</th>
                  <th style={{width:90}}>Status</th>
                  <th style={{width:110}}>Frequency</th>
                  <th style={{width:90}}>Pay Days</th>
                  <th style={{width:36}}></th>
                </tr>
              </thead>
              <tbody>
                {loans.map((l, idx) => (
                  <tr key={l.id}>
                    <td style={{ color:'#94a3b8', fontSize:10 }}>{idx + 1}</td>
                    <td>
                      <input list="fp-lender-list" className="tbl-inp" style={{minWidth:130}} value={l.name||''} onChange={e=>updateLoan(l.id,'name',e.target.value)} placeholder="Lender name" />
                    </td>
                    <td>
                      <select className="tbl-sel" value={l.loanType||'Term Loan'} onChange={e=>updateLoan(l.id,'loanType',e.target.value)}>
                        {LOAN_TYPES.map(t=><option key={t}>{t}</option>)}
                      </select>
                    </td>
                    <td><input type="date" className="tbl-inp" value={l.disbursementDate||''} onChange={e=>updateLoan(l.id,'disbursementDate',e.target.value)} /></td>
                    <td><input type="number" className="tbl-inp tbl-num" value={l.principal||''} onChange={e=>updateLoan(l.id,'principal',parseFloat(e.target.value)||0)} /></td>
                    <td><input type="number" className="tbl-inp" style={{width:60}} value={l.termMonths||''} onChange={e=>updateLoan(l.id,'termMonths',parseInt(e.target.value)||0)} /></td>
                    <td><input type="number" step="0.01" className="tbl-inp" style={{width:70}} value={l.annualRate||''} onChange={e=>updateLoan(l.id,'annualRate',parseFloat(e.target.value)||0)} /></td>
                    <td>
                      <select className="tbl-sel" value={l.interestMethod||'Reducing Balance'} onChange={e=>updateLoan(l.id,'interestMethod',e.target.value)}>
                        {INTEREST_METHODS.map(m=><option key={m}>{m}</option>)}
                      </select>
                    </td>
                    <td><input type="number" className="tbl-inp tbl-num" value={l.processingFee||''} onChange={e=>updateLoan(l.id,'processingFee',parseFloat(e.target.value)||0)} /></td>
                    <td><input type="date" className="tbl-inp" value={l.proceedsDate||''} onChange={e=>updateLoan(l.id,'proceedsDate',e.target.value)} /></td>
                    <td>
                      <select className="tbl-sel" value={l.status||'Active'} onChange={e=>updateLoan(l.id,'status',e.target.value)}>
                        {['Active','Disposed'].map(s=><option key={s}>{s}</option>)}
                      </select>
                    </td>
                    <td>
                      <select className="tbl-sel" value={l.paymentFrequency||'Monthly'} onChange={e=>updateLoan(l.id,'paymentFrequency',e.target.value)}>
                        {PAYMENT_FREQS.map(f=><option key={f}>{f}</option>)}
                      </select>
                    </td>
                    <td>
                      {l.paymentFrequency === 'Semi-Monthly'
                        ? <button className="pill pill-sm" onClick={()=>setPayDaysModal(l.id)} style={{cursor:'pointer',background:'#f0f9ff',borderColor:'#bae6fd',color:'#0284c7',border:'1px solid'}}>
                            {l.payDays || 'Set'}
                          </button>
                        : <span style={{color:'#94a3b8',fontSize:10}}>Monthly</span>
                      }
                    </td>
                    <td>
                      <button onClick={()=>deleteLoan(l.id)} style={{background:'none',border:'none',color:'#dc2626',cursor:'pointer',fontWeight:900,fontSize:14,padding:'2px 4px'}}>✕</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    );
  }

  /* ── Tab: Amortization Schedule ────────────────────────────────── */
  function ScheduleTab() {
    const active = loans.filter(l => l.status === 'Active' && l.disbursementDate && l.termMonths > 0);
    const years  = allYears(active);

    const allMoSet = new Set();
    active.forEach(l => buildSchedule(l).forEach(r => allMoSet.add(r.label)));
    const sorted = [...allMoSet].sort((a, b) => {
      const parse = s => { const [mo, yr] = s.split('-'); return new Date(yr, MONTH_NAMES.indexOf(mo)); };
      return parse(a) - parse(b);
    });
    const filtered = scheduleYear === 'all' ? sorted : sorted.filter(m => m.endsWith('-' + scheduleYear));

    const schedMap = {};
    active.forEach(l => { schedMap[l.id] = {}; buildSchedule(l).forEach(r => { schedMap[l.id][r.label] = r; }); });

    return (
      <div>
        <div style={{ display:'flex', gap:8, marginBottom:14, flexWrap:'wrap' }}>
          {['all', ...years].map(y => (
            <button key={y} className={`btn btn-sm ${scheduleYear===String(y)?'btn-primary':'btn-ghost'}`}
              onClick={()=>setScheduleYear(String(y))}>
              {y === 'all' ? 'All Years' : y}
            </button>
          ))}
        </div>
        {active.length === 0 ? <div className="empty">No active loans with disbursement dates.</div> : (
          <div style={{ overflowX:'auto' }}>
            <table style={{ fontSize:11 }}>
              <thead>
                <tr>
                  <th style={{minWidth:90}}>Month</th>
                  {active.map(l => (
                    <th key={l.id} colSpan={3} style={{ textAlign:'center', borderLeft:'2px solid #e5e7eb', minWidth:180 }}>
                      {l.name || `Loan ${l.id}`}
                    </th>
                  ))}
                  <th colSpan={2} style={{ textAlign:'center', borderLeft:'2px solid #e5e7eb', background:'#fef9c3', minWidth:120 }}>Grand Total</th>
                </tr>
                <tr>
                  <th></th>
                  {active.map(l => (
                    <th key={l.id + 'hdr'} colSpan={3} style={{ borderLeft:'2px solid #e5e7eb' }}>
                      <span style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr', fontSize:9 }}>
                        <span style={{textAlign:'right'}}>Principal</span>
                        <span style={{textAlign:'right'}}>Interest</span>
                        <span style={{textAlign:'right'}}>Total</span>
                      </span>
                    </th>
                  ))}
                  <th style={{ textAlign:'right', borderLeft:'2px solid #e5e7eb', background:'#fef9c3', fontSize:9 }}>Principal</th>
                  <th style={{ textAlign:'right', background:'#fef9c3', fontSize:9 }}>Interest</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(mo => {
                  let gP = 0, gI = 0;
                  return (
                    <tr key={mo}>
                      <td style={{ fontWeight:600, whiteSpace:'nowrap' }}>{mo}</td>
                      {active.map(l => {
                        const r = schedMap[l.id]?.[mo];
                        if (!r) return (
                          <td key={l.id} colSpan={3} style={{ borderLeft:'2px solid #e5e7eb' }}></td>
                        );
                        gP += r.principal; gI += r.interest;
                        return (
                          <td key={l.id} colSpan={3} style={{ borderLeft:'2px solid #e5e7eb', padding:0 }}>
                            <span style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr' }}>
                              <span style={{textAlign:'right',padding:'8px 6px'}}>{fmtPHP(r.principal)}</span>
                              <span style={{textAlign:'right',padding:'8px 6px',color:'#dc2626'}}>{fmtPHP(r.interest)}</span>
                              <span style={{textAlign:'right',padding:'8px 6px',fontWeight:700}}>{fmtPHP(r.principal+r.interest)}</span>
                            </span>
                          </td>
                        );
                      })}
                      <td style={{ textAlign:'right', borderLeft:'2px solid #e5e7eb', background:'#fefce8', fontWeight:700 }}>{fmtPHP(gP)}</td>
                      <td style={{ textAlign:'right', background:'#fefce8', color:'#dc2626', fontWeight:700 }}>{fmtPHP(gI)}</td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr>
                  <td>TOTAL</td>
                  {active.map(l => {
                    const sched = buildSchedule(l).filter(r => scheduleYear==='all' || r.label.endsWith('-'+scheduleYear));
                    const tP = sched.reduce((s,r)=>s+r.principal,0), tI = sched.reduce((s,r)=>s+r.interest,0);
                    return (
                      <td key={l.id} colSpan={3} style={{ borderLeft:'2px solid #e5e7eb', padding:0 }}>
                        <span style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr' }}>
                          <span style={{textAlign:'right',padding:'8px 6px'}}>{fmtPHP(tP)}</span>
                          <span style={{textAlign:'right',padding:'8px 6px',color:'#dc2626'}}>{fmtPHP(tI)}</span>
                          <span style={{textAlign:'right',padding:'8px 6px'}}>{fmtPHP(tP+tI)}</span>
                        </span>
                      </td>
                    );
                  })}
                  <td style={{ textAlign:'right', borderLeft:'2px solid #e5e7eb' }}>
                    {fmtPHP(active.reduce((s,l)=>{const sc=buildSchedule(l).filter(r=>scheduleYear==='all'||r.label.endsWith('-'+scheduleYear));return s+sc.reduce((ss,r)=>ss+r.principal,0);},0))}
                  </td>
                  <td style={{ textAlign:'right', color:'#dc2626' }}>
                    {fmtPHP(active.reduce((s,l)=>{const sc=buildSchedule(l).filter(r=>scheduleYear==='all'||r.label.endsWith('-'+scheduleYear));return s+sc.reduce((ss,r)=>ss+r.interest,0);},0))}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </div>
    );
  }

  /* ── Tab: Summary ──────────────────────────────────────────────── */
  function SummaryTab() {
    const rows = loans.map(l => {
      const totInt = loanTotalInterest(l) - (parseFloat(l.processingFee)||0);
      const fee    = parseFloat(l.processingFee)||0;
      const finCost = totInt + fee;
      const pct   = (parseFloat(l.principal)||0) > 0 ? finCost / (parseFloat(l.principal)||0) * 100 : 0;
      return { l, totInt, fee, finCost, pct };
    });
    const grand = {
      principal: rows.reduce((s,r)=>s+(parseFloat(r.l.principal)||0),0),
      totInt:    rows.reduce((s,r)=>s+r.totInt,0),
      fee:       rows.reduce((s,r)=>s+r.fee,0),
      finCost:   rows.reduce((s,r)=>s+r.finCost,0),
    };
    const maxFC = Math.max(...rows.map(r => r.finCost), 1);
    if (rows.length === 0) return <div className="empty">No loans to summarize.</div>;
    return (
      <div style={{ overflowX:'auto' }}>
        <table>
          <thead>
            <tr>
              <th>Loan / Lender</th>
              <th>Type</th>
              <th style={{textAlign:'right'}}>Principal</th>
              <th style={{textAlign:'right'}}>Total Interest</th>
              <th style={{textAlign:'right'}}>Processing Fee</th>
              <th style={{textAlign:'right'}}>Finance Cost</th>
              <th style={{textAlign:'right'}}>% of Principal</th>
              <th style={{width:120}}>Cost Bar</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ l, totInt, fee, finCost, pct }) => (
              <tr key={l.id}>
                <td style={{ fontWeight:700 }}>{l.name || `Loan ${l.id}`}</td>
                <td style={{ color:'#64748b' }}>{l.loanType}</td>
                <td style={{ textAlign:'right' }}>{fmtCur(parseFloat(l.principal)||0)}</td>
                <td style={{ textAlign:'right', color:'#dc2626' }}>{fmtCur(totInt)}</td>
                <td style={{ textAlign:'right' }}>{fmtCur(fee)}</td>
                <td style={{ textAlign:'right', fontWeight:800 }}>{fmtCur(finCost)}</td>
                <td style={{ textAlign:'right' }}>{pct.toFixed(1)}%</td>
                <td>
                  <div style={{ background:'#f1f5f9', borderRadius:6, height:8, overflow:'hidden' }}>
                    <div style={{ width:`${Math.min(finCost/maxFC*100,100)}%`, height:'100%', background:'#f97316', borderRadius:6 }}></div>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={2}>GRAND TOTAL</td>
              <td style={{ textAlign:'right' }}>{fmtCur(grand.principal)}</td>
              <td style={{ textAlign:'right', color:'#dc2626' }}>{fmtCur(grand.totInt)}</td>
              <td style={{ textAlign:'right' }}>{fmtCur(grand.fee)}</td>
              <td style={{ textAlign:'right' }}>{fmtCur(grand.finCost)}</td>
              <td colSpan={2}></td>
            </tr>
          </tfoot>
        </table>
      </div>
    );
  }

  /* ── Tab: Calendar ─────────────────────────────────────────────── */
  function CalendarTab() {
    const prevM = () => calMonth === 0 ? (setCalMonth(11), setCalYear(y=>y-1)) : setCalMonth(m=>m-1);
    const nextM = () => calMonth === 11 ? (setCalMonth(0), setCalYear(y=>y+1)) : setCalMonth(m=>m+1);

    const events = {};
    loans.filter(l => l.status==='Active').forEach(l => {
      const sched = buildSchedule(l);
      const label = MONTH_NAMES[calMonth] + '-' + calYear;
      const row   = sched.find(r => r.label === label);
      if (!row) return;
      const add = (day, amt) => {
        if (!events[day]) events[day] = [];
        events[day].push({ loan: l, amount: amt });
      };
      if (l.paymentFrequency === 'Semi-Monthly') {
        const key  = calYear + '-' + String(calMonth+1).padStart(2,'0');
        const dayStr = (l.payDayMode==='Custom' && l.payDaysPerMonth?.[key]) ? l.payDaysPerMonth[key] : (l.payDays||'15,30');
        const half = (row.principal + row.interest) / 2;
        String(dayStr).split(',').forEach(d => { const n=parseInt(d); if (n>=1&&n<=31) add(n, half); });
      } else {
        const day = l.disbursementDate ? new Date(l.disbursementDate).getDate() : 1;
        add(day, row.principal + row.interest);
      }
    });

    const daysInMonth = new Date(calYear, calMonth+1, 0).getDate();
    const firstDow    = new Date(calYear, calMonth, 1).getDay();
    const cells = [...Array(firstDow).fill(null), ...Array.from({length:daysInMonth},(_,i)=>i+1)];
    while (cells.length % 7) cells.push(null);
    const weeks = Array.from({length:cells.length/7},(_,i)=>cells.slice(i*7,i*7+7));
    const today = new Date();
    const DOW = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];

    return (
      <div>
        <div style={{ display:'flex', alignItems:'center', gap:12, marginBottom:14 }}>
          <button className="btn btn-ghost btn-sm" onClick={prevM}>◀</button>
          <span style={{ fontWeight:900, fontSize:16, minWidth:120 }}>{MONTH_NAMES[calMonth]} {calYear}</span>
          <button className="btn btn-ghost btn-sm" onClick={nextM}>▶</button>
          <span style={{ marginLeft:'auto', fontSize:12, color:'#64748b' }}>
            {Object.values(events).flat().length} payment{Object.values(events).flat().length!==1?'s':''} this month
          </span>
        </div>
        <div className="cal-grid">
          {DOW.map(d => (
            <div key={d} style={{ textAlign:'center', fontWeight:800, fontSize:10, color:'#94a3b8', padding:'6px 0', textTransform:'uppercase', letterSpacing:'.06em' }}>{d}</div>
          ))}
          {weeks.map((week, wi) => week.map((day, di) => (
            <div key={`${wi}-${di}`} className={day ? 'cal-cell' : 'cal-cell-empty'}>
              {day && (
                <>
                  <div className="cal-day" style={{ color: day===today.getDate()&&calMonth===today.getMonth()&&calYear===today.getFullYear()?'#f97316':'#0b1220' }}>
                    {day}
                  </div>
                  {(events[day]||[]).map((ev, i) => (
                    <div key={i} className="cal-event">
                      <div style={{ fontWeight:800, color:'#9a3412', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
                        {ev.loan.name || `Loan ${ev.loan.id}`}
                      </div>
                      <div style={{ color:'#ea580c' }}>{fmtCur(ev.amount)}</div>
                    </div>
                  ))}
                </>
              )}
            </div>
          )))}
        </div>
      </div>
    );
  }

  /* ── Tab: Payment Method ───────────────────────────────────────── */
  function PaymentTab() {
    const PM = {
      Check:          { bg:'#f0f9ff', border:'#bae6fd', color:'#0369a1' },
      'Auto-Debit':   { bg:'#f5f3ff', border:'#ddd6fe', color:'#6d28d9' },
      'Bank Transfer':{ bg:'#f0fdf4', border:'#bbf7d0', color:'#15803d' },
    };
    if (loans.length === 0) return <div className="empty">No loans yet.</div>;
    return (
      <div style={{ overflowX:'auto' }}>
        <table>
          <thead>
            <tr>
              <th>#</th>
              <th>Contact / Lender</th>
              <th>Loan Type</th>
              <th>Payment Method</th>
              <th>Details</th>
              <th>Auto-Voucher</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {loans.map((l, idx) => {
              const pm  = l.paymentMethod || 'Check';
              const clr = PM[pm] || PM.Check;
              let details = '';
              if (pm === 'Check') details = (l.pmChecks||[]).join(', ');
              else if (pm === 'Auto-Debit') details = `Day ${l.pmAdaDay||'—'} · ${l.pmAdaBank||'—'}`;
              else if (pm === 'Bank Transfer') details = l.pmBtBank||'—';
              return (
                <tr key={l.id}>
                  <td style={{ color:'#94a3b8', fontSize:10 }}>{idx+1}</td>
                  <td style={{ fontWeight:700 }}>{l.name||`Loan ${l.id}`}</td>
                  <td style={{ color:'#64748b' }}>{l.loanType}</td>
                  <td>
                    <span className="pill" style={{ background:clr.bg, borderColor:clr.border, color:clr.color }}>{pm}</span>
                  </td>
                  <td style={{ fontSize:11, color:'#64748b' }}>{details||'—'}</td>
                  <td>
                    <span className={`pill ${l.pmAutoVoucher?'pill-active':'pill-disposed'}`}>{l.pmAutoVoucher?'On':'Off'}</span>
                  </td>
                  <td>
                    <button className="btn btn-ghost btn-sm" onClick={()=>setPmModal(l.id)}>Edit</button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    );
  }

  const pmLoan       = pmModal      ? loans.find(l => l.id === pmModal)      : null;
  const payDaysLoan  = payDaysModal ? loans.find(l => l.id === payDaysModal) : null;

  return (
    <div className="fp-wrap">
      <style>{CSS}</style>

      {/* Header */}
      <div className="fp-topbar">
        <div>
          <h1 style={{ margin:0, fontSize:18, fontWeight:900 }}>Financial Management</h1>
          <p style={{ margin:0, fontSize:12, color:'#64748b' }}>
            {loans.length} loan{loans.length!==1?'s':''} · {activeLoans.length} active
            {totalPrincipal > 0 && ` · Principal: ${fmtCur(totalPrincipal)}`}
          </p>
        </div>
        <div style={{ display:'flex', gap:8, alignItems:'center' }}>
          {saveStatus && (
            <span style={{ fontSize:11, color: saveStatus==='error'?'#dc2626':'#15803d' }}>
              {saveStatus==='saving'?'Saving…':saveStatus==='saved'?'Saved ✓':'Save Error'}
            </span>
          )}
          <button className="btn btn-primary btn-sm" onClick={()=>saveToFirestore(loans)}>💾 Save All</button>
        </div>
      </div>

      {/* Tab Bar */}
      <div className="fp-tabs">
        {TABS.map(t => (
          <button key={t.key} className={`fp-tab${activeTab===t.key?' fp-tab-active':''}`} onClick={()=>setActiveTab(t.key)}>
            {t.label}
          </button>
        ))}
      </div>

      {/* Body */}
      <div className="fp-body">
        {activeTab === 'loans'    && <LoansTab />}
        {activeTab === 'schedule' && <ScheduleTab />}
        {activeTab === 'summary'  && <SummaryTab />}
        {activeTab === 'calendar' && <CalendarTab />}
        {activeTab === 'payment'  && <PaymentTab />}
      </div>

      {/* Payment Method Modal */}
      {pmLoan && (
        <div className="backdrop" onClick={e=>e.target===e.currentTarget&&setPmModal(null)}>
          <div className="modal">
            <div className="modal-h">
              <strong>Payment Method — {pmLoan.name||`Loan ${pmLoan.id}`}</strong>
              <button className="btn btn-ghost btn-sm" onClick={()=>setPmModal(null)}>✕</button>
            </div>
            <div className="modal-b">
              <div style={{ display:'flex', gap:8, marginBottom:16 }}>
                {['Check','Auto-Debit','Bank Transfer'].map(pm => (
                  <button key={pm} className={`btn btn-sm ${(pmLoan.paymentMethod||'Check')===pm?'btn-primary':'btn-ghost'}`}
                    onClick={()=>updateLoan(pmLoan.id,'paymentMethod',pm)}>{pm}</button>
                ))}
              </div>
              {(pmLoan.paymentMethod||'Check') === 'Check' && (
                <div className="field">
                  <label>Check Series / Bank Account Numbers</label>
                  <input
                    value={(pmLoan.pmChecks||[]).join(', ')}
                    onChange={e=>updateLoan(pmLoan.id,'pmChecks',e.target.value.split(',').map(s=>s.trim()).filter(Boolean))}
                    placeholder="e.g. BDO-001, BPI-002"
                  />
                </div>
              )}
              {pmLoan.paymentMethod === 'Auto-Debit' && (
                <div className="grid4">
                  <div className="field col2">
                    <label>Debit Day of Month</label>
                    <input type="number" min="1" max="31" value={pmLoan.pmAdaDay||''} onChange={e=>updateLoan(pmLoan.id,'pmAdaDay',e.target.value)} />
                  </div>
                  <div className="field col2">
                    <label>Bank / Account</label>
                    <input value={pmLoan.pmAdaBank||''} onChange={e=>updateLoan(pmLoan.id,'pmAdaBank',e.target.value)} />
                  </div>
                </div>
              )}
              {pmLoan.paymentMethod === 'Bank Transfer' && (
                <div className="field">
                  <label>Bank / Account for Transfer</label>
                  <input value={pmLoan.pmBtBank||''} onChange={e=>updateLoan(pmLoan.id,'pmBtBank',e.target.value)} />
                </div>
              )}
              <div style={{ marginTop:16, display:'flex', alignItems:'center', gap:10 }}>
                <input type="checkbox" id="fpAutoVoucher" checked={!!pmLoan.pmAutoVoucher}
                  onChange={e=>updateLoan(pmLoan.id,'pmAutoVoucher',e.target.checked)} />
                <label htmlFor="fpAutoVoucher" style={{ fontSize:13, fontWeight:600, cursor:'pointer' }}>
                  Auto-Voucher (auto-generate payment voucher on due date)
                </label>
              </div>
            </div>
            <div className="modal-f">
              <button className="btn btn-ghost" onClick={()=>setPmModal(null)}>Close</button>
              <button className="btn btn-primary" onClick={()=>{ saveToFirestore(loans); setPmModal(null); showToast('Payment method saved.'); }}>Save</button>
            </div>
          </div>
        </div>
      )}

      {/* Pay Days Modal */}
      {payDaysLoan && (
        <div className="backdrop" onClick={e=>e.target===e.currentTarget&&setPayDaysModal(null)}>
          <div className="modal" style={{ width:'min(500px,98vw)' }}>
            <div className="modal-h">
              <strong>Semi-Monthly Pay Days — {payDaysLoan.name||`Loan ${payDaysLoan.id}`}</strong>
              <button className="btn btn-ghost btn-sm" onClick={()=>setPayDaysModal(null)}>✕</button>
            </div>
            <div className="modal-b">
              <div style={{ display:'flex', gap:8, marginBottom:16 }}>
                {['Fixed','Custom'].map(mode => (
                  <button key={mode}
                    className={`btn btn-sm ${(payDaysLoan.payDayMode||'Fixed')===mode?'btn-primary':'btn-ghost'}`}
                    onClick={()=>updateLoan(payDaysLoan.id,'payDayMode',mode)}>{mode}</button>
                ))}
              </div>
              {(payDaysLoan.payDayMode||'Fixed') === 'Fixed' ? (
                <div className="field">
                  <label>Two Pay Days (comma-separated, e.g. 15, 30)</label>
                  <input value={payDaysLoan.payDays||''} onChange={e=>updateLoan(payDaysLoan.id,'payDays',e.target.value)} placeholder="15, 30" />
                </div>
              ) : (
                <div>
                  <p style={{ fontSize:12, color:'#64748b', marginTop:0 }}>
                    Enter custom pay days per month (e.g. "15, 30"). Leave blank to skip that month.
                  </p>
                  {MONTH_NAMES.map((mn, mi) => {
                    const yr  = calYear;
                    const key = yr + '-' + String(mi+1).padStart(2,'0');
                    return (
                      <div key={key} style={{ display:'flex', alignItems:'center', gap:10, marginBottom:8 }}>
                        <span style={{ width:36, fontSize:12, fontWeight:700 }}>{mn}</span>
                        <input style={{ flex:1, border:'1px solid #e5e7eb', borderRadius:8, padding:'6px 10px', fontSize:12 }}
                          placeholder="15, 30"
                          value={(payDaysLoan.payDaysPerMonth||{})[key]||''}
                          onChange={e=>updateLoan(payDaysLoan.id,'payDaysPerMonth',{...(payDaysLoan.payDaysPerMonth||{}),[key]:e.target.value})}
                        />
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
            <div className="modal-f">
              <button className="btn btn-ghost" onClick={()=>setPayDaysModal(null)}>Close</button>
              <button className="btn btn-primary" onClick={()=>{ saveToFirestore(loans); setPayDaysModal(null); showToast('Pay days saved.'); }}>Save</button>
            </div>
          </div>
        </div>
      )}

      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}

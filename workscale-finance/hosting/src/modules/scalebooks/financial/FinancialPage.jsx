import { useState, useEffect, useRef, useCallback } from 'react';
import { doc, getDoc, setDoc, serverTimestamp, collection, addDoc, getDocs } from 'firebase/firestore';
import { db, auth } from '../../../firebase.js';
import AccountCombobox from '../../../components/AccountCombobox.jsx';

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

/* Build pay-days month list: [{key:'YYYY-MM', label:'Mon-YYYY'}] starting from disbursementDate for termMonths */
function buildPayDaysMonths(loan) {
  if (!loan.disbursementDate || !loan.termMonths) return [];
  const start = new Date(loan.disbursementDate);
  if (isNaN(start.getTime())) return [];
  const months = [];
  for (let i = 0; i < loan.termMonths; i++) {
    const d = new Date(start.getFullYear(), start.getMonth() + i, 1);
    const key = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
    const label = MONTH_NAMES[d.getMonth()] + '-' + d.getFullYear();
    months.push({ key, label });
  }
  return months;
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
  .backdrop  { position:fixed; inset:0; background:rgba(15,23,42,.45); display:flex; align-items:center; justify-content:center; padding:16px; z-index:100; }
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
  const [confirmModal, setConfirmModal] = useState(null);
  const [pdFillD1, setPdFillD1]         = useState('');
  const [pdFillD2, setPdFillD2]         = useState('');
  const [calDayModal,     setCalDayModal]     = useState(null); // { day, month, year, events } — preview
  const [calVoucherModal, setCalVoucherModal] = useState(null); // { day, month, year, events } — full form
  const [calAccounts, setCalAccounts]     = useState([]);
  const [vForm,        setVForm]          = useState({});
  const [vLines,       setVLines]         = useState([]);
  const [vSaving,      setVSaving]        = useState(false);
  const saveTimerRef = useRef(null);

  const showToast = (msg) => { setToast(msg); setTimeout(() => setToast(''), 3000); };
  const askConfirm = (message, onConfirm) => setConfirmModal({ message, onConfirm });

  /* ── Firestore ─────────────────────────────────────────────────── */
  useEffect(() => {
    getDoc(doc(db, 'finc', 'profile')).then(snap => {
      const data = snap.data() || {};
      const ls = Array.isArray(data.loans) ? data.loans : [];
      setLoans(ls);
      setNextId(ls.reduce((m, l) => Math.max(m, l.id || 0), 0) + 1);
    });
    getDocs(collection(db, 'accounts')).then(s =>
      setCalAccounts(s.docs.map(d => ({ id: d.id, ...d.data() })))
    );
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
    setLoans(prev => prev.map(l => l.id === id ? { ...l, [field]: value } : l));
  }, []);

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
      return [...prev, newLoan];
    });
  }, [])

  const deleteLoan = useCallback((id) => {
    askConfirm('Delete this loan?', () => {
      setLoans(prev => {
        const next = prev.filter(l => l.id !== id);
        debounceSave(next);
        return next;
      });
    });
  }, [debounceSave, setConfirmModal]);

  const activeLoans    = loans.filter(l => l.status === 'Active');
  const totalPrincipal = activeLoans.reduce((s, l) => s + (parseFloat(l.principal) || 0), 0);
  const totalInterest  = activeLoans.reduce((s, l) => s + loanTotalInterest(l), 0);

  /* ── Build voucher lines from calendar day events ──────────────── */
  const buildVoucherLines = useCallback((day, month, year, dayEvts, accounts) => {
    const monthLabel = MONTH_NAMES[month] + '-' + year;
    const fcAcct = accounts.find(a => (a.name||'').toLowerCase().includes('finance cost'));
    const lpAcct = accounts.find(a => (a.name||'').toLowerCase().includes('loans payable'));
    const lines = [];
    dayEvts.forEach(e => {
      const loanDesc = `${e.loan.name||`Loan ${e.loan.id}`} (${e.loan.loanType||'Term Loan'} \u2022 ${e.loan.interestMethod||'Reducing Balance'}) ${monthLabel} (Day ${day})`;
      if (e.interest > 0) lines.push({
        id: Math.random().toString(36).slice(2,9),
        contact: e.loan.name || `Loan ${e.loan.id}`,
        expenseAccount: fcAcct ? (fcAcct.code || fcAcct.id) : '',
        description: `Interest Payment \u2013 ${loanDesc}`,
        amount: String(parseFloat(e.interest.toFixed(2))),
        _type: 'interest',
      });
      if (e.principal > 0) lines.push({
        id: Math.random().toString(36).slice(2,9),
        contact: e.loan.name || `Loan ${e.loan.id}`,
        expenseAccount: lpAcct ? (lpAcct.code || lpAcct.id) : '',
        description: `Principal Payment \u2013 ${loanDesc}`,
        amount: String(parseFloat(e.principal.toFixed(2))),
        _type: 'principal',
      });
    });
    return lines;
  }, []);

  const openCalVoucher = useCallback((day, month, year, dayEvts) => {
    const dateStr = `${year}-${String(month+1).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
    const monthLabel = MONTH_NAMES[month] + '-' + year;
    setVForm({
      voucherType: 'LOAN',
      preparationDate: dateStr,
      purposeCategory: 'Loan Payment',
      paymentFrom: '',
      notes: `Loan amortization for ${monthLabel}`,
    });
    setVLines(buildVoucherLines(day, month, year, dayEvts, calAccounts));
    setCalVoucherModal({ day, month, year, events: dayEvts });
  }, [calAccounts, buildVoucherLines]);

  const saveCalVoucher = useCallback(async (status) => {
    setVSaving(true);
    try {
      const user = auth.currentUser?.email || '';
      const totalAmount = vLines.reduce((s,l) => s + (Number(l.amount)||0), 0);
      const contactSummary = [...new Set(vLines.map(l=>l.contact).filter(Boolean))].join(', ');
      const d = new Date();
      const periodKey = `LV${d.getFullYear()}${String(d.getMonth()+1).padStart(2,'0')}`;
      const voucherId = `${periodKey}-${String(Math.floor(Math.random()*9000)+1000)}`;
      await addDoc(collection(db,'vouchers'), {
        voucherId,
        voucherType: vForm.voucherType || 'LOAN',
        preparationDate: vForm.preparationDate,
        purposeCategory: vForm.purposeCategory,
        paymentFromAccountCode: vForm.paymentFrom,
        contactSummary,
        totalAmount,
        status,
        notes: vForm.notes || '',
        lines: vLines.map((l,i) => ({
          lineNo: i+1,
          contact: l.contact,
          expenseAccountCode: l.expenseAccount,
          description: l.description,
          amount: Number(l.amount)||0,
          category: l._type === 'interest' ? 'Finance Cost' : l._type === 'principal' ? 'Loans Payable' : '',
          taxType: 'N/A', taxRate: 0, taxAmt: 0, inclusive: false,
        })),
        createdAt: serverTimestamp(), createdBy: user,
        updatedAt: serverTimestamp(), updatedBy: user,
      });
      showToast(`Voucher ${voucherId} ${status === 'Pending' ? 'saved as draft' : 'submitted for approval'}.`);
      setCalVoucherModal(null);
    } catch(e) { showToast('Error: ' + e.message); }
    setVSaving(false);
  }, [vForm, vLines]);

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
                        ? <button className="pill pill-sm" onClick={()=>{setPayDaysModal(l.id);setPdFillD1('');setPdFillD2('');}} style={{cursor:'pointer',background:'#f0f9ff',borderColor:'#bae6fd',color:'#0284c7',border:'1px solid'}}>
                            {l.payDayMode==='Variable per Month' ? 'Variable' : (l.payDay1&&l.payDay2 ? `${l.payDay1}/${l.payDay2}` : l.payDays||'Set')}
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

    if (active.length === 0) return <div className="empty">No active loans with disbursement dates.</div>;

    // Sticky column styles
    const stickyName   = { position:'sticky', left:0,   minWidth:160, background:'inherit', zIndex:1, whiteSpace:'nowrap' };
    const stickySeries = { position:'sticky', left:160, minWidth:100, background:'inherit', zIndex:1, whiteSpace:'nowrap' };
    const stickyNameHd = { position:'sticky', left:0,   minWidth:160, background:'#f8fafc', zIndex:2, textAlign:'left' };
    const stickySerHd  = { position:'sticky', left:160, minWidth:100, background:'#f8fafc', zIndex:2, textAlign:'left' };

    // Dot indicator shared
    const dot = (l) => (
      <span style={{ display:'inline-block', width:8, height:8, borderRadius:'50%',
        background: l.status==='Active' ? '#f97316' : '#cbd5e1', marginRight:6, flexShrink:0 }} />
    );

    // Section header row
    const SectionHdr = ({ bg, border, label }) => (
      <tr>
        <td colSpan={2 + filtered.length}
          style={{ background:bg, color:'#fff', fontWeight:900, padding:'7px 10px',
            letterSpacing:'.05em', fontSize:12, borderTop:`2px solid ${border}` }}>
          {label}
        </td>
      </tr>
    );

    // Subtotal row
    const SubtotalRow = ({ bg, label, getValue }) => (
      <tr>
        <td colSpan={2}
          style={{ fontWeight:900, background:bg, color:'#fff', padding:'8px 10px',
            fontSize:11, letterSpacing:'.04em', ...stickyName }}>
          {label}
        </td>
        {filtered.map(mo => {
          const total = active.reduce((s, l) => { const r = schedMap[l.id]?.[mo]; return s + (r ? getValue(r) : 0); }, 0);
          return (
            <td key={mo} style={{ textAlign:'right', fontWeight:900, background:bg, color:'#fff', padding:'8px 8px' }}>
              {total > 0 ? fmtPHP(total) : '—'}
            </td>
          );
        })}
      </tr>
    );

    return (
      <div>
        {/* Year filter buttons */}
        <div style={{ display:'flex', gap:8, marginBottom:14, flexWrap:'wrap' }}>
          {['all', ...years].map(y => (
            <button key={y} className={`btn btn-sm ${scheduleYear===String(y)?'btn-primary':'btn-ghost'}`}
              onClick={()=>setScheduleYear(String(y))}>
              {y === 'all' ? 'All Years' : y}
            </button>
          ))}
        </div>

        <div style={{ overflowX:'auto' }}>
          <table style={{ fontSize:11, borderCollapse:'collapse', width:'100%' }}>
            <thead>
              <tr>
                <th style={stickyNameHd}>LOAN / FACILITY</th>
                <th style={stickySerHd}>SERIES</th>
                {filtered.map(mo => (
                  <th key={mo} style={{ textAlign:'right', minWidth:96, whiteSpace:'nowrap' }}>{mo}</th>
                ))}
              </tr>
            </thead>
            <tbody>

              {/* ── Section 1: FINANCE COST — INTEREST ── */}
              <SectionHdr bg="#7f1d1d" border="#450a0a" label="FINANCE COST — INTEREST" />
              {active.map(l => (
                <tr key={'int-' + l.id} style={{ background:'#fff' }}>
                  <td style={{ ...stickyName, fontWeight:700, background:'#fff' }}>{dot(l)}{l.name || `Loan ${l.id}`}</td>
                  <td style={{ ...stickySeries, color:'#94a3b8', background:'#fff' }}>Finance Cost</td>
                  {filtered.map(mo => {
                    const r = schedMap[l.id]?.[mo];
                    return (
                      <td key={mo} style={{ textAlign:'right', color: r ? '#dc2626' : '#d1d5db', padding:'7px 8px' }}>
                        {r ? fmtPHP(r.interest) : '—'}
                      </td>
                    );
                  })}
                </tr>
              ))}
              <SubtotalRow bg="#991b1b" label="TOTAL FINANCE COST" getValue={r => r.interest} />

              {/* ── Section 2: PRINCIPAL PAYMENT ── */}
              <SectionHdr bg="#1e3a8a" border="#172554" label="PRINCIPAL PAYMENT" />
              {active.map(l => (
                <tr key={'pri-' + l.id} style={{ background:'#fff' }}>
                  <td style={{ ...stickyName, fontWeight:700, background:'#fff' }}>{dot(l)}{l.name || `Loan ${l.id}`}</td>
                  <td style={{ ...stickySeries, color:'#94a3b8', background:'#fff' }}>Principal</td>
                  {filtered.map(mo => {
                    const r = schedMap[l.id]?.[mo];
                    return (
                      <td key={mo} style={{ textAlign:'right', color: r ? '#2563eb' : '#d1d5db', padding:'7px 8px' }}>
                        {r ? fmtPHP(r.principal) : '—'}
                      </td>
                    );
                  })}
                </tr>
              ))}
              <SubtotalRow bg="#1e3a8a" label="TOTAL PRINCIPAL PAYMENT" getValue={r => r.principal} />

              {/* ── Section 3: TOTAL PAYMENT — INTEREST + PRINCIPAL ── */}
              <SectionHdr bg="#1e293b" border="#0f172a" label="TOTAL PAYMENT — INTEREST + PRINCIPAL" />
              {active.map(l => (
                <tr key={'tot-' + l.id} style={{ background:'#fff' }}>
                  <td style={{ ...stickyName, fontWeight:700, background:'#fff' }}>{dot(l)}{l.name || `Loan ${l.id}`}</td>
                  <td style={{ ...stickySeries, color:'#94a3b8', background:'#fff' }}>Total Pmt</td>
                  {filtered.map(mo => {
                    const r = schedMap[l.id]?.[mo];
                    return (
                      <td key={mo} style={{ textAlign:'right', color: r ? '#0f172a' : '#d1d5db', fontWeight: r ? 700 : 400, padding:'7px 8px' }}>
                        {r ? fmtPHP(r.principal + r.interest) : '—'}
                      </td>
                    );
                  })}
                </tr>
              ))}

            </tbody>
            <tfoot>
              {/* Grand Total Payment */}
              <tr>
                <td colSpan={2}
                  style={{ fontWeight:900, background:'#0f172a', color:'#fff', padding:'9px 10px',
                    fontSize:11, letterSpacing:'.04em', ...stickyName }}>
                  GRAND TOTAL PAYMENT
                </td>
                {filtered.map(mo => {
                  const total = active.reduce((s, l) => { const r = schedMap[l.id]?.[mo]; return s + (r ? r.principal + r.interest : 0); }, 0);
                  return (
                    <td key={mo} style={{ textAlign:'right', fontWeight:900, background:'#0f172a', color:'#fff', padding:'9px 8px' }}>
                      {total > 0 ? fmtPHP(total) : '—'}
                    </td>
                  );
                })}
              </tr>
            </tfoot>
          </table>
        </div>
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
      const add = (day, principal, interest) => {
        if (!events[day]) events[day] = [];
        events[day].push({ loan: l, principal, interest });
      };
      if (l.paymentFrequency === 'Semi-Monthly') {
        const key   = calYear + '-' + String(calMonth+1).padStart(2,'0');
        const halfP = row.principal / 2, halfI = row.interest / 2;
        const days  = [];
        if (l.payDayMode === 'Variable per Month') {
          const perMonth = l.payDaysPerMonth?.[key] || {};
          const d1 = parseInt(perMonth.d1), d2 = parseInt(perMonth.d2);
          if (d1 >= 1 && d1 <= 31) days.push(d1);
          if (d2 >= 1 && d2 <= 31) days.push(d2);
          // fall back to fixed days if this month has no entries yet
          if (days.length === 0) {
            const f1 = parseInt(l.payDay1), f2 = parseInt(l.payDay2);
            if (f1 >= 1 && f1 <= 31) days.push(f1);
            if (f2 >= 1 && f2 <= 31) days.push(f2);
          }
        } else {
          // Fixed mode — use payDay1 / payDay2
          const d1 = parseInt(l.payDay1), d2 = parseInt(l.payDay2);
          if (d1 >= 1 && d1 <= 31) days.push(d1);
          if (d2 >= 1 && d2 <= 31) days.push(d2);
          if (days.length === 0) { days.push(15); days.push(30); } // default fallback
        }
        days.forEach(d => add(d, halfP, halfI));
      } else {
        const day = l.disbursementDate ? new Date(l.disbursementDate).getDate() : 1;
        add(day, row.principal, row.interest);
      }
    });

    const daysInMonth = new Date(calYear, calMonth+1, 0).getDate();
    const firstDow    = new Date(calYear, calMonth, 1).getDay();
    const cells = [...Array(firstDow).fill(null), ...Array.from({length:daysInMonth},(_,i)=>i+1)];
    while (cells.length % 7) cells.push(null);
    const weeks = Array.from({length:cells.length/7},(_,i)=>cells.slice(i*7,i*7+7));
    const todayD = new Date();
    const DOW = ['SUN','MON','TUE','WED','THU','FRI','SAT'];

    // Month totals
    const monthInt = Object.values(events).flat().reduce((s,e)=>s+e.interest,0);
    const monthPri = Object.values(events).flat().reduce((s,e)=>s+e.principal,0);

    return (
      <div style={{ display:'flex', flexDirection:'column', gap:0 }}>
        {/* Navigation */}
        <div style={{ display:'flex', alignItems:'center', gap:10, marginBottom:14 }}>
          <button className="btn btn-ghost btn-sm" onClick={prevM}>‹</button>
          <span style={{ fontWeight:900, fontSize:18, minWidth:130 }}>{MONTH_NAMES[calMonth]} {calYear}</span>
          <button className="btn btn-ghost btn-sm" onClick={nextM}>›</button>
          <span style={{ marginLeft:'auto', fontSize:12, color:'#64748b' }}>
            {Object.values(events).flat().length} payment{Object.values(events).flat().length!==1?'s':''} this month
          </span>
        </div>

        {/* Day-of-week header */}
        <div style={{ display:'grid', gridTemplateColumns:'repeat(7,1fr)', gap:2, marginBottom:2 }}>
          {DOW.map(d => (
            <div key={d} style={{ textAlign:'center', fontWeight:800, fontSize:10, color:'#94a3b8',
              padding:'5px 0', textTransform:'uppercase', letterSpacing:'.06em' }}>{d}</div>
          ))}
        </div>

        {/* Weeks */}
        {weeks.map((week, wi) => {
          // Week summary
          const weekEvts = week.filter(Boolean).flatMap(d => events[d]||[]);
          const wInt = weekEvts.reduce((s,e)=>s+e.interest,0);
          const wPri = weekEvts.reduce((s,e)=>s+e.principal,0);
          const wTot = wInt + wPri;
          const weekNum = wi + 1;
          return (
            <div key={wi}>
              {/* Week summary bar */}
              <div style={{ display:'flex', alignItems:'center', background:'#f0f9ff',
                border:'1px solid #e0f2fe', borderRadius:8, padding:'5px 12px', marginBottom:2,
                fontSize:11, fontWeight:700, gap:16, flexWrap:'wrap' }}>
                <span style={{ color:'#0369a1', fontWeight:900 }}>WEEK {weekNum}</span>
                {wInt > 0 && <span style={{ color:'#dc2626' }}>Int {fmtCur(wInt)}</span>}
                {wPri > 0 && <span style={{ color:'#2563eb' }}>Pri {fmtCur(wPri)}</span>}
                {wTot > 0 && <span style={{ marginLeft:'auto', color:'#0f172a' }}>Total {fmtCur(wTot)}</span>}
              </div>

              {/* Day cells */}
              <div style={{ display:'grid', gridTemplateColumns:'repeat(7,1fr)', gap:2, marginBottom:4 }}>
                {week.map((day, di) => {
                  if (!day) return <div key={di} style={{ minHeight:72 }} />;
                  const dayEvts  = events[day] || [];
                  const dayInt   = dayEvts.reduce((s,e)=>s+e.interest,0);
                  const dayPri   = dayEvts.reduce((s,e)=>s+e.principal,0);
                  const isToday  = day===todayD.getDate()&&calMonth===todayD.getMonth()&&calYear===todayD.getFullYear();
                  const hasEvts  = dayEvts.length > 0;
                  return (
                    <div key={di}
                      onClick={() => hasEvts && setCalDayModal({ day, month: calMonth, year: calYear, events: dayEvts })}
                      style={{
                        minHeight:72, background:'#fff', border:`1px solid ${isToday?'#f97316':'#e5e7eb'}`,
                        borderRadius:8, padding:'6px 7px', cursor: hasEvts ? 'pointer' : 'default',
                        transition:'box-shadow .15s',
                        boxShadow: hasEvts ? '0 1px 4px rgba(0,0,0,.06)' : 'none',
                      }}
                      onMouseEnter={e => { if(hasEvts) e.currentTarget.style.boxShadow='0 3px 10px rgba(249,115,22,.18)'; }}
                      onMouseLeave={e => { e.currentTarget.style.boxShadow= hasEvts ? '0 1px 4px rgba(0,0,0,.06)' : 'none'; }}
                    >
                      <div style={{ fontWeight:700, fontSize:12, marginBottom:3,
                        color: isToday ? '#f97316' : '#0b1220' }}>{day}</div>
                      {hasEvts && (
                        <>
                          {dayInt > 0 && <div style={{ fontSize:10, color:'#dc2626', fontWeight:700 }}>Int {fmtCur(dayInt)}</div>}
                          {dayPri > 0 && <div style={{ fontSize:10, color:'#2563eb', fontWeight:700 }}>Pri {fmtCur(dayPri)}</div>}
                          <div style={{ fontSize:10, color:'#64748b', marginTop:2 }}>
                            {dayEvts.length} loan{dayEvts.length!==1?'s':''}
                          </div>
                        </>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}

        {/* Month Total footer */}
        {(monthInt > 0 || monthPri > 0) && (
          <div style={{ display:'flex', gap:24, alignItems:'center', background:'#0f172a', color:'#fff',
            borderRadius:10, padding:'12px 20px', marginTop:8, flexWrap:'wrap', fontSize:13 }}>
            <span style={{ fontWeight:800, color:'#94a3b8', letterSpacing:'.05em', fontSize:11 }}>MONTH TOTAL</span>
            <span>Interest <strong style={{ color:'#fca5a5' }}>{fmtCur(monthInt)}</strong></span>
            <span>Principal <strong style={{ color:'#93c5fd' }}>{fmtCur(monthPri)}</strong></span>
            <span style={{ marginLeft:'auto' }}>Total <strong>{fmtCur(monthInt+monthPri)}</strong></span>
          </div>
        )}
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
        {activeTab === 'loans'    && LoansTab()}
        {activeTab === 'schedule' && ScheduleTab()}
        {activeTab === 'summary'  && SummaryTab()}
        {activeTab === 'calendar' && CalendarTab()}
        {activeTab === 'payment'  && PaymentTab()}
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
      {payDaysLoan && (() => {
        const pdMonths = buildPayDaysMonths(payDaysLoan);
        const pdm      = payDaysLoan.payDaysPerMonth || {};
        const pdMode   = payDaysLoan.payDayMode || 'Fixed';
        const getCell  = (key, col) => (pdm[key]?.[col]) || '';
        const setCell  = (key, col, val) => updateLoan(payDaysLoan.id, 'payDaysPerMonth', { ...pdm, [key]: { ...(pdm[key]||{}), [col]: val } });
        const closePd  = () => { setPayDaysModal(null); setPdFillD1(''); setPdFillD2(''); };
        return (
          <div className="backdrop" onClick={e=>e.target===e.currentTarget&&closePd()}>
            <div className="modal" style={{width:'min(500px,98vw)'}}>

              {/* Orange banner */}
              <div style={{background:'#f97316',color:'#fff',padding:'16px 20px',flexShrink:0,borderRadius:'16px 16px 0 0'}}>
                <div style={{display:'flex',alignItems:'center',justifyContent:'space-between'}}>
                  <strong style={{fontSize:16,fontWeight:900}}>📅 Pay Days</strong>
                  <button onClick={closePd} style={{background:'rgba(255,255,255,.25)',border:'none',color:'#fff',borderRadius:8,width:28,height:28,cursor:'pointer',fontSize:14,fontWeight:900,display:'flex',alignItems:'center',justifyContent:'center'}}>✕</button>
                </div>
                <div style={{fontSize:12,opacity:.85,marginTop:4,fontWeight:600}}>{payDaysLoan.name||`Loan ${payDaysLoan.id}`}</div>
              </div>

              {/* Mode toggle bar */}
              <div style={{display:'flex',alignItems:'center',gap:10,padding:'14px 20px',borderBottom:'1px solid #e5e7eb',background:'#fff'}}>
                <span style={{fontSize:12,fontWeight:800,color:'#64748b',letterSpacing:'.04em'}}>MODE:</span>
                {['Fixed','Variable per Month'].map(m => (
                  <button key={m}
                    onClick={()=>updateLoan(payDaysLoan.id,'payDayMode',m)}
                    style={{border:`2px solid ${pdMode===m?'#f97316':'#e5e7eb'}`,borderRadius:10,padding:'6px 14px',fontWeight:700,fontSize:12,cursor:'pointer',fontFamily:'inherit',background:pdMode===m?'#f97316':'#fff',color:pdMode===m?'#fff':'#64748b',transition:'all .15s'}}>
                    {m}
                  </button>
                ))}
              </div>

              {/* Body */}
              <div className="modal-b" style={{padding:'18px 20px'}}>
                {pdMode === 'Fixed' ? (
                  <div>
                    <p style={{margin:'0 0 16px',fontSize:13,color:'#64748b'}}>Same two pay days every month.</p>
                    <div style={{display:'flex',alignItems:'flex-end',gap:14}}>
                      <div className="field" style={{flex:1}}>
                        <label>DAY 1</label>
                        <input className="tbl-inp" type="number" min="1" max="31" placeholder="e.g. 15"
                          style={{textAlign:'center',fontSize:18,fontWeight:800,padding:'10px 8px'}}
                          value={payDaysLoan.payDay1||''}
                          onChange={e=>updateLoan(payDaysLoan.id,'payDay1',e.target.value)} />
                      </div>
                      <span style={{fontSize:24,color:'#cbd5e1',paddingBottom:10,fontWeight:300}}>/</span>
                      <div className="field" style={{flex:1}}>
                        <label>DAY 2</label>
                        <input className="tbl-inp" type="number" min="1" max="31" placeholder="e.g. 30"
                          style={{textAlign:'center',fontSize:18,fontWeight:800,padding:'10px 8px'}}
                          value={payDaysLoan.payDay2||''}
                          onChange={e=>updateLoan(payDaysLoan.id,'payDay2',e.target.value)} />
                      </div>
                    </div>
                  </div>
                ) : (
                  <div>
                    <p style={{margin:'0 0 12px',fontSize:12,color:'#64748b'}}>
                      Set specific days per month. Use <strong>Fill All</strong> to apply a day to every month at once.
                    </p>
                    {pdMonths.length === 0 ? (
                      <div style={{color:'#94a3b8',fontSize:12,textAlign:'center',padding:'24px 0'}}>
                        Set a First Payment date and Term (months) in the Loan Registry first.
                      </div>
                    ) : (
                      <table style={{width:'100%',borderCollapse:'collapse'}}>
                        <thead>
                          <tr>
                            <th style={{textAlign:'left',fontSize:10,fontWeight:800,color:'#64748b',letterSpacing:'.05em',textTransform:'uppercase',padding:'8px 10px',background:'#f8fafc',borderBottom:'2px solid #e5e7eb'}}>MONTH</th>
                            <th style={{textAlign:'center',fontSize:10,fontWeight:800,color:'#64748b',letterSpacing:'.05em',textTransform:'uppercase',padding:'8px 10px',background:'#f8fafc',borderBottom:'2px solid #e5e7eb'}}>Day 1</th>
                            <th style={{textAlign:'center',fontSize:10,fontWeight:800,color:'#64748b',letterSpacing:'.05em',textTransform:'uppercase',padding:'8px 10px',background:'#f8fafc',borderBottom:'2px solid #e5e7eb'}}>Day 2</th>
                          </tr>
                          {/* Fill All row */}
                          <tr style={{background:'#fffbeb'}}>
                            <td style={{padding:'6px 10px',borderBottom:'2px solid #fde68a',fontSize:12,fontWeight:700,color:'#92400e'}}>Fill All →</td>
                            <td style={{padding:'5px 8px',borderBottom:'2px solid #fde68a',textAlign:'center'}}>
                              <input type="number" min="1" max="31" placeholder="Day"
                                style={{border:'2px dashed #fbbf24',borderRadius:8,padding:'5px 0',fontSize:13,width:72,textAlign:'center',fontFamily:'inherit',background:'#fffbeb',boxSizing:'border-box'}}
                                value={pdFillD1}
                                onChange={e=>{ const v=e.target.value; setPdFillD1(v); const u={...pdm}; pdMonths.forEach(({key})=>{u[key]={...(u[key]||{}),d1:v}}); updateLoan(payDaysLoan.id,'payDaysPerMonth',u); }} />
                            </td>
                            <td style={{padding:'5px 8px',borderBottom:'2px solid #fde68a',textAlign:'center'}}>
                              <input type="number" min="1" max="31" placeholder="Day"
                                style={{border:'2px dashed #fbbf24',borderRadius:8,padding:'5px 0',fontSize:13,width:72,textAlign:'center',fontFamily:'inherit',background:'#fffbeb',boxSizing:'border-box'}}
                                value={pdFillD2}
                                onChange={e=>{ const v=e.target.value; setPdFillD2(v); const u={...pdm}; pdMonths.forEach(({key})=>{u[key]={...(u[key]||{}),d2:v}}); updateLoan(payDaysLoan.id,'payDaysPerMonth',u); }} />
                            </td>
                          </tr>
                        </thead>
                        <tbody>
                          {pdMonths.map(({key,label}) => (
                            <tr key={key}>
                              <td style={{padding:'5px 10px',borderBottom:'1px solid #f1f5f9',fontSize:12,fontWeight:700}}>{label}</td>
                              <td style={{padding:'5px 8px',borderBottom:'1px solid #f1f5f9',textAlign:'center'}}>
                                <input type="number" min="1" max="31" placeholder="D1"
                                  style={{border:'1px solid #e5e7eb',borderRadius:8,padding:'5px 0',fontSize:12,width:72,textAlign:'center',fontFamily:'inherit',boxSizing:'border-box'}}
                                  value={getCell(key,'d1')}
                                  onChange={e=>setCell(key,'d1',e.target.value)} />
                              </td>
                              <td style={{padding:'5px 8px',borderBottom:'1px solid #f1f5f9',textAlign:'center'}}>
                                <input type="number" min="1" max="31" placeholder="D2"
                                  style={{border:'1px solid #e5e7eb',borderRadius:8,padding:'5px 0',fontSize:12,width:72,textAlign:'center',fontFamily:'inherit',boxSizing:'border-box'}}
                                  value={getCell(key,'d2')}
                                  onChange={e=>setCell(key,'d2',e.target.value)} />
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                  </div>
                )}
              </div>

              <div className="modal-f">
                <button className="btn btn-primary" onClick={()=>{ saveToFirestore(loans); closePd(); showToast('Pay days saved.'); }}>Done</button>
              </div>
            </div>
          </div>
        );
      })()}

      {confirmModal && (
        <div className="backdrop" onClick={() => setConfirmModal(null)}>
          <div style={{width:'min(400px,98vw)',background:'#fff',borderRadius:16,overflow:'hidden',boxShadow:'0 24px 64px rgba(0,0,0,.25)'}} onClick={e=>e.stopPropagation()}>
            <div style={{padding:'14px 18px',borderBottom:'1px solid #e5e7eb',background:'#f8fafc',display:'flex',alignItems:'center',justifyContent:'space-between'}}>
              <strong style={{fontSize:14,fontWeight:900,color:'#0b1220'}}>Confirm Action</strong>
              <button className="btn btn-ghost btn-sm" onClick={()=>setConfirmModal(null)}>✕</button>
            </div>
            <div style={{padding:'18px'}}>
              <p style={{margin:0,fontSize:14,color:'#0b1220',lineHeight:1.5}}>{confirmModal.message}</p>
            </div>
            <div style={{display:'flex',justifyContent:'flex-end',gap:10,padding:'12px 18px',borderTop:'1px solid #e5e7eb'}}>
              <button className="btn btn-ghost" onClick={()=>setConfirmModal(null)}>Cancel</button>
              <button className="btn btn-primary" style={{background:'#dc2626'}} onClick={()=>{confirmModal.onConfirm();setConfirmModal(null);}}>Confirm</button>
            </div>
          </div>
        </div>
      )}

      {/* ── Day Preview Modal ───────────────────────────────────────── */}
      {calDayModal && (() => {
        const { day, month, year, events: dayEvts } = calDayModal;
        const monthLabel = MONTH_NAMES[month] + '-' + year;
        const totalInt = dayEvts.reduce((s,e)=>s+e.interest,0);
        const totalPri = dayEvts.reduce((s,e)=>s+e.principal,0);
        const thS = { padding:'8px 12px', textAlign:'left', fontWeight:800, color:'#64748b',
          fontSize:10, letterSpacing:'.05em', textTransform:'uppercase', background:'#f8fafc' };
        return (
          <div className="backdrop" onClick={e=>e.target===e.currentTarget&&setCalDayModal(null)}>
            <div style={{width:'min(520px,98vw)',background:'#fff',borderRadius:16,overflow:'hidden',boxShadow:'0 24px 64px rgba(0,0,0,.25)',display:'flex',flexDirection:'column'}}>
              {/* Header */}
              <div style={{background:'#f97316',color:'#fff',padding:'16px 20px',display:'flex',alignItems:'center',justifyContent:'space-between'}}>
                <div>
                  <div style={{fontWeight:900,fontSize:16}}>📅 Payment Due</div>
                  <div style={{fontSize:12,opacity:.85,marginTop:3}}>{MONTH_NAMES[month]} {day}, {year} &nbsp;·&nbsp; {dayEvts.length} loan{dayEvts.length!==1?'s':''}</div>
                </div>
                <button onClick={()=>setCalDayModal(null)}
                  style={{background:'rgba(255,255,255,.25)',border:'none',color:'#fff',borderRadius:8,width:28,height:28,cursor:'pointer',fontSize:14,fontWeight:900,display:'flex',alignItems:'center',justifyContent:'center'}}>✕</button>
              </div>
              {/* Loan breakdown */}
              <div style={{padding:'16px 20px',overflowY:'auto'}}>
                <table style={{width:'100%',borderCollapse:'collapse',fontSize:12}}>
                  <thead>
                    <tr>
                      <th style={thS}>Loan / Lender</th>
                      <th style={{...thS,textAlign:'right'}}>Type</th>
                      <th style={{...thS,textAlign:'right',color:'#dc2626'}}>Interest</th>
                      <th style={{...thS,textAlign:'right',color:'#2563eb'}}>Principal</th>
                      <th style={{...thS,textAlign:'right'}}>Total PMT</th>
                    </tr>
                  </thead>
                  <tbody>
                    {dayEvts.map((e,i)=>(
                      <tr key={i} style={{borderTop:'1px solid #f1f5f9'}}>
                        <td style={{padding:'9px 12px',fontWeight:700}}>{e.loan.name||`Loan ${e.loan.id}`}</td>
                        <td style={{padding:'9px 12px',color:'#64748b',fontSize:11}}>{e.loan.loanType||'—'}</td>
                        <td style={{padding:'9px 12px',textAlign:'right',color:'#dc2626',fontWeight:700}}>{fmtCur(e.interest)}</td>
                        <td style={{padding:'9px 12px',textAlign:'right',color:'#2563eb',fontWeight:700}}>{fmtCur(e.principal)}</td>
                        <td style={{padding:'9px 12px',textAlign:'right',fontWeight:900}}>{fmtCur(e.interest+e.principal)}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr style={{borderTop:'2px solid #e5e7eb',background:'#f8fafc'}}>
                      <td colSpan={2} style={{padding:'9px 12px',fontWeight:900}}>TOTAL</td>
                      <td style={{padding:'9px 12px',textAlign:'right',fontWeight:900,color:'#dc2626'}}>{fmtCur(totalInt)}</td>
                      <td style={{padding:'9px 12px',textAlign:'right',fontWeight:900,color:'#2563eb'}}>{fmtCur(totalPri)}</td>
                      <td style={{padding:'9px 12px',textAlign:'right',fontWeight:900}}>{fmtCur(totalInt+totalPri)}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
              {/* Footer */}
              <div style={{display:'flex',justifyContent:'flex-end',gap:10,padding:'14px 20px',borderTop:'1px solid #e5e7eb'}}>
                <button className="btn btn-ghost" onClick={()=>setCalDayModal(null)}>Close</button>
                <button className="btn btn-primary" onClick={()=>{ setCalDayModal(null); openCalVoucher(day, month, year, dayEvts); }}>
                  Create Voucher
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* ── Create Voucher from Calendar (full form) ───────────────── */}
      {calVoucherModal && (() => {
        const { day, month, year, events: dayEvts } = calVoucherModal;
        const monthLabel = MONTH_NAMES[month] + '-' + year;

        const bankAccounts = calAccounts.filter(a =>
          ['Bank','Cash','Cash Equivalents','Cash and Cash Equivalents'].includes(a.subType) ||
          (a.name||'').toLowerCase().includes('cash in bank')
        );

        const reloadLines = () =>
          setVLines(buildVoucherLines(day, month, year, dayEvts, calAccounts));

        const setLine = (idx, key, val) =>
          setVLines(p => p.map((l,i) => i===idx ? {...l,[key]:val} : l));

        const totalAmt = vLines.reduce((s,l) => s + (Number(l.amount)||0), 0);
        const intTotal = vLines.filter(l => l._type==='interest').reduce((s,l)=>s+(Number(l.amount)||0),0);
        const priTotal = vLines.filter(l => l._type==='principal').reduce((s,l)=>s+(Number(l.amount)||0),0);
        const bankAcct = calAccounts.find(a => a.code===vForm.paymentFrom || a.id===vForm.paymentFrom);
        const fcAcctName  = (() => { const a = calAccounts.find(a => a.code===vLines.find(l=>l._type==='interest')?.expenseAccount); return a ? `${a.code} — ${a.name}` : 'Finance Cost'; })();
        const lpAcctName  = (() => { const a = calAccounts.find(a => a.code===vLines.find(l=>l._type==='principal')?.expenseAccount); return a ? `${a.code} — ${a.name}` : 'Loans Payable'; })();
        const bankAcctName = bankAcct ? `${bankAcct.code} — ${bankAcct.name}` : (vForm.paymentFrom || 'Cash / Bank');

        const thS = { padding:'8px 10px', textAlign:'left', fontWeight:800, color:'#64748b',
          fontSize:10, letterSpacing:'.05em', textTransform:'uppercase', background:'#f8fafc' };
        const inpS = { border:'1px solid #e5e7eb', borderRadius:8, padding:'6px 8px', fontSize:12,
          width:'100%', boxSizing:'border-box', fontFamily:'inherit' };

        return (
          <div className="backdrop" onClick={e=>e.target===e.currentTarget&&setCalVoucherModal(null)}>
            <div className="modal" style={{width:'min(960px,98vw)'}}>

              {/* Header */}
              <div className="modal-h">
                <strong style={{fontSize:15,fontWeight:900}}>Create Voucher</strong>
                <button className="btn btn-ghost btn-sm" onClick={()=>setCalVoucherModal(null)}>✕</button>
              </div>

              {/* Body */}
              <div className="modal-b" style={{padding:'20px'}}>

                {/* ── Header fields ── */}
                <div style={{display:'grid',gridTemplateColumns:'repeat(6,1fr)',gap:10,marginBottom:18}}>
                  <div style={{gridColumn:'span 2',display:'flex',flexDirection:'column',gap:5}}>
                    <label style={{fontSize:10,fontWeight:800,color:'#64748b',letterSpacing:'.06em',textTransform:'uppercase'}}>Voucher ID</label>
                    <input readOnly value="Auto-generated on save" style={{...inpS,background:'#f8fafc',color:'#64748b',fontWeight:700}} />
                  </div>
                  <div style={{gridColumn:'span 2',display:'flex',flexDirection:'column',gap:5}}>
                    <label style={{fontSize:10,fontWeight:800,color:'#64748b',letterSpacing:'.06em',textTransform:'uppercase'}}>Voucher Type</label>
                    <select style={inpS} value={vForm.voucherType||'LOAN'} onChange={e=>setVForm(f=>({...f,voucherType:e.target.value}))}>
                      <option value="PAYMENT">Payment Voucher</option>
                      <option value="LOAN">Loan Voucher</option>
                    </select>
                  </div>
                  <div style={{gridColumn:'span 2',display:'flex',flexDirection:'column',gap:5}}>
                    <label style={{fontSize:10,fontWeight:800,color:'#64748b',letterSpacing:'.06em',textTransform:'uppercase'}}>Preparation Date</label>
                    <input type="date" style={inpS} value={vForm.preparationDate||''} onChange={e=>setVForm(f=>({...f,preparationDate:e.target.value}))} />
                  </div>
                  <div style={{gridColumn:'span 2',display:'flex',flexDirection:'column',gap:5}}>
                    <label style={{fontSize:10,fontWeight:800,color:'#64748b',letterSpacing:'.06em',textTransform:'uppercase'}}>Purpose Category</label>
                    <input style={inpS} value={vForm.purposeCategory||''} onChange={e=>setVForm(f=>({...f,purposeCategory:e.target.value}))} placeholder="e.g. Loan Payment" />
                  </div>
                  <div style={{gridColumn:'span 2',display:'flex',flexDirection:'column',gap:5}}>
                    <label style={{fontSize:10,fontWeight:800,color:'#64748b',letterSpacing:'.06em',textTransform:'uppercase'}}>Status</label>
                    <div style={{padding:'7px 10px',borderRadius:8,border:'1px solid #fed7aa',background:'#fff7ed',fontSize:13,fontWeight:700,color:'#c2410c'}}>Pending</div>
                  </div>
                  <div style={{gridColumn:'span 2',display:'flex',flexDirection:'column',gap:5}}>
                    <label style={{fontSize:10,fontWeight:800,color:'#64748b',letterSpacing:'.06em',textTransform:'uppercase'}}>Payment From (Bank)</label>
                    <AccountCombobox
                      options={[
                        ...bankAccounts.map(a=>({value:a.code||a.id,label:`${a.code} — ${a.name}`})),
                        ...(bankAccounts.length===0 ? calAccounts.map(a=>({value:a.code||a.id,label:`${a.code} — ${a.name}`})) : []),
                      ]}
                      value={vForm.paymentFrom||''}
                      onChange={v=>setVForm(f=>({...f,paymentFrom:v}))}
                      placeholder="— Select Account —"
                    />
                  </div>
                </div>

                {/* ── Payment Details section ── */}
                <div style={{fontSize:11,fontWeight:800,color:'#f97316',letterSpacing:'.07em',textTransform:'uppercase',marginBottom:10,paddingBottom:6,borderBottom:'2px solid #f1f5f9'}}>
                  Payment Details
                </div>
                <div style={{display:'flex',justifyContent:'flex-end',gap:8,marginBottom:8}}>
                  <button className="btn btn-ghost btn-sm" onClick={reloadLines}>↺ Load Loan Payments</button>
                  <button className="btn btn-ghost btn-sm" onClick={()=>setVLines(p=>[...p,{id:Math.random().toString(36).slice(2,9),contact:'',expenseAccount:'',description:'',amount:'',_type:''}])}>+ Add New Row</button>
                </div>

                <div style={{border:'1px solid #e5e7eb',borderRadius:10,overflow:'hidden',marginBottom:4}}>
                  <table style={{width:'100%',borderCollapse:'collapse',fontSize:12}}>
                    <thead>
                      <tr>
                        <th style={{...thS,minWidth:140}}>Contact</th>
                        <th style={{...thS,minWidth:160}}>Account</th>
                        <th style={{...thS,minWidth:220}}>Description</th>
                        <th style={{...thS,textAlign:'right',width:120}}>Amount</th>
                        <th style={{width:30,padding:'8px 6px',background:'#f8fafc'}}></th>
                      </tr>
                    </thead>
                    <tbody>
                      {vLines.map((ln,i) => (
                        <tr key={ln.id} style={{borderTop:'1px solid #f1f5f9'}}>
                          <td style={{padding:'5px 8px'}}>
                            <input style={inpS} value={ln.contact} onChange={e=>setLine(i,'contact',e.target.value)} placeholder="Contact name" />
                          </td>
                          <td style={{padding:'5px 8px'}}>
                            <AccountCombobox
                              options={calAccounts.map(a=>({value:a.code||a.id,label:`${a.code} — ${a.name}`}))}
                              value={ln.expenseAccount}
                              onChange={v=>setLine(i,'expenseAccount',v)}
                              placeholder="Account code"
                            />
                          </td>
                          <td style={{padding:'5px 8px'}}>
                            <input style={inpS} value={ln.description} onChange={e=>setLine(i,'description',e.target.value)} placeholder="Description" />
                          </td>
                          <td style={{padding:'5px 8px'}}>
                            <input type="number" style={{...inpS,textAlign:'right'}} value={ln.amount} onChange={e=>setLine(i,'amount',e.target.value)} />
                          </td>
                          <td style={{padding:'5px 4px',textAlign:'center'}}>
                            <button onClick={()=>setVLines(p=>p.filter((_,idx)=>idx!==i))} style={{background:'none',border:'none',color:'#dc2626',cursor:'pointer',fontWeight:900,fontSize:13,padding:'4px'}}>✕</button>
                          </td>
                        </tr>
                      ))}
                      {vLines.length === 0 && (
                        <tr><td colSpan={5} style={{padding:'20px',textAlign:'center',color:'#94a3b8',fontSize:12}}>No lines. Click "Load Loan Payments" or "+ Add New Row".</td></tr>
                      )}
                    </tbody>
                  </table>
                </div>

                {/* Net Cash Disbursed */}
                <div style={{textAlign:'right',padding:'8px 12px',fontSize:13,fontWeight:900,color:'#0f172a',letterSpacing:'.04em'}}>
                  NET CASH DISBURSED &nbsp;
                  <span style={{fontSize:16,color:'#0f172a'}}>{fmtCur(totalAmt)}</span>
                </div>

                {/* ── Journal Entry (auto-generated) ── */}
                {totalAmt > 0 && (
                  <div style={{marginTop:14}}>
                    <div style={{fontSize:11,fontWeight:800,color:'#f97316',letterSpacing:'.07em',textTransform:'uppercase',marginBottom:8,paddingBottom:6,borderBottom:'2px solid #f1f5f9'}}>
                      Journal Entry (Auto-Generated)
                    </div>
                    <table style={{width:'100%',borderCollapse:'collapse',fontSize:12,border:'1px solid #e5e7eb',borderRadius:8,overflow:'hidden'}}>
                      <thead>
                        <tr>
                          <th style={thS}>COA (Account Name)</th>
                          <th style={{...thS,textAlign:'right',width:130}}>Debit</th>
                          <th style={{...thS,textAlign:'right',width:130}}>Credit</th>
                        </tr>
                      </thead>
                      <tbody>
                        {priTotal > 0 && (
                          <tr style={{borderTop:'1px solid #f1f5f9'}}>
                            <td style={{padding:'9px 12px',fontWeight:700}}>{lpAcctName}</td>
                            <td style={{padding:'9px 12px',textAlign:'right'}}>{fmtPHP(priTotal)}</td>
                            <td style={{padding:'9px 12px',textAlign:'right',color:'#94a3b8'}}>—</td>
                          </tr>
                        )}
                        {intTotal > 0 && (
                          <tr style={{borderTop:'1px solid #f1f5f9'}}>
                            <td style={{padding:'9px 12px',fontWeight:700}}>{fcAcctName}</td>
                            <td style={{padding:'9px 12px',textAlign:'right'}}>{fmtPHP(intTotal)}</td>
                            <td style={{padding:'9px 12px',textAlign:'right',color:'#94a3b8'}}>—</td>
                          </tr>
                        )}
                        <tr style={{borderTop:'1px solid #f1f5f9'}}>
                          <td style={{padding:'9px 12px',fontWeight:700}}>{bankAcctName}</td>
                          <td style={{padding:'9px 12px',textAlign:'right',color:'#94a3b8'}}>—</td>
                          <td style={{padding:'9px 12px',textAlign:'right'}}>{fmtPHP(totalAmt)}</td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              {/* Footer */}
              <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',gap:10,padding:'14px 20px',borderTop:'1px solid #e5e7eb',background:'#f8fafc',flexShrink:0}}>
                <button className="btn btn-ghost" style={{color:'#dc2626'}} onClick={()=>setCalVoucherModal(null)} disabled={vSaving}>
                  Discard Voucher
                </button>
                <div style={{display:'flex',gap:8}}>
                  <button className="btn btn-primary" style={{background:'#0b1220'}} onClick={()=>saveCalVoucher('Pending Review')} disabled={vSaving}>
                    Submit for Approval
                  </button>
                  <button className="btn btn-primary" onClick={()=>saveCalVoucher('Pending')} disabled={vSaving}>
                    ✓ Save to Draft
                  </button>
                </div>
              </div>
            </div>
          </div>
        );
      })()}

      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}

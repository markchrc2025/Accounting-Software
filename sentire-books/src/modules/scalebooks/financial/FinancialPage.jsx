import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import AccountCombobox from '../../../components/AccountCombobox.jsx';
import { recomputeLoanState, daysBetween, buildScheduleWithDueDates } from './loanMonitoring.js';
import RecordPaymentModal from './RecordPaymentModal.jsx';
import { usePermissions } from '../../../contexts/PermissionsContext.jsx';
import {
  loansApi, loanPaymentsApi, bookLoan, unbookLoan, listAccounts, listVouchers, listCheckbooks, listChecks,
  createVoucherDraft, transitionVoucher, ApiError,
} from '../../../lib/api.js';

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

/* ─── API <-> UI mapping ─────────────────────────────────────────── */
// API rows carry integer centavos + a pm_config blob; the amortization engine
// and every tab keep the original pesos/flattened shape, so the mapping
// restores it. Loan ids are now uuids (were client-side integers).
const toPesos = (c) => Number(c || 0) / 100;
const toCents = (p) => Math.round(Number(p || 0) * 100);
const loanFromApi = (r) => ({
  id: r.id,
  loanNo: r.loanNo || '',
  name: r.name || '',
  loanType: r.loanType || 'Term Loan',
  disbursementDate: r.disbursementDate || '',
  proceedsDate: r.proceedsDate || '',
  termMonths: r.termMonths ?? 60,
  annualRate: Number(r.annualRate) || 0,
  principal: toPesos(r.principalCents),
  interestMethod: r.interestMethod || 'Reducing Balance',
  processingFee: toPesos(r.processingFeeCents),
  liabilityAccountCode: r.liabilityAccountCode || '',
  financeCostAccountCode: r.financeCostAccountCode || '',
  cashAccountCode: r.cashAccountCode || '',
  bookingMode: r.bookingMode || '',
  bookingJournalEntryId: r.bookingJournalEntryId || null,
  bookedAt: r.bookedAt || null,
  status: r.status || 'Active',
  paymentFrequency: r.paymentFrequency || 'Monthly',
  payDayMode: r.payDayMode || 'Fixed',
  payDays: '',
  payDay1: r.payDay1 ?? '',
  payDay2: r.payDay2 ?? '',
  payDaysPerMonth: (r.payDaysPerMonth && typeof r.payDaysPerMonth === 'object') ? r.payDaysPerMonth : {},
  intervalDays: r.intervalDays ?? 15,
  paymentMethod: r.paymentMethod || 'Check',
  pmChecks: [], pmAdaDay: '', pmAdaBank: '', pmBtBank: '', cycleCount: 1,
  ...(r.pmConfig && typeof r.pmConfig === 'object' ? r.pmConfig : {}),
});
const loanToApi = (l) => ({
  name: (l.name || '').trim(),
  loanType: l.loanType || 'Term Loan',
  disbursementDate: l.disbursementDate || null,
  proceedsDate: l.proceedsDate || null,
  termMonths: parseInt(l.termMonths) || 60,
  annualRate: Number(l.annualRate) || 0,
  principalCents: toCents(l.principal),
  interestMethod: l.interestMethod || 'Reducing Balance',
  processingFeeCents: toCents(l.processingFee),
  liabilityAccountCode: l.liabilityAccountCode || null,
  financeCostAccountCode: l.financeCostAccountCode || null,
  cashAccountCode: l.cashAccountCode || null,
  status: l.status || 'Active',
  paymentFrequency: l.paymentFrequency || 'Monthly',
  payDayMode: l.payDayMode || 'Fixed',
  payDay1: parseInt(l.payDay1) || null,
  payDay2: parseInt(l.payDay2) || null,
  payDaysPerMonth: l.payDaysPerMonth || {},
  intervalDays: parseInt(l.intervalDays) || 15,
  paymentMethod: l.paymentMethod || null,
});
const paymentFromApi = (p) => ({
  id: p.id,
  loanId: p.loanId || '',
  loanName: p.loanName || '',
  date: p.payDate || '',
  interest: toPesos(p.interestCents),
  principal: toPesos(p.principalCents),
  penalty: toPesos(p.penaltyCents),
  total: toPesos(p.totalCents),
  method: p.method || '',
  referenceNo: p.referenceNo || '',
  bank: p.bank || '',
  voucherId: p.voucherNo || '',
  voucherDocId: p.voucherDocId || '',
  checkVoucherId: p.checkVoucherNo || '',
  notes: p.notes || '',
  allocations: Array.isArray(p.allocations) ? p.allocations : [],
});
// Voucher rows for the Payment History status badges + Record Payment modal;
// loan linkage rides in the voucher's meta jsonb.
const FIN_VSTATUS = {
  draft:'Draft', pending:'Pending', for_verification:'Pending Review', verified:'Pending Review',
  for_approval:'Pending Approval', approved:'Approved', for_disbursement:'For Disbursement',
  paid:'Paid', rejected:'Rejected', posted:'Approved', void:'Voided',
};
const finVoucherFromApi = (v) => {
  const m = v.meta || {};
  return {
    id: v.id, docId: v.id,
    voucherId: v.voucherNo,
    voucherType: (v.voucherType || '').toUpperCase(),
    preparationDate: v.voucherDate,
    totalAmount: toPesos(v.totalCents),
    status: FIN_VSTATUS[v.status] || v.status,
    loanId: m.loanId || '',
    checkVoucherId: m.checkVoucherId || '',
  };
};

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

/* ── Every-N-Days payment schedule ─────────────────────────────── */
/* Returns one entry per payment: { period, dueDate, date, principal, interest, balance } */
function buildIntervalPayments(loan) {
  const intervalDays = parseInt(loan.intervalDays) || 15;
  const start = loan.disbursementDate ? new Date(loan.disbursementDate + 'T00:00:00') : null;
  if (!start || isNaN(start.getTime()) || !loan.termMonths) return [];
  const endDate = new Date(start.getFullYear(), start.getMonth() + parseInt(loan.termMonths), start.getDate());
  const P = parseFloat(loan.principal) || 0;
  // Collect all due dates
  const dates = [];
  let cur = new Date(start);
  while (cur <= endDate) { dates.push(new Date(cur)); cur = new Date(cur.getTime() + intervalDays * 86400000); }
  const n = dates.length;
  if (n === 0 || P <= 0) return [];
  const r = (loan.annualRate || 0) / 100 * intervalDays / 365;
  const pmt = r === 0 ? P / n : P * r * Math.pow(1+r,n) / (Math.pow(1+r,n)-1);
  let balance = P;
  return dates.map((d, i) => {
    let interest, principal;
    if (loan.interestMethod === 'Fixed') {
      principal = P / n;
      interest  = P * (loan.annualRate||0) / 100 * intervalDays / 365;
    } else if (loan.interestMethod === 'Balloon') {
      interest  = balance * r;
      principal = i === n - 1 ? balance : 0;
    } else {
      interest  = balance * r;
      principal = Math.max(0, pmt - interest);
    }
    balance = Math.max(0, balance - principal);
    const iso = d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0');
    return { period: i+1, dueDate: iso, date: d, principal, interest, balance };
  });
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

  /* ── Loan Registry ─────────────────────────────────────────────── */
  .lr-kpi-grid { display:grid; grid-template-columns:repeat(auto-fit,minmax(160px,1fr)); gap:10px; margin-bottom:16px; }
  .lr-kpi-card { border-radius:12px; padding:12px 14px; }
  .lr-kpi-label { font-size:9px; font-weight:800; letter-spacing:.07em; text-transform:uppercase; margin-bottom:4px; opacity:.75; }
  .lr-kpi-value { font-size:17px; font-weight:900; line-height:1.1; }
  .lr-kpi-sub   { font-size:10px; opacity:.6; margin-top:3px; }
  .lr-filter-bar { display:flex; gap:4px; background:#f1f5f9; border-radius:8px; padding:3px; }
  .lr-filter-btn { border:none; border-radius:6px; padding:4px 10px; font-size:11px; font-weight:700; cursor:pointer; font-family:inherit; transition:all .15s; }
  .lr-tbl-wrap { border-radius:12px; border:1px solid #e5e7eb; background:#fff; overflow:hidden; }
  .lr-tbl-wrap table { margin:0; }
  .lr-tbl-wrap th:first-child { border-radius:0; }
  .lr-row td { border-left:3px solid transparent; }
  .lr-row-active td:first-child { border-left:3px solid #22c55e; }
  .lr-row-disposed td:first-child { border-left:3px solid #cbd5e1; }
  .lr-prog-track { background:#f1f5f9; border-radius:999px; height:5px; overflow:hidden; margin-top:4px; }
  .lr-prog-fill  { height:100%; border-radius:999px; transition:width .4s ease; }
  .lr-type-badge { font-size:9px; font-weight:800; padding:2px 6px; border-radius:4px; display:inline-block; margin-top:3px; white-space:nowrap; }
  .lr-del-btn    { background:none; border:none; color:#fca5a5; cursor:pointer; font-weight:900; font-size:14px; padding:2px 6px; border-radius:6px; transition:color .15s; }
  .lr-del-btn:hover { color:#dc2626; }
  .lr-save-badge { font-size:11px; font-weight:700; padding:4px 10px; border-radius:6px; border:1px solid; }
  .lr-empty { padding:56px 24px; text-align:center; color:#94a3b8; }
  .lr-empty-icon { font-size:36px; margin-bottom:10px; }
  .lr-empty-title { font-weight:700; font-size:14px; color:#475569; margin-bottom:4px; }
  .lr-empty-sub   { font-size:12px; }
  .lr-edit-btn   { background:none; border:1px solid #e2e8f0; color:#64748b; cursor:pointer; font-size:12px; padding:3px 8px; border-radius:6px; transition:all .15s; font-family:inherit; }
  .lr-edit-btn:hover { border-color:#f97316; color:#f97316; }
  .lr-form-grid  { display:grid; grid-template-columns:1fr 1fr; gap:12px; margin-bottom:14px; }
  .lr-form-full  { grid-column:1/-1; }
  .lr-form-sect  { font-size:10px; font-weight:800; color:#94a3b8; letter-spacing:.06em; text-transform:uppercase; margin:4px 0 10px; padding-bottom:6px; border-bottom:1px solid #f1f5f9; grid-column:1/-1; }
  .lr-td-label   { font-size:13px; font-weight:700; color:#0b1220; }
  .lr-td-sub     { font-size:10px; color:#94a3b8; margin-top:2px; }
  .lr-row-click  { cursor:pointer; }
  .lr-row-click:hover td { background:#fafbff !important; }
  .lr-detail-grid { display:grid; grid-template-columns:repeat(3,1fr); gap:14px 18px; }
  .lr-detail-2col { grid-column:span 2; }
  .lr-detail-3col { grid-column:span 3; }
  .lr-detail-lbl  { font-size:9px; font-weight:800; color:#94a3b8; letter-spacing:.07em; text-transform:uppercase; margin-bottom:3px; }
  .lr-detail-val  { font-size:13px; font-weight:700; color:#0b1220; }
  .lr-detail-val-dim { font-size:13px; font-weight:600; color:#94a3b8; }
  .lr-detail-sect { font-size:10px; font-weight:800; color:#94a3b8; letter-spacing:.06em; text-transform:uppercase; margin:16px 0 10px; padding-bottom:6px; border-bottom:1px solid #f1f5f9; grid-column:1/-1; }
  .lr-hero-outstanding { border-radius:14px; padding:16px 20px; margin-bottom:16px; display:flex; align-items:center; justify-content:space-between; gap:16px; }
  .lr-lock-notice { display:flex; align-items:center; gap:6px; font-size:11px; color:#94a3b8; background:#f8fafc; border:1px solid #e2e8f0; border-radius:8px; padding:6px 12px; }
`;

export default function FinancialPage() {
  const [loans, setLoans]           = useState([]);
  const [activeTab, setActiveTab]   = useState('dashboard');
  const [scheduleYear, setScheduleYear] = useState('all');
  const [pmModal, setPmModal]       = useState(null);  // loan.id
  const [payDaysModal, setPayDaysModal] = useState(null); // loan.id
  const [calMonth, setCalMonth]     = useState(new Date().getMonth());
  const [calYear, setCalYear]       = useState(new Date().getFullYear());
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

  // Phase 2/3: actual payments + monitoring
  const [payments,      setPayments]      = useState([]);
  const [voucherDocs,   setVoucherDocs]   = useState([]);
  const [checkbooks,    setCheckbooks]    = useState([]);
  const [payModal,      setPayModal]      = useState(null);  // loan.id
  const [pmForm, setPmForm] = useState({
    paymentMethod: 'Check', checkbookId: '', checks: [],
    pmBtBankName: '', pmBtAccountName: '', pmBtAccountNumber: '',
    pmAdaAccountCode: '', pmAdaDay: ''
  });
  // pmForm.checks: [{id, checkNo, checkDate, amount}]
  const [monitorFilter, setMonitorFilter] = useState('outstanding'); // outstanding | paidoff | atrisk | all
  const [historyLoanFilter, setHistoryLoanFilter] = useState('all');
  const [lrFilter, setLrFilter] = useState('all'); // all | active | disposed
  const [loanFormModal, setLoanFormModal] = useState(null); // { mode:'new'|'edit', data:{...loan} }
  const [loanDetailModal, setLoanDetailModal] = useState(null); // loan.id
  const [loanDetailTab, setLoanDetailTab] = useState('details'); // 'details' | 'schedule'
  const [reportDropdown, setReportDropdown] = useState(false);
  const reportTableRef = useRef(null);
  const { isAdmin } = usePermissions();

  const showToast = (msg) => { setToast(msg); setTimeout(() => setToast(''), 3000); };
  const askConfirm = (message, onConfirm) => setConfirmModal({ message, onConfirm });

  /* ── Data loading (REST API) ───────────────────────────────────── */
  const loadLoans = useCallback(async () => {
    try {
      const rows = (await loansApi.list()).map(loanFromApi);
      // cycleCount = Nth loan sharing the same lender name (display only)
      const byName = {};
      rows.forEach(l => {
        const k = (l.name || '').trim().toLowerCase();
        byName[k] = (byName[k] || 0) + 1;
        l.cycleCount = byName[k];
      });
      setLoans(rows);
    } catch (e) {
      console.error('loans load failed:', e);
    }
  }, []);
  const loadPayments = useCallback(
    () => loanPaymentsApi.list().then(rs => setPayments(rs.map(paymentFromApi))).catch(e => console.error('loanPayments load failed:', e)),
    [],
  );
  const loadVoucherDocs = useCallback(
    () => listVouchers().then(rs => setVoucherDocs(rs.map(finVoucherFromApi))).catch(e => console.error('vouchers load failed:', e)),
    [],
  );
  useEffect(() => {
    loadLoans();
    listAccounts()
      .then(rows => setCalAccounts(rows.map(a => ({ ...a, subType: a.subtype || a.subType || '' }))))
      .catch(() => {});
    loadPayments();
    loadVoucherDocs();
    listCheckbooks().then(setCheckbooks).catch(() => {});
  }, [loadLoans, loadPayments, loadVoucherDocs]);

  // Load already-issued check numbers when selected checkbook changes
  const [issuedNums, setIssuedNums] = useState(new Set());
  useEffect(() => {
    if (!pmForm.checkbookId) { setIssuedNums(new Set()); return; }
    listChecks()
      .then(rows => setIssuedNums(new Set(rows.filter(ch => ch.checkbookId === pmForm.checkbookId).map(ch => ch.checkNumber).filter(Boolean))))
      .catch(() => setIssuedNums(new Set()));
  }, [pmForm.checkbookId]);

  /* ── Voucher lookup map (by human-readable voucherId string) ──── */  const voucherMap = useMemo(() => {
    const m = {};
    for (const v of voucherDocs) if (v.voucherId) m[v.voucherId] = v;
    return m;
  }, [voucherDocs]);

  const VOUCHER_STATUS_STYLE = {
    'Pending':           { background:'#fff7ed', borderColor:'#fed7aa', color:'#c2410c' },
    'Pending Review':    { background:'#fffbeb', borderColor:'#fde68a', color:'#92400e' },
    'Pending Approval':  { background:'#eff6ff', borderColor:'#bfdbfe', color:'#1d4ed8' },
    'Approved':          { background:'#ecfdf5', borderColor:'#6ee7b7', color:'#065f46' },
    'For Disbursement':  { background:'#f0f9ff', borderColor:'#bae6fd', color:'#0369a1' },
    'Paid':              { background:'#f0fdf4', borderColor:'#bbf7d0', color:'#15803d' },
    'Rejected':          { background:'#fef2f2', borderColor:'#fecaca', color:'#dc2626' },
    'Voided':            { background:'#f8fafc', borderColor:'#e2e8f0', color:'#64748b' },
  };

  /* ── Group payments by loanId & compute monitoring states ─────── */
  const paymentsByLoan = useMemo(() => {
    const map = {};
    for (const p of payments) {
      if (p.loanId == null) continue;
      (map[p.loanId] = map[p.loanId] || []).push(p);
    }
    return map;
  }, [payments]);

  const loanStates = useMemo(() => {
    const map = {};
    for (const l of loans) map[l.id] = recomputeLoanState(l, paymentsByLoan[l.id] || []);
    return map;
  }, [loans, paymentsByLoan]);

  // Persist one loan's fields (was a debounced whole-document overwrite).
  const saveLoanFields = useCallback(async (id, fields) => {
    setSaveStatus('saving');
    try {
      await loansApi.update(id, fields);
      setSaveStatus('saved');
      setTimeout(() => setSaveStatus(''), 2000);
    } catch (e) {
      setSaveStatus('error');
      console.error(e);
    }
  }, []);

  const updateLoan = useCallback((id, field, value) => {
    setLoans(prev => prev.map(l => l.id === id ? { ...l, [field]: value } : l));
  }, []);

  const addLoan = useCallback(() => {
    const iso = new Date().toISOString().slice(0, 7) + '-01';
    setPdFillD1(''); setPdFillD2('');
    setLoanFormModal({
      mode: 'new',
      data: {
        id: null, name: '', loanType: 'Term Loan',
        disbursementDate: iso, proceedsDate: '',
        termMonths: 60, annualRate: 6, principal: 0,
        interestMethod: 'Reducing Balance', processingFee: 0,
        status: 'Active', paymentFrequency: 'Monthly',
        payDayMode: 'Fixed', payDays: '', payDay1: '', payDay2: '',
        payDaysPerMonth: {}, intervalDays: 15, paymentMethod: 'Check', pmChecks: [],
        pmAdaDay: '', pmAdaBank: '', pmBtBank: '', cycleCount: 1,
        // GL accounts (defaults: Loans Payable / Finance Cost; bank picked by user)
        liabilityAccountCode: '2001002', financeCostAccountCode: '5004001', cashAccountCode: ''
      }
    });
  }, [])

  const deleteLoan = useCallback((id) => {
    askConfirm('Delete this loan?', async () => {
      try {
        await loansApi.remove(id);
        await loadLoans();
      } catch (e) { showToast('Error: ' + (e instanceof ApiError ? e.detail : e.message)); }
    });
  }, [loadLoans, setConfirmModal]); // eslint-disable-line react-hooks/exhaustive-deps

  const saveLoanFromModal = useCallback(async (data) => {
    try {
      if (data.id == null) await loansApi.create(loanToApi(data));
      else                 await loansApi.update(data.id, loanToApi(data));
      setLoanFormModal(null);
      await loadLoans();
    } catch (e) { showToast('Error: ' + (e instanceof ApiError ? e.detail : e.message)); }
  }, [loadLoans]); // eslint-disable-line react-hooks/exhaustive-deps

  // Book a loan to the ledger (posts its origination JE). New loans = real
  // disbursement (DR Cash + Finance Cost, CR Loans Payable); pre-existing loans
  // = opening balance (DR Opening Balance Offset, CR Loans Payable).
  const doBookLoan = useCallback((loan, mode) => {
    askConfirm(
      mode === 'opening_balance'
        ? `Book "${loan.name}" as an opening balance? This posts CR Loans Payable / DR Opening Balance Offset for ${fmtCur(parseFloat(loan.principal)||0)}.`
        : `Book "${loan.name}" to the ledger? This posts the loan disbursement (DR Cash + Finance Cost, CR Loans Payable).`,
      async () => {
        try {
          const r = await bookLoan(loan.id, { mode });
          showToast(`Booked to ledger — ${r.journalEntryNo}.`);
          await loadLoans();
        } catch (e) { showToast('Book failed: ' + (e instanceof ApiError ? e.detail : e.message)); }
      });
  }, [loadLoans]); // eslint-disable-line react-hooks/exhaustive-deps

  const doUnbookLoan = useCallback((loan) => {
    askConfirm(`Unbook "${loan.name}"? This reverses its booking journal entry.`, async () => {
      try {
        await unbookLoan(loan.id);
        showToast('Loan unbooked — booking entry reversed.');
        await loadLoans();
      } catch (e) { showToast('Unbook failed: ' + (e instanceof ApiError ? e.detail : e.message)); }
    });
  }, [loadLoans]); // eslint-disable-line react-hooks/exhaustive-deps

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
      const validLines = vLines.filter(l => (Number(l.amount)||0) > 0);
      const resolve = (codeOrId) => calAccounts.find(a => a.code === codeOrId || a.id === codeOrId);
      const apiLines = validLines.map(l => {
        const acct = resolve(l.expenseAccount);
        return acct && {
          accountId: acct.id,
          description: l.description || undefined,
          amountCents: Math.round((Number(l.amount)||0) * 100),
          meta: {
            contact: l.contact || '',
            category: l._type === 'interest' ? 'Finance Cost' : l._type === 'principal' ? 'Loans Payable' : '',
          },
        };
      });
      if (!apiLines.length || apiLines.some(l => !l)) {
        showToast('Could not resolve an account for one of the lines — check the Finance Cost / Loans Payable accounts.');
        setVSaving(false);
        return;
      }
      const bank = resolve(vForm.paymentFrom);
      const loanIds = [...new Set((calVoucherModal?.events || []).map(e => e.loan?.id).filter(Boolean))];
      const created = await createVoucherDraft({
        type: (vForm.voucherType || 'LOAN') === 'LOAN' ? 'loan' : 'payment',
        voucherDate: vForm.preparationDate,
        purposeCategory: vForm.purposeCategory || null,
        paymentFromAccountId: bank?.id || null,
        notes: vForm.notes || null,
        meta: {
          contactSummary: [...new Set(validLines.map(l=>l.contact).filter(Boolean))].join(', '),
          ...(loanIds.length === 1 ? { loanId: loanIds[0] } : {}),
        },
        lines: apiLines,
      });
      if (status !== 'Pending') await transitionVoucher(created.id, 'pending').catch(()=>{});
      showToast(`Voucher ${created.voucherNo} ${status === 'Pending' ? 'saved as draft' : 'submitted for approval'}.`);
      setCalVoucherModal(null);
      await loadVoucherDocs();
    } catch(e) { showToast('Error: ' + (e instanceof ApiError ? e.detail : e.message)); }
    setVSaving(false);
  }, [vForm, vLines, calAccounts, calVoucherModal, loadVoucherDocs]); // eslint-disable-line react-hooks/exhaustive-deps

  const TABS = [
    { key: 'dashboard',  label: 'Dashboard' },
    { key: 'loans',      label: 'Loan Registry' },
    { key: 'schedule',   label: 'Amortization' },
    { key: 'history',    label: 'Payment History' },
    { key: 'calendar',   label: 'Calendar' },
    { key: 'summary',    label: 'Reports' },
    { key: 'payment',    label: 'Settings' },
  ];

  const deletePayment = useCallback((paymentId) => {
    askConfirm('Delete this payment record? This cannot be undone.', async () => {
      try { await loanPaymentsApi.remove(paymentId); showToast('Payment deleted.'); await loadPayments(); }
      catch (e) { showToast('Error: ' + (e instanceof ApiError ? e.detail : e.message)); }
    });
  }, [loadPayments]); // eslint-disable-line react-hooks/exhaustive-deps

  /* ── Tab: Loan Registry ────────────────────────────────────────── */
  const LOAN_TYPE_COLORS = {
    'Term Loan':           { bg:'#eff6ff', color:'#1d4ed8' },
    'Revolving Credit':    { bg:'#faf5ff', color:'#7c3aed' },
    'Mortgage':            { bg:'#fef3c7', color:'#92400e' },
    'Equipment Financing': { bg:'#ecfdf5', color:'#065f46' },
    'Line of Credit':      { bg:'#fff7ed', color:'#c2410c' },
    'Balloon Loan':        { bg:'#fce7f3', color:'#9d174d' },
    'Bonds Payable':       { bg:'#f0f9ff', color:'#0369a1' },
    'Other':               { bg:'#f8fafc', color:'#475569' },
  };

  function LoansTab() {
    const today = new Date().toISOString().slice(0, 10);
    const countAll         = loans.length;
    const countOutstanding = loans.filter(l => !loanStates[l.id]?.isPaidOff && l.status !== 'Disposed').length;
    const countAtRisk      = loans.filter(l => (loanStates[l.id]?.missedCount || 0) > 0 && !loanStates[l.id]?.isPaidOff).length;
    const countPaidOff     = loans.filter(l =>  loanStates[l.id]?.isPaidOff).length;
    const countDisposed    = loans.filter(l => l.status === 'Disposed').length;

    let visibleLoans;
    if (lrFilter === 'outstanding') {
      visibleLoans = loans.filter(l => !loanStates[l.id]?.isPaidOff && l.status !== 'Disposed');
    } else if (lrFilter === 'atrisk') {
      visibleLoans = loans.filter(l => (loanStates[l.id]?.missedCount || 0) > 0 && !loanStates[l.id]?.isPaidOff);
    } else if (lrFilter === 'paidoff') {
      visibleLoans = loans.filter(l =>  loanStates[l.id]?.isPaidOff);
    } else if (lrFilter === 'disposed') {
      visibleLoans = loans.filter(l => l.status === 'Disposed');
    } else {
      visibleLoans = loans;
    }

    const kpi = loans.reduce((acc, l) => {
      const st = loanStates[l.id] || {};
      acc.totalPrincipal   += Number(l.principal) || 0;
      acc.totalOutstanding += st.outstandingTotal || 0;
      acc.totalInterest    += st.totalScheduledInterest || 0;
      return acc;
    }, { totalPrincipal:0, totalOutstanding:0, totalInterest:0 });

    const METHOD_SHORT = {
      'Reducing Balance':              'Reducing Bal.',
      'Straight-Line':                 'Straight-Line',
      'Straight-Line (Monthly Rate)':  'Straight-Line Mo.',
      'Fixed':                         'Fixed',
      'Balloon':                       'Balloon',
    };

    return (
      <div>
        {/* ── KPI Summary Cards ─────────────────────────────────── */}
        <div className="lr-kpi-grid">
          {[
            { label:'Total Loans',        value: String(countAll),             sub:`${countOutstanding} outstanding · ${countAtRisk} at-risk`, color:'#0369a1', bg:'#f0f9ff', border:'#bae6fd' },
            { label:'Total Borrowed',     value: fmtCur(kpi.totalPrincipal),   sub:'original principal',              color:'#7c3aed', bg:'#faf5ff', border:'#ddd6fe' },
            { label:'Outstanding',        value: fmtCur(kpi.totalOutstanding), sub:'principal + interest',            color:'#c2410c', bg:'#fff7ed', border:'#fed7aa' },
            { label:'Projected Interest', value: fmtCur(kpi.totalInterest),    sub:'total finance cost',              color:'#065f46', bg:'#f0fdf4', border:'#bbf7d0' },
          ].map(k => (
            <div key={k.label} className="lr-kpi-card" style={{ background:k.bg, border:`1px solid ${k.border}` }}>
              <div className="lr-kpi-label" style={{ color:k.color }}>{k.label}</div>
              <div className="lr-kpi-value" style={{ color:k.color }}>{k.value}</div>
              <div className="lr-kpi-sub"   style={{ color:k.color }}>{k.sub}</div>
            </div>
          ))}
        </div>

        {/* ── Toolbar ───────────────────────────────────────────── */}
        <div style={{ display:'flex', gap:8, alignItems:'center', marginBottom:14, flexWrap:'wrap' }}>
          {isAdmin
            ? <button className="btn btn-primary btn-sm" onClick={addLoan}>+ Add Loan</button>
            : <span title="Admin access required" style={{ display:'inline-flex', alignItems:'center', gap:5, fontSize:12, color:'#94a3b8', background:'#f8fafc', border:'1px solid #e2e8f0', borderRadius:8, padding:'6px 12px', cursor:'not-allowed' }}>
                🔒 Add Loan
              </span>
          }
          <div style={{ display:'flex', gap:6, flexWrap:'wrap' }}>
            {[
              { k:'all',         label:'All',         count:countAll,         accent:'#0f172a' },
              { k:'outstanding', label:'Outstanding',  count:countOutstanding, accent:'#c2410c' },
              { k:'atrisk',      label:'At-Risk',      count:countAtRisk,      accent:'#b91c1c' },
              { k:'paidoff',     label:'Paid-Off',     count:countPaidOff,     accent:'#15803d' },
              { k:'disposed',    label:'Disposed',     count:countDisposed,    accent:'#64748b' },
            ].map(({ k, label, count, accent }) => (
              <button key={k}
                onClick={() => setLrFilter(k)}
                style={{
                  border: lrFilter === k ? `2px solid ${accent}` : '2px solid #e5e7eb',
                  background: lrFilter === k ? accent : '#fff',
                  color: lrFilter === k ? '#fff' : '#0b1220',
                  borderRadius: 999, padding: '5px 13px', fontSize: 12, fontWeight: 800,
                  cursor: 'pointer', fontFamily: 'inherit', display: 'inline-flex', alignItems: 'center', gap: 7,
                }}
              >
                {label}
                <span style={{
                  background: lrFilter === k ? 'rgba(255,255,255,.25)' : '#f1f5f9',
                  color: lrFilter === k ? '#fff' : '#64748b',
                  borderRadius: 999, padding: '1px 7px', fontSize: 11, fontWeight: 800,
                }}>{count}</span>
              </button>
            ))}
          </div>
          <div style={{ marginLeft:'auto', display:'flex', gap:8, alignItems:'center' }}>
            <span style={{ fontSize:11, color:'#94a3b8' }}>
              {visibleLoans.length} loan{visibleLoans.length !== 1 ? 's' : ''}
            </span>
            {saveStatus && (
              <span className="lr-save-badge" style={{
                background:  saveStatus==='error' ? '#fef2f2' : saveStatus==='saved' ? '#f0fdf4' : '#f8fafc',
                color:       saveStatus==='error' ? '#dc2626' : saveStatus==='saved' ? '#15803d' : '#64748b',
                borderColor: saveStatus==='error' ? '#fca5a5' : saveStatus==='saved' ? '#bbf7d0' : '#e2e8f0',
              }}>
                {saveStatus==='saving' ? '⟳ Saving…' : saveStatus==='saved' ? '✓ Saved' : '✕ Error'}
              </span>
            )}
            <button className="btn btn-ghost btn-sm" onClick={() => loadLoans()}>Refresh</button>
          </div>
        </div>

        {/* ── Empty State ───────────────────────────────────────── */}
        {visibleLoans.length === 0 ? (
          <div className="lr-empty">
            <div className="lr-empty-icon">🏦</div>
            <div className="lr-empty-title">
              {lrFilter === 'all' ? 'No loans yet' : `No ${lrFilter} loans`}
            </div>
            <div className="lr-empty-sub">
              {lrFilter === 'all'
                ? 'Click "+ Add Loan" to register your first loan.'
                : 'Switch to "All" to see all loans.'}
            </div>
          </div>
        ) : (
          /* ── Table ──────────────────────────────────────────── */
          <div className="lr-tbl-wrap">
            <table>
              <thead>
                <tr>
                  <th style={{width:36}}>#</th>
                  <th style={{minWidth:180}}>Lender / Type</th>
                  <th style={{minWidth:130, textAlign:'right'}}>Principal ₱</th>
                  <th style={{width:110}}>Term · Rate</th>
                  <th style={{width:120}}>Method</th>
                  <th style={{width:120}}>Schedule</th>
                  <th style={{minWidth:175, textAlign:'right'}}>Outstanding / Progress</th>
                  <th style={{width:140}}>Next Due</th>
                  <th style={{width:100}}>Status</th>
                  <th style={{width:85, textAlign:'center'}}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {visibleLoans.map((l, idx) => {
                  const st          = loanStates[l.id] || {};
                  const isActive    = (l.status || 'Active') === 'Active';
                  const typeColor   = LOAN_TYPE_COLORS[l.loanType] || LOAN_TYPE_COLORS['Other'];
                  const principal   = parseFloat(l.principal) || 0;
                  const outstanding = st.outstandingPrincipal != null ? st.outstandingPrincipal : principal;
                  const progress    = principal > 0 ? Math.max(0, Math.min(100, ((principal - outstanding) / principal) * 100)) : 0;
                  const progColor   = progress >= 100 ? '#22c55e' : progress >= 60 ? '#f97316' : '#3b82f6';
                  const payLabel    = l.payDayMode === 'Every N Days'
                    ? `Every ${l.intervalDays || 15}d`
                    : l.paymentFrequency === 'Semi-Monthly'
                    ? (l.payDayMode === 'Variable per Month' ? 'Semi-Mo · Var'
                      : l.payDay1 && l.payDay2 ? `Semi-Mo · ${l.payDay1}/${l.payDay2}` : 'Semi-Monthly')
                    : 'Monthly';
                  const dToNext = daysBetween(today, st.nextDueDate);
                  const rowBorderColor = st.derivedStatus === 'Overdue' ? '#ef4444'
                    : st.derivedStatus === 'Paid-Off' ? '#22c55e'
                    : isActive ? '#3b82f6' : '#cbd5e1';
                  return (
                    <tr
                      key={l.id}
                      className="lr-row-click"
                      style={{ borderLeft:`3px solid ${rowBorderColor}` }}
                      onClick={() => setLoanDetailModal(l.id)}
                    >
                      <td style={{ color:'#94a3b8', fontSize:10, fontWeight:700, paddingLeft:10 }}>{idx + 1}</td>
                      <td>
                        <div className="lr-td-label">
                          {l.name || <span style={{color:'#cbd5e1',fontStyle:'italic'}}>Unnamed</span>}
                        </div>
                        <span className="lr-type-badge" style={{ background:typeColor.bg, color:typeColor.color }}>
                          {l.loanType || 'Term Loan'}
                        </span>
                      </td>
                      <td style={{ textAlign:'right' }}>
                        <div className="lr-td-label">{fmtCur(principal)}</div>
                        {l.processingFee > 0 && <div className="lr-td-sub">+{fmtCur(l.processingFee)} fee</div>}
                      </td>
                      <td>
                        <div className="lr-td-label">{l.termMonths || '—'} mo</div>
                        <div className="lr-td-sub">{l.annualRate || '—'}% p.a.</div>
                      </td>
                      <td>
                        <div style={{ fontSize:11, color:'#374151' }}>
                          {METHOD_SHORT[l.interestMethod] || l.interestMethod || '—'}
                        </div>
                      </td>
                      <td>
                        <div style={{ fontSize:11, color:'#374151' }}>{payLabel}</div>
                        {l.proceedsDate && <div className="lr-td-sub">Proceeds {l.proceedsDate}</div>}
                      </td>
                      <td style={{ textAlign:'right' }}>
                        <div style={{ fontWeight:800, fontSize:13, color: outstanding > 0 ? '#c2410c' : '#15803d' }}>
                          {fmtCur(outstanding)}
                        </div>
                        <div className="lr-prog-track">
                          <div className="lr-prog-fill" style={{ width:`${progress}%`, background:progColor }} />
                        </div>
                        <div style={{ fontSize:9, color:'#94a3b8', marginTop:2 }}>
                          {progress.toFixed(0)}% repaid
                        </div>
                      </td>
                      <td style={{ fontSize:11 }}>
                        {st.nextDueDate ? (
                          <>
                            <div style={{ fontWeight:700 }}>{st.nextDueDate}</div>
                            {dToNext != null && (
                              <div style={{ fontWeight:700, fontSize:10, color: dToNext < 0 ? '#b91c1c' : dToNext <= 7 ? '#c2410c' : '#94a3b8' }}>
                                {dToNext < 0 ? `${Math.abs(dToNext)}d overdue` : dToNext === 0 ? 'Due today' : `in ${dToNext}d`}
                              </div>
                            )}
                          </>
                        ) : <span style={{ color:'#cbd5e1' }}>—</span>}
                      </td>
                      <td>
                        {(() => {
                          const smap = {
                            'Paid-Off':  { bg:'#f0fdf4', border:'#bbf7d0', color:'#15803d' },
                            'Overdue':   { bg:'#fef2f2', border:'#fecaca', color:'#b91c1c' },
                            'Current':   { bg:'#eff6ff', border:'#bfdbfe', color:'#1d4ed8' },
                            'Active':    { bg:'#fff7ed', border:'#fed7aa', color:'#c2410c' },
                            'Disposed':  { bg:'#f8fafc', border:'#e2e8f0', color:'#94a3b8' },
                          };
                          const s = smap[st.derivedStatus || 'Active'] || smap.Active;
                          return <span className="pill" style={{ background:s.bg, borderColor:s.border, color:s.color }}>{st.derivedStatus || 'Active'}</span>;
                        })()}
                      </td>
                      <td style={{ textAlign:'center' }} onClick={e => e.stopPropagation()}>
                        <div style={{ display:'flex', gap:3, justifyContent:'center' }}>
                          {!st.isPaidOff && l.status !== 'Disposed' && isAdmin && (
                            <button
                              className="btn btn-primary btn-sm"
                              title="Record payment"
                              style={{ padding:'3px 7px', fontSize:11 }}
                              onClick={() => setPayModal(l.id)}
                            >₱</button>
                          )}
                          {isAdmin ? (
                            <>
                              <button
                                className="lr-edit-btn"
                                title="Edit loan"
                                onClick={() => { setPdFillD1(''); setPdFillD2(''); setLoanFormModal({ mode:'edit', data:{ ...l } }); }}
                              >✎</button>
                              <button
                                className="lr-del-btn"
                                title="Delete loan"
                                onClick={() => deleteLoan(l.id)}
                              >✕</button>
                            </>
                          ) : (
                            <span title="Admin access required" style={{ fontSize:13, color:'#cbd5e1' }}>🔒</span>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* Overdue installments breakdown — when At-Risk filter active */}
        {lrFilter === 'atrisk' && visibleLoans.length > 0 && (() => {
          const overdueRows = visibleLoans.flatMap(l => {
            const st = loanStates[l.id] || {};
            return (st.schedule || [])
              .filter(r => r.status === 'overdue' || (r.status === 'partial' && r.dueDate < today))
              .map(r => ({ l, r }));
          });
          if (overdueRows.length === 0) return null;
          return (
            <div style={{ marginTop:24 }}>
              <div style={{ fontSize:11, fontWeight:800, color:'#b91c1c', letterSpacing:'.07em',
                textTransform:'uppercase', marginBottom:10, paddingBottom:6, borderBottom:'2px solid #fecaca' }}>
                Overdue Installments
              </div>
              <table>
                <thead>
                  <tr>
                    <th>Loan</th>
                    <th>Period</th>
                    <th>Due Date</th>
                    <th>Days Overdue</th>
                    <th style={{textAlign:'right'}}>Interest Due</th>
                    <th style={{textAlign:'right'}}>Principal Due</th>
                    <th style={{textAlign:'right'}}>Total Due</th>
                  </tr>
                </thead>
                <tbody>
                  {overdueRows.map(({ l, r }) => {
                    const intDue = Math.max(0, r.scheduledInterest - r.paidInterest);
                    const priDue = Math.max(0, r.scheduledPrincipal - r.paidPrincipal);
                    const days = daysBetween(r.dueDate, today) || 0;
                    return (
                      <tr key={l.id+'-'+r.period}>
                        <td style={{ fontWeight:700 }}>{l.name || `Loan ${l.id}`}</td>
                        <td>{r.label} (P{r.period})</td>
                        <td style={{ fontSize:11 }}>{r.dueDate}</td>
                        <td style={{ color:'#b91c1c', fontWeight:700 }}>{days}d</td>
                        <td style={{ textAlign:'right', color:'#dc2626' }}>{fmtCur(intDue)}</td>
                        <td style={{ textAlign:'right', color:'#2563eb' }}>{fmtCur(priDue)}</td>
                        <td style={{ textAlign:'right', fontWeight:900 }}>{fmtCur(intDue+priDue)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          );
        })()}
      </div>
    );
  }

  /* ── Tab: Dashboard (Phase 4a) ─────────────────────────────────── */
  function DashboardTab() {
    if (loans.length === 0) return <div className="empty">No loans yet. Add loans in the Loan Registry tab to see dashboard insights.</div>;

    const todayStr = new Date().toISOString().slice(0, 10);
    const yearStart = todayStr.slice(0, 4) + '-01-01';

    // Portfolio aggregates
    const portfolio = loans.reduce((acc, l) => {
      const st = loanStates[l.id] || {};
      acc.totalBorrowed       += Number(l.principal) || 0;
      acc.totalOutstanding    += st.outstandingTotal || 0;
      acc.totalPaidPrincipal  += st.paidPrincipal || 0;
      acc.totalPaidInterest   += st.paidInterest  || 0;
      acc.totalScheduledInt   += st.totalScheduledInterest || 0;
      acc.atRiskAmount        += st.overdueAmount || 0;
      if (st.derivedStatus === 'Paid-Off') acc.paidOffCount++;
      else if (st.derivedStatus === 'Overdue') acc.overdueCount++;
      else if (l.status === 'Disposed') acc.disposedCount++;
      else acc.activeCount++;
      return acc;
    }, { totalBorrowed:0, totalOutstanding:0, totalPaidPrincipal:0, totalPaidInterest:0,
         totalScheduledInt:0, atRiskAmount:0, paidOffCount:0, overdueCount:0, activeCount:0, disposedCount:0 });

    // Interest paid this year (YTD)
    const ytdInterest = payments
      .filter(p => (p.date||'') >= yearStart)
      .reduce((s, p) => s + (Number(p.interest)||0), 0);
    const ytdPrincipal = payments
      .filter(p => (p.date||'') >= yearStart)
      .reduce((s, p) => s + (Number(p.principal)||0), 0);

    // Build alert rows: overdue first, then due in next 14 days
    const alerts = [];
    loans.forEach(l => {
      const st = loanStates[l.id] || {};
      if (st.derivedStatus === 'Paid-Off' || l.status === 'Disposed') return;
      if ((st.overdueAmount || 0) > 0) {
        alerts.push({ loan: l, type: 'overdue', amount: st.overdueAmount,
          dueDate: st.nextDueDate, missedCount: st.missedCount || 0 });
      } else if (st.nextDueDate) {
        const days = daysBetween(todayStr, st.nextDueDate);
        if (days >= 0 && days <= 14) {
          alerts.push({ loan: l, type: days <= 7 ? 'duesoon' : 'upcoming',
            amount: st.nextDueAmount || 0, dueDate: st.nextDueDate, daysToDue: days });
        }
      }
    });
    // Sort: overdue first, then duesoon, then upcoming; within group by date asc
    const ORDER = { overdue:0, duesoon:1, upcoming:2 };
    alerts.sort((a, b) => (ORDER[a.type] - ORDER[b.type]) || ((a.dueDate||'').localeCompare(b.dueDate||'')));

    const ALERT_STYLE = {
      overdue:  { bg:'#fef2f2', border:'#fca5a5', color:'#dc2626', label:'OVERDUE',
        icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"><path d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"/></svg> },
      duesoon:  { bg:'#fff7ed', border:'#fdba74', color:'#c2410c', label:'DUE SOON',
        icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 8v4l3 3"/></svg> },
      upcoming: { bg:'#f0f9ff', border:'#bae6fd', color:'#0369a1', label:'UPCOMING',
        icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"><path d="M8 7V3m8 4V3M3 11h18M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"/></svg> },
    };

    // Recent payments (last 5)
    const recentPayments = [...payments].slice(0, 5);

    return (
      <div style={{ display:'flex', flexDirection:'column', gap:16 }}>
        {/* ── KPI Scorecards ─────────────────────────────────────── */}
        <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit,minmax(220px,1fr))', gap:14 }}>

          {/* Total Borrowed */}
          <div style={{
            background:'linear-gradient(135deg,#0369a1 0%,#0284c7 100%)',
            borderRadius:14, padding:'18px 20px', color:'#fff', position:'relative', overflow:'hidden',
          }}>
            <div style={{position:'absolute',right:-8,top:-8,opacity:.13}}>
              <svg width="56" height="56" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"><path d="M2 21h20M4 21V8l8-5 8 5v13M10 21V12h4v9"/></svg>
            </div>
            <div style={{fontSize:10,fontWeight:800,letterSpacing:'.08em',textTransform:'uppercase',opacity:.8,marginBottom:6}}>Total Borrowed</div>
            <div style={{fontSize:22,fontWeight:900,letterSpacing:'-.5px'}}>{fmtCur(portfolio.totalBorrowed)}</div>
            <div style={{marginTop:10,fontSize:11,opacity:.75}}>Across {loans.length} loan{loans.length!==1?'s':''}</div>
            <div style={{marginTop:8,display:'flex',gap:16,fontSize:11}}>
              <span style={{display:'flex',alignItems:'center',gap:5}}>
                <svg width="7" height="7" viewBox="0 0 7 7"><circle cx="3.5" cy="3.5" r="3.5" fill="currentColor"/></svg>
                {portfolio.activeCount} active
              </span>
              <span style={{display:'flex',alignItems:'center',gap:5,opacity:.7}}>
                <svg width="7" height="7" viewBox="0 0 7 7" fill="none" stroke="currentColor" strokeWidth="1.5"><circle cx="3.5" cy="3.5" r="2.8"/></svg>
                {portfolio.paidOffCount} paid off
              </span>
            </div>
          </div>

          {/* Total Outstanding */}
          {(() => {
            const totalPayable = portfolio.totalBorrowed + portfolio.totalScheduledInt;
            const repaidAmt = portfolio.totalPaidPrincipal + portfolio.totalPaidInterest;
            const repaidPct = totalPayable > 0 ? Math.min(100, (repaidAmt / totalPayable) * 100) : 0;
            const outPct    = totalPayable > 0 ? Math.min(100, (portfolio.totalOutstanding / totalPayable) * 100) : 0;
            return (
              <div style={{
                background:'linear-gradient(135deg,#c2410c 0%,#ea580c 100%)',
                borderRadius:14, padding:'18px 20px', color:'#fff', position:'relative', overflow:'hidden',
              }}>
                <div style={{position:'absolute',right:-8,top:-8,opacity:.13}}>
                  <svg width="56" height="56" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"><path d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"/></svg>
                </div>
                <div style={{fontSize:10,fontWeight:800,letterSpacing:'.08em',textTransform:'uppercase',opacity:.8,marginBottom:6}}>Total Outstanding</div>
                <div style={{fontSize:22,fontWeight:900,letterSpacing:'-.5px'}}>{fmtCur(portfolio.totalOutstanding)}</div>
                <div style={{fontSize:11,opacity:.7,marginBottom:6}}>principal + interest</div>
                <div style={{marginTop:4,height:5,background:'rgba(255,255,255,.25)',borderRadius:99}}>
                  <div style={{height:'100%',width:`${repaidPct}%`,background:'#fff',borderRadius:99,transition:'width .6s'}} />
                </div>
                <div style={{marginTop:5,fontSize:11,opacity:.8,display:'flex',justifyContent:'space-between'}}>
                  <span>{outPct.toFixed(1)}% of total payable</span>
                  <span>{repaidPct.toFixed(1)}% repaid</span>
                </div>
              </div>
            );
          })()}

          {/* Paid to Date */}
          <div style={{
            background:'linear-gradient(135deg,#166534 0%,#16a34a 100%)',
            borderRadius:14, padding:'18px 20px', color:'#fff', position:'relative', overflow:'hidden',
          }}>
            <div style={{position:'absolute',right:-8,top:-8,opacity:.13}}>
              <svg width="56" height="56" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"><path d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>
            </div>
            <div style={{fontSize:10,fontWeight:800,letterSpacing:'.08em',textTransform:'uppercase',opacity:.8,marginBottom:6}}>Paid to Date</div>
            <div style={{fontSize:22,fontWeight:900,letterSpacing:'-.5px'}}>{fmtCur(portfolio.totalPaidPrincipal + portfolio.totalPaidInterest)}</div>
            <div style={{marginTop:10,display:'flex',gap:6,flexWrap:'wrap',fontSize:11}}>
              <span style={{background:'rgba(255,255,255,.18)',borderRadius:6,padding:'2px 8px'}}>Pri {fmtCur(portfolio.totalPaidPrincipal)}</span>
              <span style={{background:'rgba(255,255,255,.18)',borderRadius:6,padding:'2px 8px'}}>Int {fmtCur(portfolio.totalPaidInterest)}</span>
            </div>
          </div>

          {/* At Risk */}
          <div style={{
            background: portfolio.atRiskAmount > 0
              ? 'linear-gradient(135deg,#991b1b 0%,#dc2626 100%)'
              : 'linear-gradient(135deg,#166534 0%,#16a34a 100%)',
            borderRadius:14, padding:'18px 20px', color:'#fff', position:'relative', overflow:'hidden',
          }}>
            <div style={{position:'absolute',right:-8,top:-8,opacity:.13}}>
              {portfolio.atRiskAmount > 0
                ? <svg width="56" height="56" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"><path d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"/></svg>
                : <svg width="56" height="56" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"><path d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z"/></svg>
              }
            </div>
            <div style={{fontSize:10,fontWeight:800,letterSpacing:'.08em',textTransform:'uppercase',opacity:.8,marginBottom:6}}>At Risk · Overdue</div>
            <div style={{fontSize:22,fontWeight:900,letterSpacing:'-.5px'}}>{fmtCur(portfolio.atRiskAmount)}</div>
            <div style={{marginTop:10,fontSize:11,opacity:.8}}>
              {portfolio.atRiskAmount > 0
                ? `${portfolio.overdueCount} loan${portfolio.overdueCount!==1?'s':''} with missed payments`
                : 'All payments current'}
            </div>
          </div>
        </div>

        {/* ── Secondary KPI Row ──────────────────────────────────────── */}
        <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit,minmax(150px,1fr))', gap:10 }}>
          {[
            { label:'Active Loans',
              value: portfolio.activeCount, sub: 'carrying balance', color:'#1d4ed8', bg:'#eff6ff', border:'#bfdbfe',
              icon: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"><path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2M9 12h6M9 16h4"/></svg> },
            { label:'Paid Off',
              value: portfolio.paidOffCount, sub: 'fully settled', color:'#15803d', bg:'#f0fdf4', border:'#bbf7d0',
              icon: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"><path d="M5 13l4 4L19 7"/></svg> },
            { label:'Disposed',
              value: portfolio.disposedCount, sub: 'written-off / closed', color:'#64748b', bg:'#f8fafc', border:'#e2e8f0',
              icon: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"><path d="M20 7H4a2 2 0 000 4h16a2 2 0 000-4zM8 11v8M12 11v8M16 11v8"/></svg> },
            { label:'Interest Paid YTD',
              value: fmtCur(ytdInterest), sub: new Date().getFullYear()+' year to date', color:'#dc2626', bg:'#fef2f2', border:'#fecaca',
              icon: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"><path d="M19 14l-7 7m0 0l-7-7m7 7V3"/></svg> },
            { label:'Principal Paid YTD',
              value: fmtCur(ytdPrincipal), sub: new Date().getFullYear()+' year to date', color:'#2563eb', bg:'#eff6ff', border:'#bfdbfe',
              icon: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"><path d="M5 10l7-7m0 0l7 7m-7-7v18"/></svg> },
          ].map(({ label, value, sub, color, bg, border, icon }) => (
            <div key={label} style={{
              background: bg, border:`1px solid ${border}`, borderRadius:12, padding:'14px 15px',
            }}>
              <div style={{display:'flex',alignItems:'center',gap:6,marginBottom:6}}>
                <span style={{color,display:'flex'}}>{icon}</span>
                <span style={{fontSize:9,fontWeight:800,color:'#64748b',letterSpacing:'.07em',textTransform:'uppercase'}}>{label}</span>
              </div>
              <div style={{fontSize:20,fontWeight:900,color,lineHeight:1}}>{value}</div>
              <div style={{fontSize:10,color:'#94a3b8',marginTop:5}}>{sub}</div>
            </div>
          ))}
        </div>

        {/* Alerts feed */}
        <div className="card" style={{padding:0}}>
          <div style={{padding:'12px 16px',borderBottom:'1px solid #f1f5f9',display:'flex',alignItems:'center',justifyContent:'space-between'}}>
            <strong style={{fontSize:13}}>Alerts &amp; Upcoming Payments</strong>
            <span style={{fontSize:11,color:'#64748b'}}>{alerts.length} item{alerts.length!==1?'s':''}</span>
          </div>
          {alerts.length === 0 ? (
            <div className="empty" style={{padding:'28px 16px'}}>
              All clear — no overdue loans and nothing due in the next 14 days.
            </div>
          ) : (
            <div>
              {alerts.map((a, idx) => {
                const s = ALERT_STYLE[a.type];
                return (
                  <div key={idx} style={{
                    display:'flex',alignItems:'center',gap:12,padding:'12px 16px',
                    borderBottom: idx < alerts.length-1 ? '1px solid #f1f5f9' : 'none',
                    background: s.bg,
                  }}>‌
                    <span style={{color:s.color,display:'flex',flexShrink:0}}>{s.icon}</span>
                    <span className="pill" style={{background:'#fff',borderColor:s.border,color:s.color,fontSize:10}}>
                      {s.label}
                    </span>
                    <div style={{flex:1,minWidth:0}}>
                      <div style={{fontWeight:700,fontSize:13,color:'#0f172a'}}>{a.loan.name || `Loan ${a.loan.id}`}</div>
                      <div style={{fontSize:11,color:'#64748b',marginTop:2}}>
                        {a.loan.loanType || 'Loan'}
                        {a.type === 'overdue' && a.missedCount > 0 && <> · {a.missedCount} missed payment{a.missedCount!==1?'s':''}</>}
                        {a.type !== 'overdue' && a.daysToDue != null && <> · in {a.daysToDue} day{a.daysToDue!==1?'s':''}</>}
                      </div>
                    </div>
                    <div style={{textAlign:'right'}}>
                      <div style={{fontWeight:800,fontSize:13,color:s.color}}>{fmtCur(a.amount)}</div>
                      <div style={{fontSize:10,color:'#64748b',marginTop:2}}>Due {a.dueDate || '—'}</div>
                    </div>
                    <button className="btn btn-primary btn-sm" onClick={()=>setPayModal(a.loan.id)}>Record</button>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Recent payments */}
        {recentPayments.length > 0 && (
          <div className="card" style={{padding:0}}>
            <div style={{padding:'12px 16px',borderBottom:'1px solid #f1f5f9',display:'flex',alignItems:'center',justifyContent:'space-between'}}>
              <strong style={{fontSize:13}}>Recent Payments</strong>
              <button className="btn btn-ghost btn-sm" onClick={()=>setActiveTab('history')}>View all →</button>
            </div>
            <table>
              <thead>
                <tr>
                  <th>Date</th><th>Loan</th><th>Method</th>
                  <th style={{textAlign:'right'}}>Interest</th>
                  <th style={{textAlign:'right'}}>Principal</th>
                  <th style={{textAlign:'right'}}>Total</th>
                </tr>
              </thead>
              <tbody>
                {recentPayments.map(p => {
                  const l = loans.find(x => x.id === p.loanId);
                  return (
                    <tr key={p.id}>
                      <td style={{fontSize:12}}>{p.date}</td>
                      <td style={{fontWeight:600}}>{l?.name || p.loanName || p.loanId}</td>
                      <td><span className="pill" style={{background:'#f1f5f9',borderColor:'#cbd5e1',color:'#475569'}}>{p.method || '—'}</span></td>
                      <td style={{textAlign:'right',color:'#dc2626'}}>{fmtCur(p.interest||0)}</td>
                      <td style={{textAlign:'right',color:'#2563eb'}}>{fmtCur(p.principal||0)}</td>
                      <td style={{textAlign:'right',fontWeight:700}}>{fmtCur(p.total||0)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    );
  }

  /* ── Tab: Loan Monitoring (Phase 3) ────────────────────────────── */
  function MonitoringTab() {
    if (loans.length === 0) return <div className="empty">No loans yet. Add loans in the Loan Registry tab.</div>;

    const today = new Date().toISOString().slice(0, 10);

    // Build rows decorated with state
    const rows = loans.map(l => ({ loan: l, st: loanStates[l.id] || {} }));

    // Filter by category
    let filtered;
    if (monitorFilter === 'outstanding') {
      filtered = rows.filter(r => !r.st.isPaidOff && r.loan.status !== 'Disposed');
    } else if (monitorFilter === 'paidoff') {
      filtered = rows.filter(r => r.st.isPaidOff);
    } else if (monitorFilter === 'atrisk') {
      filtered = rows.filter(r => (r.st.missedCount || 0) > 0 && !r.st.isPaidOff);
    } else {
      filtered = rows;
    }

    // Portfolio KPIs (across all loans, not just filtered)
    const kpi = rows.reduce((acc, r) => {
      acc.totalPrincipal += parseFloat(r.loan.principal) || 0;
      acc.totalOutstanding += r.st.outstandingTotal || 0;
      acc.totalPaidPrincipal += r.st.paidPrincipal || 0;
      acc.totalPaidInterest += r.st.paidInterest || 0;
      if (r.st.isPaidOff) acc.paidOffCount++;
      else if (r.loan.status !== 'Disposed') acc.outstandingCount++;
      if ((r.st.missedCount || 0) > 0 && !r.st.isPaidOff) acc.atRiskCount++;
      return acc;
    }, { totalPrincipal:0, totalOutstanding:0, totalPaidPrincipal:0, totalPaidInterest:0,
         outstandingCount:0, paidOffCount:0, atRiskCount:0 });

    const StatusPill = ({ status }) => {
      const map = {
        'Paid-Off':  { bg:'#f0fdf4', border:'#bbf7d0', color:'#15803d' },
        'Overdue':   { bg:'#fef2f2', border:'#fecaca', color:'#b91c1c' },
        'Current':   { bg:'#eff6ff', border:'#bfdbfe', color:'#1d4ed8' },
        'Active':    { bg:'#fff7ed', border:'#fed7aa', color:'#c2410c' },
        'Disposed':  { bg:'#f8fafc', border:'#e2e8f0', color:'#94a3b8' },
      };
      const s = map[status] || map.Active;
      return <span className="pill" style={{ background:s.bg, borderColor:s.border, color:s.color }}>{status}</span>;
    };

    const FilterChip = ({ k, label, count, accent }) => (
      <button
        onClick={() => setMonitorFilter(k)}
        style={{
          border: monitorFilter === k ? `2px solid ${accent}` : '2px solid #e5e7eb',
          background: monitorFilter === k ? accent : '#fff',
          color: monitorFilter === k ? '#fff' : '#0b1220',
          borderRadius: 999, padding: '6px 14px', fontSize: 12, fontWeight: 800,
          cursor: 'pointer', fontFamily: 'inherit', display: 'inline-flex', alignItems: 'center', gap: 8,
        }}
      >
        {label}
        <span style={{
          background: monitorFilter === k ? 'rgba(255,255,255,.25)' : '#f1f5f9',
          color: monitorFilter === k ? '#fff' : '#64748b',
          borderRadius: 999, padding: '1px 8px', fontSize: 11, fontWeight: 800,
        }}>{count}</span>
      </button>
    );

    return (
      <div>
        {/* KPI cards */}
        <div className="summary-bar">
          <div className="scard">
            <div className="scard-label">Total Borrowed</div>
            <div className="scard-value">{fmtCur(kpi.totalPrincipal)}</div>
            <div style={{ fontSize:10, color:'#94a3b8', marginTop:4 }}>{rows.length} loan{rows.length!==1?'s':''}</div>
          </div>
          <div className="scard">
            <div className="scard-label">Outstanding Balance</div>
            <div className="scard-value" style={{ color:'#c2410c' }}>{fmtCur(kpi.totalOutstanding)}</div>
            <div style={{ fontSize:10, color:'#94a3b8', marginTop:4 }}>{kpi.outstandingCount} active · principal + interest</div>
          </div>
          <div className="scard">
            <div className="scard-label">Principal Paid-to-Date</div>
            <div className="scard-value" style={{ color:'#15803d' }}>{fmtCur(kpi.totalPaidPrincipal)}</div>
            <div style={{ fontSize:10, color:'#94a3b8', marginTop:4 }}>Interest paid: {fmtCur(kpi.totalPaidInterest)}</div>
          </div>
          <div className="scard">
            <div className="scard-label">At-Risk Loans</div>
            <div className="scard-value" style={{ color: kpi.atRiskCount > 0 ? '#b91c1c' : '#15803d' }}>
              {kpi.atRiskCount}
            </div>
            <div style={{ fontSize:10, color:'#94a3b8', marginTop:4 }}>{kpi.paidOffCount} paid-off</div>
          </div>
        </div>

        {/* Filter chips */}
        <div style={{ display:'flex', gap:8, marginBottom:14, flexWrap:'wrap' }}>
          <FilterChip k="outstanding" label="Outstanding" count={kpi.outstandingCount} accent="#c2410c" />
          <FilterChip k="atrisk"      label="At-Risk / Overdue" count={kpi.atRiskCount}     accent="#b91c1c" />
          <FilterChip k="paidoff"     label="Paid-Off"    count={kpi.paidOffCount}    accent="#15803d" />
          <FilterChip k="all"         label="All Loans"   count={rows.length}         accent="#0f172a" />
        </div>

        {filtered.length === 0 ? (
          <div className="empty">
            {monitorFilter === 'paidoff'
              ? 'No paid-off loans yet.'
              : monitorFilter === 'atrisk'
              ? 'No at-risk loans. Everything is current.'
              : 'No loans in this category.'}
          </div>
        ) : (
          <div style={{ overflowX:'auto' }}>
            <table>
              <thead>
                <tr>
                  <th>Lender / Loan</th>
                  <th>Type</th>
                  <th style={{textAlign:'right'}}>Principal</th>
                  <th style={{textAlign:'right'}}>Outstanding</th>
                  <th style={{width:140}}>% Paid</th>
                  <th>Last Payment</th>
                  <th>Next Due</th>
                  <th style={{textAlign:'right'}}>Next Amt</th>
                  <th>Status</th>
                  <th style={{width:170}}></th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(({ loan: l, st }) => {
                  const pct = st.percentPaid || 0;
                  const dToNext = daysBetween(today, st.nextDueDate);
                  const dSinceLast = daysBetween(st.lastPaymentDate, today);
                  return (
                    <tr key={l.id}>
                      <td style={{ fontWeight:700 }}>
                        {l.name || `Loan ${l.id}`}
                        {l.bookedAt && <span title="Booked to the general ledger" style={{ marginLeft:6, fontSize:10, fontWeight:800, color:'#15803d', background:'#f0fdf4', border:'1px solid #bbf7d0', borderRadius:999, padding:'1px 6px', verticalAlign:'middle' }}>✓ GL</span>}
                        {l.loanNo && <div style={{ fontFamily:'monospace', fontSize:11, fontWeight:600, color:'#94a3b8' }}>{l.loanNo}</div>}
                      </td>
                      <td style={{ color:'#64748b' }}>{l.loanType || '—'}</td>
                      <td style={{ textAlign:'right' }}>{fmtCur(parseFloat(l.principal)||0)}</td>
                      <td style={{ textAlign:'right', fontWeight:800, color: st.outstandingPrincipal > 0 ? '#c2410c' : '#15803d' }}>
                        {fmtCur(st.outstandingPrincipal || 0)}
                      </td>
                      <td>
                        <div style={{ display:'flex', alignItems:'center', gap:8 }}>
                          <div style={{ flex:1, background:'#f1f5f9', borderRadius:6, height:8, overflow:'hidden' }}>
                            <div style={{
                              width:`${pct}%`, height:'100%',
                              background: pct >= 100 ? '#15803d' : '#f97316',
                            }} />
                          </div>
                          <span style={{ fontSize:11, fontWeight:700, color:'#64748b', minWidth:38, textAlign:'right' }}>
                            {pct.toFixed(0)}%
                          </span>
                        </div>
                      </td>
                      <td style={{ fontSize:11 }}>
                        {st.lastPaymentDate ? (
                          <>
                            {st.lastPaymentDate}
                            {dSinceLast != null && <span style={{ color:'#94a3b8', marginLeft:6 }}>({dSinceLast}d ago)</span>}
                          </>
                        ) : <span style={{ color:'#cbd5e1' }}>—</span>}
                      </td>
                      <td style={{ fontSize:11 }}>
                        {st.nextDueDate ? (
                          <>
                            {st.nextDueDate}
                            {dToNext != null && (
                              <span style={{
                                marginLeft:6, fontWeight:700,
                                color: dToNext < 0 ? '#b91c1c' : dToNext <= 7 ? '#c2410c' : '#94a3b8',
                              }}>
                                {dToNext < 0 ? `${Math.abs(dToNext)}d overdue` : `in ${dToNext}d`}
                              </span>
                            )}
                          </>
                        ) : <span style={{ color:'#cbd5e1' }}>—</span>}
                      </td>
                      <td style={{ textAlign:'right' }}>{st.nextDueAmount ? fmtCur(st.nextDueAmount) : '—'}</td>
                      <td><StatusPill status={st.derivedStatus || 'Active'} /></td>
                      <td style={{ textAlign:'right' }}>
                        {!st.isPaidOff && l.status !== 'Disposed' && (
                          <button className="btn btn-primary btn-sm" onClick={()=>setPayModal(l.id)}>
                            + Record Payment
                          </button>
                        )}
                        {st.isPaidOff && (
                          <span style={{ fontSize:11, color:'#15803d', fontWeight:700 }}>
                            ✓ Paid {st.payoffDate || ''}
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* Overdue installments breakdown — when At-Risk filter active */}
        {monitorFilter === 'atrisk' && filtered.length > 0 && (
          <div style={{ marginTop:24 }}>
            <div style={{ fontSize:11, fontWeight:800, color:'#b91c1c', letterSpacing:'.07em',
              textTransform:'uppercase', marginBottom:10, paddingBottom:6, borderBottom:'2px solid #fecaca' }}>
              Overdue Installments
            </div>
            <table>
              <thead>
                <tr>
                  <th>Loan</th>
                  <th>Period</th>
                  <th>Due Date</th>
                  <th>Days Overdue</th>
                  <th style={{textAlign:'right'}}>Interest Due</th>
                  <th style={{textAlign:'right'}}>Principal Due</th>
                  <th style={{textAlign:'right'}}>Total Due</th>
                </tr>
              </thead>
              <tbody>
                {filtered.flatMap(({ loan: l, st }) =>
                  (st.schedule || [])
                    .filter(r => r.status === 'overdue' || (r.status === 'partial' && r.dueDate < today))
                    .map(r => {
                      const intDue = Math.max(0, r.scheduledInterest - r.paidInterest);
                      const priDue = Math.max(0, r.scheduledPrincipal - r.paidPrincipal);
                      const days = daysBetween(r.dueDate, today) || 0;
                      return (
                        <tr key={l.id+'-'+r.period}>
                          <td style={{ fontWeight:700 }}>{l.name || `Loan ${l.id}`}</td>
                          <td>{r.label} (P{r.period})</td>
                          <td style={{ fontSize:11 }}>{r.dueDate}</td>
                          <td style={{ color:'#b91c1c', fontWeight:700 }}>{days}d</td>
                          <td style={{ textAlign:'right', color:'#dc2626' }}>{fmtCur(intDue)}</td>
                          <td style={{ textAlign:'right', color:'#2563eb' }}>{fmtCur(priDue)}</td>
                          <td style={{ textAlign:'right', fontWeight:900 }}>{fmtCur(intDue+priDue)}</td>
                        </tr>
                      );
                    })
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>
    );
  }

  /* ── Tab: Payment History (Phase 2) ────────────────────────────── */
  function HistoryTab() {
    const filtered = historyLoanFilter === 'all'
      ? payments
      : payments.filter(p => String(p.loanId) === String(historyLoanFilter));

    const totals = filtered.reduce((acc, p) => {
      acc.interest  += p.interest  || 0;
      acc.principal += p.principal || 0;
      acc.penalty   += p.penalty   || 0;
      acc.total     += p.total     || 0;
      return acc;
    }, { interest:0, principal:0, penalty:0, total:0 });

    return (
      <div>
        <div style={{ display:'flex', gap:10, alignItems:'center', marginBottom:12, flexWrap:'wrap' }}>
          <label style={{ fontSize:11, fontWeight:800, color:'#64748b', letterSpacing:'.05em' }}>
            FILTER BY LOAN:
          </label>
          <select className="tbl-sel" value={historyLoanFilter} onChange={e=>setHistoryLoanFilter(e.target.value)}>
            <option value="all">All Loans</option>
            {loans.map(l => <option key={l.id} value={l.id}>{l.name || `Loan ${l.id}`}</option>)}
          </select>
          <span style={{ marginLeft:'auto', fontSize:12, color:'#64748b' }}>
            {filtered.length} payment{filtered.length!==1?'s':''} · Total <strong>{fmtCur(totals.total)}</strong>
          </span>
        </div>

        {filtered.length === 0 ? (
          <div className="empty">
            No payments recorded yet. Use the <strong>+ Record Payment</strong> button in the Loan Details view.
          </div>
        ) : (
          <div style={{ overflowX:'auto' }}>
            <table>
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Contact</th>
                  <th style={{textAlign:'center'}}>Cycle</th>
                  <th>Method</th>
                  <th>Reference</th>
                  <th>Loan Voucher (LV)</th>
                  <th>Check Voucher (CV)</th>
                  <th style={{textAlign:'right'}}>Interest</th>
                  <th style={{textAlign:'right'}}>Principal</th>
                  <th style={{textAlign:'right'}}>Penalty</th>
                  <th style={{textAlign:'right'}}>Total</th>
                  <th>Notes</th>
                  <th style={{width:36}}></th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(p => (
                  <tr key={p.id}>
                    <td style={{ fontSize:11, fontWeight:700 }}>{p.date}</td>
                    <td style={{ fontWeight:700 }}>{(() => { const ln = loans.find(x => String(x.id) === String(p.loanId)); return ln?.name || p.loanName || '—'; })()}</td>
                    <td style={{ textAlign:'center', fontWeight:800, color:'#7c3aed' }}>{(() => { const ln = loans.find(x => String(x.id) === String(p.loanId)); return ln?.cycleCount ? `#${ln.cycleCount}` : '—'; })()}</td>
                    <td style={{ fontSize:11, color:'#64748b' }}>{p.method || '—'}</td>
                    <td style={{ fontSize:11, color:'#64748b' }}>{p.referenceNo || '—'}</td>
                    <td>
                      {p.voucherId ? (() => {
                        const vDoc = voucherMap[p.voucherId];
                        const st   = vDoc?.status || null;
                        const sty  = st ? VOUCHER_STATUS_STYLE[st] : null;
                        return (
                          <div style={{ display:'flex', flexDirection:'column', gap:3 }}>
                            <span style={{ fontSize:11, fontWeight:700, color:'#0b1220', fontFamily:'monospace' }}>{p.voucherId}</span>
                            {st ? (
                              <span style={{ display:'inline-block', padding:'2px 7px', borderRadius:999, fontSize:10, fontWeight:800, border:'1px solid', whiteSpace:'nowrap', ...sty }}>{st}</span>
                            ) : (
                              <span style={{ fontSize:10, color:'#94a3b8' }}>loading…</span>
                            )}
                          </div>
                        );
                      })() : <span style={{ color:'#94a3b8' }}>—</span>}
                    </td>
                    <td>
                      {p.checkVoucherId ? (() => {
                        const cvDoc = voucherMap[p.checkVoucherId];
                        const st    = cvDoc?.status || null;
                        const sty   = st ? VOUCHER_STATUS_STYLE[st] : null;
                        return (
                          <div style={{ display:'flex', flexDirection:'column', gap:3 }}>
                            <span style={{ fontSize:11, fontWeight:700, color:'#0b1220', fontFamily:'monospace' }}>{p.checkVoucherId}</span>
                            {st ? (
                              <span style={{ display:'inline-block', padding:'2px 7px', borderRadius:999, fontSize:10, fontWeight:800, border:'1px solid', whiteSpace:'nowrap', ...sty }}>{st}</span>
                            ) : (
                              <span style={{ fontSize:10, color:'#94a3b8' }}>loading…</span>
                            )}
                          </div>
                        );
                      })() : <span style={{ color:'#94a3b8' }}>—</span>}
                    </td>
                    <td style={{ textAlign:'right', color:'#dc2626' }}>{p.interest ? fmtCur(p.interest) : '—'}</td>
                    <td style={{ textAlign:'right', color:'#2563eb' }}>{p.principal ? fmtCur(p.principal) : '—'}</td>
                    <td style={{ textAlign:'right', color:'#7c2d12' }}>{p.penalty ? fmtCur(p.penalty) : '—'}</td>
                    <td style={{ textAlign:'right', fontWeight:900 }}>{fmtCur(p.total || 0)}</td>
                    <td style={{ fontSize:11, color:'#64748b', maxWidth:220, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
                      {p.notes || ''}
                    </td>
                    <td>
                      <button onClick={()=>deletePayment(p.id)} style={{ background:'none', border:'none', color:'#dc2626', cursor:'pointer', fontWeight:900, fontSize:14 }}>✕</button>
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={7}>TOTALS</td>
                  <td style={{ textAlign:'right', color:'#dc2626' }}>{fmtCur(totals.interest)}</td>
                  <td style={{ textAlign:'right', color:'#2563eb' }}>{fmtCur(totals.principal)}</td>
                  <td style={{ textAlign:'right', color:'#7c2d12' }}>{fmtCur(totals.penalty)}</td>
                  <td style={{ textAlign:'right' }}>{fmtCur(totals.total)}</td>
                  <td colSpan={2}></td>
                </tr>
              </tfoot>
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
  function buildOutstandingRows() {
    return loans
      .filter(l => (l.status || 'Active') === 'Active')
      .map(l => {
        const st             = loanStates[l.id] || {};
        const principal      = parseFloat(l.principal) || 0;
        const outPrincipal   = st.outstandingPrincipal != null ? st.outstandingPrincipal : principal;
        const totalInt       = Math.max(0, loanTotalInterest(l) - (parseFloat(l.processingFee) || 0));
        const outInterest    = Math.max(0, totalInt - (st.paidInterest || 0));
        const totalOutstanding = outPrincipal + outInterest;
        const pctRepaid      = principal > 0 ? Math.max(0, Math.min(100, ((principal - outPrincipal) / principal) * 100)) : 0;
        let payEndDate = '—';
        if (l.payDayMode === 'Every N Days') {
          const pmts = buildIntervalPayments(l);
          if (pmts.length > 0) payEndDate = pmts[pmts.length - 1].dueDate;
        } else if (l.disbursementDate && l.termMonths) {
          const base = new Date(l.disbursementDate);
          const lastMonthDate = new Date(base.getFullYear(), base.getMonth() + parseInt(l.termMonths) - 1, 1);
          const lastKey = lastMonthDate.getFullYear() + '-' + String(lastMonthDate.getMonth() + 1).padStart(2, '0');
          let lastDay;
          if (l.paymentFrequency === 'Semi-Monthly') {
            if (l.payDayMode === 'Variable per Month') {
              const perMonth = l.payDaysPerMonth?.[lastKey] || {};
              const vd2 = parseInt(perMonth.d2), vd1 = parseInt(perMonth.d1);
              if (vd2 >= 1 && vd2 <= 31) lastDay = vd2;
              else if (vd1 >= 1 && vd1 <= 31) lastDay = vd1;
              else { const f2 = parseInt(l.payDay2), f1 = parseInt(l.payDay1); lastDay = (f2 >= 1 && f2 <= 31) ? f2 : (f1 >= 1 && f1 <= 31) ? f1 : base.getDate(); }
            } else {
              const fd2 = parseInt(l.payDay2), fd1 = parseInt(l.payDay1);
              lastDay = (fd2 >= 1 && fd2 <= 31) ? fd2 : (fd1 >= 1 && fd1 <= 31) ? fd1 : base.getDate();
            }
          } else {
            lastDay = base.getDate();
          }
          const daysInLastMonth = new Date(lastMonthDate.getFullYear(), lastMonthDate.getMonth() + 1, 0).getDate();
          const clampedDay = Math.min(lastDay, daysInLastMonth);
          const d = new Date(lastMonthDate.getFullYear(), lastMonthDate.getMonth(), clampedDay);
          if (!isNaN(d.getTime())) payEndDate = d.toISOString().slice(0, 10);
        }
        return { l, principal, outPrincipal, outInterest, totalOutstanding, pctRepaid, payEndDate, nextDue: st.nextDueDate || '—' };
      });
  }

  async function exportOutstandingXLSX() {
    const ExcelJS = (await import('exceljs')).default;
    const rows = buildOutstandingRows();
    const asOf = new Date().toLocaleDateString('en-PH', { dateStyle: 'long' });

    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Outstanding Loans');

    // Column widths
    ws.columns = [
      { width: 30 }, { width: 18 }, { width: 20 }, { width: 22 },
      { width: 22 }, { width: 22 }, { width: 16 }, { width: 18 }, { width: 12 },
    ];

    // Row 1: Title
    const titleRow = ws.addRow([`Outstanding Loans Report — as of ${asOf}`]);
    ws.mergeCells('A1:I1');
    titleRow.getCell(1).font = { bold: true, size: 14 };
    titleRow.height = 22;

    // Row 2: blank
    ws.addRow([]);

    // Row 3: Header
    const headerRow = ws.addRow([
      'Lender / Name', 'Loan Type', 'Principal (₱)', 'Out. Principal (₱)',
      'Out. Interest (₱)', 'Total Outstanding (₱)', 'Next Due Date', 'Payment End Date', '% Repaid',
    ]);
    headerRow.height = 20;
    headerRow.eachCell(cell => {
      cell.font      = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 };
      cell.fill      = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF97316' } };
      cell.alignment = { vertical: 'middle', horizontal: 'left' };
      cell.border    = { bottom: { style: 'thin', color: { argb: 'FFE2E8F0' } } };
    });
    // Right-align numeric header cells
    [3,4,5,6,9].forEach(c => { headerRow.getCell(c).alignment = { vertical: 'middle', horizontal: 'right' }; });

    const toDate = s => {
      if (!s || s === '—') return s || '';
      const d = new Date(s + 'T00:00:00');
      return isNaN(d.getTime()) ? s : d;
    };
    const currFmt = '#,##0.00';
    const dateFmt = 'mm/dd/yyyy';

    // Data rows
    rows.forEach(r => {
      const dataRow = ws.addRow([
        r.l.name || `Loan ${r.l.id}`,
        r.l.loanType || 'Term Loan',
        r.principal, r.outPrincipal, r.outInterest, r.totalOutstanding,
        toDate(r.nextDue), toDate(r.payEndDate),
        parseFloat(r.pctRepaid.toFixed(2)),
      ]);
      dataRow.height = 18;
      // Currency format
      [3,4,5,6].forEach(c => {
        const cell = dataRow.getCell(c);
        cell.numFmt    = currFmt;
        cell.alignment = { horizontal: 'right' };
      });
      // Date format
      [7,8].forEach(c => {
        const cell = dataRow.getCell(c);
        if (cell.value instanceof Date) cell.numFmt = dateFmt;
      });
      // % Repaid
      dataRow.getCell(9).numFmt    = '0.00';
      dataRow.getCell(9).alignment = { horizontal: 'right' };
    });

    // Blank row before totals
    ws.addRow([]);

    // Totals row
    const totalsRow = ws.addRow([
      `TOTALS (${rows.length} active)`, '',
      rows.reduce((s,r)=>s+r.principal,0),
      rows.reduce((s,r)=>s+r.outPrincipal,0),
      rows.reduce((s,r)=>s+r.outInterest,0),
      rows.reduce((s,r)=>s+r.totalOutstanding,0),
      '', '', '',
    ]);
    totalsRow.height = 20;
    totalsRow.eachCell({ includeEmpty: true }, cell => {
      cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E293B' } };
    });
    [3,4,5,6].forEach(c => {
      const cell = totalsRow.getCell(c);
      cell.numFmt    = currFmt;
      cell.alignment = { horizontal: 'right' };
    });

    const buf = await wb.xlsx.writeBuffer();
    const url = URL.createObjectURL(new Blob([buf], { type: 'application/octet-stream' }));
    const a = document.createElement('a');
    a.href = url; a.download = `Outstanding_Loans_${new Date().toISOString().slice(0,10)}.xlsx`;
    a.click(); URL.revokeObjectURL(url);
    setReportDropdown(false);
  }

  async function exportOutstandingPDF() {
    setReportDropdown(false);
    if (!reportTableRef.current) return;
    const { default: jsPDF }       = await import('jspdf');
    const { default: html2canvas } = await import('html2canvas');
    const canvas  = await html2canvas(reportTableRef.current, { scale: 2, useCORS: true, backgroundColor: '#ffffff' });
    const imgData = canvas.toDataURL('image/png');
    const pdf     = new jsPDF('l', 'mm', 'a4');
    const pw      = pdf.internal.pageSize.getWidth();
    const asOf    = new Date().toLocaleDateString('en-PH', { dateStyle: 'long' });
    pdf.setFont('helvetica', 'bold');   pdf.setFontSize(14);
    pdf.text('Outstanding Loans Report', 14, 14);
    pdf.setFont('helvetica', 'normal'); pdf.setFontSize(9); pdf.setTextColor(100);
    pdf.text(`As of ${asOf}`, 14, 21);  pdf.setTextColor(0);
    const imgW = pw - 28;
    pdf.addImage(imgData, 'PNG', 14, 26, imgW, (canvas.height * imgW) / canvas.width);
    pdf.save(`Outstanding_Loans_${new Date().toISOString().slice(0,10)}.pdf`);
  }

  function SummaryTab() {
    const orRows = buildOutstandingRows();
    const orGrand = {
      principal:        orRows.reduce((s,r)=>s+r.principal, 0),
      outPrincipal:     orRows.reduce((s,r)=>s+r.outPrincipal, 0),
      outInterest:      orRows.reduce((s,r)=>s+r.outInterest, 0),
      totalOutstanding: orRows.reduce((s,r)=>s+r.totalOutstanding, 0),
    };
    const fcRows = loans.map(l => {
      const totInt  = loanTotalInterest(l) - (parseFloat(l.processingFee)||0);
      const fee     = parseFloat(l.processingFee)||0;
      const finCost = totInt + fee;
      const pct     = (parseFloat(l.principal)||0) > 0 ? finCost / (parseFloat(l.principal)||0) * 100 : 0;
      return { l, totInt, fee, finCost, pct };
    });
    const fcGrand = {
      principal: fcRows.reduce((s,r)=>s+(parseFloat(r.l.principal)||0),0),
      totInt:    fcRows.reduce((s,r)=>s+r.totInt,0),
      fee:       fcRows.reduce((s,r)=>s+r.fee,0),
      finCost:   fcRows.reduce((s,r)=>s+r.finCost,0),
    };
    const maxFC = Math.max(...fcRows.map(r => r.finCost), 1);
    if (loans.length === 0) return <div className="empty">No loans to summarize.</div>;

    const SECT = {
      fontSize:10, fontWeight:800, color:'#94a3b8', letterSpacing:'.06em', textTransform:'uppercase',
      marginBottom:10, paddingBottom:6, borderBottom:'1px solid #f1f5f9',
      display:'flex', alignItems:'center', justifyContent:'space-between',
    };

    return (
      <div style={{ display:'flex', flexDirection:'column', gap:28 }}>

        {/* ── Outstanding Loans ─────────────────────────────── */}
        <div>
          <div style={SECT}>
            <span>Outstanding Loans</span>
            <div style={{ position:'relative' }}>
              <div style={{ display:'flex', borderRadius:8, overflow:'hidden', border:'1px solid #e2e8f0', fontSize:12, fontWeight:700 }}>
                <button
                  style={{ padding:'6px 14px', background:'#fff', color:'#374151', border:'none', cursor:'pointer', borderRight:'1px solid #e2e8f0' }}
                  onClick={() => exportOutstandingXLSX()}
                >↓ Export Report</button>
                <button
                  style={{ padding:'6px 10px', background:'#fff', color:'#374151', border:'none', cursor:'pointer' }}
                  onClick={() => setReportDropdown(v => !v)}
                >▾</button>
              </div>
              {reportDropdown && (
                <>
                  <div style={{ position:'fixed', inset:0, zIndex:40 }} onClick={() => setReportDropdown(false)} />
                  <div style={{ position:'absolute', right:0, top:'calc(100% + 4px)', zIndex:50, background:'#fff',
                    border:'1px solid #e2e8f0', borderRadius:10, boxShadow:'0 8px 24px rgba(0,0,0,.10)', minWidth:175, overflow:'hidden' }}>
                    <button
                      style={{ display:'flex', alignItems:'center', gap:10, width:'100%', padding:'10px 14px',
                        background:'none', border:'none', cursor:'pointer', fontSize:13, color:'#374151', textAlign:'left' }}
                      onMouseEnter={e=>e.currentTarget.style.background='#f8fafc'}
                      onMouseLeave={e=>e.currentTarget.style.background='none'}
                      onClick={() => exportOutstandingXLSX()}
                    >Export Excel (.xlsx)</button>
                    <button
                      style={{ display:'flex', alignItems:'center', gap:10, width:'100%', padding:'10px 14px',
                        background:'none', border:'none', borderTop:'1px solid #f1f5f9', cursor:'pointer', fontSize:13, color:'#374151', textAlign:'left' }}
                      onMouseEnter={e=>e.currentTarget.style.background='#f8fafc'}
                      onMouseLeave={e=>e.currentTarget.style.background='none'}
                      onClick={() => exportOutstandingPDF()}
                    >Export PDF</button>
                  </div>
                </>
              )}
            </div>
          </div>

          <div ref={reportTableRef} style={{ overflowX:'auto', background:'#fff' }}>
            <table>
              <thead>
                <tr>
                  <th>Lender / Name</th>
                  <th>Type</th>
                  <th style={{textAlign:'right'}}>Principal</th>
                  <th style={{textAlign:'right'}}>Out. Principal</th>
                  <th style={{textAlign:'right'}}>Out. Interest</th>
                  <th style={{textAlign:'right'}}>Total Outstanding</th>
                  <th>Next Due</th>
                  <th>Payment End Date</th>
                  <th style={{textAlign:'right'}}>% Repaid</th>
                </tr>
              </thead>
              <tbody>
                {orRows.length === 0
                  ? <tr><td colSpan={9} style={{ textAlign:'center', color:'#94a3b8', padding:24 }}>No active loans.</td></tr>
                  : orRows.map(({ l, principal, outPrincipal, outInterest, totalOutstanding, pctRepaid, payEndDate, nextDue }) => (
                    <tr key={l.id}>
                      <td style={{ fontWeight:700 }}>{l.name || `Loan ${l.id}`}</td>
                      <td style={{ color:'#64748b' }}>{l.loanType || '—'}</td>
                      <td style={{ textAlign:'right' }}>{fmtCur(principal)}</td>
                      <td style={{ textAlign:'right', color:'#c2410c', fontWeight:700 }}>{fmtCur(outPrincipal)}</td>
                      <td style={{ textAlign:'right', color:'#dc2626' }}>{fmtCur(outInterest)}</td>
                      <td style={{ textAlign:'right', fontWeight:800 }}>{fmtCur(totalOutstanding)}</td>
                      <td style={{ color: nextDue !== '—' ? '#c2410c' : '#94a3b8' }}>{nextDue}</td>
                      <td>{payEndDate}</td>
                      <td style={{ textAlign:'right' }}>
                        <div style={{ display:'flex', alignItems:'center', gap:6, justifyContent:'flex-end' }}>
                          <div style={{ width:48, background:'#f1f5f9', borderRadius:999, height:5, overflow:'hidden' }}>
                            <div style={{ width:`${pctRepaid}%`, height:'100%', borderRadius:999,
                              background: pctRepaid >= 100 ? '#22c55e' : pctRepaid >= 60 ? '#f97316' : '#3b82f6' }} />
                          </div>
                          <span>{pctRepaid.toFixed(1)}%</span>
                        </div>
                      </td>
                    </tr>
                  ))
                }
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={2} style={{ fontWeight:800 }}>TOTALS ({orRows.length} active)</td>
                  <td style={{ textAlign:'right', fontWeight:800 }}>{fmtCur(orGrand.principal)}</td>
                  <td style={{ textAlign:'right', fontWeight:800, color:'#c2410c' }}>{fmtCur(orGrand.outPrincipal)}</td>
                  <td style={{ textAlign:'right', fontWeight:800, color:'#dc2626' }}>{fmtCur(orGrand.outInterest)}</td>
                  <td style={{ textAlign:'right', fontWeight:900, fontSize:14 }}>{fmtCur(orGrand.totalOutstanding)}</td>
                  <td colSpan={3}></td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>

        {/* ── Finance Cost Summary ───────────────────────────── */}
        <div>
          <div style={SECT}><span>Finance Cost Summary</span></div>
          <div style={{ overflowX:'auto' }}>
            <table>
              <thead>
                <tr>
                  <th>Loan / Lender</th><th>Type</th>
                  <th style={{textAlign:'right'}}>Principal</th>
                  <th style={{textAlign:'right'}}>Total Interest</th>
                  <th style={{textAlign:'right'}}>Processing Fee</th>
                  <th style={{textAlign:'right'}}>Finance Cost</th>
                  <th style={{textAlign:'right'}}>% of Principal</th>
                  <th style={{width:120}}>Cost Bar</th>
                </tr>
              </thead>
              <tbody>
                {fcRows.map(({ l, totInt, fee, finCost, pct }) => (
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
                  <td style={{ textAlign:'right' }}>{fmtCur(fcGrand.principal)}</td>
                  <td style={{ textAlign:'right', color:'#dc2626' }}>{fmtCur(fcGrand.totInt)}</td>
                  <td style={{ textAlign:'right' }}>{fmtCur(fcGrand.fee)}</td>
                  <td style={{ textAlign:'right' }}>{fmtCur(fcGrand.finCost)}</td>
                  <td colSpan={2}></td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>

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
      const add = (day, principal, interest) => {
        if (!events[day]) events[day] = [];
        events[day].push({ loan: l, principal, interest, status: 'scheduled' });
      };
      if (l.payDayMode === 'Every N Days') {
        // Each payment lands on an exact date — no monthly row lookup needed
        const allPayments = buildIntervalPayments(l);
        allPayments
          .filter(p => p.date.getFullYear() === calYear && p.date.getMonth() === calMonth)
          .forEach(p => add(p.date.getDate(), p.principal, p.interest));
      } else {
      const row   = sched.find(r => r.label === label);
      if (!row) return;
      // Phase 4b: derive payment status for this loan/month from loanStates
      const stRow = loanStates[l.id]?.schedule?.find(r => r.label === label);
      const status = stRow?.status || 'scheduled';
      const addS = (day, principal, interest) => {
        if (!events[day]) events[day] = [];
        events[day].push({ loan: l, principal, interest, status });
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
        days.forEach(d => addS(d, halfP, halfI));
      } else {
        const day = l.disbursementDate ? new Date(l.disbursementDate).getDate() : 1;
        addS(day, row.principal, row.interest);
      }
      } // end else (non Every-N-Days)
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

        {/* Phase 4b: Status legend */}
        <div style={{ display:'flex', gap:14, alignItems:'center', flexWrap:'wrap',
          background:'#f8fafc', border:'1px solid #e5e7eb', borderRadius:8,
          padding:'6px 12px', marginBottom:8, fontSize:11, fontWeight:600, color:'#64748b' }}>
          <span>Status:</span>
          <span style={{display:'flex',alignItems:'center',gap:5}}><span style={{width:10,height:10,borderRadius:'50%',background:'#16a34a'}}/>Paid</span>
          <span style={{display:'flex',alignItems:'center',gap:5}}><span style={{width:10,height:10,borderRadius:'50%',background:'#d97706'}}/>Partial</span>
          <span style={{display:'flex',alignItems:'center',gap:5}}><span style={{width:10,height:10,borderRadius:'50%',background:'#dc2626'}}/>Overdue</span>
          <span style={{display:'flex',alignItems:'center',gap:5}}><span style={{width:10,height:10,borderRadius:'50%',background:'#f97316'}}/>Scheduled</span>
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
                  // Phase 4b: aggregate worst status across the day's events
                  let dayStatus = null;
                  if (hasEvts) {
                    if (dayEvts.some(e => e.status === 'overdue'))      dayStatus = 'overdue';
                    else if (dayEvts.some(e => e.status === 'partial')) dayStatus = 'partial';
                    else if (dayEvts.every(e => e.status === 'paid'))   dayStatus = 'paid';
                    else                                                dayStatus = 'scheduled';
                  }
                  const STATUS_BG = { paid:'#f0fdf4', partial:'#fffbeb', overdue:'#fef2f2', scheduled:'#fff7ed' };
                  const STATUS_BORDER = { paid:'#86efac', partial:'#fcd34d', overdue:'#fca5a5', scheduled:'#fed7aa' };
                  const bgColor     = dayStatus ? STATUS_BG[dayStatus] : '#fff';
                  const borderColor = isToday ? '#f97316' : (dayStatus ? STATUS_BORDER[dayStatus] : '#e5e7eb');
                  return (
                    <div key={di}
                      onClick={() => hasEvts && setCalDayModal({ day, month: calMonth, year: calYear, events: dayEvts })}
                      style={{
                        minHeight:72, background:bgColor, border:`1px solid ${borderColor}`,
                        borderRadius:8, padding:'6px 7px', cursor: hasEvts ? 'pointer' : 'default',
                        transition:'box-shadow .15s', position:'relative',
                        boxShadow: hasEvts ? '0 1px 4px rgba(0,0,0,.06)' : 'none',
                      }}
                      onMouseEnter={e => { if(hasEvts) e.currentTarget.style.boxShadow='0 3px 10px rgba(249,115,22,.18)'; }}
                      onMouseLeave={e => { e.currentTarget.style.boxShadow= hasEvts ? '0 1px 4px rgba(0,0,0,.06)' : 'none'; }}
                    >
                      <div style={{ fontWeight:700, fontSize:12, marginBottom:3,
                        color: isToday ? '#f97316' : '#0b1220', display:'flex', alignItems:'center', gap:4 }}>
                        <span>{day}</span>
                        {dayStatus && (
                          <span style={{ width:6, height:6, borderRadius:'50%',
                            background: dayStatus==='paid'?'#16a34a':dayStatus==='partial'?'#d97706':dayStatus==='overdue'?'#dc2626':'#f97316' }} />
                        )}
                      </div>
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
              <th></th>
            </tr>
          </thead>
          <tbody>
            {loans.map((l, idx) => {
              const pm  = l.paymentMethod || 'Check';
              const clr = PM[pm] || PM.Check;
              let details = '';
              if (pm === 'Check') {
                const chks = l.pmChecks || [];
                details = chks.map(c => typeof c === 'string' ? c : c.checkNo).filter(Boolean).join(', ') || '—';
              }
              else if (pm === 'Auto-Debit') {
                const adaAcct = calAccounts.find(a => a.code === l.pmAdaAccountCode);
                details = `${adaAcct ? adaAcct.name : l.pmAdaAccountCode || '—'}${l.pmAdaDay ? ` · Day ${l.pmAdaDay}` : ''}`;
              }
              else if (pm === 'Bank Transfer') {
                const parts = [l.pmBtBankName, l.pmBtAccountName, l.pmBtAccountNumber].filter(Boolean);
                details = parts.join(' · ') || '—';
              }
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
                    <button className="btn btn-ghost btn-sm" onClick={()=>{
                      setPmModal(l.id);
                      setPmForm({
                        paymentMethod:    l.paymentMethod    || 'Check',
                        checkbookId:      l.pmCheckbookId    || '',
                        checks:           l.pmChecks         || [],
                        pmBtBankName:     l.pmBtBankName     || '',
                        pmBtAccountName:  l.pmBtAccountName  || '',
                        pmBtAccountNumber:l.pmBtAccountNumber|| '',
                        pmAdaAccountCode: l.pmAdaAccountCode || '',
                        pmAdaDay:         l.pmAdaDay         || '',
                      });
                    }}>Edit</button>
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
        <div />
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
        {activeTab === 'dashboard'  && DashboardTab()}
        {activeTab === 'loans'      && LoansTab()}
        {activeTab === 'monitoring' && MonitoringTab()}
        {activeTab === 'history'    && HistoryTab()}
        {activeTab === 'schedule'   && ScheduleTab()}
        {activeTab === 'summary'    && SummaryTab()}
        {activeTab === 'calendar'   && CalendarTab()}
        {activeTab === 'payment'    && PaymentTab()}
      </div>

      {/* Loan Detail Modal */}
      {loanDetailModal && (() => {
        const l   = loans.find(x => x.id === loanDetailModal);
        if (!l) return null;
        const st          = loanStates[l.id] || {};
        const isActive    = (l.status || 'Active') === 'Active';
        const typeColor   = LOAN_TYPE_COLORS[l.loanType] || LOAN_TYPE_COLORS['Other'];
        const principal   = parseFloat(l.principal) || 0;
        const outstanding = st.outstandingPrincipal != null ? st.outstandingPrincipal : principal;
        const progress    = principal > 0 ? Math.max(0, Math.min(100, ((principal - outstanding) / principal) * 100)) : 0;
        const progColor   = progress >= 100 ? '#22c55e' : progress >= 60 ? '#f97316' : '#3b82f6';
        const METHOD_SHORT_D = {
          'Reducing Balance':             'Reducing Balance',
          'Straight-Line':                'Straight-Line',
          'Straight-Line (Monthly Rate)': 'Straight-Line (Monthly Rate)',
          'Fixed':                        'Fixed',
          'Balloon':                      'Balloon',
        };
        const payLabel = l.paymentFrequency === 'Semi-Monthly'
          ? (l.payDayMode === 'Every N Days' ? `Every ${l.intervalDays || 15} Days`
            : l.payDayMode === 'Variable per Month' ? 'Semi-Monthly (Variable)'
            : l.payDay1 && l.payDay2 ? `Semi-Monthly · Day ${l.payDay1} & ${l.payDay2}` : 'Semi-Monthly')
          : 'Monthly';
        const totalPaid    = (st.paidPrincipal || 0) + (st.paidInterest || 0);
        const paymentCount = (payments || []).filter(p => p.loanId === l.id).length;

        return (
          <div className="backdrop" onClick={e => { if (e.target === e.currentTarget) { setLoanDetailModal(null); setLoanDetailTab('details'); } }}>
            <div className="modal" style={{ width:'min(1200px,98vw)', height:'88vh' }}>

              {/* ── Header ──────────────────────────────────────── */}
              <div className="modal-h" style={{ background:'#fff', borderBottom:'1px solid #f1f5f9' }}>
                <div style={{ display:'flex', alignItems:'center', gap:12, flex:1, minWidth:0 }}>
                  <div style={{
                    width:40, height:40, borderRadius:12, flexShrink:0,
                    background: typeColor.bg, border:`1px solid ${typeColor.color}22`,
                    display:'flex', alignItems:'center', justifyContent:'center', fontSize:20
                  }}>🏦</div>
                  <div style={{ minWidth:0 }}>
                    <div style={{ fontWeight:900, fontSize:16, color:'#0b1220', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
                      {l.name || 'Unnamed Loan'}
                    </div>
                    <div style={{ display:'flex', alignItems:'center', gap:6, marginTop:3 }}>
                      {l.loanNo && <span style={{ fontFamily:'monospace', fontSize:11, fontWeight:700, color:'#64748b' }}>{l.loanNo}</span>}
                      <span className="lr-type-badge" style={{ background:typeColor.bg, color:typeColor.color }}>
                        {l.loanType || 'Term Loan'}
                      </span>
                      <span className="pill" style={isActive
                        ? { background:'#f0fdf4', borderColor:'#bbf7d0', color:'#15803d' }
                        : { background:'#f8fafc', borderColor:'#e2e8f0', color:'#94a3b8' }}>
                        {l.status || 'Active'}
                      </span>
                    </div>
                  </div>
                </div>
                <button className="btn btn-ghost btn-sm" style={{ flexShrink:0 }} onClick={() => { setLoanDetailModal(null); setLoanDetailTab('details'); }}>✕</button>
              </div>

              {/* ── Tabs ────────────────────────────────────────── */}
              <div style={{ display:'flex', borderBottom:'2px solid #f1f5f9', background:'#fff', padding:'0 22px' }}>
                {[['details','Details'],['schedule','Payment Schedule'],['history','Payment History']].map(([key, label]) => (
                  <button key={key}
                    onClick={() => setLoanDetailTab(key)}
                    style={{
                      border:'none', background:'none', cursor:'pointer', fontFamily:'inherit',
                      padding:'10px 18px', fontSize:12, fontWeight:700, letterSpacing:'.04em',
                      color: loanDetailTab === key ? '#f97316' : '#94a3b8',
                      borderBottom: loanDetailTab === key ? '2px solid #f97316' : '2px solid transparent',
                      marginBottom:'-2px', transition:'color .15s',
                    }}>
                    {label}
                  </button>
                ))}
              </div>

              {/* ── Body ────────────────────────────────────────── */}
              <div className="modal-b" style={{ padding: loanDetailTab === 'schedule' ? '0' : '18px 22px' }}>

              {loanDetailTab === 'details' ? (<>

                {/* Outstanding Hero */}
                <div className="lr-hero-outstanding" style={{
                  background: outstanding > 0 ? '#fff7ed' : '#f0fdf4',
                  border: `1px solid ${outstanding > 0 ? '#fed7aa' : '#bbf7d0'}`,
                  margin:'18px 22px 0', borderRadius:14,
                }}>
                  <div>
                    <div style={{ fontSize:9, fontWeight:800, color: outstanding > 0 ? '#c2410c' : '#15803d', letterSpacing:'.07em', textTransform:'uppercase', marginBottom:4, opacity:.75 }}>
                      Outstanding Balance
                    </div>
                    <div style={{ fontSize:26, fontWeight:900, color: outstanding > 0 ? '#c2410c' : '#15803d', lineHeight:1 }}>
                      {fmtCur(outstanding)}
                    </div>
                    <div style={{ fontSize:11, color: outstanding > 0 ? '#c2410c' : '#15803d', opacity:.65, marginTop:4 }}>
                      of {fmtCur(principal)} original principal
                    </div>
                  </div>
                  <div style={{ flex:1, maxWidth:220 }}>
                    <div style={{ display:'flex', justifyContent:'space-between', fontSize:10, fontWeight:700, color:'#64748b', marginBottom:5 }}>
                      <span>Repaid</span><span>{progress.toFixed(1)}%</span>
                    </div>
                    <div className="lr-prog-track" style={{ height:8 }}>
                      <div className="lr-prog-fill" style={{ width:`${progress}%`, background:progColor }} />
                    </div>
                    <div style={{ display:'flex', justifyContent:'space-between', fontSize:10, color:'#94a3b8', marginTop:5 }}>
                      <span>{fmtCur(st.paidPrincipal || 0)} paid</span>
                      <span>{fmtCur(outstanding)} left</span>
                    </div>
                  </div>
                </div>

                <div style={{ padding:'0 22px' }}>

                {/* Loan Terms */}
                <div className="lr-detail-sect">Loan Terms</div>
                <div className="lr-detail-grid" style={{ marginBottom:4 }}>
                  <div className="lr-detail-item">
                    <div className="lr-detail-lbl">Principal</div>
                    <div className="lr-detail-val">{fmtCur(principal)}</div>
                  </div>
                  <div className="lr-detail-item">
                    <div className="lr-detail-lbl">Processing Fee</div>
                    <div className={l.processingFee > 0 ? 'lr-detail-val' : 'lr-detail-val-dim'}>
                      {l.processingFee > 0 ? fmtCur(l.processingFee) : '—'}
                    </div>
                  </div>
                  <div className="lr-detail-item">
                    <div className="lr-detail-lbl">Term</div>
                    <div className="lr-detail-val">{l.termMonths || '—'} months</div>
                  </div>
                  <div className="lr-detail-item">
                    <div className="lr-detail-lbl">Annual Rate</div>
                    <div className="lr-detail-val">{l.annualRate || '—'}%</div>
                  </div>
                  <div className="lr-detail-item lr-detail-2col">
                    <div className="lr-detail-lbl">Interest Method</div>
                    <div className="lr-detail-val">{METHOD_SHORT_D[l.interestMethod] || l.interestMethod || '—'}</div>
                  </div>
                </div>

                {/* Schedule */}
                <div className="lr-detail-sect">Payment Schedule</div>
                <div className="lr-detail-grid" style={{ marginBottom:4 }}>
                  <div className="lr-detail-item">
                    <div className="lr-detail-lbl">First Payment Date</div>
                    <div className={l.disbursementDate ? 'lr-detail-val' : 'lr-detail-val-dim'}>{l.disbursementDate || '—'}</div>
                  </div>
                  <div className="lr-detail-item">
                    <div className="lr-detail-lbl">Proceeds Date</div>
                    <div className={l.proceedsDate ? 'lr-detail-val' : 'lr-detail-val-dim'}>{l.proceedsDate || '—'}</div>
                  </div>
                  <div className="lr-detail-item lr-detail-2col">
                    <div className="lr-detail-lbl">Payment Schedule</div>
                    <div className="lr-detail-val">{payLabel}</div>
                  </div>
                  {st.nextDueDate && (
                    <div className="lr-detail-item">
                      <div className="lr-detail-lbl">Next Due Date</div>
                      <div className="lr-detail-val" style={{ color:'#c2410c' }}>{st.nextDueDate}</div>
                    </div>
                  )}
                </div>

                {/* Activity */}
                <div className="lr-detail-sect">Repayment Activity</div>
                <div className="lr-detail-grid">
                  <div className="lr-detail-item">
                    <div className="lr-detail-lbl">Payments Made</div>
                    <div className="lr-detail-val">{paymentCount}</div>
                  </div>
                  <div className="lr-detail-item">
                    <div className="lr-detail-lbl">Last Payment</div>
                    <div className={st.lastPaymentDate ? 'lr-detail-val' : 'lr-detail-val-dim'}>{st.lastPaymentDate || '—'}</div>
                  </div>
                  <div className="lr-detail-item">
                    <div className="lr-detail-lbl">Total Paid</div>
                    <div className="lr-detail-val" style={{ color:'#15803d' }}>{fmtCur(totalPaid)}</div>
                  </div>
                  <div className="lr-detail-item">
                    <div className="lr-detail-lbl">Principal Paid</div>
                    <div className="lr-detail-val">{fmtCur(st.paidPrincipal || 0)}</div>
                  </div>
                  <div className="lr-detail-item">
                    <div className="lr-detail-lbl">Interest Paid</div>
                    <div className="lr-detail-val">{fmtCur(st.paidInterest || 0)}</div>
                  </div>
                  {(st.overdueAmount || 0) > 0 && (
                    <div className="lr-detail-item">
                      <div className="lr-detail-lbl">Overdue Amount</div>
                      <div className="lr-detail-val" style={{ color:'#dc2626' }}>{fmtCur(st.overdueAmount)}</div>
                    </div>
                  )}
                </div>

                </div>{/* end inner padding */}

              </>) : loanDetailTab === 'schedule' ? (() => {
                /* ── Payment Schedule Tab ───────────────────────── */
                const schedule = buildScheduleWithDueDates(l);
                const today = new Date().toISOString().slice(0,10);
                if (schedule.length === 0) return (
                  <div style={{ textAlign:'center', padding:'48px 22px', color:'#94a3b8', fontSize:13 }}>
                    No schedule available. Set First Payment Date and Term first.
                  </div>
                );
                const totalPrincipal = schedule.reduce((s,r) => s + r.scheduledPrincipal, 0);
                const totalInterest  = schedule.reduce((s,r) => s + r.scheduledInterest + (r.processingFee||0), 0);
                const totalPayment   = schedule.reduce((s,r) => s + r.scheduledTotal + (r.processingFee||0), 0);
                return (
                  <div style={{ overflowX:'auto' }}>
                    <table style={{ width:'100%', borderCollapse:'collapse', fontSize:11 }}>
                      <thead>
                        <tr style={{ background:'#f97316', color:'#fff' }}>
                          <th style={{ padding:'9px 10px', textAlign:'center', fontWeight:800, letterSpacing:'.04em', whiteSpace:'nowrap' }}>#</th>
                          <th style={{ padding:'9px 10px', textAlign:'center', fontWeight:800, letterSpacing:'.04em', whiteSpace:'nowrap' }}>Due Date</th>
                          <th style={{ padding:'9px 10px', textAlign:'right',  fontWeight:800, letterSpacing:'.04em', whiteSpace:'nowrap' }}>Opening Bal.</th>
                          <th style={{ padding:'9px 10px', textAlign:'right',  fontWeight:800, letterSpacing:'.04em', whiteSpace:'nowrap' }}>Principal</th>
                          <th style={{ padding:'9px 10px', textAlign:'right',  fontWeight:800, letterSpacing:'.04em', whiteSpace:'nowrap' }}>Interest</th>
                          <th style={{ padding:'9px 10px', textAlign:'right',  fontWeight:800, letterSpacing:'.04em', whiteSpace:'nowrap' }}>Payment</th>
                          <th style={{ padding:'9px 10px', textAlign:'right',  fontWeight:800, letterSpacing:'.04em', whiteSpace:'nowrap' }}>Closing Bal.</th>
                          <th style={{ padding:'9px 10px', textAlign:'center', fontWeight:800, letterSpacing:'.04em', whiteSpace:'nowrap' }}>Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {schedule.map((row, idx) => {
                          const isPast    = row.dueDate < today;
                          const isCurrent = row.dueDate === st.nextDueDate;
                          const paid      = row.paidPrincipal + row.paidInterest >= row.scheduledTotal * 0.99;
                          const rowBg     = paid ? '#f0fdf4' : isCurrent ? '#fff7ed' : idx % 2 === 0 ? '#fff' : '#f8fafc';
                          const rowColor  = paid ? '#15803d' : isCurrent ? '#c2410c' : isPast ? '#94a3b8' : '#0b1220';
                          const statusLabel = paid ? 'Paid' : isCurrent ? 'Current' : isPast ? 'Overdue' : 'Scheduled';
                          const statusColor = paid ? '#15803d' : isCurrent ? '#c2410c' : isPast ? '#ef4444' : '#64748b';
                          const statusBg    = paid ? '#f0fdf4' : isCurrent ? '#fff7ed' : isPast ? '#fef2f2' : '#f1f5f9';
                          return (<>
                            <tr key={row.period} style={{ background:rowBg, color:rowColor, borderBottom: row.processingFee ? 'none' : '1px solid #f1f5f9' }}>
                              <td style={{ padding:'7px 10px', textAlign:'center', fontWeight:700 }}>{row.period}</td>
                              <td style={{ padding:'7px 10px', textAlign:'center', fontFamily:'monospace', fontSize:11 }}>{row.dueDate}</td>
                              <td style={{ padding:'7px 10px', textAlign:'right' }}>{fmtCur(row.openingBalance ?? 0)}</td>
                              <td style={{ padding:'7px 10px', textAlign:'right' }}>{fmtCur(row.scheduledPrincipal)}</td>
                              <td style={{ padding:'7px 10px', textAlign:'right', color:'#f97316' }}>{fmtCur(row.scheduledInterest)}</td>
                              <td style={{ padding:'7px 10px', textAlign:'right', fontWeight:700 }}>{fmtCur(row.scheduledTotal)}</td>
                              <td style={{ padding:'7px 10px', textAlign:'right' }}>{fmtCur(row.closingBalance)}</td>
                              <td style={{ padding:'7px 10px', textAlign:'center' }}>
                                <span style={{ background:statusBg, color:statusColor, borderRadius:6, padding:'2px 8px', fontWeight:700, fontSize:10 }}>
                                  {statusLabel}
                                </span>
                              </td>
                            </tr>
                            {row.processingFee > 0 && (
                              <tr key={`${row.period}-fee`} style={{ background:'#f0fdf4', color:'#15803d', borderBottom:'1px solid #f1f5f9' }}>
                                <td style={{ padding:'4px 10px', textAlign:'center', color:'#86efac', fontSize:10 }}>↳</td>
                                <td style={{ padding:'4px 10px', textAlign:'center', fontStyle:'italic', fontSize:10, color:'#15803d' }}>Processing Fee</td>
                                <td />
                                <td />
                                <td style={{ padding:'4px 10px', textAlign:'right', color:'#15803d', fontWeight:600 }}>{fmtCur(row.processingFee)}</td>
                                <td style={{ padding:'4px 10px', textAlign:'right', color:'#15803d', fontWeight:600 }}>{fmtCur(row.processingFee)}</td>
                                <td />
                                <td style={{ padding:'4px 10px', textAlign:'center' }}>
                                  <span style={{ background:'#f0fdf4', color:'#15803d', borderRadius:6, padding:'2px 8px', fontWeight:700, fontSize:10 }}>Paid</span>
                                </td>
                              </tr>
                            )}
                          </>);
                        })}
                      </tbody>
                      <tfoot>
                        <tr style={{ background:'#1e293b', color:'#fff', fontWeight:800 }}>
                          <td colSpan={3} style={{ padding:'8px 10px', textAlign:'right', fontSize:11, letterSpacing:'.04em' }}>TOTALS</td>
                          <td style={{ padding:'8px 10px', textAlign:'right' }}>{fmtCur(totalPrincipal)}</td>
                          <td style={{ padding:'8px 10px', textAlign:'right', color:'#fb923c' }}>{fmtCur(totalInterest)}</td>
                          <td style={{ padding:'8px 10px', textAlign:'right' }}>{fmtCur(totalPayment)}</td>
                          <td colSpan={2} />
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                );
              })() : (() => {
                /* ── Payment History Tab ──────────────────────────── */
                const loanPayments = (payments || [])
                  .filter(p => String(p.loanId) === String(l.id))
                  .sort((a, b) => (b.date || '').localeCompare(a.date || ''));
                if (loanPayments.length === 0) return (
                  <div style={{ textAlign:'center', padding:'48px 22px', color:'#94a3b8', fontSize:13 }}>
                    No payments recorded yet.
                    {!st.isPaidOff && l.status !== 'Disposed' && (
                      <div style={{ marginTop:12 }}>
                        <button className="btn btn-primary btn-sm"
                          onClick={() => { setLoanDetailModal(null); setLoanDetailTab('details'); setPayModal(l.id); }}>
                          + Record First Payment
                        </button>
                      </div>
                    )}
                  </div>
                );
                const totals = loanPayments.reduce((acc, p) => ({
                  interest:  acc.interest  + (p.interest  || 0),
                  principal: acc.principal + (p.principal || 0),
                  penalty:   acc.penalty   + (p.penalty   || 0),
                  total:     acc.total     + (p.total     || 0),
                }), { interest:0, principal:0, penalty:0, total:0 });
                return (
                  <div style={{ overflowX:'auto' }}>
                    <table style={{ width:'100%', borderCollapse:'collapse', fontSize:11 }}>
                      <thead>
                        <tr style={{ background:'#f97316', color:'#fff' }}>
                          <th style={{ padding:'9px 10px', fontWeight:800, whiteSpace:'nowrap' }}>Date</th>
                          <th style={{ padding:'9px 10px', fontWeight:800, whiteSpace:'nowrap' }}>Method</th>
                          <th style={{ padding:'9px 10px', fontWeight:800, whiteSpace:'nowrap' }}>Reference</th>
                          <th style={{ padding:'9px 10px', textAlign:'right', fontWeight:800, whiteSpace:'nowrap' }}>Interest</th>
                          <th style={{ padding:'9px 10px', textAlign:'right', fontWeight:800, whiteSpace:'nowrap' }}>Principal</th>
                          <th style={{ padding:'9px 10px', textAlign:'right', fontWeight:800, whiteSpace:'nowrap' }}>Penalty</th>
                          <th style={{ padding:'9px 10px', textAlign:'right', fontWeight:800, whiteSpace:'nowrap' }}>Total</th>
                          <th style={{ padding:'9px 10px', fontWeight:800 }}>Notes</th>
                          <th style={{ padding:'9px 10px', width:36 }}></th>
                        </tr>
                      </thead>
                      <tbody>
                        {loanPayments.map((p, idx) => (
                          <tr key={p.id} style={{ background: idx % 2 === 0 ? '#fff' : '#f8fafc', borderBottom:'1px solid #f1f5f9' }}>
                            <td style={{ padding:'7px 10px', fontFamily:'monospace', fontWeight:700 }}>{p.date}</td>
                            <td style={{ padding:'7px 10px', color:'#64748b' }}>{p.method || '—'}</td>
                            <td style={{ padding:'7px 10px', color:'#64748b', fontFamily:'monospace' }}>{p.referenceNo || '—'}</td>
                            <td style={{ padding:'7px 10px', textAlign:'right', color:'#dc2626' }}>{p.interest ? fmtCur(p.interest) : '—'}</td>
                            <td style={{ padding:'7px 10px', textAlign:'right', color:'#2563eb' }}>{p.principal ? fmtCur(p.principal) : '—'}</td>
                            <td style={{ padding:'7px 10px', textAlign:'right', color:'#7c2d12' }}>{p.penalty ? fmtCur(p.penalty) : '—'}</td>
                            <td style={{ padding:'7px 10px', textAlign:'right', fontWeight:700 }}>{fmtCur(p.total || 0)}</td>
                            <td style={{ padding:'7px 10px', color:'#64748b', maxWidth:160, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{p.notes || ''}</td>
                            <td style={{ padding:'7px 10px', textAlign:'center' }}>
                              <button onClick={() => deletePayment(p.id)} style={{ background:'none', border:'none', color:'#dc2626', cursor:'pointer', fontWeight:900, fontSize:13 }}>✕</button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                      <tfoot>
                        <tr style={{ background:'#1e293b', color:'#fff', fontWeight:800 }}>
                          <td colSpan={3} style={{ padding:'8px 10px', textAlign:'right', fontSize:11, letterSpacing:'.04em' }}>TOTALS</td>
                          <td style={{ padding:'8px 10px', textAlign:'right', color:'#fca5a5' }}>{fmtCur(totals.interest)}</td>
                          <td style={{ padding:'8px 10px', textAlign:'right', color:'#93c5fd' }}>{fmtCur(totals.principal)}</td>
                          <td style={{ padding:'8px 10px', textAlign:'right' }}>{fmtCur(totals.penalty)}</td>
                          <td style={{ padding:'8px 10px', textAlign:'right' }}>{fmtCur(totals.total)}</td>
                          <td colSpan={2} />
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                );
              })()}

              </div>{/* end modal-b */}

              {/* ── Footer ──────────────────────────────────────── */}
              <div className="modal-f" style={{ justifyContent:'space-between', alignItems:'center' }}>
                {!isAdmin && (
                  <span className="lr-lock-notice">
                    🔒 <span>Editing requires <strong>Admin</strong> access</span>
                  </span>
                )}
                {/* Ledger booking status / action */}
                {l.bookedAt ? (
                  <span style={{ display:'inline-flex', alignItems:'center', gap:8, fontSize:12, fontWeight:700, color:'#15803d' }}>
                    <span style={{ background:'#f0fdf4', border:'1px solid #bbf7d0', borderRadius:999, padding:'3px 10px' }}>✓ Booked to Ledger</span>
                    {isAdmin && <button className="btn btn-ghost btn-sm" onClick={() => doUnbookLoan(l)}>Unbook</button>}
                  </span>
                ) : isAdmin && (
                  <span style={{ display:'inline-flex', alignItems:'center', gap:6 }}>
                    <button className="btn btn-sm" style={{ background:'#eff6ff', color:'#1d4ed8', border:'1.5px solid #bfdbfe', fontWeight:700 }}
                      onClick={() => doBookLoan(l, 'disbursement')} title="Post the loan disbursement entry">📒 Book to Ledger</button>
                    <button className="btn btn-ghost btn-sm" onClick={() => doBookLoan(l, 'opening_balance')} title="Book as an opening balance (pre-existing loan)">Opening Bal.</button>
                  </span>
                )}
                <div style={{ display:'flex', gap:8, marginLeft:'auto' }}>
                  <button className="btn btn-ghost" onClick={() => { setLoanDetailModal(null); setLoanDetailTab('details'); }}>Close</button>
                  {!st.isPaidOff && l.status !== 'Disposed' && (
                    <button
                      className="btn btn-secondary"
                      style={{ background:'#fff7ed', color:'#c2410c', border:'1.5px solid #fed7aa', fontWeight:700 }}
                      onClick={() => { setLoanDetailModal(null); setLoanDetailTab('details'); setPayModal(l.id); }}
                    >+ Record Payment</button>
                  )}
                  {isAdmin && (
                    <button
                      className="btn btn-primary"
                      onClick={() => {
                        setLoanDetailModal(null);
                        setLoanDetailTab('details');
                        setPdFillD1(''); setPdFillD2('');
                        setLoanFormModal({ mode:'edit', data:{ ...l } });
                      }}
                    >✎ Edit Loan</button>
                  )}
                </div>
              </div>

            </div>
          </div>
        );
      })()}

      {/* Loan Form Modal (Add / Edit) */}
      {loanFormModal && (() => {
        const isNew = loanFormModal.mode === 'new';
        const fd    = loanFormModal.data;
        const set   = (field, val) =>
          setLoanFormModal(prev => ({ ...prev, data: { ...prev.data, [field]: val } }));
        const isSemiMonthly = fd.paymentFrequency === 'Semi-Monthly';
        const canSave = !!(fd.name?.trim());
        const typeColor = LOAN_TYPE_COLORS[fd.loanType] || LOAN_TYPE_COLORS['Other'];
        return (
          <div className="backdrop" onClick={e => { if (e.target === e.currentTarget) setLoanFormModal(null); }}>
            <div className="modal" style={{ width:'min(1200px,98vw)', height:'88vh' }}>

              {/* ── Header ──────────────────────────────────────── */}
              <div className="modal-h">
                <div style={{ display:'flex', alignItems:'center', gap:10 }}>
                  <div style={{
                    width:36, height:36, borderRadius:10,
                    background:'#fff7ed', border:'1px solid #fed7aa',
                    display:'flex', alignItems:'center', justifyContent:'center', fontSize:18
                  }}>🏦</div>
                  <div>
                    <div style={{ fontWeight:900, fontSize:15 }}>
                      {isNew ? 'New Loan' : 'Edit Loan'}
                    </div>
                    <div style={{ fontSize:11, color:'#94a3b8' }}>
                      {isNew ? 'Register a new loan facility'
                             : `Editing: ${fd.name || `Loan ${fd.id}`}`}
                    </div>
                  </div>
                </div>
                <button className="btn btn-ghost btn-sm" onClick={() => setLoanFormModal(null)}>✕</button>
              </div>

              {/* ── Body ────────────────────────────────────────── */}
              <div className="modal-b">

                {/* Section: Lender */}
                <div style={{ fontSize:10, fontWeight:800, color:'#94a3b8', letterSpacing:'.06em', textTransform:'uppercase', marginBottom:10, paddingBottom:6, borderBottom:'1px solid #f1f5f9' }}>
                  Lender Information
                </div>
                <div className="lr-form-grid">
                  <div className="field lr-form-full">
                    <label>Contact / Lender Name <span style={{color:'#ef4444'}}>*</span></label>
                    <input
                      list="fp-lender-modal-list"
                      value={fd.name||''}
                      onChange={e => {
                        const newName = e.target.value;
                        set('name', newName);
                        // Auto-compute cycle: count all loans with same name (excluding self in edit)
                        const sameName = loans.filter(l =>
                          l.name?.trim().toLowerCase() === newName.trim().toLowerCase() &&
                          (isNew ? true : l.id !== fd.id)
                        );
                        set('cycleCount', sameName.length + 1);
                      }}
                      placeholder="e.g. BDO Universal Bank"
                      autoFocus
                    />
                    <datalist id="fp-lender-modal-list">
                      {[...new Set(loans.map(l => l.name).filter(Boolean))].map(n => <option key={n} value={n} />)}
                    </datalist>
                  </div>
                  <div className="field">
                    <label>Loan Type</label>
                    <select value={fd.loanType||'Term Loan'} onChange={e => set('loanType', e.target.value)}>
                      {LOAN_TYPES.map(t => <option key={t}>{t}</option>)}
                    </select>
                    <span className="lr-type-badge" style={{ background:typeColor.bg, color:typeColor.color, marginTop:2 }}>
                      {fd.loanType || 'Term Loan'}
                    </span>
                  </div>
                  <div className="field">
                    <label>Status</label>
                    <select value={fd.status||'Active'} onChange={e => set('status', e.target.value)}>
                      {['Active','Disposed'].map(s => <option key={s}>{s}</option>)}
                    </select>
                  </div>
                  <div className="field">
                    <label>Cycle Count</label>
                    <input
                      type="number"
                      value={fd.cycleCount || 1}
                      readOnly
                      style={{ background:'#f8fafc', color:'#7c3aed', fontWeight:800, cursor:'default' }}
                    />
                    <span style={{ fontSize:10, color:'#94a3b8', marginTop:3 }}>
                      Auto-set · Cycle #{fd.cycleCount || 1} for this contact
                      {(fd.cycleCount || 1) > 1 && ` (${fd.cycleCount - 1} prior loan${fd.cycleCount - 1 > 1 ? 's' : ''} found)`}
                    </span>
                  </div>
                </div>

                {/* Section: Loan Terms */}
                <div style={{ fontSize:10, fontWeight:800, color:'#94a3b8', letterSpacing:'.06em', textTransform:'uppercase', marginBottom:10, paddingBottom:6, borderBottom:'1px solid #f1f5f9' }}>
                  Loan Terms
                </div>
                <div className="lr-form-grid">
                  <div className="field">
                    <label>Principal ₱</label>
                    <input type="number" value={fd.principal||''} onChange={e => set('principal', parseFloat(e.target.value)||0)} placeholder="0.00" />
                  </div>
                  <div className="field">
                    <label>Processing Fee ₱</label>
                    <input type="number" value={fd.processingFee||''} onChange={e => set('processingFee', parseFloat(e.target.value)||0)} placeholder="0.00" />
                  </div>
                  <div className="field">
                    <label>Term (months)</label>
                    <input type="number" value={fd.termMonths||''} onChange={e => set('termMonths', parseInt(e.target.value)||0)} placeholder="e.g. 60" />
                  </div>
                  <div className="field">
                    <label>Annual Rate %</label>
                    <input type="number" step="0.01" value={fd.annualRate||''} onChange={e => set('annualRate', parseFloat(e.target.value)||0)} placeholder="e.g. 6.5" />
                  </div>
                  <div className="field lr-form-full">
                    <label>Interest Method</label>
                    <select value={fd.interestMethod||'Reducing Balance'} onChange={e => set('interestMethod', e.target.value)}>
                      {INTEREST_METHODS.map(m => <option key={m}>{m}</option>)}
                    </select>
                  </div>
                </div>

                {/* Section: GL Accounts (used when booking the loan to the ledger) */}
                <div style={{ fontSize:10, fontWeight:800, color:'#94a3b8', letterSpacing:'.06em', textTransform:'uppercase', marginBottom:10, paddingBottom:6, borderBottom:'1px solid #f1f5f9' }}>
                  Accounting — GL Accounts
                </div>
                <div className="lr-form-grid">
                  <div className="field">
                    <label>Loan Liability Account</label>
                    <AccountCombobox
                      options={calAccounts.filter(a=>a.type==='liability').map(a=>({value:a.code||a.id,label:`${a.code} — ${a.name}`}))}
                      value={fd.liabilityAccountCode||''} onChange={v=>set('liabilityAccountCode',v)} placeholder="— Loans Payable —" />
                  </div>
                  <div className="field">
                    <label>Finance Cost Account</label>
                    <AccountCombobox
                      options={calAccounts.filter(a=>a.type==='expense').map(a=>({value:a.code||a.id,label:`${a.code} — ${a.name}`}))}
                      value={fd.financeCostAccountCode||''} onChange={v=>set('financeCostAccountCode',v)} placeholder="— Finance Cost —" />
                  </div>
                  <div className="field lr-form-full">
                    <label>Cash / Bank Account (proceeds & payments)</label>
                    <AccountCombobox
                      options={[
                        ...bankAccounts.map(a=>({value:a.code||a.id,label:`${a.code} — ${a.name}`})),
                        ...(bankAccounts.length===0 ? calAccounts.map(a=>({value:a.code||a.id,label:`${a.code} — ${a.name}`})) : []),
                      ]}
                      value={fd.cashAccountCode||''} onChange={v=>set('cashAccountCode',v)} placeholder="— Select bank account —" />
                  </div>
                </div>

                {/* Section: Schedule */}
                <div style={{ fontSize:10, fontWeight:800, color:'#94a3b8', letterSpacing:'.06em', textTransform:'uppercase', marginBottom:10, paddingBottom:6, borderBottom:'1px solid #f1f5f9' }}>
                  Payment Schedule
                </div>
                <div className="lr-form-grid">
                  <div className="field">
                    <label>First Payment Date</label>
                    <input type="date" value={fd.disbursementDate||''} onChange={e => set('disbursementDate', e.target.value)} />
                  </div>
                  <div className="field">
                    <label>Proceeds Date</label>
                    <input type="date" value={fd.proceedsDate||''} onChange={e => set('proceedsDate', e.target.value)} />
                  </div>
                  <div className="field">
                    <label>Payment Frequency</label>
                    <select value={fd.paymentFrequency||'Monthly'} onChange={e => set('paymentFrequency', e.target.value)}>
                      {PAYMENT_FREQS.map(f => <option key={f}>{f}</option>)}
                    </select>
                  </div>
                  <div className="field">
                    <label>Payment Method</label>
                    <div style={{ display:'flex', gap:8, marginTop:2 }}>
                      {['Check','Bank Transfer','Auto-Debit'].map(pm => (
                        <button
                          key={pm}
                          type="button"
                          onClick={() => set('paymentMethod', pm)}
                          style={{
                            flex:1, padding:'7px 10px', borderRadius:8, fontSize:12, fontWeight:700,
                            border: (fd.paymentMethod||'Check') === pm ? '2px solid #f97316' : '1.5px solid #e5e7eb',
                            background: (fd.paymentMethod||'Check') === pm ? '#fff7ed' : '#f8fafc',
                            color: (fd.paymentMethod||'Check') === pm ? '#ea580c' : '#64748b',
                            cursor:'pointer', transition:'all .15s'
                          }}
                        >{pm}</button>
                      ))}
                    </div>
                  </div>
                  {/* Pay Day Mode — shown for all frequencies */}
                  {(() => {
                      const ord = n => { const v = parseInt(n); if (!v) return ''; const s = v % 100; return v + (s >= 11 && s <= 13 ? 'th' : s % 10 === 1 ? 'st' : s % 10 === 2 ? 'nd' : s % 10 === 3 ? 'rd' : 'th'); };
                      const modes = isSemiMonthly
                        ? ['Fixed', 'Variable per Month', 'Every N Days']
                        : ['Every N Days'];
                      return (
                        <div className="field" style={{ gridColumn:'1/-1' }}>
                          <label>Pay Day Mode</label>
                          {/* Mode toggle */}
                          <div style={{ display:'flex', gap:8, marginBottom:10 }}>
                            {modes.map(mode => (
                              <button
                                key={mode}
                                type="button"
                                onClick={() => set('payDayMode', mode)}
                                style={{
                                  flex:1, padding:'7px 10px', borderRadius:8, fontSize:12, fontWeight:700,
                                  border: fd.payDayMode === mode ? '2px solid #f97316' : '1.5px solid #e2e8f0',
                                  background: fd.payDayMode === mode ? '#fff7ed' : '#fff',
                                  color: fd.payDayMode === mode ? '#c2410c' : '#64748b',
                                  cursor:'pointer', transition:'all .15s',
                                }}
                              >
                                {mode === 'Fixed' ? 'Fixed Pay Days' : mode === 'Variable per Month' ? 'Variable per Month' : 'Every N Days'}
                              </button>
                            ))}
                          </div>

                          {fd.payDayMode === 'Every N Days' ? (
                            <div>
                              <div style={{ fontSize:11, color:'#64748b', marginBottom:10 }}>
                                Payments fall every <strong>N days</strong> from the First Payment Date, regardless of calendar months.
                              </div>
                              <div style={{ display:'flex', alignItems:'center', gap:10 }}>
                                <div style={{ flex:'0 0 140px' }}>
                                  <div style={{ fontSize:10, fontWeight:700, color:'#94a3b8', marginBottom:4, textTransform:'uppercase', letterSpacing:'.05em' }}>Interval (days)</div>
                                  <input
                                    type="number" min="1" max="365"
                                    value={fd.intervalDays || 15}
                                    onChange={e => set('intervalDays', parseInt(e.target.value)||15)}
                                    style={{ width:'100%', textAlign:'center', fontWeight:800, fontSize:16 }}
                                  />
                                </div>
                                {fd.disbursementDate && fd.termMonths && fd.intervalDays && (() => {
                                  const pmts = buildIntervalPayments(fd);
                                  return pmts.length > 0 ? (
                                    <div style={{ flex:1, padding:'8px 12px', borderRadius:8, background:'#fff7ed', border:'1px solid #fed7aa', fontSize:11, color:'#c2410c', fontWeight:600 }}>
                                      <strong>{pmts.length}</strong> payments every {fd.intervalDays} days.
                                      First: <strong>{pmts[0].dueDate}</strong> &nbsp;·&nbsp; Last: <strong>{pmts[pmts.length-1].dueDate}</strong>
                                    </div>
                                  ) : null;
                                })()}
                              </div>
                            </div>
                          ) : fd.payDayMode === 'Fixed' ? (
                            <div>
                              <div style={{ fontSize:11, color:'#64748b', marginBottom:8 }}>
                                Same two calendar days every month (e.g. 15th &amp; 30th).
                              </div>
                              <div style={{ display:'flex', gap:8, alignItems:'flex-end' }}>
                                <div style={{ flex:1 }}>
                                  <div style={{ fontSize:10, fontWeight:700, color:'#94a3b8', marginBottom:4, textTransform:'uppercase', letterSpacing:'.05em' }}>Day 1</div>
                                  <select
                                    value={fd.payDay1||''}
                                    onChange={e => set('payDay1', e.target.value)}
                                    style={{ width:'100%' }}
                                  >
                                    <option value="">— choose —</option>
                                    {Array.from({length:31},(_,i)=>i+1).map(d => (
                                      <option key={d} value={d}>{ord(d)}</option>
                                    ))}
                                  </select>
                                </div>
                                <div style={{ fontSize:18, color:'#cbd5e1', paddingBottom:8 }}>&amp;</div>
                                <div style={{ flex:1 }}>
                                  <div style={{ fontSize:10, fontWeight:700, color:'#94a3b8', marginBottom:4, textTransform:'uppercase', letterSpacing:'.05em' }}>Day 2</div>
                                  <select
                                    value={fd.payDay2||''}
                                    onChange={e => set('payDay2', e.target.value)}
                                    style={{ width:'100%' }}
                                  >
                                    <option value="">— choose —</option>
                                    {Array.from({length:31},(_,i)=>i+1).map(d => (
                                      <option key={d} value={d}>{ord(d)}</option>
                                    ))}
                                  </select>
                                </div>
                              </div>
                              {fd.payDay1 && fd.payDay2 && (
                                <div style={{ marginTop:8, padding:'7px 10px', borderRadius:7, background:'#fff7ed', border:'1px solid #fed7aa', fontSize:11, color:'#c2410c', fontWeight:600 }}>
                                  Payments due on the <strong>{ord(fd.payDay1)}</strong> and <strong>{ord(fd.payDay2)}</strong> of each month.
                                </div>
                              )}
                            </div>
                          ) : (() => {
                              const pdMonths = buildPayDaysMonths({ disbursementDate: fd.disbursementDate, termMonths: fd.termMonths });
                              const pdm      = fd.payDaysPerMonth || {};
                              const getCell  = (key, col) => pdm[key]?.[col] || '';
                              const setCell  = (key, col, val) => set('payDaysPerMonth', { ...pdm, [key]: { ...(pdm[key]||{}), [col]: val } });
                              if (!fd.disbursementDate || !fd.termMonths) {
                                return (
                                  <div style={{ padding:'12px 14px', borderRadius:8, background:'#fefce8', border:'1px solid #fde68a', fontSize:12, color:'#92400e', display:'flex', gap:10, alignItems:'center' }}>
                                    <span style={{ fontSize:18 }}>⚠️</span>
                                    <span>Set a <strong>First Payment Date</strong> and <strong>Term (months)</strong> above to generate the monthly schedule.</span>
                                  </div>
                                );
                              }
                              return (
                                <div>
                                  <p style={{ margin:'0 0 10px', fontSize:11, color:'#64748b' }}>
                                    Enter the pay days for each month individually.
                                  </p>
                                  <div style={{ maxHeight:240, overflowY:'auto', border:'1px solid #e5e7eb', borderRadius:10 }}>
                                    <table style={{ width:'100%', borderCollapse:'collapse' }}>
                                      <thead style={{ position:'sticky', top:0, zIndex:1 }}>
                                        <tr>
                                          <th style={{ textAlign:'left', fontSize:10, fontWeight:800, color:'#64748b', letterSpacing:'.05em', textTransform:'uppercase', padding:'8px 10px', background:'#f8fafc', borderBottom:'2px solid #e5e7eb' }}>MONTH</th>
                                          <th style={{ textAlign:'center', fontSize:10, fontWeight:800, color:'#64748b', letterSpacing:'.05em', textTransform:'uppercase', padding:'8px 10px', background:'#f8fafc', borderBottom:'2px solid #e5e7eb' }}>Day 1</th>
                                          <th style={{ textAlign:'center', fontSize:10, fontWeight:800, color:'#64748b', letterSpacing:'.05em', textTransform:'uppercase', padding:'8px 10px', background:'#f8fafc', borderBottom:'2px solid #e5e7eb' }}>Day 2</th>
                                        </tr>
                                      </thead>
                                      <tbody>
                                        {pdMonths.map(({ key, label }) => (
                                          <tr key={key}>
                                            <td style={{ padding:'5px 10px', borderBottom:'1px solid #f1f5f9', fontSize:12, fontWeight:700 }}>{label}</td>
                                            <td style={{ padding:'5px 8px', borderBottom:'1px solid #f1f5f9', textAlign:'center' }}>
                                              <input type="number" min="1" max="31" placeholder="D1"
                                                style={{ border:'1px solid #e5e7eb', borderRadius:8, padding:'5px 0', fontSize:12, width:64, textAlign:'center', fontFamily:'inherit', boxSizing:'border-box' }}
                                                value={getCell(key, 'd1')}
                                                onChange={e => setCell(key, 'd1', e.target.value)} />
                                            </td>
                                            <td style={{ padding:'5px 8px', borderBottom:'1px solid #f1f5f9', textAlign:'center' }}>
                                              <input type="number" min="1" max="31" placeholder="D2"
                                                style={{ border:'1px solid #e5e7eb', borderRadius:8, padding:'5px 0', fontSize:12, width:64, textAlign:'center', fontFamily:'inherit', boxSizing:'border-box' }}
                                                value={getCell(key, 'd2')}
                                                onChange={e => setCell(key, 'd2', e.target.value)} />
                                            </td>
                                          </tr>
                                        ))}
                                      </tbody>
                                    </table>
                                  </div>
                                </div>
                              );
                          })()}
                        </div>
                      );
                  })()}
                </div>

              </div>{/* end modal-b */}

              {/* ── Footer ──────────────────────────────────────── */}
              <div className="modal-f">
                <button className="btn btn-ghost" onClick={() => setLoanFormModal(null)}>Cancel</button>
                <button
                  className="btn btn-primary"
                  onClick={() => saveLoanFromModal(fd)}
                  disabled={!canSave}
                  style={{ opacity: canSave ? 1 : 0.5 }}
                >
                  {isNew ? 'Add Loan' : 'Save Changes'}
                </button>
              </div>

            </div>
          </div>
        );
      })()}

      {/* Record Payment Modal (Phase 2) */}
      {payModal && (() => {
        const l  = loans.find(x => x.id === payModal);
        if (!l) return null;
        const st = loanStates[l.id] || {};
        const bankAccounts = calAccounts.filter(a =>
          ['Bank','Cash Equivalents','Cash','Cash and Cash Equivalents'].includes(a.subType) ||
          /cash in bank/i.test(a.name||'')
        );
        return (
          <RecordPaymentModal
            loan={l}
            loanState={st}
            bankAccounts={bankAccounts}
            onClose={() => setPayModal(null)}
            onSaved={(res) => {
              const v = res?.voucher;
              showToast(v ? `Payment recorded · ${v.type === 'check' ? 'Check Voucher' : 'Payment Voucher'} ${v.voucherNo} created.` : 'Payment recorded.');
              loadPayments(); loadVoucherDocs();
            }}
          />
        );
      })()}

      {/* Payment Method Modal */}
      {pmLoan && (() => {
        const bankAccounts = calAccounts.filter(a =>
          ['Bank','Cash Equivalents','Cash','Cash and Cash Equivalents'].includes(a.subType) ||
          /cash in bank/i.test(a.name||'')
        );
        const activeCbs = checkbooks.filter(c => c.isActive !== false);
        const selCb = activeCbs.find(c => c.id === pmForm.checkbookId);
        const pendingTotal = pmForm.checks.reduce((s,c) => s + (Number(c.amount)||0), 0);

        function addCheck() {
          let nextNo = '';
          if (selCb) {
            const padLen = String(selCb.endingNumber||'').length || 6;
            const end = parseInt(selCb.endingNumber) || Infinity;
            const taken = new Set([
              ...Array.from(issuedNums),
              ...pmForm.checks.map(c => c.checkNo).filter(Boolean),
            ]);
            let candidate = parseInt(selCb.nextCheckNumber||selCb.startingNumber||1);
            while (candidate <= end && taken.has(String(candidate).padStart(padLen,'0'))) candidate++;
            if (candidate <= end) nextNo = String(candidate).padStart(padLen,'0');
          }
          setPmForm(f => ({ ...f, checks: [...f.checks, { id: Date.now(), checkNo: nextNo, checkDate: new Date().toISOString().slice(0,10), amount: '' }] }));
        }
        function updCheck(id, key, val) {
          setPmForm(f => ({ ...f, checks: f.checks.map(c => c.id===id ? {...c,[key]:val} : c) }));
        }
        function delCheck(id) {
          setPmForm(f => ({ ...f, checks: f.checks.filter(c => c.id !== id) }));
        }
        function checkError(checkNo, idx) {
          if (!checkNo) return null;
          if (issuedNums.has(String(checkNo))) return 'Already issued';
          if (pmForm.checks.some((c,i) => i!==idx && c.checkNo && c.checkNo===checkNo)) return 'Duplicate';
          return null;
        }
        const hasCheckErrors = pmForm.paymentMethod==='Check' &&
          pmForm.checks.some((c,i) => !!checkError(c.checkNo,i));
        const closeModal = () => {
          setPmModal(null);
          setPmForm({ paymentMethod:'Check', checkbookId:'', checks:[], pmBtBankName:'', pmBtAccountName:'', pmBtAccountNumber:'', pmAdaAccountCode:'', pmAdaDay:'' });
        };
        return (
          <div className="backdrop" onClick={e=>{ if(e.target===e.currentTarget) closeModal(); }}>
            <div className="modal" style={{maxWidth:560}}>
              <div className="modal-h">
                <strong>Payment Method — {pmLoan.name||`Loan ${pmLoan.id}`}</strong>
                <button className="btn btn-ghost btn-sm" onClick={closeModal}>✕</button>
              </div>
              <div className="modal-b" style={{display:'flex',flexDirection:'column',gap:14}}>
                {/* Method selector */}
                <div style={{ display:'flex', gap:8 }}>
                  {['Check','Auto-Debit','Bank Transfer'].map(pm => (
                    <button key={pm} className={`btn btn-sm ${pmForm.paymentMethod===pm?'btn-primary':'btn-ghost'}`}
                      onClick={()=>setPmForm(f=>({...f,paymentMethod:pm}))}>{pm}</button>
                  ))}
                </div>

                {/* Check */}
                {pmForm.paymentMethod === 'Check' && (
                  <>
                    <div className="field">
                      <label style={{fontSize:10,fontWeight:800,color:'#64748b',textTransform:'uppercase',letterSpacing:'.06em'}}>Issuing Checkbook</label>
                      <select value={pmForm.checkbookId} onChange={e=>setPmForm(f=>({...f,checkbookId:e.target.value}))} style={{width:'100%',border:'1px solid #e5e7eb',borderRadius:8,padding:'8px 10px',fontSize:13}}>
                        <option value="">— Select checkbook —</option>
                        {activeCbs.map(cb => {
                          const acct = calAccounts.find(a => a.code === cb.bankCode);
                          const label = acct ? acct.name : cb.bankCode;
                          return <option key={cb.id} value={cb.id}>{cb.bankCode} · {label} · Next: #{String(cb.nextCheckNumber||cb.startingNumber||'').padStart(6,'0')}</option>;
                        })}
                      </select>
                    </div>
                    {selCb && (() => {
                      const acct = calAccounts.find(a => a.code === selCb.bankCode);
                      return (
                        <div style={{background:'#f8fafc',border:'1px solid #e5e7eb',borderRadius:8,padding:'6px 12px',fontSize:12,color:'#64748b'}}>
                          {acct&&<span style={{fontWeight:700,color:'#0b1220'}}>{acct.name}</span>}{acct&&' · '}
                          Series #{selCb.startingNumber}–#{selCb.endingNumber} · Next: #{selCb.nextCheckNumber}
                        </div>
                      );
                    })()}
                    <table style={{width:'100%',borderCollapse:'collapse',fontSize:12}}>
                      <thead>
                        <tr style={{background:'#f8fafc'}}>
                          <th style={{padding:'7px 10px',textAlign:'left',fontWeight:800,fontSize:10,textTransform:'uppercase',letterSpacing:'.06em',color:'#64748b',borderBottom:'2px solid #e5e7eb'}}>Check No.</th>
                          <th style={{padding:'7px 10px',textAlign:'left',fontWeight:800,fontSize:10,textTransform:'uppercase',letterSpacing:'.06em',color:'#64748b',borderBottom:'2px solid #e5e7eb'}}>Check Date</th>
                          <th style={{padding:'7px 10px',textAlign:'right',fontWeight:800,fontSize:10,textTransform:'uppercase',letterSpacing:'.06em',color:'#64748b',borderBottom:'2px solid #e5e7eb'}}>Amount (₱)</th>
                          <th style={{width:28,borderBottom:'2px solid #e5e7eb'}}></th>
                        </tr>
                      </thead>
                      <tbody>
                        {pmForm.checks.length === 0 && (
                          <tr><td colSpan={4} style={{padding:'18px',textAlign:'center',color:'#94a3b8',fontSize:12}}>No pending checks. Click "+ Add Check" to queue one.</td></tr>
                        )}
                        {pmForm.checks.map((c,i) => {
                          const err = checkError(c.checkNo, i);
                          return (
                            <tr key={c.id} style={{borderBottom:'1px solid #f1f5f9',background:err?'#fef2f2':undefined}}>
                              <td style={{padding:'5px 6px'}}>
                                <input value={c.checkNo||''} onChange={e=>updCheck(c.id,'checkNo',e.target.value)}
                                  style={{border:`1px solid ${err?'#fca5a5':'#e5e7eb'}`,borderRadius:6,padding:'5px 7px',fontSize:12,width:'100%'}} placeholder="Check #" />
                                {err&&<div style={{color:'#dc2626',fontSize:10,marginTop:1}}>{err}</div>}
                              </td>
                              <td style={{padding:'5px 6px'}}><input type="date" value={c.checkDate||''} onChange={e=>updCheck(c.id,'checkDate',e.target.value)} style={{border:'1px solid #e5e7eb',borderRadius:6,padding:'5px 7px',fontSize:12,width:'100%'}} /></td>
                              <td style={{padding:'5px 6px'}}><input type="number" step="0.01" value={c.amount||''} onChange={e=>updCheck(c.id,'amount',e.target.value)} style={{border:'1px solid #e5e7eb',borderRadius:6,padding:'5px 7px',fontSize:12,width:'100%',textAlign:'right'}} placeholder="0.00" /></td>
                              <td style={{padding:'5px 4px',textAlign:'center'}}><button onClick={()=>delCheck(c.id)} style={{background:'none',border:'none',color:'#dc2626',cursor:'pointer',fontWeight:900,fontSize:13,padding:'2px 4px'}}>✕</button></td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                    <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',padding:'8px 0',borderTop:'2px solid #e5e7eb'}}>
                      <button className="btn btn-ghost btn-sm" onClick={addCheck} disabled={!pmForm.checkbookId}>+ Add Check</button>
                      <span style={{fontSize:12,fontWeight:800,color:'#0f172a'}}>
                        PENDING · {pmForm.checks.length} CHECK{pmForm.checks.length!==1?'S':''}&nbsp;
                        <span style={{color:'#dc2626'}}>₱{pendingTotal.toLocaleString('en-PH',{minimumFractionDigits:2})}</span>
                      </span>
                    </div>
                  </>
                )}

                {/* Auto-Debit */}
                {pmForm.paymentMethod === 'Auto-Debit' && (
                  <div className="grid4">
                    <div className="field col2">
                      <label>Bank Account (COA)</label>
                      <select value={pmForm.pmAdaAccountCode||''} onChange={e=>setPmForm(f=>({...f,pmAdaAccountCode:e.target.value}))} style={{width:'100%'}}>
                        <option value="">— select account —</option>
                        {bankAccounts.map(a=><option key={a.id} value={a.code}>{a.code} · {a.name}</option>)}
                      </select>
                    </div>
                    <div className="field col2">
                      <label>Debit Day of Month</label>
                      <input type="number" min="1" max="31" value={pmForm.pmAdaDay||''} onChange={e=>setPmForm(f=>({...f,pmAdaDay:e.target.value}))} placeholder="1–31" />
                    </div>
                  </div>
                )}

                {/* Bank Transfer */}
                {pmForm.paymentMethod === 'Bank Transfer' && (
                  <div className="grid4">
                    <div className="field col4">
                      <label>Bank Name</label>
                      <input value={pmForm.pmBtBankName||''} onChange={e=>setPmForm(f=>({...f,pmBtBankName:e.target.value}))} placeholder="e.g. BDO, BPI, Metrobank" />
                    </div>
                    <div className="field col2">
                      <label>Account Name</label>
                      <input value={pmForm.pmBtAccountName||''} onChange={e=>setPmForm(f=>({...f,pmBtAccountName:e.target.value}))} placeholder="Name on the bank account" />
                    </div>
                    <div className="field col2">
                      <label>Account Number</label>
                      <input value={pmForm.pmBtAccountNumber||''} onChange={e=>setPmForm(f=>({...f,pmBtAccountNumber:e.target.value}))} placeholder="Vendor's account number" />
                    </div>
                  </div>
                )}


              </div>
              <div className="modal-f">
                <button className="btn btn-ghost" onClick={closeModal}>Close</button>
                <button className="btn btn-primary" disabled={hasCheckErrors} onClick={()=>{
                  const pm = {
                    pmCheckbookId:     pmForm.checkbookId,
                    pmCheckbookCode:   checkbooks.find(c=>c.id===pmForm.checkbookId)?.bankCode || '',
                    pmChecks:          pmForm.checks,
                    pmBtBankName:      pmForm.pmBtBankName,
                    pmBtAccountName:   pmForm.pmBtAccountName,
                    pmBtAccountNumber: pmForm.pmBtAccountNumber,
                    pmAdaAccountCode:  pmForm.pmAdaAccountCode,
                    pmAdaDay:          pmForm.pmAdaDay,
                  };
                  setLoans(prev => prev.map(l => l.id !== pmLoan.id ? l : { ...l, paymentMethod: pmForm.paymentMethod, ...pm }));
                  saveLoanFields(pmLoan.id, { paymentMethod: pmForm.paymentMethod || null, pmConfig: pm });
                  closeModal();
                  showToast('Payment method saved.');
                }}>{hasCheckErrors ? '⚠ Fix check errors' : 'Save'}</button>
              </div>
            </div>
          </div>
        );
      })()}

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
                {['Fixed','Variable per Month','Every N Days'].map(m => (
                  <button key={m}
                    onClick={()=>updateLoan(payDaysLoan.id,'payDayMode',m)}
                    style={{border:`2px solid ${pdMode===m?'#f97316':'#e5e7eb'}`,borderRadius:10,padding:'6px 14px',fontWeight:700,fontSize:12,cursor:'pointer',fontFamily:'inherit',background:pdMode===m?'#f97316':'#fff',color:pdMode===m?'#fff':'#64748b',transition:'all .15s'}}>
                    {m}
                  </button>
                ))}
              </div>

              {/* Body */}
              <div className="modal-b" style={{padding:'18px 20px'}}>
                {pdMode === 'Every N Days' ? (
                  <div>
                    <p style={{margin:'0 0 16px',fontSize:13,color:'#64748b'}}>
                      Payments fall every <strong>N days</strong> from the First Payment Date, automatically computed.
                    </p>
                    <div style={{display:'flex',alignItems:'center',gap:14}}>
                      <div className="field" style={{flex:'0 0 160px'}}>
                        <label>INTERVAL (DAYS)</label>
                        <input className="tbl-inp" type="number" min="1" max="365"
                          style={{textAlign:'center',fontSize:22,fontWeight:900,padding:'10px 8px'}}
                          value={payDaysLoan.intervalDays || 15}
                          onChange={e=>updateLoan(payDaysLoan.id,'intervalDays',parseInt(e.target.value)||15)} />
                      </div>
                      {(() => {
                        const pmts = buildIntervalPayments(payDaysLoan);
                        return pmts.length > 0 ? (
                          <div style={{flex:1,padding:'10px 14px',borderRadius:10,background:'#fff7ed',border:'1px solid #fed7aa',fontSize:12,color:'#c2410c',fontWeight:600,lineHeight:1.6}}>
                            <strong>{pmts.length}</strong> payments every {payDaysLoan.intervalDays || 15} days<br/>
                            First: <strong>{pmts[0].dueDate}</strong><br/>
                            Last: <strong>{pmts[pmts.length-1].dueDate}</strong>
                          </div>
                        ) : <div style={{color:'#94a3b8',fontSize:12}}>Set First Payment Date and Term first.</div>;
                      })()}
                    </div>
                  </div>
                ) : pdMode === 'Fixed' ? (
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
                <button className="btn btn-primary" onClick={()=>{
                  const cur = loans.find(l => l.id === payDaysLoan.id);
                  if (cur) saveLoanFields(cur.id, {
                    payDayMode: cur.payDayMode || 'Fixed',
                    payDay1: parseInt(cur.payDay1) || null,
                    payDay2: parseInt(cur.payDay2) || null,
                    payDaysPerMonth: cur.payDaysPerMonth || {},
                    intervalDays: parseInt(cur.intervalDays) || 15,
                  });
                  closePd(); showToast('Pay days saved.');
                }}>Done</button>
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

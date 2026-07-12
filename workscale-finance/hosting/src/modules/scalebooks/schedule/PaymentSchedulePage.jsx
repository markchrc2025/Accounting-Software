import React, { useState, useEffect, useRef, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate, useLocation } from 'react-router-dom';
import { usePermissions } from '../../../contexts/PermissionsContext.jsx';
import { issueCheck, getActiveCheckbook } from '../../../utils/issueCheck.js';
import { setSchedulePrefill } from '../../../utils/schedulePrefill.js';
import AccountCombobox from '../../../components/AccountCombobox.jsx';
import ContactPicker from '../../../components/ContactPicker.jsx';
import {
  paymentSchedulesApi, schedulePaymentsApi, listAccounts, listContacts,
  taxRatesApi, taxGroupsApi, purposeCategoriesApi, listVouchers, listCheckbooks,
  listChecks, createVoucherDraft, transitionVoucher, ApiError,
} from '../../../lib/api.js';

const CATEGORIES = ['Rent','Utilities','Insurance','Salaries','Loan Payment','Subscription','Tax','Other'];
const FREQS = ['Monthly','Quarterly','Semi-Annual','Annual','One-Time'];
const STATUSES = ['Active','Cancelled'];
const PM_METHODS = ['','Check','Bank Transfer','Auto-Debit'];
const MONTH_NAMES = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const CAT_COLORS = {
  Rent:'#eff6ff:#bfdbfe:#1d4ed8',Utilities:'#fef9c3:#fde68a:#a16207',
  Insurance:'#f0fdf4:#bbf7d0:#15803d','Loan Payment':'#fdf4ff:#e9d5ff:#7e22ce',
  Salaries:'#fff7ed:#fed7aa:#c2410c',Subscription:'#f8fafc:#e2e8f0:#475569',
  Tax:'#fef2f2:#fecaca:#b91c1c',Other:'#f1f5f9:#e2e8f0:#64748b',
};
function catStyle(cat) {
  const s = CAT_COLORS[cat]||CAT_COLORS.Other;
  const [bg,border,color] = s.split(':');
  return {background:bg,borderColor:border,color};
}

const fmtPHP = n => new Intl.NumberFormat('en-PH',{minimumFractionDigits:2,maximumFractionDigits:2}).format(n||0);
const fmtCur = n => '₱' + fmtPHP(n);

// ── API <-> UI mapping ──────────────────────────────────────────────────────
// API rows carry integer centavos plus a pm_config blob; the UI thinks in
// pesos with flattened pm* fields (pmBtBankName, pmChecks, …), so the mapping
// restores the original shape the render code expects.
const toPesos = (c) => Number(c || 0) / 100;
const toCents = (p) => Math.round(Number(p || 0) * 100);
const schedFromApi = (r) => ({
  id: r.id,
  scheduleId: r.scheduleNo || '',
  title: r.title || '',
  contactId: r.contactId || '',
  contactName: r.contactName || '',
  category: r.category || '',
  frequency: r.frequency || 'Monthly',
  amount: toPesos(r.amountCents),
  dueDate: r.dueDate || '',
  startDate: r.startDate || '',
  endDate: r.endDate || '',
  dueDay: r.dueDay || 0,
  status: r.status || 'Active',
  notes: r.notes || '',
  defaultExpenseAccountCode: r.defaultExpenseAccountCode || '',
  defaultTaxRateId: r.defaultTaxRateId || '',
  paymentMethod: r.paymentMethod || '',
  ...(r.pmConfig && typeof r.pmConfig === 'object' ? r.pmConfig : {}),
});
// Vouchers linked to schedules: linkage rides in the voucher's meta jsonb.
const VTYPE_LABEL = { payment:'PV', receipt:'RV', payroll:'PR', final_pay:'FP', loan:'LV', check:'CV' };
const VSTATUS_LABEL = {
  draft:'Draft', pending:'Pending', for_verification:'For Verification', verified:'Verified',
  for_approval:'For Approval', approved:'Approved', paid:'Paid', rejected:'Rejected',
  posted:'Approved', void:'Voided',
};
const schedVoucherFromApi = (v) => {
  const m = v.meta || {};
  return {
    id: v.id,
    voucherId: v.voucherNo,
    voucherType: VTYPE_LABEL[v.voucherType] || 'CV',
    preparationDate: v.voucherDate,
    totalAmount: toPesos(v.totalCents),
    status: VSTATUS_LABEL[v.status] || v.status,
    linkedScheduleId: m.linkedScheduleId || '',
    linkedScheduleDate: m.linkedScheduleDate || '',
  };
};

// Compute representative monthly installment for a loan (PMT or method-specific)
function loanMonthlyPmt(loan) {
  const P = loan.principal || 0;
  const r = (loan.annualRate || 0) / 100 / 12;
  const n = Math.max(loan.termMonths || 1, 1);
  if (P <= 0) return 0;
  if (loan.loanType === 'Revolving Credit') return Math.round(P * r * 100) / 100;
  if (loan.interestMethod === 'Balloon') return Math.round(P * r * 100) / 100;
  if (loan.interestMethod === 'Fixed') return Math.round((P / n + P * (loan.annualRate||0) / 100 / 12) * 100) / 100;
  if (r === 0) return Math.round(P / n * 100) / 100;
  const pmt = P * r * Math.pow(1+r,n) / (Math.pow(1+r,n)-1);
  return Math.round(pmt * 100) / 100;
}

function nextOccurrence(s) {
  if (s.frequency === 'One-Time') return s.dueDate || null;
  const today = new Date(); today.setHours(0,0,0,0);
  const start = s.startDate ? new Date(s.startDate) : (s.dueDate ? new Date(s.dueDate) : null);
  if (!start || isNaN(start)) return null;
  const dueDay = parseInt(s.dueDay) || start.getDate();
  const freqMos = {Monthly:1, Quarterly:3, 'Semi-Annual':6, Annual:12}[s.frequency] || 1;
  let d = new Date(start.getFullYear(), start.getMonth(), dueDay);
  while (d < today) d = new Date(d.getFullYear(), d.getMonth() + freqMos, dueDay);
  if (s.endDate) {
    const end = new Date(s.endDate);
    if (d > end) return null;
  }
  return d.toISOString().substring(0,10);
}

function occurrencesInMonth(s, year, month) {
  if (s.status === 'Cancelled') return [];
  if (s.frequency === 'One-Time') {
    const d = s.dueDate;
    if (d && d.startsWith(year+'-'+String(month+1).padStart(2,'0'))) return [d];
    return [];
  }
  const start = s.startDate ? new Date(s.startDate) : (s.dueDate ? new Date(s.dueDate) : null);
  if (!start || isNaN(start)) return [];
  const dueDay = parseInt(s.dueDay) || start.getDate();
  const freqMos = {Monthly:1, Quarterly:3, 'Semi-Annual':6, Annual:12}[s.frequency] || 1;
  const results = [];
  let d = new Date(start.getFullYear(), start.getMonth(), dueDay);
  const endDate = s.endDate ? new Date(s.endDate) : new Date(year+12, 11, 31);
  const periodStart = new Date(year, month, 1), periodEnd = new Date(year, month+1, 0);
  while (d <= endDate) {
    if (d >= periodStart && d <= periodEnd) results.push(d.toISOString().substring(0,10));
    d = new Date(d.getFullYear(), d.getMonth() + freqMos, dueDay);
    if (d.getFullYear() > year + 1) break;
  }
  return results;
}

const CSS = `
  .ps-wrap{display:flex;flex-direction:column;height:100%;overflow:hidden;font-family:Inter,system-ui,sans-serif;}
  .ps-topbar{display:flex;align-items:center;justify-content:space-between;padding:14px 22px 10px;flex-shrink:0;border-bottom:1px solid #e5e7eb;background:#fff;gap:12px;flex-wrap:wrap;}
  .ps-tabs{display:flex;background:#fff;border-bottom:2px solid #e5e7eb;flex-shrink:0;overflow-x:auto;}
  .ps-tab{padding:10px 15px;font-size:12px;font-weight:600;border:none;background:transparent;color:#64748b;cursor:pointer;white-space:nowrap;border-bottom:2px solid transparent;margin-bottom:-2px;font-family:inherit;}
  .ps-tab:hover{color:#0b1220;}
  .ps-tab-active{color:#f97316;border-bottom-color:#f97316;font-weight:800;}
  .ps-body{flex:1;overflow-y:auto;padding:16px 22px;}
  .kpi-row{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:16px;}
  .kpi{background:#fff;border:1px solid #e5e7eb;border-radius:12px;padding:14px 16px;}
  .kpi-lbl{font-size:9px;font-weight:800;color:#94a3b8;letter-spacing:.07em;text-transform:uppercase;margin-bottom:4px;}
  .kpi-val{font-size:20px;font-weight:900;}
  .filters{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px;align-items:center;}
  .filters input,.filters select{border:1px solid #e5e7eb;border-radius:10px;padding:7px 10px;font-size:12px;background:#fff;font-family:inherit;}
  .btn{border:0;border-radius:10px;padding:9px 16px;font-weight:700;cursor:pointer;font-size:13px;font-family:inherit;}
  .btn-primary{background:#f97316;color:#fff;}
  .btn-ghost{background:#f1f5f9;color:#0b1220;}
  .btn-ghost:hover{background:#e2e8f0;}
  .btn-sm{padding:6px 12px;font-size:12px;}
  table{width:100%;border-collapse:collapse;}
  th,td{padding:8px 10px;border-bottom:1px solid #f1f5f9;font-size:12px;text-align:left;}
  th{color:#64748b;font-weight:800;font-size:10px;letter-spacing:.05em;text-transform:uppercase;background:#f8fafc;position:sticky;top:0;z-index:1;}
  tr:hover td{background:#fafafa;}
  tr:last-child td{border-bottom:none;}
  tfoot td{background:#f8fafc;font-weight:900;border-top:2px solid #e5e7eb;}
  .pill{display:inline-block;padding:2px 9px;border-radius:999px;font-size:11px;font-weight:700;border:1px solid;}
  .loan-row td{background:#f5f3ff;}
  .loan-row:hover td{background:#ede9fe;}
  .empty{padding:48px;text-align:center;color:#94a3b8;}
  .backdrop{position:fixed;inset:0;background:rgba(15,23,42,.45);display:flex;align-items:center;justify-content:center;padding:16px;z-index:100;}
  .modal{width:min(640px,98vw);max-height:92vh;background:#fff;border-radius:16px;display:flex;flex-direction:column;overflow:hidden;box-shadow:0 24px 64px rgba(0,0,0,.25);}
  .modal-sm{width:min(480px,98vw);}
  .modal-h{display:flex;align-items:center;justify-content:space-between;padding:16px 20px;border-bottom:1px solid #e5e7eb;background:#f8fafc;flex-shrink:0;}
  .modal-b{padding:20px;overflow-y:auto;flex:1;}
  .modal-f{display:flex;justify-content:flex-end;gap:10px;padding:14px 20px;border-top:1px solid #e5e7eb;flex-shrink:0;}
  .grid3{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-bottom:12px;}
  .col2{grid-column:span 2;}.col3{grid-column:span 3;}
  .field{display:flex;flex-direction:column;gap:5px;}
  .field label{font-size:10px;font-weight:800;color:#64748b;letter-spacing:.06em;text-transform:uppercase;}
  .field input,.field select,.field textarea{width:100%;border:1px solid #e5e7eb;border-radius:10px;padding:9px 10px;font-size:13px;background:#fff;font-family:inherit;box-sizing:border-box;}
  .sec-hdr{font-size:11px;font-weight:900;color:#94a3b8;letter-spacing:.07em;text-transform:uppercase;margin:14px 0 8px;padding-bottom:4px;border-bottom:1px solid #e5e7eb;}
  .cal-grid{display:grid;grid-template-columns:repeat(7,1fr);gap:2px;}
  .cal-cell{min-height:64px;background:#fff;border:1px solid #e5e7eb;border-radius:5px;padding:3px;}
  .cal-empty{background:transparent;border:none;min-height:64px;}
  .cal-day-hdr{text-align:center;font-weight:800;font-size:9px;color:#94a3b8;padding:4px 0;text-transform:uppercase;letter-spacing:.06em;}
  .cal-day{font-size:9px;font-weight:700;margin-bottom:2px;}
  .cal-ev{font-size:8px;border-radius:3px;padding:2px 3px;margin-bottom:1px;line-height:1.3;border:1px solid;}
  .pm-group{background:#fff;border:1px solid #e5e7eb;border-radius:12px;margin-bottom:12px;}
  .pm-group-hdr{display:flex;align-items:center;justify-content:space-between;padding:12px 16px;border-bottom:1px solid #e5e7eb;cursor:pointer;}
  .toast{position:fixed;right:16px;bottom:16px;background:#0b1220;color:#fff;padding:12px 18px;border-radius:12px;font-size:13px;font-weight:600;z-index:999;}
  @media(max-width:640px){.kpi-row{grid-template-columns:repeat(2,1fr);}}
`;

export default function PaymentSchedulePage() {
  const navigate = useNavigate();
  const { hasAccess } = usePermissions();
  const [schedules, setSchedules] = useState([]);
  const [activeTab, setActiveTab] = useState('list');
  const [search, setSearch] = useState('');
  const [filterCat, setFilterCat] = useState('');
  const [filterFreq, setFilterFreq] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [modal, setModal] = useState(null);
  const [detailId, setDetailId] = useState(null);
  const [pmModal, setPmModal] = useState(null);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState('');
  const [confirmModal, setConfirmModal] = useState(null);
  const [calOffset, setCalOffset] = useState(0);
  const [bankAccounts, setBankAccounts] = useState([]);
  const [accounts, setAccounts] = useState([]);
  const [taxRates, setTaxRates] = useState([]);
  const [taxGroups, setTaxGroups] = useState([]);
  const [vouchers, setVouchers] = useState([]);
  const [openMenuId, setOpenMenuId] = useState(null);
  const [openActionsId, setOpenActionsId] = useState(null);
  const [menuRect, setMenuRect] = useState(null);
  const [actionsRect, setActionsRect] = useState(null);

  function toggleVoucherMenu(id, e) {
    if (openMenuId === id) { setOpenMenuId(null); setMenuRect(null); return; }
    const r = e.currentTarget.getBoundingClientRect();
    setOpenActionsId(null); setActionsRect(null);
    setOpenMenuId(id); setMenuRect(r);
  }
  function toggleActionsMenu(id, e) {
    if (openActionsId === id) { setOpenActionsId(null); setActionsRect(null); return; }
    const r = e.currentTarget.getBoundingClientRect();
    setOpenMenuId(null); setMenuRect(null);
    setOpenActionsId(id); setActionsRect(r);
  }
  const [contacts, setContacts] = useState([]);
  const [purposeCategories, setPurposeCategories] = useState([]);
  const [payModal, setPayModal] = useState(null); // { schedule, dueDate }
  const [loans, setLoans] = useState([]);
  const [filterSource, setFilterSource] = useState('all'); // 'all' | 'expenses' | 'loans'
  const [expandedLoanIds, setExpandedLoanIds] = useState(new Set());
  const [checkbooks, setCheckbooks] = useState([]);

  function toggleLoanExpand(loanId) {
    setExpandedLoanIds(prev => {
      const next = new Set(prev);
      next.has(loanId) ? next.delete(loanId) : next.add(loanId);
      return next;
    });
  }

  const showToast = msg => { setToast(msg); setTimeout(()=>setToast(''),3000); }
  const askConfirm = (message, onConfirm) => setConfirmModal({ message, onConfirm });;

  // Open create form when navigating from CreateFlyout
  const location = useLocation();
  useEffect(() => {
    if (location.state?.openCreate) { window.history.replaceState({}, ''); setModal({}); }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const loadSchedules = async () => {
    try {
      setSchedules((await paymentSchedulesApi.list()).map(schedFromApi));
    } catch (e) {
      showToast(e instanceof ApiError ? e.detail : e.message);
    }
  };
  useEffect(() => { loadSchedules(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Load COA accounts (bank list + expense-account picker), tax rates/groups,
  // contacts, purpose categories, and checkbooks — all reference data.
  useEffect(() => {
    (async () => {
      try {
        const [accs, rates, groups, cts, cats, cbs] = await Promise.all([
          listAccounts(), taxRatesApi.list(), taxGroupsApi.list(), listContacts(),
          purposeCategoriesApi.list(), listCheckbooks(),
        ]);
        setAccounts(accs);
        setBankAccounts(accs.filter(a => ['Bank','Cash Equivalents','Cash','Cash and Cash Equivalents'].includes(a.subType || a.subtype) || /cash in bank/i.test(a.name||'')));
        setTaxRates(rates.filter(r => r.isActive !== false).map(r => ({ ...r, rate: Number(r.rate) || 0 })));
        setTaxGroups(groups.filter(g => g.isActive !== false));
        setContacts(cts);
        setPurposeCategories(cats.map(c => c.name).filter(Boolean));
        setCheckbooks(cbs.filter(cb => cb.isActive !== false));
      } catch (e) {
        console.error('reference data load failed', e);
      }
    })();
  }, []);

  // Vouchers linked to schedules, so each row can show its derived status.
  const loadLinkedVouchers = async () => {
    try {
      const rows = await listVouchers();
      setVouchers(rows.map(schedVoucherFromApi).filter(v => v.linkedScheduleId));
    } catch (e) {
      console.error('linked voucher load failed', e);
    }
  };
  useEffect(() => { loadLinkedVouchers(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Loan obligations come from the loans domain (Financial Management), which
  // moves to the API in Phase 6 — until then the loan sections stay empty.
  useEffect(() => { setLoans([]); }, []);

  // Close the row action menu on outside click / Escape.
  useEffect(() => {
    if (!openMenuId && !openActionsId) return;
    const close = () => { setOpenMenuId(null); setOpenActionsId(null); setMenuRect(null); setActionsRect(null); };
    document.addEventListener('click', close);
    document.addEventListener('keydown', e => e.key === 'Escape' && close());
    return () => document.removeEventListener('click', close);
  }, [openMenuId, openActionsId]);

  /* ── Loan obligations derived from Financial Management ──────────────── */
  // One row per exact payment date so every overdue installment is individually visible.
  const loanSchedules = useMemo(() => {
    const result = [];
    loans.filter(l => l.disbursementDate && (l.termMonths||0) > 0).forEach(l => {
      const start = new Date(l.disbursementDate);
      if (isNaN(start.getTime())) return;
      const baseAmt = loanMonthlyPmt(l);
      const loanStatus = l.status === 'Disposed' ? 'Cancelled' : 'Active';
      for (let i = 0; i < (l.termMonths || 0); i++) {
        const m = new Date(start.getFullYear(), start.getMonth() + i, 1);
        const key = m.getFullYear() + '-' + String(m.getMonth() + 1).padStart(2, '0');
        const daysInM = new Date(m.getFullYear(), m.getMonth() + 1, 0).getDate();
        const addRow = (dayNum, suffix, amt) => {
          const clamped = Math.min(Math.max(dayNum || 1, 1), daysInM);
          const dueDate = key + '-' + String(clamped).padStart(2, '0');
          result.push({
            _isLoan: true, _loanId: l.id,
            id: `loan-${l.id}-${key}${suffix}`,
            title: l.name || `Loan ${l.id}`,
            loanType: l.loanType || 'Term Loan',
            contactName: l.name || '',
            category: 'Loan Obligation',
            frequency: 'One-Time',
            paymentFrequency: l.paymentFrequency || 'Monthly',
            dueDate,
            amount: amt,
            startDate: l.disbursementDate,
            endDate: dueDate,
            dueDay: clamped,
            status: loanStatus,
          });
        };
        if (l.paymentFrequency === 'Semi-Monthly') {
          let d1 = 0, d2 = 0;
          if (l.payDayMode === 'Variable per Month') {
            const perMonth = (l.payDaysPerMonth || {})[key] || {};
            d1 = parseInt(perMonth.d1) || parseInt(l.payDay1) || 15;
            d2 = parseInt(perMonth.d2) || parseInt(l.payDay2) || 30;
          } else {
            d1 = parseInt(l.payDay1) || 15;
            d2 = parseInt(l.payDay2) || 30;
          }
          const half = Math.round(baseAmt / 2 * 100) / 100;
          addRow(d1, '-a', half);
          addRow(d2, '-b', half);
        } else {
          addRow(parseInt(l.payDay1) || start.getDate(), '', baseAmt);
        }
      }
    });
    // Oldest (most overdue) first so past-due obligations appear at the top of the list
    return result.sort((a, b) => a.dueDate.localeCompare(b.dueDate));
  }, [loans]);

  /* ── KPIs ────────────────────────────────────────────────────── */
  const today = new Date(); today.setHours(0,0,0,0);
  const cm = today.getMonth(), cy = today.getFullYear();
  const activeScheds = schedules.filter(s=>s.status!=='Cancelled');
  const activeLoanScheds = loanSchedules.filter(ls=>ls.status!=='Cancelled');
  const allActive = [...activeScheds, ...activeLoanScheds];
  const thisMonthTotal = allActive.reduce((sum,s)=>sum+occurrencesInMonth(s,cy,cm).length*(parseFloat(s.amount)||0),0);
  const loanMonthTotal = activeLoanScheds.reduce((sum,s)=>sum+occurrencesInMonth(s,cy,cm).length*(parseFloat(s.amount)||0),0);
  const pendingThisMonth = allActive.filter(s=>occurrencesInMonth(s,cy,cm).length>0).length;
  const overdueCount = [
    ...activeScheds,
    ...activeLoanScheds,
  ].filter(s=>{
    const nxt = nextOccurrence(s);
    return nxt && new Date(nxt) < today;
  }).length;
  const annual12mo = allActive.reduce((sum,s)=>{
    let total=0;
    for(let i=0;i<12;i++){
      const m=(cm+i)%12, y=cy+Math.floor((cm+i)/12);
      total+=occurrencesInMonth(s,y,m).length*(parseFloat(s.amount)||0);
    }
    return sum+total;
  }, 0);

  /* ── Filter ──────────────────────────────────────────────────── */
  const filtered = filterSource === 'loans' ? [] : schedules.filter(s=>{
    if (filterCat && s.category!==filterCat) return false;
    if (filterFreq && s.frequency!==filterFreq) return false;
    if (filterStatus && s.status!==filterStatus) return false;
    if (search && !((s.title||'').toLowerCase().includes(search.toLowerCase())||(s.contactName||s.contactId||'').toLowerCase().includes(search.toLowerCase()))) return false;
    return true;
  });
  // Grouped loan rows — one entry per loan for the list view
  const groupedLoanRows = (() => {
    const groups = {};
    const todayMs = today.getTime();
    (filterSource === 'expenses' ? [] : loanSchedules.filter(ls => {
      if (filterStatus === 'Active' && ls.status !== 'Active') return false;
      if (filterStatus === 'Cancelled' && ls.status !== 'Cancelled') return false;
      if (search && !(ls.title.toLowerCase().includes(search.toLowerCase()) || ls.contactName.toLowerCase().includes(search.toLowerCase()))) return false;
      return true;
    })).forEach(ls => {
      if (!groups[ls._loanId]) {
        groups[ls._loanId] = { ...ls, id: `loan-group-${ls._loanId}`, _rows: [], _overdueCount: 0, _nextDue: null, _totalAmt: 0 };
      }
      const g = groups[ls._loanId];
      g._rows.push(ls);
      g._totalAmt = Math.round((g._totalAmt + (ls.amount || 0)) * 100) / 100;
      if (new Date(ls.dueDate).getTime() < todayMs) {
        g._overdueCount++;
      } else if (!g._nextDue) {
        g._nextDue = ls.dueDate; // rows are sorted asc — first non-overdue = soonest upcoming
      }
    });
    return Object.values(groups).map(g => {
      if (!g._nextDue && g._rows.length > 0) g._nextDue = g._rows[g._rows.length - 1].dueDate;
      return g;
    });
  })();

  const filteredLoans = filterSource === 'expenses' ? [] : loanSchedules.filter(ls=>{
    if (filterStatus === 'Active' && ls.status !== 'Active') return false;
    if (filterStatus === 'Cancelled' && ls.status !== 'Cancelled') return false;
    if (search && !(ls.title.toLowerCase().includes(search.toLowerCase()) || ls.contactName.toLowerCase().includes(search.toLowerCase()))) return false;
    return true;
  });

  const allCategories = [...new Set(schedules.map(s=>s.category).filter(Boolean))];

  /* ── Save / Delete ───────────────────────────────────────────── */
  async function saveSchedule(form) {
    setSaving(true);
    try {
      // Only the fields the create/edit modal owns. Payment-method fields
      // (paymentMethod, pmConfig) are managed exclusively by PmModal / savePm —
      // partial updates leave them untouched.
      const payload = {
        title: form.title||'',
        contactId: form.contactId && String(form.contactId).length === 36 ? form.contactId : null,
        contactName: form.contactName||null,
        category: form.category||null,
        frequency: form.frequency||'Monthly', amountCents: toCents(form.amount),
        dueDate: form.dueDate||null,
        startDate: form.startDate||null, endDate: form.endDate||null,
        dueDay: parseInt(form.dueDay)||0, status: form.status||'Active',
        notes: form.notes||null,
        // Voucher pre-fill defaults (used by the “Create Voucher” action)
        defaultExpenseAccountCode: form.defaultExpenseAccountCode||null,
        defaultTaxRateId:          form.defaultTaxRateId||null,
      };
      if (form.id) {
        await paymentSchedulesApi.update(form.id, payload);
        showToast('Schedule updated.');
      } else {
        await paymentSchedulesApi.create(payload); // server assigns the PS number
        showToast('Schedule created.');
      }
      setModal(null);
      await loadSchedules();
    } catch(e) { console.error(e); alert('Save failed: ' + (e?.detail || e?.message || e)); }
    setSaving(false);
  }

  function cancelSchedule(id) {
    askConfirm('Cancel this schedule?', async () => {
      await paymentSchedulesApi.update(id, { status:'Cancelled' });
      showToast('Schedule cancelled.');
      if (detailId===id) setDetailId(null);
      await loadSchedules();
    });
  }

  function deleteSchedule(id) {
    askConfirm('Permanently delete this schedule?', async () => {
      await paymentSchedulesApi.remove(id);
      if (detailId===id) setDetailId(null);
      await loadSchedules();
    });
  }

  function cancelAndDeleteSchedule(id) {
    askConfirm('Cancel and permanently delete this schedule? This cannot be undone.', async () => {
      await paymentSchedulesApi.remove(id);
      if (detailId===id) setDetailId(null);
      showToast('Schedule cancelled and deleted.');
      await loadSchedules();
    });
  }

  function endSchedule(id) {
    askConfirm('End this schedule today? No future occurrences will be generated.', async () => {
      const todayStr = new Date().toISOString().substring(0,10);
      await paymentSchedulesApi.update(id, { endDate: todayStr });
      showToast('Schedule ended.');
      await loadSchedules();
    });
  }

  async function savePm(form) {
    try {
      await paymentSchedulesApi.update(form.id, {
        paymentMethod: form.paymentMethod||null,
        pmConfig: {
          // Bank Transfer
          pmBtBankName:      form.pmBtBankName||'',
          pmBtAccountName:   form.pmBtAccountName||'',
          pmBtAccountNumber: form.pmBtAccountNumber||'',
          // Auto-Debit
          pmAdaAccountCode: form.pmAdaAccountCode||'',
          pmAdaDay:         form.pmAdaDay||'',
          // Check
          pmCheckbookCode: form.pmCheckbookCode||'',
          pmChecks: (form.pmChecks||[]).map(c =>
            typeof c === 'object' ? c : { checkNo:c, checkDate:'', amount:'' }
          ),
        },
      });
      setPmModal(null); showToast('Payment method saved.');
      await loadSchedules();
    } catch(e) { console.error(e); alert('Save failed: ' + (e?.detail || e?.message || e)); }
  }

  const detailSched = detailId ? schedules.find(s=>s.id===detailId) : null;
  const TABS = [{key:'list',label:'Schedules'},{key:'paymentmethod',label:'Payment Method'},{key:'calendar',label:'Calendar'},{key:'history',label:'History'}];

  /* ── Derived per-row payment status ─────────────────────────────
   *   Upcoming  — no linked voucher, due in future
   *   Due       — no linked voucher, due today
   *   Drafted   — linked voucher exists, not yet Paid / Disbursed
   *   Paid      — linked voucher is Paid or Disbursed
   *   Overdue   — no linked voucher and due date passed
   *   Cancelled — schedule cancelled
   * The match is by linkedScheduleId + linkedScheduleDate (or by id alone
   * for one-time schedules where the next-occurrence date equals dueDate).
   */
  function scheduleVoucher(scheduleId, occurrenceDate) {
    if (!scheduleId) return null;
    return vouchers.find(v => v.linkedScheduleId === scheduleId &&
      (!occurrenceDate || !v.linkedScheduleDate || v.linkedScheduleDate === occurrenceDate));
  }
  function rowStatus(s, nxt) {
    if (s.status === 'Cancelled') return { key:'Cancelled', label:'Cancelled', style:{background:'#f8fafc',borderColor:'#e2e8f0',color:'#94a3b8'} };
    const v = scheduleVoucher(s.id, nxt);
    if (v) {
      const paid = ['Paid','Disbursed','Approved'].includes(v.status);
      return paid
        ? { key:'Paid', label:'Paid', style:{background:'#f0fdf4',borderColor:'#bbf7d0',color:'#15803d'}, voucher:v }
        : { key:'Drafted', label:`${v.voucherType||'CV'} ${v.status||'Draft'}`, style:{background:'#eff6ff',borderColor:'#bfdbfe',color:'#1d4ed8'}, voucher:v };
    }
    if (!nxt) return { key:'None', label:'—', style:{background:'#f8fafc',borderColor:'#e2e8f0',color:'#94a3b8'} };
    const d = new Date(nxt); d.setHours(0,0,0,0);
    if (d < today) return { key:'Overdue', label:'Overdue', style:{background:'#fef2f2',borderColor:'#fecaca',color:'#b91c1c'} };
    if (d.getTime() === today.getTime()) return { key:'Due', label:'Due today', style:{background:'#fff7ed',borderColor:'#fed7aa',color:'#c2410c'} };
    return { key:'Upcoming', label:'Upcoming', style:{background:'#f0f9ff',borderColor:'#bae6fd',color:'#0369a1'} };
  }

  /* ── Hand off to Vouchers / Check Registry with prefill ───────── */
  function launchVoucher(s, kind /* 'PAYMENT' | 'CHECK' | 'LOAN' */, occurrenceDate) {
    const payload = {
      target: kind === 'CHECK' ? 'check' : 'voucher',
      voucherType: kind === 'CHECK' ? 'CV' : kind, // PAYMENT | LOAN
      scheduleId:     s.id,
      scheduleTitle:  s.title || '',
      scheduleSource: 'manual',
      occurrenceDate: occurrenceDate || nextOccurrence(s) || s.dueDate || '',
      contactId:   s.contactId || '',
      contactName: s.contactName || s.contactId || s.title || '',
      amount: parseFloat(s.amount) || 0,
      expenseAccountCode: s.defaultExpenseAccountCode || '',
      taxRateId:          s.defaultTaxRateId || '',
      bankCode:           s.bankCode || s.pmBtBank || s.pmCheckBank || '',
      purposeCategory:    s.category || '',
      notes: `${s.title || ''} — ${occurrenceDate || s.dueDate || ''}`.trim(),
    };
    setSchedulePrefill(payload);
    if (kind === 'CHECK') navigate('/scalebooks/checks');
    else                  navigate('/scalebooks/vouchers');
  }

  /* ══ Tab: List ═══════════════════════════════════════════════ */
  function ListTab() {
    const totalRows = filtered.length + groupedLoanRows.length;
    return (
      <div>
        <div style={{display:'flex',gap:8,marginBottom:12,alignItems:'center',flexWrap:'wrap'}}>
          <button className="btn btn-primary btn-sm" onClick={()=>setModal({})}>+ New Schedule</button>
          <span style={{marginLeft:'auto',fontSize:12,color:'#64748b'}}>{totalRows} result{totalRows!==1?'s':''}</span>
        </div>
        {totalRows===0?<div className="empty">No schedules match your filters.</div>:(
          <div style={{overflowX:'auto'}}>
            <table>
              <thead><tr>
                <th>Title</th><th>Vendor / Lender</th><th>Category</th><th>Frequency</th>
                <th style={{textAlign:'right'}}>Amount</th><th style={{minWidth:110,whiteSpace:'nowrap'}}>Next Due</th>
                <th>Method</th><th>Payment</th><th>Status</th><th style={{minWidth:160}}></th>
              </tr></thead>
              <tbody>
                {filtered.map(s=>{
                  const nxt=nextOccurrence(s);
                  const overdue=nxt&&new Date(nxt)<today;
                  const cs=catStyle(s.category);
                  const rs=rowStatus(s,nxt);
                  const defaultKind = s.paymentMethod==='Check' ? 'CHECK' : 'PAYMENT';
                  return (
                    <React.Fragment key={s.id}>
                    <tr>
                      <td>
                        <button onClick={()=>setDetailId(s.id===detailId?null:s.id)} style={{background:'none',border:'none',cursor:'pointer',fontWeight:700,color:'#0b1220',fontSize:12,padding:0,textAlign:'left'}}>
                          {s.title||'—'}
                          {s.frequency!=='One-Time'&&<span style={{marginLeft:5,fontSize:10}}>🔁</span>}
                        </button>
                      </td>
                      <td style={{color:'#64748b'}}>{s.contactName||s.contactId||'—'}</td>
                      <td><span className="pill" style={cs}>{s.category||'—'}</span></td>
                      <td style={{color:'#64748b'}}>{s.frequency}</td>
                      <td style={{textAlign:'right',fontWeight:700}}>{fmtCur(s.amount)}</td>
                      <td style={{color:overdue?'#dc2626':'#0b1220',fontWeight:overdue?700:400,whiteSpace:'nowrap'}}>
                        {nxt||<span style={{color:'#94a3b8'}}>—</span>}
                        {overdue&&<span style={{marginLeft:4,fontSize:10}}>⚠</span>}
                      </td>
                      <td style={{color:'#64748b',fontSize:11}}>{s.paymentMethod||<span style={{color:'#e5e7eb'}}>—</span>}</td>
                      <td>
                        {rs.voucher
                          ? <button onClick={()=>navigate('/scalebooks/vouchers')} className="pill" style={{...rs.style,border:`1px solid ${rs.style.borderColor}`,cursor:'pointer'}} title={`Voucher ${rs.voucher.voucherId||rs.voucher.id}`}>{rs.label}</button>
                          : <span className="pill" style={rs.style}>{rs.label}</span>}
                      </td>
                      <td><span className={`pill ${s.status==='Cancelled'?'':'pill-active'}`} style={s.status==='Cancelled'?{background:'#f8fafc',borderColor:'#e2e8f0',color:'#94a3b8'}:{}}>{s.status||'Active'}</span></td>
                      <td>
                        <div style={{display:'flex',gap:4,alignItems:'center',position:'relative',whiteSpace:'nowrap'}}>
                          {!rs.voucher && s.status!=='Cancelled' && (
                            <div style={{position:'relative'}} onClick={e=>e.stopPropagation()}>
                              <button className="btn btn-primary btn-sm" onClick={e=>toggleVoucherMenu(s.id,e)} title="Create voucher for this schedule">+ Voucher ▾</button>
                              {openMenuId===s.id && menuRect && createPortal((
                                <div onClick={e=>e.stopPropagation()} style={{position:'fixed',top:menuRect.bottom+4,right:Math.max(8,window.innerWidth-menuRect.right),background:'#fff',border:'1px solid #e5e7eb',borderRadius:10,boxShadow:'0 12px 32px rgba(0,0,0,.15)',zIndex:9999,minWidth:200,overflow:'hidden'}}>
                                  {[
                                    {k:'PAYMENT', label:'Payment Voucher', sub:'Bank transfer / cash'},
                                    {k:'CHECK',   label:'Check Voucher',   sub:'Issue check (incl. PDC)'},
                                    {k:'LOAN',    label:'Loan Voucher',    sub:'Loan principal/interest'},
                                  ].map(opt => (
                                    <button key={opt.k} onClick={()=>{setOpenMenuId(null);setMenuRect(null);launchVoucher(s,opt.k,nxt);}} style={{display:'block',width:'100%',textAlign:'left',background:opt.k===defaultKind?'#fff7ed':'none',border:0,padding:'9px 12px',cursor:'pointer',fontSize:12,fontFamily:'inherit'}}>
                                      <div style={{fontWeight:700,color:'#0b1220'}}>{opt.label}{opt.k===defaultKind?' ★':''}</div>
                                      <div style={{fontSize:10,color:'#64748b'}}>{opt.sub}</div>
                                    </button>
                                  ))}
                                </div>
                              ), document.body)}
                            </div>
                          )}
                          <div style={{position:'relative'}} onClick={e=>e.stopPropagation()}>
                            <button
                              onClick={e=>toggleActionsMenu(s.id,e)}
                              title="More actions"
                              style={{background:'none',border:'1px solid #e5e7eb',borderRadius:6,cursor:'pointer',fontSize:16,lineHeight:1,padding:'2px 8px',color:'#64748b',fontWeight:900}}
                            >⋮</button>
                            {openActionsId===s.id && actionsRect && createPortal((
                              <div onClick={e=>e.stopPropagation()} style={{position:'fixed',top:actionsRect.bottom+4,right:Math.max(8,window.innerWidth-actionsRect.right),background:'#fff',border:'1px solid #e5e7eb',borderRadius:10,boxShadow:'0 12px 32px rgba(0,0,0,.15)',zIndex:9999,minWidth:200,overflow:'hidden'}}>
                                {[
                                  {k:'edit',   label:'Edit',              color:'#0b1220', onClick:()=>setModal({...s})},
                                  {k:'cancel', label:'Cancel',            color:'#b45309', onClick:()=>cancelSchedule(s.id), disabled:s.status==='Cancelled'},
                                  {k:'cdel',   label:'Cancel and Delete', color:'#dc2626', onClick:()=>cancelAndDeleteSchedule(s.id)},
                                  {k:'end',    label:'End Schedule',      color:'#0b1220', onClick:()=>endSchedule(s.id), disabled:s.frequency==='One-Time'},
                                ].map(opt => (
                                  <button
                                    key={opt.k}
                                    disabled={opt.disabled}
                                    onClick={()=>{setOpenActionsId(null);setActionsRect(null);opt.onClick();}}
                                    style={{display:'block',width:'100%',textAlign:'left',background:'none',border:0,padding:'9px 12px',cursor:opt.disabled?'not-allowed':'pointer',fontSize:12,fontFamily:'inherit',color:opt.disabled?'#cbd5e1':opt.color,fontWeight:600}}
                                  >{opt.label}</button>
                                ))}
                              </div>
                            ), document.body)}
                          </div>
                        </div>
                      </td>
                    </tr>
                    {detailId===s.id&&<tr><td colSpan={10} style={{padding:'0 0 8px 0',background:'#f8fafc'}}><DetailPanel s={s} /></td></tr>}
                    </React.Fragment>
                  );
                })}
                {filtered.length > 0 && groupedLoanRows.length > 0 && (
                  <tr>
                    <td colSpan={10} style={{background:'#eef2ff',color:'#4338ca',fontWeight:800,fontSize:10,letterSpacing:'.07em',textTransform:'uppercase',padding:'6px 10px',borderTop:'2px solid #c7d2fe'}}>
                      Loan Obligations — Financial Management
                    </td>
                  </tr>
                )}
                {/* Loan obligation rows (read-only, grouped by loan) */}
                {groupedLoanRows.map(g => {
                  const nxtDue = g._nextDue;
                  const allOverdue = g._overdueCount === g._rows.length;
                  const hasOverdue = g._overdueCount > 0;
                  const nxtIsOverdue = nxtDue && new Date(nxtDue) < today;
                  const isExpanded = expandedLoanIds.has(g._loanId);
                  return (
                    <React.Fragment key={g.id}>
                      <tr className="loan-row" style={{cursor:'pointer'}} onClick={()=>toggleLoanExpand(g._loanId)}>
                        <td>
                          <span style={{fontWeight:700,color:'#0b1220',fontSize:12}}>
                            <span style={{display:'inline-block',width:14,color:'#6366f1',fontSize:10,marginRight:4,fontWeight:900}}>{isExpanded ? '▾' : '▸'}</span>
                            {g.title}
                          </span>
                          <span style={{marginLeft:6,fontSize:10,fontWeight:700,color:'#4338ca',background:'#eef2ff',border:'1px solid #c7d2fe',borderRadius:4,padding:'1px 5px'}}>Loan</span>
                        </td>
                        <td style={{color:'#64748b'}}>{g.contactName||'—'}</td>
                        <td><span className="pill" style={{background:'#f5f3ff',borderColor:'#ddd6fe',color:'#7c3aed'}}>{g.loanType||'Loan'}</span></td>
                        <td style={{color:'#64748b'}}>{g.paymentFrequency||'Monthly'}</td>
                        <td style={{textAlign:'right',fontWeight:700}}>
                          {fmtCur(g.amount)}
                          <div style={{fontSize:10,color:'#94a3b8',fontWeight:400}}>{g._rows.length} payment{g._rows.length!==1?'s':''}</div>
                        </td>
                        <td style={{color: allOverdue||nxtIsOverdue ? '#dc2626' : '#0b1220', fontWeight: allOverdue||nxtIsOverdue ? 700 : 400, whiteSpace:'nowrap'}}>
                          {nxtDue || <span style={{color:'#94a3b8'}}>—</span>}
                          {(allOverdue || nxtIsOverdue) && <span style={{marginLeft:4,fontSize:10}}>⚠</span>}
                          {hasOverdue && (
                            <div style={{fontSize:10,color:'#dc2626',fontWeight:700}}>
                              {g._overdueCount} overdue
                            </div>
                          )}
                        </td>
                        <td style={{color:'#94a3b8',fontSize:11}}>—</td>
                        <td><span className="pill" style={{background:'#f5f3ff',borderColor:'#ddd6fe',color:'#7c3aed'}}>Loan Obligation</span></td>
                        <td><span className="pill" style={g.status==='Cancelled'?{background:'#f8fafc',borderColor:'#e2e8f0',color:'#94a3b8'}:{background:'#f0fdf4',borderColor:'#bbf7d0',color:'#15803d'}}>{g.status}</span></td>
                        <td onClick={e=>e.stopPropagation()}>
                          <div style={{display:'flex',gap:4,alignItems:'center'}}>
                            {g.status !== 'Cancelled' && (
                              <div style={{position:'relative'}} onClick={e=>e.stopPropagation()}>
                                <button className="btn btn-primary btn-sm" onClick={e=>toggleVoucherMenu(g.id,e)}>+ Voucher ▾</button>
                                {openMenuId===g.id && menuRect && createPortal((
                                  <div onClick={e=>e.stopPropagation()} style={{position:'fixed',top:menuRect.bottom+4,right:Math.max(8,window.innerWidth-menuRect.right),background:'#fff',border:'1px solid #e5e7eb',borderRadius:10,boxShadow:'0 12px 32px rgba(0,0,0,.15)',zIndex:9999,minWidth:200,overflow:'hidden'}}>
                                    {[
                                      {k:'PAYMENT', label:'Payment Voucher', sub:'Bank transfer / cash'},
                                      {k:'CHECK',   label:'Check Voucher',   sub:'Issue check (incl. PDC)'},
                                      {k:'LOAN',    label:'Loan Voucher',    sub:'Loan principal/interest'},
                                    ].map(opt => (
                                      <button key={opt.k} onClick={()=>{setOpenMenuId(null);setMenuRect(null);launchVoucher(g, opt.k, g._nextDue);}} style={{display:'block',width:'100%',textAlign:'left',background:'none',border:0,padding:'9px 12px',cursor:'pointer',fontSize:12,fontFamily:'inherit'}}>
                                        <div style={{fontWeight:700,color:'#0b1220'}}>{opt.label}</div>
                                        <div style={{fontSize:10,color:'#64748b'}}>{opt.sub}</div>
                                      </button>
                                    ))}
                                  </div>
                                ), document.body)}
                              </div>
                            )}
                            {hasAccess('Financial Management')
                              ? <button className="btn btn-ghost btn-sm" onClick={()=>navigate('/scalebooks/financial')} title="Manage in Financial Management">View</button>
                              : <span title="You do not have access to Financial Management" style={{fontSize:11,color:'#94a3b8',cursor:'not-allowed',padding:'3px 8px',border:'1px solid #e5e7eb',borderRadius:6,display:'inline-block'}}>No access</span>
                            }
                          </div>
                        </td>
                      </tr>
                      {isExpanded && g._rows.map((row, ri) => {
                        const rowOverdue = row.dueDate && new Date(row.dueDate) < today;
                        return (
                          <tr key={row.id} style={{background: rowOverdue ? '#fef2f2' : '#f9f8ff'}}>
                            <td style={{paddingLeft:28,fontSize:11,color:'#64748b'}}>Payment {ri + 1}</td>
                            <td style={{color:'#94a3b8',fontSize:11}}>—</td>
                            <td></td>
                            <td style={{fontSize:11,color:'#94a3b8'}}>One-Time</td>
                            <td style={{textAlign:'right',fontWeight:600,fontSize:12}}>{fmtCur(row.amount)}</td>
                            <td style={{fontSize:12,color:rowOverdue?'#dc2626':'#374151',fontWeight:rowOverdue?700:400,whiteSpace:'nowrap'}}>
                              {row.dueDate}
                              {rowOverdue && <span style={{marginLeft:4,fontSize:10}}>⚠</span>}
                            </td>
                            <td></td><td></td><td></td>
                            <td>
                              <div style={{position:'relative'}} onClick={e=>e.stopPropagation()}>
                                <button className="btn btn-primary btn-sm" onClick={e=>toggleVoucherMenu(row.id,e)}>+ Voucher ▾</button>
                                {openMenuId===row.id && menuRect && createPortal((
                                  <div onClick={e=>e.stopPropagation()} style={{position:'fixed',top:menuRect.bottom+4,right:Math.max(8,window.innerWidth-menuRect.right),background:'#fff',border:'1px solid #e5e7eb',borderRadius:10,boxShadow:'0 12px 32px rgba(0,0,0,.15)',zIndex:9999,minWidth:200,overflow:'hidden'}}>
                                    {[
                                      {k:'PAYMENT', label:'Payment Voucher', sub:'Bank transfer / cash'},
                                      {k:'CHECK',   label:'Check Voucher',   sub:'Issue check (incl. PDC)'},
                                      {k:'LOAN',    label:'Loan Voucher',    sub:'Loan principal/interest'},
                                    ].map(opt => (
                                      <button key={opt.k} onClick={()=>{setOpenMenuId(null);setMenuRect(null);launchVoucher(row, opt.k, row.dueDate);}} style={{display:'block',width:'100%',textAlign:'left',background:'none',border:0,padding:'9px 12px',cursor:'pointer',fontSize:12,fontFamily:'inherit'}}>
                                        <div style={{fontWeight:700,color:'#0b1220'}}>{opt.label}</div>
                                        <div style={{fontSize:10,color:'#64748b'}}>{opt.sub}</div>
                                      </button>
                                    ))}
                                  </div>
                                ), document.body)}
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </React.Fragment>
                  );
                })}
              </tbody>
              <tfoot>
                {filterSource === 'all' && filtered.length > 0 && groupedLoanRows.length > 0 ? (
                  <>
                    <tr>
                      <td colSpan={4} style={{fontWeight:700,color:'#64748b'}}>Expense Schedules</td>
                      <td style={{textAlign:'right',fontWeight:700,color:'#64748b'}}>{fmtCur(filtered.reduce((s,r)=>s+(parseFloat(r.amount)||0),0))}</td>
                      <td colSpan={5}></td>
                    </tr>
                    <tr>
                      <td colSpan={4} style={{fontWeight:700,color:'#7c3aed'}}>Loan Obligations</td>
                      <td style={{textAlign:'right',fontWeight:700,color:'#7c3aed'}}>{fmtCur(filteredLoans.reduce((s,r)=>s+(parseFloat(r.amount)||0),0))}</td>
                      <td colSpan={5}></td>
                    </tr>
                    <tr style={{borderTop:'2px solid #e5e7eb'}}>
                      <td colSpan={4} style={{fontWeight:900}}>COMBINED TOTAL</td>
                      <td style={{textAlign:'right',fontWeight:900}}>{fmtCur([...filtered,...filteredLoans].reduce((s,r)=>s+(parseFloat(r.amount)||0),0))}</td>
                      <td colSpan={5}></td>
                    </tr>
                  </>
                ) : (
                  <tr>
                    <td colSpan={4} style={{fontWeight:900}}>TOTAL (filtered)</td>
                    <td style={{textAlign:'right'}}>{fmtCur([...filtered,...filteredLoans].reduce((s,r)=>s+(parseFloat(r.amount)||0),0))}</td>
                    <td colSpan={5}></td>
                  </tr>
                )}
              </tfoot>
            </table>
          </div>
        )}
      </div>
    );
  }

  /* ══ Tab: Payment Method Grouping ════════════════════════════ */
  function PaymentMethodTab() {
    const groups = {'Check':[],'Bank Transfer':[],'Auto-Debit':[],'Unspecified':[]};
    filtered.filter(s=>s.status!=='Cancelled').forEach(s=>{
      const pm=s.paymentMethod||'';
      (groups[pm]||groups['Unspecified']).push(s);
    });
    return (
      <div>
        {Object.entries(groups).map(([pm,list])=>{
          const icons={'Check':'✏️','Bank Transfer':'🏦','Auto-Debit':'🔁','Unspecified':'❓'};
          const monthTotal=list.reduce((sum,s)=>sum+occurrencesInMonth(s,cy,cm).length*(parseFloat(s.amount)||0),0);
          let ann12=0;
          list.forEach(s=>{for(let i=0;i<12;i++){const m=(cm+i)%12,y=cy+Math.floor((cm+i)/12);ann12+=occurrencesInMonth(s,y,m).length*(parseFloat(s.amount)||0);}});
          return (
            <div key={pm} className="pm-group">
              <div className="pm-group-hdr">
                <span style={{fontWeight:800,fontSize:13}}>{icons[pm]} {pm} <span style={{color:'#94a3b8',fontWeight:600}}>({list.length})</span></span>
                <span style={{fontSize:12,color:'#64748b'}}>This month: <strong>{fmtCur(monthTotal)}</strong> · 12mo: <strong>{fmtCur(ann12)}</strong></span>
              </div>
              {list.length===0?<div style={{padding:'12px 16px',color:'#94a3b8',fontSize:12}}>No schedules.</div>:(
                <table>
                  <thead><tr>
                    <th>Title</th><th>Category</th><th>Frequency</th><th style={{textAlign:'right'}}>Amount</th><th>Next Due</th><th>Bank</th><th></th>
                  </tr></thead>
                  <tbody>
                    {list.map(s=>{
                      const nxt=nextOccurrence(s);
                      const overdue=nxt&&new Date(nxt)<today;
                      return (
                        <tr key={s.id}>
                          <td style={{fontWeight:700}}>{s.title}</td>
                          <td><span className="pill" style={catStyle(s.category)}>{s.category||'—'}</span></td>
                          <td style={{color:'#64748b'}}>{s.frequency}</td>
                          <td style={{textAlign:'right',fontWeight:700}}>{fmtCur(s.amount)}</td>
                          <td style={{color:overdue?'#dc2626':'#0b1220'}}>{nxt||'—'}</td>
                          <td style={{fontSize:11,color:'#64748b'}}>{s.paymentMethod==='Bank Transfer'?(s.pmBtBankName||'—'):s.paymentMethod==='Auto-Debit'?(s.pmAdaAccountCode||'—'):s.paymentMethod==='Check'?(s.pmCheckbookCode?`CB: ${s.pmCheckbookCode.slice(0,8)}…`:'—'):'—'}</td>
                          <td>
                            <div style={{display:'flex',gap:4}}>
                              <button className="btn btn-ghost btn-sm" onClick={()=>setModal({...s})}>Edit</button>
                              <button className="btn btn-ghost btn-sm" onClick={()=>setPmModal({...s})}>💳 Set Method</button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                  <tfoot><tr>
                    <td colSpan={3} style={{fontWeight:900}}>SUBTOTAL</td>
                    <td style={{textAlign:'right'}}>{fmtCur(list.reduce((s,r)=>s+(parseFloat(r.amount)||0),0))}</td>
                    <td colSpan={3}></td>
                  </tr></tfoot>
                </table>
              )}
            </div>
          );
        })}
      </div>
    );
  }

  /* ══ Tab: Calendar (3-month rolling) ════════════════════════ */
  function CalendarTab() {
    const months = [0,1,2].map(i=>{
      const base = (cm + calOffset*3 + i);
      return {month: base%12<0?base%12+12:base%12, year: cy + Math.floor((cm + calOffset*3 + i)/12)};
    });
    const DOW=['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
    return (
      <div>
        <div style={{display:'flex',gap:8,marginBottom:14,alignItems:'center'}}>
          <button className="btn btn-ghost btn-sm" onClick={()=>setCalOffset(o=>o-1)}>◀ Prev</button>
          <span style={{fontWeight:700,fontSize:13}}>{MONTH_NAMES[months[0].month]} {months[0].year} – {MONTH_NAMES[months[2].month]} {months[2].year}</span>
          <button className="btn btn-ghost btn-sm" onClick={()=>setCalOffset(o=>o+1)}>Next ▶</button>
          <button className="btn btn-ghost btn-sm" onClick={()=>setCalOffset(0)}>Today</button>
        </div>
        {months.map(({month,year})=>{
          const dim=new Date(year,month+1,0).getDate();
          const fdow=new Date(year,month,1).getDay();
          const cells=[...Array(fdow).fill(null),...Array.from({length:dim},(_,i)=>i+1)];
          while(cells.length%7) cells.push(null);
          const weeks=Array.from({length:cells.length/7},(_,i)=>cells.slice(i*7,i*7+7));
          const dayEvents={};
          (filterSource !== 'loans' ? filtered : []).filter(s=>s.status!=='Cancelled').forEach(s=>{
            occurrencesInMonth(s,year,month).forEach(dateStr=>{
              const d=parseInt(dateStr.split('-')[2]);
              if(!dayEvents[d]) dayEvents[d]=[];
              dayEvents[d].push(s);
            });
          });
          (filterSource !== 'expenses' ? filteredLoans : []).filter(ls=>ls.status!=='Cancelled').forEach(ls=>{
            occurrencesInMonth(ls,year,month).forEach(dateStr=>{
              const d=parseInt(dateStr.split('-')[2]);
              if(!dayEvents[d]) dayEvents[d]=[];
              dayEvents[d].push({...ls, _calIsLoan: true});
            });
          });
          return (
            <div key={year+'-'+month} style={{marginBottom:24}}>
              <div style={{fontWeight:900,fontSize:14,marginBottom:8}}>{MONTH_NAMES[month]} {year}</div>
              <div className="cal-grid">
                {DOW.map(d=><div key={d} className="cal-day-hdr">{d}</div>)}
                {weeks.map((wk,wi)=>wk.map((day,di)=>(
                  <div key={`${wi}-${di}`} className={day?'cal-cell':'cal-empty'}>
                    {day&&(<>
                      <div className="cal-day" style={{color:day===today.getDate()&&month===today.getMonth()&&year===today.getFullYear()?'#f97316':'#0b1220'}}>{day}</div>
                      {(dayEvents[day]||[]).slice(0,3).map((s,i)=>(
                        <div key={i} className="cal-ev" style={s._calIsLoan ? {background:'#f5f3ff',borderColor:'#ddd6fe',color:'#7c3aed'} : catStyle(s.category)}>
                          <div style={{overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap',fontWeight:700}}>{s.title}</div>
                          <div>{fmtCur(s.amount)}</div>
                        </div>
                      ))}
                      {(dayEvents[day]||[]).length>3&&<div style={{fontSize:8,color:'#94a3b8'}}>+{dayEvents[day].length-3} more</div>}
                    </>)}
                  </div>
                )))}
              </div>
            </div>
          );
        })}
      </div>
    );
  }

  /* ══ Tab: Transaction History ════════════════════════════════ */
  function HistoryTab() {
    const [vouchers, setVouchers] = useState([]);
    useEffect(()=>{
      listVouchers()
        .then(rows => setVouchers(rows.map(schedVoucherFromApi).filter(v=>v.linkedScheduleId)))
        .catch(e => console.error('history load failed', e));
    },[]);
    const VSTATUS_COLORS = {Draft:'#f8fafc:#e2e8f0:#475569',Pending:'#fef9c3:#fde68a:#a16207',Approved:'#f0fdf4:#bbf7d0:#15803d',Disbursed:'#eff6ff:#bfdbfe:#1d4ed8',Rejected:'#fef2f2:#fecaca:#b91c1c',Cancelled:'#f8fafc:#e2e8f0:#94a3b8'};
    function vstyle(st){const s=VSTATUS_COLORS[st]||VSTATUS_COLORS.Draft;const [bg,border,color]=s.split(':');return{background:bg,borderColor:border,color};}
    return (
      <div>
        {vouchers.length===0?<div className="empty">No vouchers linked to payment schedules yet.</div>:(
          <div style={{overflowX:'auto'}}>
            <table>
              <thead><tr>
                <th>Voucher ID</th><th>Date</th><th>Schedule</th><th>Sched. Date</th>
                <th style={{textAlign:'right'}}>Amount</th><th>Status</th>
              </tr></thead>
              <tbody>
                {vouchers.map(v=>{
                  const s=schedules.find(sc=>sc.id===v.linkedScheduleId);
                  return (
                    <tr key={v.id}>
                      <td style={{fontFamily:'monospace',color:'#f97316',fontWeight:800,fontSize:11}}>{v.voucherId||v.id}</td>
                      <td>{v.preparationDate||'—'}</td>
                      <td style={{fontWeight:600}}>{s?.title||v.linkedScheduleId}</td>
                      <td style={{color:'#64748b'}}>{v.linkedScheduleDate||'—'}</td>
                      <td style={{textAlign:'right',fontWeight:700}}>{fmtCur(v.totalAmount)}</td>
                      <td><span className="pill" style={vstyle(v.status)}>{v.status||'Draft'}</span></td>
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

  /* ══ Detail Panel ════════════════════════════════════════════ */
  function DetailPanel({s}) {
    const nxt=nextOccurrence(s);
    const overdue=nxt&&new Date(nxt)<today;
    const cs=catStyle(s.category);
    const PM_ICONS={'Check':'✏️','Bank Transfer':'🏦','Auto-Debit':'🔁'};
    let pmDetails='';
    if(s.paymentMethod==='Check'){
      const cnt=(s.pmChecks||[]).length;
      pmDetails=cnt?`${cnt} check${cnt!==1?'s':''} queued`:'—';
    } else if(s.paymentMethod==='Bank Transfer'){
      const parts=[s.pmBtBankName, s.pmBtAccountName, s.pmBtAccountNumber].filter(Boolean);
      pmDetails=parts.join(' · ')||'—';
    } else if(s.paymentMethod==='Auto-Debit'){
      const acct=s.pmAdaAccountCode?bankAccounts.find(a=>a.code===s.pmAdaAccountCode):null;
      pmDetails=`${acct?acct.name:s.pmAdaAccountCode||'?'}${s.pmAdaDay?` · Day ${s.pmAdaDay}`:''}` || '—';
    }
    return (
      <div style={{marginTop:16,background:'#f8fafc',border:'1px solid #e5e7eb',borderRadius:12,padding:16}}>
        <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:12}}>
          <div>
            <span style={{fontWeight:900,fontSize:14}}>{s.title}</span>
            <span className="pill" style={{...cs,marginLeft:8}}>{s.category}</span>
            <span className={`pill`} style={{marginLeft:6,background:s.status==='Cancelled'?'#f8fafc':'#f0fdf4',borderColor:s.status==='Cancelled'?'#e2e8f0':'#bbf7d0',color:s.status==='Cancelled'?'#94a3b8':'#15803d'}}>{s.status||'Active'}</span>
          </div>
          <div style={{display:'flex',gap:6}}>
            <button className="btn btn-ghost btn-sm" onClick={()=>setModal({...s})}>Edit</button>
            <button className="btn btn-primary btn-sm" onClick={()=>setPayModal({schedule:s, dueDate:nxt||today.toISOString().slice(0,10)})}>+ Record Payment</button>
            <button onClick={()=>setDetailId(null)} style={{background:'none',border:'none',color:'#94a3b8',cursor:'pointer',fontSize:16,padding:'0 4px'}}>✕</button>
          </div>
        </div>
        <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(160px,1fr))',gap:'8px 16px',fontSize:12}}>
          {[['Vendor',s.contactName||s.contactId||'—'],['Frequency',s.frequency],['Amount',fmtCur(s.amount)],['Bank / Fund',s.bankCode||'—'],['Due Day',s.dueDay||'—'],['Start Date',s.startDate||s.dueDate||'—'],['End Date',s.endDate||'—'],['Next Due', <span style={{color:overdue?'#dc2626':'inherit'}}>{nxt||(s.status==='Cancelled'?'N/A':'—')}{overdue?' ⚠':''}</span>],['Payment Method',`${PM_ICONS[s.paymentMethod]||'❓'} ${s.paymentMethod||'Unspecified'}`],['PM Details',pmDetails]].map(([lbl,val])=>(
            <div key={lbl}><div style={{fontSize:9,fontWeight:800,color:'#94a3b8',textTransform:'uppercase',letterSpacing:'.06em',marginBottom:2}}>{lbl}</div><div style={{fontWeight:600}}>{val}</div></div>
          ))}
        </div>
        {s.notes&&<div style={{marginTop:10,fontSize:12,color:'#64748b',borderTop:'1px solid #e5e7eb',paddingTop:8}}>{s.notes}</div>}
      </div>
    );
  }

  /* ══ Schedule Form Modal ════════════════════════════════════
   *  Captures only the essentials needed for a recurring/one-time
   *  payable reminder. Payment Method is configured separately via
   *  the 💳 row action (see PmModal). Voucher pre-fill defaults
   *  (account + tax) are kept inline because they're trivial picks
   *  that materially improve the “Create Voucher” hand-off.
   */
  function ScheduleModal() {
    const isEdit=!!(modal&&modal.id);
    const [form,setForm]=useState({title:'',contactId:'',category:'',frequency:'Monthly',amount:'',dueDate:'',startDate:'',endDate:'',dueDay:'',status:'Active',notes:'',defaultExpenseAccountCode:'',defaultTaxRateId:'',...modal});
    const upd=(k,v)=>setForm(f=>({...f,[k]:v}));
    const isRecurring=form.frequency!=='One-Time';
    return (
      <div className="backdrop" onClick={e=>e.target===e.currentTarget&&setModal(null)}>
        <div className="modal">
          <div className="modal-h"><strong>{isEdit?'Edit Schedule':'New Payment Schedule'}</strong><button className="btn btn-ghost btn-sm" onClick={()=>setModal(null)}>✕</button></div>
          <div className="modal-b">
            <div className="grid3">
              <div className="field col3"><label>Title *</label><input value={form.title} onChange={e=>upd('title',e.target.value)} /></div>
              <div className="field col2">
                <label>Vendor / Contact</label>
                <ContactPicker
                  contacts={contacts}
                  value={form.contactId||''}
                  displayName={form.contactName||''}
                  onChange={({contactId,contactName})=>setForm(f=>({...f,contactId:contactId||'',contactName:contactName||''}))}
                  placeholder="Search vendor…"
                />
              </div>
              <div className="field">
                <label>Category</label>
                <select value={form.category} onChange={e=>upd('category',e.target.value)}>
                  <option value="">— None —</option>
                  {purposeCategories.map(c=><option key={c} value={c}>{c}</option>)}
                  {form.category && !purposeCategories.includes(form.category) && <option value={form.category}>{form.category}</option>}
                </select>
              </div>
              <div className="field"><label>Frequency</label><select value={form.frequency} onChange={e=>upd('frequency',e.target.value)}>{FREQS.map(f=><option key={f}>{f}</option>)}</select></div>
              <div className="field"><label>Amount *</label><input type="number" step="0.01" value={form.amount} onChange={e=>upd('amount',e.target.value)} /></div>
              <div className="field"><label>Status</label><select value={form.status} onChange={e=>upd('status',e.target.value)}>{STATUSES.map(s=><option key={s}>{s}</option>)}</select></div>
            </div>
            {!isRecurring&&<div className="field" style={{marginBottom:10}}><label>Due Date</label><input type="date" value={form.dueDate} onChange={e=>upd('dueDate',e.target.value)} /></div>}
            {isRecurring&&<div className="grid3">
              <div className="field"><label>Start Date</label><input type="date" value={form.startDate} onChange={e=>upd('startDate',e.target.value)} /></div>
              <div className="field"><label>End Date</label><input type="date" value={form.endDate} onChange={e=>upd('endDate',e.target.value)} /></div>
              <div className="field"><label>Due Day of Month</label><input type="number" min="1" max="31" value={form.dueDay} onChange={e=>upd('dueDay',e.target.value)} /></div>
            </div>}
            <div className="grid3">
              <div className="field col2">
                <label>Expense / COA Account</label>
                <AccountCombobox
                  rawAccounts={accounts}
                  value={form.defaultExpenseAccountCode||''}
                  onChange={v=>upd('defaultExpenseAccountCode',v)}
                  placeholder="— Select account —"
                />
              </div>
              <div className="field">
                <label>Tax Rate</label>
                <select value={form.defaultTaxRateId||''} onChange={e=>upd('defaultTaxRateId',e.target.value)}>
                  <option value="">— None —</option>
                  {taxRates.length > 0 && <optgroup label="— Rates —">{taxRates.map(r=><option key={r.id} value={r.id}>{r.name} ({r.rate||0}%)</option>)}</optgroup>}
                  {taxGroups.length > 0 && <optgroup label="— Groups —">{taxGroups.map(g=><option key={g.id} value={g.id}>{g.name}</option>)}</optgroup>}
                </select>
              </div>
            </div>
            <div className="field" style={{marginTop:10}}><label>Notes</label><textarea rows={2} value={form.notes} onChange={e=>upd('notes',e.target.value)} style={{resize:'vertical'}} /></div>
            {!isEdit && <div style={{marginTop:10,padding:'8px 10px',background:'#f8fafc',border:'1px solid #e5e7eb',borderRadius:8,fontSize:11,color:'#64748b'}}>💡 Set the Payment Method (Check / Bank Transfer / Auto-Debit) from the row's 💳 action after creating the schedule.</div>}
          </div>
          <div className="modal-f">
            <button className="btn btn-ghost" onClick={()=>setModal(null)}>Cancel</button>
            <button className="btn btn-primary" disabled={saving} onClick={()=>{if(!form.title.trim()) return alert('Title required.');if(!(parseFloat(form.amount)>0)) return alert('Amount must be > 0.');saveSchedule(form);}}>{saving?'Saving…':isEdit?'Save Changes':'Create Schedule'}</button>
          </div>
        </div>
      </div>
    );
  }

  /* ══ PM Modal ════════════════════════════════════════════════ */
  function PmModal() {
    if(!pmModal) return null;
    const [form,setForm]=useState({
      ...pmModal,
      pmChecks: Array.isArray(pmModal.pmChecks)
        ? pmModal.pmChecks.map(c => typeof c==='object' ? c : {checkNo:c,checkDate:'',amount:''})
        : [],
    });
    const upd=(k,v)=>setForm(f=>({...f,[k]:v}));

    // Load already-issued check numbers for the selected checkbook
    const [issuedNums, setIssuedNums] = useState(new Set());
    const [numsLoading, setNumsLoading] = useState(false);
    useEffect(() => {
      if (!form.pmCheckbookCode) { setIssuedNums(new Set()); return; }
      setNumsLoading(true);
      listChecks()
        .then(rows => setIssuedNums(new Set(rows.filter(ch => ch.checkbookId === form.pmCheckbookCode).map(ch => ch.checkNumber).filter(Boolean))))
        .catch(() => setIssuedNums(new Set()))
        .finally(() => setNumsLoading(false));
    }, [form.pmCheckbookCode]);

    function checkError(checkNo, idx) {
      if (!checkNo) return null;
      if (issuedNums.has(String(checkNo))) return 'Already issued';
      const dupe = (form.pmChecks||[]).some((c,i) => i!==idx && c.checkNo && c.checkNo===checkNo);
      if (dupe) return 'Duplicate';
      return null;
    }
    const hasCheckErrors = form.paymentMethod==='Check' &&
      (form.pmChecks||[]).some((c,i) => !!checkError(c.checkNo, i));

    function addCheck() {
      const cb = checkbooks.find(c=>c.id===form.pmCheckbookCode);
      let nextNo = '';
      if (cb) {
        const padLen = String(cb.endingNumber||'').length || 6;
        const end = parseInt(cb.endingNumber) || Infinity;
        // All numbers already taken: issued in checkRegister + already queued in this list
        const taken = new Set([
          ...Array.from(issuedNums),
          ...(form.pmChecks||[]).map(c=>c.checkNo).filter(Boolean),
        ]);
        let candidate = parseInt(cb.nextCheckNumber||cb.startingNumber||1);
        while (candidate <= end && taken.has(String(candidate).padStart(padLen,'0'))) candidate++;
        if (candidate <= end) nextNo = String(candidate).padStart(padLen,'0');
      }
      upd('pmChecks',[...(form.pmChecks||[]),{checkNo:nextNo,checkDate:new Date().toISOString().slice(0,10),amount:form.amount||''}]);
    }
    function updateCheck(idx,field,val) {
      upd('pmChecks',(form.pmChecks||[]).map((c,i)=>i===idx?{...c,[field]:val}:c));
    }
    function removeCheck(idx) {
      upd('pmChecks',(form.pmChecks||[]).filter((_,i)=>i!==idx));
    }
    const selectedCb = checkbooks.find(c=>c.id===form.pmCheckbookCode);
    const pendingTotal = (form.pmChecks||[]).reduce((s,c)=>s+(parseFloat(c.amount)||0),0);

    return (
      <div className="backdrop" onClick={e=>e.target===e.currentTarget&&setPmModal(null)}>
        <div className="modal" style={{maxWidth:520}}>
          <div className="modal-h">
            <strong>Payment Method — {pmModal.title}</strong>
            <button className="btn btn-ghost btn-sm" onClick={()=>setPmModal(null)}>✕</button>
          </div>
          <div className="modal-b" style={{display:'flex',flexDirection:'column',gap:14}}>
            {/* Method selector */}
            <div style={{display:'flex',gap:8}}>
              {['','Check','Bank Transfer','Auto-Debit'].map(pm=>(
                <button key={pm||'none'}
                  className={`btn btn-sm ${form.paymentMethod===pm?'btn-primary':'btn-ghost'}`}
                  onClick={()=>upd('paymentMethod',pm)}>
                  {pm||'None'}
                </button>
              ))}
            </div>

            {/* Bank Transfer */}
            {form.paymentMethod==='Bank Transfer'&&(
              <div style={{display:'flex',flexDirection:'column',gap:10}}>
                <div className="field">
                  <label>Bank Name</label>
                  <input value={form.pmBtBankName||''} onChange={e=>upd('pmBtBankName',e.target.value)} placeholder="e.g. BDO, BPI, Metrobank" />
                </div>
                <div className="field">
                  <label>Account Name</label>
                  <input value={form.pmBtAccountName||''} onChange={e=>upd('pmBtAccountName',e.target.value)} placeholder="Name on the bank account" />
                </div>
                <div className="field">
                  <label>Account Number</label>
                  <input value={form.pmBtAccountNumber||''} onChange={e=>upd('pmBtAccountNumber',e.target.value)} placeholder="Vendor's account number" />
                </div>
              </div>
            )}

            {/* Auto-Debit */}
            {form.paymentMethod==='Auto-Debit'&&(
              <div style={{display:'flex',flexDirection:'column',gap:10}}>
                <div className="field">
                  <label>Bank Account (COA)</label>
                  <select value={form.pmAdaAccountCode||''} onChange={e=>upd('pmAdaAccountCode',e.target.value)} style={{width:'100%'}}>
                    <option value="">— select account —</option>
                    {bankAccounts.map(a=><option key={a.id} value={a.code}>{a.code} · {a.name}</option>)}
                  </select>
                </div>
                <div className="field">
                  <label>Debit Day of Month</label>
                  <input type="number" min="1" max="31" value={form.pmAdaDay||''} onChange={e=>upd('pmAdaDay',e.target.value)} style={{width:80}} placeholder="1–31" />
                </div>
              </div>
            )}

            {/* Check */}
            {form.paymentMethod==='Check'&&(
              <div style={{display:'flex',flexDirection:'column',gap:10}}>
                <div className="field">
                  <label>Issuing Checkbook</label>
                  <select value={form.pmCheckbookCode||''} onChange={e=>upd('pmCheckbookCode',e.target.value)} style={{width:'100%'}}>
                    <option value="">— select checkbook —</option>
                    {checkbooks.map(cb=>{
                      const cbAcct = bankAccounts.find(a=>a.code===cb.bankCode);
                      const cbLabel = cbAcct ? cbAcct.name : cb.bankCode;
                      return (
                        <option key={cb.id} value={cb.id}>
                          {cb.bankCode} · {cbLabel} · Next: #{String(cb.nextCheckNumber||cb.startingNumber||'').padStart(6,'0')}
                        </option>
                      );
                    })}
                  </select>
                </div>
                {selectedCb&&(()=>{
                  const cbAcct = bankAccounts.find(a=>a.code===selectedCb.bankCode);
                  return (
                    <div style={{background:'#f8fafc',border:'1px solid #e5e7eb',borderRadius:8,padding:'6px 12px',fontSize:12,color:'#64748b'}}>
                      {cbAcct&&<span style={{fontWeight:700,color:'#0b1220'}}>{cbAcct.name}</span>}{cbAcct&&' · '}
                      Series #{selectedCb.startingNumber}–#{selectedCb.endingNumber} · Next: #{selectedCb.nextCheckNumber}
                    </div>
                  );
                })()}
                <div>
                  <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:6}}>
                    <label style={{fontWeight:700,fontSize:12,margin:0}}>Pending Checks</label>
                    <button className="btn btn-ghost btn-sm" onClick={addCheck} style={{fontSize:11}}>+ Add Check</button>
                  </div>
                  {(form.pmChecks||[]).length===0
                    ? <div style={{color:'#94a3b8',fontSize:12,padding:'4px 0'}}>No checks queued.</div>
                    : (
                      <table style={{width:'100%',fontSize:12,borderCollapse:'collapse'}}>
                        <thead>
                          <tr style={{background:'#f1f5f9'}}>
                            <th style={{padding:'4px 8px',textAlign:'left',fontWeight:700}}>CHECK NO.</th>
                            <th style={{padding:'4px 8px',textAlign:'left',fontWeight:700}}>CHECK DATE</th>
                            <th style={{padding:'4px 8px',textAlign:'right',fontWeight:700}}>AMOUNT</th>
                            <th style={{width:28}}></th>
                          </tr>
                        </thead>
                        <tbody>
                          {(form.pmChecks||[]).map((c,i)=>{
                            const err = checkError(c.checkNo, i);
                            return (
                            <tr key={i} style={{borderTop:'1px solid #e5e7eb',background:err?'#fef2f2':undefined}}>
                              <td style={{padding:'4px 8px'}}>
                                <input value={c.checkNo||''} onChange={e=>updateCheck(i,'checkNo',e.target.value)}
                                  style={{width:'100%',border:`1px solid ${err?'#fca5a5':'#e5e7eb'}`,borderRadius:4,padding:'2px 6px',fontFamily:'monospace'}} />
                                {err&&<div style={{color:'#dc2626',fontSize:10,marginTop:1}}>{err}</div>}
                              </td>
                              <td style={{padding:'4px 8px'}}>
                                <input type="date" value={c.checkDate||''} onChange={e=>updateCheck(i,'checkDate',e.target.value)}
                                  style={{border:'1px solid #e5e7eb',borderRadius:4,padding:'2px 4px'}} />
                              </td>
                              <td style={{padding:'4px 8px'}}>
                                <input type="number" value={c.amount||''} onChange={e=>updateCheck(i,'amount',e.target.value)}
                                  style={{width:90,border:'1px solid #e5e7eb',borderRadius:4,padding:'2px 6px',textAlign:'right'}} />
                              </td>
                              <td style={{padding:'4px 4px'}}>
                                <button className="btn btn-ghost btn-sm" onClick={()=>removeCheck(i)}
                                  style={{color:'#dc2626',padding:'2px 6px'}}>✕</button>
                              </td>
                            </tr>
                            );
                          })}
                        </tbody>
                        <tfoot>
                          <tr style={{borderTop:'2px solid #e5e7eb'}}>
                            <td colSpan={2} style={{padding:'4px 8px',fontWeight:700,fontSize:12}}>
                              PENDING · {(form.pmChecks||[]).length} CHECK{(form.pmChecks||[]).length!==1?'S':''}
                            </td>
                            <td style={{padding:'4px 8px',textAlign:'right',fontWeight:700}}>{fmtCur(pendingTotal)}</td>
                            <td></td>
                          </tr>
                        </tfoot>
                      </table>
                    )
                  }
                </div>
              </div>
            )}
          </div>
          <div className="modal-f">
            <button className="btn btn-ghost" onClick={()=>setPmModal(null)}>Cancel</button>
            <button className="btn btn-primary" onClick={()=>savePm(form)} disabled={hasCheckErrors}>
              {hasCheckErrors ? '⚠ Fix check errors' : 'Save'}
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="ps-wrap">
      <style>{CSS}</style>
      <div className="ps-topbar">
        <div>
          <h1 style={{margin:0,fontSize:18,fontWeight:900}}>Payment Schedule</h1>
          <p style={{margin:0,fontSize:12,color:'#64748b'}}>{schedules.length} expense schedule{schedules.length!==1?'s':''} · {activeLoanScheds.length} loan obligation{activeLoanScheds.length!==1?'s':''} · {activeScheds.length + activeLoanScheds.length} active</p>
        </div>
      </div>
      <div style={{padding:'10px 22px 0',flexShrink:0,background:'#fff'}}>
        {/* ── Primary KPI Scorecards ─────────────────────────────────────── */}
        <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(200px,1fr))',gap:14,marginBottom:12}}>
          <div style={{background:'linear-gradient(135deg,#0369a1 0%,#0284c7 100%)',borderRadius:14,padding:'18px 20px',color:'#fff',position:'relative',overflow:'hidden'}}>
            <div style={{position:'absolute',right:-8,top:-8,opacity:.13}}>
              <svg width="56" height="56" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg>
            </div>
            <div style={{fontSize:10,fontWeight:800,letterSpacing:'.08em',textTransform:'uppercase',opacity:.8,marginBottom:6}}>This Month Total</div>
            <div style={{fontSize:22,fontWeight:900,letterSpacing:'-.5px'}}>{fmtCur(thisMonthTotal)}</div>
            <div style={{marginTop:10,fontSize:11,opacity:.8}}>{pendingThisMonth} obligation{pendingThisMonth!==1?'s':''} due this month{loanMonthTotal>0?` · Loans: ${fmtCur(loanMonthTotal)}`:''}</div>
          </div>
          <div style={{background:'linear-gradient(135deg,#1e3a5f 0%,#1d4ed8 100%)',borderRadius:14,padding:'18px 20px',color:'#fff',position:'relative',overflow:'hidden'}}>
            <div style={{position:'absolute',right:-8,top:-8,opacity:.13}}>
              <svg width="56" height="56" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"><path d="M3 3v18h18"/><path d="M18.4 9L13 3.6 6.8 9.8 3.8 7"/></svg>
            </div>
            <div style={{fontSize:10,fontWeight:800,letterSpacing:'.08em',textTransform:'uppercase',opacity:.8,marginBottom:6}}>Annual Projection</div>
            <div style={{fontSize:22,fontWeight:900,letterSpacing:'-.5px'}}>{fmtCur(annual12mo)}</div>
            <div style={{marginTop:10,fontSize:11,opacity:.8}}>Next 12 months forecast</div>
          </div>
          <div style={{background:overdueCount>0?'linear-gradient(135deg,#991b1b 0%,#dc2626 100%)':'linear-gradient(135deg,#166534 0%,#16a34a 100%)',borderRadius:14,padding:'18px 20px',color:'#fff',position:'relative',overflow:'hidden'}}>
            <div style={{position:'absolute',right:-8,top:-8,opacity:.13}}>
              {overdueCount>0
                ? <svg width="56" height="56" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"><path d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"/></svg>
                : <svg width="56" height="56" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"><path d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>
              }
            </div>
            <div style={{fontSize:10,fontWeight:800,letterSpacing:'.08em',textTransform:'uppercase',opacity:.8,marginBottom:6}}>Overdue</div>
            <div style={{fontSize:22,fontWeight:900,letterSpacing:'-.5px'}}>{overdueCount}</div>
            <div style={{marginTop:10,fontSize:11,opacity:.8}}>{overdueCount>0?`${overdueCount} missed payment${overdueCount!==1?'s':''}`:'All payments current'}</div>
          </div>
        </div>
        {/* ── Secondary KPI Row ─────────────────────────────────────────── */}
        <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(140px,1fr))',gap:10,marginBottom:12}}>
          {[
            {label:'Pending This Month',value:pendingThisMonth,sub:'schedules due now',color:'#f97316',bg:'#fff7ed',border:'#fed7aa',icon:<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 8v4l3 3"/></svg>},
            {label:'Active Schedules',value:activeScheds.length,sub:'total active',color:'#1d4ed8',bg:'#eff6ff',border:'#bfdbfe',icon:<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"><path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2M9 12h6M9 16h4"/></svg>},
          ].map(({label,value,sub,color,bg,border,icon})=>(
            <div key={label} style={{background:bg,border:`1px solid ${border}`,borderRadius:12,padding:'14px 15px'}}>
              <div style={{display:'flex',alignItems:'center',gap:6,marginBottom:6}}>
                <span style={{color,display:'flex'}}>{icon}</span>
                <span style={{fontSize:9,fontWeight:800,color:'#64748b',letterSpacing:'.07em',textTransform:'uppercase'}}>{label}</span>
              </div>
              <div style={{fontSize:20,fontWeight:900,color,lineHeight:1}}>{value}</div>
              <div style={{fontSize:11,color:'#94a3b8',marginTop:4}}>{sub}</div>
            </div>
          ))}
        </div>
        <div className="filters">
          <input placeholder="Search title or vendor…" value={search} onChange={e=>setSearch(e.target.value)} style={{minWidth:180}} />
          <select value={filterCat} onChange={e=>setFilterCat(e.target.value)}><option value="">All Categories</option>{[...new Set([...CATEGORIES,...allCategories])].map(c=><option key={c}>{c}</option>)}</select>
          <select value={filterFreq} onChange={e=>setFilterFreq(e.target.value)}><option value="">All Frequencies</option>{FREQS.map(f=><option key={f}>{f}</option>)}</select>
          <select value={filterStatus} onChange={e=>setFilterStatus(e.target.value)}><option value="">All Statuses</option><option>Active</option><option>Cancelled</option></select>
          <select value={filterSource} onChange={e=>setFilterSource(e.target.value)} style={{fontWeight:600}}>
            <option value="all">All Sources</option>
            <option value="expenses">Expense Schedules</option>
            <option value="loans">Loan Obligations</option>
          </select>
          {(search||filterCat||filterFreq||filterStatus||filterSource!=='all')&&<button className="btn btn-ghost btn-sm" onClick={()=>{setSearch('');setFilterCat('');setFilterFreq('');setFilterStatus('');setFilterSource('all');}}>Clear</button>}
        </div>
      </div>
      <div className="ps-tabs">
        {TABS.map(t=><button key={t.key} className={`ps-tab${activeTab===t.key?' ps-tab-active':''}`} onClick={()=>setActiveTab(t.key)}>{t.label}</button>)}
      </div>
      <div className="ps-body">
        {activeTab==='list'&&<ListTab />}
        {activeTab==='paymentmethod'&&<PaymentMethodTab />}
        {activeTab==='calendar'&&<CalendarTab />}
        {activeTab==='history'&&<HistoryTab />}
      </div>
      {modal!==null&&<ScheduleModal />}
      {pmModal!==null&&<PmModal />}
      {payModal&&<RecordSchedulePaymentModal info={payModal} onClose={()=>setPayModal(null)} bankAccounts={bankAccounts} accounts={accounts} onSaved={()=>{setPayModal(null);showToast('Payment recorded.');loadLinkedVouchers();}} />}
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
      {toast&&<div className="toast">{toast}</div>}
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// Modal: record an actual payment for a recurring schedule occurrence.
// Uses the shared issueCheck helper when method === 'Check' so the
// Check Register & Checkbook Inventory remain authoritative.
// ──────────────────────────────────────────────────────────────────────────
function RecordSchedulePaymentModal({ info, onClose, bankAccounts, accounts = [], onSaved }) {
  const s = info.schedule;
  const [form, setForm] = useState({
    date:      info.dueDate || new Date().toISOString().slice(0,10),
    amount:    Number(s.amount||0).toFixed(2),
    method:    s.paymentMethod || 'Check',
    bank:      s.bankCode || s.pmCheckBank || s.pmAdaBank || s.pmBtBank || '',
    checkNo:   '',
    autoVoucher: true,
    notes:     `${s.title} — ${info.dueDate}`,
  });
  const [activeCb, setActiveCb] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err,  setErr]  = useState('');
  const upd = (k,v) => setForm(f => ({...f,[k]:v}));

  useEffect(() => {
    if (form.method !== 'Check' || !form.bank) { setActiveCb(null); return; }
    let cancel = false;
    getActiveCheckbook(form.bank).then(cb => { if(!cancel) setActiveCb(cb); }).catch(()=>setActiveCb(null));
    return () => { cancel = true; };
  }, [form.bank, form.method]);

  useEffect(() => {
    if (form.method === 'Check' && activeCb && !form.checkNo) {
      setForm(f => ({ ...f, checkNo: String(activeCb.nextCheckNumber||'') }));
    }
  }, [activeCb, form.method]); // eslint-disable-line react-hooks/exhaustive-deps

  async function save() {
    const total = Number(form.amount) || 0;
    if (!form.date) { setErr('Date required.'); return; }
    if (total <= 0) { setErr('Amount must be > 0.'); return; }
    if (form.method === 'Check' && !form.bank)  { setErr('Select a bank account.'); return; }
    if (form.method === 'Check' && !activeCb)   { setErr('No active checkbook for this bank.'); return; }
    setBusy(true); setErr('');
    try {
      // Voucher — the server assigns the CHK number and expects a resolvable
      // expense account per line, so the CV posts correctly at approval.
      let voucherDocId = '', voucherIdStr = '';
      if (form.autoVoucher) {
        const expAcct = accounts.find(a => a.code === (s.defaultExpenseAccountCode||'') || a.id === s.defaultExpenseAccountCode);
        if (!expAcct) {
          setErr('Set a Default Expense Account on the schedule (Edit → Default Expense Account) so the voucher can post — or untick "Auto-create CV".');
          setBusy(false);
          return;
        }
        const bankAcct = accounts.find(a => a.code === form.bank || a.id === form.bank);
        const created = await createVoucherDraft({
          type: 'check',
          voucherDate: form.date,
          purposeCategory: s.category || 'Scheduled Payment',
          paymentFromAccountId: bankAcct?.id || null,
          contactId: s.contactId && String(s.contactId).length === 36 ? s.contactId : null,
          notes: form.notes || null,
          meta: {
            contactSummary: s.contactName || s.title,
            linkedScheduleId: s.id,
            linkedScheduleDate: info.dueDate,
          },
          lines: [{
            accountId: expAcct.id,
            description: s.title,
            amountCents: Math.round(total * 100),
            meta: {
              contactId: s.contactId || '', contact: s.contactName || s.title,
              category: s.category || 'Other', taxType: 'N/A', taxRate: 0, taxAmt: 0,
            },
          }],
        });
        voucherDocId = created.id;
        voucherIdStr = created.voucherNo;
        await transitionVoucher(created.id, 'pending').catch(()=>{});
      }

      // Issue check
      let checkInfo = null;
      if (form.method === 'Check' && activeCb) {
        checkInfo = await issueCheck({
          bankCode:      form.bank,
          payeeName:     s.contactName || s.title,
          amount:        total,
          netAmount:     total,
          issueDate:     form.date,
          checkNumber:   form.checkNo || undefined,
          referenceType: 'Scheduled Payment',
          referenceId:   s.id,
          voucherDocId,
          notes:         form.notes,
        });
      }

      // Record schedule payment
      await schedulePaymentsApi.create({
        scheduleId: s.id,
        scheduleTitle: s.title || null,
        dueDate: info.dueDate || null,
        payDate: form.date,
        amountCents: Math.round(total * 100),
        method: form.method || null,
        bank: form.bank || null,
        checkId:         checkInfo?.checkId || null,
        checkNumber:     checkInfo?.checkNumber || form.checkNo || null,
        checkRegisterId: checkInfo?.checkRegisterId || null,
        voucherNo:    voucherIdStr || null,
        voucherDocId: voucherDocId || null,
        notes: form.notes || null,
      });

      onSaved && onSaved();
    } catch (e) {
      console.error(e);
      setErr((e instanceof ApiError ? e.detail : e.message) || 'Failed to save.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="backdrop" onClick={e => e.target===e.currentTarget && onClose()}>
      <div className="modal modal-sm">
        <div className="modal-h">
          <div>
            <strong>Record Payment</strong>
            <div style={{fontSize:11,color:'#64748b',marginTop:2}}>{s.title} · Due {info.dueDate}</div>
          </div>
          <button className="btn btn-ghost btn-sm" onClick={onClose}>✕</button>
        </div>
        <div className="modal-b">
          {form.method==='Check' && form.bank && (
            activeCb ? (
              <div style={{background:'#eff6ff',border:'1px solid #bfdbfe',borderLeft:'4px solid #1d4ed8',borderRadius:8,padding:'8px 12px',marginBottom:12,fontSize:12,color:'#1e3a8a',display:'flex',flexWrap:'wrap',gap:10}}>
                <span>📋 <strong>Active Checkbook</strong></span>
                <span>{activeCb.checkbookType}</span>
                <span>Range: <strong>{activeCb.startingNumber}–{activeCb.endingNumber}</strong></span>
                <span>Next: <strong style={{color:'#f97316'}}>{activeCb.nextCheckNumber}</strong></span>
              </div>
            ) : (
              <div style={{background:'#fff7ed',border:'1px solid #fed7aa',borderLeft:'4px solid #f97316',borderRadius:8,padding:'8px 12px',marginBottom:12,fontSize:12,color:'#9a3412'}}>
                ⚠️ No active checkbook for this bank — open Check Registry → Checkbook Management.
              </div>
            )
          )}
          <div style={{display:'grid',gridTemplateColumns:'repeat(2,1fr)',gap:10,marginBottom:12}}>
            <div style={{display:'flex',flexDirection:'column',gap:5}}>
              <label style={{fontSize:10,fontWeight:800,color:'#64748b',textTransform:'uppercase',letterSpacing:'.06em'}}>Payment Date</label>
              <input type="date" style={{border:'1px solid #e5e7eb',borderRadius:8,padding:'8px 10px',fontSize:13}} value={form.date} onChange={e=>upd('date',e.target.value)} />
            </div>
            <div style={{display:'flex',flexDirection:'column',gap:5}}>
              <label style={{fontSize:10,fontWeight:800,color:'#64748b',textTransform:'uppercase',letterSpacing:'.06em'}}>Method</label>
              <select style={{border:'1px solid #e5e7eb',borderRadius:8,padding:'8px 10px',fontSize:13}} value={form.method} onChange={e=>upd('method',e.target.value)}>
                {['Check','Bank Transfer','Auto-Debit','Cash','Online'].map(m => <option key={m}>{m}</option>)}
              </select>
            </div>
            <div style={{display:'flex',flexDirection:'column',gap:5}}>
              <label style={{fontSize:10,fontWeight:800,color:'#64748b',textTransform:'uppercase',letterSpacing:'.06em'}}>Amount ₱</label>
              <input type="number" step="0.01" style={{border:'1px solid #e5e7eb',borderRadius:8,padding:'8px 10px',fontSize:13,textAlign:'right'}} value={form.amount} onChange={e=>upd('amount',e.target.value)} />
            </div>
            <div style={{display:'flex',flexDirection:'column',gap:5}}>
              <label style={{fontSize:10,fontWeight:800,color:'#64748b',textTransform:'uppercase',letterSpacing:'.06em'}}>Bank Account</label>
              {bankAccounts.length > 0 ? (
                <select style={{border:'1px solid #e5e7eb',borderRadius:8,padding:'8px 10px',fontSize:13}} value={form.bank} onChange={e=>upd('bank',e.target.value)}>
                  <option value="">— Select —</option>
                  {bankAccounts.map(b => <option key={b.id} value={b.code||b.id}>{b.code} — {b.name}</option>)}
                </select>
              ) : (
                <input style={{border:'1px solid #e5e7eb',borderRadius:8,padding:'8px 10px',fontSize:13}} value={form.bank} onChange={e=>upd('bank',e.target.value)} placeholder="Bank account code" />
              )}
            </div>
            <div style={{display:'flex',flexDirection:'column',gap:5}}>
              <label style={{fontSize:10,fontWeight:800,color:'#64748b',textTransform:'uppercase',letterSpacing:'.06em'}}>{form.method==='Check' ? 'Check #' : 'Reference No.'}</label>
              <input style={{border:'1px solid #e5e7eb',borderRadius:8,padding:'8px 10px',fontSize:13}} value={form.checkNo} onChange={e=>upd('checkNo',e.target.value)} />
            </div>
            <div style={{display:'flex',alignItems:'flex-end',gap:8}}>
              <label style={{display:'flex',alignItems:'center',gap:6,fontSize:12,fontWeight:600,cursor:'pointer'}}>
                <input type="checkbox" checked={form.autoVoucher} onChange={e=>upd('autoVoucher',e.target.checked)} />
                Auto-create CV
              </label>
            </div>
          </div>
          <div style={{display:'flex',flexDirection:'column',gap:5,marginBottom:8}}>
            <label style={{fontSize:10,fontWeight:800,color:'#64748b',textTransform:'uppercase',letterSpacing:'.06em'}}>Notes</label>
            <input style={{border:'1px solid #e5e7eb',borderRadius:8,padding:'8px 10px',fontSize:13}} value={form.notes} onChange={e=>upd('notes',e.target.value)} />
          </div>
          {err && <div style={{marginTop:10,padding:'8px 12px',background:'#fef2f2',border:'1px solid #fecaca',color:'#b91c1c',borderRadius:8,fontSize:12,fontWeight:600}}>{err}</div>}
        </div>
        <div className="modal-f">
          <button className="btn btn-ghost" onClick={onClose} disabled={busy}>Cancel</button>
          <button className="btn btn-primary" onClick={save} disabled={busy}>{busy?'Saving…':'Record Payment'}</button>
        </div>
      </div>
    </div>
  );
}

import { useState, useEffect, useMemo } from 'react';
import {
  collection, query, orderBy, onSnapshot, addDoc, updateDoc, deleteDoc,
  doc, serverTimestamp, writeBatch, getDocs,
} from 'firebase/firestore';
import { db, auth } from '../../../firebase.js';
import AccountCombobox from '../../../components/AccountCombobox.jsx';
import ContactPicker from '../../../components/ContactPicker.jsx';
import { nextCheckVoucherId } from '../../../utils/documentIds.js';

// ── Constants ─────────────────────────────────────────────────────────────────
const CHECKBOOK_TYPES = ['Regular', 'Business', 'Payroll', 'Manager'];
const CHECK_STATUSES  = ['Issued', 'Cleared', 'Voided', 'Stopped', 'Stale'];

const STATUS_STYLES = {
  Issued:  { background:'#eff6ff', borderColor:'#bfdbfe', color:'#1d4ed8' },
  Cleared: { background:'#f0fdf4', borderColor:'#bbf7d0', color:'#15803d' },
  Voided:  { background:'#fef2f2', borderColor:'#fecaca', color:'#b91c1c' },
  Stopped: { background:'#fff7ed', borderColor:'#fed7aa', color:'#c2410c' },
  Stale:   { background:'#f8fafc', borderColor:'#e2e8f0', color:'#64748b' },
};

const PURPOSE_SUGGESTIONS = [
  'Bills Payment', 'Rent', 'Utilities', 'Professional Fees', 'Office Supplies',
  'Transportation', 'Representation', 'Taxes & Licenses', 'Contractor Payment', 'Supplier Payment',
];

const uid   = () => Math.random().toString(36).slice(2, 10).toUpperCase();
const today = () => new Date().toISOString().slice(0, 10);
const fmt   = n => new Intl.NumberFormat('en-PH', { style:'currency', currency:'PHP' }).format(n || 0);
const fmtN  = n => new Intl.NumberFormat('en-PH', { minimumFractionDigits:2, maximumFractionDigits:2 }).format(n || 0);

const EMPTY_LINE = () => ({
  id: uid(),
  contactId:'', contact:'', expenseAccount:'', description:'',
  amount:'', taxRateId:'', taxType:'N/A', taxRate:0, taxAmt:0, inclusive:false,
  lineCheckNo:'', lineCheckDate:'',
});

const CSS = `
  .cr-wrap    { display:flex; flex-direction:column; height:100%; overflow:hidden; font-family:Inter,system-ui,sans-serif; background:#f8fafc; }
  .cr-topbar  { display:flex; align-items:center; justify-content:space-between; padding:14px 22px 10px; flex-shrink:0; border-bottom:1px solid #e5e7eb; background:#fff; gap:12px; flex-wrap:wrap; }
  .cr-tabs    { display:flex; background:#fff; border-bottom:2px solid #e5e7eb; flex-shrink:0; }
  .cr-tab     { padding:10px 16px; font-size:12px; font-weight:600; border:none; background:transparent; color:#64748b; cursor:pointer; white-space:nowrap; border-bottom:2px solid transparent; margin-bottom:-2px; font-family:inherit; }
  .cr-tab:hover { color:#0b1220; }
  .cr-tab-active { color:#f97316; border-bottom-color:#f97316; font-weight:800; }
  .cr-body    { flex:1; overflow-y:auto; padding:16px 22px; }
  .kpi-row    { display:grid; grid-template-columns:repeat(5,1fr); gap:10px; margin-bottom:16px; }
  .kpi        { background:#fff; border:1px solid #e5e7eb; border-radius:12px; padding:12px 14px; }
  .kpi-lbl    { font-size:9px; font-weight:800; color:#94a3b8; letter-spacing:.07em; text-transform:uppercase; margin-bottom:3px; }
  .kpi-val    { font-size:20px; font-weight:900; }
  .filters    { display:flex; gap:8px; flex-wrap:wrap; margin-bottom:12px; align-items:center; }
  .filters input,.filters select { border:1px solid #e5e7eb; border-radius:10px; padding:7px 10px; font-size:12px; background:#fff; font-family:inherit; }
  .btn        { border:0; border-radius:10px; padding:9px 16px; font-weight:700; cursor:pointer; font-size:13px; font-family:inherit; transition:opacity .15s; }
  .btn:disabled { opacity:.5; cursor:not-allowed; }
  .btn-primary { background:#f97316; color:#fff; }
  .btn-ghost  { background:#f1f5f9; color:#0b1220; }
  .btn-ghost:hover { background:#e2e8f0; }
  .btn-danger { background:#ef4444; color:#fff; }
  .btn-sm     { padding:6px 12px; font-size:12px; }
  .btn-xs     { padding:4px 8px; font-size:11px; border-radius:8px; }
  table       { width:100%; border-collapse:collapse; }
  th,td       { padding:9px 10px; border-bottom:1px solid #f1f5f9; font-size:12px; text-align:left; }
  th          { color:#64748b; font-weight:800; font-size:10px; letter-spacing:.05em; text-transform:uppercase; background:#f8fafc; position:sticky; top:0; z-index:1; }
  tr:hover td { background:#fafafa; }
  tr:last-child td { border-bottom:none; }
  tfoot td    { background:#f8fafc; font-weight:900; border-top:2px solid #e5e7eb; }
  .pill       { display:inline-block; padding:3px 9px; border-radius:999px; font-size:11px; font-weight:700; border:1px solid; white-space:nowrap; }
  .empty      { padding:48px; text-align:center; color:#94a3b8; font-size:13px; }
  .backdrop   { position:fixed; inset:0; background:rgba(15,23,42,.45); display:flex; align-items:center; justify-content:center; padding:16px; z-index:100; }
  .modal      { width:min(1000px,98vw); max-height:92vh; background:#fff; border-radius:16px; display:flex; flex-direction:column; overflow:hidden; box-shadow:0 24px 64px rgba(0,0,0,.25); }
  .modal-sm   { width:min(480px,98vw); }
  .modal-h    { display:flex; align-items:center; justify-content:space-between; padding:16px 20px; border-bottom:1px solid #e5e7eb; background:#f8fafc; flex-shrink:0; }
  .modal-h strong { font-size:15px; font-weight:900; }
  .modal-b    { padding:20px; overflow-y:auto; flex:1; }
  .modal-f    { display:flex; justify-content:flex-end; gap:10px; padding:14px 20px; border-top:1px solid #e5e7eb; background:#fff; flex-shrink:0; }
  .grid6      { display:grid; grid-template-columns:repeat(6,1fr); gap:10px; margin-bottom:12px; }
  .col2       { grid-column:span 2; }
  .col3       { grid-column:span 3; }
  .col4       { grid-column:span 4; }
  .col6       { grid-column:span 6; }
  .field      { display:flex; flex-direction:column; gap:5px; }
  .field label { font-size:10px; font-weight:800; color:#64748b; letter-spacing:.06em; text-transform:uppercase; }
  .field input,.field select,.field textarea { width:100%; border:1px solid #e5e7eb; border-radius:10px; padding:9px 10px; font-size:13px; background:#fff; font-family:inherit; box-sizing:border-box; }
  .sec-title  { font-size:11px; font-weight:800; color:#94a3b8; letter-spacing:.07em; text-transform:uppercase; margin:16px 0 8px; border-bottom:1px solid #f1f5f9; padding-bottom:6px; }
  .lines-tbl  { font-size:12px; margin-bottom:8px; }
  .lines-tbl th,.lines-tbl td { border-bottom:1px solid #f1f5f9; padding:7px 8px; }
  .lines-tbl td input,.lines-tbl td select { width:100%; border:1px solid #e5e7eb; border-radius:8px; padding:6px 8px; font-size:12px; font-family:inherit; }
  .tfoot-row  { display:flex; justify-content:flex-end; gap:20px; padding:10px 16px; background:#f8fafc; border-top:2px solid #e5e7eb; font-size:13px; font-weight:700; flex-wrap:wrap; }
  .cb-banner  { background:#eff6ff; border:1px solid #bfdbfe; border-radius:10px; padding:10px 14px; margin-bottom:12px; font-size:12px; display:flex; align-items:center; gap:10px; flex-wrap:wrap; }
  .info-banner { background:#fff7ed; border:1px solid #fed7aa; border-radius:10px; padding:10px 14px; margin-bottom:10px; font-size:12px; color:#92400e; }
  .jnl-tbl    { width:100%; border-collapse:collapse; font-size:12px; background:#f8fafc; border-radius:10px; overflow:hidden; }
  .jnl-tbl th,.jnl-tbl td { padding:8px 12px; border-bottom:1px solid #e5e7eb; }
  .jnl-tbl th { background:#f1f5f9; font-size:10px; color:#64748b; text-transform:uppercase; letter-spacing:.05em; }
  .jnl-tbl tfoot td { background:#f1f5f9; font-weight:800; border-top:2px solid #e2e8f0; }
  .toast      { position:fixed; right:16px; bottom:16px; background:#0b1220; color:#fff; padding:12px 18px; border-radius:12px; font-size:13px; font-weight:600; z-index:999; }
  @media(max-width:640px) { .kpi-row{grid-template-columns:repeat(3,1fr);} }
`;

export default function CheckRegistryPage() {
  // ── State ──────────────────────────────────────────────────────────────────
  const [checks,     setChecks]     = useState([]);
  const [checkbooks, setCheckbooks] = useState([]);
  const [accounts,   setAccounts]   = useState([]);
  const [contacts,   setContacts]   = useState([]);
  const [taxRates,   setTaxRates]   = useState([]);
  const [taxGroups,  setTaxGroups]  = useState([]);
  const [vouchers,   setVouchers]   = useState([]);

  const [activeTab,    setActiveTab]    = useState('register');
  const [cvModal,      setCvModal]      = useState(null);
  const [cbModal,      setCbModal]      = useState(null);
  const [statusModal,  setStatusModal]  = useState(null);
  const [confirmModal, setConfirmModal] = useState(null);

  const [filterBank,   setFilterBank]   = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [search,       setSearch]       = useState('');
  const [dateFrom,     setDateFrom]     = useState('');
  const [dateTo,       setDateTo]       = useState('');
  const [periodPreset, setPeriodPreset] = useState(''); // '', 'week', 'month', 'year'
  const [analyticsBucket, setAnalyticsBucket] = useState('month'); // 'week' | 'month' | 'year'
  const [analyticsBank,   setAnalyticsBank]   = useState('');
  const [saving,       setSaving]       = useState(false);
  const [toast,        setToast]        = useState('');

  // Check Voucher form state
  const [cvForm,  setCvForm]  = useState({});
  const [cvLines, setCvLines] = useState([EMPTY_LINE()]);

  const showToast  = msg => { setToast(msg); setTimeout(() => setToast(''), 3200); };
  const askConfirm = (message, onConfirm) => setConfirmModal({ message, onConfirm });
  const user = auth.currentUser?.email || '';

  // ── Live Data ──────────────────────────────────────────────────────────────
  useEffect(() => {
    const u1 = onSnapshot(query(collection(db,'checkRegister'),   orderBy('issueDate','desc')), snap => setChecks(snap.docs.map(d => ({ id:d.id, ...d.data() }))));
    const u2 = onSnapshot(query(collection(db,'checkbookMaster'), orderBy('bankCode','asc')),   snap => setCheckbooks(snap.docs.map(d => ({ id:d.id, ...d.data() }))));
    const u3 = onSnapshot(query(collection(db,'vouchers'),         orderBy('createdAt','desc')), snap => setVouchers(snap.docs.map(d => ({ id:d.id, ...d.data() }))));
    const u4 = onSnapshot(query(collection(db,'taxRates'),  orderBy('name')), snap => setTaxRates(snap.docs.map(d => ({ id:d.id, ...d.data() })).filter(r => r.isActive !== false)));
    const u5 = onSnapshot(query(collection(db,'taxGroups'), orderBy('name')), snap => setTaxGroups(snap.docs.map(d => ({ id:d.id, ...d.data() })).filter(g => g.isActive !== false)));
    getDocs(collection(db,'accounts')).then(s => setAccounts(s.docs.map(d => ({ id:d.id, ...d.data() }))));
    const u6 = onSnapshot(query(collection(db,'contacts'), orderBy('name')), snap => setContacts(snap.docs.map(d => ({ id:d.id, ...d.data() }))));
    return () => { u1(); u2(); u3(); u4(); u5(); u6(); };
  }, []);

  // ── Derived ────────────────────────────────────────────────────────────────
  // Unified tax registry: individual rates + groups (with effective aggregate rate)
  const taxRegistry = useMemo(() => {
    const rateItems = taxRates.map(r => ({ id: r.id, name: r.name, rate: r.rate || 0, kind: 'rate' }));
    const groupItems = taxGroups.map(g => {
      const effRate = (g.rateNames || []).reduce((sum, rn) => {
        const r = taxRates.find(r2 => r2.name.toLowerCase() === rn.toLowerCase());
        return sum + (r?.rate || 0);
      }, 0);
      return { id: g.id, name: g.name, rate: effRate, kind: 'group' };
    });
    return [...rateItems, ...groupItems].sort((a,b) => a.name.localeCompare(b.name));
  }, [taxRates, taxGroups]);

  const bankAccounts = useMemo(() =>
    accounts.filter(a =>
      ['Bank','Cash Equivalents','Cash','Cash and Cash Equivalents'].includes(a.subType) ||
      (a.name||'').toLowerCase().includes('cash in bank')
    ), [accounts]
  );

  const activeCheckbook = (bankCode) =>
    checkbooks.find(cb => cb.bankCode === bankCode && cb.isActive !== false) || null;

  const genCheckId = (checkNumber) => {
    const d = new Date();
    const yyyyMMdd = `${d.getFullYear()}${String(d.getMonth()+1).padStart(2,'0')}${String(d.getDate()).padStart(2,'0')}`;
    return `CHK-${yyyyMMdd}-${checkNumber}`;
  };

  // KPIs
  const countsByStatus = {};
  CHECK_STATUSES.forEach(s => { countsByStatus[s] = checks.filter(c => c.status === s).length; });
  const totalIssued = checks.filter(c => c.status === 'Issued').reduce((s,c) => s + (parseFloat(c.amount)||0), 0);

  // Apply preset to date range whenever it changes
  useEffect(() => {
    if (!periodPreset) return;
    const now = new Date();
    if (periodPreset === 'week') {
      const day = now.getDay(); // 0=Sun
      const start = new Date(now); start.setDate(now.getDate() - day);
      const end   = new Date(start); end.setDate(start.getDate() + 6);
      setDateFrom(start.toISOString().slice(0,10));
      setDateTo(end.toISOString().slice(0,10));
    } else if (periodPreset === 'month') {
      const start = new Date(now.getFullYear(), now.getMonth(), 1);
      const end   = new Date(now.getFullYear(), now.getMonth()+1, 0);
      setDateFrom(start.toISOString().slice(0,10));
      setDateTo(end.toISOString().slice(0,10));
    } else if (periodPreset === 'year') {
      setDateFrom(`${now.getFullYear()}-01-01`);
      setDateTo(`${now.getFullYear()}-12-31`);
    }
  }, [periodPreset]);

  // Filtered checks
  const filtered = useMemo(() => checks.filter(c => {
    if (filterBank   && c.bankCode !== filterBank)   return false;
    if (filterStatus && c.status   !== filterStatus) return false;
    if (dateFrom && (c.issueDate||'') < dateFrom) return false;
    if (dateTo   && (c.issueDate||'') > dateTo)   return false;
    if (search) {
      const q = search.toLowerCase();
      if (!((String(c.checkNumber||'')).toLowerCase().includes(q) ||
            (c.payeeName||'').toLowerCase().includes(q)           ||
            (c.referenceId||'').toLowerCase().includes(q)         ||
            (c.checkId||'').toLowerCase().includes(q))) return false;
    }
    return true;
  }), [checks, filterBank, filterStatus, search, dateFrom, dateTo]);

  // Outstanding aging buckets (Issued only, by days since issueDate)
  const aging = useMemo(() => {
    const buckets = { '0-30':{n:0,a:0}, '31-60':{n:0,a:0}, '61-90':{n:0,a:0}, '90+':{n:0,a:0} };
    const now = new Date();
    checks.filter(c => c.status === 'Issued').forEach(c => {
      const d = new Date(c.issueDate); if (isNaN(d)) return;
      const days = Math.floor((now - d) / 86400000);
      const amt  = parseFloat(c.amount) || 0;
      const k = days <= 30 ? '0-30' : days <= 60 ? '31-60' : days <= 90 ? '61-90' : '90+';
      buckets[k].n += 1; buckets[k].a += amt;
    });
    return buckets;
  }, [checks]);

  // Time-series buckets for analytics tab
  function bucketKey(dateStr, bucket) {
    if (!dateStr) return '';
    const d = new Date(dateStr); if (isNaN(d)) return '';
    if (bucket === 'year')  return String(d.getFullYear());
    if (bucket === 'month') return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
    // week (ISO-ish: YYYY-Www, week starts Sunday for simplicity)
    const onejan = new Date(d.getFullYear(), 0, 1);
    const wk = Math.ceil(((d - onejan) / 86400000 + onejan.getDay() + 1) / 7);
    return `${d.getFullYear()}-W${String(wk).padStart(2,'0')}`;
  }
  const series = useMemo(() => {
    const map = new Map(); // key -> { issuedN, issuedA, clearedN, clearedA, voidedN, voidedA }
    checks.forEach(c => {
      if (analyticsBank && c.bankCode !== analyticsBank) return;
      const k = bucketKey(c.issueDate, analyticsBucket);
      if (!k) return;
      if (!map.has(k)) map.set(k, { key:k, issuedN:0, issuedA:0, clearedN:0, clearedA:0, voidedN:0, voidedA:0 });
      const row = map.get(k);
      const amt = parseFloat(c.amount) || 0;
      row.issuedN += 1; row.issuedA += amt;
      if (c.status === 'Cleared') { row.clearedN += 1; row.clearedA += amt; }
      if (c.status === 'Voided')  { row.voidedN  += 1; row.voidedA  += amt; }
    });
    return [...map.values()].sort((a,b) => b.key.localeCompare(a.key));
  }, [checks, analyticsBucket, analyticsBank]);

  // ── Line helpers ───────────────────────────────────────────────────────────
  const setLine = (i, key, val) => setCvLines(prev => prev.map((l, idx) => {
    if (idx !== i) return l;
    const updated = { ...l, [key]: val };
    if (key === 'taxRateId') {
      const item = taxRegistry.find(r => r.id === val);
      if (item) { updated.taxType = item.name; updated.taxRate = item.rate || 0; }
      else       { updated.taxType = 'N/A'; updated.taxRate = 0; }
    }
    const amt  = Number(updated.amount) || 0;
    const rate = Number(updated.taxRate) || 0;
    updated.taxAmt = updated.taxRateId
      ? Math.round((updated.inclusive ? amt - amt/(1 + rate/100) : amt*(rate/100)) * 100) / 100
      : 0;
    return updated;
  }));
  const addLine    = ()  => setCvLines(prev => [...prev, EMPTY_LINE()]);
  const removeLine = (i) => setCvLines(prev => prev.filter((_,idx) => idx !== i));

  const lineTotal = cvLines.reduce((s,l) => s + (Number(l.amount)||0), 0);
  const taxTotal  = cvLines.reduce((s,l) => s + (Number(l.taxAmt)||0),  0);
  const netCash   = lineTotal - taxTotal;

  const journalLines = useMemo(() => {
    const jl = [];

    // Format account as "(code) Name"
    const acctLabel = (codeOrFull, fallback = '—') => {
      if (!codeOrFull) return fallback;
      if (codeOrFull.includes(' — ')) {
        const [c, ...rest] = codeOrFull.split(' — ');
        return `(${c.trim()}) ${rest.join(' — ').trim()}`;
      }
      const found = accounts.find(a => a.code === codeOrFull);
      return found ? `(${found.code}) ${found.name}` : codeOrFull;
    };

    // Check Vouchers are purchases → use taxAccountPurchases for separate tracking
    const taxRateLabel = (rateDoc) => {
      const raw = rateDoc.trackingType === 'separate'
        ? (rateDoc.taxAccountPurchases || rateDoc.taxAccountSingle || '')
        : (rateDoc.taxAccountSingle || '');
      return raw ? acctLabel(raw) : `Tax — ${rateDoc.name}`;
    };

    let bankCreditTotal = 0;

    cvLines.forEach(l => {
      const amt = Number(l.amount) || 0;
      const tax = Number(l.taxAmt)  || 0;
      if (!amt) return;

      // 1. Expense debit (net of inclusive tax)
      const expAmt = (tax > 0 && l.inclusive) ? amt - tax : amt;
      if (l.expenseAccount) {
        jl.push({ account: acctLabel(l.expenseAccount), debit: expAmt, credit: 0 });
      }

      // 2. Tax debit lines (purchase = input tax)
      if (tax > 0 && l.taxRateId) {
        const rateDoc = taxRates.find(r => r.id === l.taxRateId);
        if (rateDoc) {
          jl.push({ account: taxRateLabel(rateDoc), debit: tax, credit: 0 });
        } else {
          // Tax group — split pro-rata across constituent rates
          const groupDoc = taxGroups.find(g => g.id === l.taxRateId);
          if (groupDoc?.rateNames?.length) {
            const effectiveRate = groupDoc.rateNames.reduce((s, rn) => {
              const r = taxRates.find(x => x.name === rn);
              return s + (r?.rate || 0);
            }, 0);
            groupDoc.rateNames.forEach(rn => {
              const r = taxRates.find(x => x.name === rn);
              if (!r) return;
              const share = effectiveRate > 0
                ? Math.round((r.rate / effectiveRate) * tax * 100) / 100
                : Math.round(tax / groupDoc.rateNames.length * 100) / 100;
              jl.push({ account: taxRateLabel(r), debit: share, credit: 0 });
            });
          } else {
            jl.push({ account: `Tax — ${l.taxType || 'Unknown'}`, debit: tax, credit: 0 });
          }
        }
      }

      // 3. Bank credit: gross amount paid
      bankCreditTotal += l.inclusive ? amt : amt + tax;
    });

    // 4. Bank / Cash credit
    const bankAcct = bankAccounts.find(a => a.code === cvForm.bankCode || a.id === cvForm.bankCode);
    const bankLabel = bankAcct
      ? acctLabel(`${bankAcct.code} — ${bankAcct.name}`)
      : (cvForm.bankCode || 'Bank / Cash');
    if (bankCreditTotal > 0) jl.push({ account: bankLabel, debit: 0, credit: bankCreditTotal });

    return jl;
  }, [cvLines, cvForm.bankCode, bankAccounts, taxRates, taxGroups, accounts]);

  const jDebit  = journalLines.reduce((s,j) => s+j.debit,  0);
  const jCredit = journalLines.reduce((s,j) => s+j.credit, 0);

  // ── Open Check Voucher modal ───────────────────────────────────────────────
  const openNewCv = () => {
    const defaultBank = bankAccounts[0]?.code || bankAccounts[0]?.id || '';
    const cb = activeCheckbook(defaultBank);
    setCvForm({ bankCode:defaultBank, issueDate:today(), purposeCategory:'', isMultipleChecks:false, globalCheckNo:cb?.nextCheckNumber||'', globalCheckDate:today(), notes:'' });
    setCvLines([EMPTY_LINE()]);
    setCvModal({ _new:true });
  };

  // ── Create Check Voucher ───────────────────────────────────────────────────
  const createCheckVoucher = async () => {
    if (!cvForm.bankCode)  return alert('Select a bank account.');
    if (!cvForm.issueDate) return alert('Issue date is required.');
    if (!cvForm.isMultipleChecks && !String(cvForm.globalCheckNo||'').trim()) return alert('Check number is required.');
    if (!(lineTotal > 0))  return alert('Total amount must be greater than zero.');
    if (cvLines.some(l => !l.expenseAccount)) return alert('All lines need an account (COA).');

    const cb = activeCheckbook(cvForm.bankCode);
    if (!cb) return alert('No active checkbook for this bank. Please create one in Checkbook Management first.');

    const end   = parseInt(cb.endingNumber)   || 0;
    const start = parseInt(cb.startingNumber) || 0;
    const next  = parseInt(cb.nextCheckNumber) || start;
    let assignedCheckNo = cvForm.isMultipleChecks
      ? next
      : (parseInt(cvForm.globalCheckNo) || next);

    if (assignedCheckNo > end) return alert(`Checkbook exhausted (all checks up to #${end} used). Create a new checkbook.`);

    setSaving(true);
    try {
      const voucherId    = await nextCheckVoucherId(cvForm.issueDate);
      const checkId      = genCheckId(assignedCheckNo);
      const payeeSummary = [...new Set(cvLines.map(l => l.contact).filter(Boolean))].join(', ') || cvForm.purposeCategory || '';

      const linesPayload = cvLines.map((l, i) => ({
        lineNo:             i + 1,
        contactId:          l.contactId || '',
        contact:            l.contact,
        expenseAccountCode: l.expenseAccount,
        description:        l.description,
        amount:             Number(l.amount) || 0,
        taxRateId:          l.taxRateId  || '',
        taxType:            l.taxType    || 'N/A',
        taxRate:            Number(l.taxRate) || 0,
        taxAmt:             Number(l.taxAmt)  || 0,
        inclusive:          !!l.inclusive,
        lineCheckNo:   cvForm.isMultipleChecks ? (l.lineCheckNo||'')   : String(assignedCheckNo),
        lineCheckDate: cvForm.isMultipleChecks ? (l.lineCheckDate||'') : (cvForm.globalCheckDate||cvForm.issueDate||''),
      }));

      const batch      = writeBatch(db);
      const voucherRef = doc(collection(db, 'vouchers'));
      const checkRef   = doc(collection(db, 'checkRegister'));

      batch.set(voucherRef, {
        voucherId, voucherType:'CHECK',
        preparationDate:        cvForm.issueDate,
        purposeCategory:        cvForm.purposeCategory || '',
        paymentFromAccountCode: cvForm.bankCode,
        contactSummary:         payeeSummary,
        totalAmount:            lineTotal, taxTotal, netCash,
        status:                 'Pending',
        isMultipleChecks:       !!cvForm.isMultipleChecks,
        checkNumber:            cvForm.isMultipleChecks ? '' : String(assignedCheckNo),
        checkDate:              cvForm.isMultipleChecks ? '' : (cvForm.globalCheckDate||cvForm.issueDate),
        notes:                  cvForm.notes || '',
        lines:                  linesPayload,
        checkId, referenceType: 'Check Voucher',
        createdAt:serverTimestamp(), createdBy:user,
        updatedAt:serverTimestamp(), updatedBy:user,
      });

      batch.set(checkRef, {
        checkId, checkbookId:cb.id, bankCode:cvForm.bankCode,
        checkNumber:   cvForm.isMultipleChecks ? 'Multiple' : String(assignedCheckNo),
        issueDate:     cvForm.issueDate,
        payeeName:     payeeSummary,
        amount:        lineTotal, netAmount:netCash,
        status:        'Issued',
        referenceType: 'Check Voucher',
        referenceId:   voucherId,
        voucherDocId:  voucherRef.id,
        voidReason:'', clearedDate:'', voidedDate:'', stoppedDate:'', staleDate:'',
        notes:         cvForm.notes || '',
        createdAt:serverTimestamp(), createdBy:user,
        updatedAt:serverTimestamp(), updatedBy:user,
      });

      await batch.commit();

      // Advance checkbook next check number
      await updateDoc(doc(db,'checkbookMaster',cb.id), {
        nextCheckNumber: String(assignedCheckNo + 1).padStart(String(end).length, '0'),
        updatedAt:serverTimestamp(), updatedBy:user,
      });

      showToast(`Check Voucher ${voucherId} created · Check #${cvForm.isMultipleChecks ? 'Multiple' : assignedCheckNo}`);
      setCvModal(null);
    } catch(e) { console.error(e); alert('Error: ' + e.message); }
    setSaving(false);
  };

  // ── Update check status (with linked voucher side effect) ─────────────────
  const updateStatus = async (form) => {
    if (!form.status || form.status === statusModal.status) return alert('Select a new status.');
    if (form.status === 'Voided' && !form.voidReason) return alert('Void reason is required.');
    setSaving(true);
    try {
      const patch = { status:form.status, updatedAt:serverTimestamp(), updatedBy:user };
      if (form.status === 'Cleared') patch.clearedDate = form.clearedDate || today();
      if (form.status === 'Voided')  { patch.voidedDate = today(); patch.voidReason = form.voidReason; }
      if (form.status === 'Stopped') patch.stoppedDate = form.stoppedDate || today();
      if (form.status === 'Stale')   patch.staleDate   = form.staleDate   || today();
      await updateDoc(doc(db,'checkRegister',form.id), patch);

      // GAS updateCheckStatus side effects: Cleared→voucher Paid, Voided→voucher Pending
      if (form.voucherDocId) {
        if (form.status === 'Cleared') await updateDoc(doc(db,'vouchers',form.voucherDocId), { status:'Paid',    updatedAt:serverTimestamp(), updatedBy:user });
        if (form.status === 'Voided')  await updateDoc(doc(db,'vouchers',form.voucherDocId), { status:'Pending', updatedAt:serverTimestamp(), updatedBy:user });
      }

      setStatusModal(null);
      showToast(`Check status updated to ${form.status}.`);
    } catch(e) { console.error(e); alert('Update failed: ' + e.message); }
    setSaving(false);
  };

  // ── Save checkbook (one-active-per-bank enforcement) ──────────────────────
  const saveCheckbook = async (form) => {
    if (!form.bankCode)       return alert('Select a bank.');
    if (!form.startingNumber) return alert('Starting number required.');
    if (!form.endingNumber)   return alert('Ending number required.');
    setSaving(true);
    try {
      const payload = {
        bankCode:form.bankCode, checkbookType:form.checkbookType||'Regular',
        startingNumber:form.startingNumber, endingNumber:form.endingNumber,
        nextCheckNumber:form.nextCheckNumber||form.startingNumber,
        isActive:form.isActive!==false, notes:form.notes||'',
        updatedAt:serverTimestamp(), updatedBy:user,
      };
      // Enforce one-active-per-bank
      if (payload.isActive) {
        const others = checkbooks.filter(cb => cb.bankCode === form.bankCode && cb.id !== form.id);
        await Promise.all(others.map(cb => updateDoc(doc(db,'checkbookMaster',cb.id), { isActive:false, updatedAt:serverTimestamp(), updatedBy:user })));
      }
      if (form.id) await updateDoc(doc(db,'checkbookMaster',form.id), payload);
      else await addDoc(collection(db,'checkbookMaster'), { ...payload, createdAt:serverTimestamp(), createdBy:user });
      setCbModal(null);
      showToast('Checkbook saved.');
    } catch(e) { console.error(e); alert('Save failed: ' + e.message); }
    setSaving(false);
  };

  // ── Flag stale checks ─────────────────────────────────────────────────────
  const flagStaleChecks = async () => {
    const cutoff = new Date(); cutoff.setDate(cutoff.getDate() - 180);
    const stale = checks.filter(c => { if (c.status !== 'Issued') return false; const d = new Date(c.issueDate); return !isNaN(d) && d < cutoff; });
    if (!stale.length) { showToast('No stale checks found.'); return; }
    askConfirm(`Mark ${stale.length} check(s) issued before ${cutoff.toLocaleDateString()} as Stale?`, async () => {
      await Promise.all(stale.map(c => updateDoc(doc(db,'checkRegister',c.id), { status:'Stale', staleDate:today(), updatedAt:serverTimestamp(), updatedBy:user })));
      showToast(`${stale.length} check(s) flagged as Stale.`);
    });
  };

  const deleteCheck = (id) => {
    askConfirm('Delete this check entry? This cannot be undone.', async () => {
      await deleteDoc(doc(db,'checkRegister',id));
      showToast('Check entry deleted.');
    });
  };

  // ══ Tab: Check Register ════════════════════════════════════════════════════
  function RegisterTab() {
    return (
      <div>
        {/* ── Primary KPI Scorecards ─────────────────────────────────────── */}
        <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(200px,1fr))',gap:14,marginBottom:12}}>
          <div style={{background:'linear-gradient(135deg,#0369a1 0%,#0284c7 100%)',borderRadius:14,padding:'18px 20px',color:'#fff',position:'relative',overflow:'hidden'}}>
            <div style={{position:'absolute',right:-8,top:-8,opacity:.13}}>
              <svg width="56" height="56" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg>
            </div>
            <div style={{fontSize:10,fontWeight:800,letterSpacing:'.08em',textTransform:'uppercase',opacity:.8,marginBottom:6}}>Issued</div>
            <div style={{fontSize:22,fontWeight:900,letterSpacing:'-.5px'}}>{countsByStatus['Issued']||0}</div>
            <div style={{marginTop:10,fontSize:11,opacity:.8}}>Outstanding: {fmt(totalIssued)}</div>
          </div>
          <div style={{background:'linear-gradient(135deg,#166534 0%,#16a34a 100%)',borderRadius:14,padding:'18px 20px',color:'#fff',position:'relative',overflow:'hidden'}}>
            <div style={{position:'absolute',right:-8,top:-8,opacity:.13}}>
              <svg width="56" height="56" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"><path d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>
            </div>
            <div style={{fontSize:10,fontWeight:800,letterSpacing:'.08em',textTransform:'uppercase',opacity:.8,marginBottom:6}}>Cleared</div>
            <div style={{fontSize:22,fontWeight:900,letterSpacing:'-.5px'}}>{countsByStatus['Cleared']||0}</div>
            {(() => { const pct = checks.length > 0 ? Math.round((countsByStatus['Cleared']||0)/checks.length*100) : 0; return (
              <div style={{marginTop:10}}><div style={{height:4,background:'rgba(255,255,255,.25)',borderRadius:99,marginBottom:5}}><div style={{height:'100%',width:`${pct}%`,background:'#fff',borderRadius:99}}/></div><div style={{fontSize:11,opacity:.8}}>{pct}% of all checks</div></div>
            ); })()}
          </div>
          <div style={{background:'linear-gradient(135deg,#991b1b 0%,#dc2626 100%)',borderRadius:14,padding:'18px 20px',color:'#fff',position:'relative',overflow:'hidden'}}>
            <div style={{position:'absolute',right:-8,top:-8,opacity:.13}}>
              <svg width="56" height="56" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><path d="M15 9l-6 6M9 9l6 6"/></svg>
            </div>
            <div style={{fontSize:10,fontWeight:800,letterSpacing:'.08em',textTransform:'uppercase',opacity:.8,marginBottom:6}}>Voided</div>
            <div style={{fontSize:22,fontWeight:900,letterSpacing:'-.5px'}}>{countsByStatus['Voided']||0}</div>
            <div style={{marginTop:10,fontSize:11,opacity:.8}}>Cancelled checks</div>
          </div>
          <div style={{background:'linear-gradient(135deg,#c2410c 0%,#ea580c 100%)',borderRadius:14,padding:'18px 20px',color:'#fff',position:'relative',overflow:'hidden'}}>
            <div style={{position:'absolute',right:-8,top:-8,opacity:.13}}>
              <svg width="56" height="56" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"><path d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"/></svg>
            </div>
            <div style={{fontSize:10,fontWeight:800,letterSpacing:'.08em',textTransform:'uppercase',opacity:.8,marginBottom:6}}>Stopped</div>
            <div style={{fontSize:22,fontWeight:900,letterSpacing:'-.5px'}}>{countsByStatus['Stopped']||0}</div>
            <div style={{marginTop:10,fontSize:11,opacity:.8}}>Payment halted</div>
          </div>
        </div>
        {/* ── Secondary KPI Row ─────────────────────────────────────────── */}
        <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(140px,1fr))',gap:10,marginBottom:16}}>
          {[
            {label:'Total Checks',value:checks.length,sub:`${filtered.length} matching filters`,color:'#1d4ed8',bg:'#eff6ff',border:'#bfdbfe',icon:<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"><path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2M9 12h6M9 16h4"/></svg>},
            {label:'Stale',value:countsByStatus['Stale']||0,sub:'outstanding too long',color:'#64748b',bg:'#f8fafc',border:'#e2e8f0',icon:<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 8v4l3 3"/></svg>},
            {label:'Checkbooks',value:checkbooks.length,sub:'registered accounts',color:'#0369a1',bg:'#f0f9ff',border:'#bae6fd',icon:<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"><path d="M4 19.5A2.5 2.5 0 016.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 014 19.5v-15A2.5 2.5 0 016.5 2z"/></svg>},
            {label:'Outstanding',value:fmt(totalIssued),sub:'from issued checks',color:'#c2410c',bg:'#fff7ed',border:'#fed7aa',icon:<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"><path d="M12 1v22M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6"/></svg>},
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
          <button className="btn btn-primary btn-sm" onClick={openNewCv}>+ New Check Voucher</button>
          <AccountCombobox
            options={bankAccounts.map(b=>({value:b.code||b.id,label:`${b.code} — ${b.name}`}))}
            value={filterBank}
            onChange={v => setFilterBank(v)}
            placeholder="All Banks"
            noneLabel="All Banks"
            style={{width:220}}
          />
          <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)}>
            <option value="">All Statuses</option>
            {CHECK_STATUSES.map(s => <option key={s}>{s}</option>)}
          </select>
          <input placeholder="Search check #, payee, reference…" value={search} onChange={e => setSearch(e.target.value)} style={{ minWidth:200 }} />
          {(filterBank||filterStatus||search) && (
            <button className="btn btn-ghost btn-sm" onClick={() => { setFilterBank(''); setFilterStatus(''); setSearch(''); }}>Clear</button>
          )}
          <button className="btn btn-ghost btn-sm" onClick={flagStaleChecks} style={{ marginLeft:'auto' }} title="Mark Issued checks older than 180 days as Stale">⚑ Flag Stale</button>
          <span style={{ fontSize:12, color:'#64748b' }}>
            {filtered.length} check{filtered.length !== 1 ? 's' : ''} · Outstanding: <strong>{fmt(totalIssued)}</strong>
          </span>
        </div>
        {filtered.length === 0 ? <div className="empty">No checks match your filters.</div> : (
          <div style={{ overflowX:'auto' }}>
            <table>
              <thead><tr>
                <th>Check No.</th><th>Check ID</th><th>Issue Date</th><th>Bank</th>
                <th>Payee</th><th style={{ textAlign:'right' }}>Amount</th>
                <th>Reference</th><th>Status</th><th></th>
              </tr></thead>
              <tbody>
                {filtered.map(c => {
                  const ss = STATUS_STYLES[c.status] || STATUS_STYLES.Issued;
                  const bk = bankAccounts.find(a => a.code === c.bankCode || a.id === c.bankCode);
                  return (
                    <tr key={c.id}>
                      <td style={{ fontFamily:'monospace', fontWeight:700 }}>{c.checkNumber||'—'}</td>
                      <td style={{ fontFamily:'monospace', fontSize:11, color:'#94a3b8' }}>{c.checkId||'—'}</td>
                      <td>{c.issueDate||'—'}</td>
                      <td style={{ fontSize:11, color:'#64748b' }}>{bk ? `${bk.code} — ${bk.name}` : (c.bankCode||'—')}</td>
                      <td style={{ fontWeight:600 }}>{c.payeeName||'—'}</td>
                      <td style={{ textAlign:'right', fontWeight:700 }}>{fmt(c.amount)}</td>
                      <td style={{ fontFamily:'monospace', fontSize:11, color:'#64748b' }}>{c.referenceId||'—'}</td>
                      <td><span className="pill" style={ss}>{c.status||'Issued'}</span></td>
                      <td>
                        <div style={{ display:'flex', gap:4 }}>
                          {(c.status==='Issued'||c.status==='Stopped') && (
                            <button className="btn btn-ghost btn-sm" onClick={() => setStatusModal({ ...c })} style={{ borderColor:'#bfdbfe', color:'#1d4ed8' }}>
                              Update Status
                            </button>
                          )}
                          <button onClick={() => deleteCheck(c.id)} style={{ background:'none', border:'none', color:'#dc2626', cursor:'pointer', fontWeight:900, fontSize:13, padding:'3px 5px' }} title="Delete">✕</button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot><tr>
                <td colSpan={5} style={{ fontWeight:900 }}>TOTAL (filtered)</td>
                <td style={{ textAlign:'right' }}>{fmt(filtered.reduce((s,c) => s+(parseFloat(c.amount)||0), 0))}</td>
                <td colSpan={3}></td>
              </tr></tfoot>
            </table>
          </div>
        )}
      </div>
    );
  }

  // ══ Tab: Checkbooks ════════════════════════════════════════════════════════
  function CheckbooksTab() {
    return (
      <div>
        <div style={{ display:'flex', gap:8, marginBottom:12, alignItems:'center' }}>
          <button className="btn btn-primary btn-sm" onClick={() => setCbModal({ isActive:true })}>+ New Checkbook</button>
          <span style={{ marginLeft:'auto', fontSize:12, color:'#64748b' }}>{checkbooks.length} checkbook{checkbooks.length !== 1 ? 's' : ''}</span>
        </div>
        {checkbooks.length === 0 ? <div className="empty">No checkbooks added yet.</div> : (
          <div style={{ overflowX:'auto' }}>
            <table>
              <thead><tr>
                <th>Bank</th><th>Type</th><th>Starting #</th><th>Ending #</th>
                <th>Next #</th><th>Progress</th><th>Status</th><th>Notes</th><th></th>
              </tr></thead>
              <tbody>
                {checkbooks.map(cb => {
                  const active = cb.isActive !== false;
                  const start  = parseInt(cb.startingNumber)  || 0;
                  const end    = parseInt(cb.endingNumber)     || 0;
                  const nxt    = parseInt(cb.nextCheckNumber)  || start;
                  const used   = Math.max(0, nxt - start);
                  const total  = Math.max(1, end - start + 1);
                  const pct    = Math.min(100, Math.round((used / total) * 100));
                  const bk     = bankAccounts.find(a => a.code === cb.bankCode || a.id === cb.bankCode);
                  return (
                    <tr key={cb.id}>
                      <td style={{ fontWeight:600 }}>{bk ? `${bk.code} — ${bk.name}` : (cb.bankCode||'—')}</td>
                      <td style={{ color:'#64748b' }}>{cb.checkbookType||'Regular'}</td>
                      <td style={{ fontFamily:'monospace' }}>{cb.startingNumber||'—'}</td>
                      <td style={{ fontFamily:'monospace' }}>{cb.endingNumber||'—'}</td>
                      <td style={{ fontFamily:'monospace', fontWeight:700, color:'#f97316' }}>{cb.nextCheckNumber||'—'}</td>
                      <td style={{ minWidth:120 }}>
                        <div style={{ background:'#f1f5f9', borderRadius:999, height:8, overflow:'hidden' }}>
                          <div style={{ width:`${pct}%`, height:'100%', background:pct>=90?'#ef4444':pct>=70?'#f97316':'#22c55e', borderRadius:999 }} />
                        </div>
                        <div style={{ fontSize:10, color:'#94a3b8', marginTop:2 }}>{pct}% used ({used}/{total})</div>
                      </td>
                      <td>
                        <span className="pill" style={active ? { background:'#f0fdf4', borderColor:'#bbf7d0', color:'#15803d' } : { background:'#f8fafc', borderColor:'#e2e8f0', color:'#94a3b8' }}>
                          {active ? 'Active' : 'Inactive'}
                        </span>
                      </td>
                      <td style={{ color:'#64748b', maxWidth:150, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{cb.notes||'—'}</td>
                      <td>
                        <div style={{ display:'flex', gap:4 }}>
                          <button className="btn btn-ghost btn-sm" onClick={() => setCbModal({ ...cb })}>Edit</button>
                          <button onClick={() => askConfirm('Delete this checkbook?', async () => { await deleteDoc(doc(db,'checkbookMaster',cb.id)); showToast('Checkbook deleted.'); })} style={{ background:'none', border:'none', color:'#dc2626', cursor:'pointer', fontWeight:900, fontSize:13, padding:'3px 5px' }}>✕</button>
                        </div>
                      </td>
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

  // ══ Check Voucher Modal ════════════════════════════════════════════════════
  function CheckVoucherModal() {
    if (!cvModal) return null;
    const upd = (k, v) => setCvForm(f => ({ ...f, [k]:v }));
    const cb  = activeCheckbook(cvForm.bankCode);
    return (
      <div className="backdrop" onClick={e => e.target === e.currentTarget && setCvModal(null)}>
        <div className="modal">
          <div className="modal-h">
            <div>
              <strong>New Check Voucher</strong>
              <div style={{ fontSize:11, color:'#64748b', marginTop:2 }}>Creates a Check Voucher + Check Register entry atomically</div>
            </div>
            <button className="btn btn-ghost btn-sm" onClick={() => setCvModal(null)}>✕</button>
          </div>
          <div className="modal-b">
            {/* Checkbook banner */}
            {cb ? (
              <div className="cb-banner">
                <span>📋 <strong>Active Checkbook</strong></span>
                <span style={{ color:'#1d4ed8' }}>{bankAccounts.find(a=>a.code===cb.bankCode||a.id===cb.bankCode)?.name||cb.bankCode}</span>
                <span>Range: <strong>{cb.startingNumber}–{cb.endingNumber}</strong></span>
                <span>Next: <strong style={{ color:'#f97316' }}>{cb.nextCheckNumber}</strong></span>
                <button className="btn btn-ghost btn-sm" onClick={() => upd('globalCheckNo', cb.nextCheckNumber)}>Use Next #</button>
              </div>
            ) : cvForm.bankCode ? (
              <div className="info-banner">⚠️ No active checkbook for this bank. Create one in the <strong>Checkbook Management</strong> tab first.</div>
            ) : null}

            {/* Header */}
            <div className="grid6">
              <div className="field col3">
                <label>Bank Account *</label>
                <AccountCombobox
                  options={bankAccounts.map(a=>({value:a.code||a.id,label:`${a.code} — ${a.name}`}))}
                  value={cvForm.bankCode||''}
                  onChange={v => upd('bankCode',v)}
                  placeholder="— Select Bank —"
                />
              </div>
              <div className="field col3">
                <label>Issue Date *</label>
                <input type="date" value={cvForm.issueDate||''} onChange={e => upd('issueDate',e.target.value)} />
              </div>
              <div className="field col4">
                <label>Purpose / Category</label>
                <input value={cvForm.purposeCategory||''} onChange={e => upd('purposeCategory',e.target.value)} placeholder="e.g. Bills Payment, Rent…" list="cv-purpose-list" />
                <datalist id="cv-purpose-list">{PURPOSE_SUGGESTIONS.map(s => <option key={s} value={s} />)}</datalist>
              </div>
              <div className="col2" style={{ display:'flex', alignItems:'center' }}>
                <label style={{ display:'flex', alignItems:'center', gap:8, cursor:'pointer', fontSize:13, fontWeight:600, whiteSpace:'nowrap' }}>
                  <input type="checkbox" checked={!!cvForm.isMultipleChecks} onChange={e => upd('isMultipleChecks',e.target.checked)} />
                  Multiple Checks
                </label>
              </div>
              {!cvForm.isMultipleChecks && (<>
                <div className="field col3">
                  <label>Check Number *</label>
                  <input value={cvForm.globalCheckNo||''} onChange={e => upd('globalCheckNo',e.target.value)} placeholder="e.g. 000125" />
                </div>
                <div className="field col3">
                  <label>Check Date</label>
                  <input type="date" value={cvForm.globalCheckDate||''} onChange={e => upd('globalCheckDate',e.target.value)} />
                </div>
              </>)}
            </div>

            {/* Payment Details */}
            <div className="sec-title">Payment Details</div>
            <table className="lines-tbl" style={{ width:'100%' }}>
              <thead>
                <tr>
                  <th style={{ width:28 }}>#</th>
                  <th>Contact / Payee</th>
                  <th>Account (COA)</th>
                  <th>Description</th>
                  {cvForm.isMultipleChecks && <th style={{ width:100 }}>Check #</th>}
                  {cvForm.isMultipleChecks && <th style={{ width:110 }}>Check Date</th>}
                  <th style={{ minWidth:160 }}>EWT / Tax Rate</th>
                  <th style={{ textAlign:'right', width:110 }}>Amount</th>
                  <th style={{ textAlign:'right', width:90 }}>Tax Amt</th>
                  <th style={{ width:32 }}></th>
                </tr>
              </thead>
              <tbody>
                {cvLines.map((l, i) => (
                  <tr key={l.id}>
                    <td style={{ textAlign:'center', color:'#94a3b8', fontWeight:700 }}>{i+1}</td>
                    <td>
                      <ContactPicker
                        contacts={contacts}
                        value={l.contactId}
                        displayName={l.contact}
                        defaultNewType="Supplier"
                        onChange={({contactId, contactName})=>{ setLine(i,'contactId',contactId); setLine(i,'contact',contactName); }}
                        compact
                      />
                    </td>
                    <td>
                      <AccountCombobox
                        options={accounts.map(a=>({value:a.code||a.id,label:`${a.code} — ${a.name}`}))}
                        value={l.expenseAccount}
                        onChange={v => setLine(i,'expenseAccount',v)}
                        placeholder="Account code"
                      />
                    </td>
                    <td><input value={l.description} onChange={e => setLine(i,'description',e.target.value)} placeholder="Description" /></td>
                    {cvForm.isMultipleChecks && <td><input value={l.lineCheckNo} onChange={e => setLine(i,'lineCheckNo',e.target.value)} placeholder="Check #" /></td>}
                    {cvForm.isMultipleChecks && <td><input type="date" value={l.lineCheckDate} onChange={e => setLine(i,'lineCheckDate',e.target.value)} /></td>}
                    <td style={{ minWidth:160 }}>
                      <select value={l.taxRateId||''} onChange={e => setLine(i,'taxRateId',e.target.value)} style={{ marginBottom:3 }}>
                        <option value="">N/A</option>
                        {taxRates.length > 0 && <optgroup label="— Rates —">{taxRates.map(r => <option key={r.id} value={r.id}>{r.name} ({(r.rate||0).toFixed(2)}%)</option>)}</optgroup>}
                        {taxGroups.length > 0 && <optgroup label="— Groups —">{taxGroups.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}</optgroup>}
                      </select>
                      {l.taxRateId && (
                        <label style={{ fontSize:10, display:'flex', alignItems:'center', gap:4, cursor:'pointer', marginTop:2 }}>
                          <input type="checkbox" checked={!!l.inclusive} onChange={e => setLine(i,'inclusive',e.target.checked)} /> Inclusive
                        </label>
                      )}
                    </td>
                    <td><input type="number" style={{ textAlign:'right' }} value={l.amount} onChange={e => setLine(i,'amount',e.target.value)} placeholder="0.00" /></td>
                    <td style={{ textAlign:'right', color:'#7c3aed', fontWeight:700, fontSize:12 }}>{l.taxAmt > 0 ? fmtN(l.taxAmt) : '—'}</td>
                    <td><button className="btn btn-ghost btn-xs" style={{ color:'#dc2626' }} onClick={() => removeLine(i)} disabled={cvLines.length <= 1}>✕</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
            <button className="btn btn-ghost btn-sm" onClick={addLine}>+ Add New Row</button>
            <div className="tfoot-row">
              <div style={{ display:'flex', gap:20 }}><span style={{ color:'#94a3b8' }}>Gross Total:</span><span>{fmt(lineTotal)}</span></div>
              <div style={{ display:'flex', gap:20 }}><span style={{ color:'#94a3b8' }}>Total EWT:</span><span style={{ color:'#7c3aed' }}>{fmt(taxTotal)}</span></div>
              <div style={{ display:'flex', gap:20, fontSize:15, fontWeight:900 }}><span style={{ color:'#64748b' }}>NET CHECK AMOUNT</span><span style={{ color:'#0b1220' }}>{fmt(netCash)}</span></div>
            </div>

            {/* Journal Entry */}
            <div className="sec-title" style={{ marginTop:20 }}>Journal Entry (Auto-Generated)</div>
            <table className="jnl-tbl">
              <thead><tr><th style={{ width:'55%' }}>COA Account</th><th style={{ textAlign:'right' }}>Debit</th><th style={{ textAlign:'right' }}>Credit</th></tr></thead>
              <tbody>
                {journalLines.map((j, i) => (
                  <tr key={i}>
                    <td style={{ fontFamily:'monospace', fontSize:12, paddingLeft: j.credit > 0 ? 28 : 8 }}>{j.account}</td>
                    <td style={{ textAlign:'right', fontWeight:700, color:j.debit?'#1d4ed8':'#94a3b8' }}>{j.debit ? fmtN(j.debit) : '—'}</td>
                    <td style={{ textAlign:'right', fontWeight:700, color:j.credit?'#15803d':'#94a3b8' }}>{j.credit ? fmtN(j.credit) : '—'}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot><tr>
                <td style={{ fontWeight:900 }}>TOTAL</td>
                <td style={{ textAlign:'right', fontWeight:900, color:jDebit===jCredit?'#15803d':'#dc2626' }}>{fmtN(jDebit)}</td>
                <td style={{ textAlign:'right', fontWeight:900, color:jDebit===jCredit?'#15803d':'#dc2626' }}>{fmtN(jCredit)}</td>
              </tr></tfoot>
            </table>
            {jDebit !== jCredit && <div style={{ color:'#dc2626', fontSize:11, marginTop:4, fontWeight:700 }}>⚠ Journal is unbalanced — verify all line amounts.</div>}

            <div className="field" style={{ marginTop:12 }}>
              <label>Notes</label>
              <textarea rows={2} value={cvForm.notes||''} onChange={e => upd('notes',e.target.value)} style={{ resize:'vertical' }} />
            </div>
          </div>
          <div className="modal-f">
            <button className="btn btn-ghost" onClick={() => setCvModal(null)}>Cancel</button>
            <button className="btn btn-primary" disabled={saving || !cb} onClick={createCheckVoucher}>
              {saving ? 'Creating…' : 'Create Check Voucher'}
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ══ Status Update Modal ════════════════════════════════════════════════════
  function StatusUpdateModal() {
    if (!statusModal) return null;
    const [form, setF] = useState({ ...statusModal });
    const upd = (k, v) => setF(f => ({ ...f, [k]:v }));
    const next = statusModal.status === 'Issued'
      ? ['Cleared','Voided','Stopped','Stale']
      : statusModal.status === 'Stopped'
      ? ['Cleared','Voided','Stale']
      : [];
    return (
      <div className="backdrop" onClick={e => e.target === e.currentTarget && setStatusModal(null)}>
        <div className="modal modal-sm">
          <div className="modal-h"><strong>Update Check Status</strong><button className="btn btn-ghost btn-sm" onClick={() => setStatusModal(null)}>✕</button></div>
          <div className="modal-b">
            <div style={{ marginBottom:12, padding:'10px 12px', background:'#f8fafc', borderRadius:10, fontSize:12 }}>
              <div style={{ fontWeight:700 }}>Check #{statusModal.checkNumber} — {statusModal.payeeName}</div>
              <div style={{ color:'#64748b' }}>Amount: {fmt(statusModal.amount)} · Current: <strong>{statusModal.status}</strong></div>
              {statusModal.referenceId && <div style={{ color:'#7c3aed', marginTop:2 }}>Linked Voucher: {statusModal.referenceId}</div>}
            </div>
            <div className="field" style={{ marginBottom:12 }}>
              <label>New Status *</label>
              <div style={{ display:'flex', gap:8, flexWrap:'wrap' }}>
                {next.map(s => {
                  const ss = STATUS_STYLES[s];
                  return (
                    <button key={s} className="btn btn-sm"
                      style={{ background:form.status===s?ss.background:'#f8fafc', borderColor:form.status===s?ss.borderColor:'#e2e8f0', color:form.status===s?ss.color:'#64748b', border:'1px solid' }}
                      onClick={() => upd('status', s)}>{s}</button>
                  );
                })}
              </div>
            </div>
            {form.status==='Cleared' && <div className="field" style={{ marginBottom:10 }}><label>Cleared Date *</label><input type="date" value={form.clearedDate||today()} onChange={e=>upd('clearedDate',e.target.value)} /></div>}
            {form.status==='Voided'  && (
              <div style={{ display:'grid', gridTemplateColumns:'1fr 2fr', gap:10, marginBottom:10 }}>
                <div className="field"><label>Voided Date</label><input type="date" value={form.voidedDate||today()} onChange={e=>upd('voidedDate',e.target.value)} /></div>
                <div className="field"><label>Void Reason *</label><input value={form.voidReason||''} onChange={e=>upd('voidReason',e.target.value)} placeholder="Required" /></div>
              </div>
            )}
            {form.status==='Stopped' && <div className="field" style={{ marginBottom:10 }}><label>Stop Payment Date</label><input type="date" value={form.stoppedDate||today()} onChange={e=>upd('stoppedDate',e.target.value)} /></div>}
            {form.status==='Stale'   && <div className="field" style={{ marginBottom:10 }}><label>Stale Date</label><input type="date" value={form.staleDate||today()} onChange={e=>upd('staleDate',e.target.value)} /></div>}
            {(form.status==='Cleared'||form.status==='Voided') && statusModal.referenceId && (
              <div style={{ fontSize:11, color:'#64748b', background:'#f0f9ff', border:'1px solid #bae6fd', borderRadius:8, padding:'8px 10px', marginTop:8 }}>
                {form.status==='Cleared' ? '✓ Linked voucher will be automatically marked as Paid.' : '↩ Linked voucher will be reverted to Pending.'}
              </div>
            )}
          </div>
          <div className="modal-f">
            <button className="btn btn-ghost" onClick={() => setStatusModal(null)}>Cancel</button>
            <button className="btn btn-primary" disabled={saving} onClick={() => updateStatus(form)}>{saving ? 'Saving…' : 'Update Status'}</button>
          </div>
        </div>
      </div>
    );
  }

  // ══ Checkbook Modal ════════════════════════════════════════════════════════
  function CheckbookModal() {
    const isEdit = !!(cbModal && cbModal.id);
    const [form, setF] = useState({ bankCode:'', checkbookType:'Regular', startingNumber:'', endingNumber:'', nextCheckNumber:'', isActive:true, notes:'', ...cbModal });
    const upd = (k, v) => setF(f => ({ ...f, [k]:v }));
    return (
      <div className="backdrop" onClick={e => e.target === e.currentTarget && setCbModal(null)}>
        <div className="modal modal-sm">
          <div className="modal-h"><strong>{isEdit ? 'Edit Checkbook' : 'New Checkbook'}</strong><button className="btn btn-ghost btn-sm" onClick={() => setCbModal(null)}>✕</button></div>
          <div className="modal-b">
            {form.isActive && (
              <div style={{ fontSize:11, color:'#92400e', background:'#fff7ed', border:'1px solid #fed7aa', borderRadius:8, padding:'8px 10px', marginBottom:12 }}>
                ⚠ Setting this checkbook as Active will deactivate any other active checkbook for the same bank.
              </div>
            )}
            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:10, marginBottom:12 }}>
              <div style={{ gridColumn:'span 2' }} className="field">
                <label>Bank Account *</label>
                <AccountCombobox
                  options={bankAccounts.map(a=>({value:a.code||a.id,label:`${a.code} — ${a.name}`}))}
                  value={form.bankCode||''}
                  onChange={v => upd('bankCode',v)}
                  placeholder="— Select Bank —"
                />
              </div>
              <div className="field"><label>Checkbook Type</label><select value={form.checkbookType||'Regular'} onChange={e=>upd('checkbookType',e.target.value)}>{CHECKBOOK_TYPES.map(t=><option key={t}>{t}</option>)}</select></div>
              <div className="field"><label>Status</label><select value={form.isActive?'yes':'no'} onChange={e=>upd('isActive',e.target.value==='yes')}><option value="yes">Active</option><option value="no">Inactive</option></select></div>
              <div className="field"><label>Starting Number *</label><input value={form.startingNumber||''} onChange={e=>upd('startingNumber',e.target.value)} placeholder="e.g. 000001" /></div>
              <div className="field"><label>Ending Number *</label><input value={form.endingNumber||''} onChange={e=>upd('endingNumber',e.target.value)} placeholder="e.g. 000100" /></div>
              <div className="field" style={{ gridColumn:'span 2' }}>
                <label>Next Check # (auto-advances on each issue)</label>
                <input value={form.nextCheckNumber||form.startingNumber||''} onChange={e=>upd('nextCheckNumber',e.target.value)} />
              </div>
              <div className="field" style={{ gridColumn:'span 2' }}><label>Notes</label><input value={form.notes||''} onChange={e=>upd('notes',e.target.value)} /></div>
            </div>
          </div>
          <div className="modal-f">
            <button className="btn btn-ghost" onClick={() => setCbModal(null)}>Cancel</button>
            <button className="btn btn-primary" disabled={saving} onClick={() => saveCheckbook(form)}>
              {saving ? 'Saving…' : isEdit ? 'Save Changes' : 'Create Checkbook'}
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="cr-wrap">
      <style>{CSS}</style>
      <div className="cr-topbar">
        <div>
          <h1 style={{ margin:0, fontSize:18, fontWeight:900 }}>Check Registry</h1>
          <p style={{ margin:0, fontSize:12, color:'#64748b' }}>
            {checks.length} check{checks.length !== 1 ? 's' : ''} · {checkbooks.length} checkbook{checkbooks.length !== 1 ? 's' : ''}
          </p>
        </div>
      </div>
      <div className="cr-tabs">
        {[
          {key:'register',label:'Check Register'},
          {key:'analytics',label:'Analytics & Aging'},
          {key:'checkbooks',label:'Checkbook Management'},
        ].map(t => (
          <button key={t.key} className={`cr-tab${activeTab===t.key?' cr-tab-active':''}`} onClick={() => setActiveTab(t.key)}>{t.label}</button>
        ))}
      </div>
      <div className="cr-body">
        {activeTab === 'register'   && <RegisterTab />}
        {activeTab === 'analytics'  && <AnalyticsTab />}
        {activeTab === 'checkbooks' && <CheckbooksTab />}
      </div>
      {cvModal     !== null && <CheckVoucherModal />}
      {cbModal     !== null && <CheckbookModal />}
      {statusModal !== null && <StatusUpdateModal />}
      {confirmModal && (
        <div className="backdrop" onClick={() => setConfirmModal(null)}>
          <div style={{ width:'min(400px,98vw)', background:'#fff', borderRadius:16, overflow:'hidden', boxShadow:'0 24px 64px rgba(0,0,0,.25)' }} onClick={e => e.stopPropagation()}>
            <div style={{ padding:'14px 18px', borderBottom:'1px solid #e5e7eb', background:'#f8fafc', display:'flex', alignItems:'center', justifyContent:'space-between' }}>
              <strong style={{ fontSize:14, fontWeight:900 }}>Confirm</strong>
              <button className="btn btn-ghost btn-sm" onClick={() => setConfirmModal(null)}>✕</button>
            </div>
            <div style={{ padding:'18px' }}><p style={{ margin:0, fontSize:14, lineHeight:1.5 }}>{confirmModal.message}</p></div>
            <div style={{ display:'flex', justifyContent:'flex-end', gap:10, padding:'12px 18px', borderTop:'1px solid #e5e7eb' }}>
              <button className="btn btn-ghost" onClick={() => setConfirmModal(null)}>Cancel</button>
              <button className="btn btn-danger" onClick={() => { confirmModal.onConfirm(); setConfirmModal(null); }}>Confirm</button>
            </div>
          </div>
        </div>
      )}
      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}


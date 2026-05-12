import { useState, useEffect, useMemo, useCallback } from 'react';
import {
  collection, query, orderBy, onSnapshot, addDoc, updateDoc, deleteDoc, doc,
  serverTimestamp, getDocs
} from 'firebase/firestore';
import { db, auth } from '../../../firebase.js';

const fmt = (n) => new Intl.NumberFormat('en-PH', { style:'currency', currency:'PHP' }).format(n || 0);
const uid = () => Math.random().toString(36).slice(2, 10).toUpperCase();
const today = () => new Date().toISOString().slice(0, 10);

// Matches GAS acounting.js getAppConfig() voucherTypes.
// CHECK vouchers are created from Check Registry, not here.
const VOUCHER_TYPES = [
  { value:'PAYMENT',   label:'Payment Voucher' },
  { value:'PAYROLL',   label:'Payroll Voucher' },
  { value:'FINAL_PAY', label:'Final Pay Voucher' },
  { value:'LOAN',      label:'Loan Voucher' },
];
// Types where Purpose Category and Payment From are hidden (auto-bank)
const AUTO_BANK_TYPES = ['PAYROLL','FINAL_PAY'];
// Types where Tax columns are shown
const TAX_VISIBLE_TYPES = ['PAYMENT'];
const STATUSES = ['Pending','Pending Review','Pending Approval','Approved','For Disbursement','Paid','Rejected','Voided'];

const PURPOSE_SUGGESTIONS = [
  'Bills Payment','Salaries and Wages','Rent','Utilities','Professional Fees',
  'Office Supplies','Transportation','Representation','Taxes','Contractor Payment',
];

const STATUS_STYLES = {
  'Pending':            { background:'#fff7ed', borderColor:'#fed7aa', color:'#c2410c' },
  'Pending Review':     { background:'#fffbeb', borderColor:'#fde68a', color:'#92400e' },
  'Pending Approval':   { background:'#eff6ff', borderColor:'#bfdbfe', color:'#1d4ed8' },
  'Approved':           { background:'#ecfdf5', borderColor:'#6ee7b7', color:'#065f46' },
  'For Disbursement':   { background:'#f0f9ff', borderColor:'#bae6fd', color:'#0369a1' },
  'Paid':               { background:'#f0fdf4', borderColor:'#bbf7d0', color:'#15803d' },
  'Rejected':           { background:'#fef2f2', borderColor:'#fecaca', color:'#dc2626' },
  'Voided':             { background:'#f8fafc', borderColor:'#e2e8f0', color:'#64748b' },
};

const EMPTY_LINE = () => ({ id: uid(), contact:'', expenseAccount:'', description:'', amount:'', category:'', taxRateId:'', taxType:'N/A', taxRate:0, taxAmt:0, inclusive:false });

const CSS = `
  .vp-wrap   { display:flex; flex-direction:column; height:100%; overflow:hidden; font-family:Inter,system-ui,sans-serif; background:#f8fafc; }
  .vp-topbar { display:flex; align-items:center; justify-content:space-between; padding:16px 22px 12px; flex-shrink:0; border-bottom:1px solid #e5e7eb; background:#fff; }
  .vp-body   { flex:1; overflow-y:auto; padding:16px 22px; }
  .toolbar   { display:flex; gap:10px; align-items:center; flex-wrap:wrap; margin-bottom:14px; }
  .input     { border:1px solid #e5e7eb; border-radius:10px; padding:9px 12px; font-size:13px; background:#fff; font-family:inherit; }
  .btn       { border:0; border-radius:10px; padding:9px 16px; font-weight:700; cursor:pointer; font-size:13px; font-family:inherit; transition:opacity .15s; }
  .btn:disabled { opacity:.5; cursor:not-allowed; }
  .btn-primary { background:#f97316; color:#fff; }
  .btn-dark    { background:#0b1220; color:#fff; }
  .btn-ghost   { background:#f1f5f9; color:#0b1220; }
  .btn-ghost:hover { background:#e2e8f0; }
  .btn-danger  { background:#ef4444; color:#fff; }
  .btn-sm      { padding:6px 12px; font-size:12px; }
  .btn-xs      { padding:4px 8px; font-size:11px; border-radius:8px; }
  .card { background:#fff; border:1px solid #e5e7eb; border-radius:14px; overflow:hidden; }
  table { width:100%; border-collapse:collapse; }
  th,td { padding:11px 12px; border-bottom:1px solid #f1f5f9; font-size:13px; text-align:left; }
  th { color:#64748b; font-weight:800; font-size:11px; letter-spacing:.05em; text-transform:uppercase; background:#f8fafc; }
  tr:hover td { background:#fafafa; }
  tr:last-child td { border-bottom:none; }
  .pill { display:inline-block; padding:3px 9px; border-radius:999px; font-size:11px; font-weight:700; border:1px solid; white-space:nowrap; }
  .backdrop { position:fixed; inset:0; background:rgba(15,23,42,.45); display:flex; align-items:center; justify-content:center; padding:16px; z-index:100; }
  .modal    { width:min(960px,98vw); max-height:92vh; background:#fff; border-radius:16px; display:flex; flex-direction:column; overflow:hidden; box-shadow:0 24px 64px rgba(0,0,0,.25); }
  .modal-sm { width:min(480px,98vw); }
  .modal-h  { display:flex; align-items:center; justify-content:space-between; padding:16px 20px; border-bottom:1px solid #e5e7eb; background:#f8fafc; flex-shrink:0; }
  .modal-h strong { font-size:15px; font-weight:900; }
  .modal-b  { padding:20px; overflow-y:auto; flex:1; }
  .modal-f  { display:flex; justify-content:flex-end; gap:10px; padding:14px 20px; border-top:1px solid #e5e7eb; background:#fff; flex-shrink:0; }
  .grid6    { display:grid; grid-template-columns:repeat(6,1fr); gap:10px; margin-bottom:12px; }
  .col2     { grid-column:span 2; }
  .col3     { grid-column:span 3; }
  .col4     { grid-column:span 4; }
  .col6     { grid-column:span 6; }
  .field    { display:flex; flex-direction:column; gap:5px; }
  .field label { font-size:10px; font-weight:800; color:#64748b; letter-spacing:.06em; text-transform:uppercase; }
  .field input,.field select,.field textarea { width:100%; border:1px solid #e5e7eb; border-radius:10px; padding:9px 10px; font-size:13px; background:#fff; font-family:inherit; box-sizing:border-box; }
  .section-title { font-size:11px; font-weight:800; color:#94a3b8; letter-spacing:.07em; text-transform:uppercase; margin:16px 0 8px; border-bottom:1px solid #f1f5f9; padding-bottom:6px; }
  .lines-tbl th,.lines-tbl td { border-bottom:1px solid #f1f5f9; padding:8px 10px; }
  .lines-tbl td input,.lines-tbl td select { width:100%; border:1px solid #e5e7eb; border-radius:8px; padding:7px 8px; font-size:12px; font-family:inherit; }
  .tfoot-row { display:flex; justify-content:flex-end; gap:20px; padding:10px 16px; background:#f8fafc; border-top:2px solid #e5e7eb; font-size:13px; font-weight:700; }
  .bulk-bar  { display:flex; align-items:center; gap:10px; padding:8px 14px; background:#fff7ed; border:1px solid #fed7aa; border-radius:10px; margin-bottom:10px; flex-wrap:wrap; }
  .kpi-row   { display:grid; grid-template-columns:repeat(auto-fit,minmax(130px,1fr)); gap:10px; margin-bottom:16px; }
  .kpi-card  { background:#fff; border:1px solid #e5e7eb; border-radius:12px; padding:14px 16px; }
  .kpi-label { font-size:10px; font-weight:800; color:#94a3b8; letter-spacing:.07em; text-transform:uppercase; margin-bottom:4px; }
  .kpi-value { font-size:18px; font-weight:900; color:#0b1220; }
  .empty { padding:48px; text-align:center; color:#94a3b8; font-size:13px; }
  .toast { position:fixed; right:16px; bottom:16px; background:#0b1220; color:#fff; padding:12px 18px; border-radius:12px; font-size:13px; font-weight:600; z-index:999; animation:fadeIn .2s; }
  .backdrop { position:fixed; inset:0; background:rgba(15,23,42,.45); display:flex; align-items:center; justify-content:center; padding:16px; z-index:100; }
  @keyframes fadeIn { from{opacity:0;transform:translateY(8px)} to{opacity:1;transform:none} }
  .expand-row td { background:#f8fafc; padding:16px 20px; }
  .pg-bar { display:flex; align-items:center; justify-content:space-between; padding:10px 4px; flex-shrink:0; margin-top:8px; flex-wrap:wrap; gap:8px; }
  .pg-bar span { font-size:12px; color:#64748b; font-weight:600; }
`;

function StatusPill({ status }) {
  const s = STATUS_STYLES[status] || STATUS_STYLES['Pending'];
  return <span className="pill" style={s}>{status || 'Pending'}</span>;
}

export default function VouchersPage() {
  const [vouchers,   setVouchers]  = useState([]);
  const [accounts,   setAccounts]  = useState([]);
  const [contacts,   setContacts]  = useState([]);
  const [taxRates,   setTaxRates]  = useState([]);

  // Filters
  const [search,        setSearch]       = useState('');
  const [filterType,    setFilterType]   = useState('');
  const [filterStatus,  setFilterStatus] = useState('');
  const [dateFrom,      setDateFrom]     = useState('');
  const [dateTo,        setDateTo]       = useState('');

  // Pagination
  const [page,     setPage]     = useState(1);
  const [pageSize, setPageSize] = useState(25);

  // Sort
  const [sortCol, setSortCol] = useState('preparationDate');
  const [sortDir, setSortDir] = useState('desc');

  // Bulk
  const [selected, setSelected] = useState(new Set());

  // Expand
  const [expandId, setExpandId] = useState(null);

  // Modals
  const [showModal,   setShowModal]   = useState(false);
  const [viewModal,   setViewModal]   = useState(null);
  const [statusModal, setStatusModal] = useState(null); // { voucher, newStatus, reason }

  // Form
  const [editing,   setEditing]   = useState(null);
  const [form,      setForm]      = useState({});
  const [lines,     setLines]     = useState([EMPTY_LINE()]);
  const [saving,    setSaving]    = useState(false);
  const [toast,     setToast]     = useState('');

  const showToast = (msg) => { setToast(msg); setTimeout(() => setToast(''), 3000); };
  const [confirmModal, setConfirmModal] = useState(null);
  const askConfirm = (message, onConfirm) => setConfirmModal({ message, onConfirm });
  const user = auth.currentUser?.email || '';

  // Live data
  useEffect(() => {
    const unsub = onSnapshot(
      query(collection(db, 'vouchers'), orderBy('createdAt', 'desc')),
      snap => setVouchers(snap.docs.map(d => ({ id: d.id, ...d.data() })))
    );
    getDocs(collection(db, 'accounts')).then(s => setAccounts(s.docs.map(d => ({ id:d.id, ...d.data() }))));
    getDocs(collection(db, 'contacts')).then(s => setContacts(s.docs.map(d => ({ id:d.id, ...d.data() }))));
    const unsubRates = onSnapshot(query(collection(db,'taxRates'), orderBy('taxType')), snap => setTaxRates(snap.docs.map(d=>({id:d.id,...d.data()})).filter(r=>r.isActive!==false)));
    return () => { unsub(); unsubRates(); };
  }, []);

  // Generate sequential voucher ID: PREFIX-YYYYMM-NNNN (based on existing count in DB)
  const genId = (type) => {
    const d = new Date(); const y = d.getFullYear(); const m = String(d.getMonth()+1).padStart(2,'0');
    const prefix = type === 'PAYMENT' ? 'PV' : type === 'PAYROLL' ? 'PR' : type === 'FINAL_PAY' ? 'FP' : type === 'LOAN' ? 'LV' : 'VCH';
    const periodKey = `${prefix}${y}${m}`;
    const existing = vouchers.filter(v => (v.voucherId||'').startsWith(periodKey));
    const seq = String(existing.length + 1).padStart(4, '0');
    return `${periodKey}-${seq}`;
  };

  // Filtered + sorted
  const filtered = useMemo(() => {
    let v = [...vouchers];
    const q = search.toLowerCase();
    if (q) v = v.filter(x => (x.voucherId||x.id||'').toLowerCase().includes(q) || (x.contactSummary||'').toLowerCase().includes(q) || (x.purposeCategory||'').toLowerCase().includes(q));
    if (filterType)   v = v.filter(x => (x.voucherType||'') === filterType);
    if (filterStatus) v = v.filter(x => (x.status||'') === filterStatus);
    if (dateFrom) v = v.filter(x => (x.preparationDate||'') >= dateFrom);
    if (dateTo)   v = v.filter(x => (x.preparationDate||'') <= dateTo);

    v.sort((a, b) => {
      let av = a[sortCol] ?? '', bv = b[sortCol] ?? '';
      if (sortCol === 'totalAmount') { av = Number(av)||0; bv = Number(bv)||0; }
      if (av < bv) return sortDir === 'asc' ? -1 : 1;
      if (av > bv) return sortDir === 'asc' ? 1 : -1;
      return 0;
    });
    return v;
  }, [vouchers, search, filterType, filterStatus, dateFrom, dateTo, sortCol, sortDir]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const paginated  = filtered.slice((page-1)*pageSize, page*pageSize);

  const handleSort = (col) => {
    if (sortCol === col) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortCol(col); setSortDir('asc'); }
    setPage(1);
  };

  // KPIs
  const kpis = useMemo(() => {
    const total   = vouchers.length;
    const pending = vouchers.filter(v => ['Pending','Pending Review','Pending Approval'].includes(v.status)).length;
    const approved = vouchers.filter(v => v.status === 'Approved').length;
    const paid    = vouchers.filter(v => v.status === 'Paid').length;
    const totalAmt = vouchers.filter(v => v.status !== 'Voided').reduce((s,v) => s + (Number(v.totalAmount)||0), 0);
    return { total, pending, approved, paid, totalAmt };
  }, [vouchers]);

  // Bulk helpers
  const toggleSel = (id) => setSelected(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const toggleAll = () => {
    if (selected.size === paginated.length) setSelected(new Set());
    else setSelected(new Set(paginated.map(v => v.id)));
  };

  const bulkSubmit = () => {
    if (!selected.size) return;
    const count = selected.size;
    askConfirm(`Submit ${count} voucher(s) for approval?`, async () => {
      await Promise.all([...selected].map(id => updateDoc(doc(db,'vouchers',id), { status:'Pending Review', updatedAt:serverTimestamp(), updatedBy:user })));
      setSelected(new Set());
      showToast(`${count} voucher(s) submitted for review.`);
    });
  };

  const bulkVoid = () => {
    if (!selected.size) return;
    const count = selected.size;
    askConfirm(`Void ${count} voucher(s)? This cannot be undone.`, async () => {
      await Promise.all([...selected].map(id => updateDoc(doc(db,'vouchers',id), { status:'Voided', updatedAt:serverTimestamp(), updatedBy:user })));
      setSelected(new Set());
      showToast(`${count} voucher(s) voided.`);
    });
  };

  const bulkDelete = () => {
    if (!selected.size) return;
    const count = selected.size;
    askConfirm(`Delete ${count} voucher(s)? This cannot be undone.`, async () => {
      await Promise.all([...selected].map(id => deleteDoc(doc(db,'vouchers',id))));
      setSelected(new Set());
      showToast(`${count} voucher(s) deleted.`);
    });
  };

  // Open create/edit modal
  const openNew = () => {
    setEditing(null);
    setForm({ voucherType:'PAYMENT', preparationDate:today(), purposeCategory:'', paymentFrom:'', status:'Pending', notes:'' });
    setLines([EMPTY_LINE()]);
    setShowModal(true);
  };

  const openEdit = (v) => {
    setEditing(v);
    setForm({ voucherType:v.voucherType||'PAYMENT', preparationDate:v.preparationDate||today(), purposeCategory:v.purposeCategory||'', paymentFrom:v.paymentFromAccountCode||'', status:v.status||'Pending', notes:v.notes||'' });
    setLines((v.lines||[]).map(l => ({ id:uid(), contact:l.contact||'', expenseAccount:l.expenseAccountCode||'', description:l.description||'', amount:String(l.amount||''), category:l.category||'', taxRateId:l.taxRateId||'', taxType:l.taxType||'N/A', taxRate:l.taxRate||0, taxAmt:l.taxAmt||0, inclusive:l.inclusive||false })));
    if ((v.lines||[]).length === 0) setLines([EMPTY_LINE()]);
    setShowModal(true);
  };

  const duplicate = async (v) => {
    const newId = genId(v.voucherType||'PAYMENT');
    await addDoc(collection(db,'vouchers'), {
      voucherId: newId, voucherType: v.voucherType, preparationDate: today(),
      purposeCategory: v.purposeCategory, paymentFromAccountCode: v.paymentFromAccountCode,
      contactSummary: v.contactSummary, totalAmount: v.totalAmount,
      status:'Pending', notes: v.notes||'',
      lines: v.lines||[],
      createdAt:serverTimestamp(), createdBy:user, updatedAt:serverTimestamp(), updatedBy:user
    });
    showToast('Voucher duplicated.');
  };

  const deleteVoucher = (v) => {
    askConfirm(`Delete voucher ${v.voucherId||v.id}?`, async () => {
      await deleteDoc(doc(db,'vouchers',v.id));
      showToast('Voucher deleted.');
    });
  };

  // Save voucher
  const saveVoucher = async (newStatus) => {
    const totalAmount = lines.reduce((s,l) => s + (Number(l.amount)||0), 0);
    const contactSummary = [...new Set(lines.map(l=>l.contact).filter(Boolean))].join(', ');
    const payload = {
      voucherType:           form.voucherType,
      preparationDate:       form.preparationDate,
      purposeCategory:       form.purposeCategory,
      paymentFromAccountCode:form.paymentFrom,
      contactSummary,
      totalAmount,
      status:                newStatus || form.status,
      notes:                 form.notes||'',
      lines: lines.map((l,i) => ({ lineNo:i+1, contact:l.contact, expenseAccountCode:l.expenseAccount, description:l.description, amount:Number(l.amount)||0, category:l.category, taxRateId:l.taxRateId||'', taxType:l.taxType||'N/A', taxRate:Number(l.taxRate)||0, taxAmt:Number(l.taxAmt)||0, inclusive:!!l.inclusive })),
      updatedAt: serverTimestamp(), updatedBy: user
    };
    setSaving(true);
    try {
      if (editing) {
        await updateDoc(doc(db,'vouchers',editing.id), payload);
        showToast('Voucher updated.');
      } else {
        const voucherId = genId(form.voucherType);
        await addDoc(collection(db,'vouchers'), { ...payload, voucherId, createdAt:serverTimestamp(), createdBy:user });
        showToast('Voucher created.');
      }
      setShowModal(false);
    } catch(e) { showToast('Error: ' + e.message); }
    setSaving(false);
  };

  // Status update
  const doStatusUpdate = async () => {
    if (!statusModal) return;
    const { voucher, newStatus, reason } = statusModal;
    setSaving(true);
    try {
      await updateDoc(doc(db,'vouchers',voucher.id), {
        status: newStatus,
        ...(reason ? { rejectReason: reason } : {}),
        updatedAt: serverTimestamp(), updatedBy: user
      });
      showToast(`Status updated to ${newStatus}.`);
      setStatusModal(null);
    } catch(e) { showToast('Error: ' + e.message); }
    setSaving(false);
  };

  const sortIcon = (col) => sortCol === col ? (sortDir === 'asc' ? ' ▲' : ' ▼') : '';

  // Line helpers
  const setLine = (i, key, val) => setLines(prev => prev.map((l,idx) => {
    if (idx !== i) return l;
    const updated = {...l, [key]:val};
    // When taxRateId changes, auto-fill taxType & rate
    if (key === 'taxRateId') {
      const rate = taxRates.find(r => r.id === val);
      if (rate) { updated.taxType = rate.taxType; updated.taxRate = rate.rate||0; }
      else { updated.taxType = 'N/A'; updated.taxRate = 0; }
    }
    // Recalc tax amount
    const amt = Number(updated.amount)||0;
    const rate = Number(updated.taxRate)||0;
    updated.taxAmt = updated.taxRateId ? (updated.inclusive ? amt - amt/(1+rate/100) : amt*(rate/100)) : 0;
    updated.taxAmt = Math.round(updated.taxAmt*100)/100;
    return updated;
  }));
  const addLine = () => setLines(prev => [...prev, EMPTY_LINE()]);
  const removeLine = (i) => setLines(prev => prev.filter((_,idx) => idx !== i));

  // isAutoBank: hide Purpose/PaymentFrom for PAYROLL, FINAL_PAY (matches GAS toggleVoucherMode)
  const isAutoBank = AUTO_BANK_TYPES.includes(form.voucherType);
  const isLoan = form.voucherType === 'LOAN';
  const showTax = TAX_VISIBLE_TYPES.includes(form.voucherType);

  const lineTotal = lines.reduce((s,l) => s + (Number(l.amount)||0), 0);
  const taxTotal  = showTax ? lines.reduce((s,l) => s + (Number(l.taxAmt)||0), 0) : 0;
  const netCash   = lineTotal - taxTotal;

  // Bank/cash accounts from COA (subType = Bank or Cash)
  const bankAccounts = accounts.filter(a => ['Bank','Cash Equivalents','Cash','Cash and Cash Equivalents'].includes(a.subType) || (a.name||'').toLowerCase().includes('cash in bank'));

  // Auto-generate journal entry lines from voucher lines
  const journalLines = useMemo(() => {
    const jl = [];
    lines.forEach(l => {
      const amt = Number(l.amount)||0;
      const tax = Number(l.taxAmt)||0;
      if (!amt) return;
      const expenseAmt = l.inclusive ? amt - tax : amt;
      if (l.expenseAccount) jl.push({ account: l.expenseAccount, debit: expenseAmt, credit: 0 });
      if (tax > 0 && l.taxType && l.taxType !== 'N/A') {
        const taxAcct = l.taxType.includes('VAT') ? 'Input VAT' : `EWT Payable — ${l.taxType}`;
        jl.push({ account: taxAcct, debit: l.inclusive ? 0 : tax, credit: l.inclusive ? 0 : 0 });
        if (!l.inclusive) jl.push({ account: taxAcct + ' (payable)', debit: 0, credit: tax });
      }
    });
    const cashAmt = netCash;
    const bankAcct = bankAccounts.find(a => a.code === form.paymentFrom || a.id === form.paymentFrom);
    if (cashAmt > 0) jl.push({ account: bankAcct ? `${bankAcct.code} — ${bankAcct.name}` : (form.paymentFrom||'Cash / Bank'), debit: 0, credit: cashAmt });
    return jl;
  }, [lines, form.paymentFrom, bankAccounts, netCash]);

  const jDebit  = journalLines.reduce((s,j)=>s+j.debit,0);
  const jCredit = journalLines.reduce((s,j)=>s+j.credit,0);

  const nextStatuses = (status) => {
    if (status === 'Pending')          return ['Pending Review','Voided'];
    if (status === 'Pending Review')   return ['Pending Approval','Rejected','Voided'];
    if (status === 'Pending Approval') return ['Approved','Rejected','Voided'];
    if (status === 'Approved')         return ['For Disbursement','Voided'];
    if (status === 'For Disbursement') return ['Paid','Voided'];
    return [];
  };

  const canEdit = (v) => ['Pending','Pending Review'].includes(v.status);

  return (
    <div className="vp-wrap">
      <style>{CSS}</style>

      {/* Topbar */}
      <div className="vp-topbar">
        <div style={{display:'flex',alignItems:'center',gap:12}}>
          <strong style={{fontSize:18,fontWeight:900,color:'#0b1220'}}>VOUCHERS</strong>
          {selected.size > 0 && (
            <div className="bulk-bar" style={{margin:0}}>
              <span style={{fontSize:12,fontWeight:800,color:'#c2410c'}}>{selected.size} Selected</span>
              <button className="btn btn-ghost btn-sm" onClick={bulkSubmit}>Submit for Review</button>
              <button className="btn btn-ghost btn-sm" style={{color:'#dc2626'}} onClick={bulkVoid}>Void</button>
              <button className="btn btn-ghost btn-sm" style={{color:'#dc2626'}} onClick={bulkDelete}>Delete</button>
              <button className="btn btn-ghost btn-sm" onClick={()=>setSelected(new Set())}>Clear</button>
            </div>
          )}
        </div>
        <button className="btn btn-primary" onClick={openNew}>＋ NEW VOUCHER</button>
      </div>

      <div className="vp-body">
        {/* KPIs */}
        <div className="kpi-row">
          {[
            { label:'Total Vouchers', value:kpis.total },
            { label:'Pending / In-Review', value:kpis.pending },
            { label:'Approved', value:kpis.approved },
            { label:'Paid', value:kpis.paid },
            { label:'Total Amount (Active)', value:fmt(kpis.totalAmt) },
          ].map(k => (
            <div className="kpi-card" key={k.label}>
              <div className="kpi-label">{k.label}</div>
              <div className="kpi-value">{k.value}</div>
            </div>
          ))}
        </div>

        {/* Toolbar */}
        <div className="toolbar">
          <input className="input" placeholder="🔍 Search ID, contact, purpose…" value={search} onChange={e=>{setSearch(e.target.value);setPage(1);}} style={{flex:'1 1 200px',minWidth:180}} />
          <select className="input" value={filterType} onChange={e=>{setFilterType(e.target.value);setPage(1);}}>
            <option value="">All Types</option>
            {VOUCHER_TYPES.map(t=><option key={t.value} value={t.value}>{t.label}</option>)}
          </select>
          <select className="input" value={filterStatus} onChange={e=>{setFilterStatus(e.target.value);setPage(1);}}>
            <option value="">All Statuses</option>
            {STATUSES.map(s=><option key={s}>{s}</option>)}
          </select>
          <input type="date" className="input" value={dateFrom} onChange={e=>{setDateFrom(e.target.value);setPage(1);}} />
          <span style={{fontSize:12,color:'#94a3b8',fontWeight:700}}>TO</span>
          <input type="date" className="input" value={dateTo} onChange={e=>{setDateTo(e.target.value);setPage(1);}} />
          <button className="btn btn-ghost btn-sm" onClick={()=>{setSearch('');setFilterType('');setFilterStatus('');setDateFrom('');setDateTo('');setPage(1);}}>✕ Clear</button>
          <span style={{fontSize:12,color:'#94a3b8',fontWeight:600}}>{filtered.length} result{filtered.length!==1?'s':''}</span>
        </div>

        {/* Table */}
        <div className="card">
          <table>
            <thead>
              <tr>
                <th style={{width:40,textAlign:'center'}}><input type="checkbox" checked={selected.size === paginated.length && paginated.length > 0} onChange={toggleAll} /></th>
                <th style={{cursor:'pointer'}} onClick={()=>handleSort('voucherId')}>VOUCHER ID{sortIcon('voucherId')}</th>
                <th style={{cursor:'pointer'}} onClick={()=>handleSort('voucherType')}>TYPE{sortIcon('voucherType')}</th>
                <th style={{cursor:'pointer'}} onClick={()=>handleSort('preparationDate')}>DATE{sortIcon('preparationDate')}</th>
                <th>CONTACT</th>
                <th style={{textAlign:'right',cursor:'pointer'}} onClick={()=>handleSort('totalAmount')}>AMOUNT{sortIcon('totalAmount')}</th>
                <th>STATUS</th>
                <th style={{textAlign:'center'}}>ACTIONS</th>
              </tr>
            </thead>
            <tbody>
              {paginated.length === 0 && (
                <tr><td colSpan={8} className="empty">No vouchers found.</td></tr>
              )}
              {paginated.map(v => {
                const isExpanded = expandId === v.id;
                return [
                  <tr key={v.id} style={{cursor:'pointer'}}>
                    <td style={{textAlign:'center'}} onClick={e=>e.stopPropagation()}>
                      <input type="checkbox" checked={selected.has(v.id)} onChange={()=>toggleSel(v.id)} />
                    </td>
                    <td>
                      <a style={{fontWeight:900,color:'#f97316',textDecoration:'underline',cursor:'pointer'}} onClick={()=>setExpandId(isExpanded?null:v.id)}>
                        {v.voucherId || v.id}
                      </a>
                    </td>
                    <td><span style={{fontSize:11,fontWeight:700,background:'#f1f5f9',padding:'2px 8px',borderRadius:6}}>{v.voucherType||'—'}</span></td>
                    <td>{v.preparationDate||'—'}</td>
                    <td style={{maxWidth:160,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{v.contactSummary||'—'}</td>
                    <td style={{textAlign:'right',fontWeight:700}}>{fmt(v.totalAmount)}</td>
                    <td><StatusPill status={v.status} /></td>
                    <td style={{textAlign:'center'}}>
                      <div style={{display:'flex',gap:4,justifyContent:'center'}}>
                        <button className="btn btn-ghost btn-xs" onClick={()=>setViewModal(v)}>View</button>
                        {canEdit(v) && <button className="btn btn-ghost btn-xs" onClick={()=>openEdit(v)}>Edit</button>}
                        {nextStatuses(v.status).length > 0 && (
                          <select className="input" style={{padding:'3px 6px',fontSize:11,border:'1px solid #e5e7eb',borderRadius:8,cursor:'pointer'}}
                            defaultValue=""
                            onChange={e => { if(e.target.value) { const ns=e.target.value; e.target.value=''; if(ns==='Rejected') setStatusModal({voucher:v,newStatus:ns,reason:''}); else setStatusModal({voucher:v,newStatus:ns,reason:null}); } }}>
                            <option value="" disabled>Update…</option>
                            {nextStatuses(v.status).map(s=><option key={s} value={s}>{s}</option>)}
                          </select>
                        )}
                        <button className="btn btn-ghost btn-xs" onClick={()=>duplicate(v)} title="Duplicate">📋</button>
                        {v.status === 'Pending' && <button className="btn btn-ghost btn-xs" style={{color:'#dc2626'}} onClick={()=>deleteVoucher(v)}>🗑</button>}
                      </div>
                    </td>
                  </tr>,
                  isExpanded && (
                    <tr key={v.id+'-exp'} className="expand-row">
                      <td colSpan={8}>
                        <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(180px,1fr))',gap:12,marginBottom:12}}>
                          <div><span style={{fontSize:11,color:'#94a3b8',fontWeight:700}}>PURPOSE / CATEGORY</span><div style={{fontWeight:700}}>{v.purposeCategory||'—'}</div></div>
                          <div><span style={{fontSize:11,color:'#94a3b8',fontWeight:700}}>PAYMENT FROM</span><div style={{fontWeight:700}}>{v.paymentFromAccountCode||'—'}</div></div>
                          <div><span style={{fontSize:11,color:'#94a3b8',fontWeight:700}}>CHECK NO.</span><div style={{fontWeight:700}}>{v.checkNumber||'—'}</div></div>
                          <div><span style={{fontSize:11,color:'#94a3b8',fontWeight:700}}>REVIEWED BY</span><div style={{fontWeight:700}}>{v.reviewedBy||'—'}</div></div>
                          <div><span style={{fontSize:11,color:'#94a3b8',fontWeight:700}}>APPROVED BY</span><div style={{fontWeight:700}}>{v.approvedBy||'—'}</div></div>
                          {v.rejectReason && <div style={{gridColumn:'span 2'}}><span style={{fontSize:11,color:'#dc2626',fontWeight:700}}>REJECT REASON</span><div>{v.rejectReason}</div></div>}
                        </div>
                        {(v.lines||[]).length > 0 && (
                          <table className="lines-tbl" style={{fontSize:12}}>
                            <thead>
                              <tr>
                                <th>#</th><th>Contact</th><th>Account</th><th>Description</th><th>Category</th><th>Tax</th><th style={{textAlign:'right'}}>Amount</th>
                              </tr>
                            </thead>
                            <tbody>
                              {(v.lines||[]).map((l,i) => (
                                <tr key={i}>
                                  <td>{l.lineNo||i+1}</td>
                                  <td>{l.contact||'—'}</td>
                                  <td>{l.expenseAccountCode||'—'}</td>
                                  <td>{l.description||'—'}</td>
                                  <td>{l.category||'—'}</td>
                                  <td>{l.taxType||'—'}</td>
                                  <td style={{textAlign:'right',fontWeight:700}}>{fmt(l.amount)}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        )}
                      </td>
                    </tr>
                  )
                ];
              })}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {filtered.length > 0 && (
          <div className="pg-bar">
            <div style={{display:'flex',alignItems:'center',gap:8}}>
              <span>Rows per page:</span>
              <select className="input" style={{padding:'5px 8px',fontSize:12}} value={pageSize} onChange={e=>{setPageSize(Number(e.target.value));setPage(1);}}>
                {[25,50,100,200].map(n=><option key={n} value={n}>{n}</option>)}
              </select>
            </div>
            <span>Page {page} of {totalPages} — {filtered.length} results</span>
            <div style={{display:'flex',gap:4}}>
              <button className="btn btn-ghost btn-sm" disabled={page<=1} onClick={()=>setPage(p=>p-1)}>‹ Prev</button>
              {Array.from({length:Math.min(5,totalPages)},(_,i)=>i+1).map(n=>(
                <button key={n} className="btn btn-sm" style={{background:page===n?'#f97316':'#f1f5f9',color:page===n?'#fff':'#0b1220'}} onClick={()=>setPage(n)}>{n}</button>
              ))}
              <button className="btn btn-ghost btn-sm" disabled={page>=totalPages} onClick={()=>setPage(p=>p+1)}>Next ›</button>
            </div>
          </div>
        )}
      </div>

      {/* Create / Edit Modal */}
      {showModal && (
        <div className="backdrop" onClick={()=>setShowModal(false)}>
          <div className="modal" onClick={e=>e.stopPropagation()}>
            <div className="modal-h">
              <strong>{editing ? `Edit Voucher — ${editing.voucherId||editing.id}` : 'New Voucher'}</strong>
              <button className="btn btn-ghost btn-sm" onClick={()=>setShowModal(false)}>✕</button>
            </div>
            <div className="modal-b">
              <div className="grid6">
                {/* Row 1: Voucher ID (read-only) | Voucher Type | Preparation Date */}
                <div className="field col2">
                  <label>Voucher ID</label>
                  <input readOnly value={editing ? (editing.voucherId||editing.id) : genId(form.voucherType||'PAYMENT')} style={{background:'#f8fafc',color:'#64748b',fontWeight:700}} />
                </div>
                <div className="field col2">
                  <label>Voucher Type</label>
                  <select value={form.voucherType||'PAYMENT'} onChange={e=>setForm(f=>({...f,voucherType:e.target.value}))}>
                    {VOUCHER_TYPES.map(t=><option key={t.value} value={t.value}>{t.label}</option>)}
                  </select>
                </div>
                <div className="field col2">
                  <label>Preparation Date</label>
                  <input type="date" value={form.preparationDate||''} onChange={e=>setForm(f=>({...f,preparationDate:e.target.value}))} />
                </div>

                {/* Status — always read-only; determined by approval routing */}
                <div className="field col2">
                  <label>Status</label>
                  <div style={{padding:'9px 10px',borderRadius:10,border:'1px solid #e5e7eb',background:'#f8fafc',fontSize:13,fontWeight:700,...(STATUS_STYLES[form.status||'Pending']||{})}}>{form.status||'Pending'}</div>
                </div>

                {/* Purpose Category — hidden for PAYROLL/FINAL_PAY (auto-bank, matches GAS toggleVoucherMode) */}
                {!isAutoBank && (
                  <div className="field col2">
                    <label>Purpose / Category</label>
                    <input value={form.purposeCategory||''} onChange={e=>setForm(f=>({...f,purposeCategory:e.target.value}))} placeholder="e.g. Bills Payment, Salaries…" list="purpose-suggestions" />
                    <datalist id="purpose-suggestions">{PURPOSE_SUGGESTIONS.map(s=><option key={s} value={s} />)}</datalist>
                  </div>
                )}

                {/* Payment From — hidden for PAYROLL/FINAL_PAY (bank auto-resolved per line) */}
                {!isAutoBank && (
                  <div className="field col2">
                    <label>Payment From (Bank)</label>
                    <select value={form.paymentFrom||''} onChange={e=>setForm(f=>({...f,paymentFrom:e.target.value}))}>
                      <option value="">— Select Account —</option>
                      {bankAccounts.map(a=><option key={a.id} value={a.code||a.id}>{a.code} — {a.name}</option>)}
                      {bankAccounts.length===0 && accounts.map(a=><option key={a.id} value={a.code||a.id}>{a.code} — {a.name}</option>)}
                    </select>
                  </div>
                )}

                {/* Payroll type notice */}
                {form.voucherType === 'PAYROLL' && (
                  <div className="field col6" style={{background:'#f0fdf4',border:'1px solid #bbf7d0',borderRadius:10,padding:'10px 14px',fontSize:12,color:'#15803d',fontWeight:700}}>
                    ℹ️ Payroll Voucher — Payment bank is resolved per payroll line. Add payroll lines manually or import from your Payroll module.
                  </div>
                )}
                {form.voucherType === 'FINAL_PAY' && (
                  <div className="field col6" style={{background:'#f0f9ff',border:'1px solid #bae6fd',borderRadius:10,padding:'10px 14px',fontSize:12,color:'#0369a1',fontWeight:700}}>
                    ℹ️ Final Pay Voucher — Payment bank is resolved per employee line. Add final pay lines manually.
                  </div>
                )}
                {isLoan && (
                  <div className="field col6" style={{background:'#fdf4ff',border:'1px solid #e9d5ff',borderRadius:10,padding:'10px 14px',fontSize:12,color:'#7c3aed',fontWeight:700}}>
                    ℹ️ Loan Voucher — Used to record loan releases or amortization payments.
                  </div>
                )}
                <div className="field col6">
                  <label>Notes</label>
                  <textarea rows={2} value={form.notes||''} onChange={e=>setForm(f=>({...f,notes:e.target.value}))} />
                </div>
              </div>

              {/* Payment Details */}
              <div className="section-title">Payment Details</div>
              <table className="lines-tbl" style={{fontSize:12,marginBottom:8}}>
                <thead>
                  <tr>
                    <th style={{width:28}}>#</th>
                    <th>Contact</th>
                    <th>Account</th>
                    <th>Description</th>
                    {isAutoBank && <th style={{width:100}}>Category</th>}
                    {showTax && <th style={{minWidth:160}}>Tax Rate</th>}
                    <th style={{textAlign:'right',width:110}}>Amount</th>
                    {showTax && <th style={{textAlign:'right',width:90}}>Tax Amt</th>}
                    <th style={{width:32}}></th>
                  </tr>
                </thead>
                <tbody>
                  {lines.map((l,i) => (
                    <tr key={l.id}>
                      <td style={{textAlign:'center',color:'#94a3b8',fontWeight:700}}>{i+1}</td>
                      <td>
                        <input value={l.contact} onChange={e=>setLine(i,'contact',e.target.value)} placeholder="Contact name" list={`clist-${i}`} />
                        <datalist id={`clist-${i}`}>{contacts.map(c=><option key={c.id} value={c.name||c.id} />)}</datalist>
                      </td>
                      <td>
                        <input value={l.expenseAccount} onChange={e=>setLine(i,'expenseAccount',e.target.value)} placeholder="Account code / name" list={`alist-${i}`} />
                        <datalist id={`alist-${i}`}>{accounts.map(a=><option key={a.id} value={a.code||a.id}>{a.code} — {a.name}</option>)}</datalist>
                      </td>
                      <td><input value={l.description} onChange={e=>setLine(i,'description',e.target.value)} placeholder="Description" /></td>
                      {isAutoBank && (
                        <td>
                          <select value={l.category||'Deployed'} onChange={e=>setLine(i,'category',e.target.value)}>
                            <option>Head Office</option>
                            <option>Deployed</option>
                            <option>Other</option>
                          </select>
                        </td>
                      )}
                      {showTax && (
                        <td style={{minWidth:160}}>
                          <select value={l.taxRateId||''} onChange={e=>setLine(i,'taxRateId',e.target.value)} style={{marginBottom:3}}>
                            <option value="">N/A</option>
                            {taxRates.map(r=><option key={r.id} value={r.id}>{r.name} ({r.rate}%)</option>)}
                          </select>
                          {l.taxRateId && (
                            <label style={{fontSize:10,display:'flex',alignItems:'center',gap:4,cursor:'pointer',marginTop:2}}>
                              <input type="checkbox" checked={!!l.inclusive} onChange={e=>setLine(i,'inclusive',e.target.checked)} />
                              Inclusive
                            </label>
                          )}
                        </td>
                      )}
                      <td><input type="number" style={{textAlign:'right'}} value={l.amount} onChange={e=>setLine(i,'amount',e.target.value)} placeholder="0.00" /></td>
                      {showTax && (
                        <td style={{textAlign:'right',color:'#7c3aed',fontWeight:700,fontSize:12,whiteSpace:'nowrap'}}>{l.taxAmt>0?fmt(l.taxAmt):'—'}</td>
                      )}
                      <td><button className="btn btn-ghost btn-xs" style={{color:'#dc2626'}} onClick={()=>removeLine(i)} disabled={lines.length<=1}>✕</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <button className="btn btn-ghost btn-sm" onClick={addLine}>+ Add New Row</button>
              <div className="tfoot-row" style={{flexDirection:'column',alignItems:'flex-end',gap:4}}>
                {showTax && <div style={{display:'flex',gap:20}}><span style={{color:'#94a3b8'}}>Total Tax:</span><span style={{color:'#7c3aed'}}>{fmt(taxTotal)}</span></div>}
                <div style={{display:'flex',gap:20,fontSize:15,fontWeight:900}}><span style={{color:'#64748b'}}>NET CASH DISBURSED</span><span style={{color:'#0b1220'}}>{fmt(netCash)}</span></div>
              </div>

              {/* Auto-Generated Journal Entry */}
              <div className="section-title" style={{marginTop:20}}>Journal Entry (Auto-Generated)</div>
              <table className="lines-tbl" style={{fontSize:12,background:'#f8fafc',borderRadius:10,overflow:'hidden'}}>
                <thead>
                  <tr>
                    <th style={{width:'50%'}}>COA (Account Name)</th>
                    <th style={{textAlign:'right'}}>Debit</th>
                    <th style={{textAlign:'right'}}>Credit</th>
                  </tr>
                </thead>
                <tbody>
                  {journalLines.length === 0 ? (
                    <tr><td colSpan={3} style={{textAlign:'center',color:'#94a3b8',padding:'14px'}}>Fill out payment details to generate journal entry</td></tr>
                  ) : journalLines.map((j,i) => (
                    <tr key={i}>
                      <td style={{fontWeight:600}}>{j.account}</td>
                      <td style={{textAlign:'right',color:j.debit>0?'#15803d':'#94a3b8'}}>{j.debit>0?fmt(j.debit):'—'}</td>
                      <td style={{textAlign:'right',color:j.credit>0?'#dc2626':'#94a3b8'}}>{j.credit>0?fmt(j.credit):'—'}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr style={{background:'#e2e8f0'}}>
                    <td style={{fontWeight:900,fontSize:11,textTransform:'uppercase',letterSpacing:'.05em'}}>Total</td>
                    <td style={{textAlign:'right',fontWeight:900}}>{fmt(jDebit)}</td>
                    <td style={{textAlign:'right',fontWeight:900}}>{fmt(jCredit)}</td>
                  </tr>
                  {Math.abs(jDebit-jCredit)>0.01&&<tr><td colSpan={3} style={{color:'#dc2626',fontSize:11,fontWeight:700,textAlign:'right'}}>⚠ Entry is not balanced ({fmt(Math.abs(jDebit-jCredit))} difference)</td></tr>}
                </tfoot>
              </table>
            </div>
            <div className="modal-f">
              <button className="btn btn-ghost" onClick={()=>setShowModal(false)}>Cancel</button>
              <button className="btn btn-ghost" onClick={()=>saveVoucher('Pending')} disabled={saving}>Save Draft</button>
              <button className="btn btn-primary" onClick={()=>saveVoucher('Pending Review')} disabled={saving}>{saving?'Saving…':'Submit for Review'}</button>
            </div>
          </div>
        </div>
      )}

      {/* View Modal */}
      {viewModal && (
        <div className="backdrop" onClick={()=>setViewModal(null)}>
          <div className="modal" onClick={e=>e.stopPropagation()}>
            <div className="modal-h">
              <strong>Voucher — {viewModal.voucherId||viewModal.id}</strong>
              <div style={{display:'flex',gap:8,alignItems:'center'}}>
                <StatusPill status={viewModal.status} />
                <button className="btn btn-ghost btn-sm" onClick={()=>setViewModal(null)}>✕</button>
              </div>
            </div>
            <div className="modal-b">
              <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(180px,1fr))',gap:12,marginBottom:20}}>
                {[
                  ['Type', viewModal.voucherType],
                  ['Date', viewModal.preparationDate],
                  ['Purpose', viewModal.purposeCategory],
                  ['Payment From', viewModal.paymentFromAccountCode],
                  ['Contact', viewModal.contactSummary],
                  ['Check No.', viewModal.checkNumber||'—'],
                  ['Check Date', viewModal.checkDate||'—'],
                  ['Reviewed By', viewModal.reviewedBy||'—'],
                  ['Approved By', viewModal.approvedBy||'—'],
                  ['Created By', viewModal.createdBy||'—'],
                ].map(([k,v]) => (
                  <div key={k}><div style={{fontSize:10,fontWeight:800,color:'#94a3b8',textTransform:'uppercase',letterSpacing:'.06em',marginBottom:4}}>{k}</div><div style={{fontWeight:700}}>{v||'—'}</div></div>
                ))}
              </div>
              {viewModal.rejectReason && (
                <div style={{background:'#fef2f2',border:'1px solid #fecaca',borderRadius:10,padding:12,marginBottom:12}}>
                  <span style={{fontSize:11,fontWeight:800,color:'#dc2626'}}>REJECT REASON: </span>{viewModal.rejectReason}
                </div>
              )}
              {viewModal.notes && (
                <div style={{background:'#f8fafc',borderRadius:10,padding:12,marginBottom:12,fontSize:13}}>{viewModal.notes}</div>
              )}
              <div className="section-title">Expense Lines</div>
              {(viewModal.lines||[]).length === 0
                ? <div className="empty">No lines recorded.</div>
                : <table className="lines-tbl">
                    <thead>
                      <tr><th>#</th><th>Contact</th><th>Account</th><th>Description</th><th>Category</th><th>Tax</th><th style={{textAlign:'right'}}>Amount</th></tr>
                    </thead>
                    <tbody>
                      {(viewModal.lines||[]).map((l,i) => (
                        <tr key={i}>
                          <td>{l.lineNo||i+1}</td>
                          <td>{l.contact||'—'}</td>
                          <td>{l.expenseAccountCode||'—'}</td>
                          <td>{l.description||'—'}</td>
                          <td>{l.category||'—'}</td>
                          <td>{l.taxType||'—'}</td>
                          <td style={{textAlign:'right',fontWeight:700}}>{fmt(l.amount)}</td>
                        </tr>
                      ))}
                      <tr>
                        <td colSpan={6} style={{textAlign:'right',fontWeight:800,color:'#64748b',fontSize:12}}>TOTAL</td>
                        <td style={{textAlign:'right',fontWeight:900}}>{fmt(viewModal.totalAmount)}</td>
                      </tr>
                    </tbody>
                  </table>
              }
            </div>
            <div className="modal-f">
              {canEdit(viewModal) && <button className="btn btn-ghost" onClick={()=>{setViewModal(null);openEdit(viewModal);}}>Edit</button>}
              <button className="btn btn-ghost" onClick={()=>duplicate(viewModal)}>📋 Duplicate</button>
              <button className="btn btn-ghost" onClick={()=>setViewModal(null)}>Close</button>
            </div>
          </div>
        </div>
      )}

      {/* Status Update Modal */}
      {statusModal && (
        <div className="backdrop" onClick={()=>setStatusModal(null)}>
          <div className="modal modal-sm" onClick={e=>e.stopPropagation()}>
            <div className="modal-h">
              <strong>Update Status → {statusModal.newStatus}</strong>
              <button className="btn btn-ghost btn-sm" onClick={()=>setStatusModal(null)}>✕</button>
            </div>
            <div className="modal-b">
              <p style={{fontSize:13,marginBottom:12}}>Voucher: <strong>{statusModal.voucher.voucherId||statusModal.voucher.id}</strong></p>
              {statusModal.reason !== null && (
                <div className="field">
                  <label>Reason / Notes</label>
                  <textarea rows={3} value={statusModal.reason||''} onChange={e=>setStatusModal(s=>({...s,reason:e.target.value}))} placeholder={statusModal.newStatus === 'Rejected' ? 'Required: explain the rejection…' : 'Optional notes…'} />
                </div>
              )}
            </div>
            <div className="modal-f">
              <button className="btn btn-ghost" onClick={()=>setStatusModal(null)}>Cancel</button>
              <button className="btn btn-primary" onClick={doStatusUpdate} disabled={saving || (statusModal.newStatus==='Rejected' && !statusModal.reason?.trim())}>
                {saving ? 'Saving…' : `Confirm — ${statusModal.newStatus}`}
              </button>
            </div>
          </div>
        </div>
      )}

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
      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}

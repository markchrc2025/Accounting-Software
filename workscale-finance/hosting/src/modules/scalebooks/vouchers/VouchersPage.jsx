import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import {
  collection, query, orderBy, onSnapshot, addDoc, updateDoc, deleteDoc, doc,
  serverTimestamp, getDoc, getDocs
} from 'firebase/firestore';
import { db, auth } from '../../../firebase.js';
import AccountCombobox from '../../../components/AccountCombobox.jsx';
import ContactPicker from '../../../components/ContactPicker.jsx';
import { nextVoucherId, previewVoucherId, nextJournalEntryId } from '../../../utils/documentIds.js';
import VoucherPdfModal from './VoucherPdfModal.jsx';

const fmt  = (n) => new Intl.NumberFormat('en-PH', { style:'currency', currency:'PHP' }).format(n || 0);
const fmtP = (n) => new Intl.NumberFormat('en-PH', { minimumFractionDigits:0, maximumFractionDigits:4 }).format(n || 0) + '%';
const uid  = () => Math.random().toString(36).slice(2, 10).toUpperCase();
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
const STATUSES = ['Draft','Pending','For Verification','Verified','For Approval','Approved','Paid','Rejected','Voided'];


const STATUS_STYLES = {
  'Draft':            { background:'#f8fafc', borderColor:'#e2e8f0', color:'#64748b' },
  'Pending':          { background:'#fff7ed', borderColor:'#fed7aa', color:'#c2410c' },
  'For Verification': { background:'#fffbeb', borderColor:'#fde68a', color:'#92400e' },
  'Verified':         { background:'#f0f9ff', borderColor:'#bae6fd', color:'#0369a1' },
  'For Approval':     { background:'#eff6ff', borderColor:'#bfdbfe', color:'#1d4ed8' },
  'Approved':         { background:'#ecfdf5', borderColor:'#6ee7b7', color:'#065f46' },
  'Paid':             { background:'#f0fdf4', borderColor:'#bbf7d0', color:'#15803d' },
  'Rejected':         { background:'#fef2f2', borderColor:'#fecaca', color:'#dc2626' },
  'Voided':           { background:'#f8fafc', borderColor:'#e2e8f0', color:'#94a3b8' },
};

const EMPTY_LINE = () => ({ id: uid(), contactId:'', contact:'', expenseAccount:'', description:'', amount:'', category:'', taxRateId:'', taxType:'N/A', taxRate:0, taxAmt:0, inclusive:false });

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
  .km-item     { display:block; width:100%; background:none; border:0; text-align:left; padding:9px 16px; font-size:13px; font-family:inherit; cursor:pointer; color:#0b1220; white-space:nowrap; }
  .km-item:hover { background:#f1f5f9; }
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
  .modal    { width:min(1400px,98vw); max-height:92vh; background:#fff; border-radius:16px; display:flex; flex-direction:column; overflow:hidden; box-shadow:0 24px 64px rgba(0,0,0,.25); }
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
  const [vouchers,         setVouchers]         = useState([]);
  const [accounts,         setAccounts]         = useState([]);
  const [contacts,         setContacts]         = useState([]);
  const [taxRates,         setTaxRates]         = useState([]);
  const [taxGroups,        setTaxGroups]        = useState([]);
  const [purposeCategories, setPurposeCategories] = useState([]);
  const [loans, setLoans] = useState([]); // for LOAN voucher → loanId picker

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

  // Modals
  const [showModal,    setShowModal]   = useState(false);
  const [viewModal,    setViewModal]   = useState(null);
  const [pdfModal,     setPdfModal]    = useState(null);
  const [openMenuId,   setOpenMenuId]  = useState(null);
  const [menuPos,      setMenuPos]     = useState({ top:0, right:0 });
  const menuRef = useRef(null);

  // Close kebab menu on outside click or scroll
  useEffect(() => {
    if (!openMenuId) return;
    const close = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) setOpenMenuId(null);
    };
    const closeScroll = () => setOpenMenuId(null);
    document.addEventListener('mousedown', close);
    document.addEventListener('scroll', closeScroll, true);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('scroll', closeScroll, true);
    };
  }, [openMenuId]);

  const [newAcctModal, setNewAcctModal] = useState(null);

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
    const unsubAccounts = onSnapshot(query(collection(db,'accounts'), orderBy('code')), s => setAccounts(s.docs.map(d => ({ id:d.id, ...d.data() }))));
    const unsubContacts = onSnapshot(query(collection(db,'contacts'), orderBy('name')), snap => setContacts(snap.docs.map(d => ({ id:d.id, ...d.data() }))));
    const unsubRates  = onSnapshot(query(collection(db,'taxRates'),  orderBy('name')), snap => setTaxRates(snap.docs.map(d=>({id:d.id,...d.data()})).filter(r=>r.isActive!==false)));
    const unsubGroups = onSnapshot(query(collection(db,'taxGroups'), orderBy('name')), snap => setTaxGroups(snap.docs.map(d=>({id:d.id,...d.data()})).filter(g=>g.isActive!==false)));
    const unsubCats   = onSnapshot(query(collection(db,'purposeCategories'), orderBy('name')), snap => setPurposeCategories(snap.docs.map(d => d.data().name).filter(Boolean)));
    // Loans (for LOAN voucher loanId picker)
    getDoc(doc(db,'finc','profile')).then(snap => {
      const data = snap.data() || {};
      setLoans(Array.isArray(data.loans) ? data.loans : []);
    });
    return () => { unsub(); unsubAccounts(); unsubContacts(); unsubRates(); unsubGroups(); unsubCats(); };
  }, []);

  // Voucher IDs are assigned atomically by `nextVoucherId` at save time
  // (see saveVoucher / duplicate). The form shows a placeholder preview
  // computed from settings + the current preparation date.
  const [idPreview, setIdPreview] = useState('');
  useEffect(() => {
    if (editing) { setIdPreview(''); return; }
    if (!showModal) return;
    let cancelled = false;
    previewVoucherId(form.voucherType || 'PAYMENT', form.preparationDate)
      .then(p => { if (!cancelled) setIdPreview(p); })
      .catch(() => { if (!cancelled) setIdPreview(''); });
    return () => { cancelled = true; };
  }, [showModal, editing, form.voucherType, form.preparationDate]);

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
    const pending = vouchers.filter(v => ['Pending','For Verification','Verified','For Approval'].includes(v.status)).length;
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
      await Promise.all([...selected].map(id => updateDoc(doc(db,'vouchers',id), { status:'Pending', updatedAt:serverTimestamp(), updatedBy:user })));
      setSelected(new Set());
      showToast(`${count} voucher(s) submitted.`);
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
    setForm({ voucherType:'PAYMENT', preparationDate:today(), purposeCategory:'', paymentFrom:'', status:'Pending', notes:'', inclusive:false, loanId:'' });
    setLines([EMPTY_LINE()]);
    setShowModal(true);
  };

  const openEdit = (v) => {
    setEditing(v);
    setForm({ voucherType:v.voucherType||'PAYMENT', preparationDate:v.preparationDate||today(), purposeCategory:v.purposeCategory||'', paymentFrom:v.paymentFromAccountCode||'', status:v.status||'Pending', notes:v.notes||'', inclusive: !!(v.lines||[]).find(l=>l.taxRateId)?.inclusive, loanId: v.loanId || '' });
    setLines((v.lines||[]).map(l => ({ id:uid(), contactId:l.contactId||'', contact:l.contact||'', expenseAccount:l.expenseAccountCode||'', description:l.description||'', amount:String(l.amount||''), category:l.category||'', taxRateId:l.taxRateId||'', taxType:l.taxType||'N/A', taxRate:l.taxRate||0, taxAmt:l.taxAmt||0, inclusive:l.inclusive||false })));
    if ((v.lines||[]).length === 0) setLines([EMPTY_LINE()]);
    setShowModal(true);
  };

  const duplicate = async (v) => {
    const newId = await nextVoucherId(v.voucherType||'PAYMENT', today());
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
    const status = newStatus || form.status;
    const payload = {
      voucherType:           form.voucherType,
      preparationDate:       form.preparationDate,
      purposeCategory:       form.purposeCategory,
      paymentFromAccountCode:form.paymentFrom,
      contactSummary,
      totalAmount,
      status,
      notes:                 form.notes||'',
      loanId: form.voucherType === 'LOAN' ? (form.loanId || '') : '',
      lines: lines.map((l,i) => ({ lineNo:i+1, contactId:l.contactId||'', contact:l.contact, expenseAccountCode:l.expenseAccount, description:l.description, amount:Number(l.amount)||0, category:l.category, taxRateId:l.taxRateId||'', taxType:l.taxType||'N/A', taxRate:Number(l.taxRate)||0, taxAmt:Number(l.taxAmt)||0, inclusive:!!l.inclusive })),
      updatedAt: serverTimestamp(), updatedBy: user
    };

    // Build JE lines from current journalLines (parse "(code) Name" format)
    const buildJeLines = () => journalLines.map(j => {
      const m = j.account.match(/^\(([^)]+)\)\s*(.*)/);
      return { accountCode: m ? m[1] : j.account, accountName: m ? m[2] : j.account, description: '', debit: j.debit, credit: j.credit };
    });

    setSaving(true);
    try {
      if (editing) {
        await updateDoc(doc(db,'vouchers',editing.id), payload);
        // Always sync JE lines if already linked
        if (editing.linkedJeId) {
          const jeLines = buildJeLines();
          await updateDoc(doc(db,'journalEntries',editing.linkedJeId), {
            lines: jeLines,
            totalDebit:  jeLines.reduce((s,l)=>s+l.debit, 0),
            totalCredit: jeLines.reduce((s,l)=>s+l.credit, 0),
            date: form.preparationDate,
            updatedAt: serverTimestamp(), updatedBy: user
          });
        }
        // Create JE if not yet linked (e.g. old voucher pre-dating this feature)
        if (!editing.linkedJeId) {
          const jeLines = buildJeLines();
          const jeId = await nextJournalEntryId(form.preparationDate);
          const voucherLabel = VOUCHER_TYPES.find(t=>t.value===form.voucherType)?.label || form.voucherType;
          const jeRef = await addDoc(collection(db,'journalEntries'), {
            jeId, date: form.preparationDate,
            description: `${voucherLabel} ${editing.voucherId||''}${form.purposeCategory?' — '+form.purposeCategory:''}`,
            type: 'Voucher', reference: editing.voucherId||'', sourceDocId: editing.id, sourceDocType: 'voucher',
            status: 'For Clearing',
            lines: jeLines, totalDebit: jeLines.reduce((s,l)=>s+l.debit,0), totalCredit: jeLines.reduce((s,l)=>s+l.credit,0),
            createdAt: serverTimestamp(), createdBy: user, updatedAt: serverTimestamp(), updatedBy: user
          });
          await updateDoc(doc(db,'vouchers',editing.id), { linkedJeId: jeRef.id });
        }
        showToast('Voucher updated.');
      } else {
        const voucherId = await nextVoucherId(form.voucherType, form.preparationDate);
        const voucherRef = await addDoc(collection(db,'vouchers'), { ...payload, voucherId, createdAt:serverTimestamp(), createdBy:user });
        // Always auto-create JE immediately on voucher creation
        const jeLines = buildJeLines();
        const jeId = await nextJournalEntryId(form.preparationDate);
        const voucherLabel = VOUCHER_TYPES.find(t=>t.value===form.voucherType)?.label || form.voucherType;
        const jeRef = await addDoc(collection(db,'journalEntries'), {
          jeId, date: form.preparationDate,
          description: `${voucherLabel} ${voucherId}${form.purposeCategory?' — '+form.purposeCategory:''}`,
          type: 'Voucher', reference: voucherId, sourceDocId: voucherRef.id, sourceDocType: 'voucher',
          status: 'For Clearing',
          lines: jeLines, totalDebit: jeLines.reduce((s,l)=>s+l.debit,0), totalCredit: jeLines.reduce((s,l)=>s+l.credit,0),
          createdAt: serverTimestamp(), createdBy: user, updatedAt: serverTimestamp(), updatedBy: user
        });
        await updateDoc(voucherRef, { linkedJeId: jeRef.id });
        showToast('Voucher created.');
      }
      setShowModal(false);
    } catch(e) { showToast('Error: ' + e.message); }
    setSaving(false);
  };

  const handleSaveNewAcct = async () => {
    if (!newAcctModal.code.trim() || !newAcctModal.name.trim()) { showToast('Account code and name are required.'); return; }
    setNewAcctModal(m => ({...m, saving:true}));
    try {
      await addDoc(collection(db,'accounts'), {
        code:      newAcctModal.code.trim(),
        name:      newAcctModal.name.trim(),
        type:      newAcctModal.type,
        subType:   newAcctModal.subType,
        parent:    newAcctModal.parent || '',
        createdAt: serverTimestamp(), createdBy: user,
      });
      showToast(`Account ${newAcctModal.code.trim()} created.`);
      setNewAcctModal(null);
    } catch(e) { showToast('Error: ' + e.message); setNewAcctModal(m => ({...m, saving:false})); }
  };

  const sortIcon = (col) => sortCol === col ? (sortDir === 'asc' ? ' ▲' : ' ▼') : '';

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

  // Line helpers
  const setLine = (i, key, val) => setLines(prev => prev.map((l,idx) => {
    if (idx !== i) return l;
    const updated = {...l, [key]:val};
    // When taxRateId changes, auto-fill taxType & rate
    if (key === 'taxRateId') {
      const item = taxRegistry.find(r => r.id === val);
      if (item) { updated.taxType = item.name; updated.taxRate = item.rate || 0; }
      else { updated.taxType = 'N/A'; updated.taxRate = 0; }
    }
    // Recalc tax amount
    const amt = Number(updated.amount)||0;
    const rate = Number(updated.taxRate)||0;
    updated.taxAmt = updated.taxRateId ? (form.inclusive ? amt - amt/(1+rate/100) : amt*(rate/100)) : 0;
    updated.taxAmt = Math.round(updated.taxAmt*100)/100;
    return updated;
  }));
  const addLine = () => setLines(prev => [...prev, EMPTY_LINE()]);
  const removeLine = (i) => setLines(prev => prev.filter((_,idx) => idx !== i));

  // Global inclusive toggle — recalculates taxAmt on all lines
  const handleInclusiveToggle = (checked) => {
    setForm(f => ({...f, inclusive: checked}));
    setLines(prev => prev.map(l => {
      const amt  = Number(l.amount) || 0;
      const rate = Number(l.taxRate) || 0;
      const taxAmt = l.taxRateId ? (checked ? amt - amt/(1+rate/100) : amt*(rate/100)) : 0;
      return {...l, taxAmt: Math.round(taxAmt*100)/100};
    }));
  };

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

    // Get display label for a taxRate doc
    // Payment Vouchers are purchases → use taxAccountPurchases for separate tracking
    const taxRateLabel = (rateDoc) => {
      const raw = rateDoc.trackingType === 'separate'
        ? (rateDoc.taxAccountPurchases || rateDoc.taxAccountSingle || '')
        : (rateDoc.taxAccountSingle || '');
      return raw ? acctLabel(raw) : `Tax — ${rateDoc.name}`;
    };

    let bankCreditTotal = 0;

    lines.forEach(l => {
      const amt = Number(l.amount) || 0;
      const tax = Number(l.taxAmt)  || 0;
      if (!amt) return;

      // 1. Expense debit (net of inclusive tax)
      const expenseAmt = (tax > 0 && form.inclusive) ? amt - tax : amt;
      if (l.expenseAccount) {
        jl.push({ account: acctLabel(l.expenseAccount), debit: expenseAmt, credit: 0 });
      }

      // 2. Tax debit lines
      if (tax > 0 && l.taxRateId) {
        const rateDoc = taxRates.find(r => r.id === l.taxRateId);
        if (rateDoc) {
          // Single rate
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

      // 3. Bank credit: gross amount paid (inclusive = full amt; exclusive = amt + tax)
      bankCreditTotal += form.inclusive ? amt : amt + tax;
    });

    // 4. Bank / Cash credit
    const bankAcct = bankAccounts.find(a => a.code === form.paymentFrom || a.id === form.paymentFrom);
    const bankLabel = bankAcct
      ? acctLabel(`${bankAcct.code} — ${bankAcct.name}`)
      : (form.paymentFrom || 'Cash / Bank');
    if (bankCreditTotal > 0) jl.push({ account: bankLabel, debit: 0, credit: bankCreditTotal });

    return jl;
  }, [lines, form.paymentFrom, form.inclusive, bankAccounts, taxRates, taxGroups, accounts]);

  const jDebit  = journalLines.reduce((s,j)=>s+j.debit,0);
  const jCredit = journalLines.reduce((s,j)=>s+j.credit,0);

  const canEdit = (v) => ['Draft','Pending'].includes(v.status);

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
        {/* ── Primary KPI Scorecards ─────────────────────────────────────── */}
        <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(200px,1fr))',gap:14,marginBottom:12}}>
          <div style={{background:'linear-gradient(135deg,#1e40af 0%,#2563eb 100%)',borderRadius:14,padding:'18px 20px',color:'#fff',position:'relative',overflow:'hidden'}}>
            <div style={{position:'absolute',right:-8,top:-8,opacity:.13}}>
              <svg width="56" height="56" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"><path d="M12 1v22M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6"/></svg>
            </div>
            <div style={{fontSize:10,fontWeight:800,letterSpacing:'.08em',textTransform:'uppercase',opacity:.8,marginBottom:6}}>Total Active Amount</div>
            <div style={{fontSize:22,fontWeight:900,letterSpacing:'-.5px'}}>{fmt(kpis.totalAmt)}</div>
            <div style={{marginTop:10,fontSize:11,opacity:.8}}>Across {kpis.total} voucher{kpis.total!==1?'s':''}</div>
          </div>
          <div style={{background:'linear-gradient(135deg,#166534 0%,#16a34a 100%)',borderRadius:14,padding:'18px 20px',color:'#fff',position:'relative',overflow:'hidden'}}>
            <div style={{position:'absolute',right:-8,top:-8,opacity:.13}}>
              <svg width="56" height="56" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"><path d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z"/></svg>
            </div>
            <div style={{fontSize:10,fontWeight:800,letterSpacing:'.08em',textTransform:'uppercase',opacity:.8,marginBottom:6}}>Approved</div>
            <div style={{fontSize:22,fontWeight:900,letterSpacing:'-.5px'}}>{kpis.approved}</div>
            <div style={{marginTop:10,fontSize:11,opacity:.8}}>Ready for disbursement</div>
          </div>
          <div style={{background:'linear-gradient(135deg,#b45309 0%,#d97706 100%)',borderRadius:14,padding:'18px 20px',color:'#fff',position:'relative',overflow:'hidden'}}>
            <div style={{position:'absolute',right:-8,top:-8,opacity:.13}}>
              <svg width="56" height="56" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 8v4l3 3"/></svg>
            </div>
            <div style={{fontSize:10,fontWeight:800,letterSpacing:'.08em',textTransform:'uppercase',opacity:.8,marginBottom:6}}>Pending / In-Review</div>
            <div style={{fontSize:22,fontWeight:900,letterSpacing:'-.5px'}}>{kpis.pending}</div>
            <div style={{marginTop:10,fontSize:11,opacity:.8}}>Awaiting approval</div>
          </div>
        </div>
        {/* ── Secondary KPI Row ─────────────────────────────────────────── */}
        <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(140px,1fr))',gap:10,marginBottom:16}}>
          {[
            {label:'Total Vouchers',value:kpis.total,sub:'all vouchers',color:'#1d4ed8',bg:'#eff6ff',border:'#bfdbfe',icon:<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><path d="M14 2v6h6M16 13H8M16 17H8M10 9H8"/></svg>},
            {label:'Paid',value:kpis.paid,sub:'fully disbursed',color:'#15803d',bg:'#f0fdf4',border:'#bbf7d0',icon:<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"><path d="M5 13l4 4L19 7"/></svg>},
            {label:'Voided',value:vouchers.filter(v=>v.status==='Voided').length,sub:'cancelled entries',color:'#dc2626',bg:'#fef2f2',border:'#fecaca',icon:<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><path d="M15 9l-6 6M9 9l6 6"/></svg>},
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
                return (
                  <tr key={v.id} style={{cursor:'pointer'}}>
                    <td style={{textAlign:'center'}} onClick={e=>e.stopPropagation()}>
                      <input type="checkbox" checked={selected.has(v.id)} onChange={()=>toggleSel(v.id)} />
                    </td>
                    <td>
                      <a style={{fontWeight:900,color:'#f97316',textDecoration:'underline',cursor:'pointer'}} onClick={()=>setPdfModal(v)}>
                        {v.voucherId || v.id}
                      </a>
                    </td>
                    <td><span style={{fontSize:11,fontWeight:700,background:'#f1f5f9',padding:'2px 8px',borderRadius:6}}>{v.voucherType||'—'}</span></td>
                    <td>{v.preparationDate||'—'}</td>
                    <td style={{maxWidth:160,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{v.contactSummary||'—'}</td>
                    <td style={{textAlign:'right',fontWeight:700}}>{fmt(v.totalAmount)}</td>
                    <td><StatusPill status={v.status} /></td>
                    <td style={{textAlign:'center'}} onClick={e=>e.stopPropagation()}>
                      <div style={{display:'inline-block'}} ref={openMenuId===v.id ? menuRef : null}>
                        <button
                          className="btn btn-ghost btn-xs"
                          style={{fontWeight:900,letterSpacing:2,padding:'4px 10px',fontSize:15,lineHeight:1}}
                          onClick={(e)=>{
                            if (openMenuId===v.id) { setOpenMenuId(null); return; }
                            const rect = e.currentTarget.getBoundingClientRect();
                            setMenuPos({ top: rect.bottom + 4, right: window.innerWidth - rect.right });
                            setOpenMenuId(v.id);
                          }}
                          title="Actions"
                        >···</button>
                        {openMenuId === v.id && (
                          <div style={{
                            position:'fixed',right:menuPos.right,top:menuPos.top,zIndex:9999,
                            background:'#fff',border:'1px solid #e5e7eb',borderRadius:10,
                            boxShadow:'0 8px 24px rgba(0,0,0,.12)',minWidth:140,padding:'4px 0',
                          }}>
                            <button className="km-item" onClick={()=>{setViewModal(v);setOpenMenuId(null);}}>
                              👁 View
                            </button>
                            <button className="km-item" onClick={()=>{setPdfModal(v);setOpenMenuId(null);}}>
                              📄 Download PDF
                            </button>
                            {canEdit(v) && (
                              <button className="km-item" onClick={()=>{openEdit(v);setOpenMenuId(null);}}>
                                ✏️ Edit
                              </button>
                            )}
                            <button className="km-item" onClick={()=>{duplicate(v);setOpenMenuId(null);}}>
                              📋 Duplicate
                            </button>
                            {v.status === 'Draft' && (
                              <button className="km-item" style={{color:'#dc2626'}} onClick={()=>{deleteVoucher(v);setOpenMenuId(null);}}>
                                🗑 Delete
                              </button>
                            )}
                          </div>
                        )}
                      </div>
                    </td>
                  </tr>
                );
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

      {/* PDF Preview Modal */}
      {pdfModal && (
        <VoucherPdfModal
          voucher={pdfModal}
          onClose={() => setPdfModal(null)}
        />
      )}

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
                  <input readOnly value={editing ? (editing.voucherId||editing.id) : (idPreview || 'Auto-assigned on save')} style={{background:'#f8fafc',color:'#64748b',fontWeight:700}} />
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
                    <datalist id="purpose-suggestions">{purposeCategories.map(s=><option key={s} value={s} />)}</datalist>
                  </div>
                )}

                {/* Payment From — hidden for PAYROLL/FINAL_PAY (bank auto-resolved per line) */}
                {!isAutoBank && (
                  <div className="field col2">
                    <label>Payment From (Bank)</label>
                    <AccountCombobox
                      options={[
                        ...bankAccounts.map(a=>({value:a.code||a.id,label:`${a.code} — ${a.name}`})),
                        ...(bankAccounts.length===0 ? accounts.map(a=>({value:a.code||a.id,label:`${a.code} — ${a.name}`})) : []),
                      ]}
                      value={form.paymentFrom||''}
                      onChange={v=>setForm(f=>({...f,paymentFrom:v}))}
                      placeholder="— Select Account —"
                    />
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
                  <>
                    <div className="field col6" style={{background:'#fdf4ff',border:'1px solid #e9d5ff',borderRadius:10,padding:'10px 14px',fontSize:12,color:'#7c3aed',fontWeight:700}}>
                      ℹ️ Loan Voucher — Used to record loan releases or amortization payments. When this voucher is paid through a Disbursement Report, a payment will auto-post to <strong>Loan Monitoring</strong>.
                    </div>
                    <div className="field col3">
                      <label>Linked Loan</label>
                      <select value={form.loanId||''} onChange={e=>setForm(f=>({...f,loanId:e.target.value}))}>
                        <option value="">— None (skip auto-post) —</option>
                        {loans.filter(l=>l.status!=='Disposed').map(l => (
                          <option key={l.id} value={l.id}>{l.name||`Loan ${l.id}`} — {l.loanType||'Loan'}</option>
                        ))}
                      </select>
                    </div>
                    <div className="field col3" style={{justifyContent:'flex-end'}}>
                      <label>&nbsp;</label>
                      <div style={{fontSize:11,color:'#64748b',fontWeight:600,padding:'9px 0'}}>
                        {form.loanId
                          ? <>✅ Auto-post enabled. Tag lines with category <code>Finance Cost</code> (interest) or <code>Loans Payable</code> (principal) for accurate split.</>
                          : 'No loan linked — payment will not auto-post.'}
                      </div>
                    </div>
                  </>
                )}
                <div className="field col6">
                  <label>Notes</label>
                  <textarea rows={2} value={form.notes||''} onChange={e=>setForm(f=>({...f,notes:e.target.value}))} />
                </div>
              </div>

              {/* Payment Details */}
              <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginTop:20,marginBottom:0}}>
                <div className="section-title" style={{margin:0}}>Payment Details</div>
                {showTax && (
                  <label style={{display:'flex',alignItems:'center',gap:6,cursor:'pointer',fontSize:12,fontWeight:700,color:'#64748b',userSelect:'none'}}>
                    <input type="checkbox" checked={!!form.inclusive} onChange={e=>handleInclusiveToggle(e.target.checked)}
                      style={{width:'auto',accentColor:'#f97316',cursor:'pointer'}} />
                    Tax amounts are inclusive
                  </label>
                )}
              </div>
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
                        <ContactPicker
                          contacts={contacts}
                          value={l.contactId}
                          displayName={l.contact}
                          defaultNewType={form.voucherType==='PAYROLL'||form.voucherType==='FINAL_PAY' ? 'Employee' : 'Supplier'}
                          onChange={({contactId, contactName})=>{ setLine(i,'contactId',contactId); setLine(i,'contact',contactName); }}
                          compact
                        />
                      </td>
                      <td>
                        <AccountCombobox
                          rawAccounts={accounts}
                          value={l.expenseAccount}
                          onChange={v=>setLine(i,'expenseAccount',v)}
                          placeholder="— Select Account —"
                          onNewAccount={()=>setNewAcctModal({code:'',name:'',type:'Expense',subType:'General and Administrative Expenses',parent:'',saving:false})}
                        />
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
                            {taxRates.length > 0 && <optgroup label="— Rates —">{taxRates.map(r=><option key={r.id} value={r.id}>{r.name} ({fmtP(r.rate)})</option>)}</optgroup>}
                            {taxGroups.length > 0 && <optgroup label="— Groups —">{taxGroups.map(g=><option key={g.id} value={g.id}>{g.name}</option>)}</optgroup>}
                          </select>
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
                      <td style={{fontWeight:600, paddingLeft: j.credit > 0 ? 28 : 8}}>{j.account}</td>
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
              <button className="btn btn-ghost" onClick={()=>saveVoucher('Draft')} disabled={saving}>Save Draft</button>
              <button className="btn btn-primary" onClick={()=>saveVoucher('Pending')} disabled={saving}>{saving?'Saving…':'Submit'}</button>
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
      {/* New Account Modal */}
      {newAcctModal && (
        <div className="backdrop" onClick={()=>setNewAcctModal(null)}>
          <div className="modal modal-sm" onClick={e=>e.stopPropagation()}>
            <div className="modal-h">
              <strong>New Account</strong>
              <button className="btn btn-ghost btn-sm" onClick={()=>setNewAcctModal(null)}>✕</button>
            </div>
            <div className="modal-b" style={{display:'flex',flexDirection:'column',gap:12}}>
              <div className="field">
                <label>Account Code <span style={{color:'#ef4444'}}>*</span></label>
                <input value={newAcctModal.code} onChange={e=>setNewAcctModal(m=>({...m,code:e.target.value}))} placeholder="e.g. 5001001" autoFocus />
              </div>
              <div className="field">
                <label>Account Name <span style={{color:'#ef4444'}}>*</span></label>
                <input value={newAcctModal.name} onChange={e=>setNewAcctModal(m=>({...m,name:e.target.value}))} placeholder="e.g. Office Supplies" />
              </div>
              <div className="field">
                <label>Type</label>
                <select value={newAcctModal.type} onChange={e=>setNewAcctModal(m=>({...m,type:e.target.value,subType:(ACCT_SUBTYPES[e.target.value]||[''])[0]}))}>                  {ACCT_TYPES.map(t=><option key={t}>{t}</option>)}
                </select>
              </div>
              <div className="field">
                <label>Sub-Type</label>
                <select value={newAcctModal.subType} onChange={e=>setNewAcctModal(m=>({...m,subType:e.target.value}))}>
                  {(ACCT_SUBTYPES[newAcctModal.type]||[]).map(s=><option key={s}>{s}</option>)}
                </select>
              </div>
              <div className="field">
                <label>Parent Account <span style={{color:'#94a3b8',fontWeight:400}}>(optional)</span></label>
                <select value={newAcctModal.parent} onChange={e=>setNewAcctModal(m=>({...m,parent:e.target.value}))}>
                  <option value="">— None —</option>
                  {accounts.filter(a=>!a.parent).sort((a,b)=>(a.code||'').localeCompare(b.code||'')).map(a=><option key={a.code||a.id} value={a.code||a.id}>[{a.code}] {a.name}</option>)}
                </select>
              </div>
            </div>
            <div className="modal-f">
              <button className="btn btn-ghost" onClick={()=>setNewAcctModal(null)}>Cancel</button>
              <button className="btn btn-primary" onClick={handleSaveNewAcct} disabled={newAcctModal.saving || !newAcctModal.code.trim() || !newAcctModal.name.trim()}>
                {newAcctModal.saving ? 'Saving…' : 'Create Account'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* New Account Modal */}
      {newAcctModal && (
        <div className="backdrop" onClick={()=>setNewAcctModal(null)}>
          <div className="modal modal-sm" onClick={e=>e.stopPropagation()}>
            <div className="modal-h">
              <strong>New Account</strong>
              <button className="btn btn-ghost btn-sm" onClick={()=>setNewAcctModal(null)}>✕</button>
            </div>
            <div className="modal-b" style={{display:'flex',flexDirection:'column',gap:12}}>
              <div className="field">
                <label>Account Code <span style={{color:'#ef4444'}}>*</span></label>
                <input value={newAcctModal.code} onChange={e=>setNewAcctModal(m=>({...m,code:e.target.value}))} placeholder="e.g. 5001001" autoFocus />
              </div>
              <div className="field">
                <label>Account Name <span style={{color:'#ef4444'}}>*</span></label>
                <input value={newAcctModal.name} onChange={e=>setNewAcctModal(m=>({...m,name:e.target.value}))} placeholder="e.g. Office Supplies" />
              </div>
              <div className="field">
                <label>Type</label>
                <select value={newAcctModal.type} onChange={e=>setNewAcctModal(m=>({...m,type:e.target.value,subType:(ACCT_SUBTYPES[e.target.value]||[''])[0]}))}>
                  {ACCT_TYPES.map(t=><option key={t}>{t}</option>)}
                </select>
              </div>
              <div className="field">
                <label>Sub-Type</label>
                <select value={newAcctModal.subType} onChange={e=>setNewAcctModal(m=>({...m,subType:e.target.value}))}>
                  {(ACCT_SUBTYPES[newAcctModal.type]||[]).map(s=><option key={s}>{s}</option>)}
                </select>
              </div>
              <div className="field">
                <label>Parent Account <span style={{color:'#94a3b8',fontWeight:400}}>(optional)</span></label>
                <select value={newAcctModal.parent} onChange={e=>setNewAcctModal(m=>({...m,parent:e.target.value}))}>
                  <option value="">— None —</option>
                  {accounts.filter(a=>!a.parent).sort((a,b)=>(a.code||'').localeCompare(b.code||'')).map(a=><option key={a.code||a.id} value={a.code||a.id}>[{a.code}] {a.name}</option>)}
                </select>
              </div>
            </div>
            <div className="modal-f">
              <button className="btn btn-ghost" onClick={()=>setNewAcctModal(null)}>Cancel</button>
              <button className="btn btn-primary" onClick={handleSaveNewAcct} disabled={newAcctModal.saving || !newAcctModal.code.trim() || !newAcctModal.name.trim()}>
                {newAcctModal.saving ? 'Saving…' : 'Create Account'}
              </button>
            </div>
          </div>
        </div>
      )}
      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}

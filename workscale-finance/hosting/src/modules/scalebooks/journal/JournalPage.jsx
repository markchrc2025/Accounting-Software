import { useState, useEffect, useMemo, useCallback } from 'react';
import { useLocation } from 'react-router-dom';
import {
  listJournalEntries, createJournalEntry, updateJournalEntry, deleteJournalEntry as apiDeleteJE,
  transitionJournalEntry, reverseJournalEntry as apiReverseJE,
  listAccounts, listContacts, ApiError,
} from '../../../lib/api.js';
import { usePermissions } from '../../../contexts/PermissionsContext.jsx';
import AccountCombobox from '../../../components/AccountCombobox.jsx';
import ContactPicker from '../../../components/ContactPicker.jsx';

const JE_TYPES = ['Manual','Adjusting','Accrual','Closing','Reversing'];
const PAGE_SIZES = [20, 50, 100];
const uid = () => Math.random().toString(36).slice(2,10).toUpperCase();

// ── API status enum <-> the UI's display labels ───────────────
const STATUS_LABEL = {
  draft:'Draft', pending_review:'Pending Review', pending_approval:'Pending Approval',
  for_clearing:'For Clearing', cleared:'Cleared', for_posting:'For Posting',
  posted:'Posted', rejected:'Rejected', voided:'Voided', reversed:'Reversed',
};
const LABEL_STATUS = Object.fromEntries(Object.entries(STATUS_LABEL).map(([k,v])=>[v,k]));

// API entry row -> the shape this screen renders (pesos, labels, flat lines).
const fromApi = (e) => ({
  id: e.id,
  jeId: e.entryNo,
  date: e.entryDate,
  description: e.memo || '',
  type: e.entryType || 'Manual',
  reference: e.reference || '',
  status: STATUS_LABEL[e.status] || e.status,
  totalDebit: (e.totalCents ?? 0) / 100,
  totalCredit: (e.totalCents ?? 0) / 100,
  createdBy: e.createdByEmail || '',
  lines: (e.lines || []).map(l => ({
    contactId: l.contactId || '', contactName: l.contactName || '',
    accountId: l.accountId, accountCode: l.accountCode || '', accountName: l.accountName || '',
    description: l.description || '',
    debit: (l.debitCents ?? 0) / 100, credit: (l.creditCents ?? 0) / 100,
  })),
});

/* Comma-formatted amount input — shows commas when blurred, raw value when editing */
function AmountInput({ value, onChange }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft]     = useState('');

  const handleFocus = () => {
    setEditing(true);
    const v = (value != null && value !== '' && Number(value) !== 0) ? String(value) : '';
    setDraft(v);
  };

  const handleChange = (e) => {
    let raw = e.target.value.replace(/[^0-9.]/g, '');
    const parts = raw.split('.');
    if (parts.length > 2) raw = parts[0] + '.' + parts.slice(1).join('');
    setDraft(raw);
    onChange(raw);
  };

  const handleBlur = () => {
    setEditing(false);
    const clean = draft.replace(/\.$/, '');
    if (clean !== draft) onChange(clean);
  };

  const display = (() => {
    if (editing) return draft;
    const v = (value != null && value !== '') ? String(value) : '';
    if (v === '' || Number(v) === 0) return '';
    const n = parseFloat(v);
    if (isNaN(n)) return '';
    const dotIdx = v.indexOf('.');
    const fractionLen = dotIdx >= 0 ? v.length - dotIdx - 1 : 0;
    return new Intl.NumberFormat('en-US', {
      minimumFractionDigits: fractionLen,
      maximumFractionDigits: 20,
    }).format(n);
  })();

  return (
    <input
      type="text"
      inputMode="decimal"
      value={display}
      onFocus={handleFocus}
      onBlur={handleBlur}
      onChange={handleChange}
      style={{ textAlign:'right', width:'100%', border:'1px solid #e5e7eb', borderRadius:6, padding:'5px 7px', fontSize:13, fontFamily:'inherit', boxSizing:'border-box' }}
    />
  );
}

const fmtPHP = n => new Intl.NumberFormat('en-PH',{minimumFractionDigits:2,maximumFractionDigits:2}).format(n||0);
const fmtCur = n => '₱' + fmtPHP(n);

const STATUS_STYLES = {
  'Draft':            {bg:'#fef9c3',border:'#fde68a',color:'#a16207'},
  'Pending Review':   {bg:'#fffbeb',border:'#fde68a',color:'#92400e'},
  'Pending Approval': {bg:'#eff6ff',border:'#bfdbfe',color:'#1d4ed8'},
  'For Clearing':     {bg:'#eff6ff',border:'#bfdbfe',color:'#1d4ed8'},
  'Cleared':          {bg:'#ecfdf5',border:'#6ee7b7',color:'#065f46'},
  'For Posting':      {bg:'#fff7ed',border:'#fed7aa',color:'#c2410c'},
  'Posted':           {bg:'#f0fdf4',border:'#bbf7d0',color:'#15803d'},
  'Reversed':         {bg:'#fff7ed',border:'#fed7aa',color:'#c2410c'},
  'Voided':           {bg:'#fef2f2',border:'#fecaca',color:'#b91c1c'},
};

const CSS = `
  .jp-wrap{display:flex;flex-direction:column;height:100%;overflow:hidden;font-family:Inter,system-ui,sans-serif;}
  .jp-topbar{display:flex;align-items:center;justify-content:space-between;padding:14px 22px 10px;flex-shrink:0;border-bottom:1px solid #e5e7eb;background:#fff;gap:12px;flex-wrap:wrap;}
  .jp-body{flex:1;overflow-y:auto;padding:16px 22px;}
  .stats-bar{display:grid;grid-template-columns:repeat(5,1fr);gap:12px;margin-bottom:16px;}
  .stat{background:#fff;border:1px solid #e5e7eb;border-radius:12px;padding:12px 16px;}
  .stat-lbl{font-size:9px;font-weight:800;color:#94a3b8;letter-spacing:.07em;text-transform:uppercase;margin-bottom:3px;}
  .stat-val{font-size:18px;font-weight:900;}
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
  .pill{display:inline-block;padding:2px 9px;border-radius:999px;font-size:11px;font-weight:700;border:1px solid;}
  .empty{padding:48px;text-align:center;color:#94a3b8;}
  .backdrop{position:fixed;inset:0;background:rgba(15,23,42,.45);display:flex;align-items:center;justify-content:center;padding:16px;z-index:100;}
  .modal{width:min(1280px,98vw);max-height:95vh;background:#fff;border-radius:16px;display:flex;flex-direction:column;overflow:hidden;box-shadow:0 24px 64px rgba(0,0,0,.25);}
  .modal-h{display:flex;align-items:center;justify-content:space-between;padding:16px 20px;border-bottom:1px solid #e5e7eb;background:#f8fafc;flex-shrink:0;}
  .modal-b{padding:20px;overflow-y:auto;flex:1;}
  .modal-f{display:flex;justify-content:space-between;align-items:center;gap:10px;padding:14px 20px;border-top:1px solid #e5e7eb;flex-shrink:0;}
  .grid4{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:12px;}
  .col2{grid-column:span 2;}.col3{grid-column:span 3;}.col4{grid-column:span 4;}
  .field{display:flex;flex-direction:column;gap:5px;}
  .field label{font-size:10px;font-weight:800;color:#64748b;letter-spacing:.06em;text-transform:uppercase;}
  .field input,.field select,.field textarea{width:100%;border:1px solid #e5e7eb;border-radius:10px;padding:9px 10px;font-size:13px;background:#fff;font-family:inherit;box-sizing:border-box;}
  .sec-hdr{font-size:11px;font-weight:900;color:#64748b;letter-spacing:.07em;text-transform:uppercase;margin:14px 0 6px;padding-bottom:4px;border-bottom:1px solid #e5e7eb;}
  .line-table{width:100%;border-collapse:collapse;}
  .line-table th{padding:4px 6px;background:#f8fafc;color:#94a3b8;font-size:9px;font-weight:800;letter-spacing:.06em;text-transform:uppercase;text-align:left;}
  .line-table td{padding:4px;border-bottom:1px solid #f1f5f9;}
  .line-table input{border:1px solid #e5e7eb;border-radius:6px;padding:5px 7px;font-size:13px;font-family:inherit;width:100%;box-sizing:border-box;}
  .balance-bar{display:flex;gap:16px;background:#f8fafc;border-radius:10px;padding:10px 14px;margin-top:10px;font-size:12px;align-items:center;}
  .je-row{background:#fff;border:1px solid #e5e7eb;border-radius:10px;margin-bottom:8px;overflow:hidden;}
  .je-hdr{display:flex;align-items:center;justify-content:space-between;padding:10px 14px;cursor:pointer;gap:8px;}
  .je-hdr:hover{background:#f8fafc;}
  .je-lines-wrap{padding:8px 14px 12px;border-top:1px solid #f1f5f9;}
  .pagination{display:flex;align-items:center;gap:6px;margin-top:14px;justify-content:center;}
  .page-btn{background:#fff;border:1px solid #e5e7eb;border-radius:8px;padding:5px 10px;font-size:12px;cursor:pointer;font-family:inherit;}
  .page-btn:disabled{color:#d1d5db;cursor:default;}
  .page-btn-active{background:#f97316;color:#fff;border-color:#f97316;}
  .toast{position:fixed;right:16px;bottom:16px;background:#0b1220;color:#fff;padding:12px 18px;border-radius:12px;font-size:13px;font-weight:600;z-index:999;}
  @media(max-width:640px){.stats-bar{grid-template-columns:repeat(2,1fr);}}
`;

export default function JournalPage() {
  const { can } = usePermissions();
  const canPost        = can('Journal', 'Poster') || can('Journal', 'Approver');
  const canApprovePost = can('Journal', 'Approver');
  const canSubmit      = can('Journal', 'Maker') || canPost;
  const [entries, setEntries]   = useState([]);
  const [expanded, setExpanded] = useState(new Set());
  const [search, setSearch]     = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [filterType, setFilterType]     = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo]     = useState('');
  const [modal, setModal]       = useState(null);
  const [lines, setLines]       = useState([]);
  const [saving, setSaving]     = useState(false);
  const [toast, setToast]       = useState('');
  const [confirmModal, setConfirmModal] = useState(null);
  const [page, setPage]         = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [selected, setSelected] = useState(new Set());
  const [accounts,  setAccounts]  = useState([]);
  const [contacts,  setContacts]  = useState([]);

  const showToast = msg => { setToast(msg); setTimeout(()=>setToast(''),3000); };
  const askConfirm = (message, onConfirm) => setConfirmModal({ message, onConfirm });

  const loadEntries = useCallback(async () => {
    try {
      const rows = await listJournalEntries({ limit: 500 });
      setEntries(rows.map(fromApi));
    } catch (e) {
      showToast(`Couldn't load entries: ${e instanceof ApiError ? e.detail : e.message}`);
    }
  }, []);

  useEffect(() => { loadEntries().then(()=>setPage(1)); }, [loadEntries]);

  useEffect(() => {
    listAccounts().then(rows => setAccounts(rows.map(a => ({ ...a, subType: a.subtype || '' })))).catch(()=>{});
    listContacts().then(rows => setContacts(rows)).catch(()=>{});
  }, []);

  /* ── Filter ────────────────────────────────────────────────── */
  const filtered = useMemo(() => entries.filter(e => {
    if (filterStatus && e.status!==filterStatus) return false;
    if (filterType && e.type!==filterType) return false;
    if (dateFrom && (e.date||'')<dateFrom) return false;
    if (dateTo && (e.date||'')>dateTo) return false;
    if (search) {
      const q=search.toLowerCase();
      if (!((e.jeId||'').toLowerCase().includes(q)||(e.description||'').toLowerCase().includes(q)||(e.createdBy||'').toLowerCase().includes(q))) return false;
    }
    return true;
  }), [entries, filterStatus, filterType, dateFrom, dateTo, search]);

  const totalPages = Math.max(1, Math.ceil(filtered.length/pageSize));
  const paginated = filtered.slice((page-1)*pageSize, page*pageSize);

  /* ── Stats ─────────────────────────────────────────────────── */
  const totalDebits  = entries.reduce((s,e)=>(e.lines||[]).reduce((ss,l)=>ss+(parseFloat(l.debit)||0),s),0);
  const totalPosted     = entries.filter(e=>e.status==='Posted').length;
  const totalCleared    = entries.filter(e=>e.status==='Cleared').length;
  const totalForClearing = entries.filter(e=>e.status==='For Clearing').length;
  const totalDraft      = entries.filter(e=>e.status==='Draft').length;
  const totalForPosting = entries.filter(e=>e.status==='For Posting').length;
  const totalEntries = entries.length;

  /* ── Toggle expand ──────────────────────────────────────────── */
  const toggleExpand = id => setExpanded(s=>{const n=new Set(s);n.has(id)?n.delete(id):n.add(id);return n;});

  /* ── Open new JE modal ──────────────────────────────────────── */
  function openNew() {
    setModal({jeId:'', date:new Date().toISOString().slice(0,10), description:'', type:'Manual', status:'Draft', reference:''});
    setLines([
      {id:uid(),contactId:'',contactName:'',accountCode:'',accountName:'',description:'',debit:'',credit:''},
      {id:uid(),contactId:'',contactName:'',accountCode:'',accountName:'',description:'',debit:'',credit:''},
    ]);
  }

  function openEdit(e) {
    setModal({...e});
    setLines((e.lines||[]).map(l=>({id:uid(),...l})));
  }

  // Open create form when navigating from CreateFlyout
  const location = useLocation();
  useEffect(() => {
    if (location.state?.openCreate) { window.history.replaceState({}, ''); openNew(); }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  /* ── Save (server assigns the number; accruals auto-create their reversal) ── */
  const apiLines = (validLines) => validLines.map(l => ({
    accountId: l.accountId || (accounts.find(a => a.code === l.accountCode)?.id),
    debitCents: Math.round((parseFloat(l.debit) || 0) * 100),
    creditCents: Math.round((parseFloat(l.credit) || 0) * 100),
    contactId: l.contactId || undefined,
    description: l.description || undefined,
  }));

  async function saveJE(form) {
    setSaving(true);
    try {
      const validLines = lines.filter(l => (parseFloat(l.debit) > 0) || (parseFloat(l.credit) > 0));
      const totalDebit  = validLines.reduce((s,l)=>s+(parseFloat(l.debit)||0),0);
      const totalCredit = validLines.reduce((s,l)=>s+(parseFloat(l.credit)||0),0);
      if (Math.abs(totalDebit-totalCredit)>0.005) { alert('Debits must equal Credits before saving.'); setSaving(false); return; }
      const payload = apiLines(validLines);
      if (payload.some(l => !l.accountId)) { showToast('Every line with an amount needs an account.'); setSaving(false); return; }

      if (form.id) {
        await updateJournalEntry(form.id, {
          entryDate: form.date, memo: form.description || null,
          entryType: form.type || 'Manual', reference: form.reference || null,
          lines: payload,
        });
        showToast('JE updated.');
      } else {
        const res = await createJournalEntry({
          entryDate: form.date, memo: form.description || undefined,
          entryType: form.type || 'Manual', reference: form.reference || undefined,
          post: false, lines: payload,
        });
        if (res.accrualReversal) {
          showToast(`Accrual JE ${res.entryNo} saved. Auto-reversal ${res.accrualReversal.entryNo} created for ${res.accrualReversal.entryDate}.`);
        } else {
          showToast(`JE ${res.entryNo} saved as draft.`);
        }
      }
      setModal(null);
      await loadEntries();
    } catch(e) {
      console.error(e);
      alert(e instanceof ApiError ? e.detail : 'Save failed.');
    }
    setSaving(false);
  }

  /* ── Workflow transitions (server enforces the whitelist + role gates) ────── */
  async function moveStatus(id, to, doneMsg) {
    try {
      await transitionJournalEntry(id, to);
      showToast(doneMsg);
      await loadEntries();
    } catch (e) {
      showToast(e instanceof ApiError ? e.detail : e.message);
    }
  }
  const postEntry   = (id) => moveStatus(id, 'pending_review', 'Submitted for approval.');
  const clearEntry  = (id) => moveStatus(id, 'cleared', 'Journal Entry cleared.');
  const requestPost = (id) => moveStatus(id, 'for_posting', 'Submitted for posting.');
  const approvePost = (id) => moveStatus(id, 'posted', 'Journal Entry posted.');

  async function bulkMove(fromLabel, to, verb) {
    const ids = [...selected].filter(id => entries.find(e => e.id === id && e.status === fromLabel));
    if (!ids.length) return showToast(`No "${fromLabel}" entries selected.`);
    askConfirm(`${verb} ${ids.length} journal entr${ids.length > 1 ? 'ies' : 'y'}?`, async () => {
      const results = await Promise.allSettled(ids.map(id => transitionJournalEntry(id, to)));
      const okCount = results.filter(r => r.status === 'fulfilled').length;
      setSelected(new Set());
      showToast(okCount === ids.length
        ? `${okCount} entr${okCount > 1 ? 'ies' : 'y'} updated.`
        : `${okCount}/${ids.length} updated (${ids.length - okCount} failed).`);
      await loadEntries();
    });
  }
  const bulkSubmitForApproval = () => bulkMove('Draft', 'pending_review', 'Submit');
  const bulkClear             = () => bulkMove('For Clearing', 'cleared', 'Clear');
  const bulkSubmitForPosting  = () => bulkMove('Cleared', 'for_posting', 'Submit');
  const bulkPost              = () => bulkMove('For Posting', 'posted', 'Post');

  async function reverseEntry(e) {
    try {
      const res = await apiReverseJE(e.id);
      showToast(`Reversing entry ${res.entryNo} posted.`);
      await loadEntries();
    } catch (err) {
      showToast(err instanceof ApiError ? err.detail : err.message);
    }
  }

  function deleteEntry(id) {
    askConfirm('Delete this journal entry?', async () => {
      try {
        await apiDeleteJE(id);
        showToast('Journal entry deleted.');
        await loadEntries();
      } catch (e) {
        showToast(e instanceof ApiError ? e.detail : e.message);
      }
    });
  }

  /* ── Line helpers ───────────────────────────────────────────── */
  const updLine=(id,k,v)=>setLines(ls=>ls.map(l=>l.id===id?{...l,[k]:v}:l));
  const updLineAccount=(id,code)=>{const acct=accounts.find(a=>(a.code||a.id)===code);setLines(ls=>ls.map(l=>l.id===id?{...l,accountCode:code,accountName:acct?.name||''}:l));};
  const addLine=()=>setLines(ls=>[...ls,{id:uid(),contactId:'',contactName:'',accountCode:'',accountName:'',description:'',debit:'',credit:''}]);
  const removeLine=id=>setLines(ls=>ls.filter(l=>l.id!==id));
  const totalDebit=lines.reduce((s,l)=>s+(parseFloat(l.debit)||0),0);
  const totalCredit=lines.reduce((s,l)=>s+(parseFloat(l.credit)||0),0);
  const isBalanced=Math.abs(totalDebit-totalCredit)<0.005&&totalDebit>0;

  /* ══ JE Form Modal ════════════════════════════════════════════ */
  function JEModal() {
    if (!modal) return null;
    const isEdit=!!modal.id;
    const ss=STATUS_STYLES[modal.status]||STATUS_STYLES.Draft;
    return (
      <div className="backdrop" onClick={e=>e.target===e.currentTarget&&setModal(null)}>
        <div className="modal">
          <div className="modal-h">
            <strong>{isEdit?`Edit JE — ${modal.jeId||''}`:modal.jeId||'New Journal Entry'}</strong>
            <div style={{display:'flex',gap:8,alignItems:'center'}}>
              <span className="pill" style={{background:ss.bg,borderColor:ss.border,color:ss.color}}>{modal.status}</span>
              <button className="btn btn-ghost btn-sm" onClick={()=>setModal(null)}>✕</button>
            </div>
          </div>
          <div className="modal-b">
            <div className="grid4">
              <div className="field"><label>JE ID</label><input value={modal.jeId} placeholder="Auto-assigned on save" readOnly /></div>
              <div className="field"><label>Date *</label><input type="date" value={modal.date} onChange={e=>setModal(m=>({...m,date:e.target.value}))} /></div>
              <div className="field"><label>Type</label><select value={modal.type||'Manual'} onChange={e=>setModal(m=>({...m,type:e.target.value}))}>{JE_TYPES.map(t=><option key={t}>{t}</option>)}</select></div>
              <div className="field"><label>Reference</label><input value={modal.reference||''} onChange={e=>setModal(m=>({...m,reference:e.target.value}))} /></div>
              {modal.type==='Accrual'&&!modal.id&&(()=>{
                const [yr,mo]=(modal.date||new Date().toISOString().slice(0,10)).split('-').map(Number);
                const revY=mo===12?yr+1:yr; const revM=mo===12?1:mo+1;
                const revDate=`${revY}-${String(revM).padStart(2,'0')}-01`;
                return <div className="col4" style={{background:'#eff6ff',border:'1px solid #bfdbfe',borderRadius:8,padding:'8px 12px',fontSize:12,color:'#1d4ed8',display:'flex',alignItems:'center',gap:6}}>
                  <span>🔄</span><span>A reversing entry (ACJE) will be auto-created on <strong>{revDate}</strong> when saved.</span>
                </div>;
              })()}
              <div className="field col4"><label>Description *</label><input value={modal.description} onChange={e=>setModal(m=>({...m,description:e.target.value}))} /></div>
            </div>
            <div className="sec-hdr">Journal Lines</div>
            <div style={{overflowX:'auto'}}>
              <table className="line-table">
                <thead><tr>
                  <th style={{width:'22%'}}>Contact</th>
                  <th style={{width:'25%'}}>Account</th>
                  <th style={{width:'20%'}}>Description</th>
                  <th style={{width:'13%',textAlign:'right'}}>Debit</th>
                  <th style={{width:'13%',textAlign:'right'}}>Credit</th>
                  <th style={{width:'5%'}}></th>
                </tr></thead>
                <tbody>
                  {lines.map(l=>(
                    <tr key={l.id}>
                      <td><ContactPicker contacts={contacts} value={l.contactId} displayName={l.contactName} onChange={({contactId,contactName})=>setLines(ls=>ls.map(x=>x.id===l.id?{...x,contactId,contactName}:x))} compact placeholder="— Contact —" /></td>
                      <td><AccountCombobox rawAccounts={accounts} value={l.accountCode} onChange={code=>updLineAccount(l.id,code)} placeholder="— Select Account —" style={{fontSize:11}} /></td>
                      <td><input value={l.description} onChange={e=>updLine(l.id,'description',e.target.value)} /></td>
                      <td><AmountInput value={l.debit} onChange={raw=>{updLine(l.id,'debit',raw);if(parseFloat(raw)>0) updLine(l.id,'credit','');}} /></td>
                      <td><AmountInput value={l.credit} onChange={raw=>{updLine(l.id,'credit',raw);if(parseFloat(raw)>0) updLine(l.id,'debit','');}} /></td>
                      <td><button onClick={()=>removeLine(l.id)} style={{background:'none',border:'none',color:'#dc2626',cursor:'pointer',fontWeight:900,fontSize:14,padding:'0 4px'}}>✕</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <button className="btn btn-ghost btn-sm" style={{marginTop:6}} onClick={addLine}>+ Add Line</button>
            <div className="balance-bar">
              <span style={{flex:1}}>Total Debit: <strong style={{color:'#dc2626'}}>{fmtCur(totalDebit)}</strong></span>
              <span style={{flex:1}}>Total Credit: <strong style={{color:'#15803d'}}>{fmtCur(totalCredit)}</strong></span>
              <span style={{fontWeight:900,color:isBalanced?'#15803d':'#dc2626'}}>
                {isBalanced?'✅ Balanced':`⚠ Out of balance by ${fmtCur(Math.abs(totalDebit-totalCredit))}`}
              </span>
            </div>
          </div>
          <div className="modal-f">
            <div style={{fontSize:12,color:'#64748b'}}>{lines.length} line{lines.length!==1?'s':''}</div>
            <div style={{display:'flex',gap:8}}>
              <button className="btn btn-ghost" onClick={()=>setModal(null)}>Cancel</button>
              <button className="btn btn-primary" disabled={saving||!isBalanced} onClick={()=>saveJE(modal)} title={isBalanced?'':'Balance debits and credits first'}>{saving?'Saving…':'Save'}</button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="jp-wrap">
      <style>{CSS}</style>
      <div className="jp-topbar">
        <div>
          <h1 style={{margin:0,fontSize:18,fontWeight:900}}>Journal Entries</h1>
          <p style={{margin:0,fontSize:12,color:'#64748b'}}>{totalEntries} entries · {totalForClearing} for clearing · {totalCleared} cleared · {totalForPosting} for posting · {totalPosted} posted</p>
        </div>
        <button className="btn btn-primary" onClick={openNew}>+ New JE</button>
      </div>
      <div className="jp-body">
        {/* Stats */}
        <div className="stats-bar">
          <div className="stat"><div className="stat-lbl">Total Entries</div><div className="stat-val">{totalEntries}</div></div>
          <div className="stat"><div className="stat-lbl">For Clearing</div><div className="stat-val" style={{color:'#1d4ed8'}}>{totalForClearing}</div></div>
          <div className="stat"><div className="stat-lbl">Cleared</div><div className="stat-val" style={{color:'#065f46'}}>{totalCleared}</div></div>
          <div className="stat"><div className="stat-lbl">For Posting</div><div className="stat-val" style={{color:'#c2410c'}}>{totalForPosting}</div></div>
          <div className="stat"><div className="stat-lbl">Posted</div><div className="stat-val" style={{color:'#15803d'}}>{totalPosted}</div></div>
        </div>
        {/* Filters */}
        <div className="filters">
          <input placeholder="Search JE ID, description, user…" value={search} onChange={e=>{setSearch(e.target.value);setPage(1);}} style={{minWidth:200}} />
          <select value={filterStatus} onChange={e=>{setFilterStatus(e.target.value);setPage(1);}}>
            <option value="">All Statuses</option>
            {Object.keys(STATUS_STYLES).map(s=><option key={s}>{s}</option>)}
          </select>
          <select value={filterType} onChange={e=>{setFilterType(e.target.value);setPage(1);}}>
            <option value="">All Types</option>
            {JE_TYPES.map(t=><option key={t}>{t}</option>)}
          </select>
          <input type="date" value={dateFrom} onChange={e=>{setDateFrom(e.target.value);setPage(1);}} title="From date" />
          <input type="date" value={dateTo} onChange={e=>{setDateTo(e.target.value);setPage(1);}} title="To date" />
          {(search||filterStatus||filterType||dateFrom||dateTo)&&<button className="btn btn-ghost btn-sm" onClick={()=>{setSearch('');setFilterStatus('');setFilterType('');setDateFrom('');setDateTo('');setPage(1);}}>Clear</button>}
          <select value={pageSize} onChange={e=>{setPageSize(Number(e.target.value));setPage(1);}} style={{marginLeft:'auto'}}>
            {PAGE_SIZES.map(n=><option key={n} value={n}>{n} per page</option>)}
          </select>
          <span style={{fontSize:12,color:'#64748b'}}>{filtered.length} result{filtered.length!==1?'s':''}</span>
        </div>
        {/* Bulk action bar */}
        {selected.size > 0 && (
          <div style={{display:'flex',alignItems:'center',gap:10,padding:'8px 14px',background:'#eff6ff',border:'1px solid #bfdbfe',borderRadius:10,marginBottom:10,flexWrap:'wrap'}}>
            <span style={{fontSize:13,fontWeight:700,color:'#1d4ed8'}}>{selected.size} selected</span>
            {[...selected].some(id=>entries.find(e=>e.id===id&&e.status==='Draft'))&&canSubmit&&(
              <button className="btn btn-ghost btn-sm" style={{borderColor:'#fde68a',color:'#92400e'}} onClick={bulkSubmitForApproval}>Bulk Submit for Approval</button>
            )}
            {[...selected].some(id=>entries.find(e=>e.id===id&&e.status==='For Clearing'))&&canPost&&(
              <button className="btn btn-ghost btn-sm" style={{borderColor:'#6ee7b7',color:'#065f46'}} onClick={bulkClear}>Bulk Clear</button>
            )}
            {[...selected].some(id=>entries.find(e=>e.id===id&&e.status==='Cleared'))&&canPost&&(
              <button className="btn btn-ghost btn-sm" style={{borderColor:'#bfdbfe',color:'#1d4ed8'}} onClick={bulkSubmitForPosting}>Bulk Submit for Posting</button>
            )}
            {[...selected].some(id=>entries.find(e=>e.id===id&&e.status==='For Posting'))&&canApprovePost&&(
              <button className="btn btn-ghost btn-sm" style={{borderColor:'#bbf7d0',color:'#15803d'}} onClick={bulkPost}>Batch Post</button>
            )}
            <button className="btn btn-ghost btn-sm" style={{marginLeft:'auto'}} onClick={()=>setSelected(new Set())}>Deselect All</button>
          </div>
        )}
        {/* List */}
        {filtered.length===0?<div className="empty">No journal entries match your filters.</div>:(
          <>
            {paginated.map(e=>{
              const ss=STATUS_STYLES[e.status]||STATUS_STYLES.Draft;
              const isOpen=expanded.has(e.id);
              return (
                <div key={e.id} className="je-row">
                  <div className="je-hdr" onClick={()=>toggleExpand(e.id)}>
                    <input type="checkbox" checked={selected.has(e.id)} onChange={()=>setSelected(prev=>{const n=new Set(prev);n.has(e.id)?n.delete(e.id):n.add(e.id);return n;})} onClick={ev=>ev.stopPropagation()} style={{marginRight:4,flexShrink:0,cursor:'pointer',width:15,height:15}} />
                    <div style={{display:'flex',gap:10,alignItems:'center',flex:1,flexWrap:'wrap'}}>
                      <span style={{fontFamily:'monospace',fontWeight:800,color:'#f97316',fontSize:12}}>{e.jeId||'—'}</span>
                      <span style={{fontWeight:600,fontSize:12}}>{e.date||'—'}</span>
                      <span style={{color:'#0b1220',fontSize:12,flex:1}}>{e.description||'—'}</span>
                      <span className="pill" style={{background:ss.bg,borderColor:ss.border,color:ss.color}}>{e.status||'Draft'}</span>
                      {e.type&&e.type!=='Manual'&&<span className="pill" style={{background:'#f8fafc',borderColor:'#e2e8f0',color:'#64748b'}}>{e.type}</span>}
                    </div>
                    <div style={{display:'flex',gap:6,alignItems:'center',flexShrink:0}}>
                      <span style={{fontWeight:700,fontSize:12,color:'#64748b'}}>{fmtCur(e.totalDebit||0)}</span>
                      <button className="btn btn-ghost btn-sm" onClick={ev=>{ev.stopPropagation();openEdit(e);}}>Edit</button>
                      {e.status==='For Clearing'&&canPost&&<button className="btn btn-ghost btn-sm" style={{borderColor:'#6ee7b7',color:'#065f46'}} onClick={ev=>{ev.stopPropagation();askConfirm('Mark this Journal Entry as Cleared?',()=>clearEntry(e.id));}}>Clear</button>}
                      {e.status==='Draft'&&canSubmit&&<button className="btn btn-ghost btn-sm" style={{borderColor:'#fde68a',color:'#92400e'}} onClick={ev=>{ev.stopPropagation();askConfirm('Submit this Journal Entry for approval?',()=>postEntry(e.id));}}>Submit for Approval</button>}
                      {e.status==='Cleared'&&canPost&&<button className="btn btn-ghost btn-sm" style={{borderColor:'#bfdbfe',color:'#1d4ed8'}} onClick={ev=>{ev.stopPropagation();askConfirm('Submit this Journal Entry for posting?',()=>requestPost(e.id));}}>Submit for Posting</button>}
                      {e.status==='For Posting'&&canApprovePost&&<button className="btn btn-ghost btn-sm" style={{borderColor:'#6ee7b7',color:'#065f46'}} onClick={ev=>{ev.stopPropagation();askConfirm('Approve and post this Journal Entry?',()=>approvePost(e.id));}}>Approve &amp; Post</button>}
                      {e.status==='Posted'&&canApprovePost&&<button className="btn btn-ghost btn-sm" style={{borderColor:'#fed7aa',color:'#c2410c'}} onClick={ev=>{ev.stopPropagation();reverseEntry(e);}}>Reverse</button>}
                      {e.status==='Draft'&&<button onClick={ev=>{ev.stopPropagation();deleteEntry(e.id);}} style={{background:'none',border:'none',color:'#dc2626',cursor:'pointer',fontWeight:900,fontSize:13,padding:'3px 5px'}}>✕</button>}
                      <span style={{color:'#94a3b8',fontSize:14}}>{isOpen?'▲':'▼'}</span>
                    </div>
                  </div>
                  {isOpen&&(
                    <div className="je-lines-wrap">
                      <table>
                        <thead><tr>
                          <th>Contact</th><th>Account Code</th><th>Account Name</th><th>Description</th>
                          <th style={{textAlign:'right'}}>Debit</th><th style={{textAlign:'right'}}>Credit</th>
                        </tr></thead>
                        <tbody>
                          {(e.lines||[]).map((l,i)=>(
                            <tr key={i}>
                              <td style={{color:'#64748b'}}>{l.contactName||l.contactId||'—'}</td>
                              <td style={{fontFamily:'monospace',fontWeight:600}}>{l.accountCode||'—'}</td>
                              <td>{l.accountName||'—'}</td>
                              <td style={{color:'#64748b'}}>{l.description||'—'}</td>
                              <td style={{textAlign:'right',color:'#dc2626',fontWeight:l.debit>0?700:400}}>{l.debit>0?fmtCur(l.debit):'—'}</td>
                              <td style={{textAlign:'right',color:'#15803d',fontWeight:l.credit>0?700:400}}>{l.credit>0?fmtCur(l.credit):'—'}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      <div style={{display:'flex',gap:8,marginTop:6,fontSize:11,color:'#64748b'}}>
                        <span>Created by: {e.createdBy||'—'}</span>
                        {e.reference&&<span>· Ref: {e.reference}</span>}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
            {/* Pagination */}
            <div className="pagination">
              <button className="page-btn" disabled={page===1} onClick={()=>setPage(1)}>«</button>
              <button className="page-btn" disabled={page===1} onClick={()=>setPage(p=>p-1)}>‹</button>
              {Array.from({length:Math.min(totalPages,7)},(_,i)=>{
                let p;
                if (totalPages<=7) p=i+1;
                else if (page<=4) p=i+1;
                else if (page>=totalPages-3) p=totalPages-6+i;
                else p=page-3+i;
                return <button key={p} className={`page-btn ${page===p?'page-btn-active':''}`} onClick={()=>setPage(p)}>{p}</button>;
              })}
              <button className="page-btn" disabled={page===totalPages} onClick={()=>setPage(p=>p+1)}>›</button>
              <button className="page-btn" disabled={page===totalPages} onClick={()=>setPage(totalPages)}>»</button>
              <span style={{fontSize:11,color:'#94a3b8',marginLeft:4}}>Page {page} of {totalPages}</span>
            </div>
          </>
        )}
      </div>
      {modal!==null&&JEModal()}
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

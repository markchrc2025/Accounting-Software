import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { useLocation } from 'react-router-dom';
import * as XLSX from 'xlsx';
import {
  listAccounts, createAccount, updateAccount, deleteAccount as apiDeleteAccount,
  importAccounts, ApiError,
} from '../../../lib/api.js';

const ACCOUNT_TYPES = ['Asset','Cost of Services','Equity','Expense','Income','Liability'];

const SUBTYPES_BY_TYPE = {
  'Asset':            ['Accounts Receivable','Bank','Cash Equivalents','Fixed Asset','Other Current Asset','Tax Asset'],
  'Cost of Services': ['Cost of Services'],
  'Equity':           ['Equity'],
  'Expense':          ['Finance Cost and Amortization','General and Administrative Expenses','Non Cash Expenses','Other Expense','Other General Expenses','Personnel Cost','Taxes and Licenses','Utilities'],
  'Income':           ['Income','Other Income'],
  'Liability':        ['Accounts Payable','Other Current Liability','Tax Liability'],
};

const NORMAL_BALANCE = {
  'Asset':'Debit', 'Cost of Services':'Debit', 'Expense':'Debit',
  'Liability':'Credit', 'Equity':'Credit', 'Income':'Credit',
};

// ── Map between the portal's Title-case types and the API's lowercase enum.
// 'Cost of Services' has no enum member yet, so it maps to 'expense' with the
// label preserved in the subtype (round-trips via toUiType). Bank credit-line
// fields (isCreditLine/creditLimit/interestRate) are deferred — no columns yet.
const TYPE_TO_API = {
  'Asset':'asset', 'Liability':'liability', 'Equity':'equity',
  'Income':'income', 'Expense':'expense', 'Cost of Services':'expense',
};
const API_TO_TYPE = { asset:'Asset', liability:'Liability', equity:'Equity', income:'Income', expense:'Expense' };
const toApiType = (t) => TYPE_TO_API[t] || 'expense';
const toUiType = (apiType, subtype) =>
  (subtype || '') === 'Cost of Services' ? 'Cost of Services' : (API_TO_TYPE[apiType] || 'Asset');
// API row -> the shape the table/modal expect.
const fromApi = (a) => {
  const type = toUiType(a.type, a.subtype);
  return {
    id: a.id, code: a.code || '', name: a.name || '', type,
    subType: a.subtype || '', normalBalance: NORMAL_BALANCE[type] || 'Debit',
    notes: a.description || '', isActive: a.isActive,
  };
};
// modal/preview -> API create/update payload.
const toApiPayload = (r) => ({
  code: (r.code || '').trim(), name: (r.name || '').trim(), type: toApiType(r.type),
  subtype: r.subType || null, description: r.notes || null,
});

/* ── Import wizard field definitions ─────────────────────────── */
const IMPORT_FIELDS = [
  { key:'code',         label:'Account Code',           required:true  },
  { key:'name',         label:'Account Name',           required:true  },
  { key:'type',         label:'Type (Type1)',            required:false },
  { key:'subType',      label:'Sub-Type (Account Type)',required:false },
  { key:'notes',        label:'Description / Notes',    required:false },
  { key:'accountNo',    label:'Account #',              required:false },
  { key:'parent',       label:'Parent Account',         required:false },
  { key:'creditLimit',  label:'Credit Limit',           required:false },
  { key:'interestRate', label:'Interest Rate',          required:false },
];

function autoMapHeaders(headers) {
  const n = h => h.toLowerCase().replace(/[^a-z0-9]/g,'');
  const hints = {
    code:        ['accountcode','code'],
    name:        ['accountname','name'],
    type:        ['type1','type'],
    subType:     ['accounttype','subtype'],
    notes:       ['description','notes','desc'],
    accountNo:   ['accountnumber','accountno','account'],
    parent:      ['parentaccount','parent'],
    creditLimit: ['creditlimit','credit'],
    interestRate:['interestrate','interest','rate'],
  };
  const map = {};
  for (const [field, patterns] of Object.entries(hints)) {
    const match = headers.find(h => patterns.some(p => n(h).includes(p)));
    map[field] = match || '';
  }
  return map;
}

function buildPreviewRow(raw, mapping, existingCodes) {
  const get = f => (raw[mapping[f]] ?? '').toString().trim();
  const code    = get('code');
  const name    = get('name');
  const rawType = get('type');
  const rawSub  = get('subType');
  const type    = ACCOUNT_TYPES.find(t => t.toLowerCase() === rawType.toLowerCase()) || rawType;
  const allSubs = Object.values(SUBTYPES_BY_TYPE).flat();
  const subType = allSubs.find(s => s.toLowerCase() === rawSub.toLowerCase()) || rawSub;
  const normalBalance = NORMAL_BALANCE[type] || 'Debit';
  const creditLimit   = parseFloat(get('creditLimit'))  || 0;
  const interestRate  = parseFloat(get('interestRate')) || 0;
  const isCreditLine  = subType === 'Bank' && creditLimit > 0;
  const errors = [];
  if (!code) errors.push('Missing code');
  if (!name) errors.push('Missing name');
  if (type && !ACCOUNT_TYPES.includes(type)) errors.push(`Unknown type: "${type}"`);
  const status = errors.length > 0 ? 'error' : existingCodes[code] ? 'duplicate' : 'new';
  return { code, name, type: type||'', subType: subType||'', normalBalance, creditLimit, interestRate, isCreditLine,
    notes:get('notes'), accountNo:get('accountNo'), parent:get('parent'),
    errors, status, existingId: existingCodes[code] || null };
}

const CSS = `
  .coa-wrap  { display:flex; flex-direction:column; height:100%; overflow:hidden; font-family:Inter,system-ui,sans-serif; background:#f8fafc; }
  .coa-top   { display:flex; align-items:center; justify-content:space-between; padding:16px 22px 12px; flex-shrink:0; border-bottom:1px solid #e5e7eb; background:#fff; }
  .coa-body  { flex:1; overflow-y:auto; padding:16px 22px; }
  .toolbar   { display:flex; gap:10px; align-items:center; flex-wrap:wrap; margin-bottom:14px; }
  .input     { border:1px solid #e5e7eb; border-radius:10px; padding:9px 12px; font-size:13px; background:#fff; font-family:inherit; }
  .btn       { border:0; border-radius:10px; padding:9px 16px; font-weight:700; cursor:pointer; font-size:13px; font-family:inherit; }
  .btn:disabled { opacity:.5; cursor:not-allowed; }
  .btn-primary { background:#f97316; color:#fff; }
  .btn-ghost   { background:#f1f5f9; color:#0b1220; }
  .btn-ghost:hover { background:#e2e8f0; }
  .btn-sm      { padding:6px 12px; font-size:12px; }
  .btn-xs      { padding:4px 8px; font-size:11px; border-radius:8px; }
  .card { background:#fff; border:1px solid #e5e7eb; border-radius:14px; overflow:hidden; }
  table { width:100%; border-collapse:collapse; }
  th,td { padding:10px 12px; border-bottom:1px solid #f1f5f9; font-size:13px; text-align:left; }
  th { color:#64748b; font-weight:800; font-size:11px; letter-spacing:.05em; text-transform:uppercase; background:#f8fafc; }
  tr:hover td { background:#fafafa; }
  tr:last-child td { border-bottom:none; }
  .pill { display:inline-block; padding:2px 9px; border-radius:999px; font-size:11px; font-weight:700; border:1px solid #e2e8f0; background:#f8fafc; color:#64748b; }
  .backdrop { position:fixed; inset:0; background:rgba(15,23,42,.45); display:flex; align-items:center; justify-content:center; padding:16px; z-index:100; }
  .modal-sm { width:min(520px,98vw); background:#fff; border-radius:16px; display:flex; flex-direction:column; overflow:hidden; box-shadow:0 24px 64px rgba(0,0,0,.25); }
  .modal-h  { display:flex; align-items:center; justify-content:space-between; padding:14px 18px; border-bottom:1px solid #e5e7eb; background:#f8fafc; }
  .modal-h strong { font-size:14px; font-weight:900; }
  .modal-b  { padding:18px; }
  .modal-f  { display:flex; justify-content:flex-end; gap:10px; padding:12px 18px; border-top:1px solid #e5e7eb; }
  .grid2 { display:grid; grid-template-columns:1fr 1fr; gap:10px; }
  .col2  { grid-column:span 2; }
  .field { display:flex; flex-direction:column; gap:5px; margin-bottom:0; }
  .field label { font-size:10px; font-weight:800; color:#64748b; letter-spacing:.06em; text-transform:uppercase; }
  .field input,.field select { border:1px solid #e5e7eb; border-radius:10px; padding:9px 10px; font-size:13px; font-family:inherit; width:100%; box-sizing:border-box; }
  .empty { padding:40px; text-align:center; color:#94a3b8; font-size:13px; }
  .toast { position:fixed; right:16px; bottom:16px; background:#0b1220; color:#fff; padding:12px 18px; border-radius:12px; font-size:13px; font-weight:600; z-index:999; animation:fadeIn .2s; }
  .backdrop { position:fixed; inset:0; background:rgba(15,23,42,.45); display:flex; align-items:center; justify-content:center; padding:16px; z-index:100; }
  @keyframes fadeIn { from{opacity:0;transform:translateY(8px)} to{opacity:1;transform:none} }
  .imp-modal { width:min(860px,98vw); max-height:92vh; background:#fff; border-radius:16px; display:flex; flex-direction:column; overflow:hidden; box-shadow:0 24px 64px rgba(0,0,0,.25); }
  .imp-header { padding:16px 22px 14px; border-bottom:1px solid #e5e7eb; background:#f8fafc; flex-shrink:0; }
  .imp-steps { display:flex; align-items:center; margin-top:12px; }
  .imp-step { display:flex; align-items:center; gap:7px; }
  .imp-step-num { width:24px; height:24px; border-radius:50%; display:flex; align-items:center; justify-content:center; font-size:11px; font-weight:900; flex-shrink:0; }
  .sn-done { background:#22c55e; color:#fff; } .sn-active { background:#f97316; color:#fff; } .sn-idle { background:#e5e7eb; color:#94a3b8; }
  .imp-step-lbl { font-size:12px; font-weight:700; }
  .sl-done { color:#22c55e; } .sl-active { color:#f97316; } .sl-idle { color:#94a3b8; }
  .imp-conn { flex:1; height:2px; margin:0 8px; } .ic-done { background:#22c55e; } .ic-idle { background:#e5e7eb; }
  .imp-body { flex:1; overflow-y:auto; padding:22px; }
  .imp-footer { display:flex; justify-content:space-between; align-items:center; padding:14px 22px; border-top:1px solid #e5e7eb; flex-shrink:0; background:#fff; }
  .drop-zone { border:2px dashed #e5e7eb; border-radius:14px; padding:44px 24px; text-align:center; cursor:pointer; transition:all .2s; }
  .drop-zone:hover,.dz-over { border-color:#f97316!important; background:#fff7ed!important; }
  .map-tbl { width:100%; border-collapse:collapse; }
  .map-tbl th,.map-tbl td { padding:8px 12px; border-bottom:1px solid #f1f5f9; font-size:12px; text-align:left; }
  .map-tbl th { color:#64748b; font-weight:800; font-size:10px; letter-spacing:.05em; text-transform:uppercase; background:#f8fafc; }
  .imp-sel { border:1px solid #e5e7eb; border-radius:8px; padding:6px 8px; font-size:12px; background:#fff; font-family:inherit; width:100%; }
  .prev-tbl { width:100%; border-collapse:collapse; font-size:11px; }
  .prev-tbl th,.prev-tbl td { padding:7px 10px; border-bottom:1px solid #f1f5f9; text-align:left; white-space:nowrap; }
  .prev-tbl th { color:#64748b; font-weight:800; font-size:10px; letter-spacing:.05em; text-transform:uppercase; background:#f8fafc; position:sticky; top:0; z-index:1; }
  .pr-new td { background:#f0fdf4!important; } .pr-dup td { background:#fffbeb!important; } .pr-err td { background:#fef2f2!important; }
  .ibadge { display:inline-block; padding:2px 8px; border-radius:999px; font-size:10px; font-weight:700; border:1px solid; }
  .ib-new { background:#f0fdf4; border-color:#86efac; color:#15803d; }
  .ib-dup { background:#fffbeb; border-color:#fde68a; color:#92400e; }
  .ib-err { background:#fef2f2; border-color:#fca5a5; color:#991b1b; }
  .imp-kpi-row { display:flex; gap:12px; flex-wrap:wrap; margin-bottom:16px; }
  .imp-kpi { background:#f8fafc; border:1px solid #e5e7eb; border-radius:10px; padding:10px 16px; min-width:100px; }
  .imp-kpi-val { font-size:22px; font-weight:900; line-height:1; }
  .imp-kpi-lbl { font-size:10px; color:#94a3b8; font-weight:800; text-transform:uppercase; letter-spacing:.06em; margin-top:3px; }
  .imp-bar { height:6px; background:#e5e7eb; border-radius:999px; overflow:hidden; margin-top:8px; }
  .imp-bar-fill { height:100%; background:#f97316; border-radius:999px; transition:width .25s; }
`;

const TYPE_COLORS = {
  'Asset':            { background:'#ecfdf5', border:'#6ee7b7', color:'#065f46' },
  'Liability':        { background:'#fef2f2', border:'#fecaca', color:'#991b1b' },
  'Equity':           { background:'#eff6ff', border:'#bfdbfe', color:'#1d4ed8' },
  'Income':           { background:'#f0fdf4', border:'#bbf7d0', color:'#15803d' },
  'Expense':          { background:'#fff7ed', border:'#fed7aa', color:'#c2410c' },
  'Cost of Services': { background:'#fef9c3', border:'#fde68a', color:'#92400e' },
};

export default function COAPage() {
  const [accounts, setAccounts] = useState([]);
  const [search,   setSearch]   = useState('');
  const [filterType, setFilterType] = useState('');
  const [modal,    setModal]    = useState(null); // null | { isNew, id?, code, name, type, normalBalance, subType, creditLimit, interestRate, notes }
  const [saving,   setSaving]   = useState(false);
  const [toast,    setToast]    = useState('');
  const [confirmModal, setConfirmModal] = useState(null);
  const [impWiz, setImpWiz]             = useState(null);
  // impWiz: null | { step:1|2|3, fileName, rawRows, headers, mapping, dupMode, previewRows, importing, progress }

  const showToast = (msg) => { setToast(msg); setTimeout(() => setToast(''), 3000); };

  /* ── Load accounts from the API (replaces the Firestore live listener) ─────── */
  const loadAccounts = useCallback(async () => {
    try {
      const rows = await listAccounts();
      setAccounts(rows.map(fromApi));
    } catch (e) {
      showToast(`Couldn't load accounts: ${e instanceof ApiError ? e.detail : e.message}`);
    }
  }, []);

  /* ── Import: parse file via SheetJS ─────────────────────────── */
  const parseFile = useCallback((file) => {
    const ext = file.name.split('.').pop().toLowerCase();
    if (!['csv','xlsx','xls'].includes(ext)) { showToast('Only CSV, XLS, or XLSX supported.'); return; }
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const wb   = XLSX.read(new Uint8Array(e.target.result), { type:'array' });
        const ws   = wb.Sheets[wb.SheetNames[0]];
        const rows = XLSX.utils.sheet_to_json(ws, { defval:'' });
        if (!rows.length) { showToast('File appears empty.'); return; }
        const headers = Object.keys(rows[0]);
        setImpWiz({ step:1, fileName:file.name, rawRows:rows, headers,
          mapping:autoMapHeaders(headers), dupMode:'skip',
          previewRows:[], importing:false, progress:0 });
      } catch { showToast('Could not read file.'); }
    };
    reader.readAsArrayBuffer(file);
  }, []);

  /* ── Import: build preview rows ─────────────────────────────── */
  const buildPreview = useCallback((wiz) => {
    const existing = {};
    accounts.forEach(a => { if (a.code) existing[a.code] = a.id; });
    return wiz.rawRows.map(r => buildPreviewRow(r, wiz.mapping, existing));
  }, [accounts]);

  /* ── Import via the API: bulk-insert new rows, per-row update on overwrite ──── */
  const runImport = useCallback(async (wiz) => {
    const newRows = wiz.previewRows.filter(r => r.status === 'new');
    const overwriteRows = wiz.dupMode === 'overwrite'
      ? wiz.previewRows.filter(r => r.status === 'duplicate' && r.existingId) : [];
    if (!newRows.length && !overwriteRows.length) { showToast('Nothing to import.'); return; }
    setImpWiz(w => ({ ...w, importing:true, progress:0 }));

    let inserted = 0, updated = 0, failed = 0;
    try {
      if (newRows.length) {
        const res = await importAccounts(newRows.map(r => ({
          code: r.code, name: r.name, type: toApiType(r.type),
          subtype: r.subType || undefined, description: r.notes || undefined,
          parentName: r.parent || undefined,
        })));
        inserted = (res && typeof res.inserted === 'number') ? res.inserted : newRows.length;
        setImpWiz(w => w ? { ...w, progress: overwriteRows.length ? 50 : 100 } : w);
      }
      let done = 0;
      for (const r of overwriteRows) {
        try { await updateAccount(r.existingId, toApiPayload(r)); updated++; }
        catch { failed++; }
        done++;
        setImpWiz(w => w ? { ...w, progress: 50 + Math.round((done / overwriteRows.length) * 50) } : w);
      }
    } catch (e) {
      setImpWiz(null);
      showToast(`Import failed: ${e instanceof ApiError ? e.detail : e.message}`);
      return;
    }
    await loadAccounts();
    setImpWiz(null);
    const ok = inserted + updated;
    showToast(`✅ Imported ${ok} account${ok !== 1 ? 's' : ''}!${failed ? ` (${failed} failed)` : ''}`);
  }, [loadAccounts]);
  const askConfirm = (message, onConfirm) => setConfirmModal({ message, onConfirm });

  // Open create form when navigating from CreateFlyout
  const location = useLocation();
  useEffect(() => {
    if (location.state?.openCreate) { window.history.replaceState({}, ''); setModal({isNew:true,code:'',name:'',type:'Expense',subType:SUBTYPES_BY_TYPE['Expense'][0],isCreditLine:false,creditLimit:0,interestRate:0,notes:''}); }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { loadAccounts(); }, [loadAccounts]);

  const filtered = useMemo(() => {
    let a = [...accounts];
    const q = search.toLowerCase();
    if (q) a = a.filter(x => (x.code||'').toLowerCase().includes(q) || (x.name||'').toLowerCase().includes(q));
    if (filterType) a = a.filter(x => x.type === filterType);
    return a;
  }, [accounts, search, filterType]);

  const save = async () => {
    if (!modal) return;
    const { isNew, id, code, name } = modal;
    if (!code?.trim() || !name?.trim()) { showToast('Code and Name required.'); return; }
    setSaving(true);
    try {
      const payload = toApiPayload(modal);
      if (isNew) await createAccount(payload);
      else       await updateAccount(id, payload);
      showToast('Account saved.'); setModal(null);
      await loadAccounts();
    } catch (e) {
      showToast(e instanceof ApiError ? e.detail : ('Error: ' + e.message));
    }
    setSaving(false);
  };

  const deleteAccount = (a) => {
    askConfirm(`Delete account "${a.code} - ${a.name}"?`, async () => {
      try {
        await apiDeleteAccount(a.id);
        showToast('Account deleted.');
        await loadAccounts();
      } catch (e) {
        // API returns 409 account_in_use with a "deactivate instead" message.
        showToast(e instanceof ApiError ? e.detail : ('Error: ' + e.message));
      }
    });
  };

  const typeStyle = (type) => TYPE_COLORS[type] || { background:'#f8fafc', border:'#e2e8f0', color:'#64748b' };

  return (
    <div className="coa-wrap">
      <style>{CSS}</style>
      <div className="coa-top">
        <strong style={{fontSize:18,fontWeight:900,color:'#0b1220'}}>CHART OF ACCOUNTS</strong>
        <div style={{display:'flex',gap:8}}>
          <button className="btn btn-ghost btn-sm" onClick={()=>setImpWiz({step:1,fileName:'',rawRows:[],headers:[],mapping:{},dupMode:'skip',previewRows:[],importing:false,progress:0})}>⬆ Import</button>
          <button className="btn btn-primary" onClick={()=>setModal({isNew:true,code:'',name:'',type:'Expense',subType:SUBTYPES_BY_TYPE['Expense'][0],isCreditLine:false,creditLimit:0,interestRate:0,notes:''})}>＋ Add Account</button>
        </div>
      </div>
      <div className="coa-body">
        <div className="toolbar">
          <input className="input" placeholder="🔍 Search code or name…" value={search} onChange={e=>setSearch(e.target.value)} style={{flex:'1 1 200px',minWidth:160}} />
          <select className="input" value={filterType} onChange={e=>setFilterType(e.target.value)}>
            <option value="">All Types</option>
            {ACCOUNT_TYPES.map(t=><option key={t}>{t}</option>)}
          </select>
          <button className="btn btn-ghost btn-sm" onClick={()=>{setSearch('');setFilterType('');}}>✕ Clear</button>
          <span style={{fontSize:12,color:'#94a3b8',fontWeight:600}}>{filtered.length} account{filtered.length!==1?'s':''}</span>
        </div>
        <div className="card">
          <table>
            <thead>
              <tr><th>CODE</th><th>ACCOUNT NAME</th><th>TYPE</th><th>SUB-TYPE</th><th>CREDIT LIMIT</th><th style={{textAlign:'center'}}>ACTIONS</th></tr>
            </thead>
            <tbody>
              {filtered.length === 0 && <tr><td colSpan={6} className="empty">No accounts found.</td></tr>}
              {filtered.map(a => {
                const ts = typeStyle(a.type);
                return (
                  <tr key={a.id}>
                    <td><strong style={{fontFamily:'monospace',color:'#f97316'}}>{a.code||'—'}</strong></td>
                    <td>{a.name}</td>
                    <td><span className="pill" style={{background:ts.background,borderColor:ts.border,color:ts.color}}>{a.type||'—'}</span></td>
                    <td style={{color:'#64748b'}}>{a.subType||'—'}</td>
                    <td>{Number(a.creditLimit||0) > 0 ? new Intl.NumberFormat('en-PH',{style:'currency',currency:'PHP'}).format(a.creditLimit) : '—'}</td>
                    <td style={{textAlign:'center'}}>
                      <div style={{display:'flex',gap:4,justifyContent:'center'}}>
                        <button className="btn btn-ghost btn-xs" onClick={()=>setModal({...a,isNew:false})}>Edit</button>
                        <button className="btn btn-ghost btn-xs" style={{color:'#dc2626'}} onClick={()=>deleteAccount(a)}>Delete</button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {modal && (
        <div className="backdrop" onClick={()=>setModal(null)}>
          <div className="modal-sm" onClick={e=>e.stopPropagation()}>
            <div className="modal-h">
              <strong>{modal.isNew?'Add Account':'Edit Account'}</strong>
              <button className="btn btn-ghost btn-sm" onClick={()=>setModal(null)}>✕</button>
            </div>
            <div className="modal-b">
              <div className="grid2" style={{gap:12}}>
                <div className="field">
                  <label>Account Code</label>
                  <input value={modal.code||''} onChange={e=>setModal(m=>({...m,code:e.target.value}))} placeholder="e.g. 1010" />
                </div>
                <div className="field">
                  <label>Account Name</label>
                  <input value={modal.name||''} onChange={e=>setModal(m=>({...m,name:e.target.value}))} placeholder="e.g. Cash on Hand" />
                </div>
                <div className="field">
                  <label>Type</label>
                  <select value={modal.type||'Asset'} onChange={e=>{
                    const t = e.target.value;
                    const firstSub = (SUBTYPES_BY_TYPE[t]||[''])[0];
                    setModal(m=>({...m,type:t,subType:firstSub,isCreditLine:firstSub==='Bank'?m.isCreditLine:false}));
                  }}>
                    {ACCOUNT_TYPES.map(t=><option key={t}>{t}</option>)}
                  </select>
                </div>
                <div className="field">
                  <label>Sub-Type</label>
                  <select value={modal.subType||''} onChange={e=>{
                    const s = e.target.value;
                    setModal(m=>({...m,subType:s,isCreditLine:s==='Bank'?m.isCreditLine:false}));
                  }}>
                    {(SUBTYPES_BY_TYPE[modal.type]||[]).map(s=><option key={s}>{s}</option>)}
                  </select>
                </div>
                <div className="field col2" style={{marginTop:4}}>
                  <label>Notes</label>
                  <input value={modal.notes||''} onChange={e=>setModal(m=>({...m,notes:e.target.value}))} placeholder="Optional notes" />
                </div>
              </div>
            </div>
            <div className="modal-f">
              <button className="btn btn-ghost" onClick={()=>setModal(null)}>Cancel</button>
              <button className="btn btn-primary" onClick={save} disabled={saving}>{saving?'Saving…':'Save Account'}</button>
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

      {/* ════ Import Wizard ════════════════════════════════════════ */}
      {impWiz && (() => {
        const stepLabels = ['Configure','Map Fields','Preview & Import'];

        /* Step bar */
        const StepBar = () => (
          <div className="imp-steps">
            {stepLabels.map((lbl, i) => {
              const n = i + 1;
              const st = n < impWiz.step ? 'done' : n === impWiz.step ? 'active' : 'idle';
              return (
                <div key={n} style={{display:'flex',alignItems:'center',flex:i<stepLabels.length-1?1:'0 0 auto'}}>
                  <div className="imp-step">
                    <div className={`imp-step-num sn-${st}`}>{st==='done'?'✓':n}</div>
                    <span className={`imp-step-lbl sl-${st}`}>{lbl}</span>
                  </div>
                  {i < stepLabels.length-1 && <div className={`imp-conn ${n<impWiz.step?'ic-done':'ic-idle'}`} style={{flex:1,height:2,margin:'0 8px'}} />}
                </div>
              );
            })}
          </div>
        );

        /* ── Phase 1 ── */
        const Phase1 = () => {
          const [drag, setDrag] = useState(false);
          const fileRef = useRef(null);
          return (
            <div>
              <div className={`drop-zone${drag?' dz-over':''}`}
                onDragOver={e=>{e.preventDefault();setDrag(true);}}
                onDragLeave={()=>setDrag(false)}
                onDrop={e=>{e.preventDefault();setDrag(false);parseFile(e.dataTransfer.files[0]);}}
                onClick={()=>fileRef.current.click()}>
                <div style={{fontSize:36,marginBottom:10}}>📂</div>
                <div style={{fontWeight:700,fontSize:14,color:'#0b1220',marginBottom:12}}>Drag and drop file to import</div>
                <span style={{background:'#f97316',color:'#fff',padding:'9px 20px',borderRadius:10,fontWeight:700,fontSize:13}}>Choose File</span>
                <div style={{marginTop:12,fontSize:11,color:'#94a3b8'}}>Maximum File Size: 25 MB &nbsp;·&nbsp; CSV · XLS · XLSX</div>
                <input ref={fileRef} type="file" accept=".csv,.xlsx,.xls" style={{display:'none'}}
                  onChange={e=>parseFile(e.target.files[0])} />
              </div>

              {impWiz.fileName && (
                <div style={{marginTop:14,padding:'12px 16px',background:'#f0fdf4',border:'1px solid #86efac',borderRadius:10,display:'flex',alignItems:'center',gap:10}}>
                  <span style={{fontSize:20}}>📄</span>
                  <div><div style={{fontWeight:700,fontSize:13}}>{impWiz.fileName}</div>
                    <div style={{fontSize:11,color:'#64748b'}}>{impWiz.rawRows.length} data row{impWiz.rawRows.length!==1?'s':''} detected</div></div>
                </div>
              )}

              <div style={{marginTop:20}}>
                <div style={{fontSize:11,fontWeight:800,color:'#64748b',letterSpacing:'.06em',textTransform:'uppercase',marginBottom:10}}>Duplicate Handling</div>
                {[
                  {val:'skip',      label:'Skip Duplicates',    desc:'Keep existing accounts; rows whose name already exists are ignored.'},
                  {val:'overwrite', label:'Overwrite Accounts', desc:'Update existing accounts with the values from this import file.'},
                ].map(opt => (
                  <label key={opt.val} style={{display:'flex',alignItems:'flex-start',gap:10,padding:'11px 14px',border:'1px solid',borderColor:impWiz.dupMode===opt.val?'#f97316':'#e5e7eb',borderRadius:10,marginBottom:8,cursor:'pointer',background:impWiz.dupMode===opt.val?'#fff7ed':'#fff'}}>
                    <input type="radio" name="dupMode" checked={impWiz.dupMode===opt.val}
                      onChange={()=>setImpWiz(w=>({...w,dupMode:opt.val}))}
                      style={{marginTop:2,accentColor:'#f97316'}} />
                    <div><div style={{fontWeight:700,fontSize:13}}>{opt.label}</div>
                      <div style={{fontSize:11,color:'#64748b',marginTop:2}}>{opt.desc}</div></div>
                  </label>
                ))}
              </div>
            </div>
          );
        };

        /* ── Phase 2 ── */
        const Phase2 = () => (
          <div>
            <div style={{background:'#eff6ff',border:'1px solid #bfdbfe',borderRadius:10,padding:'10px 14px',marginBottom:18,fontSize:12,color:'#1d4ed8',display:'flex',gap:8,alignItems:'flex-start'}}>
              <span>ℹ️</span><span>The best-match column for each ScaleBooks field has been auto-selected. Adjust any that look incorrect.</span>
            </div>
            <div style={{fontWeight:800,fontSize:13,color:'#0b1220',marginBottom:12}}>Chart of Account Details</div>
            <table className="map-tbl">
              <thead><tr><th>ScaleBooks Field</th><th>Your File Column</th><th>Sample Value (row 1)</th></tr></thead>
              <tbody>
                {IMPORT_FIELDS.map(f => {
                  const mapped = impWiz.mapping[f.key] || '';
                  const sample = mapped && impWiz.rawRows[0] ? String(impWiz.rawRows[0][mapped] ?? '').slice(0,50) : '—';
                  return (
                    <tr key={f.key}>
                      <td style={{fontWeight:700}}>{f.label}{f.required&&<span style={{color:'#f97316',marginLeft:4}}>*</span>}</td>
                      <td>
                        <select className="imp-sel" value={mapped}
                          onChange={e=>setImpWiz(w=>({...w,mapping:{...w.mapping,[f.key]:e.target.value==='__none'?'':e.target.value}}))}>

                          <option value="__none">(ignore)</option>
                          {impWiz.headers.map(h=><option key={h} value={h}>{h}</option>)}
                        </select>
                      </td>
                      <td style={{color:'#64748b'}}>{sample}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        );

        /* ── Phase 3 ── */
        const Phase3 = () => {
          const rows  = impWiz.previewRows;
          const nNew  = rows.filter(r=>r.status==='new').length;
          const nDup  = rows.filter(r=>r.status==='duplicate').length;
          const nErr  = rows.filter(r=>r.status==='error').length;
          const nWrit = rows.filter(r=>r.status==='new'||(r.status==='duplicate'&&impWiz.dupMode==='overwrite')).length;
          return (
            <div>
              <div className="imp-kpi-row">
                <div className="imp-kpi"><div className="imp-kpi-val" style={{color:'#15803d'}}>{nNew}</div><div className="imp-kpi-lbl">New</div></div>
                <div className="imp-kpi"><div className="imp-kpi-val" style={{color:'#92400e'}}>{nDup}</div><div className="imp-kpi-lbl">Duplicates ({impWiz.dupMode==='skip'?'skip':'overwrite'})</div></div>
                <div className="imp-kpi"><div className="imp-kpi-val" style={{color:'#991b1b'}}>{nErr}</div><div className="imp-kpi-lbl">Errors (skipped)</div></div>
                <div className="imp-kpi"><div className="imp-kpi-val" style={{color:'#f97316'}}>{nWrit}</div><div className="imp-kpi-lbl">Will be written</div></div>
              </div>
              {impWiz.importing && (
                <div style={{marginBottom:16}}>
                  <div style={{fontSize:12,fontWeight:700,marginBottom:6}}>Importing… {impWiz.progress}%</div>
                  <div className="imp-bar"><div className="imp-bar-fill" style={{width:`${impWiz.progress}%`}} /></div>
                </div>
              )}
              <div style={{overflowX:'auto'}}>
                <table className="prev-tbl">
                  <thead><tr><th>Status</th><th>Code</th><th>Account Name</th><th>Type</th><th>Sub-Type</th><th>Normal Bal.</th><th>Credit Limit</th><th>Notes / Error</th></tr></thead>
                  <tbody>
                    {rows.map((r,i) => (
                      <tr key={i} className={r.status==='new'?'pr-new':r.status==='duplicate'?'pr-dup':'pr-err'}>
                        <td><span className={`ibadge ib-${r.status==='new'?'new':r.status==='duplicate'?'dup':'err'}`}>
                          {r.status==='new'?'New':r.status==='duplicate'?'Duplicate':'Error'}
                        </span></td>
                        <td style={{fontFamily:'monospace',fontWeight:700,color:'#f97316'}}>{r.code||'—'}</td>
                        <td>{r.name||'—'}</td>
                        <td>{r.type||'—'}</td>
                        <td>{r.subType||'—'}</td>
                        <td>{r.normalBalance}</td>
                        <td>{r.creditLimit>0?new Intl.NumberFormat('en-PH',{style:'currency',currency:'PHP'}).format(r.creditLimit):'—'}</td>
                        <td style={{color:r.errors.length?'#dc2626':'#64748b',maxWidth:180,whiteSpace:'normal'}}>
                          {r.errors.length?r.errors.join(', '):r.notes||'—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          );
        };

        return (
          <div className="backdrop" onClick={e=>e.target===e.currentTarget&&!impWiz.importing&&setImpWiz(null)}>
            <div className="imp-modal" onClick={e=>e.stopPropagation()}>

              <div className="imp-header">
                <div style={{display:'flex',alignItems:'center',justifyContent:'space-between'}}>
                  <strong style={{fontSize:15,fontWeight:900}}>Import Chart of Accounts</strong>
                  {!impWiz.importing&&<button className="btn btn-ghost btn-sm" onClick={()=>setImpWiz(null)}>✕</button>}
                </div>
                <StepBar />
              </div>

              <div className="imp-body">
                {impWiz.step===1 && <Phase1 />}
                {impWiz.step===2 && <Phase2 />}
                {impWiz.step===3 && <Phase3 />}
              </div>

              <div className="imp-footer">
                <div>
                  {impWiz.step>1&&!impWiz.importing&&(
                    <button className="btn btn-ghost" onClick={()=>setImpWiz(w=>({...w,step:w.step-1}))}>← Previous</button>
                  )}
                </div>
                <div style={{display:'flex',gap:10,alignItems:'center'}}>
                  {!impWiz.importing&&<button className="btn btn-ghost" onClick={()=>setImpWiz(null)}>Cancel</button>}
                  {impWiz.step===1&&(
                    <button className="btn btn-primary" disabled={!impWiz.rawRows.length}
                      onClick={()=>setImpWiz(w=>({...w,step:2}))}>Next →</button>
                  )}
                  {impWiz.step===2&&(
                    <button className="btn btn-primary" onClick={()=>{
                      const preview = buildPreview(impWiz);
                      setImpWiz(w=>({...w,step:3,previewRows:preview}));
                    }}>Next →</button>
                  )}
                  {impWiz.step===3&&!impWiz.importing&&(
                    <button className="btn btn-primary"
                      disabled={!impWiz.previewRows.filter(r=>r.status==='new'||(r.status==='duplicate'&&impWiz.dupMode==='overwrite')).length}
                      onClick={()=>runImport(impWiz)}>
                      ⬆ Import {impWiz.previewRows.filter(r=>r.status==='new'||(r.status==='duplicate'&&impWiz.dupMode==='overwrite')).length} Account{impWiz.previewRows.filter(r=>r.status==='new'||(r.status==='duplicate'&&impWiz.dupMode==='overwrite')).length!==1?'s':''}
                    </button>
                  )}
                  {impWiz.importing&&<span style={{fontSize:12,color:'#64748b',fontWeight:600}}>Importing, please wait…</span>}
                </div>
              </div>

            </div>
          </div>
        );
      })()}
    </div>
  );
}

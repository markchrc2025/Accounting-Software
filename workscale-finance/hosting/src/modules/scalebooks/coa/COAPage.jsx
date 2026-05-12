import { useState, useEffect, useMemo } from 'react';
import {
  collection, onSnapshot, addDoc, updateDoc, deleteDoc, doc, serverTimestamp, orderBy, query
} from 'firebase/firestore';
import { db, auth } from '../../../firebase.js';

const ACCOUNT_TYPES = ['Asset','Liability','Equity','Revenue','Expense','Cost of Sales','Other Income','Other Expense'];

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
`;

const TYPE_COLORS = {
  'Asset':         { background:'#ecfdf5', border:'#6ee7b7', color:'#065f46' },
  'Liability':     { background:'#fef2f2', border:'#fecaca', color:'#991b1b' },
  'Equity':        { background:'#eff6ff', border:'#bfdbfe', color:'#1d4ed8' },
  'Revenue':       { background:'#f0fdf4', border:'#bbf7d0', color:'#15803d' },
  'Expense':       { background:'#fff7ed', border:'#fed7aa', color:'#c2410c' },
  'Cost of Sales': { background:'#fef9c3', border:'#fde68a', color:'#92400e' },
};

export default function COAPage() {
  const [accounts, setAccounts] = useState([]);
  const [search,   setSearch]   = useState('');
  const [filterType, setFilterType] = useState('');
  const [modal,    setModal]    = useState(null); // null | { isNew, id?, code, name, type, normalBalance, subType, creditLimit, interestRate, notes }
  const [saving,   setSaving]   = useState(false);
  const [toast,    setToast]    = useState('');
  const [confirmModal, setConfirmModal] = useState(null);

  const showToast = (msg) => { setToast(msg); setTimeout(() => setToast(''), 3000); };
  const askConfirm = (message, onConfirm) => setConfirmModal({ message, onConfirm });

  useEffect(() => {
    const unsub = onSnapshot(
      query(collection(db,'accounts'), orderBy('code','asc')),
      s => setAccounts(s.docs.map(d => ({ id:d.id, ...d.data() })))
    );
    return unsub;
  }, []);

  const filtered = useMemo(() => {
    let a = [...accounts];
    const q = search.toLowerCase();
    if (q) a = a.filter(x => (x.code||'').toLowerCase().includes(q) || (x.name||'').toLowerCase().includes(q));
    if (filterType) a = a.filter(x => x.type === filterType);
    return a;
  }, [accounts, search, filterType]);

  const save = async () => {
    if (!modal) return;
    const { isNew, id, code, name, type, normalBalance, subType, creditLimit, interestRate, notes } = modal;
    if (!code?.trim() || !name?.trim()) { showToast('Code and Name required.'); return; }
    setSaving(true);
    try {
      const payload = { code:code.trim(), name:name.trim(), type:type||'Asset', normalBalance:normalBalance||'Debit', subType:subType||'', creditLimit:Number(creditLimit||0), interestRate:Number(interestRate||0), notes:notes||'' };
      if (isNew) await addDoc(collection(db,'accounts'), { ...payload, createdAt:serverTimestamp() });
      else       await updateDoc(doc(db,'accounts',id), { ...payload, updatedAt:serverTimestamp() });
      showToast('Account saved.'); setModal(null);
    } catch(e) { showToast('Error: '+e.message); }
    setSaving(false);
  };

  const deleteAccount = (a) => {
    askConfirm(`Delete account "${a.code} - ${a.name}"?`, async () => {
      await deleteDoc(doc(db,'accounts',a.id));
      showToast('Account deleted.');
    });
  };

  const typeStyle = (type) => TYPE_COLORS[type] || { background:'#f8fafc', border:'#e2e8f0', color:'#64748b' };

  return (
    <div className="coa-wrap">
      <style>{CSS}</style>
      <div className="coa-top">
        <strong style={{fontSize:18,fontWeight:900,color:'#0b1220'}}>CHART OF ACCOUNTS</strong>
        <button className="btn btn-primary" onClick={()=>setModal({isNew:true,code:'',name:'',type:'Expense',normalBalance:'Debit',subType:'',creditLimit:0,interestRate:0,notes:''})}>＋ Add Account</button>
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
              <tr><th>CODE</th><th>ACCOUNT NAME</th><th>TYPE</th><th>NORMAL BALANCE</th><th>SUB-TYPE</th><th>CREDIT LIMIT</th><th style={{textAlign:'center'}}>ACTIONS</th></tr>
            </thead>
            <tbody>
              {filtered.length === 0 && <tr><td colSpan={7} className="empty">No accounts found.</td></tr>}
              {filtered.map(a => {
                const ts = typeStyle(a.type);
                return (
                  <tr key={a.id}>
                    <td><strong style={{fontFamily:'monospace',color:'#f97316'}}>{a.code||'—'}</strong></td>
                    <td>{a.name}</td>
                    <td><span className="pill" style={{background:ts.background,borderColor:ts.border,color:ts.color}}>{a.type||'—'}</span></td>
                    <td>{a.normalBalance||'—'}</td>
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
                  <select value={modal.type||'Asset'} onChange={e=>setModal(m=>({...m,type:e.target.value}))}>
                    {ACCOUNT_TYPES.map(t=><option key={t}>{t}</option>)}
                  </select>
                </div>
                <div className="field">
                  <label>Normal Balance</label>
                  <select value={modal.normalBalance||'Debit'} onChange={e=>setModal(m=>({...m,normalBalance:e.target.value}))}>
                    <option>Debit</option><option>Credit</option>
                  </select>
                </div>
                <div className="field">
                  <label>Sub-Type</label>
                  <input value={modal.subType||''} onChange={e=>setModal(m=>({...m,subType:e.target.value}))} placeholder="e.g. Current Asset, Bank" />
                </div>
                <div className="field">
                  <label>Credit Limit (for bank credit lines)</label>
                  <input type="number" value={modal.creditLimit||0} onChange={e=>setModal(m=>({...m,creditLimit:e.target.value}))} />
                </div>
                <div className="field">
                  <label>Interest Rate (monthly, e.g. 0.015 = 1.5%)</label>
                  <input type="number" step="0.001" value={modal.interestRate||0} onChange={e=>setModal(m=>({...m,interestRate:e.target.value}))} />
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
    </div>
  );
}

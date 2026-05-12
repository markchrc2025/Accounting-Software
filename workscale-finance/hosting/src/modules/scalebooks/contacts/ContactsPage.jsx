import { useState, useEffect, useMemo } from 'react';
import {
  collection, onSnapshot, addDoc, updateDoc, deleteDoc, doc, serverTimestamp, orderBy, query
} from 'firebase/firestore';
import { db, auth } from '../../../firebase.js';

const CONTACT_TYPES = ['Supplier','Employee','Client','Contractor','Government','Others'];

const CSS = `
  .ct-wrap { display:flex; flex-direction:column; height:100%; overflow:hidden; font-family:Inter,system-ui,sans-serif; background:#f8fafc; }
  .ct-top  { display:flex; align-items:center; justify-content:space-between; padding:16px 22px 12px; flex-shrink:0; border-bottom:1px solid #e5e7eb; background:#fff; }
  .ct-body { flex:1; overflow-y:auto; padding:16px 22px; }
  .toolbar { display:flex; gap:10px; align-items:center; flex-wrap:wrap; margin-bottom:14px; }
  .input   { border:1px solid #e5e7eb; border-radius:10px; padding:9px 12px; font-size:13px; background:#fff; font-family:inherit; }
  .btn     { border:0; border-radius:10px; padding:9px 16px; font-weight:700; cursor:pointer; font-size:13px; font-family:inherit; }
  .btn:disabled { opacity:.5; cursor:not-allowed; }
  .btn-primary { background:#f97316; color:#fff; }
  .btn-ghost   { background:#f1f5f9; color:#0b1220; }
  .btn-ghost:hover { background:#e2e8f0; }
  .btn-sm { padding:6px 12px; font-size:12px; }
  .btn-xs { padding:4px 8px; font-size:11px; border-radius:8px; }
  .card   { background:#fff; border:1px solid #e5e7eb; border-radius:14px; overflow:hidden; }
  table   { width:100%; border-collapse:collapse; }
  th,td   { padding:10px 12px; border-bottom:1px solid #f1f5f9; font-size:13px; text-align:left; }
  th      { color:#64748b; font-weight:800; font-size:11px; letter-spacing:.05em; text-transform:uppercase; background:#f8fafc; }
  tr:hover td { background:#fafafa; }
  tr:last-child td { border-bottom:none; }
  .pill   { display:inline-block; padding:2px 9px; border-radius:999px; font-size:11px; font-weight:700; border:1px solid #e2e8f0; background:#f8fafc; color:#64748b; }
  .backdrop { position:fixed; inset:0; background:rgba(15,23,42,.45); display:flex; align-items:center; justify-content:center; padding:16px; z-index:100; }
  .modal  { width:min(600px,98vw); background:#fff; border-radius:16px; display:flex; flex-direction:column; overflow:hidden; box-shadow:0 24px 64px rgba(0,0,0,.25); }
  .modal-h { display:flex; align-items:center; justify-content:space-between; padding:14px 18px; border-bottom:1px solid #e5e7eb; background:#f8fafc; }
  .modal-h strong { font-size:14px; font-weight:900; }
  .modal-b { padding:18px; overflow-y:auto; max-height:65vh; }
  .modal-f { display:flex; justify-content:flex-end; gap:10px; padding:12px 18px; border-top:1px solid #e5e7eb; }
  .grid2  { display:grid; grid-template-columns:1fr 1fr; gap:12px; }
  .col2   { grid-column:span 2; }
  .field  { display:flex; flex-direction:column; gap:5px; }
  .field label { font-size:10px; font-weight:800; color:#64748b; letter-spacing:.06em; text-transform:uppercase; }
  .field input,.field select,.field textarea { border:1px solid #e5e7eb; border-radius:10px; padding:9px 10px; font-size:13px; font-family:inherit; width:100%; box-sizing:border-box; }
  .field textarea { resize:vertical; min-height:60px; }
  .empty  { padding:40px; text-align:center; color:#94a3b8; font-size:13px; }
  .toast  { position:fixed; right:16px; bottom:16px; background:#0b1220; color:#fff; padding:12px 18px; border-radius:12px; font-size:13px; font-weight:600; z-index:999; animation:fadeIn .2s; }
  .backdrop { position:fixed; inset:0; background:rgba(15,23,42,.45); display:flex; align-items:center; justify-content:center; padding:16px; z-index:100; }
  @keyframes fadeIn { from{opacity:0;transform:translateY(8px)} to{opacity:1;transform:none} }
`;

const TYPE_PILL = {
  'Supplier':   { background:'#fff7ed', borderColor:'#fed7aa', color:'#c2410c' },
  'Employee':   { background:'#ecfdf5', borderColor:'#6ee7b7', color:'#065f46' },
  'Client':     { background:'#eff6ff', borderColor:'#bfdbfe', color:'#1d4ed8' },
  'Contractor': { background:'#f5f3ff', borderColor:'#ddd6fe', color:'#5b21b6' },
  'Government': { background:'#fef2f2', borderColor:'#fecaca', color:'#991b1b' },
};

const EMPTY_MODAL = { isNew:true, id:null, name:'', type:'Supplier', email:'', phone:'', tin:'', address:'', bankCode:'', bankAccountNumber:'', bankAccountName:'', notes:'' };

export default function ContactsPage() {
  const [contacts, setContacts] = useState([]);
  const [search,   setSearch]   = useState('');
  const [filterType, setFilterType] = useState('');
  const [modal,    setModal]    = useState(null);
  const [saving,   setSaving]   = useState(false);
  const [toast,    setToast]    = useState('');
  const [confirmModal, setConfirmModal] = useState(null);

  const showToast = (msg) => { setToast(msg); setTimeout(() => setToast(''), 3000); };
  const askConfirm = (message, onConfirm) => setConfirmModal({ message, onConfirm });

  useEffect(() => {
    const unsub = onSnapshot(
      query(collection(db,'contacts'), orderBy('name','asc')),
      s => setContacts(s.docs.map(d => ({ id:d.id, ...d.data() })))
    );
    return unsub;
  }, []);

  const filtered = useMemo(() => {
    let a = [...contacts];
    const q = search.toLowerCase();
    if (q) a = a.filter(x => (x.name||'').toLowerCase().includes(q) || (x.email||'').toLowerCase().includes(q) || (x.tin||'').toLowerCase().includes(q));
    if (filterType) a = a.filter(x => x.type === filterType);
    return a;
  }, [contacts, search, filterType]);

  const save = async () => {
    if (!modal) return;
    if (!modal.name?.trim()) { showToast('Name is required.'); return; }
    setSaving(true);
    try {
      const { isNew, id, ...rest } = modal;
      const payload = { ...rest, name:rest.name.trim(), updatedAt:serverTimestamp() };
      if (isNew) await addDoc(collection(db,'contacts'), { ...payload, createdAt:serverTimestamp() });
      else       await updateDoc(doc(db,'contacts',id), payload);
      showToast('Contact saved.'); setModal(null);
    } catch(e) { showToast('Error: '+e.message); }
    setSaving(false);
  };

  const doDelete = (c) => {
    askConfirm(`Delete contact "${c.name}"?`, async () => {
      await deleteDoc(doc(db,'contacts',c.id));
      showToast('Contact deleted.');
    });
  };

  const openEdit = (c) => setModal({ isNew:false, id:c.id, name:c.name||'', type:c.type||'Supplier', email:c.email||'', phone:c.phone||'', tin:c.tin||'', address:c.address||'', bankCode:c.bankCode||'', bankAccountNumber:c.bankAccountNumber||'', bankAccountName:c.bankAccountName||'', notes:c.notes||'' });

  return (
    <div className="ct-wrap">
      <style>{CSS}</style>
      <div className="ct-top">
        <strong style={{fontSize:18,fontWeight:900,color:'#0b1220'}}>CONTACTS</strong>
        <button className="btn btn-primary" onClick={()=>setModal({...EMPTY_MODAL})}>＋ Add Contact</button>
      </div>
      <div className="ct-body">
        <div className="toolbar">
          <input className="input" placeholder="🔍 Search name, email or TIN…" value={search} onChange={e=>setSearch(e.target.value)} style={{flex:'1 1 200px',minWidth:160}} />
          <select className="input" value={filterType} onChange={e=>setFilterType(e.target.value)}>
            <option value="">All Types</option>
            {CONTACT_TYPES.map(t=><option key={t}>{t}</option>)}
          </select>
          <button className="btn btn-ghost btn-sm" onClick={()=>{setSearch('');setFilterType('');}}>✕ Clear</button>
          <span style={{fontSize:12,color:'#94a3b8',fontWeight:600}}>{filtered.length} contact{filtered.length!==1?'s':''}</span>
        </div>
        <div className="card">
          <table>
            <thead>
              <tr><th>NAME</th><th>TYPE</th><th>EMAIL</th><th>PHONE</th><th>TIN</th><th>BANK</th><th style={{textAlign:'center'}}>ACTIONS</th></tr>
            </thead>
            <tbody>
              {filtered.length === 0 && <tr><td colSpan={7} className="empty">No contacts found.</td></tr>}
              {filtered.map(c => {
                const ps = TYPE_PILL[c.type] || {};
                return (
                  <tr key={c.id}>
                    <td><strong style={{color:'#0b1220'}}>{c.name}</strong></td>
                    <td><span className="pill" style={ps}>{c.type||'—'}</span></td>
                    <td style={{color:'#64748b'}}>{c.email||'—'}</td>
                    <td style={{color:'#64748b'}}>{c.phone||'—'}</td>
                    <td style={{fontFamily:'monospace',fontSize:12}}>{c.tin||'—'}</td>
                    <td style={{fontSize:12,color:'#64748b'}}>{c.bankCode ? `${c.bankCode} ${c.bankAccountNumber||''}`.trim() : '—'}</td>
                    <td style={{textAlign:'center'}}>
                      <div style={{display:'flex',gap:4,justifyContent:'center'}}>
                        <button className="btn btn-ghost btn-xs" onClick={()=>openEdit(c)}>Edit</button>
                        <button className="btn btn-ghost btn-xs" style={{color:'#dc2626'}} onClick={()=>doDelete(c)}>Delete</button>
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
          <div className="modal" onClick={e=>e.stopPropagation()}>
            <div className="modal-h">
              <strong>{modal.isNew?'Add Contact':'Edit Contact'}</strong>
              <button className="btn btn-ghost btn-sm" onClick={()=>setModal(null)}>✕</button>
            </div>
            <div className="modal-b">
              <div className="grid2">
                <div className="field col2">
                  <label>Full Name / Company Name</label>
                  <input value={modal.name} onChange={e=>setModal(m=>({...m,name:e.target.value}))} placeholder="Name" />
                </div>
                <div className="field">
                  <label>Type</label>
                  <select value={modal.type} onChange={e=>setModal(m=>({...m,type:e.target.value}))}>
                    {CONTACT_TYPES.map(t=><option key={t}>{t}</option>)}
                  </select>
                </div>
                <div className="field">
                  <label>TIN</label>
                  <input value={modal.tin} onChange={e=>setModal(m=>({...m,tin:e.target.value}))} placeholder="000-000-000" />
                </div>
                <div className="field">
                  <label>Email</label>
                  <input type="email" value={modal.email} onChange={e=>setModal(m=>({...m,email:e.target.value}))} placeholder="email@example.com" />
                </div>
                <div className="field">
                  <label>Phone</label>
                  <input value={modal.phone} onChange={e=>setModal(m=>({...m,phone:e.target.value}))} placeholder="+63..." />
                </div>
                <div className="field col2">
                  <label>Address</label>
                  <input value={modal.address} onChange={e=>setModal(m=>({...m,address:e.target.value}))} placeholder="Business address" />
                </div>
                <div className="field">
                  <label>Bank Code</label>
                  <input value={modal.bankCode} onChange={e=>setModal(m=>({...m,bankCode:e.target.value}))} placeholder="e.g. BPI" />
                </div>
                <div className="field">
                  <label>Bank Account Number</label>
                  <input value={modal.bankAccountNumber} onChange={e=>setModal(m=>({...m,bankAccountNumber:e.target.value}))} />
                </div>
                <div className="field col2">
                  <label>Bank Account Name</label>
                  <input value={modal.bankAccountName} onChange={e=>setModal(m=>({...m,bankAccountName:e.target.value}))} />
                </div>
                <div className="field col2">
                  <label>Notes</label>
                  <textarea value={modal.notes} onChange={e=>setModal(m=>({...m,notes:e.target.value}))} />
                </div>
              </div>
            </div>
            <div className="modal-f">
              <button className="btn btn-ghost" onClick={()=>setModal(null)}>Cancel</button>
              <button className="btn btn-primary" onClick={save} disabled={saving}>{saving?'Saving…':'Save Contact'}</button>
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

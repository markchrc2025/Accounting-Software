import { useState, useEffect } from 'react';
import { collection, query, orderBy, onSnapshot, addDoc, updateDoc, doc, serverTimestamp } from 'firebase/firestore';
import { db, auth } from '../../../firebase.js';

const fmt = (n) => new Intl.NumberFormat('en-PH', { style:'currency', currency:'PHP' }).format(n || 0);
const uid = () => Math.random().toString(36).slice(2, 10).toUpperCase();

const CONTACT_TYPES = ['Customer','Supplier','Employee','Other'];

const CSS = `
  .cop-wrap   { display:flex; flex-direction:column; height:100%; overflow:hidden; font-family:Inter,system-ui,sans-serif; }
  .cop-topbar { display:flex; align-items:center; justify-content:space-between; padding:16px 22px 12px; flex-shrink:0; border-bottom:1px solid #e5e7eb; background:#fff; }
  .cop-body   { flex:1; overflow-y:auto; padding:16px 22px; }
  .input      { border:1px solid #e5e7eb; border-radius:10px; padding:9px 12px; font-size:13px; background:#fff; }
  .btn        { border:0; border-radius:10px; padding:9px 16px; font-weight:700; cursor:pointer; font-size:13px; font-family:inherit; }
  .btn-primary { background:#f97316; color:#fff; }
  .btn-ghost   { background:#f1f5f9; color:#0b1220; }
  .btn-ghost:hover { background:#e2e8f0; }
  .btn-sm     { padding:6px 12px; font-size:12px; }
  .card       { background:#fff; border:1px solid #e5e7eb; border-radius:14px; overflow:hidden; }
  table       { width:100%; border-collapse:collapse; }
  th,td       { padding:11px 12px; border-bottom:1px solid #f1f5f9; font-size:13px; text-align:left; }
  th          { color:#64748b; font-weight:800; font-size:11px; letter-spacing:.05em; text-transform:uppercase; background:#f8fafc; }
  tr:hover td { background:#fafafa; }
  tr:last-child td { border-bottom:none; }
  .toolbar    { display:flex; gap:10px; align-items:center; flex-wrap:wrap; margin-bottom:14px; }
  .type-badge { display:inline-block; padding:2px 10px; border-radius:999px; font-size:11px; font-weight:700; }
  .empty      { padding:48px; text-align:center; color:#94a3b8; font-size:13px; }
  .backdrop   { position:fixed; inset:0; background:rgba(15,23,42,.45); display:flex; align-items:center; justify-content:center; padding:16px; z-index:100; }
  .modal      { width:min(640px,98vw); background:#fff; border-radius:16px; overflow:hidden; box-shadow:0 24px 64px rgba(0,0,0,.25); }
  .modal-h    { display:flex; align-items:center; justify-content:space-between; padding:16px 20px; border-bottom:1px solid #e5e7eb; background:#f8fafc; }
  .modal-b    { padding:20px; display:grid; grid-template-columns:1fr 1fr; gap:12px; }
  .modal-f    { display:flex; justify-content:flex-end; gap:10px; padding:14px 20px; border-top:1px solid #e5e7eb; }
  .field      { display:flex; flex-direction:column; gap:5px; }
  .field.full { grid-column:span 2; }
  .field label { font-size:10px; font-weight:800; color:#64748b; letter-spacing:.06em; text-transform:uppercase; }
  .field input,.field select,.field textarea { width:100%; border:1px solid #e5e7eb; border-radius:10px; padding:9px 10px; font-size:13px; background:#fff; font-family:inherit; box-sizing:border-box; }
  .toast { position:fixed; right:16px; bottom:16px; background:#0b1220; color:#fff; padding:12px 18px; border-radius:12px; font-size:13px; font-weight:600; z-index:999; }
`;

const TYPE_BADGE = { Customer:'#dcfce7,#15803d', Supplier:'#dbeafe,#1d4ed8', Employee:'#f3e8ff,#7c3aed', Other:'#f1f5f9,#64748b' };

export default function ContactsPage() {
  const [contacts, setContacts] = useState([]);
  const [search, setSearch]     = useState('');
  const [typeFilter, setType]   = useState('All');
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing]   = useState(null);
  const [form, setForm]         = useState({});
  const [saving, setSaving]     = useState(false);
  const [toast, setToast]       = useState('');

  const showToast = (msg) => { setToast(msg); setTimeout(() => setToast(''), 3000); };

  useEffect(() => {
    const unsub = onSnapshot(
      query(collection(db, 'contacts'), orderBy('name')),
      snap => setContacts(snap.docs.map(d => ({ id:d.id, ...d.data() })))
    );
    return unsub;
  }, []);

  function openCreate() {
    setEditing(null);
    setForm({ type:'Customer', isActive:true });
    setShowModal(true);
  }
  function openEdit(c) {
    setEditing(c.id);
    setForm({ ...c });
    setShowModal(true);
  }

  async function handleSave() {
    if (!form.name) return alert('Name is required.');
    setSaving(true);
    try {
      const payload = { ...form, updatedAt: serverTimestamp() };
      if (editing) {
        await updateDoc(doc(db, 'contacts', editing), payload);
        showToast('Contact updated.');
      } else {
        await addDoc(collection(db, 'contacts'), { ...payload, createdAt: serverTimestamp(), createdBy: auth.currentUser?.email });
        showToast('Contact added.');
      }
      setShowModal(false);
    } catch (e) { alert(e.message); }
    setSaving(false);
  }

  const filtered = contacts.filter(c => {
    const matchType = typeFilter === 'All' || c.type === typeFilter;
    const matchSearch = !search || [c.name, c.tin, c.email, c.contactId].some(s => String(s||'').toLowerCase().includes(search.toLowerCase()));
    return matchType && matchSearch;
  });

  return (
    <div className="cop-wrap">
      <style>{CSS}</style>
      <div className="cop-topbar">
        <div>
          <h1 style={{ margin:0, fontSize:18, fontWeight:900 }}>Contacts</h1>
          <p style={{ margin:0, fontSize:12, color:'#64748b' }}>{filtered.length} contact{filtered.length!==1?'s':''}</p>
        </div>
        <button className="btn btn-primary" onClick={openCreate}>+ New Contact</button>
      </div>

      <div className="cop-body">
        <div className="toolbar">
          <input className="input" placeholder="Search name, TIN, email…" value={search} onChange={e=>setSearch(e.target.value)} style={{width:240}} />
          <select className="input" value={typeFilter} onChange={e=>setType(e.target.value)}>
            <option>All</option>
            {CONTACT_TYPES.map(t => <option key={t}>{t}</option>)}
          </select>
        </div>

        <div className="card">
          {filtered.length === 0 ? (
            <div className="empty">No contacts. <span style={{color:'#f97316',cursor:'pointer',fontWeight:700}} onClick={openCreate}>Add the first contact →</span></div>
          ) : (
            <table>
              <thead><tr><th>Name</th><th>Type</th><th>TIN</th><th>Business Style</th><th>Email</th><th>Phone</th><th>Address</th><th>Actions</th></tr></thead>
              <tbody>
                {filtered.map(c => {
                  const [bg, color] = (TYPE_BADGE[c.type]||TYPE_BADGE.Other).split(',');
                  return (
                    <tr key={c.id}>
                      <td style={{ fontWeight:700 }}>{c.name}</td>
                      <td><span className="type-badge" style={{ background:bg, color }}>{c.type}</span></td>
                      <td style={{ fontFamily:'monospace', fontSize:12 }}>{c.tin}</td>
                      <td style={{ fontSize:12, color:'#64748b' }}>{c.businessStyle}</td>
                      <td style={{ fontSize:12 }}>{c.email}</td>
                      <td style={{ fontSize:12 }}>{c.phone}</td>
                      <td style={{ fontSize:11, color:'#94a3b8', maxWidth:160, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{c.address}</td>
                      <td><button className="btn btn-ghost btn-sm" onClick={() => openEdit(c)}>Edit</button></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {showModal && (
        <div className="backdrop" onClick={e=>e.target===e.currentTarget&&setShowModal(false)}>
          <div className="modal">
            <div className="modal-h"><strong>{editing?'Edit Contact':'New Contact'}</strong><button className="btn btn-ghost btn-sm" onClick={()=>setShowModal(false)}>✕</button></div>
            <div className="modal-b">
              <div className="field full"><label>Full Name / Company *</label><input value={form.name||''} onChange={e=>setForm(f=>({...f,name:e.target.value}))} /></div>
              <div className="field"><label>Contact Type</label>
                <select value={form.type||'Customer'} onChange={e=>setForm(f=>({...f,type:e.target.value}))}>
                  {CONTACT_TYPES.map(t => <option key={t}>{t}</option>)}
                </select>
              </div>
              <div className="field"><label>TIN</label><input value={form.tin||''} onChange={e=>setForm(f=>({...f,tin:e.target.value}))} placeholder="000-000-000-000" /></div>
              <div className="field"><label>Business Style</label><input value={form.businessStyle||''} onChange={e=>setForm(f=>({...f,businessStyle:e.target.value}))} /></div>
              <div className="field"><label>Email</label><input type="email" value={form.email||''} onChange={e=>setForm(f=>({...f,email:e.target.value}))} /></div>
              <div className="field"><label>Phone</label><input value={form.phone||''} onChange={e=>setForm(f=>({...f,phone:e.target.value}))} /></div>
              <div className="field full"><label>Address</label><textarea rows={2} value={form.address||''} onChange={e=>setForm(f=>({...f,address:e.target.value}))} /></div>
              <div className="field"><label>CC Emails (comma-separated)</label><input value={form.ccEmails||''} onChange={e=>setForm(f=>({...f,ccEmails:e.target.value}))} /></div>
              <div className="field"><label>Payment Terms (days)</label><input type="number" value={form.terms||''} onChange={e=>setForm(f=>({...f,terms:e.target.value}))} placeholder="30" /></div>
            </div>
            <div className="modal-f">
              <button className="btn btn-ghost" onClick={()=>setShowModal(false)}>Cancel</button>
              <button className="btn btn-primary" onClick={handleSave} disabled={saving}>{saving?'Saving…':editing?'Save Changes':'Add Contact'}</button>
            </div>
          </div>
        </div>
      )}
      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}

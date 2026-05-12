import { useState, useEffect } from 'react';
import { collection, query, orderBy, onSnapshot, addDoc, updateDoc, doc, serverTimestamp, getDocs } from 'firebase/firestore';
import { useNavigate } from 'react-router-dom';
import { db, auth } from '../../../firebase.js';

const fmt = (n) => new Intl.NumberFormat('en-PH', { style:'currency', currency:'PHP' }).format(n || 0);

const CSS = `
  .bbp-wrap   { display:flex; flex-direction:column; height:100%; overflow:hidden; font-family:Inter,system-ui,sans-serif; }
  .bbp-topbar { display:flex; align-items:center; justify-content:space-between; padding:16px 22px 12px; flex-shrink:0; border-bottom:1px solid #e5e7eb; background:#fff; }
  .bbp-body   { flex:1; overflow-y:auto; padding:16px 22px; }
  .input      { border:1px solid #e5e7eb; border-radius:10px; padding:9px 12px; font-size:13px; background:#fff; }
  .btn        { border:0; border-radius:10px; padding:9px 16px; font-weight:700; cursor:pointer; font-size:13px; font-family:inherit; }
  .btn-primary { background:#f97316; color:#fff; }
  .btn-ghost   { background:#f1f5f9; color:#0b1220; }
  .btn-ghost:hover { background:#e2e8f0; }
  .btn-sm     { padding:6px 12px; font-size:12px; }
  .toolbar    { display:flex; gap:10px; align-items:center; flex-wrap:wrap; margin-bottom:14px; }
  .client-grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(280px,1fr)); gap:14px; }
  .client-card { background:#fff; border:1px solid #e5e7eb; border-radius:14px; padding:18px; cursor:pointer; transition:box-shadow .15s, border-color .15s; }
  .client-card:hover { box-shadow:0 4px 16px rgba(0,0,0,.08); border-color:#f97316; }
  .client-name { font-size:15px; font-weight:900; color:#0f172a; margin-bottom:2px; }
  .client-tin  { font-size:11px; color:#94a3b8; font-family:monospace; }
  .client-stats { display:flex; justify-content:space-between; margin-top:14px; padding-top:14px; border-top:1px solid #f1f5f9; }
  .stat-col    { text-align:center; }
  .stat-label  { font-size:9px; font-weight:800; color:#94a3b8; letter-spacing:.07em; text-transform:uppercase; }
  .stat-value  { font-size:13px; font-weight:900; color:#0f172a; margin-top:2px; }
  .empty       { padding:64px; text-align:center; color:#94a3b8; font-size:13px; }
  .backdrop    { position:fixed; inset:0; background:rgba(15,23,42,.45); display:flex; align-items:center; justify-content:center; padding:16px; z-index:100; }
  .modal       { width:min(640px,98vw); background:#fff; border-radius:16px; overflow:hidden; box-shadow:0 24px 64px rgba(0,0,0,.25); }
  .modal-h     { display:flex; align-items:center; justify-content:space-between; padding:16px 20px; border-bottom:1px solid #e5e7eb; background:#f8fafc; }
  .modal-b     { padding:20px; display:grid; grid-template-columns:1fr 1fr; gap:12px; }
  .modal-f     { display:flex; justify-content:flex-end; gap:10px; padding:14px 20px; border-top:1px solid #e5e7eb; }
  .field       { display:flex; flex-direction:column; gap:5px; }
  .field.full  { grid-column:span 2; }
  .field label { font-size:10px; font-weight:800; color:#64748b; letter-spacing:.06em; text-transform:uppercase; }
  .field input,.field select,.field textarea { width:100%; border:1px solid #e5e7eb; border-radius:10px; padding:9px 10px; font-size:13px; background:#fff; font-family:inherit; box-sizing:border-box; }
  .toast { position:fixed; right:16px; bottom:16px; background:#0b1220; color:#fff; padding:12px 18px; border-radius:12px; font-size:13px; font-weight:600; z-index:999; }
`;

export default function BillingPage() {
  const navigate = useNavigate();
  const [books, setBooks]       = useState([]);
  const [contacts, setContacts] = useState([]);
  const [search, setSearch]     = useState('');
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing]   = useState(null);
  const [form, setForm]         = useState({});
  const [saving, setSaving]     = useState(false);
  const [toast, setToast]       = useState('');

  const showToast = (msg) => { setToast(msg); setTimeout(() => setToast(''), 3000); };

  useEffect(() => {
    const unsub = onSnapshot(
      query(collection(db, 'billingBooks'), orderBy('contactName')),
      snap => setBooks(snap.docs.map(d => ({ id:d.id, ...d.data() })))
    );
    getDocs(collection(db, 'contacts')).then(s => setContacts(s.docs.map(d => ({ id:d.id, ...d.data() }))));
    return unsub;
  }, []);

  function openCreate() {
    setEditing(null);
    setForm({ terms: 30 });
    setShowModal(true);
  }
  function openEdit(e, book) {
    e.stopPropagation();
    setEditing(book.id);
    setForm({ ...book });
    setShowModal(true);
  }

  async function handleSave() {
    if (!form.contactName) return alert('Client name is required.');
    setSaving(true);
    try {
      const payload = { ...form, terms: parseInt(form.terms)||30, updatedAt: serverTimestamp() };
      if (editing) {
        await updateDoc(doc(db, 'billingBooks', editing), payload);
        showToast('Billing book updated.');
      } else {
        await addDoc(collection(db, 'billingBooks'), { ...payload, createdAt: serverTimestamp(), createdBy: auth.currentUser?.email });
        showToast('Billing book created.');
      }
      setShowModal(false);
    } catch (e) { alert(e.message); }
    setSaving(false);
  }

  const filtered = books.filter(b => {
    return !search || [b.contactName, b.tin, b.businessStyle].some(s => String(s||'').toLowerCase().includes(search.toLowerCase()));
  });

  return (
    <div className="bbp-wrap">
      <style>{CSS}</style>
      <div className="bbp-topbar">
        <div>
          <h1 style={{ margin:0, fontSize:18, fontWeight:900 }}>Billing Book</h1>
          <p style={{ margin:0, fontSize:12, color:'#64748b' }}>{filtered.length} client ledger{filtered.length!==1?'s':''}</p>
        </div>
        <button className="btn btn-primary" onClick={openCreate}>+ New Client Ledger</button>
      </div>

      <div className="bbp-body">
        <div className="toolbar">
          <input className="input" placeholder="Search client name, TIN…" value={search} onChange={e=>setSearch(e.target.value)} style={{width:260}} />
        </div>

        {filtered.length === 0 ? (
          <div style={{ background:'#fff', border:'1px solid #e5e7eb', borderRadius:14 }}>
            <div className="empty">No billing books. <span style={{color:'#f97316',cursor:'pointer',fontWeight:700}} onClick={openCreate}>Create first client ledger →</span></div>
          </div>
        ) : (
          <div className="client-grid">
            {filtered.map(b => (
              <div key={b.id} className="client-card" onClick={() => navigate(`/scalebooks/billing/${b.id}`)}>
                <div className="client-name">{b.contactName}</div>
                <div className="client-tin">{b.tin} {b.businessStyle ? `· ${b.businessStyle}` : ''}</div>
                {b.address && <div style={{ fontSize:11, color:'#94a3b8', marginTop:4 }}>{b.address}</div>}
                <div className="client-stats">
                  <div className="stat-col">
                    <div className="stat-label">Billed</div>
                    <div className="stat-value" style={{color:'#1d4ed8', fontSize:12}}>{fmt(b.totalBilled||0)}</div>
                  </div>
                  <div className="stat-col">
                    <div className="stat-label">Collected</div>
                    <div className="stat-value" style={{color:'#15803d', fontSize:12}}>{fmt(b.totalCollected||0)}</div>
                  </div>
                  <div className="stat-col">
                    <div className="stat-label">Balance</div>
                    <div className="stat-value" style={{color: (b.totalBilled||0)-(b.totalCollected||0)>0?'#dc2626':'#15803d', fontSize:12}}>
                      {fmt((b.totalBilled||0)-(b.totalCollected||0))}
                    </div>
                  </div>
                  <div className="stat-col">
                    <div className="stat-label">Terms</div>
                    <div className="stat-value" style={{fontSize:12}}>{b.terms||30}d</div>
                  </div>
                </div>
                <div style={{ marginTop:10, display:'flex', justifyContent:'flex-end' }}>
                  <button className="btn btn-ghost btn-sm" onClick={e=>openEdit(e,b)}>Edit</button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {showModal && (
        <div className="backdrop" onClick={e=>e.target===e.currentTarget&&setShowModal(false)}>
          <div className="modal">
            <div className="modal-h"><strong>{editing?'Edit Billing Book':'New Client Ledger'}</strong><button className="btn btn-ghost btn-sm" onClick={()=>setShowModal(false)}>✕</button></div>
            <div className="modal-b">
              <div className="field full">
                <label>Client / Company Name *</label>
                <input value={form.contactName||''} onChange={e=>setForm(f=>({...f,contactName:e.target.value}))} list="contacts-list" placeholder="Type or select contact" />
                <datalist id="contacts-list">{contacts.map(c => <option key={c.id} value={c.name||c.contactName} />)}</datalist>
              </div>
              <div className="field"><label>TIN</label><input value={form.tin||''} onChange={e=>setForm(f=>({...f,tin:e.target.value}))} placeholder="000-000-000-000" /></div>
              <div className="field"><label>Business Style</label><input value={form.businessStyle||''} onChange={e=>setForm(f=>({...f,businessStyle:e.target.value}))} /></div>
              <div className="field full"><label>Address</label><textarea rows={2} value={form.address||''} onChange={e=>setForm(f=>({...f,address:e.target.value}))} /></div>
              <div className="field"><label>Primary Emails</label><input value={form.primaryEmails||''} onChange={e=>setForm(f=>({...f,primaryEmails:e.target.value}))} placeholder="email@client.com" /></div>
              <div className="field"><label>CC Emails</label><input value={form.ccEmails||''} onChange={e=>setForm(f=>({...f,ccEmails:e.target.value}))} placeholder="Comma-separated" /></div>
              <div className="field"><label>Payment Terms (days)</label><input type="number" value={form.terms||30} onChange={e=>setForm(f=>({...f,terms:e.target.value}))} /></div>
            </div>
            <div className="modal-f">
              <button className="btn btn-ghost" onClick={()=>setShowModal(false)}>Cancel</button>
              <button className="btn btn-primary" onClick={handleSave} disabled={saving}>{saving?'Saving…':editing?'Save Changes':'Create Ledger'}</button>
            </div>
          </div>
        </div>
      )}
      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}

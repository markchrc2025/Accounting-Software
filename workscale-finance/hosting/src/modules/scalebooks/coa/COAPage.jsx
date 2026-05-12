import { useState, useEffect } from 'react';
import { collection, query, orderBy, onSnapshot, addDoc, updateDoc, doc, serverTimestamp } from 'firebase/firestore';
import { db, auth } from '../../../firebase.js';

const ACCOUNT_TYPES = ['Asset','Liability','Equity','Revenue','Expense','Cost of Sales','Other Income','Other Expense'];
const NORMAL_BALANCE = { Asset:'Debit', Liability:'Credit', Equity:'Credit', Revenue:'Credit', Expense:'Debit', 'Cost of Sales':'Debit', 'Other Income':'Credit', 'Other Expense':'Debit' };

const CSS = `
  .cp-wrap   { display:flex; flex-direction:column; height:100%; overflow:hidden; font-family:Inter,system-ui,sans-serif; }
  .cp-topbar { display:flex; align-items:center; justify-content:space-between; padding:16px 22px 12px; flex-shrink:0; border-bottom:1px solid #e5e7eb; background:#fff; }
  .cp-body   { flex:1; overflow-y:auto; padding:16px 22px; }
  .input     { border:1px solid #e5e7eb; border-radius:10px; padding:9px 12px; font-size:13px; background:#fff; }
  .btn       { border:0; border-radius:10px; padding:9px 16px; font-weight:700; cursor:pointer; font-size:13px; font-family:inherit; }
  .btn-primary { background:#f97316; color:#fff; }
  .btn-ghost   { background:#f1f5f9; color:#0b1220; }
  .btn-ghost:hover { background:#e2e8f0; }
  .btn-sm    { padding:6px 12px; font-size:12px; }
  .card      { background:#fff; border:1px solid #e5e7eb; border-radius:14px; overflow:hidden; }
  table      { width:100%; border-collapse:collapse; }
  th,td      { padding:11px 12px; border-bottom:1px solid #f1f5f9; font-size:13px; text-align:left; }
  th         { color:#64748b; font-weight:800; font-size:11px; letter-spacing:.05em; text-transform:uppercase; background:#f8fafc; position:sticky; top:0; }
  tr:hover td { background:#fafafa; }
  tr:last-child td { border-bottom:none; }
  .toolbar   { display:flex; gap:10px; align-items:center; flex-wrap:wrap; margin-bottom:14px; }
  .type-badge { display:inline-block; padding:2px 8px; border-radius:999px; font-size:11px; font-weight:700; }
  .empty     { padding:48px; text-align:center; color:#94a3b8; font-size:13px; }
  .backdrop  { position:fixed; inset:0; background:rgba(15,23,42,.45); display:flex; align-items:center; justify-content:center; padding:16px; z-index:100; }
  .modal     { width:min(540px,98vw); background:#fff; border-radius:16px; display:flex; flex-direction:column; overflow:hidden; box-shadow:0 24px 64px rgba(0,0,0,.25); }
  .modal-h   { display:flex; align-items:center; justify-content:space-between; padding:16px 20px; border-bottom:1px solid #e5e7eb; background:#f8fafc; }
  .modal-b   { padding:20px; display:grid; grid-template-columns:1fr 1fr; gap:12px; }
  .modal-f   { display:flex; justify-content:flex-end; gap:10px; padding:14px 20px; border-top:1px solid #e5e7eb; }
  .field     { display:flex; flex-direction:column; gap:5px; }
  .field.full { grid-column:span 2; }
  .field label { font-size:10px; font-weight:800; color:#64748b; letter-spacing:.06em; text-transform:uppercase; }
  .field input,.field select,.field textarea { width:100%; border:1px solid #e5e7eb; border-radius:10px; padding:9px 10px; font-size:13px; background:#fff; font-family:inherit; box-sizing:border-box; }
  .toast { position:fixed; right:16px; bottom:16px; background:#0b1220; color:#fff; padding:12px 18px; border-radius:12px; font-size:13px; font-weight:600; z-index:999; }
`;

const TYPE_COLORS = {
  Asset:'#dbeafe', Liability:'#fef9c3', Equity:'#f3e8ff', Revenue:'#dcfce7',
  Expense:'#fee2e2', 'Cost of Sales':'#ffedd5', 'Other Income':'#d1fae5', 'Other Expense':'#fecaca'
};

export default function COAPage() {
  const [accounts, setAccounts] = useState([]);
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
      query(collection(db, 'accounts'), orderBy('code')),
      snap => setAccounts(snap.docs.map(d => ({ id: d.id, ...d.data() })))
    );
    return unsub;
  }, []);

  function openCreate() {
    setEditing(null);
    setForm({ isActive: true, normalBalance: 'Debit' });
    setShowModal(true);
  }
  function openEdit(a) {
    setEditing(a.id);
    setForm({ ...a });
    setShowModal(true);
  }

  async function handleSave() {
    if (!form.code) return alert('Account code is required.');
    if (!form.name) return alert('Account name is required.');
    setSaving(true);
    try {
      const payload = { ...form, updatedAt: serverTimestamp() };
      if (editing) {
        await updateDoc(doc(db, 'accounts', editing), payload);
        showToast('Account updated.');
      } else {
        await addDoc(collection(db, 'accounts'), { ...payload, createdAt: serverTimestamp(), createdBy: auth.currentUser?.email });
        showToast('Account created.');
      }
      setShowModal(false);
    } catch (e) { alert(e.message); }
    setSaving(false);
  }

  async function toggleActive(a) {
    await updateDoc(doc(db, 'accounts', a.id), { isActive: !a.isActive });
    showToast(a.isActive ? 'Account deactivated.' : 'Account activated.');
  }

  const filtered = accounts.filter(a => {
    const matchType = typeFilter === 'All' || a.type === typeFilter;
    const matchSearch = !search || [a.code, a.name].some(s => String(s||'').toLowerCase().includes(search.toLowerCase()));
    return matchType && matchSearch;
  });

  return (
    <div className="cp-wrap">
      <style>{CSS}</style>
      <div className="cp-topbar">
        <div>
          <h1 style={{ margin:0, fontSize:18, fontWeight:900 }}>Chart of Accounts</h1>
          <p style={{ margin:0, fontSize:12, color:'#64748b' }}>{filtered.length} account{filtered.length!==1?'s':''}</p>
        </div>
        <button className="btn btn-primary" onClick={openCreate}>+ New Account</button>
      </div>

      <div className="cp-body">
        <div className="toolbar">
          <input className="input" placeholder="Search code or name…" value={search} onChange={e=>setSearch(e.target.value)} style={{width:220}} />
          <select className="input" value={typeFilter} onChange={e=>setType(e.target.value)}>
            <option>All</option>
            {ACCOUNT_TYPES.map(t => <option key={t}>{t}</option>)}
          </select>
        </div>

        <div className="card">
          {filtered.length === 0 ? (
            <div className="empty">No accounts. <span style={{color:'#f97316',cursor:'pointer',fontWeight:700}} onClick={openCreate}>Add the first account →</span></div>
          ) : (
            <table>
              <thead><tr><th>Code</th><th>Name</th><th>Type</th><th>Normal Balance</th><th>Description</th><th>Status</th><th>Actions</th></tr></thead>
              <tbody>
                {filtered.map(a => (
                  <tr key={a.id} style={{ opacity: a.isActive === false ? .5 : 1 }}>
                    <td style={{ fontFamily:'monospace', fontWeight:800, color:'#475569' }}>{a.code}</td>
                    <td style={{ fontWeight:700 }}>{a.name}</td>
                    <td><span className="type-badge" style={{ background: TYPE_COLORS[a.type]||'#f1f5f9' }}>{a.type}</span></td>
                    <td style={{ fontSize:12, color:'#64748b' }}>{a.normalBalance}</td>
                    <td style={{ color:'#94a3b8', fontSize:12 }}>{a.description}</td>
                    <td><span style={{ color: a.isActive !== false ? '#15803d' : '#94a3b8', fontWeight:700, fontSize:12 }}>{a.isActive !== false ? 'Active' : 'Inactive'}</span></td>
                    <td>
                      <div style={{ display:'flex', gap:6 }}>
                        <button className="btn btn-ghost btn-sm" onClick={() => openEdit(a)}>Edit</button>
                        <button className="btn btn-ghost btn-sm" onClick={() => toggleActive(a)} style={{ color: a.isActive!==false?'#dc2626':'#15803d' }}>
                          {a.isActive !== false ? 'Deactivate' : 'Activate'}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {showModal && (
        <div className="backdrop" onClick={e => e.target===e.currentTarget && setShowModal(false)}>
          <div className="modal">
            <div className="modal-h">
              <strong>{editing ? 'Edit Account' : 'New Account'}</strong>
              <button className="btn btn-ghost btn-sm" onClick={() => setShowModal(false)}>✕</button>
            </div>
            <div className="modal-b">
              <div className="field"><label>Account Code *</label><input value={form.code||''} onChange={e=>setForm(f=>({...f,code:e.target.value}))} placeholder="e.g. 1010" /></div>
              <div className="field"><label>Account Type *</label>
                <select value={form.type||''} onChange={e=>setForm(f=>({...f, type:e.target.value, normalBalance:NORMAL_BALANCE[e.target.value]||'Debit'}))}>
                  <option value="">Select type</option>
                  {ACCOUNT_TYPES.map(t => <option key={t}>{t}</option>)}
                </select>
              </div>
              <div className="field full"><label>Account Name *</label><input value={form.name||''} onChange={e=>setForm(f=>({...f,name:e.target.value}))} placeholder="e.g. Cash on Hand" /></div>
              <div className="field"><label>Normal Balance</label>
                <select value={form.normalBalance||'Debit'} onChange={e=>setForm(f=>({...f,normalBalance:e.target.value}))}>
                  <option>Debit</option><option>Credit</option>
                </select>
              </div>
              <div className="field"><label>Active</label>
                <select value={form.isActive===false?'false':'true'} onChange={e=>setForm(f=>({...f,isActive:e.target.value==='true'}))}>
                  <option value="true">Yes</option><option value="false">No</option>
                </select>
              </div>
              <div className="field full"><label>Description</label><textarea rows={2} value={form.description||''} onChange={e=>setForm(f=>({...f,description:e.target.value}))} /></div>
            </div>
            <div className="modal-f">
              <button className="btn btn-ghost" onClick={()=>setShowModal(false)}>Cancel</button>
              <button className="btn btn-primary" onClick={handleSave} disabled={saving}>{saving?'Saving…':editing?'Save Changes':'Create Account'}</button>
            </div>
          </div>
        </div>
      )}
      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}

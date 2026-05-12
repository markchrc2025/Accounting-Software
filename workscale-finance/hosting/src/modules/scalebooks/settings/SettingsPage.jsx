import { useState, useEffect } from 'react';
import { collection, query, onSnapshot, addDoc, updateDoc, doc, serverTimestamp, orderBy, getDocs } from 'firebase/firestore';
import { db, auth } from '../../../firebase.js';

const CSS = `
  .sp-wrap   { display:flex; flex-direction:column; height:100%; overflow:hidden; font-family:Inter,system-ui,sans-serif; }
  .sp-topbar { display:flex; align-items:center; justify-content:space-between; padding:16px 22px 12px; flex-shrink:0; border-bottom:1px solid #e5e7eb; background:#fff; }
  .sp-body   { flex:1; overflow-y:auto; padding:16px 22px; }
  .input     { border:1px solid #e5e7eb; border-radius:10px; padding:9px 12px; font-size:13px; background:#fff; }
  .btn       { border:0; border-radius:10px; padding:9px 16px; font-weight:700; cursor:pointer; font-size:13px; font-family:inherit; }
  .btn-primary { background:#f97316; color:#fff; }
  .btn-ghost   { background:#f1f5f9; color:#0b1220; }
  .btn-ghost:hover { background:#e2e8f0; }
  .btn-sm    { padding:6px 12px; font-size:12px; }
  .card      { background:#fff; border:1px solid #e5e7eb; border-radius:14px; overflow:hidden; margin-bottom:12px; }
  table      { width:100%; border-collapse:collapse; }
  th,td      { padding:11px 14px; border-bottom:1px solid #f1f5f9; font-size:13px; text-align:left; }
  th         { color:#64748b; font-weight:800; font-size:11px; letter-spacing:.05em; text-transform:uppercase; background:#f8fafc; }
  tr:hover td { background:#fafafa; }
  tr:last-child td { border-bottom:none; }
  .empty     { padding:48px; text-align:center; color:#94a3b8; }
  .backdrop  { position:fixed; inset:0; background:rgba(15,23,42,.45); display:flex; align-items:center; justify-content:center; padding:16px; z-index:100; }
  .modal     { width:min(520px,98vw); background:#fff; border-radius:16px; overflow:hidden; box-shadow:0 24px 64px rgba(0,0,0,.25); }
  .modal-h   { display:flex; align-items:center; justify-content:space-between; padding:16px 20px; border-bottom:1px solid #e5e7eb; background:#f8fafc; }
  .modal-f   { display:flex; justify-content:flex-end; gap:10px; padding:14px 20px; border-top:1px solid #e5e7eb; }
  .section-title { font-size:11px; font-weight:800; color:#64748b; letter-spacing:.07em; text-transform:uppercase; margin:20px 0 8px; }
  .toast { position:fixed; right:16px; bottom:16px; background:#0b1220; color:#fff; padding:12px 18px; border-radius:12px; font-size:13px; font-weight:600; z-index:999; }
`;

export default function SettingsPage() {
  const [settings, setSettings] = useState([]);
  const [users, setUsers]       = useState([]);
  const [editingId, setEditingId] = useState(null);
  const [editingValue, setEditingValue] = useState('');
  const [showAddModal, setShowAddModal] = useState(false);
  const [newKey, setNewKey]     = useState('');
  const [newValue, setNewValue] = useState('');
  const [saving, setSaving]     = useState(false);
  const [toast, setToast]       = useState('');

  const showToast = (msg) => { setToast(msg); setTimeout(() => setToast(''), 3000); };

  useEffect(() => {
    const unsubS = onSnapshot(query(collection(db,'appSettings'), orderBy('key')), snap=>setSettings(snap.docs.map(d=>({id:d.id,...d.data()}))));
    getDocs(collection(db,'users')).then(snap=>setUsers(snap.docs.map(d=>({id:d.id,...d.data()}))));
    return unsubS;
  }, []);

  async function saveEdit(id) {
    setSaving(true);
    try {
      await updateDoc(doc(db,'appSettings',id), { value:editingValue, updatedAt:serverTimestamp() });
      setEditingId(null);
      showToast('Setting saved.');
    } catch(e) { alert(e.message); }
    setSaving(false);
  }

  async function addSetting() {
    if (!newKey.trim()) return alert('Key is required.');
    setSaving(true);
    try {
      await addDoc(collection(db,'appSettings'), { key:newKey.trim(), value:newValue, createdAt:serverTimestamp(), createdBy:auth.currentUser?.email });
      setShowAddModal(false);
      setNewKey('');
      setNewValue('');
      showToast('Setting added.');
    } catch(e) { alert(e.message); }
    setSaving(false);
  }

  return (
    <div className="sp-wrap">
      <style>{CSS}</style>
      <div className="sp-topbar">
        <div>
          <h1 style={{ margin:0, fontSize:18, fontWeight:900 }}>Settings</h1>
          <p style={{ margin:0, fontSize:12, color:'#64748b' }}>App configuration and user access</p>
        </div>
        <button className="btn btn-primary" onClick={()=>{setShowAddModal(true);}}>+ Add Setting</button>
      </div>

      <div className="sp-body">
        <div style={{ fontSize:11, color:'#64748b', marginBottom:4, fontWeight:800, letterSpacing:'.07em', textTransform:'uppercase' }}>App Settings</div>
        <div className="card">
          {settings.length===0 ? (
            <div className="empty">No settings configured. Add key/value pairs above.</div>
          ) : (
            <table>
              <thead><tr><th style={{width:'35%'}}>Key</th><th>Value</th><th style={{width:120}}>Actions</th></tr></thead>
              <tbody>
                {settings.map(s=>(
                  <tr key={s.id}>
                    <td style={{fontFamily:'monospace',fontWeight:800,fontSize:12,color:'#475569'}}>{s.key}</td>
                    <td>
                      {editingId===s.id ? (
                        <input
                          value={editingValue}
                          onChange={e=>setEditingValue(e.target.value)}
                          style={{width:'100%',border:'1px solid #e5e7eb',borderRadius:8,padding:'6px 10px',fontSize:13,fontFamily:'inherit'}}
                          autoFocus
                          onKeyDown={e=>{ if(e.key==='Enter') saveEdit(s.id); if(e.key==='Escape') setEditingId(null); }}
                        />
                      ) : (
                        <span style={{color:'#0f172a'}}>{s.value}</span>
                      )}
                    </td>
                    <td>
                      {editingId===s.id ? (
                        <div style={{display:'flex',gap:6}}>
                          <button className="btn btn-sm btn-primary" onClick={()=>saveEdit(s.id)} disabled={saving}>Save</button>
                          <button className="btn btn-sm btn-ghost" onClick={()=>setEditingId(null)}>Cancel</button>
                        </div>
                      ) : (
                        <button className="btn btn-ghost btn-sm" onClick={()=>{setEditingId(s.id);setEditingValue(s.value);}}>Edit</button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div style={{ fontSize:11, color:'#64748b', marginTop:24, marginBottom:8, fontWeight:800, letterSpacing:'.07em', textTransform:'uppercase' }}>Users</div>
        <div className="card">
          {users.length===0 ? (
            <div className="empty">No users found in database.</div>
          ) : (
            <table>
              <thead><tr><th>Email</th><th>Role</th><th>Created</th></tr></thead>
              <tbody>
                {users.map(u=>(
                  <tr key={u.id}>
                    <td style={{fontWeight:700}}>{u.email||u.id}</td>
                    <td><span style={{background:'#eff6ff',color:'#1d4ed8',border:'1px solid #bfdbfe',borderRadius:999,padding:'2px 9px',fontSize:11,fontWeight:700}}>{u.role||'User'}</span></td>
                    <td style={{color:'#94a3b8',fontSize:12}}>{u.createdAt?.toDate?.()?.toLocaleDateString('en-PH')||'—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <div style={{ padding:'12px 16px', fontSize:12, color:'#94a3b8', borderTop:'1px solid #f1f5f9' }}>Contact the admin to add or remove user access.</div>
        </div>
      </div>

      {showAddModal && (
        <div className="backdrop" onClick={e=>e.target===e.currentTarget&&setShowAddModal(false)}>
          <div className="modal">
            <div className="modal-h"><strong>Add Setting</strong><button className="btn btn-ghost btn-sm" onClick={()=>setShowAddModal(false)}>✕</button></div>
            <div style={{padding:20,display:'flex',flexDirection:'column',gap:12}}>
              <div style={{display:'flex',flexDirection:'column',gap:5}}>
                <label style={{fontSize:10,fontWeight:800,color:'#64748b',letterSpacing:'.06em',textTransform:'uppercase'}}>Key *</label>
                <input className="input" value={newKey} onChange={e=>setNewKey(e.target.value)} placeholder="e.g. company_name" />
              </div>
              <div style={{display:'flex',flexDirection:'column',gap:5}}>
                <label style={{fontSize:10,fontWeight:800,color:'#64748b',letterSpacing:'.06em',textTransform:'uppercase'}}>Value</label>
                <input className="input" value={newValue} onChange={e=>setNewValue(e.target.value)} placeholder="Setting value" />
              </div>
            </div>
            <div className="modal-f">
              <button className="btn btn-ghost" onClick={()=>setShowAddModal(false)}>Cancel</button>
              <button className="btn btn-primary" onClick={addSetting} disabled={saving}>{saving?'Saving…':'Add'}</button>
            </div>
          </div>
        </div>
      )}
      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}

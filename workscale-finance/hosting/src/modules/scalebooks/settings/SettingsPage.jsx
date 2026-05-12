import { useState, useEffect } from 'react';
import {
  doc, getDoc, setDoc, serverTimestamp,
  collection, onSnapshot, addDoc, updateDoc, deleteDoc, query, orderBy
} from 'firebase/firestore';
import { db, auth } from '../../../firebase.js';

const CSS = `
  .st-wrap  { display:flex; flex-direction:column; height:100%; overflow:hidden; font-family:Inter,system-ui,sans-serif; background:#f8fafc; }
  .st-top   { display:flex; align-items:center; justify-content:space-between; padding:16px 22px 12px; flex-shrink:0; border-bottom:1px solid #e5e7eb; background:#fff; }
  .st-body  { flex:1; overflow-y:auto; padding:16px 22px; display:flex; flex-direction:column; gap:20px; }
  .btn      { border:0; border-radius:10px; padding:9px 16px; font-weight:700; cursor:pointer; font-size:13px; font-family:inherit; }
  .btn:disabled { opacity:.5; cursor:not-allowed; }
  .btn-primary { background:#f97316; color:#fff; }
  .btn-ghost   { background:#f1f5f9; color:#0b1220; }
  .btn-ghost:hover { background:#e2e8f0; }
  .btn-sm { padding:6px 12px; font-size:12px; }
  .btn-xs { padding:4px 8px; font-size:11px; border-radius:8px; }
  .input  { border:1px solid #e5e7eb; border-radius:10px; padding:9px 12px; font-size:13px; background:#fff; font-family:inherit; }
  .card   { background:#fff; border:1px solid #e5e7eb; border-radius:14px; padding:20px; }
  .card-title { font-size:13px; font-weight:900; color:#0b1220; margin-bottom:14px; letter-spacing:.03em; }
  .grid2  { display:grid; grid-template-columns:1fr 1fr; gap:12px; }
  .grid3  { display:grid; grid-template-columns:1fr 1fr 1fr; gap:12px; }
  .col2   { grid-column:span 2; }
  .col3   { grid-column:span 3; }
  .field  { display:flex; flex-direction:column; gap:5px; }
  .field label { font-size:10px; font-weight:800; color:#64748b; letter-spacing:.06em; text-transform:uppercase; }
  .field input,.field select,.field textarea { border:1px solid #e5e7eb; border-radius:10px; padding:9px 10px; font-size:13px; font-family:inherit; width:100%; box-sizing:border-box; }
  .field textarea { resize:vertical; min-height:72px; }
  .sect-hdr { font-size:11px; font-weight:800; color:#94a3b8; letter-spacing:.08em; text-transform:uppercase; padding-bottom:8px; border-bottom:1px solid #f1f5f9; margin-bottom:10px; margin-top:4px; }
  table   { width:100%; border-collapse:collapse; }
  th,td   { padding:9px 11px; border-bottom:1px solid #f1f5f9; font-size:13px; text-align:left; }
  th      { color:#64748b; font-weight:800; font-size:11px; letter-spacing:.05em; text-transform:uppercase; background:#f8fafc; }
  tr:last-child td { border-bottom:none; }
  .pill   { display:inline-block; padding:2px 9px; border-radius:999px; font-size:11px; font-weight:700; border:1px solid #e2e8f0; background:#f8fafc; color:#64748b; }
  .backdrop { position:fixed; inset:0; background:rgba(15,23,42,.45); display:flex; align-items:center; justify-content:center; padding:16px; z-index:100; }
  .modal  { width:min(500px,98vw); background:#fff; border-radius:16px; display:flex; flex-direction:column; overflow:hidden; box-shadow:0 24px 64px rgba(0,0,0,.25); }
  .modal-h { display:flex; align-items:center; justify-content:space-between; padding:14px 18px; border-bottom:1px solid #e5e7eb; background:#f8fafc; }
  .modal-h strong { font-size:14px; font-weight:900; }
  .modal-b { padding:18px; display:flex; flex-direction:column; gap:12px; }
  .modal-f { display:flex; justify-content:flex-end; gap:10px; padding:12px 18px; border-top:1px solid #e5e7eb; }
  .save-bar { display:flex; justify-content:flex-end; margin-top:14px; }
  .toast  { position:fixed; right:16px; bottom:16px; background:#0b1220; color:#fff; padding:12px 18px; border-radius:12px; font-size:13px; font-weight:600; z-index:999; animation:fadeIn .2s; }
  .backdrop { position:fixed; inset:0; background:rgba(15,23,42,.45); display:flex; align-items:center; justify-content:center; padding:16px; z-index:100; }
  @keyframes fadeIn { from{opacity:0;transform:translateY(8px)} to{opacity:1;transform:none} }
`;

const ROLES = ['VIEWER','REVIEWER','APPROVER','ADMIN'];
const EMPTY_USER = { isNew:true, id:null, email:'', role:'VIEWER', displayName:'' };

export default function SettingsPage() {
  const [profile, setProfile] = useState(null);
  const [form, setForm] = useState(null);
  const [users, setUsers] = useState([]);
  const [userModal, setUserModal] = useState(null);
  const [categories, setCategories] = useState([]);
  const [catModal, setCatModal] = useState(null);
  const [saving, setSaving] = useState(false);
  const [toast,  setToast] = useState('');
  const [confirmModal, setConfirmModal] = useState(null);

  const showToast = (msg) => { setToast(msg); setTimeout(() => setToast(''), 3000); };
  const askConfirm = (message, onConfirm) => setConfirmModal({ message, onConfirm });

  // Load system profile (single doc)
  useEffect(() => {
    getDoc(doc(db,'settings','profile')).then(snap => {
      const d = snap.exists() ? snap.data() : {};
      setProfile(d);
      setForm({
        companyName: d.companyName || '',
        companyAddress: d.companyAddress || '',
        companyTin: d.companyTin || '',
        vcPrefix: d.vcPrefix || 'VC',
        drPrefix: d.drPrefix || 'DR',
        wpPrefix: d.wpPrefix || 'WP',
        isPrefix: d.isPrefix || 'IS',
        includeYear: d.includeYear !== false,
        includeMonth: d.includeMonth !== false,
        billingWebAppUrl: d.billingWebAppUrl || '',
        fiscalYearStart: d.fiscalYearStart || '01',
      });
    });
  }, []);

  // Users
  useEffect(() => {
    const unsub = onSnapshot(
      query(collection(db,'appUsers'), orderBy('email','asc')),
      s => setUsers(s.docs.map(d => ({ id:d.id, ...d.data() })))
    );
    return unsub;
  }, []);

  // Purpose categories
  useEffect(() => {
    const unsub = onSnapshot(
      query(collection(db,'purposeCategories'), orderBy('name','asc')),
      s => setCategories(s.docs.map(d => ({ id:d.id, ...d.data() })))
    );
    return unsub;
  }, []);

  const saveProfile = async () => {
    if (!form) return;
    setSaving(true);
    try {
      await setDoc(doc(db,'settings','profile'), { ...form, updatedAt:serverTimestamp(), updatedBy:auth.currentUser?.email||'' }, { merge:true });
      showToast('Settings saved.');
    } catch(e) { showToast('Error: '+e.message); }
    setSaving(false);
  };

  const saveUser = async () => {
    if (!userModal?.email?.trim()) { showToast('Email required.'); return; }
    setSaving(true);
    try {
      const { isNew, id, ...rest } = userModal;
      if (isNew) await addDoc(collection(db,'appUsers'), { ...rest, createdAt:serverTimestamp() });
      else       await updateDoc(doc(db,'appUsers',id), { ...rest, updatedAt:serverTimestamp() });
      showToast('User saved.'); setUserModal(null);
    } catch(e) { showToast('Error: '+e.message); }
    setSaving(false);
  };

  const deleteUser = (u) => {
    askConfirm(`Remove user "${u.email}"?`, async () => {
      await deleteDoc(doc(db,'appUsers',u.id));
      showToast('User removed.');
    });
  };

  const saveCat = async () => {
    if (!catModal?.name?.trim()) { showToast('Name required.'); return; }
    setSaving(true);
    try {
      const { isNew, id, name } = catModal;
      if (isNew) await addDoc(collection(db,'purposeCategories'), { name:name.trim(), createdAt:serverTimestamp() });
      else       await updateDoc(doc(db,'purposeCategories',id), { name:name.trim(), updatedAt:serverTimestamp() });
      showToast('Category saved.'); setCatModal(null);
    } catch(e) { showToast('Error: '+e.message); }
    setSaving(false);
  };

  const deleteCat = (c) => {
    askConfirm(`Delete category "${c.name}"?`, async () => {
      await deleteDoc(doc(db,'purposeCategories',c.id));
      showToast('Category deleted.');
    });
  };

  const ROLE_STYLE = {
    ADMIN:    { background:'#fef2f2', borderColor:'#fecaca', color:'#991b1b' },
    APPROVER: { background:'#eff6ff', borderColor:'#bfdbfe', color:'#1d4ed8' },
    REVIEWER: { background:'#ecfdf5', borderColor:'#6ee7b7', color:'#065f46' },
  };

  if (!form) return <div style={{padding:40,textAlign:'center',color:'#94a3b8'}}>Loading settings…</div>;

  return (
    <div className="st-wrap">
      <style>{CSS}</style>
      <div className="st-top">
        <strong style={{fontSize:18,fontWeight:900,color:'#0b1220'}}>SETTINGS</strong>
      </div>
      <div className="st-body">

        {/* Company Info */}
        <div className="card">
          <div className="card-title">Company Information</div>
          <div className="grid2" style={{gap:12}}>
            <div className="field col2">
              <label>Company Name</label>
              <input className="" value={form.companyName} onChange={e=>setForm(f=>({...f,companyName:e.target.value}))} />
            </div>
            <div className="field col2">
              <label>Company Address</label>
              <input value={form.companyAddress} onChange={e=>setForm(f=>({...f,companyAddress:e.target.value}))} />
            </div>
            <div className="field">
              <label>TIN</label>
              <input value={form.companyTin} onChange={e=>setForm(f=>({...f,companyTin:e.target.value}))} placeholder="000-000-000-000" />
            </div>
            <div className="field">
              <label>Fiscal Year Start Month (01–12)</label>
              <input value={form.fiscalYearStart} onChange={e=>setForm(f=>({...f,fiscalYearStart:e.target.value}))} placeholder="01" />
            </div>
          </div>
        </div>

        {/* ID Generation */}
        <div className="card">
          <div className="card-title">Document ID Generation</div>
          <div className="grid3" style={{gap:12}}>
            <div className="field">
              <label>Voucher Prefix</label>
              <input value={form.vcPrefix} onChange={e=>setForm(f=>({...f,vcPrefix:e.target.value}))} placeholder="VC" />
            </div>
            <div className="field">
              <label>Disbursement Report Prefix</label>
              <input value={form.drPrefix} onChange={e=>setForm(f=>({...f,drPrefix:e.target.value}))} placeholder="DR" />
            </div>
            <div className="field">
              <label>Weekly Projection Prefix</label>
              <input value={form.wpPrefix} onChange={e=>setForm(f=>({...f,wpPrefix:e.target.value}))} placeholder="WP" />
            </div>
            <div className="field">
              <label>Service Invoice Prefix</label>
              <input value={form.isPrefix} onChange={e=>setForm(f=>({...f,isPrefix:e.target.value}))} placeholder="IS" />
            </div>
            <div className="field" style={{flexDirection:'row',alignItems:'center',gap:8,paddingTop:18}}>
              <input type="checkbox" id="incYear" checked={!!form.includeYear} onChange={e=>setForm(f=>({...f,includeYear:e.target.checked}))} style={{width:'auto'}} />
              <label htmlFor="incYear" style={{textTransform:'none',fontSize:13,letterSpacing:0,color:'#0b1220'}}>Include Year in ID</label>
            </div>
            <div className="field" style={{flexDirection:'row',alignItems:'center',gap:8,paddingTop:18}}>
              <input type="checkbox" id="incMo" checked={!!form.includeMonth} onChange={e=>setForm(f=>({...f,includeMonth:e.target.checked}))} style={{width:'auto'}} />
              <label htmlFor="incMo" style={{textTransform:'none',fontSize:13,letterSpacing:0,color:'#0b1220'}}>Include Month in ID</label>
            </div>
          </div>
          <div className="field" style={{marginTop:14}}>
            <label>Billing Web App URL</label>
            <input value={form.billingWebAppUrl} onChange={e=>setForm(f=>({...f,billingWebAppUrl:e.target.value}))} placeholder="https://..." />
          </div>
          <div className="save-bar">
            <button className="btn btn-primary" onClick={saveProfile} disabled={saving}>{saving?'Saving…':'Save Settings'}</button>
          </div>
        </div>

        {/* Users */}
        <div className="card">
          <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:14}}>
            <div className="card-title" style={{marginBottom:0}}>User Access Roles</div>
            <button className="btn btn-primary btn-sm" onClick={()=>setUserModal({...EMPTY_USER})}>＋ Add User</button>
          </div>
          <table>
            <thead>
              <tr><th>EMAIL</th><th>DISPLAY NAME</th><th>ROLE</th><th style={{textAlign:'center'}}>ACTIONS</th></tr>
            </thead>
            <tbody>
              {users.length===0 && <tr><td colSpan={4} style={{padding:24,textAlign:'center',color:'#94a3b8',fontSize:13}}>No users configured.</td></tr>}
              {users.map(u => {
                const rs = ROLE_STYLE[u.role] || {};
                return (
                  <tr key={u.id}>
                    <td style={{fontWeight:600}}>{u.email}</td>
                    <td style={{color:'#64748b'}}>{u.displayName||'—'}</td>
                    <td><span className="pill" style={rs}>{u.role||'VIEWER'}</span></td>
                    <td style={{textAlign:'center'}}>
                      <div style={{display:'flex',gap:4,justifyContent:'center'}}>
                        <button className="btn btn-ghost btn-xs" onClick={()=>setUserModal({isNew:false,...u})}>Edit</button>
                        <button className="btn btn-ghost btn-xs" style={{color:'#dc2626'}} onClick={()=>deleteUser(u)}>Remove</button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Purpose Categories */}
        <div className="card">
          <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:14}}>
            <div className="card-title" style={{marginBottom:0}}>Purpose / Expense Categories</div>
            <button className="btn btn-primary btn-sm" onClick={()=>setCatModal({isNew:true,id:null,name:''})}>＋ Add Category</button>
          </div>
          <table>
            <thead><tr><th>CATEGORY NAME</th><th style={{textAlign:'center'}}>ACTIONS</th></tr></thead>
            <tbody>
              {categories.length===0 && <tr><td colSpan={2} style={{padding:24,textAlign:'center',color:'#94a3b8',fontSize:13}}>No categories defined.</td></tr>}
              {categories.map(c => (
                <tr key={c.id}>
                  <td>{c.name}</td>
                  <td style={{textAlign:'center'}}>
                    <div style={{display:'flex',gap:4,justifyContent:'center'}}>
                      <button className="btn btn-ghost btn-xs" onClick={()=>setCatModal({isNew:false,id:c.id,name:c.name})}>Edit</button>
                      <button className="btn btn-ghost btn-xs" style={{color:'#dc2626'}} onClick={()=>deleteCat(c)}>Delete</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

      </div>

      {/* User Modal */}
      {userModal && (
        <div className="backdrop" onClick={()=>setUserModal(null)}>
          <div className="modal" onClick={e=>e.stopPropagation()}>
            <div className="modal-h">
              <strong>{userModal.isNew?'Add User':'Edit User'}</strong>
              <button className="btn btn-ghost btn-sm" onClick={()=>setUserModal(null)}>✕</button>
            </div>
            <div className="modal-b">
              <div className="field">
                <label>Email</label>
                <input type="email" value={userModal.email} onChange={e=>setUserModal(m=>({...m,email:e.target.value}))} />
              </div>
              <div className="field">
                <label>Display Name</label>
                <input value={userModal.displayName||''} onChange={e=>setUserModal(m=>({...m,displayName:e.target.value}))} />
              </div>
              <div className="field">
                <label>Role</label>
                <select value={userModal.role} onChange={e=>setUserModal(m=>({...m,role:e.target.value}))}>
                  {ROLES.map(r=><option key={r}>{r}</option>)}
                </select>
              </div>
            </div>
            <div className="modal-f">
              <button className="btn btn-ghost" onClick={()=>setUserModal(null)}>Cancel</button>
              <button className="btn btn-primary" onClick={saveUser} disabled={saving}>{saving?'Saving…':'Save User'}</button>
            </div>
          </div>
        </div>
      )}

      {/* Category Modal */}
      {catModal && (
        <div className="backdrop" onClick={()=>setCatModal(null)}>
          <div className="modal" onClick={e=>e.stopPropagation()}>
            <div className="modal-h">
              <strong>{catModal.isNew?'Add Category':'Edit Category'}</strong>
              <button className="btn btn-ghost btn-sm" onClick={()=>setCatModal(null)}>✕</button>
            </div>
            <div className="modal-b">
              <div className="field">
                <label>Category Name</label>
                <input value={catModal.name} onChange={e=>setCatModal(m=>({...m,name:e.target.value}))} placeholder="e.g. Office Supplies" />
              </div>
            </div>
            <div className="modal-f">
              <button className="btn btn-ghost" onClick={()=>setCatModal(null)}>Cancel</button>
              <button className="btn btn-primary" onClick={saveCat} disabled={saving}>{saving?'Saving…':'Save'}</button>
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

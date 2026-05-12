import { useState, useEffect } from 'react';
import {
  doc, getDoc, setDoc, serverTimestamp,
  collection, onSnapshot, addDoc, updateDoc, deleteDoc, query, orderBy,
} from 'firebase/firestore';
import { db, auth } from '../../../firebase.js';

const ROLES         = ['VIEWER', 'REVIEWER', 'APPROVER', 'ADMIN'];
const VOUCHER_TYPES = ['PAYMENT', 'PAYROLL', 'FINAL_PAY', 'LOAN'];
const MONTHS        = ['January','February','March','April','May','June','July','August','September','October','November','December'];

const NAV = [
  { group: 'ORGANIZATION SETTINGS', items: [
    { id: 'org-profile',  icon: '🏢', label: 'Organization Profile' },
    { id: 'users-roles',  icon: '👥', label: 'Users & Roles' },
    { id: 'setup-config', icon: '⚙️', label: 'Setup & Configurations' },
  ]},
  { group: 'MODULE SETTINGS', items: [
    { id: 'mod-vouchers', icon: '📄', label: 'Vouchers' },
    { id: 'mod-checks',   icon: '✏️', label: 'Check Registry' },
  ]},
  { group: 'REFERENCE DATA', items: [
    { id: 'ref-categories',    icon: '🗂️', label: 'Purpose Categories' },
    { id: 'ref-payment-terms', icon: '📅', label: 'Payment Terms' },
  ]},
];

const ROLE_STYLE = {
  ADMIN:    { background:'#fef2f2', borderColor:'#fecaca', color:'#991b1b' },
  APPROVER: { background:'#eff6ff', borderColor:'#bfdbfe', color:'#1d4ed8' },
  REVIEWER: { background:'#ecfdf5', borderColor:'#6ee7b7', color:'#065f46' },
  VIEWER:   { background:'#f8fafc', borderColor:'#e2e8f0', color:'#64748b' },
};

const CSS = `
  .sp { display:flex; height:100%; overflow:hidden; font-family:Inter,system-ui,sans-serif; background:#f8fafc; }
  .sp-sidebar { width:220px; flex-shrink:0; background:#fff; border-right:1px solid #e5e7eb; overflow-y:auto; display:flex; flex-direction:column; }
  .sp-sb-hdr  { padding:18px 16px 14px; border-bottom:1px solid #f1f5f9; }
  .sp-sb-hdr h2 { margin:0; font-size:15px; font-weight:900; color:#0b1220; }
  .sp-sb-hdr p  { margin:3px 0 0; font-size:11px; color:#94a3b8; }
  .sp-grp-lbl { font-size:9px; font-weight:900; color:#94a3b8; letter-spacing:.1em; text-transform:uppercase; padding:14px 16px 5px; }
  .sp-nav { display:flex; align-items:center; gap:9px; padding:9px 16px; cursor:pointer; font-size:13px; font-weight:500; color:#374151; border-left:3px solid transparent; transition:background .12s; user-select:none; }
  .sp-nav:hover { background:#f8fafc; color:#0b1220; }
  .sp-nav-on  { background:#fff7ed !important; color:#f97316 !important; font-weight:700; border-left-color:#f97316; }
  .sp-nav-ico { font-size:15px; width:20px; text-align:center; flex-shrink:0; }
  .sp-content { flex:1; overflow-y:auto; padding:30px 40px 50px; }
  .sp-ch h1   { margin:0 0 5px; font-size:22px; font-weight:900; color:#0b1220; }
  .sp-ch p    { margin:0 0 24px; font-size:13px; color:#64748b; }
  .sp-card { background:#fff; border:1px solid #e5e7eb; border-radius:14px; padding:22px 24px; margin-bottom:20px; }
  .sp-card-title { font-size:10px; font-weight:900; color:#94a3b8; letter-spacing:.08em; text-transform:uppercase; margin-bottom:14px; padding-bottom:8px; border-bottom:1px solid #f1f5f9; }
  .grid2 { display:grid; grid-template-columns:1fr 1fr; gap:14px; }
  .grid3 { display:grid; grid-template-columns:1fr 1fr 1fr; gap:14px; }
  .col2  { grid-column:span 2; }
  .col3  { grid-column:span 3; }
  .field { display:flex; flex-direction:column; gap:5px; }
  .field label { font-size:10px; font-weight:800; color:#64748b; letter-spacing:.06em; text-transform:uppercase; }
  .field input,.field select,.field textarea { border:1px solid #e5e7eb; border-radius:10px; padding:9px 10px; font-size:13px; font-family:inherit; width:100%; box-sizing:border-box; background:#fff; }
  .field input:focus,.field select:focus,.field textarea:focus { outline:none; border-color:#f97316; box-shadow:0 0 0 3px rgba(249,115,22,.12); }
  .field textarea { resize:vertical; min-height:68px; }
  .btn { border:0; border-radius:10px; padding:9px 16px; font-weight:700; cursor:pointer; font-size:13px; font-family:inherit; transition:opacity .15s; }
  .btn:disabled { opacity:.5; cursor:not-allowed; }
  .btn-primary { background:#f97316; color:#fff; }
  .btn-primary:hover:not(:disabled) { opacity:.88; }
  .btn-ghost  { background:#f1f5f9; color:#0b1220; }
  .btn-ghost:hover { background:#e2e8f0; }
  .btn-danger { background:#ef4444; color:#fff; }
  .btn-sm { padding:7px 13px; font-size:12px; }
  .btn-xs { padding:4px 9px; font-size:11px; border-radius:8px; }
  table { width:100%; border-collapse:collapse; }
  th,td { padding:10px 12px; border-bottom:1px solid #f1f5f9; font-size:13px; text-align:left; }
  th    { color:#64748b; font-weight:800; font-size:10px; letter-spacing:.05em; text-transform:uppercase; background:#f8fafc; }
  tr:last-child td { border-bottom:none; }
  tr:hover td { background:#fafafa; }
  .tog-row { display:flex; align-items:center; justify-content:space-between; padding:14px 0; border-bottom:1px solid #f8fafc; }
  .tog-row:last-child { border-bottom:none; }
  .tog-info strong { font-size:13px; font-weight:700; color:#0b1220; display:block; margin-bottom:2px; }
  .tog-info span   { font-size:12px; color:#94a3b8; }
  .tog-sw { position:relative; width:42px; height:24px; flex-shrink:0; cursor:pointer; }
  .tog-sw input { opacity:0; width:0; height:0; position:absolute; }
  .tog-sl { position:absolute; inset:0; background:#e2e8f0; border-radius:999px; transition:.2s; }
  .tog-sl:before { content:''; position:absolute; height:18px; width:18px; left:3px; bottom:3px; background:#fff; border-radius:50%; transition:.2s; box-shadow:0 1px 3px rgba(0,0,0,.2); }
  .tog-sw input:checked + .tog-sl { background:#f97316; }
  .tog-sw input:checked + .tog-sl:before { transform:translateX(18px); }
  .pill     { display:inline-block; padding:3px 10px; border-radius:999px; font-size:11px; font-weight:700; border:1px solid; }
  .save-bar { display:flex; justify-content:flex-end; gap:10px; margin-top:20px; }
  .info-box { background:#eff6ff; border:1px solid #bfdbfe; border-radius:10px; padding:10px 14px; font-size:12px; color:#1d4ed8; margin-bottom:16px; }
  .backdrop { position:fixed; inset:0; background:rgba(15,23,42,.45); display:flex; align-items:center; justify-content:center; padding:16px; z-index:100; }
  .modal    { width:min(480px,98vw); background:#fff; border-radius:16px; display:flex; flex-direction:column; overflow:hidden; box-shadow:0 24px 64px rgba(0,0,0,.25); }
  .modal-h  { display:flex; align-items:center; justify-content:space-between; padding:14px 18px; border-bottom:1px solid #e5e7eb; background:#f8fafc; }
  .modal-h strong { font-size:14px; font-weight:900; }
  .modal-b  { padding:20px; display:flex; flex-direction:column; gap:12px; }
  .modal-f  { display:flex; justify-content:flex-end; gap:10px; padding:12px 18px; border-top:1px solid #e5e7eb; }
  .sp-toast { position:fixed; right:16px; bottom:16px; background:#0b1220; color:#fff; padding:12px 18px; border-radius:12px; font-size:13px; font-weight:600; z-index:999; animation:sp-fade .2s; }
  @keyframes sp-fade { from{opacity:0;transform:translateY(8px)} to{opacity:1;transform:none} }
`;

function Toggle({ checked, onChange }) {
  return (
    <label className="tog-sw">
      <input type="checkbox" checked={!!checked} onChange={e => onChange(e.target.checked)} />
      <span className="tog-sl" />
    </label>
  );
}

export default function SettingsPage() {
  const [activeSection, setActiveSection] = useState('org-profile');
  const [profileForm, setProfileForm] = useState(null);
  const [moduleForm,  setModuleForm]  = useState(null);
  const [users,        setUsers]        = useState([]);
  const [categories,   setCategories]   = useState([]);
  const [paymentTerms, setPaymentTerms] = useState([]);
  const [userModal,    setUserModal]    = useState(null);
  const [catModal,     setCatModal]     = useState(null);
  const [termModal,    setTermModal]    = useState(null);
  const [confirmModal, setConfirmModal] = useState(null);
  const [saving, setSaving] = useState(false);
  const [toast,  setToast]  = useState('');

  const showToast  = msg => { setToast(msg); setTimeout(() => setToast(''), 3000); };
  const askConfirm = (msg, fn) => setConfirmModal({ msg, fn });
  const me = auth.currentUser?.email || '';

  useEffect(() => {
    getDoc(doc(db, 'settings', 'profile')).then(snap => {
      const d = snap.exists() ? snap.data() : {};
      setProfileForm({
        companyName:      d.companyName      || '',
        companyAddress:   d.companyAddress   || '',
        companyTin:       d.companyTin       || '',
        companyEmail:     d.companyEmail     || '',
        companyPhone:     d.companyPhone     || '',
        industry:         d.industry         || 'Services',
        country:          d.country          || 'Philippines',
        fiscalYearStart:  d.fiscalYearStart  || '01',
        logoUrl:          d.logoUrl          || '',
        billingWebAppUrl: d.billingWebAppUrl || '',
      });
    });
    getDoc(doc(db, 'settings', 'modules')).then(snap => {
      const d = snap.exists() ? snap.data() : {};
      setModuleForm({
        vcPrefix:     d.vcPrefix     || 'PV',
        cvPrefix:     d.cvPrefix     || 'CV',
        drPrefix:     d.drPrefix     || 'DR',
        wpPrefix:     d.wpPrefix     || 'WP',
        isPrefix:     d.isPrefix     || 'IS',
        includeYear:  d.includeYear  !== false,
        includeMonth: d.includeMonth !== false,
        enabledVoucherTypes:    d.enabledVoucherTypes    || [...VOUCHER_TYPES],
        requireVoucherApproval: d.requireVoucherApproval || false,
        requirePurposeCategory: d.requirePurposeCategory || false,
        staleCheckDays:    d.staleCheckDays    || 180,
        requireVoidReason: d.requireVoidReason !== false,
      });
    });
  }, []);

  useEffect(() => {
    const u1 = onSnapshot(query(collection(db, 'appUsers'),          orderBy('email')), s => setUsers(s.docs.map(d => ({id:d.id,...d.data()}))));
    const u2 = onSnapshot(query(collection(db, 'purposeCategories'), orderBy('name')),  s => setCategories(s.docs.map(d => ({id:d.id,...d.data()}))));
    const u3 = onSnapshot(query(collection(db, 'paymentTerms'),      orderBy('days')),  s => setPaymentTerms(s.docs.map(d => ({id:d.id,...d.data()}))));
    return () => { u1(); u2(); u3(); };
  }, []);

  const saveProfile = async () => {
    setSaving(true);
    try {
      await setDoc(doc(db, 'settings', 'profile'), { ...profileForm, updatedAt:serverTimestamp(), updatedBy:me }, { merge:true });
      showToast('Organization profile saved.');
    } catch(e) { showToast('Error: ' + e.message); }
    setSaving(false);
  };

  const saveModules = async () => {
    setSaving(true);
    try {
      await setDoc(doc(db, 'settings', 'modules'), { ...moduleForm, updatedAt:serverTimestamp(), updatedBy:me }, { merge:true });
      showToast('Settings saved.');
    } catch(e) { showToast('Error: ' + e.message); }
    setSaving(false);
  };

  const saveUser = async () => {
    if (!userModal?.email?.trim()) return showToast('Email required.');
    setSaving(true);
    try {
      const { isNew, id, ...rest } = userModal;
      if (isNew) await addDoc(collection(db, 'appUsers'), { ...rest, createdAt:serverTimestamp(), createdBy:me });
      else       await updateDoc(doc(db, 'appUsers', id),  { ...rest, updatedAt:serverTimestamp(), updatedBy:me });
      showToast('User saved.'); setUserModal(null);
    } catch(e) { showToast('Error: ' + e.message); }
    setSaving(false);
  };

  const saveCat = async () => {
    if (!catModal?.name?.trim()) return showToast('Name required.');
    setSaving(true);
    try {
      const { isNew, id, name } = catModal;
      if (isNew) await addDoc(collection(db, 'purposeCategories'), { name:name.trim(), createdAt:serverTimestamp(), createdBy:me });
      else       await updateDoc(doc(db, 'purposeCategories', id),  { name:name.trim(), updatedAt:serverTimestamp(), updatedBy:me });
      showToast('Category saved.'); setCatModal(null);
    } catch(e) { showToast('Error: ' + e.message); }
    setSaving(false);
  };

  const saveTerm = async () => {
    if (!termModal?.name?.trim()) return showToast('Name required.');
    setSaving(true);
    try {
      const { isNew, id, ...rest } = termModal;
      if (isNew) await addDoc(collection(db, 'paymentTerms'), { ...rest, createdAt:serverTimestamp(), createdBy:me });
      else       await updateDoc(doc(db, 'paymentTerms', id),  { ...rest, updatedAt:serverTimestamp(), updatedBy:me });
      showToast('Payment term saved.'); setTermModal(null);
    } catch(e) { showToast('Error: ' + e.message); }
    setSaving(false);
  };

  const del = (colName, id, label) =>
    askConfirm(`Delete "${label}"?`, async () => {
      await deleteDoc(doc(db, colName, id));
      showToast('Deleted.');
    });

  function OrgProfile() {
    if (!profileForm) return <div style={{padding:40,textAlign:'center',color:'#94a3b8'}}>Loading…</div>;
    const up = (k, v) => setProfileForm(f => ({ ...f, [k]: v }));
    return (
      <>
        <div className="sp-ch">
          <h1>Organization Profile</h1>
          <p>Basic information about your company — shown on all documents and used system-wide.</p>
        </div>
        <div className="sp-card">
          <div className="sp-card-title">Company Details</div>
          <div className="grid2">
            <div className="field col2"><label>Company Name *</label><input value={profileForm.companyName} onChange={e=>up('companyName',e.target.value)} placeholder="Workscale Resources Inc." /></div>
            <div className="field col2"><label>Address</label><textarea rows={2} value={profileForm.companyAddress} onChange={e=>up('companyAddress',e.target.value)} /></div>
            <div className="field"><label>TIN</label><input value={profileForm.companyTin} onChange={e=>up('companyTin',e.target.value)} placeholder="000-000-000-000" /></div>
            <div className="field"><label>Email</label><input type="email" value={profileForm.companyEmail} onChange={e=>up('companyEmail',e.target.value)} /></div>
            <div className="field"><label>Phone</label><input value={profileForm.companyPhone} onChange={e=>up('companyPhone',e.target.value)} /></div>
            <div className="field">
              <label>Industry</label>
              <select value={profileForm.industry} onChange={e=>up('industry',e.target.value)}>
                {['Services','Manufacturing','Trading','Construction','Agriculture','Healthcare','Education','Government','Other'].map(i=><option key={i}>{i}</option>)}
              </select>
            </div>
            <div className="field"><label>Country</label><input value={profileForm.country} onChange={e=>up('country',e.target.value)} /></div>
            <div className="field">
              <label>Fiscal Year Start</label>
              <select value={profileForm.fiscalYearStart} onChange={e=>up('fiscalYearStart',e.target.value)}>
                {MONTHS.map((m,i)=><option key={i} value={String(i+1).padStart(2,'0')}>{m}</option>)}
              </select>
            </div>
          </div>
        </div>
        <div className="sp-card">
          <div className="sp-card-title">Branding & Integrations</div>
          <div className="grid2">
            <div className="field col2">
              <label>Company Logo URL</label>
              <input value={profileForm.logoUrl} onChange={e=>up('logoUrl',e.target.value)} placeholder="https://…" />
              {profileForm.logoUrl && <img src={profileForm.logoUrl} alt="logo" style={{marginTop:8,height:52,objectFit:'contain',borderRadius:8,border:'1px solid #e5e7eb',background:'#f8fafc',padding:4}} onError={e=>{e.target.style.display='none';}} />}
            </div>
            <div className="field col2"><label>Billing Web App URL</label><input value={profileForm.billingWebAppUrl} onChange={e=>up('billingWebAppUrl',e.target.value)} placeholder="https://…" /></div>
          </div>
        </div>
        <div className="save-bar">
          <button className="btn btn-primary" disabled={saving} onClick={saveProfile}>{saving?'Saving…':'Save Profile'}</button>
        </div>
      </>
    );
  }

  function UsersRoles() {
    return (
      <>
        <div className="sp-ch"><h1>Users & Roles</h1><p>Control who can access the Finance Portal and what they can do.</p></div>
        <div className="sp-card">
          <div className="info-box"><strong>Role guide:</strong>&nbsp; VIEWER = read-only &nbsp;·&nbsp; REVIEWER = can comment &nbsp;·&nbsp; APPROVER = can approve / reject vouchers &nbsp;·&nbsp; ADMIN = full access</div>
          <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:14}}>
            <span style={{fontSize:12,color:'#64748b'}}>{users.length} user{users.length!==1?'s':''} configured</span>
            <button className="btn btn-primary btn-sm" onClick={()=>setUserModal({isNew:true,id:null,email:'',role:'VIEWER',displayName:''})}>+ Add User</button>
          </div>
          <table>
            <thead><tr><th>EMAIL</th><th>DISPLAY NAME</th><th>ROLE</th><th style={{textAlign:'center'}}>ACTIONS</th></tr></thead>
            <tbody>
              {users.length===0&&<tr><td colSpan={4} style={{padding:28,textAlign:'center',color:'#94a3b8'}}>No users configured.</td></tr>}
              {users.map(u=>{
                const rs=ROLE_STYLE[u.role]||ROLE_STYLE.VIEWER;
                return (
                  <tr key={u.id}>
                    <td style={{fontWeight:600}}>{u.email}</td>
                    <td style={{color:'#64748b'}}>{u.displayName||'—'}</td>
                    <td><span className="pill" style={rs}>{u.role||'VIEWER'}</span></td>
                    <td style={{textAlign:'center'}}>
                      <div style={{display:'flex',gap:4,justifyContent:'center'}}>
                        <button className="btn btn-ghost btn-xs" onClick={()=>setUserModal({isNew:false,...u})}>Edit</button>
                        <button className="btn btn-xs" style={{background:'#fef2f2',color:'#dc2626',border:'none',cursor:'pointer',borderRadius:8}} onClick={()=>del('appUsers',u.id,u.email)}>Remove</button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </>
    );
  }

  function SetupConfig() {
    if (!moduleForm) return <div style={{padding:40,textAlign:'center',color:'#94a3b8'}}>Loading…</div>;
    const up = (k,v) => setModuleForm(f=>({...f,[k]:v}));
    return (
      <>
        <div className="sp-ch"><h1>Setup & Configurations</h1><p>Document ID prefixes and numbering format applied across all modules.</p></div>
        <div className="sp-card">
          <div className="sp-card-title">Document ID Prefixes</div>
          <div className="grid3">
            <div className="field"><label>Payment Voucher</label><input value={moduleForm.vcPrefix} onChange={e=>up('vcPrefix',e.target.value)} placeholder="PV" /></div>
            <div className="field"><label>Check Voucher</label><input value={moduleForm.cvPrefix} onChange={e=>up('cvPrefix',e.target.value)} placeholder="CV" /></div>
            <div className="field"><label>Disbursement Report</label><input value={moduleForm.drPrefix} onChange={e=>up('drPrefix',e.target.value)} placeholder="DR" /></div>
            <div className="field"><label>Weekly Projection</label><input value={moduleForm.wpPrefix} onChange={e=>up('wpPrefix',e.target.value)} placeholder="WP" /></div>
            <div className="field"><label>Service Invoice</label><input value={moduleForm.isPrefix} onChange={e=>up('isPrefix',e.target.value)} placeholder="IS" /></div>
          </div>
        </div>
        <div className="sp-card">
          <div className="sp-card-title">ID Format Options</div>
          <div className="tog-row">
            <div className="tog-info"><strong>Include Year in Document IDs</strong><span>e.g. PV2026-0001</span></div>
            <Toggle checked={moduleForm.includeYear} onChange={v=>up('includeYear',v)} />
          </div>
          <div className="tog-row">
            <div className="tog-info"><strong>Include Month in Document IDs</strong><span>e.g. PV202605-0001</span></div>
            <Toggle checked={moduleForm.includeMonth} onChange={v=>up('includeMonth',v)} />
          </div>
        </div>
        <div className="save-bar">
          <button className="btn btn-primary" disabled={saving} onClick={saveModules}>{saving?'Saving…':'Save Configuration'}</button>
        </div>
      </>
    );
  }

  function ModVouchers() {
    if (!moduleForm) return <div style={{padding:40,textAlign:'center',color:'#94a3b8'}}>Loading…</div>;
    const up = (k,v) => setModuleForm(f=>({...f,[k]:v}));
    const toggleType = type => {
      const cur  = moduleForm.enabledVoucherTypes || [];
      const next = cur.includes(type) ? cur.filter(t=>t!==type) : [...cur, type];
      setModuleForm(f=>({...f,enabledVoucherTypes:next}));
    };
    return (
      <>
        <div className="sp-ch"><h1>Vouchers</h1><p>Control which voucher types are available and configure voucher workflow rules.</p></div>
        <div className="sp-card">
          <div className="sp-card-title">Enabled Voucher Types</div>
          <div style={{display:'flex',gap:10,flexWrap:'wrap',marginBottom:10}}>
            {VOUCHER_TYPES.map(type=>{
              const on=(moduleForm.enabledVoucherTypes||[]).includes(type);
              return (
                <button key={type} className="btn btn-sm" onClick={()=>toggleType(type)}
                  style={{border:`2px solid ${on?'#f97316':'#e5e7eb'}`,background:on?'#fff7ed':'#f8fafc',color:on?'#f97316':'#64748b',fontWeight:on?800:500}}>
                  {on?'✓ ':''}{type}
                </button>
              );
            })}
          </div>
          <div style={{fontSize:12,color:'#94a3b8'}}>Click a type to enable or disable it across the portal.</div>
        </div>
        <div className="sp-card">
          <div className="sp-card-title">Workflow Rules</div>
          <div className="tog-row">
            <div className="tog-info"><strong>Require Approval Before Payment</strong><span>Vouchers must be approved before being marked as Paid</span></div>
            <Toggle checked={moduleForm.requireVoucherApproval} onChange={v=>up('requireVoucherApproval',v)} />
          </div>
          <div className="tog-row">
            <div className="tog-info"><strong>Require Purpose / Category</strong><span>The Purpose field is mandatory when creating a voucher</span></div>
            <Toggle checked={moduleForm.requirePurposeCategory} onChange={v=>up('requirePurposeCategory',v)} />
          </div>
        </div>
        <div className="save-bar">
          <button className="btn btn-primary" disabled={saving} onClick={saveModules}>{saving?'Saving…':'Save Voucher Settings'}</button>
        </div>
      </>
    );
  }

  function ModChecks() {
    if (!moduleForm) return <div style={{padding:40,textAlign:'center',color:'#94a3b8'}}>Loading…</div>;
    const up = (k,v) => setModuleForm(f=>({...f,[k]:v}));
    return (
      <>
        <div className="sp-ch"><h1>Check Registry</h1><p>Configure check lifecycle policies and stale-check detection rules.</p></div>
        <div className="sp-card">
          <div className="sp-card-title">Lifecycle Rules</div>
          <div className="tog-row">
            <div className="tog-info"><strong>Require Void Reason</strong><span>A reason must be entered when voiding a check</span></div>
            <Toggle checked={moduleForm.requireVoidReason} onChange={v=>up('requireVoidReason',v)} />
          </div>
        </div>
        <div className="sp-card">
          <div className="sp-card-title">Stale Check Policy</div>
          <div className="field" style={{maxWidth:260,marginBottom:10}}>
            <label>Stale Check Threshold (Days)</label>
            <input type="number" min="1" value={moduleForm.staleCheckDays||180} onChange={e=>up('staleCheckDays',parseInt(e.target.value)||180)} />
          </div>
          <div style={{fontSize:12,color:'#94a3b8'}}>Issued checks older than this threshold will be flagged when you run <strong>"Flag Stale"</strong> in Check Registry. Default: 180 days.</div>
        </div>
        <div className="save-bar">
          <button className="btn btn-primary" disabled={saving} onClick={saveModules}>{saving?'Saving…':'Save Check Settings'}</button>
        </div>
      </>
    );
  }

  function RefCategories() {
    return (
      <>
        <div className="sp-ch"><h1>Purpose Categories</h1><p>Expense and purpose categories used across Vouchers and Check Registry dropdowns.</p></div>
        <div className="sp-card">
          <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:14}}>
            <span style={{fontSize:12,color:'#64748b'}}>{categories.length} categor{categories.length!==1?'ies':'y'}</span>
            <button className="btn btn-primary btn-sm" onClick={()=>setCatModal({isNew:true,id:null,name:''})}>+ Add Category</button>
          </div>
          <table>
            <thead><tr><th>CATEGORY NAME</th><th style={{textAlign:'center'}}>ACTIONS</th></tr></thead>
            <tbody>
              {categories.length===0&&<tr><td colSpan={2} style={{padding:28,textAlign:'center',color:'#94a3b8'}}>No categories yet.</td></tr>}
              {categories.map(c=>(
                <tr key={c.id}>
                  <td style={{fontWeight:500}}>{c.name}</td>
                  <td style={{textAlign:'center'}}>
                    <div style={{display:'flex',gap:4,justifyContent:'center'}}>
                      <button className="btn btn-ghost btn-xs" onClick={()=>setCatModal({isNew:false,id:c.id,name:c.name})}>Edit</button>
                      <button className="btn btn-xs" style={{background:'#fef2f2',color:'#dc2626',border:'none',cursor:'pointer',borderRadius:8}} onClick={()=>del('purposeCategories',c.id,c.name)}>Delete</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </>
    );
  }

  function RefPaymentTerms() {
    return (
      <>
        <div className="sp-ch"><h1>Payment Terms</h1><p>Standard due-date terms used on invoices and billing (e.g. Net 30, Due on Receipt).</p></div>
        <div className="sp-card">
          <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:14}}>
            <span style={{fontSize:12,color:'#64748b'}}>{paymentTerms.length} term{paymentTerms.length!==1?'s':''}</span>
            <button className="btn btn-primary btn-sm" onClick={()=>setTermModal({isNew:true,id:null,name:'',days:30,description:''})}>+ Add Term</button>
          </div>
          <table>
            <thead><tr><th>NAME</th><th>DUE (DAYS)</th><th>DESCRIPTION</th><th style={{textAlign:'center'}}>ACTIONS</th></tr></thead>
            <tbody>
              {paymentTerms.length===0&&<tr><td colSpan={4} style={{padding:28,textAlign:'center',color:'#94a3b8'}}>No payment terms defined.</td></tr>}
              {paymentTerms.map(t=>(
                <tr key={t.id}>
                  <td style={{fontWeight:700}}>{t.name}</td>
                  <td style={{color:'#f97316',fontWeight:700}}>{t.days}d</td>
                  <td style={{color:'#64748b',fontSize:12}}>{t.description||'—'}</td>
                  <td style={{textAlign:'center'}}>
                    <div style={{display:'flex',gap:4,justifyContent:'center'}}>
                      <button className="btn btn-ghost btn-xs" onClick={()=>setTermModal({isNew:false,...t})}>Edit</button>
                      <button className="btn btn-xs" style={{background:'#fef2f2',color:'#dc2626',border:'none',cursor:'pointer',borderRadius:8}} onClick={()=>del('paymentTerms',t.id,t.name)}>Delete</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </>
    );
  }

  const SECTIONS = {
    'org-profile':       <OrgProfile />,
    'users-roles':       <UsersRoles />,
    'setup-config':      <SetupConfig />,
    'mod-vouchers':      <ModVouchers />,
    'mod-checks':        <ModChecks />,
    'ref-categories':    <RefCategories />,
    'ref-payment-terms': <RefPaymentTerms />,
  };

  return (
    <div className="sp">
      <style>{CSS}</style>

      <div className="sp-sidebar">
        <div className="sp-sb-hdr">
          <h2>Settings</h2>
          <p>Workscale Finance Portal</p>
        </div>
        {NAV.map(group => (
          <div key={group.group}>
            <div className="sp-grp-lbl">{group.group}</div>
            {group.items.map(item => (
              <div key={item.id}
                className={`sp-nav${activeSection===item.id?' sp-nav-on':''}`}
                onClick={()=>setActiveSection(item.id)}>
                <span className="sp-nav-ico">{item.icon}</span>
                {item.label}
              </div>
            ))}
          </div>
        ))}
      </div>

      <div className="sp-content">
        {SECTIONS[activeSection]}
      </div>

      {userModal && (
        <div className="backdrop" onClick={()=>setUserModal(null)}>
          <div className="modal" onClick={e=>e.stopPropagation()}>
            <div className="modal-h">
              <strong>{userModal.isNew?'Add User':'Edit User'}</strong>
              <button className="btn btn-ghost btn-sm" onClick={()=>setUserModal(null)}>✕</button>
            </div>
            <div className="modal-b">
              <div className="field"><label>Email *</label><input type="email" value={userModal.email} onChange={e=>setUserModal(m=>({...m,email:e.target.value}))} autoFocus /></div>
              <div className="field"><label>Display Name</label><input value={userModal.displayName||''} onChange={e=>setUserModal(m=>({...m,displayName:e.target.value}))} /></div>
              <div className="field"><label>Role</label>
                <select value={userModal.role} onChange={e=>setUserModal(m=>({...m,role:e.target.value}))}>
                  {ROLES.map(r=><option key={r}>{r}</option>)}
                </select>
              </div>
            </div>
            <div className="modal-f">
              <button className="btn btn-ghost" onClick={()=>setUserModal(null)}>Cancel</button>
              <button className="btn btn-primary" disabled={saving} onClick={saveUser}>{saving?'Saving…':'Save User'}</button>
            </div>
          </div>
        </div>
      )}

      {catModal && (
        <div className="backdrop" onClick={()=>setCatModal(null)}>
          <div className="modal" onClick={e=>e.stopPropagation()}>
            <div className="modal-h">
              <strong>{catModal.isNew?'Add Category':'Edit Category'}</strong>
              <button className="btn btn-ghost btn-sm" onClick={()=>setCatModal(null)}>✕</button>
            </div>
            <div className="modal-b">
              <div className="field"><label>Category Name *</label><input value={catModal.name} onChange={e=>setCatModal(m=>({...m,name:e.target.value}))} placeholder="e.g. Office Supplies" autoFocus /></div>
            </div>
            <div className="modal-f">
              <button className="btn btn-ghost" onClick={()=>setCatModal(null)}>Cancel</button>
              <button className="btn btn-primary" disabled={saving} onClick={saveCat}>{saving?'Saving…':'Save'}</button>
            </div>
          </div>
        </div>
      )}

      {termModal && (
        <div className="backdrop" onClick={()=>setTermModal(null)}>
          <div className="modal" onClick={e=>e.stopPropagation()}>
            <div className="modal-h">
              <strong>{termModal.isNew?'Add Payment Term':'Edit Payment Term'}</strong>
              <button className="btn btn-ghost btn-sm" onClick={()=>setTermModal(null)}>✕</button>
            </div>
            <div className="modal-b">
              <div className="field"><label>Term Name *</label><input value={termModal.name||''} onChange={e=>setTermModal(m=>({...m,name:e.target.value}))} placeholder="e.g. Net 30" autoFocus /></div>
              <div className="field"><label>Due in (Days) *</label><input type="number" min="0" value={termModal.days||30} onChange={e=>setTermModal(m=>({...m,days:parseInt(e.target.value)||0}))} /></div>
              <div className="field"><label>Description</label><input value={termModal.description||''} onChange={e=>setTermModal(m=>({...m,description:e.target.value}))} placeholder="e.g. Payment due within 30 days" /></div>
            </div>
            <div className="modal-f">
              <button className="btn btn-ghost" onClick={()=>setTermModal(null)}>Cancel</button>
              <button className="btn btn-primary" disabled={saving} onClick={saveTerm}>{saving?'Saving…':'Save'}</button>
            </div>
          </div>
        </div>
      )}

      {confirmModal && (
        <div className="backdrop" onClick={()=>setConfirmModal(null)}>
          <div style={{width:'min(400px,98vw)',background:'#fff',borderRadius:16,overflow:'hidden',boxShadow:'0 24px 64px rgba(0,0,0,.25)'}} onClick={e=>e.stopPropagation()}>
            <div style={{padding:'14px 18px',borderBottom:'1px solid #e5e7eb',background:'#f8fafc',display:'flex',alignItems:'center',justifyContent:'space-between'}}>
              <strong style={{fontSize:14,fontWeight:900}}>Confirm</strong>
              <button className="btn btn-ghost btn-sm" onClick={()=>setConfirmModal(null)}>✕</button>
            </div>
            <div style={{padding:'18px'}}><p style={{margin:0,fontSize:14,lineHeight:1.5}}>{confirmModal.msg}</p></div>
            <div style={{display:'flex',justifyContent:'flex-end',gap:10,padding:'12px 18px',borderTop:'1px solid #e5e7eb'}}>
              <button className="btn btn-ghost" onClick={()=>setConfirmModal(null)}>Cancel</button>
              <button className="btn btn-danger" onClick={()=>{confirmModal.fn();setConfirmModal(null);}}>Confirm</button>
            </div>
          </div>
        </div>
      )}

      {toast && <div className="sp-toast">{toast}</div>}
    </div>
  );
}

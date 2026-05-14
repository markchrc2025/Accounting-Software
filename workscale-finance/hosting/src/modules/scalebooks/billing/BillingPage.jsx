import { useState, useEffect, useMemo } from 'react';
import {
  collection, onSnapshot, addDoc, updateDoc, deleteDoc, doc, serverTimestamp, query, orderBy, getDocs, where
} from 'firebase/firestore';
import { db, auth } from '../../../firebase.js';
import ContactPicker from '../../../components/ContactPicker.jsx';

const BS_STATUSES = ['Draft','Pending Review','Pending Approval','Approved','Sent','Partial','Paid','Voided'];

const STATUS_STYLES = {
  'Draft':            { background:'#f8fafc', borderColor:'#e2e8f0', color:'#64748b' },
  'Pending Review':   { background:'#fffbeb', borderColor:'#fde68a', color:'#92400e' },
  'Pending Approval': { background:'#fff7ed', borderColor:'#fed7aa', color:'#c2410c' },
  'Approved':         { background:'#ecfdf5', borderColor:'#6ee7b7', color:'#065f46' },
  'Sent':             { background:'#eff6ff', borderColor:'#bfdbfe', color:'#1d4ed8' },
  'Partial':          { background:'#f5f3ff', borderColor:'#ddd6fe', color:'#5b21b6' },
  'Paid':             { background:'#f0fdf4', borderColor:'#bbf7d0', color:'#15803d' },
  'Voided':           { background:'#fef2f2', borderColor:'#fecaca', color:'#991b1b' },
};

const TAX_GROUPS = ['VAT','VAT+EWT','EWT','Exempt','N/A'];

const CSS = `
  .bl-wrap  { display:flex; flex-direction:column; height:100%; overflow:hidden; font-family:Inter,system-ui,sans-serif; background:#f8fafc; }
  .bl-top   { display:flex; align-items:center; justify-content:space-between; padding:16px 22px 12px; flex-shrink:0; border-bottom:1px solid #e5e7eb; background:#fff; }
  .bl-body  { flex:1; overflow-y:auto; padding:16px 22px; }
  .kpi-row  { display:grid; grid-template-columns:repeat(auto-fill,minmax(140px,1fr)); gap:12px; margin-bottom:16px; }
  .kpi-card { background:#fff; border:1px solid #e5e7eb; border-radius:12px; padding:14px 16px; }
  .kpi-label { font-size:10px; color:#94a3b8; font-weight:800; letter-spacing:.06em; text-transform:uppercase; margin-bottom:4px; }
  .kpi-value { font-size:22px; font-weight:900; color:#0b1220; }
  .kpi-value.orange { color:#f97316; }
  .toolbar  { display:flex; gap:10px; align-items:center; flex-wrap:wrap; margin-bottom:14px; }
  .input    { border:1px solid #e5e7eb; border-radius:10px; padding:9px 12px; font-size:13px; background:#fff; font-family:inherit; }
  .btn      { border:0; border-radius:10px; padding:9px 16px; font-weight:700; cursor:pointer; font-size:13px; font-family:inherit; }
  .btn:disabled { opacity:.5; cursor:not-allowed; }
  .btn-primary { background:#f97316; color:#fff; }
  .btn-ghost   { background:#f1f5f9; color:#0b1220; }
  .btn-ghost:hover { background:#e2e8f0; }
  .btn-sm { padding:6px 12px; font-size:12px; }
  .btn-xs { padding:4px 8px; font-size:11px; border-radius:8px; }
  .card   { background:#fff; border:1px solid #e5e7eb; border-radius:14px; overflow:hidden; margin-bottom:16px; }
  table   { width:100%; border-collapse:collapse; }
  th,td   { padding:10px 12px; border-bottom:1px solid #f1f5f9; font-size:13px; text-align:left; }
  th      { color:#64748b; font-weight:800; font-size:11px; letter-spacing:.05em; text-transform:uppercase; background:#f8fafc; }
  tr:hover td { background:#fafafa; }
  tr:last-child td { border-bottom:none; }
  .pill   { display:inline-block; padding:2px 9px; border-radius:999px; font-size:11px; font-weight:700; border:1px solid #e2e8f0; background:#f8fafc; color:#64748b; }
  .expand-row td { background:#f8fafc !important; border-bottom:2px solid #e5e7eb; }
  .exp-box { padding:12px 4px; }
  .exp-box table { border:1px solid #e5e7eb; border-radius:10px; overflow:hidden; }
  .backdrop { position:fixed; inset:0; background:rgba(15,23,42,.45); display:flex; align-items:center; justify-content:center; padding:16px; z-index:100; }
  .modal  { width:min(640px,98vw); background:#fff; border-radius:16px; display:flex; flex-direction:column; overflow:hidden; box-shadow:0 24px 64px rgba(0,0,0,.25); }
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
  .lines-table { width:100%; border-collapse:collapse; margin-top:10px; }
  .lines-table th,.lines-table td { padding:7px 8px; border:1px solid #e5e7eb; font-size:12px; }
  .lines-table th { background:#f8fafc; font-weight:800; color:#64748b; }
  .empty  { padding:40px; text-align:center; color:#94a3b8; font-size:13px; }
  .toast  { position:fixed; right:16px; bottom:16px; background:#0b1220; color:#fff; padding:12px 18px; border-radius:12px; font-size:13px; font-weight:600; z-index:999; animation:fadeIn .2s; }
  .backdrop { position:fixed; inset:0; background:rgba(15,23,42,.45); display:flex; align-items:center; justify-content:center; padding:16px; z-index:100; }
  @keyframes fadeIn { from{opacity:0;transform:translateY(8px)} to{opacity:1;transform:none} }
`;

const fmt = (n) => new Intl.NumberFormat('en-PH',{style:'currency',currency:'PHP'}).format(Number(n||0));
const today = () => new Date().toISOString().slice(0,10);

export default function BillingPage() {
  const [statements, setStatements] = useState([]);
  const [contacts,   setContacts]   = useState([]);
  const [search,   setSearch]   = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [filterClient, setFilterClient] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo,   setDateTo]   = useState('');
  const [expandId, setExpandId] = useState(null);
  const [modal,    setModal]    = useState(null);
  const [statusModal, setStatusModal] = useState(null);
  const [saving,   setSaving]   = useState(false);
  const [toast,    setToast]    = useState('');
  const [confirmModal, setConfirmModal] = useState(null);

  const showToast = (msg) => { setToast(msg); setTimeout(() => setToast(''), 3000); };
  const askConfirm = (message, onConfirm) => setConfirmModal({ message, onConfirm });

  useEffect(() => {
    const u1 = onSnapshot(query(collection(db,'billingStatements'), orderBy('createdAt','desc')), s => setStatements(s.docs.map(d=>({id:d.id,...d.data()}))));
    const u2 = onSnapshot(query(collection(db,'contacts'), orderBy('name','asc')), s => setContacts(s.docs.map(d=>({id:d.id,...d.data()}))));
    return () => { u1(); u2(); };
  }, []);

  const kpis = useMemo(() => {
    const active = statements.filter(s => !['Voided'].includes(s.status));
    return {
      total:   statements.length,
      draft:   statements.filter(s=>s.status==='Draft').length,
      pending: statements.filter(s=>['Pending Review','Pending Approval'].includes(s.status)).length,
      sent:    statements.filter(s=>['Approved','Sent','Partial'].includes(s.status)).length,
      paid:    statements.filter(s=>s.status==='Paid').length,
      balance: active.reduce((a,s) => a + Number(s.balance||s.netDue||0), 0),
    };
  }, [statements]);

  const filtered = useMemo(() => {
    let a = [...statements];
    const q = search.toLowerCase();
    if (q) a = a.filter(x => (x.bsId||'').toLowerCase().includes(q) || (x.contactName||x.contact||'').toLowerCase().includes(q));
    if (filterStatus) a = a.filter(x => x.status === filterStatus);
    if (filterClient) a = a.filter(x => (x.contactName||x.contact||'').toLowerCase().includes(filterClient.toLowerCase()));
    if (dateFrom)     a = a.filter(x => (x.billingDate||'') >= dateFrom);
    if (dateTo)       a = a.filter(x => (x.billingDate||'') <= dateTo);
    return a;
  }, [statements, search, filterStatus, filterClient, dateFrom, dateTo]);

  const genBsId = () => {
    const d = new Date();
    const yy = String(d.getFullYear()).slice(2);
    const mm = String(d.getMonth()+1).padStart(2,'0');
    const seq = String(Math.floor(Math.random()*9000)+1000);
    return `BS${yy}${mm}${seq}`;
  };

  const openNew = () => setModal({
    isNew:true, bsId:genBsId(), contactId:'', contactName:'', billingDate:today(), dueDate:'', creditTerm:30,
    periodStart:'', periodEnd:'', description:'', grossAmount:0, taxGroupName:'VAT', totalVatInclusive:0,
    netDue:0, balance:0, incomeAccount:'', notes:'', status:'Draft', lines:[]
  });

  const save = async (statusOverride) => {
    if (!modal) return;
    if (!modal.contactName?.trim()) { showToast('Contact required.'); return; }
    setSaving(true);
    try {
      const { isNew, id, ...rest } = modal;
      const payload = { ...rest, status: statusOverride || rest.status, balance: Number(rest.netDue||0) - Number(rest.appliedAmount||0), updatedAt:serverTimestamp(), updatedBy:auth.currentUser?.email||'' };
      if (isNew) await addDoc(collection(db,'billingStatements'), { ...payload, appliedAmount:0, createdAt:serverTimestamp(), createdBy:auth.currentUser?.email||'' });
      else       await updateDoc(doc(db,'billingStatements',id), payload);
      showToast('Billing statement saved.'); setModal(null);
    } catch(e) { showToast('Error: '+e.message); }
    setSaving(false);
  };

  const doStatusUpdate = async () => {
    if (!statusModal) return;
    setSaving(true);
    try {
      const { id, newStatus, rejectReason } = statusModal;
      const email = auth.currentUser?.email||'';
      const update = { status:newStatus, updatedAt:serverTimestamp(), updatedBy:email };
      if (newStatus === 'Pending Approval') update.reviewedBy = email;
      if (newStatus === 'Approved') update.approvedBy = email;
      if (rejectReason) update.rejectReason = rejectReason;
      await updateDoc(doc(db,'billingStatements',id), update);
      showToast('Status updated.'); setStatusModal(null);
    } catch(e) { showToast('Error: '+e.message); }
    setSaving(false);
  };

  const doVoid = (bs) => {
    askConfirm(`Void billing statement "${bs.bsId}"?`, async () => {
      await updateDoc(doc(db,'billingStatements',bs.id), { status:'Voided', updatedAt:serverTimestamp() });
      showToast('Voided.');
    });
  };

  const NEXT_STATUSES = {
    'Draft':            ['Pending Review','Voided'],
    'Pending Review':   ['Pending Approval','Rejected','Voided'],
    'Pending Approval': ['Approved','Rejected','Voided'],
    'Approved':         ['Sent','Voided'],
    'Sent':             ['Partial','Paid','Voided'],
    'Partial':          ['Paid','Voided'],
  };

  return (
    <div className="bl-wrap">
      <style>{CSS}</style>
      <div className="bl-top">
        <strong style={{fontSize:18,fontWeight:900,color:'#0b1220'}}>BILLING STATEMENTS</strong>
        <button className="btn btn-primary" onClick={openNew}>＋ New Statement</button>
      </div>
      <div className="bl-body">
        <div className="kpi-row">
          <div className="kpi-card"><div className="kpi-label">Total</div><div className="kpi-value">{kpis.total}</div></div>
          <div className="kpi-card"><div className="kpi-label">Draft</div><div className="kpi-value">{kpis.draft}</div></div>
          <div className="kpi-card"><div className="kpi-label">Pending</div><div className="kpi-value">{kpis.pending}</div></div>
          <div className="kpi-card"><div className="kpi-label">Sent/Active</div><div className="kpi-value">{kpis.sent}</div></div>
          <div className="kpi-card"><div className="kpi-label">Paid</div><div className="kpi-value">{kpis.paid}</div></div>
          <div className="kpi-card"><div className="kpi-label">Total Balance</div><div className="kpi-value orange" style={{fontSize:16}}>{fmt(kpis.balance)}</div></div>
        </div>

        <div className="toolbar">
          <input className="input" placeholder="🔍 Search ID or client…" value={search} onChange={e=>setSearch(e.target.value)} style={{flex:'1 1 180px',minWidth:140}} />
          <select className="input" value={filterStatus} onChange={e=>setFilterStatus(e.target.value)}>
            <option value="">All Statuses</option>
            {BS_STATUSES.map(s=><option key={s}>{s}</option>)}
          </select>
          <input className="input" placeholder="Client…" value={filterClient} onChange={e=>setFilterClient(e.target.value)} style={{width:160}} />
          <input className="input" type="date" value={dateFrom} onChange={e=>setDateFrom(e.target.value)} title="Date From" />
          <input className="input" type="date" value={dateTo}   onChange={e=>setDateTo(e.target.value)}   title="Date To" />
          <button className="btn btn-ghost btn-sm" onClick={()=>{setSearch('');setFilterStatus('');setFilterClient('');setDateFrom('');setDateTo('');}}>✕ Clear</button>
        </div>

        <div className="card">
          <table>
            <thead>
              <tr><th>BS ID</th><th>CLIENT</th><th>DATE</th><th>DUE DATE</th><th>NET DUE</th><th>BALANCE</th><th>STATUS</th><th style={{textAlign:'center'}}>ACTIONS</th></tr>
            </thead>
            <tbody>
              {filtered.length === 0 && <tr><td colSpan={8} className="empty">No billing statements found.</td></tr>}
              {filtered.map(bs => {
                const ss = STATUS_STYLES[bs.status] || {};
                const isExp = expandId === bs.id;
                return [
                  <tr key={bs.id}>
                    <td><button className="btn btn-ghost btn-xs" style={{fontFamily:'monospace',color:'#f97316',fontWeight:800}} onClick={()=>setExpandId(isExp?null:bs.id)}>{bs.bsId||bs.id}</button></td>
                    <td>{bs.contactName||bs.contact||'—'}</td>
                    <td>{bs.billingDate||'—'}</td>
                    <td>{bs.dueDate||'—'}</td>
                    <td style={{fontWeight:700}}>{fmt(bs.netDue||bs.totalAmount||0)}</td>
                    <td style={{fontWeight:700,color: Number(bs.balance||0) > 0 ? '#c2410c' : '#15803d'}}>{fmt(bs.balance||0)}</td>
                    <td><span className="pill" style={ss}>{bs.status}</span></td>
                    <td style={{textAlign:'center'}}>
                      <div style={{display:'flex',gap:4,justifyContent:'center'}}>
                        <button className="btn btn-ghost btn-xs" onClick={()=>setModal({isNew:false,...bs})}>Edit</button>
                        {NEXT_STATUSES[bs.status] && <button className="btn btn-ghost btn-xs" onClick={()=>setStatusModal({id:bs.id,currentStatus:bs.status,newStatus:NEXT_STATUSES[bs.status][0],rejectReason:''})}>Update</button>}
                        {bs.status !== 'Voided' && <button className="btn btn-ghost btn-xs" style={{color:'#dc2626'}} onClick={()=>doVoid(bs)}>Void</button>}
                      </div>
                    </td>
                  </tr>,
                  isExp && (
                    <tr key={bs.id+'-exp'} className="expand-row">
                      <td colSpan={8}>
                        <div className="exp-box">
                          <div style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:12,marginBottom:10,fontSize:12}}>
                            <div><div style={{color:'#94a3b8',fontWeight:700,fontSize:10,textTransform:'uppercase'}}>Period</div><div>{bs.periodStart||'—'} – {bs.periodEnd||'—'}</div></div>
                            <div><div style={{color:'#94a3b8',fontWeight:700,fontSize:10,textTransform:'uppercase'}}>Tax Group</div><div>{bs.taxGroupName||'—'}</div></div>
                            <div><div style={{color:'#94a3b8',fontWeight:700,fontSize:10,textTransform:'uppercase'}}>Gross Amount</div><div>{fmt(bs.grossAmount||0)}</div></div>
                            <div><div style={{color:'#94a3b8',fontWeight:700,fontSize:10,textTransform:'uppercase'}}>Income Account</div><div>{bs.incomeAccount||'—'}</div></div>
                            {bs.reviewedBy && <div><div style={{color:'#94a3b8',fontWeight:700,fontSize:10,textTransform:'uppercase'}}>Reviewed By</div><div>{bs.reviewedBy}</div></div>}
                            {bs.approvedBy && <div><div style={{color:'#94a3b8',fontWeight:700,fontSize:10,textTransform:'uppercase'}}>Approved By</div><div>{bs.approvedBy}</div></div>}
                          </div>
                          {bs.description && <div style={{fontSize:12,color:'#64748b',marginBottom:8}}>Description: {bs.description}</div>}
                          {bs.notes && <div style={{fontSize:12,color:'#64748b'}}>Notes: {bs.notes}</div>}
                        </div>
                      </td>
                    </tr>
                  )
                ];
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Create/Edit Modal */}
      {modal && (
        <div className="backdrop" onClick={()=>setModal(null)}>
          <div className="modal" onClick={e=>e.stopPropagation()}>
            <div className="modal-h">
              <strong>{modal.isNew?'New Billing Statement':'Edit Billing Statement'}</strong>
              <button className="btn btn-ghost btn-sm" onClick={()=>setModal(null)}>✕</button>
            </div>
            <div className="modal-b">
              <div className="grid2" style={{gap:12}}>
                <div className="field">
                  <label>BS ID</label>
                  <input value={modal.bsId||''} onChange={e=>setModal(m=>({...m,bsId:e.target.value}))} />
                </div>
                <div className="field">
                  <label>Client / Contact</label>
                  <ContactPicker
                    typeFilter="Customer"
                    defaultNewType="Customer"
                    contacts={contacts}
                    value={modal.contactId}
                    displayName={modal.contactName}
                    onChange={({contactId, contactName})=>setModal(m=>({...m, contactId, contactName}))}
                  />
                </div>
                <div className="field">
                  <label>Billing Date</label>
                  <input type="date" value={modal.billingDate||''} onChange={e=>setModal(m=>({...m,billingDate:e.target.value}))} />
                </div>
                <div className="field">
                  <label>Due Date</label>
                  <input type="date" value={modal.dueDate||''} onChange={e=>setModal(m=>({...m,dueDate:e.target.value}))} />
                </div>
                <div className="field">
                  <label>Period Start</label>
                  <input type="date" value={modal.periodStart||''} onChange={e=>setModal(m=>({...m,periodStart:e.target.value}))} />
                </div>
                <div className="field">
                  <label>Period End</label>
                  <input type="date" value={modal.periodEnd||''} onChange={e=>setModal(m=>({...m,periodEnd:e.target.value}))} />
                </div>
                <div className="field">
                  <label>Gross Amount</label>
                  <input type="number" value={modal.grossAmount||0} onChange={e=>setModal(m=>({...m,grossAmount:Number(e.target.value)}))} />
                </div>
                <div className="field">
                  <label>Tax Group</label>
                  <select value={modal.taxGroupName||'VAT'} onChange={e=>setModal(m=>({...m,taxGroupName:e.target.value}))}>
                    {TAX_GROUPS.map(t=><option key={t}>{t}</option>)}
                  </select>
                </div>
                <div className="field">
                  <label>Net Due</label>
                  <input type="number" value={modal.netDue||0} onChange={e=>setModal(m=>({...m,netDue:Number(e.target.value)}))} />
                </div>
                <div className="field">
                  <label>Income Account</label>
                  <input value={modal.incomeAccount||''} onChange={e=>setModal(m=>({...m,incomeAccount:e.target.value}))} />
                </div>
                <div className="field col2">
                  <label>Description</label>
                  <input value={modal.description||''} onChange={e=>setModal(m=>({...m,description:e.target.value}))} />
                </div>
                <div className="field col2">
                  <label>Notes</label>
                  <textarea value={modal.notes||''} onChange={e=>setModal(m=>({...m,notes:e.target.value}))} />
                </div>
              </div>
            </div>
            <div className="modal-f">
              <button className="btn btn-ghost" onClick={()=>setModal(null)}>Cancel</button>
              <button className="btn btn-ghost" onClick={()=>save('Draft')} disabled={saving}>Save Draft</button>
              <button className="btn btn-primary" onClick={()=>save('Pending Review')} disabled={saving}>{saving?'Saving…':'Submit for Review'}</button>
            </div>
          </div>
        </div>
      )}

      {/* Status Update Modal */}
      {statusModal && (
        <div className="backdrop" onClick={()=>setStatusModal(null)}>
          <div className="modal" style={{width:'min(440px,98vw)'}} onClick={e=>e.stopPropagation()}>
            <div className="modal-h"><strong>Update Status</strong><button className="btn btn-ghost btn-sm" onClick={()=>setStatusModal(null)}>✕</button></div>
            <div className="modal-b" style={{gap:12}}>
              <div className="field">
                <label>New Status</label>
                <select value={statusModal.newStatus} onChange={e=>setStatusModal(m=>({...m,newStatus:e.target.value}))}>
                  {(NEXT_STATUSES[statusModal.currentStatus]||[]).map(s=><option key={s}>{s}</option>)}
                </select>
              </div>
              {statusModal.newStatus === 'Rejected' && (
                <div className="field">
                  <label>Reason for Rejection</label>
                  <textarea value={statusModal.rejectReason||''} onChange={e=>setStatusModal(m=>({...m,rejectReason:e.target.value}))} />
                </div>
              )}
            </div>
            <div className="modal-f">
              <button className="btn btn-ghost" onClick={()=>setStatusModal(null)}>Cancel</button>
              <button className="btn btn-primary" onClick={doStatusUpdate} disabled={saving}>{saving?'Saving…':'Update'}</button>
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

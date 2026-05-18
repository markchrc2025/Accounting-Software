import { useState, useEffect, useMemo } from 'react';
import { useLocation } from 'react-router-dom';
import {
  collection, onSnapshot, addDoc, updateDoc, deleteDoc, doc, serverTimestamp, query, orderBy
} from 'firebase/firestore';
import { db, auth } from '../../../firebase.js';
import ContactPicker from '../../../components/ContactPicker.jsx';
import { nextServiceInvoiceId } from '../../../utils/documentIds.js';

const SI_STATUSES = ['Draft','Pending Review','Pending Approval','Approved','Sent','Partial','Paid','Voided'];
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
const TAX_TYPES = ['N/A','VAT','EWT','VAT+EWT'];

const CSS = `
  .si-wrap { display:flex; flex-direction:column; height:100%; overflow:hidden; font-family:Inter,system-ui,sans-serif; background:#f8fafc; }
  .si-top  { display:flex; align-items:center; justify-content:space-between; padding:16px 22px 12px; flex-shrink:0; border-bottom:1px solid #e5e7eb; background:#fff; }
  .si-body { flex:1; overflow-y:auto; padding:16px 22px; }
  .kpi-row { display:grid; grid-template-columns:repeat(auto-fill,minmax(130px,1fr)); gap:12px; margin-bottom:16px; }
  .kpi-card { background:#fff; border:1px solid #e5e7eb; border-radius:12px; padding:14px 16px; }
  .kpi-label { font-size:10px; color:#94a3b8; font-weight:800; letter-spacing:.06em; text-transform:uppercase; margin-bottom:4px; }
  .kpi-value { font-size:20px; font-weight:900; color:#0b1220; }
  .kpi-value.orange { color:#f97316; }
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
  .modal  { width:min(580px,98vw); background:#fff; border-radius:16px; display:flex; flex-direction:column; overflow:hidden; box-shadow:0 24px 64px rgba(0,0,0,.25); }
  .modal-h { display:flex; align-items:center; justify-content:space-between; padding:14px 18px; border-bottom:1px solid #e5e7eb; background:#f8fafc; }
  .modal-h strong { font-size:14px; font-weight:900; }
  .modal-b { padding:18px; overflow-y:auto; max-height:65vh; }
  .modal-f { display:flex; justify-content:flex-end; gap:10px; padding:12px 18px; border-top:1px solid #e5e7eb; }
  .grid2  { display:grid; grid-template-columns:1fr 1fr; gap:12px; }
  .col2   { grid-column:span 2; }
  .field  { display:flex; flex-direction:column; gap:5px; }
  .field label { font-size:10px; font-weight:800; color:#64748b; letter-spacing:.06em; text-transform:uppercase; }
  .field input,.field select,.field textarea { border:1px solid #e5e7eb; border-radius:10px; padding:9px 10px; font-size:13px; font-family:inherit; width:100%; box-sizing:border-box; }
  .empty  { padding:40px; text-align:center; color:#94a3b8; font-size:13px; }
  .toast  { position:fixed; right:16px; bottom:16px; background:#0b1220; color:#fff; padding:12px 18px; border-radius:12px; font-size:13px; font-weight:600; z-index:999; animation:fadeIn .2s; }
  @keyframes fadeIn { from{opacity:0;transform:translateY(8px)} to{opacity:1;transform:none} }
`;

const fmt = (n) => new Intl.NumberFormat('en-PH',{style:'currency',currency:'PHP'}).format(Number(n||0));
const today = () => new Date().toISOString().slice(0,10);
const NEXT = {
  'Draft':['Pending Review','Voided'],'Pending Review':['Pending Approval','Rejected','Voided'],
  'Pending Approval':['Approved','Rejected','Voided'],'Approved':['Sent','Voided'],'Sent':['Partial','Paid','Voided'],'Partial':['Paid','Voided'],
};

const EMPTY = { isNew:true, siId:'', contactId:'', contactName:'', siDate:'', dueDate:'', amount:0, taxType:'N/A', ewtRate:0, incomeAccountCode:'', billingStatementId:'', notes:'', status:'Draft' };

export default function ServiceInvoicesPage() {
  const [invoices,  setInvoices]  = useState([]);
  const [contacts,  setContacts]  = useState([]);
  const [search,    setSearch]    = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [modal,     setModal]     = useState(null);
  const [statusModal, setStatusModal] = useState(null);
  const [saving,    setSaving]    = useState(false);
  const [toast,     setToast]     = useState('');

  const showToast = (msg) => { setToast(msg); setTimeout(() => setToast(''), 3000); };

  // Open create form when navigating from CreateFlyout
  const location = useLocation();
  useEffect(() => {
    if (location.state?.openCreate) { window.history.replaceState({}, ''); setModal({...EMPTY,siId:'',siDate:today()}); }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const u1 = onSnapshot(query(collection(db,'serviceInvoices'), orderBy('createdAt','desc')), s => setInvoices(s.docs.map(d=>({id:d.id,...d.data()}))));
    const u2 = onSnapshot(query(collection(db,'contacts'), orderBy('name','asc')), s => setContacts(s.docs.map(d=>({id:d.id,...d.data()}))));
    return () => { u1(); u2(); };
  }, []);

  const kpis = useMemo(() => ({
    total:   invoices.length,
    draft:   invoices.filter(i=>i.status==='Draft').length,
    pending: invoices.filter(i=>['Pending Review','Pending Approval'].includes(i.status)).length,
    paid:    invoices.filter(i=>i.status==='Paid').length,
    balance: invoices.filter(i=>i.status!=='Voided').reduce((a,i)=>a+Number(i.balance||i.amount||0),0),
  }), [invoices]);

  const filtered = useMemo(() => {
    let a = [...invoices];
    const q = search.toLowerCase();
    if (q) a = a.filter(x => (x.siId||'').toLowerCase().includes(q) || (x.contactName||x.contact||'').toLowerCase().includes(q));
    if (filterStatus) a = a.filter(x => x.status === filterStatus);
    return a;
  }, [invoices, search, filterStatus]);

  const genSiId = async (date) => nextServiceInvoiceId(date);

  const save = async (statusOverride) => {
    if (!modal?.contactName?.trim()) { showToast('Contact required.'); return; }
    setSaving(true);
    try {
      const { isNew, id, ...rest } = modal;
      const siId = isNew ? await genSiId(rest.siDate || today()) : (rest.siId || '');
      const payload = { ...rest, siId, status: statusOverride||rest.status, balance: Number(rest.amount||0) - Number(rest.appliedAmount||0), updatedAt:serverTimestamp(), updatedBy:auth.currentUser?.email||'' };
      if (isNew) await addDoc(collection(db,'serviceInvoices'), { ...payload, appliedAmount:0, createdAt:serverTimestamp(), createdBy:auth.currentUser?.email||'' });
      else       await updateDoc(doc(db,'serviceInvoices',id), payload);
      showToast('Invoice saved.'); setModal(null);
    } catch(e) { showToast('Error: '+e.message); }
    setSaving(false);
  };

  const doStatusUpdate = async () => {
    if (!statusModal) return;
    setSaving(true);
    try {
      const { id, newStatus, rejectReason } = statusModal;
      const email = auth.currentUser?.email||'';
      const upd = { status:newStatus, updatedAt:serverTimestamp(), updatedBy:email };
      if (newStatus==='Pending Approval') upd.reviewedBy = email;
      if (newStatus==='Approved') upd.approvedBy = email;
      if (rejectReason) upd.rejectReason = rejectReason;
      await updateDoc(doc(db,'serviceInvoices',id), upd);
      showToast('Status updated.'); setStatusModal(null);
    } catch(e) { showToast('Error: '+e.message); }
    setSaving(false);
  };

  return (
    <div className="si-wrap">
      <style>{CSS}</style>
      <div className="si-top">
        <strong style={{fontSize:18,fontWeight:900,color:'#0b1220'}}>SERVICE INVOICES</strong>
        <button className="btn btn-primary" onClick={()=>setModal({...EMPTY,siId:'',siDate:today()})}>＋ New Invoice</button>
      </div>
      <div className="si-body">
        {/* ── Primary KPI Scorecards ─────────────────────────────────────── */}
        <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(200px,1fr))',gap:14,marginBottom:12}}>
          <div style={{background:'linear-gradient(135deg,#c2410c 0%,#ea580c 100%)',borderRadius:14,padding:'18px 20px',color:'#fff',position:'relative',overflow:'hidden'}}>
            <div style={{position:'absolute',right:-8,top:-8,opacity:.13}}>
              <svg width="56" height="56" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"><path d="M12 1v22M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6"/></svg>
            </div>
            <div style={{fontSize:10,fontWeight:800,letterSpacing:'.08em',textTransform:'uppercase',opacity:.8,marginBottom:6}}>Total Balance</div>
            <div style={{fontSize:22,fontWeight:900,letterSpacing:'-.5px'}}>{fmt(kpis.balance)}</div>
            <div style={{marginTop:10,fontSize:11,opacity:.8}}>Outstanding receivables</div>
          </div>
          <div style={{background:'linear-gradient(135deg,#166534 0%,#16a34a 100%)',borderRadius:14,padding:'18px 20px',color:'#fff',position:'relative',overflow:'hidden'}}>
            <div style={{position:'absolute',right:-8,top:-8,opacity:.13}}>
              <svg width="56" height="56" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"><path d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>
            </div>
            <div style={{fontSize:10,fontWeight:800,letterSpacing:'.08em',textTransform:'uppercase',opacity:.8,marginBottom:6}}>Paid</div>
            <div style={{fontSize:22,fontWeight:900,letterSpacing:'-.5px'}}>{kpis.paid}</div>
            <div style={{marginTop:10,fontSize:11,opacity:.8}}>Fully collected invoices</div>
          </div>
          <div style={{background:'linear-gradient(135deg,#b45309 0%,#d97706 100%)',borderRadius:14,padding:'18px 20px',color:'#fff',position:'relative',overflow:'hidden'}}>
            <div style={{position:'absolute',right:-8,top:-8,opacity:.13}}>
              <svg width="56" height="56" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 8v4l3 3"/></svg>
            </div>
            <div style={{fontSize:10,fontWeight:800,letterSpacing:'.08em',textTransform:'uppercase',opacity:.8,marginBottom:6}}>Pending</div>
            <div style={{fontSize:22,fontWeight:900,letterSpacing:'-.5px'}}>{kpis.pending}</div>
            <div style={{marginTop:10,fontSize:11,opacity:.8}}>Awaiting approval</div>
          </div>
        </div>
        {/* ── Secondary KPI Row ─────────────────────────────────────────── */}
        <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(140px,1fr))',gap:10,marginBottom:16}}>
          {[
            {label:'Total Invoices',value:kpis.total,sub:'all service invoices',color:'#1d4ed8',bg:'#eff6ff',border:'#bfdbfe',icon:<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><path d="M14 2v6h6M16 13H8M16 17H8M10 9H8"/></svg>},
            {label:'Draft',value:kpis.draft,sub:'not yet submitted',color:'#64748b',bg:'#f8fafc',border:'#e2e8f0',icon:<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>},
          ].map(({label,value,sub,color,bg,border,icon})=>(
            <div key={label} style={{background:bg,border:`1px solid ${border}`,borderRadius:12,padding:'14px 15px'}}>
              <div style={{display:'flex',alignItems:'center',gap:6,marginBottom:6}}>
                <span style={{color,display:'flex'}}>{icon}</span>
                <span style={{fontSize:9,fontWeight:800,color:'#64748b',letterSpacing:'.07em',textTransform:'uppercase'}}>{label}</span>
              </div>
              <div style={{fontSize:20,fontWeight:900,color,lineHeight:1}}>{value}</div>
              <div style={{fontSize:11,color:'#94a3b8',marginTop:4}}>{sub}</div>
            </div>
          ))}
        </div>
        <div className="toolbar">
          <input className="input" placeholder="🔍 Search SI ID or client…" value={search} onChange={e=>setSearch(e.target.value)} style={{flex:'1 1 180px',minWidth:140}} />
          <select className="input" value={filterStatus} onChange={e=>setFilterStatus(e.target.value)}>
            <option value="">All Statuses</option>
            {SI_STATUSES.map(s=><option key={s}>{s}</option>)}
          </select>
          <button className="btn btn-ghost btn-sm" onClick={()=>{setSearch('');setFilterStatus('');}}>✕ Clear</button>
        </div>
        <div className="card">
          <table>
            <thead>
              <tr><th>SI ID</th><th>CLIENT</th><th>DATE</th><th>DUE DATE</th><th>AMOUNT</th><th>BALANCE</th><th>TAX</th><th>STATUS</th><th style={{textAlign:'center'}}>ACTIONS</th></tr>
            </thead>
            <tbody>
              {filtered.length === 0 && <tr><td colSpan={9} className="empty">No service invoices found.</td></tr>}
              {filtered.map(si => {
                const ss = STATUS_STYLES[si.status]||{};
                return (
                  <tr key={si.id}>
                    <td><strong style={{fontFamily:'monospace',color:'#f97316'}}>{si.siId||si.id}</strong></td>
                    <td>{si.contactName||si.contact||'—'}</td>
                    <td>{si.siDate||'—'}</td>
                    <td>{si.dueDate||'—'}</td>
                    <td style={{fontWeight:700}}>{fmt(si.amount||0)}</td>
                    <td style={{fontWeight:700,color:Number(si.balance||0)>0?'#c2410c':'#15803d'}}>{fmt(si.balance||0)}</td>
                    <td><span className="pill">{si.taxType||'N/A'}</span></td>
                    <td><span className="pill" style={ss}>{si.status}</span></td>
                    <td style={{textAlign:'center'}}>
                      <div style={{display:'flex',gap:4,justifyContent:'center'}}>
                        <button className="btn btn-ghost btn-xs" onClick={()=>setModal({isNew:false,...si})}>Edit</button>
                        {NEXT[si.status] && <button className="btn btn-ghost btn-xs" onClick={()=>setStatusModal({id:si.id,currentStatus:si.status,newStatus:NEXT[si.status][0],rejectReason:''})}>Update</button>}
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
              <strong>{modal.isNew?'New Service Invoice':'Edit Service Invoice'}</strong>
              <button className="btn btn-ghost btn-sm" onClick={()=>setModal(null)}>✕</button>
            </div>
            <div className="modal-b">
              <div className="grid2" style={{gap:12}}>
                <div className="field">
                  <label>SI ID</label>
                  <input value={modal.siId || ''} readOnly placeholder={modal.isNew ? 'Auto-assigned on save' : ''} style={modal.isNew ? {background:'#f8fafc',color:'#64748b',fontWeight:700} : undefined} />
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
                  <label>SI Date</label>
                  <input type="date" value={modal.siDate||''} onChange={e=>setModal(m=>({...m,siDate:e.target.value}))} />
                </div>
                <div className="field">
                  <label>Due Date</label>
                  <input type="date" value={modal.dueDate||''} onChange={e=>setModal(m=>({...m,dueDate:e.target.value}))} />
                </div>
                <div className="field">
                  <label>Amount</label>
                  <input type="number" value={modal.amount||0} onChange={e=>setModal(m=>({...m,amount:Number(e.target.value)}))} />
                </div>
                <div className="field">
                  <label>Tax Type</label>
                  <select value={modal.taxType||'N/A'} onChange={e=>setModal(m=>({...m,taxType:e.target.value}))}>
                    {TAX_TYPES.map(t=><option key={t}>{t}</option>)}
                  </select>
                </div>
                <div className="field">
                  <label>EWT Rate (%)</label>
                  <input type="number" step="0.01" value={modal.ewtRate||0} onChange={e=>setModal(m=>({...m,ewtRate:Number(e.target.value)}))} />
                </div>
                <div className="field">
                  <label>Income Account</label>
                  <input value={modal.incomeAccountCode||''} onChange={e=>setModal(m=>({...m,incomeAccountCode:e.target.value}))} />
                </div>
                <div className="field col2">
                  <label>Billing Statement ID (link)</label>
                  <input value={modal.billingStatementId||''} onChange={e=>setModal(m=>({...m,billingStatementId:e.target.value}))} />
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
              <button className="btn btn-primary" onClick={()=>save('Pending Review')} disabled={saving}>{saving?'Saving…':'Submit'}</button>
            </div>
          </div>
        </div>
      )}

      {statusModal && (
        <div className="backdrop" onClick={()=>setStatusModal(null)}>
          <div className="modal" style={{width:'min(440px,98vw)'}} onClick={e=>e.stopPropagation()}>
            <div className="modal-h"><strong>Update Status</strong><button className="btn btn-ghost btn-sm" onClick={()=>setStatusModal(null)}>✕</button></div>
            <div className="modal-b" style={{gap:12,display:'flex',flexDirection:'column'}}>
              <div className="field">
                <label>New Status</label>
                <select value={statusModal.newStatus} onChange={e=>setStatusModal(m=>({...m,newStatus:e.target.value}))}>
                  {(NEXT[statusModal.currentStatus]||[]).map(s=><option key={s}>{s}</option>)}
                </select>
              </div>
              {statusModal.newStatus==='Rejected' && (
                <div className="field">
                  <label>Rejection Reason</label>
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
      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}

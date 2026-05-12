import { useState, useEffect, useMemo } from 'react';
import {
  collection, onSnapshot, addDoc, updateDoc, deleteDoc, doc, serverTimestamp, query, orderBy
} from 'firebase/firestore';
import { db, auth } from '../../../firebase.js';

const COLL_STATUSES = ['Unposted','Posted','Voided'];
const STATUS_STYLES = {
  'Unposted': { background:'#fffbeb', borderColor:'#fde68a', color:'#92400e' },
  'Posted':   { background:'#ecfdf5', borderColor:'#6ee7b7', color:'#065f46' },
  'Voided':   { background:'#fef2f2', borderColor:'#fecaca', color:'#991b1b' },
};
const METHODS = ['Cash','Check','Bank Transfer','GCash','PayMaya','Wire','Other'];

const CSS = `
  .cl-wrap { display:flex; flex-direction:column; height:100%; overflow:hidden; font-family:Inter,system-ui,sans-serif; background:#f8fafc; }
  .cl-top  { display:flex; align-items:center; justify-content:space-between; padding:16px 22px 12px; flex-shrink:0; border-bottom:1px solid #e5e7eb; background:#fff; }
  .cl-body { flex:1; overflow-y:auto; padding:16px 22px; }
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
  .modal  { width:min(560px,98vw); background:#fff; border-radius:16px; display:flex; flex-direction:column; overflow:hidden; box-shadow:0 24px 64px rgba(0,0,0,.25); }
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
  .backdrop { position:fixed; inset:0; background:rgba(15,23,42,.45); display:flex; align-items:center; justify-content:center; padding:16px; z-index:100; }
  @keyframes fadeIn { from{opacity:0;transform:translateY(8px)} to{opacity:1;transform:none} }
`;

const fmt = (n) => new Intl.NumberFormat('en-PH',{style:'currency',currency:'PHP'}).format(Number(n||0));
const today = () => new Date().toISOString().slice(0,10);

const EMPTY = { isNew:true, collectionId:'', contactName:'', collectionDate:'', amountReceived:0, appliedAmount:0, unappliedAmount:0, method:'Cash', referenceNo:'', billingStatementId:'', siId:'', status:'Unposted', notes:'' };

export default function CollectionsPage() {
  const [collections, setCollections] = useState([]);
  const [contacts,    setContacts]    = useState([]);
  const [search,      setSearch]      = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo,   setDateTo]   = useState('');
  const [modal,    setModal]    = useState(null);
  const [saving,   setSaving]   = useState(false);
  const [toast,    setToast]    = useState('');
  const [confirmModal, setConfirmModal] = useState(null);

  const showToast = (msg) => { setToast(msg); setTimeout(() => setToast(''), 3000); };
  const askConfirm = (message, onConfirm) => setConfirmModal({ message, onConfirm });

  useEffect(() => {
    const u1 = onSnapshot(query(collection(db,'collections'), orderBy('createdAt','desc')), s => setCollections(s.docs.map(d=>({id:d.id,...d.data()}))));
    const u2 = onSnapshot(query(collection(db,'contacts'), orderBy('name','asc')), s => setContacts(s.docs.map(d=>({id:d.id,...d.data()}))));
    return () => { u1(); u2(); };
  }, []);

  const kpis = useMemo(() => ({
    total:     collections.length,
    unposted:  collections.filter(c=>c.status==='Unposted').length,
    posted:    collections.filter(c=>c.status==='Posted').length,
    received:  collections.filter(c=>c.status!=='Voided').reduce((a,c)=>a+Number(c.amountReceived||0),0),
    unapplied: collections.filter(c=>c.status==='Posted').reduce((a,c)=>a+Number(c.unappliedAmount||0),0),
  }), [collections]);

  const filtered = useMemo(() => {
    let a = [...collections];
    const q = search.toLowerCase();
    if (q) a = a.filter(x => (x.collectionId||'').toLowerCase().includes(q) || (x.contactName||x.contact||'').toLowerCase().includes(q) || (x.referenceNo||'').toLowerCase().includes(q));
    if (filterStatus) a = a.filter(x => x.status === filterStatus);
    if (dateFrom) a = a.filter(x => (x.collectionDate||'') >= dateFrom);
    if (dateTo)   a = a.filter(x => (x.collectionDate||'') <= dateTo);
    return a;
  }, [collections, search, filterStatus, dateFrom, dateTo]);

  const genId = () => {
    const d = new Date();
    const yy = String(d.getFullYear()).slice(2);
    const mm = String(d.getMonth()+1).padStart(2,'0');
    return `COL${yy}${mm}${String(Math.floor(Math.random()*9000)+1000)}`;
  };

  const save = async () => {
    if (!modal?.contactName?.trim()) { showToast('Contact required.'); return; }
    setSaving(true);
    try {
      const { isNew, id, ...rest } = modal;
      const unapplied = Number(rest.amountReceived||0) - Number(rest.appliedAmount||0);
      const payload = { ...rest, unappliedAmount: unapplied, updatedAt:serverTimestamp(), updatedBy:auth.currentUser?.email||'' };
      if (isNew) await addDoc(collection(db,'collections'), { ...payload, createdAt:serverTimestamp(), createdBy:auth.currentUser?.email||'' });
      else       await updateDoc(doc(db,'collections',id), payload);
      showToast('Collection saved.'); setModal(null);
    } catch(e) { showToast('Error: '+e.message); }
    setSaving(false);
  };

  const doPost = (c) => {
    askConfirm(`Post collection "${c.collectionId}"? This will mark it as Posted.`, async () => {
      await updateDoc(doc(db,'collections',c.id), { status:'Posted', postedBy:auth.currentUser?.email||'', postedAt:serverTimestamp(), updatedAt:serverTimestamp() });
      showToast('Posted.');
    });
  };

  const doVoid = (c) => {
    askConfirm(`Void collection "${c.collectionId}"?`, async () => {
      await updateDoc(doc(db,'collections',c.id), { status:'Voided', updatedAt:serverTimestamp() });
      showToast('Voided.');
    });
  };

  return (
    <div className="cl-wrap">
      <style>{CSS}</style>
      <div className="cl-top">
        <strong style={{fontSize:18,fontWeight:900,color:'#0b1220'}}>COLLECTIONS</strong>
        <button className="btn btn-primary" onClick={()=>setModal({...EMPTY,collectionId:genId(),collectionDate:today()})}>＋ Record Collection</button>
      </div>
      <div className="cl-body">
        <div className="kpi-row">
          <div className="kpi-card"><div className="kpi-label">Total</div><div className="kpi-value">{kpis.total}</div></div>
          <div className="kpi-card"><div className="kpi-label">Unposted</div><div className="kpi-value">{kpis.unposted}</div></div>
          <div className="kpi-card"><div className="kpi-label">Posted</div><div className="kpi-value">{kpis.posted}</div></div>
          <div className="kpi-card"><div className="kpi-label">Total Received</div><div className="kpi-value orange" style={{fontSize:14}}>{fmt(kpis.received)}</div></div>
          <div className="kpi-card"><div className="kpi-label">Unapplied</div><div className="kpi-value" style={{fontSize:14,color:kpis.unapplied>0?'#c2410c':'#15803d'}}>{fmt(kpis.unapplied)}</div></div>
        </div>
        <div className="toolbar">
          <input className="input" placeholder="🔍 Search ID, client, ref…" value={search} onChange={e=>setSearch(e.target.value)} style={{flex:'1 1 180px',minWidth:140}} />
          <select className="input" value={filterStatus} onChange={e=>setFilterStatus(e.target.value)}>
            <option value="">All Statuses</option>
            {COLL_STATUSES.map(s=><option key={s}>{s}</option>)}
          </select>
          <input className="input" type="date" value={dateFrom} onChange={e=>setDateFrom(e.target.value)} />
          <input className="input" type="date" value={dateTo}   onChange={e=>setDateTo(e.target.value)}   />
          <button className="btn btn-ghost btn-sm" onClick={()=>{setSearch('');setFilterStatus('');setDateFrom('');setDateTo('');}}>✕ Clear</button>
        </div>
        <div className="card">
          <table>
            <thead>
              <tr><th>COLL. ID</th><th>CLIENT</th><th>DATE</th><th>AMOUNT</th><th>APPLIED</th><th>UNAPPLIED</th><th>METHOD</th><th>REF NO</th><th>STATUS</th><th style={{textAlign:'center'}}>ACTIONS</th></tr>
            </thead>
            <tbody>
              {filtered.length === 0 && <tr><td colSpan={10} className="empty">No collections found.</td></tr>}
              {filtered.map(c => {
                const ss = STATUS_STYLES[c.status]||{};
                return (
                  <tr key={c.id}>
                    <td><strong style={{fontFamily:'monospace',color:'#f97316'}}>{c.collectionId||c.id}</strong></td>
                    <td>{c.contactName||c.contact||'—'}</td>
                    <td>{c.collectionDate||'—'}</td>
                    <td style={{fontWeight:700}}>{fmt(c.amountReceived||0)}</td>
                    <td>{fmt(c.appliedAmount||0)}</td>
                    <td style={{color:Number(c.unappliedAmount||0)>0?'#c2410c':'#64748b'}}>{fmt(c.unappliedAmount||0)}</td>
                    <td>{c.method||'—'}</td>
                    <td style={{fontSize:12,fontFamily:'monospace'}}>{c.referenceNo||'—'}</td>
                    <td><span className="pill" style={ss}>{c.status}</span></td>
                    <td style={{textAlign:'center'}}>
                      <div style={{display:'flex',gap:4,justifyContent:'center'}}>
                        <button className="btn btn-ghost btn-xs" onClick={()=>setModal({isNew:false,...c})}>Edit</button>
                        {c.status==='Unposted' && <button className="btn btn-ghost btn-xs" style={{color:'#065f46'}} onClick={()=>doPost(c)}>Post</button>}
                        {c.status!=='Voided'   && <button className="btn btn-ghost btn-xs" style={{color:'#dc2626'}} onClick={()=>doVoid(c)}>Void</button>}
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
              <strong>{modal.isNew?'Record Collection':'Edit Collection'}</strong>
              <button className="btn btn-ghost btn-sm" onClick={()=>setModal(null)}>✕</button>
            </div>
            <div className="modal-b">
              <div className="grid2" style={{gap:12}}>
                <div className="field">
                  <label>Collection ID</label>
                  <input value={modal.collectionId||''} onChange={e=>setModal(m=>({...m,collectionId:e.target.value}))} />
                </div>
                <div className="field">
                  <label>Client / Contact</label>
                  <input list="cl-contacts" value={modal.contactName||''} onChange={e=>setModal(m=>({...m,contactName:e.target.value}))} />
                  <datalist id="cl-contacts">{contacts.map(c=><option key={c.id} value={c.name}/>)}</datalist>
                </div>
                <div className="field">
                  <label>Collection Date</label>
                  <input type="date" value={modal.collectionDate||''} onChange={e=>setModal(m=>({...m,collectionDate:e.target.value}))} />
                </div>
                <div className="field">
                  <label>Amount Received</label>
                  <input type="number" value={modal.amountReceived||0} onChange={e=>setModal(m=>({...m,amountReceived:Number(e.target.value)}))} />
                </div>
                <div className="field">
                  <label>Payment Method</label>
                  <select value={modal.method||'Cash'} onChange={e=>setModal(m=>({...m,method:e.target.value}))}>
                    {METHODS.map(mth=><option key={mth}>{mth}</option>)}
                  </select>
                </div>
                <div className="field">
                  <label>Reference No</label>
                  <input value={modal.referenceNo||''} onChange={e=>setModal(m=>({...m,referenceNo:e.target.value}))} placeholder="Check/OR/Ref #" />
                </div>
                <div className="field">
                  <label>Billing Statement ID (link)</label>
                  <input value={modal.billingStatementId||''} onChange={e=>setModal(m=>({...m,billingStatementId:e.target.value}))} />
                </div>
                <div className="field">
                  <label>SI ID (link)</label>
                  <input value={modal.siId||''} onChange={e=>setModal(m=>({...m,siId:e.target.value}))} />
                </div>
                <div className="field col2">
                  <label>Notes</label>
                  <textarea value={modal.notes||''} onChange={e=>setModal(m=>({...m,notes:e.target.value}))} />
                </div>
              </div>
            </div>
            <div className="modal-f">
              <button className="btn btn-ghost" onClick={()=>setModal(null)}>Cancel</button>
              <button className="btn btn-primary" onClick={save} disabled={saving}>{saving?'Saving…':'Save'}</button>
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

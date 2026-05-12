import { useState, useEffect } from 'react';
import {
  collection, query, orderBy, onSnapshot, addDoc, updateDoc, doc, serverTimestamp
} from 'firebase/firestore';
import { db, auth } from '../../../firebase.js';

const fmt = (n) => new Intl.NumberFormat('en-PH', { style:'currency', currency:'PHP' }).format(n || 0);
const uid = () => Math.random().toString(36).slice(2, 10).toUpperCase();
const BANK_CODES = ['UBPBPHM','BPI','BDO','RCBC','MBTC'];

const CSS = `
  .cr-wrap   { display:flex; flex-direction:column; height:100%; overflow:hidden; font-family:Inter,system-ui,sans-serif; }
  .cr-topbar { display:flex; align-items:center; justify-content:space-between; padding:16px 22px 12px; flex-shrink:0; border-bottom:1px solid #e5e7eb; background:#fff; }
  .cr-body   { flex:1; overflow-y:auto; padding:16px 22px; }
  .input     { border:1px solid #e5e7eb; border-radius:10px; padding:9px 12px; font-size:13px; background:#fff; }
  .btn       { border:0; border-radius:10px; padding:9px 16px; font-weight:700; cursor:pointer; font-size:13px; font-family:inherit; }
  .btn-primary { background:#f97316; color:#fff; }
  .btn-ghost   { background:#f1f5f9; color:#0b1220; }
  .btn-ghost:hover { background:#e2e8f0; }
  .btn-sm    { padding:6px 12px; font-size:12px; }
  .toolbar   { display:flex; gap:10px; align-items:center; flex-wrap:wrap; margin-bottom:14px; }
  .tabs      { display:flex; gap:4px; background:#f1f5f9; border-radius:10px; padding:4px; width:fit-content; margin-bottom:14px; }
  .tab       { border:0; background:none; padding:8px 18px; border-radius:8px; font-size:13px; font-weight:700; cursor:pointer; color:#64748b; font-family:inherit; }
  .tab.active { background:#fff; color:#0b1220; box-shadow:0 1px 4px rgba(0,0,0,.1); }
  .card      { background:#fff; border:1px solid #e5e7eb; border-radius:14px; overflow:hidden; margin-bottom:12px; }
  table      { width:100%; border-collapse:collapse; }
  th,td      { padding:11px 12px; border-bottom:1px solid #f1f5f9; font-size:13px; text-align:left; }
  th         { color:#64748b; font-weight:800; font-size:11px; letter-spacing:.05em; text-transform:uppercase; background:#f8fafc; }
  tr:hover td { background:#fafafa; }
  tr:last-child td { border-bottom:none; }
  .pill      { display:inline-block; padding:2px 9px; border-radius:999px; font-size:11px; font-weight:700; border:1px solid; }
  .pill-issued   { background:#eff6ff; border-color:#bfdbfe; color:#1d4ed8; }
  .pill-cleared  { background:#f0fdf4; border-color:#bbf7d0; color:#15803d; }
  .pill-voided   { background:#f8fafc; border-color:#e2e8f0; color:#94a3b8; }
  .pill-stopped  { background:#fef2f2; border-color:#fecaca; color:#dc2626; }
  .pill-active   { background:#f0fdf4; border-color:#bbf7d0; color:#15803d; }
  .pill-inactive { background:#f8fafc; border-color:#e2e8f0; color:#94a3b8; }
  .empty     { padding:48px; text-align:center; color:#94a3b8; }
  .backdrop  { position:fixed; inset:0; background:rgba(15,23,42,.45); display:flex; align-items:center; justify-content:center; padding:16px; z-index:100; }
  .modal     { width:min(560px,98vw); background:#fff; border-radius:16px; overflow:hidden; box-shadow:0 24px 64px rgba(0,0,0,.25); }
  .modal-h   { display:flex; align-items:center; justify-content:space-between; padding:16px 20px; border-bottom:1px solid #e5e7eb; background:#f8fafc; }
  .modal-b   { padding:20px; display:grid; grid-template-columns:1fr 1fr; gap:12px; }
  .modal-f   { display:flex; justify-content:flex-end; gap:10px; padding:14px 20px; border-top:1px solid #e5e7eb; }
  .field     { display:flex; flex-direction:column; gap:5px; }
  .field.full { grid-column:span 2; }
  .field label { font-size:10px; font-weight:800; color:#64748b; letter-spacing:.06em; text-transform:uppercase; }
  .field input,.field select,.field textarea { width:100%; border:1px solid #e5e7eb; border-radius:10px; padding:9px 10px; font-size:13px; background:#fff; font-family:inherit; box-sizing:border-box; }
  .toast { position:fixed; right:16px; bottom:16px; background:#0b1220; color:#fff; padding:12px 18px; border-radius:12px; font-size:13px; font-weight:600; z-index:999; }
`;

const checkPill = (s) => {
  const m = { Issued:'pill-issued', Cleared:'pill-cleared', Voided:'pill-voided', Stopped:'pill-stopped' };
  return `pill ${m[s]||'pill-issued'}`;
};

export default function CheckRegistryPage() {
  const [tab, setTab]         = useState('register');
  const [checkbooks, setCheckbooks] = useState([]);
  const [checks, setChecks]   = useState([]);
  const [filter, setFilter]   = useState('All');
  const [bankFilter, setBankFilter] = useState('All');
  const [showCbModal, setShowCbModal] = useState(false);
  const [showCkModal, setShowCkModal] = useState(false);
  const [editingCb, setEditingCb] = useState(null);
  const [editingCk, setEditingCk] = useState(null);
  const [cbForm, setCbForm]   = useState({});
  const [ckForm, setCkForm]   = useState({});
  const [saving, setSaving]   = useState(false);
  const [toast, setToast]     = useState('');

  const showToast = (msg) => { setToast(msg); setTimeout(() => setToast(''), 3000); };

  useEffect(() => {
    const unsubCb = onSnapshot(query(collection(db,'checkbookMaster'), orderBy('createdAt','desc')), snap=>setCheckbooks(snap.docs.map(d=>({id:d.id,...d.data()}))));
    const unsubCk = onSnapshot(query(collection(db,'checkRegister'),   orderBy('issueDate','desc')),  snap=>setChecks(snap.docs.map(d=>({id:d.id,...d.data()}))));
    return () => { unsubCb(); unsubCk(); };
  }, []);

  async function saveCb() {
    if (!cbForm.bankCode) return alert('Bank is required.');
    setSaving(true);
    try {
      const payload = { ...cbForm, updatedAt: serverTimestamp() };
      if (editingCb) { await updateDoc(doc(db,'checkbookMaster',editingCb), payload); showToast('Checkbook updated.'); }
      else { await addDoc(collection(db,'checkbookMaster'), {...payload, createdAt:serverTimestamp(), createdBy:auth.currentUser?.email}); showToast('Checkbook added.'); }
      setShowCbModal(false);
    } catch(e) { alert(e.message); }
    setSaving(false);
  }

  async function saveCk() {
    if (!ckForm.checkNumber) return alert('Check number is required.');
    setSaving(true);
    try {
      const payload = { ...ckForm, amount:parseFloat(ckForm.amount)||0, updatedAt:serverTimestamp() };
      if (editingCk) { await updateDoc(doc(db,'checkRegister',editingCk), payload); showToast('Check updated.'); }
      else { await addDoc(collection(db,'checkRegister'), {...payload, createdAt:serverTimestamp(), createdBy:auth.currentUser?.email}); showToast('Check registered.'); }
      setShowCkModal(false);
    } catch(e) { alert(e.message); }
    setSaving(false);
  }

  async function updateCheckStatus(id, status) {
    await updateDoc(doc(db,'checkRegister',id), { status, updatedAt:serverTimestamp() });
    showToast(`Check marked ${status}.`);
  }

  const filteredChecks = checks.filter(c => {
    const mStatus = filter==='All' || c.status===filter;
    const mBank   = bankFilter==='All' || c.bankCode===bankFilter;
    return mStatus && mBank;
  });

  return (
    <div className="cr-wrap">
      <style>{CSS}</style>
      <div className="cr-topbar">
        <div>
          <h1 style={{ margin:0, fontSize:18, fontWeight:900 }}>Check Registry</h1>
          <p style={{ margin:0, fontSize:12, color:'#64748b' }}>{checks.length} check{checks.length!==1?'s':''} · {checkbooks.length} checkbook{checkbooks.length!==1?'s':''}</p>
        </div>
        <div style={{ display:'flex', gap:8 }}>
          <button className="btn btn-ghost" onClick={()=>{setEditingCb(null);setCbForm({isActive:true});setShowCbModal(true);}}>+ Checkbook</button>
          <button className="btn btn-primary" onClick={()=>{setEditingCk(null);setCkForm({bankCode:'UBPBPHM',status:'Issued',issueDate:new Date().toISOString().slice(0,10)});setShowCkModal(true);}}>+ Register Check</button>
        </div>
      </div>

      <div className="cr-body">
        <div className="tabs">
          <button className={`tab ${tab==='register'?'active':''}`} onClick={()=>setTab('register')}>Check Register</button>
          <button className={`tab ${tab==='checkbooks'?'active':''}`} onClick={()=>setTab('checkbooks')}>Checkbooks ({checkbooks.length})</button>
        </div>

        {tab === 'register' && <>
          <div className="toolbar">
            <select className="input" value={filter} onChange={e=>setFilter(e.target.value)}>
              {['All','Issued','Cleared','Voided','Stopped'].map(s=><option key={s}>{s}</option>)}
            </select>
            <select className="input" value={bankFilter} onChange={e=>setBankFilter(e.target.value)}>
              <option value="All">All Banks</option>
              {BANK_CODES.map(b=><option key={b}>{b}</option>)}
            </select>
          </div>
          <div className="card">
            {filteredChecks.length===0 ? <div className="empty">No checks found.</div> : (
              <table>
                <thead><tr><th>Check No.</th><th>Bank</th><th>Issue Date</th><th>Payee</th><th style={{textAlign:'right'}}>Amount</th><th>Cleared</th><th>Status</th><th>Actions</th></tr></thead>
                <tbody>{filteredChecks.map(c=>(
                  <tr key={c.id}>
                    <td style={{fontFamily:'monospace',fontWeight:800}}>{c.checkNumber}</td>
                    <td style={{color:'#475569'}}>{c.bankCode}</td>
                    <td style={{color:'#64748b'}}>{c.issueDate}</td>
                    <td style={{fontWeight:700}}>{c.payeeName}</td>
                    <td style={{textAlign:'right',fontWeight:800}}>{fmt(c.amount)}</td>
                    <td style={{color:'#94a3b8',fontSize:12}}>{c.clearedDate||'—'}</td>
                    <td><span className={checkPill(c.status)}>{c.status}</span></td>
                    <td>
                      <div style={{display:'flex',gap:6}}>
                        <button className="btn btn-ghost btn-sm" onClick={()=>{setEditingCk(c.id);setCkForm({...c});setShowCkModal(true);}}>Edit</button>
                        {c.status==='Issued'  && <button className="btn btn-sm" style={{background:'#dcfce7',color:'#15803d'}} onClick={()=>updateCheckStatus(c.id,'Cleared')}>Clear</button>}
                        {c.status==='Issued'  && <button className="btn btn-sm" style={{background:'#fee2e2',color:'#dc2626'}} onClick={()=>updateCheckStatus(c.id,'Voided')}>Void</button>}
                      </div>
                    </td>
                  </tr>
                ))}</tbody>
              </table>
            )}
          </div>
        </>}

        {tab === 'checkbooks' && (
          <div className="card">
            {checkbooks.length===0 ? <div className="empty">No checkbooks. <span style={{color:'#f97316',cursor:'pointer',fontWeight:700}} onClick={()=>{setEditingCb(null);setCbForm({isActive:true});setShowCbModal(true);}}>Add one →</span></div> : (
              <table>
                <thead><tr><th>Bank</th><th>Starting #</th><th>Ending #</th><th>Next Check #</th><th>Status</th><th>Notes</th><th>Actions</th></tr></thead>
                <tbody>{checkbooks.map(cb=>(
                  <tr key={cb.id}>
                    <td style={{fontWeight:800,color:'#1d4ed8'}}>{cb.bankCode}</td>
                    <td style={{fontFamily:'monospace'}}>{cb.startingNumber}</td>
                    <td style={{fontFamily:'monospace'}}>{cb.endingNumber}</td>
                    <td style={{fontFamily:'monospace',fontWeight:800,color:'#f97316'}}>{cb.nextCheckNumber}</td>
                    <td><span className={`pill ${cb.isActive?'pill-active':'pill-inactive'}`}>{cb.isActive?'Active':'Inactive'}</span></td>
                    <td style={{color:'#94a3b8',fontSize:12}}>{cb.notes}</td>
                    <td><button className="btn btn-ghost btn-sm" onClick={()=>{setEditingCb(cb.id);setCbForm({...cb});setShowCbModal(true);}}>Edit</button></td>
                  </tr>
                ))}</tbody>
              </table>
            )}
          </div>
        )}
      </div>

      {/* Checkbook Modal */}
      {showCbModal && (
        <div className="backdrop" onClick={e=>e.target===e.currentTarget&&setShowCbModal(false)}>
          <div className="modal">
            <div className="modal-h"><strong>{editingCb?'Edit Checkbook':'New Checkbook'}</strong><button className="btn btn-ghost btn-sm" onClick={()=>setShowCbModal(false)}>✕</button></div>
            <div className="modal-b">
              <div className="field"><label>Bank *</label><select value={cbForm.bankCode||''} onChange={e=>setCbForm(f=>({...f,bankCode:e.target.value}))}><option value="">Select</option>{BANK_CODES.map(b=><option key={b}>{b}</option>)}</select></div>
              <div className="field"><label>Starting Number</label><input value={cbForm.startingNumber||''} onChange={e=>setCbForm(f=>({...f,startingNumber:e.target.value}))} /></div>
              <div className="field"><label>Ending Number</label><input value={cbForm.endingNumber||''} onChange={e=>setCbForm(f=>({...f,endingNumber:e.target.value}))} /></div>
              <div className="field"><label>Next Check Number</label><input value={cbForm.nextCheckNumber||''} onChange={e=>setCbForm(f=>({...f,nextCheckNumber:e.target.value}))} /></div>
              <div className="field"><label>Active</label><select value={cbForm.isActive===false?'false':'true'} onChange={e=>setCbForm(f=>({...f,isActive:e.target.value==='true'}))}><option value="true">Yes</option><option value="false">No</option></select></div>
              <div className="field full"><label>Notes</label><textarea rows={2} value={cbForm.notes||''} onChange={e=>setCbForm(f=>({...f,notes:e.target.value}))} /></div>
            </div>
            <div className="modal-f">
              <button className="btn btn-ghost" onClick={()=>setShowCbModal(false)}>Cancel</button>
              <button className="btn btn-primary" onClick={saveCb} disabled={saving}>{saving?'Saving…':editingCb?'Save':'Add Checkbook'}</button>
            </div>
          </div>
        </div>
      )}

      {/* Check Modal */}
      {showCkModal && (
        <div className="backdrop" onClick={e=>e.target===e.currentTarget&&setShowCkModal(false)}>
          <div className="modal">
            <div className="modal-h"><strong>{editingCk?'Edit Check':'Register Check'}</strong><button className="btn btn-ghost btn-sm" onClick={()=>setShowCkModal(false)}>✕</button></div>
            <div className="modal-b">
              <div className="field"><label>Check Number *</label><input value={ckForm.checkNumber||''} onChange={e=>setCkForm(f=>({...f,checkNumber:e.target.value}))} /></div>
              <div className="field"><label>Bank</label><select value={ckForm.bankCode||'UBPBPHM'} onChange={e=>setCkForm(f=>({...f,bankCode:e.target.value}))}>{BANK_CODES.map(b=><option key={b}>{b}</option>)}</select></div>
              <div className="field"><label>Issue Date</label><input type="date" value={ckForm.issueDate||''} onChange={e=>setCkForm(f=>({...f,issueDate:e.target.value}))} /></div>
              <div className="field"><label>Payee Name</label><input value={ckForm.payeeName||''} onChange={e=>setCkForm(f=>({...f,payeeName:e.target.value}))} /></div>
              <div className="field"><label>Amount</label><input type="number" value={ckForm.amount||''} onChange={e=>setCkForm(f=>({...f,amount:e.target.value}))} /></div>
              <div className="field"><label>Status</label><select value={ckForm.status||'Issued'} onChange={e=>setCkForm(f=>({...f,status:e.target.value}))}><option>Issued</option><option>Cleared</option><option>Voided</option><option>Stopped</option></select></div>
              <div className="field"><label>Cleared Date</label><input type="date" value={ckForm.clearedDate||''} onChange={e=>setCkForm(f=>({...f,clearedDate:e.target.value}))} /></div>
              <div className="field"><label>Voided Date</label><input type="date" value={ckForm.voidedDate||''} onChange={e=>setCkForm(f=>({...f,voidedDate:e.target.value}))} /></div>
              <div className="field full"><label>Void Reason</label><input value={ckForm.voidReason||''} onChange={e=>setCkForm(f=>({...f,voidReason:e.target.value}))} /></div>
            </div>
            <div className="modal-f">
              <button className="btn btn-ghost" onClick={()=>setShowCkModal(false)}>Cancel</button>
              <button className="btn btn-primary" onClick={saveCk} disabled={saving}>{saving?'Saving…':editingCk?'Save Changes':'Register'}</button>
            </div>
          </div>
        </div>
      )}
      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}

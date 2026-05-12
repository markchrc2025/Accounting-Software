import { useState, useEffect } from 'react';
import { collection, query, orderBy, onSnapshot, addDoc, updateDoc, doc, serverTimestamp } from 'firebase/firestore';
import { db, auth } from '../../../firebase.js';

const fmt  = (n) => new Intl.NumberFormat('en-PH', { style:'currency', currency:'PHP' }).format(n || 0);
const fmtP = (n) => `${(parseFloat(n)||0).toFixed(2)}%`;
const uid  = () => Math.random().toString(36).slice(2, 10).toUpperCase();

const TAX_TYPES = ['VAT','EWT','Percentage Tax','Documentary Stamp','Others'];

const CSS = `
  .tp-wrap   { display:flex; flex-direction:column; height:100%; overflow:hidden; font-family:Inter,system-ui,sans-serif; }
  .tp-topbar { display:flex; align-items:center; justify-content:space-between; padding:16px 22px 12px; flex-shrink:0; border-bottom:1px solid #e5e7eb; background:#fff; }
  .tp-body   { flex:1; overflow-y:auto; padding:16px 22px; }
  .input     { border:1px solid #e5e7eb; border-radius:10px; padding:9px 12px; font-size:13px; background:#fff; }
  .btn       { border:0; border-radius:10px; padding:9px 16px; font-weight:700; cursor:pointer; font-size:13px; font-family:inherit; }
  .btn-primary { background:#f97316; color:#fff; }
  .btn-ghost   { background:#f1f5f9; color:#0b1220; }
  .btn-ghost:hover { background:#e2e8f0; }
  .btn-sm    { padding:6px 12px; font-size:12px; }
  .tabs      { display:flex; gap:4px; background:#f1f5f9; border-radius:10px; padding:4px; width:fit-content; margin-bottom:14px; }
  .tab       { border:0; background:none; padding:8px 18px; border-radius:8px; font-size:13px; font-weight:700; cursor:pointer; color:#64748b; font-family:inherit; }
  .tab.active { background:#fff; color:#0b1220; box-shadow:0 1px 4px rgba(0,0,0,.1); }
  .toolbar   { display:flex; gap:10px; align-items:center; flex-wrap:wrap; margin-bottom:14px; }
  .card      { background:#fff; border:1px solid #e5e7eb; border-radius:14px; overflow:hidden; }
  table      { width:100%; border-collapse:collapse; }
  th,td      { padding:11px 12px; border-bottom:1px solid #f1f5f9; font-size:13px; text-align:left; }
  th         { color:#64748b; font-weight:800; font-size:11px; letter-spacing:.05em; text-transform:uppercase; background:#f8fafc; }
  tr:hover td { background:#fafafa; }
  tr:last-child td { border-bottom:none; }
  .empty     { padding:48px; text-align:center; color:#94a3b8; }
  .backdrop  { position:fixed; inset:0; background:rgba(15,23,42,.45); display:flex; align-items:center; justify-content:center; padding:16px; z-index:100; }
  .modal     { width:min(580px,98vw); background:#fff; border-radius:16px; overflow:hidden; box-shadow:0 24px 64px rgba(0,0,0,.25); }
  .modal-h   { display:flex; align-items:center; justify-content:space-between; padding:16px 20px; border-bottom:1px solid #e5e7eb; background:#f8fafc; }
  .modal-b   { padding:20px; display:grid; grid-template-columns:1fr 1fr; gap:12px; }
  .modal-f   { display:flex; justify-content:flex-end; gap:10px; padding:14px 20px; border-top:1px solid #e5e7eb; }
  .field     { display:flex; flex-direction:column; gap:5px; }
  .field.full { grid-column:span 2; }
  .field label { font-size:10px; font-weight:800; color:#64748b; letter-spacing:.06em; text-transform:uppercase; }
  .field input,.field select,.field textarea { width:100%; border:1px solid #e5e7eb; border-radius:10px; padding:9px 10px; font-size:13px; background:#fff; font-family:inherit; box-sizing:border-box; }
  .summary-bar { display:grid; grid-template-columns:repeat(3,1fr); gap:12px; margin-bottom:16px; }
  .scard     { background:#fff; border:1px solid #e5e7eb; border-radius:12px; padding:14px 16px; }
  .scard-label { font-size:9px; font-weight:800; color:#94a3b8; letter-spacing:.07em; text-transform:uppercase; margin-bottom:4px; }
  .scard-value { font-size:20px; font-weight:900; }
  .toast { position:fixed; right:16px; bottom:16px; background:#0b1220; color:#fff; padding:12px 18px; border-radius:12px; font-size:13px; font-weight:600; z-index:999; }
`;

export default function TaxPage() {
  const [tab, setTab]       = useState('entries');
  const [entries, setEntries] = useState([]);
  const [rates, setRates]   = useState([]);
  const [filter, setFilter] = useState('All');
  const [period, setPeriod] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [showRateModal, setShowRateModal] = useState(false);
  const [editingE, setEditingE] = useState(null);
  const [editingR, setEditingR] = useState(null);
  const [form, setForm]     = useState({});
  const [rForm, setRForm]   = useState({});
  const [saving, setSaving] = useState(false);
  const [toast, setToast]   = useState('');

  const showToast = (msg) => { setToast(msg); setTimeout(() => setToast(''), 3000); };

  useEffect(() => {
    const unsubE = onSnapshot(query(collection(db,'taxEntries'), orderBy('period','desc')), snap=>setEntries(snap.docs.map(d=>({id:d.id,...d.data()}))));
    const unsubR = onSnapshot(query(collection(db,'taxRates'),   orderBy('taxType')),      snap=>setRates(snap.docs.map(d=>({id:d.id,...d.data()}))));
    return () => { unsubE(); unsubR(); };
  }, []);

  async function saveEntry() {
    if (!form.taxType || !form.period) return alert('Tax type and period are required.');
    setSaving(true);
    try {
      const payload = { ...form, taxBase:parseFloat(form.taxBase)||0, taxAmount:parseFloat(form.taxAmount)||0, amountPaid:parseFloat(form.amountPaid)||0, updatedAt:serverTimestamp() };
      if (editingE) { await updateDoc(doc(db,'taxEntries',editingE), payload); showToast('Entry updated.'); }
      else { await addDoc(collection(db,'taxEntries'), {...payload, createdAt:serverTimestamp(), createdBy:auth.currentUser?.email}); showToast('Entry added.'); }
      setShowModal(false);
    } catch(e) { alert(e.message); }
    setSaving(false);
  }

  async function saveRate() {
    if (!rForm.taxType || !rForm.name) return alert('Tax type and name are required.');
    setSaving(true);
    try {
      const payload = { ...rForm, rate:parseFloat(rForm.rate)||0, updatedAt:serverTimestamp() };
      if (editingR) { await updateDoc(doc(db,'taxRates',editingR), payload); showToast('Rate updated.'); }
      else { await addDoc(collection(db,'taxRates'), {...payload, createdAt:serverTimestamp(), createdBy:auth.currentUser?.email}); showToast('Rate added.'); }
      setShowRateModal(false);
    } catch(e) { alert(e.message); }
    setSaving(false);
  }

  const filtered = entries.filter(e => {
    const mType   = filter==='All' || e.taxType===filter;
    const mPeriod = !period || e.period?.startsWith(period);
    return mType && mPeriod;
  });

  const totalTax  = filtered.reduce((s,e)=>s+(e.taxAmount||0),0);
  const totalPaid = filtered.reduce((s,e)=>s+(e.amountPaid||0),0);

  return (
    <div className="tp-wrap">
      <style>{CSS}</style>
      <div className="tp-topbar">
        <div>
          <h1 style={{ margin:0, fontSize:18, fontWeight:900 }}>Tax</h1>
          <p style={{ margin:0, fontSize:12, color:'#64748b' }}>{entries.length} entries · {rates.length} rates</p>
        </div>
        <div style={{ display:'flex', gap:8 }}>
          <button className="btn btn-ghost" onClick={()=>{setEditingR(null);setRForm({isActive:true});setShowRateModal(true);}}>+ Tax Rate</button>
          <button className="btn btn-primary" onClick={()=>{setEditingE(null);setForm({period:new Date().toISOString().slice(0,7)});setShowModal(true);}}>+ Tax Entry</button>
        </div>
      </div>

      <div className="tp-body">
        <div className="tabs">
          <button className={`tab ${tab==='entries'?'active':''}`} onClick={()=>setTab('entries')}>Tax Entries</button>
          <button className={`tab ${tab==='rates'?'active':''}`} onClick={()=>setTab('rates')}>Tax Rates ({rates.length})</button>
        </div>

        {tab === 'entries' && <>
          <div className="summary-bar">
            <div className="scard"><div className="scard-label">Total Tax Amount</div><div className="scard-value" style={{color:'#dc2626',fontSize:16}}>{fmt(totalTax)}</div></div>
            <div className="scard"><div className="scard-label">Total Paid</div><div className="scard-value" style={{color:'#15803d',fontSize:16}}>{fmt(totalPaid)}</div></div>
            <div className="scard"><div className="scard-label">Balance Due</div><div className="scard-value" style={{color:(totalTax-totalPaid)>0?'#dc2626':'#15803d',fontSize:16}}>{fmt(totalTax-totalPaid)}</div></div>
          </div>
          <div className="toolbar">
            <select className="input" value={filter} onChange={e=>setFilter(e.target.value)}><option value="All">All Types</option>{TAX_TYPES.map(t=><option key={t}>{t}</option>)}</select>
            <input className="input" type="month" value={period} onChange={e=>setPeriod(e.target.value)} style={{width:160}} />
          </div>
          <div className="card">
            {filtered.length===0 ? <div className="empty">No tax entries.</div> : (
              <table>
                <thead><tr><th>Period</th><th>Type</th><th>Description</th><th style={{textAlign:'right'}}>Tax Base</th><th style={{textAlign:'right'}}>Tax Amount</th><th style={{textAlign:'right'}}>Amount Paid</th><th>Due Date</th><th>Status</th><th>Actions</th></tr></thead>
                <tbody>{filtered.map(e=>(
                  <tr key={e.id}>
                    <td style={{fontWeight:700}}>{e.period}</td>
                    <td><span style={{fontWeight:800,fontSize:12,color:'#7c3aed'}}>{e.taxType}</span></td>
                    <td style={{color:'#64748b',fontSize:12}}>{e.description}</td>
                    <td style={{textAlign:'right',color:'#64748b'}}>{fmt(e.taxBase)}</td>
                    <td style={{textAlign:'right',fontWeight:800,color:'#dc2626'}}>{fmt(e.taxAmount)}</td>
                    <td style={{textAlign:'right',fontWeight:800,color:'#15803d'}}>{fmt(e.amountPaid)}</td>
                    <td style={{color:'#94a3b8',fontSize:12}}>{e.dueDate}</td>
                    <td style={{fontSize:12,fontWeight:700,color:(e.amountPaid||0)>=(e.taxAmount||0)?'#15803d':'#dc2626'}}>{(e.amountPaid||0)>=(e.taxAmount||0)?'Paid':'Unpaid'}</td>
                    <td><button className="btn btn-ghost btn-sm" onClick={()=>{setEditingE(e.id);setForm({...e});setShowModal(true);}}>Edit</button></td>
                  </tr>
                ))}</tbody>
              </table>
            )}
          </div>
        </>}

        {tab === 'rates' && (
          <div className="card">
            {rates.length===0 ? <div className="empty">No tax rates. <span style={{color:'#f97316',cursor:'pointer',fontWeight:700}} onClick={()=>{setEditingR(null);setRForm({isActive:true});setShowRateModal(true);}}>Add one →</span></div> : (
              <table>
                <thead><tr><th>Name</th><th>Tax Type</th><th>Rate</th><th>Description</th><th>Active</th><th>Actions</th></tr></thead>
                <tbody>{rates.map(r=>(
                  <tr key={r.id}>
                    <td style={{fontWeight:700}}>{r.name}</td>
                    <td><span style={{fontWeight:800,fontSize:12,color:'#7c3aed'}}>{r.taxType}</span></td>
                    <td style={{fontFamily:'monospace',fontWeight:800,fontSize:13}}>{fmtP(r.rate)}</td>
                    <td style={{color:'#94a3b8',fontSize:12}}>{r.description}</td>
                    <td style={{fontWeight:700,color:r.isActive!==false?'#15803d':'#94a3b8'}}>{r.isActive!==false?'Yes':'No'}</td>
                    <td><button className="btn btn-ghost btn-sm" onClick={()=>{setEditingR(r.id);setRForm({...r});setShowRateModal(true);}}>Edit</button></td>
                  </tr>
                ))}</tbody>
              </table>
            )}
          </div>
        )}
      </div>

      {showModal && (
        <div className="backdrop" onClick={e=>e.target===e.currentTarget&&setShowModal(false)}>
          <div className="modal">
            <div className="modal-h"><strong>{editingE?'Edit Tax Entry':'New Tax Entry'}</strong><button className="btn btn-ghost btn-sm" onClick={()=>setShowModal(false)}>✕</button></div>
            <div className="modal-b">
              <div className="field"><label>Tax Type *</label><select value={form.taxType||''} onChange={e=>setForm(f=>({...f,taxType:e.target.value}))}><option value="">Select</option>{TAX_TYPES.map(t=><option key={t}>{t}</option>)}</select></div>
              <div className="field"><label>Period (YYYY-MM) *</label><input type="month" value={form.period||''} onChange={e=>setForm(f=>({...f,period:e.target.value}))} /></div>
              <div className="field"><label>Tax Base</label><input type="number" value={form.taxBase||''} onChange={e=>setForm(f=>({...f,taxBase:e.target.value}))} /></div>
              <div className="field"><label>Tax Amount</label><input type="number" value={form.taxAmount||''} onChange={e=>setForm(f=>({...f,taxAmount:e.target.value}))} /></div>
              <div className="field"><label>Amount Paid</label><input type="number" value={form.amountPaid||''} onChange={e=>setForm(f=>({...f,amountPaid:e.target.value}))} /></div>
              <div className="field"><label>Due Date</label><input type="date" value={form.dueDate||''} onChange={e=>setForm(f=>({...f,dueDate:e.target.value}))} /></div>
              <div className="field full"><label>Description</label><textarea rows={2} value={form.description||''} onChange={e=>setForm(f=>({...f,description:e.target.value}))} /></div>
            </div>
            <div className="modal-f">
              <button className="btn btn-ghost" onClick={()=>setShowModal(false)}>Cancel</button>
              <button className="btn btn-primary" onClick={saveEntry} disabled={saving}>{saving?'Saving…':editingE?'Save Changes':'Add Entry'}</button>
            </div>
          </div>
        </div>
      )}

      {showRateModal && (
        <div className="backdrop" onClick={e=>e.target===e.currentTarget&&setShowRateModal(false)}>
          <div className="modal">
            <div className="modal-h"><strong>{editingR?'Edit Tax Rate':'New Tax Rate'}</strong><button className="btn btn-ghost btn-sm" onClick={()=>setShowRateModal(false)}>✕</button></div>
            <div className="modal-b">
              <div className="field"><label>Name *</label><input value={rForm.name||''} onChange={e=>setRForm(f=>({...f,name:e.target.value}))} placeholder="e.g. EWT — Professional Services" /></div>
              <div className="field"><label>Tax Type *</label><select value={rForm.taxType||''} onChange={e=>setRForm(f=>({...f,taxType:e.target.value}))}><option value="">Select</option>{TAX_TYPES.map(t=><option key={t}>{t}</option>)}</select></div>
              <div className="field"><label>Rate (%)</label><input type="number" step="0.01" value={rForm.rate||''} onChange={e=>setRForm(f=>({...f,rate:e.target.value}))} placeholder="e.g. 10" /></div>
              <div className="field"><label>Active</label><select value={rForm.isActive===false?'false':'true'} onChange={e=>setRForm(f=>({...f,isActive:e.target.value==='true'}))}><option value="true">Yes</option><option value="false">No</option></select></div>
              <div className="field full"><label>Description</label><textarea rows={2} value={rForm.description||''} onChange={e=>setRForm(f=>({...f,description:e.target.value}))} /></div>
            </div>
            <div className="modal-f">
              <button className="btn btn-ghost" onClick={()=>setShowRateModal(false)}>Cancel</button>
              <button className="btn btn-primary" onClick={saveRate} disabled={saving}>{saving?'Saving…':editingR?'Save Changes':'Add Rate'}</button>
            </div>
          </div>
        </div>
      )}
      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}

import { useState, useEffect } from 'react';
import { collection, query, orderBy, onSnapshot, addDoc, updateDoc, doc, serverTimestamp } from 'firebase/firestore';
import { db, auth } from '../../../firebase.js';

const fmt = (n) => new Intl.NumberFormat('en-PH', { style:'currency', currency:'PHP' }).format(n || 0);

const CATEGORIES = ['Land','Building','Leasehold Improvements','Furniture & Fixtures','Office Equipment','Machinery','Vehicle','Computer Hardware','Software','Others'];
const DEP_METHODS = ['Straight-Line','Double Declining Balance'];
const STATUSES    = ['Active','Disposed','Fully Depreciated','Idle'];

function buildDepSchedule(asset) {
  const cost = parseFloat(asset.acquisitionCost) || 0;
  const salvage = parseFloat(asset.salvageValue) || 0;
  const life = parseInt(asset.usefulLifeYears) || 1;
  const method = asset.depreciationMethod || 'Straight-Line';
  const rows = [];
  let bookValue = cost;
  let accum = 0;
  for (let yr = 1; yr <= Math.min(life, 30); yr++) {
    let dep = 0;
    if (method === 'Straight-Line') {
      dep = (cost - salvage) / life;
    } else {
      const rate = 2 / life;
      dep = bookValue * rate;
    }
    dep = Math.min(dep, bookValue - salvage);
    if (dep <= 0) break;
    accum += dep;
    bookValue -= dep;
    rows.push({ year: yr, depreciation: dep, accumulated: accum, bookValue: Math.max(bookValue, salvage) });
  }
  return rows;
}

const CSS = `
  .fa-wrap   { display:flex; flex-direction:column; height:100%; overflow:hidden; font-family:Inter,system-ui,sans-serif; }
  .fa-topbar { display:flex; align-items:center; justify-content:space-between; padding:16px 22px 12px; flex-shrink:0; border-bottom:1px solid #e5e7eb; background:#fff; }
  .fa-body   { flex:1; overflow-y:auto; padding:16px 22px; }
  .input     { border:1px solid #e5e7eb; border-radius:10px; padding:9px 12px; font-size:13px; background:#fff; }
  .btn       { border:0; border-radius:10px; padding:9px 16px; font-weight:700; cursor:pointer; font-size:13px; font-family:inherit; }
  .btn-primary { background:#f97316; color:#fff; }
  .btn-ghost   { background:#f1f5f9; color:#0b1220; }
  .btn-ghost:hover { background:#e2e8f0; }
  .btn-sm    { padding:6px 12px; font-size:12px; }
  .card      { background:#fff; border:1px solid #e5e7eb; border-radius:14px; overflow:hidden; margin-bottom:12px; }
  .card-head { display:flex; justify-content:space-between; align-items:center; padding:14px 18px; cursor:pointer; }
  .card-head:hover { background:#f8fafc; }
  table      { width:100%; border-collapse:collapse; }
  th,td      { padding:10px 12px; border-bottom:1px solid #f1f5f9; font-size:13px; text-align:left; }
  th         { color:#64748b; font-weight:800; font-size:11px; letter-spacing:.05em; text-transform:uppercase; background:#f8fafc; }
  tr:hover td { background:#fafafa; }
  tr:last-child td { border-bottom:none; }
  .pill      { display:inline-block; padding:2px 9px; border-radius:999px; font-size:11px; font-weight:700; border:1px solid; }
  .pill-active  { background:#f0fdf4; border-color:#bbf7d0; color:#15803d; }
  .pill-disposed { background:#fef2f2; border-color:#fecaca; color:#dc2626; }
  .pill-fully   { background:#eff6ff; border-color:#bfdbfe; color:#1d4ed8; }
  .pill-idle    { background:#fef9c3; border-color:#fde68a; color:#a16207; }
  .summary-bar { display:grid; grid-template-columns:repeat(4,1fr); gap:12px; margin-bottom:16px; }
  .scard     { background:#fff; border:1px solid #e5e7eb; border-radius:12px; padding:14px 16px; }
  .scard-label { font-size:9px; font-weight:800; color:#94a3b8; letter-spacing:.07em; text-transform:uppercase; margin-bottom:4px; }
  .scard-value { font-size:18px; font-weight:900; }
  .empty     { padding:48px; text-align:center; color:#94a3b8; }
  .toolbar   { display:flex; gap:10px; align-items:center; flex-wrap:wrap; margin-bottom:14px; }
  .backdrop  { position:fixed; inset:0; background:rgba(15,23,42,.45); display:flex; align-items:center; justify-content:center; padding:16px; z-index:100; }
  .modal     { width:min(720px,98vw); max-height:92vh; background:#fff; border-radius:16px; display:flex; flex-direction:column; overflow:hidden; box-shadow:0 24px 64px rgba(0,0,0,.25); }
  .modal-h   { display:flex; align-items:center; justify-content:space-between; padding:16px 20px; border-bottom:1px solid #e5e7eb; background:#f8fafc; flex-shrink:0; }
  .modal-b   { padding:20px; overflow-y:auto; flex:1; }
  .modal-f   { display:flex; justify-content:flex-end; gap:10px; padding:14px 20px; border-top:1px solid #e5e7eb; flex-shrink:0; }
  .grid4     { display:grid; grid-template-columns:repeat(4,1fr); gap:10px; margin-bottom:14px; }
  .col2      { grid-column:span 2; }
  .col4      { grid-column:span 4; }
  .field     { display:flex; flex-direction:column; gap:5px; }
  .field label { font-size:10px; font-weight:800; color:#64748b; letter-spacing:.06em; text-transform:uppercase; }
  .field input,.field select { width:100%; border:1px solid #e5e7eb; border-radius:10px; padding:9px 10px; font-size:13px; background:#fff; font-family:inherit; box-sizing:border-box; }
  .toast { position:fixed; right:16px; bottom:16px; background:#0b1220; color:#fff; padding:12px 18px; border-radius:12px; font-size:13px; font-weight:600; z-index:999; }
`;

const assetPill = (s) => {
  const m = { Active:'pill-active', Disposed:'pill-disposed', 'Fully Depreciated':'pill-fully', Idle:'pill-idle' };
  return `pill ${m[s]||'pill-active'}`;
};

export default function FixedAssetsPage() {
  const [assets, setAssets]     = useState([]);
  const [expanded, setExpanded] = useState(new Set());
  const [filter, setFilter]     = useState('All');
  const [catFilter, setCatFilter] = useState('All');
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing]   = useState(null);
  const [form, setForm]         = useState({});
  const [saving, setSaving]     = useState(false);
  const [toast, setToast]       = useState('');

  const showToast = (msg) => { setToast(msg); setTimeout(() => setToast(''), 3000); };

  useEffect(() => {
    const unsub = onSnapshot(query(collection(db,'fixedAssets'), orderBy('acquisitionDate','desc')), snap=>setAssets(snap.docs.map(d=>({id:d.id,...d.data()}))));
    return unsub;
  }, []);

  function toggle(id) { setExpanded(s=>{ const n=new Set(s); n.has(id)?n.delete(id):n.add(id); return n; }); }

  async function save() {
    if (!form.description) return alert('Description is required.');
    setSaving(true);
    try {
      const payload = { ...form, acquisitionCost:parseFloat(form.acquisitionCost)||0, salvageValue:parseFloat(form.salvageValue)||0, usefulLifeYears:parseInt(form.usefulLifeYears)||0, updatedAt:serverTimestamp() };
      if (editing) { await updateDoc(doc(db,'fixedAssets',editing), payload); showToast('Asset updated.'); }
      else { await addDoc(collection(db,'fixedAssets'), {...payload, createdAt:serverTimestamp(), createdBy:auth.currentUser?.email}); showToast('Asset added.'); }
      setShowModal(false);
    } catch(e) { alert(e.message); }
    setSaving(false);
  }

  const filtered = assets.filter(a => {
    const mStatus = filter==='All' || a.status===filter;
    const mCat    = catFilter==='All' || a.category===catFilter;
    return mStatus && mCat;
  });

  const activeAssets = assets.filter(a=>a.status==='Active');
  const totalCost    = activeAssets.reduce((s,a)=>s+(a.acquisitionCost||0),0);
  const totalBV      = activeAssets.reduce((s,a)=>{
    const sched = buildDepSchedule(a);
    return s + (sched.length ? sched[sched.length-1].bookValue : (a.acquisitionCost||0));
  }, 0);

  return (
    <div className="fa-wrap">
      <style>{CSS}</style>
      <div className="fa-topbar">
        <div>
          <h1 style={{ margin:0, fontSize:18, fontWeight:900 }}>Fixed Assets</h1>
          <p style={{ margin:0, fontSize:12, color:'#64748b' }}>{assets.length} asset{assets.length!==1?'s':''} · {activeAssets.length} active</p>
        </div>
        <button className="btn btn-primary" onClick={()=>{setEditing(null);setForm({status:'Active',depreciationMethod:'Straight-Line'});setShowModal(true);}}>+ New Asset</button>
      </div>

      <div className="fa-body">
        <div className="summary-bar">
          <div className="scard"><div className="scard-label">Active Assets</div><div className="scard-value">{activeAssets.length}</div></div>
          <div className="scard"><div className="scard-label">Total Cost</div><div className="scard-value" style={{fontSize:14,color:'#0b1220'}}>{fmt(totalCost)}</div></div>
          <div className="scard"><div className="scard-label">Total Book Value</div><div className="scard-value" style={{fontSize:14,color:'#1d4ed8'}}>{fmt(totalBV)}</div></div>
          <div className="scard"><div className="scard-label">Disposed</div><div className="scard-value">{assets.filter(a=>a.status==='Disposed').length}</div></div>
        </div>

        <div className="toolbar">
          <select className="input" value={filter} onChange={e=>setFilter(e.target.value)}><option value="All">All Statuses</option>{STATUSES.map(s=><option key={s}>{s}</option>)}</select>
          <select className="input" value={catFilter} onChange={e=>setCatFilter(e.target.value)}><option value="All">All Categories</option>{CATEGORIES.map(c=><option key={c}>{c}</option>)}</select>
        </div>

        {filtered.length===0 ? (
          <div className="card"><div className="empty">No assets found.</div></div>
        ) : filtered.map(a => {
          const schedule = expanded.has(a.id) ? buildDepSchedule(a) : [];
          return (
            <div key={a.id} className="card">
              <div className="card-head" onClick={()=>toggle(a.id)}>
                <div style={{ display:'flex', alignItems:'center', gap:14 }}>
                  <span style={{ fontWeight:900 }}>{a.description}</span>
                  <span style={{ fontSize:12, color:'#64748b' }}>{a.category}</span>
                  <span className={assetPill(a.status)}>{a.status}</span>
                </div>
                <div style={{ display:'flex', alignItems:'center', gap:16 }}>
                  <div style={{ textAlign:'right' }}>
                    <div style={{ fontWeight:900, fontSize:13 }}>{fmt(a.acquisitionCost)}</div>
                    <div style={{ fontSize:11, color:'#64748b' }}>{a.usefulLifeYears}yr · {a.depreciationMethod?.slice(0,2)}</div>
                  </div>
                  <button className="btn btn-ghost btn-sm" onClick={e=>{e.stopPropagation();setEditing(a.id);setForm({...a});setShowModal(true);}}>Edit</button>
                  <span style={{ color:'#94a3b8', fontSize:11 }}>{expanded.has(a.id)?'▲':'▼'}</span>
                </div>
              </div>
              {expanded.has(a.id) && (
                <div style={{ padding:'0 0 12px' }}>
                  <div style={{ display:'grid', gridTemplateColumns:'repeat(4,1fr)', gap:14, padding:'12px 16px', borderBottom:'1px solid #f1f5f9', fontSize:12 }}>
                    <div><span style={{color:'#94a3b8'}}>Acquired: </span><strong>{a.acquisitionDate||'—'}</strong></div>
                    <div><span style={{color:'#94a3b8'}}>Cost: </span><strong>{fmt(a.acquisitionCost)}</strong></div>
                    <div><span style={{color:'#94a3b8'}}>Salvage: </span><strong>{fmt(a.salvageValue)}</strong></div>
                    <div><span style={{color:'#94a3b8'}}>Method: </span><strong>{a.depreciationMethod||'—'}</strong></div>
                  </div>
                  <div style={{ padding:'0 16px', overflowX:'auto' }}>
                    <div style={{ fontSize:11, fontWeight:800, color:'#64748b', letterSpacing:'.07em', textTransform:'uppercase', padding:'12px 0 6px' }}>
                      Depreciation Schedule{a.usefulLifeYears>30?' (first 30 years shown)':''}
                    </div>
                    <table>
                      <thead><tr><th>Year</th><th style={{textAlign:'right'}}>Depreciation</th><th style={{textAlign:'right'}}>Accumulated</th><th style={{textAlign:'right'}}>Book Value</th></tr></thead>
                      <tbody>{schedule.map((row,i)=>(
                        <tr key={i}>
                          <td style={{color:'#94a3b8'}}>{row.year}</td>
                          <td style={{textAlign:'right',color:'#dc2626'}}>{fmt(row.depreciation)}</td>
                          <td style={{textAlign:'right',color:'#64748b'}}>{fmt(row.accumulated)}</td>
                          <td style={{textAlign:'right',fontWeight:800}}>{fmt(row.bookValue)}</td>
                        </tr>
                      ))}</tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {showModal && (
        <div className="backdrop" onClick={e=>e.target===e.currentTarget&&setShowModal(false)}>
          <div className="modal">
            <div className="modal-h"><strong>{editing?'Edit Asset':'New Asset'}</strong><button className="btn btn-ghost btn-sm" onClick={()=>setShowModal(false)}>✕</button></div>
            <div className="modal-b">
              <div className="grid4">
                <div className="field col4"><label>Description *</label><input value={form.description||''} onChange={e=>setForm(f=>({...f,description:e.target.value}))} /></div>
                <div className="field col2"><label>Category</label><select value={form.category||''} onChange={e=>setForm(f=>({...f,category:e.target.value}))}><option value="">Select</option>{CATEGORIES.map(c=><option key={c}>{c}</option>)}</select></div>
                <div className="field col2"><label>Status</label><select value={form.status||'Active'} onChange={e=>setForm(f=>({...f,status:e.target.value}))}>{STATUSES.map(s=><option key={s}>{s}</option>)}</select></div>
                <div className="field col2"><label>Acquisition Date</label><input type="date" value={form.acquisitionDate||''} onChange={e=>setForm(f=>({...f,acquisitionDate:e.target.value}))} /></div>
                <div className="field col2"><label>Acquisition Cost</label><input type="number" value={form.acquisitionCost||''} onChange={e=>setForm(f=>({...f,acquisitionCost:e.target.value}))} /></div>
                <div className="field"><label>Useful Life (Years)</label><input type="number" value={form.usefulLifeYears||''} onChange={e=>setForm(f=>({...f,usefulLifeYears:e.target.value}))} /></div>
                <div className="field"><label>Salvage Value</label><input type="number" value={form.salvageValue||''} onChange={e=>setForm(f=>({...f,salvageValue:e.target.value}))} /></div>
                <div className="field col2"><label>Depreciation Method</label><select value={form.depreciationMethod||'Straight-Line'} onChange={e=>setForm(f=>({...f,depreciationMethod:e.target.value}))}>{DEP_METHODS.map(m=><option key={m}>{m}</option>)}</select></div>
                <div className="field col4"><label>Notes</label><input value={form.notes||''} onChange={e=>setForm(f=>({...f,notes:e.target.value}))} /></div>
              </div>
            </div>
            <div className="modal-f">
              <button className="btn btn-ghost" onClick={()=>setShowModal(false)}>Cancel</button>
              <button className="btn btn-primary" onClick={save} disabled={saving}>{saving?'Saving…':editing?'Save Changes':'Add Asset'}</button>
            </div>
          </div>
        </div>
      )}
      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}

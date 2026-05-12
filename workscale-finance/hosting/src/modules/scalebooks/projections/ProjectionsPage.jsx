import { useState, useEffect } from 'react';
import {
  collection, query, orderBy, onSnapshot, addDoc, updateDoc, doc, serverTimestamp
} from 'firebase/firestore';
import { db, auth } from '../../../firebase.js';

const fmt = (n) => new Intl.NumberFormat('en-PH', { style:'currency', currency:'PHP' }).format(n || 0);
const uid = () => Math.random().toString(36).slice(2, 10).toUpperCase();

const BANK_CODES = ['UBPBPHM','BPI','BDO','RCBC','MBTC','CASH'];

const CSS = `
  .wp-wrap   { display:flex; flex-direction:column; height:100%; overflow:hidden; font-family:Inter,system-ui,sans-serif; }
  .wp-topbar { display:flex; align-items:center; justify-content:space-between; padding:16px 22px 12px; flex-shrink:0; border-bottom:1px solid #e5e7eb; background:#fff; }
  .wp-body   { flex:1; overflow-y:auto; padding:16px 22px; }
  .input     { border:1px solid #e5e7eb; border-radius:10px; padding:9px 12px; font-size:13px; background:#fff; }
  .btn       { border:0; border-radius:10px; padding:9px 16px; font-weight:700; cursor:pointer; font-size:13px; font-family:inherit; }
  .btn-primary { background:#f97316; color:#fff; }
  .btn-ghost   { background:#f1f5f9; color:#0b1220; }
  .btn-ghost:hover { background:#e2e8f0; }
  .btn-sm    { padding:6px 12px; font-size:12px; }
  .proj-card { background:#fff; border:1px solid #e5e7eb; border-radius:14px; overflow:hidden; margin-bottom:14px; }
  .proj-head { display:flex; justify-content:space-between; align-items:center; padding:14px 18px; background:#f8fafc; border-bottom:1px solid #e5e7eb; cursor:pointer; }
  .proj-head:hover { background:#f1f5f9; }
  table      { width:100%; border-collapse:collapse; }
  th,td      { padding:10px 12px; border-bottom:1px solid #f1f5f9; font-size:12px; text-align:left; }
  th         { color:#64748b; font-weight:800; font-size:10px; letter-spacing:.05em; text-transform:uppercase; background:#f8fafc; }
  tr:hover td { background:#fafafa; }
  tr:last-child td { border-bottom:none; }
  .section-title { font-size:10px; font-weight:800; color:#94a3b8; letter-spacing:.07em; text-transform:uppercase; padding:10px 14px 6px; background:#fff; }
  .inflow-row td { background:#f0fdf4 !important; }
  .empty     { padding:48px; text-align:center; color:#94a3b8; }
  .backdrop  { position:fixed; inset:0; background:rgba(15,23,42,.45); display:flex; align-items:center; justify-content:center; padding:16px; z-index:100; }
  .modal     { width:min(840px,98vw); max-height:92vh; background:#fff; border-radius:16px; display:flex; flex-direction:column; overflow:hidden; box-shadow:0 24px 64px rgba(0,0,0,.25); }
  .modal-h   { display:flex; align-items:center; justify-content:space-between; padding:16px 20px; border-bottom:1px solid #e5e7eb; background:#f8fafc; }
  .modal-b   { padding:20px; overflow-y:auto; flex:1; }
  .modal-f   { display:flex; justify-content:flex-end; gap:10px; padding:14px 20px; border-top:1px solid #e5e7eb; }
  .grid4     { display:grid; grid-template-columns:repeat(4,1fr); gap:10px; margin-bottom:14px; }
  .col2      { grid-column:span 2; }
  .col4      { grid-column:span 4; }
  .field     { display:flex; flex-direction:column; gap:5px; }
  .field label { font-size:10px; font-weight:800; color:#64748b; letter-spacing:.06em; text-transform:uppercase; }
  .field input,.field select { width:100%; border:1px solid #e5e7eb; border-radius:10px; padding:9px 10px; font-size:13px; background:#fff; font-family:inherit; box-sizing:border-box; }
  .sub-title { font-size:11px; font-weight:800; color:#64748b; letter-spacing:.07em; text-transform:uppercase; margin:16px 0 8px; }
  .lines-tbl th,.lines-tbl td { border-bottom:1px solid #f1f5f9; }
  .lines-tbl td input,.lines-tbl td select { width:100%; border:1px solid #e5e7eb; border-radius:7px; padding:6px 8px; font-size:12px; font-family:inherit; }
  .tfoot-row { display:flex; justify-content:space-between; padding:10px 14px; border-top:2px solid #e5e7eb; background:#f8fafc; font-size:13px; font-weight:700; }
  .toast { position:fixed; right:16px; bottom:16px; background:#0b1220; color:#fff; padding:12px 18px; border-radius:12px; font-size:13px; font-weight:600; z-index:999; }
`;

const EMPTY_LINE    = () => ({ id:uid(), voucherType:'Check Voucher', purpose:'', contact:'', description:'', dueDate:'', bankCode:'UBPBPHM', amount:'', status:'Pending' });
const EMPTY_INFLOW  = () => ({ id:uid(), source:'', description:'', expectedDate:'', bankCode:'UBPBPHM', amount:'' });

export default function ProjectionsPage() {
  const [projections, setProjections] = useState([]);
  const [expanded, setExpanded]       = useState(new Set());
  const [showModal, setShowModal]     = useState(false);
  const [editing, setEditing]         = useState(null);
  const [form, setForm]               = useState({});
  const [lines, setLines]             = useState([EMPTY_LINE()]);
  const [inflows, setInflows]         = useState([EMPTY_INFLOW()]);
  const [saving, setSaving]           = useState(false);
  const [toast, setToast]             = useState('');

  const showToast = (msg) => { setToast(msg); setTimeout(() => setToast(''), 3000); };

  useEffect(() => {
    const unsub = onSnapshot(
      query(collection(db, 'weeklyProjections'), orderBy('createdAt', 'desc')),
      snap => setProjections(snap.docs.map(d => ({ id:d.id, ...d.data() })))
    );
    return unsub;
  }, []);

  function toggle(id) {
    setExpanded(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  }

  function openCreate() {
    setEditing(null);
    const today = new Date();
    const mon = new Date(today); mon.setDate(today.getDate() - today.getDay() + 1);
    const fri = new Date(mon); fri.setDate(mon.getDate() + 4);
    const iso = (d) => d.toISOString().slice(0,10);
    setForm({ projId:'WP-'+new Date().getFullYear()+'-'+uid(), weekCoverage:`${iso(mon)} to ${iso(fri)}`, startDate:iso(mon), endDate:iso(fri) });
    setLines([EMPTY_LINE()]);
    setInflows([EMPTY_INFLOW()]);
    setShowModal(true);
  }
  function openEdit(p) {
    setEditing(p.id);
    setForm({ ...p });
    setLines((p.lines||[EMPTY_LINE()]).map(l=>({...l,id:l.id||uid()})));
    setInflows((p.inflows||[EMPTY_INFLOW()]).map(l=>({...l,id:l.id||uid()})));
    setShowModal(true);
  }

  const setLine = (i, f, v) => setLines(ls => ls.map((r,idx)=>idx===i?{...r,[f]:v}:r));
  const setInflow = (i, f, v) => setInflows(ls => ls.map((r,idx)=>idx===i?{...r,[f]:v}:r));

  const totalOut = lines.reduce((s,l)=>s+(parseFloat(l.amount)||0),0);
  const totalIn  = inflows.reduce((s,l)=>s+(parseFloat(l.amount)||0),0);
  const netCash  = totalIn - totalOut;

  async function handleSave() {
    if (!form.weekCoverage) return alert('Week coverage is required.');
    setSaving(true);
    try {
      const payload = {
        ...form,
        totalAmount: totalOut,
        totalInflows: totalIn,
        lines: lines.map(l=>({...l,amount:parseFloat(l.amount)||0})),
        inflows: inflows.map(l=>({...l,amount:parseFloat(l.amount)||0})),
        updatedAt: serverTimestamp(),
      };
      if (editing) {
        await updateDoc(doc(db,'weeklyProjections',editing), payload);
        showToast('Projection updated.');
      } else {
        await addDoc(collection(db,'weeklyProjections'), {...payload, createdAt:serverTimestamp(), createdBy:auth.currentUser?.email});
        showToast('Projection saved.');
      }
      setShowModal(false);
    } catch(e) { alert(e.message); }
    setSaving(false);
  }

  return (
    <div className="wp-wrap">
      <style>{CSS}</style>
      <div className="wp-topbar">
        <div>
          <h1 style={{ margin:0, fontSize:18, fontWeight:900 }}>Weekly Projections</h1>
          <p style={{ margin:0, fontSize:12, color:'#64748b' }}>{projections.length} projection{projections.length!==1?'s':''}</p>
        </div>
        <button className="btn btn-primary" onClick={openCreate}>+ New Projection</button>
      </div>

      <div className="wp-body">
        {projections.length === 0 ? (
          <div className="proj-card"><div className="empty">No projections yet. <span style={{color:'#f97316',cursor:'pointer',fontWeight:700}} onClick={openCreate}>Create one →</span></div></div>
        ) : projections.map(p => {
          const isOpen = expanded.has(p.id);
          const outAmt = (p.lines||[]).reduce((s,l)=>s+(l.amount||0),0);
          const inAmt  = (p.inflows||[]).reduce((s,l)=>s+(l.amount||0),0);
          return (
            <div key={p.id} className="proj-card">
              <div className="proj-head" onClick={()=>toggle(p.id)}>
                <div style={{ display:'flex', alignItems:'center', gap:14 }}>
                  <span style={{ fontWeight:900, fontFamily:'monospace', fontSize:12, color:'#475569' }}>{p.projId}</span>
                  <span style={{ fontWeight:700, fontSize:14 }}>{p.weekCoverage}</span>
                </div>
                <div style={{ display:'flex', alignItems:'center', gap:18 }}>
                  <span style={{ fontSize:12, color:'#dc2626' }}>Out: {fmt(outAmt)}</span>
                  <span style={{ fontSize:12, color:'#15803d' }}>In: {fmt(inAmt)}</span>
                  <span style={{ fontSize:13, fontWeight:900, color:(inAmt-outAmt)>=0?'#15803d':'#dc2626' }}>Net: {fmt(inAmt-outAmt)}</span>
                  <button className="btn btn-ghost btn-sm" onClick={e=>{e.stopPropagation();openEdit(p);}}>Edit</button>
                  <span style={{ color:'#94a3b8', fontSize:11 }}>{isOpen?'▲':'▼'}</span>
                </div>
              </div>
              {isOpen && (
                <div>
                  {(p.lines||[]).length > 0 && <>
                    <div className="section-title">Disbursements</div>
                    <table>
                      <thead><tr><th>Type</th><th>Purpose</th><th>Contact</th><th>Due Date</th><th>Bank</th><th style={{textAlign:'right'}}>Amount</th><th>Status</th></tr></thead>
                      <tbody>{(p.lines||[]).map((l,i)=>(
                        <tr key={i}><td style={{fontSize:12}}>{l.voucherType}</td><td>{l.purpose}</td><td style={{color:'#64748b'}}>{l.contact}</td><td style={{fontFamily:'monospace',fontSize:11}}>{l.dueDate}</td><td style={{color:'#64748b',fontSize:11}}>{l.bankCode}</td><td style={{textAlign:'right',fontWeight:700}}>{fmt(l.amount)}</td><td style={{color:'#64748b',fontSize:11}}>{l.status}</td></tr>
                      ))}</tbody>
                    </table>
                  </>}
                  {(p.inflows||[]).length > 0 && <>
                    <div className="section-title" style={{color:'#15803d'}}>Expected Inflows</div>
                    <table>
                      <thead><tr><th>Source</th><th>Description</th><th>Expected Date</th><th>Bank</th><th style={{textAlign:'right'}}>Amount</th></tr></thead>
                      <tbody>{(p.inflows||[]).map((l,i)=>(
                        <tr key={i} className="inflow-row"><td style={{fontWeight:700}}>{l.source}</td><td style={{color:'#64748b'}}>{l.description}</td><td style={{fontFamily:'monospace',fontSize:11}}>{l.expectedDate}</td><td style={{color:'#64748b',fontSize:11}}>{l.bankCode}</td><td style={{textAlign:'right',fontWeight:700,color:'#15803d'}}>{fmt(l.amount)}</td></tr>
                      ))}</tbody>
                    </table>
                  </>}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {showModal && (
        <div className="backdrop" onClick={e=>e.target===e.currentTarget&&setShowModal(false)}>
          <div className="modal">
            <div className="modal-h"><strong>{editing?'Edit Projection':'New Weekly Projection'}</strong><button className="btn btn-ghost btn-sm" onClick={()=>setShowModal(false)}>✕</button></div>
            <div className="modal-b">
              <div className="grid4">
                <div className="field col2"><label>Projection ID</label><input value={form.projId||''} onChange={e=>setForm(f=>({...f,projId:e.target.value}))} /></div>
                <div className="field col2"><label>Week Coverage *</label><input value={form.weekCoverage||''} onChange={e=>setForm(f=>({...f,weekCoverage:e.target.value}))} placeholder="e.g. 2024-01-01 to 2024-01-07" /></div>
                <div className="field col2"><label>Start Date</label><input type="date" value={form.startDate||''} onChange={e=>setForm(f=>({...f,startDate:e.target.value}))} /></div>
                <div className="field col2"><label>End Date</label><input type="date" value={form.endDate||''} onChange={e=>setForm(f=>({...f,endDate:e.target.value}))} /></div>
              </div>

              <div className="sub-title">Disbursements</div>
              <div style={{border:'1px solid #e5e7eb',borderRadius:12,overflow:'hidden',marginBottom:14}}>
                <table className="lines-tbl">
                  <thead><tr><th>Type</th><th>Purpose</th><th>Contact</th><th>Due Date</th><th>Bank</th><th>Amount</th><th></th></tr></thead>
                  <tbody>{lines.map((l,i)=>(
                    <tr key={l.id}>
                      <td><select value={l.voucherType} onChange={e=>setLine(i,'voucherType',e.target.value)}><option>Check Voucher</option><option>Cash Voucher</option><option>Journal Voucher</option></select></td>
                      <td><input value={l.purpose} onChange={e=>setLine(i,'purpose',e.target.value)} /></td>
                      <td><input value={l.contact} onChange={e=>setLine(i,'contact',e.target.value)} /></td>
                      <td><input type="date" value={l.dueDate} onChange={e=>setLine(i,'dueDate',e.target.value)} /></td>
                      <td><select value={l.bankCode} onChange={e=>setLine(i,'bankCode',e.target.value)}>{BANK_CODES.map(b=><option key={b}>{b}</option>)}</select></td>
                      <td><input type="number" value={l.amount} onChange={e=>setLine(i,'amount',e.target.value)} style={{textAlign:'right'}} /></td>
                      <td><button onClick={()=>setLines(ls=>ls.filter((_,idx)=>idx!==i))} style={{background:'none',border:'none',color:'#ef4444',cursor:'pointer',fontSize:16}}>×</button></td>
                    </tr>
                  ))}</tbody>
                </table>
                <div style={{padding:'8px 12px'}}><button className="btn btn-ghost btn-sm" onClick={()=>setLines(ls=>[...ls,EMPTY_LINE()])}>+ Add Line</button></div>
                <div className="tfoot-row"><span>Total Out: <strong style={{color:'#dc2626'}}>{fmt(totalOut)}</strong></span></div>
              </div>

              <div className="sub-title" style={{color:'#15803d'}}>Expected Inflows</div>
              <div style={{border:'1px solid #e5e7eb',borderRadius:12,overflow:'hidden'}}>
                <table className="lines-tbl">
                  <thead><tr><th>Source</th><th>Description</th><th>Expected Date</th><th>Bank</th><th>Amount</th><th></th></tr></thead>
                  <tbody>{inflows.map((l,i)=>(
                    <tr key={l.id}>
                      <td><input value={l.source} onChange={e=>setInflow(i,'source',e.target.value)} /></td>
                      <td><input value={l.description} onChange={e=>setInflow(i,'description',e.target.value)} /></td>
                      <td><input type="date" value={l.expectedDate} onChange={e=>setInflow(i,'expectedDate',e.target.value)} /></td>
                      <td><select value={l.bankCode} onChange={e=>setInflow(i,'bankCode',e.target.value)}>{BANK_CODES.map(b=><option key={b}>{b}</option>)}</select></td>
                      <td><input type="number" value={l.amount} onChange={e=>setInflow(i,'amount',e.target.value)} style={{textAlign:'right'}} /></td>
                      <td><button onClick={()=>setInflows(ls=>ls.filter((_,idx)=>idx!==i))} style={{background:'none',border:'none',color:'#ef4444',cursor:'pointer',fontSize:16}}>×</button></td>
                    </tr>
                  ))}</tbody>
                </table>
                <div style={{padding:'8px 12px'}}><button className="btn btn-ghost btn-sm" onClick={()=>setInflows(ls=>[...ls,EMPTY_INFLOW()])}>+ Add Inflow</button></div>
                <div className="tfoot-row">
                  <span>Total In: <strong style={{color:'#15803d'}}>{fmt(totalIn)}</strong></span>
                  <span>Net Cash: <strong style={{color:netCash>=0?'#15803d':'#dc2626'}}>{fmt(netCash)}</strong></span>
                </div>
              </div>
            </div>
            <div className="modal-f">
              <button className="btn btn-ghost" onClick={()=>setShowModal(false)}>Cancel</button>
              <button className="btn btn-primary" onClick={handleSave} disabled={saving}>{saving?'Saving…':editing?'Save Changes':'Save Projection'}</button>
            </div>
          </div>
        </div>
      )}
      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}

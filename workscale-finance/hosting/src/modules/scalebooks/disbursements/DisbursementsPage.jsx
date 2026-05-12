import { useState, useEffect } from 'react';
import {
  collection, query, orderBy, onSnapshot, addDoc, updateDoc, doc,
  serverTimestamp, getDocs, where
} from 'firebase/firestore';
import { db, auth } from '../../../firebase.js';

const fmt = (n) => new Intl.NumberFormat('en-PH', { style:'currency', currency:'PHP' }).format(n || 0);
const uid = () => Math.random().toString(36).slice(2, 10).toUpperCase();

const BANK_CODES = ['UBPBPHM','BPI','BDO','RCBC','MBTC','CASH'];

const CSS = `
  .dp-wrap   { display:flex; flex-direction:column; height:100%; overflow:hidden; font-family:Inter,system-ui,sans-serif; }
  .dp-topbar { display:flex; align-items:center; justify-content:space-between; padding:16px 22px 12px; flex-shrink:0; border-bottom:1px solid #e5e7eb; background:#fff; }
  .dp-body   { flex:1; overflow-y:auto; padding:16px 22px; }
  .input     { border:1px solid #e5e7eb; border-radius:10px; padding:9px 12px; font-size:13px; background:#fff; }
  .btn       { border:0; border-radius:10px; padding:9px 16px; font-weight:700; cursor:pointer; font-size:13px; font-family:inherit; }
  .btn-primary { background:#f97316; color:#fff; }
  .btn-ghost   { background:#f1f5f9; color:#0b1220; }
  .btn-ghost:hover { background:#e2e8f0; }
  .btn-sm    { padding:6px 12px; font-size:12px; }
  .card      { background:#fff; border:1px solid #e5e7eb; border-radius:14px; overflow:hidden; margin-bottom:12px; }
  .card-head { display:flex; justify-content:space-between; align-items:center; padding:13px 18px; background:#f8fafc; border-bottom:1px solid #e5e7eb; cursor:pointer; }
  .card-head:hover { background:#f1f5f9; }
  table      { width:100%; border-collapse:collapse; }
  th,td      { padding:10px 12px; border-bottom:1px solid #f1f5f9; font-size:13px; text-align:left; }
  th         { color:#64748b; font-weight:800; font-size:11px; letter-spacing:.05em; text-transform:uppercase; background:#f8fafc; }
  tr:hover td { background:#fafafa; }
  tr:last-child td { border-bottom:none; }
  .toolbar   { display:flex; gap:10px; align-items:center; flex-wrap:wrap; margin-bottom:14px; }
  .empty     { padding:48px; text-align:center; color:#94a3b8; }
  .backdrop  { position:fixed; inset:0; background:rgba(15,23,42,.45); display:flex; align-items:center; justify-content:center; padding:16px; z-index:100; }
  .modal     { width:min(760px,98vw); max-height:90vh; background:#fff; border-radius:16px; display:flex; flex-direction:column; overflow:hidden; box-shadow:0 24px 64px rgba(0,0,0,.25); }
  .modal-h   { display:flex; align-items:center; justify-content:space-between; padding:16px 20px; border-bottom:1px solid #e5e7eb; background:#f8fafc; }
  .modal-b   { padding:20px; overflow-y:auto; flex:1; }
  .modal-f   { display:flex; justify-content:flex-end; gap:10px; padding:14px 20px; border-top:1px solid #e5e7eb; }
  .grid4     { display:grid; grid-template-columns:repeat(4,1fr); gap:10px; margin-bottom:14px; }
  .col2      { grid-column:span 2; }
  .col4      { grid-column:span 4; }
  .field     { display:flex; flex-direction:column; gap:5px; }
  .field label { font-size:10px; font-weight:800; color:#64748b; letter-spacing:.06em; text-transform:uppercase; }
  .field input,.field select,.field textarea { width:100%; border:1px solid #e5e7eb; border-radius:10px; padding:9px 10px; font-size:13px; background:#fff; font-family:inherit; box-sizing:border-box; }
  .voucher-picker { border:1px solid #e5e7eb; border-radius:12px; overflow:hidden; margin-top:4px; }
  .vp-row { display:flex; align-items:center; gap:10px; padding:9px 12px; border-bottom:1px solid #f1f5f9; font-size:13px; cursor:pointer; }
  .vp-row:last-child { border-bottom:none; }
  .vp-row:hover { background:#f8fafc; }
  .vp-row input[type=checkbox] { accent-color:#f97316; width:14px; height:14px; }
  .toast { position:fixed; right:16px; bottom:16px; background:#0b1220; color:#fff; padding:12px 18px; border-radius:12px; font-size:13px; font-weight:600; z-index:999; }
`;

export default function DisbursementsPage() {
  const [reports, setReports]   = useState([]);
  const [vouchers, setVouchers] = useState([]);
  const [expanded, setExpanded] = useState(new Set());
  const [showModal, setShowModal] = useState(false);
  const [form, setForm]         = useState({});
  const [selected, setSelected] = useState(new Set());
  const [lineData, setLineData] = useState({});
  const [saving, setSaving]     = useState(false);
  const [toast, setToast]       = useState('');

  const showToast = (msg) => { setToast(msg); setTimeout(() => setToast(''), 3000); };

  useEffect(() => {
    const unsubR = onSnapshot(query(collection(db,'disbursementReports'), orderBy('createdAt','desc')), snap => setReports(snap.docs.map(d=>({id:d.id,...d.data()}))));
    getDocs(query(collection(db,'vouchers'), where('status','==','For Disbursement'))).then(snap => setVouchers(snap.docs.map(d=>({id:d.id,...d.data()}))));
    return unsubR;
  }, []);

  function openCreate() {
    setForm({ reportId:'DR-'+new Date().getFullYear()+'-'+uid(), date:new Date().toISOString().slice(0,10), bankCode:'UBPBPHM' });
    setSelected(new Set());
    setLineData({});
    setShowModal(true);
  }

  function toggle(id) { setExpanded(s=>{ const n=new Set(s); n.has(id)?n.delete(id):n.add(id); return n; }); }

  function toggleVoucher(id) {
    setSelected(s => {
      const n = new Set(s);
      if (n.has(id)) { n.delete(id); } else { n.add(id); }
      return n;
    });
  }

  const selectedVouchers = vouchers.filter(v => selected.has(v.id));
  const totalAmount = selectedVouchers.reduce((s,v)=>s+(v.amount||0),0);

  async function handleSave() {
    if (selected.size === 0) return alert('Select at least one voucher.');
    setSaving(true);
    try {
      const lines = selectedVouchers.map(v => ({
        voucherId: v.id,
        number: v.number,
        payee: v.payee,
        amount: v.amount||0,
        bankCode: v.bankCode||form.bankCode,
        checkNumber: lineData[v.id]?.checkNumber||'',
        bankReference: lineData[v.id]?.bankRef||'',
        status: 'Disbursed',
      }));
      await addDoc(collection(db,'disbursementReports'), {
        ...form,
        totalAmount,
        lines,
        voucherIds: Array.from(selected),
        createdAt: serverTimestamp(),
        createdBy: auth.currentUser?.email,
      });
      // Mark vouchers as Paid
      await Promise.all(Array.from(selected).map(id =>
        updateDoc(doc(db,'vouchers',id), { status:'Paid', disbursedAt:serverTimestamp(), updatedAt:serverTimestamp() })
      ));
      showToast('Disbursement report created. Vouchers marked Paid.');
      setShowModal(false);
    } catch(e) { alert(e.message); }
    setSaving(false);
  }

  return (
    <div className="dp-wrap">
      <style>{CSS}</style>
      <div className="dp-topbar">
        <div>
          <h1 style={{ margin:0, fontSize:18, fontWeight:900 }}>Master Disbursements</h1>
          <p style={{ margin:0, fontSize:12, color:'#64748b' }}>{reports.length} disbursement report{reports.length!==1?'s':''}</p>
        </div>
        <button className="btn btn-primary" onClick={openCreate}>+ New Disbursement Run</button>
      </div>

      <div className="dp-body">
        {vouchers.length > 0 && (
          <div style={{ background:'#fff7ed', border:'1px solid #fed7aa', borderRadius:12, padding:'10px 16px', marginBottom:14, fontSize:13, color:'#c2410c', fontWeight:700 }}>
            {vouchers.length} voucher{vouchers.length!==1?'s':''} awaiting disbursement · {fmt(vouchers.reduce((s,v)=>s+(v.amount||0),0))}
          </div>
        )}

        {reports.length === 0 ? (
          <div className="card"><div className="empty">No disbursement reports yet.</div></div>
        ) : reports.map(r => (
          <div key={r.id} className="card">
            <div className="card-head" onClick={()=>toggle(r.id)}>
              <div style={{ display:'flex', alignItems:'center', gap:14 }}>
                <span style={{ fontWeight:900, fontFamily:'monospace', fontSize:12, color:'#475569' }}>{r.reportId}</span>
                <span style={{ fontWeight:700 }}>{r.date}</span>
                <span style={{ color:'#64748b', fontSize:12 }}>{r.bankCode}</span>
              </div>
              <div style={{ display:'flex', alignItems:'center', gap:16 }}>
                <span style={{ fontWeight:900, fontSize:14 }}>{fmt(r.totalAmount)}</span>
                <span style={{ fontSize:12, color:'#64748b' }}>{(r.lines||[]).length} voucher{(r.lines||[]).length!==1?'s':''}</span>
                <span style={{ color:'#94a3b8', fontSize:11 }}>{expanded.has(r.id)?'▲':'▼'}</span>
              </div>
            </div>
            {expanded.has(r.id) && (
              <table>
                <thead><tr><th>Voucher No.</th><th>Payee</th><th>Bank</th><th>Check No.</th><th>Bank Ref.</th><th style={{textAlign:'right'}}>Amount</th><th>Status</th></tr></thead>
                <tbody>{(r.lines||[]).map((l,i)=>(
                  <tr key={i}>
                    <td style={{fontFamily:'monospace',fontSize:11}}>{l.number}</td>
                    <td style={{fontWeight:700}}>{l.payee}</td>
                    <td style={{color:'#64748b',fontSize:12}}>{l.bankCode}</td>
                    <td style={{fontFamily:'monospace',fontSize:12}}>{l.checkNumber}</td>
                    <td style={{fontSize:12,color:'#94a3b8'}}>{l.bankReference}</td>
                    <td style={{textAlign:'right',fontWeight:800}}>{fmt(l.amount)}</td>
                    <td style={{fontSize:12,color:'#15803d',fontWeight:700}}>{l.status}</td>
                  </tr>
                ))}</tbody>
              </table>
            )}
          </div>
        ))}
      </div>

      {showModal && (
        <div className="backdrop" onClick={e=>e.target===e.currentTarget&&setShowModal(false)}>
          <div className="modal">
            <div className="modal-h"><strong>New Disbursement Run</strong><button className="btn btn-ghost btn-sm" onClick={()=>setShowModal(false)}>✕</button></div>
            <div className="modal-b">
              <div className="grid4">
                <div className="field col2"><label>Report ID</label><input value={form.reportId||''} onChange={e=>setForm(f=>({...f,reportId:e.target.value}))} /></div>
                <div className="field"><label>Date</label><input type="date" value={form.date||''} onChange={e=>setForm(f=>({...f,date:e.target.value}))} /></div>
                <div className="field"><label>Default Bank</label>
                  <select value={form.bankCode||'UBPBPHM'} onChange={e=>setForm(f=>({...f,bankCode:e.target.value}))}>
                    {BANK_CODES.map(b=><option key={b}>{b}</option>)}
                  </select>
                </div>
                <div className="field col4"><label>Notes</label><input value={form.notes||''} onChange={e=>setForm(f=>({...f,notes:e.target.value}))} /></div>
              </div>

              <div style={{ fontSize:11, fontWeight:800, color:'#64748b', letterSpacing:'.07em', textTransform:'uppercase', marginBottom:8 }}>Select Vouchers (For Disbursement)</div>
              {vouchers.length === 0 ? (
                <div style={{ padding:20, textAlign:'center', color:'#94a3b8', fontSize:13, background:'#f8fafc', borderRadius:12 }}>No vouchers in "For Disbursement" status.</div>
              ) : (
                <div>
                  <div className="voucher-picker">
                    {vouchers.map(v => (
                      <div key={v.id} className="vp-row" onClick={()=>toggleVoucher(v.id)}>
                        <input type="checkbox" checked={selected.has(v.id)} onChange={()=>toggleVoucher(v.id)} onClick={e=>e.stopPropagation()} />
                        <span style={{fontFamily:'monospace',fontSize:11,color:'#475569',width:140,flexShrink:0}}>{v.number}</span>
                        <span style={{flex:1,fontWeight:700}}>{v.payee}</span>
                        <span style={{color:'#64748b',fontSize:12,marginRight:8}}>{v.bankCode}</span>
                        <span style={{fontWeight:800,color:'#0f172a'}}>{fmt(v.amount)}</span>
                      </div>
                    ))}
                  </div>
                  {selected.size > 0 && (
                    <div style={{ marginTop:14 }}>
                      <div style={{ fontSize:11, fontWeight:800, color:'#64748b', letterSpacing:'.07em', textTransform:'uppercase', marginBottom:8 }}>Check / Reference Numbers</div>
                      {selectedVouchers.map(v => (
                        <div key={v.id} style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:8, marginBottom:8, padding:'10px 14px', background:'#f8fafc', borderRadius:10 }}>
                          <div style={{ fontWeight:700, fontSize:12, alignSelf:'center' }}>{v.number} — {v.payee}</div>
                          <input placeholder="Check Number" value={lineData[v.id]?.checkNumber||''} onChange={e=>setLineData(d=>({...d,[v.id]:{...d[v.id],checkNumber:e.target.value}}))} style={{border:'1px solid #e5e7eb',borderRadius:8,padding:'7px 10px',fontSize:12}} />
                          <input placeholder="Bank Reference" value={lineData[v.id]?.bankRef||''} onChange={e=>setLineData(d=>({...d,[v.id]:{...d[v.id],bankRef:e.target.value}}))} style={{border:'1px solid #e5e7eb',borderRadius:8,padding:'7px 10px',fontSize:12}} />
                        </div>
                      ))}
                    </div>
                  )}
                  <div style={{ textAlign:'right', fontWeight:900, fontSize:15, marginTop:10, color:'#0f172a' }}>
                    Total: {fmt(totalAmount)} ({selected.size} voucher{selected.size!==1?'s':''})
                  </div>
                </div>
              )}
            </div>
            <div className="modal-f">
              <button className="btn btn-ghost" onClick={()=>setShowModal(false)}>Cancel</button>
              <button className="btn btn-primary" onClick={handleSave} disabled={saving||selected.size===0}>{saving?'Processing…':'Post Disbursement'}</button>
            </div>
          </div>
        </div>
      )}
      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}

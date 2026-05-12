import { useState, useEffect } from 'react';
import { collection, query, orderBy, onSnapshot, addDoc, updateDoc, doc, serverTimestamp, where } from 'firebase/firestore';
import { db, auth } from '../../../firebase.js';

const fmt = (n) => new Intl.NumberFormat('en-PH', { style:'currency', currency:'PHP' }).format(n || 0);
const uid = () => Math.random().toString(36).slice(2, 10).toUpperCase();
const STATUSES = ['Open','Partial','Closed','Cancelled'];

const CSS = `
  .si-wrap   { display:flex; flex-direction:column; height:100%; overflow:hidden; font-family:Inter,system-ui,sans-serif; }
  .si-topbar { display:flex; align-items:center; justify-content:space-between; padding:16px 22px 12px; flex-shrink:0; border-bottom:1px solid #e5e7eb; background:#fff; }
  .si-body   { flex:1; overflow-y:auto; padding:16px 22px; }
  .input     { border:1px solid #e5e7eb; border-radius:10px; padding:9px 12px; font-size:13px; background:#fff; }
  .btn       { border:0; border-radius:10px; padding:9px 16px; font-weight:700; cursor:pointer; font-size:13px; font-family:inherit; }
  .btn-primary { background:#f97316; color:#fff; }
  .btn-ghost   { background:#f1f5f9; color:#0b1220; }
  .btn-ghost:hover { background:#e2e8f0; }
  .btn-sm    { padding:6px 12px; font-size:12px; }
  .toolbar   { display:flex; gap:10px; align-items:center; flex-wrap:wrap; margin-bottom:14px; }
  .card      { background:#fff; border:1px solid #e5e7eb; border-radius:14px; overflow:hidden; }
  table      { width:100%; border-collapse:collapse; }
  th,td      { padding:11px 12px; border-bottom:1px solid #f1f5f9; font-size:13px; text-align:left; }
  th         { color:#64748b; font-weight:800; font-size:11px; letter-spacing:.05em; text-transform:uppercase; background:#f8fafc; }
  tr:hover td { background:#fafafa; }
  tr:last-child td { border-bottom:none; }
  .pill      { display:inline-block; padding:2px 9px; border-radius:999px; font-size:11px; font-weight:700; border:1px solid; }
  .pill-open      { background:#eff6ff; border-color:#bfdbfe; color:#1d4ed8; }
  .pill-partial   { background:#fef9c3; border-color:#fde68a; color:#a16207; }
  .pill-closed    { background:#f0fdf4; border-color:#bbf7d0; color:#15803d; }
  .pill-cancelled { background:#f8fafc; border-color:#e2e8f0; color:#94a3b8; }
  .summary-bar { display:grid; grid-template-columns:repeat(4,1fr); gap:12px; margin-bottom:16px; }
  .scard     { background:#fff; border:1px solid #e5e7eb; border-radius:12px; padding:14px 16px; }
  .scard-label { font-size:9px; font-weight:800; color:#94a3b8; letter-spacing:.07em; text-transform:uppercase; margin-bottom:4px; }
  .scard-value { font-size:18px; font-weight:900; }
  .empty     { padding:48px; text-align:center; color:#94a3b8; }
  .backdrop  { position:fixed; inset:0; background:rgba(15,23,42,.45); display:flex; align-items:center; justify-content:center; padding:16px; z-index:100; }
  .modal     { width:min(640px,98vw); background:#fff; border-radius:16px; overflow:hidden; box-shadow:0 24px 64px rgba(0,0,0,.25); }
  .modal-h   { display:flex; align-items:center; justify-content:space-between; padding:16px 20px; border-bottom:1px solid #e5e7eb; background:#f8fafc; }
  .modal-b   { padding:20px; display:grid; grid-template-columns:1fr 1fr; gap:12px; }
  .modal-f   { display:flex; justify-content:flex-end; gap:10px; padding:14px 20px; border-top:1px solid #e5e7eb; }
  .field     { display:flex; flex-direction:column; gap:5px; }
  .field.full { grid-column:span 2; }
  .field label { font-size:10px; font-weight:800; color:#64748b; letter-spacing:.06em; text-transform:uppercase; }
  .field input,.field select,.field textarea { width:100%; border:1px solid #e5e7eb; border-radius:10px; padding:9px 10px; font-size:13px; background:#fff; font-family:inherit; box-sizing:border-box; }
  .toast { position:fixed; right:16px; bottom:16px; background:#0b1220; color:#fff; padding:12px 18px; border-radius:12px; font-size:13px; font-weight:600; z-index:999; }
`;

const siPill = (s) => {
  const m = { Open:'pill-open', Partial:'pill-partial', Closed:'pill-closed', Cancelled:'pill-cancelled' };
  return `pill ${m[s]||'pill-open'}`;
};

export default function ServiceInvoicesPage() {
  const [invoices, setInvoices] = useState([]);
  const [contacts, setContacts] = useState([]);
  const [filter, setFilter]     = useState('All');
  const [search, setSearch]     = useState('');
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing]   = useState(null);
  const [form, setForm]         = useState({});
  const [saving, setSaving]     = useState(false);
  const [toast, setToast]       = useState('');

  const showToast = (msg) => { setToast(msg); setTimeout(() => setToast(''), 3000); };

  useEffect(() => {
    const unsubI = onSnapshot(query(collection(db,'serviceInvoices'), orderBy('siDate','desc')), snap=>setInvoices(snap.docs.map(d=>({id:d.id,...d.data()}))));
    const unsubC = onSnapshot(query(collection(db,'contacts'), where('type','in',['Customer','Other'])), snap=>setContacts(snap.docs.map(d=>({id:d.id,...d.data()}))));
    return () => { unsubI(); unsubC(); };
  }, []);

  async function save() {
    if (!form.contact || !form.siDate || !form.amount) return alert('Contact, date, and amount are required.');
    setSaving(true);
    try {
      const amount = parseFloat(form.amount)||0;
      const applied = parseFloat(form.appliedAmount)||0;
      const balance = amount - applied;
      const status  = applied >= amount ? 'Closed' : applied > 0 ? 'Partial' : form.status||'Open';
      const payload = { ...form, amount, appliedAmount:applied, balance, status, updatedAt:serverTimestamp() };
      if (editing) { await updateDoc(doc(db,'serviceInvoices',editing), payload); showToast('Invoice updated.'); }
      else {
        const siId = 'SI-'+new Date().getFullYear()+'-'+uid();
        await addDoc(collection(db,'serviceInvoices'), {...payload, siId, createdAt:serverTimestamp(), createdBy:auth.currentUser?.email});
        showToast('Invoice created.');
      }
      setShowModal(false);
    } catch(e) { alert(e.message); }
    setSaving(false);
  }

  const filtered = invoices.filter(i => {
    const mStatus = filter==='All' || i.status===filter;
    const mSearch = !search || i.contact?.toLowerCase().includes(search.toLowerCase()) || i.siId?.toLowerCase().includes(search.toLowerCase());
    return mStatus && mSearch;
  });

  const totalBilled   = filtered.reduce((s,i)=>s+(i.amount||0),0);
  const totalApplied  = filtered.reduce((s,i)=>s+(i.appliedAmount||0),0);
  const totalBalance  = totalBilled - totalApplied;

  return (
    <div className="si-wrap">
      <style>{CSS}</style>
      <div className="si-topbar">
        <div>
          <h1 style={{ margin:0, fontSize:18, fontWeight:900 }}>Service Invoices</h1>
          <p style={{ margin:0, fontSize:12, color:'#64748b' }}>{invoices.length} invoice{invoices.length!==1?'s':''}</p>
        </div>
        <button className="btn btn-primary" onClick={()=>{setEditing(null);setForm({status:'Open',siDate:new Date().toISOString().slice(0,10),appliedAmount:0});setShowModal(true);}}>+ New Invoice</button>
      </div>

      <div className="si-body">
        <div className="summary-bar">
          <div className="scard"><div className="scard-label">Total Billed</div><div className="scard-value" style={{fontSize:15}}>{fmt(totalBilled)}</div></div>
          <div className="scard"><div className="scard-label">Total Applied</div><div className="scard-value" style={{fontSize:15,color:'#15803d'}}>{fmt(totalApplied)}</div></div>
          <div className="scard"><div className="scard-label">Total Balance</div><div className="scard-value" style={{fontSize:15,color:totalBalance>0?'#dc2626':'#15803d'}}>{fmt(totalBalance)}</div></div>
          <div className="scard"><div className="scard-label">Open</div><div className="scard-value">{invoices.filter(i=>i.status==='Open').length}</div></div>
        </div>

        <div className="toolbar">
          <input className="input" placeholder="Search by client or SI no…" value={search} onChange={e=>setSearch(e.target.value)} style={{width:240}} />
          <select className="input" value={filter} onChange={e=>setFilter(e.target.value)}><option value="All">All Statuses</option>{STATUSES.map(s=><option key={s}>{s}</option>)}</select>
        </div>

        <div className="card">
          {filtered.length===0 ? <div className="empty">No service invoices.</div> : (
            <table>
              <thead><tr><th>SI No.</th><th>Client</th><th>SI Date</th><th>Due Date</th><th style={{textAlign:'right'}}>Amount</th><th style={{textAlign:'right'}}>Applied</th><th style={{textAlign:'right'}}>Balance</th><th>Status</th><th>Actions</th></tr></thead>
              <tbody>{filtered.map(i=>(
                <tr key={i.id}>
                  <td style={{fontFamily:'monospace',fontWeight:800,fontSize:11,color:'#475569'}}>{i.siId}</td>
                  <td style={{fontWeight:700}}>{i.contact}</td>
                  <td style={{color:'#64748b',fontSize:12}}>{i.siDate}</td>
                  <td style={{color:i.status!=='Closed'&&i.dueDate&&i.dueDate<new Date().toISOString().slice(0,10)?'#dc2626':'#64748b',fontSize:12}}>{i.dueDate||'—'}</td>
                  <td style={{textAlign:'right',fontWeight:800}}>{fmt(i.amount)}</td>
                  <td style={{textAlign:'right',color:'#15803d'}}>{fmt(i.appliedAmount)}</td>
                  <td style={{textAlign:'right',fontWeight:800,color:i.balance>0?'#dc2626':'#15803d'}}>{fmt(i.balance)}</td>
                  <td><span className={siPill(i.status)}>{i.status}</span></td>
                  <td><button className="btn btn-ghost btn-sm" onClick={()=>{setEditing(i.id);setForm({...i});setShowModal(true);}}>Edit</button></td>
                </tr>
              ))}</tbody>
            </table>
          )}
        </div>
      </div>

      {showModal && (
        <div className="backdrop" onClick={e=>e.target===e.currentTarget&&setShowModal(false)}>
          <div className="modal">
            <div className="modal-h"><strong>{editing?'Edit Service Invoice':'New Service Invoice'}</strong><button className="btn btn-ghost btn-sm" onClick={()=>setShowModal(false)}>✕</button></div>
            <div className="modal-b">
              <div className="field full">
                <label>Client *</label>
                <select value={form.contact||''} onChange={e=>setForm(f=>({...f,contact:e.target.value}))}>
                  <option value="">Select client</option>
                  {contacts.map(c=><option key={c.id} value={c.name}>{c.name}</option>)}
                </select>
              </div>
              <div className="field"><label>SI Date *</label><input type="date" value={form.siDate||''} onChange={e=>setForm(f=>({...f,siDate:e.target.value}))} /></div>
              <div className="field"><label>Due Date</label><input type="date" value={form.dueDate||''} onChange={e=>setForm(f=>({...f,dueDate:e.target.value}))} /></div>
              <div className="field"><label>Amount *</label><input type="number" value={form.amount||''} onChange={e=>setForm(f=>({...f,amount:e.target.value}))} /></div>
              <div className="field"><label>Applied Amount</label><input type="number" value={form.appliedAmount||''} onChange={e=>setForm(f=>({...f,appliedAmount:e.target.value}))} /></div>
              <div className="field"><label>Status</label><select value={form.status||'Open'} onChange={e=>setForm(f=>({...f,status:e.target.value}))}>{STATUSES.map(s=><option key={s}>{s}</option>)}</select></div>
              <div className="field"><label>Billing Statement ID</label><input value={form.billingStatementId||''} onChange={e=>setForm(f=>({...f,billingStatementId:e.target.value}))} /></div>
              <div className="field full"><label>Notes</label><textarea rows={2} value={form.notes||''} onChange={e=>setForm(f=>({...f,notes:e.target.value}))} /></div>
            </div>
            <div className="modal-f">
              <button className="btn btn-ghost" onClick={()=>setShowModal(false)}>Cancel</button>
              <button className="btn btn-primary" onClick={save} disabled={saving}>{saving?'Saving…':editing?'Save Changes':'Create Invoice'}</button>
            </div>
          </div>
        </div>
      )}
      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}

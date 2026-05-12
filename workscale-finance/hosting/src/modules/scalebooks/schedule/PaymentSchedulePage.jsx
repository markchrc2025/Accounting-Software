import { useState, useEffect } from 'react';
import {
  collection, query, orderBy, onSnapshot, addDoc, updateDoc, deleteDoc,
  doc, serverTimestamp
} from 'firebase/firestore';
import { db, auth } from '../../../firebase.js';

const fmt = (n) => new Intl.NumberFormat('en-PH', { style:'currency', currency:'PHP' }).format(n || 0);
const uid = () => Math.random().toString(36).slice(2, 10).toUpperCase();

const CATEGORIES  = ['Payroll','Utilities','Rent','Loan','Insurance','Tax','Supplier Payment','Other'];
const FREQUENCIES = ['One-Time','Monthly','Quarterly','Semi-Annual','Annual'];
const BANK_CODES  = ['UBPBPHM','BPI','BDO','RCBC','MBTC','CASH'];

const CSS = `
  .psp-wrap   { display:flex; flex-direction:column; height:100%; overflow:hidden; font-family:Inter,system-ui,sans-serif; }
  .psp-topbar { display:flex; align-items:center; justify-content:space-between; padding:16px 22px 12px; flex-shrink:0; border-bottom:1px solid #e5e7eb; background:#fff; }
  .psp-body   { flex:1; overflow-y:auto; padding:16px 22px; }
  .input      { border:1px solid #e5e7eb; border-radius:10px; padding:9px 12px; font-size:13px; background:#fff; }
  .btn        { border:0; border-radius:10px; padding:9px 16px; font-weight:700; cursor:pointer; font-size:13px; font-family:inherit; }
  .btn-primary { background:#f97316; color:#fff; }
  .btn-ghost   { background:#f1f5f9; color:#0b1220; }
  .btn-ghost:hover { background:#e2e8f0; }
  .btn-danger  { background:#fee2e2; color:#dc2626; }
  .btn-sm      { padding:6px 12px; font-size:12px; }
  .toolbar     { display:flex; gap:10px; align-items:center; flex-wrap:wrap; margin-bottom:14px; }
  .card        { background:#fff; border:1px solid #e5e7eb; border-radius:14px; overflow:hidden; }
  table        { width:100%; border-collapse:collapse; }
  th,td        { padding:11px 12px; border-bottom:1px solid #f1f5f9; font-size:13px; text-align:left; }
  th           { color:#64748b; font-weight:800; font-size:11px; letter-spacing:.05em; text-transform:uppercase; background:#f8fafc; }
  tr:hover td  { background:#fafafa; }
  tr:last-child td { border-bottom:none; }
  .empty       { padding:48px; text-align:center; color:#94a3b8; }
  .pill        { display:inline-block; padding:2px 9px; border-radius:999px; font-size:11px; font-weight:700; border:1px solid; }
  .pill-active    { background:#f0fdf4; border-color:#bbf7d0; color:#15803d; }
  .pill-cancelled { background:#f8fafc; border-color:#e2e8f0; color:#94a3b8; }
  .pill-one-time  { background:#eff6ff; border-color:#bfdbfe; color:#1d4ed8; }
  .pill-recurring { background:#fff7ed; border-color:#fed7aa; color:#c2410c; }
  .freq-badge  { display:inline-block; padding:2px 8px; border-radius:999px; font-size:11px; font-weight:700; background:#f3e8ff; color:#7c3aed; }
  .backdrop    { position:fixed; inset:0; background:rgba(15,23,42,.45); display:flex; align-items:center; justify-content:center; padding:16px; z-index:100; }
  .modal       { width:min(640px,98vw); max-height:90vh; background:#fff; border-radius:16px; display:flex; flex-direction:column; overflow:hidden; box-shadow:0 24px 64px rgba(0,0,0,.25); }
  .modal-h     { display:flex; align-items:center; justify-content:space-between; padding:16px 20px; border-bottom:1px solid #e5e7eb; background:#f8fafc; }
  .modal-b     { padding:20px; overflow-y:auto; flex:1; display:grid; grid-template-columns:1fr 1fr; gap:12px; }
  .modal-f     { display:flex; justify-content:flex-end; gap:10px; padding:14px 20px; border-top:1px solid #e5e7eb; }
  .field       { display:flex; flex-direction:column; gap:5px; }
  .field.full  { grid-column:span 2; }
  .field label { font-size:10px; font-weight:800; color:#64748b; letter-spacing:.06em; text-transform:uppercase; }
  .field input,.field select,.field textarea { width:100%; border:1px solid #e5e7eb; border-radius:10px; padding:9px 10px; font-size:13px; background:#fff; font-family:inherit; box-sizing:border-box; }
  .toast { position:fixed; right:16px; bottom:16px; background:#0b1220; color:#fff; padding:12px 18px; border-radius:12px; font-size:13px; font-weight:600; z-index:999; }
`;

export default function PaymentSchedulePage() {
  const [schedules, setSchedules] = useState([]);
  const [filter, setFilter]       = useState('All');
  const [search, setSearch]       = useState('');
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing]     = useState(null);
  const [form, setForm]           = useState({});
  const [saving, setSaving]       = useState(false);
  const [toast, setToast]         = useState('');

  const showToast = (msg) => { setToast(msg); setTimeout(() => setToast(''), 3000); };

  useEffect(() => {
    const unsub = onSnapshot(
      query(collection(db, 'paymentSchedules'), orderBy('dueDate')),
      snap => setSchedules(snap.docs.map(d => ({ id:d.id, ...d.data() })))
    );
    return unsub;
  }, []);

  function openCreate() {
    setEditing(null);
    setForm({ frequency:'Monthly', bankCode:'UBPBPHM', status:'Active', category:'Supplier Payment', dueDay:1 });
    setShowModal(true);
  }
  function openEdit(s) {
    setEditing(s.id);
    setForm({ ...s });
    setShowModal(true);
  }

  async function handleSave() {
    if (!form.title) return alert('Title is required.');
    if (!form.dueDate && !form.startDate) return alert('Due date or start date is required.');
    setSaving(true);
    try {
      const payload = {
        ...form,
        amount: parseFloat(form.amount) || 0,
        dueDay: parseInt(form.dueDay) || 1,
        updatedAt: serverTimestamp(),
      };
      if (editing) {
        await updateDoc(doc(db, 'paymentSchedules', editing), payload);
        showToast('Schedule updated.');
      } else {
        await addDoc(collection(db, 'paymentSchedules'), { ...payload, createdAt: serverTimestamp(), createdBy: auth.currentUser?.email });
        showToast('Schedule created.');
      }
      setShowModal(false);
    } catch (e) { alert(e.message); }
    setSaving(false);
  }

  async function cancel(id) {
    if (!window.confirm('Cancel this payment schedule?')) return;
    await updateDoc(doc(db, 'paymentSchedules', id), { status:'Cancelled', updatedAt: serverTimestamp() });
    showToast('Schedule cancelled.');
  }

  const filtered = schedules.filter(s => {
    const matchFilter = filter === 'All' || s.status === filter || (filter === 'Recurring' && s.frequency !== 'One-Time') || (filter === 'One-Time' && s.frequency === 'One-Time');
    const matchSearch = !search || [s.title, s.category, s.contactId].some(x => String(x||'').toLowerCase().includes(search.toLowerCase()));
    return matchFilter && matchSearch;
  });

  const totalActive = schedules.filter(s => s.status !== 'Cancelled').reduce((sum, s) => sum + (s.amount||0), 0);

  return (
    <div className="psp-wrap">
      <style>{CSS}</style>
      <div className="psp-topbar">
        <div>
          <h1 style={{ margin:0, fontSize:18, fontWeight:900 }}>Payment Schedule</h1>
          <p style={{ margin:0, fontSize:12, color:'#64748b' }}>{schedules.filter(s=>s.status!=='Cancelled').length} active · {fmt(totalActive)} recurring obligations</p>
        </div>
        <button className="btn btn-primary" onClick={openCreate}>+ New Schedule</button>
      </div>

      <div className="psp-body">
        <div className="toolbar">
          <input className="input" placeholder="Search title, category…" value={search} onChange={e=>setSearch(e.target.value)} style={{width:220}} />
          <select className="input" value={filter} onChange={e=>setFilter(e.target.value)}>
            {['All','Active','Cancelled','Recurring','One-Time'].map(f => <option key={f}>{f}</option>)}
          </select>
        </div>

        <div className="card">
          {filtered.length === 0 ? (
            <div className="empty">No payment schedules. <span style={{color:'#f97316',cursor:'pointer',fontWeight:700}} onClick={openCreate}>Add one →</span></div>
          ) : (
            <table>
              <thead><tr><th>Title</th><th>Category</th><th>Frequency</th><th>Due Date</th><th>Due Day</th><th>Bank</th><th style={{textAlign:'right'}}>Amount</th><th>Status</th><th>Actions</th></tr></thead>
              <tbody>
                {filtered.map(s => (
                  <tr key={s.id} style={{ opacity: s.status==='Cancelled' ? .5 : 1 }}>
                    <td style={{ fontWeight:700 }}>{s.title}</td>
                    <td style={{ color:'#64748b', fontSize:12 }}>{s.category}</td>
                    <td><span className="freq-badge">{s.frequency}</span></td>
                    <td style={{ fontFamily:'monospace', fontSize:12 }}>{s.dueDate || s.startDate}</td>
                    <td style={{ color:'#94a3b8' }}>{s.frequency !== 'One-Time' ? `Day ${s.dueDay||1}` : '—'}</td>
                    <td style={{ fontSize:12, color:'#475569' }}>{s.bankCode}</td>
                    <td style={{ textAlign:'right', fontWeight:800 }}>{fmt(s.amount)}</td>
                    <td><span className={`pill ${s.status==='Active'?'pill-active':'pill-cancelled'}`}>{s.status}</span></td>
                    <td>
                      <div style={{ display:'flex', gap:6 }}>
                        <button className="btn btn-ghost btn-sm" onClick={()=>openEdit(s)}>Edit</button>
                        {s.status !== 'Cancelled' && <button className="btn btn-danger btn-sm" onClick={()=>cancel(s.id)}>Cancel</button>}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {showModal && (
        <div className="backdrop" onClick={e=>e.target===e.currentTarget&&setShowModal(false)}>
          <div className="modal">
            <div className="modal-h"><strong>{editing?'Edit Schedule':'New Payment Schedule'}</strong><button className="btn btn-ghost btn-sm" onClick={()=>setShowModal(false)}>✕</button></div>
            <div className="modal-b">
              <div className="field full"><label>Title *</label><input value={form.title||''} onChange={e=>setForm(f=>({...f,title:e.target.value}))} placeholder="e.g. Monthly Rent — Makati Office" /></div>
              <div className="field"><label>Category</label>
                <select value={form.category||''} onChange={e=>setForm(f=>({...f,category:e.target.value}))}>
                  {CATEGORIES.map(c=><option key={c}>{c}</option>)}
                </select>
              </div>
              <div className="field"><label>Frequency</label>
                <select value={form.frequency||'Monthly'} onChange={e=>setForm(f=>({...f,frequency:e.target.value}))}>
                  {FREQUENCIES.map(c=><option key={c}>{c}</option>)}
                </select>
              </div>
              <div className="field"><label>Amount</label><input type="number" value={form.amount||''} onChange={e=>setForm(f=>({...f,amount:e.target.value}))} placeholder="0.00" /></div>
              <div className="field"><label>Bank / Fund</label>
                <select value={form.bankCode||'UBPBPHM'} onChange={e=>setForm(f=>({...f,bankCode:e.target.value}))}>
                  {BANK_CODES.map(b=><option key={b}>{b}</option>)}
                </select>
              </div>
              {form.frequency === 'One-Time' ? (
                <div className="field"><label>Due Date *</label><input type="date" value={form.dueDate||''} onChange={e=>setForm(f=>({...f,dueDate:e.target.value}))} /></div>
              ) : (
                <>
                  <div className="field"><label>Start Date *</label><input type="date" value={form.startDate||''} onChange={e=>setForm(f=>({...f,startDate:e.target.value}))} /></div>
                  <div className="field"><label>End Date (blank = ongoing)</label><input type="date" value={form.endDate||''} onChange={e=>setForm(f=>({...f,endDate:e.target.value}))} /></div>
                  <div className="field"><label>Due Day of Month</label><input type="number" min={1} max={31} value={form.dueDay||1} onChange={e=>setForm(f=>({...f,dueDay:e.target.value}))} /></div>
                </>
              )}
              <div className="field"><label>Status</label>
                <select value={form.status||'Active'} onChange={e=>setForm(f=>({...f,status:e.target.value}))}>
                  <option>Active</option><option>Cancelled</option>
                </select>
              </div>
              <div className="field full"><label>Notes</label><textarea rows={2} value={form.notes||''} onChange={e=>setForm(f=>({...f,notes:e.target.value}))} /></div>
            </div>
            <div className="modal-f">
              <button className="btn btn-ghost" onClick={()=>setShowModal(false)}>Cancel</button>
              <button className="btn btn-primary" onClick={handleSave} disabled={saving}>{saving?'Saving…':editing?'Save Changes':'Create Schedule'}</button>
            </div>
          </div>
        </div>
      )}
      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}

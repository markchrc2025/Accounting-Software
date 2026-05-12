import { useState, useEffect } from 'react';
import { collection, query, orderBy, onSnapshot, addDoc, updateDoc, doc, serverTimestamp, where, getDocs } from 'firebase/firestore';
import { db, auth } from '../../../firebase.js';

const fmt = (n) => new Intl.NumberFormat('en-PH', { style:'currency', currency:'PHP' }).format(n || 0);

const BANKS = [
  { code:'UBPBPHM', name:'UnionBank', color:'#0052cc' },
  { code:'BPI',     name:'BPI',       color:'#d32f2f' },
  { code:'BDO',     name:'BDO',       color:'#1a6b3a' },
  { code:'RCBC',    name:'RCBC',      color:'#9c1c1c' },
  { code:'MBTC',    name:'Metrobank', color:'#2c5f2e' },
  { code:'CASH',    name:'Petty Cash', color:'#7c3aed' },
];

const CSS = `
  .bp-wrap   { display:flex; flex-direction:column; height:100%; overflow:hidden; font-family:Inter,system-ui,sans-serif; }
  .bp-topbar { display:flex; align-items:center; justify-content:space-between; padding:16px 22px 12px; flex-shrink:0; border-bottom:1px solid #e5e7eb; background:#fff; }
  .bp-body   { flex:1; overflow-y:auto; padding:16px 22px; }
  .input     { border:1px solid #e5e7eb; border-radius:10px; padding:9px 12px; font-size:13px; background:#fff; }
  .btn       { border:0; border-radius:10px; padding:9px 16px; font-weight:700; cursor:pointer; font-size:13px; font-family:inherit; }
  .btn-primary { background:#f97316; color:#fff; }
  .btn-ghost   { background:#f1f5f9; color:#0b1220; }
  .btn-ghost:hover { background:#e2e8f0; }
  .btn-sm    { padding:6px 12px; font-size:12px; }
  .bank-grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(220px,1fr)); gap:12px; margin-bottom:20px; }
  .bank-card { background:#fff; border:1px solid #e5e7eb; border-radius:14px; padding:18px; position:relative; overflow:hidden; }
  .bank-card::before { content:''; position:absolute; top:0; left:0; right:0; height:4px; }
  .card      { background:#fff; border:1px solid #e5e7eb; border-radius:14px; overflow:hidden; }
  table      { width:100%; border-collapse:collapse; }
  th,td      { padding:11px 12px; border-bottom:1px solid #f1f5f9; font-size:13px; text-align:left; }
  th         { color:#64748b; font-weight:800; font-size:11px; letter-spacing:.05em; text-transform:uppercase; background:#f8fafc; }
  tr:hover td { background:#fafafa; }
  tr:last-child td { border-bottom:none; }
  .toolbar   { display:flex; gap:10px; align-items:center; flex-wrap:wrap; margin-bottom:14px; }
  .empty     { padding:48px; text-align:center; color:#94a3b8; font-size:13px; }
  .backdrop  { position:fixed; inset:0; background:rgba(15,23,42,.45); display:flex; align-items:center; justify-content:center; padding:16px; z-index:100; }
  .modal     { width:min(520px,98vw); background:#fff; border-radius:16px; overflow:hidden; box-shadow:0 24px 64px rgba(0,0,0,.25); }
  .modal-h   { display:flex; align-items:center; justify-content:space-between; padding:16px 20px; border-bottom:1px solid #e5e7eb; background:#f8fafc; }
  .modal-b   { padding:20px; display:grid; grid-template-columns:1fr 1fr; gap:12px; }
  .modal-f   { display:flex; justify-content:flex-end; gap:10px; padding:14px 20px; border-top:1px solid #e5e7eb; }
  .field     { display:flex; flex-direction:column; gap:5px; }
  .field.full { grid-column:span 2; }
  .field label { font-size:10px; font-weight:800; color:#64748b; letter-spacing:.06em; text-transform:uppercase; }
  .field input,.field select { width:100%; border:1px solid #e5e7eb; border-radius:10px; padding:9px 10px; font-size:13px; background:#fff; font-family:inherit; box-sizing:border-box; }
  .toast { position:fixed; right:16px; bottom:16px; background:#0b1220; color:#fff; padding:12px 18px; border-radius:12px; font-size:13px; font-weight:600; z-index:999; }
`;

export default function BankPage() {
  const [balances, setBalances] = useState([]);
  const [bankFilter, setBankFilter] = useState('All');
  const [dateFilter, setDateFilter] = useState(new Date().toISOString().slice(0,10));
  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState({});
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState('');

  const showToast = (msg) => { setToast(msg); setTimeout(() => setToast(''), 3000); };

  useEffect(() => {
    const unsub = onSnapshot(
      query(collection(db, 'dailyBankBalances'), orderBy('date', 'desc')),
      snap => setBalances(snap.docs.map(d => ({ id:d.id, ...d.data() })))
    );
    return unsub;
  }, []);

  // Latest balance per bank
  const latestByBank = BANKS.reduce((acc, b) => {
    const rows = balances.filter(r => r.bankCode === b.code);
    if (rows.length) acc[b.code] = rows[0];
    return acc;
  }, {});

  function openNew() {
    setForm({ date: new Date().toISOString().slice(0,10), bankCode: BANKS[0].code, beginning: '', ending: '', notes: '' });
    setShowModal(true);
  }

  async function handleSave() {
    if (!form.bankCode || !form.date) return alert('Bank and date are required.');
    setSaving(true);
    try {
      await addDoc(collection(db, 'dailyBankBalances'), {
        ...form,
        beginning: parseFloat(form.beginning) || 0,
        ending:    parseFloat(form.ending) || 0,
        createdAt: serverTimestamp(),
        createdBy: auth.currentUser?.email,
      });
      showToast('Balance recorded.');
      setShowModal(false);
    } catch (e) { alert(e.message); }
    setSaving(false);
  }

  const filtered = balances.filter(r => {
    const matchBank = bankFilter === 'All' || r.bankCode === bankFilter;
    return matchBank;
  });

  const totalBalance = BANKS.reduce((s, b) => s + (latestByBank[b.code]?.ending || 0), 0);

  return (
    <div className="bp-wrap">
      <style>{CSS}</style>
      <div className="bp-topbar">
        <div>
          <h1 style={{ margin:0, fontSize:18, fontWeight:900 }}>Bank Balances</h1>
          <p style={{ margin:0, fontSize:12, color:'#64748b' }}>Total available: <strong>{fmt(totalBalance)}</strong></p>
        </div>
        <button className="btn btn-primary" onClick={openNew}>+ Record Balance</button>
      </div>

      <div className="bp-body">
        {/* Bank summary cards */}
        <div className="bank-grid">
          {BANKS.map(b => {
            const row = latestByBank[b.code];
            return (
              <div key={b.code} className="bank-card" style={{ borderTopColor: b.color }}>
                <div style={{ position:'absolute', top:0, left:0, right:0, height:4, background:b.color, borderRadius:'14px 14px 0 0' }} />
                <div style={{ fontSize:11, fontWeight:800, color:'#64748b', letterSpacing:'.07em', marginBottom:4 }}>{b.code}</div>
                <div style={{ fontSize:14, fontWeight:700, color:'#0f172a', marginBottom:8 }}>{b.name}</div>
                <div style={{ fontSize:24, fontWeight:900, color: b.color }}>{fmt(row?.ending || 0)}</div>
                {row && <div style={{ fontSize:11, color:'#94a3b8', marginTop:4 }}>As of {row.date}</div>}
              </div>
            );
          })}
        </div>

        <div className="toolbar">
          <select className="input" value={bankFilter} onChange={e=>setBankFilter(e.target.value)}>
            <option value="All">All Banks</option>
            {BANKS.map(b => <option key={b.code} value={b.code}>{b.code} — {b.name}</option>)}
          </select>
        </div>

        <div className="card">
          {filtered.length === 0 ? (
            <div className="empty">No balance records. <span style={{color:'#f97316',cursor:'pointer',fontWeight:700}} onClick={openNew}>Record first entry →</span></div>
          ) : (
            <table>
              <thead><tr><th>Date</th><th>Bank</th><th style={{textAlign:'right'}}>Beginning</th><th style={{textAlign:'right'}}>Ending Balance</th><th>Notes</th><th>By</th></tr></thead>
              <tbody>
                {filtered.map(r => (
                  <tr key={r.id}>
                    <td style={{ fontWeight:700 }}>{r.date}</td>
                    <td><span style={{ fontWeight:800, color: BANKS.find(b=>b.code===r.bankCode)?.color }}>{r.bankCode}</span></td>
                    <td style={{ textAlign:'right', color:'#64748b' }}>{fmt(r.beginning)}</td>
                    <td style={{ textAlign:'right', fontWeight:800, color:'#0f172a' }}>{fmt(r.ending)}</td>
                    <td style={{ color:'#94a3b8', fontSize:12 }}>{r.notes}</td>
                    <td style={{ fontSize:11, color:'#94a3b8' }}>{r.createdBy}</td>
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
            <div className="modal-h"><strong>Record Bank Balance</strong><button className="btn btn-ghost btn-sm" onClick={()=>setShowModal(false)}>✕</button></div>
            <div className="modal-b">
              <div className="field">
                <label>Bank *</label>
                <select value={form.bankCode||''} onChange={e=>setForm(f=>({...f,bankCode:e.target.value}))}>
                  {BANKS.map(b => <option key={b.code} value={b.code}>{b.code} — {b.name}</option>)}
                </select>
              </div>
              <div className="field"><label>Date *</label><input type="date" value={form.date||''} onChange={e=>setForm(f=>({...f,date:e.target.value}))} /></div>
              <div className="field"><label>Beginning Balance</label><input type="number" value={form.beginning||''} onChange={e=>setForm(f=>({...f,beginning:e.target.value}))} placeholder="0.00" /></div>
              <div className="field"><label>Ending Balance *</label><input type="number" value={form.ending||''} onChange={e=>setForm(f=>({...f,ending:e.target.value}))} placeholder="0.00" /></div>
              <div className="field full"><label>Notes</label><input value={form.notes||''} onChange={e=>setForm(f=>({...f,notes:e.target.value}))} placeholder="Optional notes" /></div>
            </div>
            <div className="modal-f">
              <button className="btn btn-ghost" onClick={()=>setShowModal(false)}>Cancel</button>
              <button className="btn btn-primary" onClick={handleSave} disabled={saving}>{saving?'Saving…':'Record Balance'}</button>
            </div>
          </div>
        </div>
      )}
      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}

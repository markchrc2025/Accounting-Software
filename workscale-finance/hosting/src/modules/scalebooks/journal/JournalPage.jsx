import { useState, useEffect } from 'react';
import { collection, query, orderBy, onSnapshot, addDoc, updateDoc, doc, serverTimestamp } from 'firebase/firestore';
import { db, auth } from '../../../firebase.js';

const fmt = (n) => new Intl.NumberFormat('en-PH', { style:'currency', currency:'PHP' }).format(n || 0);
const uid = () => Math.random().toString(36).slice(2, 10).toUpperCase();

const CSS = `
  .jp-wrap   { display:flex; flex-direction:column; height:100%; overflow:hidden; font-family:Inter,system-ui,sans-serif; }
  .jp-topbar { display:flex; align-items:center; justify-content:space-between; padding:16px 22px 12px; flex-shrink:0; border-bottom:1px solid #e5e7eb; background:#fff; }
  .jp-body   { flex:1; overflow-y:auto; padding:16px 22px; }
  .input     { border:1px solid #e5e7eb; border-radius:10px; padding:9px 12px; font-size:13px; background:#fff; }
  .btn       { border:0; border-radius:10px; padding:9px 16px; font-weight:700; cursor:pointer; font-size:13px; font-family:inherit; }
  .btn-primary { background:#f97316; color:#fff; }
  .btn-ghost   { background:#f1f5f9; color:#0b1220; }
  .btn-ghost:hover { background:#e2e8f0; }
  .btn-sm    { padding:6px 12px; font-size:12px; }
  .card      { background:#fff; border:1px solid #e5e7eb; border-radius:14px; overflow:hidden; margin-bottom:12px; }
  .je-header { display:flex; justify-content:space-between; align-items:center; padding:12px 16px; background:#f8fafc; border-bottom:1px solid #e5e7eb; cursor:pointer; }
  .je-header:hover { background:#f1f5f9; }
  .je-body   { overflow:hidden; }
  table      { width:100%; border-collapse:collapse; }
  th,td      { padding:10px 14px; border-bottom:1px solid #f1f5f9; font-size:12px; text-align:left; }
  th         { color:#64748b; font-weight:800; font-size:10px; letter-spacing:.05em; text-transform:uppercase; background:#f8fafc; }
  tr:last-child td { border-bottom:none; }
  .badge-posted     { background:#d1fae5; color:#065f46; border-radius:20px; padding:2px 9px; font-size:10px; font-weight:800; display:inline-block; }
  .badge-draft      { background:#fef3c7; color:#92400e; border-radius:20px; padding:2px 9px; font-size:10px; font-weight:800; display:inline-block; }
  .badge-reversed   { background:#fff7ed; color:#c2410c; border-radius:20px; padding:2px 9px; font-size:10px; font-weight:800; display:inline-block; }
  .empty     { padding:48px; text-align:center; color:#94a3b8; font-size:13px; }
  .toolbar   { display:flex; gap:10px; align-items:center; flex-wrap:wrap; margin-bottom:14px; }
  .stats-bar { display:grid; grid-template-columns:repeat(4,1fr); gap:12px; margin-bottom:16px; }
  .stat      { background:#fff; border:1px solid #e5e7eb; border-radius:12px; padding:12px 16px; }
  .stat-label { font-size:10px; font-weight:800; color:#64748b; letter-spacing:.07em; text-transform:uppercase; margin-bottom:4px; }
  .stat-value { font-size:18px; font-weight:900; color:#0f172a; }
  /* MJE Modal */
  .backdrop { position:fixed; inset:0; background:rgba(15,23,42,.45); display:flex; align-items:center; justify-content:center; padding:16px; z-index:100; }
  .modal    { width:min(900px,98vw); max-height:90vh; background:#fff; border-radius:16px; display:flex; flex-direction:column; overflow:hidden; box-shadow:0 24px 64px rgba(0,0,0,.25); }
  .modal-h  { display:flex; align-items:center; justify-content:space-between; padding:16px 20px; border-bottom:1px solid #e5e7eb; background:#f8fafc; }
  .modal-b  { padding:20px; overflow-y:auto; flex:1; }
  .modal-f  { display:flex; justify-content:flex-end; gap:10px; padding:14px 20px; border-top:1px solid #e5e7eb; }
  .grid6    { display:grid; grid-template-columns:repeat(6,1fr); gap:10px; margin-bottom:14px; }
  .col2 { grid-column:span 2; } .col3 { grid-column:span 3; } .col6 { grid-column:span 6; }
  .field { display:flex; flex-direction:column; gap:5px; }
  .field label { font-size:10px; font-weight:800; color:#64748b; letter-spacing:.06em; text-transform:uppercase; }
  .field input,.field select,.field textarea { width:100%; border:1px solid #e5e7eb; border-radius:10px; padding:9px 10px; font-size:13px; background:#fff; font-family:inherit; box-sizing:border-box; }
  .toast { position:fixed; right:16px; bottom:16px; background:#0b1220; color:#fff; padding:12px 18px; border-radius:12px; font-size:13px; font-weight:600; z-index:999; }
`;

export default function JournalPage() {
  const [entries, setEntries] = useState([]);
  const [expanded, setExpanded] = useState(new Set());
  const [search, setSearch] = useState('');
  const [statusFilter, setStatus] = useState('All');
  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState({});
  const [lines, setLines] = useState([]);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState('');

  const showToast = (msg) => { setToast(msg); setTimeout(() => setToast(''), 3000); };

  useEffect(() => {
    const unsub = onSnapshot(
      query(collection(db, 'journalEntries'), orderBy('createdAt', 'desc')),
      snap => setEntries(snap.docs.map(d => ({ id: d.id, ...d.data() })))
    );
    return unsub;
  }, []);

  function toggleExpand(id) {
    setExpanded(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  }

  function openNew() {
    const jeId = 'JE-' + new Date().getFullYear() + '-' + uid();
    setForm({ jeId, date: new Date().toISOString().slice(0,10), description:'', status:'Draft' });
    setLines([
      { id: uid(), accountCode:'', accountName:'', description:'', debit:'', credit:'' },
      { id: uid(), accountCode:'', accountName:'', description:'', debit:'', credit:'' },
    ]);
    setShowModal(true);
  }

  function addLine() { setLines(l => [...l, { id:uid(), accountCode:'', accountName:'', description:'', debit:'', credit:'' }]); }
  function removeLine(idx) { setLines(l => l.filter((_,i) => i !== idx)); }
  function setLine(idx, field, val) { setLines(l => l.map((r,i) => i === idx ? {...r, [field]:val} : r)); }

  const totalDr = lines.reduce((s,l) => s + (parseFloat(l.debit)||0), 0);
  const totalCr = lines.reduce((s,l) => s + (parseFloat(l.credit)||0), 0);
  const balanced = Math.abs(totalDr - totalCr) < 0.01;

  async function handleSave(post) {
    if (!balanced && post) return alert('Journal entry must be balanced before posting (Debit = Credit).');
    setSaving(true);
    try {
      await addDoc(collection(db, 'journalEntries'), {
        ...form,
        status: post ? 'Posted' : 'Draft',
        totalDebit: totalDr,
        totalCredit: totalCr,
        lines: lines.map(l => ({ ...l, debit: parseFloat(l.debit)||0, credit: parseFloat(l.credit)||0 })),
        createdAt: serverTimestamp(),
        createdBy: auth.currentUser?.email,
      });
      showToast(post ? 'Journal entry posted.' : 'Draft saved.');
      setShowModal(false);
    } catch (e) { alert(e.message); }
    setSaving(false);
  }

  async function handlePost(id) {
    await updateDoc(doc(db, 'journalEntries', id), { status:'Posted', postedAt: serverTimestamp(), postedBy: auth.currentUser?.email });
    showToast('Entry posted.');
  }

  async function handleReverse(id) {
    if (!window.confirm('Reverse this journal entry?')) return;
    await updateDoc(doc(db, 'journalEntries', id), { status:'Reversed', reversedAt: serverTimestamp() });
    showToast('Entry reversed.');
  }

  const filtered = entries.filter(e => {
    const matchStatus = statusFilter === 'All' || e.status === statusFilter;
    const matchSearch = !search || [e.jeId, e.description].some(s => String(s||'').toLowerCase().includes(search.toLowerCase()));
    return matchStatus && matchSearch;
  });

  const postedDr = entries.filter(e => e.status === 'Posted').reduce((s,e) => s+(e.totalDebit||0), 0);
  const draftCount = entries.filter(e => e.status === 'Draft').length;

  return (
    <div className="jp-wrap">
      <style>{CSS}</style>
      <div className="jp-topbar">
        <div>
          <h1 style={{ margin:0, fontSize:18, fontWeight:900 }}>Journal</h1>
          <p style={{ margin:0, fontSize:12, color:'#64748b' }}>{entries.length} entries · {entries.filter(e=>e.status==='Posted').length} posted</p>
        </div>
        <button className="btn btn-primary" onClick={openNew}>+ New Journal Entry</button>
      </div>

      <div className="jp-body">
        <div className="stats-bar">
          <div className="stat"><div className="stat-label">Total Entries</div><div className="stat-value">{entries.length}</div></div>
          <div className="stat"><div className="stat-label">Posted</div><div className="stat-value" style={{color:'#15803d'}}>{entries.filter(e=>e.status==='Posted').length}</div></div>
          <div className="stat"><div className="stat-label">Drafts</div><div className="stat-value" style={{color:'#b45309'}}>{draftCount}</div></div>
          <div className="stat"><div className="stat-label">Posted Debits</div><div className="stat-value" style={{color:'#1d4ed8', fontSize:14}}>{fmt(postedDr)}</div></div>
        </div>

        <div className="toolbar">
          <input className="input" placeholder="Search JE ID, description…" value={search} onChange={e => setSearch(e.target.value)} style={{ width:260 }} />
          <select className="input" value={statusFilter} onChange={e => setStatus(e.target.value)}>
            {['All','Draft','Posted','Reversed'].map(s => <option key={s}>{s}</option>)}
          </select>
        </div>

        {filtered.length === 0 ? (
          <div className="card"><div className="empty">No journal entries yet. <span style={{color:'#f97316',cursor:'pointer',fontWeight:700}} onClick={openNew}>Create one →</span></div></div>
        ) : filtered.map(e => (
          <div key={e.id} className="card">
            <div className="je-header" onClick={() => toggleExpand(e.id)}>
              <div style={{ display:'flex', alignItems:'center', gap:12, flexWrap:'wrap' }}>
                <span style={{ fontWeight:900, fontSize:14, color:'#0b1220' }}>{e.jeId}</span>
                <span style={{ fontSize:12, color:'#64748b' }}>{e.date}</span>
                <span style={{ fontSize:12, color:'#475569' }}>{e.description}</span>
              </div>
              <div style={{ display:'flex', alignItems:'center', gap:12 }}>
                <span style={{ fontWeight:800, fontSize:13, color:'#188038' }}>DR {fmt(e.totalDebit)}</span>
                <span className={`badge-${(e.status||'draft').toLowerCase()}`}>{e.status}</span>
                {e.status === 'Draft' && <button className="btn btn-ghost btn-sm" onClick={ev => { ev.stopPropagation(); handlePost(e.id); }}>Post</button>}
                {e.status === 'Posted' && <button className="btn btn-sm btn-ghost" style={{color:'#dc2626'}} onClick={ev => { ev.stopPropagation(); handleReverse(e.id); }}>Reverse</button>}
                <span style={{ fontSize:11, color:'#94a3b8' }}>{expanded.has(e.id) ? '▲' : '▼'}</span>
              </div>
            </div>
            {expanded.has(e.id) && (
              <div className="je-body">
                <table>
                  <thead><tr><th>Account</th><th>Description</th><th style={{textAlign:'right'}}>Debit</th><th style={{textAlign:'right'}}>Credit</th></tr></thead>
                  <tbody>
                    {(e.lines||[]).map((l, i) => (
                      <tr key={i}>
                        <td style={{ fontFamily:'monospace', fontSize:11 }}>{l.accountCode ? `${l.accountCode} - ` : ''}{l.accountName}</td>
                        <td style={{ color:'#64748b' }}>{l.description}</td>
                        <td style={{ textAlign:'right', fontWeight:700, color:'#188038' }}>{l.debit > 0 ? fmt(l.debit) : ''}</td>
                        <td style={{ textAlign:'right', fontWeight:700, color:'#1d4ed8' }}>{l.credit > 0 ? fmt(l.credit) : ''}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr>
                      <td colSpan={2} style={{ fontWeight:800, textAlign:'right', padding:'10px 14px', borderTop:'2px solid #e5e7eb' }}>Totals</td>
                      <td style={{ textAlign:'right', fontWeight:900, borderTop:'2px solid #e5e7eb', color:'#188038' }}>{fmt(e.totalDebit)}</td>
                      <td style={{ textAlign:'right', fontWeight:900, borderTop:'2px solid #e5e7eb', color:'#1d4ed8' }}>{fmt(e.totalCredit)}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Manual JE Modal */}
      {showModal && (
        <div className="backdrop" onClick={e => e.target === e.currentTarget && setShowModal(false)}>
          <div className="modal">
            <div className="modal-h">
              <strong>New Journal Entry</strong>
              <button className="btn btn-ghost btn-sm" onClick={() => setShowModal(false)}>✕</button>
            </div>
            <div className="modal-b">
              <div className="grid6">
                <div className="field col2"><label>JE ID</label><input value={form.jeId||''} onChange={e => setForm(f=>({...f,jeId:e.target.value}))} /></div>
                <div className="field col2"><label>Date</label><input type="date" value={form.date||''} onChange={e => setForm(f=>({...f,date:e.target.value}))} /></div>
                <div className="field col6"><label>Description / Memo</label><textarea rows={2} value={form.description||''} onChange={e => setForm(f=>({...f,description:e.target.value}))} /></div>
              </div>

              <div style={{ border:'1px solid #e5e7eb', borderRadius:12, overflow:'hidden' }}>
                <table>
                  <thead><tr><th style={{width:180}}>Account</th><th>Description</th><th style={{width:120, textAlign:'right'}}>Debit</th><th style={{width:120, textAlign:'right'}}>Credit</th><th style={{width:36}}></th></tr></thead>
                  <tbody>
                    {lines.map((l,i) => (
                      <tr key={l.id}>
                        <td><input value={l.accountName||''} onChange={e => setLine(i,'accountName',e.target.value)} placeholder="Account name" style={{border:'1px solid #e5e7eb',borderRadius:8,padding:'7px 8px',fontSize:12,width:'100%',boxSizing:'border-box'}} /></td>
                        <td><input value={l.description||''} onChange={e => setLine(i,'description',e.target.value)} style={{border:'1px solid #e5e7eb',borderRadius:8,padding:'7px 8px',fontSize:12,width:'100%',boxSizing:'border-box'}} /></td>
                        <td><input type="number" value={l.debit||''} onChange={e => setLine(i,'debit',e.target.value)} style={{border:'1px solid #e5e7eb',borderRadius:8,padding:'7px 8px',fontSize:12,width:'100%',textAlign:'right',boxSizing:'border-box'}} /></td>
                        <td><input type="number" value={l.credit||''} onChange={e => setLine(i,'credit',e.target.value)} style={{border:'1px solid #e5e7eb',borderRadius:8,padding:'7px 8px',fontSize:12,width:'100%',textAlign:'right',boxSizing:'border-box'}} /></td>
                        <td><button onClick={()=>removeLine(i)} style={{background:'none',border:'none',color:'#ef4444',cursor:'pointer',fontSize:16}}>×</button></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <div style={{padding:'8px 12px'}}><button className="btn btn-ghost btn-sm" onClick={addLine}>+ Add Line</button></div>
                <div style={{display:'flex',justifyContent:'flex-end',gap:20,padding:'12px 16px',borderTop:'2px solid #e5e7eb',background:'#f8fafc',fontSize:13,fontWeight:700}}>
                  <span style={{color:'#188038'}}>DR: {fmt(totalDr)}</span>
                  <span style={{color:'#1d4ed8'}}>CR: {fmt(totalCr)}</span>
                  <span style={{color: balanced ? '#15803d' : '#dc2626', fontWeight:900}}>{balanced ? '✓ Balanced' : '✗ Unbalanced'}</span>
                </div>
              </div>
            </div>
            <div className="modal-f">
              <button className="btn btn-ghost" onClick={() => setShowModal(false)}>Cancel</button>
              <button className="btn btn-ghost" onClick={() => handleSave(false)} disabled={saving}>Save Draft</button>
              <button className="btn btn-primary" onClick={() => handleSave(true)} disabled={saving || !balanced}>Post Entry</button>
            </div>
          </div>
        </div>
      )}
      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}

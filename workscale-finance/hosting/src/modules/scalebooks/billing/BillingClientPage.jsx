import { useState, useEffect } from 'react';
import {
  collection, query, where, orderBy, onSnapshot,
  addDoc, updateDoc, doc, serverTimestamp, getDoc
} from 'firebase/firestore';
import { useParams, useNavigate } from 'react-router-dom';
import { db, auth } from '../../../firebase.js';

const fmt = (n) => new Intl.NumberFormat('en-PH', { style:'currency', currency:'PHP' }).format(n || 0);
const uid = () => Math.random().toString(36).slice(2, 10).toUpperCase();

const CSS = `
  .bcp-wrap   { display:flex; flex-direction:column; height:100%; overflow:hidden; font-family:Inter,system-ui,sans-serif; }
  .bcp-topbar { display:flex; align-items:center; justify-content:space-between; padding:14px 22px; flex-shrink:0; border-bottom:1px solid #e5e7eb; background:#fff; }
  .bcp-body   { flex:1; overflow-y:auto; padding:16px 22px; }
  .input      { border:1px solid #e5e7eb; border-radius:10px; padding:9px 12px; font-size:13px; background:#fff; }
  .btn        { border:0; border-radius:10px; padding:9px 16px; font-weight:700; cursor:pointer; font-size:13px; font-family:inherit; }
  .btn-primary { background:#f97316; color:#fff; }
  .btn-success { background:#22c55e; color:#fff; }
  .btn-ghost   { background:#f1f5f9; color:#0b1220; }
  .btn-ghost:hover { background:#e2e8f0; }
  .btn-sm     { padding:6px 12px; font-size:12px; }
  .tabs       { display:flex; gap:4px; background:#f1f5f9; border-radius:10px; padding:4px; margin-bottom:16px; }
  .tab        { border:0; background:none; padding:8px 18px; border-radius:8px; font-size:13px; font-weight:700; cursor:pointer; color:#64748b; font-family:inherit; }
  .tab.active { background:#fff; color:#0b1220; box-shadow:0 1px 4px rgba(0,0,0,.1); }
  .summary-bar { display:grid; grid-template-columns:repeat(4,1fr); gap:12px; margin-bottom:16px; }
  .scard      { background:#fff; border:1px solid #e5e7eb; border-radius:12px; padding:14px 16px; }
  .scard-label { font-size:9px; font-weight:800; color:#94a3b8; letter-spacing:.07em; text-transform:uppercase; margin-bottom:4px; }
  .scard-value { font-size:20px; font-weight:900; }
  .card       { background:#fff; border:1px solid #e5e7eb; border-radius:14px; overflow:hidden; }
  table       { width:100%; border-collapse:collapse; }
  th,td       { padding:10px 12px; border-bottom:1px solid #f1f5f9; font-size:13px; text-align:left; }
  th          { color:#64748b; font-weight:800; font-size:11px; letter-spacing:.05em; text-transform:uppercase; background:#f8fafc; }
  tr:hover td { background:#fafafa; }
  tr:last-child td { border-bottom:none; }
  .pill       { display:inline-block; padding:2px 9px; border-radius:999px; font-size:11px; font-weight:700; border:1px solid; }
  .pill-paid  { background:#f0fdf4; border-color:#bbf7d0; color:#15803d; }
  .pill-partial { background:#fffbeb; border-color:#fde68a; color:#92400e; }
  .pill-unpaid  { background:#fef2f2; border-color:#fecaca; color:#dc2626; }
  .pill-draft   { background:#f8fafc; border-color:#e2e8f0; color:#64748b; }
  .empty      { padding:48px; text-align:center; color:#94a3b8; }
  .backdrop   { position:fixed; inset:0; background:rgba(15,23,42,.45); display:flex; align-items:center; justify-content:center; padding:16px; z-index:100; }
  .modal      { width:min(640px,98vw); background:#fff; border-radius:16px; overflow:hidden; box-shadow:0 24px 64px rgba(0,0,0,.25); }
  .modal-h    { display:flex; align-items:center; justify-content:space-between; padding:16px 20px; border-bottom:1px solid #e5e7eb; background:#f8fafc; }
  .modal-b    { padding:20px; display:grid; grid-template-columns:1fr 1fr; gap:12px; }
  .modal-f    { display:flex; justify-content:flex-end; gap:10px; padding:14px 20px; border-top:1px solid #e5e7eb; }
  .field      { display:flex; flex-direction:column; gap:5px; }
  .field.full { grid-column:span 2; }
  .field label { font-size:10px; font-weight:800; color:#64748b; letter-spacing:.06em; text-transform:uppercase; }
  .field input,.field select,.field textarea { width:100%; border:1px solid #e5e7eb; border-radius:10px; padding:9px 10px; font-size:13px; background:#fff; font-family:inherit; box-sizing:border-box; }
  .computed-field { background:#f8fafc; border-radius:10px; padding:12px; font-size:14px; font-weight:700; color:#0f172a; }
  .toast { position:fixed; right:16px; bottom:16px; background:#0b1220; color:#fff; padding:12px 18px; border-radius:12px; font-size:13px; font-weight:600; z-index:999; }
`;

function computeBilling(gross) {
  const g = parseFloat(gross) || 0;
  const vat = g * 0.12;
  const ewt = g * 0.02;
  const netVat = g + vat;
  const netDue = netVat - ewt;
  return { gross:g, vat, ewt, netVat, netDue };
}

export default function BillingClientPage() {
  const { clientId } = useParams();
  const navigate = useNavigate();
  const [book, setBook]       = useState(null);
  const [statements, setStatements] = useState([]);
  const [collections, setCollections] = useState([]);
  const [tab, setTab]         = useState('statements');
  const [showStmtModal, setShowStmtModal] = useState(false);
  const [showColModal,  setShowColModal]  = useState(false);
  const [stmtForm, setStmtForm] = useState({});
  const [colForm, setColForm]   = useState({});
  const [saving, setSaving]   = useState(false);
  const [toast, setToast]     = useState('');

  const showToast = (msg) => { setToast(msg); setTimeout(() => setToast(''), 3000); };

  useEffect(() => {
    getDoc(doc(db, 'billingBooks', clientId)).then(d => {
      if (d.exists()) setBook({ id:d.id, ...d.data() });
    });
    const unsubS = onSnapshot(
      query(collection(db, 'billingStatements'), where('bookId','==',clientId), orderBy('period','desc')),
      snap => setStatements(snap.docs.map(d => ({ id:d.id, ...d.data() })))
    );
    const unsubC = onSnapshot(
      query(collection(db, 'collections'), where('bookId','==',clientId), orderBy('date','desc')),
      snap => setCollections(snap.docs.map(d => ({ id:d.id, ...d.data() })))
    );
    return () => { unsubS(); unsubC(); };
  }, [clientId]);

  const totalBilled    = statements.reduce((s,st) => s + (st.netDue||0), 0);
  const totalCollected = collections.reduce((s,c)  => s + (c.amount||0), 0);
  const balance        = totalBilled - totalCollected;

  function openNewStatement() {
    setStmtForm({ period: new Date().toISOString().slice(0,7), gross: '' });
    setShowStmtModal(true);
  }
  function openNewCollection() {
    setColForm({ date: new Date().toISOString().slice(0,10), amount:'', orNumber:'', paymentMode:'Check' });
    setShowColModal(true);
  }

  const computed = computeBilling(stmtForm.gross);

  async function handleSaveStatement() {
    if (!stmtForm.period) return alert('Period is required.');
    const c = computeBilling(stmtForm.gross);
    setSaving(true);
    try {
      await addDoc(collection(db, 'billingStatements'), {
        bookId: clientId,
        clientName: book?.contactName,
        period: stmtForm.period,
        description: stmtForm.description || '',
        gross: c.gross,
        vat:   c.vat,
        ewt:   c.ewt,
        netVat: c.netVat,
        netDue: c.netDue,
        status: 'Unpaid',
        createdAt: serverTimestamp(),
        createdBy: auth.currentUser?.email,
      });
      // Update book totals
      await updateDoc(doc(db, 'billingBooks', clientId), {
        totalBilled: (book?.totalBilled||0) + c.netDue,
        updatedAt: serverTimestamp(),
      });
      showToast('Billing statement created.');
      setShowStmtModal(false);
    } catch (e) { alert(e.message); }
    setSaving(false);
  }

  async function handleSaveCollection() {
    if (!colForm.amount) return alert('Amount is required.');
    const amt = parseFloat(colForm.amount)||0;
    setSaving(true);
    try {
      await addDoc(collection(db, 'collections'), {
        bookId: clientId,
        clientName: book?.contactName,
        date: colForm.date,
        amount: amt,
        orNumber: colForm.orNumber||'',
        paymentMode: colForm.paymentMode||'Check',
        notes: colForm.notes||'',
        createdAt: serverTimestamp(),
        createdBy: auth.currentUser?.email,
      });
      await updateDoc(doc(db, 'billingBooks', clientId), {
        totalCollected: (book?.totalCollected||0) + amt,
        updatedAt: serverTimestamp(),
      });
      showToast('Collection recorded.');
      setShowColModal(false);
    } catch (e) { alert(e.message); }
    setSaving(false);
  }

  async function markPaid(stmtId) {
    await updateDoc(doc(db, 'billingStatements', stmtId), { status:'Paid', paidAt: serverTimestamp() });
    showToast('Marked as paid.');
  }

  const stmtPill = (s) => {
    if (s==='Paid') return 'pill pill-paid';
    if (s==='Partial') return 'pill pill-partial';
    if (s==='Draft') return 'pill pill-draft';
    return 'pill pill-unpaid';
  };

  if (!book) return <div style={{ padding:40, textAlign:'center', color:'#94a3b8' }}>Loading…</div>;

  return (
    <div className="bcp-wrap">
      <style>{CSS}</style>
      <div className="bcp-topbar">
        <div style={{ display:'flex', alignItems:'center', gap:12 }}>
          <button className="btn btn-ghost btn-sm" onClick={() => navigate('/scalebooks/billing')}>← Back</button>
          <div>
            <h1 style={{ margin:0, fontSize:17, fontWeight:900 }}>{book.contactName}</h1>
            <p style={{ margin:0, fontSize:11, color:'#94a3b8' }}>{book.tin}{book.businessStyle ? ` · ${book.businessStyle}` : ''}</p>
          </div>
        </div>
        <div style={{ display:'flex', gap:8 }}>
          <button className="btn btn-ghost btn-sm" onClick={openNewCollection}>+ Record Collection</button>
          <button className="btn btn-primary btn-sm" onClick={openNewStatement}>+ New Statement</button>
        </div>
      </div>

      <div className="bcp-body">
        <div className="summary-bar">
          <div className="scard"><div className="scard-label">Total Billed</div><div className="scard-value" style={{color:'#1d4ed8',fontSize:16}}>{fmt(totalBilled)}</div></div>
          <div className="scard"><div className="scard-label">Collected</div><div className="scard-value" style={{color:'#15803d',fontSize:16}}>{fmt(totalCollected)}</div></div>
          <div className="scard"><div className="scard-label">Outstanding</div><div className="scard-value" style={{color:balance>0?'#dc2626':'#15803d',fontSize:16}}>{fmt(balance)}</div></div>
          <div className="scard"><div className="scard-label">Statements</div><div className="scard-value">{statements.length}</div></div>
        </div>

        <div className="tabs">
          <button className={`tab ${tab==='statements'?'active':''}`} onClick={() => setTab('statements')}>Billing Statements ({statements.length})</button>
          <button className={`tab ${tab==='collections'?'active':''}`} onClick={() => setTab('collections')}>Collections ({collections.length})</button>
        </div>

        {tab === 'statements' && (
          <div className="card">
            {statements.length === 0 ? (
              <div className="empty"><p>No statements yet.</p><button className="btn btn-primary btn-sm" onClick={openNewStatement}>Create First Statement</button></div>
            ) : (
              <table>
                <thead><tr><th>Period</th><th>Description</th><th style={{textAlign:'right'}}>Gross</th><th style={{textAlign:'right'}}>VAT</th><th style={{textAlign:'right'}}>EWT</th><th style={{textAlign:'right'}}>Net Due</th><th>Status</th><th>Actions</th></tr></thead>
                <tbody>
                  {statements.map(s => (
                    <tr key={s.id}>
                      <td style={{ fontWeight:700 }}>{s.period}</td>
                      <td style={{ color:'#64748b', fontSize:12 }}>{s.description}</td>
                      <td style={{ textAlign:'right' }}>{fmt(s.gross)}</td>
                      <td style={{ textAlign:'right', color:'#64748b' }}>{fmt(s.vat)}</td>
                      <td style={{ textAlign:'right', color:'#64748b' }}>{fmt(s.ewt)}</td>
                      <td style={{ textAlign:'right', fontWeight:800, color:'#0f172a' }}>{fmt(s.netDue)}</td>
                      <td><span className={stmtPill(s.status)}>{s.status}</span></td>
                      <td>{s.status === 'Unpaid' && <button className="btn btn-ghost btn-sm" onClick={() => markPaid(s.id)}>Mark Paid</button>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}

        {tab === 'collections' && (
          <div className="card">
            {collections.length === 0 ? (
              <div className="empty"><p>No collections recorded.</p><button className="btn btn-success btn-sm" onClick={openNewCollection}>Record Collection</button></div>
            ) : (
              <table>
                <thead><tr><th>Date</th><th>OR Number</th><th>Payment Mode</th><th style={{textAlign:'right'}}>Amount</th><th>Notes</th><th>By</th></tr></thead>
                <tbody>
                  {collections.map(c => (
                    <tr key={c.id}>
                      <td style={{ fontWeight:700 }}>{c.date}</td>
                      <td style={{ fontFamily:'monospace', fontSize:12 }}>{c.orNumber}</td>
                      <td>{c.paymentMode}</td>
                      <td style={{ textAlign:'right', fontWeight:800, color:'#15803d' }}>{fmt(c.amount)}</td>
                      <td style={{ fontSize:12, color:'#94a3b8' }}>{c.notes}</td>
                      <td style={{ fontSize:11, color:'#94a3b8' }}>{c.createdBy}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}
      </div>

      {/* New Statement Modal */}
      {showStmtModal && (
        <div className="backdrop" onClick={e=>e.target===e.currentTarget&&setShowStmtModal(false)}>
          <div className="modal">
            <div className="modal-h"><strong>New Billing Statement — {book.contactName}</strong><button className="btn btn-ghost btn-sm" onClick={()=>setShowStmtModal(false)}>✕</button></div>
            <div className="modal-b">
              <div className="field"><label>Period (YYYY-MM) *</label><input type="month" value={stmtForm.period||''} onChange={e=>setStmtForm(f=>({...f,period:e.target.value}))} /></div>
              <div className="field"><label>Gross Amount *</label><input type="number" value={stmtForm.gross||''} onChange={e=>setStmtForm(f=>({...f,gross:e.target.value}))} placeholder="0.00" /></div>
              <div className="field full"><label>Description</label><textarea rows={2} value={stmtForm.description||''} onChange={e=>setStmtForm(f=>({...f,description:e.target.value}))} /></div>
              {stmtForm.gross && (
                <div className="field full">
                  <label>Computed Amounts</label>
                  <div className="computed-field" style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr 1fr', gap:12, background:'#f8fafc', border:'1px solid #e5e7eb', borderRadius:10, padding:12 }}>
                    <div><div style={{fontSize:10,color:'#94a3b8',fontWeight:800}}>GROSS</div><div>{fmt(computed.gross)}</div></div>
                    <div><div style={{fontSize:10,color:'#94a3b8',fontWeight:800}}>+ VAT 12%</div><div>{fmt(computed.vat)}</div></div>
                    <div><div style={{fontSize:10,color:'#94a3b8',fontWeight:800}}>- EWT 2%</div><div>{fmt(computed.ewt)}</div></div>
                    <div><div style={{fontSize:10,color:'#f97316',fontWeight:800}}>NET DUE</div><div style={{color:'#f97316'}}>{fmt(computed.netDue)}</div></div>
                  </div>
                </div>
              )}
            </div>
            <div className="modal-f">
              <button className="btn btn-ghost" onClick={()=>setShowStmtModal(false)}>Cancel</button>
              <button className="btn btn-primary" onClick={handleSaveStatement} disabled={saving}>{saving?'Saving…':'Create Statement'}</button>
            </div>
          </div>
        </div>
      )}

      {/* Record Collection Modal */}
      {showColModal && (
        <div className="backdrop" onClick={e=>e.target===e.currentTarget&&setShowColModal(false)}>
          <div className="modal">
            <div className="modal-h"><strong>Record Collection — {book.contactName}</strong><button className="btn btn-ghost btn-sm" onClick={()=>setShowColModal(false)}>✕</button></div>
            <div className="modal-b">
              <div className="field"><label>Date *</label><input type="date" value={colForm.date||''} onChange={e=>setColForm(f=>({...f,date:e.target.value}))} /></div>
              <div className="field"><label>Amount *</label><input type="number" value={colForm.amount||''} onChange={e=>setColForm(f=>({...f,amount:e.target.value}))} placeholder="0.00" /></div>
              <div className="field"><label>OR Number</label><input value={colForm.orNumber||''} onChange={e=>setColForm(f=>({...f,orNumber:e.target.value}))} /></div>
              <div className="field"><label>Payment Mode</label>
                <select value={colForm.paymentMode||'Check'} onChange={e=>setColForm(f=>({...f,paymentMode:e.target.value}))}>
                  {['Check','Online Transfer','Cash','Credit Card','Debit Card'].map(m=><option key={m}>{m}</option>)}
                </select>
              </div>
              <div className="field full"><label>Notes</label><textarea rows={2} value={colForm.notes||''} onChange={e=>setColForm(f=>({...f,notes:e.target.value}))} /></div>
            </div>
            <div className="modal-f">
              <button className="btn btn-ghost" onClick={()=>setShowColModal(false)}>Cancel</button>
              <button className="btn btn-success" onClick={handleSaveCollection} disabled={saving}>{saving?'Saving…':'Record Collection'}</button>
            </div>
          </div>
        </div>
      )}

      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}

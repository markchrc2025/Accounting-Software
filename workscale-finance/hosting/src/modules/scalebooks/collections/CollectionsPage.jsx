import { useState, useEffect } from 'react';
import { collection, query, orderBy, onSnapshot, limit, where } from 'firebase/firestore';
import { db } from '../../../firebase.js';

const fmt = (n) => new Intl.NumberFormat('en-PH', { style:'currency', currency:'PHP' }).format(n || 0);

const PAY_MODES = ['Check','Bank Transfer','Cash','GCash','Maya','Others'];

const CSS = `
  .cl-wrap   { display:flex; flex-direction:column; height:100%; overflow:hidden; font-family:Inter,system-ui,sans-serif; }
  .cl-topbar { display:flex; align-items:center; justify-content:space-between; padding:16px 22px 12px; flex-shrink:0; border-bottom:1px solid #e5e7eb; background:#fff; }
  .cl-body   { flex:1; overflow-y:auto; padding:16px 22px; }
  .input     { border:1px solid #e5e7eb; border-radius:10px; padding:9px 12px; font-size:13px; background:#fff; }
  .toolbar   { display:flex; gap:10px; align-items:center; flex-wrap:wrap; margin-bottom:14px; }
  .card      { background:#fff; border:1px solid #e5e7eb; border-radius:14px; overflow:hidden; }
  table      { width:100%; border-collapse:collapse; }
  th,td      { padding:11px 12px; border-bottom:1px solid #f1f5f9; font-size:13px; text-align:left; }
  th         { color:#64748b; font-weight:800; font-size:11px; letter-spacing:.05em; text-transform:uppercase; background:#f8fafc; }
  tr:hover td { background:#fafafa; }
  tr:last-child td { border-bottom:none; }
  .pill      { display:inline-block; padding:2px 9px; border-radius:999px; font-size:11px; font-weight:700; border:1px solid; }
  .summary-bar { display:grid; grid-template-columns:repeat(4,1fr); gap:12px; margin-bottom:16px; }
  .scard     { background:#fff; border:1px solid #e5e7eb; border-radius:12px; padding:14px 16px; }
  .scard-label { font-size:9px; font-weight:800; color:#94a3b8; letter-spacing:.07em; text-transform:uppercase; margin-bottom:4px; }
  .scard-value { font-size:18px; font-weight:900; }
  .empty     { padding:48px; text-align:center; color:#94a3b8; }
`;

export default function CollectionsPage() {
  const [collections, setCollections] = useState([]);
  const [search, setSearch]   = useState('');
  const [modeFilter, setModeFilter] = useState('All');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo]   = useState('');

  useEffect(() => {
    const unsub = onSnapshot(
      query(collection(db,'collections'), orderBy('date','desc'), limit(500)),
      snap => setCollections(snap.docs.map(d=>({id:d.id,...d.data()})))
    );
    return unsub;
  }, []);

  const thisMonth = new Date().toISOString().slice(0, 7);
  const mtdTotal = collections.filter(c => c.date?.startsWith(thisMonth)).reduce((s,c)=>s+(c.amount||0),0);
  const grandTotal = collections.reduce((s,c)=>s+(c.amount||0),0);

  const filtered = collections.filter(c => {
    const mSearch = !search || c.clientName?.toLowerCase().includes(search.toLowerCase()) || c.orNumber?.toLowerCase().includes(search.toLowerCase());
    const mMode   = modeFilter==='All' || c.paymentMode===modeFilter;
    const mFrom   = !dateFrom || c.date >= dateFrom;
    const mTo     = !dateTo   || c.date <= dateTo;
    return mSearch && mMode && mFrom && mTo;
  });

  const filteredTotal = filtered.reduce((s,c)=>s+(c.amount||0),0);

  return (
    <div className="cl-wrap">
      <style>{CSS}</style>
      <div className="cl-topbar">
        <div>
          <h1 style={{ margin:0, fontSize:18, fontWeight:900 }}>Collections (Global)</h1>
          <p style={{ margin:0, fontSize:12, color:'#64748b' }}>{collections.length} collection{collections.length!==1?'s':''} · MTD: {fmt(mtdTotal)}</p>
        </div>
      </div>

      <div className="cl-body">
        <div className="summary-bar">
          <div className="scard"><div className="scard-label">MTD Collected</div><div className="scard-value" style={{fontSize:14,color:'#15803d'}}>{fmt(mtdTotal)}</div></div>
          <div className="scard"><div className="scard-label">Grand Total</div><div className="scard-value" style={{fontSize:14}}>{fmt(grandTotal)}</div></div>
          <div className="scard"><div className="scard-label">Filtered Total</div><div className="scard-value" style={{fontSize:14,color:'#1d4ed8'}}>{fmt(filteredTotal)}</div></div>
          <div className="scard"><div className="scard-label">Records Shown</div><div className="scard-value">{filtered.length}</div></div>
        </div>

        <div className="toolbar">
          <input className="input" placeholder="Search client or OR no…" value={search} onChange={e=>setSearch(e.target.value)} style={{width:220}} />
          <select className="input" value={modeFilter} onChange={e=>setModeFilter(e.target.value)}>
            <option value="All">All Modes</option>
            {PAY_MODES.map(m=><option key={m}>{m}</option>)}
          </select>
          <input className="input" type="date" value={dateFrom} onChange={e=>setDateFrom(e.target.value)} />
          <span style={{color:'#94a3b8',fontSize:13}}>to</span>
          <input className="input" type="date" value={dateTo} onChange={e=>setDateTo(e.target.value)} />
        </div>

        <div className="card">
          {filtered.length===0 ? (
            <div className="empty">No collections found.</div>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Client</th>
                  <th>OR Number</th>
                  <th>Payment Mode</th>
                  <th>Billing Book</th>
                  <th>Notes</th>
                  <th style={{textAlign:'right'}}>Amount</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(c=>(
                  <tr key={c.id}>
                    <td style={{color:'#64748b',fontSize:12}}>{c.date}</td>
                    <td style={{fontWeight:700}}>{c.clientName||c.bookId}</td>
                    <td style={{fontFamily:'monospace',fontSize:11,color:'#475569'}}>{c.orNumber||'—'}</td>
                    <td style={{fontSize:12}}>{c.paymentMode||'—'}</td>
                    <td style={{fontSize:12,color:'#94a3b8'}}>{c.bookId}</td>
                    <td style={{fontSize:12,color:'#94a3b8',maxWidth:200,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{c.notes||'—'}</td>
                    <td style={{textAlign:'right',fontWeight:800,color:'#15803d'}}>{fmt(c.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}

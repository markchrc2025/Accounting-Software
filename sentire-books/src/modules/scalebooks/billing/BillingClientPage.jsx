import { useState, useEffect, useMemo } from 'react';
import { billingStatementsApi, serviceInvoicesApi, collectionsApi, ApiError } from '../../../lib/api.js';

const STATUS_STYLES = {
  'Draft':            { background:'#f8fafc', borderColor:'#e2e8f0', color:'#64748b' },
  'Pending Review':   { background:'#fffbeb', borderColor:'#fde68a', color:'#92400e' },
  'Pending Approval': { background:'#fff7ed', borderColor:'#fed7aa', color:'#c2410c' },
  'Approved':         { background:'#ecfdf5', borderColor:'#6ee7b7', color:'#065f46' },
  'Sent':             { background:'#eff6ff', borderColor:'#bfdbfe', color:'#1d4ed8' },
  'Partial':          { background:'#f5f3ff', borderColor:'#ddd6fe', color:'#5b21b6' },
  'Paid':             { background:'#f0fdf4', borderColor:'#bbf7d0', color:'#15803d' },
  'Voided':           { background:'#fef2f2', borderColor:'#fecaca', color:'#991b1b' },
};

const CSS = `
  .bc-wrap { display:flex; flex-direction:column; height:100%; overflow:hidden; font-family:Inter,system-ui,sans-serif; background:#f8fafc; }
  .bc-top  { display:flex; align-items:center; justify-content:space-between; padding:16px 22px 12px; flex-shrink:0; border-bottom:1px solid #e5e7eb; background:#fff; }
  .bc-body { flex:1; overflow-y:auto; padding:16px 22px; }
  .kpi-row { display:grid; grid-template-columns:repeat(auto-fill,minmax(140px,1fr)); gap:12px; margin-bottom:16px; }
  .kpi-card { background:#fff; border:1px solid #e5e7eb; border-radius:12px; padding:14px 16px; }
  .kpi-label { font-size:10px; color:#94a3b8; font-weight:800; letter-spacing:.06em; text-transform:uppercase; margin-bottom:4px; }
  .kpi-value { font-size:20px; font-weight:900; color:#0b1220; }
  .kpi-value.orange { color:#f97316; }
  .toolbar { display:flex; gap:10px; align-items:center; flex-wrap:wrap; margin-bottom:14px; }
  .input   { border:1px solid #e5e7eb; border-radius:10px; padding:9px 12px; font-size:13px; background:#fff; font-family:inherit; }
  .btn     { border:0; border-radius:10px; padding:9px 16px; font-weight:700; cursor:pointer; font-size:13px; font-family:inherit; }
  .btn:disabled { opacity:.5; cursor:not-allowed; }
  .btn-primary { background:#f97316; color:#fff; }
  .btn-ghost   { background:#f1f5f9; color:#0b1220; }
  .btn-ghost:hover { background:#e2e8f0; }
  .btn-sm { padding:6px 12px; font-size:12px; }
  .btn-xs { padding:4px 8px; font-size:11px; border-radius:8px; }
  .card   { background:#fff; border:1px solid #e5e7eb; border-radius:14px; overflow:hidden; margin-bottom:16px; }
  table   { width:100%; border-collapse:collapse; }
  th,td   { padding:10px 12px; border-bottom:1px solid #f1f5f9; font-size:13px; text-align:left; }
  th      { color:#64748b; font-weight:800; font-size:11px; letter-spacing:.05em; text-transform:uppercase; background:#f8fafc; }
  tr:hover td { background:#fafafa; }
  tr:last-child td { border-bottom:none; }
  .pill   { display:inline-block; padding:2px 9px; border-radius:999px; font-size:11px; font-weight:700; border:1px solid #e2e8f0; background:#f8fafc; color:#64748b; }
  .expand-row td { background:#f8fafc !important; border-bottom:2px solid #e5e7eb; }
  .exp-box { padding:10px 4px; }
  .panel-hdr { font-size:12px; font-weight:900; color:#0b1220; margin-bottom:8px; }
  .col-panel { display:grid; grid-template-columns:1fr 1fr; gap:16px; margin-top:12px; }
  .empty  { padding:40px; text-align:center; color:#94a3b8; font-size:13px; }
  .toast  { position:fixed; right:16px; bottom:16px; background:#0b1220; color:#fff; padding:12px 18px; border-radius:12px; font-size:13px; font-weight:600; z-index:999; animation:fadeIn .2s; }
  @keyframes fadeIn { from{opacity:0;transform:translateY(8px)} to{opacity:1;transform:none} }
`;

const fmt = (n) => new Intl.NumberFormat('en-PH',{style:'currency',currency:'PHP'}).format(Number(n||0));

// API rows carry integer centavos; the UI thinks in pesos. Mapping also keeps
// the original field names (bsNo→bsId, siNo→siId, …) the render code expects.
const toPesos = (c) => Number(c || 0) / 100;
const bsFromApi = (r) => ({
  id: r.id, bsId: r.bsNo || '', contactName: r.contactName || '',
  billingDate: r.billingDate || '', periodStart: r.periodStart || '', periodEnd: r.periodEnd || '',
  taxGroupName: r.taxGroupName || '', grossAmount: toPesos(r.grossCents),
  netDue: toPesos(r.netDueCents), appliedAmount: toPesos(r.appliedCents),
  balance: toPesos(r.balanceCents), description: r.description || '', status: r.status || 'Draft',
});
const siFromApi = (r) => ({
  id: r.id, siId: r.siNo || '', contactName: r.contactName || '', siDate: r.siDate || '',
  amount: toPesos(r.amountCents), balance: toPesos(r.balanceCents),
  billingStatementId: r.billingStatementId || '',
});
const colFromApi = (r) => ({
  id: r.id, collectionId: r.collectionNo || '', contactName: r.contactName || '',
  collectionDate: r.collectionDate || '', amountReceived: toPesos(r.amountReceivedCents),
  billingStatementId: r.billingStatementId || '',
});

export default function BillingClientPage() {
  const [statements,  setStatements]  = useState([]);
  const [invoices,    setInvoices]    = useState([]);
  const [collections, setCollections] = useState([]);
  const [selectedClient, setSelectedClient] = useState('');
  const [search,   setSearch]   = useState('');
  const [expandId, setExpandId] = useState(null);
  const [toast,    setToast]    = useState('');

  const showToast = (msg) => { setToast(msg); setTimeout(() => setToast(''), 3000); };

  useEffect(() => {
    (async () => {
      try {
        const [sts, sis, cols] = await Promise.all([
          billingStatementsApi.list(),
          serviceInvoicesApi.list(),
          collectionsApi.list(),
        ]);
        setStatements(sts.map(bsFromApi));
        setInvoices(sis.map(siFromApi));
        setCollections(cols.map(colFromApi));
      } catch (e) {
        showToast(e instanceof ApiError ? e.detail : e.message);
      }
    })();
  }, []);

  const clientList = useMemo(() => {
    const names = new Set(statements.map(s => s.contactName||s.contact||'').filter(Boolean));
    return [...names].sort();
  }, [statements]);

  const clientStatements = useMemo(() => {
    let a = [...statements];
    if (selectedClient) a = a.filter(s => (s.contactName||s.contact||'') === selectedClient);
    const q = search.toLowerCase();
    if (q) a = a.filter(s => (s.bsId||'').toLowerCase().includes(q) || (s.contactName||s.contact||'').toLowerCase().includes(q));
    return a;
  }, [statements, selectedClient, search]);

  const clientInvoices = useMemo(() => {
    if (!selectedClient) return invoices;
    return invoices.filter(i => (i.contactName||i.contact||'') === selectedClient);
  }, [invoices, selectedClient]);

  const clientCollections = useMemo(() => {
    if (!selectedClient) return collections;
    return collections.filter(c => (c.contactName||c.contact||'') === selectedClient);
  }, [collections, selectedClient]);

  const kpis = useMemo(() => {
    const active = clientStatements.filter(s => s.status !== 'Voided');
    return {
      clients: clientList.length,
      statements: clientStatements.length,
      balance: active.reduce((a,s) => a + Number(s.balance||s.netDue||0), 0),
      collected: clientCollections.reduce((a,c) => a + Number(c.amountReceived||0), 0),
    };
  }, [clientStatements, clientCollections, clientList]);

  return (
    <div className="bc-wrap">
      <style>{CSS}</style>
      <div className="bc-top">
        <strong style={{fontSize:18,fontWeight:900,color:'#0b1220'}}>CLIENT BILLING VIEW</strong>
      </div>
      <div className="bc-body">
        {/* ── Primary KPI Scorecards ─────────────────────────────────────── */}
        <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(200px,1fr))',gap:14,marginBottom:12}}>
          <div style={{background:'linear-gradient(135deg,#c2410c 0%,#ea580c 100%)',borderRadius:14,padding:'18px 20px',color:'#fff',position:'relative',overflow:'hidden'}}>
            <div style={{position:'absolute',right:-8,top:-8,opacity:.13}}>
              <svg width="56" height="56" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"><path d="M12 1v22M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6"/></svg>
            </div>
            <div style={{fontSize:10,fontWeight:800,letterSpacing:'.08em',textTransform:'uppercase',opacity:.8,marginBottom:6}}>Outstanding Balance</div>
            <div style={{fontSize:22,fontWeight:900,letterSpacing:'-.5px'}}>{fmt(kpis.balance)}</div>
            <div style={{marginTop:10,fontSize:11,opacity:.8}}>Across active statements</div>
          </div>
          <div style={{background:'linear-gradient(135deg,#166534 0%,#16a34a 100%)',borderRadius:14,padding:'18px 20px',color:'#fff',position:'relative',overflow:'hidden'}}>
            <div style={{position:'absolute',right:-8,top:-8,opacity:.13}}>
              <svg width="56" height="56" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"><path d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>
            </div>
            <div style={{fontSize:10,fontWeight:800,letterSpacing:'.08em',textTransform:'uppercase',opacity:.8,marginBottom:6}}>Total Collected</div>
            <div style={{fontSize:22,fontWeight:900,letterSpacing:'-.5px'}}>{fmt(kpis.collected)}</div>
            <div style={{marginTop:10,fontSize:11,opacity:.8}}>From all collections</div>
          </div>
          <div style={{background:'linear-gradient(135deg,#0369a1 0%,#0284c7 100%)',borderRadius:14,padding:'18px 20px',color:'#fff',position:'relative',overflow:'hidden'}}>
            <div style={{position:'absolute',right:-8,top:-8,opacity:.13}}>
              <svg width="56" height="56" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 00-3-3.87"/><path d="M16 3.13a4 4 0 010 7.75"/></svg>
            </div>
            <div style={{fontSize:10,fontWeight:800,letterSpacing:'.08em',textTransform:'uppercase',opacity:.8,marginBottom:6}}>Clients</div>
            <div style={{fontSize:22,fontWeight:900,letterSpacing:'-.5px'}}>{kpis.clients}</div>
            <div style={{marginTop:10,fontSize:11,opacity:.8}}>{kpis.statements} statement{kpis.statements!==1?'s':''} total</div>
          </div>
        </div>
        {/* ── Secondary KPI Row ─────────────────────────────────────────── */}
        <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(140px,1fr))',gap:10,marginBottom:16}}>
          {[
            {label:'Statements',value:kpis.statements,sub:'all billing statements',color:'#1d4ed8',bg:'#eff6ff',border:'#bfdbfe',icon:<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><path d="M14 2v6h6M16 13H8M16 17H8M10 9H8"/></svg>},
          ].map(({label,value,sub,color,bg,border,icon})=>(
            <div key={label} style={{background:bg,border:`1px solid ${border}`,borderRadius:12,padding:'14px 15px'}}>
              <div style={{display:'flex',alignItems:'center',gap:6,marginBottom:6}}>
                <span style={{color,display:'flex'}}>{icon}</span>
                <span style={{fontSize:9,fontWeight:800,color:'#64748b',letterSpacing:'.07em',textTransform:'uppercase'}}>{label}</span>
              </div>
              <div style={{fontSize:20,fontWeight:900,color,lineHeight:1}}>{value}</div>
              <div style={{fontSize:11,color:'#94a3b8',marginTop:4}}>{sub}</div>
            </div>
          ))}
        </div>

        <div className="toolbar">
          <select className="input" style={{flex:'0 0 220px'}} value={selectedClient} onChange={e=>{setSelectedClient(e.target.value);setExpandId(null);}}>
            <option value="">All Clients</option>
            {clientList.map(n=><option key={n}>{n}</option>)}
          </select>
          <input className="input" placeholder="🔍 Search BS ID…" value={search} onChange={e=>setSearch(e.target.value)} style={{flex:'1 1 180px',minWidth:140}} />
          <button className="btn btn-ghost btn-sm" onClick={()=>{setSearch('');setSelectedClient('');setExpandId(null);}}>✕ Clear</button>
        </div>

        {/* Billing Statements */}
        <div style={{marginBottom:8,fontWeight:800,fontSize:12,color:'#64748b',letterSpacing:'.06em',textTransform:'uppercase'}}>Billing Statements ({clientStatements.length})</div>
        <div className="card">
          <table>
            <thead>
              <tr><th>BS ID</th><th>CLIENT</th><th>DATE</th><th>NET DUE</th><th>BALANCE</th><th>STATUS</th></tr>
            </thead>
            <tbody>
              {clientStatements.length === 0 && <tr><td colSpan={6} className="empty">No billing statements.</td></tr>}
              {clientStatements.map(bs => {
                const ss = STATUS_STYLES[bs.status] || {};
                const isExp = expandId === bs.id;
                return [
                  <tr key={bs.id}>
                    <td><button className="btn btn-ghost btn-xs" style={{fontFamily:'monospace',color:'#f97316',fontWeight:800}} onClick={()=>setExpandId(isExp?null:bs.id)}>{bs.bsId||bs.id}</button></td>
                    <td>{bs.contactName||bs.contact||'—'}</td>
                    <td>{bs.billingDate||'—'}</td>
                    <td style={{fontWeight:700}}>{fmt(bs.netDue||bs.totalAmount||0)}</td>
                    <td style={{fontWeight:700,color:Number(bs.balance||0)>0?'#c2410c':'#15803d'}}>{fmt(bs.balance||0)}</td>
                    <td><span className="pill" style={ss}>{bs.status}</span></td>
                  </tr>,
                  isExp && (
                    <tr key={bs.id+'-exp'} className="expand-row">
                      <td colSpan={6}>
                        <div className="exp-box">
                          <div style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:12,fontSize:12}}>
                            <div><div style={{color:'#94a3b8',fontWeight:700,fontSize:10,textTransform:'uppercase'}}>Period</div><div>{bs.periodStart||'—'} – {bs.periodEnd||'—'}</div></div>
                            <div><div style={{color:'#94a3b8',fontWeight:700,fontSize:10,textTransform:'uppercase'}}>Tax Group</div><div>{bs.taxGroupName||'—'}</div></div>
                            <div><div style={{color:'#94a3b8',fontWeight:700,fontSize:10,textTransform:'uppercase'}}>Gross Amount</div><div>{fmt(bs.grossAmount||0)}</div></div>
                            <div><div style={{color:'#94a3b8',fontWeight:700,fontSize:10,textTransform:'uppercase'}}>Applied</div><div>{fmt(bs.appliedAmount||0)}</div></div>
                          </div>
                          {bs.description && <div style={{marginTop:8,fontSize:12,color:'#64748b'}}>{bs.description}</div>}
                          {/* Associated invoices and collections */}
                          <div className="col-panel">
                            <div>
                              <div className="panel-hdr">Service Invoices</div>
                              <table style={{fontSize:12}}>
                                <thead><tr><th>SI ID</th><th>Date</th><th>Amount</th><th>Balance</th></tr></thead>
                                <tbody>
                                  {clientInvoices.filter(i=>i.billingStatementId===bs.id||i.billingStatementId===bs.bsId).length === 0
                                    ? <tr><td colSpan={4} style={{textAlign:'center',color:'#94a3b8',padding:12}}>None</td></tr>
                                    : clientInvoices.filter(i=>i.billingStatementId===bs.id||i.billingStatementId===bs.bsId).map(i=>(
                                        <tr key={i.id}><td style={{fontFamily:'monospace',color:'#f97316'}}>{i.siId||i.id}</td><td>{i.siDate||'—'}</td><td>{fmt(i.amount||0)}</td><td>{fmt(i.balance||0)}</td></tr>
                                      ))}
                                </tbody>
                              </table>
                            </div>
                            <div>
                              <div className="panel-hdr">Collections</div>
                              <table style={{fontSize:12}}>
                                <thead><tr><th>Coll. ID</th><th>Date</th><th>Received</th></tr></thead>
                                <tbody>
                                  {clientCollections.filter(c=>c.billingStatementId===bs.id||c.billingStatementId===bs.bsId).length === 0
                                    ? <tr><td colSpan={3} style={{textAlign:'center',color:'#94a3b8',padding:12}}>None</td></tr>
                                    : clientCollections.filter(c=>c.billingStatementId===bs.id||c.billingStatementId===bs.bsId).map(c=>(
                                        <tr key={c.id}><td style={{fontFamily:'monospace',color:'#f97316'}}>{c.collectionId||c.id}</td><td>{c.collectionDate||'—'}</td><td>{fmt(c.amountReceived||0)}</td></tr>
                                      ))}
                                </tbody>
                              </table>
                            </div>
                          </div>
                        </div>
                      </td>
                    </tr>
                  )
                ];
              })}
            </tbody>
          </table>
        </div>
      </div>
      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}

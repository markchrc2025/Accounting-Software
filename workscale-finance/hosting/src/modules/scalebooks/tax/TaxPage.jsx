import { useState, useEffect, useMemo } from 'react';
import { collection, query, orderBy, onSnapshot, addDoc, updateDoc, doc, serverTimestamp, getDocs } from 'firebase/firestore';
import { db, auth } from '../../../firebase.js';
import AccountCombobox from '../../../components/AccountCombobox.jsx';

const fmt  = (n) => new Intl.NumberFormat('en-PH', { style:'currency', currency:'PHP' }).format(n || 0);
const fmtP = (n) => `${(parseFloat(n)||0).toFixed(2)}%`;
const uid  = () => Math.random().toString(36).slice(2, 10).toUpperCase();

const CSS = `
  .tp-wrap   { display:flex; flex-direction:column; height:100%; overflow:hidden; font-family:Inter,system-ui,sans-serif; }
  .tp-topbar { display:flex; align-items:center; justify-content:space-between; padding:16px 22px 12px; flex-shrink:0; border-bottom:1px solid #e5e7eb; background:#fff; }
  .tp-body   { flex:1; overflow-y:auto; padding:16px 22px; }
  .input     { border:1px solid #e5e7eb; border-radius:10px; padding:9px 12px; font-size:13px; background:#fff; }
  .btn       { border:0; border-radius:10px; padding:9px 16px; font-weight:700; cursor:pointer; font-size:13px; font-family:inherit; }
  .btn-primary { background:#f97316; color:#fff; }
  .btn-ghost   { background:#f1f5f9; color:#0b1220; }
  .btn-ghost:hover { background:#e2e8f0; }
  .btn-sm    { padding:6px 12px; font-size:12px; }
  .tabs      { display:flex; gap:4px; background:#f1f5f9; border-radius:10px; padding:4px; width:fit-content; margin-bottom:14px; }
  .tab       { border:0; background:none; padding:8px 18px; border-radius:8px; font-size:13px; font-weight:700; cursor:pointer; color:#64748b; font-family:inherit; }
  .tab.active { background:#fff; color:#0b1220; box-shadow:0 1px 4px rgba(0,0,0,.1); }
  .toolbar   { display:flex; gap:10px; align-items:center; flex-wrap:wrap; margin-bottom:14px; }
  .card      { background:#fff; border:1px solid #e5e7eb; border-radius:14px; overflow:hidden; }
  table      { width:100%; border-collapse:collapse; }
  th,td      { padding:11px 12px; border-bottom:1px solid #f1f5f9; font-size:13px; text-align:left; }
  th         { color:#64748b; font-weight:800; font-size:11px; letter-spacing:.05em; text-transform:uppercase; background:#f8fafc; }
  tr:hover td { background:#fafafa; }
  tr:last-child td { border-bottom:none; }
  .empty     { padding:48px; text-align:center; color:#94a3b8; }
  .backdrop  { position:fixed; inset:0; background:rgba(15,23,42,.45); display:flex; align-items:center; justify-content:center; padding:16px; z-index:100; }
  .modal     { width:min(580px,98vw); background:#fff; border-radius:16px; overflow:hidden; box-shadow:0 24px 64px rgba(0,0,0,.25); }
  .modal-h   { display:flex; align-items:center; justify-content:space-between; padding:16px 20px; border-bottom:1px solid #e5e7eb; background:#f8fafc; }
  .modal-b   { padding:20px; display:grid; grid-template-columns:1fr 1fr; gap:12px; }
  .modal-f   { display:flex; justify-content:flex-end; gap:10px; padding:14px 20px; border-top:1px solid #e5e7eb; }
  .field     { display:flex; flex-direction:column; gap:5px; }
  .field.full { grid-column:span 2; }
  .field label { font-size:10px; font-weight:800; color:#64748b; letter-spacing:.06em; text-transform:uppercase; }
  .field input,.field select,.field textarea { width:100%; border:1px solid #e5e7eb; border-radius:10px; padding:9px 10px; font-size:13px; background:#fff; font-family:inherit; box-sizing:border-box; }
  .summary-bar { display:grid; grid-template-columns:repeat(3,1fr); gap:12px; margin-bottom:16px; }
  .scard     { background:#fff; border:1px solid #e5e7eb; border-radius:12px; padding:14px 16px; }
  .scard-label { font-size:9px; font-weight:800; color:#94a3b8; letter-spacing:.07em; text-transform:uppercase; margin-bottom:4px; }
  .scard-value { font-size:20px; font-weight:900; }
  .toast { position:fixed; right:16px; bottom:16px; background:#0b1220; color:#fff; padding:12px 18px; border-radius:12px; font-size:13px; font-weight:600; z-index:999; }
  .hint  { font-size:11px; color:#94a3b8; margin-top:2px; }
  .check-list { display:flex; flex-direction:column; gap:6px; max-height:220px; overflow-y:auto; border:1px solid #e5e7eb; border-radius:10px; padding:10px 12px; }
  .check-item { display:flex; align-items:center; gap:8px; font-size:13px; cursor:pointer; }
  .check-item input[type=checkbox] { width:15px; height:15px; accent-color:#f97316; cursor:pointer; }
  .rate-pill  { display:inline-flex; align-items:center; gap:4px; background:#eff6ff; border:1px solid #bfdbfe; border-radius:6px; padding:2px 8px; font-size:11px; font-weight:700; color:#1d4ed8; }
`;

export default function TaxPage() {
  const [tab, setTab]             = useState('entries');
  const [vouchers, setVouchers]   = useState([]);
  const [rates, setRates]         = useState([]);
  const [groups, setGroups]       = useState([]);
  const [accounts, setAccounts]   = useState([]);
  const [filter, setFilter]       = useState('All');
  const [period, setPeriod]       = useState('');
  const [showRateModal, setShowRateModal]   = useState(false);
  const [showGroupModal, setShowGroupModal] = useState(false);
  const [editingR, setEditingR]   = useState(null);
  const [editingG, setEditingG]   = useState(null);
  const [rForm, setRForm]         = useState({});
  const [gForm, setGForm]         = useState({});
  const [saving, setSaving]       = useState(false);
  const [toast, setToast]         = useState('');

  const showToast = (msg) => { setToast(msg); setTimeout(() => setToast(''), 3000); };

  useEffect(() => {
    const unsubV = onSnapshot(query(collection(db,'vouchers'), orderBy('createdAt','desc')), snap=>setVouchers(snap.docs.map(d=>({id:d.id,...d.data()}))));
    const unsubR = onSnapshot(query(collection(db,'taxRates'),  orderBy('name')), snap=>setRates(snap.docs.map(d=>({id:d.id,...d.data()}))));
    const unsubG = onSnapshot(query(collection(db,'taxGroups'), orderBy('name')), snap=>setGroups(snap.docs.map(d=>({id:d.id,...d.data()}))));
    getDocs(collection(db,'accounts')).then(s =>
      setAccounts(s.docs.map(d=>({id:d.id,...d.data()})).sort((a,b)=>(a.code||'').localeCompare(b.code||'')))
    );
    return () => { unsubV(); unsubR(); unsubG(); };
  }, []);

  // Derive tax lines from all Payment/Check vouchers that have taxAmt > 0
  const taxLines = useMemo(() => {
    const rows = [];
    vouchers.forEach(v => {
      if (!['PAYMENT','CHECK'].includes(v.voucherType)) return;
      (v.lines || []).forEach(l => {
        if (!(l.taxAmt > 0)) return;
        const dateStr = v.preparationDate || '';
        rows.push({
          key:         `${v.id}-${l.lineNo}`,
          date:        dateStr,
          period:      dateStr.slice(0, 7),
          voucherId:   v.voucherId || '',
          source:      v.voucherType === 'CHECK' ? 'Check Voucher' : 'Payment Voucher',
          payee:       l.contact || v.contactSummary || '',
          description: l.description || v.purposeCategory || '',
          taxName:     l.taxType || '',
          taxRate:     l.taxRate || 0,
          grossAmount: l.amount  || 0,
          taxAmount:   l.taxAmt  || 0,
          inclusive:   !!l.inclusive,
          status:      v.status  || '',
        });
      });
    });
    return rows.sort((a, b) => b.date.localeCompare(a.date));
  }, [vouchers]);

  async function saveRate() {
    if (!rForm.name?.trim()) return alert('Tax name is required.');
    setSaving(true);
    try {
      const payload = {
        name:               rForm.name.trim(),
        rate:               parseFloat(rForm.rate)||0,
        trackingType:       rForm.trackingType||'single',
        taxAccountSingle:   rForm.taxAccountSingle||'',
        taxAccountSales:    rForm.taxAccountSales||'',
        taxAccountPurchases:rForm.taxAccountPurchases||'',
        isActive:           rForm.isActive!==false,
        updatedAt:          serverTimestamp(),
      };
      if (editingR) { await updateDoc(doc(db,'taxRates',editingR), payload); showToast('Rate updated.'); }
      else { await addDoc(collection(db,'taxRates'), {...payload, createdAt:serverTimestamp(), createdBy:auth.currentUser?.email}); showToast('Rate added.'); }
      setShowRateModal(false);
    } catch(e) { alert(e.message); }
    setSaving(false);
  }

  async function saveGroup() {
    if (!gForm.name?.trim()) return alert('Group name is required.');
    if (!gForm.rateNames?.length) return alert('Select at least one tax rate.');
    setSaving(true);
    try {
      const payload = { name:gForm.name.trim(), rateNames:gForm.rateNames, isActive:gForm.isActive!==false, updatedAt:serverTimestamp() };
      if (editingG) { await updateDoc(doc(db,'taxGroups',editingG), payload); showToast('Group updated.'); }
      else { await addDoc(collection(db,'taxGroups'), {...payload, createdAt:serverTimestamp(), createdBy:auth.currentUser?.email}); showToast('Group added.'); }
      setShowGroupModal(false);
    } catch(e) { alert(e.message); }
    setSaving(false);
  }

  function toggleGroupRate(rateName) {
    setGForm(f => {
      const prev = f.rateNames || [];
      return { ...f, rateNames: prev.includes(rateName) ? prev.filter(n=>n!==rateName) : [...prev, rateName] };
    });
  }

  // All tax names from registry for filter dropdown
  const allTaxNames = [...rates.map(r=>r.name), ...groups.map(g=>g.name)].filter(Boolean);

  const filteredLines = taxLines.filter(l => {
    const mType   = filter==='All' || l.taxName===filter;
    const mPeriod = !period || l.period===period;
    return mType && mPeriod;
  });

  const totalTax   = filteredLines.reduce((s,l)=>s+(l.taxAmount||0), 0);
  const totalGross = filteredLines.reduce((s,l)=>s+(l.grossAmount||0), 0);

  return (
    <div className="tp-wrap">
      <style>{CSS}</style>
      <div className="tp-topbar">
        <div>
          <h1 style={{ margin:0, fontSize:18, fontWeight:900 }}>Tax</h1>
          <p style={{ margin:0, fontSize:12, color:'#64748b' }}>{taxLines.length} tax lines · {rates.length + groups.length} registry items</p>
        </div>
        <div />
      </div>

      <div className="tp-body">
        <div className="tabs">
          <button className={`tab ${tab==='entries'?'active':''}`} onClick={()=>setTab('entries')}>Tax Entries</button>
          <button className={`tab ${tab==='registry'?'active':''}`} onClick={()=>setTab('registry')}>Tax Registry ({rates.length + groups.length})</button>
          <button className={`tab ${tab==='summary'?'active':''}`} onClick={()=>setTab('summary')}>Tax Summary</button>
        </div>

        {tab === 'entries' && <>
          <div className="summary-bar">
            <div className="scard"><div className="scard-label">Total Tax Lines</div><div className="scard-value">{filteredLines.length}</div></div>
            <div className="scard"><div className="scard-label">Total Gross Amount</div><div className="scard-value" style={{color:'#64748b',fontSize:16}}>{fmt(totalGross)}</div></div>
            <div className="scard"><div className="scard-label">Total Tax Amount</div><div className="scard-value" style={{color:'#dc2626',fontSize:16}}>{fmt(totalTax)}</div></div>
          </div>
          <div className="toolbar">
            <select className="input" value={filter} onChange={e=>setFilter(e.target.value)}>
              <option value="All">All Tax Types</option>
              {allTaxNames.map(t=><option key={t}>{t}</option>)}
            </select>
            <input className="input" type="month" value={period} onChange={e=>setPeriod(e.target.value)} style={{width:160}} placeholder="Filter by month" />
            {(filter!=='All'||period) && <button className="btn btn-ghost btn-sm" onClick={()=>{setFilter('All');setPeriod('');}}>Clear</button>}
          </div>
          <div className="card">
            {filteredLines.length===0 ? (
              <div className="empty">
                {vouchers.length===0
                  ? 'No vouchers yet. Tax entries will appear here once Payment or Check Vouchers with a tax rate are created.'
                  : 'No tax lines match the current filter.'}
              </div>
            ) : (
              <table>
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Voucher ID</th>
                    <th>Source</th>
                    <th>Payee</th>
                    <th>Description</th>
                    <th>Tax Name</th>
                    <th style={{textAlign:'right'}}>Rate %</th>
                    <th style={{textAlign:'right'}}>Gross Amt</th>
                    <th style={{textAlign:'right'}}>Tax Amt</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>{filteredLines.map(l=>(
                  <tr key={l.key}>
                    <td style={{color:'#64748b',fontSize:12,whiteSpace:'nowrap'}}>{l.date}</td>
                    <td style={{fontFamily:'monospace',fontWeight:700,fontSize:12}}>{l.voucherId}</td>
                    <td style={{fontSize:11,fontWeight:700,color:'#7c3aed'}}>{l.source}</td>
                    <td style={{fontSize:12}}>{l.payee||<span style={{color:'#cbd5e1'}}>—</span>}</td>
                    <td style={{color:'#64748b',fontSize:12,maxWidth:180,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{l.description||<span style={{color:'#cbd5e1'}}>—</span>}</td>
                    <td><span style={{display:'inline-block',padding:'2px 8px',borderRadius:6,fontSize:11,fontWeight:700,background:'#fef3c7',color:'#92400e',border:'1px solid #fde68a'}}>{l.taxName}</span></td>
                    <td style={{textAlign:'right',fontFamily:'monospace',fontSize:12}}>{fmtP(l.taxRate)}</td>
                    <td style={{textAlign:'right',color:'#64748b'}}>{fmt(l.grossAmount)}</td>
                    <td style={{textAlign:'right',fontWeight:800,color:'#dc2626'}}>{fmt(l.taxAmount)}</td>
                    <td style={{fontSize:11,fontWeight:700,color:l.status==='Paid'?'#15803d':l.status==='Voided'?'#94a3b8':'#c2410c'}}>{l.status}</td>
                  </tr>
                ))}</tbody>
              </table>
            )}
          </div>
        </>}

        {tab === 'registry' && (() => {
          const allItems = [
            ...rates.map(r => ({ ...r, kind: 'Rate' })),
            ...groups.map(g => {
              const effRate = (g.rateNames||[]).reduce((sum, rn) => {
                const r = rates.find(r2 => r2.name.toLowerCase() === rn.toLowerCase());
                return sum + (r?.rate || 0);
              }, 0);
              return { ...g, kind: 'Group', rate: effRate };
            }),
          ].sort((a,b) => a.name.localeCompare(b.name));
          return (
            <div>
              <div style={{display:'flex',gap:8,marginBottom:12}}>
                <button className="btn btn-ghost btn-sm" onClick={()=>{setEditingR(null);setRForm({isActive:true});setShowRateModal(true);}}>+ Add Rate</button>
                <button className="btn btn-ghost btn-sm" onClick={()=>{setEditingG(null);setGForm({isActive:true,rateNames:[]});setShowGroupModal(true);}}>+ Add Group</button>
              </div>
              <div className="card">
                {allItems.length===0 ? <div className="empty">No tax registry items yet.</div> : (
                  <table>
                    <thead><tr><th>Name</th><th>Kind</th><th>Rate %</th><th>Details</th><th>Active</th><th>Actions</th></tr></thead>
                    <tbody>{allItems.map(item => (
                      <tr key={item.id}>
                        <td style={{fontWeight:700}}>{item.name}</td>
                        <td>
                          <span style={{display:'inline-block',padding:'2px 8px',borderRadius:6,fontSize:11,fontWeight:700,
                            background: item.kind==='Rate' ? '#f0fdf4' : '#eff6ff',
                            color: item.kind==='Rate' ? '#15803d' : '#1d4ed8',
                            border: `1px solid ${item.kind==='Rate' ? '#bbf7d0' : '#bfdbfe'}`
                          }}>{item.kind}</span>
                        </td>
                        <td style={{fontFamily:'monospace',fontWeight:800,fontSize:13,color:(item.rate||0)<0?'#dc2626':'#0b1220'}}>{fmtP(item.rate)}</td>
                        <td style={{color:'#64748b',fontSize:12}}>
                          {item.kind==='Rate'
                            ? (() => {
                                if (item.trackingType==='separate') {
                                  const parts = [item.taxAccountSales && `Sales: ${item.taxAccountSales}`, item.taxAccountPurchases && `Purchases: ${item.taxAccountPurchases}`].filter(Boolean);
                                  return parts.length ? <span>{parts.join(' · ')}</span> : <span style={{color:'#cbd5e1'}}>—</span>;
                                }
                                return item.taxAccountSingle || <span style={{color:'#cbd5e1'}}>—</span>;
                              })()
                            : <span style={{display:'flex',flexWrap:'wrap',gap:4}}>{(item.rateNames||[]).map(rn=><span key={rn} className="rate-pill">{rn}</span>)}</span>
                          }
                        </td>
                        <td style={{fontWeight:700,color:item.isActive!==false?'#15803d':'#94a3b8'}}>{item.isActive!==false?'Yes':'No'}</td>
                        <td>
                          {item.kind==='Rate'
                            ? <button className="btn btn-ghost btn-sm" onClick={()=>{setEditingR(item.id);setRForm({...item});setShowRateModal(true);}}>Edit</button>
                            : <button className="btn btn-ghost btn-sm" onClick={()=>{setEditingG(item.id);setGForm({...item,rateNames:[...(item.rateNames||[])]});setShowGroupModal(true);}}>Edit</button>
                          }
                        </td>
                      </tr>
                    ))}</tbody>
                  </table>
                )}
              </div>
            </div>
          );
        })()}

        {tab === 'summary' && (() => {
          const byType = {};
          taxLines.forEach(l => {
            const k = l.taxName || 'Unknown';
            if (!byType[k]) byType[k] = { taxName:k, lines:0, gross:0, tax:0 };
            byType[k].lines++;
            byType[k].gross += l.grossAmount||0;
            byType[k].tax   += l.taxAmount||0;
          });
          const rows = Object.values(byType).sort((a,b)=>a.taxName.localeCompare(b.taxName));
          return (
            <div>
              <div className="summary-bar" style={{gridTemplateColumns:'repeat(3,1fr)'}}>
                <div className="scard"><div className="scard-label">Total Tax Lines</div><div className="scard-value">{taxLines.length}</div></div>
                <div className="scard"><div className="scard-label">Total Gross Amount</div><div className="scard-value" style={{color:'#64748b',fontSize:15}}>{fmt(taxLines.reduce((s,l)=>s+(l.grossAmount||0),0))}</div></div>
                <div className="scard"><div className="scard-label">Total Tax Amount</div><div className="scard-value" style={{color:'#dc2626',fontSize:15}}>{fmt(taxLines.reduce((s,l)=>s+(l.taxAmount||0),0))}</div></div>
              </div>
              <div className="card">
                {rows.length===0?<div className="empty">No tax transactions yet.</div>:(
                  <table>
                    <thead><tr><th>Tax Name</th><th style={{textAlign:'right'}}># Lines</th><th style={{textAlign:'right'}}>Total Gross</th><th style={{textAlign:'right'}}>Total Tax</th></tr></thead>
                    <tbody>{rows.map(r=>(
                      <tr key={r.taxName}>
                        <td style={{fontWeight:800,color:'#7c3aed'}}>{r.taxName}</td>
                        <td style={{textAlign:'right'}}>{r.lines}</td>
                        <td style={{textAlign:'right',color:'#64748b'}}>{fmt(r.gross)}</td>
                        <td style={{textAlign:'right',fontWeight:700,color:'#dc2626'}}>{fmt(r.tax)}</td>
                      </tr>
                    ))}</tbody>
                  </table>
                )}
              </div>
            </div>
          );
        })()}
      </div>

      {showRateModal && (
        <div className="backdrop" onClick={e=>e.target===e.currentTarget&&setShowRateModal(false)}>
          <div className="modal">
            <div className="modal-h"><strong>{editingR?'Edit Tax Rate':'New Tax Rate'}</strong><button className="btn btn-ghost btn-sm" onClick={()=>setShowRateModal(false)}>✕</button></div>
            <div className="modal-b">
              <div className="field full">
                <label>Tax Name *</label>
                <input value={rForm.name||''} onChange={e=>setRForm(f=>({...f,name:e.target.value}))} placeholder="e.g. VAT, EWT 2%, Sales Tax" />
                <span className="hint">Appears in the Tax Type dropdown on voucher lines.</span>
              </div>
              <div className="field">
                <label>Rate (%) *</label>
                <input type="number" step="0.01" value={rForm.rate||''} onChange={e=>setRForm(f=>({...f,rate:e.target.value}))} placeholder="e.g. 12, -2, -5" />
                <span className="hint">Negative = deducted from cash payment (EWT-style).</span>
              </div>
              <div className="field">
                <label>Active</label>
                <select value={rForm.isActive===false?'false':'true'} onChange={e=>setRForm(f=>({...f,isActive:e.target.value==='true'}))}>
                  <option value="true">Yes</option>
                  <option value="false">No</option>
                </select>
              </div>
              <div style={{gridColumn:'span 2',borderTop:'1px solid #e2e8f0',paddingTop:14,marginTop:4}}>
                <div style={{fontSize:10,fontWeight:800,color:'#64748b',letterSpacing:'.06em',textTransform:'uppercase',marginBottom:10}}>Tracking Preference</div>
                <div style={{display:'flex',flexDirection:'column',gap:10}}>
                  {/* Single account option */}
                  <div style={{display:'flex',alignItems:'flex-start',gap:10,cursor:'pointer'}}
                       onClick={()=>setRForm(f=>({...f,trackingType:'single'}))}>
                    <input type="radio" readOnly checked={(rForm.trackingType||'single')==='single'}
                      style={{marginTop:3,flexShrink:0,accentColor:'#f97316',cursor:'pointer'}} />
                    <div>
                      <div style={{fontWeight:700,fontSize:13,color:'#0b1220'}}>Track taxes under a single account</div>
                      <div style={{fontSize:11,color:'#64748b',marginTop:2}}>All tax transactions will be posted to one account.</div>
                    </div>
                  </div>
                  {(rForm.trackingType||'single')==='single' && (
                    <div style={{marginLeft:26,display:'flex',flexDirection:'column',gap:4}}>
                      <div style={{fontSize:11,fontWeight:700,color:'#64748b',textTransform:'uppercase',letterSpacing:'.05em'}}>Tax Account</div>
                      <AccountCombobox
                        options={accounts.map(a=>({value:`${a.code} — ${a.name}`,label:`${a.code} — ${a.name}`}))}
                        value={rForm.taxAccountSingle||''}
                        onChange={v=>setRForm(f=>({...f,taxAccountSingle:v}))}
                      />
                    </div>
                  )}
                  {/* Separate accounts option */}
                  <div style={{display:'flex',alignItems:'flex-start',gap:10,cursor:'pointer'}}
                       onClick={()=>setRForm(f=>({...f,trackingType:'separate'}))}>
                    <input type="radio" readOnly checked={rForm.trackingType==='separate'}
                      style={{marginTop:3,flexShrink:0,accentColor:'#f97316',cursor:'pointer'}} />
                    <div>
                      <div style={{fontWeight:700,fontSize:13,color:'#0b1220'}}>Track taxes under separate accounts</div>
                      <div style={{fontSize:11,color:'#64748b',marginTop:2}}>Use different accounts for sales and purchases.</div>
                    </div>
                  </div>
                  {rForm.trackingType==='separate' && (
                    <div style={{marginLeft:26,display:'flex',flexDirection:'column',gap:10}}>
                      <div style={{display:'flex',flexDirection:'column',gap:4}}>
                        <div style={{fontSize:11,fontWeight:700,color:'#64748b',textTransform:'uppercase',letterSpacing:'.05em'}}>Account to Track Sales</div>
                        <AccountCombobox
                          options={accounts.map(a=>({value:`${a.code} — ${a.name}`,label:`${a.code} — ${a.name}`}))}
                          value={rForm.taxAccountSales||''}
                          onChange={v=>setRForm(f=>({...f,taxAccountSales:v}))}
                        />
                      </div>
                      <div style={{display:'flex',flexDirection:'column',gap:4}}>
                        <div style={{fontSize:11,fontWeight:700,color:'#64748b',textTransform:'uppercase',letterSpacing:'.05em'}}>Account to Track Purchases</div>
                        <AccountCombobox
                          options={accounts.map(a=>({value:`${a.code} — ${a.name}`,label:`${a.code} — ${a.name}`}))}
                          value={rForm.taxAccountPurchases||''}
                          onChange={v=>setRForm(f=>({...f,taxAccountPurchases:v}))}
                        />
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
            <div className="modal-f">
              <button className="btn btn-ghost" onClick={()=>setShowRateModal(false)}>Cancel</button>
              <button className="btn btn-primary" onClick={saveRate} disabled={saving}>{saving?'Saving…':editingR?'Save Changes':'Add Rate'}</button>
            </div>
          </div>
        </div>
      )}

      {showGroupModal && (
        <div className="backdrop" onClick={e=>e.target===e.currentTarget&&setShowGroupModal(false)}>
          <div className="modal">
            <div className="modal-h"><strong>{editingG?'Edit Tax Group':'New Tax Group'}</strong><button className="btn btn-ghost btn-sm" onClick={()=>setShowGroupModal(false)}>✕</button></div>
            <div className="modal-b">
              <div className="field">
                <label>Group Name *</label>
                <input value={gForm.name||''} onChange={e=>setGForm(f=>({...f,name:e.target.value}))} placeholder="e.g. VAT+EWT 2%" />
                <span className="hint">Appears alongside individual rates in the Tax Type dropdown.</span>
              </div>
              <div className="field">
                <label>Active</label>
                <select value={gForm.isActive===false?'false':'true'} onChange={e=>setGForm(f=>({...f,isActive:e.target.value==='true'}))}>
                  <option value="true">Yes</option>
                  <option value="false">No</option>
                </select>
              </div>
              <div className="field full">
                <label>Include Rates (select all that apply)</label>
                {rates.length===0
                  ? <p style={{fontSize:12,color:'#94a3b8',margin:0}}>No tax rates yet. Add rates first.</p>
                  : <div className="check-list">
                      {rates.map(r=>(
                        <label key={r.id} className="check-item">
                          <input type="checkbox" checked={(gForm.rateNames||[]).includes(r.name)} onChange={()=>toggleGroupRate(r.name)} />
                          <span style={{fontWeight:700}}>{r.name}</span>
                          <span style={{color:'#94a3b8',fontSize:12,marginLeft:'auto'}}>{fmtP(r.rate)}</span>
                        </label>
                      ))}
                    </div>
                }
              </div>
            </div>
            <div className="modal-f">
              <button className="btn btn-ghost" onClick={()=>setShowGroupModal(false)}>Cancel</button>
              <button className="btn btn-primary" onClick={saveGroup} disabled={saving}>{saving?'Saving…':editingG?'Save Changes':'Add Group'}</button>
            </div>
          </div>
        </div>
      )}
      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}

import { useState, useEffect } from 'react';
import {
  collection, query, orderBy, onSnapshot,
  addDoc, updateDoc, doc, serverTimestamp, deleteDoc
} from 'firebase/firestore';
import { db, auth } from '../../../firebase.js';

const BANKS = [
  {code:'UBPBPHM', name:'UnionBank', color:'#1e40af'},
  {code:'BPI',     name:'BPI',       color:'#15803d'},
  {code:'BDO',     name:'BDO',       color:'#b91c1c'},
  {code:'RCBC',    name:'RCBC',      color:'#a16207'},
  {code:'MBTC',    name:'Metrobank', color:'#7e22ce'},
  {code:'CASH',    name:'Petty Cash',color:'#64748b'},
];

const fmtPHP = n => new Intl.NumberFormat('en-PH',{minimumFractionDigits:2,maximumFractionDigits:2}).format(n||0);
const fmtCur = n => '₱' + fmtPHP(n);
const bankName = code => BANKS.find(b=>b.code===code)?.name || code;
const bankColor = code => BANKS.find(b=>b.code===code)?.color || '#64748b';

const CSS = `
  .bank-wrap{display:flex;flex-direction:column;height:100%;overflow:hidden;font-family:Inter,system-ui,sans-serif;}
  .bank-topbar{display:flex;align-items:center;justify-content:space-between;padding:14px 22px 10px;flex-shrink:0;border-bottom:1px solid #e5e7eb;background:#fff;gap:12px;flex-wrap:wrap;}
  .bank-tabs{display:flex;background:#fff;border-bottom:2px solid #e5e7eb;flex-shrink:0;overflow-x:auto;}
  .bank-tab{padding:10px 16px;font-size:12px;font-weight:600;border:none;background:transparent;color:#64748b;cursor:pointer;white-space:nowrap;border-bottom:2px solid transparent;margin-bottom:-2px;font-family:inherit;}
  .bank-tab:hover{color:#0b1220;}
  .bank-tab-active{color:#f97316;border-bottom-color:#f97316;font-weight:800;}
  .bank-body{flex:1;overflow-y:auto;padding:16px 22px;}
  .bank-cards{display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:12px;margin-bottom:16px;}
  .bank-card{background:#fff;border:1px solid #e5e7eb;border-radius:12px;padding:14px 16px;border-left:4px solid;}
  .bank-card-name{font-size:11px;font-weight:800;color:#64748b;text-transform:uppercase;letter-spacing:.06em;margin-bottom:4px;}
  .bank-card-bal{font-size:22px;font-weight:900;}
  .bank-card-sub{font-size:10px;color:#94a3b8;margin-top:2px;}
  .cl-card{background:#fff;border:1px solid #e5e7eb;border-radius:12px;padding:14px 16px;margin-bottom:12px;}
  .cl-card-hdr{display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;}
  .cl-name{font-size:13px;font-weight:800;color:#0b1220;}
  .cl-stat-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:8px;}
  .cl-stat{background:#f8fafc;border-radius:8px;padding:8px 10px;}
  .cl-stat-lbl{font-size:9px;font-weight:800;color:#94a3b8;letter-spacing:.07em;text-transform:uppercase;margin-bottom:2px;}
  .cl-stat-val{font-size:15px;font-weight:900;}
  .util-bar{height:6px;background:#e5e7eb;border-radius:999px;overflow:hidden;margin-top:6px;}
  .util-fill{height:100%;border-radius:999px;background:#f97316;transition:width .3s;}
  .filters{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px;align-items:center;}
  .filters input,.filters select{border:1px solid #e5e7eb;border-radius:10px;padding:7px 10px;font-size:12px;background:#fff;font-family:inherit;}
  .btn{border:0;border-radius:10px;padding:9px 16px;font-weight:700;cursor:pointer;font-size:13px;font-family:inherit;}
  .btn-primary{background:#f97316;color:#fff;}
  .btn-ghost{background:#f1f5f9;color:#0b1220;}
  .btn-ghost:hover{background:#e2e8f0;}
  .btn-sm{padding:6px 12px;font-size:12px;}
  table{width:100%;border-collapse:collapse;}
  th,td{padding:8px 10px;border-bottom:1px solid #f1f5f9;font-size:12px;text-align:left;}
  th{color:#64748b;font-weight:800;font-size:10px;letter-spacing:.05em;text-transform:uppercase;background:#f8fafc;position:sticky;top:0;z-index:1;}
  tr:hover td{background:#fafafa;}
  tr:last-child td{border-bottom:none;}
  tfoot td{background:#f8fafc;font-weight:900;border-top:2px solid #e5e7eb;}
  .pill{display:inline-block;padding:2px 9px;border-radius:999px;font-size:11px;font-weight:700;border:1px solid;}
  .empty{padding:48px;text-align:center;color:#94a3b8;}
  .backdrop{position:fixed;inset:0;background:rgba(15,23,42,.45);display:flex;align-items:center;justify-content:center;padding:16px;z-index:100;}
  .modal{width:min(560px,98vw);max-height:92vh;background:#fff;border-radius:16px;display:flex;flex-direction:column;overflow:hidden;box-shadow:0 24px 64px rgba(0,0,0,.25);}
  .modal-h{display:flex;align-items:center;justify-content:space-between;padding:16px 20px;border-bottom:1px solid #e5e7eb;background:#f8fafc;flex-shrink:0;}
  .modal-b{padding:20px;overflow-y:auto;flex:1;}
  .modal-f{display:flex;justify-content:flex-end;gap:10px;padding:14px 20px;border-top:1px solid #e5e7eb;flex-shrink:0;}
  .grid3{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-bottom:12px;}
  .col2{grid-column:span 2;}.col3{grid-column:span 3;}
  .field{display:flex;flex-direction:column;gap:5px;}
  .field label{font-size:10px;font-weight:800;color:#64748b;letter-spacing:.06em;text-transform:uppercase;}
  .field input,.field select,.field textarea{width:100%;border:1px solid #e5e7eb;border-radius:10px;padding:9px 10px;font-size:13px;background:#fff;font-family:inherit;box-sizing:border-box;}
  .recon-section{background:#f0fdf4;border:1px solid #bbf7d0;border-radius:12px;padding:16px;margin-bottom:16px;}
  .recon-variance-ok{color:#15803d;font-weight:900;}
  .recon-variance-short{color:#dc2626;font-weight:900;}
  .recon-variance-over{color:#d97706;font-weight:900;}
  .toast{position:fixed;right:16px;bottom:16px;background:#0b1220;color:#fff;padding:12px 18px;border-radius:12px;font-size:13px;font-weight:600;z-index:999;}
  @media(max-width:640px){.cl-stat-grid{grid-template-columns:repeat(2,1fr);}}
`;

export default function BankPage() {
  const [balances, setBalances]     = useState([]);
  const [creditLines, setCreditLines] = useState([]);
  const [transactions, setTransactions] = useState([]);
  const [activeTab, setActiveTab]   = useState('balances');
  const [modal, setModal]           = useState(null);
  const [txModal, setTxModal]       = useState(null);
  const [filterBank, setFilterBank] = useState('');
  const [txSearch, setTxSearch]     = useState('');
  const [txBank, setTxBank]         = useState('');
  const [txStart, setTxStart]       = useState('');
  const [txEnd, setTxEnd]           = useState('');
  const [saving, setSaving]         = useState(false);
  const [toast, setToast]           = useState('');

  const showToast = msg => { setToast(msg); setTimeout(()=>setToast(''),3000); };

  useEffect(() => {
    const unsub1 = onSnapshot(query(collection(db,'dailyBankBalances'),orderBy('date','desc')), snap => {
      setBalances(snap.docs.map(d=>({id:d.id,...d.data()})));
    });
    const unsub2 = onSnapshot(query(collection(db,'creditLines'),orderBy('displayName','asc')), snap => {
      setCreditLines(snap.docs.map(d=>({id:d.id,...d.data()})));
    });
    const unsub3 = onSnapshot(query(collection(db,'bankTransactions'),orderBy('date','desc')), snap => {
      setTransactions(snap.docs.map(d=>({id:d.id,...d.data()})));
    });
    return () => { unsub1(); unsub2(); unsub3(); };
  }, []);

  /* ── Latest balance per bank ─────────────────────────────── */
  const latestBalances = {};
  balances.forEach(b => {
    if (!latestBalances[b.bankCode] || b.date > latestBalances[b.bankCode].date) {
      latestBalances[b.bankCode] = b;
    }
  });
  const totalBalance = Object.values(latestBalances).reduce((s,b)=>s+(parseFloat(b.ending)||0),0);

  /* ── Save balance entry ──────────────────────────────────── */
  async function saveBalance(form) {
    setSaving(true);
    try {
      const payload = {
        bankCode: form.bankCode||'', date: form.date||'',
        beginning: parseFloat(form.beginning)||0, ending: parseFloat(form.ending)||0,
        notes: form.notes||'', updatedAt: serverTimestamp(), updatedBy: auth.currentUser?.email||'',
      };
      if (form.id) {
        await updateDoc(doc(db,'dailyBankBalances',form.id), payload);
      } else {
        await addDoc(collection(db,'dailyBankBalances'), {...payload, createdAt:serverTimestamp(), createdBy:auth.currentUser?.email||''});
      }
      setModal(null); showToast('Balance entry saved.');
    } catch(e) { console.error(e); alert('Save failed.'); }
    setSaving(false);
  }

  async function deleteBalance(id) {
    if (!confirm('Delete this balance entry?')) return;
    await deleteDoc(doc(db,'dailyBankBalances',id));
    showToast('Deleted.');
  }

  /* ── Save manual transaction ─────────────────────────────── */
  async function saveTx(form) {
    setSaving(true);
    try {
      const payload = {
        bankCode: form.bankCode||'', date: form.date||'',
        description: form.description||'', reference: form.reference||'',
        debit: parseFloat(form.debit)||0, credit: parseFloat(form.credit)||0,
        source: 'Manual', updatedAt: serverTimestamp(), updatedBy: auth.currentUser?.email||'',
      };
      if (form.id) {
        await updateDoc(doc(db,'bankTransactions',form.id), payload);
      } else {
        await addDoc(collection(db,'bankTransactions'), {...payload, createdAt:serverTimestamp(), createdBy:auth.currentUser?.email||''});
      }
      setTxModal(null); showToast('Transaction saved.');
    } catch(e) { console.error(e); alert('Save failed.'); }
    setSaving(false);
  }

  async function deleteTx(id) {
    if (!confirm('Delete this transaction?')) return;
    await deleteDoc(doc(db,'bankTransactions',id));
  }

  const filteredBalances = filterBank ? balances.filter(b=>b.bankCode===filterBank) : balances;
  const filteredTx = transactions.filter(t=>{
    if (txBank && t.bankCode!==txBank) return false;
    if (txStart && t.date < txStart) return false;
    if (txEnd && t.date > txEnd) return false;
    if (txSearch && !((t.description||'').toLowerCase().includes(txSearch.toLowerCase())||(t.reference||'').toLowerCase().includes(txSearch.toLowerCase()))) return false;
    return true;
  });

  const TABS = [{key:'balances',label:'Bank Balances'},{key:'creditlines',label:'Credit Lines'},{key:'transactions',label:'Transactions'},{key:'reconciliation',label:'Reconciliation'}];

  /* ══ Tab: Bank Balances ══════════════════════════════════════ */
  function BalancesTab() {
    return (
      <div>
        <div className="bank-cards">
          {BANKS.map(b=>{
            const lb = latestBalances[b.code];
            return (
              <div key={b.code} className="bank-card" style={{borderLeftColor:b.color}}>
                <div className="bank-card-name">{b.name}</div>
                <div className="bank-card-bal" style={{color:b.color}}>{fmtCur(lb?.ending||0)}</div>
                <div className="bank-card-sub">{lb ? `As of ${lb.date}` : 'No data yet'}</div>
              </div>
            );
          })}
          <div className="bank-card" style={{borderLeftColor:'#0b1220',background:'#f8fafc'}}>
            <div className="bank-card-name">Total</div>
            <div className="bank-card-bal">{fmtCur(totalBalance)}</div>
            <div className="bank-card-sub">{Object.keys(latestBalances).length} bank{Object.keys(latestBalances).length!==1?'s':''} with data</div>
          </div>
        </div>
        <div className="filters">
          <button className="btn btn-primary btn-sm" onClick={()=>setModal({})}>+ Add Entry</button>
          <select value={filterBank} onChange={e=>setFilterBank(e.target.value)}>
            <option value="">All Banks</option>
            {BANKS.map(b=><option key={b.code} value={b.code}>{b.name}</option>)}
          </select>
          <span style={{marginLeft:'auto',fontSize:12,color:'#64748b'}}>{filteredBalances.length} entries</span>
        </div>
        {filteredBalances.length===0?<div className="empty">No balance entries yet.</div>:(
          <div style={{overflowX:'auto'}}>
            <table>
              <thead><tr>
                <th>Date</th><th>Bank</th>
                <th style={{textAlign:'right'}}>Beginning</th><th style={{textAlign:'right'}}>Ending Balance</th>
                <th>Notes</th><th>By</th><th></th>
              </tr></thead>
              <tbody>
                {filteredBalances.map(b=>(
                  <tr key={b.id}>
                    <td style={{fontWeight:600}}>{b.date}</td>
                    <td><span className="pill" style={{background:'#f8fafc',borderColor:'#e2e8f0',color:bankColor(b.bankCode)}}>{bankName(b.bankCode)}</span></td>
                    <td style={{textAlign:'right'}}>{fmtCur(b.beginning)}</td>
                    <td style={{textAlign:'right',fontWeight:700}}>{fmtCur(b.ending)}</td>
                    <td style={{color:'#64748b',maxWidth:200,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{b.notes||'—'}</td>
                    <td style={{color:'#94a3b8',fontSize:11}}>{b.createdBy||b.updatedBy||'—'}</td>
                    <td>
                      <div style={{display:'flex',gap:4}}>
                        <button className="btn btn-ghost btn-sm" onClick={()=>setModal({...b})}>Edit</button>
                        <button onClick={()=>deleteBalance(b.id)} style={{background:'none',border:'none',color:'#dc2626',cursor:'pointer',fontWeight:900,fontSize:13,padding:'3px 5px'}}>✕</button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    );
  }

  /* ══ Tab: Credit Lines ════════════════════════════════════════ */
  function CreditLinesTab() {
    const [clModal, setClModal] = useState(null);
    const [saving2, setSaving2] = useState(false);
    async function saveCl(form) {
      setSaving2(true);
      try {
        const payload = {displayName:form.displayName||'',bankCode:form.bankCode||'',creditLimit:parseFloat(form.creditLimit)||0,availableBalance:parseFloat(form.availableBalance)||0,interestRate:parseFloat(form.interestRate)||0,asOfDate:form.asOfDate||'',notes:form.notes||'',updatedAt:serverTimestamp(),updatedBy:auth.currentUser?.email||''};
        if(form.id){await updateDoc(doc(db,'creditLines',form.id),payload);}
        else{await addDoc(collection(db,'creditLines'),{...payload,createdAt:serverTimestamp(),createdBy:auth.currentUser?.email||''});}
        setClModal(null); showToast('Credit line saved.');
      } catch(e){console.error(e);alert('Save failed.');}
      setSaving2(false);
    }
    return (
      <div>
        <div style={{display:'flex',gap:10,alignItems:'center',marginBottom:14}}>
          <button className="btn btn-primary btn-sm" onClick={()=>setClModal({})}>+ Add Credit Line</button>
          <span style={{marginLeft:'auto',fontSize:12,color:'#64748b'}}>{creditLines.length} credit line{creditLines.length!==1?'s':''}</span>
        </div>
        {creditLines.length===0?<div className="empty">No credit lines. Add credit line accounts to track utilization.</div>:(
          <>
            <div style={{overflowX:'auto',marginBottom:16}}>
              <table>
                <thead><tr>
                  <th>Account Name</th><th>Bank</th>
                  <th style={{textAlign:'right'}}>Credit Limit</th>
                  <th style={{textAlign:'right'}}>Available</th>
                  <th style={{textAlign:'right'}}>Outstanding</th>
                  <th>Utilization</th>
                  <th>Rate/Mo.</th><th>As Of</th><th></th>
                </tr></thead>
                <tbody>
                  {creditLines.map(cl=>{
                    const avail=parseFloat(cl.availableBalance)||0,limit=parseFloat(cl.creditLimit)||0;
                    const outstanding=Math.max(limit-avail,0);
                    const util=limit>0?Math.round((outstanding/limit)*100):0;
                    const rate=parseFloat(cl.interestRate)||0;
                    return (
                      <tr key={cl.id}>
                        <td style={{fontWeight:700}}>{cl.displayName}</td>
                        <td><span className="pill" style={{background:'#f8fafc',borderColor:'#e2e8f0',color:bankColor(cl.bankCode)}}>{bankName(cl.bankCode)}</span></td>
                        <td style={{textAlign:'right'}}>{fmtCur(limit)}</td>
                        <td style={{textAlign:'right',color:'#15803d',fontWeight:700}}>{fmtCur(avail)}</td>
                        <td style={{textAlign:'right',color:outstanding>0?'#dc2626':'#0b1220',fontWeight:700}}>{fmtCur(outstanding)}</td>
                        <td style={{minWidth:100}}>
                          <div style={{display:'flex',alignItems:'center',gap:6}}>
                            <div className="util-bar" style={{flex:1}}><div className="util-fill" style={{width:`${Math.min(util,100)}%`,background:util>80?'#dc2626':util>50?'#f97316':'#15803d'}} /></div>
                            <span style={{fontSize:11,fontWeight:700,color:util>80?'#dc2626':util>50?'#f97316':'#15803d'}}>{util}%</span>
                          </div>
                        </td>
                        <td style={{textAlign:'right',color:'#64748b'}}>{rate>0?`${rate}%`:'—'}</td>
                        <td style={{color:'#64748b',fontSize:11}}>{cl.asOfDate||'—'}</td>
                        <td>
                          <div style={{display:'flex',gap:4}}>
                            <button className="btn btn-ghost btn-sm" onClick={()=>setClModal({...cl})}>Edit</button>
                            <button onClick={async()=>{if(!confirm('Delete?'))return;await deleteDoc(doc(db,'creditLines',cl.id));}} style={{background:'none',border:'none',color:'#dc2626',cursor:'pointer',fontWeight:900,fontSize:13,padding:'3px 5px'}}>✕</button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot><tr>
                  <td colSpan={2}>TOTAL</td>
                  <td style={{textAlign:'right'}}>{fmtCur(creditLines.reduce((s,cl)=>s+(parseFloat(cl.creditLimit)||0),0))}</td>
                  <td style={{textAlign:'right'}}>{fmtCur(creditLines.reduce((s,cl)=>s+(parseFloat(cl.availableBalance)||0),0))}</td>
                  <td style={{textAlign:'right'}}>{fmtCur(creditLines.reduce((s,cl)=>s+Math.max((parseFloat(cl.creditLimit)||0)-(parseFloat(cl.availableBalance)||0),0),0))}</td>
                  <td colSpan={4}></td>
                </tr></tfoot>
              </table>
            </div>
            {clModal!==null&&(
              <div className="backdrop" onClick={e=>e.target===e.currentTarget&&setClModal(null)}>
                <div className="modal">
                  <div className="modal-h"><strong>{clModal.id?'Edit Credit Line':'New Credit Line'}</strong><button className="btn btn-ghost btn-sm" onClick={()=>setClModal(null)}>✕</button></div>
                  <div className="modal-b">
                    {(()=>{
                      const [f,setF]=useState({displayName:'',bankCode:'UBPBPHM',creditLimit:'',availableBalance:'',interestRate:'',asOfDate:'',notes:'',...clModal});
                      const u=(k,v)=>setF(x=>({...x,[k]:v}));
                      return (
                        <div className="grid3">
                          <div className="field col3"><label>Account Name *</label><input value={f.displayName} onChange={e=>u('displayName',e.target.value)} /></div>
                          <div className="field"><label>Bank</label><select value={f.bankCode} onChange={e=>u('bankCode',e.target.value)}>{BANKS.map(b=><option key={b.code} value={b.code}>{b.name}</option>)}</select></div>
                          <div className="field"><label>Credit Limit *</label><input type="number" value={f.creditLimit} onChange={e=>u('creditLimit',e.target.value)} /></div>
                          <div className="field"><label>Available Balance</label><input type="number" value={f.availableBalance} onChange={e=>u('availableBalance',e.target.value)} /></div>
                          <div className="field"><label>Interest Rate /Mo. %</label><input type="number" step="0.01" value={f.interestRate} onChange={e=>u('interestRate',e.target.value)} /></div>
                          <div className="field"><label>As of Date</label><input type="date" value={f.asOfDate} onChange={e=>u('asOfDate',e.target.value)} /></div>
                          <div className="field col3"><label>Notes</label><input value={f.notes} onChange={e=>u('notes',e.target.value)} /></div>
                          <div style={{gridColumn:'span 3',display:'flex',justifyContent:'flex-end',gap:10,marginTop:4}}>
                            <button className="btn btn-ghost" onClick={()=>setClModal(null)}>Cancel</button>
                            <button className="btn btn-primary" disabled={saving2} onClick={()=>{if(!f.displayName.trim()) return alert('Account name required.');saveCl(f);}}>{saving2?'Saving…':f.id?'Save':'Add Credit Line'}</button>
                          </div>
                        </div>
                      );
                    })()}
                  </div>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    );
  }

  /* ══ Tab: Transactions ════════════════════════════════════════ */
  function TransactionsTab() {
    return (
      <div>
        <div className="filters">
          <button className="btn btn-primary btn-sm" onClick={()=>setTxModal({})}>+ Add Transaction</button>
          <select value={txBank} onChange={e=>setTxBank(e.target.value)}>
            <option value="">All Banks</option>
            {BANKS.map(b=><option key={b.code} value={b.code}>{b.name}</option>)}
          </select>
          <input type="date" value={txStart} onChange={e=>setTxStart(e.target.value)} title="From date" />
          <input type="date" value={txEnd} onChange={e=>setTxEnd(e.target.value)} title="To date" />
          <input placeholder="Search description / reference…" value={txSearch} onChange={e=>setTxSearch(e.target.value)} style={{minWidth:180}} />
          {(txBank||txStart||txEnd||txSearch)&&<button className="btn btn-ghost btn-sm" onClick={()=>{setTxBank('');setTxStart('');setTxEnd('');setTxSearch('');}}>Clear</button>}
          <span style={{marginLeft:'auto',fontSize:12,color:'#64748b'}}>{filteredTx.length} transaction{filteredTx.length!==1?'s':''}</span>
        </div>
        {filteredTx.length===0?<div className="empty">No transactions match your filters.</div>:(
          <div style={{overflowX:'auto'}}>
            <table>
              <thead><tr>
                <th>Date</th><th>Bank</th><th>Source</th>
                <th>Description</th><th>Reference</th>
                <th style={{textAlign:'right'}}>Debit (Out)</th>
                <th style={{textAlign:'right'}}>Credit (In)</th>
                <th></th>
              </tr></thead>
              <tbody>
                {filteredTx.map(t=>{
                  const src=t.source||'Manual';
                  const srcStyle={Manual:{bg:'#f1f5f9',border:'#e2e8f0',color:'#475569'},App:{bg:'#eff6ff',border:'#bfdbfe',color:'#1d4ed8'},Stmt:{bg:'#f0fdf4',border:'#bbf7d0',color:'#15803d'}};
                  const sc=srcStyle[src]||srcStyle.Manual;
                  return (
                    <tr key={t.id}>
                      <td style={{fontWeight:600}}>{t.date}</td>
                      <td><span style={{fontSize:10,fontWeight:700,color:bankColor(t.bankCode)}}>{bankName(t.bankCode)}</span></td>
                      <td><span className="pill" style={{background:sc.bg,borderColor:sc.border,color:sc.color,fontSize:9}}>{src}</span></td>
                      <td style={{maxWidth:220,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{t.description||'—'}</td>
                      <td style={{fontFamily:'monospace',fontSize:11,color:'#64748b'}}>{t.reference||'—'}</td>
                      <td style={{textAlign:'right',color:'#dc2626',fontWeight:t.debit>0?700:400}}>{t.debit>0?fmtCur(t.debit):'—'}</td>
                      <td style={{textAlign:'right',color:'#15803d',fontWeight:t.credit>0?700:400}}>{t.credit>0?fmtCur(t.credit):'—'}</td>
                      <td>
                        <div style={{display:'flex',gap:4}}>
                          {src==='Manual'&&<button className="btn btn-ghost btn-sm" onClick={()=>setTxModal({...t})}>Edit</button>}
                          {src==='Manual'&&<button onClick={()=>deleteTx(t.id)} style={{background:'none',border:'none',color:'#dc2626',cursor:'pointer',fontWeight:900,fontSize:13,padding:'3px 5px'}}>✕</button>}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot><tr>
                <td colSpan={5}>TOTAL</td>
                <td style={{textAlign:'right',color:'#dc2626'}}>{fmtCur(filteredTx.reduce((s,t)=>s+(parseFloat(t.debit)||0),0))}</td>
                <td style={{textAlign:'right',color:'#15803d'}}>{fmtCur(filteredTx.reduce((s,t)=>s+(parseFloat(t.credit)||0),0))}</td>
                <td></td>
              </tr></tfoot>
            </table>
          </div>
        )}
      </div>
    );
  }

  /* ══ Tab: Reconciliation ══════════════════════════════════════ */
  function ReconciliationTab() {
    const [reconBank, setReconBank] = useState('');
    const [stmtBal, setStmtBal] = useState('');
    const [bookBal, setBookBal] = useState('');
    const reconEntry = reconBank ? latestBalances[reconBank] : null;
    const stmtBalVal = parseFloat(stmtBal)||0;
    const bookBalVal = parseFloat(bookBal)||(reconEntry ? parseFloat(reconEntry.ending)||0 : 0);
    const variance = stmtBalVal - bookBalVal;
    const isBalanced = Math.abs(variance) < 0.01;
    return (
      <div style={{maxWidth:700}}>
        <p style={{fontSize:13,color:'#64748b',marginTop:0}}>Compare your bank statement balance against your book balance to identify variances.</p>
        <div className="grid3" style={{marginBottom:16}}>
          <div className="field">
            <label>Bank Account</label>
            <select value={reconBank} onChange={e=>setReconBank(e.target.value)}>
              <option value="">— Select Bank —</option>
              {BANKS.map(b=><option key={b.code} value={b.code}>{b.name}</option>)}
            </select>
          </div>
          <div className="field">
            <label>Bank Statement Balance</label>
            <input type="number" step="0.01" value={stmtBal} onChange={e=>setStmtBal(e.target.value)} placeholder="Enter from bank statement" />
          </div>
          <div className="field">
            <label>Book Balance {reconEntry&&`(as of ${reconEntry.date})`}</label>
            <input type="number" step="0.01" value={bookBal} onChange={e=>setBookBal(e.target.value)} placeholder={reconEntry?String(reconEntry.ending||0):'Enter book balance'} />
          </div>
        </div>
        {reconBank&&stmtBal&&(
          <div className={`recon-section`} style={{background:isBalanced?'#f0fdf4':variance<0?'#fef2f2':'#fff7ed',borderColor:isBalanced?'#bbf7d0':variance<0?'#fecaca':'#fed7aa'}}>
            <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:16,marginBottom:12}}>
              <div><div style={{fontSize:10,fontWeight:800,color:'#64748b',textTransform:'uppercase',letterSpacing:'.06em'}}>Statement Balance</div><div style={{fontSize:20,fontWeight:900}}>{fmtCur(stmtBalVal)}</div></div>
              <div><div style={{fontSize:10,fontWeight:800,color:'#64748b',textTransform:'uppercase',letterSpacing:'.06em'}}>Book Balance</div><div style={{fontSize:20,fontWeight:900}}>{fmtCur(bookBalVal)}</div></div>
              <div><div style={{fontSize:10,fontWeight:800,color:'#64748b',textTransform:'uppercase',letterSpacing:'.06em'}}>Variance</div>
                <div className={isBalanced?'recon-variance-ok':variance<0?'recon-variance-short':'recon-variance-over'} style={{fontSize:20}}>
                  {isBalanced?'✅ Balanced':variance<0?`⚠ Shortage: ${fmtCur(Math.abs(variance))}`:`ℹ Overage: ${fmtCur(variance)}`}
                </div>
              </div>
            </div>
            {!isBalanced&&(
              <div style={{fontSize:12,color:'#64748b'}}>
                {variance<0?'Shortage detected: check for missing disbursements, bank charges, or unrecorded payments.':'Overage detected: check for unrecorded collections or floating credits.'}
              </div>
            )}
          </div>
        )}
        {reconBank&&(
          <div>
            <div style={{fontWeight:900,fontSize:13,marginBottom:8}}>Recent Balance History — {bankName(reconBank)}</div>
            <table>
              <thead><tr><th>Date</th><th style={{textAlign:'right'}}>Beginning</th><th style={{textAlign:'right'}}>Ending</th><th>Notes</th></tr></thead>
              <tbody>
                {balances.filter(b=>b.bankCode===reconBank).slice(0,10).map(b=>(
                  <tr key={b.id}>
                    <td>{b.date}</td>
                    <td style={{textAlign:'right'}}>{fmtCur(b.beginning)}</td>
                    <td style={{textAlign:'right',fontWeight:700}}>{fmtCur(b.ending)}</td>
                    <td style={{color:'#64748b'}}>{b.notes||'—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    );
  }

  /* ══ Balance Entry Modal ══════════════════════════════════════ */
  function BalanceModal() {
    const isEdit=!!(modal&&modal.id);
    const [form,setForm]=useState({bankCode:'UBPBPHM',date:'',beginning:'',ending:'',notes:'',...modal});
    const upd=(k,v)=>setForm(f=>({...f,[k]:v}));
    return (
      <div className="backdrop" onClick={e=>e.target===e.currentTarget&&setModal(null)}>
        <div className="modal">
          <div className="modal-h"><strong>{isEdit?'Edit Balance Entry':'New Balance Entry'}</strong><button className="btn btn-ghost btn-sm" onClick={()=>setModal(null)}>✕</button></div>
          <div className="modal-b">
            <div className="grid3">
              <div className="field col2"><label>Bank *</label><select value={form.bankCode} onChange={e=>upd('bankCode',e.target.value)}>{BANKS.map(b=><option key={b.code} value={b.code}>{b.name}</option>)}</select></div>
              <div className="field"><label>Date *</label><input type="date" value={form.date} onChange={e=>upd('date',e.target.value)} /></div>
              <div className="field col2"><label>Ending Balance *</label><input type="number" step="0.01" value={form.ending} onChange={e=>upd('ending',e.target.value)} /></div>
              <div className="field"><label>Beginning Balance</label><input type="number" step="0.01" value={form.beginning} onChange={e=>upd('beginning',e.target.value)} /></div>
              <div className="field col3"><label>Notes</label><input value={form.notes} onChange={e=>upd('notes',e.target.value)} /></div>
            </div>
          </div>
          <div className="modal-f">
            <button className="btn btn-ghost" onClick={()=>setModal(null)}>Cancel</button>
            <button className="btn btn-primary" disabled={saving} onClick={()=>{if(!form.date) return alert('Date required.');if(!(parseFloat(form.ending)>=0)) return alert('Ending balance required.');saveBalance(form);}}>{saving?'Saving…':isEdit?'Save':'Add Entry'}</button>
          </div>
        </div>
      </div>
    );
  }

  /* ══ Transaction Modal ════════════════════════════════════════ */
  function TxFormModal() {
    const isEdit=!!(txModal&&txModal.id);
    const [form,setForm]=useState({bankCode:'UBPBPHM',date:'',description:'',reference:'',debit:'',credit:'',source:'Manual',...txModal});
    const upd=(k,v)=>setForm(f=>({...f,[k]:v}));
    return (
      <div className="backdrop" onClick={e=>e.target===e.currentTarget&&setTxModal(null)}>
        <div className="modal">
          <div className="modal-h"><strong>{isEdit?'Edit Transaction':'New Manual Transaction'}</strong><button className="btn btn-ghost btn-sm" onClick={()=>setTxModal(null)}>✕</button></div>
          <div className="modal-b">
            <div className="grid3">
              <div className="field col2"><label>Bank *</label><select value={form.bankCode} onChange={e=>upd('bankCode',e.target.value)}>{BANKS.map(b=><option key={b.code} value={b.code}>{b.name}</option>)}</select></div>
              <div className="field"><label>Date *</label><input type="date" value={form.date} onChange={e=>upd('date',e.target.value)} /></div>
              <div className="field col3"><label>Description *</label><input value={form.description} onChange={e=>upd('description',e.target.value)} /></div>
              <div className="field col2"><label>Reference</label><input value={form.reference} onChange={e=>upd('reference',e.target.value)} /></div>
              <div className="field"><label>Debit (Out)</label><input type="number" step="0.01" value={form.debit} onChange={e=>upd('debit',e.target.value)} /></div>
              <div className="field"><label>Credit (In)</label><input type="number" step="0.01" value={form.credit} onChange={e=>upd('credit',e.target.value)} /></div>
              <div className="field col3"></div>
            </div>
          </div>
          <div className="modal-f">
            <button className="btn btn-ghost" onClick={()=>setTxModal(null)}>Cancel</button>
            <button className="btn btn-primary" disabled={saving} onClick={()=>{if(!form.date||!form.description.trim()) return alert('Date and description required.');saveTx(form);}}>{saving?'Saving…':isEdit?'Save':'Add Transaction'}</button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="bank-wrap">
      <style>{CSS}</style>
      <div className="bank-topbar">
        <div>
          <h1 style={{margin:0,fontSize:18,fontWeight:900}}>Bank Management</h1>
          <p style={{margin:0,fontSize:12,color:'#64748b'}}>Total balance: <strong>{fmtCur(totalBalance)}</strong> · {balances.length} entries</p>
        </div>
      </div>
      <div className="bank-tabs">
        {TABS.map(t=><button key={t.key} className={`bank-tab${activeTab===t.key?' bank-tab-active':''}`} onClick={()=>setActiveTab(t.key)}>{t.label}</button>)}
      </div>
      <div className="bank-body">
        {activeTab==='balances'&&<BalancesTab />}
        {activeTab==='creditlines'&&<CreditLinesTab />}
        {activeTab==='transactions'&&<TransactionsTab />}
        {activeTab==='reconciliation'&&<ReconciliationTab />}
      </div>
      {modal!==null&&<BalanceModal />}
      {txModal!==null&&<TxFormModal />}
      {toast&&<div className="toast">{toast}</div>}
    </div>
  );
}

import { useState, useEffect } from 'react';
import {
  collection, query, orderBy, onSnapshot, where,
  addDoc, updateDoc, doc, serverTimestamp, deleteDoc
} from 'firebase/firestore';
import { db, auth } from '../../../firebase.js';

const BANK_PALETTE = ['#1e40af','#15803d','#b91c1c','#a16207','#7e22ce','#0e7490','#9a3412','#64748b'];
const fmtPHP = n => new Intl.NumberFormat('en-PH',{minimumFractionDigits:2,maximumFractionDigits:2}).format(n||0);
const fmtCur = n => '₱' + fmtPHP(n);

const CSS = `
  *{box-sizing:border-box;}
  .bank-wrap{display:flex;flex-direction:column;height:100%;overflow:hidden;font-family:Inter,system-ui,sans-serif;}
  .bank-topbar{display:flex;align-items:center;justify-content:space-between;padding:14px 22px 10px;flex-shrink:0;border-bottom:1px solid #e5e7eb;background:#fff;gap:12px;flex-wrap:wrap;}
  .bank-tabs{display:flex;background:#fff;border-bottom:2px solid #e5e7eb;flex-shrink:0;overflow-x:auto;}
  .bank-tab{padding:10px 16px;font-size:12px;font-weight:600;border:none;background:transparent;color:#64748b;cursor:pointer;white-space:nowrap;border-bottom:2px solid transparent;margin-bottom:-2px;font-family:inherit;}
  .bank-tab:hover{color:#0b1220;}
  .bank-tab-active{color:#f97316;border-bottom-color:#f97316;font-weight:800;}
  .bank-body{flex:1;overflow-y:auto;padding:16px 22px;}
  .bank-cards{display:flex;gap:12px;margin-bottom:16px;overflow-x:auto;padding-bottom:4px;}
  .bank-card{background:#fff;border:1px solid #e5e7eb;border-radius:12px;padding:14px 16px;border-top:3px solid;flex-shrink:0;min-width:175px;max-width:215px;}
  .bank-card-code{font-size:10px;font-weight:800;color:#64748b;letter-spacing:.04em;margin-bottom:2px;}
  .bank-card-name{font-size:13px;font-weight:900;color:#0b1220;margin-bottom:10px;line-height:1.3;}
  .bank-card-lbl{font-size:9px;font-weight:800;color:#94a3b8;text-transform:uppercase;letter-spacing:.07em;margin-bottom:1px;}
  .bank-card-bal{font-size:20px;font-weight:900;margin-bottom:6px;}
  .bank-card-book{font-size:14px;font-weight:700;color:#0b1220;margin-bottom:8px;}
  .bank-card-date{font-size:10px;color:#94a3b8;display:flex;align-items:center;gap:4px;}
  .cl-scorecard{background:#fff;border:1px solid #e5e7eb;border-radius:14px;padding:18px 20px;margin-bottom:18px;max-width:540px;}
  .cl-stat-grid{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:12px;}
  .cl-stat-lbl{font-size:9px;font-weight:800;color:#94a3b8;text-transform:uppercase;letter-spacing:.07em;margin-bottom:2px;}
  .cl-stat-val{font-size:20px;font-weight:900;}
  .util-bar{height:6px;background:#e5e7eb;border-radius:999px;overflow:hidden;margin-top:4px;}
  .util-fill{height:100%;border-radius:999px;transition:width .3s;}
  .filter-group{display:flex;flex-direction:column;gap:4px;}
  .filter-label{font-size:10px;font-weight:800;color:#64748b;letter-spacing:.06em;text-transform:uppercase;}
  .filter-group input,.filter-group select{border:1px solid #e5e7eb;border-radius:10px;padding:7px 10px;font-size:12px;background:#fff;font-family:inherit;}
  .filters{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px;align-items:flex-end;}
  .btn{border:0;border-radius:10px;padding:9px 16px;font-weight:700;cursor:pointer;font-size:13px;font-family:inherit;}
  .btn-primary{background:#f97316;color:#fff;}
  .btn-primary:hover{background:#ea6a00;}
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
  .grid3{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;}
  .col2{grid-column:span 2;}.col3{grid-column:span 3;}
  .field{display:flex;flex-direction:column;gap:5px;}
  .field label{font-size:10px;font-weight:800;color:#64748b;letter-spacing:.06em;text-transform:uppercase;}
  .field input,.field select,.field textarea{width:100%;border:1px solid #e5e7eb;border-radius:10px;padding:9px 10px;font-size:13px;background:#fff;font-family:inherit;box-sizing:border-box;}
  .toast{position:fixed;right:16px;bottom:16px;background:#0b1220;color:#fff;padding:12px 18px;border-radius:12px;font-size:13px;font-weight:600;z-index:999;animation:fadeIn .2s;}
  @keyframes fadeIn{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}
  @media(max-width:640px){.cl-stat-grid{grid-template-columns:1fr 1fr;}}
`;

export default function BankPage() {
  const [balances, setBalances]           = useState([]);
  const [creditLines, setCreditLines]     = useState([]);
  const [transactions, setTransactions]   = useState([]);
  const [reconciliations, setReconciliations] = useState([]);
  const [bankAccounts, setBankAccounts]   = useState([]);
  const [activeTab, setActiveTab]         = useState('balances');
  const [modal, setModal]                 = useState(null);
  const [txModal, setTxModal]             = useState(null);
  const [filterBank, setFilterBank]       = useState('');
  const [txSearch, setTxSearch]           = useState('');
  const [txBank, setTxBank]               = useState('');
  const [txStart, setTxStart]             = useState('');
  const [txEnd, setTxEnd]                 = useState('');
  const [saving, setSaving]               = useState(false);
  const [toast, setToast]                 = useState('');
  const [confirmModal, setConfirmModal]   = useState(null);

  /* Derive BANKS from COA subType==='Bank' accounts */
  const BANKS     = bankAccounts.map((a,i) => ({ code:a.code, name:a.name, isCreditLine:a.isCreditLine||false, creditLimit:a.creditLimit||0, interestRate:a.interestRate||0, color:BANK_PALETTE[i%BANK_PALETTE.length] }));
  const bankName  = code => BANKS.find(b=>b.code===code)?.name || code;
  const bankColor = code => BANKS.find(b=>b.code===code)?.color || '#64748b';

  const showToast  = msg => { setToast(msg); setTimeout(()=>setToast(''),3000); };
  const askConfirm = (message, onConfirm) => setConfirmModal({message, onConfirm});

  useEffect(() => {
    const u1 = onSnapshot(query(collection(db,'dailyBankBalances'),orderBy('date','desc')), snap => {
      setBalances(snap.docs.map(d=>({id:d.id,...d.data()})));
    });
    const u2 = onSnapshot(query(collection(db,'creditLines'),orderBy('displayName','asc')), snap => {
      setCreditLines(snap.docs.map(d=>({id:d.id,...d.data()})));
    });
    const u3 = onSnapshot(query(collection(db,'bankTransactions'),orderBy('date','desc')), snap => {
      setTransactions(snap.docs.map(d=>({id:d.id,...d.data()})));
    });
    const u4 = onSnapshot(query(collection(db,'accounts'), where('subType','==','Bank')), snap => {
      setBankAccounts(snap.docs.map(d=>({id:d.id,...d.data()})).sort((a,b)=>(a.code||'').localeCompare(b.code||'')));
    });
    const u5 = onSnapshot(query(collection(db,'bankReconciliations'),orderBy('reconciledAt','desc')), snap => {
      setReconciliations(snap.docs.map(d=>({id:d.id,...d.data()})));
    });
    return () => { u1(); u2(); u3(); u4(); u5(); };
  }, []);

  /* Latest balance per bank */
  const latestBalances = {};
  balances.forEach(b => {
    if (!latestBalances[b.bankCode] || b.date > latestBalances[b.bankCode].date)
      latestBalances[b.bankCode] = b;
  });
  const totalBalance = Object.values(latestBalances).reduce((s,b)=>s+(parseFloat(b.ending)||0),0);

  async function saveBalance(form) {
    setSaving(true);
    try {
      const payload = { bankCode:form.bankCode||'', date:form.date||'', beginning:parseFloat(form.beginning)||0, ending:parseFloat(form.ending)||0, notes:form.notes||'', updatedAt:serverTimestamp(), updatedBy:auth.currentUser?.email||'' };
      if (form.id) await updateDoc(doc(db,'dailyBankBalances',form.id), payload);
      else await addDoc(collection(db,'dailyBankBalances'), {...payload, createdAt:serverTimestamp(), createdBy:auth.currentUser?.email||''});
      setModal(null); showToast('Balance entry saved.');
    } catch(e) { console.error(e); alert('Save failed.'); }
    setSaving(false);
  }

  function deleteBalance(id) {
    askConfirm('Delete this balance entry?', async () => { await deleteDoc(doc(db,'dailyBankBalances',id)); showToast('Deleted.'); });
  }

  async function saveTx(form) {
    setSaving(true);
    try {
      const payload = { bankCode:form.bankCode||'', date:form.date||'', description:form.description||'', reference:form.reference||'', debit:parseFloat(form.debit)||0, credit:parseFloat(form.credit)||0, type:form.type||'', status:form.status||'', source:'Manual', updatedAt:serverTimestamp(), updatedBy:auth.currentUser?.email||'' };
      if (form.id) await updateDoc(doc(db,'bankTransactions',form.id), payload);
      else await addDoc(collection(db,'bankTransactions'), {...payload, createdAt:serverTimestamp(), createdBy:auth.currentUser?.email||''});
      setTxModal(null); showToast('Transaction saved.');
    } catch(e) { console.error(e); alert('Save failed.'); }
    setSaving(false);
  }

  function deleteTx(id) {
    askConfirm('Delete this transaction?', async () => { await deleteDoc(doc(db,'bankTransactions',id)); showToast('Deleted.'); });
  }

  const filteredBalances = filterBank ? balances.filter(b=>b.bankCode===filterBank) : balances;
  const filteredTx = transactions.filter(t => {
    if (txBank && t.bankCode!==txBank) return false;
    if (txStart && t.date<txStart) return false;
    if (txEnd && t.date>txEnd) return false;
    if (txSearch && !((t.description||'').toLowerCase().includes(txSearch.toLowerCase())||(t.reference||'').toLowerCase().includes(txSearch.toLowerCase()))) return false;
    return true;
  });

  const TABS = [
    {key:'balances',      label:'Bank Balances'},
    {key:'creditlines',   label:'Credit Lines'},
    {key:'transactions',  label:'Bank Transactions'},
    {key:'reconciliation',label:'Reconciliation'},
  ];

  /* ════════════════════════════════════════════
   * Tab: Bank Balances
   * ════════════════════════════════════════════ */
  function BalancesTab() {
    return (
      <div>
        <div className="bank-cards">
          {BANKS.map(b => {
            const lb  = latestBalances[b.code];
            const bal = parseFloat(lb?.ending||0);
            return (
              <div key={b.code} className="bank-card" style={{borderTopColor:b.color}}>
                <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start'}}>
                  <div>
                    <div className="bank-card-code">{b.code}</div>
                    <div className="bank-card-name">{b.name}</div>
                  </div>
                  {b.isCreditLine && <span style={{fontSize:9,background:'#fff7ed',border:'1px solid #fed7aa',color:'#c2410c',borderRadius:6,padding:'2px 5px',fontWeight:700,flexShrink:0}}>CL</span>}
                </div>
                <div className="bank-card-lbl">BANK</div>
                <div className="bank-card-bal" style={{color:b.color}}>{fmtCur(bal)}</div>
                <div className="bank-card-lbl">BOOK</div>
                <div className="bank-card-book">{fmtCur(bal)}</div>
                <div className="bank-card-date">
                  {lb ? <><span>📅</span><span>As of {lb.date}</span></> : <span>No balance recorded</span>}
                </div>
              </div>
            );
          })}
          <div className="bank-card" style={{borderTopColor:'#0b1220',background:'#f8fafc',minWidth:160}}>
            <div className="bank-card-code">ALL BANKS</div>
            <div className="bank-card-name">Total</div>
            <div className="bank-card-bal" style={{color:'#0b1220'}}>{fmtCur(totalBalance)}</div>
            <div style={{fontSize:10,color:'#94a3b8'}}>{Object.keys(latestBalances).length} bank{Object.keys(latestBalances).length!==1?'s':''} with data</div>
          </div>
        </div>

        <div className="filters">
          <button className="btn btn-primary btn-sm" onClick={()=>setModal({})}>+ Add Entry</button>
          <select value={filterBank} onChange={e=>setFilterBank(e.target.value)} style={{border:'1px solid #e5e7eb',borderRadius:10,padding:'7px 10px',fontSize:12,background:'#fff',fontFamily:'inherit'}}>
            <option value="">All Banks</option>
            {BANKS.map(b=><option key={b.code} value={b.code}>{b.code} — {b.name}</option>)}
          </select>
          <span style={{marginLeft:'auto',fontSize:12,color:'#64748b'}}>{filteredBalances.length} entries</span>
        </div>

        {filteredBalances.length===0 ? <div className="empty">No balance entries yet.</div> : (
          <div style={{overflowX:'auto'}}>
            <table>
              <thead><tr>
                <th>Date</th><th>Bank</th>
                <th style={{textAlign:'right'}}>Beginning</th>
                <th style={{textAlign:'right'}}>Ending Balance</th>
                <th>Notes</th><th>By</th><th></th>
              </tr></thead>
              <tbody>
                {filteredBalances.map(b=>(
                  <tr key={b.id}>
                    <td style={{fontWeight:600}}>{b.date}</td>
                    <td>
                      <div style={{fontWeight:700,color:bankColor(b.bankCode),fontSize:11}}>{b.bankCode}</div>
                      <div style={{fontSize:11,color:'#64748b'}}>{bankName(b.bankCode)}</div>
                    </td>
                    <td style={{textAlign:'right'}}>{fmtCur(b.beginning)}</td>
                    <td style={{textAlign:'right',fontWeight:700,color:bankColor(b.bankCode)}}>{fmtCur(b.ending)}</td>
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

  /* ════════════════════════════════════════════
   * Tab: Credit Lines
   * ════════════════════════════════════════════ */
  function CreditLinesTab() {
    const [clModal, setClModal] = useState(null);
    const [saving2, setSaving2] = useState(false);
    const [selCl, setSelCl]     = useState(null);
    const displayCl = selCl || creditLines[0] || null;

    async function saveCl(form) {
      setSaving2(true);
      try {
        const payload = { displayName:form.displayName||'', bankCode:form.bankCode||'', creditLimit:parseFloat(form.creditLimit)||0, availableBalance:parseFloat(form.availableBalance)||0, interestRate:parseFloat(form.interestRate)||0, asOfDate:form.asOfDate||'', notes:form.notes||'', updatedAt:serverTimestamp(), updatedBy:auth.currentUser?.email||'' };
        if (form.id) await updateDoc(doc(db,'creditLines',form.id),payload);
        else await addDoc(collection(db,'creditLines'),{...payload,createdAt:serverTimestamp(),createdBy:auth.currentUser?.email||''});
        setClModal(null); showToast('Credit line saved.');
      } catch(e) { console.error(e); alert('Save failed.'); }
      setSaving2(false);
    }

    return (
      <div>
        <div style={{display:'flex',gap:10,alignItems:'center',marginBottom:14}}>
          <button className="btn btn-primary btn-sm" onClick={()=>setClModal({})}>+ Add Credit Line</button>
          <span style={{marginLeft:'auto',fontSize:12,color:'#64748b'}}>{creditLines.length} credit line{creditLines.length!==1?'s':''}</span>
        </div>

        {creditLines.length===0 ? <div className="empty">No credit lines. Add credit line accounts to track utilization.</div> : (
          <>
            {/* Summary Scorecard */}
            {displayCl && (() => {
              const avail=parseFloat(displayCl.availableBalance)||0, limit=parseFloat(displayCl.creditLimit)||0;
              const outstanding=Math.max(limit-avail,0), util=limit>0?outstanding/limit*100:0;
              const rate=parseFloat(displayCl.interestRate)||0;
              return (
                <div className="cl-scorecard">
                  <div style={{fontSize:13,fontWeight:800,color:'#64748b',marginBottom:14}}>{displayCl.bankCode} — {displayCl.displayName}</div>
                  <div className="cl-stat-grid">
                    <div><div className="cl-stat-lbl">CREDIT LIMIT</div><div className="cl-stat-val">{fmtCur(limit)}</div></div>
                    <div><div className="cl-stat-lbl">AVAILABLE</div><div className="cl-stat-val" style={{color:'#15803d'}}>{fmtCur(avail)}</div></div>
                    <div><div className="cl-stat-lbl">OUTSTANDING LIABILITY</div><div className="cl-stat-val" style={{color:'#dc2626'}}>{fmtCur(outstanding)}</div></div>
                    <div>
                      <div className="cl-stat-lbl">UTILIZATION</div>
                      <div className="cl-stat-val" style={{color:util>80?'#dc2626':util>50?'#f97316':'#15803d'}}>{util.toFixed(1)}%</div>
                      <div className="util-bar"><div className="util-fill" style={{width:`${Math.min(util,100)}%`,background:util>80?'#dc2626':util>50?'#f97316':'#15803d'}}/></div>
                    </div>
                  </div>
                  {rate>0&&<div style={{fontSize:11,fontWeight:700,color:'#64748b',marginBottom:4}}>INTEREST RATE / MONTH: {rate}%</div>}
                  {displayCl.asOfDate&&<div style={{fontSize:10,color:'#94a3b8'}}>Available balance as of {displayCl.asOfDate}</div>}
                </div>
              );
            })()}

            {/* Table */}
            <div style={{overflowX:'auto',marginBottom:28}}>
              <table>
                <thead><tr>
                  <th>Credit Line Account</th>
                  <th style={{textAlign:'right'}}>Credit Limit</th>
                  <th style={{textAlign:'right'}}>Int. Rate/Mo</th>
                  <th style={{textAlign:'right'}}>Available Credit</th>
                  <th style={{textAlign:'right'}}>Outstanding Liability</th>
                  <th>Utilization</th><th>Last Updated</th><th></th>
                </tr></thead>
                <tbody>
                  {creditLines.map(cl=>{
                    const avail=parseFloat(cl.availableBalance)||0,limit=parseFloat(cl.creditLimit)||0;
                    const outstanding=Math.max(limit-avail,0), util=limit>0?outstanding/limit*100:0;
                    const rate=parseFloat(cl.interestRate)||0;
                    return (
                      <tr key={cl.id} style={{cursor:'pointer'}} onClick={()=>setSelCl(cl)}>
                        <td style={{fontWeight:700}}>{cl.bankCode?`${cl.bankCode} — `:''}{cl.displayName}</td>
                        <td style={{textAlign:'right',fontWeight:700}}>{fmtCur(limit)}</td>
                        <td style={{textAlign:'right',color:'#64748b'}}>{rate>0?`${rate}%`:'—'}</td>
                        <td style={{textAlign:'right',color:'#15803d',fontWeight:700}}>{fmtCur(avail)}</td>
                        <td style={{textAlign:'right',color:outstanding>0?'#dc2626':'#0b1220',fontWeight:700}}>{fmtCur(outstanding)}</td>
                        <td style={{minWidth:120}}>
                          <div style={{display:'flex',alignItems:'center',gap:6}}>
                            <div className="util-bar" style={{flex:1}}><div className="util-fill" style={{width:`${Math.min(util,100)}%`,background:util>80?'#dc2626':util>50?'#f97316':'#15803d'}}/></div>
                            <span style={{fontSize:11,fontWeight:700,color:util>80?'#dc2626':util>50?'#f97316':'#15803d',minWidth:36}}>{util.toFixed(1)}%</span>
                          </div>
                        </td>
                        <td style={{color:'#64748b',fontSize:11}}>{cl.asOfDate||'—'}</td>
                        <td onClick={e=>e.stopPropagation()}>
                          <div style={{display:'flex',gap:4}}>
                            <button className="btn btn-ghost btn-sm" onClick={()=>setClModal({...cl})}>Edit</button>
                            <button onClick={()=>askConfirm('Delete this credit line?',async()=>{await deleteDoc(doc(db,'creditLines',cl.id));})} style={{background:'none',border:'none',color:'#dc2626',cursor:'pointer',fontWeight:900,fontSize:13,padding:'3px 5px'}}>✕</button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot><tr>
                  <td>TOTAL</td>
                  <td style={{textAlign:'right'}}>{fmtCur(creditLines.reduce((s,cl)=>s+(parseFloat(cl.creditLimit)||0),0))}</td>
                  <td></td>
                  <td style={{textAlign:'right'}}>{fmtCur(creditLines.reduce((s,cl)=>s+(parseFloat(cl.availableBalance)||0),0))}</td>
                  <td style={{textAlign:'right'}}>{fmtCur(creditLines.reduce((s,cl)=>s+Math.max((parseFloat(cl.creditLimit)||0)-(parseFloat(cl.availableBalance)||0),0),0))}</td>
                  <td colSpan={3}></td>
                </tr></tfoot>
              </table>
            </div>

            {/* Monthly Interest Schedule */}
            {displayCl && (() => {
              const limit=parseFloat(displayCl.creditLimit)||0, avail=parseFloat(displayCl.availableBalance)||0;
              const utilized=Math.max(limit-avail,0), rate=parseFloat(displayCl.interestRate)||0;
              const monthlyInt=utilized*(rate/100), asOf=displayCl.asOfDate||'';
              let dueDate='';
              if(asOf){const d=new Date(asOf);d.setDate(d.getDate()+18);dueDate=d.toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'});}
              return (
                <div>
                  <div style={{fontSize:10,fontWeight:900,color:'#64748b',textTransform:'uppercase',letterSpacing:'.07em',marginBottom:10,display:'flex',alignItems:'center',gap:6}}>
                    <span>📅</span> MONTHLY INTEREST SCHEDULE — {displayCl.bankCode} — {displayCl.displayName} ({rate}%/MO)
                  </div>
                  <table>
                    <thead><tr>
                      <th>Month-End Date</th>
                      <th style={{textAlign:'right'}}>Available (Balance)</th>
                      <th style={{textAlign:'right'}}>Utilized Amount</th>
                      <th style={{textAlign:'right'}}>Monthly Interest</th>
                      <th>Interest Due Date</th>
                    </tr></thead>
                    <tbody>
                      {asOf ? (
                        <tr>
                          <td>{new Date(asOf).toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'})}</td>
                          <td style={{textAlign:'right',color:'#15803d',fontWeight:700}}>{fmtCur(avail)}</td>
                          <td style={{textAlign:'right',color:'#dc2626',fontWeight:700}}>{fmtCur(utilized)}</td>
                          <td style={{textAlign:'right',color:'#dc2626',fontWeight:700}}>{fmtCur(monthlyInt)}</td>
                          <td style={{color:'#64748b'}}>{dueDate}</td>
                        </tr>
                      ) : <tr><td colSpan={5} className="empty" style={{padding:'20px'}}>No date set for this credit line.</td></tr>}
                    </tbody>
                  </table>
                </div>
              );
            })()}
          </>
        )}

        {/* Credit Line Modal */}
        {clModal!==null&&(
          <div className="backdrop" onClick={e=>e.target===e.currentTarget&&setClModal(null)}>
            <div className="modal">
              <div className="modal-h"><strong>{clModal.id?'Edit Credit Line':'New Credit Line'}</strong><button className="btn btn-ghost btn-sm" onClick={()=>setClModal(null)}>✕</button></div>
              <div className="modal-b">
                {(()=>{
                  const [f,setF]=useState({displayName:'',bankCode:BANKS[0]?.code||'',creditLimit:'',availableBalance:'',interestRate:'',asOfDate:'',notes:'',...clModal});
                  const u=(k,v)=>setF(x=>({...x,[k]:v}));
                  return (
                    <div className="grid3">
                      <div className="field col3"><label>Account Name *</label><input value={f.displayName} onChange={e=>u('displayName',e.target.value)} /></div>
                      <div className="field"><label>Bank</label><select value={f.bankCode} onChange={e=>u('bankCode',e.target.value)}>{BANKS.map(b=><option key={b.code} value={b.code}>{b.code} — {b.name}</option>)}</select></div>
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
      </div>
    );
  }

  /* ════════════════════════════════════════════
   * Tab: Bank Transactions
   * ════════════════════════════════════════════ */
  function TransactionsTab() {
    return (
      <div>
        <div className="filters">
          <div className="filter-group">
            <div className="filter-label">Bank Account</div>
            <select value={txBank} onChange={e=>setTxBank(e.target.value)} style={{minWidth:160}}>
              <option value="">Select Bank...</option>
              {BANKS.map(b=><option key={b.code} value={b.code}>{b.name}</option>)}
            </select>
          </div>
          <div className="filter-group">
            <div className="filter-label">From</div>
            <input type="date" value={txStart} onChange={e=>setTxStart(e.target.value)} />
          </div>
          <div className="filter-group">
            <div className="filter-label">To</div>
            <input type="date" value={txEnd} onChange={e=>setTxEnd(e.target.value)} />
          </div>
          <div className="filter-group" style={{flex:1,minWidth:180}}>
            <div className="filter-label">Search</div>
            <input placeholder="Description, Reference..." value={txSearch} onChange={e=>setTxSearch(e.target.value)} style={{width:'100%'}} />
          </div>
          {(txBank||txStart||txEnd||txSearch)&&<button className="btn btn-ghost" style={{alignSelf:'flex-end'}} onClick={()=>{setTxBank('');setTxStart('');setTxEnd('');setTxSearch('');}}>Clear</button>}
          <button className="btn btn-ghost" style={{alignSelf:'flex-end'}} onClick={()=>setTxModal({})}>+ Add Transaction</button>
          <button className="btn btn-primary" style={{alignSelf:'flex-end',display:'flex',alignItems:'center',gap:6}}>↑ Upload Statement</button>
          <span style={{marginLeft:'auto',fontSize:12,color:'#64748b',alignSelf:'flex-end'}}>{filteredTx.length} transaction{filteredTx.length!==1?'s':''}</span>
        </div>

        {filteredTx.length===0 ? (
          <div className="empty">{txBank?'No transactions match your filters.':'Select a bank account to view transactions.'}</div>
        ) : (
          <div style={{overflowX:'auto'}}>
            <table>
              <thead><tr>
                <th>Date</th><th>Source</th><th>Description</th><th>Reference</th>
                <th style={{textAlign:'right'}}>Debit (In)</th>
                <th style={{textAlign:'right'}}>Credit (Out)</th>
                <th style={{textAlign:'right'}}>Balance</th>
                <th>Type</th><th>Status</th><th></th>
              </tr></thead>
              <tbody>
                {(()=>{
                  const sorted=[...filteredTx].sort((a,b)=>a.date<b.date?-1:a.date>b.date?1:0);
                  let run=0;
                  const withBal=sorted.map(t=>{run+=(parseFloat(t.debit)||0)-(parseFloat(t.credit)||0);return{...t,runBal:run};}).reverse();
                  return withBal.map(t=>{
                    const src=t.source||'Manual';
                    const sc=src==='Manual'?{bg:'#f1f5f9',bd:'#e2e8f0',c:'#475569'}:src==='Stmt'?{bg:'#f0fdf4',bd:'#bbf7d0',c:'#15803d'}:{bg:'#eff6ff',bd:'#bfdbfe',c:'#1d4ed8'};
                    return (
                      <tr key={t.id}>
                        <td style={{fontWeight:600}}>{t.date}</td>
                        <td><span className="pill" style={{background:sc.bg,borderColor:sc.bd,color:sc.c,fontSize:9}}>{src}</span></td>
                        <td style={{maxWidth:220,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{t.description||'—'}</td>
                        <td style={{fontFamily:'monospace',fontSize:11,color:'#64748b'}}>{t.reference||'—'}</td>
                        <td style={{textAlign:'right',color:'#15803d',fontWeight:t.debit>0?700:400}}>{t.debit>0?fmtCur(t.debit):'—'}</td>
                        <td style={{textAlign:'right',color:'#dc2626',fontWeight:t.credit>0?700:400}}>{t.credit>0?fmtCur(t.credit):'—'}</td>
                        <td style={{textAlign:'right',fontWeight:700,color:'#0b1220'}}>{fmtCur(t.runBal)}</td>
                        <td style={{color:'#64748b',fontSize:11}}>{t.type||'—'}</td>
                        <td>{t.status&&<span className="pill" style={{background:'#f0fdf4',borderColor:'#bbf7d0',color:'#15803d',fontSize:9}}>{t.status}</span>}</td>
                        <td>
                          <div style={{display:'flex',gap:4}}>
                            {src==='Manual'&&<button className="btn btn-ghost btn-sm" onClick={()=>setTxModal({...t})}>Edit</button>}
                            {src==='Manual'&&<button onClick={()=>deleteTx(t.id)} style={{background:'none',border:'none',color:'#dc2626',cursor:'pointer',fontWeight:900,fontSize:13,padding:'3px 5px'}}>✕</button>}
                          </div>
                        </td>
                      </tr>
                    );
                  });
                })()}
              </tbody>
              <tfoot><tr>
                <td colSpan={4}>TOTAL</td>
                <td style={{textAlign:'right',color:'#15803d'}}>{fmtCur(filteredTx.reduce((s,t)=>s+(parseFloat(t.debit)||0),0))}</td>
                <td style={{textAlign:'right',color:'#dc2626'}}>{fmtCur(filteredTx.reduce((s,t)=>s+(parseFloat(t.credit)||0),0))}</td>
                <td colSpan={4}></td>
              </tr></tfoot>
            </table>
          </div>
        )}
      </div>
    );
  }

  /* ════════════════════════════════════════════
   * Tab: Reconciliation
   * ════════════════════════════════════════════ */
  function ReconciliationTab() {
    const [reconBank, setReconBank]     = useState('');
    const [stmtBal,   setStmtBal]       = useState('');
    const [stmtDate,  setStmtDate]      = useState('');
    const [reconSaving, setReconSaving] = useState(false);

    const lastRecon  = reconBank ? reconciliations.filter(r=>r.bankCode===reconBank).sort((a,b)=>b.periodEnding>a.periodEnding?1:-1)[0] : null;
    const beginBal   = lastRecon ? parseFloat(lastRecon.endingBalance)||0 : null;
    const bankRecons = reconBank ? reconciliations.filter(r=>r.bankCode===reconBank) : [];

    async function startRecon() {
      if(!reconBank) return alert('Select a bank account.');
      if(!stmtBal)   return alert('Enter statement ending balance.');
      if(!stmtDate)  return alert('Enter statement ending date.');
      setReconSaving(true);
      try {
        await addDoc(collection(db,'bankReconciliations'),{bankCode:reconBank,beginningBalance:beginBal||0,endingBalance:parseFloat(stmtBal)||0,periodEnding:stmtDate,clearedCount:0,reconciledAt:serverTimestamp(),reconciledBy:auth.currentUser?.email||''});
        showToast('Reconciliation saved.'); setStmtBal(''); setStmtDate('');
      } catch(e) { console.error(e); alert('Save failed.'); }
      setReconSaving(false);
    }

    return (
      <div style={{maxWidth:640,margin:'0 auto',paddingTop:8}}>
        <h2 style={{fontSize:20,fontWeight:900,margin:'0 0 6px',color:'#0b1220'}}>Bank Reconciliation</h2>
        <p style={{fontSize:13,color:'#64748b',margin:'0 0 22px'}}>Select an account and enter your bank statement details to begin.</p>

        <div style={{background:'#fff',border:'1px solid #e5e7eb',borderRadius:14,padding:'22px',marginBottom:24}}>
          <div style={{marginBottom:14}}>
            <div className="filter-label" style={{marginBottom:5}}>Account</div>
            <select style={{width:'100%',border:'1px solid #e5e7eb',borderRadius:10,padding:'9px 10px',fontSize:13,fontFamily:'inherit'}} value={reconBank} onChange={e=>setReconBank(e.target.value)}>
              <option value="">Select Bank...</option>
              {BANKS.map(b=><option key={b.code} value={b.code}>{b.code} — {b.name}</option>)}
            </select>
          </div>
          <div style={{background:'#f8fafc',border:'1px solid #e5e7eb',borderRadius:10,padding:'12px 14px',marginBottom:14}}>
            <div className="filter-label" style={{marginBottom:4}}>Beginning Balance</div>
            <div style={{fontSize:18,fontWeight:900,color:'#0b1220'}}>{beginBal!=null?fmtCur(beginBal):'—'}</div>
            {lastRecon&&<div style={{fontSize:10,color:'#94a3b8',marginTop:2}}>From last reconciliation ending {lastRecon.periodEnding}</div>}
          </div>
          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:12,marginBottom:20}}>
            <div>
              <div className="filter-label" style={{marginBottom:5}}>Statement Ending Balance</div>
              <input type="number" step="0.01" placeholder="0.00" value={stmtBal} onChange={e=>setStmtBal(e.target.value)} style={{width:'100%',border:'1px solid #e5e7eb',borderRadius:10,padding:'9px 10px',fontSize:13,fontFamily:'inherit',boxSizing:'border-box'}} />
            </div>
            <div>
              <div className="filter-label" style={{marginBottom:5}}>Statement Ending Date</div>
              <input type="date" value={stmtDate} onChange={e=>setStmtDate(e.target.value)} style={{width:'100%',border:'1px solid #e5e7eb',borderRadius:10,padding:'9px 10px',fontSize:13,fontFamily:'inherit',boxSizing:'border-box'}} />
            </div>
          </div>
          <button className="btn btn-primary" style={{width:'100%',padding:'13px',fontSize:14,borderRadius:10}} disabled={reconSaving} onClick={startRecon}>
            {reconSaving?'Saving…':'▶ Start Reconciling'}
          </button>
        </div>

        <div>
          <div style={{fontSize:10,fontWeight:900,color:'#64748b',textTransform:'uppercase',letterSpacing:'.07em',marginBottom:10}}>Previous Reconciliations</div>
          <table>
            <thead><tr>
              <th>Date Reconciled</th><th>Period Ending</th>
              <th style={{textAlign:'right'}}>Ending Balance</th>
              <th style={{textAlign:'right'}}># Cleared</th><th>By</th>
            </tr></thead>
            <tbody>
              {bankRecons.length===0 ? (
                <tr><td colSpan={5} style={{textAlign:'center',color:'#94a3b8',padding:'20px'}}>Select a bank account to view history.</td></tr>
              ) : bankRecons.map(r=>(
                <tr key={r.id}>
                  <td style={{color:'#64748b',fontSize:11}}>{r.reconciledAt?.toDate?.()?.toLocaleDateString('en-US')||'—'}</td>
                  <td style={{fontWeight:600}}>{r.periodEnding||'—'}</td>
                  <td style={{textAlign:'right',fontWeight:700}}>{fmtCur(r.endingBalance)}</td>
                  <td style={{textAlign:'right',color:'#64748b'}}>{r.clearedCount||0}</td>
                  <td style={{color:'#94a3b8',fontSize:11}}>{r.reconciledBy||'—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    );
  }
  /* ════════════════════════════════════════════
   * Balance Entry Modal
   * ════════════════════════════════════════════ */
  function BalanceModal() {
    const isEdit = !!(modal&&modal.id);
    const [form,setForm] = useState({bankCode:BANKS[0]?.code||'',date:'',beginning:'',ending:'',notes:'',...modal});
    const upd = (k,v) => setForm(f=>({...f,[k]:v}));
    return (
      <div className="backdrop" onClick={e=>e.target===e.currentTarget&&setModal(null)}>
        <div className="modal">
          <div className="modal-h"><strong>{isEdit?'Edit Balance Entry':'New Balance Entry'}</strong><button className="btn btn-ghost btn-sm" onClick={()=>setModal(null)}>✕</button></div>
          <div className="modal-b">
            <div className="grid3">
              <div className="field col2"><label>Bank *</label><select value={form.bankCode} onChange={e=>upd('bankCode',e.target.value)}>{BANKS.map(b=><option key={b.code} value={b.code}>{b.code} — {b.name}</option>)}</select></div>
              <div className="field"><label>Date *</label><input type="date" value={form.date} onChange={e=>upd('date',e.target.value)} /></div>
              <div className="field col2"><label>Ending Balance *</label><input type="number" step="0.01" value={form.ending} onChange={e=>upd('ending',e.target.value)} /></div>
              <div className="field"><label>Beginning Balance</label><input type="number" step="0.01" value={form.beginning} onChange={e=>upd('beginning',e.target.value)} /></div>
              <div className="field col3"><label>Notes</label><input value={form.notes} onChange={e=>upd('notes',e.target.value)} /></div>
            </div>
          </div>
          <div className="modal-f">
            <button className="btn btn-ghost" onClick={()=>setModal(null)}>Cancel</button>
            <button className="btn btn-primary" disabled={saving} onClick={()=>{if(!form.date) return alert('Date required.');if(!(parseFloat(form.ending)>=0)) return alert('Ending balance required.');saveBalance(form);}}>
              {saving?'Saving…':isEdit?'Save':'Add Entry'}
            </button>
          </div>
        </div>
      </div>
    );
  }

  /* ════════════════════════════════════════════
   * Transaction Modal
   * ════════════════════════════════════════════ */
  function TxFormModal() {
    const isEdit = !!(txModal&&txModal.id);
    const [form,setForm] = useState({bankCode:BANKS[0]?.code||'',date:'',description:'',reference:'',debit:'',credit:'',type:'',status:'',...txModal});
    const upd = (k,v) => setForm(f=>({...f,[k]:v}));
    return (
      <div className="backdrop" onClick={e=>e.target===e.currentTarget&&setTxModal(null)}>
        <div className="modal">
          <div className="modal-h"><strong>{isEdit?'Edit Transaction':'New Manual Transaction'}</strong><button className="btn btn-ghost btn-sm" onClick={()=>setTxModal(null)}>✕</button></div>
          <div className="modal-b">
            <div className="grid3">
              <div className="field col2"><label>Bank *</label><select value={form.bankCode} onChange={e=>upd('bankCode',e.target.value)}>{BANKS.map(b=><option key={b.code} value={b.code}>{b.code} — {b.name}</option>)}</select></div>
              <div className="field"><label>Date *</label><input type="date" value={form.date} onChange={e=>upd('date',e.target.value)} /></div>
              <div className="field col3"><label>Description *</label><input value={form.description} onChange={e=>upd('description',e.target.value)} /></div>
              <div className="field col2"><label>Reference</label><input value={form.reference} onChange={e=>upd('reference',e.target.value)} /></div>
              <div className="field"><label>Type</label><input value={form.type} onChange={e=>upd('type',e.target.value)} placeholder="e.g. Debit" /></div>
              <div className="field"><label>Debit (In)</label><input type="number" step="0.01" value={form.debit} onChange={e=>upd('debit',e.target.value)} /></div>
              <div className="field"><label>Credit (Out)</label><input type="number" step="0.01" value={form.credit} onChange={e=>upd('credit',e.target.value)} /></div>
              <div className="field"><label>Status</label><input value={form.status} onChange={e=>upd('status',e.target.value)} placeholder="e.g. Cleared" /></div>
            </div>
          </div>
          <div className="modal-f">
            <button className="btn btn-ghost" onClick={()=>setTxModal(null)}>Cancel</button>
            <button className="btn btn-primary" disabled={saving} onClick={()=>{if(!form.date||!form.description.trim()) return alert('Date and description required.');saveTx(form);}}>
              {saving?'Saving…':isEdit?'Save':'Add Transaction'}
            </button>
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
        </div>
      </div>
      <div className="bank-tabs">
        {TABS.map(t=><button key={t.key} className={`bank-tab${activeTab===t.key?' bank-tab-active':''}`} onClick={()=>setActiveTab(t.key)}>{t.label}</button>)}
      </div>
      <div className="bank-body">
        {activeTab==='balances'       && <BalancesTab />}
        {activeTab==='creditlines'    && <CreditLinesTab />}
        {activeTab==='transactions'   && <TransactionsTab />}
        {activeTab==='reconciliation' && <ReconciliationTab />}
      </div>
      {modal!==null   && <BalanceModal />}
      {txModal!==null && <TxFormModal />}
      {confirmModal && (
        <div className="backdrop" onClick={()=>setConfirmModal(null)}>
          <div style={{width:'min(400px,98vw)',background:'#fff',borderRadius:16,overflow:'hidden',boxShadow:'0 24px 64px rgba(0,0,0,.25)'}} onClick={e=>e.stopPropagation()}>
            <div style={{padding:'14px 18px',borderBottom:'1px solid #e5e7eb',background:'#f8fafc',display:'flex',alignItems:'center',justifyContent:'space-between'}}>
              <strong style={{fontSize:14,fontWeight:900,color:'#0b1220'}}>Confirm Action</strong>
              <button className="btn btn-ghost btn-sm" onClick={()=>setConfirmModal(null)}>✕</button>
            </div>
            <div style={{padding:'18px'}}><p style={{margin:0,fontSize:14,color:'#0b1220',lineHeight:1.5}}>{confirmModal.message}</p></div>
            <div style={{display:'flex',justifyContent:'flex-end',gap:10,padding:'12px 18px',borderTop:'1px solid #e5e7eb'}}>
              <button className="btn btn-ghost" onClick={()=>setConfirmModal(null)}>Cancel</button>
              <button className="btn btn-primary" style={{background:'#dc2626'}} onClick={()=>{confirmModal.onConfirm();setConfirmModal(null);}}>Confirm</button>
            </div>
          </div>
        </div>
      )}
      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}

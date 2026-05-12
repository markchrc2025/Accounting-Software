import { useState, useEffect, useRef } from 'react';
import {
  collection, query, orderBy, onSnapshot,
  addDoc, updateDoc, doc, serverTimestamp, deleteDoc
} from 'firebase/firestore';
import { db, auth } from '../../../firebase.js';

const CATEGORIES = ['Rent','Utilities','Insurance','Salaries','Loan Payment','Subscription','Tax','Other'];
const FREQS = ['Monthly','Quarterly','Semi-Annual','Annual','One-Time'];
const STATUSES = ['Active','Cancelled'];
const PM_METHODS = ['','Check','Bank Transfer','Auto-Debit'];
const MONTH_NAMES = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const CAT_COLORS = {
  Rent:'#eff6ff:#bfdbfe:#1d4ed8',Utilities:'#fef9c3:#fde68a:#a16207',
  Insurance:'#f0fdf4:#bbf7d0:#15803d','Loan Payment':'#fdf4ff:#e9d5ff:#7e22ce',
  Salaries:'#fff7ed:#fed7aa:#c2410c',Subscription:'#f8fafc:#e2e8f0:#475569',
  Tax:'#fef2f2:#fecaca:#b91c1c',Other:'#f1f5f9:#e2e8f0:#64748b',
};
function catStyle(cat) {
  const s = CAT_COLORS[cat]||CAT_COLORS.Other;
  const [bg,border,color] = s.split(':');
  return {background:bg,borderColor:border,color};
}

const fmtPHP = n => new Intl.NumberFormat('en-PH',{minimumFractionDigits:2,maximumFractionDigits:2}).format(n||0);
const fmtCur = n => '₱' + fmtPHP(n);

function nextOccurrence(s) {
  if (s.frequency === 'One-Time') return s.dueDate || null;
  const today = new Date(); today.setHours(0,0,0,0);
  const start = s.startDate ? new Date(s.startDate) : (s.dueDate ? new Date(s.dueDate) : null);
  if (!start || isNaN(start)) return null;
  const dueDay = parseInt(s.dueDay) || start.getDate();
  const freqMos = {Monthly:1, Quarterly:3, 'Semi-Annual':6, Annual:12}[s.frequency] || 1;
  let d = new Date(start.getFullYear(), start.getMonth(), dueDay);
  while (d < today) d = new Date(d.getFullYear(), d.getMonth() + freqMos, dueDay);
  if (s.endDate) {
    const end = new Date(s.endDate);
    if (d > end) return null;
  }
  return d.toISOString().substring(0,10);
}

function occurrencesInMonth(s, year, month) {
  if (s.status === 'Cancelled') return [];
  if (s.frequency === 'One-Time') {
    const d = s.dueDate;
    if (d && d.startsWith(year+'-'+String(month+1).padStart(2,'0'))) return [d];
    return [];
  }
  const start = s.startDate ? new Date(s.startDate) : (s.dueDate ? new Date(s.dueDate) : null);
  if (!start || isNaN(start)) return [];
  const dueDay = parseInt(s.dueDay) || start.getDate();
  const freqMos = {Monthly:1, Quarterly:3, 'Semi-Annual':6, Annual:12}[s.frequency] || 1;
  const results = [];
  let d = new Date(start.getFullYear(), start.getMonth(), dueDay);
  const endDate = s.endDate ? new Date(s.endDate) : new Date(year+12, 11, 31);
  const periodStart = new Date(year, month, 1), periodEnd = new Date(year, month+1, 0);
  while (d <= endDate) {
    if (d >= periodStart && d <= periodEnd) results.push(d.toISOString().substring(0,10));
    d = new Date(d.getFullYear(), d.getMonth() + freqMos, dueDay);
    if (d.getFullYear() > year + 1) break;
  }
  return results;
}

const CSS = `
  .ps-wrap{display:flex;flex-direction:column;height:100%;overflow:hidden;font-family:Inter,system-ui,sans-serif;}
  .ps-topbar{display:flex;align-items:center;justify-content:space-between;padding:14px 22px 10px;flex-shrink:0;border-bottom:1px solid #e5e7eb;background:#fff;gap:12px;flex-wrap:wrap;}
  .ps-tabs{display:flex;background:#fff;border-bottom:2px solid #e5e7eb;flex-shrink:0;overflow-x:auto;}
  .ps-tab{padding:10px 15px;font-size:12px;font-weight:600;border:none;background:transparent;color:#64748b;cursor:pointer;white-space:nowrap;border-bottom:2px solid transparent;margin-bottom:-2px;font-family:inherit;}
  .ps-tab:hover{color:#0b1220;}
  .ps-tab-active{color:#f97316;border-bottom-color:#f97316;font-weight:800;}
  .ps-body{flex:1;overflow-y:auto;padding:16px 22px;}
  .kpi-row{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:16px;}
  .kpi{background:#fff;border:1px solid #e5e7eb;border-radius:12px;padding:14px 16px;}
  .kpi-lbl{font-size:9px;font-weight:800;color:#94a3b8;letter-spacing:.07em;text-transform:uppercase;margin-bottom:4px;}
  .kpi-val{font-size:20px;font-weight:900;}
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
  .modal{width:min(640px,98vw);max-height:92vh;background:#fff;border-radius:16px;display:flex;flex-direction:column;overflow:hidden;box-shadow:0 24px 64px rgba(0,0,0,.25);}
  .modal-sm{width:min(480px,98vw);}
  .modal-h{display:flex;align-items:center;justify-content:space-between;padding:16px 20px;border-bottom:1px solid #e5e7eb;background:#f8fafc;flex-shrink:0;}
  .modal-b{padding:20px;overflow-y:auto;flex:1;}
  .modal-f{display:flex;justify-content:flex-end;gap:10px;padding:14px 20px;border-top:1px solid #e5e7eb;flex-shrink:0;}
  .grid3{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-bottom:12px;}
  .col2{grid-column:span 2;}.col3{grid-column:span 3;}
  .field{display:flex;flex-direction:column;gap:5px;}
  .field label{font-size:10px;font-weight:800;color:#64748b;letter-spacing:.06em;text-transform:uppercase;}
  .field input,.field select,.field textarea{width:100%;border:1px solid #e5e7eb;border-radius:10px;padding:9px 10px;font-size:13px;background:#fff;font-family:inherit;box-sizing:border-box;}
  .sec-hdr{font-size:11px;font-weight:900;color:#94a3b8;letter-spacing:.07em;text-transform:uppercase;margin:14px 0 8px;padding-bottom:4px;border-bottom:1px solid #e5e7eb;}
  .cal-grid{display:grid;grid-template-columns:repeat(7,1fr);gap:2px;}
  .cal-cell{min-height:64px;background:#fff;border:1px solid #e5e7eb;border-radius:5px;padding:3px;}
  .cal-empty{background:transparent;border:none;min-height:64px;}
  .cal-day-hdr{text-align:center;font-weight:800;font-size:9px;color:#94a3b8;padding:4px 0;text-transform:uppercase;letter-spacing:.06em;}
  .cal-day{font-size:9px;font-weight:700;margin-bottom:2px;}
  .cal-ev{font-size:8px;border-radius:3px;padding:2px 3px;margin-bottom:1px;line-height:1.3;border:1px solid;}
  .pm-group{background:#fff;border:1px solid #e5e7eb;border-radius:12px;margin-bottom:12px;}
  .pm-group-hdr{display:flex;align-items:center;justify-content:space-between;padding:12px 16px;border-bottom:1px solid #e5e7eb;cursor:pointer;}
  .toast{position:fixed;right:16px;bottom:16px;background:#0b1220;color:#fff;padding:12px 18px;border-radius:12px;font-size:13px;font-weight:600;z-index:999;}
  @media(max-width:640px){.kpi-row{grid-template-columns:repeat(2,1fr);}}
`;

export default function PaymentSchedulePage() {
  const [schedules, setSchedules] = useState([]);
  const [activeTab, setActiveTab] = useState('list');
  const [search, setSearch] = useState('');
  const [filterCat, setFilterCat] = useState('');
  const [filterFreq, setFilterFreq] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [modal, setModal] = useState(null);
  const [detailId, setDetailId] = useState(null);
  const [pmModal, setPmModal] = useState(null);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState('');
  const [calOffset, setCalOffset] = useState(0);

  const showToast = msg => { setToast(msg); setTimeout(()=>setToast(''),3000); };

  useEffect(() => {
    const q = query(collection(db,'paymentSchedules'), orderBy('createdAt','desc'));
    return onSnapshot(q, snap => setSchedules(snap.docs.map(d=>({id:d.id,...d.data()}))));
  }, []);

  /* ── KPIs ────────────────────────────────────────────────────── */
  const today = new Date(); today.setHours(0,0,0,0);
  const cm = today.getMonth(), cy = today.getFullYear();
  const activeScheds = schedules.filter(s=>s.status!=='Cancelled');
  const thisMonthTotal = activeScheds.reduce((sum,s)=>{
    const occ = occurrencesInMonth(s, cy, cm);
    return sum + occ.length * (parseFloat(s.amount)||0);
  }, 0);
  const pendingThisMonth = activeScheds.filter(s=>occurrencesInMonth(s,cy,cm).length>0).length;
  const overdueCount = activeScheds.filter(s=>{
    const nxt = nextOccurrence(s);
    return nxt && new Date(nxt) < today;
  }).length;
  const annual12mo = activeScheds.reduce((sum,s)=>{
    let total=0;
    for(let i=0;i<12;i++){
      const m=(cm+i)%12, y=cy+Math.floor((cm+i)/12);
      total+=occurrencesInMonth(s,y,m).length*(parseFloat(s.amount)||0);
    }
    return sum+total;
  }, 0);

  /* ── Filter ──────────────────────────────────────────────────── */
  const filtered = schedules.filter(s=>{
    if (filterCat && s.category!==filterCat) return false;
    if (filterFreq && s.frequency!==filterFreq) return false;
    if (filterStatus && s.status!==filterStatus) return false;
    if (search && !((s.title||'').toLowerCase().includes(search.toLowerCase())||(s.contactId||'').toLowerCase().includes(search.toLowerCase()))) return false;
    return true;
  });

  const allCategories = [...new Set(schedules.map(s=>s.category).filter(Boolean))];

  /* ── Save / Delete ───────────────────────────────────────────── */
  async function saveSchedule(form) {
    setSaving(true);
    try {
      const payload = {
        title: form.title||'', contactId: form.contactId||'', category: form.category||'',
        frequency: form.frequency||'Monthly', amount: parseFloat(form.amount)||0,
        bankCode: form.bankCode||'', dueDate: form.dueDate||'',
        startDate: form.startDate||'', endDate: form.endDate||'',
        dueDay: parseInt(form.dueDay)||0, status: form.status||'Active',
        notes: form.notes||'',
        paymentMethod: form.paymentMethod||'',
        pmCheckbookCode: form.pmCheckbookCode||'', pmCheckNo: form.pmCheckNo||'',
        pmCheckBank: form.pmCheckBank||'', pmChecks: form.pmChecks||[],
        pmBtBank: form.pmBtBank||'', pmAdaDay: form.pmAdaDay||'',
        updatedAt: serverTimestamp(), updatedBy: auth.currentUser?.email||'',
      };
      if (form.id) {
        await updateDoc(doc(db,'paymentSchedules',form.id), payload);
        showToast('Schedule updated.');
      } else {
        await addDoc(collection(db,'paymentSchedules'), {...payload, createdAt:serverTimestamp(), createdBy:auth.currentUser?.email||''});
        showToast('Schedule created.');
      }
      setModal(null);
    } catch(e) { console.error(e); alert('Save failed.'); }
    setSaving(false);
  }

  async function cancelSchedule(id) {
    if (!confirm('Cancel this schedule?')) return;
    await updateDoc(doc(db,'paymentSchedules',id), {status:'Cancelled', updatedAt:serverTimestamp()});
    showToast('Schedule cancelled.');
    if (detailId===id) setDetailId(null);
  }

  async function deleteSchedule(id) {
    if (!confirm('Permanently delete this schedule?')) return;
    await deleteDoc(doc(db,'paymentSchedules',id));
    if (detailId===id) setDetailId(null);
  }

  async function savePm(form) {
    await updateDoc(doc(db,'paymentSchedules',form.id), {
      paymentMethod: form.paymentMethod||'',
      pmCheckbookCode:form.pmCheckbookCode||'', pmCheckNo:form.pmCheckNo||'',
      pmCheckBank:form.pmCheckBank||'', pmChecks:form.pmChecks||[],
      pmBtBank:form.pmBtBank||'', pmAdaDay:form.pmAdaDay||'',
      updatedAt:serverTimestamp(),
    });
    setPmModal(null); showToast('Payment method saved.');
  }

  const detailSched = detailId ? schedules.find(s=>s.id===detailId) : null;
  const TABS = [{key:'list',label:'Schedules'},{key:'paymentmethod',label:'Payment Method'},{key:'calendar',label:'Calendar'},{key:'history',label:'History'}];

  /* ══ Tab: List ═══════════════════════════════════════════════ */
  function ListTab() {
    return (
      <div>
        <div style={{display:'flex',gap:8,marginBottom:12,alignItems:'center',flexWrap:'wrap'}}>
          <button className="btn btn-primary btn-sm" onClick={()=>setModal({})}>+ New Schedule</button>
          <span style={{marginLeft:'auto',fontSize:12,color:'#64748b'}}>{filtered.length} result{filtered.length!==1?'s':''}</span>
        </div>
        {filtered.length===0?<div className="empty">No payment schedules match your filters.</div>:(
          <div style={{overflowX:'auto'}}>
            <table>
              <thead><tr>
                <th>Title</th><th>Vendor</th><th>Category</th><th>Frequency</th>
                <th style={{textAlign:'right'}}>Amount</th><th>Next Due</th>
                <th>Bank</th><th>Method</th><th>Status</th><th></th>
              </tr></thead>
              <tbody>
                {filtered.map(s=>{
                  const nxt=nextOccurrence(s);
                  const overdue=nxt&&new Date(nxt)<today;
                  const cs=catStyle(s.category);
                  return (
                    <tr key={s.id}>
                      <td>
                        <button onClick={()=>setDetailId(s.id===detailId?null:s.id)} style={{background:'none',border:'none',cursor:'pointer',fontWeight:700,color:'#0b1220',fontSize:12,padding:0,textAlign:'left'}}>
                          {s.title||'—'}
                          {s.frequency!=='One-Time'&&<span style={{marginLeft:5,fontSize:10}}>🔁</span>}
                        </button>
                      </td>
                      <td style={{color:'#64748b'}}>{s.contactId||'—'}</td>
                      <td><span className="pill" style={cs}>{s.category||'—'}</span></td>
                      <td style={{color:'#64748b'}}>{s.frequency}</td>
                      <td style={{textAlign:'right',fontWeight:700}}>{fmtCur(s.amount)}</td>
                      <td style={{color:overdue?'#dc2626':'#0b1220',fontWeight:overdue?700:400}}>
                        {nxt||<span style={{color:'#94a3b8'}}>—</span>}
                        {overdue&&<span style={{marginLeft:4,fontSize:10}}>⚠</span>}
                      </td>
                      <td style={{color:'#64748b',fontFamily:'monospace',fontSize:11}}>{s.bankCode||'—'}</td>
                      <td style={{color:'#64748b',fontSize:11}}>{s.paymentMethod||<span style={{color:'#e5e7eb'}}>—</span>}</td>
                      <td><span className={`pill ${s.status==='Cancelled'?'':'pill-active'}`} style={s.status==='Cancelled'?{background:'#f8fafc',borderColor:'#e2e8f0',color:'#94a3b8'}:{}}>{s.status||'Active'}</span></td>
                      <td>
                        <div style={{display:'flex',gap:4}}>
                          <button className="btn btn-ghost btn-sm" onClick={()=>setModal({...s})}>Edit</button>
                          <button className="btn btn-ghost btn-sm" title="Set payment method" onClick={()=>setPmModal({...s})}>💳</button>
                          <button onClick={()=>cancelSchedule(s.id)} style={{background:'none',border:'none',color:'#dc2626',cursor:'pointer',fontWeight:900,fontSize:13,padding:'3px 5px'}} title="Cancel">✕</button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot><tr>
                <td colSpan={4} style={{fontWeight:900}}>TOTAL (filtered)</td>
                <td style={{textAlign:'right'}}>{fmtCur(filtered.reduce((s,r)=>s+(parseFloat(r.amount)||0),0))}</td>
                <td colSpan={5}></td>
              </tr></tfoot>
            </table>
          </div>
        )}
        {detailSched&&<DetailPanel s={detailSched} />}
      </div>
    );
  }

  /* ══ Tab: Payment Method Grouping ════════════════════════════ */
  function PaymentMethodTab() {
    const groups = {'Check':[],'Bank Transfer':[],'Auto-Debit':[],'Unspecified':[]};
    filtered.filter(s=>s.status!=='Cancelled').forEach(s=>{
      const pm=s.paymentMethod||'';
      (groups[pm]||groups['Unspecified']).push(s);
    });
    return (
      <div>
        {Object.entries(groups).map(([pm,list])=>{
          const icons={'Check':'✏️','Bank Transfer':'🏦','Auto-Debit':'🔁','Unspecified':'❓'};
          const monthTotal=list.reduce((sum,s)=>sum+occurrencesInMonth(s,cy,cm).length*(parseFloat(s.amount)||0),0);
          let ann12=0;
          list.forEach(s=>{for(let i=0;i<12;i++){const m=(cm+i)%12,y=cy+Math.floor((cm+i)/12);ann12+=occurrencesInMonth(s,y,m).length*(parseFloat(s.amount)||0);}});
          return (
            <div key={pm} className="pm-group">
              <div className="pm-group-hdr">
                <span style={{fontWeight:800,fontSize:13}}>{icons[pm]} {pm} <span style={{color:'#94a3b8',fontWeight:600}}>({list.length})</span></span>
                <span style={{fontSize:12,color:'#64748b'}}>This month: <strong>{fmtCur(monthTotal)}</strong> · 12mo: <strong>{fmtCur(ann12)}</strong></span>
              </div>
              {list.length===0?<div style={{padding:'12px 16px',color:'#94a3b8',fontSize:12}}>No schedules.</div>:(
                <table>
                  <thead><tr>
                    <th>Title</th><th>Category</th><th>Frequency</th><th style={{textAlign:'right'}}>Amount</th><th>Next Due</th><th>Bank</th><th></th>
                  </tr></thead>
                  <tbody>
                    {list.map(s=>{
                      const nxt=nextOccurrence(s);
                      const overdue=nxt&&new Date(nxt)<today;
                      return (
                        <tr key={s.id}>
                          <td style={{fontWeight:700}}>{s.title}</td>
                          <td><span className="pill" style={catStyle(s.category)}>{s.category||'—'}</span></td>
                          <td style={{color:'#64748b'}}>{s.frequency}</td>
                          <td style={{textAlign:'right',fontWeight:700}}>{fmtCur(s.amount)}</td>
                          <td style={{color:overdue?'#dc2626':'#0b1220'}}>{nxt||'—'}</td>
                          <td style={{fontFamily:'monospace',fontSize:11,color:'#64748b'}}>{s.bankCode||'—'}</td>
                          <td>
                            <div style={{display:'flex',gap:4}}>
                              <button className="btn btn-ghost btn-sm" onClick={()=>setModal({...s})}>Edit</button>
                              <button className="btn btn-ghost btn-sm" onClick={()=>setPmModal({...s})}>💳 Set Method</button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                  <tfoot><tr>
                    <td colSpan={3} style={{fontWeight:900}}>SUBTOTAL</td>
                    <td style={{textAlign:'right'}}>{fmtCur(list.reduce((s,r)=>s+(parseFloat(r.amount)||0),0))}</td>
                    <td colSpan={3}></td>
                  </tr></tfoot>
                </table>
              )}
            </div>
          );
        })}
      </div>
    );
  }

  /* ══ Tab: Calendar (3-month rolling) ════════════════════════ */
  function CalendarTab() {
    const months = [0,1,2].map(i=>{
      const base = (cm + calOffset*3 + i);
      return {month: base%12<0?base%12+12:base%12, year: cy + Math.floor((cm + calOffset*3 + i)/12)};
    });
    const DOW=['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
    return (
      <div>
        <div style={{display:'flex',gap:8,marginBottom:14,alignItems:'center'}}>
          <button className="btn btn-ghost btn-sm" onClick={()=>setCalOffset(o=>o-1)}>◀ Prev</button>
          <span style={{fontWeight:700,fontSize:13}}>{MONTH_NAMES[months[0].month]} {months[0].year} – {MONTH_NAMES[months[2].month]} {months[2].year}</span>
          <button className="btn btn-ghost btn-sm" onClick={()=>setCalOffset(o=>o+1)}>Next ▶</button>
          <button className="btn btn-ghost btn-sm" onClick={()=>setCalOffset(0)}>Today</button>
        </div>
        {months.map(({month,year})=>{
          const dim=new Date(year,month+1,0).getDate();
          const fdow=new Date(year,month,1).getDay();
          const cells=[...Array(fdow).fill(null),...Array.from({length:dim},(_,i)=>i+1)];
          while(cells.length%7) cells.push(null);
          const weeks=Array.from({length:cells.length/7},(_,i)=>cells.slice(i*7,i*7+7));
          const dayEvents={};
          filtered.filter(s=>s.status!=='Cancelled').forEach(s=>{
            occurrencesInMonth(s,year,month).forEach(dateStr=>{
              const d=parseInt(dateStr.split('-')[2]);
              if(!dayEvents[d]) dayEvents[d]=[];
              dayEvents[d].push(s);
            });
          });
          return (
            <div key={year+'-'+month} style={{marginBottom:24}}>
              <div style={{fontWeight:900,fontSize:14,marginBottom:8}}>{MONTH_NAMES[month]} {year}</div>
              <div className="cal-grid">
                {DOW.map(d=><div key={d} className="cal-day-hdr">{d}</div>)}
                {weeks.map((wk,wi)=>wk.map((day,di)=>(
                  <div key={`${wi}-${di}`} className={day?'cal-cell':'cal-empty'}>
                    {day&&(<>
                      <div className="cal-day" style={{color:day===today.getDate()&&month===today.getMonth()&&year===today.getFullYear()?'#f97316':'#0b1220'}}>{day}</div>
                      {(dayEvents[day]||[]).slice(0,3).map((s,i)=>(
                        <div key={i} className="cal-ev" style={catStyle(s.category)}>
                          <div style={{overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap',fontWeight:700}}>{s.title}</div>
                          <div>{fmtCur(s.amount)}</div>
                        </div>
                      ))}
                      {(dayEvents[day]||[]).length>3&&<div style={{fontSize:8,color:'#94a3b8'}}>+{dayEvents[day].length-3} more</div>}
                    </>)}
                  </div>
                )))}
              </div>
            </div>
          );
        })}
      </div>
    );
  }

  /* ══ Tab: Transaction History ════════════════════════════════ */
  function HistoryTab() {
    const [vouchers, setVouchers] = useState([]);
    useEffect(()=>{
      const q=query(collection(db,'vouchers'),orderBy('preparationDate','desc'));
      return onSnapshot(q, snap=>setVouchers(snap.docs.map(d=>({id:d.id,...d.data()})).filter(v=>v.linkedScheduleId)));
    },[]);
    const VSTATUS_COLORS = {Draft:'#f8fafc:#e2e8f0:#475569',Pending:'#fef9c3:#fde68a:#a16207',Approved:'#f0fdf4:#bbf7d0:#15803d',Disbursed:'#eff6ff:#bfdbfe:#1d4ed8',Rejected:'#fef2f2:#fecaca:#b91c1c',Cancelled:'#f8fafc:#e2e8f0:#94a3b8'};
    function vstyle(st){const s=VSTATUS_COLORS[st]||VSTATUS_COLORS.Draft;const [bg,border,color]=s.split(':');return{background:bg,borderColor:border,color};}
    return (
      <div>
        {vouchers.length===0?<div className="empty">No vouchers linked to payment schedules yet.</div>:(
          <div style={{overflowX:'auto'}}>
            <table>
              <thead><tr>
                <th>Voucher ID</th><th>Date</th><th>Schedule</th><th>Sched. Date</th>
                <th style={{textAlign:'right'}}>Amount</th><th>Status</th>
              </tr></thead>
              <tbody>
                {vouchers.map(v=>{
                  const s=schedules.find(sc=>sc.id===v.linkedScheduleId);
                  return (
                    <tr key={v.id}>
                      <td style={{fontFamily:'monospace',color:'#f97316',fontWeight:800,fontSize:11}}>{v.id}</td>
                      <td>{v.preparationDate||'—'}</td>
                      <td style={{fontWeight:600}}>{s?.title||v.linkedScheduleId}</td>
                      <td style={{color:'#64748b'}}>{v.linkedScheduleDate||'—'}</td>
                      <td style={{textAlign:'right',fontWeight:700}}>{fmtCur(v.totalAmount)}</td>
                      <td><span className="pill" style={vstyle(v.status)}>{v.status||'Draft'}</span></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    );
  }

  /* ══ Detail Panel ════════════════════════════════════════════ */
  function DetailPanel({s}) {
    const nxt=nextOccurrence(s);
    const overdue=nxt&&new Date(nxt)<today;
    const cs=catStyle(s.category);
    const PM_ICONS={'Check':'✏️','Bank Transfer':'🏦','Auto-Debit':'🔁'};
    let pmDetails='';
    if(s.paymentMethod==='Check'){pmDetails=(s.pmChecks||[]).join(', ')||s.pmCheckNo||'—';}
    else if(s.paymentMethod==='Bank Transfer'){pmDetails=s.pmBtBank||'—';}
    else if(s.paymentMethod==='Auto-Debit'){pmDetails=`Day ${s.pmAdaDay||'—'}`;}
    return (
      <div style={{marginTop:16,background:'#f8fafc',border:'1px solid #e5e7eb',borderRadius:12,padding:16}}>
        <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:12}}>
          <div>
            <span style={{fontWeight:900,fontSize:14}}>{s.title}</span>
            <span className="pill" style={{...cs,marginLeft:8}}>{s.category}</span>
            <span className={`pill`} style={{marginLeft:6,background:s.status==='Cancelled'?'#f8fafc':'#f0fdf4',borderColor:s.status==='Cancelled'?'#e2e8f0':'#bbf7d0',color:s.status==='Cancelled'?'#94a3b8':'#15803d'}}>{s.status||'Active'}</span>
          </div>
          <div style={{display:'flex',gap:6}}>
            <button className="btn btn-ghost btn-sm" onClick={()=>setModal({...s})}>Edit</button>
            <button className="btn btn-primary btn-sm" onClick={()=>{/* create voucher */showToast('Create Voucher: coming soon');}}>+ Create Voucher</button>
            <button onClick={()=>setDetailId(null)} style={{background:'none',border:'none',color:'#94a3b8',cursor:'pointer',fontSize:16,padding:'0 4px'}}>✕</button>
          </div>
        </div>
        <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(160px,1fr))',gap:'8px 16px',fontSize:12}}>
          {[['Vendor',s.contactId||'—'],['Frequency',s.frequency],['Amount',fmtCur(s.amount)],['Bank / Fund',s.bankCode||'—'],['Due Day',s.dueDay||'—'],['Start Date',s.startDate||s.dueDate||'—'],['End Date',s.endDate||'—'],['Next Due', <span style={{color:overdue?'#dc2626':'inherit'}}>{nxt||(s.status==='Cancelled'?'N/A':'—')}{overdue?' ⚠':''}</span>],['Payment Method',`${PM_ICONS[s.paymentMethod]||'❓'} ${s.paymentMethod||'Unspecified'}`],['PM Details',pmDetails]].map(([lbl,val])=>(
            <div key={lbl}><div style={{fontSize:9,fontWeight:800,color:'#94a3b8',textTransform:'uppercase',letterSpacing:'.06em',marginBottom:2}}>{lbl}</div><div style={{fontWeight:600}}>{val}</div></div>
          ))}
        </div>
        {s.notes&&<div style={{marginTop:10,fontSize:12,color:'#64748b',borderTop:'1px solid #e5e7eb',paddingTop:8}}>{s.notes}</div>}
      </div>
    );
  }

  /* ══ Schedule Form Modal ════════════════════════════════════ */
  function ScheduleModal() {
    const isEdit=!!(modal&&modal.id);
    const [form,setForm]=useState({title:'',contactId:'',category:'',frequency:'Monthly',amount:'',bankCode:'',dueDate:'',startDate:'',endDate:'',dueDay:'',status:'Active',notes:'',paymentMethod:'',pmCheckbookCode:'',pmCheckNo:'',pmCheckBank:'',pmChecks:[],pmBtBank:'',pmAdaDay:'',...modal});
    const upd=(k,v)=>setForm(f=>({...f,[k]:v}));
    const isRecurring=form.frequency!=='One-Time';
    return (
      <div className="backdrop" onClick={e=>e.target===e.currentTarget&&setModal(null)}>
        <div className="modal">
          <div className="modal-h"><strong>{isEdit?'Edit Schedule':'New Payment Schedule'}</strong><button className="btn btn-ghost btn-sm" onClick={()=>setModal(null)}>✕</button></div>
          <div className="modal-b">
            <div className="grid3">
              <div className="field col3"><label>Title *</label><input value={form.title} onChange={e=>upd('title',e.target.value)} /></div>
              <div className="field"><label>Vendor / Contact</label><input value={form.contactId} onChange={e=>upd('contactId',e.target.value)} /></div>
              <div className="field"><label>Category</label><select value={form.category} onChange={e=>upd('category',e.target.value)}><option value="">— None —</option>{CATEGORIES.map(c=><option key={c}>{c}</option>)}{!CATEGORIES.includes(form.category)&&form.category&&<option>{form.category}</option>}</select></div>
              <div className="field"><label>Frequency</label><select value={form.frequency} onChange={e=>upd('frequency',e.target.value)}>{FREQS.map(f=><option key={f}>{f}</option>)}</select></div>
              <div className="field"><label>Amount *</label><input type="number" step="0.01" value={form.amount} onChange={e=>upd('amount',e.target.value)} /></div>
              <div className="field"><label>Bank / Fund</label><input value={form.bankCode} onChange={e=>upd('bankCode',e.target.value)} placeholder="e.g. BDO-001" /></div>
              <div className="field"><label>Status</label><select value={form.status} onChange={e=>upd('status',e.target.value)}>{STATUSES.map(s=><option key={s}>{s}</option>)}</select></div>
            </div>
            {!isRecurring&&<div className="field" style={{marginBottom:10}}><label>Due Date</label><input type="date" value={form.dueDate} onChange={e=>upd('dueDate',e.target.value)} /></div>}
            {isRecurring&&<div className="grid3">
              <div className="field"><label>Start Date</label><input type="date" value={form.startDate} onChange={e=>upd('startDate',e.target.value)} /></div>
              <div className="field"><label>End Date</label><input type="date" value={form.endDate} onChange={e=>upd('endDate',e.target.value)} /></div>
              <div className="field"><label>Due Day of Month</label><input type="number" min="1" max="31" value={form.dueDay} onChange={e=>upd('dueDay',e.target.value)} /></div>
            </div>}
            <div className="sec-hdr">Payment Method</div>
            <div style={{display:'flex',gap:8,marginBottom:10}}>
              {['','Check','Bank Transfer','Auto-Debit'].map(pm=><button key={pm||'none'} className={`btn btn-sm ${form.paymentMethod===pm?'btn-primary':'btn-ghost'}`} onClick={()=>upd('paymentMethod',pm)}>{pm||'None'}</button>)}
            </div>
            {form.paymentMethod==='Check'&&<div className="field" style={{marginBottom:10}}><label>Check Numbers / Series</label><input value={(form.pmChecks||[]).join(', ')} onChange={e=>upd('pmChecks',e.target.value.split(',').map(s=>s.trim()).filter(Boolean))} placeholder="BDO-0001, BDO-0002" /></div>}
            {form.paymentMethod==='Bank Transfer'&&<div className="field" style={{marginBottom:10}}><label>Bank Account</label><input value={form.pmBtBank} onChange={e=>upd('pmBtBank',e.target.value)} /></div>}
            {form.paymentMethod==='Auto-Debit'&&<div className="field" style={{marginBottom:10}}><label>Auto-Debit Day</label><input type="number" min="1" max="31" value={form.pmAdaDay} onChange={e=>upd('pmAdaDay',e.target.value)} /></div>}
            <div className="field" style={{marginTop:10}}><label>Notes</label><textarea rows={2} value={form.notes} onChange={e=>upd('notes',e.target.value)} style={{resize:'vertical'}} /></div>
          </div>
          <div className="modal-f">
            <button className="btn btn-ghost" onClick={()=>setModal(null)}>Cancel</button>
            <button className="btn btn-primary" disabled={saving} onClick={()=>{if(!form.title.trim()) return alert('Title required.');if(!(parseFloat(form.amount)>0)) return alert('Amount must be > 0.');saveSchedule(form);}}>{saving?'Saving…':isEdit?'Save Changes':'Create Schedule'}</button>
          </div>
        </div>
      </div>
    );
  }

  /* ══ PM Modal ════════════════════════════════════════════════ */
  function PmModal() {
    if(!pmModal) return null;
    const [form,setForm]=useState({...pmModal});
    const upd=(k,v)=>setForm(f=>({...f,[k]:v}));
    return (
      <div className="backdrop" onClick={e=>e.target===e.currentTarget&&setPmModal(null)}>
        <div className="modal modal-sm">
          <div className="modal-h"><strong>Payment Method — {pmModal.title}</strong><button className="btn btn-ghost btn-sm" onClick={()=>setPmModal(null)}>✕</button></div>
          <div className="modal-b">
            <div style={{display:'flex',gap:8,marginBottom:14}}>
              {['','Check','Bank Transfer','Auto-Debit'].map(pm=><button key={pm||'none'} className={`btn btn-sm ${form.paymentMethod===pm?'btn-primary':'btn-ghost'}`} onClick={()=>upd('paymentMethod',pm)}>{pm||'None'}</button>)}
            </div>
            {form.paymentMethod==='Check'&&<div className="field"><label>Check Numbers / Series</label><input value={(form.pmChecks||[]).join(', ')} onChange={e=>upd('pmChecks',e.target.value.split(',').map(s=>s.trim()).filter(Boolean))} /></div>}
            {form.paymentMethod==='Bank Transfer'&&<div className="field"><label>Bank Account</label><input value={form.pmBtBank||''} onChange={e=>upd('pmBtBank',e.target.value)} /></div>}
            {form.paymentMethod==='Auto-Debit'&&<div className="field"><label>Auto-Debit Day</label><input type="number" min="1" max="31" value={form.pmAdaDay||''} onChange={e=>upd('pmAdaDay',e.target.value)} /></div>}
          </div>
          <div className="modal-f">
            <button className="btn btn-ghost" onClick={()=>setPmModal(null)}>Cancel</button>
            <button className="btn btn-primary" onClick={()=>savePm(form)}>Save</button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="ps-wrap">
      <style>{CSS}</style>
      <div className="ps-topbar">
        <div>
          <h1 style={{margin:0,fontSize:18,fontWeight:900}}>Payment Schedule</h1>
          <p style={{margin:0,fontSize:12,color:'#64748b'}}>{schedules.length} schedule{schedules.length!==1?'s':''} · {activeScheds.length} active</p>
        </div>
      </div>
      <div style={{padding:'10px 22px 0',flexShrink:0,background:'#fff'}}>
        <div className="kpi-row">
          <div className="kpi"><div className="kpi-lbl">This Month Total</div><div className="kpi-val">{fmtCur(thisMonthTotal)}</div></div>
          <div className="kpi"><div className="kpi-lbl">Pending This Month</div><div className="kpi-val" style={{color:'#f97316'}}>{pendingThisMonth}</div></div>
          <div className="kpi"><div className="kpi-lbl">Overdue</div><div className="kpi-val" style={{color:overdueCount>0?'#dc2626':'#0b1220'}}>{overdueCount}</div></div>
          <div className="kpi"><div className="kpi-lbl">Annual Projection (12mo)</div><div className="kpi-val">{fmtCur(annual12mo)}</div></div>
        </div>
        <div className="filters">
          <input placeholder="Search title or vendor…" value={search} onChange={e=>setSearch(e.target.value)} style={{minWidth:180}} />
          <select value={filterCat} onChange={e=>setFilterCat(e.target.value)}><option value="">All Categories</option>{[...new Set([...CATEGORIES,...allCategories])].map(c=><option key={c}>{c}</option>)}</select>
          <select value={filterFreq} onChange={e=>setFilterFreq(e.target.value)}><option value="">All Frequencies</option>{FREQS.map(f=><option key={f}>{f}</option>)}</select>
          <select value={filterStatus} onChange={e=>setFilterStatus(e.target.value)}><option value="">All Statuses</option><option>Active</option><option>Cancelled</option></select>
          {(search||filterCat||filterFreq||filterStatus)&&<button className="btn btn-ghost btn-sm" onClick={()=>{setSearch('');setFilterCat('');setFilterFreq('');setFilterStatus('');}}>Clear</button>}
        </div>
      </div>
      <div className="ps-tabs">
        {TABS.map(t=><button key={t.key} className={`ps-tab${activeTab===t.key?' ps-tab-active':''}`} onClick={()=>setActiveTab(t.key)}>{t.label}</button>)}
      </div>
      <div className="ps-body">
        {activeTab==='list'&&<ListTab />}
        {activeTab==='paymentmethod'&&<PaymentMethodTab />}
        {activeTab==='calendar'&&<CalendarTab />}
        {activeTab==='history'&&<HistoryTab />}
      </div>
      {modal!==null&&<ScheduleModal />}
      {pmModal!==null&&<PmModal />}
      {toast&&<div className="toast">{toast}</div>}
    </div>
  );
}

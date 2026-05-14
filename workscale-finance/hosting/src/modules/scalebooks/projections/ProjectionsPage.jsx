import { useState, useEffect } from 'react';
import {
  collection, query, orderBy, onSnapshot,
  addDoc, updateDoc, doc, serverTimestamp, deleteDoc
} from 'firebase/firestore';
import { db, auth } from '../../../firebase.js';
import { nextWeeklyProjectionId } from '../../../utils/documentIds.js';

const PROJ_STATUSES = ['Draft','Pending Review','Pending Approval','Approved','Rejected'];
const VOUCHER_TYPES = ['Check','Cash','Journal Voucher','Payroll','Final Pay','Government Remittance'];
const BANKS = [
  {code:'UBPBPHM',name:'UnionBank'},{code:'BPI',name:'BPI'},{code:'BDO',name:'BDO'},
  {code:'RCBC',name:'RCBC'},{code:'MBTC',name:'Metrobank'},{code:'CASH',name:'Petty Cash'},
];
const PURPOSE_CATEGORIES = ['Operational','Administrative','Capital','Payroll','Tax','Loan','Other'];

const STATUS_STYLES = {
  Draft:              {bg:'#f8fafc',border:'#e2e8f0',color:'#64748b'},
  'Pending Review':   {bg:'#fef9c3',border:'#fde68a',color:'#a16207'},
  'Pending Approval': {bg:'#fff7ed',border:'#fed7aa',color:'#c2410c'},
  Approved:           {bg:'#f0fdf4',border:'#bbf7d0',color:'#15803d'},
  Rejected:           {bg:'#fef2f2',border:'#fecaca',color:'#b91c1c'},
};

const fmtPHP = n => new Intl.NumberFormat('en-PH',{minimumFractionDigits:2,maximumFractionDigits:2}).format(n||0);
const fmtCur = n => '₱' + fmtPHP(n);
const fmtDate = d => d ? new Date(d+'T00:00:00').toLocaleDateString('en-PH',{month:'short',day:'numeric',year:'numeric'}) : '—';
const bankName = code => BANKS.find(b=>b.code===code)?.name || code;

function newLine() { return {type:'Check',purpose:'Operational',contact:'',description:'',dueDate:'',bankCode:'',amount:'',status:'Pending',linkedId:''}; }
function newInflowLine() { return {source:'',description:'',expectedDate:'',bankCode:'',amount:''}; }

const CSS = `
  .proj-wrap{display:flex;flex-direction:column;height:100%;overflow:hidden;font-family:Inter,system-ui,sans-serif;}
  .proj-topbar{display:flex;align-items:center;justify-content:space-between;padding:14px 22px 10px;flex-shrink:0;border-bottom:1px solid #e5e7eb;background:#fff;gap:12px;flex-wrap:wrap;}
  .proj-body{flex:1;overflow-y:auto;padding:16px 22px;}
  .kpi-row{display:grid;grid-template-columns:repeat(5,1fr);gap:10px;margin-bottom:16px;}
  .kpi{background:#fff;border:1px solid #e5e7eb;border-radius:12px;padding:12px 14px;}
  .kpi-lbl{font-size:9px;font-weight:800;color:#94a3b8;letter-spacing:.07em;text-transform:uppercase;margin-bottom:3px;}
  .kpi-val{font-size:18px;font-weight:900;}
  .bulk-bar{display:flex;align-items:center;gap:8px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;padding:8px 12px;margin-bottom:12px;flex-wrap:wrap;}
  .filters{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px;align-items:center;}
  .filters input,.filters select{border:1px solid #e5e7eb;border-radius:10px;padding:7px 10px;font-size:12px;background:#fff;font-family:inherit;}
  .btn{border:0;border-radius:10px;padding:9px 16px;font-weight:700;cursor:pointer;font-size:13px;font-family:inherit;}
  .btn-primary{background:#f97316;color:#fff;}
  .btn-ghost{background:#f1f5f9;color:#0b1220;}
  .btn-ghost:hover{background:#e2e8f0;}
  .btn-sm{padding:6px 12px;font-size:12px;}
  .btn-danger{background:#fef2f2;color:#b91c1c;border:1px solid #fecaca;}
  table{width:100%;border-collapse:collapse;}
  th,td{padding:8px 10px;border-bottom:1px solid #f1f5f9;font-size:12px;text-align:left;}
  th{color:#64748b;font-weight:800;font-size:10px;letter-spacing:.05em;text-transform:uppercase;background:#f8fafc;position:sticky;top:0;z-index:1;}
  tr:hover td{background:#fafafa;}
  .pill{display:inline-block;padding:2px 9px;border-radius:999px;font-size:11px;font-weight:700;border:1px solid;}
  .empty{padding:48px;text-align:center;color:#94a3b8;}
  .backdrop{position:fixed;inset:0;background:rgba(15,23,42,.45);display:flex;align-items:center;justify-content:center;padding:16px;z-index:100;}
  .modal{width:min(820px,98vw);max-height:95vh;background:#fff;border-radius:16px;display:flex;flex-direction:column;overflow:hidden;box-shadow:0 24px 64px rgba(0,0,0,.25);}
  .modal-h{display:flex;align-items:center;justify-content:space-between;padding:16px 20px;border-bottom:1px solid #e5e7eb;background:#f8fafc;flex-shrink:0;}
  .modal-b{padding:20px;overflow-y:auto;flex:1;}
  .modal-f{display:flex;justify-content:space-between;align-items:center;gap:10px;padding:14px 20px;border-top:1px solid #e5e7eb;flex-shrink:0;}
  .grid3{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-bottom:12px;}
  .col2{grid-column:span 2;}.col3{grid-column:span 3;}
  .field{display:flex;flex-direction:column;gap:5px;}
  .field label{font-size:10px;font-weight:800;color:#64748b;letter-spacing:.06em;text-transform:uppercase;}
  .field input,.field select,.field textarea{width:100%;border:1px solid #e5e7eb;border-radius:10px;padding:7px 9px;font-size:12px;background:#fff;font-family:inherit;box-sizing:border-box;}
  .sec-hdr{font-size:11px;font-weight:900;color:#64748b;letter-spacing:.07em;text-transform:uppercase;margin:14px 0 6px;padding-bottom:4px;border-bottom:1px solid #e5e7eb;}
  .line-table{width:100%;border-collapse:collapse;font-size:12px;}
  .line-table th{padding:4px 6px;background:#f8fafc;color:#94a3b8;font-size:9px;font-weight:800;letter-spacing:.06em;text-transform:uppercase;text-align:left;}
  .line-table td{padding:4px;border-bottom:1px solid #f1f5f9;}
  .line-table input,.line-table select{border:1px solid #e5e7eb;border-radius:6px;padding:5px 7px;font-size:11px;font-family:inherit;width:100%;box-sizing:border-box;}
  .summary-bar{display:grid;grid-template-columns:repeat(3,1fr);gap:12px;background:#f8fafc;border-radius:10px;padding:12px 16px;margin-top:12px;}
  .toast{position:fixed;right:16px;bottom:16px;background:#0b1220;color:#fff;padding:12px 18px;border-radius:12px;font-size:13px;font-weight:600;z-index:999;}
  .action-menu{position:relative;display:inline-block;}
  .action-dropdown{position:absolute;right:0;top:100%;background:#fff;border:1px solid #e5e7eb;border-radius:10px;min-width:170px;box-shadow:0 8px 24px rgba(0,0,0,.12);z-index:50;overflow:hidden;}
  .action-item{display:block;width:100%;text-align:left;border:none;background:transparent;padding:10px 14px;font-size:12px;font-weight:600;cursor:pointer;font-family:inherit;color:#0b1220;}
  .action-item:hover{background:#f8fafc;}
  @media(max-width:640px){.kpi-row{grid-template-columns:repeat(3,1fr);}}
`;

export default function ProjectionsPage() {
  const [projections, setProjections] = useState([]);
  const [filterStatus, setFilterStatus] = useState('');
  const [search, setSearch] = useState('');
  const [modal, setModal] = useState(null);
  const [openMenuId, setOpenMenuId] = useState(null);
  const [selected, setSelected] = useState(new Set());
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState('');
  const [confirmModal, setConfirmModal] = useState(null);

  const showToast = msg => { setToast(msg); setTimeout(()=>setToast(''),3000); };
  const askConfirm = (message, onConfirm) => setConfirmModal({ message, onConfirm });

  useEffect(() => {
    const q = query(collection(db,'weeklyProjections'), orderBy('createdAt','desc'));
    return onSnapshot(q, snap => setProjections(snap.docs.map(d=>({id:d.id,...d.data()}))));
  }, []);

  /* ── KPIs ──────────────────────────────────────────────────── */
  const countsByStatus = {};
  PROJ_STATUSES.forEach(s=>{ countsByStatus[s] = projections.filter(p=>p.status===s).length; });
  const totalPending = projections.filter(p=>['Draft','Pending Review','Pending Approval'].includes(p.status)).reduce((s,p)=>s+(parseFloat(p.totalAmount)||0),0);

  /* ── Filter ────────────────────────────────────────────────── */
  const filtered = projections.filter(p => {
    if (filterStatus && p.status!==filterStatus) return false;
    if (search) {
      const q=search.toLowerCase();
      if (!((p.projId||'').toLowerCase().includes(q)||(p.weekCoverage||'').toLowerCase().includes(q))) return false;
    }
    return true;
  });

  /* ── Bulk selection ──────────────────────────────────────────── */
  const allSelected = filtered.length>0 && filtered.every(p=>selected.has(p.id));
  const toggleAll = () => {
    if (allSelected) { setSelected(new Set()); }
    else { setSelected(new Set(filtered.map(p=>p.id))); }
  };
  const toggle = id => setSelected(prev=>{const n=new Set(prev);n.has(id)?n.delete(id):n.add(id);return n;});

  /* ── Save ──────────────────────────────────────────────────── */
  async function saveProjection(form) {
    setSaving(true);
    try {
      const totalOut = (form.lines||[]).reduce((s,l)=>s+(parseFloat(l.amount)||0),0);
      const totalIn = (form.inflowLines||[]).reduce((s,l)=>s+(parseFloat(l.amount)||0),0);
      const isNew = !form.id;
      const projId = isNew
        ? await nextWeeklyProjectionId(form.startDate || form.endDate || new Date().toISOString().slice(0,10))
        : (form.projId || '');
      const payload = {
        projId, weekCoverage: form.weekCoverage||'',
        startDate: form.startDate||'', endDate: form.endDate||'',
        status: form.status||'Draft',
        totalAmount: totalOut, totalInflow: totalIn,
        lines: (form.lines||[]).map(l=>({type:l.type||'',purpose:l.purpose||'',contact:l.contact||'',description:l.description||'',dueDate:l.dueDate||'',bankCode:l.bankCode||'',amount:parseFloat(l.amount)||0,status:l.status||'Pending',linkedId:l.linkedId||''})),
        inflowLines: (form.inflowLines||[]).map(l=>({source:l.source||'',description:l.description||'',expectedDate:l.expectedDate||'',bankCode:l.bankCode||'',amount:parseFloat(l.amount)||0})),
        notes: form.notes||'',
        updatedAt: serverTimestamp(), updatedBy: auth.currentUser?.email||'',
      };
      if (form.id) {
        await updateDoc(doc(db,'weeklyProjections',form.id), payload);
        showToast('Projection updated.');
      } else {
        await addDoc(collection(db,'weeklyProjections'), {...payload, createdAt:serverTimestamp(), createdBy:auth.currentUser?.email||''});
        showToast('Projection created.');
      }
      setModal(null);
    } catch(e) { console.error(e); alert('Save failed.'); }
    setSaving(false);
  }

  function deleteProjection(id) {
    askConfirm('Delete this projection?', async () => {
      await deleteDoc(doc(db,'weeklyProjections',id));
      showToast('Deleted.');
    });
  }

  async function submitForApproval(id) {
    await updateDoc(doc(db,'weeklyProjections',id), {status:'Pending Review', updatedAt:serverTimestamp(), updatedBy:auth.currentUser?.email||''});
    showToast('Submitted for review.');
  }

  function bulkDelete() {
    if (!selected.size) return;
    const count = selected.size;
    askConfirm(`Delete ${count} projection(s)? This cannot be undone.`, async () => {
      await Promise.all([...selected].map(id=>deleteDoc(doc(db,'weeklyProjections',id))));
      setSelected(new Set()); showToast(`${count} projection(s) deleted.`);
    });
  }

  function bulkSubmit() {
    if (!selected.size) return;
    const count = selected.size;
    askConfirm(`Submit ${count} projection(s) for review?`, async () => {
      await Promise.all([...selected].map(id=>updateDoc(doc(db,'weeklyProjections',id),{status:'Pending Review',updatedAt:serverTimestamp(),updatedBy:auth.currentUser?.email||''})));
      setSelected(new Set()); showToast('Submitted for review.');
    });
  }

  function duplicateProjection(proj) {
    const copy = {
      ...proj, id:undefined,
      projId: '',
      status:'Draft',
      lines: (proj.lines||[]).map(l=>({...l,status:'Pending',linkedId:''})),
      inflowLines: [...(proj.inflowLines||[])],
    };
    setModal(copy);
  }

  /* ══ Projection Modal ══════════════════════════════════════════ */
  function ProjectionModal() {
    const isEdit=!!(modal&&modal.id);
    const [form,setForm]=useState({projId:'',weekCoverage:'',startDate:'',endDate:'',status:'Draft',lines:[newLine()],inflowLines:[newInflowLine()],notes:'',...modal});
    const upd=(k,v)=>setForm(f=>({...f,[k]:v}));
    const updLine=(i,k,v)=>setForm(f=>({...f,lines:f.lines.map((l,idx)=>idx===i?{...l,[k]:v}:l)}));
    const updInflow=(i,k,v)=>setForm(f=>({...f,inflowLines:f.inflowLines.map((l,idx)=>idx===i?{...l,[k]:v}:l)}));
    const addLine=()=>setForm(f=>({...f,lines:[...f.lines,newLine()]}));
    const removeLine=i=>setForm(f=>({...f,lines:f.lines.filter((_,idx)=>idx!==i)}));
    const addInflow=()=>setForm(f=>({...f,inflowLines:[...f.inflowLines,newInflowLine()]}));
    const removeInflow=i=>setForm(f=>({...f,inflowLines:f.inflowLines.filter((_,idx)=>idx!==i)}));
    const totalOut=(form.lines||[]).reduce((s,l)=>s+(parseFloat(l.amount)||0),0);
    const totalIn=(form.inflowLines||[]).reduce((s,l)=>s+(parseFloat(l.amount)||0),0);
    const ss=STATUS_STYLES[form.status]||STATUS_STYLES.Draft;
    return (
      <div className="backdrop" onClick={e=>e.target===e.currentTarget&&setModal(null)}>
        <div className="modal">
          <div className="modal-h">
            <strong>{isEdit?`Edit ${form.projId||'Projection'}`:'New Weekly Projection'}</strong>
            <div style={{display:'flex',gap:8,alignItems:'center'}}>
              <span className="pill" style={{background:ss.bg,borderColor:ss.border,color:ss.color}}>{form.status}</span>
              <button className="btn btn-ghost btn-sm" onClick={()=>setModal(null)}>✕</button>
            </div>
          </div>
          <div className="modal-b">
            <div className="grid3">
              <div className="field"><label>Projection ID</label><input value={form.projId} readOnly placeholder={isEdit ? '' : 'Auto-assigned on save'} style={isEdit ? undefined : {background:'#f8fafc',color:'#64748b',fontWeight:700}} /></div>
              <div className="field"><label>Week Coverage</label><input value={form.weekCoverage} onChange={e=>upd('weekCoverage',e.target.value)} placeholder="e.g. Jan 1–7, 2025" /></div>
              <div className="field"><label>Status</label><select value={form.status} onChange={e=>upd('status',e.target.value)}>{PROJ_STATUSES.map(s=><option key={s}>{s}</option>)}</select></div>
              <div className="field"><label>Start Date</label><input type="date" value={form.startDate} onChange={e=>upd('startDate',e.target.value)} /></div>
              <div className="field"><label>End Date</label><input type="date" value={form.endDate} onChange={e=>upd('endDate',e.target.value)} /></div>
              <div className="field"><label>Notes</label><input value={form.notes} onChange={e=>upd('notes',e.target.value)} /></div>
            </div>

            <div className="sec-hdr">Disbursement Lines</div>
            <div style={{overflowX:'auto'}}>
              <table className="line-table">
                <thead><tr>
                  <th style={{width:'14%'}}>Type</th><th style={{width:'12%'}}>Purpose</th>
                  <th style={{width:'15%'}}>Contact</th><th style={{width:'16%'}}>Description</th>
                  <th style={{width:'9%'}}>Due Date</th><th style={{width:'10%'}}>Bank</th>
                  <th style={{width:'9%',textAlign:'right'}}>Amount</th><th style={{width:'10%'}}>Status</th><th style={{width:'5%'}}></th>
                </tr></thead>
                <tbody>
                  {(form.lines||[]).map((l,i)=>(
                    <tr key={i}>
                      <td><select value={l.type} onChange={e=>updLine(i,'type',e.target.value)}>{VOUCHER_TYPES.map(t=><option key={t}>{t}</option>)}</select></td>
                      <td><select value={l.purpose} onChange={e=>updLine(i,'purpose',e.target.value)}>{PURPOSE_CATEGORIES.map(p=><option key={p}>{p}</option>)}</select></td>
                      <td><input value={l.contact} onChange={e=>updLine(i,'contact',e.target.value)} /></td>
                      <td><input value={l.description} onChange={e=>updLine(i,'description',e.target.value)} /></td>
                      <td><input type="date" value={l.dueDate} onChange={e=>updLine(i,'dueDate',e.target.value)} /></td>
                      <td><select value={l.bankCode} onChange={e=>updLine(i,'bankCode',e.target.value)}><option value="">—</option>{BANKS.map(b=><option key={b.code} value={b.code}>{b.name}</option>)}</select></td>
                      <td><input type="number" step="0.01" value={l.amount} onChange={e=>updLine(i,'amount',e.target.value)} style={{textAlign:'right'}} /></td>
                      <td>
                        {l.linkedId?(
                          <span className="pill" style={{background:'#eff6ff',borderColor:'#bfdbfe',color:'#1d4ed8',fontSize:9}}>Vouchered</span>
                        ):(
                          <select value={l.status} onChange={e=>updLine(i,'status',e.target.value)} style={{fontSize:10}}>
                            <option>Pending</option><option>Done</option>
                          </select>
                        )}
                      </td>
                      <td><button onClick={()=>removeLine(i)} style={{background:'none',border:'none',color:'#dc2626',cursor:'pointer',fontWeight:900,fontSize:14,padding:'0 4px'}}>✕</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <button className="btn btn-ghost btn-sm" style={{marginTop:6}} onClick={addLine}>+ Add Line</button>

            <div className="sec-hdr" style={{marginTop:16}}>Expected Inflows</div>
            <div style={{overflowX:'auto'}}>
              <table className="line-table">
                <thead><tr>
                  <th style={{width:'18%'}}>Source</th><th style={{width:'25%'}}>Description</th>
                  <th style={{width:'15%'}}>Expected Date</th><th style={{width:'14%'}}>Bank</th>
                  <th style={{width:'12%',textAlign:'right'}}>Amount</th><th style={{width:'5%'}}></th>
                </tr></thead>
                <tbody>
                  {(form.inflowLines||[]).map((l,i)=>(
                    <tr key={i}>
                      <td><input value={l.source} onChange={e=>updInflow(i,'source',e.target.value)} /></td>
                      <td><input value={l.description} onChange={e=>updInflow(i,'description',e.target.value)} /></td>
                      <td><input type="date" value={l.expectedDate} onChange={e=>updInflow(i,'expectedDate',e.target.value)} /></td>
                      <td><select value={l.bankCode} onChange={e=>updInflow(i,'bankCode',e.target.value)}><option value="">—</option>{BANKS.map(b=><option key={b.code} value={b.code}>{b.name}</option>)}</select></td>
                      <td><input type="number" step="0.01" value={l.amount} onChange={e=>updInflow(i,'amount',e.target.value)} style={{textAlign:'right'}} /></td>
                      <td><button onClick={()=>removeInflow(i)} style={{background:'none',border:'none',color:'#dc2626',cursor:'pointer',fontWeight:900,fontSize:14,padding:'0 4px'}}>✕</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <button className="btn btn-ghost btn-sm" style={{marginTop:6}} onClick={addInflow}>+ Add Inflow</button>

            <div className="summary-bar">
              <div><div style={{fontSize:9,fontWeight:800,color:'#94a3b8',textTransform:'uppercase',letterSpacing:'.06em'}}>Total Out</div><div style={{fontSize:18,fontWeight:900,color:'#dc2626'}}>{fmtCur(totalOut)}</div></div>
              <div><div style={{fontSize:9,fontWeight:800,color:'#94a3b8',textTransform:'uppercase',letterSpacing:'.06em'}}>Total In</div><div style={{fontSize:18,fontWeight:900,color:'#15803d'}}>{fmtCur(totalIn)}</div></div>
              <div><div style={{fontSize:9,fontWeight:800,color:'#94a3b8',textTransform:'uppercase',letterSpacing:'.06em'}}>Net Cash</div><div style={{fontSize:18,fontWeight:900,color:totalIn-totalOut>=0?'#15803d':'#dc2626'}}>{fmtCur(totalIn-totalOut)}</div></div>
            </div>
          </div>
          <div className="modal-f">
            <div style={{display:'flex',gap:8}}>
              {isEdit&&form.status==='Draft'&&<button className="btn btn-ghost btn-sm" onClick={()=>{upd('status','Pending Review');showToast('Status set to Pending Review — save to confirm.');}}>Submit for Review</button>}
            </div>
            <div style={{display:'flex',gap:8}}>
              <button className="btn btn-ghost" onClick={()=>setModal(null)}>Cancel</button>
              <button className="btn btn-primary" disabled={saving} onClick={()=>saveProjection(form)}>{saving?'Saving…':isEdit?'Save Changes':'Create Projection'}</button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  /* ══ Action Menu ══════════════════════════════════════════════ */
  function ActionMenu({proj}) {
    const open = openMenuId===proj.id;
    const ss = STATUS_STYLES[proj.status]||STATUS_STYLES.Draft;
    return (
      <div className="action-menu" onBlur={()=>setTimeout(()=>setOpenMenuId(null),150)}>
        <button className="btn btn-ghost btn-sm" onClick={()=>setOpenMenuId(open?null:proj.id)}>⋮</button>
        {open&&(
          <div className="action-dropdown">
            <button className="action-item" onClick={()=>{setModal({...proj});setOpenMenuId(null);}}>✏️ Edit / View</button>
            <button className="action-item" onClick={()=>{duplicateProjection(proj);setOpenMenuId(null);}}>📋 Duplicate</button>
            {proj.status==='Draft'&&<button className="action-item" onClick={()=>{submitForApproval(proj.id);setOpenMenuId(null);}}>📤 Submit for Review</button>}
            <button className="action-item" style={{color:'#dc2626'}} onClick={()=>{deleteProjection(proj.id);setOpenMenuId(null);}}>🗑 Delete</button>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="proj-wrap">
      <style>{CSS}</style>
      <div className="proj-topbar">
        <div>
          <h1 style={{margin:0,fontSize:18,fontWeight:900}}>Weekly Cash Projections</h1>
          <p style={{margin:0,fontSize:12,color:'#64748b'}}>{projections.length} projection{projections.length!==1?'s':''}</p>
        </div>
        <button className="btn btn-primary" onClick={()=>setModal({})}>+ New Projection</button>
      </div>
      <div className="proj-body">
        {/* ── Primary KPI Scorecards ─────────────────────────────────────── */}
        <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(200px,1fr))',gap:14,marginBottom:12}}>
          <div style={{background:'linear-gradient(135deg,#166534 0%,#16a34a 100%)',borderRadius:14,padding:'18px 20px',color:'#fff',position:'relative',overflow:'hidden'}}>
            <div style={{position:'absolute',right:-8,top:-8,opacity:.13}}>
              <svg width="56" height="56" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"><path d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z"/></svg>
            </div>
            <div style={{fontSize:10,fontWeight:800,letterSpacing:'.08em',textTransform:'uppercase',opacity:.8,marginBottom:6}}>Approved</div>
            <div style={{fontSize:22,fontWeight:900,letterSpacing:'-.5px'}}>{countsByStatus['Approved']||0}</div>
            <div style={{marginTop:10,fontSize:11,opacity:.8}}>{fmtCur(projections.filter(p=>p.status==='Approved').reduce((s,p)=>s+(parseFloat(p.totalAmount)||0),0))} approved</div>
          </div>
          <div style={{background:'linear-gradient(135deg,#b45309 0%,#d97706 100%)',borderRadius:14,padding:'18px 20px',color:'#fff',position:'relative',overflow:'hidden'}}>
            <div style={{position:'absolute',right:-8,top:-8,opacity:.13}}>
              <svg width="56" height="56" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 8v4l3 3"/></svg>
            </div>
            <div style={{fontSize:10,fontWeight:800,letterSpacing:'.08em',textTransform:'uppercase',opacity:.8,marginBottom:6}}>Pending</div>
            <div style={{fontSize:22,fontWeight:900,letterSpacing:'-.5px'}}>{(countsByStatus['Pending Review']||0)+(countsByStatus['Pending Approval']||0)}</div>
            <div style={{marginTop:10,fontSize:11,opacity:.8}}>{fmtCur(totalPending)} under review</div>
          </div>
          <div style={{background:(countsByStatus['Rejected']||0)>0?'linear-gradient(135deg,#991b1b 0%,#dc2626 100%)':'linear-gradient(135deg,#334155 0%,#475569 100%)',borderRadius:14,padding:'18px 20px',color:'#fff',position:'relative',overflow:'hidden'}}>
            <div style={{position:'absolute',right:-8,top:-8,opacity:.13}}>
              <svg width="56" height="56" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><path d="M15 9l-6 6M9 9l6 6"/></svg>
            </div>
            <div style={{fontSize:10,fontWeight:800,letterSpacing:'.08em',textTransform:'uppercase',opacity:.8,marginBottom:6}}>Rejected</div>
            <div style={{fontSize:22,fontWeight:900,letterSpacing:'-.5px'}}>{countsByStatus['Rejected']||0}</div>
            <div style={{marginTop:10,fontSize:11,opacity:.8}}>{(countsByStatus['Rejected']||0)>0?'Needs revision':'All projections clean'}</div>
          </div>
        </div>
        {/* ── Secondary KPI Row ─────────────────────────────────────────── */}
        <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(140px,1fr))',gap:10,marginBottom:16}}>
          {[
            {label:'Total',value:projections.length,sub:'all projections',color:'#1d4ed8',bg:'#eff6ff',border:'#bfdbfe',icon:<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"><path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"/></svg>},
            {label:'Draft',value:countsByStatus['Draft']||0,sub:'not yet submitted',color:'#64748b',bg:'#f8fafc',border:'#e2e8f0',icon:<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>},
            {label:'Pending Review',value:countsByStatus['Pending Review']||0,sub:'awaiting review',color:'#d97706',bg:'#fffbeb',border:'#fde68a',icon:<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>},
            {label:'Pending Approval',value:countsByStatus['Pending Approval']||0,sub:'awaiting final sign-off',color:'#c2410c',bg:'#fff7ed',border:'#fed7aa',icon:<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>},
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
        {/* Filters */}
        <div className="filters">
          <select value={filterStatus} onChange={e=>setFilterStatus(e.target.value)}>
            <option value="">All Statuses</option>
            {PROJ_STATUSES.map(s=><option key={s}>{s}</option>)}
          </select>
          <input placeholder="Search ID or week coverage…" value={search} onChange={e=>setSearch(e.target.value)} style={{minWidth:200}} />
          {(filterStatus||search)&&<button className="btn btn-ghost btn-sm" onClick={()=>{setFilterStatus('');setSearch('');}}>Clear</button>}
          <span style={{marginLeft:'auto',fontSize:12,color:'#64748b'}}>{filtered.length} result{filtered.length!==1?'s':''}</span>
        </div>
        {/* Bulk bar */}
        {selected.size>0&&(
          <div className="bulk-bar">
            <span style={{fontWeight:700,fontSize:13}}>{selected.size} selected</span>
            <button className="btn btn-ghost btn-sm" onClick={bulkSubmit}>📤 Submit for Review</button>
            <button className="btn btn-danger btn-sm" onClick={bulkDelete}>🗑 Delete Selected</button>
            <button className="btn btn-ghost btn-sm" onClick={()=>setSelected(new Set())}>Clear</button>
          </div>
        )}
        {/* Table */}
        {filtered.length===0?<div className="empty">No projections match your filters.</div>:(
          <div style={{overflowX:'auto'}}>
            <table>
              <thead><tr>
                <th style={{width:32}}><input type="checkbox" checked={allSelected} onChange={toggleAll} /></th>
                <th>Proj ID</th><th>Week Coverage</th><th>Date Range</th>
                <th style={{textAlign:'right'}}>Total Out</th><th style={{textAlign:'right'}}>Total In</th>
                <th style={{textAlign:'right'}}>Net Cash</th><th>Status</th><th></th>
              </tr></thead>
              <tbody>
                {filtered.map(p=>{
                  const ss=STATUS_STYLES[p.status]||STATUS_STYLES.Draft;
                  const totalOut=parseFloat(p.totalAmount)||0, totalIn=parseFloat(p.totalInflow)||0;
                  const net=totalIn-totalOut;
                  return (
                    <tr key={p.id} style={{background:selected.has(p.id)?'#fffbf5':''}}>
                      <td><input type="checkbox" checked={selected.has(p.id)} onChange={()=>toggle(p.id)} /></td>
                      <td><button onClick={()=>setModal({...p})} style={{background:'none',border:'none',cursor:'pointer',fontWeight:700,color:'#f97316',fontSize:12,fontFamily:'monospace',padding:0}}>{p.projId||'—'}</button></td>
                      <td style={{fontWeight:600}}>{p.weekCoverage||'—'}</td>
                      <td style={{color:'#64748b',fontSize:11}}>{p.startDate&&p.endDate?`${fmtDate(p.startDate)} – ${fmtDate(p.endDate)}`:'—'}</td>
                      <td style={{textAlign:'right',color:'#dc2626',fontWeight:700}}>{fmtCur(totalOut)}</td>
                      <td style={{textAlign:'right',color:'#15803d',fontWeight:700}}>{fmtCur(totalIn)}</td>
                      <td style={{textAlign:'right',fontWeight:700,color:net>=0?'#15803d':'#dc2626'}}>{fmtCur(net)}</td>
                      <td><span className="pill" style={{background:ss.bg,borderColor:ss.border,color:ss.color}}>{p.status||'Draft'}</span></td>
                      <td><ActionMenu proj={p} /></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
      {modal!==null&&<ProjectionModal />}
      {confirmModal && (
        <div className="backdrop" onClick={() => setConfirmModal(null)}>
          <div style={{width:'min(400px,98vw)',background:'#fff',borderRadius:16,overflow:'hidden',boxShadow:'0 24px 64px rgba(0,0,0,.25)'}} onClick={e=>e.stopPropagation()}>
            <div style={{padding:'14px 18px',borderBottom:'1px solid #e5e7eb',background:'#f8fafc',display:'flex',alignItems:'center',justifyContent:'space-between'}}>
              <strong style={{fontSize:14,fontWeight:900,color:'#0b1220'}}>Confirm Action</strong>
              <button className="btn btn-ghost btn-sm" onClick={()=>setConfirmModal(null)}>✕</button>
            </div>
            <div style={{padding:'18px'}}>
              <p style={{margin:0,fontSize:14,color:'#0b1220',lineHeight:1.5}}>{confirmModal.message}</p>
            </div>
            <div style={{display:'flex',justifyContent:'flex-end',gap:10,padding:'12px 18px',borderTop:'1px solid #e5e7eb'}}>
              <button className="btn btn-ghost" onClick={()=>setConfirmModal(null)}>Cancel</button>
              <button className="btn btn-primary" style={{background:'#dc2626'}} onClick={()=>{confirmModal.onConfirm();setConfirmModal(null);}}>Confirm</button>
            </div>
          </div>
        </div>
      )}
      {toast&&<div className="toast">{toast}</div>}
    </div>
  );
}

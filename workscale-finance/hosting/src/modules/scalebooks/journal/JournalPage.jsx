import { useState, useEffect, useMemo } from 'react';
import {
  collection, query, orderBy, onSnapshot,
  addDoc, updateDoc, doc, serverTimestamp, deleteDoc
} from 'firebase/firestore';
import { db, auth } from '../../../firebase.js';

const JE_TYPES = ['Manual','Adjusting','Closing','Reversing'];
const PAGE_SIZES = [20, 50, 100];
const uid = () => Math.random().toString(36).slice(2,10).toUpperCase();

const fmtPHP = n => new Intl.NumberFormat('en-PH',{minimumFractionDigits:2,maximumFractionDigits:2}).format(n||0);
const fmtCur = n => '₱' + fmtPHP(n);

const STATUS_STYLES = {
  Draft:    {bg:'#fef9c3',border:'#fde68a',color:'#a16207'},
  Posted:   {bg:'#f0fdf4',border:'#bbf7d0',color:'#15803d'},
  Reversed: {bg:'#fff7ed',border:'#fed7aa',color:'#c2410c'},
  Voided:   {bg:'#fef2f2',border:'#fecaca',color:'#b91c1c'},
};

const CSS = `
  .jp-wrap{display:flex;flex-direction:column;height:100%;overflow:hidden;font-family:Inter,system-ui,sans-serif;}
  .jp-topbar{display:flex;align-items:center;justify-content:space-between;padding:14px 22px 10px;flex-shrink:0;border-bottom:1px solid #e5e7eb;background:#fff;gap:12px;flex-wrap:wrap;}
  .jp-body{flex:1;overflow-y:auto;padding:16px 22px;}
  .stats-bar{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:16px;}
  .stat{background:#fff;border:1px solid #e5e7eb;border-radius:12px;padding:12px 16px;}
  .stat-lbl{font-size:9px;font-weight:800;color:#94a3b8;letter-spacing:.07em;text-transform:uppercase;margin-bottom:3px;}
  .stat-val{font-size:18px;font-weight:900;}
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
  .pill{display:inline-block;padding:2px 9px;border-radius:999px;font-size:11px;font-weight:700;border:1px solid;}
  .empty{padding:48px;text-align:center;color:#94a3b8;}
  .backdrop{position:fixed;inset:0;background:rgba(15,23,42,.45);display:flex;align-items:center;justify-content:center;padding:16px;z-index:100;}
  .modal{width:min(820px,98vw);max-height:95vh;background:#fff;border-radius:16px;display:flex;flex-direction:column;overflow:hidden;box-shadow:0 24px 64px rgba(0,0,0,.25);}
  .modal-h{display:flex;align-items:center;justify-content:space-between;padding:16px 20px;border-bottom:1px solid #e5e7eb;background:#f8fafc;flex-shrink:0;}
  .modal-b{padding:20px;overflow-y:auto;flex:1;}
  .modal-f{display:flex;justify-content:space-between;align-items:center;gap:10px;padding:14px 20px;border-top:1px solid #e5e7eb;flex-shrink:0;}
  .grid4{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:12px;}
  .col2{grid-column:span 2;}.col3{grid-column:span 3;}.col4{grid-column:span 4;}
  .field{display:flex;flex-direction:column;gap:5px;}
  .field label{font-size:10px;font-weight:800;color:#64748b;letter-spacing:.06em;text-transform:uppercase;}
  .field input,.field select,.field textarea{width:100%;border:1px solid #e5e7eb;border-radius:10px;padding:9px 10px;font-size:13px;background:#fff;font-family:inherit;box-sizing:border-box;}
  .sec-hdr{font-size:11px;font-weight:900;color:#64748b;letter-spacing:.07em;text-transform:uppercase;margin:14px 0 6px;padding-bottom:4px;border-bottom:1px solid #e5e7eb;}
  .line-table{width:100%;border-collapse:collapse;}
  .line-table th{padding:4px 6px;background:#f8fafc;color:#94a3b8;font-size:9px;font-weight:800;letter-spacing:.06em;text-transform:uppercase;text-align:left;}
  .line-table td{padding:4px;border-bottom:1px solid #f1f5f9;}
  .line-table input{border:1px solid #e5e7eb;border-radius:6px;padding:5px 7px;font-size:11px;font-family:inherit;width:100%;box-sizing:border-box;}
  .balance-bar{display:flex;gap:16px;background:#f8fafc;border-radius:10px;padding:10px 14px;margin-top:10px;font-size:12px;align-items:center;}
  .je-row{background:#fff;border:1px solid #e5e7eb;border-radius:10px;margin-bottom:8px;overflow:hidden;}
  .je-hdr{display:flex;align-items:center;justify-content:space-between;padding:10px 14px;cursor:pointer;gap:8px;}
  .je-hdr:hover{background:#f8fafc;}
  .je-lines-wrap{padding:8px 14px 12px;border-top:1px solid #f1f5f9;}
  .pagination{display:flex;align-items:center;gap:6px;margin-top:14px;justify-content:center;}
  .page-btn{background:#fff;border:1px solid #e5e7eb;border-radius:8px;padding:5px 10px;font-size:12px;cursor:pointer;font-family:inherit;}
  .page-btn:disabled{color:#d1d5db;cursor:default;}
  .page-btn-active{background:#f97316;color:#fff;border-color:#f97316;}
  .toast{position:fixed;right:16px;bottom:16px;background:#0b1220;color:#fff;padding:12px 18px;border-radius:12px;font-size:13px;font-weight:600;z-index:999;}
  @media(max-width:640px){.stats-bar{grid-template-columns:repeat(2,1fr);}}
`;

export default function JournalPage() {
  const [entries, setEntries]   = useState([]);
  const [expanded, setExpanded] = useState(new Set());
  const [search, setSearch]     = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [filterType, setFilterType]     = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo]     = useState('');
  const [modal, setModal]       = useState(null);
  const [lines, setLines]       = useState([]);
  const [saving, setSaving]     = useState(false);
  const [toast, setToast]       = useState('');
  const [page, setPage]         = useState(1);
  const [pageSize, setPageSize] = useState(20);

  const showToast = msg => { setToast(msg); setTimeout(()=>setToast(''),3000); };

  useEffect(() => {
    return onSnapshot(
      query(collection(db,'journalEntries'), orderBy('date','desc')),
      snap => { setEntries(snap.docs.map(d=>({id:d.id,...d.data()}))); setPage(1); }
    );
  }, []);

  /* ── Filter ────────────────────────────────────────────────── */
  const filtered = useMemo(() => entries.filter(e => {
    if (filterStatus && e.status!==filterStatus) return false;
    if (filterType && e.type!==filterType) return false;
    if (dateFrom && (e.date||'')<dateFrom) return false;
    if (dateTo && (e.date||'')>dateTo) return false;
    if (search) {
      const q=search.toLowerCase();
      if (!((e.jeId||'').toLowerCase().includes(q)||(e.description||'').toLowerCase().includes(q)||(e.createdBy||'').toLowerCase().includes(q))) return false;
    }
    return true;
  }), [entries, filterStatus, filterType, dateFrom, dateTo, search]);

  const totalPages = Math.max(1, Math.ceil(filtered.length/pageSize));
  const paginated = filtered.slice((page-1)*pageSize, page*pageSize);

  /* ── Stats ─────────────────────────────────────────────────── */
  const totalDebits  = entries.reduce((s,e)=>(e.lines||[]).reduce((ss,l)=>ss+(parseFloat(l.debit)||0),s),0);
  const totalPosted  = entries.filter(e=>e.status==='Posted').length;
  const totalDraft   = entries.filter(e=>e.status==='Draft').length;
  const totalEntries = entries.length;

  /* ── Toggle expand ──────────────────────────────────────────── */
  const toggleExpand = id => setExpanded(s=>{const n=new Set(s);n.has(id)?n.delete(id):n.add(id);return n;});

  /* ── Open new JE modal ──────────────────────────────────────── */
  function openNew() {
    const jeId='JE-'+new Date().getFullYear()+'-'+uid();
    setModal({jeId, date:new Date().toISOString().slice(0,10), description:'', type:'Manual', status:'Draft', reference:''});
    setLines([
      {id:uid(),accountCode:'',accountName:'',description:'',debit:'',credit:''},
      {id:uid(),accountCode:'',accountName:'',description:'',debit:'',credit:''},
    ]);
  }

  function openEdit(e) {
    setModal({...e});
    setLines((e.lines||[]).map(l=>({id:uid(),...l})));
  }

  /* ── Save ──────────────────────────────────────────────────── */
  async function saveJE(form, postNow) {
    setSaving(true);
    try {
      const validLines = lines.filter(l=>l.accountCode||(parseFloat(l.debit)>0)||(parseFloat(l.credit)>0));
      const totalDebit  = validLines.reduce((s,l)=>s+(parseFloat(l.debit)||0),0);
      const totalCredit = validLines.reduce((s,l)=>s+(parseFloat(l.credit)||0),0);
      if (Math.abs(totalDebit-totalCredit)>0.005) { alert('Debits must equal Credits before saving.'); setSaving(false); return; }
      const payload = {
        jeId: form.jeId||'', date: form.date||'', description: form.description||'',
        type: form.type||'Manual', reference: form.reference||'',
        status: postNow?'Posted':(form.status||'Draft'),
        lines: validLines.map(l=>({accountCode:l.accountCode||'',accountName:l.accountName||'',description:l.description||'',debit:parseFloat(l.debit)||0,credit:parseFloat(l.credit)||0})),
        totalDebit, totalCredit,
        updatedAt: serverTimestamp(), updatedBy: auth.currentUser?.email||'',
      };
      if (form.id) {
        await updateDoc(doc(db,'journalEntries',form.id), payload);
        showToast(postNow?'Posted!':'JE updated.');
      } else {
        await addDoc(collection(db,'journalEntries'), {...payload, createdAt:serverTimestamp(), createdBy:auth.currentUser?.email||''});
        showToast(postNow?'JE created and posted!':'JE saved as draft.');
      }
      setModal(null);
    } catch(e) { console.error(e); alert('Save failed.'); }
    setSaving(false);
  }

  async function postEntry(id) {
    await updateDoc(doc(db,'journalEntries',id),{status:'Posted',updatedAt:serverTimestamp(),updatedBy:auth.currentUser?.email||''});
    showToast('Posted.');
  }

  async function reverseEntry(e) {
    const rev = {
      jeId:'JE-REV-'+uid(), date:new Date().toISOString().slice(0,10),
      description:`Reversal of ${e.jeId}`, type:'Reversing', reference:e.jeId, status:'Draft',
      lines:(e.lines||[]).map(l=>({accountCode:l.accountCode,accountName:l.accountName,description:l.description,debit:l.credit||0,credit:l.debit||0})),
      totalDebit:e.totalCredit||0, totalCredit:e.totalDebit||0,
      createdAt:serverTimestamp(), createdBy:auth.currentUser?.email||'',
    };
    await addDoc(collection(db,'journalEntries'),rev);
    await updateDoc(doc(db,'journalEntries',e.id),{status:'Reversed',updatedAt:serverTimestamp()});
    showToast('Reversing entry created.');
  }

  async function deleteEntry(id) {
    if(!confirm('Delete this journal entry?')) return;
    await deleteDoc(doc(db,'journalEntries',id));
  }

  /* ── Line helpers ───────────────────────────────────────────── */
  const updLine=(id,k,v)=>setLines(ls=>ls.map(l=>l.id===id?{...l,[k]:v}:l));
  const addLine=()=>setLines(ls=>[...ls,{id:uid(),accountCode:'',accountName:'',description:'',debit:'',credit:''}]);
  const removeLine=id=>setLines(ls=>ls.filter(l=>l.id!==id));
  const totalDebit=lines.reduce((s,l)=>s+(parseFloat(l.debit)||0),0);
  const totalCredit=lines.reduce((s,l)=>s+(parseFloat(l.credit)||0),0);
  const isBalanced=Math.abs(totalDebit-totalCredit)<0.005&&totalDebit>0;

  /* ══ JE Form Modal ════════════════════════════════════════════ */
  function JEModal() {
    if (!modal) return null;
    const isEdit=!!modal.id;
    const ss=STATUS_STYLES[modal.status]||STATUS_STYLES.Draft;
    return (
      <div className="backdrop" onClick={e=>e.target===e.currentTarget&&setModal(null)}>
        <div className="modal">
          <div className="modal-h">
            <strong>{isEdit?`Edit JE — ${modal.jeId||''}`:modal.jeId||'New Journal Entry'}</strong>
            <div style={{display:'flex',gap:8,alignItems:'center'}}>
              <span className="pill" style={{background:ss.bg,borderColor:ss.border,color:ss.color}}>{modal.status}</span>
              <button className="btn btn-ghost btn-sm" onClick={()=>setModal(null)}>✕</button>
            </div>
          </div>
          <div className="modal-b">
            <div className="grid4">
              <div className="field"><label>JE ID *</label><input value={modal.jeId} onChange={e=>setModal(m=>({...m,jeId:e.target.value}))} /></div>
              <div className="field"><label>Date *</label><input type="date" value={modal.date} onChange={e=>setModal(m=>({...m,date:e.target.value}))} /></div>
              <div className="field"><label>Type</label><select value={modal.type||'Manual'} onChange={e=>setModal(m=>({...m,type:e.target.value}))}>{JE_TYPES.map(t=><option key={t}>{t}</option>)}</select></div>
              <div className="field"><label>Reference</label><input value={modal.reference||''} onChange={e=>setModal(m=>({...m,reference:e.target.value}))} /></div>
              <div className="field col4"><label>Description *</label><input value={modal.description} onChange={e=>setModal(m=>({...m,description:e.target.value}))} /></div>
            </div>
            <div className="sec-hdr">Journal Lines</div>
            <div style={{overflowX:'auto'}}>
              <table className="line-table">
                <thead><tr>
                  <th style={{width:'15%'}}>Account Code</th>
                  <th style={{width:'22%'}}>Account Name</th>
                  <th style={{width:'25%'}}>Description</th>
                  <th style={{width:'14%',textAlign:'right'}}>Debit</th>
                  <th style={{width:'14%',textAlign:'right'}}>Credit</th>
                  <th style={{width:'5%'}}></th>
                </tr></thead>
                <tbody>
                  {lines.map(l=>(
                    <tr key={l.id}>
                      <td><input value={l.accountCode} onChange={e=>updLine(l.id,'accountCode',e.target.value)} /></td>
                      <td><input value={l.accountName} onChange={e=>updLine(l.id,'accountName',e.target.value)} /></td>
                      <td><input value={l.description} onChange={e=>updLine(l.id,'description',e.target.value)} /></td>
                      <td><input type="number" step="0.01" value={l.debit} onChange={e=>{updLine(l.id,'debit',e.target.value);if(parseFloat(e.target.value)>0) updLine(l.id,'credit','');}} style={{textAlign:'right'}} /></td>
                      <td><input type="number" step="0.01" value={l.credit} onChange={e=>{updLine(l.id,'credit',e.target.value);if(parseFloat(e.target.value)>0) updLine(l.id,'debit','');}} style={{textAlign:'right'}} /></td>
                      <td><button onClick={()=>removeLine(l.id)} style={{background:'none',border:'none',color:'#dc2626',cursor:'pointer',fontWeight:900,fontSize:14,padding:'0 4px'}}>✕</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <button className="btn btn-ghost btn-sm" style={{marginTop:6}} onClick={addLine}>+ Add Line</button>
            <div className="balance-bar">
              <span style={{flex:1}}>Total Debit: <strong style={{color:'#dc2626'}}>{fmtCur(totalDebit)}</strong></span>
              <span style={{flex:1}}>Total Credit: <strong style={{color:'#15803d'}}>{fmtCur(totalCredit)}</strong></span>
              <span style={{fontWeight:900,color:isBalanced?'#15803d':'#dc2626'}}>
                {isBalanced?'✅ Balanced':`⚠ Out of balance by ${fmtCur(Math.abs(totalDebit-totalCredit))}`}
              </span>
            </div>
          </div>
          <div className="modal-f">
            <div style={{fontSize:12,color:'#64748b'}}>{lines.length} line{lines.length!==1?'s':''}</div>
            <div style={{display:'flex',gap:8}}>
              <button className="btn btn-ghost" onClick={()=>setModal(null)}>Cancel</button>
              {modal.status!=='Posted'&&<button className="btn btn-ghost" disabled={saving} onClick={()=>saveJE(modal,false)}>Save Draft</button>}
              <button className="btn btn-primary" disabled={saving||!isBalanced} onClick={()=>saveJE(modal,true)} title={isBalanced?'':'Balance debits and credits first'}>{saving?'Saving…':modal.status==='Posted'?'Update':'Post JE'}</button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="jp-wrap">
      <style>{CSS}</style>
      <div className="jp-topbar">
        <div>
          <h1 style={{margin:0,fontSize:18,fontWeight:900}}>Journal Entries</h1>
          <p style={{margin:0,fontSize:12,color:'#64748b'}}>{totalEntries} entries · {totalPosted} posted · {totalDraft} draft</p>
        </div>
        <button className="btn btn-primary" onClick={openNew}>+ New JE</button>
      </div>
      <div className="jp-body">
        {/* Stats */}
        <div className="stats-bar">
          <div className="stat"><div className="stat-lbl">Total Entries</div><div className="stat-val">{totalEntries}</div></div>
          <div className="stat"><div className="stat-lbl">Posted</div><div className="stat-val" style={{color:'#15803d'}}>{totalPosted}</div></div>
          <div className="stat"><div className="stat-lbl">Draft</div><div className="stat-val" style={{color:'#a16207'}}>{totalDraft}</div></div>
          <div className="stat"><div className="stat-lbl">Total Debits (Posted)</div><div className="stat-val">{fmtCur(entries.filter(e=>e.status==='Posted').reduce((s,e)=>s+(parseFloat(e.totalDebit)||0),0))}</div></div>
        </div>
        {/* Filters */}
        <div className="filters">
          <input placeholder="Search JE ID, description, user…" value={search} onChange={e=>{setSearch(e.target.value);setPage(1);}} style={{minWidth:200}} />
          <select value={filterStatus} onChange={e=>{setFilterStatus(e.target.value);setPage(1);}}>
            <option value="">All Statuses</option>
            {Object.keys(STATUS_STYLES).map(s=><option key={s}>{s}</option>)}
          </select>
          <select value={filterType} onChange={e=>{setFilterType(e.target.value);setPage(1);}}>
            <option value="">All Types</option>
            {JE_TYPES.map(t=><option key={t}>{t}</option>)}
          </select>
          <input type="date" value={dateFrom} onChange={e=>{setDateFrom(e.target.value);setPage(1);}} title="From date" />
          <input type="date" value={dateTo} onChange={e=>{setDateTo(e.target.value);setPage(1);}} title="To date" />
          {(search||filterStatus||filterType||dateFrom||dateTo)&&<button className="btn btn-ghost btn-sm" onClick={()=>{setSearch('');setFilterStatus('');setFilterType('');setDateFrom('');setDateTo('');setPage(1);}}>Clear</button>}
          <select value={pageSize} onChange={e=>{setPageSize(Number(e.target.value));setPage(1);}} style={{marginLeft:'auto'}}>
            {PAGE_SIZES.map(n=><option key={n} value={n}>{n} per page</option>)}
          </select>
          <span style={{fontSize:12,color:'#64748b'}}>{filtered.length} result{filtered.length!==1?'s':''}</span>
        </div>
        {/* List */}
        {filtered.length===0?<div className="empty">No journal entries match your filters.</div>:(
          <>
            {paginated.map(e=>{
              const ss=STATUS_STYLES[e.status]||STATUS_STYLES.Draft;
              const isOpen=expanded.has(e.id);
              return (
                <div key={e.id} className="je-row">
                  <div className="je-hdr" onClick={()=>toggleExpand(e.id)}>
                    <div style={{display:'flex',gap:10,alignItems:'center',flex:1,flexWrap:'wrap'}}>
                      <span style={{fontFamily:'monospace',fontWeight:800,color:'#f97316',fontSize:12}}>{e.jeId||'—'}</span>
                      <span style={{fontWeight:600,fontSize:12}}>{e.date||'—'}</span>
                      <span style={{color:'#0b1220',fontSize:12,flex:1}}>{e.description||'—'}</span>
                      <span className="pill" style={{background:ss.bg,borderColor:ss.border,color:ss.color}}>{e.status||'Draft'}</span>
                      {e.type&&e.type!=='Manual'&&<span className="pill" style={{background:'#f8fafc',borderColor:'#e2e8f0',color:'#64748b'}}>{e.type}</span>}
                    </div>
                    <div style={{display:'flex',gap:6,alignItems:'center',flexShrink:0}}>
                      <span style={{fontWeight:700,fontSize:12,color:'#64748b'}}>{fmtCur(e.totalDebit||0)}</span>
                      <button className="btn btn-ghost btn-sm" onClick={ev=>{ev.stopPropagation();openEdit(e);}}>Edit</button>
                      {e.status==='Draft'&&<button className="btn btn-ghost btn-sm" style={{borderColor:'#bbf7d0',color:'#15803d'}} onClick={ev=>{ev.stopPropagation();postEntry(e.id);}}>Post</button>}
                      {e.status==='Posted'&&<button className="btn btn-ghost btn-sm" style={{borderColor:'#fed7aa',color:'#c2410c'}} onClick={ev=>{ev.stopPropagation();reverseEntry(e);}}>Reverse</button>}
                      {e.status==='Draft'&&<button onClick={ev=>{ev.stopPropagation();deleteEntry(e.id);}} style={{background:'none',border:'none',color:'#dc2626',cursor:'pointer',fontWeight:900,fontSize:13,padding:'3px 5px'}}>✕</button>}
                      <span style={{color:'#94a3b8',fontSize:14}}>{isOpen?'▲':'▼'}</span>
                    </div>
                  </div>
                  {isOpen&&(
                    <div className="je-lines-wrap">
                      <table>
                        <thead><tr>
                          <th>Account Code</th><th>Account Name</th><th>Description</th>
                          <th style={{textAlign:'right'}}>Debit</th><th style={{textAlign:'right'}}>Credit</th>
                        </tr></thead>
                        <tbody>
                          {(e.lines||[]).map((l,i)=>(
                            <tr key={i}>
                              <td style={{fontFamily:'monospace',fontWeight:600}}>{l.accountCode||'—'}</td>
                              <td>{l.accountName||'—'}</td>
                              <td style={{color:'#64748b'}}>{l.description||'—'}</td>
                              <td style={{textAlign:'right',color:'#dc2626',fontWeight:l.debit>0?700:400}}>{l.debit>0?fmtCur(l.debit):'—'}</td>
                              <td style={{textAlign:'right',color:'#15803d',fontWeight:l.credit>0?700:400}}>{l.credit>0?fmtCur(l.credit):'—'}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      <div style={{display:'flex',gap:8,marginTop:6,fontSize:11,color:'#64748b'}}>
                        <span>Created by: {e.createdBy||'—'}</span>
                        {e.reference&&<span>· Ref: {e.reference}</span>}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
            {/* Pagination */}
            <div className="pagination">
              <button className="page-btn" disabled={page===1} onClick={()=>setPage(1)}>«</button>
              <button className="page-btn" disabled={page===1} onClick={()=>setPage(p=>p-1)}>‹</button>
              {Array.from({length:Math.min(totalPages,7)},(_,i)=>{
                let p;
                if (totalPages<=7) p=i+1;
                else if (page<=4) p=i+1;
                else if (page>=totalPages-3) p=totalPages-6+i;
                else p=page-3+i;
                return <button key={p} className={`page-btn ${page===p?'page-btn-active':''}`} onClick={()=>setPage(p)}>{p}</button>;
              })}
              <button className="page-btn" disabled={page===totalPages} onClick={()=>setPage(p=>p+1)}>›</button>
              <button className="page-btn" disabled={page===totalPages} onClick={()=>setPage(totalPages)}>»</button>
              <span style={{fontSize:11,color:'#94a3b8',marginLeft:4}}>Page {page} of {totalPages}</span>
            </div>
          </>
        )}
      </div>
      {modal!==null&&<JEModal />}
      {toast&&<div className="toast">{toast}</div>}
    </div>
  );
}

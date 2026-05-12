import { useState, useEffect } from 'react';
import {
  collection, query, orderBy, onSnapshot,
  addDoc, updateDoc, doc, serverTimestamp, deleteDoc
} from 'firebase/firestore';
import { db, auth } from '../../../firebase.js';

const BANKS = [
  {code:'UBPBPHM',name:'UnionBank'},{code:'BPI',name:'BPI'},{code:'BDO',name:'BDO'},
  {code:'RCBC',name:'RCBC'},{code:'MBTC',name:'Metrobank'},{code:'CASH',name:'Petty Cash'},
];
const CHECK_STATUSES = ['Issued','Cleared','Voided','Stopped','Stale'];
const CHECKBOOK_TYPES = ['Regular','Business','Payroll','Manager'];

const STATUS_STYLES = {
  Issued:   {bg:'#eff6ff',border:'#bfdbfe',color:'#1d4ed8'},
  Cleared:  {bg:'#f0fdf4',border:'#bbf7d0',color:'#15803d'},
  Voided:   {bg:'#fef2f2',border:'#fecaca',color:'#b91c1c'},
  Stopped:  {bg:'#fff7ed',border:'#fed7aa',color:'#c2410c'},
  Stale:    {bg:'#f8fafc',border:'#e2e8f0',color:'#64748b'},
};

const fmtPHP = n => new Intl.NumberFormat('en-PH',{minimumFractionDigits:2,maximumFractionDigits:2}).format(n||0);
const fmtCur = n => '₱' + fmtPHP(n);
const bankName = code => BANKS.find(b=>b.code===code)?.name || code;

const CSS = `
  .cr-wrap{display:flex;flex-direction:column;height:100%;overflow:hidden;font-family:Inter,system-ui,sans-serif;}
  .cr-topbar{display:flex;align-items:center;justify-content:space-between;padding:14px 22px 10px;flex-shrink:0;border-bottom:1px solid #e5e7eb;background:#fff;gap:12px;flex-wrap:wrap;}
  .cr-tabs{display:flex;background:#fff;border-bottom:2px solid #e5e7eb;flex-shrink:0;}
  .cr-tab{padding:10px 16px;font-size:12px;font-weight:600;border:none;background:transparent;color:#64748b;cursor:pointer;white-space:nowrap;border-bottom:2px solid transparent;margin-bottom:-2px;font-family:inherit;}
  .cr-tab:hover{color:#0b1220;}
  .cr-tab-active{color:#f97316;border-bottom-color:#f97316;font-weight:800;}
  .cr-body{flex:1;overflow-y:auto;padding:16px 22px;}
  .kpi-row{display:grid;grid-template-columns:repeat(5,1fr);gap:10px;margin-bottom:16px;}
  .kpi{background:#fff;border:1px solid #e5e7eb;border-radius:12px;padding:12px 14px;}
  .kpi-lbl{font-size:9px;font-weight:800;color:#94a3b8;letter-spacing:.07em;text-transform:uppercase;margin-bottom:3px;}
  .kpi-val{font-size:18px;font-weight:900;}
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
  .sec-hdr{font-size:11px;font-weight:900;color:#94a3b8;letter-spacing:.07em;text-transform:uppercase;margin:14px 0 8px;padding-bottom:4px;border-bottom:1px solid #e5e7eb;}
  .cb-banner{background:#eff6ff;border:1px solid #bfdbfe;border-radius:10px;padding:10px 14px;margin-bottom:12px;font-size:12px;}
  .toast{position:fixed;right:16px;bottom:16px;background:#0b1220;color:#fff;padding:12px 18px;border-radius:12px;font-size:13px;font-weight:600;z-index:999;}
  @media(max-width:640px){.kpi-row{grid-template-columns:repeat(3,1fr);}}
`;

export default function CheckRegistryPage() {
  const [checks, setChecks]         = useState([]);
  const [checkbooks, setCheckbooks] = useState([]);
  const [activeTab, setActiveTab]   = useState('register');
  const [modal, setModal]           = useState(null);
  const [cbModal, setCbModal]       = useState(null);
  const [statusModal, setStatusModal] = useState(null);
  const [filterBank, setFilterBank] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [search, setSearch]         = useState('');
  const [saving, setSaving]         = useState(false);
  const [toast, setToast]           = useState('');

  const showToast = msg => { setToast(msg); setTimeout(()=>setToast(''),3000); };

  useEffect(() => {
    const q1 = query(collection(db,'checkRegister'),orderBy('issueDate','desc'));
    const q2 = query(collection(db,'checkbookMaster'),orderBy('bankCode','asc'));
    const u1 = onSnapshot(q1, snap=>setChecks(snap.docs.map(d=>({id:d.id,...d.data()}))));
    const u2 = onSnapshot(q2, snap=>setCheckbooks(snap.docs.map(d=>({id:d.id,...d.data()}))));
    return () => { u1(); u2(); };
  }, []);

  /* ── KPIs ──────────────────────────────────────────────────── */
  const countsByStatus = {};
  CHECK_STATUSES.forEach(s => { countsByStatus[s] = checks.filter(c=>c.status===s).length; });
  const totalIssued = checks.filter(c=>c.status==='Issued').reduce((s,c)=>s+(parseFloat(c.amount)||0),0);

  /* ── Filter ────────────────────────────────────────────────── */
  const filtered = checks.filter(c => {
    if (filterBank && c.bankCode!==filterBank) return false;
    if (filterStatus && c.status!==filterStatus) return false;
    if (search) {
      const q=search.toLowerCase();
      if (!((c.payeeName||'').toLowerCase().includes(q)||(c.checkNumber||'').toLowerCase().includes(q)||(c.referenceId||'').toLowerCase().includes(q))) return false;
    }
    return true;
  });

  /* ── Active checkbook for any bank ──────────────────────────── */
  function activeCheckbook(bankCode) {
    return checkbooks.find(cb=>cb.bankCode===bankCode&&cb.isActive!==false) || null;
  }

  /* ── Save check ──────────────────────────────────────────────── */
  async function saveCheck(form) {
    setSaving(true);
    try {
      const payload = {
        checkNumber: form.checkNumber||'', issueDate: form.issueDate||'',
        bankCode: form.bankCode||'', payeeName: form.payeeName||'',
        amount: parseFloat(form.amount)||0, status: form.status||'Issued',
        referenceId: form.referenceId||'', notes: form.notes||'',
        clearedDate: form.clearedDate||'', voidedDate: form.voidedDate||'',
        voidReason: form.voidReason||'', stoppedDate: form.stoppedDate||'',
        staleDate: form.staleDate||'',
        updatedAt: serverTimestamp(), updatedBy: auth.currentUser?.email||'',
      };
      if (form.id) {
        await updateDoc(doc(db,'checkRegister',form.id), payload);
        showToast('Check updated.');
      } else {
        await addDoc(collection(db,'checkRegister'), {...payload, createdAt:serverTimestamp(), createdBy:auth.currentUser?.email||''});
        /* Auto-increment checkbook next number */
        const cb = activeCheckbook(form.bankCode);
        if (cb) {
          const next = parseInt(form.checkNumber)||0;
          const cbNext = parseInt(cb.nextCheckNumber)||0;
          if (next >= cbNext) {
            await updateDoc(doc(db,'checkbookMaster',cb.id), {nextCheckNumber: String(next+1).padStart(String(cb.endingNumber||0).length,String(cb.startingNumber||'0').charAt(0)||'0')});
          }
        }
        showToast('Check added.');
      }
      setModal(null);
    } catch(e) { console.error(e); alert('Save failed.'); }
    setSaving(false);
  }

  async function deleteCheck(id) {
    if (!confirm('Delete this check entry?')) return;
    await deleteDoc(doc(db,'checkRegister',id));
    showToast('Deleted.');
  }

  async function updateStatus(form) {
    setSaving(true);
    try {
      const patch = {status:form.status, updatedAt:serverTimestamp(), updatedBy:auth.currentUser?.email||''};
      if (form.status==='Cleared') patch.clearedDate = form.clearedDate||'';
      if (form.status==='Voided') { patch.voidedDate=form.voidedDate||''; patch.voidReason=form.voidReason||''; }
      if (form.status==='Stopped') patch.stoppedDate = form.stoppedDate||'';
      if (form.status==='Stale') patch.staleDate = form.staleDate||'';
      await updateDoc(doc(db,'checkRegister',form.id), patch);
      setStatusModal(null); showToast(`Status updated to ${form.status}.`);
    } catch(e) { console.error(e); alert('Update failed.'); }
    setSaving(false);
  }

  /* ── Save checkbook ──────────────────────────────────────────── */
  async function saveCheckbook(form) {
    setSaving(true);
    try {
      const payload = {
        bankCode: form.bankCode||'', checkbookType: form.checkbookType||'Regular',
        startingNumber: form.startingNumber||'', endingNumber: form.endingNumber||'',
        nextCheckNumber: form.nextCheckNumber||form.startingNumber||'',
        isActive: form.isActive!==false, notes: form.notes||'',
        updatedAt: serverTimestamp(), updatedBy: auth.currentUser?.email||'',
      };
      if (form.id) {
        await updateDoc(doc(db,'checkbookMaster',form.id), payload);
      } else {
        await addDoc(collection(db,'checkbookMaster'), {...payload, createdAt:serverTimestamp(), createdBy:auth.currentUser?.email||''});
      }
      setCbModal(null); showToast('Checkbook saved.');
    } catch(e) { console.error(e); alert('Save failed.'); }
    setSaving(false);
  }

  const TABS = [{key:'register',label:'Check Register'},{key:'checkbooks',label:'Checkbooks'}];

  /* ══ Tab: Check Register ══════════════════════════════════════ */
  function RegisterTab() {
    return (
      <div>
        <div className="kpi-row">
          {CHECK_STATUSES.map(s=>{
            const st=STATUS_STYLES[s];
            return <div key={s} className="kpi" style={{borderTop:`3px solid ${st.border}`}}>
              <div className="kpi-lbl">{s}</div>
              <div className="kpi-val" style={{color:st.color}}>{countsByStatus[s]||0}</div>
            </div>;
          })}
        </div>
        <div className="filters">
          <button className="btn btn-primary btn-sm" onClick={()=>setModal({status:'Issued'})}>+ New Check</button>
          <select value={filterBank} onChange={e=>setFilterBank(e.target.value)}>
            <option value="">All Banks</option>
            {BANKS.map(b=><option key={b.code} value={b.code}>{b.name}</option>)}
          </select>
          <select value={filterStatus} onChange={e=>setFilterStatus(e.target.value)}>
            <option value="">All Statuses</option>
            {CHECK_STATUSES.map(s=><option key={s}>{s}</option>)}
          </select>
          <input placeholder="Search check #, payee, reference…" value={search} onChange={e=>setSearch(e.target.value)} style={{minWidth:200}} />
          {(filterBank||filterStatus||search)&&<button className="btn btn-ghost btn-sm" onClick={()=>{setFilterBank('');setFilterStatus('');setSearch('');}}>Clear</button>}
          <span style={{marginLeft:'auto',fontSize:12,color:'#64748b'}}>{filtered.length} check{filtered.length!==1?'s':''} · Outstanding: <strong>{fmtCur(totalIssued)}</strong></span>
        </div>
        {filtered.length===0?<div className="empty">No checks match your filters.</div>:(
          <div style={{overflowX:'auto'}}>
            <table>
              <thead><tr>
                <th>Check No.</th><th>Issue Date</th><th>Bank</th>
                <th>Payee</th><th style={{textAlign:'right'}}>Amount</th>
                <th>Reference</th><th>Status</th><th></th>
              </tr></thead>
              <tbody>
                {filtered.map(c=>{
                  const ss=STATUS_STYLES[c.status]||STATUS_STYLES.Issued;
                  return (
                    <tr key={c.id}>
                      <td style={{fontFamily:'monospace',fontWeight:700,color:'#0b1220'}}>{c.checkNumber||'—'}</td>
                      <td>{c.issueDate||'—'}</td>
                      <td style={{fontSize:11,color:'#64748b'}}>{bankName(c.bankCode)}</td>
                      <td style={{fontWeight:600}}>{c.payeeName||'—'}</td>
                      <td style={{textAlign:'right',fontWeight:700}}>{fmtCur(c.amount)}</td>
                      <td style={{fontFamily:'monospace',fontSize:11,color:'#64748b'}}>{c.referenceId||'—'}</td>
                      <td><span className="pill" style={{background:ss.bg,borderColor:ss.border,color:ss.color}}>{c.status||'Issued'}</span></td>
                      <td>
                        <div style={{display:'flex',gap:4}}>
                          <button className="btn btn-ghost btn-sm" onClick={()=>setModal({...c})}>Edit</button>
                          {(c.status==='Issued'||c.status==='Stopped')&&(
                            <button className="btn btn-ghost btn-sm" onClick={()=>setStatusModal({...c})} style={{borderColor:'#bfdbfe',color:'#1d4ed8'}}>Update Status</button>
                          )}
                          <button onClick={()=>deleteCheck(c.id)} style={{background:'none',border:'none',color:'#dc2626',cursor:'pointer',fontWeight:900,fontSize:13,padding:'3px 5px'}} title="Delete">✕</button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot><tr>
                <td colSpan={4} style={{fontWeight:900}}>TOTAL (filtered)</td>
                <td style={{textAlign:'right'}}>{fmtCur(filtered.reduce((s,c)=>s+(parseFloat(c.amount)||0),0))}</td>
                <td colSpan={3}></td>
              </tr></tfoot>
            </table>
          </div>
        )}
      </div>
    );
  }

  /* ══ Tab: Checkbooks ══════════════════════════════════════════ */
  function CheckbooksTab() {
    return (
      <div>
        <div style={{display:'flex',gap:8,marginBottom:12,alignItems:'center'}}>
          <button className="btn btn-primary btn-sm" onClick={()=>setCbModal({isActive:true})}>+ New Checkbook</button>
          <span style={{marginLeft:'auto',fontSize:12,color:'#64748b'}}>{checkbooks.length} checkbook{checkbooks.length!==1?'s':''}</span>
        </div>
        {checkbooks.length===0?<div className="empty">No checkbooks added yet.</div>:(
          <div style={{overflowX:'auto'}}>
            <table>
              <thead><tr>
                <th>Checkbook ID</th><th>Bank</th><th>Type</th>
                <th>Starting #</th><th>Ending #</th><th>Next #</th>
                <th>Status</th><th>Notes</th><th></th>
              </tr></thead>
              <tbody>
                {checkbooks.map(cb=>{
                  const active=cb.isActive!==false;
                  const start=parseInt(cb.startingNumber)||0,end=parseInt(cb.endingNumber)||0,nxt=parseInt(cb.nextCheckNumber)||start;
                  const used=nxt-start, total=end-start+1, pct=total>0?Math.round((used/total)*100):0;
                  return (
                    <tr key={cb.id}>
                      <td style={{fontFamily:'monospace',fontWeight:700}}>{cb.id.substring(0,8)}…</td>
                      <td style={{fontWeight:600}}>{bankName(cb.bankCode)}</td>
                      <td style={{color:'#64748b'}}>{cb.checkbookType||'Regular'}</td>
                      <td style={{fontFamily:'monospace'}}>{cb.startingNumber||'—'}</td>
                      <td style={{fontFamily:'monospace'}}>{cb.endingNumber||'—'}</td>
                      <td>
                        <div style={{display:'flex',alignItems:'center',gap:6}}>
                          <span style={{fontFamily:'monospace',fontWeight:700,color:'#f97316'}}>{cb.nextCheckNumber||'—'}</span>
                          <span style={{fontSize:10,color:'#94a3b8'}}>{pct}% used</span>
                        </div>
                      </td>
                      <td><span className="pill" style={active?{background:'#f0fdf4',borderColor:'#bbf7d0',color:'#15803d'}:{background:'#f8fafc',borderColor:'#e2e8f0',color:'#94a3b8'}}>{active?'Active':'Inactive'}</span></td>
                      <td style={{color:'#64748b',maxWidth:150,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{cb.notes||'—'}</td>
                      <td>
                        <div style={{display:'flex',gap:4}}>
                          <button className="btn btn-ghost btn-sm" onClick={()=>setCbModal({...cb})}>Edit</button>
                          <button onClick={async()=>{if(!confirm('Delete checkbook?'))return;await deleteDoc(doc(db,'checkbookMaster',cb.id));}} style={{background:'none',border:'none',color:'#dc2626',cursor:'pointer',fontWeight:900,fontSize:13,padding:'3px 5px'}}>✕</button>
                        </div>
                      </td>
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

  /* ══ Check Form Modal ═════════════════════════════════════════ */
  function CheckModal() {
    const isEdit=!!(modal&&modal.id);
    const [form,setForm]=useState({checkNumber:'',issueDate:'',bankCode:'UBPBPHM',payeeName:'',amount:'',status:'Issued',referenceId:'',notes:'',clearedDate:'',voidedDate:'',voidReason:'',stoppedDate:'',staleDate:'',...modal});
    const upd=(k,v)=>setForm(f=>({...f,[k]:v}));
    const cb = activeCheckbook(form.bankCode);
    return (
      <div className="backdrop" onClick={e=>e.target===e.currentTarget&&setModal(null)}>
        <div className="modal">
          <div className="modal-h"><strong>{isEdit?'Edit Check':'New Check Entry'}</strong><button className="btn btn-ghost btn-sm" onClick={()=>setModal(null)}>✕</button></div>
          <div className="modal-b">
            {cb&&!isEdit&&(
              <div className="cb-banner">
                <strong>Active Checkbook</strong> — {bankName(cb.bankCode)} · Range: {cb.startingNumber}–{cb.endingNumber} · Next: <strong>{cb.nextCheckNumber}</strong>
                <button className="btn btn-ghost btn-sm" style={{marginLeft:8}} onClick={()=>upd('checkNumber',cb.nextCheckNumber||'')}>Use Next #</button>
              </div>
            )}
            <div className="grid3">
              <div className="field col2"><label>Bank *</label><select value={form.bankCode} onChange={e=>upd('bankCode',e.target.value)}>{BANKS.map(b=><option key={b.code} value={b.code}>{b.name}</option>)}</select></div>
              <div className="field"><label>Check Number *</label><input value={form.checkNumber} onChange={e=>upd('checkNumber',e.target.value)} /></div>
              <div className="field col2"><label>Payee / Vendor *</label><input value={form.payeeName} onChange={e=>upd('payeeName',e.target.value)} /></div>
              <div className="field"><label>Issue Date *</label><input type="date" value={form.issueDate} onChange={e=>upd('issueDate',e.target.value)} /></div>
              <div className="field col2"><label>Amount *</label><input type="number" step="0.01" value={form.amount} onChange={e=>upd('amount',e.target.value)} /></div>
              <div className="field"><label>Status</label><select value={form.status} onChange={e=>upd('status',e.target.value)}>{CHECK_STATUSES.map(s=><option key={s}>{s}</option>)}</select></div>
              <div className="field col3"><label>Reference / Voucher ID</label><input value={form.referenceId} onChange={e=>upd('referenceId',e.target.value)} placeholder="e.g. DV-2024-001" /></div>
            </div>
            {form.status==='Cleared'&&<div className="field" style={{marginBottom:10}}><label>Cleared Date</label><input type="date" value={form.clearedDate} onChange={e=>upd('clearedDate',e.target.value)} /></div>}
            {form.status==='Voided'&&<div className="grid3"><div className="field"><label>Voided Date</label><input type="date" value={form.voidedDate} onChange={e=>upd('voidedDate',e.target.value)} /></div><div className="field col2"><label>Void Reason</label><input value={form.voidReason} onChange={e=>upd('voidReason',e.target.value)} /></div></div>}
            {form.status==='Stopped'&&<div className="field" style={{marginBottom:10}}><label>Stop Payment Date</label><input type="date" value={form.stoppedDate} onChange={e=>upd('stoppedDate',e.target.value)} /></div>}
            {form.status==='Stale'&&<div className="field" style={{marginBottom:10}}><label>Stale Date</label><input type="date" value={form.staleDate} onChange={e=>upd('staleDate',e.target.value)} /></div>}
            <div className="field"><label>Notes</label><textarea rows={2} value={form.notes} onChange={e=>upd('notes',e.target.value)} style={{resize:'vertical'}} /></div>
          </div>
          <div className="modal-f">
            <button className="btn btn-ghost" onClick={()=>setModal(null)}>Cancel</button>
            <button className="btn btn-primary" disabled={saving} onClick={()=>{
              if(!form.checkNumber.trim()) return alert('Check number required.');
              if(!form.issueDate) return alert('Issue date required.');
              if(!form.payeeName.trim()) return alert('Payee required.');
              if(!(parseFloat(form.amount)>0)) return alert('Amount must be > 0.');
              saveCheck(form);
            }}>{saving?'Saving…':isEdit?'Save Changes':'Add Check'}</button>
          </div>
        </div>
      </div>
    );
  }

  /* ══ Status Update Modal ══════════════════════════════════════ */
  function StatusUpdateModal() {
    if (!statusModal) return null;
    const [form,setForm]=useState({...statusModal});
    const upd=(k,v)=>setForm(f=>({...f,[k]:v}));
    const today=new Date().toISOString().substring(0,10);
    const nextStatuses = statusModal.status==='Issued' ? ['Cleared','Voided','Stopped','Stale'] : statusModal.status==='Stopped' ? ['Cleared','Voided','Stale'] : [];
    return (
      <div className="backdrop" onClick={e=>e.target===e.currentTarget&&setStatusModal(null)}>
        <div className="modal" style={{width:'min(440px,98vw)'}}>
          <div className="modal-h"><strong>Update Check Status</strong><button className="btn btn-ghost btn-sm" onClick={()=>setStatusModal(null)}>✕</button></div>
          <div className="modal-b">
            <div style={{marginBottom:12,padding:'10px 12px',background:'#f8fafc',borderRadius:10,fontSize:12}}>
              <div style={{fontWeight:700}}>Check #{statusModal.checkNumber} — {statusModal.payeeName}</div>
              <div style={{color:'#64748b'}}>Amount: {fmtCur(statusModal.amount)} · Current: <span style={{fontWeight:700}}>{statusModal.status}</span></div>
            </div>
            <div className="field" style={{marginBottom:12}}>
              <label>New Status *</label>
              <div style={{display:'flex',gap:8,flexWrap:'wrap'}}>
                {nextStatuses.map(s=>{
                  const ss=STATUS_STYLES[s];
                  return <button key={s} className="btn btn-sm" style={{background:form.status===s?ss.bg:'#f8fafc',borderColor:form.status===s?ss.border:'#e2e8f0',color:form.status===s?ss.color:'#64748b',border:'1px solid'}} onClick={()=>upd('status',s)}>{s}</button>;
                })}
              </div>
            </div>
            {form.status==='Cleared'&&<div className="field" style={{marginBottom:10}}><label>Cleared Date *</label><input type="date" value={form.clearedDate||today} onChange={e=>upd('clearedDate',e.target.value)} /></div>}
            {form.status==='Voided'&&<div className="grid3"><div className="field"><label>Voided Date</label><input type="date" value={form.voidedDate||today} onChange={e=>upd('voidedDate',e.target.value)} /></div><div className="field col2"><label>Void Reason</label><input value={form.voidReason||''} onChange={e=>upd('voidReason',e.target.value)} /></div></div>}
            {form.status==='Stopped'&&<div className="field" style={{marginBottom:10}}><label>Stop Payment Date</label><input type="date" value={form.stoppedDate||today} onChange={e=>upd('stoppedDate',e.target.value)} /></div>}
            {form.status==='Stale'&&<div className="field" style={{marginBottom:10}}><label>Stale Date</label><input type="date" value={form.staleDate||today} onChange={e=>upd('staleDate',e.target.value)} /></div>}
          </div>
          <div className="modal-f">
            <button className="btn btn-ghost" onClick={()=>setStatusModal(null)}>Cancel</button>
            <button className="btn btn-primary" disabled={saving} onClick={()=>{if(!form.status||form.status===statusModal.status) return alert('Select a new status.');updateStatus(form);}}>{saving?'Saving…':'Update Status'}</button>
          </div>
        </div>
      </div>
    );
  }

  /* ══ Checkbook Modal ══════════════════════════════════════════ */
  function CheckbookModal() {
    const isEdit=!!(cbModal&&cbModal.id);
    const [form,setForm]=useState({bankCode:'UBPBPHM',checkbookType:'Regular',startingNumber:'',endingNumber:'',nextCheckNumber:'',isActive:true,notes:'',...cbModal});
    const upd=(k,v)=>setForm(f=>({...f,[k]:v}));
    return (
      <div className="backdrop" onClick={e=>e.target===e.currentTarget&&setCbModal(null)}>
        <div className="modal">
          <div className="modal-h"><strong>{isEdit?'Edit Checkbook':'New Checkbook'}</strong><button className="btn btn-ghost btn-sm" onClick={()=>setCbModal(null)}>✕</button></div>
          <div className="modal-b">
            <div className="grid3">
              <div className="field col2"><label>Bank *</label><select value={form.bankCode} onChange={e=>upd('bankCode',e.target.value)}>{BANKS.map(b=><option key={b.code} value={b.code}>{b.name}</option>)}</select></div>
              <div className="field"><label>Checkbook Type</label><select value={form.checkbookType} onChange={e=>upd('checkbookType',e.target.value)}>{CHECKBOOK_TYPES.map(t=><option key={t}>{t}</option>)}</select></div>
              <div className="field"><label>Starting Number *</label><input value={form.startingNumber} onChange={e=>upd('startingNumber',e.target.value)} /></div>
              <div className="field"><label>Ending Number *</label><input value={form.endingNumber} onChange={e=>upd('endingNumber',e.target.value)} /></div>
              <div className="field"><label>Next Check #</label><input value={form.nextCheckNumber||form.startingNumber} onChange={e=>upd('nextCheckNumber',e.target.value)} /></div>
              <div className="field"><label>Active</label><select value={form.isActive?'yes':'no'} onChange={e=>upd('isActive',e.target.value==='yes')}><option value="yes">Active</option><option value="no">Inactive</option></select></div>
              <div className="field col2"><label>Notes</label><input value={form.notes} onChange={e=>upd('notes',e.target.value)} /></div>
            </div>
          </div>
          <div className="modal-f">
            <button className="btn btn-ghost" onClick={()=>setCbModal(null)}>Cancel</button>
            <button className="btn btn-primary" disabled={saving} onClick={()=>{
              if(!form.startingNumber.trim()||!form.endingNumber.trim()) return alert('Starting and ending numbers required.');
              saveCheckbook(form);
            }}>{saving?'Saving…':isEdit?'Save':'Create Checkbook'}</button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="cr-wrap">
      <style>{CSS}</style>
      <div className="cr-topbar">
        <div>
          <h1 style={{margin:0,fontSize:18,fontWeight:900}}>Check Registry</h1>
          <p style={{margin:0,fontSize:12,color:'#64748b'}}>{checks.length} check{checks.length!==1?'s':''} · {checkbooks.length} checkbook{checkbooks.length!==1?'s':''}</p>
        </div>
      </div>
      <div className="cr-tabs">
        {TABS.map(t=><button key={t.key} className={`cr-tab${activeTab===t.key?' cr-tab-active':''}`} onClick={()=>setActiveTab(t.key)}>{t.label}</button>)}
      </div>
      <div className="cr-body">
        {activeTab==='register'&&<RegisterTab />}
        {activeTab==='checkbooks'&&<CheckbooksTab />}
      </div>
      {modal!==null&&<CheckModal />}
      {cbModal!==null&&<CheckbookModal />}
      {statusModal!==null&&<StatusUpdateModal />}
      {toast&&<div className="toast">{toast}</div>}
    </div>
  );
}

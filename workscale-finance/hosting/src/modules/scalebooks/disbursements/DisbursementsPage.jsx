import { useState, useEffect, useMemo } from 'react';
import {
  collection, query, orderBy, onSnapshot, addDoc, updateDoc, deleteDoc, doc,
  serverTimestamp, getDocs, where
} from 'firebase/firestore';
import { db, auth } from '../../../firebase.js';

const fmt = (n) => new Intl.NumberFormat('en-PH', { style:'currency', currency:'PHP' }).format(n || 0);
const uid = () => Math.random().toString(36).slice(2, 10).toUpperCase();
const today = () => new Date().toISOString().slice(0, 10);

const BANKS = ['UBPBPHM','BPI','BDO','RCBC','MBTC','CASH'];

const DR_STATUSES = ['Draft','Pending Review','Pending Approval','Approved','Rejected','Voided'];

const STATUS_STYLES = {
  'Draft':            { background:'#f8fafc', borderColor:'#e2e8f0', color:'#64748b' },
  'Pending Review':   { background:'#fffbeb', borderColor:'#fde68a', color:'#92400e' },
  'Pending Approval': { background:'#eff6ff', borderColor:'#bfdbfe', color:'#1d4ed8' },
  'Approved':         { background:'#ecfdf5', borderColor:'#6ee7b7', color:'#065f46' },
  'Rejected':         { background:'#fef2f2', borderColor:'#fecaca', color:'#dc2626' },
  'Voided':           { background:'#f8fafc', borderColor:'#e2e8f0', color:'#94a3b8' },
};

const CSS = `
  .dp-wrap   { display:flex; flex-direction:column; height:100%; overflow:hidden; font-family:Inter,system-ui,sans-serif; background:#f8fafc; }
  .dp-topbar { display:flex; align-items:center; justify-content:space-between; padding:16px 22px 12px; flex-shrink:0; border-bottom:1px solid #e5e7eb; background:#fff; }
  .dp-body   { flex:1; overflow-y:auto; padding:16px 22px; }
  .toolbar   { display:flex; gap:10px; align-items:center; flex-wrap:wrap; margin-bottom:14px; }
  .input     { border:1px solid #e5e7eb; border-radius:10px; padding:9px 12px; font-size:13px; background:#fff; font-family:inherit; }
  .btn       { border:0; border-radius:10px; padding:9px 16px; font-weight:700; cursor:pointer; font-size:13px; font-family:inherit; transition:opacity .15s; }
  .btn:disabled { opacity:.5; cursor:not-allowed; }
  .btn-primary { background:#f97316; color:#fff; }
  .btn-ghost   { background:#f1f5f9; color:#0b1220; }
  .btn-ghost:hover { background:#e2e8f0; }
  .btn-danger  { background:#ef4444; color:#fff; }
  .btn-sm      { padding:6px 12px; font-size:12px; }
  .btn-xs      { padding:4px 8px; font-size:11px; border-radius:8px; }
  .card { background:#fff; border:1px solid #e5e7eb; border-radius:14px; overflow:hidden; }
  table { width:100%; border-collapse:collapse; }
  th,td { padding:11px 12px; border-bottom:1px solid #f1f5f9; font-size:13px; text-align:left; }
  th { color:#64748b; font-weight:800; font-size:11px; letter-spacing:.05em; text-transform:uppercase; background:#f8fafc; }
  tr:hover td { background:#fafafa; }
  tr:last-child td { border-bottom:none; }
  .pill { display:inline-block; padding:3px 9px; border-radius:999px; font-size:11px; font-weight:700; border:1px solid; white-space:nowrap; }
  .backdrop { position:fixed; inset:0; background:rgba(15,23,42,.45); display:flex; align-items:center; justify-content:center; padding:16px; z-index:100; }
  .modal    { width:min(1000px,98vw); max-height:92vh; background:#fff; border-radius:16px; display:flex; flex-direction:column; overflow:hidden; box-shadow:0 24px 64px rgba(0,0,0,.25); }
  .modal-sm { width:min(480px,98vw); }
  .modal-h  { display:flex; align-items:center; justify-content:space-between; padding:16px 20px; border-bottom:1px solid #e5e7eb; background:#f8fafc; flex-shrink:0; }
  .modal-h strong { font-size:15px; font-weight:900; }
  .modal-b  { padding:20px; overflow-y:auto; flex:1; }
  .modal-f  { display:flex; justify-content:flex-end; gap:10px; padding:14px 20px; border-top:1px solid #e5e7eb; background:#fff; flex-shrink:0; }
  .grid4    { display:grid; grid-template-columns:repeat(4,1fr); gap:12px; margin-bottom:14px; }
  .col2     { grid-column:span 2; }
  .col4     { grid-column:span 4; }
  .field    { display:flex; flex-direction:column; gap:5px; }
  .field label { font-size:10px; font-weight:800; color:#64748b; letter-spacing:.06em; text-transform:uppercase; }
  .field input,.field select,.field textarea { width:100%; border:1px solid #e5e7eb; border-radius:10px; padding:9px 10px; font-size:13px; background:#fff; font-family:inherit; box-sizing:border-box; }
  .section-title { font-size:11px; font-weight:800; color:#94a3b8; letter-spacing:.07em; text-transform:uppercase; margin:16px 0 8px; border-bottom:1px solid #f1f5f9; padding-bottom:6px; }
  .lines-tbl th,.lines-tbl td { border-bottom:1px solid #f1f5f9; padding:8px 10px; }
  .lines-tbl td input,.lines-tbl td select { width:100%; border:1px solid #e5e7eb; border-radius:8px; padding:7px 8px; font-size:12px; font-family:inherit; }
  .tfoot-row { display:flex; justify-content:flex-end; gap:20px; padding:10px 16px; background:#f8fafc; border-top:2px solid #e5e7eb; font-size:13px; font-weight:700; }
  .kpi-row  { display:grid; grid-template-columns:repeat(auto-fit,minmax(140px,1fr)); gap:10px; margin-bottom:16px; }
  .kpi-card { background:#fff; border:1px solid #e5e7eb; border-radius:12px; padding:14px 16px; }
  .kpi-label { font-size:10px; font-weight:800; color:#94a3b8; letter-spacing:.07em; text-transform:uppercase; margin-bottom:4px; }
  .kpi-value { font-size:18px; font-weight:900; color:#0b1220; }
  .bulk-bar  { display:flex; align-items:center; gap:10px; padding:8px 14px; background:#fff7ed; border:1px solid #fed7aa; border-radius:10px; margin-bottom:10px; flex-wrap:wrap; }
  .empty { padding:48px; text-align:center; color:#94a3b8; font-size:13px; }
  .toast { position:fixed; right:16px; bottom:16px; background:#0b1220; color:#fff; padding:12px 18px; border-radius:12px; font-size:13px; font-weight:600; z-index:999; animation:fadeIn .2s; }
  .backdrop { position:fixed; inset:0; background:rgba(15,23,42,.45); display:flex; align-items:center; justify-content:center; padding:16px; z-index:100; }
  @keyframes fadeIn { from{opacity:0;transform:translateY(8px)} to{opacity:1;transform:none} }
  .expand-row td { background:#f8fafc; padding:16px 20px; }
  .elig-check { display:flex; align-items:center; gap:10px; padding:10px 14px; border-bottom:1px solid #f1f5f9; }
  .elig-check:last-child { border-bottom:none; }
`;

function StatusPill({ status }) {
  const s = STATUS_STYLES[status] || STATUS_STYLES['Draft'];
  return <span className="pill" style={s}>{status || 'Draft'}</span>;
}

function genReportId() {
  const d = new Date(); const y = d.getFullYear(); const m = String(d.getMonth()+1).padStart(2,'0');
  return `DR${y}${m}${String(Math.floor(Math.random()*9000)+1000)}`;
}

export default function DisbursementsPage() {
  const [reports,   setReports]   = useState([]);
  const [vouchers,  setVouchers]  = useState([]);

  // Filters
  const [search,       setSearch]      = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [dateFrom,     setDateFrom]    = useState('');
  const [dateTo,       setDateTo]      = useState('');

  // Bulk
  const [selected, setSelected] = useState(new Set());

  // Expand
  const [expandId, setExpandId] = useState(null);

  // Modals
  const [showModal,   setShowModal]   = useState(false);
  const [editing,     setEditing]     = useState(null);
  const [statusModal, setStatusModal] = useState(null);
  const [viewModal,   setViewModal]   = useState(null);

  // Form
  const [form,   setForm]   = useState({ date:today(), expectedCollection:0, notes:'' });
  const [drLines, setDrLines] = useState([]); // lines picked from eligible vouchers
  const [saving, setSaving]  = useState(false);
  const [toast,  setToast]   = useState('');

  const showToast = (msg) => { setToast(msg); setTimeout(() => setToast(''), 3000); };
  const [confirmModal, setConfirmModal] = useState(null);
  const askConfirm = (message, onConfirm) => setConfirmModal({ message, onConfirm });
  const user = auth.currentUser?.email || '';

  // Live data
  useEffect(() => {
    const unsub = onSnapshot(
      query(collection(db,'disbursementReports'), orderBy('createdAt','desc')),
      snap => setReports(snap.docs.map(d => ({ id:d.id, ...d.data() })))
    );
    // Load eligible vouchers (Approved status)
    getDocs(query(collection(db,'vouchers'), where('status','==','Approved')))
      .then(s => setVouchers(s.docs.map(d => ({ id:d.id, ...d.data() }))));
    return unsub;
  }, []);

  // Also reload eligible vouchers when modal opens
  const refreshVouchers = () => {
    getDocs(query(collection(db,'vouchers'), where('status','in',['Approved','For Disbursement'])))
      .then(s => setVouchers(s.docs.map(d => ({ id:d.id, ...d.data() }))));
  };

  // Filtered reports
  const filtered = useMemo(() => {
    let r = [...reports];
    const q = search.toLowerCase();
    if (q) r = r.filter(x => (x.reportId||x.id||'').toLowerCase().includes(q) || (x.bankCode||'').toLowerCase().includes(q));
    if (filterStatus) r = r.filter(x => (x.status||'Draft') === filterStatus);
    if (dateFrom) r = r.filter(x => (x.date||'') >= dateFrom);
    if (dateTo)   r = r.filter(x => (x.date||'') <= dateTo);
    return r;
  }, [reports, search, filterStatus, dateFrom, dateTo]);

  // KPIs
  const kpis = useMemo(() => ({
    total:   reports.length,
    draft:   reports.filter(r => r.status === 'Draft').length,
    pending: reports.filter(r => ['Pending Review','Pending Approval'].includes(r.status)).length,
    approved:reports.filter(r => r.status === 'Approved').length,
    totalAmt:reports.filter(r => !['Voided','Rejected'].includes(r.status)).reduce((s,r) => s+(Number(r.totalAmount)||0), 0),
  }), [reports]);

  // Bulk
  const toggleSel = (id) => setSelected(prev => { const n=new Set(prev); n.has(id)?n.delete(id):n.add(id); return n; });
  const toggleAll = () => {
    if (selected.size === filtered.length) setSelected(new Set());
    else setSelected(new Set(filtered.map(r=>r.id)));
  };
  const bulkSubmit = () => {
    if (!selected.size) return;
    const count = selected.size;
    askConfirm(`Submit ${count} report(s) for approval?`, async () => {
      await Promise.all([...selected].map(id => updateDoc(doc(db,'disbursementReports',id), { status:'Pending Review', updatedAt:serverTimestamp(), updatedBy:user })));
      setSelected(new Set()); showToast('Submitted for review.');
    });
  };
  const bulkDelete = () => {
    if (!selected.size) return;
    const count = selected.size;
    askConfirm(`Delete ${count} report(s)?`, async () => {
      await Promise.all([...selected].map(id => deleteDoc(doc(db,'disbursementReports',id))));
      setSelected(new Set()); showToast('Deleted.');
    });
  };

  // Open create modal
  const openNew = () => {
    refreshVouchers();
    setEditing(null);
    setForm({ date:today(), expectedCollection:0, notes:'' });
    setDrLines([]);
    setShowModal(true);
  };

  const openEdit = (r) => {
    refreshVouchers();
    setEditing(r);
    setForm({ date:r.date||today(), expectedCollection:r.expectedCollection||0, notes:r.notes||'' });
    setDrLines((r.lines||[]).map(l => ({ ...l, _key: uid() })));
    setShowModal(true);
  };

  // Toggle voucher in lines
  const toggleVoucher = (v) => {
    setDrLines(prev => {
      const exists = prev.find(l => l.voucherId === (v.voucherId||v.id));
      if (exists) return prev.filter(l => l.voucherId !== (v.voucherId||v.id));
      return [...prev, {
        _key: uid(),
        voucherId:   v.voucherId || v.id,
        voucherType: v.voucherType||'',
        contact:     v.contactSummary||'',
        amount:      Number(v.totalAmount)||0,
        bankCode:    v.paymentFromAccountCode||'',
        checkNo:     v.checkNumber||'',
        refNo:       '',
        status:      'In Disbursement',
      }];
    });
  };

  const setLineField = (key, field, val) => {
    setDrLines(prev => prev.map(l => l._key === key ? { ...l, [field]: val } : l));
  };

  const lineTotal = drLines.reduce((s,l) => s+(Number(l.amount)||0), 0);

  // Save report
  const saveReport = async (status) => {
    if (drLines.length === 0) { showToast('Add at least one voucher line.'); return; }
    setSaving(true);
    try {
      const payload = {
        date:               form.date,
        bankCode:           'MULTIPLE',
        totalAmount:        lineTotal,
        expectedCollection: Number(form.expectedCollection)||0,
        notes:              form.notes||'',
        status:             status || 'Draft',
        lines:              drLines.map((l,i) => ({ lineNo:i+1, voucherId:l.voucherId, voucherType:l.voucherType, contact:l.contact, amount:Number(l.amount)||0, bankCode:l.bankCode||'', checkNo:l.checkNo||'', refNo:l.refNo||'', status:'In Disbursement' })),
        updatedAt:          serverTimestamp(), updatedBy: user
      };
      if (editing) {
        await updateDoc(doc(db,'disbursementReports',editing.id), payload);
        showToast('Report updated.');
      } else {
        const reportId = genReportId();
        await addDoc(collection(db,'disbursementReports'), { ...payload, reportId, createdAt:serverTimestamp(), createdBy:user });
        // Mark vouchers as For Disbursement
        await Promise.all(drLines.map(l => {
          const v = vouchers.find(v2 => (v2.voucherId||v2.id) === l.voucherId);
          if (v) return updateDoc(doc(db,'vouchers',v.id), { status:'For Disbursement', disbursementRef:reportId, updatedAt:serverTimestamp(), updatedBy:user });
        }).filter(Boolean));
        showToast('Report created.');
      }
      setShowModal(false);
    } catch(e) { showToast('Error: ' + e.message); }
    setSaving(false);
  };

  const doStatusUpdate = async () => {
    if (!statusModal) return;
    const { report, newStatus, reason } = statusModal;
    setSaving(true);
    try {
      await updateDoc(doc(db,'disbursementReports',report.id), {
        status:newStatus, ...(reason?{rejectReason:reason}:{}),
        updatedAt:serverTimestamp(), updatedBy:user
      });
      // If Approved → mark all vouchers as Paid
      if (newStatus === 'Approved') {
        const lines = report.lines || [];
        await Promise.all(lines.map(l => {
          const v = vouchers.find(v2 => (v2.voucherId||v2.id) === l.voucherId);
          if (v) return updateDoc(doc(db,'vouchers',v.id), { status:'Paid', updatedAt:serverTimestamp(), updatedBy:user });
        }).filter(Boolean));
      }
      showToast(`Status updated to ${newStatus}.`);
      setStatusModal(null);
    } catch(e) { showToast('Error: ' + e.message); }
    setSaving(false);
  };

  const deleteReport = (r) => {
    askConfirm(`Delete report ${r.reportId||r.id}?`, async () => {
      await deleteDoc(doc(db,'disbursementReports',r.id));
      showToast('Report deleted.');
    });
  };

  const nextStatuses = (status) => {
    if (status === 'Draft')            return ['Pending Review','Voided'];
    if (status === 'Pending Review')   return ['Pending Approval','Rejected','Voided'];
    if (status === 'Pending Approval') return ['Approved','Rejected','Voided'];
    return [];
  };

  const canEdit = (r) => ['Draft','Pending Review'].includes(r.status||'Draft');

  return (
    <div className="dp-wrap">
      <style>{CSS}</style>

      {/* Topbar */}
      <div className="dp-topbar">
        <div style={{display:'flex',alignItems:'center',gap:12}}>
          <strong style={{fontSize:18,fontWeight:900,color:'#0b1220'}}>MASTER DISBURSEMENT REPORTS</strong>
          {selected.size > 0 && (
            <div className="bulk-bar" style={{margin:0}}>
              <span style={{fontSize:12,fontWeight:800,color:'#c2410c'}}>{selected.size} Selected</span>
              <button className="btn btn-ghost btn-sm" onClick={bulkSubmit}>Submit for Approval</button>
              <button className="btn btn-ghost btn-sm" style={{color:'#dc2626'}} onClick={bulkDelete}>Delete</button>
              <button className="btn btn-ghost btn-sm" onClick={()=>setSelected(new Set())}>Clear</button>
            </div>
          )}
        </div>
        <button className="btn btn-primary" onClick={openNew}>＋ NEW REPORT</button>
      </div>

      <div className="dp-body">
        {/* KPIs */}
        <div className="kpi-row">
          {[
            { label:'Total Reports',    value: kpis.total },
            { label:'Draft',            value: kpis.draft },
            { label:'Pending',          value: kpis.pending },
            { label:'Approved',         value: kpis.approved },
            { label:'Total Amount',     value: fmt(kpis.totalAmt) },
          ].map(k => (
            <div className="kpi-card" key={k.label}>
              <div className="kpi-label">{k.label}</div>
              <div className="kpi-value">{k.value}</div>
            </div>
          ))}
        </div>

        {/* Toolbar */}
        <div className="toolbar">
          <input className="input" placeholder="🔍 Search report ID, bank…" value={search} onChange={e=>setSearch(e.target.value)} style={{flex:'1 1 200px',minWidth:160}} />
          <select className="input" value={filterStatus} onChange={e=>setFilterStatus(e.target.value)}>
            <option value="">All Statuses</option>
            {DR_STATUSES.map(s=><option key={s}>{s}</option>)}
          </select>
          <input type="date" className="input" value={dateFrom} onChange={e=>setDateFrom(e.target.value)} />
          <span style={{fontSize:12,color:'#94a3b8',fontWeight:700}}>TO</span>
          <input type="date" className="input" value={dateTo} onChange={e=>setDateTo(e.target.value)} />
          <button className="btn btn-ghost btn-sm" onClick={()=>{setSearch('');setFilterStatus('');setDateFrom('');setDateTo('');}}>✕ Clear</button>
          <span style={{fontSize:12,color:'#94a3b8',fontWeight:600}}>{filtered.length} result{filtered.length!==1?'s':''}</span>
        </div>

        {/* Table */}
        <div className="card">
          <table>
            <thead>
              <tr>
                <th style={{width:40,textAlign:'center'}}><input type="checkbox" checked={selected.size===filtered.length&&filtered.length>0} onChange={toggleAll} /></th>
                <th>REPORT ID</th>
                <th>DATE</th>
                <th>BANKS</th>
                <th style={{textAlign:'right'}}>TOTAL AMOUNT</th>
                <th style={{textAlign:'right'}}>EXPECTED COLLECTION</th>
                <th>STATUS</th>
                <th style={{textAlign:'center'}}>ACTIONS</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 && <tr><td colSpan={8} className="empty">No disbursement reports found.</td></tr>}
              {filtered.map(r => {
                const isExpanded = expandId === r.id;
                return [
                  <tr key={r.id}>
                    <td style={{textAlign:'center'}} onClick={e=>e.stopPropagation()}>
                      <input type="checkbox" checked={selected.has(r.id)} onChange={()=>toggleSel(r.id)} />
                    </td>
                    <td>
                      <a style={{fontWeight:900,color:'#f97316',textDecoration:'underline',cursor:'pointer'}} onClick={()=>setExpandId(isExpanded?null:r.id)}>
                        {r.reportId||r.id}
                      </a>
                    </td>
                    <td>{r.date||'—'}</td>
                    <td>{r.bankCode||'MULTIPLE'}</td>
                    <td style={{textAlign:'right',fontWeight:700}}>{fmt(r.totalAmount)}</td>
                    <td style={{textAlign:'right'}}>{fmt(r.expectedCollection)}</td>
                    <td><StatusPill status={r.status||'Draft'} /></td>
                    <td style={{textAlign:'center'}}>
                      <div style={{display:'flex',gap:4,justifyContent:'center'}}>
                        <button className="btn btn-ghost btn-xs" onClick={()=>setViewModal(r)}>View</button>
                        {canEdit(r) && <button className="btn btn-ghost btn-xs" onClick={()=>openEdit(r)}>Edit</button>}
                        {nextStatuses(r.status||'Draft').length > 0 && (
                          <select className="input" style={{padding:'3px 6px',fontSize:11,borderRadius:8,cursor:'pointer'}}
                            defaultValue=""
                            onChange={e=>{ if(e.target.value){ const ns=e.target.value; e.target.value=''; if(ns==='Rejected') setStatusModal({report:r,newStatus:ns,reason:''}); else setStatusModal({report:r,newStatus:ns,reason:null}); } }}>
                            <option value="" disabled>Update…</option>
                            {nextStatuses(r.status||'Draft').map(s=><option key={s} value={s}>{s}</option>)}
                          </select>
                        )}
                        {(r.status||'Draft')==='Draft' && <button className="btn btn-ghost btn-xs" style={{color:'#dc2626'}} onClick={()=>deleteReport(r)}>🗑</button>}
                      </div>
                    </td>
                  </tr>,
                  isExpanded && (
                    <tr key={r.id+'-exp'} className="expand-row">
                      <td colSpan={8}>
                        <div style={{marginBottom:8,fontSize:12,color:'#64748b'}}>
                          <strong>Created by:</strong> {r.createdBy||'—'} &nbsp;|&nbsp; <strong>Reviewed by:</strong> {r.reviewedBy||'—'} &nbsp;|&nbsp; <strong>Approved by:</strong> {r.approvedBy||'—'}
                          {r.rejectReason && <> &nbsp;|&nbsp; <span style={{color:'#dc2626'}}><strong>Reject Reason:</strong> {r.rejectReason}</span></>}
                        </div>
                        {(r.lines||[]).length > 0 ? (
                          <table className="lines-tbl" style={{fontSize:12}}>
                            <thead>
                              <tr><th>#</th><th>Voucher ID</th><th>Type</th><th>Contact</th><th>Bank</th><th>Check No.</th><th>Ref No.</th><th style={{textAlign:'right'}}>Amount</th><th>Status</th></tr>
                            </thead>
                            <tbody>
                              {(r.lines||[]).map((l,i) => (
                                <tr key={i}>
                                  <td>{l.lineNo||i+1}</td>
                                  <td style={{fontWeight:700,color:'#f97316'}}>{l.voucherId||'—'}</td>
                                  <td>{l.voucherType||'—'}</td>
                                  <td>{l.contact||'—'}</td>
                                  <td>{l.bankCode||'—'}</td>
                                  <td>{l.checkNo||'—'}</td>
                                  <td>{l.refNo||'—'}</td>
                                  <td style={{textAlign:'right',fontWeight:700}}>{fmt(l.amount)}</td>
                                  <td>{l.status||'—'}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        ) : <div style={{fontSize:13,color:'#94a3b8'}}>No lines.</div>}
                      </td>
                    </tr>
                  )
                ];
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Create / Edit Modal */}
      {showModal && (
        <div className="backdrop" onClick={()=>setShowModal(false)}>
          <div className="modal" onClick={e=>e.stopPropagation()}>
            <div className="modal-h">
              <strong>{editing ? `Edit Report — ${editing.reportId||editing.id}` : 'New Disbursement Report'}</strong>
              <button className="btn btn-ghost btn-sm" onClick={()=>setShowModal(false)}>✕</button>
            </div>
            <div className="modal-b">
              <div className="grid4">
                <div className="field">
                  <label>Date</label>
                  <input type="date" value={form.date||''} onChange={e=>setForm(f=>({...f,date:e.target.value}))} />
                </div>
                <div className="field">
                  <label>Expected Collection</label>
                  <input type="number" value={form.expectedCollection||0} onChange={e=>setForm(f=>({...f,expectedCollection:e.target.value}))} />
                </div>
                <div className="field col2">
                  <label>Notes</label>
                  <input value={form.notes||''} onChange={e=>setForm(f=>({...f,notes:e.target.value}))} placeholder="Optional notes…" />
                </div>
              </div>

              {/* Eligible Vouchers */}
              <div className="section-title">Eligible Vouchers (Approved)</div>
              {vouchers.filter(v=>v.status==='Approved').length === 0
                ? <div style={{padding:'12px 0',fontSize:13,color:'#94a3b8'}}>No approved vouchers available.</div>
                : (
                  <div style={{border:'1px solid #e5e7eb',borderRadius:12,overflow:'hidden',marginBottom:16}}>
                    {vouchers.filter(v=>v.status==='Approved').map(v => {
                      const vid = v.voucherId||v.id;
                      const checked = drLines.some(l=>l.voucherId===vid);
                      return (
                        <div key={v.id} className="elig-check" style={{background:checked?'#fff7ed':'#fff'}}>
                          <input type="checkbox" checked={checked} onChange={()=>toggleVoucher(v)} style={{width:16,height:16,accentColor:'#f97316'}} />
                          <div style={{flex:1,fontSize:13}}>
                            <strong style={{color:'#f97316'}}>{vid}</strong>
                            <span style={{marginLeft:8,color:'#64748b'}}>{v.voucherType}</span>
                            <span style={{marginLeft:8,color:'#64748b'}}>{v.contactSummary||''}</span>
                          </div>
                          <span style={{fontWeight:700,minWidth:100,textAlign:'right'}}>{fmt(v.totalAmount)}</span>
                          <span style={{marginLeft:8,fontSize:11,color:'#64748b'}}>{v.paymentFromAccountCode||''}</span>
                        </div>
                      );
                    })}
                  </div>
                )
              }

              {/* Selected Lines Table */}
              {drLines.length > 0 && (
                <>
                  <div className="section-title">Disbursement Lines ({drLines.length})</div>
                  <table className="lines-tbl" style={{fontSize:12,marginBottom:8}}>
                    <thead>
                      <tr><th>#</th><th>Voucher ID</th><th>Type</th><th>Contact</th><th>Bank</th><th>Check No.</th><th>Ref No.</th><th style={{textAlign:'right'}}>Amount</th><th></th></tr>
                    </thead>
                    <tbody>
                      {drLines.map((l,i) => (
                        <tr key={l._key}>
                          <td style={{color:'#94a3b8',fontWeight:700,width:32,textAlign:'center'}}>{i+1}</td>
                          <td style={{fontWeight:700,color:'#f97316'}}>{l.voucherId}</td>
                          <td>{l.voucherType}</td>
                          <td>{l.contact||'—'}</td>
                          <td>
                            <select value={l.bankCode||''} onChange={e=>setLineField(l._key,'bankCode',e.target.value)}>
                              <option value="">—</option>
                              {BANKS.map(b=><option key={b}>{b}</option>)}
                            </select>
                          </td>
                          <td><input value={l.checkNo||''} onChange={e=>setLineField(l._key,'checkNo',e.target.value)} placeholder="Check #" /></td>
                          <td><input value={l.refNo||''} onChange={e=>setLineField(l._key,'refNo',e.target.value)} placeholder="Ref #" /></td>
                          <td><input type="number" style={{textAlign:'right'}} value={l.amount||0} onChange={e=>setLineField(l._key,'amount',e.target.value)} /></td>
                          <td><button className="btn btn-ghost btn-xs" style={{color:'#dc2626'}} onClick={()=>setDrLines(prev=>prev.filter(x=>x._key!==l._key))}>✕</button></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <div className="tfoot-row">
                    <span style={{color:'#94a3b8'}}>Total Amount:</span>
                    <span style={{color:'#0b1220'}}>{fmt(lineTotal)}</span>
                  </div>
                </>
              )}
            </div>
            <div className="modal-f">
              <button className="btn btn-ghost" onClick={()=>setShowModal(false)}>Cancel</button>
              <button className="btn btn-ghost" onClick={()=>saveReport('Draft')} disabled={saving}>Save Draft</button>
              <button className="btn btn-primary" onClick={()=>saveReport('Pending Review')} disabled={saving}>{saving?'Saving…':'Submit for Approval'}</button>
            </div>
          </div>
        </div>
      )}

      {/* View Modal */}
      {viewModal && (
        <div className="backdrop" onClick={()=>setViewModal(null)}>
          <div className="modal" onClick={e=>e.stopPropagation()}>
            <div className="modal-h">
              <strong>Disbursement Report — {viewModal.reportId||viewModal.id}</strong>
              <div style={{display:'flex',gap:8,alignItems:'center'}}>
                <StatusPill status={viewModal.status||'Draft'} />
                <button className="btn btn-ghost btn-sm" onClick={()=>setViewModal(null)}>✕</button>
              </div>
            </div>
            <div className="modal-b">
              <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(160px,1fr))',gap:12,marginBottom:20}}>
                {[['Date',viewModal.date],['Total Amount',fmt(viewModal.totalAmount)],['Expected Collection',fmt(viewModal.expectedCollection)],['Bank',viewModal.bankCode||'MULTIPLE'],['Created By',viewModal.createdBy||'—'],['Reviewed By',viewModal.reviewedBy||'—'],['Approved By',viewModal.approvedBy||'—']].map(([k,v])=>(
                  <div key={k}><div style={{fontSize:10,fontWeight:800,color:'#94a3b8',textTransform:'uppercase',letterSpacing:'.06em',marginBottom:4}}>{k}</div><div style={{fontWeight:700}}>{v||'—'}</div></div>
                ))}
              </div>
              {viewModal.rejectReason && <div style={{background:'#fef2f2',border:'1px solid #fecaca',borderRadius:10,padding:12,marginBottom:12}}><strong style={{color:'#dc2626'}}>Reject Reason: </strong>{viewModal.rejectReason}</div>}
              <div className="section-title">Lines</div>
              {(viewModal.lines||[]).length===0
                ? <div className="empty">No lines.</div>
                : <table className="lines-tbl">
                    <thead><tr><th>#</th><th>Voucher ID</th><th>Type</th><th>Contact</th><th>Bank</th><th>Check No.</th><th>Ref No.</th><th style={{textAlign:'right'}}>Amount</th></tr></thead>
                    <tbody>
                      {(viewModal.lines||[]).map((l,i)=>(
                        <tr key={i}>
                          <td>{l.lineNo||i+1}</td>
                          <td style={{fontWeight:700,color:'#f97316'}}>{l.voucherId||'—'}</td>
                          <td>{l.voucherType||'—'}</td>
                          <td>{l.contact||'—'}</td>
                          <td>{l.bankCode||'—'}</td>
                          <td>{l.checkNo||'—'}</td>
                          <td>{l.refNo||'—'}</td>
                          <td style={{textAlign:'right',fontWeight:700}}>{fmt(l.amount)}</td>
                        </tr>
                      ))}
                      <tr><td colSpan={7} style={{textAlign:'right',fontWeight:800,color:'#64748b',fontSize:12}}>TOTAL</td><td style={{textAlign:'right',fontWeight:900}}>{fmt(viewModal.totalAmount)}</td></tr>
                    </tbody>
                  </table>
              }
            </div>
            <div className="modal-f">
              {canEdit(viewModal) && <button className="btn btn-ghost" onClick={()=>{setViewModal(null);openEdit(viewModal);}}>Edit</button>}
              <button className="btn btn-ghost" onClick={()=>setViewModal(null)}>Close</button>
            </div>
          </div>
        </div>
      )}

      {/* Status Update Modal */}
      {statusModal && (
        <div className="backdrop" onClick={()=>setStatusModal(null)}>
          <div className="modal modal-sm" onClick={e=>e.stopPropagation()}>
            <div className="modal-h">
              <strong>Update Status → {statusModal.newStatus}</strong>
              <button className="btn btn-ghost btn-sm" onClick={()=>setStatusModal(null)}>✕</button>
            </div>
            <div className="modal-b">
              <p style={{fontSize:13,marginBottom:12}}>Report: <strong>{statusModal.report.reportId||statusModal.report.id}</strong></p>
              {statusModal.reason !== null && (
                <div className="field">
                  <label>Reason {statusModal.newStatus==='Rejected'?'(required)':'(optional)'}</label>
                  <textarea rows={3} value={statusModal.reason||''} onChange={e=>setStatusModal(s=>({...s,reason:e.target.value}))} placeholder={statusModal.newStatus==='Rejected'?'Explain the rejection…':'Notes…'} />
                </div>
              )}
            </div>
            <div className="modal-f">
              <button className="btn btn-ghost" onClick={()=>setStatusModal(null)}>Cancel</button>
              <button className="btn btn-primary" onClick={doStatusUpdate} disabled={saving||(statusModal.newStatus==='Rejected'&&!statusModal.reason?.trim())}>
                {saving?'Saving…':`Confirm — ${statusModal.newStatus}`}
              </button>
            </div>
          </div>
        </div>
      )}

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
      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}

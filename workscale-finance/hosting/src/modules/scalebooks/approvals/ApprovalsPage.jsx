import { useState, useEffect } from 'react';
import { collection, query, where, onSnapshot, updateDoc, doc, getDoc, serverTimestamp } from 'firebase/firestore';
import { db, auth } from '../../../firebase.js';
import { usePermissions } from '../../../contexts/PermissionsContext.jsx';

const fmt = (n) => new Intl.NumberFormat('en-PH', { style:'currency', currency:'PHP' }).format(n || 0);

// Config per document type: which Firestore collection to watch, which statuses indicate
// "needs verifier" vs "needs approver", and what status to advance to on approval.
const DOC_TYPE_CONFIG = {
  'Vouchers': {
    collection:         'vouchers',
    verifierStatus:     ['For Verification', 'Pending'],   // 'Pending' kept for legacy docs
    approverStatus:     'For Approval',
    verifierNextStatus: 'For Approval',
    approverNextStatus: 'Approved',
    docFilter:          (d) => d.voucherType !== 'CHECK',
    label:              'Voucher',
    idField:            'voucherId',
    dateField:          'preparationDate',
    descField:          'contactSummary',
    amountField:        'totalAmount',
  },
  'Check Voucher': {
    collection:         'vouchers',
    verifierStatus:     'For Verification',
    approverStatus:     'For Approval',
    verifierNextStatus: 'For Approval',
    approverNextStatus: 'Approved',
    docFilter:          (d) => d.voucherType === 'CHECK',
    label:              'Check Voucher',
    idField:            'voucherId',
    dateField:          'preparationDate',
    descField:          'contactSummary',
    amountField:        'totalAmount',
  },
  'Disbursements': {
    collection:         'disbursementReports',
    verifierStatus:     'For Verification',
    approverStatus:     'For Approval',
    verifierNextStatus: 'For Approval',
    approverNextStatus: 'Approved',
    docFilter:          () => true,
    label:              'Disbursement',
    idField:            'reportId',
    dateField:          'date',
    descField:          'createdBy',
    amountField:        'totalAmount',
  },
  'Weekly Projections': {
    collection:         'weeklyProjections',
    verifierStatus:     'Pending Review',
    approverStatus:     'Pending Approval',
    verifierNextStatus: 'Pending Approval',
    approverNextStatus: 'Approved',
    docFilter:          () => true,
    label:              'Projection',
    idField:            'projId',
    dateField:          'startDate',
    descField:          'weekCoverage',
    amountField:        'totalAmount',
  },
  'Journal': {
    collection:         'journalEntries',
    verifierStatus:     'Pending Review',
    approverStatus:     'Pending Approval',
    verifierNextStatus: 'Pending Approval',
    approverNextStatus: 'For Posting',
    docFilter:          () => true,
    label:              'Journal Entry',
    idField:            'jeId',
    dateField:          'date',
    descField:          'description',
    amountField:        'totalDebit',
  },
};

const CSS = `
  .ap-wrap   { display:flex; flex-direction:column; height:100%; overflow:hidden; font-family:Inter,system-ui,sans-serif; }
  .ap-topbar { display:flex; align-items:center; justify-content:space-between; padding:16px 22px 12px; flex-shrink:0; border-bottom:1px solid #e5e7eb; background:#fff; }
  .ap-body   { flex:1; overflow-y:auto; padding:16px 22px; }
  .card      { background:#fff; border:1px solid #e5e7eb; border-radius:14px; overflow:hidden; margin-bottom:12px; }
  table      { width:100%; border-collapse:collapse; }
  th,td      { padding:11px 14px; border-bottom:1px solid #f1f5f9; font-size:13px; text-align:left; }
  th         { color:#64748b; font-weight:800; font-size:11px; letter-spacing:.05em; text-transform:uppercase; background:#f8fafc; white-space:nowrap; }
  tbody tr   { cursor:pointer; }
  tbody tr:hover td { background:#fafafa; }
  tbody tr:last-child td { border-bottom:none; }
  .empty     { padding:64px; text-align:center; color:#94a3b8; }
  .approve-btn { background:#d1fae5; color:#065f46; border:0; border-radius:8px; padding:6px 12px; font-weight:700; font-size:12px; cursor:pointer; white-space:nowrap; }
  .approve-btn:hover { background:#a7f3d0; }
  .reject-btn  { background:#fee2e2; color:#dc2626; border:0; border-radius:8px; padding:6px 12px; font-weight:700; font-size:12px; cursor:pointer; white-space:nowrap; }
  .reject-btn:hover  { background:#fecaca; }
  .toast { position:fixed; right:16px; bottom:16px; background:#0b1220; color:#fff; padding:12px 18px; border-radius:12px; font-size:13px; font-weight:600; z-index:9999; }
  .badge-count { display:inline-block; background:#ef4444; color:#fff; border-radius:999px; font-size:10px; font-weight:800; padding:1px 7px; margin-left:6px; }
  .info-grid { display:grid; grid-template-columns:1fr 1fr 1fr; gap:12px; margin-bottom:16px; }
  .info-card { background:#fff; border:1px solid #e5e7eb; border-radius:12px; padding:14px 16px; }
  .info-label { font-size:10px; font-weight:800; color:#94a3b8; text-transform:uppercase; letter-spacing:.07em; }
  .info-value { font-size:20px; font-weight:900; margin-top:3px; }
  .type-badge { display:inline-block; padding:2px 7px; border-radius:5px; font-size:10px; font-weight:700; background:#f1f5f9; color:#475569; border:1px solid #e2e8f0; white-space:nowrap; }
  .bulk-bar  { display:flex; align-items:center; gap:10px; background:#f0f9ff; border:1px solid #bae6fd; border-radius:12px; padding:10px 16px; margin-bottom:12px; }
  .btn-bulk-approve { background:#d1fae5; color:#065f46; border:0; border-radius:8px; padding:7px 14px; font-weight:700; font-size:12px; cursor:pointer; }
  .btn-bulk-approve:hover { background:#a7f3d0; }
  .btn-bulk-reject  { background:#fee2e2; color:#dc2626; border:0; border-radius:8px; padding:7px 14px; font-weight:700; font-size:12px; cursor:pointer; }
  .btn-bulk-reject:hover  { background:#fecaca; }
  .btn-bulk-clear   { background:#f1f5f9; color:#64748b; border:0; border-radius:8px; padding:7px 14px; font-weight:700; font-size:12px; cursor:pointer; }
  .btn-bulk-clear:hover   { background:#e2e8f0; }
`;

export default function ApprovalsPage() {
  const { isAdmin } = usePermissions();
  const [pending,      setPending]      = useState([]);
  const [loading,      setLoading]      = useState(true);
  const [selected,     setSelected]     = useState(new Set());
  const [previewItem,  setPreviewItem]  = useState(null);
  const [previewJe,    setPreviewJe]    = useState(null); // fetched JE for regular Vouchers
  const [toast,        setToast]        = useState('');
  const [confirmModal, setConfirmModal] = useState(null); // { items:[], action:'approve'|'reject', remarks:'' }

  const showToast = (msg) => { setToast(msg); setTimeout(() => setToast(''), 3000); };

  // Fetch linked JE when a regular Voucher preview opens
  useEffect(() => {
    setPreviewJe(null);
    if (!previewItem) return;
    if (previewItem._docType === 'Vouchers' && previewItem.linkedJeId) {
      getDoc(doc(db, 'journalEntries', previewItem.linkedJeId))
        .then(snap => { if (snap.exists()) setPreviewJe({ id: snap.id, ...snap.data() }); })
        .catch(() => {});
    }
  }, [previewItem]);

  useEffect(() => {
    const me = auth.currentUser?.email?.toLowerCase();
    if (!me) { setLoading(false); return; }

    let docUnsubs = [];
    const cancelDocListeners = () => { docUnsubs.forEach(u => u()); docUnsubs = []; };

    // Use onSnapshot so the page reacts automatically when approval routing is saved/changed
    const routingUnsub = onSnapshot(doc(db, 'settings', 'approvalRouting'), (snap) => {
      cancelDocListeners(); // tear down old collection listeners before rebuilding

      const routes = snap.exists() ? (snap.data().routes ?? []) : [];
      console.log('[ApprovalsPage] me:', me, '| routes:', routes.length);

      // Determine which doc types this user is a verifier or approver for (based on routing)
      // No maker filtering — the verifier/approver sees ALL docs of that type at the right status,
      // regardless of who created them (Admin, Maker, or anyone else).
      const docTypeRoles = {}; // docType → { isVerifier: bool, isApprover: bool }
      for (const docType of Object.keys(DOC_TYPE_CONFIG)) {
        const isVerifier = routes.some(r => r.documentType === docType && (r.verifierEmail || '').toLowerCase() === me);
        const isApprover = routes.some(r => r.documentType === docType && (r.approverEmail || '').toLowerCase() === me);
        if (isVerifier || isApprover) docTypeRoles[docType] = { isVerifier, isApprover };
      }
      console.log('[ApprovalsPage] docTypeRoles:', JSON.stringify(docTypeRoles));

      // Group doc types by Firestore collection to avoid duplicate listeners on same collection
      // (Vouchers + Check Voucher share the same 'vouchers' collection)
      const collectionGroups = {}; // collectionName → { docTypes: string[] }
      for (const docType of Object.keys(docTypeRoles)) {
        const colName = DOC_TYPE_CONFIG[docType].collection;
        if (!collectionGroups[colName]) collectionGroups[colName] = { docTypes: [] };
        collectionGroups[colName].docTypes.push(docType);
      }

      if (Object.keys(collectionGroups).length === 0) {
        console.log('[ApprovalsPage] No routes found for this user → empty state');
        setPending([]);
        setLoading(false);
        return;
      }

      // Track loaded state per collection so we only clear loading once all are ready
      const loadedFlags = {};
      const snapshots   = {}; // collectionName → doc[]

      const checkAllLoaded = () => {
        if (Object.keys(loadedFlags).length === Object.keys(collectionGroups).length
            && Object.values(loadedFlags).every(Boolean)) {
          const merged = Object.values(snapshots).flat();
          merged.sort((a, b) => (a.createdAt?.toMillis?.() ?? 0) - (b.createdAt?.toMillis?.() ?? 0));
          setPending(merged);
          setLoading(false);
        }
      };

      for (const [colName, { docTypes }] of Object.entries(collectionGroups)) {
        loadedFlags[colName] = false;

        // Collect all relevant statuses for this collection
        const statusSet = new Set();
        for (const docType of docTypes) {
          const cfg   = DOC_TYPE_CONFIG[docType];
          const roles = docTypeRoles[docType];
          if (roles.isVerifier) [].concat(cfg.verifierStatus).forEach(s => statusSet.add(s));
          if (roles.isApprover) statusSet.add(cfg.approverStatus);
        }

        const q = query(
          collection(db, colName),
          where('status', 'in', [...statusSet]),
        );
        console.log(`[ApprovalsPage] Query ${colName} — status IN`, [...statusSet]);

        const unsub = onSnapshot(q, (qSnap) => {
          console.log(`[ApprovalsPage] ${colName} snapshot: ${qSnap.docs.length} raw docs`);

          const allDocs = qSnap.docs.map(d => ({ id: d.id, ...d.data() }));
          const filtered = [];

          for (const d of allDocs) {
            for (const docType of docTypes) {
              const cfg   = DOC_TYPE_CONFIG[docType];
              const roles = docTypeRoles[docType];
              if (!cfg.docFilter(d)) continue;
              if (roles.isVerifier && [].concat(cfg.verifierStatus).includes(d.status)) {
                filtered.push({ ...d, _collection: colName, _docType: docType });
                break;
              }
              if (roles.isApprover && d.status === cfg.approverStatus) {
                filtered.push({ ...d, _collection: colName, _docType: docType });
                break;
              }
            }
          }

          // Deduplicate by id
          const seen = new Set();
          snapshots[colName] = filtered.filter(d => { if (seen.has(d.id)) return false; seen.add(d.id); return true; });

          loadedFlags[colName] = true;
          checkAllLoaded();
        });

        docUnsubs.push(unsub);
      }
    }, () => setLoading(false));

    return () => { routingUnsub(); cancelDocListeners(); };
  }, []);

  function toggle(id) {
    setSelected(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  }

  async function approve(item, remarks) {
    const me = auth.currentUser?.email;
    const cfg = DOC_TYPE_CONFIG[item._docType];
    const isVerifying = !isAdmin && [].concat(cfg.verifierStatus).includes(item.status);
    const nextStatus  = isVerifying ? cfg.verifierNextStatus : cfg.approverNextStatus;
    const extra = isVerifying
      ? { verifiedAt: serverTimestamp(), verifiedBy: me, verifierRemarks: remarks || '' }
      : { approvedAt: serverTimestamp(), approvedBy: me, approverRemarks: remarks || '' };
    await updateDoc(doc(db, item._collection, item.id), { status: nextStatus, ...extra, updatedAt: serverTimestamp() });
    showToast(isVerifying ? `${cfg.label} verified. Sent for final approval.` : `${cfg.label} approved.`);
  }

  async function reject(item, remarks) {
    await updateDoc(doc(db, item._collection, item.id), {
      status: 'Rejected',
      rejectedAt: serverTimestamp(),
      rejectedBy: auth.currentUser?.email,
      rejectionReason: remarks || '',
      updatedAt: serverTimestamp(),
    });
    showToast(`${DOC_TYPE_CONFIG[item._docType]?.label || 'Document'} rejected.`);
  }

  async function handleConfirm() {
    const { items, action, remarks } = confirmModal;
    setConfirmModal(null);
    setSelected(new Set());
    const results = await Promise.allSettled(
      items.map(item => action === 'approve' ? approve(item, remarks) : reject(item, remarks))
    );
    const failed  = results.filter(r => r.status === 'rejected').length;
    const succeed = results.length - failed;
    if (items.length > 1) {
      showToast(failed === 0
        ? `${succeed} document${succeed > 1 ? 's' : ''} ${action === 'approve' ? 'processed' : 'rejected'} successfully.`
        : `${succeed} processed, ${failed} failed. Please retry the failed items.`);
    } else if (failed > 0) {
      showToast('Action failed. Please try again.');
    }
  }

  const totalAmt = pending.reduce((s, item) => {
    const cfg = DOC_TYPE_CONFIG[item._docType];
    return s + (Number(item[cfg?.amountField]) || 0);
  }, 0);

  const allIds      = pending.map(i => i.id);
  const allChecked  = allIds.length > 0 && allIds.every(id => selected.has(id));
  const anySelected = allIds.some(id => selected.has(id));
  const selectedItems = pending.filter(i => selected.has(i.id));

  function toggleAll() { setSelected(allChecked ? new Set() : new Set(allIds)); }

  return (
    <div className="ap-wrap">
      <style>{CSS}</style>
      <div className="ap-topbar">
        <div>
          <h1 style={{ margin:0, fontSize:18, fontWeight:900 }}>
            My Approvals
            {pending.length > 0 && <span className="badge-count">{pending.length}</span>}
          </h1>
          <p style={{ margin:0, fontSize:12, color:'#64748b' }}>Documents routed to you for review or approval</p>
        </div>
      </div>

      <div className="ap-body">
        <div className="info-grid">
          <div className="info-card">
            <div className="info-label">Pending Count</div>
            <div className="info-value" style={{ color:'#dc2626' }}>{pending.length}</div>
          </div>
          <div className="info-card">
            <div className="info-label">Total Amount</div>
            <div className="info-value" style={{ fontSize:16, color:'#0f172a' }}>{fmt(totalAmt)}</div>
          </div>
          <div className="info-card">
            <div className="info-label">Logged in as</div>
            <div className="info-value" style={{ fontSize:13, color:'#475569', fontWeight:700 }}>{auth.currentUser?.email}</div>
          </div>
        </div>

        {anySelected && (
          <div className="bulk-bar">
            <span style={{ fontWeight:700, fontSize:13, color:'#0369a1' }}>{selectedItems.length} selected</span>
            <div style={{ display:'flex', gap:8, marginLeft:'auto' }}>
              <button className="btn-bulk-approve" onClick={() => setConfirmModal({ items: selectedItems, action:'approve', remarks:'' })}>✓ Process Selected</button>
              <button className="btn-bulk-reject"  onClick={() => setConfirmModal({ items: selectedItems, action:'reject',  remarks:'' })}>✗ Reject Selected</button>
              <button className="btn-bulk-clear"   onClick={() => setSelected(new Set())}>Clear</button>
            </div>
          </div>
        )}

        {loading ? (
          <div className="card"><div className="empty">Loading…</div></div>
        ) : pending.length === 0 ? (
          <div className="card">
            <div className="empty">
              <div style={{ fontSize:40, marginBottom:12 }}>✅</div>
              <strong>All caught up!</strong>
              <p style={{ margin:'8px 0 0', fontSize:12 }}>No documents routed to you at this time.</p>
            </div>
          </div>
        ) : (
          <div className="card">
            <table>
              <thead>
                <tr>
                  <th style={{ width:40, textAlign:'center' }}>
                    <input type="checkbox" checked={allChecked} onChange={toggleAll} style={{ cursor:'pointer' }} />
                  </th>
                  <th>Type</th>
                  <th>Document ID</th>
                  <th>Date</th>
                  <th>Description / Payee</th>
                  <th style={{ textAlign:'right' }}>Amount</th>
                  <th>Action Needed</th>
                  <th style={{ width:170 }}></th>
                </tr>
              </thead>
              <tbody>
                {pending.map(item => {
                  const cfg         = DOC_TYPE_CONFIG[item._docType] || {};
                  const isVerifying = !isAdmin && [].concat(cfg.verifierStatus).includes(item.status);
                  const actionLabel = isVerifying ? 'Verify' : 'Approve';
                  const docId  = item[cfg.idField]    || item.id;
                  const date   = item[cfg.dateField]  || '—';
                  const desc   = item[cfg.descField]  || '—';
                  const amount = Number(item[cfg.amountField]) || 0;
                  const isChecked = selected.has(item.id);
                  return (
                    <tr key={`${item._collection}-${item.id}`} style={{ background: isChecked ? '#f0f9ff' : undefined }}>
                      <td style={{ textAlign:'center', width:40 }} onClick={e => e.stopPropagation()}>
                        <input type="checkbox" checked={isChecked} onChange={() => toggle(item.id)} style={{ cursor:'pointer' }} />
                      </td>
                      <td onClick={() => setPreviewItem(item)}>
                        <span className="type-badge">{cfg.label || item._docType}</span>
                      </td>
                      <td onClick={() => setPreviewItem(item)} style={{ fontWeight:900, fontFamily:'monospace', fontSize:12 }}>{docId}</td>
                      <td onClick={() => setPreviewItem(item)} style={{ color:'#64748b', whiteSpace:'nowrap' }}>{date}</td>
                      <td onClick={() => setPreviewItem(item)} style={{ fontWeight:600, maxWidth:240, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{desc}</td>
                      <td onClick={() => setPreviewItem(item)} style={{ fontWeight:800, color:'#0f172a', textAlign:'right', whiteSpace:'nowrap' }}>{fmt(amount)}</td>
                      <td onClick={() => setPreviewItem(item)}>
                        <span style={{ padding:'3px 9px', borderRadius:6, fontWeight:700, fontSize:11,
                          background: isVerifying ? '#fffbeb' : '#eff6ff',
                          color:      isVerifying ? '#92400e' : '#1d4ed8',
                        }}>{actionLabel}</span>
                      </td>
                      <td onClick={e => e.stopPropagation()}>
                        <div style={{ display:'flex', gap:6 }}>
                          <button className="approve-btn" onClick={() => setConfirmModal({ items:[item], action:'approve', remarks:'' })}>✓ {actionLabel}</button>
                          <button className="reject-btn"  onClick={() => setConfirmModal({ items:[item], action:'reject',  remarks:'' })}>✗ Reject</button>
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

      {toast && <div className="toast">{toast}</div>}

      {/* ── Preview modal ── */}
      {previewItem && (() => {
        const item        = previewItem;
        const cfg         = DOC_TYPE_CONFIG[item._docType] || {};
        const isVerifying = !isAdmin && [].concat(cfg.verifierStatus).includes(item.status);
        const actionLabel = isVerifying ? 'Verify' : 'Approve';
        const docId       = item[cfg.idField]   || item.id;
        const amount      = Number(item[cfg.amountField]) || 0;
        const isCheck     = item.voucherType === 'CHECK';
        const lines       = item.lines || [];

        /* ── meta-info chips ─────────────────────────────── */
        const metaItems = [
          item.preparationDate  && { label:'Date',      value: item.preparationDate },
          item.purposeCategory  && { label:'Purpose',   value: item.purposeCategory },
          item.paymentFrom      && { label:'Bank / Acct', value: item.paymentFrom },
          (!item.isMultipleChecks && item.checkNumber) && { label:'Check No.', value: item.checkNumber },
          (!item.isMultipleChecks && item.checkDate)   && { label:'Check Date', value: item.checkDate },
          item.netCash > 0      && { label:'Net Cash',  value: fmt(item.netCash) },
          item.notes            && { label:'Notes',     value: item.notes },
          // fallbacks for non-voucher types
          !item.preparationDate && item[cfg.dateField]  && { label:'Date',   value: item[cfg.dateField] },
          !item.contactSummary  && item[cfg.descField]  && { label:'Detail', value: item[cfg.descField] },
        ].filter(Boolean);

        /* ── line-item columns per doc type ─────────────── */
        const cols = isCheck
          ? [
              { head:'Contact',     render: l => l.contact || '—' },
              { head:'Account',     render: l => l.expenseAccountCode || l.expenseAccount || '—' },
              { head:'Description', render: l => l.description || '—', flex: true },
              { head:'Check #',     render: l => l.lineCheckNo  || item.checkNumber  || '—' },
              { head:'Check Date',  render: l => l.lineCheckDate|| item.checkDate    || '—' },
              { head:'Tax',         render: l => l.taxAmt > 0 ? fmt(l.taxAmt) : '—', right: true },
              { head:'Amount',      render: l => fmt(Number(l.amount)||0), right: true, bold: true },
            ]
          : [
              { head:'Contact',    render: l => l.contact || l.accountName || '—' },
              { head:'Description', render: l => l.description || '—', flex: true },
              { head:'Tax Rate',    render: l => l.taxType && l.taxType !== 'N/A' ? (l.taxRate > 0 ? `${l.taxType} ${l.taxRate}%` : l.taxType) : '—', right: true },
              { head:'Amount',      render: l => l.debit  > 0 ? fmt(l.debit)  : l.amount > 0 ? fmt(l.amount) : '—', right: true, green: true },
              { head:'Tax',         render: l => l.credit > 0 ? fmt(l.credit) : l.taxAmt > 0 ? fmt(l.taxAmt) : '—', right: true, blue: true },
            ];

        const colTd = (col, l) => {
          const val   = col.render(l);
          const color = col.green ? '#15803d' : col.blue ? '#1d4ed8' : undefined;
          return (
            <td key={col.head} style={{ padding:'8px 10px', borderBottom:'1px solid #f1f5f9',
              textAlign: col.right ? 'right' : 'left',
              fontWeight: col.bold ? 700 : 400,
              color: color || (col.right && !col.bold ? '#374151' : undefined),
              whiteSpace: col.flex ? 'normal' : 'nowrap',
              maxWidth: col.flex ? 200 : undefined,
            }}>
              {val}
            </td>
          );
        };

        return (
          <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.5)', zIndex:1000,
                        display:'flex', alignItems:'center', justifyContent:'center', padding:16 }}
               onClick={() => setPreviewItem(null)}>
            <div style={{ background:'#fff', borderRadius:18, width:'100%', maxWidth:960,
                          maxHeight:'88vh', display:'flex', flexDirection:'column',
                          boxShadow:'0 24px 80px rgba(0,0,0,0.25)', fontFamily:'Inter,system-ui,sans-serif' }}
                 onClick={e => e.stopPropagation()}>

              {/* ── Header ── */}
              <div style={{ padding:'20px 24px 16px', borderBottom:'1px solid #e5e7eb' }}>
                <div style={{ display:'flex', alignItems:'flex-start', gap:10, marginBottom:4 }}>
                  <div style={{ flex:1, minWidth:0 }}>
                    <div style={{ display:'flex', alignItems:'center', gap:8, flexWrap:'wrap' }}>
                      <span style={{ fontWeight:900, fontSize:17, fontFamily:'monospace', color:'#0b1220' }}>{docId}</span>
                      <span className="type-badge">{cfg.label || item._docType}</span>
                      <span style={{ padding:'3px 10px', borderRadius:20, fontWeight:700, fontSize:11,
                        background: isVerifying ? '#fef9c3' : '#dbeafe',
                        color:      isVerifying ? '#713f12' : '#1e40af',
                        border:     isVerifying ? '1px solid #fde047' : '1px solid #bfdbfe',
                      }}>{actionLabel} Needed</span>
                    </div>
                  </div>
                  <div style={{ display:'flex', alignItems:'center', gap:10, flexShrink:0 }}>
                    <div style={{ textAlign:'right' }}>
                      <div style={{ fontSize:11, color:'#94a3b8', fontWeight:700, textTransform:'uppercase', letterSpacing:'.05em' }}>Total</div>
                      <div style={{ fontWeight:900, fontSize:20, color:'#0b1220' }}>{fmt(amount)}</div>
                    </div>
                    <button onClick={() => setPreviewItem(null)}
                      style={{ background:'#f1f5f9', border:'none', cursor:'pointer', width:32, height:32,
                               borderRadius:'50%', fontSize:16, color:'#64748b', display:'flex',
                               alignItems:'center', justifyContent:'center', flexShrink:0 }}>✕</button>
                  </div>
                </div>

                {/* Meta chips */}
                {metaItems.length > 0 && (
                  <div style={{ display:'flex', flexWrap:'wrap', gap:'6px 10px', marginTop:10 }}>
                    {metaItems.map(m => (
                      <div key={m.label} style={{ display:'flex', alignItems:'baseline', gap:4, background:'#f8fafc',
                                                  border:'1px solid #e2e8f0', borderRadius:8, padding:'4px 10px', fontSize:12 }}>
                        <span style={{ color:'#94a3b8', fontWeight:700, textTransform:'uppercase', fontSize:10, letterSpacing:'.04em' }}>{m.label}</span>
                        <span style={{ color:'#0f172a', fontWeight:600 }}>{m.value}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* ── Lines table ── */}
              <div style={{ flex:1, overflowY:'auto', minHeight:0 }}>
                {lines.length > 0 ? (
                  <table style={{ width:'100%', borderCollapse:'collapse', fontSize:13 }}>
                    <thead style={{ position:'sticky', top:0, zIndex:1 }}>
                      <tr>
                        <th style={{ padding:'8px 10px', width:32, background:'#f8fafc', borderBottom:'2px solid #e5e7eb' }}>#</th>
                        {cols.map(col => (
                          <th key={col.head} style={{ padding:'8px 10px', color:'#64748b', fontWeight:800, fontSize:11,
                            textTransform:'uppercase', letterSpacing:'.05em', background:'#f8fafc',
                            borderBottom:'2px solid #e5e7eb', textAlign: col.right ? 'right' : 'left',
                            whiteSpace:'nowrap' }}>
                            {col.head}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {lines.map((l, i) => (
                        <tr key={i} style={{ background: i % 2 === 1 ? '#fafafa' : '#fff' }}>
                          <td style={{ padding:'8px 10px', borderBottom:'1px solid #f1f5f9', color:'#0f172a', fontSize:11, textAlign:'center', fontWeight:600 }}>{i + 1}</td>
                          {cols.map(col => colTd(col, l))}
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr style={{ background:'#f8fafc' }}>
                        <td colSpan={cols.length} style={{ padding:'9px 10px', borderTop:'2px solid #e5e7eb',
                                  fontWeight:800, fontSize:12, color:'#374151', textAlign:'right' }}>
                          Total
                        </td>
                        <td style={{ padding:'9px 10px', borderTop:'2px solid #e5e7eb', fontWeight:900,
                                     fontSize:14, color:'#0b1220', textAlign:'right', whiteSpace:'nowrap' }}>
                          {fmt(amount)}
                        </td>
                      </tr>
                    </tfoot>
                  </table>
                ) : (
                  <div style={{ padding:'40px 24px', textAlign:'center', color:'#94a3b8' }}>
                    <div style={{ fontSize:32, marginBottom:8 }}>📄</div>
                    <div style={{ fontWeight:700, fontSize:14 }}>No line details available</div>
                    <div style={{ fontSize:12, marginTop:4 }}>This document has no recorded line items.</div>
                  </div>
                )}

                {/* ── Journal Entry / Memo section ── */}
                {(item._docType === 'Vouchers' || item._docType === 'Check Voucher') && (() => {
                  const sectionTitle = isCheck ? 'Journal Memo' : 'Journal Entry';
                  const noteText     = isCheck
                    ? 'Memo only — entries are posted to the GL upon check clearance (IFRS 9 §3.3.1).'
                    : null;

                  /* For Check Vouchers: compute memo from line items */
                  let jeLines = [];
                  if (isCheck) {
                    const accMap = {};
                    (item.lines || []).forEach(l => {
                      const code = l.expenseAccountCode || l.expenseAccount || '—';
                      const amt  = Number(l.amount) || 0;
                      if (!accMap[code]) accMap[code] = { accountCode: code, accountName: code, debit: 0, credit: 0 };
                      accMap[code].debit += amt;
                    });
                    jeLines = [
                      ...Object.values(accMap),
                      { accountCode: item.pdcAccountCode || 'PDC-ISSUED', accountName: 'Post-Dated Checks Issued', debit: 0, credit: amount },
                    ];
                  } else {
                    jeLines = (previewJe?.lines) || [];
                  }

                  const jeTotalDr = jeLines.reduce((s, l) => s + (Number(l.debit)  || 0), 0);
                  const jeTotalCr = jeLines.reduce((s, l) => s + (Number(l.credit) || 0), 0);
                  const jeRef     = !isCheck && previewItem?.linkedJeId ? (previewJe?.jeId || previewItem.linkedJeId) : null;
                  const jeStatus  = !isCheck ? previewJe?.status : null;
                  const loading   = !isCheck && previewItem?.linkedJeId && !previewJe;

                  return (
                    <div style={{ borderTop:'2px solid #f1f5f9', marginTop:0 }}>
                      {/* Section header */}
                      <div style={{ display:'flex', alignItems:'center', gap:8, padding:'12px 16px 8px',
                                    background:'#f8fafc' }}>
                        <span style={{ fontWeight:800, fontSize:12, color:'#374151',
                                       textTransform:'uppercase', letterSpacing:'.06em' }}>
                          {sectionTitle}
                        </span>
                        {jeRef && (
                          <span style={{ fontSize:11, fontFamily:'monospace', color:'#64748b',
                                         background:'#e2e8f0', padding:'1px 6px', borderRadius:4 }}>
                            {jeRef}
                          </span>
                        )}
                        {jeStatus && (
                          <span style={{ fontSize:10, fontWeight:700, padding:'2px 8px', borderRadius:20,
                                         background: jeStatus === 'Posted' ? '#d1fae5' : jeStatus === 'For Clearing' ? '#fffbeb' : '#f1f5f9',
                                         color:      jeStatus === 'Posted' ? '#065f46' : jeStatus === 'For Clearing' ? '#92400e' : '#64748b',
                                         border:     jeStatus === 'Posted' ? '1px solid #a7f3d0' : jeStatus === 'For Clearing' ? '1px solid #fde68a' : '1px solid #e2e8f0',
                                       }}>
                            {jeStatus}
                          </span>
                        )}
                        {isCheck && (
                          <span style={{ fontSize:10, fontWeight:700, padding:'2px 8px', borderRadius:20,
                                         background:'#fef9c3', color:'#713f12', border:'1px solid #fde047' }}>
                            Memo Only
                          </span>
                        )}
                        {loading && <span style={{ fontSize:11, color:'#94a3b8' }}>Loading…</span>}
                      </div>

                      {noteText && (
                        <div style={{ padding:'0 16px 8px', fontSize:11, color:'#92400e',
                                      background:'#fffbeb', borderBottom:'1px solid #fde68a' }}>
                          ⚠ {noteText}
                        </div>
                      )}

                      {jeLines.length > 0 ? (
                        <table style={{ width:'100%', borderCollapse:'collapse', fontSize:12 }}>
                          <thead>
                            <tr style={{ background:'#f8fafc' }}>
                              <th style={{ padding:'7px 12px 7px 16px', color:'#94a3b8', fontWeight:800, fontSize:10,
                                           textTransform:'uppercase', letterSpacing:'.05em',
                                           borderBottom:'1px solid #e5e7eb', textAlign:'left', whiteSpace:'nowrap' }}>Account Code</th>
                              <th style={{ padding:'7px 12px', color:'#94a3b8', fontWeight:800, fontSize:10,
                                           textTransform:'uppercase', letterSpacing:'.05em',
                                           borderBottom:'1px solid #e5e7eb', textAlign:'left' }}>Account Name</th>
                              {!isCheck && (
                                <th style={{ padding:'7px 12px', color:'#94a3b8', fontWeight:800, fontSize:10,
                                             textTransform:'uppercase', letterSpacing:'.05em',
                                             borderBottom:'1px solid #e5e7eb', textAlign:'left' }}>Description</th>
                              )}
                              <th style={{ padding:'7px 12px', color:'#94a3b8', fontWeight:800, fontSize:10,
                                           textTransform:'uppercase', letterSpacing:'.05em',
                                           borderBottom:'1px solid #e5e7eb', textAlign:'right', whiteSpace:'nowrap' }}>Debit</th>
                              <th style={{ padding:'7px 12px 7px 12px', color:'#94a3b8', fontWeight:800, fontSize:10,
                                           textTransform:'uppercase', letterSpacing:'.05em',
                                           borderBottom:'1px solid #e5e7eb', textAlign:'right', whiteSpace:'nowrap' }}>Credit</th>
                            </tr>
                          </thead>
                          <tbody>
                            {jeLines.map((l, i) => (
                              <tr key={i}>
                                <td style={{ padding:'7px 12px 7px 16px', borderBottom:'1px solid #f8fafc',
                                             fontFamily:'monospace', fontSize:11, color:'#475569' }}>
                                  {l.accountCode || '—'}
                                </td>
                                <td style={{ padding:'7px 12px', borderBottom:'1px solid #f8fafc',
                                             fontWeight: 600,
                                             color: '#0f172a',
                                             paddingLeft: l.debit === 0 ? 28 : 12 }}>
                                  {l.accountName || l.accountCode || '—'}
                                </td>
                                {!isCheck && (
                                  <td style={{ padding:'7px 12px', borderBottom:'1px solid #f8fafc', color:'#94a3b8', fontSize:11 }}>
                                    {l.description || ''}
                                  </td>
                                )}
                                <td style={{ padding:'7px 12px', borderBottom:'1px solid #f8fafc',
                                             textAlign:'right', fontWeight:700,
                                             color: l.debit > 0 ? '#15803d' : '#d1d5db' }}>
                                  {l.debit > 0 ? fmt(l.debit) : '—'}
                                </td>
                                <td style={{ padding:'7px 12px', borderBottom:'1px solid #f8fafc',
                                             textAlign:'right', fontWeight:700,
                                             color: l.credit > 0 ? '#1d4ed8' : '#d1d5db' }}>
                                  {l.credit > 0 ? fmt(l.credit) : '—'}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                          <tfoot>
                            <tr style={{ background:'#f8fafc' }}>
                              <td colSpan={isCheck ? 1 : 2}
                                  style={{ padding:'8px 12px 8px 16px', borderTop:'2px solid #e5e7eb',
                                           fontWeight:800, fontSize:11, color:'#374151' }}>
                                Total
                              </td>
                              {!isCheck && <td style={{ borderTop:'2px solid #e5e7eb' }} />}
                              <td style={{ padding:'8px 12px', borderTop:'2px solid #e5e7eb',
                                           textAlign:'right', fontWeight:900, fontSize:13, color:'#15803d' }}>
                                {fmt(jeTotalDr)}
                              </td>
                              <td style={{ padding:'8px 12px', borderTop:'2px solid #e5e7eb',
                                           textAlign:'right', fontWeight:900, fontSize:13, color:'#1d4ed8' }}>
                                {fmt(jeTotalCr)}
                              </td>
                            </tr>
                            {!isCheck && Math.abs(jeTotalDr - jeTotalCr) > 0.01 && (
                              <tr>
                                <td colSpan={5} style={{ padding:'4px 16px 8px', fontSize:11,
                                                          color:'#dc2626', background:'#fef2f2' }}>
                                  ⚠ Debit/Credit imbalance: {fmt(Math.abs(jeTotalDr - jeTotalCr))}
                                </td>
                              </tr>
                            )}
                          </tfoot>
                        </table>
                      ) : !loading ? (
                        <div style={{ padding:'16px', fontSize:12, color:'#94a3b8', textAlign:'center' }}>
                          No journal entry linked to this document.
                        </div>
                      ) : null}
                    </div>
                  );
                })()}
              </div>

              {/* ── Footer ── */}
              <div style={{ padding:'14px 24px', borderTop:'1px solid #e5e7eb', display:'flex',
                            gap:8, justifyContent:'flex-end', background:'#fafafa', borderRadius:'0 0 18px 18px' }}>
                <button onClick={() => setPreviewItem(null)}
                  style={{ border:'1px solid #e2e8f0', background:'#fff', borderRadius:10,
                           padding:'9px 20px', fontWeight:700, fontSize:13, cursor:'pointer', fontFamily:'inherit', color:'#374151' }}>
                  Close
                </button>
                <button onClick={() => { setPreviewItem(null); setConfirmModal({ items:[item], action:'reject', remarks:'' }); }}
                  style={{ border:0, background:'#fee2e2', color:'#dc2626', borderRadius:10,
                           padding:'9px 20px', fontWeight:700, fontSize:13, cursor:'pointer', fontFamily:'inherit' }}>
                  ✗ Reject
                </button>
                <button onClick={() => { setPreviewItem(null); setConfirmModal({ items:[item], action:'approve', remarks:'' }); }}
                  style={{ border:0, background:'#d1fae5', color:'#065f46', borderRadius:10,
                           padding:'9px 20px', fontWeight:700, fontSize:13, cursor:'pointer', fontFamily:'inherit' }}>
                  ✓ {actionLabel}
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* ── Confirm modal (single or bulk) ── */}
      {confirmModal && (() => {
        const { items, action, remarks } = confirmModal;
        const isBulk      = items.length > 1;
        const item        = items[0];
        const cfg         = DOC_TYPE_CONFIG[item._docType] || {};
        const isVerifying = !isAdmin && [].concat(cfg.verifierStatus).includes(item.status);
        const docId       = item[cfg.idField] || item.id;
        const isApprove   = action === 'approve';
        const title  = isApprove
          ? (isBulk ? `Confirm Processing ${items.length} Documents` : (isVerifying ? 'Confirm Verification' : 'Confirm Approval'))
          : (isBulk ? `Confirm Rejecting ${items.length} Documents`  : 'Confirm Rejection');
        const body   = isApprove
          ? (isBulk ? `You are about to process ${items.length} selected documents. Each will be advanced based on its current status. This cannot be undone.`
                    : `You are about to ${isVerifying ? 'verify' : 'approve'} ${docId} (${cfg.label}). This cannot be undone.`)
          : (isBulk ? `You are about to reject ${items.length} selected documents.`
                    : `You are about to reject ${docId} (${cfg.label}).`);
        const btnColor = isApprove ? '#15803d' : '#dc2626';
        const btnLabel = isApprove
          ? (isBulk ? `Yes, Process ${items.length}` : (isVerifying ? 'Yes, Verify' : 'Yes, Approve'))
          : (isBulk ? `Yes, Reject ${items.length}`  : 'Yes, Reject');
        return (
          <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.45)', zIndex:1100,
                        display:'flex', alignItems:'center', justifyContent:'center' }}
               onClick={() => setConfirmModal(null)}>
            <div style={{ background:'#fff', borderRadius:16, padding:'28px 32px', width:460,
                          boxShadow:'0 20px 60px rgba(0,0,0,0.2)', fontFamily:'Inter,system-ui,sans-serif' }}
                 onClick={e => e.stopPropagation()}>
              <h2 style={{ margin:'0 0 6px', fontSize:17, fontWeight:900, color:'#0b1220' }}>{title}</h2>
              <p style={{ margin:'0 0 18px', fontSize:13, color:'#64748b' }}>{body}</p>
              <label style={{ display:'block', fontSize:12, fontWeight:700, color:'#374151', marginBottom:6 }}>
                {isApprove ? 'Remarks (optional)' : 'Rejection reason (optional)'}
              </label>
              <textarea
                rows={3}
                placeholder={isApprove ? 'Add any remarks or notes…' : 'Enter rejection reason…'}
                value={remarks}
                onChange={e => setConfirmModal(m => ({ ...m, remarks: e.target.value }))}
                style={{ width:'100%', boxSizing:'border-box', border:'1px solid #e2e8f0', borderRadius:8,
                         padding:'8px 10px', fontSize:13, fontFamily:'inherit', resize:'vertical',
                         outline:'none', marginBottom:20 }}
              />
              <div style={{ display:'flex', gap:10, justifyContent:'flex-end' }}>
                <button onClick={() => setConfirmModal(null)}
                  style={{ border:'1px solid #e2e8f0', background:'#f8fafc', borderRadius:10,
                           padding:'9px 20px', fontWeight:700, fontSize:13, cursor:'pointer', fontFamily:'inherit' }}>
                  Cancel
                </button>
                <button onClick={handleConfirm}
                  style={{ border:0, background:btnColor, color:'#fff', borderRadius:10,
                           padding:'9px 20px', fontWeight:700, fontSize:13, cursor:'pointer', fontFamily:'inherit' }}>
                  {btnLabel}
                </button>
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}



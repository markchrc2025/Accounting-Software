import { useState, useEffect, useCallback } from 'react';
import { usePermissions } from '../../../contexts/PermissionsContext.jsx';
import { useAuth } from '../../../auth/AuthProvider.jsx';
import {
  getSettings, listVouchers, listJournalEntries, listDisbursementReports,
  weeklyProjectionsApi, transitionVoucher, transitionJournalEntry,
  setDisbursementStatus, getVoucher, getJournalEntry, ApiError,
} from '../../../lib/api.js';

const fmt = (n) => new Intl.NumberFormat('en-PH', { style:'currency', currency:'PHP' }).format(n || 0);

// ── API <-> UI mappings (mirrors VouchersPage / JournalPage) ─────────────────
const TYPE_TO_API = { PAYMENT:'payment', RECEIPT:'receipt', PAYROLL:'payroll', FINAL_PAY:'final_pay', LOAN:'loan', CHECK:'check' };
const API_TO_TYPE = Object.fromEntries(Object.entries(TYPE_TO_API).map(([k,v])=>[v,k]));
const VSTATUS_LABEL = {
  draft:'Draft', pending:'Pending', for_verification:'For Verification', verified:'Verified',
  for_approval:'For Approval', approved:'Approved', paid:'Paid', rejected:'Rejected',
  posted:'Approved', void:'Voided',
};
const JSTATUS_LABEL = {
  draft:'Draft', pending_review:'Pending Review', pending_approval:'Pending Approval',
  for_clearing:'For Clearing', cleared:'Cleared', for_posting:'For Posting',
  posted:'Posted', rejected:'Rejected', voided:'Voided', reversed:'Reversed',
};

// The API enforces workflow graphs one hop at a time; approvals may need to walk
// several hops (e.g. an admin approving a voucher still at 'for_verification').
const VOUCHER_CHAIN = ['pending', 'for_verification', 'verified', 'for_approval', 'approved'];
const JOURNAL_CHAIN = ['pending_review', 'pending_approval', 'for_clearing', 'cleared', 'for_posting'];
function chainSteps(chain, from, to) {
  const i = chain.indexOf(from);
  const j = chain.indexOf(to);
  if (j === -1) return [];
  if (i === -1) return [to]; // unexpected status — try the direct hop, server will 409 with detail
  if (j <= i) return [];
  return chain.slice(i + 1, j + 1);
}

// ── API rows -> the legacy shapes this screen renders ────────────────────────
// `status` stays the RAW api status (queue matching + transitions); display
// labels are derived where needed. Extra legacy fields (check numbers, net cash,
// reject reasons, …) live in jsonb `meta` and are spread through for the preview.
const voucherRow = (v) => ({
  ...(v.meta || {}),
  id: v.id,
  status: v.status,
  statusLabel: VSTATUS_LABEL[v.status] || v.status,
  voucherType: API_TO_TYPE[v.voucherType] || 'PAYMENT',
  voucherId: v.voucherNo,
  preparationDate: v.voucherDate,
  purposeCategory: v.purposeCategory || '',
  contactSummary: (v.meta && v.meta.contactSummary) || v.contactName || '',
  totalAmount: (v.totalCents ?? 0) / 100,
  notes: v.notes || '',
  linkedJeId: v.journalEntryId || null,
  paymentFrom: (v.meta && v.meta.paymentFrom) || v.paymentFromAccountName || v.paymentFromAccountCode || '',
  createdBy: v.createdByEmail || '',
  createdAt: v.createdAt,
  lines: null, // loaded on demand via getVoucher when previewed
});
// Voucher API detail line -> the legacy line shape (as VouchersPage does).
const voucherLineFromApi = (l) => {
  const m = l.meta || {};
  return {
    lineNo: l.lineNo, contactId: m.contactId || '', contact: m.contact || '',
    expenseAccountCode: l.accountCode || '', description: l.description || '',
    amount: (l.amountCents ?? 0) / 100, category: m.category || '',
    taxRateId: m.taxRateId || '', taxType: m.taxType || 'N/A',
    taxRate: m.taxRate || 0, taxAmt: m.taxAmt || 0, inclusive: !!m.inclusive,
    lineCheckNo: m.lineCheckNo || '', lineCheckDate: m.lineCheckDate || '',
  };
};
const journalRow = (e) => ({
  id: e.id,
  status: e.status,
  statusLabel: JSTATUS_LABEL[e.status] || e.status,
  jeId: e.entryNo,
  date: e.entryDate,
  description: e.memo || '',
  totalDebit: (e.totalCents ?? 0) / 100,
  createdBy: e.createdByEmail || '',
  createdAt: e.createdAt,
  lines: (e.lines || []).map(l => ({
    accountCode: l.accountCode || '',
    accountName: l.accountName || '',
    contact: l.contactName || '',
    description: l.description || '',
    debit: (l.debitCents ?? 0) / 100,
    credit: (l.creditCents ?? 0) / 100,
  })),
});
const disbursementRow = (r) => ({
  ...(r.meta || {}),
  id: r.id,
  status: r.status, // stored capitalized ('For Verification', 'For Approval', …)
  statusLabel: r.status,
  reportId: r.reportNo,
  date: r.reportDate,
  createdBy: r.createdByEmail || '',
  totalAmount: (r.totalCents ?? 0) / 100,
  notes: r.notes || '',
  createdAt: r.createdAt,
  lines: Array.isArray(r.lines) ? r.lines : [], // jsonb snapshot — legacy peso shape
});
const projectionRow = (p) => ({
  id: p.id,
  status: p.status, // stored capitalized ('Pending Review', 'Pending Approval', …)
  statusLabel: p.status,
  projId: p.projNo || '',
  startDate: p.startDate || '',
  weekCoverage: p.weekCoverage || '',
  totalAmount: (p.totalOutCents ?? 0) / 100,
  notes: p.notes || '',
  createdAt: p.createdAt,
  lines: Array.isArray(p.lines) ? p.lines : [], // jsonb snapshot — legacy peso shape
});

// One list call per API source (Vouchers + Check Voucher share 'vouchers').
const SOURCES = {
  vouchers:      { fetch: () => listVouchers({ limit: 500 }),       map: voucherRow },
  journal:       { fetch: () => listJournalEntries({ limit: 500 }), map: journalRow },
  disbursements: { fetch: () => listDisbursementReports(),          map: disbursementRow },
  projections:   { fetch: () => weeklyProjectionsApi.list(),        map: projectionRow },
};

// Config per document type: which API source to list, which RAW statuses indicate
// "needs verifier" vs "needs approver", and how to render the row.
const DOC_TYPE_CONFIG = {
  'Vouchers': {
    source:         'vouchers',
    verifierStatus: ['for_verification', 'pending'],   // 'pending' kept for legacy docs
    approverStatus: 'for_approval',
    docFilter:      (d) => d.voucherType !== 'CHECK',
    label:          'Voucher',
    idField:        'voucherId',
    dateField:      'preparationDate',
    descField:      'contactSummary',
    amountField:    'totalAmount',
  },
  'Check Voucher': {
    source:         'vouchers',
    verifierStatus: ['for_verification'],
    approverStatus: 'for_approval',
    docFilter:      (d) => d.voucherType === 'CHECK',
    label:          'Check Voucher',
    idField:        'voucherId',
    dateField:      'preparationDate',
    descField:      'contactSummary',
    amountField:    'totalAmount',
  },
  'Disbursements': {
    source:         'disbursements',
    verifierStatus: ['For Verification'],
    approverStatus: 'For Approval',
    docFilter:      () => true,
    label:          'Disbursement',
    idField:        'reportId',
    dateField:      'date',
    descField:      'createdBy',
    amountField:    'totalAmount',
  },
  'Weekly Projections': {
    source:         'projections',
    verifierStatus: ['Pending Review'],
    approverStatus: 'Pending Approval',
    docFilter:      () => true,
    label:          'Projection',
    idField:        'projId',
    dateField:      'startDate',
    descField:      'weekCoverage',
    amountField:    'totalAmount',
  },
  'Journal': {
    source:         'journal',
    verifierStatus: ['pending_review'],
    approverStatus: 'pending_approval',
    docFilter:      () => true,
    label:          'Journal Entry',
    idField:        'jeId',
    dateField:      'date',
    descField:      'description',
    amountField:    'totalDebit',
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
  .refresh-btn { background:#f1f5f9; color:#0b1220; border:0; border-radius:10px; padding:9px 16px; font-weight:700; font-size:13px; cursor:pointer; font-family:inherit; }
  .refresh-btn:hover { background:#e2e8f0; }
  .refresh-btn:disabled { opacity:.5; cursor:not-allowed; }
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
  const { session } = useAuth();
  const userEmail = session?.user?.email || '';
  const me = userEmail.toLowerCase();

  const [pending,      setPending]      = useState([]);
  const [loading,      setLoading]      = useState(true);
  const [selected,     setSelected]     = useState(new Set());
  const [previewItem,  setPreviewItem]  = useState(null);
  const [previewJe,    setPreviewJe]    = useState(null); // fetched JE for regular Vouchers
  const [toast,        setToast]        = useState('');
  const [confirmModal, setConfirmModal] = useState(null); // { items:[], action:'approve'|'reject', remarks:'' }

  const showToast = (msg) => { setToast(msg); setTimeout(() => setToast(''), 3000); };

  // ── Load queues: routing from settings + one list call per API source ──────
  // Real-time listeners are gone with Firestore: the page loads on mount, after
  // every action, and via the Refresh button.
  const load = useCallback(async () => {
    if (!me) { setPending([]); setLoading(false); return; }
    setLoading(true);
    try {
      const settings = await getSettings();
      const routes = settings?.approvalRouting?.routes ?? [];

      // Determine which doc types this user is a verifier or approver for.
      // No maker filtering — the verifier/approver sees ALL docs of that type at
      // the right status, regardless of who created them.
      const docTypeRoles = {}; // docType → { isVerifier, isApprover }
      for (const docType of Object.keys(DOC_TYPE_CONFIG)) {
        const isVerifier = routes.some(r => r.documentType === docType && (r.verifierEmail || '').toLowerCase() === me);
        const isApprover = routes.some(r => r.documentType === docType && (r.approverEmail || '').toLowerCase() === me);
        if (isVerifier || isApprover) docTypeRoles[docType] = { isVerifier, isApprover };
      }

      const sourceNames = [...new Set(Object.keys(docTypeRoles).map(t => DOC_TYPE_CONFIG[t].source))];
      if (sourceNames.length === 0) {
        setPending([]);
        setLoading(false);
        return;
      }

      const bySource = await Promise.all(sourceNames.map(async (name) => {
        const rows = await SOURCES[name].fetch().catch(() => []);
        return rows.map(r => ({ ...SOURCES[name].map(r), _source: name }));
      }));

      const merged = [];
      const seen = new Set();
      for (const row of bySource.flat()) {
        for (const [docType, roles] of Object.entries(docTypeRoles)) {
          const cfg = DOC_TYPE_CONFIG[docType];
          if (cfg.source !== row._source) continue;
          if (!cfg.docFilter(row)) continue;
          const needsVerify  = roles.isVerifier && cfg.verifierStatus.includes(row.status);
          const needsApprove = roles.isApprover && row.status === cfg.approverStatus;
          if ((needsVerify || needsApprove) && !seen.has(`${row._source}-${row.id}`)) {
            seen.add(`${row._source}-${row.id}`);
            merged.push({ ...row, _docType: docType });
            break;
          }
        }
      }
      merged.sort((a, b) => new Date(a.createdAt || 0) - new Date(b.createdAt || 0)); // oldest first
      setPending(merged);
    } catch (e) {
      console.error('[ApprovalsPage] load failed', e);
      setPending([]);
    }
    setLoading(false);
  }, [me]);

  useEffect(() => { load(); }, [load]);

  // Fetch details when a preview opens: voucher line items (list rows don't
  // embed them) and the linked JE for regular Vouchers.
  const previewId = previewItem?.id;
  useEffect(() => {
    setPreviewJe(null);
    if (!previewItem) return;
    let cancelled = false;

    if (previewItem._docType === 'Vouchers' && previewItem.linkedJeId) {
      getJournalEntry(previewItem.linkedJeId)
        .then(({ entry, lines }) => {
          if (cancelled || !entry) return;
          setPreviewJe({
            id: entry.id,
            jeId: entry.entryNo,
            status: JSTATUS_LABEL[entry.status] || entry.status,
            lines: (lines || []).map(l => ({
              accountCode: l.accountCode || '',
              accountName: l.accountName || '',
              description: l.description || '',
              debit: (l.debitCents ?? 0) / 100,
              credit: (l.creditCents ?? 0) / 100,
            })),
          });
        })
        .catch(() => {});
    }

    if ((previewItem._docType === 'Vouchers' || previewItem._docType === 'Check Voucher') && previewItem.lines === null) {
      getVoucher(previewItem.id)
        .then(({ lines }) => {
          if (cancelled) return;
          const mapped = (lines || []).map(voucherLineFromApi);
          setPreviewItem(prev => (prev && prev.id === previewItem.id ? { ...prev, lines: mapped } : prev));
        })
        .catch(() => {});
    }

    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [previewId]);

  function toggle(id) {
    setSelected(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  }

  // NOTE: remarks typed in the confirm modal are not persisted server-side yet
  // for vouchers, journal entries, and projections (the API status routes carry
  // no remarks field — server-side remark/audit persistence lands later).
  // Disbursement reject reasons ARE persisted via setDisbursementStatus.
  async function approve(item, _remarks) {
    const cfg = DOC_TYPE_CONFIG[item._docType];
    const isVerifying = !isAdmin && cfg.verifierStatus.includes(item.status);
    if (cfg.source === 'vouchers') {
      const target = isVerifying ? 'for_approval' : 'approved';
      for (const to of chainSteps(VOUCHER_CHAIN, item.status, target)) await transitionVoucher(item.id, to);
    } else if (cfg.source === 'journal') {
      // Legacy approver action lands the entry at For Posting; the API graph
      // requires stepping through for_clearing/cleared to get there.
      const target = isVerifying ? 'pending_approval' : 'for_posting';
      for (const to of chainSteps(JOURNAL_CHAIN, item.status, target)) await transitionJournalEntry(item.id, to);
    } else if (cfg.source === 'disbursements') {
      // Server stamps reviewedBy/approvedBy in meta from the authenticated user.
      await setDisbursementStatus(item.id, isVerifying ? 'For Approval' : 'Approved');
    } else if (cfg.source === 'projections') {
      await weeklyProjectionsApi.update(item.id, { status: isVerifying ? 'Pending Approval' : 'Approved' });
    }
    showToast(isVerifying ? `${cfg.label} verified. Sent for final approval.` : `${cfg.label} approved.`);
  }

  async function reject(item, remarks) {
    const cfg = DOC_TYPE_CONFIG[item._docType];
    if (cfg.source === 'vouchers') {
      await transitionVoucher(item.id, 'rejected');
    } else if (cfg.source === 'journal') {
      await transitionJournalEntry(item.id, 'rejected');
    } else if (cfg.source === 'disbursements') {
      await setDisbursementStatus(item.id, 'Rejected', remarks || undefined);
    } else if (cfg.source === 'projections') {
      await weeklyProjectionsApi.update(item.id, { status: 'Rejected' });
    }
    showToast(`${cfg?.label || 'Document'} rejected.`);
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
      const err = results.find(r => r.status === 'rejected')?.reason;
      showToast(err instanceof ApiError ? err.detail : 'Action failed. Please try again.');
    }
    await load(); // reload the affected queues
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
        <button className="refresh-btn" onClick={load} disabled={loading}>
          ↻ {loading ? 'Refreshing…' : 'Refresh'}
        </button>
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
            <div className="info-value" style={{ fontSize:13, color:'#475569', fontWeight:700 }}>{userEmail}</div>
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
                    <tr key={`${item._source}-${item.id}`} style={{ background: isChecked ? '#f0f9ff' : undefined }}>
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

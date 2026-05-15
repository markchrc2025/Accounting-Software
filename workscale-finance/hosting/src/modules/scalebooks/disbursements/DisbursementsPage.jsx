import { useState, useEffect, useMemo } from 'react';
import {
  collection, query, orderBy, onSnapshot, addDoc, updateDoc, deleteDoc, doc,
  serverTimestamp, getDocs, where
} from 'firebase/firestore';
import { db, auth } from '../../../firebase.js';
import { nextDisbursementReportId } from '../../../utils/documentIds.js';
import { usePermissions } from '../../../contexts/PermissionsContext.jsx';

const fmt  = (n) => new Intl.NumberFormat('en-PH', { style:'currency', currency:'PHP' }).format(n || 0);
const fmtN = (n) => new Intl.NumberFormat('en-PH', { minimumFractionDigits:2, maximumFractionDigits:2 }).format(n || 0);
const uid  = () => Math.random().toString(36).slice(2, 10).toUpperCase();
const today = () => new Date().toISOString().slice(0, 10);
const fmtDate = (d) => { try { return d ? new Date(d+'T00:00:00').toLocaleDateString('en-PH',{year:'numeric',month:'long',day:'numeric'}) : '—'; } catch { return d||'—'; } };

const PAYROLL_TYPES = ['PAYROLL','FINAL_PAY'];

const DR_STATUSES = ['Draft','Pending Review','Pending Approval','Approved','Rejected','Voided'];

// ── PDF generation ────────────────────────────────────────────────────────────
function buildPdfHtml(report, bankAccounts, companyName = 'Workscale Resources Inc.') {
  const lines = report.lines || [];
  const bankBals = report.bankBalances || {};

  // Group lines by bankCode
  const groups = {};
  lines.forEach(l => {
    const k = l.bankCode || 'OTHER';
    if (!groups[k]) groups[k] = [];
    groups[k].push(l);
  });

  const groupsHtml = Object.entries(groups).map(([bankCode, bLines]) => {
    const sub = bLines.reduce((s,l)=>s+(Number(l.amount)||0),0);
    const acc = bankAccounts.find(a => a.code === bankCode);
    const bankLabel = acc ? `${acc.code} — ${acc.name}` : bankCode;
    return `
      <tr class="bank-header"><td colspan="7"><strong>${bankLabel}</strong></td></tr>
      ${bLines.map((l,i)=>`
        <tr>
          <td>${l.lineNo||i+1}</td>
          <td>${l.voucherId||'—'}</td>
          <td>${l.contact||'—'}</td>
          <td>${l.description||l.voucherType||'—'}</td>
          <td>${l.checkNo||'—'}</td>
          <td>${l.refNo||'—'}</td>
          <td class="amt">₱${fmtN(l.amount)}</td>
        </tr>`).join('')}
      <tr class="sub-row"><td colspan="6" style="text-align:right"><strong>Subtotal — ${bankLabel}</strong></td><td class="amt"><strong>₱${fmtN(sub)}</strong></td></tr>`;
  }).join('');

  const bankBalRows = bankAccounts.map(acc => {
    const bal   = Number(bankBals[acc.code]) || 0;
    const disb  = lines.filter(l=>l.bankCode===acc.code).reduce((s,l)=>s+(Number(l.amount)||0),0);
    const after = bal - disb;
    return `<tr>
      <td>${acc.code} — ${acc.name}</td>
      <td class="amt">₱${fmtN(bal)}</td>
      <td class="amt">₱${fmtN(disb)}</td>
      <td class="amt ${after<0?'neg':''}">₱${fmtN(after)}</td>
    </tr>`;
  }).join('');

  const totalBal  = Object.values(bankBals).reduce((s,v)=>s+(Number(v)||0),0);
  const totalDisb = lines.reduce((s,l)=>s+(Number(l.amount)||0),0);
  const expColl   = Number(report.expectedCollection)||0;
  const balAfter  = totalBal + expColl - totalDisb;

  // Late lines section
  const repDate = report.date ? new Date(report.date) : null;
  const lateLines = repDate ? lines.filter(l => {
    if (!l.checkDate) return false;
    const cd = new Date(l.checkDate);
    return !isNaN(cd.getTime()) && (cd.getMonth()!==repDate.getMonth() || cd.getFullYear()!==repDate.getFullYear());
  }) : [];
  const lateHtml = lateLines.length > 0 ? `
    <h3 class="section-head">FOR LATE APPROVALS</h3>
    <table class="main-tbl">
      <thead><tr><th>#</th><th>Voucher No.</th><th>Payee</th><th>Description</th><th>Check No.</th><th>Ref No.</th><th class="amt">Amount</th></tr></thead>
      <tbody>${lateLines.map((l,i)=>`<tr><td>${l.lineNo||i+1}</td><td>${l.voucherId||'—'}</td><td>${l.contact||'—'}</td><td>${l.description||l.voucherType||'—'}</td><td>${l.checkNo||'—'}</td><td>${l.refNo||'—'}</td><td class="amt">₱${fmtN(l.amount)}</td></tr>`).join('')}</tbody>
    </table>` : '';

  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>DR — ${report.reportId||report.id}</title>
  <style>
    @page { size: letter landscape; margin: 15mm 12mm; }
    * { box-sizing: border-box; }
    body { font-family: Arial, sans-serif; font-size: 10px; color: #0b1220; }
    .header { text-align: center; margin-bottom: 10px; }
    .header h1 { font-size: 14px; font-weight: 900; text-transform: uppercase; margin: 0 0 2px; }
    .header h2 { font-size: 11px; font-weight: 700; margin: 0 0 2px; }
    .header p  { font-size: 9px; color: #555; margin: 0; }
    .meta { display: flex; justify-content: space-between; margin-bottom: 8px; font-size: 9px; }
    .meta span { font-weight: 700; }
    .section-head { font-size: 10px; font-weight: 900; text-transform: uppercase; letter-spacing: .05em; border-bottom: 2px solid #333; padding-bottom: 2px; margin: 10px 0 4px; }
    .main-tbl { width: 100%; border-collapse: collapse; margin-bottom: 10px; }
    .main-tbl th { font-size: 9px; font-weight: 900; text-transform: uppercase; background: #f0f0f0; border: 1px solid #ccc; padding: 4px 6px; }
    .main-tbl td { border: 1px solid #ddd; padding: 3px 6px; font-size: 9px; }
    .main-tbl tr.bank-header td { background: #e8eef6; font-weight: 900; padding: 4px 6px; }
    .main-tbl tr.sub-row td { background: #f8f8f8; }
    .amt { text-align: right; white-space: nowrap; }
    .neg { color: #dc2626; }
    .bal-tbl { width: 100%; border-collapse: collapse; margin-bottom: 10px; }
    .bal-tbl th { font-size: 9px; font-weight: 900; background: #f0f0f0; border: 1px solid #ccc; padding: 4px 6px; text-align: left; }
    .bal-tbl td { border: 1px solid #ddd; padding: 3px 6px; font-size: 9px; }
    .summary-box { border: 1px solid #999; padding: 8px 12px; display: inline-block; min-width: 280px; float: right; margin-bottom: 10px; }
    .summary-box h4 { font-size: 10px; font-weight: 900; text-transform: uppercase; margin: 0 0 6px; border-bottom: 1px solid #999; padding-bottom: 3px; }
    .summary-row { display: flex; justify-content: space-between; font-size: 9px; margin-bottom: 2px; }
    .summary-row.total { font-weight: 900; border-top: 1px solid #999; margin-top: 4px; padding-top: 3px; font-size: 10px; }
    .sig-block { clear: both; display: flex; justify-content: space-around; margin-top: 24px; }
    .sig-col { text-align: center; min-width: 140px; }
    .sig-line { border-top: 1px solid #333; margin-bottom: 4px; }
    .sig-label { font-size: 9px; font-weight: 700; }
    .sig-name { font-size: 9px; font-weight: 900; }
    @media print { body { -webkit-print-color-adjust: exact; print-color-adjust: exact; } .no-print { display: none; } }
  </style>
  </head><body>
    <div class="no-print" style="padding:10px;background:#f5f5f5;text-align:center">
      <button onclick="window.print()" style="padding:8px 20px;font-size:13px;font-weight:700;background:#f97316;color:#fff;border:0;border-radius:8px;cursor:pointer">🖨 Print / Save as PDF</button>
    </div>
    <div class="header">
      <h2>${companyName}</h2>
      <h1>Master Disbursement Report</h1>
      <p>${fmtDate(report.date)} &nbsp;|&nbsp; Report No.: ${report.reportId||report.id} &nbsp;|&nbsp; Status: ${report.status||'Draft'}</p>
    </div>
    <div class="meta">
      <div>Prepared by: <span>${report.createdBy||'—'}</span></div>
      <div>Reviewed by: <span>${report.reviewedBy||'—'}</span></div>
      <div>Approved by: <span>${report.approvedBy||'—'}</span></div>
    </div>
    <h3 class="section-head">Disbursements</h3>
    <table class="main-tbl">
      <thead><tr><th>#</th><th>Voucher No.</th><th>Payee</th><th>Description</th><th>Check No.</th><th>Ref No.</th><th class="amt">Amount</th></tr></thead>
      <tbody>${groupsHtml}</tbody>
      <tfoot><tr style="background:#e8eef6"><td colspan="6" style="text-align:right;font-weight:900;font-size:10px">GRAND TOTAL</td><td class="amt" style="font-weight:900;font-size:10px">₱${fmtN(totalDisb)}</td></tr></tfoot>
    </table>
    ${lateHtml}
    <h3 class="section-head">Bank Account Balances</h3>
    <table class="bal-tbl">
      <thead><tr><th>Account</th><th class="amt">Current Balance</th><th class="amt">Less: Disbursements</th><th class="amt">Balance After</th></tr></thead>
      <tbody>${bankBalRows}</tbody>
    </table>
    <div class="summary-box">
      <h4>Summary</h4>
      <div class="summary-row"><span>Total Bank Balance (Before)</span><span>₱${fmtN(totalBal)}</span></div>
      <div class="summary-row"><span>Less: Total Disbursements</span><span>(₱${fmtN(totalDisb)})</span></div>
      <div class="summary-row"><span>Add: Expected Collection</span><span>₱${fmtN(expColl)}</span></div>
      <div class="summary-row total"><span>Bank Balance After</span><span class="${balAfter<0?'neg':''}">₱${fmtN(balAfter)}</span></div>
    </div>
    ${report.notes ? `<div style="clear:both;font-size:9px;color:#555;margin-top:6px"><strong>Notes:</strong> ${report.notes}</div>` : '<div style="clear:both"></div>'}
    <div class="sig-block">
      <div class="sig-col"><div class="sig-line" style="margin-top:28px"></div><div class="sig-name">${report.createdBy||'&nbsp;'}</div><div class="sig-label">Prepared By</div></div>
      <div class="sig-col"><div class="sig-line" style="margin-top:28px"></div><div class="sig-name">${report.reviewedBy||'&nbsp;'}</div><div class="sig-label">Reviewed By</div></div>
      <div class="sig-col"><div class="sig-line" style="margin-top:28px"></div><div class="sig-name">${report.approvedBy||'&nbsp;'}</div><div class="sig-label">Approved By</div></div>
      <div class="sig-col"><div class="sig-line" style="margin-top:28px"></div><div class="sig-label">Noted By</div></div>
    </div>
  </body></html>`;
}

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
  .modal    { width:min(1100px,98vw); max-height:94vh; background:#fff; border-radius:16px; display:flex; flex-direction:column; overflow:hidden; box-shadow:0 24px 64px rgba(0,0,0,.25); }
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
  .section-title { font-size:11px; font-weight:800; color:#94a3b8; letter-spacing:.07em; text-transform:uppercase; margin:16px 0 8px; border-bottom:1px solid #f1f5f9; padding-bottom:6px; display:flex; align-items:center; justify-content:space-between; }
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
  @keyframes fadeIn { from{opacity:0;transform:translateY(8px)} to{opacity:1;transform:none} }
  .expand-row td { background:#f8fafc; padding:16px 20px; }
  .elig-check { display:flex; align-items:flex-start; gap:10px; padding:10px 14px; border-bottom:1px solid #f1f5f9; }
  .elig-check:last-child { border-bottom:none; }
  .elig-late  { background:#fffbeb; border-left:3px solid #f59e0b; }
  .bank-cards { display:flex; flex-wrap:wrap; gap:10px; margin-bottom:4px; }
  .bank-card  { background:#f8fafc; border:1px solid #e5e7eb; border-radius:10px; padding:10px 14px; min-width:160px; }
  .bank-card-code { font-size:9px; font-weight:800; color:#94a3b8; letter-spacing:.06em; text-transform:uppercase; }
  .bank-card-name { font-size:12px; font-weight:800; color:#0b1220; margin-bottom:6px; }
  .bank-card-lbl  { font-size:9px; color:#94a3b8; font-weight:700; text-transform:uppercase; letter-spacing:.04em; }
  .bank-card-val  { font-size:13px; font-weight:900; color:#1d4ed8; }
  .bank-card input { width:100%; border:1px solid #bfdbfe; border-radius:8px; padding:5px 8px; font-size:12px; font-weight:700; color:#1d4ed8; background:#eff6ff; font-family:inherit; box-sizing:border-box; }
  .summary-bar { display:flex; flex-wrap:wrap; gap:12px; background:#f0fdf4; border:1px solid #6ee7b7; border-radius:12px; padding:12px 16px; margin-bottom:12px; align-items:center; }
  .summary-item { display:flex; flex-direction:column; }
  .summary-item-lbl { font-size:9px; font-weight:800; color:#94a3b8; text-transform:uppercase; letter-spacing:.06em; }
  .summary-item-val { font-size:14px; font-weight:900; color:#065f46; }
  .summary-item-val.neg { color:#dc2626; }
  .late-badge { display:inline-block; padding:2px 7px; border-radius:999px; font-size:10px; font-weight:800; background:#fef3c7; color:#92400e; border:1px solid #fde68a; margin-left:8px; }
`;

function StatusPill({ status }) {
  const s = STATUS_STYLES[status] || STATUS_STYLES['Draft'];
  return <span className="pill" style={s}>{status || 'Draft'}</span>;
}

export default function DisbursementsPage() {
  const { globalRoles, isAdmin } = usePermissions();
  const canReviewOrApprove = isAdmin || globalRoles.some(r => ['Verifier','Approver'].includes(r));

  const [reports,      setReports]      = useState([]);
  const [vouchers,     setVouchers]     = useState([]);
  const [bankAccounts, setBankAccounts] = useState([]); // COA accounts with subType='Bank'
  const [dailyBals,    setDailyBals]    = useState([]); // dailyBankBalances entries

  // Filters
  const [search,       setSearch]       = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [dateFrom,     setDateFrom]     = useState('');
  const [dateTo,       setDateTo]       = useState('');

  // Bulk
  const [selected, setSelected] = useState(new Set());

  // Expand
  const [expandId, setExpandId] = useState(null);

  // Modals
  const [showModal,    setShowModal]    = useState(false);
  const [editing,      setEditing]      = useState(null);
  const [statusModal,  setStatusModal]  = useState(null);
  const [viewModal,    setViewModal]    = useState(null);
  const [confirmModal, setConfirmModal] = useState(null);

  // Form
  const [form,    setForm]    = useState({ date:today(), expectedCollection:0, notes:'' });
  const [drLines, setDrLines] = useState([]); // lines picked from eligible items
  // bankBals is derived live from dailyBals — no manual state needed
  const [saving,  setSaving]  = useState(false);
  const [toast,   setToast]   = useState('');

  const showToast  = (msg) => { setToast(msg); setTimeout(() => setToast(''), 3500); };
  const askConfirm = (message, onConfirm) => setConfirmModal({ message, onConfirm });
  const user = auth.currentUser?.email || '';

  // ── Data loading ──────────────────────────────────────────────────────────────
  useEffect(() => {
    // Live reports
    const unsub = onSnapshot(
      query(collection(db,'disbursementReports'), orderBy('createdAt','desc')),
      snap => setReports(snap.docs.map(d => ({ id:d.id, ...d.data() })))
    );
    // COA bank accounts (one-time)
    getDocs(query(collection(db,'accounts'), where('subType','==','Bank')))
      .then(s => setBankAccounts(s.docs.map(d=>({id:d.id,...d.data()})).sort((a,b)=>(a.code||'').localeCompare(b.code||''))));
    // Daily bank balances — live from Bank Management
    const unsubBals = onSnapshot(
      query(collection(db,'dailyBankBalances'), orderBy('date','desc')),
      snap => setDailyBals(snap.docs.map(d=>({id:d.id,...d.data()})))
    );
    return () => { unsub(); unsubBals(); };
  }, []);

  // Refresh vouchers when the create/edit modal is opened (dailyBals is already live)
  const refreshModalData = () => {
    getDocs(query(collection(db,'vouchers'), where('status','in',['Pending','Pending Review','Pending Approval','Approved','For Disbursement'])))
      .then(s => setVouchers(s.docs.map(d => ({ id:d.id, ...d.data() }))));
  };

  // ── Helpers ───────────────────────────────────────────────────────────────────

  // Get the latest daily bank balance (endBal = `ending`) for a given account code on or before a date
  const getLatestBal = (accountCode, beforeDate) => {
    const entries = dailyBals
      .filter(b => b.bankCode === accountCode && (!beforeDate || b.date <= beforeDate))
      .sort((a,b) => b.date.localeCompare(a.date));
    return entries.length > 0 ? (Number(entries[0].ending) || 0) : 0;
  };

  // Build initial bankBals for a given report date from dailyBals
  const buildInitialBankBals = (date) => {
    const result = {};
    bankAccounts.forEach(acc => { result[acc.code] = getLatestBal(acc.code, date || today()); });
    return result;
  };

  // ── Eligible vouchers (memo) ──────────────────────────────────────────────────
  // Splits vouchers into { eligible, late } for the create/edit modal
  // Also computes the set of _eligKeys already in drLines (for pre-check when editing)
  const { eligible, late } = useMemo(() => {
    if (!form.date) return { eligible: [], late: [] };
    const repDate = new Date(form.date + 'T00:00:00');
    const repMonth = repDate.getMonth();
    const repYear  = repDate.getFullYear();
    const editingId = editing ? (editing.reportId || editing.id) : null;

    const eligible = [];
    const late     = [];

    vouchers.forEach(v => {
      const status = v.status || '';
      if (['Paid','Voided','Rejected'].includes(status)) return;
      // Skip vouchers already in ANOTHER report
      if (status === 'For Disbursement' && v.disbursementRef && v.disbursementRef !== editingId) return;

      const isPayroll = PAYROLL_TYPES.includes(v.voucherType);

      if (isPayroll && Array.isArray(v.lines) && v.lines.length > 0) {
        // PAYROLL / FINAL_PAY — expand per line
        v.lines.forEach(l => {
          const lineCheckDate = l.lineCheckDate || v.checkDate || '';
          const item = {
            key:          `${v.voucherId||v.id}::${l.lineNo}`,
            voucherId:    v.voucherId || v.id,
            voucherDocId: v.id,
            lineNo:       l.lineNo,
            voucherType:  v.voucherType,
            contact:      l.contact || v.contactSummary || '',
            description:  l.description || '',
            amount:       Number(l.amount) || 0,
            bankCode:     l.lineBankCode || v.paymentFromAccountCode || '',
            checkNo:      l.lineCheckNumber || v.checkNumber || '',
            checkDate:    lineCheckDate,
            isPayrollLine:true,
            _preDisbStatus: v.preDisbursementStatus || v.status,
          };
          if (lineCheckDate) {
            try {
              const cd = new Date(lineCheckDate + 'T00:00:00');
              if (!isNaN(cd.getTime()) && (cd.getMonth() !== repMonth || cd.getFullYear() !== repYear)) {
                late.push(item); return;
              }
            } catch { /* no-op */ }
          }
          eligible.push(item);
        });
      } else {
        // Regular voucher (PAYMENT, LOAN, CHECK)
        const item = {
          key:          `${v.voucherId||v.id}::`,
          voucherId:    v.voucherId || v.id,
          voucherDocId: v.id,
          lineNo:       null,
          voucherType:  v.voucherType || '',
          contact:      v.contactSummary || '',
          description:  v.purposeCategory || '',
          amount:       Number(v.totalAmount) || 0,
          bankCode:     v.paymentFromAccountCode || '',
          checkNo:      v.checkNumber || '',
          checkDate:    v.checkDate || '',
          isPayrollLine:false,
          _preDisbStatus: v.preDisbursementStatus || v.status,
        };
        if (item.checkDate) {
          try {
            const cd = new Date(item.checkDate + 'T00:00:00');
            if (!isNaN(cd.getTime()) && (cd.getMonth() !== repMonth || cd.getFullYear() !== repYear)) {
              late.push(item); return;
            }
          } catch { /* no-op */ }
        }
        eligible.push(item);
      }
    });

    return { eligible, late };
  }, [vouchers, form.date, editing]);

  // ── Computed totals ───────────────────────────────────────────────────────────
  const lineTotal      = drLines.reduce((s,l) => s + (Number(l.amount)||0), 0);
  const totalBankBals  = bankAccounts.reduce((s,acc) => s + getLatestBal(acc.code, form.date), 0);
  const balanceAfter   = totalBankBals + (Number(form.expectedCollection)||0) - lineTotal;

  // ── Toggle voucher/line selection ─────────────────────────────────────────────
  const toggleItem = (item) => {
    setDrLines(prev => {
      const exists = prev.find(l => l._eligKey === item.key);
      if (exists) return prev.filter(l => l._eligKey !== item.key);
      return [...prev, {
        _key:          uid(),
        _eligKey:      item.key,
        voucherId:     item.voucherId,
        voucherDocId:  item.voucherDocId,
        lineNo:        item.lineNo,
        voucherType:   item.voucherType,
        contact:       item.contact,
        description:   item.description,
        amount:        item.amount,
        bankCode:      item.bankCode,
        checkNo:       item.checkNo,
        refNo:         '',
        isPayrollLine: item.isPayrollLine || false,
        _preDisbStatus:item._preDisbStatus || 'Approved',
      }];
    });
  };

  const setLineField = (key, field, val) =>
    setDrLines(prev => prev.map(l => l._key === key ? { ...l, [field]: val } : l));

  // ── Filtered & KPI ───────────────────────────────────────────────────────────
  const filtered = useMemo(() => {
    let r = [...reports];
    const q = search.toLowerCase();
    if (q) r = r.filter(x => (x.reportId||x.id||'').toLowerCase().includes(q) || (x.createdBy||'').toLowerCase().includes(q));
    if (filterStatus) r = r.filter(x => (x.status||'Draft') === filterStatus);
    if (dateFrom) r = r.filter(x => (x.date||'') >= dateFrom);
    if (dateTo)   r = r.filter(x => (x.date||'') <= dateTo);
    return r;
  }, [reports, search, filterStatus, dateFrom, dateTo]);

  const kpis = useMemo(() => ({
    total:    reports.length,
    draft:    reports.filter(r => r.status === 'Draft').length,
    pending:  reports.filter(r => ['Pending Review','Pending Approval'].includes(r.status)).length,
    approved: reports.filter(r => r.status === 'Approved').length,
    totalAmt: reports.filter(r => !['Voided','Rejected'].includes(r.status)).reduce((s,r) => s+(Number(r.totalAmount)||0), 0),
  }), [reports]);

  // ── Bulk operations ───────────────────────────────────────────────────────────
  const toggleSel = (id) => setSelected(prev => { const n=new Set(prev); n.has(id)?n.delete(id):n.add(id); return n; });
  const toggleAll = () => {
    if (selected.size === filtered.length) setSelected(new Set());
    else setSelected(new Set(filtered.map(r=>r.id)));
  };
  const bulkSubmit = () => {
    if (!selected.size) return;
    askConfirm(`Submit ${selected.size} report(s) for approval?`, async () => {
      await Promise.all([...selected].map(id => updateDoc(doc(db,'disbursementReports',id), { status:'Pending Review', updatedAt:serverTimestamp(), updatedBy:user })));
      setSelected(new Set()); showToast('Submitted for review.');
    });
  };
  const bulkDelete = () => {
    if (!selected.size) return;
    askConfirm(`Delete ${selected.size} report(s)?`, async () => {
      await Promise.all([...selected].map(id => deleteDoc(doc(db,'disbursementReports',id))));
      setSelected(new Set()); showToast('Deleted.');
    });
  };

  // ── Open Create modal ─────────────────────────────────────────────────────────
  const openNew = () => {
    refreshModalData();
    setEditing(null);
    const date = today();
    setForm({ date, expectedCollection:0, notes:'' });
    setDrLines([]);
    setShowModal(true);
  };

  // ── Open Edit modal ───────────────────────────────────────────────────────────
  const openEdit = (r) => {
    refreshModalData();
    setEditing(r);
    setForm({ date:r.date||today(), expectedCollection:r.expectedCollection||0, notes:r.notes||'' });
    // Pre-populate drLines from saved report lines
    setDrLines((r.lines||[]).map(l => ({
      ...l,
      _key:     uid(),
      _eligKey: `${l.voucherId}::${l.lineNo != null ? l.lineNo : ''}`,
      _preDisbStatus: 'Approved', // will be resolved via voucher lookup on save
    })));
    setShowModal(true);
  };

  // ── Save report ───────────────────────────────────────────────────────────────
  const saveReport = async (status) => {
    if (drLines.length === 0) { showToast('Add at least one voucher line.'); return; }
    setSaving(true);
    try {
      const reportLines = drLines.map((l,i) => ({
        lineNo:        i+1,
        voucherId:     l.voucherId,
        voucherDocId:  l.voucherDocId || '',
        srcLineNo:     l.lineNo ?? null,
        voucherType:   l.voucherType || '',
        contact:       l.contact || '',
        description:   l.description || '',
        amount:        Number(l.amount)||0,
        bankCode:      l.bankCode||'',
        checkNo:       l.checkNo||'',
        refNo:         l.refNo||'',
        isPayrollLine: l.isPayrollLine||false,
        status:        'In Disbursement',
      }));

      const payload = {
        date:               form.date,
        bankCode:           'MULTIPLE',
        totalAmount:        lineTotal,
        expectedCollection: Number(form.expectedCollection)||0,
        notes:              form.notes||'',
        bankBalances:       buildInitialBankBals(form.date),
        status:             status || 'Draft',
        lines:              reportLines,
        updatedAt:          serverTimestamp(),
        updatedBy:          user,
      };

      if (editing) {
        await updateDoc(doc(db,'disbursementReports',editing.id), payload);

        // Diff vouchers: newly added vs removed
        const prevIds = new Set((editing.lines||[]).map(l=>l.voucherId));
        const newIds  = new Set(drLines.map(l=>l.voucherId));

        // Newly added vouchers → mark For Disbursement + save preDisbursementStatus
        const addedVids = [...newIds].filter(vid => !prevIds.has(vid));
        await Promise.all(addedVids.map(vid => {
          const v = vouchers.find(v2 => (v2.voucherId||v2.id) === vid);
          if (!v || v.status === 'For Disbursement') return null;
          return updateDoc(doc(db,'vouchers',v.id), {
            status: 'For Disbursement', preDisbursementStatus: v.status,
            disbursementRef: editing.reportId||editing.id,
            updatedAt: serverTimestamp(), updatedBy: user,
          });
        }).filter(Boolean));

        // Removed vouchers → revert to preDisbursementStatus
        const removedVids = [...prevIds].filter(vid => !newIds.has(vid));
        await Promise.all(removedVids.map(vid => {
          const v = vouchers.find(v2 => (v2.voucherId||v2.id) === vid);
          if (!v) return null;
          return updateDoc(doc(db,'vouchers',v.id), {
            status: v.preDisbursementStatus || 'Approved',
            preDisbursementStatus: '', disbursementRef: '',
            updatedAt: serverTimestamp(), updatedBy: user,
          });
        }).filter(Boolean));

        showToast('Report updated.');
      } else {
        const reportId = await nextDisbursementReportId(form.date);
        await addDoc(collection(db,'disbursementReports'), {
          ...payload, reportId, createdAt:serverTimestamp(), createdBy:user
        });
        // Mark each unique voucher as For Disbursement (save preDisbursementStatus)
        const uniqueVids = [...new Set(drLines.map(l=>l.voucherId))];
        await Promise.all(uniqueVids.map(vid => {
          const v = vouchers.find(v2 => (v2.voucherId||v2.id) === vid);
          if (!v) return null;
          return updateDoc(doc(db,'vouchers',v.id), {
            status: 'For Disbursement', preDisbursementStatus: v.status,
            disbursementRef: reportId,
            updatedAt: serverTimestamp(), updatedBy: user,
          });
        }).filter(Boolean));
        showToast('Report created.');
      }
      setShowModal(false);
    } catch(e) { showToast('Error: ' + e.message); }
    setSaving(false);
  };

  // ── Status update ─────────────────────────────────────────────────────────────
  const doStatusUpdate = async () => {
    if (!statusModal) return;
    const { report, newStatus, reason } = statusModal;
    setSaving(true);
    try {
      const updateFields = {
        status: newStatus,
        ...(reason ? { rejectReason: reason } : {}),
        ...(newStatus === 'Pending Review'   ? { reviewedBy: user }  : {}),
        ...(newStatus === 'Pending Approval' ? { reviewedBy: user }  : {}),
        ...(newStatus === 'Approved'         ? { approvedBy: user }  : {}),
        updatedAt: serverTimestamp(), updatedBy: user,
      };
      await updateDoc(doc(db,'disbursementReports',report.id), updateFields);

      if (newStatus === 'Approved') {
        // Mark all vouchers as Paid + auto-post loan payments
        const lines = report.lines || [];
        const uniqueVids = [...new Set(lines.map(l=>l.voucherId))];
        await Promise.all(uniqueVids.map(async vid => {
          const v = vouchers.find(v2 => (v2.voucherId||v2.id) === vid);
          if (!v) return;
          await updateDoc(doc(db,'vouchers',v.id), {
            status:'Paid', preDisbursementStatus:'', disbursementRef:'',
            updatedAt:serverTimestamp(), updatedBy:user
          });
          if (v.loanId && !v.loanPaymentId) {
            const vLines = Array.isArray(v.lines) ? v.lines : [];
            const interestAmt  = vLines.filter(x=>(x.category||'').toLowerCase()==='finance cost').reduce((s,x)=>s+(Number(x.amount)||0),0);
            const principalAmt = vLines.filter(x=>(x.category||'').toLowerCase()==='loans payable').reduce((s,x)=>s+(Number(x.amount)||0),0);
            const total        = Number(v.totalAmount) || (interestAmt+principalAmt);
            const penaltyAmt   = Math.max(0, total - interestAmt - principalAmt);
            const line         = lines.find(l=>l.voucherId===vid)||{};
            try {
              const payRef = await addDoc(collection(db,'loanPayments'), {
                loanId:v.loanId, loanName:v.contactSummary||'', date:report.date||v.preparationDate||today(),
                interest:interestAmt, principal:principalAmt, penalty:penaltyAmt, total,
                method:'Voucher', referenceNo:line.checkNo||line.refNo||'',
                bank:line.bankCode||v.paymentFromAccountCode||'',
                voucherId:v.voucherId||v.id, disbursementReportId:report.reportId||report.id,
                allocations:[], notes:`Auto-posted from DR ${report.reportId||report.id}`,
                source:'disbursement-auto', createdAt:serverTimestamp(), createdBy:user,
              });
              await updateDoc(doc(db,'vouchers',v.id), { loanPaymentId: payRef.id });
            } catch(err) { console.error('Auto-post failed for', v.id, err); }
          }
        }));
      }

      if (newStatus === 'Rejected') {
        // Revert all vouchers to preDisbursementStatus
        const lines = report.lines || [];
        const uniqueVids = [...new Set(lines.map(l=>l.voucherId))];
        await Promise.all(uniqueVids.map(vid => {
          const v = vouchers.find(v2 => (v2.voucherId||v2.id) === vid);
          if (!v) return null;
          return updateDoc(doc(db,'vouchers',v.id), {
            status: v.preDisbursementStatus || 'Approved',
            preDisbursementStatus: '', disbursementRef: '',
            updatedAt: serverTimestamp(), updatedBy: user,
          });
        }).filter(Boolean));
      }

      showToast(`Status updated to ${newStatus}.`);
      setStatusModal(null);
    } catch(e) { showToast('Error: ' + e.message); }
    setSaving(false);
  };

  // ── Delete report (reverts voucher statuses) ──────────────────────────────────
  const deleteReport = (r) => {
    askConfirm(`Delete report ${r.reportId||r.id}? Vouchers will be reverted.`, async () => {
      const lines = r.lines || [];
      const uniqueVids = [...new Set(lines.map(l=>l.voucherId))];
      await Promise.all(uniqueVids.map(vid => {
        const v = vouchers.find(v2 => (v2.voucherId||v2.id) === vid);
        if (!v) return null;
        return updateDoc(doc(db,'vouchers',v.id), {
          status: v.preDisbursementStatus || 'Approved',
          preDisbursementStatus: '', disbursementRef: '',
          updatedAt:serverTimestamp(), updatedBy:user,
        });
      }).filter(Boolean));
      await deleteDoc(doc(db,'disbursementReports',r.id));
      showToast('Report deleted. Vouchers reverted.');
    });
  };

  // ── Remove a line from an existing report (in View modal) ────────────────────
  const removeLine = (lineIndex) => {
    const report = viewModal;
    if (!report) return;
    const line = (report.lines||[])[lineIndex];
    if (!line) return;
    askConfirm(`Remove ${line.voucherId} from this report? The voucher will be reverted.`, async () => {
      const newLines = (report.lines||[])
        .filter((_,i) => i !== lineIndex)
        .map((l,i) => ({ ...l, lineNo: i+1 }));
      const newTotal = newLines.reduce((s,l) => s+(Number(l.amount)||0), 0);
      await updateDoc(doc(db,'disbursementReports',report.id), {
        lines: newLines, totalAmount: newTotal,
        updatedAt:serverTimestamp(), updatedBy:user,
      });
      // Check if this voucher still has lines in the report
      const stillHasLines = newLines.some(l => l.voucherId === line.voucherId);
      if (!stillHasLines) {
        const v = vouchers.find(v2 => (v2.voucherId||v2.id) === line.voucherId);
        if (v) {
          await updateDoc(doc(db,'vouchers',v.id), {
            status: v.preDisbursementStatus || 'Approved',
            preDisbursementStatus: '', disbursementRef: '',
            updatedAt:serverTimestamp(), updatedBy:user,
          });
        }
      }
      setViewModal(prev => prev ? { ...prev, lines:newLines, totalAmount:newTotal } : null);
      showToast('Line removed and voucher reverted.');
    });
  };

  // ── PDF export ────────────────────────────────────────────────────────────────
  const openPdf = (r) => {
    const html = buildPdfHtml(r, bankAccounts);
    const win = window.open('', '_blank');
    if (!win) { showToast('Pop-up blocked. Please allow pop-ups for this site.'); return; }
    win.document.write(html);
    win.document.close();
    win.focus();
    setTimeout(() => win.print(), 800);
  };

  // ── Status helpers ────────────────────────────────────────────────────────────
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
        {/* ── Primary KPI Scorecards ─────────────────────────────────────── */}
        <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(200px,1fr))',gap:14,marginBottom:12}}>
          <div style={{background:'linear-gradient(135deg,#1e40af 0%,#2563eb 100%)',borderRadius:14,padding:'18px 20px',color:'#fff',position:'relative',overflow:'hidden'}}>
            <div style={{position:'absolute',right:-8,top:-8,opacity:.13}}>
              <svg width="56" height="56" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"><path d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"/></svg>
            </div>
            <div style={{fontSize:10,fontWeight:800,letterSpacing:'.08em',textTransform:'uppercase',opacity:.8,marginBottom:6}}>Total Amount</div>
            <div style={{fontSize:22,fontWeight:900,letterSpacing:'-.5px'}}>{fmt(kpis.totalAmt)}</div>
            <div style={{marginTop:10,fontSize:11,opacity:.8}}>Across {kpis.total} report{kpis.total!==1?'s':''}</div>
          </div>
          <div style={{background:'linear-gradient(135deg,#166534 0%,#16a34a 100%)',borderRadius:14,padding:'18px 20px',color:'#fff',position:'relative',overflow:'hidden'}}>
            <div style={{position:'absolute',right:-8,top:-8,opacity:.13}}>
              <svg width="56" height="56" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"><path d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z"/></svg>
            </div>
            <div style={{fontSize:10,fontWeight:800,letterSpacing:'.08em',textTransform:'uppercase',opacity:.8,marginBottom:6}}>Approved</div>
            <div style={{fontSize:22,fontWeight:900,letterSpacing:'-.5px'}}>{kpis.approved}</div>
            <div style={{marginTop:10,fontSize:11,opacity:.8}}>Ready for release</div>
          </div>
          <div style={{background:'linear-gradient(135deg,#b45309 0%,#d97706 100%)',borderRadius:14,padding:'18px 20px',color:'#fff',position:'relative',overflow:'hidden'}}>
            <div style={{position:'absolute',right:-8,top:-8,opacity:.13}}>
              <svg width="56" height="56" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 8v4l3 3"/></svg>
            </div>
            <div style={{fontSize:10,fontWeight:800,letterSpacing:'.08em',textTransform:'uppercase',opacity:.8,marginBottom:6}}>Pending</div>
            <div style={{fontSize:22,fontWeight:900,letterSpacing:'-.5px'}}>{kpis.pending}</div>
            <div style={{marginTop:10,fontSize:11,opacity:.8}}>Under review</div>
          </div>
        </div>
        {/* ── Secondary KPI Row ─────────────────────────────────────────── */}
        <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(140px,1fr))',gap:10,marginBottom:16}}>
          {[
            {label:'Total Reports',value:kpis.total,sub:'all disbursement reports',color:'#1d4ed8',bg:'#eff6ff',border:'#bfdbfe',icon:<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><path d="M14 2v6h6M16 13H8M16 17H8M10 9H8"/></svg>},
            {label:'Draft',value:kpis.draft,sub:'not yet submitted',color:'#64748b',bg:'#f8fafc',border:'#e2e8f0',icon:<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>},
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
                        {(r.status==='Draft'||r.status==='Rejected') && (
                          <button className="btn btn-ghost btn-xs" style={{color:'#1d4ed8',border:'1px solid #bfdbfe'}} onClick={()=>setStatusModal({report:r,newStatus:'Pending Review',reason:null})}>Submit</button>
                        )}
                        {nextStatuses(r.status||'Draft').length > 0 && (
                          <select className="input" style={{padding:'3px 6px',fontSize:11,borderRadius:8,cursor:'pointer'}}
                            defaultValue=""
                            onChange={e=>{ if(e.target.value){ const ns=e.target.value; e.target.value=''; if(ns==='Rejected') setStatusModal({report:r,newStatus:ns,reason:''}); else setStatusModal({report:r,newStatus:ns,reason:null}); } }}>
                            <option value="" disabled>Update…</option>
                            {nextStatuses(r.status||'Draft').map(s=><option key={s} value={s}>{s}</option>)}
                          </select>
                        )}
                        {(r.status||'Draft')==='Draft' && <button className="btn btn-ghost btn-xs" style={{color:'#dc2626'}} onClick={()=>deleteReport(r)}>🗑</button>}
                        <button className="btn btn-ghost btn-xs" title="Print PDF" onClick={()=>openPdf(r)}>🖨</button>
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

              {/* ── Header fields ── */}
              <div className="grid4">
                <div className="field">
                  <label>Date</label>
                  <input type="date" value={form.date||''} onChange={e=>setForm(f=>({...f,date:e.target.value}))} />
                </div>
                <div className="field">
                  <label>Expected Collection (₱)</label>
                  <input type="number" value={form.expectedCollection||0} onChange={e=>setForm(f=>({...f,expectedCollection:e.target.value}))} />
                </div>
                <div className="field col2">
                  <label>Notes</label>
                  <input value={form.notes||''} onChange={e=>setForm(f=>({...f,notes:e.target.value}))} placeholder="Optional notes…" />
                </div>
              </div>

              {/* ── Bank Account Balances Table ── */}
              {bankAccounts.length > 0 && (<>
                <div className="section-title">
                  <span>Bank Account Balances</span>
                  <span style={{fontSize:10,fontWeight:600,color:'#94a3b8'}}>Live Book Balance from Bank Management</span>
                </div>
                <table className="lines-tbl" style={{fontSize:13,marginBottom:10,tableLayout:'fixed'}}>
                  <colgroup>
                    <col style={{width:'60px'}} />
                    <col />
                    <col style={{width:'220px'}} />
                  </colgroup>
                  <thead>
                    <tr>
                      <th>Code</th>
                      <th>Bank Account</th>
                      <th style={{textAlign:'right'}}>Book Balance (₱)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {bankAccounts.map(acc => (
                      <tr key={acc.code}>
                        <td style={{fontWeight:800,color:'#94a3b8',fontSize:11}}>{acc.code}</td>
                        <td style={{fontWeight:700,color:'#0b1220'}}>{acc.name}</td>
                        <td style={{textAlign:'right',fontWeight:700,color:'#1d4ed8',fontSize:13}}>
                          {fmt(getLatestBal(acc.code, form.date))}
                        </td>
                      </tr>
                    ))}
                    <tr style={{background:'#f8fafc',borderTop:'2px solid #e5e7eb'}}>
                      <td colSpan={2} style={{textAlign:'right',fontWeight:800,color:'#64748b',fontSize:12,letterSpacing:'.04em',textTransform:'uppercase'}}>Total Bank Balances</td>
                      <td style={{textAlign:'right',fontWeight:900,color:'#1d4ed8',fontSize:14}}>{fmt(totalBankBals)}</td>
                    </tr>
                  </tbody>
                </table>
              </>)}

              {/* ── Live Summary Bar ── */}
              <div className="summary-bar">
                <div className="summary-item">
                  <span className="summary-item-lbl">Total Bank Balances</span>
                  <span className="summary-item-val">{fmt(totalBankBals)}</span>
                </div>
                <span style={{color:'#94a3b8',fontWeight:700,fontSize:16}}>+</span>
                <div className="summary-item">
                  <span className="summary-item-lbl">Expected Collection</span>
                  <span className="summary-item-val">{fmt(Number(form.expectedCollection)||0)}</span>
                </div>
                <span style={{color:'#94a3b8',fontWeight:700,fontSize:16}}>−</span>
                <div className="summary-item">
                  <span className="summary-item-lbl">Total Disbursements</span>
                  <span className="summary-item-val" style={{color:'#dc2626'}}>{fmt(lineTotal)}</span>
                </div>
                <span style={{color:'#94a3b8',fontWeight:700,fontSize:16}}>=</span>
                <div className="summary-item">
                  <span className="summary-item-lbl">Balance After</span>
                  <span className={`summary-item-val ${balanceAfter<0?'neg':''}`} style={{fontSize:18}}>{fmt(balanceAfter)}</span>
                </div>
              </div>

              {/* ── Eligible Vouchers (same month) ── */}
              <div className="section-title">
                <span>Eligible Vouchers — Same Month ({eligible.length})</span>
                <span style={{fontSize:10,fontWeight:600,color:'#94a3b8'}}>Pending, Approved &amp; For Disbursement</span>
                {eligible.length > 0 && (
                  <button className="btn btn-ghost btn-xs" onClick={()=>{
                    const unchecked = eligible.filter(it => !drLines.some(l=>l._eligKey===it.key));
                    if (unchecked.length > 0) unchecked.forEach(toggleItem);
                    else eligible.forEach(it => setDrLines(prev=>prev.filter(l=>l._eligKey!==it.key)));
                  }}>
                    {eligible.every(it=>drLines.some(l=>l._eligKey===it.key)) ? 'Deselect All' : 'Select All'}
                  </button>
                )}
              </div>
              {eligible.length === 0
                ? <div style={{padding:'12px 0',fontSize:13,color:'#94a3b8'}}>
                    {form.date ? `No eligible vouchers for ${form.date.slice(0,7)}.` : 'Set a report date to see eligible vouchers.'}
                  </div>
                : (
                  <div style={{border:'1px solid #e5e7eb',borderRadius:12,overflow:'hidden',marginBottom:12}}>
                    {eligible.map(item => {
                      const checked = drLines.some(l=>l._eligKey===item.key);
                      return (
                        <div key={item.key} className="elig-check" style={{background:checked?'#fff7ed':'#fff',cursor:'pointer'}} onClick={()=>toggleItem(item)}>
                          <input type="checkbox" checked={checked} readOnly style={{width:16,height:16,accentColor:'#f97316',flexShrink:0}} />
                          <div style={{flex:1,fontSize:12}}>
                            <strong style={{color:'#f97316'}}>{item.voucherId}</strong>
                            {item.isPayrollLine && <span style={{marginLeft:6,fontSize:10,background:'#eff6ff',color:'#1d4ed8',padding:'1px 5px',borderRadius:4,fontWeight:700}}>LINE {item.lineNo}</span>}
                            <span style={{marginLeft:8,color:'#64748b',fontSize:11}}>{item.voucherType}</span>
                            <span style={{marginLeft:8,color:'#0b1220'}}>{item.contact}</span>
                            {item.description && <span style={{marginLeft:8,color:'#94a3b8',fontSize:11}}>{item.description}</span>}
                          </div>
                          <span style={{fontSize:11,color:'#64748b',marginRight:8}}>{item.bankCode||'—'}</span>
                          {item.checkDate && <span style={{fontSize:11,color:'#94a3b8',marginRight:8}}>{item.checkDate}</span>}
                          <span style={{fontWeight:700,minWidth:100,textAlign:'right',fontSize:13}}>{fmt(item.amount)}</span>
                        </div>
                      );
                    })}
                  </div>
                )
              }

              {/* ── Late Vouchers (different month) ── */}
              {late.length > 0 && (<>
                <div className="section-title">
                  <span>Late Approvals — Different Month <span className="late-badge">{late.length}</span></span>
                  <button className="btn btn-ghost btn-xs" onClick={()=>{
                    const unchecked = late.filter(it => !drLines.some(l=>l._eligKey===it.key));
                    if (unchecked.length > 0) unchecked.forEach(toggleItem);
                    else late.forEach(it => setDrLines(prev=>prev.filter(l=>l._eligKey!==it.key)));
                  }}>
                    {late.every(it=>drLines.some(l=>l._eligKey===it.key)) ? 'Deselect All' : 'Select All'}
                  </button>
                </div>
                <div style={{border:'1px solid #fde68a',borderRadius:12,overflow:'hidden',marginBottom:12}}>
                  {late.map(item => {
                    const checked = drLines.some(l=>l._eligKey===item.key);
                    return (
                      <div key={item.key} className="elig-check elig-late" style={{background:checked?'#fefce8':'#fffbeb',cursor:'pointer'}} onClick={()=>toggleItem(item)}>
                        <input type="checkbox" checked={checked} readOnly style={{width:16,height:16,accentColor:'#f59e0b',flexShrink:0}} />
                        <div style={{flex:1,fontSize:12}}>
                          <strong style={{color:'#d97706'}}>{item.voucherId}</strong>
                          {item.isPayrollLine && <span style={{marginLeft:6,fontSize:10,background:'#eff6ff',color:'#1d4ed8',padding:'1px 5px',borderRadius:4,fontWeight:700}}>LINE {item.lineNo}</span>}
                          <span style={{marginLeft:8,color:'#64748b',fontSize:11}}>{item.voucherType}</span>
                          <span style={{marginLeft:8,color:'#0b1220'}}>{item.contact}</span>
                        </div>
                        <span style={{fontSize:11,color:'#64748b',marginRight:8}}>{item.bankCode||'—'}</span>
                        {item.checkDate && <span style={{fontSize:11,color:'#92400e',fontWeight:700,marginRight:8}}>{item.checkDate}</span>}
                        <span style={{fontWeight:700,minWidth:100,textAlign:'right',fontSize:13}}>{fmt(item.amount)}</span>
                      </div>
                    );
                  })}
                </div>
              </>)}

              {/* ── Selected Lines Table ── */}
              {drLines.length > 0 && (
                <>
                  <div className="section-title"><span>Disbursement Lines ({drLines.length})</span></div>
                  <table className="lines-tbl" style={{fontSize:12,marginBottom:8}}>
                    <thead>
                      <tr><th>#</th><th>Voucher ID</th><th>Type</th><th>Contact / Description</th><th>Bank</th><th>Check No.</th><th>Ref No.</th><th style={{textAlign:'right'}}>Amount</th><th></th></tr>
                    </thead>
                    <tbody>
                      {drLines.map((l,i) => (
                        <tr key={l._key}>
                          <td style={{color:'#94a3b8',fontWeight:700,width:32,textAlign:'center'}}>{i+1}</td>
                          <td style={{fontWeight:700,color:'#f97316'}}>
                            {l.voucherId}
                            {l.isPayrollLine && <span style={{marginLeft:4,fontSize:10,background:'#eff6ff',color:'#1d4ed8',padding:'1px 4px',borderRadius:4,fontWeight:700}}>L{l.lineNo}</span>}
                          </td>
                          <td>{l.voucherType}</td>
                          <td style={{maxWidth:160,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{l.contact||l.description||'—'}</td>
                          <td style={{color:'#374151'}}>{l.bankCode ? `${l.bankCode}` : '—'}</td>
                          <td style={{color:'#374151'}}>{l.checkNo||'—'}</td>
                          <td style={{color:'#374151'}}>{l.refNo||'—'}</td>
                          <td style={{textAlign:'right',fontWeight:700,color:'#0b1220',paddingRight:8}}>{fmt(l.amount||0)}</td>
                          <td><button className="btn btn-ghost btn-xs" style={{color:'#dc2626'}} onClick={()=>setDrLines(prev=>prev.filter(x=>x._key!==l._key))}>✕</button></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <div className="tfoot-row">
                    <span style={{color:'#94a3b8'}}>Total Disbursements:</span>
                    <span style={{color:'#dc2626'}}>{fmt(lineTotal)}</span>
                    <span style={{color:'#94a3b8',marginLeft:20}}>Balance After:</span>
                    <span style={{color:balanceAfter<0?'#dc2626':'#065f46'}}>{fmt(balanceAfter)}</span>
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
                {[['Date',viewModal.date],['Total Amount',fmt(viewModal.totalAmount)],['Expected Collection',fmt(viewModal.expectedCollection)],['Created By',viewModal.createdBy||'—'],['Reviewed By',viewModal.reviewedBy||'—'],['Approved By',viewModal.approvedBy||'—']].map(([k,v])=>(
                  <div key={k}><div style={{fontSize:10,fontWeight:800,color:'#94a3b8',textTransform:'uppercase',letterSpacing:'.06em',marginBottom:4}}>{k}</div><div style={{fontWeight:700}}>{v||'—'}</div></div>
                ))}
              </div>
              {viewModal.rejectReason && (
                <div style={{background:'#fef2f2',border:'1px solid #fecaca',borderRadius:10,padding:12,marginBottom:12}}>
                  <strong style={{color:'#dc2626'}}>Reject Reason: </strong>{viewModal.rejectReason}
                </div>
              )}
              {/* Bank balances snapshot */}
              {viewModal.bankBalances && Object.keys(viewModal.bankBalances).length > 0 && (
                <>
                  <div className="section-title"><span>Bank Balances (at time of report)</span></div>
                  <div className="bank-cards" style={{marginBottom:12}}>
                    {bankAccounts.filter(acc=>viewModal.bankBalances[acc.code]!=null).map(acc=>{
                      const bal  = Number(viewModal.bankBalances[acc.code])||0;
                      const disb = (viewModal.lines||[]).filter(l=>l.bankCode===acc.code).reduce((s,l)=>s+(Number(l.amount)||0),0);
                      return (
                        <div key={acc.code} className="bank-card">
                          <div className="bank-card-code">{acc.code}</div>
                          <div className="bank-card-name">{acc.name}</div>
                          <div className="bank-card-lbl">Balance</div>
                          <div className="bank-card-val">{fmt(bal)}</div>
                          {disb>0 && <div style={{fontSize:11,color:'#94a3b8',marginTop:2}}>− {fmt(disb)} disbursed</div>}
                        </div>
                      );
                    })}
                  </div>
                  <div style={{background:'#f0fdf4',border:'1px solid #6ee7b7',borderRadius:10,padding:'10px 14px',marginBottom:12,display:'flex',flexWrap:'wrap',gap:16}}>
                    {[
                      ['Total Bank Bals', Object.values(viewModal.bankBalances).reduce((s,v)=>s+(Number(v)||0),0)],
                      ['+ Expected Collection', Number(viewModal.expectedCollection)||0],
                      ['− Disbursements', Number(viewModal.totalAmount)||0],
                      ['= Balance After', Object.values(viewModal.bankBalances).reduce((s,v)=>s+(Number(v)||0),0) + (Number(viewModal.expectedCollection)||0) - (Number(viewModal.totalAmount)||0)],
                    ].map(([lbl,val])=>(
                      <div key={lbl}>
                        <div style={{fontSize:9,fontWeight:800,color:'#94a3b8',textTransform:'uppercase',letterSpacing:'.06em'}}>{lbl}</div>
                        <div style={{fontSize:14,fontWeight:900,color:lbl.includes('After')&&val<0?'#dc2626':'#065f46'}}>{fmt(val)}</div>
                      </div>
                    ))}
                  </div>
                </>
              )}
              <div className="section-title">
                <span>Lines ({(viewModal.lines||[]).length})</span>
                {canReviewOrApprove && ['Pending Review','Pending Approval'].includes(viewModal.status||'') && (
                  <span style={{fontSize:10,color:'#94a3b8'}}>You can remove lines before approval</span>
                )}
              </div>
              {(viewModal.lines||[]).length===0
                ? <div className="empty">No lines.</div>
                : <table className="lines-tbl">
                    <thead>
                      <tr>
                        <th>#</th><th>Voucher ID</th><th>Type</th><th>Contact</th>
                        <th>Bank</th><th>Check No.</th><th>Ref No.</th>
                        <th style={{textAlign:'right'}}>Amount</th>
                        {canReviewOrApprove && ['Pending Review','Pending Approval'].includes(viewModal.status||'') && <th></th>}
                      </tr>
                    </thead>
                    <tbody>
                      {(viewModal.lines||[]).map((l,i)=>(
                        <tr key={i}>
                          <td>{l.lineNo||i+1}</td>
                          <td style={{fontWeight:700,color:'#f97316'}}>
                            {l.voucherId||'—'}
                            {l.isPayrollLine && <span style={{marginLeft:4,fontSize:10,background:'#eff6ff',color:'#1d4ed8',padding:'1px 4px',borderRadius:4,fontWeight:700}}>L{l.srcLineNo||l.lineNo}</span>}
                          </td>
                          <td>{l.voucherType||'—'}</td>
                          <td>{l.contact||'—'}</td>
                          <td>{l.bankCode||'—'}</td>
                          <td>{l.checkNo||'—'}</td>
                          <td>{l.refNo||'—'}</td>
                          <td style={{textAlign:'right',fontWeight:700}}>{fmt(l.amount)}</td>
                          {canReviewOrApprove && ['Pending Review','Pending Approval'].includes(viewModal.status||'') && (
                            <td>
                              <button className="btn btn-ghost btn-xs" style={{color:'#dc2626'}} onClick={()=>removeLine(i)}>Remove</button>
                            </td>
                          )}
                        </tr>
                      ))}
                      <tr><td colSpan={canReviewOrApprove&&['Pending Review','Pending Approval'].includes(viewModal.status||'')?8:7} style={{textAlign:'right',fontWeight:800,color:'#64748b',fontSize:12}}>TOTAL</td><td style={{textAlign:'right',fontWeight:900}}>{fmt(viewModal.totalAmount)}</td></tr>
                    </tbody>
                  </table>
              }
              {viewModal.notes && <div style={{marginTop:10,fontSize:12,color:'#64748b'}}><strong>Notes:</strong> {viewModal.notes}</div>}
            </div>
            <div className="modal-f">
              <button className="btn btn-ghost btn-sm" onClick={()=>openPdf(viewModal)}>🖨 Print PDF</button>
              {canEdit(viewModal) && <button className="btn btn-ghost" onClick={()=>{setViewModal(null);openEdit(viewModal);}}>Edit</button>}
              {(viewModal.status==='Draft'||viewModal.status==='Rejected') && (
                <button className="btn btn-primary btn-sm" onClick={()=>{
                  setViewModal(null);
                  setStatusModal({report:viewModal,newStatus:'Pending Review',reason:null});
                }}>Submit for Approval</button>
              )}
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

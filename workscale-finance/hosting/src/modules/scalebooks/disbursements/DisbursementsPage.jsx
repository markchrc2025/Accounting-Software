import { useState, useEffect, useMemo, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import jsPDF from 'jspdf';
import {
  collection, query, orderBy, onSnapshot, addDoc, updateDoc, deleteDoc, doc,
  serverTimestamp, getDocs, getDoc, where
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

const DR_STATUSES = ['Pending','For Verification','Verified','For Approval','Approved','Disbursed','Rejected','Voided'];

// ── PDF generation ────────────────────────────────────────────────────────────
function buildPdfHtml(report, bankAccounts, companyName = 'Workscale Resources Inc.') {
  const lines    = report.lines || [];
  const bankBals = report.bankBalances || {};

  // helpers scoped to PDF only
  const p = (n) => '&#8369;&nbsp;' + fmtN(Math.abs(Number(n)||0));
  const pDash = (n) => (Number(n)||0) === 0 ? '&mdash;' : `<span class="neg">(&#8369;&nbsp;${fmtN(Math.abs(Number(n)||0))})</span>`;
  const pAfter = (n) => {
    const v = Number(n)||0;
    if (v < 0) return `<span class="neg">(&#8369;&nbsp;${fmtN(Math.abs(v))})</span>`;
    return '&#8369;&nbsp;' + fmtN(v);
  };

  // ── Bank balance section ──────────────────────────────────────────────────
  const activeAccounts = bankAccounts.filter(a => bankBals[a.code] !== undefined || lines.some(l=>l.bankCode===a.code));
  let totalBal = 0, totalDisb = 0;
  const bankBalRows = activeAccounts.map(acc => {
    const bal  = Number(bankBals[acc.code]) || 0;
    const disb = lines.filter(l=>l.bankCode===acc.code).reduce((s,l)=>s+(Number(l.amount)||0), 0);
    totalBal  += bal;
    totalDisb += disb;
    const after = bal - disb;
    return `<tr>
      <td>${acc.name||acc.code}</td>
      <td class="amt">${p(bal)}</td>
      <td class="amt">${pDash(disb)}</td>
      <td class="amt">${pAfter(after)}</td>
    </tr>`;
  }).join('');
  // also accumulate lines for accounts not in activeAccounts (edge case)
  lines.forEach(l => { if (!activeAccounts.find(a=>a.code===l.bankCode)) totalDisb += (Number(l.amount)||0); });
  const expColl  = Number(report.expectedCollection)||0;
  const balAfter = totalBal + expColl - totalDisb;

  // ── Disbursements by bank ─────────────────────────────────────────────────
  const repDate = report.date ? new Date(report.date+'T00:00:00') : null;
  const mainLines = lines.filter(l => {
    if (!repDate || !l.checkDate) return true;
    try {
      const cd = new Date(l.checkDate+'T00:00:00');
      return isNaN(cd.getTime()) || (cd.getMonth()===repDate.getMonth() && cd.getFullYear()===repDate.getFullYear());
    } catch { return true; }
  });
  const lateLines = repDate ? lines.filter(l => {
    if (!l.checkDate) return false;
    try {
      const cd = new Date(l.checkDate+'T00:00:00');
      return !isNaN(cd.getTime()) && (cd.getMonth()!==repDate.getMonth() || cd.getFullYear()!==repDate.getFullYear());
    } catch { return false; }
  }) : [];

  const disburseRow = (l) => `<tr>
    <td style="font-weight:700;color:#c2410c">${l.voucherId||'&mdash;'}</td>
    <td>${l.contact||'&mdash;'}</td>
    <td>${l.description||l.voucherType||'&mdash;'}</td>
    <td class="amt">${l.checkNo||'&mdash;'}</td>
    <td class="amt">${l.refNo||'&mdash;'}</td>
    <td class="amt" style="font-weight:700">&#8369;&nbsp;${fmtN(l.amount)}</td>
  </tr>`;

  const buildGroups = (lineSet) => {
    const groups = {};
    lineSet.forEach(l => { const k = l.bankCode||'OTHER'; if (!groups[k]) groups[k]=[]; groups[k].push(l); });
    return Object.entries(groups).map(([bankCode, bLines]) => {
      const acc = bankAccounts.find(a=>a.code===bankCode);
      const bankName = acc ? acc.name : bankCode;
      const sub = bLines.reduce((s,l)=>s+(Number(l.amount)||0), 0);
      return `
        <div class="bank-group-header">DISBURSEMENTS FROM: ${bankName.toUpperCase()}</div>
        <table class="disb-tbl">
          <thead><tr><th>VOUCHER NO.</th><th>PAYEE</th><th>DESCRIPTION</th><th class="amt">CHECK NO.</th><th class="amt">REF NO.</th><th class="amt">AMOUNT</th></tr></thead>
          <tbody>${bLines.map(disburseRow).join('')}</tbody>
          <tfoot><tr class="sub-row"><td colspan="5" class="amt"><strong>Subtotal</strong></td><td class="amt"><strong>&#8369;&nbsp;${fmtN(sub)}</strong></td></tr></tfoot>
        </table>
        <div class="bank-total-line">Total for ${bankName}: &nbsp;<strong>&#8369;&nbsp;${fmtN(sub)}</strong></div>`;
    }).join('');
  };

  const lateGroupsHtml = lateLines.length > 0 ? (() => {
    const groups = {};
    lateLines.forEach(l => { const k = l.bankCode||'OTHER'; if (!groups[k]) groups[k]=[]; groups[k].push(l); });
    return Object.entries(groups).map(([bankCode, bLines]) => {
      const acc = bankAccounts.find(a=>a.code===bankCode);
      const bankName = acc ? acc.name : bankCode;
      const sub = bLines.reduce((s,l)=>s+(Number(l.amount)||0), 0);
      return `
        <div class="late-from">From: ${bankName}</div>
        <table class="disb-tbl">
          <thead><tr><th>VOUCHER NO.</th><th>PAYEE</th><th>DESCRIPTION</th><th class="amt">CHECK NO.</th><th class="amt">REF NO.</th><th class="amt">AMOUNT</th></tr></thead>
          <tbody>${bLines.map(disburseRow).join('')}</tbody>
          <tfoot><tr class="sub-row"><td colspan="5" class="amt"><strong>Subtotal</strong></td><td class="amt"><strong>&#8369;&nbsp;${fmtN(sub)}</strong></td></tr></tfoot>
        </table>`;
    }).join('');
  })() : '';

  const genDate = fmtDate(new Date().toISOString().slice(0,10));

  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>DR &mdash; ${report.reportId||report.id}</title>
  <style>
    @page { size: letter portrait; margin: 12mm 14mm 14mm; }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: Arial, sans-serif; font-size: 10px; color: #0b1220; }

    /* ── Top bar ── */
    .doc-header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 10px; }
    .logo-wrap { display: flex; align-items: center; gap: 8px; }
    .logo-box { width: 34px; height: 34px; background: #f97316; border-radius: 6px; display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
    .logo-w { color: #fff; font-size: 18px; font-weight: 900; font-family: Arial, sans-serif; line-height: 1; }
    .logo-text-wrap { display: flex; flex-direction: column; line-height: 1.1; }
    .logo-co { font-size: 12px; font-weight: 900; color: #0b1220; letter-spacing: .04em; }
    .logo-sub { font-size: 8px; font-weight: 700; color: #f97316; letter-spacing: .12em; text-transform: uppercase; }
    .doc-meta { text-align: right; font-size: 9px; color: #374151; }
    .doc-meta div { margin-bottom: 1px; }

    /* ── Title ── */
    .doc-title { font-size: 15px; font-weight: 900; text-transform: uppercase; letter-spacing: .02em; margin-bottom: 1px; border-bottom: 2px solid #0b1220; padding-bottom: 4px; }
    .doc-date  { font-size: 9px; color: #555; margin-bottom: 10px; }

    /* ── Section headers ── */
    .sec-label { background: #e5e7eb; font-size: 9px; font-weight: 900; text-transform: uppercase; letter-spacing: .06em; padding: 4px 8px; margin: 10px 0 0; border: 1px solid #ccc; }

    /* ── Bank balance table ── */
    .bal-tbl { width: 100%; border-collapse: collapse; margin-bottom: 6px; }
    .bal-tbl th { font-size: 8.5px; font-weight: 900; text-transform: uppercase; background: #374151; color: #fff; border: 1px solid #4b5563; padding: 4px 7px; }
    .bal-tbl th.amt { text-align: right; }
    .bal-tbl td { border: 1px solid #d1d5db; padding: 3px 7px; font-size: 9px; }
    .bal-tbl tr.total-row td { background: #f3f4f6; font-weight: 900; font-size: 9.5px; border-top: 2px solid #374151; }

    /* ── Disbursement group ── */
    .bank-group-header { font-size: 8.5px; font-weight: 900; text-transform: uppercase; letter-spacing: .04em; padding: 4px 7px; background: #f9fafb; border: 1px solid #d1d5db; border-bottom: none; margin-top: 8px; color: #374151; }
    .disb-tbl { width: 100%; border-collapse: collapse; }
    .disb-tbl th { font-size: 8px; font-weight: 900; text-transform: uppercase; background: #374151; color: #fff; border: 1px solid #4b5563; padding: 3px 6px; }
    .disb-tbl th.amt { text-align: right; }
    .disb-tbl td { border: 1px solid #d1d5db; padding: 3px 6px; font-size: 8.5px; vertical-align: top; }
    .disb-tbl tr.sub-row td { background: #f9fafb; font-size: 9px; }
    .bank-total-line { font-size: 8.5px; text-align: right; padding: 3px 7px; color: #374151; border: 1px solid #d1d5db; border-top: none; margin-bottom: 4px; }

    /* ── Late approvals ── */
    .late-header { font-size: 10px; font-weight: 900; text-transform: uppercase; padding: 5px 8px; background: #fffbeb; border: 1px solid #fcd34d; margin: 12px 0 4px; }
    .late-from { font-size: 9px; font-weight: 700; padding: 4px 7px; background: #fefce8; border: 1px solid #fde68a; border-bottom: none; margin-top: 6px; color: #92400e; }

    /* ── Footer ── */
    .footer-wrap { display: flex; justify-content: space-between; align-items: flex-end; margin-top: 18px; gap: 16px; }
    .sig-block { display: flex; gap: 18px; flex: 1; }
    .sig-col { flex: 1; text-align: center; }
    .sig-space { height: 28px; }
    .sig-line { border-top: 1px solid #374151; margin-bottom: 3px; }
    .sig-name { font-size: 8.5px; font-weight: 900; text-transform: uppercase; }
    .sig-label { font-size: 8px; color: #6b7280; }

    /* ── Summary box ── */
    .summary-box { border: 1px solid #374151; min-width: 220px; flex-shrink: 0; }
    .summary-title { background: #374151; color: #fff; font-size: 9px; font-weight: 900; text-transform: uppercase; letter-spacing: .06em; padding: 4px 10px; }
    .summary-row { display: flex; justify-content: space-between; font-size: 9px; padding: 3px 10px; gap: 12px; }
    .summary-row.total-row { font-weight: 900; font-size: 10px; background: #f3f4f6; border-top: 2px solid #374151; padding: 5px 10px; }

    /* ── Utilities ── */
    .amt { text-align: right; white-space: nowrap; }
    .neg { color: #dc2626; }
    @media print {
      body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
      .no-print { display: none; }
    }
  </style>
  </head><body>
    <div class="no-print" style="padding:10px;background:#f5f5f5;text-align:center;margin-bottom:8px">
      <button onclick="window.print()" style="padding:8px 22px;font-size:13px;font-weight:700;background:#f97316;color:#fff;border:0;border-radius:8px;cursor:pointer">&#128424; Print / Save as PDF</button>
    </div>

    <!-- Header -->
    <div class="doc-header">
      <div class="logo-wrap">
        <div class="logo-box"><span class="logo-w">W</span></div>
        <div class="logo-text-wrap">
          <span class="logo-co">WORKSCALE</span>
          <span class="logo-sub">RESOURCES</span>
        </div>
      </div>
      <div class="doc-meta">
        <div><strong>Report No:</strong>&nbsp; ${report.reportId||report.id}</div>
        <div><strong>Generated:</strong>&nbsp; ${genDate}</div>
      </div>
    </div>
    <div class="doc-title">MASTER DISBURSEMENT REPORT</div>
    <div class="doc-date">${fmtDate(report.date)}</div>

    <!-- Section 1: Bank Account Balances -->
    <div class="sec-label">1. BANK ACCOUNT BALANCES</div>
    <table class="bal-tbl">
      <thead>
        <tr>
          <th>BANK ACCOUNT</th>
          <th class="amt">CURRENT BALANCE</th>
          <th class="amt">LESS: DISBURSEMENTS</th>
          <th class="amt">BALANCE AFTER</th>
        </tr>
      </thead>
      <tbody>
        ${bankBalRows}
      </tbody>
      <tfoot>
        <tr class="total-row">
          <td><strong>TOTAL</strong></td>
          <td class="amt"><strong>${p(totalBal)}</strong></td>
          <td class="amt"><strong>${pDash(totalDisb)}</strong></td>
          <td class="amt"><strong>${pAfter(totalBal - totalDisb)}</strong></td>
        </tr>
      </tfoot>
    </table>

    <!-- Section 2: Disbursements -->
    <div class="sec-label">2. DISBURSEMENTS</div>
    ${buildGroups(mainLines)}

    <!-- Late Approvals -->
    ${lateLines.length > 0 ? `
    <div class="late-header">&#9658; FOR LATE APPROVALS</div>
    ${lateGroupsHtml}` : ''}

    <!-- Footer: Signatures + Summary -->
    <div class="footer-wrap">
      <div class="sig-block">
        <div class="sig-col">
          <div class="sig-space"></div>
          <div class="sig-line"></div>
          <div class="sig-name">${report.createdBy||'&nbsp;'}</div>
          <div class="sig-label">Prepared by</div>
        </div>
        <div class="sig-col">
          <div class="sig-space"></div>
          <div class="sig-line"></div>
          <div class="sig-name">${report.reviewedBy||'&nbsp;'}</div>
          <div class="sig-label">Verified by</div>
        </div>
        <div class="sig-col">
          <div class="sig-space"></div>
          <div class="sig-line"></div>
          <div class="sig-name">${report.approvedBy||'&nbsp;'}</div>
          <div class="sig-label">Approved by</div>
        </div>
        <div class="sig-col">
          <div class="sig-space"></div>
          <div class="sig-line"></div>
          <div class="sig-name">&nbsp;</div>
          <div class="sig-label">Noted by</div>
        </div>
      </div>
      <div class="summary-box">
        <div class="summary-title">SUMMARY</div>
        <div class="summary-row"><span>Total Bank Balance (Before)</span><span>${p(totalBal)}</span></div>
        <div class="summary-row neg"><span>Less: Total Disbursements</span><span>${pDash(totalDisb)}</span></div>
        <div class="summary-row"><span>Add: Expected Collection</span><span>${expColl > 0 ? p(expColl) : '&#8369;&nbsp;0.00'}</span></div>
        <div class="summary-row total-row"><span>Bank Balance After</span><span class="${balAfter<0?'neg':''}">${pAfter(balAfter)}</span></div>
      </div>
    </div>
    ${report.notes ? `<div style="font-size:8.5px;color:#6b7280;margin-top:8px"><strong>Notes:</strong> ${report.notes}</div>` : ''}
  </body></html>`;
}

const STATUS_STYLES = {
  'Pending':          { background:'#f8fafc', borderColor:'#e2e8f0', color:'#64748b' },
  'For Verification': { background:'#fffbeb', borderColor:'#fde68a', color:'#92400e' },
  'Verified':         { background:'#f0fdf4', borderColor:'#86efac', color:'#166534' },
  'For Approval':     { background:'#eff6ff', borderColor:'#bfdbfe', color:'#1d4ed8' },
  'Approved':         { background:'#ecfdf5', borderColor:'#6ee7b7', color:'#065f46' },
  'Disbursed':        { background:'#f0f9ff', borderColor:'#7dd3fc', color:'#0369a1' },
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
  .modal    { width:min(1280px,98vw); max-height:94vh; background:#fff; border-radius:16px; display:flex; flex-direction:column; overflow:hidden; box-shadow:0 24px 64px rgba(0,0,0,.25); }
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
  .elig-header { display:grid; grid-template-columns:24px 120px 58px 1fr 130px 150px 88px 110px; gap:8px; padding:7px 14px; background:#f8fafc; border-bottom:2px solid #e5e7eb; font-size:10px; font-weight:800; color:#94a3b8; text-transform:uppercase; letter-spacing:.05em; align-items:center; }
  .elig-check  { display:grid; grid-template-columns:24px 120px 58px 1fr 130px 150px 88px 110px; gap:8px; padding:9px 14px; border-bottom:1px solid #f1f5f9; align-items:center; }
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
  .km-item     { display:block; width:100%; background:none; border:0; text-align:left; padding:9px 16px; font-size:13px; font-family:inherit; cursor:pointer; color:#0b1220; white-space:nowrap; }
  .km-item:hover { background:#f1f5f9; }
  .km-item-danger { color:#dc2626; }
  .km-divider { border:none; border-top:1px solid #f1f5f9; margin:4px 0; }
  .summary-item-val.neg { color:#dc2626; }
  .late-badge { display:inline-block; padding:2px 7px; border-radius:999px; font-size:10px; font-weight:800; background:#fef3c7; color:#92400e; border:1px solid #fde68a; margin-left:8px; }
`;

function StatusPill({ status }) {
  const s = STATUS_STYLES[status] || STATUS_STYLES['Pending'];
  return <span className="pill" style={s}>{status || 'Pending'}</span>;
}

export default function DisbursementsPage() {
  const { globalRoles, isAdmin } = usePermissions();
  const canReviewOrApprove = isAdmin || globalRoles.some(r => ['Verifier','Approver'].includes(r));

  const [reports,      setReports]      = useState([]);
  const [vouchers,     setVouchers]     = useState([]);
  const [checkEntries, setCheckEntries] = useState([]); // checkRegister entries — loaded while modal is open
  const [bankAccounts, setBankAccounts] = useState([]); // COA accounts with subType='Bank'
  const [dailyBals,    setDailyBals]    = useState([]); // dailyBankBalances entries
  const [profile,      setProfile]      = useState({});  // settings/profile

  // Filters
  const [search,       setSearch]       = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [dateFrom,     setDateFrom]     = useState('');
  const [dateTo,       setDateTo]       = useState('');

  // Bulk
  const [selected, setSelected] = useState(new Set());

  // Expand
  const [expandId, setExpandId] = useState(null);

  // Kebab menu
  const [openMenuId,   setOpenMenuId]  = useState(null);
  const [menuPos,      setMenuPos]     = useState({ top:0, right:0 });
  const menuRef = useRef(null);

  // Modals
  const [showModal,    setShowModal]    = useState(false);
  const [editing,      setEditing]      = useState(null);
  const [statusModal,  setStatusModal]  = useState(null);
  const [viewModal,    setViewModal]    = useState(null);
  const [confirmModal, setConfirmModal] = useState(null);
  const [viewMeta,     setViewMeta]     = useState({ preparedName:'', reviewedName:'', approvedName:'' });
  const [viewRoute,    setViewRoute]    = useState({ verifierEmail:'', approverEmail:'', hasVerifier:false, isVerifier:false, isApprover:false, isMaker:false });

  // Form
  const [form,    setForm]    = useState({ date:today(), expectedCollection:0, notes:'' });
  const [drLines, setDrLines] = useState([]); // lines picked from eligible items
  // bankBals is derived live from dailyBals — no manual state needed
  const [saving,     setSaving]     = useState(false);
  const [pdfLoading, setPdfLoading] = useState(null); // report id being downloaded
  const [toast,      setToast]      = useState('');

  const showToast  = (msg) => { setToast(msg); setTimeout(() => setToast(''), 3500); };
  const askConfirm = (message, onConfirm) => setConfirmModal({ message, onConfirm });
  const user = auth.currentUser?.email || '';

  // Close kebab menu on outside click or scroll
  useEffect(() => {
    if (!openMenuId) return;
    const close = (e) => { if (menuRef.current && !menuRef.current.contains(e.target)) setOpenMenuId(null); };
    const closeScroll = () => setOpenMenuId(null);
    document.addEventListener('mousedown', close);
    document.addEventListener('scroll', closeScroll, true);
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('scroll', closeScroll, true); };
  }, [openMenuId]);

  // ── Resolve signatory display names when view modal opens ──────────────────
  useEffect(() => {
    if (!viewModal) {
      setViewMeta({ preparedName:'', reviewedName:'', approvedName:'' });
      setViewRoute({ verifierEmail:'', approverEmail:'', hasVerifier:false, isVerifier:false, isApprover:false, isMaker:false });
      return;
    }
    const lookupName = async (email) => {
      if (!email) return '';
      const snap = await getDocs(query(collection(db,'appUsers'), where('email','==',email)));
      const d = snap?.docs?.[0]?.data();
      return d?.fullName || d?.displayName || email;
    };
    (async () => {
      const [preparedName, reviewedName, approvedName, routingSnap] = await Promise.all([
        lookupName(viewModal.createdBy  || ''),
        lookupName(viewModal.reviewedBy || ''),
        lookupName(viewModal.approvedBy || ''),
        getDoc(doc(db,'settings','approvalRouting')),
      ]);
      setViewMeta({ preparedName, reviewedName, approvedName });
      const routes = routingSnap.exists() ? (routingSnap.data().routes || []) : [];
      const route = routes.find(rt => rt.documentType === 'Disbursements' && rt.makerEmail === viewModal.createdBy) || null;
      const verifierEmail = route?.verifierEmail || '';
      const approverEmail = route?.approverEmail || '';
      const hasVerifier = !!verifierEmail && !route?.autoBypass && verifierEmail !== viewModal.createdBy;
      setViewRoute({
        verifierEmail, approverEmail, hasVerifier,
        isVerifier: isAdmin || user === verifierEmail,
        isApprover: isAdmin || user === approverEmail,
        isMaker: user === viewModal.createdBy,
      });
    })();
  }, [viewModal?.id]);

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
    // Company profile (logo, notedBy, etc.)
    getDoc(doc(db,'settings','profile')).then(s => { if (s.exists()) setProfile(s.data()); });
    // Daily bank balances — live from Bank Management
    const unsubBals = onSnapshot(
      query(collection(db,'dailyBankBalances'), orderBy('date','desc')),
      snap => setDailyBals(snap.docs.map(d=>({id:d.id,...d.data()})))
    );
    // Vouchers — only Approved or already-staged For Disbursement may be included in a DR
    const unsubVouchers = onSnapshot(
      query(collection(db,'vouchers'), where('status','in',
        ['Approved','For Disbursement']
      )),
      s => setVouchers(s.docs.map(d => ({ id:d.id, ...d.data() })))
    );
    return () => { unsub(); unsubBals(); unsubVouchers(); };
  }, []);

  // Live subscriptions — active only while the create/edit modal is open
  const checkUnsubRef   = useRef(null);
  const refreshModalData = () => {
    if (checkUnsubRef.current) checkUnsubRef.current();
    // Load Issued check register entries so CHECK vouchers expand per physical check
    checkUnsubRef.current = onSnapshot(
      query(collection(db,'checkRegister'), where('status','==','Issued')),
      s => setCheckEntries(s.docs.map(d => ({ id:d.id, ...d.data() })))
    );
  };
  const closeModal = () => {
    if (checkUnsubRef.current) { checkUnsubRef.current(); checkUnsubRef.current = null; }
    setShowModal(false);
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
      // Only fully-approved vouchers may enter a Disbursement Report
      if (!['Approved','For Disbursement'].includes(status)) return;
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
      } else if (v.voucherType === 'CHECK') {
        // CHECK vouchers — expand into one item per physical check (from checkRegister).
        // Checks connected to a Loan are excluded; the Loan Voucher covers those.
        if (v.loanId) return;
        const physicalChecks = checkEntries.filter(c => c.voucherDocId === v.id);
        // No Issued checks in checkRegister means all checks were voided/deleted — skip entirely.
        if (physicalChecks.length === 0) return;
        physicalChecks.forEach(c => {
            const checkDate = c.checkDate || c.issueDate || '';
            // Only include checks whose date falls in the same month as the report.
            // Other-month checks are skipped entirely — they don't belong to this disbursement.
            if (checkDate) {
              try {
                const cd = new Date(checkDate + 'T00:00:00');
                if (!isNaN(cd.getTime()) && (cd.getMonth() !== repMonth || cd.getFullYear() !== repYear)) return;
              } catch { /* no-op */ }
            }
            const item = {
              key:          `${v.voucherId||v.id}::chk-${c.id}`,
              voucherId:    v.voucherId || v.id,
              voucherDocId: v.id,
              checkDocId:   c.id,
              lineNo:       c.lineNo ?? null,
              voucherType:  'CHECK',
              contact:      c.payeeName || v.contactSummary || '',
              description:  v.purposeCategory || '',
              amount:       Number(c.amount) || 0,
              bankCode:     c.bankCode || v.paymentFromAccountCode || '',
              checkNo:      c.checkNumber || '',
              checkDate,
              loanId:       '',
              isPayrollLine:false,
              _preDisbStatus: v.preDisbursementStatus || v.status,
            };
            eligible.push(item);
          });
      } else {
        // PAYMENT, LOAN vouchers
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
          loanId:       v.loanId    || '',
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
  }, [vouchers, checkEntries, form.date, editing]);

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
    if (filterStatus) r = r.filter(x => (x.status||'Pending') === filterStatus);
    if (dateFrom) r = r.filter(x => (x.date||'') >= dateFrom);
    if (dateTo)   r = r.filter(x => (x.date||'') <= dateTo);
    return r;
  }, [reports, search, filterStatus, dateFrom, dateTo]);

  const kpis = useMemo(() => ({
    total:    reports.length,
    draft:    reports.filter(r => r.status === 'Pending').length,
    pending:  reports.filter(r => ['For Verification','Verified','For Approval'].includes(r.status)).length,
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
      await Promise.all([...selected].map(id => updateDoc(doc(db,'disbursementReports',id), { status:'For Verification', updatedAt:serverTimestamp(), updatedBy:user })));
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

  // Open create form when navigating from CreateFlyout
  const location = useLocation();
  useEffect(() => {
    if (location.state?.openCreate) { window.history.replaceState({}, ''); openNew(); }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Open Edit modal ───────────────────────────────────────────────────────────
  const openEdit = (r) => {
    refreshModalData();
    setEditing(r);
    setForm({ date:r.date||today(), expectedCollection:r.expectedCollection||0, notes:r.notes||'' });
    // Pre-populate drLines from saved report lines, refreshing bankCode from live voucher data
    setDrLines((r.lines||[]).map(l => {
      const liveV = vouchers.find(v => (v.voucherId||v.id) === l.voucherId);
      let currentBankCode = l.bankCode || '';
      if (liveV) {
        const vType = l.voucherType || liveV.voucherType || '';
        if (PAYROLL_TYPES.includes(vType) && l.srcLineNo != null) {
          const pl = (liveV.lines||[]).find(x => x.lineNo === l.srcLineNo);
          currentBankCode = pl?.lineBankCode || liveV.paymentFromAccountCode || l.bankCode || '';
        } else if (vType === 'CHECK') {
          const chk = checkEntries.find(c => c.voucherDocId === liveV.id && (c.lineNo === l.srcLineNo || c.checkNumber === l.checkNo));
          currentBankCode = chk?.bankCode || liveV.paymentFromAccountCode || l.bankCode || '';
        } else {
          currentBankCode = liveV.paymentFromAccountCode || l.bankCode || '';
        }
      }
      return {
        ...l,
        bankCode:       currentBankCode,
        _key:           uid(),
        _eligKey:       `${l.voucherId}::${l.lineNo != null ? l.lineNo : ''}`,
        _preDisbStatus: 'Approved',
      };
    }));
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
        status:             status || 'Pending',
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
      closeModal();
    } catch(e) { showToast('Error: ' + e.message); }
    setSaving(false);
  };

  // ── Status update ─────────────────────────────────────────────────────────────
  const doStatusUpdate = async () => {
    if (!statusModal) return;
    const { report, newStatus, reason, action } = statusModal;
    setSaving(true);
    try {
      const updateFields = {
        status: newStatus,
        ...(reason ? { rejectReason: reason } : {}),
        ...(action === 'submit'  ? { rejectReason: '' }                  : {}),
        ...(action === 'verify'  ? { reviewedBy: user, rejectReason: '' } : {}),
        ...(action === 'approve' ? { approvedBy: user }                   : {}),
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

  // ── Routing-aware submit from row (kebab menu) ───────────────────────────────
  const submitFromRow = async (r) => {
    const routingSnap = await getDoc(doc(db,'settings','approvalRouting'));
    const routes = routingSnap.exists() ? (routingSnap.data().routes || []) : [];
    const route = routes.find(rt => rt.documentType === 'Disbursements' && rt.makerEmail === r.createdBy) || null;
    const verifierEmail = route?.verifierEmail || '';
    const hasVerifier = !!verifierEmail && !route?.autoBypass && verifierEmail !== r.createdBy;
    setStatusModal({ report:r, action:'submit', newStatus: hasVerifier ? 'For Verification' : 'For Approval', reason:null });
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
  const openPdf = async (r) => {
    setPdfLoading(r.id);
    try {
      const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'letter' });

      // Letter: 215.9 × 279.4 mm
      const PW = 215.9, PH = 279.4;
      const ML = 14, MR = 14, MT = 14;
      const CW = PW - ML - MR; // ~187.9 mm

      const reg  = (sz = 9)  => { pdf.setFont('helvetica', 'normal'); pdf.setFontSize(sz); };
      const bold = (sz = 9)  => { pdf.setFont('helvetica', 'bold');   pdf.setFontSize(sz); };
      const hline = (yy, lw = 0.2) => { pdf.setLineWidth(lw); pdf.setDrawColor(0, 0, 0); pdf.line(ML, yy, ML + CW, yy); };

      let y = MT;
      const need = (h) => { if (y + h > PH - 14) { pdf.addPage(); y = MT; } };

      // ── HEADER ───────────────────────────────────────────────────────────────
      // Resolve signatories via approval routing (same as VoucherPdfModal)
      const lookupName = async (email) => {
        if (!email) return '';
        const snap = await getDocs(query(collection(db, 'appUsers'), where('email', '==', email)));
        const data = snap?.docs?.[0]?.data();
        return data?.fullName || data?.displayName || email;
      };

      const makerEmail = r.createdBy || '';
      const routingSnap = await getDoc(doc(db, 'settings', 'approvalRouting'));
      const routes = routingSnap.exists() ? (routingSnap.data().routes || []) : [];
      const route  = routes.find(rt => rt.documentType === 'Disbursements' && rt.makerEmail === makerEmail);
      const verifierEmail = route?.verifierEmail || '';
      const approverEmail = route?.approverEmail || '';

      const [preparedName, reviewedName, approvedName] = await Promise.all([
        lookupName(makerEmail),
        lookupName(verifierEmail),
        lookupName(approverEmail),
      ]);
      const notedByName = profile.voucherNotedBy || profile.notedBy || '';

      // Logo or placeholder
      let logoRightEdge = ML + 13;
      if (profile.logoBase64) {
        const imgFmt = (profile.logoBase64.match(/^data:image\/(\w+);/) || [])[1]?.toUpperCase() || 'PNG';
        const imgEl  = new Image();
        await new Promise(res => { imgEl.onload = res; imgEl.onerror = res; imgEl.src = profile.logoBase64; });
        const MAX_W = 14, MAX_H = 10;
        const asp  = (imgEl.naturalWidth || 1) / (imgEl.naturalHeight || 1);
        const imgW = asp > MAX_W / MAX_H ? MAX_W : MAX_H * asp;
        const imgH = asp > MAX_W / MAX_H ? MAX_W / asp : MAX_H;
        pdf.addImage(profile.logoBase64, imgFmt, ML, y, imgW, imgH, '', 'FAST');
        logoRightEdge = ML + imgW + 2;
      } else {
        pdf.setFillColor(249, 115, 22);
        pdf.roundedRect(ML, y, 10, 10, 1, 1, 'F');
        bold(11);
        pdf.setTextColor(255, 255, 255);
        pdf.text('W', ML + 5, y + 7.2, { align: 'center' });
        pdf.setTextColor(0, 0, 0);
        logoRightEdge = ML + 12;
      }

      bold(11);
      pdf.setTextColor(0, 0, 0);
      const companyName = profile.companyName || 'WORKSCALE';
      pdf.text(companyName, logoRightEdge, y + 6);
      if (!profile.logoBase64) {
        bold(7);
        pdf.setTextColor(249, 115, 22);
        pdf.text('RESOURCES', logoRightEdge, y + 8.8);
        pdf.setTextColor(0, 0, 0);
      }

      reg(8.5);
      pdf.setTextColor(55, 65, 81);
      const genDate = new Date().toLocaleDateString('en-PH', { year: 'numeric', month: 'long', day: 'numeric' });
      pdf.text(`Report No:  ${r.reportId || r.id || '\u2014'}`, ML + CW, y + 3.5, { align: 'right' });
      pdf.text(`Generated:  ${genDate}`, ML + CW, y + 8, { align: 'right' });
      pdf.setTextColor(0, 0, 0);
      y += 14;

      // ── TITLE ────────────────────────────────────────────────────────────────
      bold(14);
      pdf.text('MASTER DISBURSEMENT REPORT', ML, y);
      y += 2.5;
      hline(y, 0.6);
      y += 4;
      reg(8.5);
      pdf.setTextColor(85, 85, 85);
      pdf.text(fmtDate(r.date) || '\u2014', ML, y);
      pdf.setTextColor(0, 0, 0);
      y += 9;

      // ── Helpers ──────────────────────────────────────────────────────────────
      const TH = 6.5; // table header height
      const RH = 5.5; // row height
      let cx = ML;

      const secLabel = (text) => {
        need(7);
        pdf.setFillColor(229, 231, 235);
        pdf.setDrawColor(200, 200, 200);
        pdf.rect(ML, y, CW, 6, 'FD');
        pdf.setDrawColor(0, 0, 0);
        bold(8.5);
        pdf.setTextColor(30, 41, 59);
        pdf.text(text, ML + 4, y + 4.2);
        pdf.setTextColor(0, 0, 0);
        y += 6;
      };

      // ── SECTION 1: BANK ACCOUNT BALANCES ─────────────────────────────────────
      secLabel('1. BANK ACCOUNT BALANCES');

      const balCols = [CW * 0.40, CW * 0.20, CW * 0.22, CW * 0.18];

      need(TH);
      pdf.setFillColor(55, 65, 81);
      pdf.setDrawColor(75, 85, 99);
      pdf.rect(ML, y, CW, TH, 'FD');
      bold(7.5);
      pdf.setTextColor(255, 255, 255);
      cx = ML;
      ['BANK ACCOUNT', 'CURRENT BALANCE', 'LESS: DISBURSEMENTS', 'BALANCE AFTER'].forEach((h, i) => {
        if (i === 0) pdf.text(h, cx + 3, y + 4.3);
        else pdf.text(h, cx + balCols[i] - 2.5, y + 4.3, { align: 'right' });
        cx += balCols[i];
      });
      pdf.setTextColor(0, 0, 0);
      y += TH;

      const lines = r.lines || [];
      const bankBals = r.bankBalances || {};
      const activeAccounts = bankAccounts.filter(a =>
        bankBals[a.code] !== undefined || lines.some(l => l.bankCode === a.code)
      );
      let totalBal = 0, totalDisb = 0;

      activeAccounts.forEach((acc, idx) => {
        const bal  = Number(bankBals[acc.code]) || 0;
        const disb = lines.filter(l => l.bankCode === acc.code).reduce((s, l) => s + (Number(l.amount) || 0), 0);
        totalBal  += bal;
        totalDisb += disb;
        const after = bal - disb;

        need(RH);
        if (idx % 2 === 1) { pdf.setFillColor(248, 250, 252); pdf.rect(ML, y, CW, RH, 'F'); }
        pdf.setDrawColor(209, 213, 219);
        pdf.rect(ML, y, CW, RH, 'S');
        pdf.setDrawColor(0, 0, 0);

        cx = ML;
        reg(8.5);
        pdf.text(acc.name || acc.code, cx + 3, y + 3.8);
        cx += balCols[0];
        pdf.text(`P ${fmtN(bal)}`, cx + balCols[1] - 2.5, y + 3.8, { align: 'right' });
        cx += balCols[1];
        if (disb === 0) {
          pdf.text('\u2014', cx + balCols[2] / 2, y + 3.8, { align: 'center' });
        } else {
          pdf.setTextColor(220, 38, 38);
          pdf.text(`(P ${fmtN(disb)})`, cx + balCols[2] - 2.5, y + 3.8, { align: 'right' });
          pdf.setTextColor(0, 0, 0);
        }
        cx += balCols[2];
        if (after < 0) {
          pdf.setTextColor(220, 38, 38);
          pdf.text(`(P ${fmtN(Math.abs(after))})`, cx + balCols[3] - 2.5, y + 3.8, { align: 'right' });
          pdf.setTextColor(0, 0, 0);
        } else {
          pdf.text(`P ${fmtN(after)}`, cx + balCols[3] - 2.5, y + 3.8, { align: 'right' });
        }
        y += RH;
      });

      lines.forEach(l => { if (!activeAccounts.find(a => a.code === l.bankCode)) totalDisb += (Number(l.amount) || 0); });
      const expColl  = Number(r.expectedCollection) || 0;
      const balAfter = totalBal + expColl - totalDisb;

      // TOTAL row
      need(RH + 2);
      hline(y, 0.5);
      pdf.setFillColor(243, 244, 246);
      pdf.setDrawColor(209, 213, 219);
      pdf.rect(ML, y, CW, RH + 2, 'FD');
      pdf.setDrawColor(0, 0, 0);
      bold(8.5);
      cx = ML;
      pdf.text('TOTAL', cx + 3, y + 5);
      cx += balCols[0];
      pdf.text(`P ${fmtN(totalBal)}`, cx + balCols[1] - 2.5, y + 5, { align: 'right' });
      cx += balCols[1];
      if (totalDisb === 0) {
        pdf.text('\u2014', cx + balCols[2] / 2, y + 5, { align: 'center' });
      } else {
        pdf.setTextColor(220, 38, 38);
        pdf.text(`(P ${fmtN(totalDisb)})`, cx + balCols[2] - 2.5, y + 5, { align: 'right' });
        pdf.setTextColor(0, 0, 0);
      }
      cx += balCols[2];
      if (balAfter < 0) {
        pdf.setTextColor(220, 38, 38);
        pdf.text(`(P ${fmtN(Math.abs(balAfter))})`, cx + balCols[3] - 2.5, y + 5, { align: 'right' });
        pdf.setTextColor(0, 0, 0);
      } else {
        pdf.text(`P ${fmtN(balAfter)}`, cx + balCols[3] - 2.5, y + 5, { align: 'right' });
      }
      y += RH + 2 + 7;

      // ── SECTION 2: DISBURSEMENTS ──────────────────────────────────────────────
      secLabel('2. DISBURSEMENTS');

      const repDate = r.date ? new Date(r.date + 'T00:00:00') : null;
      const mainLines = lines.filter(l => {
        if (!repDate || !l.checkDate) return true;
        try {
          const cd = new Date(l.checkDate + 'T00:00:00');
          return isNaN(cd.getTime()) || (cd.getMonth() === repDate.getMonth() && cd.getFullYear() === repDate.getFullYear());
        } catch { return true; }
      });
      const lateLines = repDate ? lines.filter(l => {
        if (!l.checkDate) return false;
        try {
          const cd = new Date(l.checkDate + 'T00:00:00');
          return !isNaN(cd.getTime()) && (cd.getMonth() !== repDate.getMonth() || cd.getFullYear() !== repDate.getFullYear());
        } catch { return false; }
      }) : [];

      // Disbursement table columns: VOUCHER NO. | PAYEE | DESCRIPTION | CHECK NO. | REF NO. | AMOUNT
      const dCols = [CW * 0.13, CW * 0.21, CW * 0.28, CW * 0.12, CW * 0.12, CW * 0.14];

      const drawDisbGroup = (bLines, bankName, isLate) => {
        const GH = 5.5;
        need(GH + TH + RH + 7);

        // Group header
        if (isLate) { pdf.setFillColor(254, 252, 232); pdf.setDrawColor(253, 230, 138); }
        else        { pdf.setFillColor(249, 250, 251); pdf.setDrawColor(209, 213, 219); }
        pdf.rect(ML, y, CW, GH, 'FD');
        bold(8);
        pdf.setTextColor(isLate ? 146 : 55, isLate ? 64 : 65, isLate ? 14 : 81);
        pdf.text((isLate ? 'From: ' : 'DISBURSEMENTS FROM: ') + bankName.toUpperCase(), ML + 4, y + 3.8);
        pdf.setTextColor(0, 0, 0);
        pdf.setDrawColor(0, 0, 0);
        y += GH;

        // Column headers
        need(TH);
        pdf.setFillColor(55, 65, 81);
        pdf.setDrawColor(75, 85, 99);
        pdf.rect(ML, y, CW, TH, 'FD');
        bold(7);
        pdf.setTextColor(255, 255, 255);
        cx = ML;
        ['VOUCHER NO.', 'PAYEE', 'DESCRIPTION', 'CHECK NO.', 'REF NO.', 'AMOUNT'].forEach((h, i) => {
          if (i < 3) pdf.text(h, cx + 2.5, y + 4.3);
          else       pdf.text(h, cx + dCols[i] - 2.5, y + 4.3, { align: 'right' });
          cx += dCols[i];
        });
        pdf.setTextColor(0, 0, 0);
        y += TH;

        let sub = 0;
        bLines.forEach((l, idx) => {
          need(RH);
          if (idx % 2 === 1) { pdf.setFillColor(248, 250, 252); pdf.rect(ML, y, CW, RH, 'F'); }
          pdf.setDrawColor(209, 213, 219);
          pdf.rect(ML, y, CW, RH, 'S');
          pdf.setDrawColor(0, 0, 0);

          cx = ML;
          reg(7.5);
          pdf.setTextColor(194, 65, 12);
          pdf.text(l.voucherId || '\u2014', cx + 2, y + 3.8);
          pdf.setTextColor(0, 0, 0);
          cx += dCols[0];

          pdf.text(pdf.splitTextToSize(l.contact || '\u2014', dCols[1] - 4)[0], cx + 2, y + 3.8);
          cx += dCols[1];

          pdf.text(pdf.splitTextToSize(l.description || l.voucherType || '\u2014', dCols[2] - 4)[0], cx + 2, y + 3.8);
          cx += dCols[2];

          pdf.text(l.checkNo || '\u2014', cx + dCols[3] - 2.5, y + 3.8, { align: 'right' });
          cx += dCols[3];
          pdf.text(l.refNo || '\u2014', cx + dCols[4] - 2.5, y + 3.8, { align: 'right' });
          cx += dCols[4];

          bold(7.5);
          pdf.text(`P ${fmtN(l.amount)}`, cx + dCols[5] - 2.5, y + 3.8, { align: 'right' });

          sub += Number(l.amount) || 0;
          y += RH;
        });

        // Subtotal row
        need(RH + 1);
        pdf.setFillColor(249, 250, 251);
        pdf.setDrawColor(209, 213, 219);
        pdf.rect(ML, y, CW, RH + 1, 'FD');
        bold(8);
        pdf.text('Subtotal', ML + CW - dCols[dCols.length - 1] - 4, y + 4.2, { align: 'right' });
        pdf.text(`P ${fmtN(sub)}`, ML + CW - 2.5, y + 4.2, { align: 'right' });
        pdf.setDrawColor(0, 0, 0);
        y += RH + 1;

        // "Total for [bank]" line
        need(6);
        reg(8);
        pdf.setTextColor(55, 65, 81);
        pdf.text(`Total for ${bankName}:`, ML + CW - dCols[dCols.length - 1] - 4, y + 3.8, { align: 'right' });
        bold(8);
        pdf.text(`P ${fmtN(sub)}`, ML + CW - 2.5, y + 3.8, { align: 'right' });
        pdf.setTextColor(0, 0, 0);
        y += 7;
      };

      // Main disbursement groups
      const groups = {};
      mainLines.forEach(l => { const k = l.bankCode || 'OTHER'; if (!groups[k]) groups[k] = []; groups[k].push(l); });
      Object.entries(groups).forEach(([bankCode, bLines]) => {
        const acc = bankAccounts.find(a => a.code === bankCode);
        drawDisbGroup(bLines, acc ? acc.name : bankCode, false);
      });

      // Late approvals
      if (lateLines.length > 0) {
        need(9);
        pdf.setFillColor(255, 251, 235);
        pdf.setDrawColor(252, 211, 77);
        pdf.rect(ML, y, CW, 7, 'FD');
        bold(9);
        pdf.setTextColor(146, 64, 14);
        pdf.text('\u25BA FOR LATE APPROVALS', ML + 4, y + 4.8);
        pdf.setTextColor(0, 0, 0);
        pdf.setDrawColor(0, 0, 0);
        y += 9;

        const lateGroups = {};
        lateLines.forEach(l => { const k = l.bankCode || 'OTHER'; if (!lateGroups[k]) lateGroups[k] = []; lateGroups[k].push(l); });
        Object.entries(lateGroups).forEach(([bankCode, bLines]) => {
          const acc = bankAccounts.find(a => a.code === bankCode);
          drawDisbGroup(bLines, acc ? acc.name : bankCode, true);
        });
      }

      // ── FOOTER ───────────────────────────────────────────────────────────────
      need(44);
      y += 8;

      const sigLabels = ['Prepared by', 'Reviewed by', 'Approved by', 'Noted by'];
      const sigNames  = [preparedName, reviewedName, approvedName, notedByName];
      const sigW = (CW * 0.58) / 4;

      bold(8);
      pdf.setTextColor(30, 41, 59);
      sigLabels.forEach((lbl, i) => pdf.text(lbl, ML + i * sigW + sigW / 2, y, { align: 'center' }));
      y += 18;

      pdf.setLineWidth(0.3);
      pdf.setDrawColor(55, 65, 81);
      sigLabels.forEach((_, i) => {
        const x0 = ML + i * sigW;
        pdf.line(x0, y, x0 + sigW - 3, y);
        if (sigNames[i]) {
          bold(7.5);
          pdf.setTextColor(0, 0, 0);
          const nLines = pdf.splitTextToSize(sigNames[i].toUpperCase(), sigW - 5);
          nLines.slice(0, 2).forEach((nl, ni) => pdf.text(nl, x0 + (sigW - 3) / 2, y + 4 + ni * 3.5, { align: 'center' }));
        }
      });
      pdf.setLineWidth(0.2);
      pdf.setDrawColor(0, 0, 0);

      // Summary box (right side)
      const boxX = ML + CW * 0.62;
      const boxW = CW * 0.38;
      const boxStartY = y - 18 - 8;

      pdf.setFillColor(55, 65, 81);
      pdf.setDrawColor(55, 65, 81);
      pdf.rect(boxX, boxStartY, boxW, 6.5, 'FD');
      bold(8.5);
      pdf.setTextColor(255, 255, 255);
      pdf.text('SUMMARY', boxX + boxW / 2, boxStartY + 4.5, { align: 'center' });
      pdf.setTextColor(0, 0, 0);

      let bY = boxStartY + 6.5;
      const sumRows = [
        { label: 'Total Bank Balance (Before)', val: `P ${fmtN(totalBal)}`, red: false },
        { label: 'Less: Total Disbursements',    val: totalDisb > 0 ? `(P ${fmtN(totalDisb)})` : `P ${fmtN(0)}`, red: totalDisb > 0 },
        { label: 'Add: Expected Collection',     val: `P ${fmtN(expColl)}`, red: false },
      ];
      sumRows.forEach((row, idx) => {
        if (idx % 2 === 1) { pdf.setFillColor(248, 250, 252); pdf.rect(boxX, bY, boxW, 6, 'F'); }
        pdf.setDrawColor(209, 213, 219);
        pdf.rect(boxX, bY, boxW, 6, 'S');
        reg(7.5);
        pdf.text(row.label, boxX + 3, bY + 4);
        if (row.red) pdf.setTextColor(220, 38, 38);
        pdf.text(row.val, boxX + boxW - 3, bY + 4, { align: 'right' });
        pdf.setTextColor(0, 0, 0);
        pdf.setDrawColor(0, 0, 0);
        bY += 6;
      });

      // Total row
      pdf.setLineWidth(0.5);
      pdf.line(boxX, bY, boxX + boxW, bY);
      pdf.setLineWidth(0.2);
      pdf.setFillColor(243, 244, 246);
      pdf.setDrawColor(55, 65, 81);
      pdf.rect(boxX, bY, boxW, 7.5, 'FD');
      pdf.setDrawColor(0, 0, 0);
      bold(9);
      pdf.text('Bank Balance After', boxX + 3, bY + 5.2);
      if (balAfter < 0) {
        pdf.setTextColor(220, 38, 38);
        pdf.text(`(P ${fmtN(Math.abs(balAfter))})`, boxX + boxW - 3, bY + 5.2, { align: 'right' });
        pdf.setTextColor(0, 0, 0);
      } else {
        pdf.text(`P ${fmtN(balAfter)}`, boxX + boxW - 3, bY + 5.2, { align: 'right' });
      }

      pdf.save(`${r.reportId || r.id}.pdf`);
    } catch (e) {
      showToast('PDF error: ' + e.message);
      console.error('PDF generation error:', e);
    } finally {
      setPdfLoading(null);
    }
  };

  // ── Status helpers ────────────────────────────────────────────────────────────
  const nextStatuses = (status) => {
    if (status === 'Pending')           return ['For Verification','Voided'];
    if (status === 'For Verification') return ['Verified','Rejected','Voided'];
    if (status === 'Verified')         return ['For Approval','Rejected','Voided'];
    if (status === 'For Approval')     return ['Approved','Rejected','Voided'];
    if (status === 'Approved')         return ['Disbursed','Voided'];
    return [];
  };
  const canEdit = (r) => ['Pending','For Verification','Verified'].includes(r.status||'Pending');

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
            {label:'Pending',value:kpis.draft,sub:'not yet submitted',color:'#64748b',bg:'#f8fafc',border:'#e2e8f0',icon:<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>},
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
                const ns = nextStatuses(r.status||'Pending');
                return [
                  <tr key={r.id} style={{cursor:'pointer'}} onClick={()=>setViewModal(r)}>
                    <td style={{textAlign:'center'}} onClick={e=>e.stopPropagation()}>
                      <input type="checkbox" checked={selected.has(r.id)} onChange={()=>toggleSel(r.id)} />
                    </td>
                    <td onClick={e=>e.stopPropagation()}>
                      <a style={{fontWeight:900,color:'#f97316',textDecoration:'underline',cursor:'pointer'}} onClick={()=>setViewModal(r)}>
                        {r.reportId||r.id}
                      </a>
                    </td>
                    <td>{r.date||'—'}</td>
                    <td>{r.bankCode||'MULTIPLE'}</td>
                    <td style={{textAlign:'right',fontWeight:700}}>{fmt(r.totalAmount)}</td>
                    <td style={{textAlign:'right'}}>{fmt(r.expectedCollection)}</td>
                    <td><StatusPill status={r.status||'Pending'} /></td>
                    <td style={{textAlign:'center'}} onClick={e=>e.stopPropagation()}>
                      <div style={{display:'inline-block'}} ref={openMenuId===r.id ? menuRef : null}>
                        <button
                          className="btn btn-ghost btn-xs"
                          style={{fontWeight:900,letterSpacing:2,padding:'4px 10px',fontSize:15,lineHeight:1}}
                          onClick={(e)=>{
                            if (openMenuId===r.id) { setOpenMenuId(null); return; }
                            const rect = e.currentTarget.getBoundingClientRect();
                            setMenuPos({ top: rect.bottom + 4, right: window.innerWidth - rect.right });
                            setOpenMenuId(r.id);
                          }}
                          title="Actions"
                        >···</button>
                        {openMenuId === r.id && (
                          <div style={{
                            position:'fixed',right:menuPos.right,top:menuPos.top,zIndex:9999,
                            background:'#fff',border:'1px solid #e5e7eb',borderRadius:10,
                            boxShadow:'0 8px 24px rgba(0,0,0,.12)',minWidth:160,padding:'4px 0',
                          }}>
                            <button className="km-item" onClick={()=>{setViewModal(r);setOpenMenuId(null);}}>View Details</button>
                            {canEdit(r) && <button className="km-item" onClick={()=>{openEdit(r);setOpenMenuId(null);}}>Edit</button>}
                            {(r.status==='Pending'||r.status==='Rejected') && (
                              <button className="km-item" style={{color:'#1d4ed8'}} onClick={()=>{submitFromRow(r);setOpenMenuId(null);}}>Submit for Approval</button>
                            )}
                            {ns.filter(s=>s!=='For Verification').map(s=>(
                              <button key={s} className={`km-item${s==='Rejected'||s==='Voided'?' km-item-danger':''}`}
                                onClick={()=>{setStatusModal({report:r,action:'admin',newStatus:s,reason:s==='Rejected'?'':null});setOpenMenuId(null);}}>
                                → {s}
                              </button>
                            ))}
                            <hr className="km-divider" />
                            <button className="km-item" disabled={!!pdfLoading} onClick={()=>{openPdf(r);setOpenMenuId(null);}}>{pdfLoading===r.id ? '⏳ Generating…' : 'Print / PDF'}</button>
                            {(r.status||'Pending')==='Pending' && (
                              <button className="km-item km-item-danger" onClick={()=>{deleteReport(r);setOpenMenuId(null);}}>Delete</button>
                            )}
                          </div>
                        )}
                      </div>
                    </td>
                  </tr>,
                  isExpanded && (
                    <tr key={r.id+'-exp'} className="expand-row">
                      <td colSpan={8}>
                        <div style={{marginBottom:8,fontSize:12,color:'#64748b'}}>
                          <strong>Created by:</strong> {r.createdBy||'—'} &nbsp;|&nbsp; <strong>Verified by:</strong> {r.reviewedBy||'—'} &nbsp;|&nbsp; <strong>Approved by:</strong> {r.approvedBy||'—'}
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
        <div className="backdrop" onClick={()=>closeModal()}>
          <div className="modal" onClick={e=>e.stopPropagation()}>
            <div className="modal-h">
              <strong>{editing ? `Edit Report — ${editing.reportId||editing.id}` : 'New Disbursement Report'}</strong>
              <button className="btn btn-ghost btn-sm" onClick={()=>closeModal()}>✕</button>
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
                <span style={{fontSize:10,fontWeight:600,color:'#94a3b8'}}>Approved &amp; For Disbursement only</span>
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
                    {/* header */}
                    <div className="elig-header">
                      <span/>
                      <span>Voucher No.</span>
                      <span>Type</span>
                      <span>Payee</span>
                      <span>Purpose</span>
                      <span>Payment From</span>
                      <span>Check Date</span>
                      <span style={{textAlign:'right'}}>Amount</span>
                    </div>
                    {eligible.map(item => {
                      const checked  = drLines.some(l=>l._eligKey===item.key);
                      const bankName = bankAccounts.find(a=>a.code===item.bankCode)?.name || item.bankCode || '—';
                      return (
                        <div key={item.key} className="elig-check" style={{background:checked?'#fff7ed':'#fff',cursor:'pointer'}} onClick={()=>toggleItem(item)}>
                          <input type="checkbox" checked={checked} readOnly style={{width:16,height:16,accentColor:'#f97316',flexShrink:0}} />
                          {/* Voucher No. */}
                          <div style={{fontSize:12,overflow:'hidden'}}>
                            <strong style={{color:'#f97316',whiteSpace:'nowrap'}}>{item.voucherId}</strong>
                            {item.isPayrollLine && <span style={{marginLeft:4,fontSize:10,background:'#eff6ff',color:'#1d4ed8',padding:'1px 4px',borderRadius:4,fontWeight:700}}>L{item.lineNo}</span>}
                          </div>
                          {/* Type */}
                          <div style={{fontSize:11,display:'flex',flexWrap:'wrap',gap:2}}>
                            <span style={{color:'#64748b',fontWeight:600,whiteSpace:'nowrap'}}>{item.voucherType}</span>
                            {item.loanId && <span style={{fontSize:10,background:'#fdf4ff',color:'#7c3aed',padding:'1px 4px',borderRadius:4,fontWeight:700,border:'1px solid #e9d5ff',whiteSpace:'nowrap'}}>LOAN</span>}
                          </div>
                          {/* Payee */}
                          <span style={{fontSize:12,color:'#0b1220',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{item.contact||'—'}</span>
                          {/* Purpose */}
                          <span style={{fontSize:11,color:'#64748b',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{item.description||'—'}</span>
                          {/* Payment From */}
                          <span style={{fontSize:11,color:'#374151',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}} title={bankName}>{bankName}</span>
                          {/* Check Date */}
                          <span style={{fontSize:11,color:'#94a3b8',whiteSpace:'nowrap'}}>{item.checkDate||'—'}</span>
                          {/* Amount */}
                          <span style={{fontWeight:700,textAlign:'right',fontSize:13,whiteSpace:'nowrap'}}>{fmt(item.amount)}</span>
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
                  {/* header */}
                  <div className="elig-header" style={{background:'#fffbeb',borderBottom:'2px solid #fde68a'}}>
                    <span/>
                    <span>Voucher No.</span>
                    <span>Type</span>
                    <span>Payee</span>
                    <span>Purpose</span>
                    <span>Payment From</span>
                    <span>Check Date</span>
                    <span style={{textAlign:'right'}}>Amount</span>
                  </div>
                  {late.map(item => {
                    const checked  = drLines.some(l=>l._eligKey===item.key);
                    const bankName = bankAccounts.find(a=>a.code===item.bankCode)?.name || item.bankCode || '—';
                    return (
                      <div key={item.key} className="elig-check elig-late" style={{background:checked?'#fefce8':'#fffbeb',cursor:'pointer'}} onClick={()=>toggleItem(item)}>
                        <input type="checkbox" checked={checked} readOnly style={{width:16,height:16,accentColor:'#f59e0b',flexShrink:0}} />
                        {/* Voucher No. */}
                        <div style={{fontSize:12,overflow:'hidden'}}>
                          <strong style={{color:'#d97706',whiteSpace:'nowrap'}}>{item.voucherId}</strong>
                          {item.isPayrollLine && <span style={{marginLeft:4,fontSize:10,background:'#eff6ff',color:'#1d4ed8',padding:'1px 4px',borderRadius:4,fontWeight:700}}>L{item.lineNo}</span>}
                        </div>
                        {/* Type */}
                        <div style={{fontSize:11,display:'flex',flexWrap:'wrap',gap:2}}>
                          <span style={{color:'#64748b',fontWeight:600,whiteSpace:'nowrap'}}>{item.voucherType}</span>
                          {item.loanId && <span style={{fontSize:10,background:'#fdf4ff',color:'#7c3aed',padding:'1px 4px',borderRadius:4,fontWeight:700,border:'1px solid #e9d5ff',whiteSpace:'nowrap'}}>LOAN</span>}
                        </div>
                        <span style={{fontSize:12,color:'#0b1220',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{item.contact||'—'}</span>
                        <span style={{fontSize:11,color:'#64748b',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{item.description||'—'}</span>
                        <span style={{fontSize:11,color:'#374151',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}} title={bankName}>{bankName}</span>
                        <span style={{fontSize:11,color:'#92400e',fontWeight:700,whiteSpace:'nowrap'}}>{item.checkDate||'—'}</span>
                        <span style={{fontWeight:700,textAlign:'right',fontSize:13,whiteSpace:'nowrap'}}>{fmt(item.amount)}</span>
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
                      <tr><th>#</th><th>Voucher ID</th><th>Type</th><th>Contact / Description</th><th>Bank</th><th>Check No.</th><th style={{textAlign:'right'}}>Amount</th><th></th></tr>
                    </thead>
                    <tbody>
                      {drLines.map((l,i) => {
                        const bankName = bankAccounts.find(a=>a.code===l.bankCode)?.name || l.bankCode || '—';
                        return (
                        <tr key={l._key}>
                          <td style={{color:'#94a3b8',fontWeight:700,width:32,textAlign:'center'}}>{i+1}</td>
                          <td style={{fontWeight:700,color:'#f97316'}}>
                            {l.voucherId}
                            {l.isPayrollLine && <span style={{marginLeft:4,fontSize:10,background:'#eff6ff',color:'#1d4ed8',padding:'1px 4px',borderRadius:4,fontWeight:700}}>L{l.lineNo}</span>}
                          </td>
                          <td>{l.voucherType}</td>
                          <td style={{maxWidth:160,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{l.contact||l.description||'—'}</td>
                          <td style={{color:'#374151'}} title={bankName}>{bankName}</td>
                          <td style={{color:'#374151'}}>{l.checkNo||'—'}</td>
                          <td style={{textAlign:'right',fontWeight:700,color:'#0b1220',paddingRight:8}}>{fmt(l.amount||0)}</td>
                          <td><button className="btn btn-ghost btn-xs" style={{color:'#dc2626'}} onClick={()=>setDrLines(prev=>prev.filter(x=>x._key!==l._key))}>✕</button></td>
                        </tr>
                        );
                      })}
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
              <button className="btn btn-ghost" onClick={()=>closeModal()}>Cancel</button>
              <button className="btn btn-ghost" onClick={()=>saveReport('Pending')} disabled={saving}>Save Draft</button>
              <button className="btn btn-primary" onClick={()=>saveReport('For Verification')} disabled={saving}>{saving?'Saving…':'Submit for Approval'}</button>
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
                <StatusPill status={viewModal.status||'Pending'} />
                <button className="btn btn-ghost btn-sm" onClick={()=>setViewModal(null)}>✕</button>
              </div>
            </div>
            <div className="modal-b">
              {/* Status progress bar — same pattern as Vouchers */}
              {(() => {
                const DR_STEPS = ['Pending','For Verification','Verified','For Approval','Approved','Disbursed'];
                const cur      = viewModal.status || 'Draft';
                const stepIdx  = DR_STEPS.indexOf(cur); // -1 for Rejected/Voided
                return (
                  <div style={{ marginBottom: 18 }}>
                    <div style={{ position: 'relative' }}>
                      <div style={{ position:'absolute', top:10, left:`${100/DR_STEPS.length/2}%`, right:`${100/DR_STEPS.length/2}%`, height:2, background:'#e2e8f0', zIndex:0 }} />
                      {stepIdx > 0 && (
                        <div style={{ position:'absolute', top:10, left:`${100/DR_STEPS.length/2}%`, width:`calc(${stepIdx/(DR_STEPS.length-1)} * (100% - ${100/DR_STEPS.length}%))`, height:2, background:'#22c55e', zIndex:1, transition:'width .3s' }} />
                      )}
                      <div style={{ display:'flex', position:'relative', zIndex:2 }}>
                        {DR_STEPS.map((s, i) => {
                          const done    = stepIdx > i;
                          const current = stepIdx === i;
                          const bg = done ? '#22c55e' : current ? '#f97316' : '#e2e8f0';
                          const tc = done || current ? '#fff' : '#94a3b8';
                          return (
                            <div key={s} style={{ flex:1, display:'flex', flexDirection:'column', alignItems:'center' }}>
                              <div style={{ width:22, height:22, borderRadius:'50%', background:bg, display:'flex', alignItems:'center', justifyContent:'center', fontSize:10, fontWeight:800, color:tc }}>
                                {done ? '✓' : i + 1}
                              </div>
                              <div style={{ fontSize:9, marginTop:4, fontWeight: current ? 800 : 500, color: current ? '#f97316' : '#64748b', whiteSpace:'nowrap', textAlign:'center' }}>{s}</div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                    {cur === 'Rejected' && viewModal.rejectReason && (
                      <div style={{ marginTop:10, background:'#fef2f2', border:'1px solid #fecaca', borderRadius:8, padding:'8px 12px', fontSize:12 }}>
                        <strong style={{ color:'#dc2626' }}>Reject Reason: </strong>{viewModal.rejectReason}
                      </div>
                    )}
                  </div>
                );
              })()}
              {/* Meta row */}
              <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(150px,1fr))',gap:12,marginBottom:20}}>
                {[
                  ['Date',           viewModal.date],
                  ['Total Amount',   fmt(viewModal.totalAmount)],
                  ['Exp. Collection',fmt(viewModal.expectedCollection)],
                  ['Created By',     viewMeta.preparedName || viewModal.createdBy || '—'],
                  ['Verified By',    viewModal.reviewedBy ? (viewMeta.reviewedName || viewModal.reviewedBy) : '—'],
                  ['Approved By',    viewModal.approvedBy ? (viewMeta.approvedName || viewModal.approvedBy) : '—'],
                ].map(([k,v])=>(
                  <div key={k}><div style={{fontSize:10,fontWeight:800,color:'#94a3b8',textTransform:'uppercase',letterSpacing:'.06em',marginBottom:4}}>{k}</div><div style={{fontWeight:700}}>{v||'—'}</div></div>
                ))}
              </div>
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
                {canReviewOrApprove && ['For Verification','Verified','For Approval'].includes(viewModal.status||'') && (
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
                        {canReviewOrApprove && ['For Verification','Verified','For Approval'].includes(viewModal.status||'') && <th></th>}
                      </tr>
                    </thead>
                    <tbody>
                      {(viewModal.lines||[]).map((l,i)=>{
                        const liveV    = vouchers.find(v=>(v.voucherId||v.id)===l.voucherId);
                        const vType    = l.voucherType || liveV?.voucherType || '';
                        let liveCode   = l.bankCode || '';
                        if (liveV) {
                          if (PAYROLL_TYPES.includes(vType) && l.srcLineNo != null) {
                            const pl = (liveV.lines||[]).find(x=>x.lineNo===l.srcLineNo);
                            liveCode = pl?.lineBankCode || liveV.paymentFromAccountCode || l.bankCode || '';
                          } else if (vType !== 'CHECK') {
                            liveCode = liveV.paymentFromAccountCode || l.bankCode || '';
                          }
                        }
                        const bankName = liveCode ? (bankAccounts.find(a=>a.code===liveCode)?.name || liveCode) : '—';
                        return (
                        <tr key={i}>
                          <td>{l.lineNo||i+1}</td>
                          <td style={{fontWeight:700,color:'#f97316'}}>
                            {l.voucherId||'—'}
                            {l.isPayrollLine && <span style={{marginLeft:4,fontSize:10,background:'#eff6ff',color:'#1d4ed8',padding:'1px 4px',borderRadius:4,fontWeight:700}}>L{l.srcLineNo||l.lineNo}</span>}
                          </td>
                          <td>{l.voucherType||'—'}</td>
                          <td>{l.contact||'—'}</td>
                          <td>{bankName}</td>
                          <td>{l.checkNo||'—'}</td>
                          <td>{l.refNo||'—'}</td>
                          <td style={{textAlign:'right',fontWeight:700}}>{fmt(l.amount)}</td>
                          {canReviewOrApprove && ['For Verification','Verified','For Approval'].includes(viewModal.status||'') && (
                            <td>
                              <button className="btn btn-ghost btn-xs" style={{color:'#dc2626'}} onClick={()=>removeLine(i)}>Remove</button>
                            </td>
                          )}
                        </tr>
                        );
                      })}
                      <tr><td colSpan={canReviewOrApprove&&['For Verification','Verified','For Approval'].includes(viewModal.status||'')?8:7} style={{textAlign:'right',fontWeight:800,color:'#64748b',fontSize:12}}>TOTAL</td><td style={{textAlign:'right',fontWeight:900}}>{fmt(viewModal.totalAmount)}</td></tr>
                    </tbody>
                  </table>
              }
              {viewModal.notes && <div style={{marginTop:10,fontSize:12,color:'#64748b'}}><strong>Notes:</strong> {viewModal.notes}</div>}
            </div>
            <div className="modal-f">
              <button className="btn btn-ghost btn-sm" disabled={pdfLoading===viewModal?.id} onClick={()=>openPdf(viewModal)}>{pdfLoading===viewModal?.id ? '⏳ Generating…' : '🖨 Print PDF'}</button>
              {canEdit(viewModal) && <button className="btn btn-ghost" onClick={()=>{setViewModal(null);openEdit(viewModal);}}>Edit</button>}
              {/* Maker: submit Pending or Rejected */}
              {['Pending','Rejected'].includes(viewModal.status||'Pending') && (viewRoute.isMaker || isAdmin) && (
                <button className="btn btn-primary btn-sm" onClick={()=>{
                  setViewModal(null);
                  setStatusModal({ report:viewModal, action:'submit', newStatus: viewRoute.hasVerifier ? 'For Verification' : 'For Approval', reason:null });
                }}>Submit for Approval</button>
              )}
              {/* Verifier: verify / reject */}
              {viewModal.status === 'For Verification' && (viewRoute.isVerifier || isAdmin) && (<>
                <button className="btn btn-primary btn-sm" style={{background:'#16a34a'}} onClick={()=>{
                  setViewModal(null);
                  setStatusModal({ report:viewModal, action:'verify', newStatus:'Verified', reason:null });
                }}>✓ Verify</button>
                <button className="btn btn-ghost btn-sm" style={{color:'#dc2626',border:'1px solid #fecaca'}} onClick={()=>{
                  setViewModal(null);
                  setStatusModal({ report:viewModal, action:'reject', newStatus:'Rejected', reason:'' });
                }}>✗ Reject</button>
              </>)}
              {/* Verifier (or admin): forward Verified → For Approval */}
              {viewModal.status === 'Verified' && (viewRoute.isVerifier || isAdmin) && (
                <button className="btn btn-primary btn-sm" onClick={()=>{
                  setViewModal(null);
                  setStatusModal({ report:viewModal, action:'forward', newStatus:'For Approval', reason:null });
                }}>→ Forward for Approval</button>
              )}
              {/* Approver: approve / reject */}
              {viewModal.status === 'For Approval' && (viewRoute.isApprover || isAdmin) && (<>
                <button className="btn btn-primary btn-sm" style={{background:'#16a34a'}} onClick={()=>{
                  setViewModal(null);
                  setStatusModal({ report:viewModal, action:'approve', newStatus:'Approved', reason:null });
                }}>✓ Approve</button>
                <button className="btn btn-ghost btn-sm" style={{color:'#dc2626',border:'1px solid #fecaca'}} onClick={()=>{
                  setViewModal(null);
                  setStatusModal({ report:viewModal, action:'reject', newStatus:'Rejected', reason:'' });
                }}>✗ Reject</button>
              </>)}
              {/* Approver (or admin): mark disbursed */}
              {viewModal.status === 'Approved' && (viewRoute.isApprover || isAdmin) && (
                <button className="btn btn-primary btn-sm" style={{background:'#0ea5e9'}} onClick={()=>{
                  setViewModal(null);
                  setStatusModal({ report:viewModal, action:'disburse', newStatus:'Disbursed', reason:null });
                }}>✓ Mark as Disbursed</button>
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
              <strong>
                {statusModal.action==='verify'   ? 'Verify Report' :
                 statusModal.action==='forward'  ? 'Forward for Approval' :
                 statusModal.action==='approve'  ? 'Approve Report' :
                 statusModal.action==='disburse' ? 'Mark as Disbursed' :
                 statusModal.action==='reject'   ? 'Reject Report' :
                 statusModal.action==='submit'   ? 'Submit for Approval' :
                 `Update Status → ${statusModal.newStatus}`}
              </strong>
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
              <button className="btn btn-primary" style={statusModal.action==='reject'?{background:'#dc2626'}:{}} onClick={doStatusUpdate} disabled={saving||(statusModal.newStatus==='Rejected'&&!statusModal.reason?.trim())}>
                {saving?'Saving…':
                 statusModal.action==='verify'   ? 'Confirm Verify' :
                 statusModal.action==='forward'  ? 'Confirm Forward' :
                 statusModal.action==='approve'  ? 'Confirm Approve' :
                 statusModal.action==='disburse' ? 'Confirm Disbursed' :
                 statusModal.action==='reject'   ? 'Confirm Reject' :
                 statusModal.action==='submit'   ? 'Confirm Submit' :
                 `Confirm — ${statusModal.newStatus}`}
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

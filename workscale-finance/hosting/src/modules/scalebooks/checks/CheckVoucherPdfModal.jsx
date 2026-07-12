import { useState, useEffect } from 'react';
import { getSettings, listUsers } from '../../../lib/api.js';
import jsPDF from 'jspdf';

function fmtDate(str) {
  if (!str) return '—';
  const [y, m, d] = str.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-US', {
    month: 'long', day: 'numeric', year: 'numeric',
  });
}

function fmtN(n) {
  return new Intl.NumberFormat('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n || 0);
}

// ── Amount in words (Philippine peso) ─────────────────────────────────────
const ONES  = ['','One','Two','Three','Four','Five','Six','Seven','Eight','Nine',
                'Ten','Eleven','Twelve','Thirteen','Fourteen','Fifteen','Sixteen',
                'Seventeen','Eighteen','Nineteen'];
const TENS  = ['','','Twenty','Thirty','Forty','Fifty','Sixty','Seventy','Eighty','Ninety'];

function toWords(n) {
  const num = Math.round(Number(n) || 0);
  if (num === 0) return 'Zero Pesos Only';
  function chunk(x) {
    if (x === 0) return '';
    if (x < 20)  return ONES[x] + ' ';
    if (x < 100) return TENS[Math.floor(x / 10)] + (x % 10 ? '-' + ONES[x % 10] : '') + ' ';
    return ONES[Math.floor(x / 100)] + ' Hundred ' + chunk(x % 100);
  }
  const b = [
    { v: 1_000_000_000, s: 'Billion ' },
    { v: 1_000_000,     s: 'Million ' },
    { v: 1_000,         s: 'Thousand ' },
    { v: 1,             s: '' },
  ];
  let words = '';
  let rem = num;
  for (const { v, s } of b) {
    if (rem >= v) {
      words += chunk(Math.floor(rem / v)) + s;
      rem %= v;
    }
  }
  return words.trim() + ' Peso' + (num !== 1 ? 's' : '') + ' Only';
}

// ── Modal & paper styles ──────────────────────────────────────────────────
const MODAL_CSS = `
  .cvpdf-backdrop  { position:fixed; inset:0; background:rgba(15,23,42,.65); display:flex; align-items:center; justify-content:center; z-index:300; padding:16px; }
  .cvpdf-modal     { width:min(700px,98vw); max-height:94vh; background:#fff; border-radius:16px; display:flex; flex-direction:column; overflow:hidden; box-shadow:0 24px 64px rgba(0,0,0,.35); }
  .cvpdf-hdr       { display:flex; align-items:center; justify-content:space-between; padding:14px 20px; border-bottom:1px solid #e5e7eb; background:#f8fafc; flex-shrink:0; }
  .cvpdf-hdr strong{ font-size:14px; font-weight:900; color:#0b1220; }
  .cvpdf-body      { flex:1; overflow-y:auto; background:#9ca3af; padding:20px; display:flex; justify-content:center; }
  .cvpdf-paper     { background:#fff; width:595px; min-height:841px; padding:28px 36px; box-shadow:0 2px 20px rgba(0,0,0,.2); font-family:"Courier New",Courier,monospace; font-size:11px; color:#000; flex-shrink:0; box-sizing:border-box; }
  .cvpdf-logo      { display:block; max-height:40px; max-width:150px; object-fit:contain; margin-bottom:3px; }
  .cvpdf-co-name   { font-weight:bold; font-size:9px; }
  .cvpdf-doc-title { font-weight:bold; text-decoration:underline; text-transform:uppercase; font-size:14px; }
  .cvpdf-sec       { font-weight:bold; text-transform:uppercase; margin:10px 0 4px; border-bottom:1px dashed #000; padding-bottom:2px; font-size:9px; }
  .cvpdf-tbl       { width:100%; border-collapse:collapse; margin-bottom:10px; border:1px solid #000; }
  .cvpdf-tbl th    { font-weight:bold; text-transform:uppercase; text-align:center; border:1px solid #000; border-bottom:2px solid #000; padding:4px 6px; background:#fff; color:#000; font-size:9px; }
  .cvpdf-tbl td    { border:1px solid #000; padding:4px 6px; vertical-align:top; background:#fff; color:#000; font-size:10px; }
  .cvpdf-tbl .amt  { text-align:right; white-space:nowrap; }
  .cvpdf-tbl .tr-total td { font-weight:bold; border-top:2px solid #000; }
  .cvpdf-pay-tbl td { font-size:9px; line-height:1.3; }
  .cvpdf-pay-cell   { overflow:hidden; display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; }
  .cvpdf-words-box { border:1px dashed #000; padding:6px 10px; margin-bottom:10px; min-height:28px; font-size:10px; }
  .cvpdf-sigs      { width:100%; border-collapse:collapse; table-layout:fixed; margin-top:20px; }
  .cvpdf-sigs td   { border:none; padding-right:12px; vertical-align:top; }
  .cvpdf-sig-lbl   { font-weight:bold; margin-bottom:10px; text-align:left; font-size:10px; }
  .cvpdf-sig-line  { border-top:1px solid #000; padding-top:3px; font-weight:bold; text-transform:uppercase; text-align:center; font-size:8.5px; }
  .cvpdf-cut-line  { border-top:2px dashed #000; margin:18px 0 10px; text-align:center; font-size:9px; color:#444; padding-top:4px; letter-spacing:.15em; }
  .cvpdf-receipt   { border:1px solid #000; border-radius:2px; padding:12px 14px; margin-top:4px; }
  .cvpdf-receipt-title { font-weight:bold; text-transform:uppercase; text-align:center; border-bottom:2px solid #000; padding-bottom:5px; margin-bottom:8px; font-size:11px; letter-spacing:.06em; }
  .cvpdf-receipt-sigs  { width:100%; border-collapse:collapse; table-layout:fixed; margin-top:18px; }
  .cvpdf-receipt-sigs td { border:none; padding-right:10px; vertical-align:top; }
  .cvpdf-btn       { border:0; border-radius:10px; padding:9px 16px; font-weight:700; cursor:pointer; font-size:13px; font-family:inherit; transition:opacity .15s; display:inline-flex; align-items:center; gap:6px; }
  .cvpdf-btn:disabled { opacity:.55; cursor:not-allowed; }
  .cvpdf-btn-dl    { background:#f97316; color:#fff; }
  .cvpdf-btn-ghost { background:#f1f5f9; color:#0b1220; }
  .cvpdf-btn-ghost:hover { background:#e2e8f0; }
  .cvpdf-loading   { padding:64px; text-align:center; color:#e5e7eb; font-size:13px; font-family:Inter,system-ui,sans-serif; }
  @keyframes cvpdf-spin { to { transform:rotate(360deg); } }
`;

// ── Component ─────────────────────────────────────────────────────────────
export default function CheckVoucherPdfModal({ voucher, relatedChecks, bankAccounts, accounts = [], onClose }) {
  // Resolve an expense account code to its full display name
  const resolveAccount = (codeOrFull) => {
    if (!codeOrFull) return '—';
    if (codeOrFull.includes(' — ')) {
      const [c, ...rest] = codeOrFull.split(' — ');
      return `(${c.trim()}) ${rest.join(' — ').trim()}`;
    }
    const found = accounts.find(a => a.code === codeOrFull);
    return found ? `(${found.code}) ${found.name}` : codeOrFull;
  };

  const [profile,        setProfile]        = useState({});
  const [preparedByName, setPreparedByName] = useState('');
  const [checkedByName,  setCheckedByName]  = useState('');
  const [approvedByName, setApprovedByName] = useState('');
  const [loading,        setLoading]        = useState(true);
  const [generating,     setGenerating]     = useState(false);

  // ── Derive check rows (handle old single-doc multi-check schema) ──────────
  const checkRows = (() => {
    if (relatedChecks.length > 1) {
      // New schema: N individual docs, sort by lineNo
      return [...relatedChecks].sort((a, b) => (a.lineNo || 0) - (b.lineNo || 0));
    }
    if (relatedChecks.length === 1 && relatedChecks[0].isPartOfMultiple && voucher?.lines?.length > 1) {
      // Old schema: 1 doc that represents multiple checks — expand from voucher lines
      return voucher.lines.map((l, i) => ({
        ...relatedChecks[0],
        checkNumber: String(l.lineCheckNo || '').trim() || relatedChecks[0].checkNumber,
        checkDate:   l.lineCheckDate || relatedChecks[0].checkDate,
        amount:      Number(l.amount) || 0,
        _lineIdx:    i,
      }));
    }
    return relatedChecks;
  })();

  const totalAmount = checkRows.reduce((s, c) => s + (parseFloat(c.amount) || 0), 0);
  const isMultiple  = checkRows.length > 1;
  const bankAccount = bankAccounts?.find(a => a.code === voucher?.paymentFromAccountCode || a.id === voucher?.paymentFromAccountCode);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const creatorEmail = voucher?.createdBy || '__none__';
      const settings = await getSettings().catch(() => ({}));
      let usersByEmail = new Map();
      try {
        const users = await listUsers();
        usersByEmail = new Map(users.map(u => [(u.email||'').toLowerCase(), u]));
      } catch { /* non-admin — names fall back to emails */ }
      if (cancelled) return;

      setProfile(settings?.profile || {});
      const nameFor = (email) => usersByEmail.get((email||'').toLowerCase())?.fullName || email || '';
      setPreparedByName(nameFor(voucher?.createdBy) || voucher?.createdBy || '');

      const routes = settings?.approvalRouting?.routes || [];
      const route  = routes.find(r => r.documentType === 'Vouchers' && r.makerEmail === creatorEmail);
      const verifierEmail = route?.verifierEmail || '';
      const approverEmail = route?.approverEmail || '';
      setCheckedByName(nameFor(verifierEmail));
      setApprovedByName(nameFor(approverEmail));
      setLoading(false);
    }
    load();
    return () => { cancelled = true; };
  }, [voucher?.id, voucher?.createdBy]);

  // ── Programmatic jsPDF generation ─────────────────────────────────────────
  const handleDownload = async () => {
    setGenerating(true);
    try {
      const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
      const PW = 210, PH = 297;
      const ML = 15, MT = 14;
      const CW = PW - ML * 2;

      const reg  = (sz = 9)  => { pdf.setFont('courier', 'normal'); pdf.setFontSize(sz); };
      const bold = (sz = 9)  => { pdf.setFont('courier', 'bold');   pdf.setFontSize(sz); };

      const hline = (y, lw = 0.2) => {
        pdf.setLineWidth(lw);
        pdf.line(ML, y, ML + CW, y);
      };
      const dashLine = (y) => {
        pdf.setLineWidth(0.15);
        pdf.setLineDashPattern([0.8, 0.8], 0);
        pdf.line(ML, y, ML + CW, y);
        pdf.setLineDashPattern([], 0);
      };
      const vlines = (y0, h, cols) => {
        let x = ML;
        cols.forEach((w, i) => {
          x += w;
          if (i < cols.length - 1) { pdf.setLineWidth(0.15); pdf.line(x, y0, x, y0 + h); }
        });
      };

      let y = MT;
      const need = (h) => {
        if (y + h > PH - 15) { pdf.addPage(); y = MT; }
      };

      // ── HEADER ─────────────────────────────────────────────────────────────
      let logoBottomY = y;
      if (profile.logoBase64) {
        const imgFmt = (profile.logoBase64.match(/^data:image\/(\w+);/) || [])[1]?.toUpperCase() || 'PNG';
        const imgEl  = new Image();
        await new Promise(r => { imgEl.onload = r; imgEl.onerror = r; imgEl.src = profile.logoBase64; });
        const MAX_W = 38, MAX_H = 13;
        const asp  = (imgEl.naturalWidth || 1) / (imgEl.naturalHeight || 1);
        const imgW = asp > MAX_W / MAX_H ? MAX_W : MAX_H * asp;
        const imgH = asp > MAX_W / MAX_H ? MAX_W / asp : MAX_H;
        pdf.addImage(profile.logoBase64, imgFmt, ML, y, imgW, imgH, '', 'FAST');
        logoBottomY = y + imgH + 2;
      }
      reg(7.5);
      pdf.text(profile.companyName || 'Sentire Books', ML, logoBottomY + 3.5);

      // Document title
      bold(13);
      pdf.text('CHECK VOUCHER', PW / 2, y + 8, { align: 'center' });
      const titleW = pdf.getTextWidth('CHECK VOUCHER');
      pdf.setLineWidth(0.4);
      pdf.line(PW / 2 - titleW / 2, y + 9.5, PW / 2 + titleW / 2, y + 9.5);

      // Control info (right-aligned)
      reg(8.5);
      const vStatus  = voucher?.status || '—';
      const infoLines = [
        `Control No: ${voucher?.voucherId || '—'}`,
        `Date: ${fmtDate(voucher?.preparationDate)}`,
        `Status: ${vStatus}`,
        ...(voucher?.purposeCategory ? [`Purpose: ${voucher.purposeCategory}`] : []),
      ];
      infoLines.forEach((ln, i) => pdf.text(ln, ML + CW, y + 3.5 + i * 4.2, { align: 'right' }));

      y += 22;
      hline(y, 0.5);
      y += 5;

      // ── BANK & CHECK DETAILS ────────────────────────────────────────────────
      const bankLabel = bankAccount ? `${bankAccount.code} — ${bankAccount.name}` : (voucher?.paymentFromAccountCode || '—');
      const wordsText = toWords(totalAmount);
      reg(8.5);
      pdf.text(`Bank Account:  ${bankLabel}`, ML, y);
      y += 5;
      pdf.text(`Voucher Type:  ${isMultiple ? 'Multiple Checks' : 'Single Check'}`, ML, y);
      y += 5;
      bold(8); pdf.text('Amount in Words:', ML, y); reg(8.5); pdf.text(`  ${wordsText}`, ML + pdf.getTextWidth('Amount in Words:'), y);
      y += 7;
      hline(y, 0.2);
      y += 5;

      // ── CHECK SCHEDULE TABLE ───────────────────────────────────────────────
      bold(8.5);
      pdf.text('CHECK SCHEDULE', ML, y);
      y += 2.5; dashLine(y); y += 4;

      // Columns: CheckNo | Date | Payee | Amount | Status
      const SC1 = 30, SC2 = 26, SC3 = 62, SC4 = 30, SC5 = CW - SC1 - SC2 - SC3 - SC4;
      const SCHED_COLS = [SC1, SC2, SC3, SC4, SC5];
      const ROW = 7, PAD = 2;

      // Header
      need(ROW);
      pdf.setLineWidth(0.15);
      pdf.rect(ML, y, CW, ROW, 'S');
      vlines(y, ROW, SCHED_COLS);
      pdf.setLineWidth(0.35); hline(y + ROW, 0.35);
      bold(7.5);
      let cx = ML;
      ['CHECK NO.', 'DATE', 'PAY TO THE ORDER OF', 'AMOUNT', 'STATUS'].forEach((h, i) => {
        const w = SCHED_COLS[i];
        pdf.text(h, cx + w / 2, y + 4.5, { align: 'center' });
        cx += w;
      });
      y += ROW;

      // Data rows
      reg(8.5);
      checkRows.forEach(c => {
        need(ROW);
        pdf.setLineWidth(0.15);
        pdf.rect(ML, y, CW, ROW, 'S');
        vlines(y, ROW, SCHED_COLS);
        let dx = ML;
        pdf.text(String(c.checkNumber || '—'), dx + PAD, y + 4.5); dx += SC1;
        pdf.text(c.checkDate ? c.checkDate.slice(5).replace('-', '/') + '/' + c.checkDate.slice(0, 4) : '—', dx + PAD, y + 4.5); dx += SC2;
        const payeeLines = pdf.splitTextToSize(c.payeeName || '—', SC3 - PAD * 2);
        payeeLines.slice(0, 1).forEach(t => pdf.text(t, dx + PAD, y + 4.5)); dx += SC3;
        pdf.text(`P ${fmtN(c.amount)}`, dx + SC4 - PAD, y + 4.5, { align: 'right' }); dx += SC4;
        pdf.text(c.status || '—', dx + SC5 / 2, y + 4.5, { align: 'center' });
        y += ROW;
      });

      // Total row
      need(ROW);
      pdf.setLineWidth(0.35); hline(y, 0.35);
      pdf.setLineWidth(0.15);
      pdf.rect(ML, y, CW, ROW, 'S');
      pdf.line(ML + SC1 + SC2 + SC3, y, ML + SC1 + SC2 + SC3, y + ROW);
      bold(8.5);
      pdf.text('Total Amount', ML + SC1 + SC2 + SC3 - PAD, y + 4.5, { align: 'right' });
      pdf.text(`P ${fmtN(totalAmount)}`, ML + SC1 + SC2 + SC3 + SC4 - PAD, y + 4.5, { align: 'right' });
      y += ROW + 5;

      // ── PAYMENT DETAILS TABLE ──────────────────────────────────────────────
      bold(8.5);
      pdf.text('PAYMENT DETAILS', ML, y);
      y += 2.5; dashLine(y); y += 4;

      // Columns: Contact | Expense Acct | Description | Amount | Tax
      const PC1 = 35, PC2 = 40, PC3 = 50, PC4 = 28, PC5 = CW - PC1 - PC2 - PC3 - PC4;
      const PAY_COLS = [PC1, PC2, PC3, PC4, PC5];

      // Helper: draw column headers for Payment Details (called on first render + page breaks)
      const drawPayColHeaders = () => {
        need(ROW);
        pdf.setLineWidth(0.15);
        pdf.rect(ML, y, CW, ROW, 'S');
        vlines(y, ROW, PAY_COLS);
        pdf.setLineWidth(0.35); hline(y + ROW, 0.35);
        bold(7.5);
        let px = ML;
        ['CONTACT', 'EXPENSE ACCT', 'DESCRIPTION', 'AMOUNT', 'TAX'].forEach((h, i) => {
          const w = PAY_COLS[i];
          pdf.text(h, px + w / 2, y + 4.5, { align: 'center' });
          px += w;
        });
        y += ROW;
      };

      // Header
      drawPayColHeaders();

      // Data rows
      reg(7);
      const payLines = voucher?.lines || [];
      if (payLines.length === 0) {
        need(ROW);
        pdf.setLineWidth(0.15);
        pdf.rect(ML, y, CW, ROW, 'S'); vlines(y, ROW, PAY_COLS);
        pdf.text('—', ML + CW / 2, y + 4.5, { align: 'center' });
        y += ROW;
      } else {
        payLines.forEach(l => {
          const cLines = pdf.splitTextToSize(l.contact     || '—', PC1 - PAD * 2).slice(0, 2);
          const aLines = pdf.splitTextToSize(resolveAccount(l.expenseAccountCode || l.expenseAccount), PC2 - PAD * 2).slice(0, 2);
          const dLines = pdf.splitTextToSize(l.description || '—', PC3 - PAD * 2).slice(0, 2);
          const rowH   = Math.max(ROW, Math.max(cLines.length, aLines.length, dLines.length) * 3.5 + 3);
          const prevY  = y;
          need(rowH);
          if (y < prevY) { reg(7); drawPayColHeaders(); reg(7); } // re-draw headers after page break
          pdf.setLineWidth(0.15);
          pdf.rect(ML, y, CW, rowH, 'S'); vlines(y, rowH, PAY_COLS);
          let lx = ML;
          cLines.forEach((t, i) => pdf.text(t, lx + PAD, y + 4 + i * 3.5)); lx += PC1;
          aLines.forEach((t, i) => pdf.text(t, lx + PAD, y + 4 + i * 3.5)); lx += PC2;
          dLines.forEach((t, i) => pdf.text(t, lx + PAD, y + 4 + i * 3.5)); lx += PC3;
          pdf.text(`P ${fmtN(l.amount)}`, lx + PC4 - PAD, y + 4.5, { align: 'right' }); lx += PC4;
          const taxAmt = Number(l.taxAmt) || 0;
          pdf.text(taxAmt > 0 ? `P ${fmtN(taxAmt)}` : '—', lx + PC5 / 2, y + 4.5, { align: 'center' });
          y += rowH;
        });
      }

      // Gross total row
      need(ROW);
      pdf.setLineWidth(0.35); hline(y, 0.35);
      pdf.setLineWidth(0.15);
      pdf.rect(ML, y, CW, ROW, 'S');
      pdf.line(ML + PC1 + PC2 + PC3, y, ML + PC1 + PC2 + PC3, y + ROW);
      bold(8.5);
      pdf.text('Gross Total', ML + PC1 + PC2 + PC3 - PAD, y + 4.5, { align: 'right' });
      pdf.text(`P ${fmtN(totalAmount)}`, ML + PC1 + PC2 + PC3 + PC4 - PAD, y + 4.5, { align: 'right' });
      y += ROW + 5;

      // ── NOTES ──────────────────────────────────────────────────────────────
      if (voucher?.notes) {
        need(14);
        bold(8); pdf.text('Notes:', ML, y); y += 4;
        reg(8.5);
        const nLines = pdf.splitTextToSize(voucher.notes, CW);
        nLines.forEach(t => { need(5); pdf.text(t, ML, y); y += 4; });
        y += 3;
      }

      // ── SIGNATORIES ────────────────────────────────────────────────────────
      const sigs = [
        { label: 'Prepared by',  name: preparedByName },
        { label: 'Checked by',   name: checkedByName  },
        { label: 'Approved by',  name: approvedByName },
        { label: 'Noted by',     name: profile.voucherNotedBy || profile.notedBy || '' },
      ];
      const sigW = CW / 4;

      need(22);
      bold(8.5);
      sigs.forEach((s, i) => pdf.text(s.label, ML + i * sigW, y));
      y += 10;

      sigs.forEach((s, i) => {
        const x0 = ML + i * sigW;
        pdf.setLineWidth(0.3);
        pdf.line(x0, y, x0 + sigW - 4, y);
        if (s.name) {
          bold(7.5);
          const nLines = pdf.splitTextToSize(s.name.toUpperCase(), sigW - 5);
          nLines.forEach((nl, ni) => {
            pdf.text(nl, x0 + (sigW - 4) / 2, y + 4 + ni * 3.8, { align: 'center' });
          });
        }
      });
      y += 12;

      // ── CUT LINE ───────────────────────────────────────────────────────────
      // Move cut line + receipt to next page only if they won't fit on the current page
      const RCPT_H = 70;
      const spaceNeeded = 10 + RCPT_H; // cut line + receipt box
      if (y + spaceNeeded > PH - 15) {
        pdf.addPage();
        y = MT;
      }
      pdf.setLineWidth(0.3);
      pdf.setLineDashPattern([2, 2], 0);
      pdf.line(ML, y, ML + CW, y);
      pdf.setLineDashPattern([], 0);
      reg(8);
      pdf.text('\u2702  CUT HERE  \u2702', PW / 2, y + 4, { align: 'center' });
      y += 10;

      // ── ACKNOWLEDGEMENT RECEIPT ────────────────────────────────────────────
      // Box height: title(10) + body(15) + fields(10) + sig rows(2×14) + bottom pad = 70mm
      pdf.setLineWidth(0.4);
      pdf.rect(ML, y, CW, RCPT_H, 'S');

      // Title
      bold(10);
      pdf.text('ACKNOWLEDGEMENT RECEIPT', PW / 2, y + 8, { align: 'center' });
      pdf.setLineWidth(0.4);
      pdf.line(ML, y + 10, ML + CW, y + 10);

      // Body text
      reg(8.5);
      const body1 = `I/We hereby acknowledge receipt of the check(s) described in ${voucher?.voucherId || '—'},`;
      const body2 = `issued by ${profile.companyName || 'Sentire Books'} in good order and condition.`;
      pdf.text(body1, PW / 2, y + 16, { align: 'center' });
      pdf.text(body2, PW / 2, y + 21, { align: 'center' });

      const checkNos = checkRows.map(c => c.checkNumber).filter(Boolean).join(', ');
      reg(8.5);
      pdf.text(`Check No(s):   ${checkNos || '—'}`, ML + 8, y + 28);
      bold(8.5);
      pdf.text(`Total Amount:  P ${fmtN(totalAmount)}  (${toWords(totalAmount)})`, ML + 8, y + 33);

      // Signature block (2×2 grid) — starts at y+38, each row is 14mm, labels sit 2mm below each line
      const rY = y + 38;
      const hw = CW / 2 - 10;
      pdf.setLineWidth(0.25);
      // Row 1: Signature / Date
      pdf.line(ML + 8,           rY + 10, ML + 8 + hw,      rY + 10);
      pdf.line(ML + CW - 8 - hw, rY + 10, ML + CW - 8,      rY + 10);
      reg(7.5);
      pdf.text('Signature over Printed Name', ML + 8 + hw / 2,      rY + 13, { align: 'center' });
      pdf.text('Date Received',               ML + CW - 8 - hw / 2, rY + 13, { align: 'center' });
      // Row 2: Position / Contact
      pdf.setLineWidth(0.25);
      pdf.line(ML + 8,           rY + 24, ML + 8 + hw,      rY + 24);
      pdf.line(ML + CW - 8 - hw, rY + 24, ML + CW - 8,      rY + 24);
      pdf.text('Position / Title',            ML + 8 + hw / 2,      rY + 27, { align: 'center' });
      pdf.text('Contact Number',              ML + CW - 8 - hw / 2, rY + 27, { align: 'center' });

      pdf.save(`${voucher?.voucherId || voucher?.id || 'check-voucher'}.pdf`);
    } catch (e) {
      console.error('PDF generation error:', e);
    } finally {
      setGenerating(false);
    }
  };

  const checkNosDisplay = checkRows.map(c => c.checkNumber).filter(Boolean).join(', ');

  return (
    <>
      <style>{MODAL_CSS}</style>
      <div className="cvpdf-backdrop" onClick={onClose}>
        <div className="cvpdf-modal" onClick={e => e.stopPropagation()}>

          {/* Header bar */}
          <div className="cvpdf-hdr">
            <strong>PDF Preview — {voucher?.voucherId || voucher?.id}</strong>
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="cvpdf-btn cvpdf-btn-dl" onClick={handleDownload} disabled={loading || generating}>
                {generating
                  ? <><span style={{ width:12, height:12, border:'2px solid rgba(255,255,255,.4)', borderTopColor:'#fff', borderRadius:'50%', display:'inline-block', animation:'cvpdf-spin .7s linear infinite' }} /> Generating…</>
                  : <>⬇&nbsp; Download PDF</>}
              </button>
              <button className="cvpdf-btn cvpdf-btn-ghost" onClick={onClose}>✕ Close</button>
            </div>
          </div>

          {/* Paper area */}
          <div className="cvpdf-body">
            {loading ? (
              <div className="cvpdf-loading">Loading document…</div>
            ) : (
              <div className="cvpdf-paper">

                {/* Document header */}
                <table style={{ width:'100%', borderCollapse:'collapse', marginBottom:16, borderBottom:'2px solid #000' }}>
                  <tbody>
                    <tr>
                      <td style={{ width:'160px', verticalAlign:'middle', border:'none', paddingBottom:6 }}>
                        {(profile.logoBase64 || profile.logoUrl)
                          ? <><img src={profile.logoBase64 || profile.logoUrl} className="cvpdf-logo" alt="Logo" /><div className="cvpdf-co-name">{profile.companyName || 'Sentire Books'}</div></>
                          : <div className="cvpdf-co-name">{profile.companyName || 'Sentire Books'}</div>
                        }
                      </td>
                      <td style={{ textAlign:'center', verticalAlign:'middle', border:'none' }}>
                        <div className="cvpdf-doc-title">Check Voucher</div>
                      </td>
                      <td style={{ textAlign:'right', verticalAlign:'middle', border:'none', paddingBottom:6, whiteSpace:'nowrap', fontSize:'9px', lineHeight:'1.8' }}>
                        <div>Control No: {voucher?.voucherId || '—'}</div>
                        <div>Date: {fmtDate(voucher?.preparationDate)}</div>
                        <div>Status: {voucher?.status || '—'}</div>
                        {voucher?.purposeCategory && <div>Purpose: {voucher.purposeCategory}</div>}
                      </td>
                    </tr>
                  </tbody>
                </table>

                {/* Bank & Check Details */}
                <div style={{ fontSize:'10px', marginBottom:10, lineHeight:1.8 }}>
                  <div><strong>Bank Account:</strong> {bankAccount ? `${bankAccount.code} — ${bankAccount.name}` : (voucher?.paymentFromAccountCode || '—')}</div>
                  <div><strong>Voucher Type:</strong> {isMultiple ? 'Multiple Checks' : 'Single Check'}</div>
                  <div><strong>Amount in Words:</strong> {toWords(totalAmount)}</div>
                </div>

                {/* Check Schedule */}
                <div className="cvpdf-sec">Check Schedule</div>
                <table className="cvpdf-tbl">
                  <thead>
                    <tr>
                      <th style={{ width:'16%' }}>Check No.</th>
                      <th style={{ width:'14%' }}>Date</th>
                      <th>Pay to the Order of</th>
                      <th style={{ width:'16%', textAlign:'right' }}>Amount</th>
                      <th style={{ width:'12%' }}>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {checkRows.map((c, i) => (
                      <tr key={i}>
                        <td style={{ fontFamily:'monospace', fontWeight:700 }}>{c.checkNumber || '—'}</td>
                        <td>{c.checkDate || '—'}</td>
                        <td>{c.payeeName || '—'}</td>
                        <td className="amt">₱ {fmtN(c.amount)}</td>
                        <td style={{ textAlign:'center' }}>{c.status || '—'}</td>
                      </tr>
                    ))}
                    <tr className="tr-total">
                      <td colSpan={3} style={{ textAlign:'right', fontWeight:900 }}>Total Amount</td>
                      <td className="amt">₱ {fmtN(totalAmount)}</td>
                      <td />
                    </tr>
                  </tbody>
                </table>

                {/* Payment Details */}
                <div className="cvpdf-sec">Payment Details</div>
                <table className="cvpdf-tbl cvpdf-pay-tbl">
                  <thead>
                    <tr>
                      <th style={{ width:'16%' }}>Contact</th>
                      <th style={{ width:'20%' }}>Expense Acct</th>
                      <th>Description</th>
                      <th style={{ width:'15%', textAlign:'right' }}>Amount</th>
                      <th style={{ width:'10%', textAlign:'right' }}>Tax</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(voucher?.lines || []).length === 0 ? (
                      <tr><td colSpan={5} style={{ textAlign:'center', color:'#888', padding:10 }}>No lines recorded</td></tr>
                    ) : (voucher?.lines || []).map((l, i) => (
                      <tr key={i}>
                        <td><div className="cvpdf-pay-cell">{l.contact || '—'}</div></td>
                        <td><div className="cvpdf-pay-cell">{resolveAccount(l.expenseAccountCode || l.expenseAccount)}</div></td>
                        <td><div className="cvpdf-pay-cell">{l.description || '—'}</div></td>
                        <td className="amt">₱ {fmtN(l.amount)}</td>
                        <td className="amt">{Number(l.taxAmt) > 0 ? `₱ ${fmtN(l.taxAmt)}` : '—'}</td>
                      </tr>
                    ))}
                    <tr className="tr-total">
                      <td colSpan={3} style={{ textAlign:'right', fontWeight:900 }}>Gross Total</td>
                      <td className="amt">₱ {fmtN(totalAmount)}</td>
                      <td />
                    </tr>
                  </tbody>
                </table>

                {/* Notes */}
                {voucher?.notes && (
                  <div style={{ fontSize:'10px', marginBottom:10 }}>
                    <strong>Notes:&nbsp;</strong>{voucher.notes}
                  </div>
                )}

                {/* Signatories */}
                {(() => {
                  const sigs = [
                    ['Prepared by',  preparedByName],
                    ['Checked by',   checkedByName],
                    ['Approved by',  approvedByName],
                    ['Noted by',     profile.voucherNotedBy || profile.notedBy],
                  ];
                  return (
                    <table className="cvpdf-sigs">
                      <tbody>
                        <tr>{sigs.map(([lbl])      => <td key={lbl}><div className="cvpdf-sig-lbl">{lbl}</div></td>)}</tr>
                        <tr>{sigs.map(([lbl])      => <td key={lbl} style={{ height:36 }} />)}</tr>
                        <tr>{sigs.map(([lbl, nm])  => <td key={lbl}><div className="cvpdf-sig-line">{nm || '\u00A0'}</div></td>)}</tr>
                      </tbody>
                    </table>
                  );
                })()}

                {/* Cut line */}
                <div className="cvpdf-cut-line">✂ &nbsp; CUT HERE &nbsp; ✂</div>

                {/* Acknowledgement Receipt */}
                <div className="cvpdf-receipt">
                  <div className="cvpdf-receipt-title">Acknowledgement Receipt</div>
                  <div style={{ fontSize:'10px', lineHeight:1.7, marginBottom:6 }}>
                    I/We hereby acknowledge receipt of the check(s) described in <strong>{voucher?.voucherId || '—'}</strong>,
                    issued by <strong>{profile.companyName || 'Sentire Books'}</strong> in good order and condition.
                  </div>
                  <div style={{ fontSize:'10px', lineHeight:1.8 }}>
                    <div><strong>Check No(s):&nbsp;</strong>{checkNosDisplay || '—'}</div>
                    <div><strong>Total Amount:&nbsp;</strong>₱ {fmtN(totalAmount)} &nbsp;({toWords(totalAmount)})</div>
                  </div>
                  <table className="cvpdf-receipt-sigs">
                    <tbody>
                      <tr>
                        <td style={{ width:'50%', paddingRight:16 }}>
                          <div style={{ borderTop:'1px solid #000', paddingTop:3, fontSize:'9px', textAlign:'center', marginTop:20 }}>Signature over Printed Name</div>
                        </td>
                        <td>
                          <div style={{ borderTop:'1px solid #000', paddingTop:3, fontSize:'9px', textAlign:'center', marginTop:20 }}>Date Received</div>
                        </td>
                      </tr>
                      <tr>
                        <td style={{ paddingRight:16, paddingTop:10 }}>
                          <div style={{ borderTop:'1px solid #000', paddingTop:3, fontSize:'9px', textAlign:'center', marginTop:14 }}>Position / Title</div>
                        </td>
                        <td style={{ paddingTop:10 }}>
                          <div style={{ borderTop:'1px solid #000', paddingTop:3, fontSize:'9px', textAlign:'center', marginTop:14 }}>Contact Number</div>
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>

              </div>
            )}
          </div>

        </div>
      </div>
    </>
  );
}

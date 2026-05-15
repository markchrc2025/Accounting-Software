import { useState, useEffect, useRef } from 'react';
import { getDoc, doc } from 'firebase/firestore';
import { db } from '../../../firebase.js';
import jsPDF from 'jspdf';
import html2canvas from 'html2canvas';

const TYPE_LABELS = {
  PAYMENT:   'Payment Voucher',
  PAYROLL:   'Payroll Voucher',
  FINAL_PAY: 'Final Pay Voucher',
  LOAN:      'Loan Voucher',
  CHECK:     'Check Voucher',
};

function fmtDate(str) {
  if (!str) return '—';
  const [y, m, d] = str.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-US', {
    weekday: 'short', month: 'long', day: 'numeric', year: 'numeric',
  });
}

function fmtN(n) {
  return new Intl.NumberFormat('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n || 0);
}

// ── (buildPrintHtml removed — using html2canvas + jsPDF instead) ─────────
function _unused({ voucher, jeLines, profile }) {
  const typeLabel    = TYPE_LABELS[voucher.voucherType] || voucher.voucherType || 'Payment Voucher';
  const companyName  = profile.companyName || 'Workscale Resources Inc.';
  const logoUrl      = profile.logoUrl || '';
  const totalDebit   = jeLines.reduce((s, l) => s + (Number(l.debit)  || 0), 0);
  const totalCredit  = jeLines.reduce((s, l) => s + (Number(l.credit) || 0), 0);

  const paymentRows = (voucher.lines || []).map(l => `
    <tr>
      <td>${l.contact || '—'}</td>
      <td>${l.description || '—'}</td>
      <td class="amt">&#8369;&nbsp;${fmtN(l.amount)}</td>
    </tr>`).join('');

  const jeRows = jeLines.map(l => `
    <tr>
      <td style="padding-left:${l.credit > 0 ? '28px' : '8px'}">${l.accountName || l.accountCode || '—'}</td>
      <td class="amt">${l.debit  > 0 ? '&#8369;&nbsp;' + fmtN(l.debit)  : '-'}</td>
      <td class="amt">${l.credit > 0 ? '&#8369;&nbsp;' + fmtN(l.credit) : '-'}</td>
    </tr>`).join('');

  const logoHtml = logoUrl
    ? `<img src="${logoUrl}" style="width:60px;height:60px;object-fit:contain;border-radius:6px" alt="Logo" />`
    : `<div style="width:60px;height:60px;background:#f97316;display:flex;align-items:center;justify-content:center;font-weight:900;font-size:22px;color:#fff;border-radius:8px">W</div>`;

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>${voucher.voucherId || 'Voucher'}</title>
  <style>
    * { box-sizing:border-box; margin:0; padding:0; }
    body { font-family:Arial,sans-serif; font-size:11px; color:#000; padding:32px 48px; }
    .no-print { text-align:center; margin-bottom:20px; }
    .hdr { display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:24px; }
    .hdr-left { display:flex; align-items:center; gap:14px; }
    .company-name { font-size:13px; font-weight:900; }
    .doc-title { font-size:14px; font-weight:900; text-decoration:underline; text-transform:uppercase; letter-spacing:.06em; margin-top:6px; }
    .hdr-right { text-align:right; font-size:11px; line-height:2; }
    .sec-head { font-size:11px; font-weight:900; text-transform:uppercase; letter-spacing:.06em; margin:18px 0 6px; }
    table { width:100%; border-collapse:collapse; }
    th { font-size:10px; font-weight:900; text-transform:uppercase; background:#f0f0f0; border:1px solid #ccc; padding:6px 8px; text-align:left; }
    td { border:1px solid #ccc; padding:6px 8px; font-size:11px; vertical-align:top; }
    .amt { text-align:right; white-space:nowrap; }
    .total-row td { font-weight:900; background:#f8f8f8; }
    .je-total td { font-weight:900; background:#f0f0f0; }
    .sig-block { display:flex; justify-content:space-around; margin-top:44px; }
    .sig-col { text-align:center; min-width:120px; }
    .sig-line { border-top:1px solid #000; margin-top:32px; margin-bottom:5px; }
    .sig-name { font-size:10px; font-weight:900; text-transform:uppercase; letter-spacing:.03em; }
    .sig-label { font-size:9px; color:#555; margin-top:2px; }
    @media print {
      .no-print { display:none !important; }
      body { padding:20px 32px; }
    }
  </style>
</head>
<body>
  <div class="no-print">
    <button onclick="window.print()" style="padding:9px 22px;font-size:13px;font-weight:700;background:#f97316;color:#fff;border:0;border-radius:8px;cursor:pointer">
      🖨&nbsp; Print / Save as PDF
    </button>
  </div>

  <div class="hdr">
    <div class="hdr-left">
      ${logoHtml}
      <div>
        <div class="company-name">${companyName}</div>
        <div class="doc-title">${typeLabel}</div>
      </div>
    </div>
    <div class="hdr-right">
      <div><strong>Control No:</strong> ${voucher.voucherId || '—'}</div>
      <div><strong>Date:</strong> ${fmtDate(voucher.preparationDate)}</div>
      ${voucher.purposeCategory ? `<div><strong>Purpose:</strong> ${voucher.purposeCategory}</div>` : ''}
    </div>
  </div>

  <div class="sec-head">Payment Details</div>
  <table>
    <thead>
      <tr>
        <th style="width:25%">Contact</th>
        <th>Description</th>
        <th class="amt" style="width:22%">Amount to Pay</th>
      </tr>
    </thead>
    <tbody>
      ${paymentRows || '<tr><td colspan="3" style="text-align:center;color:#888;padding:10px">No lines recorded</td></tr>'}
      <tr class="total-row">
        <td colspan="2" style="text-align:right;font-weight:900">Grand Total</td>
        <td class="amt">&#8369;&nbsp;${fmtN(voucher.totalAmount)}</td>
      </tr>
    </tbody>
  </table>

  <div class="sec-head">Journal Entry</div>
  <table>
    <thead>
      <tr>
        <th>COA</th>
        <th class="amt" style="width:22%">Debit</th>
        <th class="amt" style="width:22%">Credit</th>
      </tr>
    </thead>
    <tbody>
      ${jeRows || '<tr><td colspan="3" style="text-align:center;color:#888;padding:10px">No journal entry linked</td></tr>'}
      <tr class="je-total">
        <td style="text-align:right;font-weight:900">Total Debit / Credit</td>
        <td class="amt">&#8369;&nbsp;${fmtN(totalDebit)}</td>
        <td class="amt">&#8369;&nbsp;${fmtN(totalCredit)}</td>
      </tr>
    </tbody>
  </table>

  <div class="sig-block">
    <div class="sig-col">
      <div class="sig-line"></div>
      <div class="sig-name">${voucher.createdBy  || '&nbsp;'}</div>
      <div class="sig-label">Prepared by</div>
    </div>
    <div class="sig-col">
      <div class="sig-line"></div>
      <div class="sig-name">${voucher.reviewedBy || '&nbsp;'}</div>
      <div class="sig-label">Reviewed by</div>
    </div>
    <div class="sig-col">
      <div class="sig-line"></div>
      <div class="sig-name">${voucher.approvedBy || '&nbsp;'}</div>
      <div class="sig-label">Approved by</div>
    </div>
    <div class="sig-col">
      <div class="sig-line"></div>
      <div class="sig-name">${voucher.notedBy || profile.notedBy || '&nbsp;'}</div>
      <div class="sig-label">Noted by</div>
    </div>
  </div>
</body>
</html>`;
}

// ── Modal & paper styles ──────────────────────────────────────────────────
const MODAL_CSS = `
  .vpdf-backdrop  { position:fixed; inset:0; background:rgba(15,23,42,.65); display:flex; align-items:center; justify-content:center; z-index:300; padding:16px; }
  .vpdf-modal     { width:min(680px,98vw); max-height:94vh; background:#fff; border-radius:16px; display:flex; flex-direction:column; overflow:hidden; box-shadow:0 24px 64px rgba(0,0,0,.35); }
  .vpdf-hdr       { display:flex; align-items:center; justify-content:space-between; padding:14px 20px; border-bottom:1px solid #e5e7eb; background:#f8fafc; flex-shrink:0; }
  .vpdf-hdr strong{ font-size:14px; font-weight:900; color:#0b1220; }
  .vpdf-body      { flex:1; overflow-y:auto; background:#9ca3af; padding:20px; display:flex; justify-content:center; }
  /* A4: 595pt wide × 842pt tall at 72dpi — exact canvas capture target */
  .vpdf-paper     { background:#fff; width:595px; min-height:842px; padding:40px 52px; box-shadow:0 2px 20px rgba(0,0,0,.2); font-family:Arial,Helvetica,sans-serif; font-size:11px; color:#000; flex-shrink:0; box-sizing:border-box; }
  .vpdf-doc-hdr   { display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:22px; }
  .vpdf-doc-left  { display:flex; align-items:center; gap:12px; }
  .vpdf-logo      { width:52px; height:52px; object-fit:contain; border-radius:6px; }
  .vpdf-logo-ph   { width:52px; height:52px; background:#f97316; display:flex; align-items:center; justify-content:center; font-weight:900; font-size:19px; color:#fff; border-radius:8px; flex-shrink:0; }
  .vpdf-co-name   { font-size:11px; font-weight:900; color:#000; }
  .vpdf-doc-title { font-size:12px; font-weight:900; text-decoration:underline; text-transform:uppercase; letter-spacing:.07em; margin-top:5px; }
  .vpdf-doc-right { text-align:right; font-size:10.5px; line-height:1.9; }
  .vpdf-sec       { font-size:10px; font-weight:900; text-transform:uppercase; letter-spacing:.07em; margin:16px 0 6px; color:#000; }
  .vpdf-tbl       { width:100%; border-collapse:collapse; margin-bottom:6px; }
  .vpdf-tbl th    { font-size:9.5px; font-weight:900; text-transform:uppercase; background:#eeeeee; border:1px solid #bbb; padding:5px 7px; text-align:left; letter-spacing:.04em; }
  .vpdf-tbl td    { border:1px solid #bbb; padding:5px 7px; font-size:10.5px; vertical-align:top; }
  .vpdf-tbl .amt  { text-align:right; white-space:nowrap; }
  .vpdf-tbl .tr-total td  { font-weight:900; background:#f2f2f2; }
  .vpdf-tbl .tr-je-tot td { font-weight:900; background:#eeeeee; }
  .vpdf-sigs      { display:flex; justify-content:space-around; margin-top:40px; }
  .vpdf-sig-col   { text-align:center; min-width:100px; }
  .vpdf-sig-line  { border-top:1px solid #000; margin-top:28px; margin-bottom:5px; }
  .vpdf-sig-name  { font-size:9.5px; font-weight:900; text-transform:uppercase; letter-spacing:.03em; }
  .vpdf-sig-lbl   { font-size:9px; color:#555; margin-top:2px; }
  .vpdf-btn       { border:0; border-radius:10px; padding:9px 16px; font-weight:700; cursor:pointer; font-size:13px; font-family:inherit; transition:opacity .15s; display:inline-flex; align-items:center; gap:6px; }
  .vpdf-btn:disabled { opacity:.55; cursor:not-allowed; }
  .vpdf-btn-dl    { background:#f97316; color:#fff; }
  .vpdf-btn-ghost { background:#f1f5f9; color:#0b1220; }
  .vpdf-btn-ghost:hover { background:#e2e8f0; }
  .vpdf-loading   { padding:64px; text-align:center; color:#e5e7eb; font-size:13px; font-family:Inter,system-ui,sans-serif; }
  @keyframes vpdf-spin { to { transform:rotate(360deg); } }
`;

// ── Component ─────────────────────────────────────────────────────────────
export default function VoucherPdfModal({ voucher, onClose }) {
  const [jeLines,    setJeLines]    = useState([]);
  const [profile,    setProfile]    = useState({});
  const [loading,    setLoading]    = useState(true);
  const [generating, setGenerating] = useState(false);
  const paperRef = useRef(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const [profSnap, jeSnap] = await Promise.all([
        getDoc(doc(db, 'settings', 'profile')),
        voucher.linkedJeId
          ? getDoc(doc(db, 'journalEntries', voucher.linkedJeId))
          : Promise.resolve(null),
      ]);
      if (cancelled) return;
      setProfile(profSnap.exists() ? profSnap.data() : {});
      setJeLines(jeSnap?.exists() ? (jeSnap.data().lines || []) : []);
      setLoading(false);
    }
    load();
    return () => { cancelled = true; };
  }, [voucher.id, voucher.linkedJeId]);

  const handleDownload = async () => {
    if (!paperRef.current) return;
    setGenerating(true);
    try {
      const canvas = await html2canvas(paperRef.current, {
        scale: 2,
        useCORS: true,
        backgroundColor: '#ffffff',
        logging: false,
      });
      const pdf   = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
      const pdfW  = pdf.internal.pageSize.getWidth();
      const pdfH  = pdf.internal.pageSize.getHeight();
      const ratio = pdfW / canvas.width;
      const imgH  = canvas.height * ratio;
      const img   = canvas.toDataURL('image/jpeg', 0.97);
      // Multi-page support
      let remaining = imgH;
      let yOffset   = 0;
      pdf.addImage(img, 'JPEG', 0, yOffset, pdfW, imgH);
      remaining -= pdfH;
      while (remaining > 0) {
        yOffset -= pdfH;
        pdf.addPage();
        pdf.addImage(img, 'JPEG', 0, yOffset, pdfW, imgH);
        remaining -= pdfH;
      }
      pdf.save(`${voucher.voucherId || voucher.id || 'voucher'}.pdf`);
    } catch (e) {
      console.error('PDF generation error:', e);
    } finally {
      setGenerating(false);
    }
  };

  const typeLabel   = TYPE_LABELS[voucher.voucherType] || voucher.voucherType || 'Payment Voucher';
  const totalDebit  = jeLines.reduce((s, l) => s + (Number(l.debit)  || 0), 0);
  const totalCredit = jeLines.reduce((s, l) => s + (Number(l.credit) || 0), 0);

  return (
    <>
      <style>{MODAL_CSS}</style>
      <div className="vpdf-backdrop" onClick={onClose}>
        <div className="vpdf-modal" onClick={e => e.stopPropagation()}>

          {/* ── Header bar ── */}
          <div className="vpdf-hdr">
            <strong>PDF Preview — {voucher.voucherId || voucher.id}</strong>
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="vpdf-btn vpdf-btn-dl" onClick={handleDownload} disabled={loading || generating}>
                {generating
                  ? <><span style={{width:12,height:12,border:'2px solid rgba(255,255,255,.4)',borderTopColor:'#fff',borderRadius:'50%',display:'inline-block',animation:'vpdf-spin .7s linear infinite'}}></span> Generating…</>
                  : <>⬇&nbsp; Download PDF</>}
              </button>
              <button className="vpdf-btn vpdf-btn-ghost" onClick={onClose}>✕ Close</button>
            </div>
          </div>

          {/* ── Paper area ── */}
          <div className="vpdf-body">
            {loading ? (
              <div className="vpdf-loading">Loading document…</div>
            ) : (
              <div className="vpdf-paper" ref={paperRef}>

                {/* Document header */}
                <div className="vpdf-doc-hdr">
                  <div className="vpdf-doc-left">
                    {profile.logoUrl
                      ? <img src={profile.logoUrl} className="vpdf-logo" alt="Logo" />
                      : <div className="vpdf-logo-ph">W</div>
                    }
                    <div>
                      <div className="vpdf-co-name">{profile.companyName || 'Workscale Resources Inc.'}</div>
                      <div className="vpdf-doc-title">{typeLabel}</div>
                    </div>
                  </div>
                  <div className="vpdf-doc-right">
                    <div><strong>Control No:</strong> {voucher.voucherId || '—'}</div>
                    <div><strong>Date:</strong> {fmtDate(voucher.preparationDate)}</div>
                    {voucher.purposeCategory && <div><strong>Purpose:</strong> {voucher.purposeCategory}</div>}
                  </div>
                </div>

                {/* Payment Details */}
                <div className="vpdf-sec">Payment Details</div>
                <table className="vpdf-tbl">
                  <thead>
                    <tr>
                      <th style={{ width: '25%' }}>Contact</th>
                      <th>Description</th>
                      <th style={{ width: '22%', textAlign: 'right' }}>Amount to Pay</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(voucher.lines || []).length === 0 ? (
                      <tr><td colSpan={3} style={{ textAlign: 'center', color: '#888', padding: 10 }}>No lines recorded</td></tr>
                    ) : (voucher.lines || []).map((l, i) => (
                      <tr key={i}>
                        <td>{l.contact || '—'}</td>
                        <td>{l.description || '—'}</td>
                        <td className="amt">₱ {fmtN(l.amount)}</td>
                      </tr>
                    ))}
                    <tr className="tr-total">
                      <td colSpan={2} style={{ textAlign: 'right', fontWeight: 900 }}>Grand Total</td>
                      <td className="amt">₱ {fmtN(voucher.totalAmount)}</td>
                    </tr>
                  </tbody>
                </table>

                {/* Journal Entry */}
                <div className="vpdf-sec">Journal Entry</div>
                <table className="vpdf-tbl">
                  <thead>
                    <tr>
                      <th>COA</th>
                      <th style={{ width: '22%', textAlign: 'right' }}>Debit</th>
                      <th style={{ width: '22%', textAlign: 'right' }}>Credit</th>
                    </tr>
                  </thead>
                  <tbody>
                    {jeLines.length === 0 ? (
                      <tr><td colSpan={3} style={{ textAlign: 'center', color: '#888', padding: 10 }}>No journal entry linked</td></tr>
                    ) : jeLines.map((l, i) => (
                      <tr key={i}>
                        <td style={{ paddingLeft: l.credit > 0 ? 28 : 8 }}>
                          {l.accountName || l.accountCode || '—'}
                        </td>
                        <td className="amt" style={{ color: l.debit  > 0 ? '#166534' : '#94a3b8' }}>
                          {l.debit  > 0 ? `₱ ${fmtN(l.debit)}`  : '—'}
                        </td>
                        <td className="amt" style={{ color: l.credit > 0 ? '#dc2626' : '#94a3b8' }}>
                          {l.credit > 0 ? `₱ ${fmtN(l.credit)}` : '—'}
                        </td>
                      </tr>
                    ))}
                    <tr className="tr-je-tot">
                      <td style={{ textAlign: 'right', fontWeight: 900, fontSize: 10, textTransform: 'uppercase', letterSpacing: '.04em' }}>
                        Total Debit / Credit
                      </td>
                      <td className="amt">₱ {fmtN(totalDebit)}</td>
                      <td className="amt">₱ {fmtN(totalCredit)}</td>
                    </tr>
                  </tbody>
                </table>

                {/* Signatures */}
                <div className="vpdf-sigs">
                  {[
                    ['Prepared by',  voucher.createdBy],
                    ['Reviewed by',  voucher.reviewedBy],
                    ['Approved by',  voucher.approvedBy],
                    ['Noted by',     voucher.notedBy || profile.notedBy],
                  ].map(([label, name]) => (
                    <div key={label} className="vpdf-sig-col">
                      <div className="vpdf-sig-line" />
                      <div className="vpdf-sig-name">{name || '\u00A0'}</div>
                      <div className="vpdf-sig-lbl">{label}</div>
                    </div>
                  ))}
                </div>

              </div>
            )}
          </div>

        </div>
      </div>
    </>
  );
}

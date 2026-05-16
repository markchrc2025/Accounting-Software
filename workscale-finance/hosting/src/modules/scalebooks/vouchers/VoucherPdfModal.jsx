import { useState, useEffect } from 'react';
import { getDoc, doc, getDocs, collection, query, where } from 'firebase/firestore';
import { db } from '../../../firebase.js';
import jsPDF from 'jspdf';

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

// ── Modal & paper styles ──────────────────────────────────────────────────
const MODAL_CSS = `
  .vpdf-backdrop  { position:fixed; inset:0; background:rgba(15,23,42,.65); display:flex; align-items:center; justify-content:center; z-index:300; padding:16px; }
  .vpdf-modal     { width:min(680px,98vw); max-height:94vh; background:#fff; border-radius:16px; display:flex; flex-direction:column; overflow:hidden; box-shadow:0 24px 64px rgba(0,0,0,.35); }
  .vpdf-hdr       { display:flex; align-items:center; justify-content:space-between; padding:14px 20px; border-bottom:1px solid #e5e7eb; background:#f8fafc; flex-shrink:0; }
  .vpdf-hdr strong{ font-size:14px; font-weight:900; color:#0b1220; }
  .vpdf-body      { flex:1; overflow-y:auto; background:#9ca3af; padding:20px; display:flex; justify-content:center; }
  /* A4 — height is dynamic to fit content (always 1 page) */
  /* NOTE: 1 CSS px = 1pt in the PDF output (html2canvas scale:2 + jsPDF A4 mapping) */
  .vpdf-paper     { background:#fff; width:595px; min-height:841px; padding:28px 36px; box-shadow:0 2px 20px rgba(0,0,0,.2); font-family:"Courier New",Courier,monospace; font-size:11px; color:#000; flex-shrink:0; box-sizing:border-box; }
  .vpdf-logo      { display:block; max-height:40px; max-width:150px; object-fit:contain; margin-bottom:3px; }
  .vpdf-co-name   { font-weight:bold; font-size:9px; }
  .vpdf-doc-title { font-weight:bold; text-decoration:underline; text-transform:uppercase; }
  .vpdf-sec       { font-weight:bold; text-transform:uppercase; margin:12px 0 5px; border-bottom:1px dashed #000; padding-bottom:2px; }
  .vpdf-tbl       { width:100%; border-collapse:collapse; margin-bottom:12px; border:1px solid #000; }
  .vpdf-tbl th    { font-weight:bold; text-transform:uppercase; text-align:center; border:1px solid #000; border-bottom:2px solid #000; padding:4px 6px; background:#fff; color:#000; }
  .vpdf-tbl td    { border:1px solid #000; padding:4px 6px; vertical-align:top; background:#fff; color:#000; }
  .vpdf-tbl .amt  { text-align:right; white-space:nowrap; }
  .vpdf-tbl .tr-total td  { font-weight:bold; border-top:2px solid #000; }
  .vpdf-tbl .tr-je-tot td { font-weight:bold; border-top:2px solid #000; }
  .vpdf-sigs      { width:100%; border-collapse:collapse; table-layout:fixed; margin-top:24px; }
  .vpdf-sigs td   { border:none; padding-right:12px; vertical-align:top; }
  .vpdf-sig-lbl   { font-weight:bold; margin-bottom:10px; text-align:left; }
  .vpdf-sig-img   { height:40px; }
  .vpdf-sig-line  { border-top:1px solid #000; padding-top:3px; font-weight:bold; text-transform:uppercase; text-align:center; }
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
  const [jeLines,        setJeLines]        = useState([]);
  const [profile,        setProfile]        = useState({});
  const [preparedByName, setPreparedByName] = useState('');
  const [reviewedByName, setReviewedByName] = useState('');
  const [approvedByName, setApprovedByName] = useState('');
  const [loading,        setLoading]        = useState(true);
  const [generating,     setGenerating]     = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const creatorEmail = voucher.createdBy || '__none__';
      const [profSnap, jeSnap, userSnap, routingSnap] = await Promise.all([
        getDoc(doc(db, 'settings', 'profile')),
        voucher.linkedJeId
          ? getDoc(doc(db, 'journalEntries', voucher.linkedJeId))
          : Promise.resolve(null),
        getDocs(query(collection(db, 'appUsers'), where('email', '==', creatorEmail))),
        getDoc(doc(db, 'settings', 'approvalRouting')),
      ]);
      if (cancelled) return;
      const profData = profSnap.exists() ? profSnap.data() : {};
      setProfile(profData);
      setJeLines(jeSnap?.exists() ? (jeSnap.data().lines || []) : []);

      const appUser = userSnap?.docs?.[0]?.data();
      setPreparedByName(appUser?.fullName || appUser?.displayName || voucher.createdBy || '');

      // Resolve verifier & approver from the routing rule for this maker
      const routes = routingSnap.exists() ? (routingSnap.data().routes || []) : [];
      const route  = routes.find(r => r.documentType === 'Vouchers' && r.makerEmail === creatorEmail);
      const verifierEmail = route?.verifierEmail || '';
      const approverEmail = route?.approverEmail || '';

      const [verSnap, apprSnap] = await Promise.all([
        verifierEmail ? getDocs(query(collection(db, 'appUsers'), where('email', '==', verifierEmail))) : Promise.resolve(null),
        approverEmail ? getDocs(query(collection(db, 'appUsers'), where('email', '==', approverEmail))) : Promise.resolve(null),
      ]);
      if (cancelled) return;
      const verUser  = verSnap?.docs?.[0]?.data();
      const apprUser = apprSnap?.docs?.[0]?.data();
      setReviewedByName(verUser?.fullName  || verUser?.displayName  || verifierEmail  || '');
      setApprovedByName(apprUser?.fullName || apprUser?.displayName || approverEmail || '');
      setLoading(false);
    }
    load();
    return () => { cancelled = true; };
  }, [voucher.id, voucher.linkedJeId, voucher.createdBy]);

  // ── Programmatic jsPDF generation (vector text + lines, no screenshot) ─────
  const handleDownload = async () => {
    setGenerating(true);
    try {
      const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });

      // ── Layout constants ────────────────────────────────────────────────
      const PW = 210, PH = 297;
      const ML = 15, MT = 14;
      const CW = PW - ML * 2;  // 180 mm content width

      // ── Font helpers ─────────────────────────────────────────────────────
      const reg  = (sz = 9)  => { pdf.setFont('courier', 'normal'); pdf.setFontSize(sz); };
      const bold = (sz = 9)  => { pdf.setFont('courier', 'bold');   pdf.setFontSize(sz); };

      // ── Line/shape helpers ────────────────────────────────────────────────
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
      // Draw inner vertical dividers for a row (skip last column = outer border)
      const vlines = (y0, h, cols) => {
        let x = ML;
        cols.forEach((w, i) => {
          x += w;
          if (i < cols.length - 1) { pdf.setLineWidth(0.15); pdf.line(x, y0, x, y0 + h); }
        });
      };
      // New page guard
      let y = MT;
      const need = (h) => {
        if (y + h > PH - 15) { pdf.addPage(); y = MT; }
      };

      // ── HEADER ────────────────────────────────────────────────────────────
      // Logo (left)
      let logoBottomY = y;
      if (profile.logoBase64) {
        const fmt = (profile.logoBase64.match(/^data:image\/(\w+);/) || [])[1]?.toUpperCase() || 'PNG';
        const imgEl = new Image();
        await new Promise(r => { imgEl.onload = r; imgEl.onerror = r; imgEl.src = profile.logoBase64; });
        const MAX_W = 38, MAX_H = 13;
        const asp = (imgEl.naturalWidth || 1) / (imgEl.naturalHeight || 1);
        const imgW = asp > MAX_W / MAX_H ? MAX_W : MAX_H * asp;
        const imgH = asp > MAX_W / MAX_H ? MAX_W / asp : MAX_H;
        pdf.addImage(profile.logoBase64, fmt, ML, y, imgW, imgH, '', 'FAST');
        logoBottomY = y + imgH + 2;
      }
      reg(7.5);
      pdf.text(profile.companyName || 'Workscale Resources Inc.', ML, logoBottomY + 3.5);

      // Document title (centred, bold, underlined)
      const typeStr = (TYPE_LABELS[voucher.voucherType] || voucher.voucherType || 'Payment Voucher').toUpperCase();
      bold(12);
      pdf.text(typeStr, PW / 2, y + 8, { align: 'center' });
      const titleW = pdf.getTextWidth(typeStr);
      pdf.setLineWidth(0.35);
      pdf.line(PW / 2 - titleW / 2, y + 9.3, PW / 2 + titleW / 2, y + 9.3);

      // Control info (right-aligned)
      reg(8.5);
      const infoLines = [
        `Control No: ${voucher.voucherId || '\u2014'}`,
        `Date: ${fmtDate(voucher.preparationDate)}`,
        ...(voucher.purposeCategory ? [`Purpose: ${voucher.purposeCategory}`] : []),
      ];
      infoLines.forEach((ln, i) => pdf.text(ln, ML + CW, y + 3.5 + i * 4.2, { align: 'right' }));

      y += 22;
      hline(y, 0.5);
      y += 6;

      // ── PAYMENT DETAILS TABLE ────────────────────────────────────────────
      bold(8.5);
      pdf.text('PAYMENT DETAILS', ML, y);
      y += 2.5; dashLine(y); y += 4;

      const C1 = 45, C2 = 96, C3 = 39;  // Contact | Desc | Amount
      const PAY_COLS = [C1, C2, C3];
      const ROW = 7, PAD = 2;

      // Header row
      need(ROW);
      pdf.setLineWidth(0.15);
      pdf.rect(ML, y, CW, ROW, 'S');
      vlines(y, ROW, PAY_COLS);
      pdf.setLineWidth(0.35); hline(y + ROW, 0.35);
      bold(8);
      pdf.text('CONTACT',       ML + C1 / 2,           y + 4.5, { align: 'center' });
      pdf.text('DESCRIPTION',   ML + C1 + C2 / 2,      y + 4.5, { align: 'center' });
      pdf.text('AMOUNT TO PAY', ML + C1 + C2 + C3 / 2, y + 4.5, { align: 'center' });
      y += ROW;

      // Data rows
      reg(9);
      const payLines = voucher.lines || [];
      if (payLines.length === 0) {
        need(ROW);
        pdf.setLineWidth(0.15);
        pdf.rect(ML, y, CW, ROW, 'S'); vlines(y, ROW, PAY_COLS);
        pdf.text('\u2014', ML + CW / 2, y + 4.5, { align: 'center' });
        y += ROW;
      } else {
        payLines.forEach(l => {
          const cLines = pdf.splitTextToSize(l.contact     || '\u2014', C1 - 2 * PAD);
          const dLines = pdf.splitTextToSize(l.description || '\u2014', C2 - 2 * PAD);
          const rowH   = Math.max(ROW, Math.max(cLines.length, dLines.length) * 4 + 3);
          need(rowH);
          pdf.setLineWidth(0.15);
          pdf.rect(ML, y, CW, rowH, 'S'); vlines(y, rowH, PAY_COLS);
          cLines.forEach((t, i) => pdf.text(t, ML + PAD, y + 4 + i * 4));
          dLines.forEach((t, i) => pdf.text(t, ML + C1 + PAD, y + 4 + i * 4));
          pdf.text(`P ${fmtN(l.amount)}`, ML + CW - PAD, y + 4.5, { align: 'right' });
          y += rowH;
        });
      }

      // Grand Total row
      need(ROW);
      pdf.setLineWidth(0.35); hline(y, 0.35);
      pdf.setLineWidth(0.15);
      pdf.rect(ML, y, CW, ROW, 'S');
      pdf.line(ML + C1 + C2, y, ML + C1 + C2, y + ROW);
      bold(9);
      pdf.text('Grand Total',             ML + C1 + C2 - PAD, y + 4.5, { align: 'right' });
      pdf.text(`P ${fmtN(voucher.totalAmount)}`, ML + CW - PAD, y + 4.5, { align: 'right' });
      y += ROW + 6;

      // ── JOURNAL ENTRY TABLE ──────────────────────────────────────────────
      bold(8.5);
      pdf.text('JOURNAL ENTRY', ML, y);
      y += 2.5; dashLine(y); y += 4;

      const JC1 = 102, JC2 = 39, JC3 = 39;  // COA | Debit | Credit
      const JE_COLS = [JC1, JC2, JC3];

      // Header row
      need(ROW);
      pdf.setLineWidth(0.15);
      pdf.rect(ML, y, CW, ROW, 'S'); vlines(y, ROW, JE_COLS);
      pdf.setLineWidth(0.35); hline(y + ROW, 0.35);
      bold(8);
      pdf.text('COA',    ML + JC1 / 2,           y + 4.5, { align: 'center' });
      pdf.text('DEBIT',  ML + JC1 + JC2 / 2,     y + 4.5, { align: 'center' });
      pdf.text('CREDIT', ML + JC1 + JC2 + JC3/2, y + 4.5, { align: 'center' });
      y += ROW;

      // JE data rows
      reg(9);
      if (jeLines.length === 0) {
        need(ROW);
        pdf.setLineWidth(0.15);
        pdf.rect(ML, y, CW, ROW, 'S'); vlines(y, ROW, JE_COLS);
        pdf.text('No journal entry linked', ML + CW / 2, y + 4.5, { align: 'center' });
        y += ROW;
      } else {
        jeLines.forEach(l => {
          const indent  = l.credit > 0 ? 8 : PAD;
          const acctTxt = l.accountName || l.accountCode || '\u2014';
          const aLines  = pdf.splitTextToSize(acctTxt, JC1 - PAD - indent);
          const rowH    = Math.max(ROW, aLines.length * 4 + 3);
          need(rowH);
          pdf.setLineWidth(0.15);
          pdf.rect(ML, y, CW, rowH, 'S'); vlines(y, rowH, JE_COLS);
          aLines.forEach((t, i) => pdf.text(t, ML + indent, y + 4 + i * 4));
          const debitX  = ML + JC1 + JC2 - PAD;
          const creditX = ML + CW - PAD;
          const midD    = ML + JC1 + JC2 / 2;
          const midC    = ML + JC1 + JC2 + JC3 / 2;
          if (l.debit  > 0) pdf.text(`P ${fmtN(l.debit)}`,  debitX,  y + 4.5, { align: 'right' });
          else              pdf.text('\u2014', midD,  y + 4.5, { align: 'center' });
          if (l.credit > 0) pdf.text(`P ${fmtN(l.credit)}`, creditX, y + 4.5, { align: 'right' });
          else              pdf.text('\u2014', midC,  y + 4.5, { align: 'center' });
          y += rowH;
        });
      }

      // JE Total row
      need(ROW);
      pdf.setLineWidth(0.35); hline(y, 0.35);
      pdf.setLineWidth(0.15);
      pdf.rect(ML, y, CW, ROW, 'S'); vlines(y, ROW, JE_COLS);
      bold(8);
      pdf.text('TOTAL DEBIT / CREDIT',    ML + JC1 - PAD,      y + 4.5, { align: 'right' });
      pdf.text(`P ${fmtN(totalDebit)}`,   ML + JC1 + JC2 - PAD, y + 4.5, { align: 'right' });
      pdf.text(`P ${fmtN(totalCredit)}`,  ML + CW - PAD,         y + 4.5, { align: 'right' });
      y += ROW + 14;

      // ── SIGNATURES ────────────────────────────────────────────────────────
      const sigs = [
        { label: 'Prepared by',  name: preparedByName },
        { label: 'Reviewed by',  name: reviewedByName },
        { label: 'Approved by',  name: approvedByName },
        { label: 'Noted by',     name: profile.voucherNotedBy || profile.notedBy || '' },
      ];
      const sigW = CW / 4;  // 45 mm each

      need(30);
      bold(8.5);
      sigs.forEach((s, i) => pdf.text(s.label, ML + i * sigW, y));
      y += 20;  // space for physical signature

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
              <div className="vpdf-paper">

                {/* Document header */}
                <table style={{width:'100%',borderCollapse:'collapse',marginBottom:20,borderBottom:'2px solid #000'}}>
                  <tbody>
                    <tr>
                      <td style={{width:'160px',verticalAlign:'middle',border:'none',paddingBottom:6}}>
                        {(profile.logoBase64 || profile.logoUrl)
                          ? <><img src={profile.logoBase64 || profile.logoUrl} className="vpdf-logo" alt="Logo" /><div className="vpdf-co-name">{profile.companyName || 'Workscale Resources Inc.'}</div></>
                          : <div className="vpdf-co-name">{profile.companyName || 'Workscale Resources Inc.'}</div>
                        }
                      </td>
                      <td style={{textAlign:'center',verticalAlign:'middle',border:'none',paddingLeft:8,paddingRight:8}}>
                        <div className="vpdf-doc-title">{typeLabel}</div>
                      </td>
                      <td style={{textAlign:'right',verticalAlign:'middle',border:'none',paddingBottom:6,whiteSpace:'nowrap',fontSize:'9px',lineHeight:'1.8'}}>
                        <div>Control No: {voucher.voucherId || '—'}</div>
                        <div>Date: {fmtDate(voucher.preparationDate)}</div>
                        {voucher.purposeCategory && <div>Purpose: {voucher.purposeCategory}</div>}
                      </td>
                    </tr>
                  </tbody>
                </table>

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
                        <td className="amt">
                          {l.debit  > 0 ? `₱ ${fmtN(l.debit)}`  : '—'}
                        </td>
                        <td className="amt">
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
                {(() => {
                  const sigs = [
                    ['Prepared by',  preparedByName],
                    ['Reviewed by',  reviewedByName],
                    ['Approved by',  approvedByName],
                    ['Noted by',     profile.voucherNotedBy || profile.notedBy],
                  ];
                  return (
                    <table className="vpdf-sigs">
                      <tbody>
                        <tr>{sigs.map(([lbl])    => <td key={lbl}><div className="vpdf-sig-lbl">{lbl}</div></td>)}</tr>
                        <tr>{sigs.map(([lbl])    => <td key={lbl} className="vpdf-sig-img" />)}</tr>
                        <tr>{sigs.map(([lbl, nm])=> <td key={lbl}><div className="vpdf-sig-line">{nm || '\u00A0'}</div></td>)}</tr>
                      </tbody>
                    </table>
                  );
                })()}

              </div>
            )}
          </div>

        </div>
      </div>
    </>
  );
}

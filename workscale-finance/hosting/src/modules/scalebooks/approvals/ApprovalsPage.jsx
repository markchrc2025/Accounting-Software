import { useState, useEffect } from 'react';
import { collection, query, where, onSnapshot, updateDoc, doc, serverTimestamp } from 'firebase/firestore';
import { db, auth } from '../../../firebase.js';

const fmt = (n) => new Intl.NumberFormat('en-PH', { style:'currency', currency:'PHP' }).format(n || 0);

const CSS = `
  .ap-wrap   { display:flex; flex-direction:column; height:100%; overflow:hidden; font-family:Inter,system-ui,sans-serif; }
  .ap-topbar { display:flex; align-items:center; justify-content:space-between; padding:16px 22px 12px; flex-shrink:0; border-bottom:1px solid #e5e7eb; background:#fff; }
  .ap-body   { flex:1; overflow-y:auto; padding:16px 22px; }
  .btn       { border:0; border-radius:10px; padding:9px 16px; font-weight:700; cursor:pointer; font-size:13px; font-family:inherit; }
  .btn-ghost { background:#f1f5f9; color:#0b1220; }
  .btn-ghost:hover { background:#e2e8f0; }
  .btn-sm    { padding:6px 12px; font-size:12px; }
  .card      { background:#fff; border:1px solid #e5e7eb; border-radius:14px; overflow:hidden; margin-bottom:12px; }
  table      { width:100%; border-collapse:collapse; }
  th,td      { padding:11px 14px; border-bottom:1px solid #f1f5f9; font-size:13px; text-align:left; }
  th         { color:#64748b; font-weight:800; font-size:11px; letter-spacing:.05em; text-transform:uppercase; background:#f8fafc; }
  tr:hover td { background:#fafafa; }
  tr:last-child td { border-bottom:none; }
  .empty     { padding:64px; text-align:center; color:#94a3b8; }
  .approve-btn { background:#d1fae5; color:#065f46; border:0; border-radius:8px; padding:6px 12px; font-weight:700; font-size:12px; cursor:pointer; }
  .reject-btn  { background:#fee2e2; color:#dc2626; border:0; border-radius:8px; padding:6px 12px; font-weight:700; font-size:12px; cursor:pointer; }
  .detail-panel { background:#f8fafc; border-radius:12px; padding:16px; margin-top:12px; display:none; }
  .toast { position:fixed; right:16px; bottom:16px; background:#0b1220; color:#fff; padding:12px 18px; border-radius:12px; font-size:13px; font-weight:600; z-index:999; }
  .badge-count { display:inline-block; background:#ef4444; color:#fff; border-radius:999px; font-size:10px; font-weight:800; padding:1px 7px; margin-left:6px; }
  .info-grid { display:grid; grid-template-columns:1fr 1fr 1fr; gap:12px; margin-bottom:16px; }
  .info-card { background:#fff; border:1px solid #e5e7eb; border-radius:12px; padding:14px 16px; }
  .info-label { font-size:10px; font-weight:800; color:#94a3b8; text-transform:uppercase; letter-spacing:.07em; }
  .info-value { font-size:20px; font-weight:900; margin-top:3px; }
  .je-row   { background:#f8fafc; }
`;

export default function ApprovalsPage() {
  const [pending, setPending]   = useState([]);
  const [expanded, setExpanded] = useState(new Set());
  const [toast, setToast]       = useState('');

  const showToast = (msg) => { setToast(msg); setTimeout(() => setToast(''), 3000); };

  useEffect(() => {
    const unsub = onSnapshot(
      query(collection(db, 'vouchers'), where('status', '==', 'Pending')),
      snap => setPending(snap.docs.map(d => ({ id:d.id, ...d.data() })))
    );
    return unsub;
  }, []);

  function toggle(id) {
    setExpanded(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  }

  async function approve(id) {
    await updateDoc(doc(db, 'vouchers', id), {
      status: 'Approved',
      approvedAt: serverTimestamp(),
      approvedBy: auth.currentUser?.email,
      updatedAt: serverTimestamp(),
    });
    showToast('Voucher approved.');
  }

  async function reject(id) {
    const reason = window.prompt('Rejection reason (optional):');
    if (reason === null) return; // cancelled
    await updateDoc(doc(db, 'vouchers', id), {
      status: 'Rejected',
      rejectedAt: serverTimestamp(),
      rejectedBy: auth.currentUser?.email,
      rejectionReason: reason || '',
      updatedAt: serverTimestamp(),
    });
    showToast('Voucher rejected.');
  }

  const totalAmt = pending.reduce((s, v) => s + (v.amount || 0), 0);

  return (
    <div className="ap-wrap">
      <style>{CSS}</style>
      <div className="ap-topbar">
        <div>
          <h1 style={{ margin:0, fontSize:18, fontWeight:900 }}>
            My Approvals
            {pending.length > 0 && <span className="badge-count">{pending.length}</span>}
          </h1>
          <p style={{ margin:0, fontSize:12, color:'#64748b' }}>Vouchers awaiting approval action</p>
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

        {pending.length === 0 ? (
          <div className="card">
            <div className="empty">
              <div style={{ fontSize:40, marginBottom:12 }}>✅</div>
              <strong>All caught up!</strong>
              <p style={{ margin:'8px 0 0', fontSize:12 }}>No vouchers pending approval at this time.</p>
            </div>
          </div>
        ) : pending.map(v => (
          <div key={v.id} className="card">
            <table>
              <tbody>
                <tr style={{ cursor:'pointer' }} onClick={() => toggle(v.id)}>
                  <td style={{ fontWeight:900, fontFamily:'monospace', fontSize:12, width:160 }}>{v.number}</td>
                  <td style={{ color:'#64748b', width:100 }}>{v.date}</td>
                  <td style={{ fontWeight:700 }}>{v.payee}</td>
                  <td style={{ color:'#64748b' }}>{v.type}</td>
                  <td style={{ color:'#475569', fontSize:12 }}>{v.bankCode}</td>
                  <td style={{ fontWeight:800, color:'#0f172a' }}>{fmt(v.amount)}</td>
                  <td style={{ color:'#94a3b8', fontSize:12, maxWidth:200, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{v.description}</td>
                  <td>
                    <div style={{ display:'flex', gap:6 }} onClick={e => e.stopPropagation()}>
                      <button className="approve-btn" onClick={() => approve(v.id)}>✓ Approve</button>
                      <button className="reject-btn"  onClick={() => reject(v.id)}>✗ Reject</button>
                    </div>
                  </td>
                  <td style={{ color:'#94a3b8', fontSize:11 }}>{expanded.has(v.id) ? '▲' : '▼'}</td>
                </tr>
                {expanded.has(v.id) && (v.lines||[]).map((l, i) => (
                  <tr key={i} className="je-row">
                    <td></td>
                    <td colSpan={2} style={{ fontSize:12, color:'#475569', paddingLeft:24 }}>{l.accountName}</td>
                    <td colSpan={2} style={{ fontSize:12, color:'#94a3b8' }}>{l.description}</td>
                    <td style={{ color:'#188038', fontWeight:700, fontSize:12 }}>{l.debit > 0 ? fmt(l.debit) : ''}</td>
                    <td style={{ color:'#1d4ed8', fontWeight:700, fontSize:12 }}>{l.credit > 0 ? fmt(l.credit) : ''}</td>
                    <td colSpan={2}></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}
      </div>
      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}

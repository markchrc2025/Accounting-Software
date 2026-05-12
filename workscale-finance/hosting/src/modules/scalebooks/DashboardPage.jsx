import { useEffect, useState } from 'react';
import { collection, query, orderBy, limit, getDocs, where } from 'firebase/firestore';
import { db } from '../../firebase.js';
import { useNavigate } from 'react-router-dom';

const fmt = (n) => new Intl.NumberFormat('en-PH', { style:'currency', currency:'PHP', maximumFractionDigits:0 }).format(n || 0);

const STAT_CARD = `
  .dc-grid { display:grid; grid-template-columns:repeat(4,1fr); gap:14px; margin-bottom:20px; }
  .dc-stat { background:#fff; border:1px solid #e5e7eb; border-radius:14px; padding:16px 18px; }
  .dc-stat-label { font-size:10px; font-weight:800; color:#64748b; letter-spacing:.07em; text-transform:uppercase; margin-bottom:6px; }
  .dc-stat-value { font-size:24px; font-weight:900; color:#0f172a; }
  .dc-stat-sub { font-size:11px; color:#94a3b8; margin-top:4px; }
  .dc-stat.green .dc-stat-value { color:#15803d; }
  .dc-stat.orange .dc-stat-value { color:#ea580c; }
  .dc-stat.blue .dc-stat-value { color:#1d4ed8; }
  .dc-section { background:#fff; border:1px solid #e5e7eb; border-radius:14px; overflow:hidden; }
  .dc-section-head { display:flex; justify-content:space-between; align-items:center; padding:14px 18px; border-bottom:1px solid #f1f5f9; }
  .dc-section-head strong { font-size:13px; font-weight:800; }
  .dc-section-head a { font-size:12px; color:#f97316; font-weight:700; text-decoration:none; cursor:pointer; }
  .dc-row { display:flex; justify-content:space-between; align-items:center; padding:12px 18px; border-bottom:1px solid #f8fafc; font-size:13px; }
  .dc-row:last-child { border-bottom:none; }
  .dc-row:hover { background:#fafafa; }
  .dc-two { display:grid; grid-template-columns:1fr 1fr; gap:14px; }
  .pill { display:inline-block; padding:3px 9px; border-radius:999px; font-size:11px; font-weight:700; border:1px solid; }
  .pill-pending  { background:#fff7ed; border-color:#fed7aa; color:#c2410c; }
  .pill-approved { background:#ecfeff; border-color:#a5f3fc; color:#0e7490; }
  .pill-paid     { background:#f0fdf4; border-color:#bbf7d0; color:#15803d; }
  .pill-rejected { background:#fef2f2; border-color:#fecaca; color:#dc2626; }
  .pill-voided   { background:#f8fafc; border-color:#e2e8f0; color:#64748b; }
  .pill-draft    { background:#fefce8; border-color:#fde047; color:#854d0e; }
  .pill-posted   { background:#f0fdf4; border-color:#bbf7d0; color:#15803d; }
`;

export default function DashboardPage() {
  const navigate = useNavigate();
  const [stats, setStats] = useState({ vouchers:0, pending:0, totalBilled:0, totalCollected:0 });
  const [recentVouchers, setRecentVouchers] = useState([]);
  const [recentBilling, setRecentBilling] = useState([]);
  const [loading, setLoading] = useState(true);

  const now = new Date();
  const timeLabel = now.getHours() < 12 ? 'Good morning' : now.getHours() < 17 ? 'Good afternoon' : 'Good evening';
  const dateLabel = now.toLocaleDateString('en-US', { weekday:'long', month:'long', day:'numeric', year:'numeric' });

  useEffect(() => {
    async function load() {
      try {
        const [vSnap, bsSnap] = await Promise.all([
          getDocs(query(collection(db, 'vouchers'), orderBy('createdAt', 'desc'), limit(5))),
          getDocs(query(collection(db, 'billingStatements'), orderBy('createdAt', 'desc'), limit(5))),
        ]);

        const vouchers = vSnap.docs.map(d => ({ id: d.id, ...d.data() }));
        const statements = bsSnap.docs.map(d => ({ id: d.id, ...d.data() }));

        // Count stats from separate aggregation queries
        const [allVSnap, pendingSnap] = await Promise.all([
          getDocs(collection(db, 'vouchers')),
          getDocs(query(collection(db, 'vouchers'), where('status', '==', 'Pending'))),
        ]);

        const totalBilled = statements.reduce((s, d) => s + (d.netDue || d.totalAmount || 0), 0);
        const totalCollected = statements.reduce((s, d) => s + (d.amountCollected || 0), 0);

        setStats({
          vouchers: allVSnap.size,
          pending: pendingSnap.size,
          totalBilled,
          totalCollected,
        });
        setRecentVouchers(vouchers);
        setRecentBilling(statements);
      } catch (e) {
        console.error(e);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  return (
    <div style={{ height:'100%', overflowY:'auto', padding:24, fontFamily:'Inter,system-ui,sans-serif' }}>
      <style>{STAT_CARD}</style>

      {/* Header */}
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', marginBottom:22 }}>
        <div>
          <h1 style={{ margin:0, fontSize:22, fontWeight:900, color:'#0f172a' }}>{timeLabel}, ScaleBooks! 👋</h1>
          <p style={{ margin:'4px 0 0', fontSize:13, color:'#64748b' }}>Here's what's happening in your finance portal today.</p>
        </div>
        <div style={{ background:'#fff', border:'1px solid #e5e7eb', borderRadius:12, padding:'10px 16px', textAlign:'right' }}>
          <div style={{ fontSize:10, fontWeight:800, color:'#94a3b8', letterSpacing:'.07em', textTransform:'uppercase' }}>Today</div>
          <div style={{ fontSize:13, fontWeight:800, color:'#0f172a' }}>{dateLabel}</div>
        </div>
      </div>

      {/* Stats */}
      <div className="dc-grid">
        <div className="dc-stat">
          <div className="dc-stat-label">Total Vouchers</div>
          <div className="dc-stat-value">{loading ? '—' : stats.vouchers}</div>
          <div className="dc-stat-sub">All-time</div>
        </div>
        <div className="dc-stat orange">
          <div className="dc-stat-label">Pending Approvals</div>
          <div className="dc-stat-value">{loading ? '—' : stats.pending}</div>
          <div className="dc-stat-sub">Awaiting action</div>
        </div>
        <div className="dc-stat blue">
          <div className="dc-stat-label">Total Billed (AR)</div>
          <div className="dc-stat-value">{loading ? '—' : fmt(stats.totalBilled)}</div>
          <div className="dc-stat-sub">Billing statements</div>
        </div>
        <div className="dc-stat green">
          <div className="dc-stat-label">Total Collected</div>
          <div className="dc-stat-value">{loading ? '—' : fmt(stats.totalCollected)}</div>
          <div className="dc-stat-sub">Payments received</div>
        </div>
      </div>

      {/* Recent Activity */}
      <div className="dc-two">
        {/* Recent Vouchers */}
        <div className="dc-section">
          <div className="dc-section-head">
            <strong>Recent Vouchers</strong>
            <a onClick={() => navigate('/scalebooks/vouchers')}>View all →</a>
          </div>
          {loading ? (
            <div style={{ padding:32, textAlign:'center', color:'#94a3b8', fontSize:13 }}>Loading…</div>
          ) : recentVouchers.length === 0 ? (
            <div style={{ padding:32, textAlign:'center', color:'#94a3b8', fontSize:13 }}>No vouchers yet. <a onClick={() => navigate('/scalebooks/vouchers')} style={{ color:'#f97316', cursor:'pointer' }}>Create one →</a></div>
          ) : recentVouchers.map(v => (
            <div key={v.id} className="dc-row" onClick={() => navigate('/scalebooks/vouchers')} style={{ cursor:'pointer' }}>
              <div>
                <div style={{ fontWeight:700, fontSize:13 }}>{v.number || v.id}</div>
                <div style={{ fontSize:11, color:'#94a3b8' }}>{v.payee || v.contact || '—'}</div>
              </div>
              <div style={{ textAlign:'right' }}>
                <div style={{ fontWeight:800, fontSize:13 }}>{fmt(v.amount)}</div>
                <span className={`pill pill-${(v.status||'pending').toLowerCase()}`}>{v.status || 'Pending'}</span>
              </div>
            </div>
          ))}
        </div>

        {/* Recent Billing */}
        <div className="dc-section">
          <div className="dc-section-head">
            <strong>Recent Billing Statements</strong>
            <a onClick={() => navigate('/scalebooks/billing')}>View all →</a>
          </div>
          {loading ? (
            <div style={{ padding:32, textAlign:'center', color:'#94a3b8', fontSize:13 }}>Loading…</div>
          ) : recentBilling.length === 0 ? (
            <div style={{ padding:32, textAlign:'center', color:'#94a3b8', fontSize:13 }}>No billing statements yet. <a onClick={() => navigate('/scalebooks/billing')} style={{ color:'#f97316', cursor:'pointer' }}>Open a client book →</a></div>
          ) : recentBilling.map(b => (
            <div key={b.id} className="dc-row" onClick={() => navigate('/scalebooks/billing')} style={{ cursor:'pointer' }}>
              <div>
                <div style={{ fontWeight:700, fontSize:13 }}>{b.billingNo || b.id}</div>
                <div style={{ fontSize:11, color:'#94a3b8' }}>{b.contactName || b.contact || '—'} · {b.period || b.billingPeriod || ''}</div>
              </div>
              <div style={{ textAlign:'right' }}>
                <div style={{ fontWeight:800, fontSize:13 }}>{fmt(b.netDue || b.totalAmount)}</div>
                <span className={`pill pill-${(b.status||'draft').toLowerCase().replace(' ','-')}`}>{b.status || 'Draft'}</span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

import { useAuth } from '../../auth/AuthProvider.jsx';

const APP_CARDS = [
  {
    name: 'Accounting',
    path: '/accounting',
    icon: '📊',
    banner: 'linear-gradient(135deg, #0b1220 0%, #1e3a5f 100%)',
    desc: 'Manage disbursements, vouchers, journal entries, bank ledger, chart of accounts, billing statements, collections, and financial reporting.',
  },
  {
    name: 'Payroll',
    path: '/payroll',
    icon: '👥',
    banner: 'linear-gradient(135deg, #052e16 0%, #065f46 100%)',
    desc: 'Upload and consolidate HRIS data, process payroll, manage deductions, generate BIR forms, 13th month, final pay, and incentive sheets.',
  },
  {
    name: 'Billing Book',
    path: '/billing',
    icon: '🧾',
    banner: 'linear-gradient(135deg, #1e1b4b 0%, #312e81 100%)',
    desc: 'Manage client billing books, upload raw billing files, generate computations, and push data to payroll.',
  },
  {
    name: 'Projections',
    path: '/projections',
    icon: '📈',
    banner: 'linear-gradient(135deg, #431407 0%, #9a3412 100%)',
    desc: 'Build headcount plans, salary budgets, and multi-profile financial projections.',
  },
];

export default function HomePage() {
  const { session } = useAuth();
  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
  const email = session?.user?.email || '';
  const displayName = session?.user?.fullName || (email ? email.split('@')[0] : '');
  const firstName = displayName.trim().split(/\s+/)[0] || 'there';
  const today = new Date().toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' });

  return (
    <div style={{ padding: '36px 32px', fontFamily: 'Inter, sans-serif' }}>

      {/* Greeting row */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 20, marginBottom: 28, flexWrap: 'wrap' }}>
        <div>
          <p style={{ fontSize: 26, fontWeight: 900, color: '#0f172a', margin: '0 0 4px' }}>
            {greeting}, {firstName}! 👋
          </p>
          <p style={{ fontSize: 13, color: '#64748b', margin: 0 }}>
            Welcome back to the Sentire Finance Portal.
          </p>
        </div>
        <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 16, padding: '14px 18px', fontSize: 13, color: '#64748b', flexShrink: 0 }}>
          <div style={{ fontSize: 10, fontWeight: 800, color: '#f97316', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 6 }}>Today</div>
          <div style={{ fontWeight: 700, color: '#0f172a' }}>{today}</div>
        </div>
      </div>

      {/* Hero banner */}
      <div style={{ marginBottom: 40 }}>
        <div style={{
          background: 'linear-gradient(135deg, #0b1220 0%, #1e3a5f 100%)',
          borderRadius: 20, padding: '36px 40px', color: '#fff', position: 'relative', overflow: 'hidden',
        }}>
          <div style={{ position: 'absolute', top: -40, right: -40, width: 200, height: 200, background: 'rgba(249,115,22,.15)', borderRadius: '50%' }} />
          <div style={{ position: 'absolute', bottom: -60, right: 60, width: 150, height: 150, background: 'rgba(249,115,22,.08)', borderRadius: '50%' }} />
          <h1 style={{ fontSize: 28, fontWeight: 900, margin: '0 0 10px', position: 'relative', zIndex: 1 }}>Finance Portal</h1>
          <p style={{ color: '#94a3b8', fontSize: 14, margin: 0, position: 'relative', zIndex: 1 }}>
            Unified access to all Sentire Finance applications — no separate links needed.
          </p>
          <div style={{ display: 'flex', gap: 20, marginTop: 24, position: 'relative', zIndex: 1 }}>
            <div style={{ background: 'rgba(255,255,255,.07)', border: '1px solid rgba(255,255,255,.1)', padding: '10px 16px', borderRadius: 12 }}>
              <div style={{ fontSize: 20, fontWeight: 900 }}>{APP_CARDS.length}</div>
              <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 2 }}>Applications</div>
            </div>
            <div style={{ background: 'rgba(255,255,255,.07)', border: '1px solid rgba(255,255,255,.1)', padding: '10px 16px', borderRadius: 12 }}>
              <div style={{ fontSize: 20, fontWeight: 900 }}>{today}</div>
              <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 2 }}>Today's Date</div>
            </div>
          </div>
        </div>
      </div>

      {/* App cards */}
      <div style={{ fontSize: 12, fontWeight: 800, color: '#64748b', letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: 16 }}>
        Launch an Application
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 20 }}>
        {APP_CARDS.map(app => (
          <AppCard key={app.path} app={app} />
        ))}
      </div>
    </div>
  );
}

function AppCard({ app }) {
  return (
    <div
      onClick={() => window.location.hash = app.path}
      style={{
        background: '#fff', border: '1px solid #e5e7eb', borderRadius: 18,
        overflow: 'hidden', cursor: 'pointer', transition: 'box-shadow 0.2s, transform 0.15s',
      }}
      onMouseOver={e => { e.currentTarget.style.boxShadow = '0 16px 48px rgba(0,0,0,.12)'; e.currentTarget.style.transform = 'translateY(-3px)'; }}
      onMouseOut={e => { e.currentTarget.style.boxShadow = 'none'; e.currentTarget.style.transform = 'none'; }}
    >
      <div style={{ height: 110, background: app.banner, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <span style={{ fontSize: 52, filter: 'drop-shadow(0 4px 12px rgba(0,0,0,.3))' }}>{app.icon}</span>
      </div>
      <div style={{ padding: '20px 22px 22px' }}>
        <div style={{ fontSize: 15, fontWeight: 900, margin: '0 0 8px' }}>{app.name}</div>
        <p style={{ color: '#64748b', fontSize: 13, lineHeight: 1.55, margin: '0 0 18px' }}>{app.desc}</p>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '5px 10px', borderRadius: 999, fontSize: 11, fontWeight: 700, background: '#f0fdf4', border: '1px solid #bbf7d0', color: '#15803d' }}>
            <span style={{ width: 7, height: 7, borderRadius: '50%', background: '#15803d', display: 'inline-block' }} />
            Available
          </span>
          <button
            onClick={e => { e.stopPropagation(); window.location.pathname = app.path; }}
            style={{ background: '#f97316', color: '#fff', border: 'none', borderRadius: 12, padding: '10px 16px', fontWeight: 700, fontSize: 13, cursor: 'pointer' }}
          >
            Open App ↗
          </button>
        </div>
      </div>
    </div>
  );
}

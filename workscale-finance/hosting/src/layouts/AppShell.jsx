import { useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { auth } from '../firebase.js';

const NAV_ITEMS = [
  { label: 'Portal Home',   icon: '🏠', path: '/' },
  { label: 'Accounting',    icon: '📊', path: '/accounting' },
  { label: 'Payroll',       icon: '👥', path: '/payroll' },
  { label: 'Billing Book',  icon: '🧾', path: '/billing' },
  { label: 'Projections',   icon: '📈', path: '/projections' },
];

export default function AppShell({ children }) {
  const [collapsed, setCollapsed] = useState(false);
  const navigate  = useNavigate();
  const location  = useLocation();
  const user      = auth.currentUser;

  return (
    <div style={{ display: 'flex', height: '100vh', overflow: 'hidden' }}>

      {/* ── Sidebar ── */}
      <aside style={{
        width: collapsed ? 62 : 260,
        flexShrink: 0,
        background: 'linear-gradient(180deg, #0b1220, #0f1b31)',
        color: '#fff',
        padding: collapsed ? '18px 0' : '18px 14px',
        height: '100vh',
        overflowY: 'auto',
        display: 'flex',
        flexDirection: 'column',
        transition: 'width 0.22s ease',
      }}>

        {/* Brand */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: collapsed ? 'center' : 'space-between', padding: collapsed ? '10px 0 18px' : '10px 10px 18px' }}>
          {!collapsed && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div style={{ width: 36, height: 36, borderRadius: 10, background: '#f97316', display: 'grid', placeItems: 'center', fontWeight: 800, fontSize: 16, flexShrink: 0 }}>W</div>
              <div>
                <div style={{ fontWeight: 900, letterSpacing: '.02em' }}>WORKSCALE</div>
                <small style={{ color: '#cbd5e1', fontSize: 11 }}>FINANCE PORTAL</small>
              </div>
            </div>
          )}
          {collapsed && (
            <div style={{ width: 36, height: 36, borderRadius: 10, background: '#f97316', display: 'grid', placeItems: 'center', fontWeight: 800, fontSize: 16 }}>W</div>
          )}
          {!collapsed && (
            <button onClick={() => setCollapsed(true)} title="Collapse sidebar" style={{ background: 'transparent', border: 'none', color: '#94a3b8', cursor: 'pointer', fontSize: 18, padding: '4px 6px', borderRadius: 6 }}>☰</button>
          )}
        </div>

        {collapsed && (
          <button onClick={() => setCollapsed(false)} title="Expand sidebar" style={{ background: 'transparent', border: 'none', color: '#94a3b8', cursor: 'pointer', fontSize: 18, padding: '4px 0', borderRadius: 6, margin: '0 auto 10px' }}>☰</button>
        )}

        {/* Nav */}
        <nav>
          {!collapsed && <div style={{ fontSize: 11, fontWeight: 800, color: '#64748b', letterSpacing: '0.05em', padding: '16px 12px 6px', textTransform: 'uppercase' }}>Navigation</div>}
          {NAV_ITEMS.map(item => {
            const active = location.pathname === item.path;
            return (
              <a
                key={item.path}
                onClick={() => navigate(item.path)}
                style={{
                  display: 'flex', gap: collapsed ? 0 : 10, alignItems: 'center',
                  color: '#e2e8f0', textDecoration: 'none',
                  padding: collapsed ? '11px 0' : '12px 12px',
                  justifyContent: collapsed ? 'center' : 'flex-start',
                  borderRadius: 12, margin: '2px 4px',
                  cursor: 'pointer',
                  background: active ? 'rgba(255,255,255,.12)' : 'transparent',
                  transition: 'background 0.15s',
                  fontSize: collapsed ? 20 : 14,
                }}
                onMouseOver={e => { if (!active) e.currentTarget.style.background = 'rgba(255,255,255,.08)'; }}
                onMouseOut={e => { if (!active) e.currentTarget.style.background = 'transparent'; }}
              >
                <span style={{ fontSize: collapsed ? 20 : 16, flexShrink: 0, width: collapsed ? 'auto' : 20, textAlign: 'center' }}>{item.icon}</span>
                {!collapsed && <span>{item.label}</span>}
              </a>
            );
          })}
        </nav>

        {/* Footer */}
        {!collapsed && (
          <div style={{ marginTop: 'auto', padding: '16px 14px', color: '#cbd5e1', fontSize: 12 }}>
            <div>Logged in:</div>
            <div style={{ wordBreak: 'break-all', marginTop: 2 }}>{user?.email || '—'}</div>
            <button
              onClick={() => auth.signOut()}
              style={{ marginTop: 10, background: 'rgba(255,255,255,.08)', border: 'none', color: '#cbd5e1', borderRadius: 8, padding: '6px 12px', fontSize: 11, fontWeight: 700, cursor: 'pointer', width: '100%' }}
            >
              Sign Out
            </button>
          </div>
        )}
      </aside>

      {/* ── Main content ── */}
      <main style={{ flex: 1, display: 'flex', flexDirection: 'column', height: '100vh', overflow: 'hidden' }}>
        <div style={{ flex: 1, overflowY: 'auto' }}>
          {children}
        </div>
      </main>
    </div>
  );
}

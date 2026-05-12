import { useState } from 'react';
import { Routes, Route, Navigate, NavLink, useNavigate } from 'react-router-dom';
import { auth } from '../../firebase.js';

// Pages
import DashboardPage from './DashboardPage.jsx';
import VouchersPage from './vouchers/VouchersPage.jsx';
import JournalPage from './journal/JournalPage.jsx';
import COAPage from './coa/COAPage.jsx';
import BankPage from './bank/BankPage.jsx';
import BillingPage from './billing/BillingPage.jsx';
import BillingClientPage from './billing/BillingClientPage.jsx';
import ContactsPage from './contacts/ContactsPage.jsx';
import ApprovalsPage from './approvals/ApprovalsPage.jsx';
import ProjectionsPage from './projections/ProjectionsPage.jsx';
import PaymentSchedulePage from './schedule/PaymentSchedulePage.jsx';
import DisbursementsPage from './disbursements/DisbursementsPage.jsx';
import CheckRegistryPage from './checks/CheckRegistryPage.jsx';
import TaxPage from './tax/TaxPage.jsx';
import FinancialPage from './financial/FinancialPage.jsx';
import FixedAssetsPage from './assets/FixedAssetsPage.jsx';
import ServiceInvoicesPage from './invoices/ServiceInvoicesPage.jsx';
import CollectionsPage from './collections/CollectionsPage.jsx';
import SettingsPage from './settings/SettingsPage.jsx';

const NAV = [
  { label: 'Dashboard', icon: '🏠', path: '' },
  { group: 'Disbursement' },
  { label: 'Vouchers', icon: '📄', path: 'vouchers' },
  { label: 'My Approvals', icon: '✅', path: 'approvals' },
  { label: 'Weekly Projections', icon: '📅', path: 'projections' },
  { label: 'Payment Schedule', icon: '📆', path: 'pay-schedule' },
  { label: 'Master Disbursements', icon: '💸', path: 'disbursements' },
  { label: 'Check Registry', icon: '📝', path: 'checks' },
  { group: 'Accountant' },
  { label: 'Journal', icon: '📓', path: 'journal' },
  { label: 'Bank', icon: '🏦', path: 'bank' },
  { label: 'Chart of Accounts', icon: '📚', path: 'coa' },
  { label: 'Tax', icon: '🧾', path: 'tax' },
  { label: 'Financial Mgmt', icon: '💰', path: 'financial' },
  { label: 'Fixed Assets', icon: '🏗️', path: 'assets' },
  { group: 'Billing & AR' },
  { label: 'Billing Book', icon: '📋', path: 'billing' },
  { label: 'Service Invoices', icon: '🧾', path: 'invoices' },
  { label: 'Collections', icon: '💵', path: 'collections' },
  { group: 'System' },
  { label: 'Contacts', icon: '👥', path: 'contacts' },
  { label: 'Settings', icon: '⚙️', path: 'settings' },
];

const CSS = `
  .sb-wrap { display:flex; height:100vh; width:100%; overflow:hidden; font-family:Inter,system-ui,sans-serif; }
  .sb-sidebar { width:248px; min-width:248px; background:linear-gradient(180deg,#0b1220,#0f1b31); color:#fff; display:flex; flex-direction:column; overflow:hidden; transition:width .25s, transform .25s; flex-shrink:0; }
  .sb-sidebar.collapsed { width:60px; min-width:60px; }
  .sb-brand { display:flex; align-items:center; gap:10px; padding:16px 14px 14px; border-bottom:1px solid rgba(255,255,255,.07); flex-shrink:0; }
  .sb-logo { width:34px; height:34px; border-radius:10px; background:#f97316; display:grid; place-items:center; font-weight:900; font-size:16px; flex-shrink:0; }
  .sb-brand-text { overflow:hidden; }
  .sb-brand-text .title { font-weight:900; font-size:13px; letter-spacing:.03em; white-space:nowrap; }
  .sb-brand-text .sub { font-size:10px; color:#94a3b8; white-space:nowrap; }
  .sb-toggle { margin-left:auto; background:transparent; border:0; color:#64748b; cursor:pointer; font-size:16px; flex-shrink:0; }
  .sb-nav { flex:1; overflow-y:auto; padding:8px 0; }
  .sb-nav::-webkit-scrollbar { width:4px; }
  .sb-nav::-webkit-scrollbar-thumb { background:rgba(255,255,255,.1); border-radius:4px; }
  .sb-group { font-size:10px; font-weight:800; color:#475569; letter-spacing:.08em; padding:14px 16px 5px; text-transform:uppercase; white-space:nowrap; overflow:hidden; }
  .sb-link { display:flex; align-items:center; gap:10px; color:#cbd5e1; text-decoration:none; padding:9px 14px; margin:1px 6px; border-radius:10px; font-size:13px; font-weight:500; white-space:nowrap; overflow:hidden; }
  .sb-link:hover { background:rgba(255,255,255,.07); color:#fff; }
  .sb-link.active { background:rgba(249,115,22,.15); color:#fb923c; font-weight:700; }
  .sb-link .icon { font-size:15px; flex-shrink:0; }
  .sb-link .lbl { overflow:hidden; text-overflow:ellipsis; }
  .sb-bottom { padding:12px 14px; border-top:1px solid rgba(255,255,255,.07); flex-shrink:0; overflow:hidden; }
  .sb-user { font-size:11px; color:#94a3b8; margin-bottom:8px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
  .sb-signout { width:100%; background:rgba(255,255,255,.06); border:0; color:#cbd5e1; border-radius:10px; padding:8px; font-size:12px; font-weight:600; cursor:pointer; }
  .sb-signout:hover { background:rgba(255,255,255,.12); }
  .sb-main { flex:1; min-width:0; overflow:hidden; display:flex; flex-direction:column; background:#f6f8fb; position:relative; }
  /* Mobile hamburger — hidden on desktop */
  .sb-mob-btn { display:none; position:absolute; top:14px; left:14px; z-index:50; width:38px; height:38px; border-radius:10px; background:#0b1220; border:0; color:#fff; font-size:18px; cursor:pointer; align-items:center; justify-content:center; box-shadow:0 2px 10px rgba(0,0,0,.25); }
  /* Overlay for mobile when sidebar open */
  .sb-overlay { display:none; position:fixed; inset:0; background:rgba(0,0,0,.5); z-index:199; }
  /* ── Responsive breakpoints ── */
  @media (max-width:1280px) {
    .sb-sidebar:not(.collapsed) { width:220px; min-width:220px; }
  }
  @media (max-width:1024px) {
    .sb-sidebar:not(.collapsed) { width:200px; min-width:200px; }
    .sb-link { font-size:12px; padding:8px 12px; }
    .sb-group { padding:12px 12px 4px; }
  }
  @media (max-width:768px) {
    .sb-sidebar { position:fixed; top:0; left:0; height:100vh; z-index:200; width:248px !important; min-width:248px !important; }
    .sb-sidebar.collapsed { transform:translateX(-100%); }
    .sb-sidebar:not(.collapsed) { transform:translateX(0); box-shadow:6px 0 40px rgba(0,0,0,.4); }
    .sb-mob-btn { display:flex; }
    .sb-overlay.open { display:block; }
    .sb-main { width:100%; padding-top:0; }
  }
  /* ── Global child-page responsive helpers ── */
  @media (max-width:960px) {
    .summary-bar { grid-template-columns:repeat(2,1fr) !important; }
    .grid4 { grid-template-columns:repeat(2,1fr) !important; }
    .col4 { grid-column:span 2 !important; }
  }
  @media (max-width:600px) {
    .summary-bar { grid-template-columns:1fr !important; }
    .grid4 { grid-template-columns:1fr !important; }
    .col2,.col4 { grid-column:span 1 !important; }
    .toolbar { flex-direction:column; align-items:stretch !important; }
    .tabs { width:100% !important; }
  }
  /* Tables scroll horizontally on small screens */
  .card { overflow-x:auto; }
`;

export default function ScaleBooksApp() {
  const [collapsed, setCollapsed] = useState(false);
  const navigate = useNavigate();
  const user = auth.currentUser;

  function handleSignOut() {
    auth.signOut().then(() => navigate('/login'));
  }

  return (
    <>
      <style>{CSS}</style>
      <div className="sb-wrap">
        <aside className={`sb-sidebar${collapsed ? ' collapsed' : ''}`}>
          <div className="sb-brand">
            <div className="sb-logo">S</div>
            {!collapsed && (
              <div className="sb-brand-text">
                <div className="title">SCALEBOOKS</div>
                <div className="sub">FINANCE PORTAL</div>
              </div>
            )}
            <button className="sb-toggle" onClick={() => setCollapsed(c => !c)}>
              {collapsed ? '»' : '«'}
            </button>
          </div>

          <nav className="sb-nav">
            {NAV.map((item, i) => {
              if (item.group) {
                return collapsed ? null : <div key={i} className="sb-group">{item.group}</div>;
              }
              const to = `/scalebooks${item.path ? '/' + item.path : ''}`;
              return (
                <NavLink
                  key={i}
                  to={to}
                  end={item.path === ''}
                  className={({ isActive }) => `sb-link${isActive ? ' active' : ''}`}
                >
                  <span className="icon">{item.icon}</span>
                  {!collapsed && <span className="lbl">{item.label}</span>}
                </NavLink>
              );
            })}
          </nav>

          <div className="sb-bottom">
            {!collapsed && (
              <div className="sb-user">
                {user?.email || 'Logged in'}
              </div>
            )}
            <button className="sb-signout" onClick={handleSignOut}>
              {collapsed ? '⏻' : 'Sign Out'}
            </button>
          </div>
        </aside>

        {!collapsed && <div className="sb-overlay open" onClick={() => setCollapsed(true)} />}
        <main className="sb-main">
          <button className="sb-mob-btn" onClick={() => setCollapsed(c => !c)}>☰</button>
          <Routes>
            <Route index element={<DashboardPage />} />
            <Route path="vouchers/*" element={<VouchersPage />} />
            <Route path="journal" element={<JournalPage />} />
            <Route path="coa" element={<COAPage />} />
            <Route path="bank" element={<BankPage />} />
            <Route path="billing" element={<BillingPage />} />
            <Route path="billing/:clientId" element={<BillingClientPage />} />
            <Route path="contacts" element={<ContactsPage />} />
            <Route path="approvals" element={<ApprovalsPage />} />
            <Route path="projections" element={<ProjectionsPage />} />
            <Route path="pay-schedule" element={<PaymentSchedulePage />} />
            <Route path="disbursements" element={<DisbursementsPage />} />
            <Route path="checks" element={<CheckRegistryPage />} />
            <Route path="tax" element={<TaxPage />} />
            <Route path="financial" element={<FinancialPage />} />
            <Route path="assets" element={<FixedAssetsPage />} />
            <Route path="invoices" element={<ServiceInvoicesPage />} />
            <Route path="collections" element={<CollectionsPage />} />
            <Route path="settings" element={<SettingsPage />} />
            <Route path="*" element={<Navigate to="/scalebooks" replace />} />
          </Routes>
        </main>
      </div>
    </>
  );
}

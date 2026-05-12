import { useState, useEffect } from 'react';
import { Routes, Route, Navigate, NavLink, useNavigate } from 'react-router-dom';
import { auth, db } from '../../firebase.js';
import { doc, onSnapshot } from 'firebase/firestore';

import DashboardPage       from './DashboardPage.jsx';
import VouchersPage        from './vouchers/VouchersPage.jsx';
import JournalPage         from './journal/JournalPage.jsx';
import COAPage             from './coa/COAPage.jsx';
import BankPage            from './bank/BankPage.jsx';
import BillingPage         from './billing/BillingPage.jsx';
import BillingClientPage   from './billing/BillingClientPage.jsx';
import ContactsPage        from './contacts/ContactsPage.jsx';
import ApprovalsPage       from './approvals/ApprovalsPage.jsx';
import ProjectionsPage     from './projections/ProjectionsPage.jsx';
import PaymentSchedulePage from './schedule/PaymentSchedulePage.jsx';
import DisbursementsPage   from './disbursements/DisbursementsPage.jsx';
import CheckRegistryPage   from './checks/CheckRegistryPage.jsx';
import TaxPage             from './tax/TaxPage.jsx';
import FinancialPage       from './financial/FinancialPage.jsx';
import FixedAssetsPage     from './assets/FixedAssetsPage.jsx';
import ServiceInvoicesPage from './invoices/ServiceInvoicesPage.jsx';
import CollectionsPage     from './collections/CollectionsPage.jsx';
import SettingsPage        from './settings/SettingsPage.jsx';

// ── Minimal SVG icon set (Lucide-style stroke icons) ─────
const ICONS = {
  dashboard: <><rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/></>,
  voucher:   <><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></>,
  approval:  <><path d="M22 11.08V12a10 10 0 11-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></>,
  calendar:  <><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></>,
  schedule:  <><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/><polyline points="9 16 11 18 15 14"/></>,
  send:      <><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></>,
  pen:       <><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 013 3L7 19l-4 1 1-4L16.5 3.5z"/></>,
  journal:   <><path d="M2 3h6a4 4 0 014 4v14a3 3 0 00-3-3H2z"/><path d="M22 3h-6a4 4 0 00-4 4v14a3 3 0 013-3h7z"/></>,
  bank:      <><line x1="3" y1="22" x2="21" y2="22"/><line x1="6" y1="18" x2="6" y2="11"/><line x1="10" y1="18" x2="10" y2="11"/><line x1="14" y1="18" x2="14" y2="11"/><line x1="18" y1="18" x2="18" y2="11"/><polygon points="12 2 20 7 4 7"/></>,
  coa:       <><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></>,
  tax:       <><polyline points="4 2 4 22 8 19 12 22 16 19 20 22 20 2"/><line x1="8" y1="9" x2="16" y2="9"/><line x1="8" y1="13" x2="16" y2="13"/></>,
  chart:     <><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/><line x1="2" y1="20" x2="22" y2="20"/></>,
  assets:    <><path d="M21 16V8a2 2 0 00-1-1.73l-7-4a2 2 0 00-2 0l-7 4A2 2 0 003 8v8a2 2 0 001 1.73l7 4a2 2 0 002 0l7-4A2 2 0 0021 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/></>,
  billing:   <><path d="M16 4h2a2 2 0 012 2v14a2 2 0 01-2 2H6a2 2 0 01-2-2V6a2 2 0 012-2h2"/><rect x="8" y="2" width="8" height="4" rx="1"/><line x1="9" y1="12" x2="15" y2="12"/><line x1="9" y1="16" x2="13" y2="16"/></>,
  invoice:   <><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/><polyline points="9 15 11 17 15 13"/></>,
  wallet:    <><path d="M21 12V7H5a2 2 0 010-4h14v4"/><path d="M3 5v14a2 2 0 002 2h16v-5"/><path d="M18 12a2 2 0 000 4h3v-4z"/></>,
  users:     <><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 00-3-3.87"/><path d="M16 3.13a4 4 0 010 7.75"/></>,
  settings:  <><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z"/></>,
  signout:   <><path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></>,
  chevDown:  <polyline points="6 9 12 15 18 9"/>,
  chevLeft:  <polyline points="15 18 9 12 15 6"/>,
  chevRight: <polyline points="9 18 15 12 9 6"/>,
  menu:      <><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></>,
};

function Ico({ name, size = 15 }) {
  return (
    <svg
      width={size} height={size} viewBox="0 0 24 24"
      fill="none" stroke="currentColor"
      strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"
      aria-hidden="true" style={{ flexShrink: 0, display: 'block' }}
    >
      {ICONS[name]}
    </svg>
  );
}

// ── Navigation groups ─────────────────────────────────────
const NAV_GROUPS = [
  {
    key: 'home', label: null,
    items: [
      { label: 'Dashboard', icon: 'dashboard', path: '' },
    ],
  },
  {
    key: 'disbursement', label: 'Disbursement',
    items: [
      { label: 'Vouchers',           icon: 'voucher',  path: 'vouchers' },
      { label: 'Approvals',          icon: 'approval', path: 'approvals' },
      { label: 'Weekly Projections', icon: 'calendar', path: 'projections' },
      { label: 'Payment Schedule',   icon: 'schedule', path: 'pay-schedule' },
      { label: 'Disbursements',      icon: 'send',     path: 'disbursements' },
      { label: 'Check Registry',     icon: 'pen',      path: 'checks' },
    ],
  },
  {
    key: 'accountant', label: 'Accountant',
    items: [
      { label: 'Journal',           icon: 'journal', path: 'journal' },
      { label: 'Bank',              icon: 'bank',    path: 'bank' },
      { label: 'Chart of Accounts', icon: 'coa',     path: 'coa' },
      { label: 'Tax',               icon: 'tax',     path: 'tax' },
      { label: 'Financial Mgmt',    icon: 'chart',   path: 'financial' },
      { label: 'Fixed Assets',      icon: 'assets',  path: 'assets' },
    ],
  },
  {
    key: 'billing', label: 'Billing & AR',
    items: [
      { label: 'Billing Book',     icon: 'billing', path: 'billing' },
      { label: 'Service Invoices', icon: 'invoice', path: 'invoices' },
      { label: 'Collections',      icon: 'wallet',  path: 'collections' },
    ],
  },
  {
    key: 'system', label: 'System',
    items: [
      { label: 'Contacts', icon: 'users',    path: 'contacts' },
      { label: 'Settings', icon: 'settings', path: 'settings' },
    ],
  },
];

// ── Styles ────────────────────────────────────────────────
const CSS = `
  .sb-wrap { display:flex; height:100vh; width:100%; overflow:hidden; font-family:Inter,system-ui,sans-serif; }

  /* ── Sidebar shell ── */
  .sb-aside {
    width:240px; flex-shrink:0;
    background:#0f1224; color:#fff;
    display:flex; flex-direction:column;
    overflow:hidden;
    transition:width .22s cubic-bezier(.4,0,.2,1);
  }
  .sb-col { width:60px; }

  /* ── Brand ── */
  .sb-brand {
    display:flex; align-items:center; gap:8px;
    padding:14px 10px 12px 13px;
    border-bottom:1px solid rgba(255,255,255,.06);
    flex-shrink:0; min-height:58px;
  }
  .sb-col .sb-brand {
    flex-direction:column; align-items:center;
    padding:13px 0 10px; gap:5px; min-height:auto;
  }
  .sb-logo {
    width:34px; height:34px; border-radius:10px;
    background:#f97316; display:grid; place-items:center;
    font-weight:900; font-size:15px; flex-shrink:0; color:#fff;
    overflow:hidden;
  }
  .sb-logo img { width:100%; height:100%; object-fit:contain; background:#fff; padding:2px; box-sizing:border-box; }
  .sb-brand-txt { flex:1; overflow:hidden; }
  .sb-title { display:block; font-size:12px; font-weight:900; letter-spacing:.04em; color:#f1f5f9; white-space:nowrap; }
  .sb-sub   { display:block; font-size:9.5px; color:#475569; white-space:nowrap; margin-top:1px; letter-spacing:.02em; }
  .sb-tog {
    background:none; border:none; color:#64748b; cursor:pointer;
    display:flex; align-items:center; justify-content:center;
    width:28px; height:28px; border-radius:7px;
    margin-left:auto; flex-shrink:0;
    transition:background .15s, color .15s;
  }
  .sb-col .sb-tog { margin:0; width:36px; height:28px; background:rgba(255,255,255,.05); border-radius:8px; }
  .sb-tog:hover { background:rgba(255,255,255,.1); color:#cbd5e1; }

  /* ── Scrollable nav ── */
  .sb-nav { flex:1; overflow-y:auto; overflow-x:hidden; padding:4px 0 10px; }
  .sb-nav::-webkit-scrollbar { width:3px; }
  .sb-nav::-webkit-scrollbar-thumb { background:rgba(255,255,255,.07); border-radius:3px; }

  /* ── Group divider ── */
  .sb-divider { height:1px; background:rgba(255,255,255,.05); margin:5px 12px 2px; }

  /* ── Group toggle header ── */
  .sb-grp-hdr {
    display:flex; align-items:center; justify-content:space-between;
    width:100%; background:none; border:none; cursor:pointer;
    padding:10px 14px 3px; font-family:inherit;
    font-size:9.5px; font-weight:800; letter-spacing:.1em;
    text-transform:uppercase; color:#475569;
    transition:color .15s;
  }
  .sb-grp-hdr:hover { color:#94a3b8; }
  .sb-grp-ico { display:flex; align-items:center; transition:transform .2s; }
  .sb-grp-ico.rot { transform:rotate(-90deg); }

  /* ── Accordion items ── */
  .sb-items { overflow:hidden; transition:max-height .22s ease; max-height:900px; }
  .sb-items.closed { max-height:0 !important; }

  /* ── Nav link ── */
  .sb-link {
    display:flex; align-items:center; gap:10px;
    padding:8.5px 12px 8.5px 14px; margin:1px 8px; border-radius:9px;
    color:#7f93aa; text-decoration:none; font-size:13px; font-weight:500;
    transition:background .12s, color .12s;
    white-space:nowrap; overflow:hidden;
  }
  .sb-link:hover { background:rgba(255,255,255,.07); color:#e2e8f0; }
  .sb-link.active { background:rgba(249,115,22,.15); color:#fb923c; font-weight:700; }
  .sb-ico { display:flex; align-items:center; justify-content:center; flex-shrink:0; width:16px; }
  .sb-lbl { overflow:hidden; text-overflow:ellipsis; }

  /* ── Collapsed: icon-only ── */
  .sb-col .sb-link { justify-content:center; padding:9px 0; margin:2px 8px; }
  .sb-col .sb-ico  { width:auto; }
  .sb-col .sb-lbl  { display:none; }

  /* ── Footer ── */
  .sb-foot {
    padding:10px 12px 14px;
    border-top:1px solid rgba(255,255,255,.06);
    flex-shrink:0;
  }
  .sb-col .sb-foot { padding:10px 0 14px; display:flex; flex-direction:column; align-items:center; }
  .sb-user { font-size:11px; color:#475569; margin-bottom:8px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .sb-out {
    display:flex; align-items:center; gap:8px;
    width:100%; background:rgba(255,255,255,.05); border:none;
    color:#7f93aa; border-radius:9px; padding:8px 10px;
    font-size:12px; font-weight:600; cursor:pointer; font-family:inherit;
    transition:background .15s, color .15s;
  }
  .sb-col .sb-out { width:40px; height:36px; justify-content:center; padding:0; }
  .sb-out:hover { background:rgba(249,115,22,.15); color:#fb923c; }

  /* ── Main area ── */
  .sb-main { flex:1; min-width:0; overflow:hidden; display:flex; flex-direction:column; background:#f6f8fb; position:relative; }

  /* ── Mobile overlay: hidden on desktop, shown on mobile when open ── */
  .sb-overlay { display:none; position:fixed; inset:0; background:rgba(0,0,0,.5); z-index:199; }

  /* ── Mobile hamburger ── */
  .sb-mob-btn {
    display:none; position:absolute; top:14px; left:14px; z-index:50;
    width:38px; height:38px; border-radius:10px; background:#0f1224;
    border:0; color:#fff; cursor:pointer;
    align-items:center; justify-content:center;
    box-shadow:0 2px 10px rgba(0,0,0,.25);
  }

  /* ── Responsive ── */
  @media (max-width:1280px) {
    .sb-aside:not(.sb-col) { width:218px; }
  }
  @media (max-width:768px) {
    .sb-aside {
      position:fixed; top:0; left:0; height:100vh; z-index:200;
      width:240px !important;
      transition:transform .22s cubic-bezier(.4,0,.2,1);
    }
    .sb-col { transform:translateX(-100%); }
    .sb-aside:not(.sb-col) { transform:translateX(0); box-shadow:8px 0 40px rgba(0,0,0,.45); }
    .sb-mob-btn { display:flex; }
    .sb-overlay.open { display:block; }
  }

  /* ── Child-page layout helpers ── */
  @media (max-width:960px) {
    .summary-bar { grid-template-columns:repeat(2,1fr) !important; }
    .grid4 { grid-template-columns:repeat(2,1fr) !important; }
    .col4  { grid-column:span 2 !important; }
  }
  @media (max-width:600px) {
    .summary-bar { grid-template-columns:1fr !important; }
    .grid4 { grid-template-columns:1fr !important; }
    .col2,.col4 { grid-column:span 1 !important; }
    .toolbar { flex-direction:column; align-items:stretch !important; }
    .tabs { width:100% !important; }
  }
  .card { overflow-x:auto; }
`;

// ── Component ─────────────────────────────────────────────
export default function ScaleBooksApp() {
  const [collapsed,  setCollapsed]  = useState(false);
  const [openGroups, setOpenGroups] = useState(() => new Set(NAV_GROUPS.map(g => g.key)));
  const [profile,    setProfile]    = useState({ companyName: '', logoUrl: '' });
  const navigate = useNavigate();
  const user = auth.currentUser;

  useEffect(() => {
    const unsub = onSnapshot(doc(db, 'settings', 'profile'), snap => {
      if (snap.exists()) {
        const d = snap.data();
        setProfile({ companyName: d.companyName || '', logoUrl: d.logoUrl || '' });
      }
    });
    return unsub;
  }, []);

  function handleSignOut() {
    auth.signOut().then(() => navigate('/login'));
  }

  function toggleGroup(key) {
    setOpenGroups(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }

  return (
    <>
      <style>{CSS}</style>
      <div className="sb-wrap">

        {/* ── Sidebar ── */}
        <aside className={`sb-aside${collapsed ? ' sb-col' : ''}`}>

          {/* Brand */}
          <div className="sb-brand">
            <div className="sb-logo">
              {profile.logoUrl
                ? <img src={profile.logoUrl} alt="logo" onError={e => { e.target.style.display='none'; }} />
                : 'S'
              }
            </div>
            {!collapsed && (
              <div className="sb-brand-txt">
                <span className="sb-title">SCALEBOOKS</span>
                <span className="sb-sub">{profile.companyName || 'FINANCE PORTAL'}</span>
              </div>
            )}
            <button
              className="sb-tog"
              onClick={() => setCollapsed(c => !c)}
              title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            >
              <Ico name={collapsed ? 'chevRight' : 'chevLeft'} size={14} />
            </button>
          </div>

          {/* Nav */}
          <nav className="sb-nav">
            {NAV_GROUPS.map((group, gi) => {
              const isOpen    = openGroups.has(group.key);
              const showItems = collapsed || !group.label || isOpen;

              return (
                <div key={group.key}>
                  {/* Divider between groups (expanded only) */}
                  {gi > 0 && !collapsed && <div className="sb-divider" />}

                  {/* Collapsible group header (expanded + labeled groups only) */}
                  {!collapsed && group.label && (
                    <button className="sb-grp-hdr" onClick={() => toggleGroup(group.key)}>
                      <span>{group.label}</span>
                      <span className={`sb-grp-ico${isOpen ? '' : ' rot'}`}>
                        <Ico name="chevDown" size={11} />
                      </span>
                    </button>
                  )}

                  {/* Items — animated accordion */}
                  <div className={`sb-items${!showItems ? ' closed' : ''}`}>
                    {group.items.map(item => {
                      const to = `/scalebooks${item.path ? '/' + item.path : ''}`;
                      return (
                        <NavLink
                          key={item.path}
                          to={to}
                          end={item.path === ''}
                          className={({ isActive }) => `sb-link${isActive ? ' active' : ''}`}
                          title={collapsed ? item.label : undefined}
                        >
                          <span className="sb-ico"><Ico name={item.icon} size={15} /></span>
                          {!collapsed && <span className="sb-lbl">{item.label}</span>}
                        </NavLink>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </nav>

          {/* Footer */}
          <div className="sb-foot">
            {!collapsed && <div className="sb-user">{user?.email || 'Logged in'}</div>}
            <button
              className="sb-out"
              onClick={handleSignOut}
              title={collapsed ? 'Sign Out' : undefined}
            >
              <Ico name="signout" size={15} />
              {!collapsed && <span>Sign Out</span>}
            </button>
          </div>
        </aside>

        {/* Mobile overlay — only visible on small screens via CSS */}
        <div
          className={`sb-overlay${!collapsed ? ' open' : ''}`}
          onClick={() => setCollapsed(true)}
        />

        {/* ── Main content ── */}
        <main className="sb-main">
          <button className="sb-mob-btn" onClick={() => setCollapsed(c => !c)}>
            <Ico name="menu" size={18} />
          </button>
          <Routes>
            <Route index                   element={<DashboardPage />} />
            <Route path="vouchers/*"       element={<VouchersPage />} />
            <Route path="journal"          element={<JournalPage />} />
            <Route path="coa"              element={<COAPage />} />
            <Route path="bank"             element={<BankPage />} />
            <Route path="billing"          element={<BillingPage />} />
            <Route path="billing/:clientId" element={<BillingClientPage />} />
            <Route path="contacts"         element={<ContactsPage />} />
            <Route path="approvals"        element={<ApprovalsPage />} />
            <Route path="projections"      element={<ProjectionsPage />} />
            <Route path="pay-schedule"     element={<PaymentSchedulePage />} />
            <Route path="disbursements"    element={<DisbursementsPage />} />
            <Route path="checks"           element={<CheckRegistryPage />} />
            <Route path="tax"              element={<TaxPage />} />
            <Route path="financial"        element={<FinancialPage />} />
            <Route path="assets"           element={<FixedAssetsPage />} />
            <Route path="invoices"         element={<ServiceInvoicesPage />} />
            <Route path="collections"      element={<CollectionsPage />} />
            <Route path="settings"         element={<SettingsPage />} />
            <Route path="*"                element={<Navigate to="/scalebooks" replace />} />
          </Routes>
        </main>

      </div>
    </>
  );
}

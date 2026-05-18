import { useState, useEffect } from 'react';
import { Routes, Route, Navigate, useNavigate } from 'react-router-dom';
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
import UserProfilePage     from './settings/UserProfilePage.jsx';
import ReportBuilderPage   from './reports/ReportBuilderPage';
import ReportsLandingPage  from './reports/ReportsLandingPage';

import { PermissionsProvider, usePermissions } from '../../contexts/PermissionsContext.jsx';
import AccessDenied from '../../components/AccessDenied.jsx';
import { LeftRail } from '../../components/shell/LeftRail.tsx';
import { TopBar } from '../../components/shell/TopBar.tsx';
import { CreateFlyout } from '../../components/shell/CreateFlyout.jsx';
import { CommandPalette } from '../../components/shell/CommandPalette.jsx';

// ── Component ─────────────────────────────────────────────
export default function ScaleBooksApp() {
  return (
    <PermissionsProvider>
      <ScaleBooksAppInner />
    </PermissionsProvider>
  );
}

// ── Route-level permission guard ──────────────────────────
function ModuleGuard({ module: moduleName, children }) {
  const { hasAccess, loading } = usePermissions();
  if (loading) {
    return (
      <div style={{ display:'flex', alignItems:'center', justifyContent:'center', height:'100%', color:'#94a3b8', fontFamily:'Inter,sans-serif', fontSize:13 }}>
        Checking permissions…
      </div>
    );
  }
  if (!hasAccess(moduleName)) return <AccessDenied module={moduleName} />;
  return children;
}

// ── Inner app (needs PermissionsProvider in tree) ─────────
function ScaleBooksAppInner() {
  const [createFlyoutOpen,  setCreateFlyoutOpen]  = useState(false);
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
  const [profile, setProfile] = useState({ companyName: '', logoUrl: '' });
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

  return (
    <div className="flex flex-col h-screen w-screen">
      <TopBar
        companyName={profile.companyName}
        userEmail={user?.email}
        logoUrl={profile.logoUrl}
        onSignOut={handleSignOut}
        onSearchClick={() => setCommandPaletteOpen(true)}
        onSettingsClick={() => navigate('/scalebooks/settings')}
        onProfileClick={() => navigate('/scalebooks/profile')}
      />
      <div className="flex flex-1 overflow-hidden">
        <LeftRail onCreateClick={() => setCreateFlyoutOpen(true)} />
        <main className="flex-1 overflow-auto bg-[#F9FAFB]">
          <Routes>
            {/* Dashboard — always accessible */}
            <Route index element={<DashboardPage />} />

            {/* Disbursement */}
            <Route path="vouchers/*"    element={<ModuleGuard module="Vouchers"><VouchersPage /></ModuleGuard>} />
            <Route path="approvals"     element={<ModuleGuard module="Approvals"><ApprovalsPage /></ModuleGuard>} />
            <Route path="projections"   element={<ModuleGuard module="Weekly Projections"><ProjectionsPage /></ModuleGuard>} />
            <Route path="pay-schedule"  element={<ModuleGuard module="Payment Schedule"><PaymentSchedulePage /></ModuleGuard>} />
            <Route path="disbursements" element={<ModuleGuard module="Disbursements"><DisbursementsPage /></ModuleGuard>} />
            <Route path="checks"        element={<ModuleGuard module="Check Registry"><CheckRegistryPage /></ModuleGuard>} />

            {/* Accountant */}
            <Route path="journal"   element={<ModuleGuard module="Journal"><JournalPage /></ModuleGuard>} />
            <Route path="bank"      element={<ModuleGuard module="Bank"><BankPage /></ModuleGuard>} />
            <Route path="coa"       element={<ModuleGuard module="Chart of Accounts"><COAPage /></ModuleGuard>} />
            <Route path="tax"       element={<ModuleGuard module="Tax"><TaxPage /></ModuleGuard>} />
            <Route path="financial" element={<ModuleGuard module="Financial Management"><FinancialPage /></ModuleGuard>} />
            <Route path="assets"    element={<ModuleGuard module="Fixed Assets"><FixedAssetsPage /></ModuleGuard>} />

            {/* Billing & AR */}
            <Route path="billing"           element={<ModuleGuard module="Billing Book"><BillingPage /></ModuleGuard>} />
            <Route path="billing/:clientId" element={<ModuleGuard module="Billing Book"><BillingClientPage /></ModuleGuard>} />
            <Route path="invoices"          element={<ModuleGuard module="Service Invoices"><ServiceInvoicesPage /></ModuleGuard>} />
            <Route path="collections"       element={<ModuleGuard module="Collections"><CollectionsPage /></ModuleGuard>} />

            {/* Reports */}
            <Route path="reports"              element={<ModuleGuard module="Reports"><ReportsLandingPage /></ModuleGuard>} />
            <Route path="reports/builder/:type" element={<ModuleGuard module="Reports"><ReportBuilderPage /></ModuleGuard>} />

            {/* System */}
            <Route path="contacts" element={<ModuleGuard module="Contacts"><ContactsPage /></ModuleGuard>} />
            <Route path="settings" element={<ModuleGuard module="Settings"><SettingsPage /></ModuleGuard>} />
            <Route path="profile"  element={<UserProfilePage />} />

            <Route path="*" element={<Navigate to="/scalebooks" replace />} />
          </Routes>
        </main>
      </div>
      <CreateFlyout open={createFlyoutOpen} onClose={() => setCreateFlyoutOpen(false)} />
      <CommandPalette open={commandPaletteOpen} onClose={() => setCommandPaletteOpen(false)} />
    </div>
  );
}

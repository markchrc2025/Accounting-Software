import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { listVouchers, billingStatementsApi } from '../../lib/api.js';
import { usePermissions } from '../../contexts/PermissionsContext.jsx';

import { PrivacyProvider } from '../../contexts/PrivacyContext.jsx';
import { GreetingBar }     from '../../components/dashboard/GreetingBar.jsx';
import { HubPills }        from '../../components/dashboard/HubPills.jsx';
import { CreateActions }   from '../../components/dashboard/CreateActions.jsx';
import { WidgetGrid }      from '../../components/dashboard/WidgetGrid.jsx';
import { useDashboardLayout } from '../../hooks/useDashboardLayout.js';

import { TotalVouchersWidget }    from '../../components/dashboard/widgets/TotalVouchersWidget.jsx';
import { PendingApprovalsWidget } from '../../components/dashboard/widgets/PendingApprovalsWidget.jsx';
import { ProfitLossWidget }       from '../../components/dashboard/widgets/ProfitLossWidget.jsx';
import { ExpensesWidget }         from '../../components/dashboard/widgets/ExpensesWidget.jsx';
import { BankAccountsWidget }     from '../../components/dashboard/widgets/BankAccountsWidget.jsx';
import { TotalBilledWidget }      from '../../components/dashboard/widgets/TotalBilledWidget.jsx';
import { TotalCollectedWidget }   from '../../components/dashboard/widgets/TotalCollectedWidget.jsx';
import { RecentVouchersWidget }   from '../../components/dashboard/widgets/RecentVouchersWidget.jsx';
import { RecentBillingWidget }    from '../../components/dashboard/widgets/RecentBillingWidget.jsx';
import { AddWidgetCard }          from '../../components/dashboard/widgets/AddWidgetCard.jsx';

// API status enum -> UI labels (mirrors VouchersPage's VSTATUS_LABEL).
const VSTATUS_LABEL = {
  draft:'Draft', pending:'Pending', for_verification:'For Verification', verified:'Verified',
  for_approval:'For Approval', approved:'Approved', paid:'Paid', rejected:'Rejected',
  posted:'Approved', void:'Voided',
};
// Raw API statuses that count as "pending approval" (legacy: Pending / For Verification / For Approval).
const PENDING_API_STATUSES = ['pending', 'for_verification', 'for_approval'];

export default function DashboardPage() {
  return (
    <PrivacyProvider>
      <DashboardPageInner />
    </PrivacyProvider>
  );
}

function DashboardPageInner() {
  const navigate = useNavigate();
  const { globalRoles, isAdmin } = usePermissions();
  const canSeeApprovals = isAdmin || globalRoles.some(r => ['Verifier', 'Approver', 'Poster'].includes(r));
  const [stats, setStats]               = useState({ vouchers: 0, pending: 0, totalBilled: 0, totalCollected: 0 });
  const [recentVouchers, setRecentVouchers] = useState([]);
  const [recentBilling,  setRecentBilling]  = useState([]);
  const [loading, setLoading]           = useState(true);

  const [isCustomising, setIsCustomising] = useState(false);
  const { layout, isCustomised, setLayout, saveLayout, resetLayout, cancelEdit } = useDashboardLayout();

  // ── One-shot REST load (Firestore listeners replaced by the API) ──────────
  useEffect(() => {
    let cancelled = false;
    setLoading(true);

    const vouchersReq = listVouchers({ limit: 500 })
      .then(rows => {
        if (cancelled) return;
        const mapped = rows.map(v => ({
          id:              v.id,
          voucherId:       v.voucherNo,
          voucherType:     v.voucherType, // raw api enum ('check', 'payment', …)
          status:          VSTATUS_LABEL[v.status] || v.status,
          apiStatus:       v.status,
          preparationDate: v.voucherDate,
          contactSummary:  (v.meta && v.meta.contactSummary) || v.contactName || '',
          purposeCategory: v.purposeCategory || '',
          totalAmount:     (v.totalCents ?? 0) / 100,
          createdAt:       v.createdAt,
        }));
        // CHECK vouchers are owned by Check Registry — exclude them here.
        // The API sorts by voucherDate; re-sort by createdAt desc for "recent".
        const recent = mapped
          .filter(v => v.voucherType !== 'check')
          .sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0))
          .slice(0, 5);
        setRecentVouchers(recent);
        const pending = canSeeApprovals
          ? mapped.filter(v => PENDING_API_STATUSES.includes(v.apiStatus)).length
          : 0; // Makers have no approval queue
        setStats(prev => ({ ...prev, vouchers: mapped.length, pending }));
      })
      .catch(e => console.error(e));

    const billingReq = billingStatementsApi.list()
      .then(rows => {
        if (cancelled) return;
        const statements = rows.slice(0, 5).map(b => ({
          id:              b.id,
          billingNo:       b.bsNo,
          contactName:     b.contactName || '',
          period:          b.periodStart && b.periodEnd ? `${b.periodStart} – ${b.periodEnd}` : '',
          netDue:          (b.netDueCents ?? 0) / 100,
          amountCollected: (b.appliedCents ?? 0) / 100,
          status:          b.status || 'Draft',
        }));
        setRecentBilling(statements);
        const totalBilled    = statements.reduce((s, d) => s + (d.netDue || 0), 0);
        const totalCollected = statements.reduce((s, d) => s + (d.amountCollected || 0), 0);
        setStats(prev => ({ ...prev, totalBilled, totalCollected }));
      })
      .catch(e => console.error(e));

    Promise.allSettled([vouchersReq, billingReq]).then(() => {
      if (!cancelled) setLoading(false);
    });

    return () => { cancelled = true; };
  }, [canSeeApprovals]);

  // ── Widget map — keyed by layout item id ────────────────────────────────────
  const WIDGETS = {
    A: () => <TotalVouchersWidget    count={stats.vouchers}       loading={loading} />,
    B: () => canSeeApprovals ? <PendingApprovalsWidget count={stats.pending} loading={loading} /> : null,
    C: () => <ProfitLossWidget />,
    D: () => <ExpensesWidget />,
    E: () => <BankAccountsWidget />,
    F: () => <TotalBilledWidget     total={stats.totalBilled}    loading={loading} />,
    G: () => <TotalCollectedWidget  total={stats.totalCollected} totalBilled={stats.totalBilled} loading={loading} />,
    H: () => <RecentVouchersWidget  vouchers={recentVouchers}    loading={loading} />,
    I: () => <RecentBillingWidget   statements={recentBilling}   loading={loading} />,
    J: () => <AddWidgetCard />,
  };

  function handleCustomiseToggle() {
    if (isCustomising) {
      cancelEdit();
    }
    setIsCustomising(c => !c);
  }

  function handleSave() {
    saveLayout();
    setIsCustomising(false);
  }

  function handleReset() {
    resetLayout();
    setIsCustomising(false);
  }

  function handleCancel() {
    cancelEdit();
    setIsCustomising(false);
  }

  return (
    <div className="w-full px-8 py-10">

      {/* ── Customise toolbar ───────────────────────────────────────────────── */}
      {isCustomising && (
        <div className="flex items-center justify-between mb-4 px-4 py-2.5 bg-white rounded-xl border border-[#E5E7EB] shadow-sm">
          <div className="flex items-center gap-4">
            <span className="text-[14px] font-semibold text-[#1F2937]">Customising layout</span>
            <button onClick={handleReset} className="text-[13px] text-[#F97316] hover:underline">
              Reset to default
            </button>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handleCancel}
              className="h-8 px-4 rounded-lg border border-[#E5E7EB] text-[13px] text-[#6B7280] hover:bg-[#F3F4F6] transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              className="h-8 px-4 rounded-lg bg-[#F97316] text-white text-[13px] font-medium hover:bg-[#EA580C] transition-colors"
            >
              Save
            </button>
          </div>
        </div>
      )}

      {/* ── Greeting ────────────────────────────────────────────────────────── */}
      <GreetingBar
        isCustomising={isCustomising}
        isCustomised={isCustomised}
        onCustomiseToggle={handleCustomiseToggle}
      />

      {/* ── Hub pills ───────────────────────────────────────────────────────── */}
      <HubPills />

      {/* ── Create actions ──────────────────────────────────────────────────── */}
      <CreateActions />

      {/* ── Widget grid ─────────────────────────────────────────────────────── */}
      <WidgetGrid
        layout={layout}
        widgets={WIDGETS}
        isCustomising={isCustomising}
        onLayoutChange={setLayout}
      />

      {/* ── See all activity ────────────────────────────────────────────────── */}
      <div className="flex justify-end mb-4">
        <button onClick={() => navigate('/scalebooks/journal')} className="text-[13px] text-[#F97316] hover:underline">
          See all activity →
        </button>
      </div>

      {/* ── Footer ──────────────────────────────────────────────────────────── */}
      <footer className="text-center text-[12px] text-[#9CA3AF] pb-4">
        © 2026 ScaleBooks.{' '}
        <span className="hover:underline cursor-pointer">Privacy</span>
        {' · '}
        <span className="hover:underline cursor-pointer">Security</span>
        {' · '}
        <span className="hover:underline cursor-pointer">Terms of Service</span>
      </footer>
    </div>
  );
}

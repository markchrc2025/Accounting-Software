import { useEffect, useState } from 'react';
import { collection, query, orderBy, limit, getDocs, where } from 'firebase/firestore';
import { db } from '../../firebase.js';
import { useNavigate } from 'react-router-dom';

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

export default function DashboardPage() {
  return (
    <PrivacyProvider>
      <DashboardPageInner />
    </PrivacyProvider>
  );
}

function DashboardPageInner() {
  const navigate = useNavigate();
  const [stats, setStats]               = useState({ vouchers: 0, pending: 0, totalBilled: 0, totalCollected: 0 });
  const [recentVouchers, setRecentVouchers] = useState([]);
  const [recentBilling,  setRecentBilling]  = useState([]);
  const [loading, setLoading]           = useState(true);

  const [isCustomising, setIsCustomising] = useState(false);
  const { layout, isCustomised, setLayout, saveLayout, resetLayout, cancelEdit } = useDashboardLayout();

  // ── Firestore load (preserved from original DashboardPage) ──────────────────
  useEffect(() => {
    async function load() {
      try {
        const [vSnap, bsSnap] = await Promise.all([
          getDocs(query(collection(db, 'vouchers'), orderBy('createdAt', 'desc'), limit(5))),
          getDocs(query(collection(db, 'billingStatements'), orderBy('createdAt', 'desc'), limit(5))),
        ]);

        const vouchers   = vSnap.docs.map(d => ({ id: d.id, ...d.data() }));
        const statements = bsSnap.docs.map(d => ({ id: d.id, ...d.data() }));

        const [allVSnap, pendingSnap] = await Promise.all([
          getDocs(collection(db, 'vouchers')),
          getDocs(query(collection(db, 'vouchers'), where('status', '==', 'Pending'))),
        ]);

        const totalBilled    = statements.reduce((s, d) => s + (d.netDue || d.totalAmount || 0), 0);
        const totalCollected = statements.reduce((s, d) => s + (d.amountCollected || 0), 0);

        setStats({ vouchers: allVSnap.size, pending: pendingSnap.size, totalBilled, totalCollected });
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

  // ── Widget map — keyed by layout item id ────────────────────────────────────
  const WIDGETS = {
    A: () => <TotalVouchersWidget    count={stats.vouchers}       loading={loading} />,
    B: () => <PendingApprovalsWidget count={stats.pending}        loading={loading} />,
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

import { useEffect, useState } from 'react';
import { collection, query, orderBy, limit, onSnapshot, where } from 'firebase/firestore';
import { db } from '../../firebase.js';
import { useNavigate } from 'react-router-dom';
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

  // ── Firestore real-time listeners ─────────────────────────────────────────
  useEffect(() => {
    const loaded = new Set();
    const KEYS = ['vouchers', 'billing', 'allV', 'pending'];
    function markDone(key) {
      loaded.add(key);
      if (KEYS.every(k => loaded.has(k))) setLoading(false);
    }

    const u1 = onSnapshot(
      query(collection(db, 'vouchers'), orderBy('createdAt', 'desc'), limit(8)),
      snap => {
        // CHECK vouchers are owned by Check Registry — exclude them here
        const vouchers = snap.docs.map(d => ({ id: d.id, ...d.data() })).filter(v => v.voucherType !== 'CHECK');
        setRecentVouchers(vouchers.slice(0, 5));
        markDone('vouchers');
      },
      e => { console.error(e); markDone('vouchers'); }
    );

    const u2 = onSnapshot(
      query(collection(db, 'billingStatements'), orderBy('createdAt', 'desc'), limit(5)),
      snap => {
        const statements = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        setRecentBilling(statements);
        const totalBilled    = statements.reduce((s, d) => s + (d.netDue || d.totalAmount || 0), 0);
        const totalCollected = statements.reduce((s, d) => s + (d.amountCollected || 0), 0);
        setStats(prev => ({ ...prev, totalBilled, totalCollected }));
        markDone('billing');
      },
      e => { console.error(e); markDone('billing'); }
    );

    const u3 = onSnapshot(
      collection(db, 'vouchers'),
      snap => {
        setStats(prev => ({ ...prev, vouchers: snap.size }));
        markDone('allV');
      },
      e => { console.error(e); markDone('allV'); }
    );

    let u4 = () => {};
    if (canSeeApprovals) {
      u4 = onSnapshot(
        query(collection(db, 'vouchers'), where('status', 'in', ['Pending', 'For Verification', 'For Approval'])),
        snap => {
          setStats(prev => ({ ...prev, pending: snap.size }));
          markDone('pending');
        },
        e => { console.error(e); markDone('pending'); }
      );
    } else {
      // Makers have no approval queue
      setStats(prev => ({ ...prev, pending: 0 }));
      markDone('pending');
    }

    return () => { u1(); u2(); u3(); u4(); };
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

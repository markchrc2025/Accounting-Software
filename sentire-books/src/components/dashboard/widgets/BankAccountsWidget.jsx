// Widget E — Bank Accounts (stub — confirm Firestore collection name)
import { Building2, RefreshCw } from 'lucide-react';
import { WidgetShell } from './WidgetShell.jsx';
import { MoneyText } from '../../common/MoneyText.jsx';
import { StatusPill } from '../../common/StatusPill.jsx';

// TODO: confirm Firestore collection name for bank accounts and reconciliation status
const STUB_ACCOUNTS = [];

export function BankAccountsWidget() {
  const total = STUB_ACCOUNTS.reduce((s, a) => s + (a.balance || 0), 0);

  return (
    <WidgetShell
      label="Bank Accounts"
      headerRight={
        <div className="flex items-center gap-2 text-[12px] text-[#9CA3AF]">
          <span>As of today</span>
          <button className="hover:text-[#F97316] transition-colors" title="Refresh">
            <RefreshCw size={12} />
          </button>
        </div>
      }
      footer={
        <button className="text-[#F97316] hover:underline">Go to registers ▾</button>
      }
    >
      <div className="flex flex-col gap-2 h-full">
        <div className="flex items-center gap-1 text-[11px] text-[#9CA3AF]">
          <span className="h-1.5 w-1.5 rounded-full bg-[#16A34A]" />
          Just updated
        </div>
        <p className="text-[12px] text-[#6B7280]">Total bank balance</p>
        <MoneyText value={total} className="text-[24px] font-semibold text-[#1F2937]" />

        {STUB_ACCOUNTS.length === 0 ? (
          <p className="text-[12px] text-[#9CA3AF] mt-2">
            No bank accounts connected yet. {/* TODO: link to bank page */}
          </p>
        ) : (
          <div className="flex flex-col gap-2 mt-2 overflow-y-auto">
            {STUB_ACCOUNTS.slice(0, 3).map((acct, i) => (
              <div key={i} className="flex items-center gap-2 text-[12px]">
                <Building2 size={14} className="text-[#9CA3AF] flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-[#1F2937] truncate">{acct.name}</p>
                  <p className="text-[#9CA3AF]">Updated {acct.daysAgo || 0}d ago</p>
                </div>
                <div className="text-right flex-shrink-0">
                  <MoneyText value={acct.balance} className="font-medium text-[#1F2937]" />
                  {acct.reconciled && <StatusPill status="paid" className="mt-0.5" />}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </WidgetShell>
  );
}

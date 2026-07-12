// Widget I — Recent Billing Statements
import { Info } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { WidgetShell } from './WidgetShell.jsx';
import { StatusPill } from '../../common/StatusPill.jsx';
import { MoneyText } from '../../common/MoneyText.jsx';

export function RecentBillingWidget({ statements = [], loading = false }) {
  const navigate = useNavigate();

  return (
    <WidgetShell
      label="Recent Billing Statements"
      headerRight={
        <button onClick={() => navigate('/scalebooks/billing')} className="text-[12px] text-[#F97316] hover:underline">
          View all →
        </button>
      }
      footer={null}
    >
      {loading ? (
        <div className="flex items-center justify-center h-full text-[13px] text-[#9CA3AF]">Loading…</div>
      ) : statements.length === 0 ? (
        <div className="flex flex-col items-center justify-center h-full gap-2 text-center">
          <Info size={20} className="text-[#9CA3AF]" />
          <p className="text-[14px] font-semibold text-[#1F2937]">No billing statements yet.</p>
          <button onClick={() => navigate('/scalebooks/billing')} className="text-[13px] text-[#F97316] hover:underline">
            Open a client book →
          </button>
        </div>
      ) : (
        <div className="flex flex-col divide-y divide-[#F3F4F6]">
          {statements.slice(0, 5).map(b => (
            <div
              key={b.id}
              onClick={() => navigate('/scalebooks/billing')}
              className="flex items-center justify-between py-2.5 cursor-pointer hover:bg-[#FAFAFA] -mx-5 px-5 transition-colors"
            >
              <div>
                <p className="font-mono text-[14px] font-semibold text-[#1F2937]">{b.billingNo || b.id}</p>
                <p className="text-[11px] text-[#9CA3AF] mt-0.5">
                  {b.contactName || b.contact || '—'}
                  {(b.period || b.billingPeriod) ? ` · ${b.period || b.billingPeriod}` : ''}
                </p>
              </div>
              <div className="text-right">
                <MoneyText value={b.netDue || b.totalAmount} className="text-[14px] font-semibold text-[#1F2937]" />
                <div className="mt-0.5">
                  <StatusPill status={b.status || 'Draft'} />
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </WidgetShell>
  );
}

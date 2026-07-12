// Widget H — Recent Vouchers
import { useNavigate } from 'react-router-dom';
import { WidgetShell } from './WidgetShell.jsx';
import { StatusPill } from '../../common/StatusPill.jsx';
import { MoneyText } from '../../common/MoneyText.jsx';

export function RecentVouchersWidget({ vouchers = [], loading = false }) {
  const navigate = useNavigate();

  return (
    <WidgetShell
      label="Recent Vouchers"
      headerRight={
        <button onClick={() => navigate('/scalebooks/vouchers')} className="text-[12px] text-[#F97316] hover:underline">
          View all →
        </button>
      }
      footer={null}
    >
      {loading ? (
        <div className="flex items-center justify-center h-full text-[13px] text-[#9CA3AF]">Loading…</div>
      ) : vouchers.length === 0 ? (
        <div className="flex items-center justify-center h-full text-[13px] text-[#9CA3AF]">
          No vouchers yet.{' '}
          <button onClick={() => navigate('/scalebooks/vouchers')} className="text-[#F97316] hover:underline ml-1">
            Create one →
          </button>
        </div>
      ) : (
        <div className="flex flex-col divide-y divide-[#F3F4F6]">
          {vouchers.slice(0, 5).map(v => (
            <div
              key={v.id}
              onClick={() => navigate('/scalebooks/vouchers')}
              className="flex items-center justify-between py-2.5 cursor-pointer hover:bg-[#FAFAFA] -mx-5 px-5 transition-colors"
            >
              <div>
                <p className="font-mono text-[14px] font-semibold text-[#1F2937]">{v.voucherId || v.id}</p>
                <p className="text-[11px] text-[#9CA3AF] mt-0.5">{v.contactSummary || v.purposeCategory || '—'}</p>
              </div>
              <div className="text-right">
                <MoneyText value={v.totalAmount} className="text-[14px] font-semibold text-[#1F2937]" />
                <div className="mt-0.5">
                  <StatusPill status={v.status || 'Pending'} />
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </WidgetShell>
  );
}

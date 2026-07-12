// Widget A — Total Vouchers
import { useNavigate } from 'react-router-dom';
import { LineChart, Line, ResponsiveContainer } from 'recharts';
import { WidgetShell } from './WidgetShell.jsx';
import { PeriodSelect } from '../../common/PeriodSelect.jsx';

// Stub sparkline data — TODO: wire to daily voucher count query
const STUB_SPARKLINE = [2, 5, 3, 8, 6, 9, 7, 11, 8, 12, 10, 15].map((v, i) => ({ v, i }));

export function TotalVouchersWidget({ count = 0, loading = false }) {
  const navigate = useNavigate();

  return (
    <WidgetShell
      label="Total Vouchers"
      headerRight={<PeriodSelect defaultValue="all_time" />}
      footer={
        <button onClick={() => navigate('/vouchers')} className="text-[#F97316] hover:underline">
          View vouchers →
        </button>
      }
    >
      <div className="flex flex-col h-full justify-between">
        <div>
          <p className="text-[28px] font-semibold text-[#1F2937] leading-tight">
            {loading ? '—' : count}
          </p>
          <p className="text-[12px] text-[#9CA3AF] mt-0.5">All-time</p>
        </div>
        <div className="h-10 mt-2">
          <ResponsiveContainer width="100%" height={40} minWidth={0}>
            <LineChart data={STUB_SPARKLINE}>
              <Line
                type="monotone" dataKey="v"
                stroke="#F97316" strokeWidth={1.5}
                dot={false} isAnimationActive={false}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>
    </WidgetShell>
  );
}

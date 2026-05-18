// Widget F — Total Billed (AR)
import { useNavigate } from 'react-router-dom';
import { BarChart, Bar, ResponsiveContainer, Tooltip } from 'recharts';
import { WidgetShell } from './WidgetShell.jsx';
import { PeriodSelect } from '../../common/PeriodSelect.jsx';
import { MoneyText } from '../../common/MoneyText.jsx';

// TODO: wire monthly billing data (currently only total is fetched)
const STUB_MONTHS = [
  { m: 'Dec', v: 0 }, { m: 'Jan', v: 0 }, { m: 'Feb', v: 0 },
  { m: 'Mar', v: 0 }, { m: 'Apr', v: 0 }, { m: 'May', v: 0 },
];

export function TotalBilledWidget({ total = 0, loading = false }) {
  const navigate = useNavigate();

  return (
    <WidgetShell
      label="Total Billed (AR)"
      headerRight={<PeriodSelect defaultValue="this_year" />}
      footer={
        <button onClick={() => navigate('/scalebooks/billing')} className="text-[#F97316] hover:underline">
          View billing book →
        </button>
      }
    >
      <div className="flex flex-col h-full justify-between">
        <div>
          <MoneyText value={total} className="text-[24px] font-semibold text-[#1F2937]" />
          <p className="text-[12px] text-[#9CA3AF] mt-0.5">Billing statements</p>
        </div>
        <div className="h-10 mt-2">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={STUB_MONTHS} barSize={8}>
              <Bar dataKey="v" fill="#F97316" radius={[3, 3, 0, 0]} isAnimationActive={false} />
              <Tooltip formatter={(v) => `₱${v.toLocaleString()}`} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
    </WidgetShell>
  );
}

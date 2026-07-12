// Widget G — Total Collected
import { useNavigate } from 'react-router-dom';
import { WidgetShell } from './WidgetShell.jsx';
import { PeriodSelect } from '../../common/PeriodSelect.jsx';
import { MoneyText } from '../../common/MoneyText.jsx';

export function TotalCollectedWidget({ total = 0, totalBilled = 0, loading = false }) {
  const navigate   = useNavigate();
  const rate       = totalBilled > 0 ? ((total / totalBilled) * 100).toFixed(1) : '0.0';

  return (
    <WidgetShell
      label="Total Collected"
      headerRight={<PeriodSelect defaultValue="this_year" />}
      footer={
        <button onClick={() => navigate('/scalebooks/collections')} className="text-[#F97316] hover:underline">
          View collections →
        </button>
      }
    >
      <div className="flex flex-col h-full justify-between">
        <div>
          <MoneyText value={total} className="text-[24px] font-semibold text-[#1F2937]" />
          <p className="text-[12px] text-[#9CA3AF] mt-0.5">Payments received</p>
        </div>
        <div className="flex items-center gap-1.5 mt-2">
          <span
            className="inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-semibold"
            style={{
              background: Number(rate) >= 80 ? '#F0FDF4' : '#FFF7ED',
              color:      Number(rate) >= 80 ? '#15803A' : '#C2410C',
            }}
          >
            {rate}% collection rate
          </span>
        </div>
      </div>
    </WidgetShell>
  );
}

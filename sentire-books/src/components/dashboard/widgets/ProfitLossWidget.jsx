// Widget C — Profit & Loss (stub — no P&L query yet)
import { Info } from 'lucide-react';
import { WidgetShell } from './WidgetShell.jsx';
import { PeriodSelect } from '../../common/PeriodSelect.jsx';
import { MoneyText } from '../../common/MoneyText.jsx';

export function ProfitLossWidget() {
  // TODO: wire to journal-aggregation query (revenue vs. expense accounts)
  const netProfit  = 0;
  const income     = 0;
  const expenses   = 0;
  const trendPct   = 0;

  return (
    <WidgetShell
      label="Profit & Loss"
      headerRight={<PeriodSelect defaultValue="last_month" />}
      footer={
        <span className="text-[#9CA3AF]">
          Missing data?{' '}
          <span className="text-[#F97316] cursor-pointer hover:underline">
            Check account connections
          </span>
        </span>
      }
    >
      <div className="flex flex-col gap-3 h-full justify-between">
        <div>
          <p className="text-[12px] text-[#6B7280]">Net profit for last month</p>
          <div className="flex items-center gap-2 mt-1">
            <MoneyText value={netProfit} className="text-[28px] font-semibold text-[#1F2937]" />
            <Info size={14} className="text-[#9CA3AF]" />
          </div>
          <span className={`inline-flex items-center text-[12px] mt-1 ${trendPct >= 0 ? 'text-[#16A34A]' : 'text-[#DC2626]'}`}>
            {trendPct >= 0 ? '↑' : '↓'} {Math.abs(trendPct).toFixed(1)}% from prior month
          </span>
        </div>

        {/* Income / Expenses breakdown */}
        <div className="grid grid-cols-2 gap-3">
          <div className="flex items-start gap-2">
            <div className="w-1 h-8 rounded-full bg-[#F97316] flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-[11px] text-[#9CA3AF] uppercase font-semibold tracking-wide">Income</p>
              <MoneyText value={income} className="text-[14px] font-semibold text-[#1F2937]" />
            </div>
          </div>
          <div className="flex items-start gap-2">
            <div className="w-1 h-8 rounded-full bg-[#E5E7EB] flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-[11px] text-[#9CA3AF] uppercase font-semibold tracking-wide">Expenses</p>
              <MoneyText value={expenses} className="text-[14px] font-semibold text-[#1F2937]" />
            </div>
          </div>
        </div>
      </div>
    </WidgetShell>
  );
}

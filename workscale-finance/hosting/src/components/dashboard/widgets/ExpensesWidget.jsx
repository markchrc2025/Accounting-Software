// Widget D — Expenses (stub — no expense-category query yet)
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from 'recharts';
import { WidgetShell } from './WidgetShell.jsx';
import { PeriodSelect } from '../../common/PeriodSelect.jsx';
import { MoneyText } from '../../common/MoneyText.jsx';

// TODO: wire to vouchers/disbursements grouped by category
const STUB_CATEGORIES = [
  { name: 'Salaries',    value: 0, color: '#F97316' },
  { name: 'Supplies',    value: 0, color: '#2563EB' },
  { name: 'Utilities',   value: 0, color: '#7C3AED' },
  { name: 'Transport',   value: 0, color: '#16A34A' },
  { name: 'Other',       value: 0, color: '#9CA3AF' },
];

export function ExpensesWidget() {
  const total = STUB_CATEGORIES.reduce((s, c) => s + c.value, 0);

  return (
    <WidgetShell
      label="Expenses"
      headerRight={<PeriodSelect defaultValue="30d" />}
      footer={
        <span className="text-[#9CA3AF]">
          <span className="text-[#F97316] cursor-pointer hover:underline">Add an expense</span>
        </span>
      }
    >
      <div className="flex flex-col gap-2 h-full">
        <p className="text-[12px] text-[#6B7280]">Spending for last 30 days</p>
        <MoneyText value={total} className="text-[24px] font-semibold text-[#1F2937]" />
        <p className="text-[12px] text-[#9CA3AF]">No data — add expenses to see breakdown</p>

        <div className="flex items-center gap-4 flex-1 min-h-0 mt-2">
          {/* Donut */}
          <div className="h-24 w-24 flex-shrink-0">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={STUB_CATEGORIES.length ? STUB_CATEGORIES : [{ name: 'empty', value: 1, color: '#F3F4F6' }]}
                  innerRadius={28} outerRadius={44}
                  dataKey="value" paddingAngle={2} isAnimationActive={false}
                >
                  {(STUB_CATEGORIES.length ? STUB_CATEGORIES : [{ color: '#F3F4F6' }]).map((c, i) => (
                    <Cell key={i} fill={c.color} />
                  ))}
                </Pie>
                <Tooltip formatter={(v) => `₱${v.toLocaleString()}`} />
              </PieChart>
            </ResponsiveContainer>
          </div>

          {/* Legend */}
          <div className="flex flex-col gap-1 text-[12px] overflow-y-auto">
            {STUB_CATEGORIES.map(c => (
              <div key={c.name} className="flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full flex-shrink-0" style={{ background: c.color }} />
                <span className="text-[#6B7280] truncate">{c.name}</span>
                <MoneyText value={c.value} className="ml-auto text-[#1F2937] font-medium" />
              </div>
            ))}
          </div>
        </div>
      </div>
    </WidgetShell>
  );
}

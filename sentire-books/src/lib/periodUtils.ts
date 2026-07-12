import type { ReportPeriodPreset, PeriodGroup, PeriodOption } from '../types/reports';

// ── Date helpers ──────────────────────────────────────────────────────
function isoDate(d: Date): string { return d.toISOString().slice(0, 10); }
function addDays(d: Date, n: number): Date { const r = new Date(d); r.setDate(r.getDate() + n); return r; }
function addMonths(d: Date, n: number): Date { return new Date(d.getFullYear(), d.getMonth() + n, d.getDate()); }
function startOfWeek(d: Date): Date {
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  const r = new Date(d); r.setDate(d.getDate() + diff); r.setHours(0, 0, 0, 0); return r;
}
function endOfWeek(d: Date): Date { const s = startOfWeek(d); s.setDate(s.getDate() + 6); return s; }
function startOfMonth(d: Date): Date { return new Date(d.getFullYear(), d.getMonth(), 1); }
function endOfMonth(d: Date): Date { return new Date(d.getFullYear(), d.getMonth() + 1, 0); }
function startOfQuarter(d: Date): Date { const q = Math.floor(d.getMonth() / 3); return new Date(d.getFullYear(), q * 3, 1); }
function endOfQuarter(d: Date): Date { const q = Math.floor(d.getMonth() / 3); return new Date(d.getFullYear(), q * 3 + 3, 0); }
function startOfYear(d: Date): Date { return new Date(d.getFullYear(), 0, 1); }
function endOfYear(d: Date): Date { return new Date(d.getFullYear(), 11, 31); }

export function computePeriodDates(p: ReportPeriodPreset): { from: string; to: string } | null {
  const t = new Date(); t.setHours(0, 0, 0, 0);
  const ly = t.getFullYear() - 1, ny = t.getFullYear() + 1;

  if (p === 'today')                              return { from: isoDate(t), to: isoDate(t) };
  if (p === 'yesterday')                          return { from: isoDate(addDays(t, -1)), to: isoDate(addDays(t, -1)) };
  if (p === 'this_week')                          return { from: isoDate(startOfWeek(t)), to: isoDate(endOfWeek(t)) };
  if (p === 'this_week_to_date')                  return { from: isoDate(startOfWeek(t)), to: isoDate(t) };
  if (p === 'this_month')                         return { from: isoDate(startOfMonth(t)), to: isoDate(endOfMonth(t)) };
  if (p === 'this_month_to_date')                 return { from: isoDate(startOfMonth(t)), to: isoDate(t) };
  if (p === 'this_quarter')                       return { from: isoDate(startOfQuarter(t)), to: isoDate(endOfQuarter(t)) };
  if (p === 'this_quarter_to_date')               return { from: isoDate(startOfQuarter(t)), to: isoDate(t) };
  if (p === 'this_fiscal_quarter')                return { from: isoDate(startOfQuarter(t)), to: isoDate(endOfQuarter(t)) };
  if (p === 'this_fiscal_quarter_to_date')        return { from: isoDate(startOfQuarter(t)), to: isoDate(t) };
  if (p === 'this_year')                          return { from: isoDate(startOfYear(t)), to: isoDate(endOfYear(t)) };
  if (p === 'this_year_to_date')                  return { from: isoDate(startOfYear(t)), to: isoDate(t) };
  if (p === 'this_year_to_last_month')            return { from: isoDate(startOfYear(t)), to: isoDate(endOfMonth(addMonths(t, -1))) };
  if (p === 'this_financial_year')                return { from: isoDate(startOfYear(t)), to: isoDate(endOfYear(t)) };
  if (p === 'this_financial_year_to_date')        return { from: isoDate(startOfYear(t)), to: isoDate(t) };
  if (p === 'this_financial_year_to_last_month')  return { from: isoDate(startOfYear(t)), to: isoDate(endOfMonth(addMonths(t, -1))) };
  if (p === 'last_6_months')                      return { from: isoDate(startOfMonth(addMonths(t, -6))), to: isoDate(endOfMonth(addMonths(t, -1))) };
  if (p === 'last_week')                          { const m = addDays(startOfWeek(t), -7); return { from: isoDate(m), to: isoDate(addDays(m, 6)) }; }
  if (p === 'last_week_to_date')                  return { from: isoDate(addDays(startOfWeek(t), -7)), to: isoDate(t) };
  if (p === 'last_week_to_today')                 return { from: isoDate(addDays(startOfWeek(t), -7)), to: isoDate(t) };
  if (p === 'last_month')                         { const lm = addMonths(t, -1); return { from: isoDate(startOfMonth(lm)), to: isoDate(endOfMonth(lm)) }; }
  if (p === 'last_month_to_date')                 return { from: isoDate(startOfMonth(addMonths(t, -1))), to: isoDate(t) };
  if (p === 'last_month_to_today')                return { from: isoDate(startOfMonth(addMonths(t, -1))), to: isoDate(t) };
  if (p === 'last_quarter')                       { const lq = addMonths(t, -3); return { from: isoDate(startOfQuarter(lq)), to: isoDate(endOfQuarter(lq)) }; }
  if (p === 'last_quarter_to_date')               return { from: isoDate(startOfQuarter(addMonths(t, -3))), to: isoDate(t) };
  if (p === 'last_quarter_to_today')              return { from: isoDate(startOfQuarter(addMonths(t, -3))), to: isoDate(t) };
  if (p === 'last_fiscal_quarter')                { const lq = addMonths(t, -3); return { from: isoDate(startOfQuarter(lq)), to: isoDate(endOfQuarter(lq)) }; }
  if (p === 'last_fiscal_quarter_to_date')        return { from: isoDate(startOfQuarter(addMonths(t, -3))), to: isoDate(t) };
  if (p === 'last_year')                          return { from: `${ly}-01-01`, to: `${ly}-12-31` };
  if (p === 'last_year_to_date')                  return { from: `${ly}-01-01`, to: isoDate(t) };
  if (p === 'last_year_to_today')                 return { from: `${ly}-01-01`, to: isoDate(t) };
  if (p === 'last_financial_year')                return { from: `${ly}-01-01`, to: `${ly}-12-31` };
  if (p === 'last_financial_year_to_date')        return { from: `${ly}-01-01`, to: isoDate(t) };
  if (p === 'last_7_days')                        return { from: isoDate(addDays(t, -7)), to: isoDate(t) };
  if (p === 'last_30_days')                       return { from: isoDate(addDays(t, -30)), to: isoDate(t) };
  if (p === 'last_90_days')                       return { from: isoDate(addDays(t, -90)), to: isoDate(t) };
  if (p === 'last_12_months')                     return { from: isoDate(addMonths(t, -12)), to: isoDate(t) };
  if (p === 'since_30_days_ago')                  return { from: isoDate(addDays(t, -30)), to: isoDate(t) };
  if (p === 'since_60_days_ago')                  return { from: isoDate(addDays(t, -60)), to: isoDate(t) };
  if (p === 'since_90_days_ago')                  return { from: isoDate(addDays(t, -90)), to: isoDate(t) };
  if (p === 'since_365_days_ago')                 return { from: isoDate(addDays(t, -365)), to: isoDate(t) };
  if (p === 'next_week')                          { const m = addDays(startOfWeek(t), 7); return { from: isoDate(m), to: isoDate(addDays(m, 6)) }; }
  if (p === 'next_4_weeks')                       { const m = addDays(startOfWeek(t), 7); return { from: isoDate(m), to: isoDate(addDays(m, 27)) }; }
  if (p === 'next_month')                         { const nm = addMonths(t, 1); return { from: isoDate(startOfMonth(nm)), to: isoDate(endOfMonth(nm)) }; }
  if (p === 'next_quarter')                       { const nq = addMonths(t, 3); return { from: isoDate(startOfQuarter(nq)), to: isoDate(endOfQuarter(nq)) }; }
  if (p === 'next_fiscal_quarter')                { const nq = addMonths(t, 3); return { from: isoDate(startOfQuarter(nq)), to: isoDate(endOfQuarter(nq)) }; }
  if (p === 'next_year')                          return { from: `${ny}-01-01`, to: `${ny}-12-31` };
  if (p === 'next_financial_year')                return { from: `${ny}-01-01`, to: `${ny}-12-31` };
  return null;
}

export const PERIOD_GROUPS: PeriodGroup[] = [
  {
    label: null,
    items: [
      { value: 'today',                             label: 'Today' },
      { value: 'this_week',                         label: 'This week' },
      { value: 'this_week_to_date',                 label: 'This week to date' },
      { value: 'this_month',                        label: 'This month' },
      { value: 'this_month_to_date',                label: 'This month to date' },
      { value: 'this_quarter',                      label: 'This quarter' },
      { value: 'this_quarter_to_date',              label: 'This quarter to date' },
      { value: 'this_fiscal_quarter',               label: 'This fiscal quarter' },
      { value: 'this_fiscal_quarter_to_date',       label: 'This fiscal quarter to date' },
      { value: 'this_year',                         label: 'This year' },
      { value: 'this_year_to_date',                 label: 'This year to date' },
      { value: 'this_year_to_last_month',           label: 'This year to last month' },
      { value: 'this_financial_year',               label: 'This financial year' },
      { value: 'this_financial_year_to_date',       label: 'This financial year to date' },
      { value: 'this_financial_year_to_last_month', label: 'This financial year to last month' },
    ],
  },
  {
    label: null,
    items: [
      { value: 'last_6_months',               label: 'Last 6 months' },
      { value: 'yesterday',                   label: 'Yesterday' },
      { value: 'last_week',                   label: 'Last week' },
      { value: 'last_week_to_date',           label: 'Last week to date' },
      { value: 'last_week_to_today',          label: 'Last week to today' },
      { value: 'last_month',                  label: 'Last month' },
      { value: 'last_month_to_date',          label: 'Last month to date' },
      { value: 'last_month_to_today',         label: 'Last month to today' },
      { value: 'last_quarter',                label: 'Last quarter' },
      { value: 'last_quarter_to_date',        label: 'Last quarter to date' },
      { value: 'last_quarter_to_today',       label: 'Last quarter to today' },
      { value: 'last_fiscal_quarter',         label: 'Last fiscal quarter' },
      { value: 'last_fiscal_quarter_to_date', label: 'Last fiscal quarter to date' },
      { value: 'last_year',                   label: 'Last year' },
      { value: 'last_year_to_date',           label: 'Last year to date' },
      { value: 'last_year_to_today',          label: 'Last year to today' },
      { value: 'last_financial_year',         label: 'Last financial year' },
      { value: 'last_financial_year_to_date', label: 'Last financial year to date' },
      { value: 'last_7_days',                 label: 'Last 7 days' },
      { value: 'last_30_days',                label: 'Last 30 days' },
      { value: 'last_90_days',                label: 'Last 90 days' },
      { value: 'last_12_months',              label: 'Last 12 months' },
      { value: 'since_30_days_ago',           label: 'Since 30 days ago' },
      { value: 'since_60_days_ago',           label: 'Since 60 days ago' },
      { value: 'since_90_days_ago',           label: 'Since 90 days ago' },
      { value: 'since_365_days_ago',          label: 'Since 365 days ago' },
    ],
  },
  {
    label: null,
    items: [
      { value: 'next_week',           label: 'Next week' },
      { value: 'next_4_weeks',        label: 'Next 4 weeks' },
      { value: 'next_month',          label: 'Next month' },
      { value: 'next_quarter',        label: 'Next quarter' },
      { value: 'next_fiscal_quarter', label: 'Next fiscal quarter' },
      { value: 'next_year',           label: 'Next year' },
      { value: 'next_financial_year', label: 'Next financial year' },
    ],
  },
  {
    label: null,
    items: [
      { value: 'custom', label: 'Custom' },
    ],
  },
];

export const ALL_PERIOD_OPTIONS: PeriodOption[] = PERIOD_GROUPS.flatMap(g => g.items);

export function periodLabel(val: ReportPeriodPreset): string {
  return ALL_PERIOD_OPTIONS.find(p => p.value === val)?.label ?? 'Custom';
}

/** Format YYYY-MM-DD → MM/DD/YYYY */
export function formatDisplayDate(iso: string): string {
  if (!iso) return '';
  const [y, m, d] = iso.split('-');
  return `${m}/${d}/${y}`;
}

/** Parse MM/DD/YYYY → YYYY-MM-DD */
export function parseDisplayDate(display: string): string {
  if (!display) return '';
  const parts = display.split('/');
  if (parts.length !== 3) return display;
  const [m, d, y] = parts;
  return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
}

/** Format YYYY-MM-DD → human readable e.g. "Jan 1–May 17, 2026" */
export function formatDateRange(from: string, to: string): string {
  if (!from || !to) return '';
  const fmt = (iso: string) => {
    const [y, m, d] = iso.split('-').map(Number);
    const date = new Date(y, m - 1, d);
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  };
  const f = fmt(from), t = fmt(to);
  // If same year, omit year from first date
  const [fy] = from.split('-'), [ty] = to.split('-');
  if (fy === ty) {
    const fShort = new Date(+fy, +from.split('-')[1]-1, +from.split('-')[2])
      .toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    return `${fShort}–${t}`;
  }
  return `${f}–${t}`;
}

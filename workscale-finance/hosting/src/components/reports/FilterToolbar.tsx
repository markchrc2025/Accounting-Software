import * as React from 'react';
import { format, isValid } from 'date-fns';
import { CalendarIcon, ChevronDown, ChevronUp, Sliders } from 'lucide-react';
import { cn } from '../../lib/utils';
import { Popover, PopoverContent, PopoverTrigger } from '../ui/popover';
import { Calendar } from '../ui/calendar';
import {
  Select, SelectContent, SelectGroup, SelectItem,
  SelectSeparator, SelectTrigger, SelectValue,
} from '../ui/select';
import { PERIOD_GROUPS, periodLabel, formatDisplayDate } from '../../lib/periodUtils';
import type { ReportFilters, AccountingMethod, DisplayColumnsBy, CompareTo, ReportPeriodPreset } from '../../types/reports';

const COLUMN_OPTIONS: DisplayColumnsBy[] = [
  'Total only', 'Days', 'Weeks', 'Months', 'Quarters', 'Years',
  'Customers', 'Vendors', 'Employees', 'Classes', 'Locations',
];
const COMPARE_OPTIONS: { value: string; label: string }[] = [
  { value: '__none__',        label: 'Select Period'   },
  { value: 'Previous period', label: 'Previous period' },
  { value: 'Previous year',   label: 'Previous year'   },
  { value: 'Year-to-date',    label: 'Year-to-date'    },
];

// ─── Tiny stacked label + control ────────────────────────────────────
function F({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 3, flexShrink: 0 }}>
      <span style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.07em', color: '#6b7280' }}>
        {label}
      </span>
      {children}
    </div>
  );
}

// ─── Date picker ──────────────────────────────────────────────────────
function DatePicker({ label, value, onChange }: { label: string; value: string; onChange: (iso: string) => void }) {
  const [open, setOpen] = React.useState(false);
  const selectedDate = React.useMemo(() => {
    if (!value) return undefined;
    const [y, m, d] = value.split('-').map(Number);
    const dt = new Date(y, m - 1, d);
    return isValid(dt) ? dt : undefined;
  }, [value]);

  return (
    <F label={label}>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button style={{
            display: 'flex', alignItems: 'center', gap: 6,
            height: 34, padding: '0 10px',
            border: '1px solid #d1d5db', borderRadius: 6,
            background: '#fff', fontSize: 13, cursor: 'pointer',
            whiteSpace: 'nowrap', minWidth: 118,
          }}>
            <span style={{ flex: 1, textAlign: 'left', color: value ? '#111827' : '#9ca3af' }}>
              {value ? formatDisplayDate(value) : 'MM/DD/YYYY'}
            </span>
            <CalendarIcon style={{ width: 14, height: 14, color: '#9ca3af', flexShrink: 0 }} />
          </button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0" align="start">
          <Calendar
            mode="single"
            selected={selectedDate}
            onSelect={day => { if (day) { onChange(format(day, 'yyyy-MM-dd')); setOpen(false); } }}
            initialFocus
          />
        </PopoverContent>
      </Popover>
    </F>
  );
}

// ─── Main component ───────────────────────────────────────────────────
interface FilterToolbarProps {
  filters: ReportFilters;
  onPeriodChange:  (p: ReportPeriodPreset) => void;
  onFromChange:    (d: string) => void;
  onToChange:      (d: string) => void;
  onMethodChange:  (m: AccountingMethod) => void;
  onColumnsChange: (c: DisplayColumnsBy) => void;
  onCompareChange: (c: CompareTo) => void;
  isCustomised:    boolean;
  onCustomise:     () => void;
}

export function FilterToolbar({
  filters, onPeriodChange, onFromChange, onToChange,
  onMethodChange, onColumnsChange, onCompareChange,
  isCustomised, onCustomise,
}: FilterToolbarProps) {
  const [collapsed, setCollapsed] = React.useState(false);

  return (
    <div style={{ background: '#fff', borderBottom: '1px solid #e5e7eb', flexShrink: 0 }}>
      {/* ── Top micro-row ── */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 16, padding: '6px 16px 4px' }}>
        <a href="#" style={{ fontSize: 12, color: '#F97316', textDecoration: 'none', fontWeight: 500 }}
          onMouseEnter={e => (e.currentTarget.style.textDecoration = 'underline')}
          onMouseLeave={e => (e.currentTarget.style.textDecoration = 'none')}>
          Learn more
        </a>
        <button
          onClick={() => setCollapsed(c => !c)}
          style={{ background: 'none', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', color: '#6b7280', padding: 2 }}
        >
          {collapsed
            ? <ChevronDown style={{ width: 15, height: 15 }} />
            : <ChevronUp   style={{ width: 15, height: 15 }} />}
        </button>
      </div>

      {/* ── Filter row ── */}
      {!collapsed && (
        <div style={{
          display: 'flex', alignItems: 'flex-end', gap: 12, flexWrap: 'nowrap',
          padding: '4px 16px 12px', overflowX: 'auto',
        }}>
          {/* 1. Report period */}
          <F label="Report period">
            <Select value={filters.period} onValueChange={v => onPeriodChange(v as ReportPeriodPreset)}>
              <SelectTrigger style={{ height: 34, width: 180, fontSize: 13 }}>
                <SelectValue>{periodLabel(filters.period)}</SelectValue>
              </SelectTrigger>
              <SelectContent className="max-h-[28rem]">
                {PERIOD_GROUPS.map((group, gi) => (
                  <React.Fragment key={gi}>
                    {gi > 0 && <SelectSeparator />}
                    <SelectGroup>
                      {group.items.map(opt => (
                        <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                      ))}
                    </SelectGroup>
                  </React.Fragment>
                ))}
              </SelectContent>
            </Select>
          </F>

          {/* 2 & 3. From / To */}
          <DatePicker label="From" value={filters.from} onChange={onFromChange} />
          <DatePicker label="To"   value={filters.to}   onChange={onToChange} />

          {/* 4. Accounting method */}
          <F label="Accounting method">
            <div style={{ display: 'flex', height: 34, border: '1px solid #d1d5db', borderRadius: 6, overflow: 'hidden', background: '#fff' }}>
              {(['Cash', 'Accrual'] as AccountingMethod[]).map(m => (
                <button
                  key={m}
                  onClick={() => onMethodChange(m)}
                  style={{
                    padding: '0 14px', fontSize: 13, fontWeight: 500, cursor: 'pointer', border: 'none',
                    background: filters.method === m ? '#F97316' : '#fff',
                    color:      filters.method === m ? '#fff'    : '#6b7280',
                    transition: 'background 0.15s, color 0.15s',
                  }}
                >
                  {m}
                </button>
              ))}
            </div>
          </F>

          {/* 5. Display columns by */}
          <F label="Display columns by">
            <Select value={filters.columns} onValueChange={v => onColumnsChange(v as DisplayColumnsBy)}>
              <SelectTrigger style={{ height: 34, width: 140, fontSize: 13 }}>
                <SelectValue>{filters.columns}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                {COLUMN_OPTIONS.map(opt => (
                  <SelectItem key={opt} value={opt}>{opt}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </F>

          {/* 6. Compare to */}
          <F label="Compare to">
            <Select
              value={filters.compareTo || '__none__'}
              onValueChange={v => onCompareChange(v === '__none__' ? '' as CompareTo : v as CompareTo)}
            >
              <SelectTrigger style={{ height: 34, width: 148, fontSize: 13 }}>
                <SelectValue placeholder="Select Period">{filters.compareTo || 'Select Period'}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                {COMPARE_OPTIONS.map(opt => (
                  <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </F>

          {/* Customise */}
          <div style={{ marginLeft: 'auto', paddingBottom: 1, flexShrink: 0 }}>
            <button
              onClick={onCustomise}
              style={{
                position: 'relative', display: 'flex', alignItems: 'center', gap: 6,
                height: 34, padding: '0 14px',
                border: '1px solid #d1d5db', borderRadius: 6,
                background: '#fff', fontSize: 13, fontWeight: 500, cursor: 'pointer',
                color: '#374151',
              }}
            >
              <Sliders style={{ width: 14, height: 14 }} />
              Customise
              {isCustomised && (
                <span style={{
                  position: 'absolute', top: -4, right: -4,
                  width: 10, height: 10, borderRadius: '50%',
                  background: '#2CA01C', border: '2px solid #fff',
                }} />
              )}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}



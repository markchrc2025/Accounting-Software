// PeriodSelect — compact period dropdown for widget headers
import * as Select from '@radix-ui/react-select';
import { ChevronDown, Check } from 'lucide-react';

export const PERIOD_OPTIONS = [
  { value: '7d',        label: 'Last 7 days' },
  { value: '30d',       label: 'Last 30 days' },
  { value: 'this_month',label: 'This month' },
  { value: 'last_month',label: 'Last month' },
  { value: 'this_qtr',  label: 'This quarter' },
  { value: 'this_year', label: 'This year' },
  { value: 'all_time',  label: 'All-time' },
  { value: 'custom',    label: 'Custom' },
];

export function PeriodSelect({ value, onValueChange, defaultValue = 'this_month' }) {
  return (
    <Select.Root value={value} onValueChange={onValueChange} defaultValue={defaultValue}>
      <Select.Trigger className="flex items-center gap-1 h-7 px-2 rounded-md border border-[#E5E7EB] bg-white text-[12px] text-[#6B7280] hover:border-[#F97316]/50 transition-colors outline-none data-[state=open]:border-[#F97316]">
        <Select.Value />
        <Select.Icon>
          <ChevronDown size={11} />
        </Select.Icon>
      </Select.Trigger>

      <Select.Portal>
        <Select.Content
          className="z-50 min-w-[140px] rounded-xl bg-white border border-[#E5E7EB] shadow-md p-1 text-[13px]"
          position="popper"
          sideOffset={4}
        >
          <Select.Viewport>
            {PERIOD_OPTIONS.map(opt => (
              <Select.Item
                key={opt.value}
                value={opt.value}
                className="flex items-center gap-2 px-2 py-1.5 rounded-lg text-[#1F2937] cursor-pointer outline-none data-[highlighted]:bg-[#FFF7ED] data-[highlighted]:text-[#F97316]"
              >
                <Select.ItemText>{opt.label}</Select.ItemText>
                <Select.ItemIndicator className="ml-auto">
                  <Check size={12} className="text-[#F97316]" />
                </Select.ItemIndicator>
              </Select.Item>
            ))}
          </Select.Viewport>
        </Select.Content>
      </Select.Portal>
    </Select.Root>
  );
}

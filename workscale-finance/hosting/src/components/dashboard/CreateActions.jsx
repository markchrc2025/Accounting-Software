// CreateActions — row of quick-create pill buttons
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import * as Popover from '@radix-ui/react-popover';
import { ChevronDown } from 'lucide-react';

const QUICK_ACTIONS = [
  { label: 'Create voucher',         path: '/scalebooks/vouchers' },
  { label: 'Record disbursement',    path: '/scalebooks/disbursements' },
  { label: 'Create cheque',          path: '/scalebooks/checks' },
  { label: 'Create billing statement', path: '/scalebooks/billing' },
  { label: 'Add journal entry',      path: '/scalebooks/journal' },
];

const ALL_ACTIONS = [
  ...QUICK_ACTIONS,
  { label: 'Payment Schedule entry', path: '/scalebooks/pay-schedule' },
  { label: 'Bank Transaction',       path: '/scalebooks/bank' },
  { label: 'Fixed Asset',            path: '/scalebooks/assets' },
  { label: 'Service Invoice',        path: '/scalebooks/invoices' },
  { label: 'Collection entry',       path: '/scalebooks/collections' },
];

export function CreateActions() {
  const navigate = useNavigate();
  const [showAll, setShowAll] = useState(false);

  return (
    <div className="mb-8">
      <h2 className="text-[18px] font-semibold text-[#1F2937] mb-3">Create actions</h2>
      <div className="flex items-center gap-2 flex-wrap">
        {QUICK_ACTIONS.map(action => (
          <button
            key={action.label}
            onClick={() => navigate(action.path)}
            className="h-9 rounded-full border border-[#E5E7EB] bg-white px-4 text-[14px] text-[#1F2937] hover:border-[#F97316]/50 hover:bg-[#FFF7ED] transition-colors"
          >
            {action.label}
          </button>
        ))}

        {/* Show all popover */}
        <Popover.Root open={showAll} onOpenChange={setShowAll}>
          <Popover.Trigger asChild>
            <button className="h-9 rounded-full px-4 text-[14px] font-medium text-[#F97316] hover:bg-[#FFF7ED] transition-colors flex items-center gap-1 outline-none">
              Show all
              <ChevronDown size={13} />
            </button>
          </Popover.Trigger>
          <Popover.Portal>
            <Popover.Content
              sideOffset={8}
              align="start"
              className="z-50 w-56 rounded-xl bg-white border border-[#E5E7EB] shadow-md p-2"
            >
              {ALL_ACTIONS.map(action => (
                <button
                  key={action.label}
                  onClick={() => { navigate(action.path); setShowAll(false); }}
                  className="w-full text-left px-3 py-2 rounded-lg text-[13px] text-[#1F2937] hover:bg-[#FFF7ED] transition-colors"
                >
                  {action.label}
                </button>
              ))}
              <Popover.Arrow className="fill-white" />
            </Popover.Content>
          </Popover.Portal>
        </Popover.Root>
      </div>
    </div>
  );
}

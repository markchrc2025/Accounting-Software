import { useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  FileText, CreditCard, Wallet, Calendar,
  BookOpen, Building, Package,
  Receipt, ClipboardList, DollarSign,
  Users, Truck, UserCheck, List,
  X,
} from 'lucide-react';

// ─── Flyout item groups ───────────────────────────────────────────────────────
const GROUPS = [
  {
    label: 'Disbursement',
    items: [
      { icon: FileText,    label: 'Voucher',               shortcut: 'Ctrl+V', path: '/vouchers' },
      { icon: CreditCard,  label: 'Cheque',                shortcut: 'Ctrl+H', path: '/checks' },
      { icon: Wallet,      label: 'Disbursement',          shortcut: 'Ctrl+D', path: '/disbursements' },
      { icon: Calendar,    label: 'Payment Schedule entry',shortcut: null,      path: '/pay-schedule' },
    ],
  },
  {
    label: 'Accounting',
    items: [
      { icon: BookOpen,    label: 'Journal Entry',         shortcut: 'Ctrl+J', path: '/journal' },
      { icon: Building,    label: 'Bank Transaction',      shortcut: null,      path: '/bank' },
      { icon: Package,     label: 'Fixed Asset',           shortcut: null,      path: '/assets' },
    ],
  },
  {
    label: 'Billing & AR',
    items: [
      { icon: Receipt,     label: 'Billing Statement',     shortcut: 'Ctrl+B', path: '/billing' },
      { icon: ClipboardList,label:'Service Invoice',       shortcut: null,      path: '/invoices' },
      { icon: DollarSign,  label: 'Collection entry',      shortcut: null,      path: '/collections' },
    ],
  },
  {
    label: 'Lists',
    items: [
      { icon: Users,       label: 'Customer',              shortcut: null,      path: '/contacts' },
      { icon: Truck,       label: 'Vendor',                shortcut: null,      path: '/contacts' },
      { icon: UserCheck,   label: 'Employee',              shortcut: null,      path: '/contacts' },
      { icon: List,        label: 'Chart of Accounts entry',shortcut: null,     path: '/coa' },
    ],
  },
];

// ─── Create flyout ────────────────────────────────────────────────────────────
export function CreateFlyout({ open, onClose }) {
  const navigate  = useNavigate();
  const panelRef  = useRef(null);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    function handler(e) {
      if (panelRef.current && !panelRef.current.contains(e.target)) onClose();
    }
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open, onClose]);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    function handler(e) { if (e.key === 'Escape') onClose(); }
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [open, onClose]);

  if (!open) return null;

  function handleItem(path) {
    navigate(path, { state: { openCreate: true } });
    onClose();
  }

  return (
    <div
      ref={panelRef}
      style={{ left: 80, top: 56 }}
      className="fixed w-[280px] bg-white border border-[#E5E7EB] rounded-xl shadow-md p-4 z-40 overflow-y-auto max-h-[calc(100vh-72px)]"
    >
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <span className="text-sm font-semibold text-[#1F2937]">Create new</span>
        <button
          onClick={onClose}
          className="h-6 w-6 flex items-center justify-center rounded-md text-[#6B7280] hover:bg-[#F3F4F6] hover:text-[#1F2937] transition-colors"
        >
          <X size={14} />
        </button>
      </div>

      {/* Groups */}
      <div className="space-y-3">
        {GROUPS.map(group => (
          <div key={group.label}>
            <p className="text-[11px] font-semibold uppercase tracking-[0.05em] text-[#9CA3AF] mb-1 px-1">
              {group.label}
            </p>
            {group.items.map(item => (
              <button
                key={item.label}
                onClick={() => handleItem(item.path)}
                className="w-full flex items-center gap-2.5 h-9 px-2 rounded-lg text-sm text-[#1F2937] hover:bg-[#FFF7ED] transition-colors"
              >
                <item.icon size={15} className="text-[#6B7280] flex-shrink-0" />
                <span className="flex-1 text-left truncate">{item.label}</span>
                {item.shortcut && (
                  <kbd className="text-[10px] font-medium text-[#9CA3AF] border border-[#E5E7EB] rounded px-1 py-0.5 leading-none bg-[#F9FAFB] flex-shrink-0">
                    {item.shortcut}
                  </kbd>
                )}
              </button>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

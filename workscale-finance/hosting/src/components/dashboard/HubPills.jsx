// HubPills — 6 category shortcuts, centered, pill-shaped
import { useNavigate } from 'react-router-dom';
import {
  Calculator, Wallet, FileText, CheckCircle, Receipt, BarChart3,
} from 'lucide-react';
import { usePermissions } from '../../contexts/PermissionsContext.jsx';

const PILLS = [
  { label: 'Accounting',   icon: Calculator,    color: '#1E3A5F', bg: '#EFF6FF', path: '/scalebooks/journal' },
  { label: 'Disbursement', icon: Wallet,         color: '#F97316', bg: '#FFF7ED', path: '/scalebooks/vouchers' },
  { label: 'Billing & AR', icon: FileText,       color: '#2563EB', bg: '#EFF6FF', path: '/scalebooks/billing' },
  { label: 'Approvals',    icon: CheckCircle,    color: '#16A34A', bg: '#F0FDF4', path: '/scalebooks/approvals', requiresRole: ['Verifier', 'Approver', 'Poster', 'Admin'] },
  { label: 'Tax',          icon: Receipt,        color: '#DC2626', bg: '#FEF2F2', path: '/scalebooks/tax' },
  { label: 'Reports',      icon: BarChart3,      color: '#7C3AED', bg: '#F5F3FF', path: '/scalebooks/reports' },
];

export function HubPills() {
  const navigate = useNavigate();
  const { globalRoles, isAdmin } = usePermissions();

  const visiblePills = PILLS.filter(pill => {
    if (!pill.requiresRole) return true;
    return isAdmin || pill.requiresRole.some(r => globalRoles.includes(r));
  });

  return (
    <div className="flex items-center justify-center gap-3 flex-wrap mb-8">
      {visiblePills.map(pill => (
        <button
          key={pill.label}
          onClick={() => navigate(pill.path)}
          className="group flex items-center gap-3 h-14 rounded-full bg-white border border-[#E5E7EB] px-6 text-[16px] font-medium text-[#1F2937] transition-all hover:-translate-y-px hover:shadow-sm hover:border-[#F97316] outline-none"
        >
          <span
            className="flex items-center justify-center w-9 h-9 rounded-full flex-shrink-0"
            style={{ background: pill.bg }}
          >
            <pill.icon size={18} style={{ color: pill.color }} strokeWidth={1.75} />
          </span>
          {pill.label}
        </button>
      ))}
    </div>
  );
}

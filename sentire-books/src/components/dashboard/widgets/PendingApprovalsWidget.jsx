// Widget B — Pending Approvals
import { useNavigate } from 'react-router-dom';
import { WidgetShell } from './WidgetShell.jsx';

export function PendingApprovalsWidget({ count = 0, loading = false }) {
  const navigate = useNavigate();

  return (
    <WidgetShell
      label="Pending Approvals"
      footer={
        <button onClick={() => navigate('/approvals')} className="text-[#F97316] hover:underline">
          View all →
        </button>
      }
    >
      <div className="flex flex-col h-full justify-between">
        <div>
          <p className="text-[28px] font-semibold text-[#1F2937] leading-tight">
            {loading ? '—' : count}
          </p>
          <p className="text-[12px] text-[#9CA3AF] mt-0.5">Awaiting action</p>
        </div>
        <button
          onClick={() => navigate('/approvals')}
          className="mt-3 h-8 rounded-lg bg-[#F97316] text-white text-[13px] font-medium px-4 hover:bg-[#EA580C] transition-colors self-start"
        >
          Review now
        </button>
      </div>
    </WidgetShell>
  );
}

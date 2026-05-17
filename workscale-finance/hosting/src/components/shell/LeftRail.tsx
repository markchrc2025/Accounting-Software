import * as React from 'react';
import {
  Plus, Bookmark, Home, Rss, BarChart2, Grid,
  Calculator, CreditCard, MoreHorizontal, Settings2,
} from 'lucide-react';
import { cn } from '../../lib/utils';
import type { ReportType } from '../../types/reports';
import { REPORT_TABS } from '../reports/ReportViewport';

// ─── Icon-rail item ───────────────────────────────────────────────────
interface RailItemProps {
  icon: React.ElementType;
  label: string;
  active?: boolean;
  onClick?: () => void;
}

function RailItem({ icon: Icon, label, active, onClick }: RailItemProps) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'flex flex-col items-center justify-center gap-1 w-full py-2.5 px-1 rounded-lg transition-colors',
        active
          ? 'text-[#2CA01C] bg-[#f0fdf0]'
          : 'text-slate-400 hover:text-slate-700 hover:bg-slate-100',
      )}
    >
      <Icon className="h-5 w-5" strokeWidth={active ? 2.2 : 1.8} />
      <span className="text-[9px] font-semibold leading-none tracking-tight">{label}</span>
    </button>
  );
}

// ─── Left rail ────────────────────────────────────────────────────────
interface LeftRailProps {
  activeReport: ReportType;
  onReportChange: (r: ReportType) => void;
}

export function LeftRail({ activeReport, onReportChange }: LeftRailProps) {
  return (
    <aside className="w-[80px] shrink-0 flex flex-col items-center border-r border-border bg-white py-2 overflow-y-auto">
      {/* Primary group */}
      <div className="w-full px-2 space-y-0.5">
        <RailItem icon={Plus}     label="Create"    />
        <RailItem icon={Bookmark} label="Bookmarks" />
        <RailItem icon={Home}     label="Home"      />
        <RailItem icon={Rss}      label="Feed"      />
        <RailItem
          icon={BarChart2}
          label="Reports"
          active={true}
        />
        <RailItem icon={Grid}     label="All apps"  />
      </div>

      {/* Divider */}
      <div className="w-12 h-px bg-border my-3" />

      {/* PINNED label */}
      <p className="text-[9px] font-extrabold uppercase tracking-widest text-slate-400 mb-2 px-2 w-full text-center">
        Pinned
      </p>

      {/* Pinned items */}
      <div className="w-full px-2 space-y-0.5">
        <RailItem icon={Calculator}   label="Accounting" />
        <RailItem icon={CreditCard}   label="Expenses"   />
        <RailItem icon={MoreHorizontal} label="More"     />
        <RailItem icon={Settings2}    label="Customise"  />
      </div>

      {/* Spacer + Report sub-tabs (vertical) */}
      <div className="flex-1" />
      <div className="w-full px-2 pb-2 space-y-0.5">
        {REPORT_TABS.map(tab => (
          <button
            key={tab.id}
            onClick={() => onReportChange(tab.id)}
            title={tab.label}
            className={cn(
              'w-full flex items-center justify-center py-2 rounded-lg transition-colors',
              activeReport === tab.id
                ? 'bg-[#2CA01C]/10 text-[#2CA01C]'
                : 'text-slate-400 hover:bg-slate-100 hover:text-slate-700',
            )}
          >
            <span className="text-[8px] font-bold text-center leading-tight px-0.5 line-clamp-2">
              {tab.label.split(' ').map((w, i) => (
                <span key={i} className="block">{w}</span>
              ))}
            </span>
          </button>
        ))}
      </div>
    </aside>
  );
}

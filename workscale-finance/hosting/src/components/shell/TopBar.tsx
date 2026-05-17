import * as React from 'react';
import {
  Search, CheckSquare, Zap, Bell, Settings, HelpCircle,
} from 'lucide-react';
import { cn } from '../../lib/utils';

// ─── Icon button helper ───────────────────────────────────────────────
function IconBtn({
  icon: Icon, label, badge, onClick,
}: { icon: React.ElementType; label: string; badge?: boolean; onClick?: () => void }) {
  return (
    <button
      onClick={onClick}
      title={label}
      className="relative flex h-9 w-9 items-center justify-center rounded-full text-slate-500 hover:bg-slate-100 hover:text-slate-800 transition-colors"
    >
      <Icon className="h-5 w-5" strokeWidth={1.75} />
      {badge && (
        <span className="absolute top-1.5 right-1.5 h-2 w-2 rounded-full bg-[#2CA01C] ring-2 ring-white" />
      )}
      <span className="sr-only">{label}</span>
    </button>
  );
}

// ─── Avatar ───────────────────────────────────────────────────────────
function Avatar({ name }: { name: string }) {
  const initials = name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map(w => w[0])
    .join('')
    .toUpperCase();

  return (
    <button className="h-8 w-8 rounded-full bg-[#2CA01C] text-white text-xs font-bold flex items-center justify-center ring-2 ring-white hover:ring-[#2CA01C] transition-all">
      {initials || 'U'}
    </button>
  );
}

// ─── Top bar ──────────────────────────────────────────────────────────
interface TopBarProps {
  companyName: string;
  userEmail?:  string;
}

export function TopBar({ companyName, userEmail }: TopBarProps) {
  return (
    <header className="h-14 shrink-0 flex items-center gap-4 border-b border-border bg-white px-4 z-10">
      {/* Brand mark */}
      <div className="flex items-center gap-2 shrink-0">
        <div className="h-7 w-7 rounded-md bg-[#2CA01C] flex items-center justify-center">
          <span className="text-white text-xs font-black leading-none">S</span>
        </div>
        {/* Company name */}
        <span className="text-[20px] font-semibold tracking-tight text-foreground truncate max-w-[180px]">
          {companyName}
        </span>
      </div>

      {/* Search ─────────────────────────────────────────── */}
      <div className="flex-1 max-w-2xl mx-auto">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
          <input
            type="text"
            placeholder="Navigate. Find transactions, contacts, help, reports, and more."
            className={cn(
              'h-9 w-full rounded-full border border-input bg-slate-50 pl-9 pr-4 text-sm',
              'placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-[#2CA01C]/30 focus:border-[#2CA01C]/60 focus:bg-white transition',
            )}
          />
        </div>
      </div>

      {/* Right icon cluster ──────────────────────────────── */}
      <div className="flex items-center gap-1 shrink-0">
        <IconBtn icon={CheckSquare} label="Tasks" />
        <IconBtn icon={Zap}         label="Shortcuts" />
        <IconBtn icon={Bell}        label="Notifications" badge />
        <IconBtn icon={Settings}    label="Settings" />
        <IconBtn icon={HelpCircle}  label="Help" />
        <div className="ml-1">
          <Avatar name={userEmail ?? 'User'} />
        </div>
      </div>
    </header>
  );
}

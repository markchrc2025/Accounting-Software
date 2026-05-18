import * as React from 'react';
import { useState, useRef, useEffect } from 'react';
import {
  Search, Clipboard, Zap, Bell, Settings, HelpCircle,
  ChevronDown, Sparkles, LogOut, User,
} from 'lucide-react';
import { cn } from '../../lib/utils';

// ─── Icon button ──────────────────────────────────────────────────────────────
function IconBtn({
  icon: Icon, label, badge, onClick,
}: { icon: React.ElementType; label: string; badge?: boolean; onClick?: () => void }) {
  return (
    <button
      onClick={onClick}
      title={label}
      className="relative flex h-9 w-9 items-center justify-center rounded-full text-[#6B7280] hover:bg-[#F3F4F6] hover:text-[#1F2937] transition-colors outline-none"
    >
      <Icon className="h-5 w-5" strokeWidth={1.75} />
      {badge && (
        <span className="absolute top-1.5 right-1.5 h-2 w-2 rounded-full bg-[#DC2626] ring-2 ring-white" />
      )}
      <span className="sr-only">{label}</span>
    </button>
  );
}

// ─── Top bar ──────────────────────────────────────────────────────────────────
export interface TopBarProps {
  companyName:        string;
  userEmail?:         string;
  logoUrl?:           string;
  onSignOut:          () => void;
  notificationCount?: number;
  onSearchClick?:     () => void;
  onSettingsClick?:   () => void;
  onProfileClick?:    () => void;
}

export function TopBar({
  companyName,
  userEmail,
  logoUrl,
  onSignOut,
  notificationCount = 0,
  onSearchClick,
  onSettingsClick,
  onProfileClick,
}: TopBarProps) {
  const [companyOpen,  setCompanyOpen]  = useState(false);
  const [profileOpen,  setProfileOpen]  = useState(false);
  const profileRef = useRef<HTMLDivElement>(null);

  // Close profile dropdown on outside click
  useEffect(() => {
    function handler(e: MouseEvent) {
      if (profileRef.current && !profileRef.current.contains(e.target as Node)) {
        setProfileOpen(false);
      }
    }
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const displayName = userEmail ?? 'User';
  const initials = displayName
    .split(/[\s@]/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w: string) => w[0])
    .join('')
    .toUpperCase() || 'U';

  return (
    <header className="h-14 shrink-0 flex items-center gap-3 border-b border-[#E5E7EB] bg-white px-4 z-20">

      {/* ── Brand mark ──────────────────────────────────────────────────── */}
      <div className="flex items-center gap-2 shrink-0 mr-1">
        <div className="h-7 w-7 rounded-md bg-[#F97316] flex items-center justify-center flex-shrink-0 overflow-hidden">
          {logoUrl
            ? <img src={logoUrl} alt="logo" className="w-full h-full object-contain p-0.5" />
            : <span className="text-white text-xs font-black leading-none">S</span>
          }
        </div>
        <span className="text-[17px] font-bold tracking-tight text-[#1F2937]">ScaleBooks</span>
      </div>

      {/* ── Company selector ────────────────────────────────────────────── */}
      <div className="relative shrink-0">
        <button
          onClick={() => setCompanyOpen(o => !o)}
          className="flex items-center gap-1 text-[15px] font-semibold text-[#1F2937] hover:text-[#F97316] transition-colors outline-none"
        >
          <span className="whitespace-nowrap">{companyName || 'Select company'}</span>
          <ChevronDown size={14} className="flex-shrink-0 text-[#6B7280]" />
        </button>
        {companyOpen && (
          <div className="absolute top-full left-0 mt-2 w-64 rounded-xl bg-white border border-[#E5E7EB] shadow-md p-2 z-50">
            <p className="text-[11px] font-semibold uppercase tracking-[0.05em] text-[#9CA3AF] px-2 pb-1">
              Companies
            </p>
            <button
              onClick={() => setCompanyOpen(false)}
              className="w-full flex items-center gap-2 px-2 py-2 rounded-lg text-sm text-[#1F2937] bg-[#FFF7ED] font-medium"
            >
              <span className="h-5 w-5 rounded-md bg-[#F97316] text-white text-[10px] font-black flex items-center justify-center flex-shrink-0">
                S
              </span>
              <span className="whitespace-nowrap">{companyName || 'Workscale Resources Inc.'}</span>
            </button>
          </div>
        )}
      </div>

      {/* ── Command-palette search trigger ──────────────────────────────── */}
      <div className="flex-1 max-w-2xl mx-auto">
        <button
          type="button"
          onClick={onSearchClick}
          className="relative h-9 w-full rounded-full border border-[#E5E7EB] bg-[#F9FAFB] pl-9 pr-4 text-sm text-left flex items-center text-[#9CA3AF] hover:border-[#F97316]/50 hover:bg-white transition-colors outline-none"
        >
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[#9CA3AF] pointer-events-none" />
          <span className="truncate">Navigate. Find vouchers, customers, help, reports, and more.</span>
          <kbd className="ml-auto flex items-center gap-0.5 rounded border border-[#E5E7EB] bg-white px-1.5 py-0.5 text-[11px] font-medium text-[#6B7280] shrink-0">
            <span className="text-[10px]">⌘</span>K
          </kbd>
        </button>
      </div>

      {/* ── Right icon cluster ───────────────────────────────────────────── */}
      <div className="flex items-center gap-0.5 shrink-0">
        <IconBtn icon={Clipboard}  label="Tasks" />
        <IconBtn icon={Zap}        label="Shortcuts" />
        <IconBtn icon={Bell}       label="Notifications" badge={notificationCount > 0} />
        <IconBtn icon={Settings}   label="Settings" onClick={onSettingsClick} />
        <IconBtn icon={HelpCircle} label="Help" />

        {/* Profile avatar + dropdown */}
        <div ref={profileRef} className="relative ml-1">
          <button
            onClick={() => setProfileOpen(o => !o)}
            className="h-8 w-8 rounded-full bg-[#F97316] text-white text-xs font-bold flex items-center justify-center ring-2 ring-white hover:ring-[#F97316]/50 transition-all outline-none"
          >
            {initials}
          </button>
          {profileOpen && (
            <div className="absolute top-full right-0 mt-2 w-52 rounded-xl bg-white border border-[#E5E7EB] shadow-md p-2 z-50">
              <div className="px-2 py-2 border-b border-[#F3F4F6] mb-1">
                <p className="text-sm font-semibold text-[#1F2937] truncate">{displayName}</p>
                {userEmail && (
                  <p className="text-xs text-[#6B7280] truncate">{userEmail}</p>
                )}
              </div>
              <button
                onClick={() => { setProfileOpen(false); onProfileClick?.(); }}
                className="w-full flex items-center gap-2 px-2 py-2 rounded-lg text-sm text-[#1F2937] hover:bg-[#F9FAFB] transition-colors outline-none"
              >
                <User size={15} />
                User Profile
              </button>
              <button
                onClick={() => { setProfileOpen(false); onSignOut(); }}
                className="w-full flex items-center gap-2 px-2 py-2 rounded-lg text-sm text-[#DC2626] hover:bg-red-50 transition-colors outline-none"
              >
                <LogOut size={15} />
                Sign out
              </button>
            </div>
          )}
        </div>

        {/* AI Assistant */}
        <button className="ml-1 flex items-center gap-1.5 h-9 rounded-full border border-[#E5E7EB] px-3 text-sm text-[#6B7280] hover:border-[#F97316] hover:text-[#F97316] transition-colors outline-none">
          <Sparkles size={15} />
          <span className="hidden sm:inline text-xs font-medium">AI</span>
        </button>
      </div>
    </header>
  );
}

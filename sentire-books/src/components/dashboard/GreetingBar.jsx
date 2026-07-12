// GreetingBar — greeting headline + date + Customise/Privacy controls
import { Sliders, EyeOff, Eye } from 'lucide-react';
import { useTimeOfDayGreeting } from '../../hooks/useTimeOfDayGreeting.js';
import { usePrivacyMode } from '../../hooks/usePrivacyMode.js';

const DATE_FMT = new Intl.DateTimeFormat('en-US', {
  timeZone: 'Asia/Manila',
  weekday: 'long', month: 'long', day: 'numeric', year: 'numeric',
});

export function GreetingBar({ isCustomising, isCustomised, onCustomiseToggle }) {
  const { greeting, firstName } = useTimeOfDayGreeting();
  const { isPrivate, togglePrivacy } = usePrivacyMode();

  const today = DATE_FMT.format(new Date());

  return (
    <div className="relative mb-8">
      {/* Top-right controls */}
      <div className="absolute top-0 right-0 flex items-center gap-2">
        {/* Privacy toggle */}
        <button
          onClick={togglePrivacy}
          className="flex items-center gap-1.5 h-8 px-3 rounded-lg border border-[#E5E7EB] bg-white text-[13px] text-[#6B7280] hover:border-[#F97316]/50 hover:text-[#F97316] transition-colors"
          title={isPrivate ? 'Show numbers' : 'Hide numbers'}
        >
          {isPrivate ? <Eye size={14} /> : <EyeOff size={14} />}
          <span className="hidden sm:inline">Privacy</span>
        </button>

        {/* Customise toggle */}
        <button
          onClick={onCustomiseToggle}
          className={`relative flex items-center gap-1.5 h-8 px-3 rounded-lg border text-[13px] transition-colors ${
            isCustomising
              ? 'border-[#F97316] bg-[#FFF7ED] text-[#F97316]'
              : 'border-[#E5E7EB] bg-white text-[#6B7280] hover:border-[#F97316]/50 hover:text-[#F97316]'
          }`}
        >
          <Sliders size={14} />
          <span className="hidden sm:inline">Customise</span>
          {isCustomised && !isCustomising && (
            <span className="absolute top-1 right-1 h-2 w-2 rounded-full bg-[#F97316]" />
          )}
        </button>
      </div>

      {/* Greeting */}
      <div className="text-center pt-2">
        <h1 className="text-[36px] font-[500] tracking-[-0.02em] text-[#1F2937] leading-tight">
          {greeting}, {firstName}!
        </h1>
        <p className="mt-1 text-[14px] text-[#6B7280]">
          Here's what's happening in your finance portal today.
        </p>
        <p className="mt-1 text-[13px] text-[#9CA3AF]">{today}</p>
      </div>
    </div>
  );
}

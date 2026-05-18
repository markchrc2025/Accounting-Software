// WidgetShell — shared card chrome for all dashboard widgets
import { useState } from 'react';
import { MoreHorizontal } from 'lucide-react';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';

export function WidgetShell({
  label,
  headerRight,
  footer,
  overflowItems,
  children,
  className = '',
}) {
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <div className={`h-full flex flex-col bg-white rounded-xl border border-[#E5E7EB] shadow-sm p-5 overflow-hidden ${className}`}>
      {/* Header */}
      <div className="flex items-center justify-between mb-3 flex-shrink-0">
        <span className="text-[11px] font-semibold uppercase tracking-[0.05em] text-[#6B7280]">
          {label}
        </span>
        {headerRight && (
          <div className="flex items-center">
            {headerRight}
          </div>
        )}
      </div>

      {/* Body */}
      <div className="flex-1 min-h-0">
        {children}
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between mt-3 pt-2 border-t border-[#F3F4F6] flex-shrink-0">
        <div className="text-[12px]">{footer}</div>

        {/* 3-dot menu */}
        <DropdownMenu.Root open={menuOpen} onOpenChange={setMenuOpen}>
          <DropdownMenu.Trigger asChild>
            <button className="h-6 w-6 flex items-center justify-center rounded-md text-[#9CA3AF] hover:text-[#6B7280] hover:bg-[#F3F4F6] transition-colors outline-none">
              <MoreHorizontal size={14} />
            </button>
          </DropdownMenu.Trigger>
          <DropdownMenu.Portal>
            <DropdownMenu.Content
              className="z-50 min-w-[140px] rounded-xl bg-white border border-[#E5E7EB] shadow-md p-1 text-[13px]"
              sideOffset={4}
              align="end"
            >
              {(overflowItems || []).map((item, i) => (
                <DropdownMenu.Item
                  key={i}
                  onSelect={item.onSelect}
                  className="flex items-center gap-2 px-2 py-1.5 rounded-lg text-[#1F2937] cursor-pointer outline-none data-[highlighted]:bg-[#FFF7ED] data-[highlighted]:text-[#F97316]"
                >
                  {item.label}
                </DropdownMenu.Item>
              ))}
              <DropdownMenu.Item
                onSelect={() => {}}
                className="flex items-center gap-2 px-2 py-1.5 rounded-lg text-[#6B7280] cursor-pointer outline-none data-[highlighted]:bg-[#F3F4F6]"
              >
                Remove widget
              </DropdownMenu.Item>
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu.Root>
      </div>
    </div>
  );
}

import * as React from 'react';
import { Sliders, Filter, Calendar, BarChart2, Users } from 'lucide-react';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '../ui/sheet';
import { Skeleton } from '../ui/skeleton';
import { Separator } from '../ui/separator';

interface CustomisePanelProps {
  open:     boolean;
  onClose:  () => void;
}

// ─── Section skeleton row ─────────────────────────────────────────────
function SectionRow({ icon: Icon, title, desc }: { icon: any; title: string; desc: string }) {
  return (
    <div className="flex items-start gap-3 py-3">
      <div className="mt-0.5 h-8 w-8 flex items-center justify-center rounded-md bg-muted text-muted-foreground shrink-0">
        <Icon className="h-4 w-4" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-foreground">{title}</p>
        <p className="text-xs text-muted-foreground mt-0.5">{desc}</p>
      </div>
      <Skeleton className="h-4 w-12 mt-1 shrink-0" />
    </div>
  );
}

export function CustomisePanel({ open, onClose }: CustomisePanelProps) {
  return (
    <Sheet open={open} onOpenChange={v => !v && onClose()}>
      <SheetContent side="right" className="w-[360px] sm:max-w-[360px] flex flex-col">
        <SheetHeader className="pb-4">
          <div className="flex items-center gap-2">
            <Sliders className="h-5 w-5 text-[#2CA01C]" />
            <SheetTitle className="text-base">Customise report</SheetTitle>
          </div>
          <SheetDescription className="text-xs">
            Adjust columns, filters, and groupings for this report.
          </SheetDescription>
        </SheetHeader>

        <Separator />

        {/* ── Skeleton sections ───────────────────────────── */}
        <div className="flex-1 overflow-y-auto mt-2 space-y-1">
          <p className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground px-1 mb-2">
            Display options
          </p>
          <SectionRow
            icon={BarChart2}
            title="Columns"
            desc="Choose which columns to display"
          />
          <Separator />
          <SectionRow
            icon={Calendar}
            title="Rows / Time period"
            desc="Group rows by time interval"
          />
          <Separator />
          <SectionRow
            icon={Filter}
            title="Filters"
            desc="Filter by account, class, or location"
          />
          <Separator />
          <SectionRow
            icon={Users}
            title="Header / Footer"
            desc="Customise header and footer content"
          />

          <div className="mt-6 px-1">
            <p className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground mb-3">
              Saved customisations
            </p>
            <div className="space-y-2">
              {[1, 2].map(i => (
                <div key={i} className="flex items-center gap-2 rounded-md border border-border p-2.5">
                  <Skeleton className="h-4 w-4 rounded" />
                  <Skeleton className="h-3 flex-1" />
                  <Skeleton className="h-3 w-10" />
                </div>
              ))}
              <button className="w-full mt-1 text-xs text-[#2CA01C] hover:underline text-left font-medium">
                + Save current customisation
              </button>
            </div>
          </div>
        </div>

        {/* ── Footer ─────────────────────────────────────── */}
        <Separator className="mt-4" />
        <div className="flex justify-end gap-2 pt-3">
          <button
            onClick={onClose}
            className="px-4 py-1.5 rounded-md border border-input text-sm font-medium hover:bg-accent transition-colors"
          >
            Cancel
          </button>
          <button className="px-4 py-1.5 rounded-md bg-[#2CA01C] text-white text-sm font-medium hover:bg-[#238716] transition-colors">
            Run report
          </button>
        </div>
      </SheetContent>
    </Sheet>
  );
}

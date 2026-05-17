import * as React from 'react';
import {
  RefreshCw, Mail, Printer, Download, MoreVertical, Sparkles,
  Info, FileText,
} from 'lucide-react';
import { Skeleton } from '../ui/skeleton';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import type { ReportDensity, ReportType } from '../../types/reports';
import { formatDateRange } from '../../lib/periodUtils';

export interface ReportTab {
  id: ReportType;
  label: string;
}

export const REPORT_TABS: ReportTab[] = [
  { id: 'general_ledger',    label: 'General Ledger'          },
  { id: 'trial_balance',     label: 'Trial Balance'           },
  { id: 'income_statement',  label: 'Income Statement'        },
  { id: 'balance_sheet',     label: 'Balance Sheet'           },
  { id: 'aging_receivables', label: 'Aging of Receivables'    },
  { id: 'payment_schedule',  label: 'Payment Schedule Report' },
];

// ─── Icon button ──────────────────────────────────────────────────────
function IBtn({ icon: Icon, title, onClick }: { icon: any; title: string; onClick?: () => void }) {
  return (
    <button onClick={onClick} title={title} style={{
      width: 32, height: 32, borderRadius: 6, border: 'none',
      background: 'transparent', cursor: 'pointer', display: 'flex',
      alignItems: 'center', justifyContent: 'center', color: '#6b7280',
    }}
      onMouseEnter={e => (e.currentTarget.style.background = '#f3f4f6')}
      onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
    >
      <Icon size={16} />
    </button>
  );
}

// ─── Empty state ──────────────────────────────────────────────────────
function EmptyState() {
  return (
    <div style={{
      display: 'flex', alignItems: 'flex-start', gap: 12,
      border: '1px solid #bfdbfe', borderRadius: 8,
      background: '#eff6ff', padding: '14px 16px',
    }}>
      <Info size={18} style={{ color: '#3b82f6', flexShrink: 0, marginTop: 1 }} />
      <div>
        <p style={{ margin: 0, fontSize: 13, fontWeight: 600, color: '#1e3a5f' }}>
          Your selection doesn't have any info.
        </p>
        <p style={{ margin: '3px 0 0', fontSize: 13, color: '#3b6fd4' }}>
          Change your selection or start a new search.
        </p>
      </div>
    </div>
  );
}

// ─── Skeleton ────────────────────────────────────────────────────────
function ReportSkeleton() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, padding: '16px 0' }}>
        <Skeleton className="h-5 w-52" />
        <Skeleton className="h-4 w-32" />
        <Skeleton className="h-3 w-40" />
      </div>
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} style={{ display: 'flex', gap: 12 }}>
          <Skeleton className="h-4 w-1/4" />
          <Skeleton className="h-4 w-1/3" />
          <Skeleton className="h-4 flex-1" />
          <Skeleton className="h-4 w-20" />
          <Skeleton className="h-4 w-20" />
        </div>
      ))}
    </div>
  );
}

// ─── Viewport ────────────────────────────────────────────────────────
interface ReportViewportProps {
  companyName: string;
  activeTab:   ReportType;
  from:        string;
  to:          string;
  isLoading:   boolean;
  hasData:     boolean;
  children:    React.ReactNode;
  onRefresh:   () => void;
}

export function ReportViewport({
  companyName, activeTab, from, to, isLoading, hasData, children, onRefresh,
}: ReportViewportProps) {
  const [density, setDensity] = React.useState<ReportDensity>('Compact');
  const reportLabel = REPORT_TABS.find(t => t.id === activeTab)?.label ?? '';
  const dateRange   = formatDateRange(from, to);
  const timestamp   = new Date().toLocaleString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
    hour: 'numeric', minute: '2-digit',
  });

  const rowPadding = density === 'Compact' ? '3px 0' : density === 'Comfortable' ? '6px 0' : '10px 0';
  const fontSize   = density === 'Compact' ? 12     : density === 'Comfortable' ? 13      : 14;

  return (
    <div style={{ maxWidth: 896, margin: '0 auto' }}>
      <div style={{
        background: '#fff', border: '1px solid #e5e7eb',
        borderRadius: 10, overflow: 'hidden', boxShadow: '0 1px 4px rgba(0,0,0,0.06)',
      }}>

        {/* ── Card toolbar ── */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '8px 14px', borderBottom: '1px solid #f0f0f0',
        }}>
          {/* Density selector */}
          <Select value={density} onValueChange={v => setDensity(v as ReportDensity)}>
            <SelectTrigger style={{ height: 30, width: 128, fontSize: 12, border: 'none', boxShadow: 'none', padding: '0 6px' }}>
              <SelectValue>{density}</SelectValue>
            </SelectTrigger>
            <SelectContent align="start">
              {(['Compact', 'Comfortable', 'Spacious'] as ReportDensity[]).map(d => (
                <SelectItem key={d} value={d} style={{ fontSize: 12 }}>{d}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          {/* Action buttons */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
            <IBtn icon={RefreshCw}    title="Refresh"      onClick={onRefresh} />
            <IBtn icon={Mail}         title="Email report" />
            <IBtn icon={Printer}      title="Print"        onClick={() => window.print()} />
            <IBtn icon={Download}     title="Export" />
            <IBtn icon={MoreVertical} title="More options" />
            <button style={{
              display: 'flex', alignItems: 'center', gap: 5,
              height: 30, padding: '0 12px', marginLeft: 4,
              background: '#2CA01C', color: '#fff', border: 'none',
              borderRadius: 6, fontSize: 12, fontWeight: 600, cursor: 'pointer',
            }}>
              <Sparkles size={13} />
              Insights
            </button>
          </div>
        </div>

        {/* ── Report header ── */}
        <div style={{ padding: '20px 0 16px', textAlign: 'center', borderBottom: '1px solid #f0f0f0' }}>
          <p style={{ margin: 0, fontSize: 18, fontWeight: 700, color: '#111827' }}>{companyName}</p>
          <p style={{ margin: '3px 0 0', fontSize: 14, color: '#374151' }}>{reportLabel}</p>
          {dateRange && (
            <p style={{ margin: '2px 0 0', fontSize: 12, color: '#6b7280' }}>{dateRange}</p>
          )}
        </div>

        {/* ── Body ── */}
        <div style={{ padding: '20px 24px', fontSize, lineHeight: 1.5 }}>
          {isLoading ? <ReportSkeleton /> : hasData ? children : <EmptyState />}
        </div>

        {/* ── Footer ── */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '10px 20px', borderTop: '1px solid #f0f0f0',
        }}>
          <button style={{
            display: 'flex', alignItems: 'center', gap: 5,
            background: 'none', border: 'none', cursor: 'pointer',
            color: '#2CA01C', fontSize: 12, fontWeight: 500,
          }}>
            <FileText size={13} />
            Add note
          </button>
          <span style={{ fontSize: 12, color: '#9ca3af' }}>
            Accrual basis | {timestamp}
          </span>
        </div>
      </div>
    </div>
  );
}



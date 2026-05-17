import React, { useState, useEffect } from 'react';
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '../../../firebase';
import { useReportFilters } from '../../../hooks/useReportFilters';
import { FilterToolbar } from '../../../components/reports/FilterToolbar';
import { ReportViewport, REPORT_TABS } from '../../../components/reports/ReportViewport';
import { CustomisePanel } from '../../../components/reports/CustomisePanel';
import { cn } from '../../../lib/utils';
import type { ReportType } from '../../../types/reports';
import '../../../reports.css';

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 30_000, retry: 1 } },
});

function ReportBuilderInner() {
  const { filters, setPeriod, setFrom, setTo, setMethod, setColumns, setCompareTo, isCustomised } =
    useReportFilters();

  const [activeReport, setActiveReport]   = useState<ReportType>('general_ledger');
  const [customiseOpen, setCustomiseOpen] = useState(false);
  const [companyName, setCompanyName]     = useState('Your Company');

  useEffect(() => {
    getDoc(doc(db, 'settings', 'profile'))
      .then(snap => {
        if (snap.exists() && snap.data().companyName)
          setCompanyName(snap.data().companyName);
      })
      .catch(() => {});
  }, []);

  const { data = [], isLoading, refetch } = useQuery({
    queryKey: ['report', activeReport, filters],
    queryFn:  async () => [],
  });

  return (
    // reports-root scopes Tailwind CSS variables and font; height 100% fills sb-main
    <div
      className="reports-root"
      style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}
    >
      {/* ── Sticky top: page title + report type tabs ───────── */}
      <div style={{ flexShrink: 0, background: '#fff', borderBottom: '1px solid #e2e8f0' }}>
        <div style={{ padding: '14px 20px 0', display: 'flex', alignItems: 'baseline', gap: 8 }}>
          <h1 className="text-[17px] font-semibold text-foreground">Reports</h1>
          <span className="text-sm text-muted-foreground">/ {REPORT_TABS.find(t => t.id === activeReport)?.label}</span>
        </div>

        {/* Tab row */}
        <div style={{ display: 'flex', overflowX: 'auto', padding: '4px 20px 0', gap: 0 }}>
          {REPORT_TABS.map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveReport(tab.id)}
              className={cn(
                'px-4 py-2.5 text-sm font-medium whitespace-nowrap border-b-2 transition-colors',
                activeReport === tab.id
                  ? 'text-[#2CA01C] border-[#2CA01C]'
                  : 'text-muted-foreground border-transparent hover:text-foreground hover:border-slate-200',
              )}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* ── Filter toolbar ──────────────────────────────────── */}
      <FilterToolbar
        filters={filters}
        onPeriodChange={setPeriod}
        onFromChange={setFrom}
        onToChange={setTo}
        onMethodChange={setMethod}
        onColumnsChange={setColumns}
        onCompareChange={setCompareTo}
        isCustomised={isCustomised}
        onCustomise={() => setCustomiseOpen(true)}
      />

      {/* ── Scrollable report area ───────────────────────────── */}
      <div style={{ flex: 1, overflowY: 'auto', background: '#f8fafc', padding: '24px' }}>
        <ReportViewport
          companyName={companyName}
          activeTab={activeReport}
          from={filters.from}
          to={filters.to}
          isLoading={isLoading}
          hasData={data.length > 0}
          onRefresh={() => refetch()}
        >
          {null}
        </ReportViewport>
      </div>

      {/* ── Customise slide-over ─────────────────────────────── */}
      <CustomisePanel open={customiseOpen} onClose={() => setCustomiseOpen(false)} />
    </div>
  );
}

export default function ReportBuilderPage() {
  return (
    <QueryClientProvider client={queryClient}>
      <ReportBuilderInner />
    </QueryClientProvider>
  );
}

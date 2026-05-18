import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '../../../firebase';
import { useReportFilters } from '../../../hooks/useReportFilters';
import { FilterToolbar } from '../../../components/reports/FilterToolbar';
import { ReportViewport, REPORT_TABS } from '../../../components/reports/ReportViewport';
import { CustomisePanel } from '../../../components/reports/CustomisePanel';
import type { ReportType } from '../../../types/reports';
import '../../../reports.css';

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 30_000, retry: 1 } },
});

function ReportBuilderInner() {
  const { type }  = useParams<{ type: string }>();
  const navigate  = useNavigate();

  const { filters, setPeriod, setFrom, setTo, setMethod, setColumns, setCompareTo, isCustomised } =
    useReportFilters();

  const activeReport = (REPORT_TABS.some(t => t.id === type) ? type : 'general_ledger') as ReportType;
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
      {/* ── Sticky top: breadcrumb only (no tab strip) ──────── */}
      <div style={{ flexShrink: 0, background: '#fff', borderBottom: '1px solid #e2e8f0', padding: '14px 20px' }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
          <button
            onClick={() => navigate('/scalebooks/reports')}
            style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, fontSize: 17, fontWeight: 600, color: '#F97316' }}
            onMouseEnter={e => (e.currentTarget.style.textDecoration = 'underline')}
            onMouseLeave={e => (e.currentTarget.style.textDecoration = 'none')}
          >
            Reports
          </button>
          <span style={{ fontSize: 14, color: '#6b7280' }}>/ {REPORT_TABS.find(t => t.id === activeReport)?.label}</span>
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

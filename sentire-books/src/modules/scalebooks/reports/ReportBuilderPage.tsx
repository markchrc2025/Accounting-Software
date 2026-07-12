import React, { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import {
  getTrialBalance, getGeneralLedger, getIncomeStatement, getBalanceSheet,
} from '../../../lib/api.js';
import { useAuth } from '../../../auth/AuthProvider.jsx';
import { useReportFilters } from '../../../hooks/useReportFilters';
import { FilterToolbar } from '../../../components/reports/FilterToolbar';
import { ReportViewport, REPORT_TABS } from '../../../components/reports/ReportViewport';
import { CustomisePanel } from '../../../components/reports/CustomisePanel';
import type { ReportType } from '../../../types/reports';
import '../../../reports.css';

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 30_000, retry: 1 } },
});

const peso = (cents: number) =>
  new Intl.NumberFormat('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format((cents || 0) / 100);

/**
 * Fetch the active report from the API. Returns { rows, payload } — `rows`
 * drives the has-data check; `payload` carries the full report for rendering.
 * Aging + Payment Schedule wait on the billing/schedule domains (later phases).
 */
async function fetchReport(type: ReportType, from?: string, to?: string) {
  const p = { from, to };
  switch (type) {
    case 'trial_balance': {
      const r = await getTrialBalance(p);
      return { rows: r.rows, payload: r };
    }
    case 'general_ledger': {
      const r = await getGeneralLedger(p);
      return { rows: r.accounts, payload: r };
    }
    case 'income_statement': {
      const r = await getIncomeStatement(p);
      return { rows: [...r.income, ...r.expenses], payload: r };
    }
    case 'balance_sheet': {
      const r = await getBalanceSheet(to);
      return { rows: [...r.assets, ...r.liabilities, ...r.equity], payload: r };
    }
    default:
      return { rows: [], payload: null };
  }
}

// ── Table primitives (scoped to the report canvas) ───────────────────────────
const th: React.CSSProperties = { textAlign: 'left', padding: '8px 10px', fontSize: 11, fontWeight: 800, color: '#64748b', textTransform: 'uppercase', letterSpacing: '.05em', borderBottom: '1px solid #e2e8f0', background: '#f8fafc' };
const thR: React.CSSProperties = { ...th, textAlign: 'right' };
const td: React.CSSProperties = { padding: '7px 10px', fontSize: 13, borderBottom: '1px solid #f1f5f9', color: '#0f172a' };
const tdR: React.CSSProperties = { ...td, textAlign: 'right', fontVariantNumeric: 'tabular-nums' };
const totalRow: React.CSSProperties = { ...td, fontWeight: 800, borderTop: '2px solid #e2e8f0', background: '#f8fafc' };

function TrialBalanceTable({ r }: { r: any }) {
  return (
    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
      <thead><tr><th style={th}>Code</th><th style={th}>Account</th><th style={thR}>Debit</th><th style={thR}>Credit</th></tr></thead>
      <tbody>
        {r.rows.map((row: any) => (
          <tr key={row.accountCode + row.accountName}>
            <td style={{ ...td, fontFamily: 'monospace' }}>{row.accountCode}</td>
            <td style={td}>{row.accountName}</td>
            <td style={tdR}>{row.debitCents ? peso(row.debitCents) : '—'}</td>
            <td style={tdR}>{row.creditCents ? peso(row.creditCents) : '—'}</td>
          </tr>
        ))}
        <tr>
          <td style={totalRow} colSpan={2}>Total {r.balanced ? '✓ balanced' : '⚠ out of balance'}</td>
          <td style={{ ...totalRow, textAlign: 'right' }}>{peso(r.totals.debitCents)}</td>
          <td style={{ ...totalRow, textAlign: 'right' }}>{peso(r.totals.creditCents)}</td>
        </tr>
      </tbody>
    </table>
  );
}

function GeneralLedgerTable({ r }: { r: any }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 22 }}>
      {r.accounts.map((a: any) => (
        <div key={a.accountId}>
          <div style={{ fontSize: 13, fontWeight: 800, color: '#0f172a', marginBottom: 4 }}>
            <span style={{ fontFamily: 'monospace', color: '#f97316' }}>{a.accountCode}</span> · {a.accountName}
          </div>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr><th style={th}>Date</th><th style={th}>Entry</th><th style={th}>Description</th><th style={thR}>Debit</th><th style={thR}>Credit</th><th style={thR}>Balance</th></tr></thead>
            <tbody>
              <tr><td style={{ ...td, color: '#64748b' }} colSpan={5}>Opening balance</td><td style={tdR}>{peso(a.openingCents)}</td></tr>
              {a.lines.map((l: any, i: number) => (
                <tr key={i}>
                  <td style={td}>{l.date}</td>
                  <td style={{ ...td, fontFamily: 'monospace', fontSize: 12 }}>{l.entryNo}</td>
                  <td style={{ ...td, color: '#64748b' }}>{l.description || '—'}</td>
                  <td style={tdR}>{l.debitCents ? peso(l.debitCents) : '—'}</td>
                  <td style={tdR}>{l.creditCents ? peso(l.creditCents) : '—'}</td>
                  <td style={tdR}>{peso(l.balanceCents)}</td>
                </tr>
              ))}
              <tr>
                <td style={totalRow} colSpan={3}>Closing</td>
                <td style={{ ...totalRow, textAlign: 'right' }}>{peso(a.totalDebitCents)}</td>
                <td style={{ ...totalRow, textAlign: 'right' }}>{peso(a.totalCreditCents)}</td>
                <td style={{ ...totalRow, textAlign: 'right' }}>{peso(a.closingCents)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      ))}
    </div>
  );
}

function Section({ title, rows, totalLabel, totalCents }: { title: string; rows: any[]; totalLabel: string; totalCents: number }) {
  return (
    <>
      <tr><td style={{ ...td, fontWeight: 800, background: '#f8fafc', textTransform: 'uppercase', fontSize: 11, letterSpacing: '.05em', color: '#64748b' }} colSpan={2}>{title}</td></tr>
      {rows.map((row: any, i: number) => (
        <tr key={i}>
          <td style={{ ...td, paddingLeft: 24 }}>{row.accountCode ? `(${row.accountCode}) ` : ''}{row.accountName}</td>
          <td style={tdR}>{peso(row.amountCents)}</td>
        </tr>
      ))}
      <tr><td style={totalRow}>{totalLabel}</td><td style={{ ...totalRow, textAlign: 'right' }}>{peso(totalCents)}</td></tr>
    </>
  );
}

function IncomeStatementTable({ r }: { r: any }) {
  return (
    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
      <tbody>
        <Section title="Income" rows={r.income} totalLabel="Total Income" totalCents={r.totals.incomeCents} />
        <Section title="Expenses" rows={r.expenses} totalLabel="Total Expenses" totalCents={r.totals.expenseCents} />
        <tr>
          <td style={{ ...totalRow, fontSize: 14 }}>Net Profit</td>
          <td style={{ ...totalRow, textAlign: 'right', fontSize: 14, color: r.totals.netProfitCents >= 0 ? '#15803d' : '#dc2626' }}>{peso(r.totals.netProfitCents)}</td>
        </tr>
      </tbody>
    </table>
  );
}

function BalanceSheetTable({ r }: { r: any }) {
  return (
    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
      <tbody>
        <Section title="Assets" rows={r.assets} totalLabel="Total Assets" totalCents={r.totals.assetsCents} />
        <Section title="Liabilities" rows={r.liabilities} totalLabel="Total Liabilities" totalCents={r.totals.liabilitiesCents} />
        <Section title="Equity" rows={r.equity} totalLabel="Total Equity" totalCents={r.totals.equityCents} />
        <tr>
          <td style={{ ...totalRow, fontSize: 13 }}>Liabilities + Equity {r.totals.balanced ? '✓' : '⚠ (≠ Assets)'}</td>
          <td style={{ ...totalRow, textAlign: 'right', fontSize: 13 }}>{peso(r.totals.liabilitiesCents + r.totals.equityCents)}</td>
        </tr>
      </tbody>
    </table>
  );
}

function renderReport(type: ReportType, payload: any) {
  if (!payload) return null;
  switch (type) {
    case 'trial_balance':    return <TrialBalanceTable r={payload} />;
    case 'general_ledger':   return <GeneralLedgerTable r={payload} />;
    case 'income_statement': return <IncomeStatementTable r={payload} />;
    case 'balance_sheet':    return <BalanceSheetTable r={payload} />;
    default:                 return null;
  }
}

function ReportBuilderInner() {
  const { type }  = useParams<{ type: string }>();
  const navigate  = useNavigate();
  const { org }   = useAuth();

  const { filters, setPeriod, setFrom, setTo, setMethod, setColumns, setCompareTo, isCustomised } =
    useReportFilters();

  const activeReport = (REPORT_TABS.some(t => t.id === type) ? type : 'general_ledger') as ReportType;
  const [customiseOpen, setCustomiseOpen] = useState(false);
  const companyName = org?.name || 'Your Company';

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['report', activeReport, filters.from, filters.to],
    queryFn:  () => fetchReport(activeReport, filters.from, filters.to),
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
            onClick={() => navigate('/reports')}
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
          hasData={(data?.rows?.length ?? 0) > 0}
          onRefresh={() => refetch()}
        >
          {renderReport(activeReport, data?.payload)}
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

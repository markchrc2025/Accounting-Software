import { useState, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import type { ReportFilters, ReportPeriodPreset, AccountingMethod, DisplayColumnsBy, CompareTo } from '../types/reports';
import { computePeriodDates } from '../lib/periodUtils';

const DEFAULT_PERIOD: ReportPeriodPreset = 'this_year_to_date';

function getDefaultDates() {
  const d = computePeriodDates(DEFAULT_PERIOD);
  return d ?? { from: '', to: '' };
}

export function useReportFilters() {
  const [searchParams, setSearchParams] = useSearchParams();

  // Read from URL params with fallbacks
  const defaults = getDefaultDates();
  const period   = (searchParams.get('period')  as ReportPeriodPreset) ?? DEFAULT_PERIOD;
  const from     = searchParams.get('from')     ?? defaults.from;
  const to       = searchParams.get('to')       ?? defaults.to;
  const method   = (searchParams.get('method') as AccountingMethod) ?? 'Accrual';
  const columns  = (searchParams.get('columns') as DisplayColumnsBy) ?? 'Total only';
  const compareTo = (searchParams.get('compareTo') as CompareTo) ?? '';

  const filters: ReportFilters = { period, from, to, method, columns, compareTo };

  function update(patch: Partial<ReportFilters>) {
    setSearchParams(prev => {
      const next = new URLSearchParams(prev);
      Object.entries(patch).forEach(([k, v]) => {
        if (v !== undefined && v !== null) next.set(k, String(v));
      });
      return next;
    }, { replace: true });
  }

  const setPeriod = useCallback((p: ReportPeriodPreset) => {
    const dates = computePeriodDates(p);
    if (dates) update({ period: p, from: dates.from, to: dates.to });
    else       update({ period: 'custom' });
  }, []);

  const setFrom = useCallback((f: string) => {
    update({ from: f, period: 'custom' });
  }, []);

  const setTo = useCallback((t: string) => {
    update({ to: t, period: 'custom' });
  }, []);

  const setMethod  = useCallback((m: AccountingMethod)   => update({ method: m }),    []);
  const setColumns = useCallback((c: DisplayColumnsBy)   => update({ columns: c }),   []);
  const setCompareTo = useCallback((c: CompareTo)        => update({ compareTo: c }), []);

  const isCustomised =
    period  !== DEFAULT_PERIOD ||
    method  !== 'Accrual'      ||
    columns !== 'Total only'   ||
    compareTo !== '';

  return {
    filters,
    setPeriod,
    setFrom,
    setTo,
    setMethod,
    setColumns,
    setCompareTo,
    isCustomised,
  };
}

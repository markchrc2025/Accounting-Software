import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, ArrowRight } from 'lucide-react';

// ─── Searchable route list ────────────────────────────────────────────────────
const ROUTES = [
  { label: 'Dashboard',           path: '/scalebooks',              group: 'Pages' },
  { label: 'Vouchers',            path: '/scalebooks/vouchers',     group: 'Pages' },
  { label: 'Approvals',           path: '/scalebooks/approvals',    group: 'Pages' },
  { label: 'Weekly Projections',  path: '/scalebooks/projections',  group: 'Pages' },
  { label: 'Payment Schedule',    path: '/scalebooks/pay-schedule', group: 'Pages' },
  { label: 'Disbursements',       path: '/scalebooks/disbursements',group: 'Pages' },
  { label: 'Check Registry',      path: '/scalebooks/checks',       group: 'Pages' },
  { label: 'Journal',             path: '/scalebooks/journal',      group: 'Pages' },
  { label: 'Bank',                path: '/scalebooks/bank',         group: 'Pages' },
  { label: 'Chart of Accounts',   path: '/scalebooks/coa',          group: 'Pages' },
  { label: 'Tax',                 path: '/scalebooks/tax',          group: 'Pages' },
  { label: 'Financial Management',path: '/scalebooks/financial',    group: 'Pages' },
  { label: 'Fixed Assets',        path: '/scalebooks/assets',       group: 'Pages' },
  { label: 'Billing Book',        path: '/scalebooks/billing',      group: 'Pages' },
  { label: 'Service Invoices',    path: '/scalebooks/invoices',     group: 'Pages' },
  { label: 'Collections',         path: '/scalebooks/collections',  group: 'Pages' },
  { label: 'Reports',             path: '/scalebooks/reports',      group: 'Pages' },
  { label: 'Contacts',            path: '/scalebooks/contacts',     group: 'Pages' },
  { label: 'Settings',            path: '/scalebooks/settings',     group: 'Pages' },
];

// ─── Command palette ──────────────────────────────────────────────────────────
export function CommandPalette({ open, onClose }) {
  const navigate     = useNavigate();
  const [query, setQuery] = useState('');
  const [cursor, setCursor] = useState(0);
  const inputRef = useRef(null);

  // Focus input when opened
  useEffect(() => {
    if (open) {
      setQuery('');
      setCursor(0);
      setTimeout(() => inputRef.current?.focus(), 30);
    }
  }, [open]);

  // Cmd+K / Ctrl+K global shortcut
  useEffect(() => {
    function handler(e) {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        open ? onClose() : null; // parent controls open state
      }
      if (e.key === 'Escape' && open) onClose();
    }
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [open, onClose]);

  if (!open) return null;

  const results = ROUTES.filter(r =>
    r.label.toLowerCase().includes(query.toLowerCase())
  );

  function go(path) {
    navigate(path);
    onClose();
  }

  function handleKeyDown(e) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setCursor(c => Math.min(c + 1, results.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setCursor(c => Math.max(c - 1, 0));
    } else if (e.key === 'Enter' && results[cursor]) {
      go(results[cursor].path);
    }
  }

  return (
    /* Backdrop */
    <div
      className="fixed inset-0 bg-black/30 z-50 flex items-start justify-center pt-[15vh]"
      onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="w-full max-w-xl bg-white rounded-xl shadow-md border border-[#E5E7EB] overflow-hidden">

        {/* Search input */}
        <div className="flex items-center gap-2 px-4 py-3 border-b border-[#F3F4F6]">
          <Search size={16} className="text-[#9CA3AF] flex-shrink-0" />
          <input
            ref={inputRef}
            value={query}
            onChange={e => { setQuery(e.target.value); setCursor(0); }}
            onKeyDown={handleKeyDown}
            placeholder="Navigate. Find vouchers, customers, help, reports, and more."
            className="flex-1 text-sm text-[#1F2937] placeholder:text-[#9CA3AF] outline-none bg-transparent"
          />
          <kbd className="text-[11px] text-[#9CA3AF] border border-[#E5E7EB] rounded px-1.5 py-0.5 bg-[#F9FAFB]">
            Esc
          </kbd>
        </div>

        {/* Results */}
        <div className="max-h-80 overflow-y-auto py-2">
          {results.length === 0 ? (
            <p className="text-sm text-[#9CA3AF] text-center py-6">No results for "{query}"</p>
          ) : (
            results.map((r, i) => (
              <button
                key={r.path}
                onClick={() => go(r.path)}
                onMouseEnter={() => setCursor(i)}
                className={`w-full flex items-center gap-3 px-4 py-2.5 text-sm transition-colors ${
                  i === cursor ? 'bg-[#FFF7ED] text-[#F97316]' : 'text-[#1F2937] hover:bg-[#F9FAFB]'
                }`}
              >
                <ArrowRight size={14} className="flex-shrink-0 text-[#9CA3AF]" />
                <span className="flex-1 text-left">{r.label}</span>
                <span className="text-xs text-[#9CA3AF]">{r.group}</span>
              </button>
            ))
          )}
        </div>

        {/* Footer hint */}
        <div className="px-4 py-2 border-t border-[#F3F4F6] flex items-center gap-3 text-[11px] text-[#9CA3AF]">
          <span><kbd className="border border-[#E5E7EB] rounded px-1 bg-[#F9FAFB]">↑↓</kbd> navigate</span>
          <span><kbd className="border border-[#E5E7EB] rounded px-1 bg-[#F9FAFB]">↵</kbd> open</span>
          <span><kbd className="border border-[#E5E7EB] rounded px-1 bg-[#F9FAFB]">Esc</kbd> close</span>
        </div>
      </div>
    </div>
  );
}

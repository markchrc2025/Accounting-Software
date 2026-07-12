import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Star, MoreVertical, Search } from 'lucide-react';

// ─── Report catalogue ─────────────────────────────────────────────────────────
const REPORT_GROUPS = [
  {
    key: 'financial',
    label: 'Financial Statements',
    items: [
      { id: 'balance_sheet',    label: 'Balance Sheet',          description: 'Assets, liabilities, and equity at a point in time.' },
      { id: 'income_statement', label: 'Income Statement',        description: 'Revenue and expenses over a period.' },
      { id: 'trial_balance',    label: 'Trial Balance',           description: 'Debit and credit totals for all accounts.' },
      { id: 'general_ledger',   label: 'General Ledger',          description: 'All journal entries by account.' },
    ],
  },
  {
    key: 'ar',
    label: 'Accounts Receivable',
    items: [
      { id: 'aging_receivables', label: 'Aging of Receivables', description: 'Outstanding balances grouped by age.' },
    ],
  },
  {
    key: 'payables',
    label: 'Payables',
    items: [
      { id: 'payment_schedule', label: 'Payment Schedule Report', description: 'Upcoming and past scheduled payments.' },
    ],
  },
];

const ALL_REPORTS = REPORT_GROUPS.flatMap(g => g.items);
const FAVORITES_KEY = 'sb_report_favorites';

// ─── Landing page ─────────────────────────────────────────────────────────────
export default function ReportsLandingPage() {
  const navigate = useNavigate();

  const [search, setSearch]       = useState('');
  const [favorites, setFavorites] = useState<string[]>(() => {
    try { return JSON.parse(localStorage.getItem(FAVORITES_KEY) || '[]'); }
    catch { return []; }
  });
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  const toggleFav = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setFavorites(prev => {
      const next = prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id];
      localStorage.setItem(FAVORITES_KEY, JSON.stringify(next));
      return next;
    });
  };

  const openReport = (id: string) => navigate(`/reports/builder/${id}`);

  const searchLower   = search.trim().toLowerCase();
  const searchResults = searchLower ? ALL_REPORTS.filter(r => r.label.toLowerCase().includes(searchLower)) : null;
  const favoriteItems = ALL_REPORTS.filter(r => favorites.includes(r.id));

  const groups = [
    ...(favoriteItems.length > 0 ? [{ key: 'favorites', label: 'Favorites', items: favoriteItems }] : []),
    ...REPORT_GROUPS,
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden', background: '#f8fafc' }}>

      {/* ── Header ─────────────────────────────────────────────────────── */}
      <div style={{ flexShrink: 0, background: '#fff', borderBottom: '1px solid #e5e7eb', padding: '18px 28px 16px' }}>
        <h1 style={{ margin: '0 0 14px', fontSize: 18, fontWeight: 700, color: '#111827' }}>Reports</h1>

        {/* Search */}
        <div style={{ position: 'relative', maxWidth: 380 }}>
          <Search size={14} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: '#9ca3af', pointerEvents: 'none' }} />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Type report name here"
            style={{
              width: '100%', height: 36, paddingLeft: 32, paddingRight: 40,
              border: '1px solid #d1d5db', borderRadius: 6, fontSize: 13,
              color: '#111827', background: '#fff', outline: 'none',
              fontFamily: 'inherit',
            }}
            onFocus={e  => (e.target.style.borderColor = '#F97316')}
            onBlur={e   => (e.target.style.borderColor = '#d1d5db')}
          />
          {search && (
            <button
              onClick={() => setSearch('')}
              style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: '#9ca3af', lineHeight: 1, padding: 2 }}
            >
              ✕
            </button>
          )}
        </div>
      </div>

      {/* ── Body ───────────────────────────────────────────────────────── */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '24px 28px' }}>
        {searchResults ? (
          searchResults.length === 0 ? (
            <p style={{ color: '#6b7280', fontSize: 13, margin: 0 }}>No reports match &ldquo;{search}&rdquo;.</p>
          ) : (
            <ReportSection
              label={`Search results (${searchResults.length})`}
              items={searchResults}
              favorites={favorites}
              onToggleFav={toggleFav}
              onOpen={openReport}
              collapsed={false}
              onToggle={() => {}}
            />
          )
        ) : (
          groups.map(group => (
            <ReportSection
              key={group.key}
              label={group.label}
              items={group.items}
              favorites={favorites}
              onToggleFav={toggleFav}
              onOpen={openReport}
              collapsed={!!collapsed[group.key]}
              onToggle={() => setCollapsed(prev => ({ ...prev, [group.key]: !prev[group.key] }))}
            />
          ))
        )}
      </div>
    </div>
  );
}

// ─── Section ──────────────────────────────────────────────────────────────────
interface ReportSectionProps {
  label:        string;
  items:        { id: string; label: string; description?: string }[];
  favorites:    string[];
  onToggleFav:  (id: string, e: React.MouseEvent) => void;
  onOpen:       (id: string) => void;
  collapsed:    boolean;
  onToggle:     () => void;
}

function ReportSection({ label, items, favorites, onToggleFav, onOpen, collapsed, onToggle }: ReportSectionProps) {
  return (
    <div style={{ marginBottom: 28 }}>
      {/* Section header */}
      <button
        onClick={onToggle}
        style={{
          display: 'flex', alignItems: 'center', gap: 6, background: 'none', border: 'none',
          cursor: 'pointer', padding: '0 0 10px', width: '100%', textAlign: 'left',
        }}
      >
        <svg
          width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#6b7280" strokeWidth="2.5"
          style={{ transform: collapsed ? 'rotate(-90deg)' : 'rotate(0)', transition: 'transform .15s', flexShrink: 0 }}
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
        <span style={{ fontSize: 14, fontWeight: 700, color: '#111827' }}>{label}</span>
      </button>

      {/* Row list */}
      {!collapsed && (
        <div style={{ border: '1px solid #e5e7eb', borderRadius: 8, background: '#fff', overflow: 'hidden' }}>
          {items.map((item, i) => (
            <ReportRow
              key={item.id}
              id={item.id}
              label={item.label}
              description={item.description}
              starred={favorites.includes(item.id)}
              onToggleFav={onToggleFav}
              onOpen={onOpen}
              hasBorder={i < items.length - 1}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Row ──────────────────────────────────────────────────────────────────────
interface ReportRowProps {
  id:           string;
  label:        string;
  description?: string;
  starred:      boolean;
  onToggleFav:  (id: string, e: React.MouseEvent) => void;
  onOpen:       (id: string) => void;
  hasBorder:    boolean;
}

function ReportRow({ id, label, description, starred, onToggleFav, onOpen, hasBorder }: ReportRowProps) {
  const [hovered, setHovered] = React.useState(false);

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onOpen(id)}
      onKeyDown={e => e.key === 'Enter' && onOpen(id)}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: 'flex', alignItems: 'center', padding: '10px 16px', cursor: 'pointer',
        borderBottom: hasBorder ? '1px solid #f3f4f6' : 'none',
        background: hovered ? '#FFF7ED' : '#fff',
        transition: 'background .1s',
      }}
    >
      <div style={{ flex: 1, minWidth: 0 }}>
        <span style={{ fontSize: 13, color: '#111827', fontWeight: 500 }}>{label}</span>
        {description && (
          <p style={{ margin: '1px 0 0', fontSize: 11, color: '#9ca3af' }}>{description}</p>
        )}
      </div>

      {/* Star */}
      <button
        onClick={e => onToggleFav(id, e)}
        title={starred ? 'Remove from favourites' : 'Add to favourites'}
        style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '4px', lineHeight: 1, flexShrink: 0 }}
      >
        <Star
          size={15}
          fill={starred ? '#F97316' : 'none'}
          color={starred ? '#F97316' : '#d1d5db'}
        />
      </button>

      {/* More */}
      <button
        onClick={e => e.stopPropagation()}
        style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '4px', lineHeight: 1, flexShrink: 0, marginLeft: 2 }}
      >
        <MoreVertical size={15} color="#d1d5db" />
      </button>
    </div>
  );
}

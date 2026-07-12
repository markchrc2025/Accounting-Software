import { useState, useEffect, useRef, useMemo } from 'react';
import { createPortal } from 'react-dom';

/**
 * AccountCombobox — searchable combobox for COA account selection.
 *
 * Props:
 *   options       [{value, label}]                    legacy flat list
 *   rawAccounts   [{code,name,type,subType,parent}]   grouped/indented mode
 *   value         string                              selected account code
 *   onChange      fn(value)
 *   placeholder   string
 *   noneLabel     string
 *   style         object
 *   onNewAccount  fn()   callback for "＋ New Account" button (rawAccounts mode)
 */
export default function AccountCombobox({
  options = [],
  rawAccounts,
  value = '',
  onChange,
  placeholder = '— Select —',
  noneLabel = '(none)',
  style = {},
  onNewAccount,
}) {
  const [open, setOpen]               = useState(false);
  const [query, setQuery]             = useState('');
  const [highlighted, setHighlighted] = useState(0);
  const [dropRect, setDropRect]       = useState(null);

  const wrapRef  = useRef(null);
  const inputRef = useRef(null);
  const listRef  = useRef(null);

  // ── Grouped items built from rawAccounts ────────────────────
  const groupedItems = useMemo(() => {
    if (!rawAccounts) return null;
    const q = query.toLowerCase();
    const matched = rawAccounts.filter(a =>
      !q ||
      (a.code || '').toLowerCase().includes(q) ||
      (a.name || '').toLowerCase().includes(q) ||
      (a.subType || '').toLowerCase().includes(q)
    );

    const map = new Map();
    matched.forEach(a => {
      const key = a.subType || a.type || 'Other';
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(a);
    });

    const result = [];
    [...map.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .forEach(([subType, accs]) => {
        const parents  = accs.filter(a => !a.parent).sort((a, b) => (a.code || '').localeCompare(b.code || ''));
        const children = accs.filter(a => !!a.parent);
        const addedParents = new Set(parents.map(p => p.code || p.id));
        const items = [];
        parents.forEach(p => {
          items.push({ value: p.code || p.id, label: `[ ${p.code} ] ${p.name}`, isChild: false });
          children
            .filter(c => c.parent === (p.code || p.id))
            .sort((a, b) => (a.code || '').localeCompare(b.code || ''))
            .forEach(c => items.push({ value: c.code || c.id, label: `[ ${c.code} ] ${c.name}`, isChild: true }));
        });
        // orphaned children (parent filtered out by search)
        children
          .filter(c => !addedParents.has(c.parent))
          .sort((a, b) => (a.code || '').localeCompare(b.code || ''))
          .forEach(c => items.push({ value: c.code || c.id, label: `[ ${c.code} ] ${c.name}`, isChild: true }));

        if (items.length > 0) {
          result.push({ kind: 'group', label: subType });
          items.forEach(item => result.push({ kind: 'item', ...item }));
        }
      });
    return result;
  }, [rawAccounts, query]);

  const selectableCount = useMemo(() => {
    if (rawAccounts) return groupedItems ? groupedItems.filter(i => i.kind === 'item').length : 0;
    const q = query.toLowerCase();
    return q ? options.filter(o => o.label.toLowerCase().includes(q) || o.value.toLowerCase().includes(q)).length : options.length;
  }, [rawAccounts, groupedItems, options, query]);

  // ── Label shown when closed ──────────────────────────────────
  const selectedLabel = useMemo(() => {
    if (rawAccounts) {
      const a = rawAccounts.find(a => (a.code || a.id) === value);
      return a ? `[ ${a.code} ] ${a.name}` : value;
    }
    return options.find(o => o.value === value)?.label ?? value;
  }, [rawAccounts, options, value]);

  // ── Filtered list (legacy flat mode) ────────────────────────
  const filtered = useMemo(() => {
    if (rawAccounts) return [];
    if (!query) return options;
    const q = query.toLowerCase();
    return options.filter(o => o.label.toLowerCase().includes(q) || o.value.toLowerCase().includes(q));
  }, [rawAccounts, options, query]);

  // ── Handlers ─────────────────────────────────────────────────
  const open_  = () => { setQuery(''); setHighlighted(0); setOpen(true); };
  const close_ = () => { setOpen(false); setQuery(''); };
  const select = (val) => { onChange(val); close_(); };

  const handleInputChange = (e) => {
    setQuery(e.target.value);
    setHighlighted(0);
    if (!open) setOpen(true);
  };

  const handleKeyDown = (e) => {
    if (!open) {
      if (e.key === 'ArrowDown' || e.key === 'Enter') { e.preventDefault(); open_(); }
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlighted(h => Math.min(h + 1, selectableCount));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlighted(h => Math.max(h - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (highlighted === 0) { select(''); return; }
      if (rawAccounts && groupedItems) {
        const items = groupedItems.filter(i => i.kind === 'item');
        if (items[highlighted - 1]) select(items[highlighted - 1].value);
      } else {
        if (filtered[highlighted - 1]) select(filtered[highlighted - 1].value);
      }
    } else if (e.key === 'Escape') { close_(); }
    else if (e.key === 'Tab') { close_(); }
  };

  // Close on outside click (ignore clicks inside the portaled dropdown)
  useEffect(() => {
    const handler = (e) => {
      if (wrapRef.current && wrapRef.current.contains(e.target)) return;
      if (listRef.current && listRef.current.contains(e.target)) return;
      close_();
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  // Scroll highlighted item into view
  useEffect(() => {
    if (!open || !listRef.current) return;
    const items = listRef.current.querySelectorAll('[data-selectable]');
    const item = items[highlighted];
    if (item) item.scrollIntoView({ block: 'nearest' });
  }, [highlighted, open]);

  // Track wrapper rect so portal dropdown can position itself; update on scroll/resize
  useEffect(() => {
    if (!open) { setDropRect(null); return; }
    const update = () => {
      if (wrapRef.current) setDropRect(wrapRef.current.getBoundingClientRect());
    };
    update();
    window.addEventListener('scroll', update, true);
    window.addEventListener('resize', update);
    return () => {
      window.removeEventListener('scroll', update, true);
      window.removeEventListener('resize', update);
    };
  }, [open]);

  // ── Styles ───────────────────────────────────────────────────
  const wrapS = { position: 'relative', ...style };

  const boxS = {
    display: 'flex', alignItems: 'center',
    border: `1px solid ${open ? '#f97316' : '#e5e7eb'}`,
    borderRadius: 10, background: '#fff',
    boxShadow: open ? '0 0 0 2px rgba(249,115,22,.15)' : 'none',
    overflow: 'hidden', transition: 'border-color .15s, box-shadow .15s',
    width: '100%', boxSizing: 'border-box',
  };

  const inputS = {
    flex: 1, border: 'none', outline: 'none', padding: '9px 10px',
    fontSize: 13, background: 'transparent', fontFamily: 'inherit', minWidth: 0, color: '#0b1220',
  };

  const chevronS = {
    padding: '0 8px', color: '#94a3b8', fontSize: 10, cursor: 'pointer',
    userSelect: 'none', display: 'flex', alignItems: 'center', flexShrink: 0,
    transform: open ? 'rotate(180deg)' : 'none', transition: 'transform .15s',
  };

  const dropS = dropRect ? {
    position: 'fixed',
    top: dropRect.bottom + 4,
    left: dropRect.left,
    width: dropRect.width,
    background: '#fff', border: '1px solid #e5e7eb', borderRadius: 10,
    boxShadow: '0 8px 24px rgba(0,0,0,.12)', zIndex: 10000,
    maxHeight: 280, overflowY: 'auto',
  } : { display: 'none' };

  const itemS = (isActive, isSelected, isChild) => ({
    padding: isChild ? '7px 12px 7px 26px' : '7px 12px',
    fontSize: 13, cursor: 'pointer',
    background: isActive ? '#2563eb' : isSelected ? '#eff6ff' : 'transparent',
    color: isActive ? '#fff' : '#0b1220',
    fontWeight: isSelected ? 700 : 400,
    whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
  });

  // ── Render ───────────────────────────────────────────────────
  return (
    <div ref={wrapRef} style={wrapS}>
      <div style={boxS}>
        <input
          ref={inputRef}
          value={open ? query : selectedLabel}
          onChange={handleInputChange}
          onFocus={open_}
          onKeyDown={handleKeyDown}
          placeholder={open ? 'Search…' : placeholder}
          style={inputS}
          autoComplete="off"
          spellCheck={false}
        />
        <span style={chevronS} onMouseDown={e => { e.preventDefault(); if (open) close_(); else inputRef.current?.focus(); }}>▾</span>
      </div>

      {open && dropRect && createPortal((
        <div ref={listRef} style={dropS}>
          {/* none / clear option */}
          <div
            data-selectable
            onMouseDown={() => select('')}
            onMouseEnter={() => setHighlighted(0)}
            style={{ padding: '7px 12px', fontSize: 13, cursor: 'pointer', color: highlighted === 0 ? '#fff' : '#94a3b8', background: highlighted === 0 ? '#2563eb' : 'transparent' }}
          >{noneLabel}</div>

          {rawAccounts ? (
            // ── Grouped + indented mode ──
            (() => {
              if (!groupedItems || groupedItems.length === 0) {
                return <div style={{ padding: '8px 12px', fontSize: 12, color: '#94a3b8' }}>{query ? `No results for "${query}"` : 'No accounts.'}</div>;
              }
              let selIdx = 0;
              return groupedItems.map((item, i) => {
                if (item.kind === 'group') {
                  return (
                    <div key={'g' + i} style={{
                      padding: '5px 12px 4px', fontSize: 10, fontWeight: 800,
                      color: '#64748b', letterSpacing: '.07em', textTransform: 'uppercase',
                      background: '#f8fafc', borderTop: i > 0 ? '1px solid #e5e7eb' : 'none',
                      borderBottom: '1px solid #f1f5f9',
                    }}>{item.label}</div>
                  );
                }
                const idx = ++selIdx;
                const isActive = highlighted === idx;
                const isSelected = value === item.value;
                return (
                  <div
                    key={'i' + i}
                    data-selectable
                    onMouseDown={() => select(item.value)}
                    onMouseEnter={() => setHighlighted(idx)}
                    title={item.label}
                    style={itemS(isActive, isSelected, item.isChild)}
                  >
                    {item.isChild ? `• ${item.label}` : item.label}
                  </div>
                );
              });
            })()
          ) : (
            // ── Legacy flat mode ──
            filtered.length === 0 && query ? (
              <div style={{ padding: '8px 12px', fontSize: 12, color: '#94a3b8' }}>No results for "{query}"</div>
            ) : (
              filtered.map((o, idx) => (
                <div
                  key={o.value || idx}
                  data-selectable
                  onMouseDown={() => select(o.value)}
                  onMouseEnter={() => setHighlighted(idx + 1)}
                  title={o.label}
                  style={itemS(highlighted === idx + 1, value === o.value, false)}
                >{o.label}</div>
              ))
            )
          )}

          {/* New Account button */}
          {onNewAccount && (
            <div style={{ borderTop: '1px solid #f1f5f9', padding: '8px 12px', background: '#fff' }}>
              <button
                onMouseDown={e => { e.preventDefault(); e.stopPropagation(); close_(); onNewAccount(); }}
                style={{
                  background: 'none', border: 'none', cursor: 'pointer',
                  color: '#2563eb', fontWeight: 700, fontSize: 13,
                  display: 'flex', alignItems: 'center', gap: 4, padding: 0, fontFamily: 'inherit',
                }}
              >＋ New Account</button>
            </div>
          )}
        </div>
      ), document.body)}
    </div>
  );
}

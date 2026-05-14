import { useState, useEffect, useRef, useMemo } from 'react';

/**
 * AccountCombobox — a type-to-search combobox for account / bank dropdowns.
 *
 * Props:
 *   options     [{ value, label }]   list of selectable items
 *   value       string               currently stored value
 *   onChange    fn(value)            called with the new value string
 *   placeholder string               shown when nothing is selected
 *   noneLabel   string               label for the "(none)" option
 *   style       object               extra styles on the root wrapper
 */
export default function AccountCombobox({
  options = [],
  value = '',
  onChange,
  placeholder = '— Select —',
  noneLabel = '(none)',
  style = {},
}) {
  const [open, setOpen]             = useState(false);
  const [query, setQuery]           = useState('');
  const [highlighted, setHighlighted] = useState(0);

  const wrapRef  = useRef(null);
  const inputRef = useRef(null);
  const listRef  = useRef(null);

  // Label to display when closed
  const selectedLabel = useMemo(
    () => options.find(o => o.value === value)?.label ?? value,
    [options, value],
  );

  // Filtered list based on what the user has typed
  const filtered = useMemo(() => {
    if (!query) return options;
    const q = query.toLowerCase();
    return options.filter(
      o => o.label.toLowerCase().includes(q) || o.value.toLowerCase().includes(q),
    );
  }, [options, query]);

  // ── handlers ────────────────────────────────────────────────────────────
  const open_ = () => { setQuery(''); setHighlighted(0); setOpen(true); };
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
    const total = filtered.length; // 0 = none-option
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlighted(h => Math.min(h + 1, total));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlighted(h => Math.max(h - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (highlighted === 0) select('');
      else if (filtered[highlighted - 1]) select(filtered[highlighted - 1].value);
    } else if (e.key === 'Escape') {
      close_();
    } else if (e.key === 'Tab') {
      close_();
    }
  };

  // Close on outside click
  useEffect(() => {
    const handler = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) close_();
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  // Scroll highlighted item into view
  useEffect(() => {
    if (!open || !listRef.current) return;
    const item = listRef.current.children[highlighted];
    if (item) item.scrollIntoView({ block: 'nearest' });
  }, [highlighted, open]);

  // ── styles ───────────────────────────────────────────────────────────────
  const wrapS = {
    position: 'relative',
    ...style,
  };

  const boxS = {
    display: 'flex',
    alignItems: 'center',
    border: `1px solid ${open ? '#f97316' : '#e5e7eb'}`,
    borderRadius: 10,
    background: '#fff',
    boxShadow: open ? '0 0 0 2px rgba(249,115,22,.15)' : 'none',
    overflow: 'hidden',
    transition: 'border-color .15s, box-shadow .15s',
    width: '100%',
    boxSizing: 'border-box',
  };

  const inputS = {
    flex: 1,
    border: 'none',
    outline: 'none',
    padding: '9px 10px',
    fontSize: 13,
    background: 'transparent',
    fontFamily: 'inherit',
    minWidth: 0,
    color: '#0b1220',
  };

  const chevronS = {
    padding: '0 8px',
    color: '#94a3b8',
    fontSize: 10,
    cursor: 'pointer',
    userSelect: 'none',
    display: 'flex',
    alignItems: 'center',
    flexShrink: 0,
    transform: open ? 'rotate(180deg)' : 'none',
    transition: 'transform .15s',
  };

  const dropS = {
    position: 'absolute',
    top: 'calc(100% + 4px)',
    left: 0,
    right: 0,
    background: '#fff',
    border: '1px solid #e5e7eb',
    borderRadius: 10,
    boxShadow: '0 8px 24px rgba(0,0,0,.12)',
    zIndex: 9999,
    maxHeight: 220,
    overflowY: 'auto',
  };

  const optBase = (active, selected) => ({
    padding: '8px 12px',
    fontSize: 13,
    cursor: 'pointer',
    background: active ? '#fff7ed' : selected ? '#fef3c7' : 'transparent',
    fontWeight: selected ? 700 : 400,
    color: '#0b1220',
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  });

  // ── render ───────────────────────────────────────────────────────────────
  return (
    <div ref={wrapRef} style={wrapS}>
      <div style={boxS}>
        <input
          ref={inputRef}
          value={open ? query : selectedLabel}
          onChange={handleInputChange}
          onFocus={open_}
          onKeyDown={handleKeyDown}
          placeholder={open ? 'Type to search…' : placeholder}
          style={inputS}
          autoComplete="off"
          spellCheck={false}
        />
        <span
          style={chevronS}
          onMouseDown={e => {
            e.preventDefault();
            if (open) { close_(); } else { inputRef.current?.focus(); }
          }}
        >▾</span>
      </div>

      {open && (
        <div ref={listRef} style={dropS}>
          {/* none option */}
          <div
            onMouseDown={() => select('')}
            style={{ ...optBase(highlighted === 0, value === ''), color: '#94a3b8' }}
            onMouseEnter={() => setHighlighted(0)}
          >{noneLabel}</div>

          {filtered.length === 0 && query ? (
            <div style={{ padding: '8px 12px', fontSize: 12, color: '#94a3b8' }}>
              No results for "{query}"
            </div>
          ) : (
            filtered.map((o, idx) => (
              <div
                key={o.value || idx}
                onMouseDown={() => select(o.value)}
                style={optBase(highlighted === idx + 1, value === o.value)}
                onMouseEnter={() => setHighlighted(idx + 1)}
                title={o.label}
              >{o.label}</div>
            ))
          )}
        </div>
      )}
    </div>
  );
}

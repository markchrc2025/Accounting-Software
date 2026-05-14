import { useEffect, useMemo, useRef, useState } from 'react';
import { addDoc, collection, serverTimestamp } from 'firebase/firestore';
import { db, auth } from '../firebase.js';

/**
 * ContactPicker — type-to-search combobox for selecting a Contact, with
 * inline "+ Add new" that creates a stub contact in Firestore on the fly.
 *
 * Props:
 *   contacts       [{id, contactId?, name, types?, type?, needsCompletion?}]
 *   value          string  — contactId (preferred) or legacy name string
 *   displayName    string  — current text to display when value is just a name
 *   onChange       fn({contactId, contactName, contact, isNew})
 *   typeFilter     string|string[]  — filter list (e.g., 'Customer', ['Supplier','Employee'])
 *   defaultNewType string  — type assigned to a stub when user adds new (default 'Supplier')
 *   placeholder    string
 *   allowCreate    bool    (default true)
 *   compact        bool    — smaller padding for table rows
 *   style          object
 *   onStubCreated  fn(stub)  — optional callback after stub creation
 */
export default function ContactPicker({
  contacts = [],
  value = '',
  displayName = '',
  onChange,
  typeFilter = null,
  defaultNewType = 'Supplier',
  placeholder = 'Search or add contact…',
  allowCreate = true,
  compact = false,
  style = {},
  onStubCreated,
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [highlighted, setHighlighted] = useState(0);
  const [creating, setCreating] = useState(false);
  const wrapRef = useRef(null);
  const inputRef = useRef(null);

  const wantedTypes = useMemo(() => {
    if (!typeFilter) return null;
    return Array.isArray(typeFilter) ? typeFilter : [typeFilter];
  }, [typeFilter]);

  const matchesType = (c) => {
    if (!wantedTypes) return true;
    const t = Array.isArray(c.types) ? c.types : [c.type].filter(Boolean);
    if (t.length === 0) return true; // unknown — allow
    return t.some(x => wantedTypes.includes(x));
  };

  const selected = useMemo(
    () => contacts.find(c => c.id === value) ||
          contacts.find(c => (c.contactId || '') === value) ||
          (displayName ? contacts.find(c => (c.name || '').toLowerCase() === displayName.toLowerCase()) : null),
    [contacts, value, displayName]
  );

  const selectedLabel = selected?.name || displayName || '';

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    let list = contacts.filter(matchesType);
    if (q) {
      list = list.filter(c =>
        (c.name || '').toLowerCase().includes(q) ||
        (c.contactId || '').toLowerCase().includes(q) ||
        (c.tin || '').toLowerCase().includes(q) ||
        (c.email || '').toLowerCase().includes(q)
      );
    }
    return list.slice(0, 50);
  }, [contacts, query, wantedTypes]);

  const exactMatch = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return null;
    return contacts.find(c => (c.name || '').toLowerCase() === q);
  }, [contacts, query]);

  const showCreate = allowCreate && query.trim().length > 1 && !exactMatch && !creating;

  const choose = (c) => {
    onChange?.({
      contactId: c.id,
      contactName: c.name,
      contact: c,
      isNew: false,
    });
    setOpen(false);
    setQuery('');
  };

  const clearSelection = () => {
    onChange?.({ contactId: '', contactName: '', contact: null, isNew: false });
    setQuery('');
    setOpen(false);
  };

  const createStub = async () => {
    const name = query.trim();
    if (!name) return;
    setCreating(true);
    try {
      const email = auth.currentUser?.email || '';
      const types = wantedTypes && wantedTypes.length === 1
        ? [wantedTypes[0]]
        : [defaultNewType];
      const payload = {
        name,
        types,
        type: types[0],          // legacy single-type compatibility
        status: 'Active',
        needsCompletion: true,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        createdBy: email,
        updatedBy: email,
      };
      const ref = await addDoc(collection(db, 'contacts'), payload);
      const stub = { id: ref.id, ...payload };
      onChange?.({
        contactId: ref.id,
        contactName: name,
        contact: stub,
        isNew: true,
      });
      onStubCreated?.(stub);
      setOpen(false);
      setQuery('');
    } catch (e) {
      console.error('ContactPicker: stub create failed', e);
      alert('Could not create contact: ' + e.message);
    }
    setCreating(false);
  };

  const handleKey = (e) => {
    if (!open) {
      if (e.key === 'ArrowDown' || e.key === 'Enter') { e.preventDefault(); openIt(); }
      return;
    }
    const n = filtered.length + (showCreate ? 1 : 0);
    if (e.key === 'ArrowDown') { e.preventDefault(); setHighlighted(h => Math.min(h + 1, n - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setHighlighted(h => Math.max(h - 1, 0)); }
    else if (e.key === 'Enter') {
      e.preventDefault();
      if (highlighted < filtered.length) choose(filtered[highlighted]);
      else if (showCreate) createStub();
    }
    else if (e.key === 'Escape') { setOpen(false); setQuery(''); }
  };

  const openIt = () => { setQuery(''); setHighlighted(0); setOpen(true); setTimeout(() => inputRef.current?.focus(), 0); };

  useEffect(() => {
    const onDoc = (e) => { if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  // Styles
  const padY = compact ? 6 : 9;
  const fz = compact ? 12 : 13;
  const wrapS = { position: 'relative', width: '100%', ...style };
  const boxS = {
    display: 'flex', alignItems: 'center',
    border: `1px solid ${open ? '#f97316' : '#e5e7eb'}`,
    borderRadius: 10, background: '#fff',
    boxShadow: open ? '0 0 0 2px rgba(249,115,22,.15)' : 'none',
    transition: 'border-color .15s, box-shadow .15s',
    overflow: 'hidden', minWidth: 0,
  };
  const inputS = {
    flex: 1, border: 'none', outline: 'none',
    padding: `${padY}px 10px`, fontSize: fz,
    background: 'transparent', fontFamily: 'inherit', color: '#0b1220', minWidth: 0,
  };
  const dropS = {
    position: 'absolute', top: 'calc(100% + 4px)', left: 0, right: 0,
    background: '#fff', border: '1px solid #e5e7eb', borderRadius: 10,
    boxShadow: '0 8px 24px rgba(0,0,0,.12)', zIndex: 9999,
    maxHeight: 280, overflowY: 'auto', minWidth: 220,
  };
  const optS = (active, stub) => ({
    padding: '8px 12px', fontSize: 12, cursor: 'pointer',
    background: active ? '#fff7ed' : 'transparent',
    color: '#0b1220',
    borderBottom: '1px solid #f8fafc',
    display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8,
    fontStyle: stub ? 'italic' : 'normal',
  });

  return (
    <div ref={wrapRef} style={wrapS}>
      <div style={boxS}>
        {open ? (
          <input
            ref={inputRef}
            value={query}
            onChange={e => { setQuery(e.target.value); setHighlighted(0); }}
            onKeyDown={handleKey}
            placeholder={placeholder}
            style={inputS}
            autoComplete="off"
            spellCheck={false}
          />
        ) : (
          <div
            onClick={openIt}
            style={{ ...inputS, cursor: 'pointer', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', color: selectedLabel ? '#0b1220' : '#94a3b8' }}
            title={selectedLabel || placeholder}
          >
            {selectedLabel || placeholder}
            {selected?.needsCompletion && (
              <span style={{ marginLeft: 6, fontSize: 9, fontWeight: 800, color: '#c2410c', background: '#fff7ed', border: '1px solid #fed7aa', padding: '1px 5px', borderRadius: 4 }}>NEEDS DETAILS</span>
            )}
          </div>
        )}
        {selectedLabel && !open && (
          <span
            onClick={(e) => { e.stopPropagation(); clearSelection(); }}
            title="Clear"
            style={{ padding: '0 8px', color: '#94a3b8', fontSize: 13, cursor: 'pointer', userSelect: 'none' }}
          >×</span>
        )}
        <span
          onMouseDown={e => { e.preventDefault(); open ? setOpen(false) : openIt(); }}
          style={{ padding: '0 8px', color: '#94a3b8', fontSize: 10, cursor: 'pointer', userSelect: 'none', transform: open ? 'rotate(180deg)' : 'none', transition: 'transform .15s' }}
        >▾</span>
      </div>

      {open && (
        <div style={dropS}>
          {filtered.length === 0 && !showCreate && (
            <div style={{ padding: '12px', fontSize: 12, color: '#94a3b8' }}>
              {query ? 'No matches.' : 'Start typing to search…'}
            </div>
          )}
          {filtered.map((c, i) => (
            <div
              key={c.id}
              onMouseDown={() => choose(c)}
              onMouseEnter={() => setHighlighted(i)}
              style={optS(highlighted === i, c.needsCompletion)}
            >
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {c.contactId && <span style={{ fontFamily: 'monospace', color: '#94a3b8', marginRight: 6 }}>{c.contactId}</span>}
                <strong style={{ fontWeight: 700 }}>{c.name}</strong>
                {c.needsCompletion && <span style={{ marginLeft: 6, fontSize: 9, fontWeight: 800, color: '#c2410c' }}>•</span>}
              </span>
              <span style={{ fontSize: 10, color: '#94a3b8', flexShrink: 0 }}>
                {(Array.isArray(c.types) ? c.types.join('/') : c.type) || ''}
              </span>
            </div>
          ))}
          {showCreate && (
            <div
              onMouseDown={createStub}
              onMouseEnter={() => setHighlighted(filtered.length)}
              style={{
                padding: '10px 12px', fontSize: 12, cursor: 'pointer',
                background: highlighted === filtered.length ? '#fff7ed' : '#fffbeb',
                borderTop: '1px solid #fde68a',
                fontWeight: 700, color: '#c2410c',
              }}
            >
              ＋ Add “{query.trim()}” as new contact
              <div style={{ fontSize: 10, fontWeight: 500, color: '#92400e', marginTop: 2 }}>
                Will be saved as a stub — you can complete details later in Contacts.
              </div>
            </div>
          )}
          {creating && (
            <div style={{ padding: '10px 12px', fontSize: 12, color: '#64748b' }}>Creating contact…</div>
          )}
        </div>
      )}
    </div>
  );
}

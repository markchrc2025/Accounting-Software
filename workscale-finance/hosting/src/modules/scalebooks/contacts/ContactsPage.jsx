import { useState, useEffect, useMemo, useCallback } from 'react';
import {
  listContacts, createContact, updateContact, deleteContact as apiDeleteContact,
  listAccounts, ApiError, taxRatesApi, taxGroupsApi,
} from '../../../lib/api.js';
import AccountCombobox from '../../../components/AccountCombobox.jsx';

// ── Constants ─────────────────────────────────────────────
const CONTACT_TYPES = ['Customer','Supplier','Employee','Contractor','Government','Other'];
const STATUSES      = ['Active','Inactive'];
const PAYMENT_TERMS = ['Due on Receipt','Net 7','Net 15','Net 30','Net 45','Net 60','Net 90','EOM','15 MFI','Custom'];
const CURRENCIES    = ['PHP','USD','EUR','SGD','HKD','JPY','CNY','GBP','AUD'];
const CATEGORY_SUGGESTIONS = ['Deployed','In-house','Trading','Service','Logistics','Affiliate','Government','Other'];
const SALUTATIONS   = ['','Mr.','Ms.','Mrs.','Dr.','Atty.','Engr.','Hon.'];

const formatTin = v => {
  const d = v.replace(/\D/g, '').slice(0, 14);
  const main = d.slice(0, 9);
  const branch = d.slice(9);
  const parts = [];
  for (let i = 0; i < main.length; i += 3) parts.push(main.slice(i, i + 3));
  const result = parts.join('-');
  return branch.length ? result + '-' + branch : result;
};

const TYPE_PILL = {
  Supplier:   { background:'#fff7ed', borderColor:'#fed7aa', color:'#c2410c' },
  Customer:   { background:'#eff6ff', borderColor:'#bfdbfe', color:'#1d4ed8' },
  Employee:   { background:'#ecfdf5', borderColor:'#6ee7b7', color:'#065f46' },
  Contractor: { background:'#f5f3ff', borderColor:'#ddd6fe', color:'#5b21b6' },
  Government: { background:'#fef2f2', borderColor:'#fecaca', color:'#991b1b' },
  Other:      { background:'#f8fafc', borderColor:'#e2e8f0', color:'#64748b' },
};

// ── Helpers ───────────────────────────────────────────────
const asTypes = (c) => Array.isArray(c?.types) ? c.types : (c?.type ? [c.type] : []);
const isReceivableAcct = (a) => {
  const sub = (a.subType || '').toLowerCase();
  const nm  = (a.name || '').toLowerCase();
  return sub.includes('receivable') || nm.includes('receivable') || nm.includes('a/r') || nm.includes('ar -');
};
const isPayableAcct = (a) => {
  const sub = (a.subType || '').toLowerCase();
  const nm  = (a.name || '').toLowerCase();
  return sub.includes('payable') || nm.includes('payable') || nm.includes('a/p') || nm.includes('ap -');
};

const EMPTY_BANK    = () => ({ bankCode:'', branch:'', accountNumber:'', accountName:'', swift:'', isDefault:false });
const EMPTY_PERSON  = () => ({ salutation:'', firstName:'', lastName:'', email:'', workPhone:'', mobile:'', role:'' });

const EMPTY_MODAL = () => ({
  isNew:true, id:null,
  contactId:'', name:'', displayName:'',
  types:['Customer'], parentId:'', status:'Active',
  costCenter:'', category:'', branch:'', department:'',
  arAccountCode:'', apAccountCode:'',
  paymentTerms:'Due on Receipt', currency:'PHP', creditLimit:0, openingBalance:0, taxRateId:'',
  tin:'', email:'', phone:'', mobile:'', website:'',
  billingStreet:'', billingCity:'', billingZip:'', billingCountry:'Philippines',
  shippingStreet:'', shippingCity:'', shippingZip:'', shippingCountry:'Philippines',
  banks:[EMPTY_BANK()],
  contactPersons:[],
  notes:'', internalRemarks:'',
});

// ── API <-> UI mapping ────────────────────────────────────
// The API keeps a canonical enum (vendor|customer|employee) for vouchers and
// filters, and stores the portal's rich labels in `types` so they round-trip.
const ENUM_TO_LABEL = { vendor:'Supplier', customer:'Customer', employee:'Employee' };
const addr = (a) => a || { street:'', city:'', zip:'', country:'' };
const fromApi = (r) => ({
  id: r.id,
  contactId: r.contactNo || '',
  name: r.name || '',
  displayName: r.displayName || '',
  types: Array.isArray(r.types) && r.types.length ? r.types : (r.type ? [ENUM_TO_LABEL[r.type] || 'Other'] : []),
  parentId: r.parentId || '',
  status: r.isActive === false ? 'Inactive' : 'Active',
  costCenter: r.costCenter || '', category: r.category || '',
  branch: r.branch || '', department: r.department || '',
  arAccountCode: r.arAccountCode || '', apAccountCode: r.apAccountCode || '',
  paymentTerms: r.paymentTerms || 'Due on Receipt', currency: r.currency || 'PHP',
  creditLimit: (r.creditLimitCents ?? 0) / 100,
  openingBalance: (r.openingBalanceCents ?? 0) / 100,
  taxRateId: r.taxRef || '',
  tin: r.tin || '', email: r.email || '', phone: r.phone || '',
  mobile: r.mobile || '', website: r.website || '',
  billingStreet: addr(r.billingAddress).street || '', billingCity: addr(r.billingAddress).city || '',
  billingZip: addr(r.billingAddress).zip || '', billingCountry: addr(r.billingAddress).country || '',
  shippingStreet: addr(r.shippingAddress).street || '', shippingCity: addr(r.shippingAddress).city || '',
  shippingZip: addr(r.shippingAddress).zip || '', shippingCountry: addr(r.shippingAddress).country || '',
  banks: Array.isArray(r.banks) ? r.banks : [],
  contactPersons: Array.isArray(r.contactPersons) ? r.contactPersons : [],
  notes: r.notes || '', internalRemarks: r.internalRemarks || '',
  needsCompletion: !!r.needsCompletion,
});
const packAddr = (street, city, zip, country) =>
  (street || city || zip || country) ? { street, city, zip, country } : null;
const toApi = (m) => ({
  name: m.name.trim(),
  displayName: (m.displayName || m.name).trim(),
  types: m.types || [],
  parentId: m.parentId || null,
  isActive: (m.status || 'Active') === 'Active',
  costCenter: m.costCenter || '', category: m.category || '',
  branch: m.branch || '', department: m.department || '',
  arAccountCode: m.arAccountCode || '', apAccountCode: m.apAccountCode || '',
  paymentTerms: m.paymentTerms || '', currency: m.currency || '',
  creditLimitCents: Math.max(0, Math.round((Number(m.creditLimit) || 0) * 100)),
  openingBalanceCents: Math.round((Number(m.openingBalance) || 0) * 100),
  taxRef: m.taxRateId || null,
  tin: m.tin || '', email: m.email || '', phone: m.phone || '',
  mobile: m.mobile || '', website: m.website || '',
  billingAddress: packAddr(m.billingStreet||'', m.billingCity||'', m.billingZip||'', m.billingCountry||''),
  shippingAddress: packAddr(m.shippingStreet||'', m.shippingCity||'', m.shippingZip||'', m.shippingCountry||''),
  banks: (m.banks || []).filter(b => b.bankCode || b.accountNumber || b.accountName),
  contactPersons: (m.contactPersons || []).filter(p => p.firstName || p.lastName || p.email || p.mobile),
  notes: m.notes || '', internalRemarks: m.internalRemarks || '',
  needsCompletion: false,
});

// ── CSS ───────────────────────────────────────────────────
const CSS = `
  .ct-wrap { display:flex; flex-direction:column; height:100%; overflow:hidden; font-family:Inter,system-ui,sans-serif; background:#f8fafc; }
  .ct-top  { display:flex; align-items:center; justify-content:space-between; padding:16px 22px 12px; flex-shrink:0; border-bottom:1px solid #e5e7eb; background:#fff; }
  .ct-body { flex:1; overflow-y:auto; padding:16px 22px; }
  .toolbar { display:flex; gap:10px; align-items:center; flex-wrap:wrap; margin-bottom:14px; }
  .input   { border:1px solid #e5e7eb; border-radius:10px; padding:9px 12px; font-size:13px; background:#fff; font-family:inherit; }
  .btn     { border:0; border-radius:10px; padding:9px 16px; font-weight:700; cursor:pointer; font-size:13px; font-family:inherit; }
  .btn:disabled { opacity:.5; cursor:not-allowed; }
  .btn-primary { background:#f97316; color:#fff; }
  .btn-ghost   { background:#f1f5f9; color:#0b1220; }
  .btn-ghost:hover { background:#e2e8f0; }
  .btn-sm { padding:6px 12px; font-size:12px; }
  .btn-xs { padding:4px 8px; font-size:11px; border-radius:8px; }
  .card   { background:#fff; border:1px solid #e5e7eb; border-radius:14px; overflow:hidden; }
  table   { width:100%; border-collapse:collapse; }
  th,td   { padding:10px 12px; border-bottom:1px solid #f1f5f9; font-size:13px; text-align:left; vertical-align:middle; }
  th      { color:#64748b; font-weight:800; font-size:11px; letter-spacing:.05em; text-transform:uppercase; background:#f8fafc; }
  tr:hover td { background:#fafafa; }
  tr:last-child td { border-bottom:none; }
  .pill   { display:inline-block; padding:2px 9px; border-radius:999px; font-size:11px; font-weight:700; border:1px solid #e2e8f0; background:#f8fafc; color:#64748b; }
  .pill-warn { background:#fff7ed; border:1px solid #fed7aa; color:#c2410c; }
  .pill-ok   { background:#ecfdf5; border:1px solid #6ee7b7; color:#065f46; }
  .pill-mute { background:#f1f5f9; border:1px solid #e2e8f0; color:#64748b; }
  .badge-id  { font-family:monospace; font-size:11px; padding:2px 7px; border-radius:6px; background:#f1f5f9; color:#475569; font-weight:700; }
  .backdrop { position:fixed; inset:0; background:rgba(15,23,42,.45); display:flex; align-items:center; justify-content:center; padding:16px; z-index:100; }
  .modal  { width:min(820px,98vw); max-height:92vh; background:#fff; border-radius:16px; display:flex; flex-direction:column; overflow:hidden; box-shadow:0 24px 64px rgba(0,0,0,.25); }
  .modal-h { display:flex; align-items:center; justify-content:space-between; padding:14px 18px; border-bottom:1px solid #e5e7eb; background:#f8fafc; }
  .modal-h strong { font-size:14px; font-weight:900; }
  .modal-b { padding:18px; overflow-y:auto; flex:1; }
  .modal-f { display:flex; justify-content:space-between; gap:10px; padding:12px 18px; border-top:1px solid #e5e7eb; background:#fff; flex-shrink:0; }
  .tabs   { display:flex; gap:2px; border-bottom:1px solid #e5e7eb; margin-bottom:14px; flex-wrap:wrap; }
  .tab    { padding:8px 14px; font-size:12px; font-weight:700; color:#64748b; cursor:pointer; border-bottom:2px solid transparent; user-select:none; }
  .tab:hover { color:#0b1220; }
  .tab.active { color:#f97316; border-bottom-color:#f97316; }
  .grid2  { display:grid; grid-template-columns:1fr 1fr; gap:12px; }
  .grid3  { display:grid; grid-template-columns:repeat(3,1fr); gap:12px; }
  .col2   { grid-column:span 2; }
  .col3   { grid-column:span 3; }
  .field  { display:flex; flex-direction:column; gap:5px; }
  .field label { font-size:10px; font-weight:800; color:#64748b; letter-spacing:.06em; text-transform:uppercase; }
  .field input,.field select,.field textarea { border:1px solid #e5e7eb; border-radius:10px; padding:9px 10px; font-size:13px; font-family:inherit; width:100%; box-sizing:border-box; }
  .field textarea { resize:vertical; min-height:60px; }
  .chk-row { display:flex; flex-wrap:wrap; gap:6px; }
  .chk     { display:inline-flex; align-items:center; gap:6px; padding:5px 10px; border:1px solid #e5e7eb; border-radius:999px; font-size:12px; cursor:pointer; user-select:none; background:#fff; color:#64748b; font-weight:600; }
  .chk.on  { background:#fff7ed; border-color:#fed7aa; color:#c2410c; }
  .sub-tbl th,.sub-tbl td { padding:7px 8px; font-size:12px; border-bottom:1px solid #f1f5f9; }
  .sub-tbl input,.sub-tbl select { width:100%; border:1px solid #e5e7eb; border-radius:8px; padding:6px 8px; font-size:12px; font-family:inherit; }
  .empty  { padding:40px; text-align:center; color:#94a3b8; font-size:13px; }
  .toast  { position:fixed; right:16px; bottom:16px; background:#0b1220; color:#fff; padding:12px 18px; border-radius:12px; font-size:13px; font-weight:600; z-index:999; animation:fadeIn .2s; }
  .banner { background:#fff7ed; border:1px solid #fed7aa; color:#9a3412; padding:10px 14px; border-radius:10px; font-size:12px; margin-bottom:12px; display:flex; align-items:center; justify-content:space-between; gap:10px; }
  @keyframes fadeIn { from{opacity:0;transform:translateY(8px)} to{opacity:1;transform:none} }
`;

// ── Component ─────────────────────────────────────────────
export default function ContactsPage() {
  const [contacts, setContacts] = useState([]);
  const [accounts, setAccounts] = useState([]);
  const [taxRates, setTaxRates] = useState([]);
  const [taxGroups, setTaxGroups] = useState([]);
  const [search, setSearch] = useState('');
  const [filterType, setFilterType] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [filterIncomplete, setFilterIncomplete] = useState(false);
  const [modal, setModal] = useState(null);
  const [tab, setTab] = useState('general');
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState('');
  const [confirmModal, setConfirmModal] = useState(null);

  const showToast = (msg) => { setToast(msg); setTimeout(() => setToast(''), 3000); };
  const askConfirm = (message, onConfirm) => setConfirmModal({ message, onConfirm });

  // ── Data (API; refetched after every mutation) ───────────
  const loadContacts = useCallback(async () => {
    try {
      const rows = await listContacts();
      setContacts(rows.map(fromApi));
    } catch (e) {
      showToast(`Couldn't load contacts: ${e instanceof ApiError ? e.detail : e.message}`);
    }
  }, []);

  useEffect(() => {
    loadContacts();
    listAccounts()
      .then(rows => setAccounts(rows.map(a => ({ ...a, subType: a.subtype || '' }))))
      .catch(() => {});
    taxRatesApi.list().then(rs => setTaxRates(rs.map(r => ({ ...r, rate: Number(r.rate) })).filter(r => r.isActive !== false))).catch(()=>{});
    taxGroupsApi.list().then(gs => setTaxGroups(gs.filter(g => g.isActive !== false))).catch(()=>{});
  }, [loadContacts]);

  const arOptions = useMemo(() => accounts.filter(isReceivableAcct).map(a => ({ value:a.code, label:`(${a.code}) ${a.name}` })), [accounts]);
  const apOptions = useMemo(() => accounts.filter(isPayableAcct).map(a => ({ value:a.code, label:`(${a.code}) ${a.name}` })), [accounts]);

  const incompleteCount = useMemo(() => contacts.filter(c => c.needsCompletion).length, [contacts]);

  // ── Filtering ───────────────────────────────────────────
  const filtered = useMemo(() => {
    let a = [...contacts];
    const q = search.toLowerCase().trim();
    if (q) a = a.filter(x =>
      (x.name||'').toLowerCase().includes(q) ||
      (x.contactId||'').toLowerCase().includes(q) ||
      (x.email||'').toLowerCase().includes(q) ||
      (x.tin||'').toLowerCase().includes(q) ||
      (x.costCenter||'').toLowerCase().includes(q));
    if (filterType)   a = a.filter(x => asTypes(x).includes(filterType));
    if (filterStatus) a = a.filter(x => (x.status||'Active') === filterStatus);
    if (filterIncomplete) a = a.filter(x => x.needsCompletion);
    return a;
  }, [contacts, search, filterType, filterStatus, filterIncomplete]);

  // ── Save (contact number is assigned server-side on create) ──
  const save = async () => {
    if (!modal) return;
    if (!modal.name?.trim()) { showToast('Name is required.'); return; }
    if (!modal.types || modal.types.length === 0) { showToast('At least one Type is required.'); return; }
    if (modal.parentId && modal.parentId === modal.id) { showToast('A contact cannot be its own parent.'); return; }
    setSaving(true);
    try {
      const payload = toApi(modal);
      if (modal.isNew) await createContact(payload);
      else await updateContact(modal.id, payload);
      showToast('Contact saved.'); setModal(null);
      await loadContacts();
    } catch (e) {
      showToast(e instanceof ApiError ? e.detail : ('Error: ' + e.message));
    }
    setSaving(false);
  };

  const doDelete = (c) => {
    const childCount = contacts.filter(x => x.parentId === c.id).length;
    const msg = childCount > 0
      ? `Delete contact "${c.name}"? It has ${childCount} sub-contact(s) which will be detached.`
      : `Delete contact "${c.name}"?`;
    askConfirm(msg, async () => {
      try {
        await apiDeleteContact(c.id);
        showToast('Contact deleted.');
        await loadContacts();
      } catch (e) {
        // 409 contact_in_use → referenced by vouchers; suggest deactivating.
        showToast(e instanceof ApiError ? e.detail : ('Error: ' + e.message));
      }
    });
  };

  const openNew = () => {
    const m = EMPTY_MODAL();
    m.contactId = '';
    setModal(m); setTab('general');
  };
  const openEdit = (c) => {
    const m = { ...EMPTY_MODAL(), ...c, isNew:false, id:c.id };
    if (!Array.isArray(m.types)) m.types = c.type ? [c.type] : [];
    if (!m.banks || !m.banks.length) m.banks = [EMPTY_BANK()];
    if (!m.contactPersons) m.contactPersons = [];
    setModal(m); setTab('general');
  };

  const toggleType = (t) => setModal(m => {
    const cur = new Set(m.types || []);
    cur.has(t) ? cur.delete(t) : cur.add(t);
    return { ...m, types: [...cur] };
  });

  // ── Render ──────────────────────────────────────────────
  return (
    <div className="ct-wrap">
      <style>{CSS}</style>
      <div className="ct-top">
        <strong style={{fontSize:18,fontWeight:900,color:'#0b1220'}}>CONTACTS</strong>
        <button className="btn btn-primary" onClick={openNew}>＋ Add Contact</button>
      </div>

      <div className="ct-body">
        {incompleteCount > 0 && !filterIncomplete && (
          <div className="banner">
            <span><strong>{incompleteCount}</strong> contact{incompleteCount!==1?'s':''} need details (auto-created from transactions).</span>
            <button className="btn btn-ghost btn-xs" onClick={()=>setFilterIncomplete(true)}>Review now →</button>
          </div>
        )}

        <div className="toolbar">
          <input className="input" placeholder="🔍 Search ID, name, email, TIN…" value={search} onChange={e=>setSearch(e.target.value)} style={{flex:'1 1 220px',minWidth:180}} />
          <select className="input" value={filterType} onChange={e=>setFilterType(e.target.value)}>
            <option value="">All Types</option>
            {CONTACT_TYPES.map(t=><option key={t}>{t}</option>)}
          </select>
          <select className="input" value={filterStatus} onChange={e=>setFilterStatus(e.target.value)}>
            <option value="">All Status</option>
            {STATUSES.map(s=><option key={s}>{s}</option>)}
          </select>
          <label style={{display:'flex',alignItems:'center',gap:6,fontSize:12,color:'#64748b',fontWeight:600,cursor:'pointer'}}>
            <input type="checkbox" checked={filterIncomplete} onChange={e=>setFilterIncomplete(e.target.checked)} />
            Needs details only
          </label>
          <button className="btn btn-ghost btn-sm" onClick={()=>{setSearch('');setFilterType('');setFilterStatus('');setFilterIncomplete(false);}}>✕ Clear</button>
          <span style={{fontSize:12,color:'#94a3b8',fontWeight:600,marginLeft:'auto'}}>{filtered.length} contact{filtered.length!==1?'s':''}</span>
        </div>

        <div className="card">
          <table>
            <thead>
              <tr>
                <th>Contact ID</th><th>Contact Name</th><th>Type</th><th>Parent</th>
                <th>Email</th><th>Phone</th><th>Cost Center</th><th>Category</th>
                <th>AR Account</th><th>AP Account</th><th>Active</th><th style={{textAlign:'center'}}>Action</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 && <tr><td colSpan={12} className="empty">No contacts found.</td></tr>}
              {filtered.map(c => {
                const types = asTypes(c);
                const parent = c.parentId ? contacts.find(x => x.id === c.parentId) : null;
                const arName = c.arAccountCode ? (accounts.find(a => a.code === c.arAccountCode)?.name || c.arAccountCode) : '';
                const apName = c.apAccountCode ? (accounts.find(a => a.code === c.apAccountCode)?.name || c.apAccountCode) : '';
                const status = c.status || 'Active';
                return (
                  <tr key={c.id}>
                    <td><span className="badge-id">{c.contactId || '—'}</span></td>
                    <td>
                      <strong style={{color:'#0b1220'}}>{c.name}</strong>
                      {c.needsCompletion && <span className="pill pill-warn" style={{marginLeft:6}}>NEEDS DETAILS</span>}
                    </td>
                    <td>
                      <div style={{display:'flex',gap:3,flexWrap:'wrap'}}>
                        {types.length === 0 ? '—' : types.map(t => (
                          <span key={t} className="pill" style={TYPE_PILL[t]||{}}>{t}</span>
                        ))}
                      </div>
                    </td>
                    <td style={{color:'#64748b'}}>{parent ? parent.name : '—'}</td>
                    <td style={{color:'#64748b'}}>{c.email||'—'}</td>
                    <td style={{color:'#64748b'}}>{c.phone||c.mobile||'—'}</td>
                    <td style={{fontFamily:'monospace',fontSize:12}}>{c.costCenter||'—'}</td>
                    <td style={{color:'#64748b'}}>{c.category||'—'}</td>
                    <td style={{color:'#64748b',fontSize:12}}>{arName||'—'}</td>
                    <td style={{color:'#64748b',fontSize:12}}>{apName||'—'}</td>
                    <td><span className={status==='Active'?'pill pill-ok':'pill pill-mute'}>{status}</span></td>
                    <td style={{textAlign:'center'}}>
                      <div style={{display:'flex',gap:4,justifyContent:'center'}}>
                        <button className="btn btn-ghost btn-xs" onClick={()=>openEdit(c)}>✎ Edit</button>
                        <button className="btn btn-ghost btn-xs" style={{color:'#dc2626'}} onClick={()=>doDelete(c)}>Delete</button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {modal && (
        <ContactModal
          modal={modal} setModal={setModal} tab={tab} setTab={setTab}
          contacts={contacts} arOptions={arOptions} apOptions={apOptions}
          taxRates={taxRates} taxGroups={taxGroups} toggleType={toggleType}
          save={save} saving={saving} onClose={()=>setModal(null)}
        />
      )}

      {confirmModal && (
        <div className="backdrop" onClick={() => setConfirmModal(null)}>
          <div style={{width:'min(440px,98vw)',background:'#fff',borderRadius:16,overflow:'hidden',boxShadow:'0 24px 64px rgba(0,0,0,.25)'}} onClick={e=>e.stopPropagation()}>
            <div style={{padding:'14px 18px',borderBottom:'1px solid #e5e7eb',background:'#f8fafc',display:'flex',alignItems:'center',justifyContent:'space-between'}}>
              <strong style={{fontSize:14,fontWeight:900,color:'#0b1220'}}>Confirm Action</strong>
              <button className="btn btn-ghost btn-sm" onClick={()=>setConfirmModal(null)}>✕</button>
            </div>
            <div style={{padding:'18px'}}>
              <p style={{margin:0,fontSize:14,color:'#0b1220',lineHeight:1.5}}>{confirmModal.message}</p>
            </div>
            <div style={{display:'flex',justifyContent:'flex-end',gap:10,padding:'12px 18px',borderTop:'1px solid #e5e7eb'}}>
              <button className="btn btn-ghost" onClick={()=>setConfirmModal(null)}>Cancel</button>
              <button className="btn btn-primary" style={{background:'#dc2626'}} onClick={()=>{confirmModal.onConfirm();setConfirmModal(null);}}>Confirm</button>
            </div>
          </div>
        </div>
      )}

      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}

// ── Modal sub-component ───────────────────────────────────
function ContactModal({ modal, setModal, tab, setTab, contacts, arOptions, apOptions, taxRates, taxGroups, toggleType, save, saving, onClose }) {
  const update = (key, val) => setModal(m => ({ ...m, [key]: val }));
  const updateBank = (i, key, val) => setModal(m => ({
    ...m, banks: (m.banks||[]).map((b, idx) => idx === i ? { ...b, [key]: val } : b),
  }));
  const addBank = () => setModal(m => ({ ...m, banks: [...(m.banks||[]), EMPTY_BANK()] }));
  const removeBank = (i) => setModal(m => ({ ...m, banks: (m.banks||[]).filter((_, idx) => idx !== i) }));

  const updatePerson = (i, key, val) => setModal(m => ({
    ...m, contactPersons: (m.contactPersons||[]).map((p, idx) => idx === i ? { ...p, [key]: val } : p),
  }));
  const addPerson = () => setModal(m => ({ ...m, contactPersons: [...(m.contactPersons||[]), EMPTY_PERSON()] }));
  const removePerson = (i) => setModal(m => ({ ...m, contactPersons: (m.contactPersons||[]).filter((_, idx) => idx !== i) }));

  const eligibleParents = contacts.filter(c =>
    c.id !== modal.id && !(c.parentId && c.parentId === modal.id)
  );

  return (
    <div className="backdrop" onClick={onClose}>
      <div className="modal" onClick={e=>e.stopPropagation()}>
        <div className="modal-h">
          <strong>
            {modal.isNew ? 'Add Contact' : 'Edit Contact'}
            {modal.contactId
              ? <span style={{marginLeft:10,fontFamily:'monospace',fontSize:12,color:'#94a3b8'}}>{modal.contactId}</span>
              : <span style={{marginLeft:10,fontFamily:'monospace',fontSize:12,color:'#94a3b8'}}>Auto-assigned on save</span>}
            {modal.needsCompletion && <span className="pill pill-warn" style={{marginLeft:8}}>NEEDS DETAILS</span>}
          </strong>
          <button className="btn btn-ghost btn-sm" onClick={onClose}>✕</button>
        </div>

        <div className="modal-b">
          <div className="tabs">
            {[
              ['general','General'],
              ['financial','Financial'],
              ['contact','Contact Info'],
              ['address','Addresses'],
              ['banks','Banks'],
              ['persons','Contact Persons'],
              ['notes','Notes'],
            ].map(([k,l]) => (
              <div key={k} className={'tab' + (tab===k?' active':'')} onClick={()=>setTab(k)}>{l}</div>
            ))}
          </div>

          {tab === 'general' && (
            <div className="grid2">
              <div className="field col2">
                <label>Full Name / Company Name *</label>
                <input value={modal.name} onChange={e=>update('name',e.target.value)} placeholder="e.g. Adele Fado Trading Corp." />
              </div>
              <div className="field">
                <label>Display Name</label>
                <input value={modal.displayName||''} onChange={e=>update('displayName',e.target.value)} placeholder="(defaults to Full Name)" />
              </div>
              <div className="field">
                <label>Status</label>
                <select value={modal.status||'Active'} onChange={e=>update('status',e.target.value)}>
                  {STATUSES.map(s=><option key={s}>{s}</option>)}
                </select>
              </div>
              <div className="field col2">
                <label>Type * (multi-select)</label>
                <div className="chk-row">
                  {CONTACT_TYPES.map(t => (
                    <span key={t} className={'chk' + ((modal.types||[]).includes(t)?' on':'')} onClick={()=>toggleType(t)}>{t}</span>
                  ))}
                </div>
              </div>
              <div className="field col2">
                <label>Parent Contact (for sub-contacts / branches)</label>
                <select value={modal.parentId||''} onChange={e=>update('parentId',e.target.value)}>
                  <option value="">— None (top-level) —</option>
                  {eligibleParents.map(c => (
                    <option key={c.id} value={c.id}>{c.contactId ? `${c.contactId} · ` : ''}{c.name}</option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label>Cost Center</label>
                <input value={modal.costCenter||''} onChange={e=>update('costCenter',e.target.value.toUpperCase())} placeholder="e.g. AFT, ALC, DIG" list="cc-suggestions" />
                <datalist id="cc-suggestions">
                  {[...new Set(contacts.map(c=>c.costCenter).filter(Boolean))].map(cc=><option key={cc} value={cc} />)}
                </datalist>
              </div>
              <div className="field">
                <label>Category</label>
                <input value={modal.category||''} onChange={e=>update('category',e.target.value)} placeholder="e.g. Deployed" list="cat-suggestions" />
                <datalist id="cat-suggestions">{CATEGORY_SUGGESTIONS.map(c=><option key={c} value={c} />)}</datalist>
              </div>
              <div className="field">
                <label>Branch (Reporting Tag)</label>
                <input value={modal.branch||''} onChange={e=>update('branch',e.target.value)} />
              </div>
              <div className="field">
                <label>Department (Reporting Tag)</label>
                <input value={modal.department||''} onChange={e=>update('department',e.target.value)} />
              </div>
            </div>
          )}

          {tab === 'financial' && (
            <div className="grid2">
              <div className="field">
                <label>AR Account (Receivable)</label>
                <AccountCombobox options={arOptions} value={modal.arAccountCode||''} onChange={v=>update('arAccountCode',v)} placeholder="— Select Receivable Account —" />
              </div>
              <div className="field">
                <label>AP Account (Payable)</label>
                <AccountCombobox options={apOptions} value={modal.apAccountCode||''} onChange={v=>update('apAccountCode',v)} placeholder="— Select Payable Account —" />
              </div>
              <div className="field">
                <label>Currency</label>
                <select value={modal.currency||'PHP'} onChange={e=>update('currency',e.target.value)}>
                  {CURRENCIES.map(c=><option key={c}>{c}</option>)}
                </select>
              </div>
              <div className="field">
                <label>Payment Terms</label>
                <select value={modal.paymentTerms||'Due on Receipt'} onChange={e=>update('paymentTerms',e.target.value)}>
                  {PAYMENT_TERMS.map(t=><option key={t}>{t}</option>)}
                </select>
              </div>
              <div className="field">
                <label>Credit Limit</label>
                <input type="number" value={modal.creditLimit||0} onChange={e=>update('creditLimit',e.target.value)} />
              </div>
              <div className="field">
                <label>Opening Balance</label>
                <input type="number" value={modal.openingBalance||0} onChange={e=>update('openingBalance',e.target.value)} />
              </div>
              <div className="field col2">
                <label>Default Tax Rate / Group</label>
                <select value={modal.taxRateId||''} onChange={e=>update('taxRateId',e.target.value)}>
                  <option value="">— None —</option>
                  {taxRates.length > 0 && (
                    <optgroup label="— Rates —">
                      {taxRates.map(r=><option key={r.id} value={r.id}>{r.name} ({r.rate||0}%)</option>)}
                    </optgroup>
                  )}
                  {taxGroups.length > 0 && (
                    <optgroup label="— Groups —">
                      {taxGroups.map(g=><option key={g.id} value={g.id}>{g.name}</option>)}
                    </optgroup>
                  )}
                </select>
              </div>
            </div>
          )}

          {tab === 'contact' && (
            <div className="grid2">
              <div className="field">
                <label>TIN</label>
                <input value={modal.tin||''} onChange={e=>update('tin',formatTin(e.target.value))} placeholder="000-000-000-000" inputMode="numeric" />
              </div>
              <div className="field">
                <label>Email</label>
                <input type="email" value={modal.email||''} onChange={e=>update('email',e.target.value)} placeholder="email@example.com" />
              </div>
              <div className="field">
                <label>Phone (Work)</label>
                <input value={modal.phone||''} onChange={e=>update('phone',e.target.value)} placeholder="+63..." />
              </div>
              <div className="field">
                <label>Mobile</label>
                <input value={modal.mobile||''} onChange={e=>update('mobile',e.target.value)} placeholder="+63..." />
              </div>
              <div className="field col2">
                <label>Website</label>
                <input value={modal.website||''} onChange={e=>update('website',e.target.value)} placeholder="https://" />
              </div>
            </div>
          )}

          {tab === 'address' && (
            <div>
              <div style={{fontSize:11,fontWeight:800,color:'#94a3b8',letterSpacing:'.07em',textTransform:'uppercase',marginBottom:10,borderBottom:'1px solid #f1f5f9',paddingBottom:6}}>Billing Address</div>
              <div className="grid2" style={{marginBottom:20}}>
                <div className="field col2">
                  <label>Street / Line 1</label>
                  <input value={modal.billingStreet||''} onChange={e=>update('billingStreet',e.target.value)} placeholder="Unit/Bldg, Street Name, Barangay" />
                </div>
                <div className="field">
                  <label>City / Municipality</label>
                  <input value={modal.billingCity||''} onChange={e=>update('billingCity',e.target.value)} placeholder="e.g. Makati City" />
                </div>
                <div className="field">
                  <label>ZIP Code</label>
                  <input value={modal.billingZip||''} onChange={e=>update('billingZip',e.target.value)} placeholder="e.g. 1200" />
                </div>
                <div className="field col2">
                  <label>Country</label>
                  <input value={modal.billingCountry||''} onChange={e=>update('billingCountry',e.target.value)} placeholder="e.g. Philippines" />
                </div>
              </div>

              <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:10,borderBottom:'1px solid #f1f5f9',paddingBottom:6}}>
                <span style={{fontSize:11,fontWeight:800,color:'#94a3b8',letterSpacing:'.07em',textTransform:'uppercase'}}>Shipping Address</span>
                <button type="button" className="btn btn-ghost btn-xs" onClick={()=>setModal(m=>({
                  ...m,
                  shippingStreet:  m.billingStreet||'',
                  shippingCity:    m.billingCity||'',
                  shippingZip:     m.billingZip||'',
                  shippingCountry: m.billingCountry||'',
                }))}>↓ Copy from billing</button>
              </div>
              <div className="grid2">
                <div className="field col2">
                  <label>Street / Line 1</label>
                  <input value={modal.shippingStreet||''} onChange={e=>update('shippingStreet',e.target.value)} placeholder="Unit/Bldg, Street Name, Barangay" />
                </div>
                <div className="field">
                  <label>City / Municipality</label>
                  <input value={modal.shippingCity||''} onChange={e=>update('shippingCity',e.target.value)} placeholder="e.g. Makati City" />
                </div>
                <div className="field">
                  <label>ZIP Code</label>
                  <input value={modal.shippingZip||''} onChange={e=>update('shippingZip',e.target.value)} placeholder="e.g. 1200" />
                </div>
                <div className="field col2">
                  <label>Country</label>
                  <input value={modal.shippingCountry||''} onChange={e=>update('shippingCountry',e.target.value)} placeholder="e.g. Philippines" />
                </div>
              </div>
            </div>
          )}

          {tab === 'banks' && (
            <div>
              <table className="sub-tbl">
                <thead>
                  <tr><th>Bank Code</th><th>Branch</th><th>Account No</th><th>Account Name</th><th>SWIFT</th><th>Default</th><th></th></tr>
                </thead>
                <tbody>
                  {(modal.banks||[]).map((b,i) => (
                    <tr key={i}>
                      <td><input value={b.bankCode||''} onChange={e=>updateBank(i,'bankCode',e.target.value)} placeholder="e.g. BPI" /></td>
                      <td><input value={b.branch||''} onChange={e=>updateBank(i,'branch',e.target.value)} /></td>
                      <td><input value={b.accountNumber||''} onChange={e=>updateBank(i,'accountNumber',e.target.value)} /></td>
                      <td><input value={b.accountName||''} onChange={e=>updateBank(i,'accountName',e.target.value)} /></td>
                      <td><input value={b.swift||''} onChange={e=>updateBank(i,'swift',e.target.value)} /></td>
                      <td style={{textAlign:'center'}}><input type="checkbox" checked={!!b.isDefault} onChange={e=>updateBank(i,'isDefault',e.target.checked)} /></td>
                      <td style={{textAlign:'center',width:30}}>
                        <button className="btn btn-ghost btn-xs" style={{color:'#dc2626'}} onClick={()=>removeBank(i)} disabled={(modal.banks||[]).length<=1}>✕</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <button className="btn btn-ghost btn-sm" style={{marginTop:8}} onClick={addBank}>＋ Add Bank</button>
            </div>
          )}

          {tab === 'persons' && (
            <div>
              <table className="sub-tbl">
                <thead>
                  <tr><th>Title</th><th>First Name</th><th>Last Name</th><th>Email</th><th>Work Phone</th><th>Mobile</th><th>Role</th><th></th></tr>
                </thead>
                <tbody>
                  {(modal.contactPersons||[]).length === 0 && (
                    <tr><td colSpan={8} style={{padding:14,textAlign:'center',color:'#94a3b8',fontSize:12}}>No contact persons yet.</td></tr>
                  )}
                  {(modal.contactPersons||[]).map((p,i) => (
                    <tr key={i}>
                      <td style={{width:80}}>
                        <select value={p.salutation||''} onChange={e=>updatePerson(i,'salutation',e.target.value)}>
                          {SALUTATIONS.map(s=><option key={s} value={s}>{s||'—'}</option>)}
                        </select>
                      </td>
                      <td><input value={p.firstName||''} onChange={e=>updatePerson(i,'firstName',e.target.value)} /></td>
                      <td><input value={p.lastName||''} onChange={e=>updatePerson(i,'lastName',e.target.value)} /></td>
                      <td><input value={p.email||''} onChange={e=>updatePerson(i,'email',e.target.value)} /></td>
                      <td><input value={p.workPhone||''} onChange={e=>updatePerson(i,'workPhone',e.target.value)} /></td>
                      <td><input value={p.mobile||''} onChange={e=>updatePerson(i,'mobile',e.target.value)} /></td>
                      <td><input value={p.role||''} onChange={e=>updatePerson(i,'role',e.target.value)} placeholder="e.g. Accountant" /></td>
                      <td style={{textAlign:'center',width:30}}>
                        <button className="btn btn-ghost btn-xs" style={{color:'#dc2626'}} onClick={()=>removePerson(i)}>✕</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <button className="btn btn-ghost btn-sm" style={{marginTop:8}} onClick={addPerson}>＋ Add Contact Person</button>
            </div>
          )}

          {tab === 'notes' && (
            <div className="grid2">
              <div className="field col2">
                <label>Notes (visible on transactions)</label>
                <textarea value={modal.notes||''} onChange={e=>update('notes',e.target.value)} />
              </div>
              <div className="field col2">
                <label>Internal Remarks</label>
                <textarea value={modal.internalRemarks||''} onChange={e=>update('internalRemarks',e.target.value)} />
              </div>
            </div>
          )}
        </div>

        <div className="modal-f">
          <span style={{fontSize:11,color:'#94a3b8',alignSelf:'center'}}>
            {modal.isNew ? 'New contact' : `Editing ${modal.contactId || ''}`}
          </span>
          <div style={{display:'flex',gap:10}}>
            <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
            <button className="btn btn-primary" onClick={save} disabled={saving}>{saving?'Saving…':'Save Contact'}</button>
          </div>
        </div>
      </div>
    </div>
  );
}

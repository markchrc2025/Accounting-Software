import { useState, useEffect, useCallback } from 'react';
import {
  collection, query, orderBy, onSnapshot, addDoc, updateDoc, doc,
  serverTimestamp, getDocs
} from 'firebase/firestore';
import { db, auth } from '../../../firebase.js';

const fmt = (n) => new Intl.NumberFormat('en-PH', { style:'currency', currency:'PHP' }).format(n || 0);
const uid = () => Math.random().toString(36).slice(2, 10).toUpperCase();

const VOUCHER_TYPES = ['Check Voucher','Cash Voucher','Journal Voucher','Petty Cash','Debit Memo'];
const BANK_CODES    = ['UBPBPHM','BPI','BDO','RCBC','MBTC','CASH'];
const STATUSES      = ['All','Pending','Approved','For Disbursement','Paid','Rejected','Voided'];

const pill = (status) => {
  const map = {
    'Pending':          'pill-pending',
    'Approved':         'pill-approved',
    'For Disbursement': 'pill-disburse',
    'Paid':             'pill-paid',
    'Rejected':         'pill-rejected',
    'Voided':           'pill-voided',
  };
  return `pill ${map[status] || 'pill-pending'}`;
};

const EMPTY_LINE = () => ({ id: uid(), description:'', accountCode:'', accountName:'', debit:'', credit:'' });

const CSS = `
  .vp-wrap   { display:flex; flex-direction:column; height:100%; overflow:hidden; font-family:Inter,system-ui,sans-serif; }
  .vp-topbar { display:flex; align-items:center; justify-content:space-between; padding:16px 22px 12px; flex-shrink:0; border-bottom:1px solid #e5e7eb; background:#fff; }
  .vp-body   { flex:1; overflow-y:auto; padding:16px 22px; }
  .toolbar   { display:flex; gap:10px; align-items:center; flex-wrap:wrap; margin-bottom:14px; }
  .input     { border:1px solid #e5e7eb; border-radius:10px; padding:9px 12px; font-size:13px; background:#fff; }
  .btn       { border:0; border-radius:10px; padding:9px 16px; font-weight:700; cursor:pointer; font-size:13px; font-family:inherit; }
  .btn-primary { background:#f97316; color:#fff; }
  .btn-dark    { background:#0b1220; color:#fff; }
  .btn-ghost   { background:#f1f5f9; color:#0b1220; }
  .btn-ghost:hover { background:#e2e8f0; }
  .btn-danger  { background:#ef4444; color:#fff; }
  .btn-sm      { padding:6px 12px; font-size:12px; }
  .card { background:#fff; border:1px solid #e5e7eb; border-radius:14px; overflow:hidden; }
  table { width:100%; border-collapse:collapse; }
  th,td { padding:11px 12px; border-bottom:1px solid #f1f5f9; font-size:13px; text-align:left; }
  th { color:#64748b; font-weight:800; font-size:11px; letter-spacing:.05em; text-transform:uppercase; background:#f8fafc; }
  tr:hover td { background:#fafafa; }
  tr:last-child td { border-bottom:none; }
  .pill          { display:inline-block; padding:3px 9px; border-radius:999px; font-size:11px; font-weight:700; border:1px solid; white-space:nowrap; }
  .pill-pending  { background:#fff7ed; border-color:#fed7aa; color:#c2410c; }
  .pill-approved { background:#ecfeff; border-color:#a5f3fc; color:#0e7490; }
  .pill-disburse { background:#eff6ff; border-color:#bfdbfe; color:#1d4ed8; }
  .pill-paid     { background:#f0fdf4; border-color:#bbf7d0; color:#15803d; }
  .pill-rejected { background:#fef2f2; border-color:#fecaca; color:#dc2626; }
  .pill-voided   { background:#f8fafc; border-color:#e2e8f0; color:#64748b; }
  /* Modal */
  .backdrop { position:fixed; inset:0; background:rgba(15,23,42,.45); display:flex; align-items:center; justify-content:center; padding:16px; z-index:100; }
  .modal    { width:min(900px,98vw); max-height:90vh; background:#fff; border-radius:16px; display:flex; flex-direction:column; overflow:hidden; box-shadow:0 24px 64px rgba(0,0,0,.25); }
  .modal-h  { display:flex; align-items:center; justify-content:space-between; padding:16px 20px; border-bottom:1px solid #e5e7eb; background:#f8fafc; }
  .modal-h strong { font-size:15px; font-weight:900; }
  .modal-b  { padding:20px; overflow-y:auto; flex:1; }
  .modal-f  { display:flex; justify-content:flex-end; gap:10px; padding:14px 20px; border-top:1px solid #e5e7eb; background:#fff; }
  .grid6    { display:grid; grid-template-columns:repeat(6,1fr); gap:10px; margin-bottom:12px; }
  .col2     { grid-column:span 2; }
  .col3     { grid-column:span 3; }
  .col4     { grid-column:span 4; }
  .col6     { grid-column:span 6; }
  .field    { display:flex; flex-direction:column; gap:5px; }
  .field label { font-size:10px; font-weight:800; color:#64748b; letter-spacing:.06em; text-transform:uppercase; }
  .field input,.field select,.field textarea { width:100%; border:1px solid #e5e7eb; border-radius:10px; padding:9px 10px; font-size:13px; background:#fff; font-family:inherit; box-sizing:border-box; }
  .section-title { font-size:11px; font-weight:800; color:#94a3b8; letter-spacing:.07em; text-transform:uppercase; margin:16px 0 8px; }
  .lines-table th,.lines-table td { border-bottom:1px solid #f1f5f9; }
  .lines-table td input,.lines-table td select { width:100%; border:1px solid #e5e7eb; border-radius:8px; padding:7px 8px; font-size:12px; font-family:inherit; }
  .tfoot { display:flex; justify-content:flex-end; gap:20px; padding:12px 16px; border-top:2px solid #e5e7eb; background:#f8fafc; font-size:13px; font-weight:700; }
  .empty { padding:48px; text-align:center; color:#94a3b8; font-size:13px; }
  .toast { position:fixed; right:16px; bottom:16px; background:#0b1220; color:#fff; padding:12px 18px; border-radius:12px; font-size:13px; font-weight:600; z-index:999; animation:fadeIn .2s; }
  @keyframes fadeIn { from{opacity:0;transform:translateY(8px)} to{opacity:1;transform:none} }
`;

export default function VouchersPage() {
  const [vouchers, setVouchers]   = useState([]);
  const [accounts, setAccounts]   = useState([]);
  const [contacts, setContacts]   = useState([]);
  const [statusFilter, setStatus] = useState('All');
  const [search, setSearch]       = useState('');
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing]     = useState(null);
  const [form, setForm]           = useState({});
  const [lines, setLines]         = useState([EMPTY_LINE()]);
  const [saving, setSaving]       = useState(false);
  const [toast, setToast]         = useState('');

  const showToast = (msg) => { setToast(msg); setTimeout(() => setToast(''), 3000); };

  // Live data
  useEffect(() => {
    const unsub = onSnapshot(
      query(collection(db, 'vouchers'), orderBy('createdAt', 'desc')),
      snap => setVouchers(snap.docs.map(d => ({ id: d.id, ...d.data() })))
    );
    getDocs(collection(db, 'accounts')).then(s => setAccounts(s.docs.map(d => ({ id:d.id, ...d.data() }))));
    getDocs(collection(db, 'contacts')).then(s => setContacts(s.docs.map(d => ({ id:d.id, ...d.data() }))));
    return unsub;
  }, []);

  function openCreate() {
    const num = 'CV-' + new Date().getFullYear() + '-' + uid();
    setEditing(null);
    setForm({ number:num, type:'Check Voucher', date: new Date().toISOString().slice(0,10), status:'Pending', bankCode:'UBPBPHM' });
    setLines([EMPTY_LINE()]);
    setShowModal(true);
  }

  function openEdit(v) {
    setEditing(v.id);
    setForm({ ...v });
    setLines((v.lines || [{ ...EMPTY_LINE() }]).map(l => ({ ...l, id: l.id || uid() })));
    setShowModal(true);
  }

  function calcTotal() {
    return lines.reduce((s, l) => s + (parseFloat(l.debit) || 0), 0);
  }

  async function handleSave() {
    if (!form.payee) return alert('Payee is required.');
    setSaving(true);
    try {
      const amount = calcTotal();
      const payload = {
        ...form,
        amount,
        lines: lines.map(l => ({ ...l, debit: parseFloat(l.debit)||0, credit: parseFloat(l.credit)||0 })),
        updatedAt: serverTimestamp(),
      };
      if (editing) {
        await updateDoc(doc(db, 'vouchers', editing), payload);
        showToast('Voucher updated.');
      } else {
        await addDoc(collection(db, 'vouchers'), { ...payload, createdAt: serverTimestamp(), createdBy: auth.currentUser?.email });
        showToast('Voucher created.');
      }
      setShowModal(false);
    } catch (e) { alert(e.message); }
    setSaving(false);
  }

  async function updateStatus(id, status) {
    await updateDoc(doc(db, 'vouchers', id), { status, updatedAt: serverTimestamp() });
    showToast(`Status updated to ${status}.`);
  }

  function addLine() { setLines(l => [...l, EMPTY_LINE()]); }
  function removeLine(idx) { setLines(l => l.filter((_,i) => i !== idx)); }
  function setLine(idx, field, val) { setLines(l => l.map((r,i) => i === idx ? { ...r, [field]: val } : r)); }

  const filtered = vouchers.filter(v => {
    const matchStatus = statusFilter === 'All' || v.status === statusFilter;
    const matchSearch = !search || [v.number, v.payee, v.description].some(s => String(s||'').toLowerCase().includes(search.toLowerCase()));
    return matchStatus && matchSearch;
  });

  const totalAmt = filtered.reduce((s, v) => s + (v.amount || 0), 0);

  return (
    <div className="vp-wrap">
      <style>{CSS}</style>

      <div className="vp-topbar">
        <div>
          <h1 style={{ margin:0, fontSize:18, fontWeight:900 }}>Vouchers</h1>
          <p style={{ margin:0, fontSize:12, color:'#64748b' }}>{filtered.length} record{filtered.length !== 1 ? 's' : ''} · {fmt(totalAmt)} total</p>
        </div>
        <button className="btn btn-primary" onClick={openCreate}>+ New Voucher</button>
      </div>

      <div className="vp-body">
        <div className="toolbar">
          <input className="input" placeholder="Search number, payee…" value={search} onChange={e => setSearch(e.target.value)} style={{ width:220 }} />
          <select className="input" value={statusFilter} onChange={e => setStatus(e.target.value)}>
            {STATUSES.map(s => <option key={s}>{s}</option>)}
          </select>
        </div>

        <div className="card">
          {filtered.length === 0 ? (
            <div className="empty">No vouchers found.{' '}
              <span style={{ color:'#f97316', cursor:'pointer', fontWeight:700 }} onClick={openCreate}>Create the first one →</span>
            </div>
          ) : (
            <table>
              <thead>
                <tr><th>Number</th><th>Date</th><th>Type</th><th>Payee</th><th>Bank</th><th style={{textAlign:'right'}}>Amount</th><th>Status</th><th>Actions</th></tr>
              </thead>
              <tbody>
                {filtered.map(v => (
                  <tr key={v.id}>
                    <td style={{ fontWeight:700, fontFamily:'monospace', fontSize:12 }}>{v.number}</td>
                    <td style={{ color:'#64748b' }}>{v.date}</td>
                    <td>{v.type}</td>
                    <td style={{ fontWeight:600 }}>{v.payee}</td>
                    <td style={{ color:'#64748b', fontSize:12 }}>{v.bankCode}</td>
                    <td style={{ textAlign:'right', fontWeight:800 }}>{fmt(v.amount)}</td>
                    <td><span className={pill(v.status)}>{v.status}</span></td>
                    <td>
                      <div style={{ display:'flex', gap:6 }}>
                        <button className="btn btn-ghost btn-sm" onClick={() => openEdit(v)}>Edit</button>
                        {v.status === 'Pending' && <>
                          <button className="btn btn-sm" style={{ background:'#d1fae5', color:'#065f46' }} onClick={() => updateStatus(v.id, 'Approved')}>Approve</button>
                          <button className="btn btn-sm" style={{ background:'#fee2e2', color:'#dc2626' }} onClick={() => updateStatus(v.id, 'Rejected')}>Reject</button>
                        </>}
                        {v.status === 'Approved' && (
                          <button className="btn btn-sm" style={{ background:'#dbeafe', color:'#1d4ed8' }} onClick={() => updateStatus(v.id, 'For Disbursement')}>For Disburse</button>
                        )}
                        {v.status === 'For Disbursement' && (
                          <button className="btn btn-sm" style={{ background:'#dcfce7', color:'#15803d' }} onClick={() => updateStatus(v.id, 'Paid')}>Mark Paid</button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* Modal */}
      {showModal && (
        <div className="backdrop" onClick={e => e.target === e.currentTarget && setShowModal(false)}>
          <div className="modal">
            <div className="modal-h">
              <strong>{editing ? 'Edit Voucher' : 'New Voucher'}</strong>
              <button className="btn btn-ghost btn-sm" onClick={() => setShowModal(false)}>✕ Close</button>
            </div>
            <div className="modal-b">
              <div className="grid6">
                <div className="field col2">
                  <label>Voucher No.</label>
                  <input value={form.number||''} onChange={e => setForm(f => ({...f, number:e.target.value}))} />
                </div>
                <div className="field col2">
                  <label>Type</label>
                  <select value={form.type||''} onChange={e => setForm(f => ({...f, type:e.target.value}))}>
                    {VOUCHER_TYPES.map(t => <option key={t}>{t}</option>)}
                  </select>
                </div>
                <div className="field col2">
                  <label>Date</label>
                  <input type="date" value={form.date||''} onChange={e => setForm(f => ({...f, date:e.target.value}))} />
                </div>
                <div className="field col3">
                  <label>Payee / Contact</label>
                  <input value={form.payee||''} onChange={e => setForm(f => ({...f, payee:e.target.value}))} list="contacts-list" placeholder="Name of payee" />
                  <datalist id="contacts-list">{contacts.map(c => <option key={c.id} value={c.name||c.contactName} />)}</datalist>
                </div>
                <div className="field col2">
                  <label>Bank / Fund</label>
                  <select value={form.bankCode||''} onChange={e => setForm(f => ({...f, bankCode:e.target.value}))}>
                    {BANK_CODES.map(b => <option key={b}>{b}</option>)}
                  </select>
                </div>
                <div className="field col1">
                  <label>Status</label>
                  <select value={form.status||'Pending'} onChange={e => setForm(f => ({...f, status:e.target.value}))}>
                    {STATUSES.filter(s => s !== 'All').map(s => <option key={s}>{s}</option>)}
                  </select>
                </div>
                <div className="field col6">
                  <label>Description / Purpose</label>
                  <textarea rows={2} value={form.description||''} onChange={e => setForm(f => ({...f, description:e.target.value}))} />
                </div>
              </div>

              {/* Journal Lines */}
              <div className="section-title">Journal Entry Lines</div>
              <div style={{ border:'1px solid #e5e7eb', borderRadius:12, overflow:'hidden' }}>
                <table className="lines-table">
                  <thead>
                    <tr>
                      <th style={{ width:160 }}>Account</th>
                      <th>Description</th>
                      <th style={{ width:120, textAlign:'right' }}>Debit</th>
                      <th style={{ width:120, textAlign:'right' }}>Credit</th>
                      <th style={{ width:40 }}></th>
                    </tr>
                  </thead>
                  <tbody>
                    {lines.map((l, i) => (
                      <tr key={l.id}>
                        <td>
                          <input
                            value={l.accountName||''}
                            onChange={e => setLine(i, 'accountName', e.target.value)}
                            list="accounts-list"
                            placeholder="Account name"
                          />
                          <datalist id="accounts-list">{accounts.map(a => <option key={a.id} value={`${a.code} - ${a.name}`} />)}</datalist>
                        </td>
                        <td><input value={l.description||''} onChange={e => setLine(i, 'description', e.target.value)} placeholder="Line description" /></td>
                        <td><input type="number" value={l.debit||''} onChange={e => setLine(i, 'debit', e.target.value)} style={{ textAlign:'right' }} placeholder="0.00" /></td>
                        <td><input type="number" value={l.credit||''} onChange={e => setLine(i, 'credit', e.target.value)} style={{ textAlign:'right' }} placeholder="0.00" /></td>
                        <td><button onClick={() => removeLine(i)} style={{ background:'none', border:'none', color:'#ef4444', cursor:'pointer', fontSize:16 }}>×</button></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <div style={{ padding:'8px 12px' }}>
                  <button className="btn btn-ghost btn-sm" onClick={addLine}>+ Add Line</button>
                </div>
                <div className="tfoot">
                  <span>Total Debit: <strong>{fmt(lines.reduce((s,l) => s+(parseFloat(l.debit)||0),0))}</strong></span>
                  <span>Total Credit: <strong>{fmt(lines.reduce((s,l) => s+(parseFloat(l.credit)||0),0))}</strong></span>
                </div>
              </div>
            </div>
            <div className="modal-f">
              <button className="btn btn-ghost" onClick={() => setShowModal(false)}>Cancel</button>
              <button className="btn btn-primary" onClick={handleSave} disabled={saving}>
                {saving ? 'Saving…' : editing ? 'Save Changes' : 'Create Voucher'}
              </button>
            </div>
          </div>
        </div>
      )}

      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}

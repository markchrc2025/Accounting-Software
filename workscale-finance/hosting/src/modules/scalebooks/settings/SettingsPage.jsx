import { useState, useEffect } from 'react';
import {
  doc, getDoc, setDoc, serverTimestamp,
  collection, onSnapshot, addDoc, updateDoc, deleteDoc, getDocs, writeBatch, query, orderBy, where,
} from 'firebase/firestore';
import { db, auth, storage, functions } from '../../../firebase.js';
import { httpsCallable } from 'firebase/functions';
import { ref as storageRef, uploadBytes, getDownloadURL, deleteObject } from 'firebase/storage';
import { usePermissions } from '../../../contexts/PermissionsContext.jsx';
import { invalidateDocIdSettings } from '../../../utils/documentIds.js';

const GLOBAL_ROLES  = ['Maker', 'Verifier', 'Approver', 'Poster', 'Admin'];
const MODULE_ROLES  = ['Maker', 'Verifier', 'Approver', 'Poster', 'Admin'];
const ROUTING_DOC_TYPES = ['Vouchers', 'Weekly Projections', 'Disbursements', 'Check Voucher'];
// Roles that Admin implicitly includes (all of them)
const ADMIN_INHERITS = ['Maker', 'Verifier', 'Approver', 'Poster', 'Admin'];
const MODULE_GROUPS = [
  { group: 'Disbursement', modules: ['Vouchers', 'Approvals', 'Weekly Projections', 'Payment Schedule', 'Disbursements', 'Check Registry'] },
  { group: 'Accountant',  modules: ['Journal', 'Bank', 'Chart of Accounts', 'Tax', 'Financial Management', 'Fixed Assets'] },
  { group: 'Billing & AR', modules: ['Billing Book', 'Service Invoices', 'Collections'] },
];
const VOUCHER_TYPES = ['PAYMENT', 'PAYROLL', 'FINAL_PAY', 'LOAN'];
const MONTHS        = ['January','February','March','April','May','June','July','August','September','October','November','December'];

const formatTin = v => {
  const d = v.replace(/\D/g, '').slice(0, 14);
  const main = d.slice(0, 9);
  const branch = d.slice(9);
  const parts = [];
  for (let i = 0; i < main.length; i += 3) parts.push(main.slice(i, i + 3));
  const result = parts.join('-');
  return branch.length ? result + '-' + branch : result;
};

const MODULE_BACKUP_GROUPS = [
  { group: 'Disbursement', modules: [
    { label: 'Vouchers',           collections: ['vouchers'] },
    { label: 'Weekly Projections', collections: ['weeklyProjections'] },
    { label: 'Payment Schedule',   collections: ['paymentSchedules'] },
    { label: 'Disbursements',      collections: ['disbursementReports'] },
    { label: 'Check Registry',     collections: ['checkRegister', 'checkbookMaster'] },
  ]},
  { group: 'Accountant', modules: [
    { label: 'Journal',              collections: ['journalEntries'] },
    { label: 'Bank',                 collections: ['dailyBankBalances', 'bankTransactions', 'creditLines', 'bankReconciliations'] },
    { label: 'Chart of Accounts',    collections: ['accounts'] },
    { label: 'Tax',                  collections: ['taxEntries', 'taxRates'] },
    { label: 'Financial Management', collections: [], singleDocs: [{ coll: 'finc', id: 'profile' }] },
    { label: 'Fixed Assets',         collections: [], singleDocs: [{ coll: 'fixedAssets', id: 'profile' }] },
  ]},
  { group: 'Billing & AR', modules: [
    { label: 'Billing Book',     collections: ['billingStatements'] },
    { label: 'Service Invoices', collections: ['serviceInvoices'] },
    { label: 'Collections',      collections: ['collections'] },
  ]},
  { group: 'System', modules: [
    { label: 'Contacts',          collections: ['contacts'] },
    { label: 'Users & Reference', collections: ['appUsers', 'purposeCategories', 'paymentTerms'] },
    { label: 'Settings (Config)', collections: [], includeSettings: true },
  ]},
];
const ALL_MODULES_FLAT  = MODULE_BACKUP_GROUPS.flatMap(g => g.modules);
const ALL_MODULE_LABELS = ALL_MODULES_FLAT.map(m => m.label);

function serializeData(obj) {
  if (obj === null || obj === undefined) return obj;
  if (obj && typeof obj === 'object' && typeof obj.toDate === 'function') return obj.toDate().toISOString();
  if (Array.isArray(obj)) return obj.map(serializeData);
  if (typeof obj === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(obj)) out[k] = serializeData(v);
    return out;
  }
  return obj;
}

const NAV = [
  { group: 'ORGANIZATION SETTINGS', items: [
    { id: 'org-profile',  icon: '🏢', label: 'Organization Profile' },
    { id: 'users-roles',  icon: '👥', label: 'Users & Roles' },
    { id: 'setup-config', icon: '⚙️', label: 'Setup & Configurations' },
  ]},
  { group: 'MODULE SETTINGS', items: [
    { id: 'mod-vouchers', icon: '📄', label: 'Vouchers' },
    { id: 'mod-checks',   icon: '✏️', label: 'Check Registry' },
  ]},
  { group: 'REFERENCE DATA', items: [
    { id: 'ref-categories',    icon: '🗂️', label: 'Purpose Categories' },
    { id: 'ref-payment-terms', icon: '📅', label: 'Payment Terms' },
  ]},
  { group: 'DATA MANAGEMENT', items: [
    { id: 'data-settings', icon: '🗄️', label: 'Data Settings', adminOnly: true },
  ]},
];

const ROLE_STYLE = {
  Maker:    { background:'#f0f9ff', borderColor:'#bae6fd', color:'#0369a1' },
  Verifier: { background:'#ecfdf5', borderColor:'#6ee7b7', color:'#065f46' },
  Approver: { background:'#eff6ff', borderColor:'#bfdbfe', color:'#1d4ed8' },
  Poster:   { background:'#fdf4ff', borderColor:'#e9d5ff', color:'#7e22ce' },
  Admin:    { background:'#fef2f2', borderColor:'#fecaca', color:'#991b1b' },
  HRBP:     { background:'#fffbeb', borderColor:'#fde68a', color:'#92400e' },
  VIEWER:   { background:'#f8fafc', borderColor:'#e2e8f0', color:'#64748b' },
};

const CSS = `
  .sp { display:flex; height:100%; overflow:hidden; font-family:Inter,system-ui,sans-serif; background:#f8fafc; }
  .sp-sidebar { width:220px; flex-shrink:0; background:#fff; border-right:1px solid #e5e7eb; overflow-y:auto; display:flex; flex-direction:column; }
  .sp-sb-hdr  { padding:18px 16px 14px; border-bottom:1px solid #f1f5f9; }
  .sp-sb-hdr h2 { margin:0; font-size:15px; font-weight:900; color:#0b1220; }
  .sp-sb-hdr p  { margin:3px 0 0; font-size:11px; color:#f97316; font-weight:600; }
  .sp-grp-lbl { font-size:9px; font-weight:900; color:#94a3b8; letter-spacing:.1em; text-transform:uppercase; padding:14px 16px 5px; }
  .sp-nav { display:flex; align-items:center; gap:9px; padding:9px 16px; cursor:pointer; font-size:13px; font-weight:500; color:#374151; border-left:3px solid transparent; transition:background .12s; user-select:none; }
  .sp-nav:hover { background:#f8fafc; color:#0b1220; }
  .sp-nav-on  { background:#fff7ed !important; color:#f97316 !important; font-weight:700; border-left-color:#f97316; }
  .sp-nav-ico { font-size:15px; width:20px; text-align:center; flex-shrink:0; }
  .sp-content { flex:1; overflow-y:auto; padding:30px 40px 50px; }
  .sp-ch h1   { margin:0 0 5px; font-size:22px; font-weight:900; color:#0b1220; }
  .sp-ch p    { margin:0 0 24px; font-size:13px; color:#64748b; }
  .sp-card { background:#fff; border:1px solid #e5e7eb; border-radius:14px; padding:22px 24px; margin-bottom:20px; }
  .sp-card-title { font-size:10px; font-weight:900; color:#94a3b8; letter-spacing:.08em; text-transform:uppercase; margin-bottom:14px; padding-bottom:8px; border-bottom:1px solid #f1f5f9; }
  .grid2 { display:grid; grid-template-columns:1fr 1fr; gap:14px; }
  .grid3 { display:grid; grid-template-columns:1fr 1fr 1fr; gap:14px; }
  .col2  { grid-column:span 2; }
  .col3  { grid-column:span 3; }
  .field { display:flex; flex-direction:column; gap:5px; }
  .field label { font-size:10px; font-weight:800; color:#64748b; letter-spacing:.06em; text-transform:uppercase; }
  .field input,.field select,.field textarea { border:1px solid #e5e7eb; border-radius:10px; padding:9px 10px; font-size:13px; font-family:inherit; width:100%; box-sizing:border-box; background:#fff; }
  .field input:focus,.field select:focus,.field textarea:focus { outline:none; border-color:#f97316; box-shadow:0 0 0 3px rgba(249,115,22,.12); }
  .field textarea { resize:vertical; min-height:68px; }
  .btn { border:0; border-radius:10px; padding:9px 16px; font-weight:700; cursor:pointer; font-size:13px; font-family:inherit; transition:opacity .15s; }
  .btn:disabled { opacity:.5; cursor:not-allowed; }
  .btn-primary { background:#f97316; color:#fff; }
  .btn-primary:hover:not(:disabled) { opacity:.88; }
  .btn-ghost  { background:#f1f5f9; color:#0b1220; }
  .btn-ghost:hover { background:#e2e8f0; }
  .btn-danger { background:#ef4444; color:#fff; }
  .btn-sm { padding:7px 13px; font-size:12px; }
  .btn-xs { padding:4px 9px; font-size:11px; border-radius:8px; }
  table { width:100%; border-collapse:collapse; }
  th,td { padding:10px 12px; border-bottom:1px solid #f1f5f9; font-size:13px; text-align:left; }
  th    { color:#64748b; font-weight:800; font-size:10px; letter-spacing:.05em; text-transform:uppercase; background:#f8fafc; }
  tr:last-child td { border-bottom:none; }
  tr:hover td { background:#fafafa; }
  .tog-row { display:flex; align-items:center; justify-content:space-between; padding:14px 0; border-bottom:1px solid #f8fafc; }
  .tog-row:last-child { border-bottom:none; }
  .tog-info strong { font-size:13px; font-weight:700; color:#0b1220; display:block; margin-bottom:2px; }
  .tog-info span   { font-size:12px; color:#94a3b8; }
  .tog-sw { position:relative; width:42px; height:24px; flex-shrink:0; cursor:pointer; }
  .tog-sw input { opacity:0; width:0; height:0; position:absolute; }
  .tog-sl { position:absolute; inset:0; background:#e2e8f0; border-radius:999px; transition:.2s; }
  .tog-sl:before { content:''; position:absolute; height:18px; width:18px; left:3px; bottom:3px; background:#fff; border-radius:50%; transition:.2s; box-shadow:0 1px 3px rgba(0,0,0,.2); }
  .tog-sw input:checked + .tog-sl { background:#f97316; }
  .tog-sw input:checked + .tog-sl:before { transform:translateX(18px); }
  .pill     { display:inline-block; padding:3px 10px; border-radius:999px; font-size:11px; font-weight:700; border:1px solid; }
  .save-bar { display:flex; justify-content:flex-end; gap:10px; margin-top:20px; }
  .info-box { background:#eff6ff; border:1px solid #bfdbfe; border-radius:10px; padding:10px 14px; font-size:12px; color:#1d4ed8; margin-bottom:16px; }
  .backdrop { position:fixed; inset:0; background:rgba(15,23,42,.45); display:flex; align-items:center; justify-content:center; padding:16px; z-index:100; }
  .backdrop-fs { padding:0 !important; align-items:stretch !important; }
  .modal    { width:min(480px,98vw); background:#fff; border-radius:16px; display:flex; flex-direction:column; overflow:hidden; box-shadow:0 24px 64px rgba(0,0,0,.25); }
  .modal-h  { display:flex; align-items:center; justify-content:space-between; padding:14px 18px; border-bottom:1px solid #e5e7eb; background:#f8fafc; }
  .modal-h strong { font-size:14px; font-weight:900; }
  .modal-b  { padding:20px; display:flex; flex-direction:column; gap:12px; }
  .modal-f  { display:flex; justify-content:flex-end; gap:10px; padding:12px 18px; border-top:1px solid #e5e7eb; }
  .sp-toast { position:fixed; right:16px; bottom:16px; background:#0b1220; color:#fff; padding:12px 18px; border-radius:12px; font-size:13px; font-weight:600; z-index:999; animation:sp-fade .2s; }
  @keyframes sp-fade { from{opacity:0;transform:translateY(8px)} to{opacity:1;transform:none} }
  .modal-wide { width:min(740px,98vw) !important; }
  .inner-tabs { display:flex; gap:0; border-bottom:2px solid #e5e7eb; margin-bottom:20px; }
  .inner-tab { padding:9px 18px; font-size:13px; font-weight:600; color:#64748b; cursor:pointer; border-bottom:2px solid transparent; margin-bottom:-2px; transition:color .12s,border-color .12s; user-select:none; }
  .inner-tab:hover { color:#0b1220; }
  .inner-tab-on { color:#f97316 !important; border-bottom-color:#f97316 !important; font-weight:800; }
  .route-badge { display:inline-block; padding:2px 9px; border-radius:6px; font-size:11px; font-weight:700; background:#f0fdf4; color:#166534; border:1px solid #bbf7d0; }
  .route-bypass { background:#fff7ed; color:#c2410c; border-color:#fed7aa; }
  .delegate-active { background:#eff6ff; color:#1d4ed8; border:1px solid #bfdbfe; border-radius:6px; padding:2px 9px; font-size:11px; font-weight:700; }
  .delegate-inactive { background:#f8fafc; color:#94a3b8; border:1px solid #e2e8f0; border-radius:6px; padding:2px 9px; font-size:11px; font-weight:700; }
  .modal-fs { width:100vw !important; max-width:100vw !important; height:100vh !important; border-radius:0 !important; margin:0 !important; }
  .modal-fs .modal-b-scroll { flex:1; overflow-y:auto; padding:24px 28px; display:flex; flex-direction:column; gap:16px; }
  .you-badge  { display:inline-block; padding:1px 7px; border-radius:999px; font-size:10px; font-weight:800; background:#eff6ff; color:#1d4ed8; border:1px solid #bfdbfe; flex-shrink:0; }
  .mod-chip   { display:inline-block; padding:2px 8px; border-radius:6px; font-size:10px; font-weight:600; background:#f1f5f9; color:#374151; border:1px solid #e2e8f0; white-space:nowrap; }
  .mod-sec-hdr td { background:#f8fafc; font-weight:900; font-size:10px; color:#64748b; letter-spacing:.08em; text-transform:uppercase; padding:8px 12px; border-bottom:1px solid #e5e7eb; }
`;

function Toggle({ checked, onChange }) {
  return (
    <label className="tog-sw">
      <input type="checkbox" checked={!!checked} onChange={e => onChange(e.target.checked)} />
      <span className="tog-sl" />
    </label>
  );
}

export default function SettingsPage() {
  const [activeSection, setActiveSection] = useState('org-profile');
  const [profileForm, setProfileForm] = useState(null);
  const [moduleForm,  setModuleForm]  = useState(null);
  const [users,        setUsers]        = useState([]);
  const [categories,   setCategories]   = useState([]);
  const [paymentTerms, setPaymentTerms] = useState([]);
  const [userModal,    setUserModal]    = useState(null);
  const [catModal,     setCatModal]     = useState(null);
  const [termModal,    setTermModal]    = useState(null);
  const [confirmModal, setConfirmModal] = useState(null);
  const [saving,        setSaving]        = useState(false);
  const [logoUploading,  setLogoUploading]  = useState(false);
  const [toast,          setToast]          = useState('');
  const [backupModal,   setBackupModal]   = useState(null);
  const [restoreModal,  setRestoreModal]  = useState(null);
  const [resetModal,    setResetModal]    = useState(null);
  const [dataWorking,   setDataWorking]   = useState(false);
  const [counters,      setCounters]      = useState({}); // { periodKey: seq }
  const [seqOverrides,  setSeqOverrides]  = useState({}); // { periodKey: editedSeq }
  // Users & Roles inner tabs
  const [usersRolesTab,     setUsersRolesTab]     = useState('user-list');
  const [approvalRouting,   setApprovalRouting]   = useState({ routes: [], delegates: [] });
  const [routingModal,      setRoutingModal]       = useState(null);
  const [delegateAuthModal, setDelegateAuthModal]  = useState(null);
  const _today = new Date();
  const [selYear,  setSelYear]  = useState(_today.getFullYear());
  const [selMonth, setSelMonth] = useState(_today.getMonth() + 1); // 1-12

  const { isAdmin } = usePermissions();
  const showToast  = msg => { setToast(msg); setTimeout(() => setToast(''), 3000); };
  const askConfirm = (msg, fn) => setConfirmModal({ msg, fn });
  const me = auth.currentUser?.email || '';

  useEffect(() => {
    getDoc(doc(db, 'settings', 'profile')).then(snap => {
      const d = snap.exists() ? snap.data() : {};
      setProfileForm({
        companyName:      d.companyName      || '',
        companyAddress:   d.companyAddress   || '',
        city:             d.city             || '',
        zipCode:          d.zipCode          || '',
        companyTin:       d.companyTin       || '',

        companyEmail:     d.companyEmail     || '',
        companyPhone:     d.companyPhone     || '',
        industry:         d.industry         || 'Services',
        country:          d.country          || 'Philippines',
        fiscalYearStart:  d.fiscalYearStart  || '01',
        logoUrl:          d.logoUrl          || '',
        logoBase64:       d.logoBase64       || '',
        billingWebAppUrl: d.billingWebAppUrl || '',
        voucherNotedBy: d.voucherNotedBy || ''
      });
    });
    getDoc(doc(db, 'settings', 'modules')).then(snap => {
      const d = snap.exists() ? snap.data() : {};
      setModuleForm({
        vcPrefix:     d.vcPrefix     || 'PV',
        cvPrefix:     d.cvPrefix     || 'CV',
        drPrefix:     d.drPrefix     || 'DR',
        wpPrefix:     d.wpPrefix     || 'WP',
        isPrefix:     d.isPrefix     || 'IS',
        bsPrefix:     d.bsPrefix     || 'BS',
        colPrefix:    d.colPrefix    || 'COL',
        cntPrefix:    d.cntPrefix    || 'CNT',
        jePrefix:     d.jePrefix     || 'JE',
        btPrefix:     d.btPrefix     || 'BT',
        psPrefix:     d.psPrefix     || 'PS',
        brPrefix:     d.brPrefix     || 'BREC',
        prPrefix:     d.prPrefix     || 'PR',
        fpPrefix:     d.fpPrefix     || 'FP',
        lvPrefix:     d.lvPrefix     || 'LV',
        chkPrefix:    d.chkPrefix    || 'CHK',
        includeYear:  d.includeYear  !== false,
        includeMonth: d.includeMonth !== false,
        enabledVoucherTypes:    d.enabledVoucherTypes    || [...VOUCHER_TYPES],
        requireVoucherApproval: d.requireVoucherApproval || false,
        requirePurposeCategory: d.requirePurposeCategory || false,
        staleCheckDays:    d.staleCheckDays    || 180,
        requireVoidReason: d.requireVoidReason !== false,
      });
    });
    getDoc(doc(db, 'settings', 'approvalRouting')).then(snap => {
      const d = snap.exists() ? snap.data() : {};
      setApprovalRouting({
        routes:    Array.isArray(d.routes)    ? d.routes    : [],
        delegates: Array.isArray(d.delegates) ? d.delegates : [],
      });
    });
  }, []);

  useEffect(() => {
    const u1 = onSnapshot(query(collection(db, 'appUsers'),          orderBy('email')), s => setUsers(s.docs.map(d => ({id:d.id,...d.data()}))));
    const u2 = onSnapshot(query(collection(db, 'purposeCategories'), orderBy('name')),  s => setCategories(s.docs.map(d => ({id:d.id,...d.data()}))));
    const u3 = onSnapshot(query(collection(db, 'paymentTerms'),      orderBy('days')),  s => setPaymentTerms(s.docs.map(d => ({id:d.id,...d.data()}))));
    const u4 = onSnapshot(collection(db, 'documentCounters'), s => {
      const map = {};
      s.docs.forEach(d => { map[d.id] = Number(d.data()?.seq || 0); });
      setCounters(map);
    });
    return () => { u1(); u2(); u3(); u4(); };
  }, []);

  const saveProfile = async () => {
    setSaving(true);
    try {
      await setDoc(doc(db, 'settings', 'profile'), { ...profileForm, updatedAt:serverTimestamp(), updatedBy:me }, { merge:true });
      showToast('Organization profile saved.');
    } catch(e) { showToast('Error: ' + e.message); }
    setSaving(false);
  };

  const saveModules = async () => {
    setSaving(true);
    try {
      await setDoc(doc(db, 'settings', 'modules'), { ...moduleForm, updatedAt:serverTimestamp(), updatedBy:me }, { merge:true });
      // Persist any admin-edited counter sequences.
      if (isAdmin && Object.keys(seqOverrides).length) {
        const writes = Object.entries(seqOverrides).map(async ([periodKey, val]) => {
          // Field shows the NEXT sequence to be issued; counter stores last-issued (next-1).
          const nextN = Math.max(1, parseInt(val, 10) || 1);
          const seq   = nextN - 1;
          if (seq === (counters[periodKey] || 0)) return;
          // Derive prefix from periodKey by stripping trailing digits (year/month).
          const prefix = periodKey.replace(/\d+$/, '');
          await setDoc(doc(db, 'documentCounters', periodKey), {
            prefix, periodKey, seq, updatedAt: serverTimestamp(), updatedBy: me,
          }, { merge: true });
        });
        await Promise.all(writes);
        setSeqOverrides({});
      }
      invalidateDocIdSettings();
      showToast('Settings saved.');
    } catch(e) { showToast('Error: ' + e.message); }
    setSaving(false);
  };

  const saveUser = async () => {
    if (!userModal?.email?.trim()) return showToast('Email required.');
    if (!userModal?.fullName?.trim()) return showToast('Full Name required.');
    setSaving(true);
    try {
      const { isNew, id, _isMeNotSaved, ...rest } = userModal;
      const treatAsNew = isNew || _isMeNotSaved;
      const data = {
        email:        rest.email.trim().toLowerCase(),
        fullName:     rest.fullName.trim(),
        workEmail:    (rest.workEmail || '').trim(),
        roles:        Array.isArray(rest.roles) ? rest.roles : [],
        moduleAccess: (rest.moduleAccess && typeof rest.moduleAccess === 'object') ? rest.moduleAccess : {},
        signatureUrl: rest.signatureUrl || '',
      };
      if (treatAsNew) {
        // Prevent duplicate — check if email already exists in appUsers
        const dupSnap = await getDocs(query(collection(db, 'appUsers'), where('email', '==', data.email)));
        if (!dupSnap.empty) {
          setSaving(false);
          return showToast('This email is already registered as a user.');
        }
        await addDoc(collection(db, 'appUsers'), { ...data, inviteStatus: 'invited', invitedAt: serverTimestamp(), createdAt:serverTimestamp(), createdBy:me });
        try {
          // Cloud Function creates Auth account + sends branded invitation email
          const createAuthUser = httpsCallable(functions, 'createAuthUser');
          await createAuthUser({ email: data.email, fullName: data.fullName });
          showToast('User saved. Invitation email sent to ' + data.email);
        } catch (emailErr) {
          showToast('User saved, but invitation email failed: ' + emailErr.message);
        }
      } else {
        await updateDoc(doc(db, 'appUsers', id), { ...data, updatedAt:serverTimestamp(), updatedBy:me });
        showToast('User saved.');
      }
      setUserModal(null);
    } catch(e) { showToast('Error: ' + e.message); }
    setSaving(false);
  };

  const resendInvite = async (user) => {
    try {
      // Cloud Function regenerates password-reset link and resends branded invite email
      const createAuthUser = httpsCallable(functions, 'createAuthUser');
      await createAuthUser({ email: user.email, fullName: user.fullName });
      showToast('Invitation resent to ' + user.email);
    } catch (e) {
      showToast('Failed to resend invitation: ' + e.message);
    }
  };

  const saveCat = async () => {
    if (!catModal?.name?.trim()) return showToast('Name required.');
    setSaving(true);
    try {
      const { isNew, id, name } = catModal;
      if (isNew) await addDoc(collection(db, 'purposeCategories'), { name:name.trim(), createdAt:serverTimestamp(), createdBy:me });
      else       await updateDoc(doc(db, 'purposeCategories', id),  { name:name.trim(), updatedAt:serverTimestamp(), updatedBy:me });
      showToast('Category saved.'); setCatModal(null);
    } catch(e) { showToast('Error: ' + e.message); }
    setSaving(false);
  };

  const saveTerm = async () => {
    if (!termModal?.name?.trim()) return showToast('Name required.');
    setSaving(true);
    try {
      const { isNew, id, ...rest } = termModal;
      if (isNew) await addDoc(collection(db, 'paymentTerms'), { ...rest, createdAt:serverTimestamp(), createdBy:me });
      else       await updateDoc(doc(db, 'paymentTerms', id),  { ...rest, updatedAt:serverTimestamp(), updatedBy:me });
      showToast('Payment term saved.'); setTermModal(null);
    } catch(e) { showToast('Error: ' + e.message); }
    setSaving(false);
  };

  const del = (colName, id, label) =>
    askConfirm(`Delete "${label}"?`, async () => {
      await deleteDoc(doc(db, colName, id));
      showToast('Deleted.');
    });

  const saveApprovalRouting = async (newData) => {
    setSaving(true);
    try {
      const clean = { routes: newData.routes || [], delegates: newData.delegates || [] };
      await setDoc(doc(db, 'settings', 'approvalRouting'), { ...clean, updatedAt: serverTimestamp(), updatedBy: me }, { merge: true });
      setApprovalRouting(clean);
      showToast('Approval routing saved.');
    } catch(e) { showToast('Error: ' + e.message); }
    setSaving(false);
  };

  function OrgProfile() {
    if (!profileForm) return <div style={{padding:40,textAlign:'center',color:'#94a3b8'}}>Loading…</div>;
    const up = (k, v) => setProfileForm(f => ({ ...f, [k]: v }));
    const handleLogoUpload = async (e) => {
      const file = e.target.files?.[0];
      if (!file) return;
      if (!file.type.startsWith('image/')) return showToast('Please select an image file.');
      setLogoUploading(true);
      try {
        // Convert to base64 data URL (used by PDF generator without CORS issues)
        const base64 = await new Promise((res, rej) => {
          const reader = new FileReader();
          reader.onload = () => res(reader.result);
          reader.onerror = rej;
          reader.readAsDataURL(file);
        });
        const sRef = storageRef(storage, 'settings/company-logo');
        await uploadBytes(sRef, file);
        const url = await getDownloadURL(sRef);
        up('logoUrl', url);
        up('logoBase64', base64);
        showToast('Logo uploaded.');
      } catch(err) { showToast('Upload failed: ' + err.message); }
      setLogoUploading(false);
    };
    return (
      <>
        <div className="sp-ch">
          <h1>Organization Profile</h1>
          <p>Basic information about your company — shown on all documents and used system-wide.</p>
        </div>
        <div className="sp-card">
          <div className="sp-card-title">Company Details</div>
          <div className="grid2">
            <div className="field col2"><label>Company Name *</label><input value={profileForm.companyName} onChange={e=>up('companyName',e.target.value)} placeholder="Workscale Resources Inc." /></div>
            <div className="field col2"><label>Address</label><textarea rows={2} value={profileForm.companyAddress} onChange={e=>up('companyAddress',e.target.value)} /></div>
            <div className="field"><label>City</label><input value={profileForm.city} onChange={e=>up('city',e.target.value)} placeholder="e.g. Makati City" /></div>
            <div className="field"><label>Zip Code</label><input value={profileForm.zipCode} onChange={e=>up('zipCode',e.target.value)} placeholder="e.g. 1200" /></div>
            <div className="field"><label>TIN</label><input value={profileForm.companyTin} onChange={e=>up('companyTin',formatTin(e.target.value))} placeholder="000-000-000-000" inputMode="numeric" /></div>
            <div className="field"><label>Email</label><input type="email" value={profileForm.companyEmail} onChange={e=>up('companyEmail',e.target.value)} /></div>
            <div className="field"><label>Phone</label><input value={profileForm.companyPhone} onChange={e=>up('companyPhone',e.target.value)} /></div>
            <div className="field">
              <label>Industry</label>
              <select value={profileForm.industry} onChange={e=>up('industry',e.target.value)}>
                {['Services','Manufacturing','Trading','Construction','Agriculture','Healthcare','Education','Government','Other'].map(i=><option key={i}>{i}</option>)}
              </select>
            </div>
            <div className="field"><label>Country</label><input value={profileForm.country} onChange={e=>up('country',e.target.value)} /></div>
            <div className="field">
              <label>Fiscal Year Start</label>
              <select value={profileForm.fiscalYearStart} onChange={e=>up('fiscalYearStart',e.target.value)}>
                {MONTHS.map((m,i)=><option key={i} value={String(i+1).padStart(2,'0')}>{m}</option>)}
              </select>
            </div>
          </div>
          <div style={{marginTop:20,paddingTop:16,borderTop:'1px solid #f1f5f9'}}>
            <div style={{fontSize:10,fontWeight:900,color:'#94a3b8',letterSpacing:'.06em',textTransform:'uppercase',marginBottom:10}}>Company Logo</div>
            <div style={{display:'flex',alignItems:'center',gap:16}}>
              {profileForm.logoUrl
                ? <img src={profileForm.logoUrl} alt="logo" style={{height:64,width:120,objectFit:'contain',borderRadius:10,border:'1px solid #e5e7eb',background:'#f8fafc',padding:6}} onError={e=>{e.target.style.display='none';}} />
                : <div style={{height:64,width:120,borderRadius:10,border:'2px dashed #e5e7eb',background:'#f8fafc',display:'flex',alignItems:'center',justifyContent:'center',fontSize:11,color:'#94a3b8'}}>No logo</div>
              }
              <div style={{display:'flex',flexDirection:'column',gap:6}}>
                <label className="btn btn-ghost btn-sm" style={{cursor: logoUploading ? 'not-allowed' : 'pointer',display:'inline-flex',alignItems:'center',gap:6,opacity: logoUploading ? .5 : 1}}>
                  {logoUploading ? 'Uploading…' : '📁 Upload Logo'}
                  <input type="file" accept="image/*" style={{display:'none'}} disabled={logoUploading} onChange={handleLogoUpload} />
                </label>
                {profileForm.logoUrl && <button className="btn btn-xs" style={{background:'#fef2f2',color:'#dc2626',border:'none',cursor:'pointer'}} onClick={()=>up('logoUrl','')}>Remove</button>}
                <span style={{fontSize:11,color:'#94a3b8'}}>PNG, JPG or SVG. Shown on documents.</span>
              </div>
            </div>
          </div>
        </div>
        <div className="sp-card">
          <div className="sp-card-title">Document Signatories</div>
          <p style={{fontSize:12,color:'#64748b',marginBottom:16}}>"Reviewed by" and "Approved by" are automatically pulled from Approval Routing (Users &amp; Roles). Only "Noted by" is configured here.</p>
          <div className="grid2">
            <div className="field"><label>Noted by</label><input value={profileForm.voucherNotedBy} onChange={e=>up('voucherNotedBy',e.target.value)} placeholder="Full name" /></div>
          </div>
        </div>
        <div className="save-bar">
          <button className="btn btn-primary" disabled={saving} onClick={saveProfile}>{saving?'Saving…':'Save Profile'}</button>
        </div>
      </>
    );
  }

  function UsersRoles() {
    const meEmail = (auth.currentUser?.email || '').toLowerCase();
    const meInList = users.some(u => (u.email || '').toLowerCase() === meEmail);
    const displayUsers = meInList ? users : [
      {
        id: '__me__',
        email: auth.currentUser?.email || '',
        fullName: auth.currentUser?.displayName || '',
        workEmail: '',
        roles: ['Admin'],
        moduleAccess: {},
        signatureUrl: '',
        _isMeNotSaved: true,
      },
      ...users,
    ];

    const openInvite = () => setUserModal({
      isNew: true, id: null,
      email: '', fullName: '', workEmail: '',
      roles: [], moduleAccess: {}, signatureUrl: '',
    });

    // Helper: get display name for a user by email
    const nameFor = (email) => {
      const u = users.find(x => (x.email || '').toLowerCase() === (email || '').toLowerCase());
      return u ? (u.fullName || u.displayName || email) : (email || '—');
    };

    // Users eligible to be Verifiers (has Verifier or Admin role)
    const verifierUsers = users.filter(u => {
      const r = Array.isArray(u.roles) ? u.roles : [];
      return r.includes('Verifier') || r.includes('Admin');
    });
    // Users eligible to be Approvers (has Approver or Admin role)
    const approverUsers = users.filter(u => {
      const r = Array.isArray(u.roles) ? u.roles : [];
      return r.includes('Approver') || r.includes('Admin');
    });
    // Users eligible to be Makers
    const makerUsers = users.filter(u => {
      const r = Array.isArray(u.roles) ? u.roles : [];
      return r.includes('Maker') || r.includes('Admin');
    });
    // All verifier+approver users (for delegate delegator list)
    const verifierApproverUsers = users.filter(u => {
      const r = Array.isArray(u.roles) ? u.roles : [];
      return r.includes('Verifier') || r.includes('Approver') || r.includes('Admin');
    });

    // ── Approval Routing helpers ──
    const openAddRoute = () => setRoutingModal({
      isNew: true, id: null,
      documentType: ROUTING_DOC_TYPES[0],
      makerEmail: '',
      verifierEmail: '',
      approverEmail: '',
    });

    const openEditRoute = (route) => setRoutingModal({ isNew: false, ...route });

    const saveRoute = async () => {
      if (!routingModal.makerEmail)    return showToast('Maker is required.');
      if (!routingModal.approverEmail) return showToast('Approver is required.');
      const isAutoBypass = routingModal.makerEmail === routingModal.verifierEmail;
      const routeData = {
        id:            routingModal.id || crypto.randomUUID(),
        documentType:  routingModal.documentType,
        makerEmail:    routingModal.makerEmail,
        verifierEmail: isAutoBypass ? '' : (routingModal.verifierEmail || ''),
        approverEmail: routingModal.approverEmail,
        autoBypass:    isAutoBypass || !routingModal.verifierEmail,
      };
      const existing = approvalRouting.routes.filter(r => r.id !== routeData.id);
      await saveApprovalRouting({ ...approvalRouting, routes: [...existing, routeData] });
      setRoutingModal(null);
    };

    const deleteRoute = (id) =>
      askConfirm('Delete this routing rule?', async () => {
        await saveApprovalRouting({ ...approvalRouting, routes: approvalRouting.routes.filter(r => r.id !== id) });
      });

    // ── Delegate Authorization helpers ──
    const openAddDelegate = () => setDelegateAuthModal({
      isNew: true, id: null,
      delegatorEmail: '',
      delegateEmail: '',
      documentTypes: [...ROUTING_DOC_TYPES],
      fromDate: '',
      toDate: '',
      isActive: true,
    });

    const openEditDelegate = (d) => setDelegateAuthModal({ isNew: false, ...d, documentTypes: Array.isArray(d.documentTypes) ? [...d.documentTypes] : [...ROUTING_DOC_TYPES] });

    const saveDelegate = async () => {
      if (!delegateAuthModal.delegatorEmail) return showToast('Delegator is required.');
      if (!delegateAuthModal.delegateEmail)  return showToast('Delegate is required.');
      if (delegateAuthModal.delegatorEmail === delegateAuthModal.delegateEmail) return showToast('Delegator and Delegate must be different users.');
      const delData = {
        id:             delegateAuthModal.id || crypto.randomUUID(),
        delegatorEmail: delegateAuthModal.delegatorEmail,
        delegateEmail:  delegateAuthModal.delegateEmail,
        documentTypes:  delegateAuthModal.documentTypes || [],
        fromDate:       delegateAuthModal.fromDate || '',
        toDate:         delegateAuthModal.toDate || '',
        isActive:       delegateAuthModal.isActive !== false,
      };
      const existing = approvalRouting.delegates.filter(d => d.id !== delData.id);
      await saveApprovalRouting({ ...approvalRouting, delegates: [...existing, delData] });
      setDelegateAuthModal(null);
    };

    const deleteDelegate = (id) =>
      askConfirm('Remove this delegation?', async () => {
        await saveApprovalRouting({ ...approvalRouting, delegates: approvalRouting.delegates.filter(d => d.id !== id) });
      });

    const toggleDelegateActive = async (id) => {
      const updated = approvalRouting.delegates.map(d => d.id === id ? { ...d, isActive: !d.isActive } : d);
      await saveApprovalRouting({ ...approvalRouting, delegates: updated });
    };

    // ── TAB: User List ──
    const renderUserList = () => (
      <div className="sp-card" style={{overflow:'hidden'}}>
        <div className="info-box">
          <strong>Role guide:</strong>&nbsp;
          <strong style={{color:'#0369a1'}}>Maker</strong> = create/edit drafts &nbsp;·&nbsp;
          <strong style={{color:'#065f46'}}>Verifier</strong> = review documents &nbsp;·&nbsp;
          <strong style={{color:'#1d4ed8'}}>Approver</strong> = approve / reject &nbsp;·&nbsp;
          <strong style={{color:'#7e22ce'}}>Poster</strong> = post to ledger &nbsp;·&nbsp;
          <strong style={{color:'#991b1b'}}>Admin</strong> = full access (inherits Maker + Verifier + Approver + Poster for <em>all</em> modules)
        </div>
        <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:14}}>
          <span style={{fontSize:12,color:'#64748b'}}>{displayUsers.length} user{displayUsers.length!==1?'s':''} configured</span>
          <button className="btn btn-primary btn-sm" onClick={openInvite}>+ Invite User</button>
        </div>
        <div style={{overflowX:'auto'}}>
          <table style={{minWidth:900}}>
            <thead>
              <tr>
                <th>GOOGLE ACCOUNT EMAIL</th>
                <th>FULL NAME</th>
                <th>WORK EMAIL</th>
                <th>ROLES</th>
                <th>MODULE ACCESS</th>
                <th>SIGNATURE</th>
                <th style={{textAlign:'center'}}>ACTIONS</th>
              </tr>
            </thead>
            <tbody>
              {displayUsers.length === 0 && (
                <tr><td colSpan={7} style={{padding:28,textAlign:'center',color:'#94a3b8'}}>No users configured.</td></tr>
              )}
              {displayUsers.map(u => {
                const isMe = (u.email || '').toLowerCase() === meEmail;
                const userRoles = Array.isArray(u.roles) ? u.roles : u.role ? [u.role] : [];
                const modAccess = (u.moduleAccess && typeof u.moduleAccess === 'object') ? u.moduleAccess : {};
                const accessedModules = Object.entries(modAccess).filter(([, roles]) => Array.isArray(roles) && roles.length > 0);
                return (
                  <tr key={u.id}>
                    <td>
                      <div style={{display:'flex',alignItems:'center',gap:6,flexWrap:'wrap'}}>
                        <span style={{fontWeight:600}}>{u.email}</span>
                        {isMe && <span className="you-badge">You</span>}
                        {u._isMeNotSaved && <span style={{fontSize:10,color:'#f97316',fontWeight:700}}>(unsaved)</span>}
                      </div>
                    </td>
                    <td style={{fontWeight:500}}>{u.fullName || u.displayName || '—'}</td>
                    <td style={{color:'#64748b',fontSize:12}}>{u.workEmail || '—'}</td>
                    <td>
                      <div style={{display:'flex',gap:4,flexWrap:'wrap'}}>
                        {userRoles.length === 0
                          ? <span style={{color:'#94a3b8',fontSize:12}}>—</span>
                          : userRoles.map(r => {
                              const rs = ROLE_STYLE[r] || ROLE_STYLE.VIEWER;
                              return <span key={r} className="pill" style={rs}>{r}</span>;
                            })
                        }
                      </div>
                    </td>
                    <td>
                      {accessedModules.length === 0
                        ? <span style={{color:'#94a3b8',fontSize:12}}>—</span>
                        : userRoles.includes('Admin')
                          ? <span style={{fontSize:12,fontWeight:700,color:'#991b1b'}}>All modules</span>
                          : <span style={{fontSize:12,color:'#374151',fontWeight:600}}>{accessedModules.length} module{accessedModules.length !== 1 ? 's' : ''}
                              <span style={{display:'block',fontSize:11,color:'#94a3b8',fontWeight:400,marginTop:2,maxWidth:160,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}
                                title={accessedModules.map(([m]) => m).join(', ')}>
                                {accessedModules.map(([m]) => m).join(', ')}
                              </span>
                            </span>
                      }
                    </td>
                    <td>
                      {u.signatureUrl
                        ? <a href={u.signatureUrl} target="_blank" rel="noreferrer" style={{color:'#f97316',fontSize:12,fontWeight:600}}>View ↗</a>
                        : <span style={{color:'#94a3b8',fontSize:12}}>None</span>
                      }
                    </td>
                    <td style={{textAlign:'center'}}>
                      <div style={{display:'flex',gap:4,justifyContent:'center'}}>
                        <button className="btn btn-ghost btn-xs" onClick={() => setUserModal({
                          isNew: false, ...u,
                          roles:        Array.isArray(u.roles) ? u.roles : u.role ? [u.role] : [],
                          moduleAccess: (u.moduleAccess && typeof u.moduleAccess === 'object') ? u.moduleAccess : {},
                          fullName:     u.fullName || u.displayName || '',
                        })}>✏️ Edit</button>
                        {!isMe && u.inviteStatus === 'invited' && (
                          <button className="btn btn-xs" style={{background:'#fff7ed',color:'#ea580c',border:'1px solid #fed7aa',cursor:'pointer',borderRadius:8}}
                            onClick={() => resendInvite(u)}>📨 Resend Invite</button>
                        )}
                        {!isMe && (
                          <button className="btn btn-xs" style={{background:'#fef2f2',color:'#dc2626',border:'none',cursor:'pointer',borderRadius:8}}
                            onClick={() => del('appUsers', u.id, u.email)}>🗑</button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    );

    // ── TAB: Approval Routing ──
    const renderApprovalRouting = () => (
      <>
        {/* Routing Rules */}
        <div className="sp-card">
          <div className="sp-card-title">Routing Rules</div>
          <div className="info-box" style={{marginBottom:14}}>
            Define who verifies and approves each document type per Maker.
            Only <strong>Verifier</strong> and <strong>Approver</strong> roles can be linked to a Maker.
            If a Maker is also assigned as their own Verifier, verification is <strong>auto-bypassed</strong> and the document routes directly to the Approver.
          </div>
          <div style={{display:'flex',justifyContent:'flex-end',marginBottom:12}}>
            <button className="btn btn-primary btn-sm" onClick={openAddRoute}>+ Add Routing Rule</button>
          </div>
          <div style={{overflowX:'auto'}}>
            <table style={{minWidth:820}}>
              <thead>
                <tr>
                  <th>DOCUMENT TYPE</th>
                  <th>MAKER</th>
                  <th>VERIFIER</th>
                  <th>APPROVER</th>
                  <th>STATUS</th>
                  <th style={{textAlign:'center'}}>ACTIONS</th>
                </tr>
              </thead>
              <tbody>
                {approvalRouting.routes.length === 0 && (
                  <tr><td colSpan={6} style={{padding:28,textAlign:'center',color:'#94a3b8'}}>No routing rules configured.</td></tr>
                )}
                {[...approvalRouting.routes]
                  .sort((a,b) => (a.documentType||'').localeCompare(b.documentType||'') || (a.makerEmail||'').localeCompare(b.makerEmail||''))
                  .map(route => {
                    const bypass = route.autoBypass || !route.verifierEmail;
                    return (
                      <tr key={route.id}>
                        <td><span className="mod-chip">{route.documentType}</span></td>
                        <td style={{fontWeight:600,fontSize:13}}>{nameFor(route.makerEmail)}<div style={{fontSize:11,color:'#94a3b8'}}>{route.makerEmail}</div></td>
                        <td>
                          {bypass
                            ? <span style={{color:'#94a3b8',fontSize:12,fontStyle:'italic'}}>— (bypassed)</span>
                            : <><span style={{fontWeight:500}}>{nameFor(route.verifierEmail)}</span><div style={{fontSize:11,color:'#94a3b8'}}>{route.verifierEmail}</div></>
                          }
                        </td>
                        <td><span style={{fontWeight:500}}>{nameFor(route.approverEmail)}</span><div style={{fontSize:11,color:'#94a3b8'}}>{route.approverEmail}</div></td>
                        <td>
                          {bypass
                            ? <span className="route-badge route-bypass">Auto-bypass</span>
                            : <span className="route-badge">Active</span>
                          }
                        </td>
                        <td style={{textAlign:'center'}}>
                          <div style={{display:'flex',gap:4,justifyContent:'center'}}>
                            <button className="btn btn-ghost btn-xs" onClick={() => openEditRoute(route)}>✏️ Edit</button>
                            <button className="btn btn-xs" style={{background:'#fef2f2',color:'#dc2626',border:'none',cursor:'pointer',borderRadius:8}} onClick={() => deleteRoute(route.id)}>🗑</button>
                          </div>
                        </td>
                      </tr>
                    );
                  })
                }
              </tbody>
            </table>
          </div>
        </div>

        {/* Delegate Authorization */}
        <div className="sp-card">
          <div className="sp-card-title">Delegate Authorization</div>
          <div className="info-box" style={{marginBottom:14}}>
            When a Verifier or Approver is absent, they can authorize another user to act on their behalf for specific document types within a defined period.
            The delegate must be a registered user. The original approver's routing rules still apply — the delegate simply fulfils the action.
          </div>
          <div style={{display:'flex',justifyContent:'flex-end',marginBottom:12}}>
            <button className="btn btn-primary btn-sm" onClick={openAddDelegate}>+ Add Delegation</button>
          </div>
          <div style={{overflowX:'auto'}}>
            <table style={{minWidth:860}}>
              <thead>
                <tr>
                  <th>ABSENT USER (DELEGATOR)</th>
                  <th>ACTING AS (DELEGATE)</th>
                  <th>DOCUMENT TYPES</th>
                  <th>PERIOD</th>
                  <th>STATUS</th>
                  <th style={{textAlign:'center'}}>ACTIONS</th>
                </tr>
              </thead>
              <tbody>
                {approvalRouting.delegates.length === 0 && (
                  <tr><td colSpan={6} style={{padding:28,textAlign:'center',color:'#94a3b8'}}>No delegations configured.</td></tr>
                )}
                {[...approvalRouting.delegates]
                  .sort((a,b) => (a.delegatorEmail||'').localeCompare(b.delegatorEmail||''))
                  .map(d => {
                    const today = new Date().toISOString().slice(0,10);
                    const withinPeriod = (!d.fromDate || d.fromDate <= today) && (!d.toDate || d.toDate >= today);
                    const effectivelyActive = d.isActive && withinPeriod;
                    return (
                      <tr key={d.id}>
                        <td>
                          <span style={{fontWeight:600}}>{nameFor(d.delegatorEmail)}</span>
                          <div style={{fontSize:11,color:'#94a3b8'}}>{d.delegatorEmail}</div>
                        </td>
                        <td>
                          <span style={{fontWeight:500}}>{nameFor(d.delegateEmail)}</span>
                          <div style={{fontSize:11,color:'#94a3b8'}}>{d.delegateEmail}</div>
                        </td>
                        <td>
                          <div style={{display:'flex',gap:4,flexWrap:'wrap'}}>
                            {(d.documentTypes||[]).map(dt => <span key={dt} className="mod-chip">{dt}</span>)}
                          </div>
                        </td>
                        <td style={{fontSize:12,color:'#374151'}}>
                          {d.fromDate || d.toDate
                            ? <>{d.fromDate || '—'} → {d.toDate || '—'}</>
                            : <span style={{color:'#94a3b8'}}>No limit</span>
                          }
                        </td>
                        <td>
                          <span
                            className={effectivelyActive ? 'delegate-active' : 'delegate-inactive'}
                            style={{cursor:'pointer'}}
                            title={d.isActive && !withinPeriod ? 'Outside scheduled period' : undefined}
                            onClick={() => toggleDelegateActive(d.id)}
                          >
                            {effectivelyActive ? '● Active' : d.isActive && !withinPeriod ? '○ Off-period' : '○ Inactive'}
                          </span>
                        </td>
                        <td style={{textAlign:'center'}}>
                          <div style={{display:'flex',gap:4,justifyContent:'center'}}>
                            <button className="btn btn-ghost btn-xs" onClick={() => openEditDelegate(d)}>✏️ Edit</button>
                            <button className="btn btn-xs" style={{background:'#fef2f2',color:'#dc2626',border:'none',cursor:'pointer',borderRadius:8}} onClick={() => deleteDelegate(d.id)}>🗑</button>
                          </div>
                        </td>
                      </tr>
                    );
                  })
                }
              </tbody>
            </table>
          </div>
        </div>
      </>
    );

    return (
      <>
        <div className="sp-ch">
          <h1>Users &amp; Roles</h1>
          <p>Control who can access the Finance Portal and what they can do. Only invited users can log in.</p>
        </div>

        {/* Inner tabs */}
        <div className="inner-tabs">
          {[
            { id: 'user-list',        label: '👥 User List' },
            { id: 'approval-routing', label: '🔀 Approval Routing' },
          ].map(t => (
            <div key={t.id}
              className={`inner-tab${usersRolesTab === t.id ? ' inner-tab-on' : ''}`}
              onClick={() => setUsersRolesTab(t.id)}
            >
              {t.label}
              {t.id === 'approval-routing' && approvalRouting.routes.length > 0 && (
                <span style={{marginLeft:6,background:'#f97316',color:'#fff',borderRadius:999,padding:'1px 7px',fontSize:10,fontWeight:800}}>
                  {approvalRouting.routes.length}
                </span>
              )}
            </div>
          ))}
        </div>

        {usersRolesTab === 'user-list'        && renderUserList()}
        {usersRolesTab === 'approval-routing' && renderApprovalRouting()}

        {/* Routing Rule Modal */}
        {routingModal && (
          <div className="backdrop" onClick={() => setRoutingModal(null)}>
            <div className="modal modal-wide" style={{maxHeight:'90vh',display:'flex',flexDirection:'column'}} onClick={e => e.stopPropagation()}>
              <div className="modal-h">
                <strong>{routingModal.isNew ? '➕ Add Routing Rule' : '✏️ Edit Routing Rule'}</strong>
                <button className="btn btn-ghost btn-sm" onClick={() => setRoutingModal(null)}>✕</button>
              </div>
              <div className="modal-b" style={{overflowY:'auto'}}>
                <div className="field">
                  <label>Document Type *</label>
                  <select value={routingModal.documentType} onChange={e => setRoutingModal(m => ({ ...m, documentType: e.target.value }))}>
                    {ROUTING_DOC_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                  </select>
                </div>
                <div className="field">
                  <label>Maker *</label>
                  <select value={routingModal.makerEmail} onChange={e => setRoutingModal(m => ({ ...m, makerEmail: e.target.value }))}>
                    <option value="">— Select Maker —</option>
                    {makerUsers.map(u => <option key={u.id} value={u.email}>{u.fullName || u.email} ({u.email})</option>)}
                  </select>
                </div>
                <div className="field">
                  <label>Verifier</label>
                  <select value={routingModal.verifierEmail} onChange={e => setRoutingModal(m => ({ ...m, verifierEmail: e.target.value }))}>
                    <option value="">— None (auto-bypass to Approver) —</option>
                    {verifierUsers.map(u => <option key={u.id} value={u.email}>{u.fullName || u.email} ({u.email})</option>)}
                  </select>
                  {routingModal.verifierEmail && routingModal.makerEmail && routingModal.verifierEmail === routingModal.makerEmail && (
                    <div style={{background:'#fff7ed',border:'1px solid #fed7aa',borderRadius:8,padding:'8px 12px',fontSize:12,color:'#c2410c',marginTop:4}}>
                      ⚠️ This Maker is also the selected Verifier. Verification will be <strong>auto-bypassed</strong> — the document will route directly to the Approver.
                    </div>
                  )}
                </div>
                <div className="field">
                  <label>Approver *</label>
                  <select value={routingModal.approverEmail} onChange={e => setRoutingModal(m => ({ ...m, approverEmail: e.target.value }))}>
                    <option value="">— Select Approver —</option>
                    {approverUsers.map(u => <option key={u.id} value={u.email}>{u.fullName || u.email} ({u.email})</option>)}
                  </select>
                </div>
              </div>
              <div className="modal-f">
                <button className="btn btn-ghost" onClick={() => setRoutingModal(null)}>Cancel</button>
                <button className="btn btn-primary" disabled={saving} onClick={saveRoute}>{saving ? 'Saving…' : 'Save Rule'}</button>
              </div>
            </div>
          </div>
        )}

        {/* Delegate Authorization Modal */}
        {delegateAuthModal && (
          <div className="backdrop" onClick={() => setDelegateAuthModal(null)}>
            <div className="modal modal-wide" style={{maxHeight:'90vh',display:'flex',flexDirection:'column'}} onClick={e => e.stopPropagation()}>
              <div className="modal-h">
                <strong>{delegateAuthModal.isNew ? '➕ Add Delegation' : '✏️ Edit Delegation'}</strong>
                <button className="btn btn-ghost btn-sm" onClick={() => setDelegateAuthModal(null)}>✕</button>
              </div>
              <div className="modal-b" style={{overflowY:'auto'}}>
                <div className="field">
                  <label>Absent User (Delegator) *</label>
                  <select value={delegateAuthModal.delegatorEmail} onChange={e => setDelegateAuthModal(m => ({ ...m, delegatorEmail: e.target.value }))}>
                    <option value="">— Select Verifier / Approver —</option>
                    {verifierApproverUsers.map(u => <option key={u.id} value={u.email}>{u.fullName || u.email} ({u.email})</option>)}
                  </select>
                  <span style={{fontSize:11,color:'#94a3b8'}}>The Verifier or Approver who is temporarily absent.</span>
                </div>
                <div className="field">
                  <label>Acting As (Delegate) *</label>
                  <select value={delegateAuthModal.delegateEmail} onChange={e => setDelegateAuthModal(m => ({ ...m, delegateEmail: e.target.value }))}>
                    <option value="">— Select user to act on their behalf —</option>
                    {users.filter(u => u.email !== delegateAuthModal.delegatorEmail).map(u => <option key={u.id} value={u.email}>{u.fullName || u.email} ({u.email})</option>)}
                  </select>
                  <span style={{fontSize:11,color:'#94a3b8'}}>This user will receive and action the documents in place of the absent user.</span>
                </div>
                <div className="field">
                  <label>Document Types</label>
                  <div style={{display:'flex',gap:8,flexWrap:'wrap',padding:'8px 0'}}>
                    {ROUTING_DOC_TYPES.map(dt => {
                      const checked = (delegateAuthModal.documentTypes || []).includes(dt);
                      return (
                        <label key={dt} style={{display:'flex',alignItems:'center',gap:5,cursor:'pointer',fontSize:13,color:'#374151'}}>
                          <input type="checkbox" checked={checked}
                            onChange={() => {
                              const cur = delegateAuthModal.documentTypes || [];
                              setDelegateAuthModal(m => ({ ...m, documentTypes: checked ? cur.filter(x => x !== dt) : [...cur, dt] }));
                            }}
                            style={{accentColor:'#f97316',cursor:'pointer'}}
                          />
                          {dt}
                        </label>
                      );
                    })}
                  </div>
                  <span style={{fontSize:11,color:'#94a3b8'}}>Leave all checked to delegate all document types.</span>
                </div>
                <div className="grid2">
                  <div className="field">
                    <label>From Date</label>
                    <input type="date" value={delegateAuthModal.fromDate || ''} onChange={e => setDelegateAuthModal(m => ({ ...m, fromDate: e.target.value }))} />
                  </div>
                  <div className="field">
                    <label>To Date</label>
                    <input type="date" value={delegateAuthModal.toDate || ''} onChange={e => setDelegateAuthModal(m => ({ ...m, toDate: e.target.value }))} />
                  </div>
                </div>
                <span style={{fontSize:11,color:'#94a3b8'}}>Leave dates blank for an open-ended delegation. The delegation is only effective while <em>Active</em> and within the specified period.</span>
                <div style={{display:'flex',alignItems:'center',gap:10,paddingTop:4}}>
                  <Toggle checked={delegateAuthModal.isActive} onChange={v => setDelegateAuthModal(m => ({ ...m, isActive: v }))} />
                  <span style={{fontSize:13,fontWeight:600,color: delegateAuthModal.isActive ? '#065f46' : '#94a3b8'}}>
                    {delegateAuthModal.isActive ? 'Active' : 'Inactive'}
                  </span>
                </div>
              </div>
              <div className="modal-f">
                <button className="btn btn-ghost" onClick={() => setDelegateAuthModal(null)}>Cancel</button>
                <button className="btn btn-primary" disabled={saving} onClick={saveDelegate}>{saving ? 'Saving…' : 'Save Delegation'}</button>
              </div>
            </div>
          </div>
        )}
      </>
    );
  }

  function SetupConfig() {
    if (!moduleForm) return <div style={{padding:40,textAlign:'center',color:'#94a3b8'}}>Loading…</div>;
    const up = (k,v) => setModuleForm(f=>({...f,[k]:v}));

    // Compute the period key for a given prefix using the live
    // include-year/month toggles AND the admin-selected period (year/month),
    // so each month has its own counter — matching how IDs are issued
    // from the document's own date.
    const currentPeriodKey = (rawPrefix) => {
      const prefix = String(rawPrefix || '').toUpperCase();
      let key = prefix;
      if (moduleForm.includeYear)  key += String(selYear);
      if (moduleForm.includeMonth) key += String(selMonth).padStart(2, '0');
      return key;
    };
    const seqValue = (rawPrefix) => {
      const pk = currentPeriodKey(rawPrefix);
      if (Object.prototype.hasOwnProperty.call(seqOverrides, pk)) return seqOverrides[pk];
      // Display the NEXT sequence (what will appear on the next saved document),
      // i.e. counter + 1. When nothing has been issued yet, this is 1.
      return (counters[pk] || 0) + 1;
    };
    const onSeqChange = (rawPrefix, v) => {
      if (!isAdmin) return;
      const pk = currentPeriodKey(rawPrefix);
      setSeqOverrides(o => ({ ...o, [pk]: v.replace(/[^\d]/g, '') }));
    };

    const PREFIX_FIELDS = [
      ['Payment Voucher',     'vcPrefix',  'PV'],
      ['Check Voucher',       'cvPrefix',  'CV'],
      ['Disbursement Report', 'drPrefix',  'DR'],
      ['Weekly Projection',   'wpPrefix',  'WP'],
      ['Service Invoice',     'isPrefix',  'IS'],
      ['Billing Statement',   'bsPrefix',  'BS'],
      ['Collection',          'colPrefix', 'COL'],
      ['Contact',             'cntPrefix', 'CNT'],
      ['Journal Entry',       'jePrefix',  'JE'],
      ['Bank Transaction',    'btPrefix',  'BT'],
      ['Payment Schedule',    'psPrefix',  'PS'],
      ['Bank Reconciliation', 'brPrefix',  'BREC'],
      ['Payroll Voucher',     'prPrefix',  'PR'],
      ['Final Pay Voucher',   'fpPrefix',  'FP'],
      ['Loan Voucher',        'lvPrefix',  'LV'],
      ['Check Number Tag',    'chkPrefix', 'CHK'],
    ];

    return (
      <>
        <div className="sp-ch"><h1>Setup & Configurations</h1><p>Document ID prefixes and numbering format applied across all modules. Each month has its own counter — pick a period below to view or edit its Next Sequence{isAdmin?'':' (read-only — Admins can edit)'}.</p></div>
        <div className="sp-card">
          <div className="sp-card-title">Document ID Prefixes</div>
          {(moduleForm.includeYear || moduleForm.includeMonth) && (
            <div style={{display:'flex',alignItems:'center',gap:12,marginBottom:14,padding:'10px 12px',background:'#f8fafc',border:'1px solid #e2e8f0',borderRadius:6}}>
              <strong style={{fontSize:12,color:'#475569'}}>Period:</strong>
              {moduleForm.includeMonth && (
                <select value={selMonth} onChange={e=>setSelMonth(parseInt(e.target.value,10))} style={{padding:'4px 8px'}}>
                  {MONTHS.map((m,i)=><option key={i+1} value={i+1}>{m}</option>)}
                </select>
              )}
              {moduleForm.includeYear && (
                <select value={selYear} onChange={e=>setSelYear(parseInt(e.target.value,10))} style={{padding:'4px 8px'}}>
                  {Array.from({length:11},(_,i)=>_today.getFullYear()-5+i).map(y=>(
                    <option key={y} value={y}>{y}</option>
                  ))}
                </select>
              )}
              <button
                type="button"
                onClick={()=>{ setSelYear(_today.getFullYear()); setSelMonth(_today.getMonth()+1); }}
                style={{marginLeft:'auto',padding:'4px 10px',fontSize:11,border:'1px solid #cbd5e1',background:'#fff',borderRadius:4,cursor:'pointer'}}
              >Today</button>
            </div>
          )}
          <div className="grid3">
            {PREFIX_FIELDS.map(([label, key, ph]) => {
              const pk    = currentPeriodKey(moduleForm[key] || ph);
              const next  = seqValue(moduleForm[key] || ph);
              const dirty = Object.prototype.hasOwnProperty.call(seqOverrides, pk);
              return (
                <div className="field" key={key}>
                  <label>{label}</label>
                  <div style={{display:'flex',gap:6}}>
                    <input
                      style={{flex:'1 1 auto',minWidth:0}}
                      value={moduleForm[key]}
                      onChange={e=>up(key,e.target.value)}
                      placeholder={ph}
                    />
                    <input
                      style={{width:90,fontFamily:'monospace',textAlign:'right',background:isAdmin?(dirty?'#fef3c7':'#fff'):'#f1f5f9',color:isAdmin?'#0b1220':'#64748b'}}
                      value={String(next).padStart(4,'0')}
                      onChange={e=>onSeqChange(moduleForm[key] || ph, e.target.value)}
                      readOnly={!isAdmin}
                      title={isAdmin ? `Next sequence for ${pk}. The next saved document will use this value.` : `Next sequence for ${pk}. Only Admins can edit.`}
                      placeholder="0001"
                    />
                  </div>
                  <div style={{fontSize:10,color:'#94a3b8',marginTop:4,fontFamily:'monospace'}}>
                    {pk}-{String(next).padStart(4,'0')} (next)
                  </div>
                </div>
              );
            })}
          </div>
        </div>
        <div className="sp-card">
          <div className="sp-card-title">ID Format Options</div>
          <div className="tog-row">
            <div className="tog-info"><strong>Include Year in Document IDs</strong><span>e.g. PV2026-0001</span></div>
            <Toggle checked={moduleForm.includeYear} onChange={v=>up('includeYear',v)} />
          </div>
          <div className="tog-row">
            <div className="tog-info"><strong>Include Month in Document IDs</strong><span>e.g. PV202605-0001</span></div>
            <Toggle checked={moduleForm.includeMonth} onChange={v=>up('includeMonth',v)} />
          </div>
        </div>
        <div className="save-bar">
          <button className="btn btn-primary" disabled={saving} onClick={saveModules}>{saving?'Saving…':'Save Configuration'}</button>
        </div>
      </>
    );
  }

  function ModVouchers() {
    if (!moduleForm) return <div style={{padding:40,textAlign:'center',color:'#94a3b8'}}>Loading…</div>;
    const up = (k,v) => setModuleForm(f=>({...f,[k]:v}));
    const toggleType = type => {
      const cur  = moduleForm.enabledVoucherTypes || [];
      const next = cur.includes(type) ? cur.filter(t=>t!==type) : [...cur, type];
      setModuleForm(f=>({...f,enabledVoucherTypes:next}));
    };
    return (
      <>
        <div className="sp-ch"><h1>Vouchers</h1><p>Control which voucher types are available and configure voucher workflow rules.</p></div>
        <div className="sp-card">
          <div className="sp-card-title">Enabled Voucher Types</div>
          <div style={{display:'flex',gap:10,flexWrap:'wrap',marginBottom:10}}>
            {VOUCHER_TYPES.map(type=>{
              const on=(moduleForm.enabledVoucherTypes||[]).includes(type);
              return (
                <button key={type} className="btn btn-sm" onClick={()=>toggleType(type)}
                  style={{border:`2px solid ${on?'#f97316':'#e5e7eb'}`,background:on?'#fff7ed':'#f8fafc',color:on?'#f97316':'#64748b',fontWeight:on?800:500}}>
                  {on?'✓ ':''}{type}
                </button>
              );
            })}
          </div>
          <div style={{fontSize:12,color:'#94a3b8'}}>Click a type to enable or disable it across the portal.</div>
        </div>
        <div className="sp-card">
          <div className="sp-card-title">Workflow Rules</div>
          <div className="tog-row">
            <div className="tog-info"><strong>Require Approval Before Payment</strong><span>Vouchers must be approved before being marked as Paid</span></div>
            <Toggle checked={moduleForm.requireVoucherApproval} onChange={v=>up('requireVoucherApproval',v)} />
          </div>
          <div className="tog-row">
            <div className="tog-info"><strong>Require Purpose / Category</strong><span>The Purpose field is mandatory when creating a voucher</span></div>
            <Toggle checked={moduleForm.requirePurposeCategory} onChange={v=>up('requirePurposeCategory',v)} />
          </div>
        </div>
        <div className="save-bar">
          <button className="btn btn-primary" disabled={saving} onClick={saveModules}>{saving?'Saving…':'Save Voucher Settings'}</button>
        </div>
      </>
    );
  }

  function ModChecks() {
    if (!moduleForm) return <div style={{padding:40,textAlign:'center',color:'#94a3b8'}}>Loading…</div>;
    const up = (k,v) => setModuleForm(f=>({...f,[k]:v}));
    return (
      <>
        <div className="sp-ch"><h1>Check Registry</h1><p>Configure check lifecycle policies and stale-check detection rules.</p></div>
        <div className="sp-card">
          <div className="sp-card-title">Lifecycle Rules</div>
          <div className="tog-row">
            <div className="tog-info"><strong>Require Void Reason</strong><span>A reason must be entered when voiding a check</span></div>
            <Toggle checked={moduleForm.requireVoidReason} onChange={v=>up('requireVoidReason',v)} />
          </div>
        </div>
        <div className="sp-card">
          <div className="sp-card-title">Stale Check Policy</div>
          <div className="field" style={{maxWidth:260,marginBottom:10}}>
            <label>Stale Check Threshold (Days)</label>
            <input type="number" min="1" value={moduleForm.staleCheckDays||180} onChange={e=>up('staleCheckDays',parseInt(e.target.value)||180)} />
          </div>
          <div style={{fontSize:12,color:'#94a3b8'}}>Issued checks older than this threshold will be flagged when you run <strong>"Flag Stale"</strong> in Check Registry. Default: 180 days.</div>
        </div>
        <div className="save-bar">
          <button className="btn btn-primary" disabled={saving} onClick={saveModules}>{saving?'Saving…':'Save Check Settings'}</button>
        </div>
      </>
    );
  }

  function RefCategories() {
    return (
      <>
        <div className="sp-ch"><h1>Purpose Categories</h1><p>Expense and purpose categories used across Vouchers and Check Registry dropdowns.</p></div>
        <div className="sp-card">
          <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:14}}>
            <span style={{fontSize:12,color:'#64748b'}}>{categories.length} categor{categories.length!==1?'ies':'y'}</span>
            <button className="btn btn-primary btn-sm" onClick={()=>setCatModal({isNew:true,id:null,name:''})}>+ Add Category</button>
          </div>
          <table>
            <thead><tr><th>CATEGORY NAME</th><th style={{textAlign:'center'}}>ACTIONS</th></tr></thead>
            <tbody>
              {categories.length===0&&<tr><td colSpan={2} style={{padding:28,textAlign:'center',color:'#94a3b8'}}>No categories yet.</td></tr>}
              {categories.map(c=>(
                <tr key={c.id}>
                  <td style={{fontWeight:500}}>{c.name}</td>
                  <td style={{textAlign:'center'}}>
                    <div style={{display:'flex',gap:4,justifyContent:'center'}}>
                      <button className="btn btn-ghost btn-xs" onClick={()=>setCatModal({isNew:false,id:c.id,name:c.name})}>Edit</button>
                      <button className="btn btn-xs" style={{background:'#fef2f2',color:'#dc2626',border:'none',cursor:'pointer',borderRadius:8}} onClick={()=>del('purposeCategories',c.id,c.name)}>Delete</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </>
    );
  }

  function RefPaymentTerms() {
    return (
      <>
        <div className="sp-ch"><h1>Payment Terms</h1><p>Standard due-date terms used on invoices and billing (e.g. Net 30, Due on Receipt).</p></div>
        <div className="sp-card">
          <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:14}}>
            <span style={{fontSize:12,color:'#64748b'}}>{paymentTerms.length} term{paymentTerms.length!==1?'s':''}</span>
            <button className="btn btn-primary btn-sm" onClick={()=>setTermModal({isNew:true,id:null,name:'',days:30,description:''})}>+ Add Term</button>
          </div>
          <table>
            <thead><tr><th>NAME</th><th>DUE (DAYS)</th><th>DESCRIPTION</th><th style={{textAlign:'center'}}>ACTIONS</th></tr></thead>
            <tbody>
              {paymentTerms.length===0&&<tr><td colSpan={4} style={{padding:28,textAlign:'center',color:'#94a3b8'}}>No payment terms defined.</td></tr>}
              {paymentTerms.map(t=>(
                <tr key={t.id}>
                  <td style={{fontWeight:700}}>{t.name}</td>
                  <td style={{color:'#f97316',fontWeight:700}}>{t.days}d</td>
                  <td style={{color:'#64748b',fontSize:12}}>{t.description||'—'}</td>
                  <td style={{textAlign:'center'}}>
                    <div style={{display:'flex',gap:4,justifyContent:'center'}}>
                      <button className="btn btn-ghost btn-xs" onClick={()=>setTermModal({isNew:false,...t})}>Edit</button>
                      <button className="btn btn-xs" style={{background:'#fef2f2',color:'#dc2626',border:'none',cursor:'pointer',borderRadius:8}} onClick={()=>del('paymentTerms',t.id,t.name)}>Delete</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </>
    );
  }

  // ── Data helpers ─────────────────────────────────────────────────────────
  const doBackup = async (selected) => {
    setDataWorking(true);
    try {
      const selectedModules = ALL_MODULES_FLAT.filter(m => selected.has(m.label));
      const backupCollections = {};
      const backupSingleDocs = {};
      for (const mod of selectedModules) {
        for (const collName of mod.collections) {
          const snap = await getDocs(collection(db, collName));
          backupCollections[collName] = snap.docs.map(d => ({ id: d.id, ...serializeData(d.data()) }));
        }
        for (const { coll, id } of (mod.singleDocs || [])) {
          const snap = await getDoc(doc(db, coll, id));
          if (snap.exists()) backupSingleDocs[`${coll}/${id}`] = serializeData(snap.data());
        }
      }
      const settingsData = {};
      if (selected.has('Settings (Config)')) {
        const profSnap = await getDoc(doc(db, 'settings', 'profile'));
        const modSnap  = await getDoc(doc(db, 'settings', 'modules'));
        if (profSnap.exists()) settingsData.profile = serializeData(profSnap.data());
        if (modSnap.exists())  settingsData.modules  = serializeData(modSnap.data());
      }
      const backup = {
        version: '1.0',
        app: 'workscale-finance',
        exportedAt: new Date().toISOString(),
        exportedBy: me,
        modules: [...selected],
        collections: backupCollections,
        singleDocs: backupSingleDocs,
        settings: settingsData,
      };
      const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement('a');
      a.href = url;
      a.download = `workscale-backup-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      showToast('Backup downloaded successfully.');
      setBackupModal(null);
    } catch (e) { showToast('Backup failed: ' + e.message); }
    setDataWorking(false);
  };

  const doRestore = async (parsed) => {
    setDataWorking(true);
    try {
      for (const [collName, docs] of Object.entries(parsed.collections || {})) {
        for (let i = 0; i < docs.length; i += 499) {
          const batch = writeBatch(db);
          docs.slice(i, i + 499).forEach(({ id, ...data }) => {
            batch.set(doc(db, collName, id), data);
          });
          await batch.commit();
        }
      }
      for (const [path, data] of Object.entries(parsed.singleDocs || {})) {
        const [coll, id] = path.split('/');
        await setDoc(doc(db, coll, id), data, { merge: true });
      }
      if (parsed.settings?.profile) await setDoc(doc(db, 'settings', 'profile'), parsed.settings.profile, { merge: true });
      if (parsed.settings?.modules)  await setDoc(doc(db, 'settings', 'modules'),  parsed.settings.modules,  { merge: true });
      showToast('Data restored successfully.');
      setRestoreModal(null);
    } catch (e) { showToast('Restore failed: ' + e.message); }
    setDataWorking(false);
  };

  const doReset = async () => {
    setDataWorking(true);
    try {
      for (const mod of ALL_MODULES_FLAT) {
        for (const collName of mod.collections) {
          const snap = await getDocs(collection(db, collName));
          const refs = snap.docs.map(d => d.ref);
          for (let i = 0; i < refs.length; i += 499) {
            const batch = writeBatch(db);
            refs.slice(i, i + 499).forEach(ref => batch.delete(ref));
            await batch.commit();
          }
        }
        for (const { coll, id } of (mod.singleDocs || [])) {
          try { await deleteDoc(doc(db, coll, id)); } catch (_) {}
        }
      }
      try { await deleteDoc(doc(db, 'settings', 'profile')); } catch (_) {}
      try { await deleteDoc(doc(db, 'settings', 'modules')); } catch (_) {}
      try { await deleteObject(storageRef(storage, 'settings/company-logo')); } catch (_) {}
      showToast('All data has been permanently deleted.');
      setResetModal(null);
    } catch (e) { showToast('Reset failed: ' + e.message); }
    setDataWorking(false);
  };

  // ── DataSettings section ──────────────────────────────────────────────────
  function DataSettings() {
    if (!isAdmin) {
      return (
        <>
          <div className="sp-ch"><h1>Data Settings</h1><p>Backup, restore, or permanently reset all data across the portal.</p></div>
          <div style={{background:'#fef2f2',border:'1px solid #fecaca',borderRadius:12,padding:'20px 22px',display:'flex',alignItems:'flex-start',gap:14}}>
            <span style={{fontSize:22,flexShrink:0}}>🔒</span>
            <div>
              <strong style={{fontSize:14,color:'#991b1b',display:'block',marginBottom:4}}>Admin Only</strong>
              <span style={{fontSize:13,color:'#b91c1c'}}>Only Admins can access Data Settings.</span>
            </div>
          </div>
        </>
      );
    }
    return (
      <>
        <div className="sp-ch">
          <h1>Data Settings</h1>
          <p>Backup, restore, or permanently reset all data across the portal. Accessible to Admins only.</p>
        </div>

        {/* Backup */}
        <div className="sp-card">
          <div className="sp-card-title">Backup Data</div>
          <p style={{margin:'0 0 14px',fontSize:13,color:'#374151',lineHeight:1.6}}>
            Download a full or selective backup of your data as a JSON file. The backup is compatible with the Restore Data feature.
          </p>
          <button className="btn btn-primary btn-sm" onClick={() => setBackupModal({ selected: new Set(ALL_MODULE_LABELS) })}>
            📥 Backup Data
          </button>
        </div>

        {/* Restore */}
        <div className="sp-card">
          <div className="sp-card-title">Restore Data</div>
          <p style={{margin:'0 0 14px',fontSize:13,color:'#374151',lineHeight:1.6}}>
            Restore data from a previously exported backup file. Existing records with the same ID will be overwritten; new records will be added.
          </p>
          <label className="btn btn-ghost btn-sm" style={{cursor:'pointer',display:'inline-flex',alignItems:'center',gap:6}}>
            📤 Select Backup File
            <input type="file" accept=".json" style={{display:'none'}} onChange={e => {
              const file = e.target.files?.[0];
              if (!file) return;
              const reader = new FileReader();
              reader.onload = ev => {
                try {
                  const parsed = JSON.parse(ev.target.result);
                  if (!parsed.version || parsed.app !== 'workscale-finance') {
                    showToast('Invalid backup file. Only Workscale Finance backups are accepted.');
                    return;
                  }
                  setRestoreModal({ file, parsed });
                } catch { showToast('Could not parse the file. Ensure it is a valid JSON backup.'); }
              };
              reader.readAsText(file);
              e.target.value = '';
            }} />
          </label>
        </div>

        {/* Complete Reset */}
        <div className="sp-card" style={{borderColor:'#fecaca'}}>
          <div className="sp-card-title" style={{color:'#ef4444'}}>⚠️ Complete Reset Data</div>
          <p style={{margin:'0 0 12px',fontSize:13,color:'#374151',lineHeight:1.6}}>
            Permanently delete <strong>all data</strong> across every module — vouchers, journal entries, bank records, billing, invoices, collections, contacts, and settings.{' '}
            <strong style={{color:'#dc2626'}}>This action cannot be undone.</strong>
          </p>
          <div style={{background:'#fef2f2',border:'1px solid #fecaca',borderRadius:10,padding:'10px 14px',fontSize:12,color:'#991b1b',marginBottom:14}}>
            We strongly recommend downloading a backup before performing a reset.
          </div>
          <button className="btn btn-danger btn-sm" onClick={() => setResetModal({ confirmText: '' })}>
            🗑️ Complete Reset Data
          </button>
        </div>
      </>
    );
  }

  const SECTIONS = {
    'org-profile':       OrgProfile,
    'users-roles':       UsersRoles,
    'setup-config':      SetupConfig,
    'mod-vouchers':      ModVouchers,
    'mod-checks':        ModChecks,
    'ref-categories':    RefCategories,
    'ref-payment-terms': RefPaymentTerms,
    'data-settings':     DataSettings,
  };

  return (
    <div className="sp">
      <style>{CSS}</style>

      <div className="sp-sidebar">
        <div className="sp-sb-hdr">
          <h2>Settings</h2>
          <p>Workscale Finance Portal</p>
        </div>
        {NAV.map(group => (
          <div key={group.group}>
            <div className="sp-grp-lbl">{group.group}</div>
            {group.items
              .filter(item => !item.adminOnly || isAdmin)
              .map(item => (
              <div key={item.id}
                className={`sp-nav${activeSection===item.id?' sp-nav-on':''}`}
                onClick={()=>setActiveSection(item.id)}>
                <span className="sp-nav-ico">{item.icon}</span>
                {item.label}
              </div>
            ))}
          </div>
        ))}
      </div>

      <div className="sp-content">
        {SECTIONS[activeSection] ? SECTIONS[activeSection]() : null}
      </div>

      {userModal && (
        <div className="backdrop backdrop-fs" onClick={()=>setUserModal(null)}>
          <div className="modal modal-fs" onClick={e=>e.stopPropagation()}>
            <div className="modal-h">
              <strong>{userModal.isNew ? '✉️ Invite User' : '✏️ Edit User'}</strong>
              <button className="btn btn-ghost btn-sm" onClick={()=>setUserModal(null)}>✕</button>
            </div>
            <div className="modal-b-scroll">

              {/* ── Basic Information ── */}
              <div style={{fontSize:10,fontWeight:900,color:'#94a3b8',letterSpacing:'.08em',textTransform:'uppercase',paddingBottom:6,borderBottom:'1px solid #f1f5f9'}}>
                Basic Information
              </div>
              <div className="grid2">
                <div className="field col2">
                  <label>Google Account Email *</label>
                  <input type="email" value={userModal.email}
                    disabled={!userModal.isNew}
                    onChange={e=>setUserModal(m=>({...m,email:e.target.value}))}
                    placeholder="user@gmail.com" autoFocus={userModal.isNew} />
                  {userModal.isNew && <span style={{fontSize:11,color:'#94a3b8'}}>Must be a valid Google / Gmail account. The user will log in with this email.</span>}
                </div>
                <div className="field">
                  <label>Full Name *</label>
                  <input value={userModal.fullName||''} onChange={e=>setUserModal(m=>({...m,fullName:e.target.value}))}
                    placeholder="First M. Last" autoFocus={!userModal.isNew} />
                </div>
                <div className="field">
                  <label>Work Email</label>
                  <input type="email" value={userModal.workEmail||''} onChange={e=>setUserModal(m=>({...m,workEmail:e.target.value}))}
                    placeholder="user@company.com" />
                </div>
              </div>

              {/* ── Roles ── */}
              <div style={{fontSize:10,fontWeight:900,color:'#94a3b8',letterSpacing:'.08em',textTransform:'uppercase',paddingBottom:6,borderBottom:'1px solid #f1f5f9',marginTop:4}}>
                Roles
              </div>
              <div style={{display:'flex',gap:8,flexWrap:'wrap'}}>
                {GLOBAL_ROLES.map(r => {
                  const active = (userModal.roles||[]).includes(r);
                  const rs = ROLE_STYLE[r] || ROLE_STYLE.VIEWER;
                  return (
                    <button key={r} type="button"
                      onClick={()=>setUserModal(m=>{
                        const adding = !active;
                        const newRoles = adding ? [...(m.roles||[]),r] : (m.roles||[]).filter(x=>x!==r);
                        const allMods = MODULE_GROUPS.flatMap(g => g.modules);
                        let newModuleAccess;
                        if (r === 'Admin') {
                          // Admin on  → grant every role to every module
                          // Admin off → clear every module access (clean slate)
                          newModuleAccess = Object.fromEntries(
                            allMods.map(mod => [mod, adding ? [...ADMIN_INHERITS] : []])
                          );
                        } else {
                          // Non-admin role: add/remove only that specific role per module
                          newModuleAccess = Object.fromEntries(allMods.map(mod => {
                            const cur = ((m.moduleAccess||{})[mod]) || [];
                            return [mod, adding ? (cur.includes(r) ? cur : [...cur, r]) : cur.filter(x=>x!==r)];
                          }));
                        }
                        return { ...m, roles: newRoles, moduleAccess: newModuleAccess };
                      })}
                      style={{
                        ...rs,
                        cursor:'pointer',
                        border: `2px solid ${active ? rs.borderColor : '#e5e7eb'}`,
                        background: active ? rs.background : '#f8fafc',
                        color: active ? rs.color : '#94a3b8',
                        fontWeight: active ? 800 : 500,
                        padding:'5px 14px', fontSize:12, borderRadius:999,
                        transition:'all .12s',
                      }}>
                      {active ? '✓ ' : ''}{r}
                    </button>
                  );
                })}
              </div>

              {/* ── Module Access ── */}
              <div style={{fontSize:10,fontWeight:900,color:'#94a3b8',letterSpacing:'.08em',textTransform:'uppercase',paddingBottom:6,borderBottom:'1px solid #f1f5f9',marginTop:4}}>
                Module Access &amp; Permissions
              </div>

              {/* Admin full-access banner */}
              {(userModal.roles||[]).includes('Admin') && (
                <div style={{background:'#fef2f2',border:'1px solid #fecaca',borderRadius:10,padding:'10px 14px',fontSize:12,color:'#991b1b',display:'flex',alignItems:'center',gap:8}}>
                  <span style={{fontSize:16}}>🛡️</span>
                  <div>
                    <strong>Admin — Full Access</strong>
                    <div style={{fontSize:11,color:'#b91c1c',marginTop:1}}>
                      Admin inherits Maker, Verifier, Approver, and Poster for all modules. All permissions are automatically granted.
                    </div>
                  </div>
                </div>
              )}

              <div style={{overflowX:'auto',border:'1px solid #e5e7eb',borderRadius:10}}>
                <table style={{minWidth:520,fontSize:12,margin:0}}>
                  <thead>
                    <tr>
                      <th style={{width:160,fontSize:10,background:'#f8fafc'}}>MODULE</th>
                      {MODULE_ROLES.map(r=>(
                        <th key={r} style={{textAlign:'center',width:76,fontSize:10,background:'#f8fafc'}}>{r.toUpperCase()}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {MODULE_GROUPS.flatMap(({group, modules}) => [
                      <tr key={`grp-${group}`} className="mod-sec-hdr">
                        <td colSpan={MODULE_ROLES.length + 1}>{group}</td>
                      </tr>,
                      ...modules.map(mod => {
                        const isAdminUser = (userModal.roles||[]).includes('Admin');
                        const modRoles = isAdminUser ? [...ADMIN_INHERITS] : (((userModal.moduleAccess||{})[mod]) || []);
                        return (
                          <tr key={mod} style={isAdminUser?{opacity:.75}:{}}>
                            <td style={{paddingLeft:20,fontWeight:500,color:'#374151'}}>{mod}</td>
                            {MODULE_ROLES.map(r => {
                              const checked = modRoles.includes(r);
                              return (
                                <td key={r} style={{textAlign:'center'}}>
                                  <input type="checkbox" checked={checked}
                                    disabled={isAdminUser}
                                    title={isAdminUser ? 'Granted via Admin role' : undefined}
                                    onChange={()=>{
                                      if (isAdminUser) return;
                                      const cur = ((userModal.moduleAccess||{})[mod]) || [];
                                      const next = checked ? cur.filter(x=>x!==r) : [...cur,r];
                                      setUserModal(m=>({
                                        ...m,
                                        moduleAccess:{...(m.moduleAccess||{}),[mod]:next},
                                      }));
                                    }}
                                    style={{width:15,height:15,cursor:isAdminUser?'not-allowed':'pointer',accentColor:'#f97316'}}
                                  />
                                </td>
                              );
                            })}
                          </tr>
                        );
                      }),
                    ])}
                  </tbody>
                </table>
              </div>

              {/* ── Signature ── */}
              <div style={{fontSize:10,fontWeight:900,color:'#94a3b8',letterSpacing:'.08em',textTransform:'uppercase',paddingBottom:6,borderBottom:'1px solid #f1f5f9',marginTop:4}}>
                Signature
              </div>
              <div className="field">
                <label>Signature Image URL</label>
                <input value={userModal.signatureUrl||''} onChange={e=>setUserModal(m=>({...m,signatureUrl:e.target.value}))}
                  placeholder="https://…" />
                {userModal.signatureUrl && (
                  <img src={userModal.signatureUrl} alt="signature preview"
                    style={{maxHeight:56,marginTop:6,border:'1px solid #e5e7eb',borderRadius:8,padding:4,objectFit:'contain'}}
                    onError={e=>{e.target.style.display='none';}} />
                )}
              </div>

            </div>
            <div className="modal-f">
              <button className="btn btn-ghost" onClick={()=>setUserModal(null)}>Cancel</button>
              <button className="btn btn-primary" disabled={saving} onClick={saveUser}>
                {saving ? 'Saving…' : userModal.isNew ? 'Send Invite' : 'Save Changes'}
              </button>
            </div>
          </div>
        </div>
      )}

      {catModal && (
        <div className="backdrop" onClick={()=>setCatModal(null)}>
          <div className="modal" onClick={e=>e.stopPropagation()}>
            <div className="modal-h">
              <strong>{catModal.isNew?'Add Category':'Edit Category'}</strong>
              <button className="btn btn-ghost btn-sm" onClick={()=>setCatModal(null)}>✕</button>
            </div>
            <div className="modal-b">
              <div className="field"><label>Category Name *</label><input value={catModal.name} onChange={e=>setCatModal(m=>({...m,name:e.target.value}))} placeholder="e.g. Office Supplies" autoFocus /></div>
            </div>
            <div className="modal-f">
              <button className="btn btn-ghost" onClick={()=>setCatModal(null)}>Cancel</button>
              <button className="btn btn-primary" disabled={saving} onClick={saveCat}>{saving?'Saving…':'Save'}</button>
            </div>
          </div>
        </div>
      )}

      {termModal && (
        <div className="backdrop" onClick={()=>setTermModal(null)}>
          <div className="modal" onClick={e=>e.stopPropagation()}>
            <div className="modal-h">
              <strong>{termModal.isNew?'Add Payment Term':'Edit Payment Term'}</strong>
              <button className="btn btn-ghost btn-sm" onClick={()=>setTermModal(null)}>✕</button>
            </div>
            <div className="modal-b">
              <div className="field"><label>Term Name *</label><input value={termModal.name||''} onChange={e=>setTermModal(m=>({...m,name:e.target.value}))} placeholder="e.g. Net 30" autoFocus /></div>
              <div className="field"><label>Due in (Days) *</label><input type="number" min="0" value={termModal.days||30} onChange={e=>setTermModal(m=>({...m,days:parseInt(e.target.value)||0}))} /></div>
              <div className="field"><label>Description</label><input value={termModal.description||''} onChange={e=>setTermModal(m=>({...m,description:e.target.value}))} placeholder="e.g. Payment due within 30 days" /></div>
            </div>
            <div className="modal-f">
              <button className="btn btn-ghost" onClick={()=>setTermModal(null)}>Cancel</button>
              <button className="btn btn-primary" disabled={saving} onClick={saveTerm}>{saving?'Saving…':'Save'}</button>
            </div>
          </div>
        </div>
      )}

      {confirmModal && (
        <div className="backdrop" onClick={()=>setConfirmModal(null)}>
          <div style={{width:'min(400px,98vw)',background:'#fff',borderRadius:16,overflow:'hidden',boxShadow:'0 24px 64px rgba(0,0,0,.25)'}} onClick={e=>e.stopPropagation()}>
            <div style={{padding:'14px 18px',borderBottom:'1px solid #e5e7eb',background:'#f8fafc',display:'flex',alignItems:'center',justifyContent:'space-between'}}>
              <strong style={{fontSize:14,fontWeight:900}}>Confirm</strong>
              <button className="btn btn-ghost btn-sm" onClick={()=>setConfirmModal(null)}>✕</button>
            </div>
            <div style={{padding:'18px'}}><p style={{margin:0,fontSize:14,lineHeight:1.5}}>{confirmModal.msg}</p></div>
            <div style={{display:'flex',justifyContent:'flex-end',gap:10,padding:'12px 18px',borderTop:'1px solid #e5e7eb'}}>
              <button className="btn btn-ghost" onClick={()=>setConfirmModal(null)}>Cancel</button>
              <button className="btn btn-danger" onClick={()=>{confirmModal.fn();setConfirmModal(null);}}>Confirm</button>
            </div>
          </div>
        </div>
      )}

      {toast && <div className="sp-toast">{toast}</div>}

      {/* ── Backup Modal ── */}
      {backupModal && (
        <div className="backdrop" onClick={() => !dataWorking && setBackupModal(null)}>
          <div className="modal modal-wide" onClick={e => e.stopPropagation()}>
            <div className="modal-h">
              <strong>📥 Backup Data</strong>
              <button className="btn btn-ghost btn-sm" disabled={dataWorking} onClick={() => setBackupModal(null)}>✕</button>
            </div>
            <div className="modal-b" style={{maxHeight:'55vh',overflowY:'auto'}}>
              <p style={{margin:0,fontSize:13,color:'#374151',lineHeight:1.5}}>
                Select the modules to include in the backup. The file can be used with <strong>Restore Data</strong>.
              </p>
              <div style={{display:'flex',gap:8}}>
                <button className="btn btn-ghost btn-xs" onClick={() => setBackupModal(m => ({ ...m, selected: new Set(ALL_MODULE_LABELS) }))}>Select All</button>
                <button className="btn btn-ghost btn-xs" onClick={() => setBackupModal(m => ({ ...m, selected: new Set() }))}>Deselect All</button>
              </div>
              {MODULE_BACKUP_GROUPS.map(grp => (
                <div key={grp.group}>
                  <div style={{fontSize:10,fontWeight:900,color:'#94a3b8',letterSpacing:'.08em',textTransform:'uppercase',marginBottom:8,paddingBottom:4,borderBottom:'1px solid #f1f5f9'}}>{grp.group}</div>
                  <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:'6px 20px',marginBottom:12}}>
                    {grp.modules.map(mod => (
                      <label key={mod.label} style={{display:'flex',alignItems:'center',gap:7,cursor:'pointer',fontSize:13,color:'#374151',padding:'2px 0'}}>
                        <input type="checkbox"
                          checked={backupModal.selected.has(mod.label)}
                          onChange={e => {
                            const next = new Set(backupModal.selected);
                            if (e.target.checked) next.add(mod.label); else next.delete(mod.label);
                            setBackupModal(m => ({ ...m, selected: next }));
                          }}
                          style={{width:14,height:14,accentColor:'#f97316',cursor:'pointer'}}
                        />
                        {mod.label}
                      </label>
                    ))}
                  </div>
                </div>
              ))}
            </div>
            <div className="modal-f">
              <button className="btn btn-ghost" disabled={dataWorking} onClick={() => setBackupModal(null)}>Cancel</button>
              <button className="btn btn-primary" disabled={dataWorking || backupModal.selected.size === 0} onClick={() => doBackup(backupModal.selected)}>
                {dataWorking ? 'Preparing…' : `📥 Download Backup (${backupModal.selected.size} module${backupModal.selected.size !== 1 ? 's' : ''})`}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Restore Modal ── */}
      {restoreModal && (() => {
        const { parsed } = restoreModal;
        const totalRecords = Object.values(parsed.collections || {}).reduce((s, docs) => s + docs.length, 0);
        const settingsKeys = Object.keys(parsed.settings || {});
        return (
          <div className="backdrop" onClick={() => !dataWorking && setRestoreModal(null)}>
            <div className="modal modal-wide" onClick={e => e.stopPropagation()}>
              <div className="modal-h">
                <strong>📤 Restore Data</strong>
                <button className="btn btn-ghost btn-sm" disabled={dataWorking} onClick={() => setRestoreModal(null)}>✕</button>
              </div>
              <div className="modal-b">
                <div style={{background:'#fffbeb',border:'1px solid #fde68a',borderRadius:10,padding:'12px 14px',fontSize:12,color:'#92400e',lineHeight:1.6}}>
                  ⚠️ <strong>Merge restore:</strong> Existing records with the same ID will be overwritten. Records not in the backup will not be removed.
                </div>
                <div style={{background:'#f8fafc',border:'1px solid #e5e7eb',borderRadius:10,padding:'14px 16px',fontSize:13}}>
                  <div style={{fontWeight:800,color:'#0b1220',marginBottom:6}}>Backup Summary</div>
                  <div style={{display:'grid',gridTemplateColumns:'auto 1fr',gap:'5px 14px',color:'#374151'}}>
                    <span style={{color:'#94a3b8',fontSize:12}}>File</span><span style={{fontWeight:600}}>{restoreModal.file.name}</span>
                    <span style={{color:'#94a3b8',fontSize:12}}>Exported</span><span>{parsed.exportedAt ? new Date(parsed.exportedAt).toLocaleString() : '—'}</span>
                    <span style={{color:'#94a3b8',fontSize:12}}>Exported By</span><span>{parsed.exportedBy || '—'}</span>
                    <span style={{color:'#94a3b8',fontSize:12}}>Modules</span><span>{(parsed.modules || []).join(', ') || '—'}</span>
                    <span style={{color:'#94a3b8',fontSize:12}}>Total Records</span><span style={{fontWeight:700,color:'#f97316'}}>{totalRecords.toLocaleString()}</span>
                    {settingsKeys.length > 0 && <><span style={{color:'#94a3b8',fontSize:12}}>Settings</span><span>{settingsKeys.join(', ')}</span></>}
                  </div>
                </div>
              </div>
              <div className="modal-f">
                <button className="btn btn-ghost" disabled={dataWorking} onClick={() => setRestoreModal(null)}>Cancel</button>
                <button className="btn btn-primary" disabled={dataWorking} onClick={() => doRestore(parsed)}>
                  {dataWorking ? 'Restoring…' : '📤 Restore Now'}
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* ── Reset Modal ── */}
      {resetModal && (
        <div className="backdrop" onClick={() => !dataWorking && setResetModal(null)}>
          <div style={{width:'min(500px,98vw)',background:'#fff',borderRadius:16,overflow:'hidden',boxShadow:'0 24px 64px rgba(0,0,0,.25)'}} onClick={e => e.stopPropagation()}>
            <div style={{padding:'14px 18px',borderBottom:'1px solid #e5e7eb',background:'#fef2f2',display:'flex',alignItems:'center',justifyContent:'space-between'}}>
              <strong style={{fontSize:14,fontWeight:900,color:'#991b1b'}}>⚠️ Complete Reset Data</strong>
              <button className="btn btn-ghost btn-sm" disabled={dataWorking} onClick={() => setResetModal(null)}>✕</button>
            </div>
            <div style={{padding:'20px 20px 14px'}}>
              <div style={{background:'#fef2f2',border:'1px solid #fecaca',borderRadius:10,padding:'12px 14px',marginBottom:16,fontSize:13,color:'#991b1b',lineHeight:1.6}}>
                <strong>This will permanently delete ALL data across every module:</strong>
                <ul style={{margin:'8px 0 0',paddingLeft:18,fontSize:12,color:'#b91c1c',lineHeight:1.8}}>
                  <li>All vouchers, approvals, projections, payment schedules, disbursements, checks</li>
                  <li>All journal entries, bank records, reconciliations, accounts (COA), tax entries, financial management (loans), fixed assets</li>
                  <li>All billing statements, service invoices, collections</li>
                  <li>All contacts, users, purpose categories, payment terms, and settings</li>
                </ul>
              </div>
              <div className="field">
                <label>Type <strong>RESET</strong> to confirm</label>
                <input
                  value={resetModal.confirmText}
                  onChange={e => setResetModal(m => ({ ...m, confirmText: e.target.value }))}
                  placeholder="Type RESET here"
                  autoFocus
                  style={{borderColor: resetModal.confirmText === 'RESET' ? '#ef4444' : undefined}}
                />
              </div>
            </div>
            <div style={{display:'flex',justifyContent:'flex-end',gap:10,padding:'12px 18px',borderTop:'1px solid #e5e7eb'}}>
              <button className="btn btn-ghost" disabled={dataWorking} onClick={() => setResetModal(null)}>Cancel</button>
              <button className="btn btn-danger"
                disabled={resetModal.confirmText !== 'RESET' || dataWorking}
                onClick={doReset}>
                {dataWorking ? 'Deleting all data…' : '🗑️ Delete All Data'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

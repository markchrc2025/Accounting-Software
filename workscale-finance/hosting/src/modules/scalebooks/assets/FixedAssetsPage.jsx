import { useState, useEffect, useRef, useCallback } from 'react';
import { useLocation } from 'react-router-dom';
import { collection, doc, onSnapshot, setDoc, addDoc, getDocs, serverTimestamp, query, orderBy, writeBatch } from 'firebase/firestore';
import AccountCombobox from '../../../components/AccountCombobox.jsx';
import { db, auth } from '../../../firebase.js';
import { issueCheck, getActiveCheckbook } from '../../../utils/issueCheck.js';
import { nextVoucherId } from '../../../utils/documentIds.js';

const DEP_METHODS  = ['Straight Line','Declining Balance','150 Declining Balance','200 Declining Balance'];
const COMP_TYPES   = ['Non Pro Rata','Pro Rata'];
const STATUSES     = ['Active','Disposed'];
const INST_METHODS = ['Reducing Balance','Straight-Line','Fixed','Balloon'];
const PM_METHODS   = ['Check','Auto-Debit','Bank Transfer'];
const MONTH_NAMES  = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

const fmtPHP = n => new Intl.NumberFormat('en-PH',{minimumFractionDigits:2,maximumFractionDigits:2}).format(n||0);
const fmtCur = n => '₱' + fmtPHP(n);

function computeMonthlyDepr(asset, yyyyMM) {
  if (!asset||!yyyyMM||(asset.status||'Active')==='Disposed') return 0;
  const ds = String(asset.deprecStartDate||'').trim();
  if (!ds) return 0;
  const deprecStart = new Date(ds+'T00:00:00');
  if (isNaN(deprecStart.getTime())) return 0;
  const cost=parseFloat(asset.cost)||0, residual=parseFloat(asset.residualValue)||0, lifeMonths=parseInt(asset.usefulLifeMonths)||0;
  if (lifeMonths<=0||cost<=residual) return 0;
  const [yyyy,mm]=yyyyMM.split('-').map(Number);
  const periodStart=new Date(yyyy,mm-1,1), dsStart=new Date(deprecStart.getFullYear(),deprecStart.getMonth(),1);
  if (periodStart<dsStart) return 0;
  const idx=(yyyy-deprecStart.getFullYear())*12+(mm-1-deprecStart.getMonth());
  if (idx<0||idx>=lifeMonths) return 0;
  const method=asset.depreciationMethod||'Straight Line', compType=asset.computationType||'Non Pro Rata';
  function fmd(bv){
    const dep=bv-residual; if(dep<=0) return 0;
    if(method==='Straight Line') return (cost-residual)/lifeMonths;
    const mult=method==='200 Declining Balance'?2:method==='150 Declining Balance'?1.5:1;
    return Math.min(bv*(mult/(lifeMonths/12))/12,dep);
  }
  let bv=cost;
  for(let i=0;i<idx;i++){bv-=fmd(bv);if(bv<residual){bv=residual;break;}}
  if(bv<=residual) return 0;
  let depr=fmd(bv);
  if(compType==='Pro Rata'){
    if(idx===0){const dim=new Date(yyyy,mm,0).getDate();depr*=(dim-deprecStart.getDate()+1)/dim;}
    else if(idx===lifeMonths-1){const dim=new Date(yyyy,mm,0).getDate();const endDay=new Date(deprecStart.getFullYear(),deprecStart.getMonth()+lifeMonths,0).getDate();const endDate=new Date(deprecStart.getFullYear(),deprecStart.getMonth()+lifeMonths-1,endDay);depr*=endDate.getDate()/dim;}
  }
  // Cap so total never exceeds depreciable amount
  let accumulated=0;
  for(let i=0;i<idx;i++){const md=computeMonthlyDepr(asset,String(deprecStart.getFullYear()+(Math.floor((deprecStart.getMonth()+i)/12))).padStart(4,'0')+'-'+String(((deprecStart.getMonth()+i)%12)+1).padStart(2,'0'));accumulated+=md;}
  depr=Math.min(depr,Math.max(0,(cost-residual)-accumulated));
  return Math.round(depr*100)/100;
}

// Compute accumulated depreciation from start up to (but not including) a given YYYY-MM
function computeAccumDepr(asset, upToYYYYMM) {
  if (!asset||!asset.deprecStartDate) return 0;
  const ds=new Date(asset.deprecStartDate+'T00:00:00');
  if(isNaN(ds.getTime())) return 0;
  const [ey,em]=upToYYYYMM.split('-').map(Number);
  const lifeMonths=parseInt(asset.usefulLifeMonths)||0;
  let total=0;
  for(let i=0;i<lifeMonths;i++){
    const yr=ds.getFullYear()+Math.floor((ds.getMonth()+i)/12);
    const mo=((ds.getMonth()+i)%12)+1;
    if(yr>ey||(yr===ey&&mo>=em)) break;
    total+=computeMonthlyDepr(asset,String(yr).padStart(4,'0')+'-'+String(mo).padStart(2,'0'));
  }
  return Math.round(total*100)/100;
}

function computeNBV(asset, asOfYYYYMM) {
  const cost=parseFloat(asset.cost)||0;
  return Math.max(parseFloat(asset.residualValue)||0, cost-computeAccumDepr(asset, asOfYYYYMM));
}

function calcInstData(asset,elapsed){
  const P=parseFloat(asset.installmentPrincipal)||0,r=(parseFloat(asset.installmentAnnualRate)||0)/100/12;
  const term=Math.max(parseInt(asset.installmentTermMonths)||1,1);
  if(elapsed<0||elapsed>=term||P<=0) return null;
  const m=asset.installmentMethod||'Reducing Balance';
  if(m==='Straight-Line'){const pp=P/term,bal=P-pp*elapsed;return{principal:pp,interest:bal*r,balance:bal-pp};}
  if(m==='Fixed'){const pp=P/term,int=P*(parseFloat(asset.installmentAnnualRate)||0)/100/12;return{principal:pp,interest:int,balance:Math.max(P-pp*(elapsed+1),0)};}
  if(m==='Balloon'){const last=elapsed===term-1;return{principal:last?P:0,interest:P*r,balance:last?0:P};}
  if(r===0){const pp=P/term;return{principal:pp,interest:0,balance:Math.max(P-pp*(elapsed+1),0)};}
  const pmt=P*r*Math.pow(1+r,term)/(Math.pow(1+r,term)-1);
  const bal0=P*Math.pow(1+r,elapsed)-pmt*(Math.pow(1+r,elapsed)-1)/r;
  const int=bal0*r,pp=pmt-int;
  return{principal:Math.max(pp,0),interest:Math.max(int,0),balance:Math.max(bal0-pp,0)};
}

function buildInstSchedule(asset){
  if(!asset.isInstallment||!asset.installmentStartDate||!asset.installmentTermMonths) return [];
  const rows=[],base=new Date(asset.installmentStartDate);
  for(let i=0;i<(parseInt(asset.installmentTermMonths)||0);i++){
    const d=calcInstData(asset,i);if(!d) break;
    const m=new Date(base.getFullYear(),base.getMonth()+i,1);
    rows.push({period:i+1,label:MONTH_NAMES[m.getMonth()]+'-'+m.getFullYear(),...d});
  }
  return rows;
}

function allInstYears(assets){
  const yrs=new Set();
  assets.forEach(a=>{
    if(!a.isInstallment||!a.installmentStartDate) return;
    const d=new Date(a.installmentStartDate);if(isNaN(d.getTime())) return;
    for(let i=0;i<(parseInt(a.installmentTermMonths)||0);i++){const m=new Date(d.getFullYear(),d.getMonth()+i,1);yrs.add(m.getFullYear());}
  });
  return [...yrs].sort((a,b)=>a-b);
}

const CSS = `
  .fa-wrap{display:flex;flex-direction:column;height:100%;overflow:hidden;font-family:Inter,system-ui,sans-serif;}
  .fa-topbar{display:flex;align-items:center;justify-content:space-between;padding:14px 22px 10px;flex-shrink:0;border-bottom:1px solid #e5e7eb;background:#fff;gap:12px;}
  .fa-tabs{display:flex;background:#fff;border-bottom:2px solid #e5e7eb;flex-shrink:0;overflow-x:auto;}
  .fa-tab{padding:10px 15px;font-size:12px;font-weight:600;border:none;background:transparent;color:#64748b;cursor:pointer;white-space:nowrap;border-bottom:2px solid transparent;margin-bottom:-2px;font-family:inherit;}
  .fa-tab:hover{color:#0b1220;}
  .fa-tab-active{color:#f97316;border-bottom-color:#f97316;font-weight:800;}
  .fa-body{flex:1;overflow-y:auto;padding:16px 22px;}
  .btn{border:0;border-radius:10px;padding:9px 16px;font-weight:700;cursor:pointer;font-size:13px;font-family:inherit;}
  .btn-primary{background:#f97316;color:#fff;}
  .btn-ghost{background:#f1f5f9;color:#0b1220;}
  .btn-ghost:hover{background:#e2e8f0;}
  .btn-sm{padding:6px 12px;font-size:12px;}
  table{width:100%;border-collapse:collapse;}
  th,td{padding:8px 10px;border-bottom:1px solid #f1f5f9;font-size:12px;text-align:left;}
  th{color:#64748b;font-weight:800;font-size:10px;letter-spacing:.05em;text-transform:uppercase;background:#f8fafc;position:sticky;top:0;z-index:1;}
  tr:hover td{background:#fafafa;}
  tr:last-child td{border-bottom:none;}
  tfoot td{background:#f8fafc;font-weight:900;border-top:2px solid #e5e7eb;}
  .pill{display:inline-block;padding:2px 9px;border-radius:999px;font-size:11px;font-weight:700;border:1px solid;}
  .pill-active{background:#f0fdf4;border-color:#bbf7d0;color:#15803d;}
  .pill-disposed{background:#f8fafc;border-color:#e2e8f0;color:#94a3b8;}
  .pill-inst{background:#eff6ff;border-color:#bfdbfe;color:#1d4ed8;}
  .empty{padding:48px;text-align:center;color:#94a3b8;}
  .backdrop{position:fixed;inset:0;background:rgba(15,23,42,.45);display:flex;align-items:center;justify-content:center;padding:16px;z-index:100;}
  .modal{width:min(820px,98vw);max-height:92vh;background:#fff;border-radius:16px;display:flex;flex-direction:column;overflow:hidden;box-shadow:0 24px 64px rgba(0,0,0,.25);}
  .modal-sm{width:min(660px,98vw);}
  .modal-h{display:flex;align-items:center;justify-content:space-between;padding:16px 20px;border-bottom:1px solid #e5e7eb;background:#f8fafc;flex-shrink:0;gap:8px;}
  .modal-b{padding:20px;overflow-y:auto;flex:1;}
  .modal-f{display:flex;justify-content:flex-end;gap:10px;padding:14px 20px;border-top:1px solid #e5e7eb;flex-shrink:0;}
  .grid4{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:14px;}
  .col2{grid-column:span 2;}.col3{grid-column:span 3;}.col4{grid-column:span 4;}
  .field{display:flex;flex-direction:column;gap:5px;}
  .field label{font-size:10px;font-weight:800;color:#64748b;letter-spacing:.06em;text-transform:uppercase;}
  .field input,.field select{width:100%;border:1px solid #e5e7eb;border-radius:10px;padding:9px 10px;font-size:13px;background:#fff;font-family:inherit;box-sizing:border-box;}
  .sec-hdr{font-size:11px;font-weight:900;color:#94a3b8;letter-spacing:.07em;text-transform:uppercase;margin:16px 0 8px;padding-bottom:4px;border-bottom:1px solid #e5e7eb;}
  .cal-grid{display:grid;grid-template-columns:repeat(7,1fr);gap:3px;}
  .cal-cell{min-height:72px;background:#fff;border:1px solid #e5e7eb;border-radius:6px;padding:4px;}
  .cal-empty{background:transparent;border:none;min-height:72px;}
  .cal-day{font-size:10px;font-weight:700;margin-bottom:2px;}
  .cal-ev{font-size:9px;background:#eff6ff;border:1px solid #bfdbfe;border-radius:3px;padding:2px 3px;margin-bottom:1px;line-height:1.3;}
  .toast{position:fixed;right:16px;bottom:16px;background:#0b1220;color:#fff;padding:12px 18px;border-radius:12px;font-size:13px;font-weight:600;z-index:999;}
  .kpi-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:14px;margin-bottom:24px;}
  .kpi-card{background:#fff;border:1px solid #e5e7eb;border-radius:14px;padding:16px 18px;display:flex;flex-direction:column;gap:4px;box-shadow:0 1px 4px rgba(0,0,0,.04);}
  .kpi-label{font-size:10px;font-weight:800;color:#94a3b8;letter-spacing:.07em;text-transform:uppercase;}
  .kpi-value{font-size:22px;font-weight:900;color:#0b1220;line-height:1.1;}
  .kpi-sub{font-size:11px;color:#64748b;}
  .kpi-orange .kpi-value{color:#f97316;}
  .kpi-blue .kpi-value{color:#1d4ed8;}
  .kpi-green .kpi-value{color:#15803d;}
  .kpi-red .kpi-value{color:#dc2626;}
  .kpi-purple .kpi-value{color:#7c3aed;}
  .dash-section{font-size:12px;font-weight:900;color:#0b1220;letter-spacing:.04em;text-transform:uppercase;margin:0 0 10px;padding-bottom:6px;border-bottom:2px solid #f1f5f9;}
  .post-badge{display:inline-block;padding:2px 8px;border-radius:999px;font-size:10px;font-weight:800;border:1px solid;}
  .badge-posted{background:#f0fdf4;border-color:#bbf7d0;color:#15803d;}
  .badge-unposted{background:#fff7ed;border-color:#fed7aa;color:#c2410c;}
  .card{background:#fff;border:1px solid #e5e7eb;border-radius:14px;overflow:hidden;box-shadow:0 1px 4px rgba(0,0,0,.04);}
`;

export default function FixedAssetsPage() {
  const [assets, setAssets]         = useState([]);
  const [types, setTypes]           = useState([]);
  const [activeTab, setActiveTab]   = useState('assets');
  const [saveStatus, setSaveStatus] = useState('');
  const [toast, setToast]           = useState('');
  const [confirmModal, setConfirmModal] = useState(null);
  const [assetModal, setAssetModal] = useState(null);
  const [typeModal, setTypeModal]   = useState(null);
  const [pmModal, setPmModal]       = useState(null);
  const [instPayModal, setInstPayModal] = useState(null); // { asset, period, label, principal, interest }
  const [bankAccounts, setBankAccounts] = useState([]);
  const [coaAccounts, setCoaAccounts]   = useState([]);
  const [installmentPayments, setInstallmentPayments] = useState([]);
  const [schedYear, setSchedYear]   = useState('all');
  const [instYear, setInstYear]     = useState('all');
  const [calMonth, setCalMonth]     = useState(new Date().getMonth());
  const [calYear, setCalYear]       = useState(new Date().getFullYear());
  const [postedMonths, setPostedMonths] = useState({});  // { 'YYYY-MM': { postedAt, postedBy } }
  const saveTimerRef = useRef(null);
  const showToast = msg => { setToast(msg); setTimeout(()=>setToast(''),3000); };
  const askConfirm = (message, onConfirm) => setConfirmModal({ message, onConfirm });

  // Open create form when navigating from CreateFlyout
  const location = useLocation();
  useEffect(() => {
    if (location.state?.openCreate) { window.history.replaceState({}, ''); setAssetModal({}); }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const unsub = onSnapshot(doc(db,'fixedAssets','profile'), snap => {
      const d = snap.data() || {};
      setAssets(Array.isArray(d.assets)?d.assets:[]);
      setTypes(Array.isArray(d.types)?d.types:[]);
    });
    return unsub;
  }, []);

  // Load installment payments, COA accounts, bank accounts, and posted-months log
  useEffect(() => {
    const u = onSnapshot(collection(db,'assetInstallmentPayments'), snap => {
      setInstallmentPayments(snap.docs.map(d => ({ id:d.id, ...d.data() })));
    });
    const uCoa = onSnapshot(query(collection(db,'accounts'), orderBy('code')), snap => {
      const all = snap.docs.map(d => ({ id:d.id, ...d.data() }));
      setCoaAccounts(all);
      setBankAccounts(all.filter(a => ['Bank','Cash Equivalents','Cash','Cash and Cash Equivalents'].includes(a.subType) || /cash|bank/i.test(a.name||'')));
    });
    const uPosted = onSnapshot(collection(db,'assetDeprPostings'), snap => {
      const map = {};
      snap.docs.forEach(d => { map[d.id] = d.data(); });
      setPostedMonths(map);
    });
    return () => { u(); uCoa(); uPosted(); };
  }, []);

  const saveToFirestore = useCallback(async (a, t) => {
    setSaveStatus('saving');
    try {
      await setDoc(doc(db,'fixedAssets','profile'),{assets:a,types:t,updatedAt:serverTimestamp(),updatedBy:auth.currentUser?.email||''});
      setSaveStatus('saved'); setTimeout(()=>setSaveStatus(''),2000);
    } catch(e) { setSaveStatus('error'); console.error(e); }
  }, []);

  const debounceSave = useCallback((a,t) => {
    if(saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(()=>saveToFirestore(a,t),1400);
  }, [saveToFirestore]);

  const saveAsset = useCallback(asset => {
    setAssets(prev => {
      const next = prev.find(a=>a.id===asset.id) ? prev.map(a=>a.id===asset.id?asset:a) : [...prev,asset];
      debounceSave(next, types);
      return next;
    });
    setAssetModal(null); showToast('Asset saved.');
  }, [types, debounceSave]);

  const deleteAsset = useCallback(id => {
    askConfirm('Delete this asset?', () => {
      setAssets(prev=>{const next=prev.filter(a=>a.id!==id);debounceSave(next,types);return next;});
    });
  }, [types, debounceSave, setConfirmModal]);

  const saveType = useCallback(t => {
    setTypes(prev => {
      const next = prev.find(x=>x.id===t.id) ? prev.map(x=>x.id===t.id?t:x) : [...prev,t];
      debounceSave(assets,next);
      return next;
    });
    setTypeModal(null); showToast('Asset type saved.');
  }, [assets, debounceSave]);

  const deleteType = useCallback(id => {
    askConfirm('Delete this asset type?', () => {
      setTypes(prev=>{const next=prev.filter(t=>t.id!==id);debounceSave(assets,next);return next;});
    });
  }, [assets, debounceSave, setConfirmModal]);

  const updateAssetField = useCallback((id, field, value) => {
    setAssets(prev=>{const next=prev.map(a=>a.id===id?{...a,[field]:value}:a);debounceSave(next,types);return next;});
  }, [types, debounceSave]);

  const activeAssets = assets.filter(a=>a.status!=='Disposed');
  const instAssets   = assets.filter(a=>a.isInstallment==='Yes'&&a.status!=='Disposed');
  const totalCost    = activeAssets.reduce((s,a)=>s+(parseFloat(a.cost)||0),0);

  // Collision-safe ID: find the highest existing numeric suffix and add 1
  const nextAssetId = () => {
    const max = assets.reduce((m,a) => {
      const n = parseInt((a.id||'').replace(/^FA-/,'')) || 0;
      return n > m ? n : m;
    }, 0);
    return 'FA-' + String(max + 1).padStart(3,'0');
  };

  const nowYYYYMM = new Date().getFullYear() + '-' + String(new Date().getMonth()+1).padStart(2,'0');

  const TABS = [
    {key:'dashboard',label:'Dashboard'},
    {key:'assets',label:'Assets'},
    {key:'types',label:'Asset Types'},
    {key:'schedule',label:'Depreciation Schedule'},
    {key:'post',label:'Post Depreciation'},
    {key:'installments',label:'Installments'},
    {key:'instcal',label:'Installment Calendar'},
    {key:'instpayment',label:'Installment Payment'},
  ];

  const schedYears = (() => {
    const yrs=new Set();
    assets.forEach(a=>{
      if(!a.deprecStartDate) return;
      const sy=parseInt(a.deprecStartDate.substring(0,4));
      const ey=sy+Math.ceil((parseInt(a.usefulLifeMonths)||0)/12);
      for(let y=sy;y<=ey;y++) yrs.add(y);
    });
    return [...yrs].sort();
  })();

  function DashboardTab() {
    const now   = new Date();
    const curYM = now.getFullYear() + '-' + String(now.getMonth()+1).padStart(2,'0');

    // Portfolio KPIs
    const nbvAll        = activeAssets.reduce((s,a) => s + computeNBV(a, curYM), 0);
    const thisMonthDepr = activeAssets.reduce((s,a) => s + computeMonthlyDepr(a, curYM), 0);
    const ytdDepr       = activeAssets.reduce((s,a) => {
      let d = 0;
      for (let m = 1; m <= now.getMonth()+1; m++)
        d += computeMonthlyDepr(a, now.getFullYear()+'-'+String(m).padStart(2,'0'));
      return s + d;
    }, 0);
    const accumTotal    = activeAssets.reduce((s,a) => s + computeAccumDepr(a, curYM), 0);
    const disposedCount = assets.filter(a => a.status==='Disposed').length;
    const postedCount   = Object.keys(postedMonths).length;

    const instOutstanding = instAssets.reduce((s,a) => {
      const paid = installmentPayments.filter(p => p.assetId===a.id).length;
      return s + buildInstSchedule(a).slice(paid).reduce((ss,r) => ss+r.principal+r.interest, 0);
    }, 0);
    const instMonthlyPmt = instAssets.reduce((s,a) => {
      const sched = buildInstSchedule(a);
      const next  = sched[installmentPayments.filter(p=>p.assetId===a.id).length];
      return next ? s + next.principal + next.interest : s;
    }, 0);

    // Depreciation progress % (accumulated / depreciable cost)
    const depreciableCost = activeAssets.reduce((s,a) => s + Math.max(0,(parseFloat(a.cost)||0)-(parseFloat(a.residualValue)||0)), 0);
    const deprPct = depreciableCost > 0 ? Math.min(100, (accumTotal / depreciableCost) * 100) : 0;

    // Upcoming installments (next 60 days)
    const todayMs = new Date(); todayMs.setHours(0,0,0,0);
    const limitMs = new Date(todayMs); limitMs.setDate(limitMs.getDate()+60);
    const upcoming = [];
    instAssets.forEach(a => {
      if (!a.installmentStartDate) return;
      const sched     = buildInstSchedule(a);
      const paidCount = installmentPayments.filter(p=>p.assetId===a.id).length;
      const next      = sched[paidCount];
      if (!next) return;
      const base    = new Date(a.installmentStartDate+'T00:00:00');
      const dueDate = new Date(base.getFullYear(), base.getMonth()+(next.period-1), base.getDate());
      const daysAway = Math.round((dueDate - todayMs) / 86400000);
      if (dueDate <= limitMs) upcoming.push({ asset:a, row:next, dueDate, daysAway });
    });
    upcoming.sort((a,b) => a.dueDate - b.dueDate);

    const ALERT_STYLE = {
      overdue:  { bg:'#fef2f2', border:'#fca5a5', color:'#dc2626', label:'OVERDUE',
        icon:<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"><path d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"/></svg> },
      duesoon:  { bg:'#fff7ed', border:'#fdba74', color:'#c2410c', label:'DUE SOON',
        icon:<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 8v4l3 3"/></svg> },
      upcoming: { bg:'#f0f9ff', border:'#bae6fd', color:'#0369a1', label:'UPCOMING',
        icon:<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"><path d="M8 7V3m8 4V3M3 11h18M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"/></svg> },
    };

    return (
      <div style={{display:'flex',flexDirection:'column',gap:16}}>

        {/* ── Primary KPI Cards ──────────────────────────────────── */}
        <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(220px,1fr))',gap:14}}>

          {/* Total Assets */}
          <div style={{background:'linear-gradient(135deg,#0369a1 0%,#0284c7 100%)',borderRadius:14,padding:'18px 20px',color:'#fff',position:'relative',overflow:'hidden'}}>
            <div style={{position:'absolute',right:-8,top:-8,opacity:.13}}>
              <svg width="56" height="56" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"><path d="M2 21h20M4 21V8l8-5 8 5v13M10 21V12h4v9"/></svg>
            </div>
            <div style={{fontSize:10,fontWeight:800,letterSpacing:'.08em',textTransform:'uppercase',opacity:.8,marginBottom:6}}>Total Assets</div>
            <div style={{fontSize:32,fontWeight:900,letterSpacing:'-.5px',lineHeight:1}}>{assets.length}</div>
            <div style={{marginTop:10,display:'flex',gap:16,fontSize:11}}>
              <span style={{display:'flex',alignItems:'center',gap:5}}>
                <svg width="7" height="7" viewBox="0 0 7 7"><circle cx="3.5" cy="3.5" r="3.5" fill="currentColor"/></svg>
                {activeAssets.length} active
              </span>
              <span style={{display:'flex',alignItems:'center',gap:5,opacity:.75}}>
                <svg width="7" height="7" viewBox="0 0 7 7" fill="none" stroke="currentColor" strokeWidth="1.5"><circle cx="3.5" cy="3.5" r="2.8"/></svg>
                {disposedCount} disposed
              </span>
            </div>
          </div>

          {/* Total Cost */}
          <div style={{background:'linear-gradient(135deg,#c2410c 0%,#ea580c 100%)',borderRadius:14,padding:'18px 20px',color:'#fff',position:'relative',overflow:'hidden'}}>
            <div style={{position:'absolute',right:-8,top:-8,opacity:.13}}>
              <svg width="56" height="56" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"><path d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"/></svg>
            </div>
            <div style={{fontSize:10,fontWeight:800,letterSpacing:'.08em',textTransform:'uppercase',opacity:.8,marginBottom:6}}>Total Cost</div>
            <div style={{fontSize:22,fontWeight:900,letterSpacing:'-.5px'}}>{fmtCur(totalCost)}</div>
            <div style={{marginTop:10,height:5,background:'rgba(255,255,255,.25)',borderRadius:99}}>
              <div style={{height:'100%',width:`${deprPct}%`,background:'#fff',borderRadius:99,transition:'width .6s'}} />
            </div>
            <div style={{marginTop:5,fontSize:11,opacity:.8,display:'flex',justifyContent:'space-between'}}>
              <span>{deprPct.toFixed(1)}% depreciated</span>
              <span>{(100-deprPct).toFixed(1)}% remaining</span>
            </div>
          </div>

          {/* Net Book Value */}
          <div style={{background:'linear-gradient(135deg,#166534 0%,#16a34a 100%)',borderRadius:14,padding:'18px 20px',color:'#fff',position:'relative',overflow:'hidden'}}>
            <div style={{position:'absolute',right:-8,top:-8,opacity:.13}}>
              <svg width="56" height="56" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"><path d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>
            </div>
            <div style={{fontSize:10,fontWeight:800,letterSpacing:'.08em',textTransform:'uppercase',opacity:.8,marginBottom:6}}>Net Book Value</div>
            <div style={{fontSize:22,fontWeight:900,letterSpacing:'-.5px'}}>{fmtCur(nbvAll)}</div>
            <div style={{marginTop:10,display:'flex',gap:6,flexWrap:'wrap',fontSize:11}}>
              <span style={{background:'rgba(255,255,255,.18)',borderRadius:6,padding:'2px 8px'}}>Cost {fmtCur(totalCost)}</span>
              <span style={{background:'rgba(255,255,255,.18)',borderRadius:6,padding:'2px 8px'}}>Depr {fmtCur(accumTotal)}</span>
            </div>
          </div>

          {/* Installment Outstanding */}
          <div style={{background:instOutstanding>0?'linear-gradient(135deg,#6d28d9 0%,#7c3aed 100%)':'linear-gradient(135deg,#166534 0%,#16a34a 100%)',borderRadius:14,padding:'18px 20px',color:'#fff',position:'relative',overflow:'hidden'}}>
            <div style={{position:'absolute',right:-8,top:-8,opacity:.13}}>
              <svg width="56" height="56" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"><path d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z"/></svg>
            </div>
            <div style={{fontSize:10,fontWeight:800,letterSpacing:'.08em',textTransform:'uppercase',opacity:.8,marginBottom:6}}>Inst. Outstanding</div>
            <div style={{fontSize:22,fontWeight:900,letterSpacing:'-.5px'}}>{fmtCur(instOutstanding)}</div>
            <div style={{marginTop:10,fontSize:11,opacity:.8}}>
              {instAssets.length>0
                ? `${instAssets.length} financed asset${instAssets.length!==1?'s':''} · Monthly PMT ${fmtCur(instMonthlyPmt)}`
                : 'No installment assets'}
            </div>
          </div>
        </div>

        {/* ── Secondary KPI Row ──────────────────────────────────── */}
        <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(150px,1fr))',gap:10}}>
          {[
            { label:'Active Assets',      value:activeAssets.length,   sub:'carrying balance',           color:'#1d4ed8', bg:'#eff6ff', border:'#bfdbfe',
              icon:<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"><path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2M9 12h6M9 16h4"/></svg> },
            { label:'Disposed',           value:disposedCount,          sub:'retired / sold',             color:'#64748b', bg:'#f8fafc', border:'#e2e8f0',
              icon:<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"><path d="M20 7H4a2 2 0 000 4h16a2 2 0 000-4zM8 11v8M12 11v8M16 11v8"/></svg> },
            { label:'This Month Depr.',   value:fmtCur(thisMonthDepr),  sub:MONTH_NAMES[now.getMonth()]+' '+now.getFullYear(), color:'#c2410c', bg:'#fff7ed', border:'#fdba74',
              icon:<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"><path d="M19 14l-7 7m0 0l-7-7m7 7V3"/></svg> },
            { label:'YTD Depreciation',   value:fmtCur(ytdDepr),        sub:'Jan – '+MONTH_NAMES[now.getMonth()]+' '+now.getFullYear(), color:'#dc2626', bg:'#fef2f2', border:'#fecaca',
              icon:<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"><path d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"/></svg> },
            { label:'Months Posted',      value:postedCount,            sub:'depreciation journal',       color:'#15803d', bg:'#f0fdf4', border:'#bbf7d0',
              icon:<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"><path d="M5 13l4 4L19 7"/></svg> },
          ].map(({label,value,sub,color,bg,border,icon})=>(
            <div key={label} style={{background:bg,border:`1px solid ${border}`,borderRadius:12,padding:'14px 15px'}}>
              <div style={{display:'flex',alignItems:'center',gap:6,marginBottom:6}}>
                <span style={{color,display:'flex'}}>{icon}</span>
                <span style={{fontSize:9,fontWeight:800,color:'#64748b',letterSpacing:'.07em',textTransform:'uppercase'}}>{label}</span>
              </div>
              <div style={{fontSize:20,fontWeight:900,color,lineHeight:1}}>{value}</div>
              <div style={{fontSize:10,color:'#94a3b8',marginTop:5}}>{sub}</div>
            </div>
          ))}
        </div>

        {/* ── Upcoming Installment Payments ─────────────────────── */}
        <div className="card" style={{padding:0}}>
          <div style={{padding:'12px 16px',borderBottom:'1px solid #f1f5f9',display:'flex',alignItems:'center',justifyContent:'space-between'}}>
            <strong style={{fontSize:13}}>Upcoming Installment Payments</strong>
            <span style={{fontSize:11,color:'#64748b'}}>{upcoming.length} due in next 60 days</span>
          </div>
          {upcoming.length===0 ? (
            <div className="empty" style={{padding:'28px 16px'}}>
              {instAssets.length===0 ? 'No installment assets on record.' : 'All clear — no installment payments due in the next 60 days.'}
            </div>
          ) : (
            <div>
              {upcoming.map(({asset:a,row,dueDate,daysAway},idx) => {
                const type = daysAway < 0 ? 'overdue' : daysAway <= 7 ? 'duesoon' : 'upcoming';
                const s = ALERT_STYLE[type];
                return (
                  <div key={a.id+row.period} style={{display:'flex',alignItems:'center',gap:12,padding:'12px 16px',borderBottom:idx<upcoming.length-1?'1px solid #f1f5f9':'none',background:s.bg}}>
                    <span style={{color:s.color,display:'flex',flexShrink:0}}>{s.icon}</span>
                    <span className="pill" style={{background:'#fff',borderColor:s.border,color:s.color,fontSize:10,flexShrink:0}}>{s.label}</span>
                    <div style={{flex:1,minWidth:0}}>
                      <div style={{fontWeight:700,fontSize:13,color:'#0f172a'}}>{a.name}</div>
                      <div style={{fontSize:11,color:'#64748b',marginTop:2}}>
                        {row.label} · Period {row.period}
                        {daysAway < 0 && <> · <span style={{color:'#dc2626',fontWeight:700}}>{Math.abs(daysAway)} day{Math.abs(daysAway)!==1?'s':''} overdue</span></>}
                        {daysAway >= 0 && <> · in {daysAway} day{daysAway!==1?'s':''}</>}
                      </div>
                    </div>
                    <div style={{textAlign:'right'}}>
                      <div style={{fontWeight:800,fontSize:13,color:s.color}}>{fmtCur(row.principal+row.interest)}</div>
                      <div style={{fontSize:10,color:'#64748b',marginTop:2}}>Due {dueDate.toLocaleDateString('en-PH',{month:'short',day:'numeric',year:'numeric'})}</div>
                    </div>
                    <button className="btn btn-primary btn-sm" onClick={()=>setInstPayModal({asset:a,period:row.period,label:row.label,principal:row.principal,interest:row.interest})}>Record</button>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* ── Asset Summary Table ────────────────────────────────── */}
        {activeAssets.length > 0 && (
          <div className="card" style={{padding:0}}>
            <div style={{padding:'12px 16px',borderBottom:'1px solid #f1f5f9',display:'flex',alignItems:'center',justifyContent:'space-between'}}>
              <strong style={{fontSize:13}}>Asset Summary</strong>
              <button className="btn btn-ghost btn-sm" onClick={()=>setActiveTab('assets')}>View all →</button>
            </div>
            <div style={{overflowX:'auto'}}>
              <table>
                <thead><tr>
                  <th>Asset</th><th>Type</th><th>Method</th>
                  <th style={{textAlign:'right'}}>Cost</th>
                  <th style={{textAlign:'right'}}>Accum. Depr.</th>
                  <th style={{textAlign:'right'}}>Net Book Value</th>
                  <th style={{textAlign:'right'}}>This Month</th>
                </tr></thead>
                <tbody>
                  {activeAssets.map(a => {
                    const accum = computeAccumDepr(a, curYM);
                    const nbv   = Math.max(parseFloat(a.residualValue)||0, (parseFloat(a.cost)||0)-accum);
                    const thisM = computeMonthlyDepr(a, curYM);
                    return (
                      <tr key={a.id}>
                        <td>
                          <div style={{fontWeight:700}}>{a.name}</div>
                          <div style={{fontSize:10,color:'#f97316',fontFamily:'monospace',fontWeight:800}}>{a.id}</div>
                        </td>
                        <td style={{color:'#64748b'}}>{a.assetType||'—'}</td>
                        <td style={{fontSize:10}}><span style={{background:'#eff6ff',border:'1px solid #bfdbfe',color:'#1d4ed8',borderRadius:999,padding:'2px 7px',fontWeight:700}}>{a.depreciationMethod||'Straight Line'}</span></td>
                        <td style={{textAlign:'right'}}>{fmtCur(parseFloat(a.cost)||0)}</td>
                        <td style={{textAlign:'right',color:'#dc2626'}}>{fmtCur(accum)}</td>
                        <td style={{textAlign:'right',fontWeight:700,color:'#15803d'}}>{fmtCur(nbv)}</td>
                        <td style={{textAlign:'right'}}>{thisM>0?fmtCur(thisM):<span style={{color:'#cbd5e1'}}>—</span>}</td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot><tr>
                  <td colSpan={3}>TOTAL ACTIVE</td>
                  <td style={{textAlign:'right'}}>{fmtCur(totalCost)}</td>
                  <td style={{textAlign:'right',color:'#dc2626'}}>{fmtCur(accumTotal)}</td>
                  <td style={{textAlign:'right',color:'#15803d'}}>{fmtCur(nbvAll)}</td>
                  <td style={{textAlign:'right'}}>{fmtCur(thisMonthDepr)}</td>
                </tr></tfoot>
              </table>
            </div>
          </div>
        )}
      </div>
    );
  }

  function AssetsTab() {
    return (
      <div>
        <div style={{display:'flex',gap:10,alignItems:'center',marginBottom:12,flexWrap:'wrap'}}>
          <button className="btn btn-primary btn-sm" onClick={()=>setAssetModal({})}>+ Add Asset</button>
          <span style={{marginLeft:'auto',fontSize:12,color:'#64748b'}}>{activeAssets.length} active · Total Cost: <strong>{fmtCur(totalCost)}</strong></span>
        </div>
        {assets.length===0?<div className="empty">No assets. Click "+ Add Asset" to begin.</div>:(
          <div style={{overflowX:'auto'}}>
            <table>
              <thead><tr>
                <th>ID</th><th>Name</th><th>Asset Type</th><th>Purchase</th><th>Depr. Start</th>
                <th style={{textAlign:'right'}}>Cost</th><th style={{textAlign:'right'}}>Residual</th>
                <th style={{textAlign:'right'}}>NBV</th>
                <th>Life Mo.</th><th>Method</th><th>Calc</th><th>Status</th><th>Installment</th><th></th>
              </tr></thead>
              <tbody>
                {assets.map(a=>(
                  <tr key={a.id}>
                    <td style={{fontFamily:'monospace',color:'#f97316',fontSize:10,fontWeight:800}}>{a.id}</td>
                    <td style={{fontWeight:700,whiteSpace:'nowrap'}}>{a.name}</td>
                    <td style={{color:'#64748b'}}>{a.assetType||'—'}</td>
                    <td style={{color:'#64748b'}}>{a.purchaseDate||'—'}</td>
                    <td style={{color:'#64748b'}}>{a.deprecStartDate||'—'}</td>
                    <td style={{textAlign:'right'}}>{fmtCur(parseFloat(a.cost)||0)}</td>
                    <td style={{textAlign:'right',color:'#64748b'}}>{fmtCur(parseFloat(a.residualValue)||0)}</td>
                    <td style={{textAlign:'right',fontWeight:700,color:a.status==='Disposed'?'#94a3b8':'#15803d'}}>{fmtCur(computeNBV(a,nowYYYYMM))}</td>
                    <td style={{textAlign:'center'}}>{a.usefulLifeMonths||'—'}</td>
                    <td><span style={{fontSize:10,background:'#eff6ff',border:'1px solid #bfdbfe',color:'#1d4ed8',borderRadius:999,padding:'2px 7px',fontWeight:700}}>{a.depreciationMethod||'Straight Line'}</span></td>
                    <td style={{color:'#64748b',fontSize:10}}>{a.computationType||'Non Pro Rata'}</td>
                    <td><span className={`pill ${a.status==='Disposed'?'pill-disposed':'pill-active'}`}>{a.status||'Active'}</span></td>
                    <td>{a.isInstallment==='Yes'?<span className="pill pill-inst">Installment</span>:<span style={{color:'#e5e7eb'}}>—</span>}</td>
                    <td>
                      <div style={{display:'flex',gap:4}}>
                        <button className="btn btn-ghost btn-sm" onClick={()=>setAssetModal({...a})}>Edit</button>
                        <button onClick={()=>deleteAsset(a.id)} style={{background:'none',border:'none',color:'#dc2626',cursor:'pointer',fontWeight:900,fontSize:13,padding:'3px 5px'}}>✕</button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    );
  }

  function TypesTab() {
    return (
      <div>
        <div style={{display:'flex',gap:10,alignItems:'center',marginBottom:12}}>
          <button className="btn btn-primary btn-sm" onClick={()=>setTypeModal({})}>+ Add Type</button>
          <span style={{marginLeft:'auto',fontSize:12,color:'#64748b'}}>{types.length} type{types.length!==1?'s':''}</span>
        </div>
        {types.length===0?<div className="empty">No asset types. Add types to auto-fill fields when creating assets.</div>:(
          <div style={{overflowX:'auto'}}>
            <table>
              <thead><tr>
                <th>ID</th><th>Name</th><th>Depr. Method</th><th>Useful Life (Mo.)</th>
                <th>Fixed Asset Acct</th><th>Accum. Depr. Acct</th><th>Depr. Expense Acct</th><th></th>
              </tr></thead>
              <tbody>
                {types.map(t=>(
                  <tr key={t.id}>
                    <td style={{fontFamily:'monospace',color:'#f97316',fontSize:10,fontWeight:800}}>{t.id}</td>
                    <td style={{fontWeight:700}}>{t.name}</td>
                    <td style={{color:'#64748b'}}>{t.depreciationMethod||'Straight Line'}</td>
                    <td style={{textAlign:'center'}}>{t.usefulLifeMonths||'—'}</td>
                    <td style={{color:'#64748b',fontSize:11}}>{t.fixedAssetAccount||'—'}</td>
                    <td style={{color:'#64748b',fontSize:11}}>{t.accumDeprecAccount||'—'}</td>
                    <td style={{color:'#64748b',fontSize:11}}>{t.deprecExpenseAccount||'—'}</td>
                    <td>
                      <div style={{display:'flex',gap:4}}>
                        <button className="btn btn-ghost btn-sm" onClick={()=>setTypeModal({...t})}>Edit</button>
                        <button onClick={()=>deleteType(t.id)} style={{background:'none',border:'none',color:'#dc2626',cursor:'pointer',fontWeight:900,fontSize:13,padding:'3px 5px'}}>✕</button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    );
  }

  function ScheduleTab() {
    const active = assets.filter(a=>a.status!=='Disposed'&&a.deprecStartDate&&a.usefulLifeMonths);
    if(!active.length) return <div className="empty">No active assets with depreciation dates.</div>;
    const displayYrs = schedYear==='all' ? schedYears : [parseInt(schedYear)];
    return (
      <div>
        <div style={{display:'flex',gap:8,marginBottom:14,flexWrap:'wrap'}}>
          {['all',...schedYears].map(y=>(
            <button key={y} className={`btn btn-sm ${schedYear===String(y)?'btn-primary':'btn-ghost'}`} onClick={()=>setSchedYear(String(y))}>
              {y==='all'?'All Years':y}
            </button>
          ))}
        </div>
        {displayYrs.map(yr=>(
          <div key={yr} style={{marginBottom:24}}>
            {schedYear==='all'&&<div style={{fontWeight:900,fontSize:13,marginBottom:8,color:'#0b1220'}}>Depreciation Schedule — {yr}</div>}
            <div style={{overflowX:'auto'}}>
              <table style={{fontSize:11}}>
                <thead><tr>
                  <th style={{minWidth:160,position:'sticky',left:0,background:'#f8fafc',zIndex:2}}>Asset</th>
                  {MONTH_NAMES.map(m=><th key={m} style={{textAlign:'right',minWidth:75}}>{m}</th>)}
                  <th style={{textAlign:'right',minWidth:90,background:'#fef9c3',color:'#a16207'}}>Year Total</th>
                </tr></thead>
                <tbody>
                  {active.map(a=>{
                    const monthly=MONTH_NAMES.map((_,mi)=>computeMonthlyDepr(a,yr+'-'+String(mi+1).padStart(2,'0')));
                    const yt=monthly.reduce((s,v)=>s+v,0);
                    return (
                      <tr key={a.id}>
                        <td style={{fontWeight:600,whiteSpace:'nowrap',position:'sticky',left:0,background:'#fff',zIndex:1}}>{a.id} – {a.name}</td>
                        {monthly.map((v,i)=><td key={i} style={{textAlign:'right'}}>{v>0?fmtPHP(v):<span style={{color:'#e5e7eb'}}>—</span>}</td>)}
                        <td style={{textAlign:'right',background:'#fefce8',fontWeight:800,color:'#a16207'}}>{yt>0?fmtCur(yt):'—'}</td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot><tr>
                  <td style={{position:'sticky',left:0,background:'#f8fafc'}}>TOTAL</td>
                  {MONTH_NAMES.map((_,mi)=>{
                    const t=active.reduce((s,a)=>s+computeMonthlyDepr(a,yr+'-'+String(mi+1).padStart(2,'0')),0);
                    return <td key={mi} style={{textAlign:'right'}}>{t>0?fmtPHP(t):'—'}</td>;
                  })}
                  <td style={{textAlign:'right',background:'#fefce8',color:'#a16207'}}>
                    {fmtCur(active.reduce((s,a)=>s+MONTH_NAMES.reduce((ss,_,mi)=>ss+computeMonthlyDepr(a,yr+'-'+String(mi+1).padStart(2,'0')),0),0))}
                  </td>
                </tr></tfoot>
              </table>
            </div>
          </div>
        ))}
      </div>
    );
  }

  function PostTab() {
    const [postMonth,setPostMonth]=useState('');
    const [preview,setPreview]=useState([]);
    const [posting,setPosting]=useState(false);
    const [postErr,setPostErr]=useState('');

    const postInfo = postMonth ? postedMonths[postMonth] : null;

    function buildPreview(){
      if(!postMonth) return;
      setPostErr('');
      setPreview(assets.filter(a=>a.status!=='Disposed').map(a=>{
        const depr=computeMonthlyDepr(a,postMonth);
        return depr>0?{asset:a,depr}:null;
      }).filter(Boolean));
    }

    async function postToJournal() {
      if(!postMonth||preview.length===0) return;
      if(postInfo) { setPostErr('Already posted for '+postMonth+'. Reverse the entry first.'); return; }
      setPosting(true); setPostErr('');
      try {
        const user = auth.currentUser?.email||'';
        const total = preview.reduce((s,r)=>s+r.depr,0);
        const description = `Depreciation — ${postMonth}`;
        // Build journal lines: one DR (depreciation expense) and one CR (accum. depr.) per asset
        const lines = [];
        let n = 1;
        preview.forEach(({asset,depr})=>{
          lines.push({ lineNo:n++, type:'DR', accountCode:asset.deprecExpenseAccount||'', description:`${asset.id} – ${asset.name}`, amount:depr });
          lines.push({ lineNo:n++, type:'CR', accountCode:asset.accumDeprecAccount||'', description:`${asset.id} – ${asset.name}`, amount:depr });
        });
        const batch = writeBatch(db);
        // Write journal entry
        const jeRef = doc(collection(db,'journalEntries'));
        batch.set(jeRef, {
          entryType: 'Depreciation',
          description,
          period: postMonth,
          totalAmount: total,
          lines,
          status: 'Posted',
          createdAt: serverTimestamp(), createdBy: user,
          updatedAt: serverTimestamp(), updatedBy: user,
        });
        // Write posted-month lock
        const lockRef = doc(db,'assetDeprPostings',postMonth);
        batch.set(lockRef, {
          period: postMonth,
          journalEntryId: jeRef.id,
          totalAmount: total,
          assetCount: preview.length,
          postedAt: serverTimestamp(), postedBy: user,
        });
        await batch.commit();
        showToast('Depreciation posted for '+postMonth);
        setPreview([]);
      } catch(e) {
        console.error(e);
        setPostErr(e.message||'Failed to post.');
      } finally {
        setPosting(false);
      }
    }

    return (
      <div style={{maxWidth:700}}>
        <p style={{fontSize:13,color:'#64748b',marginTop:0}}>Preview monthly depreciation and post as a journal entry. Each month can only be posted once.</p>
        <div style={{display:'flex',gap:10,alignItems:'flex-end',marginBottom:16}}>
          <div className="field" style={{flex:1}}>
            <label>Select Month</label>
            <input type="month" style={{border:'1px solid #e5e7eb',borderRadius:10,padding:'9px 12px',fontSize:13}} value={postMonth} onChange={e=>{ setPostMonth(e.target.value); setPreview([]); setPostErr(''); }} />
          </div>
          <button className="btn btn-ghost btn-sm" onClick={buildPreview}>Preview</button>
        </div>
        {postMonth && postInfo && (
          <div style={{background:'#f0fdf4',border:'1px solid #bbf7d0',borderLeft:'4px solid #16a34a',borderRadius:8,padding:'10px 14px',marginBottom:12,fontSize:12,color:'#166534',display:'flex',gap:12,alignItems:'center',flexWrap:'wrap'}}>
            <span><strong>✓ Already Posted</strong> — {postMonth}</span>
            <span>Journal Entry ID: <code style={{fontFamily:'monospace'}}>{postInfo.journalEntryId||'—'}</code></span>
            {postInfo.postedBy&&<span>by {postInfo.postedBy}</span>}
          </div>
        )}
        {preview.length===0&&postMonth&&!postInfo&&<div className="empty" style={{padding:24}}>No depreciation to post for {postMonth}. Click Preview to recalculate.</div>}
        {preview.length>0&&(
          <div>
            <table style={{marginBottom:12}}>
              <thead><tr>
                <th>Asset</th><th>Depr. Expense (Dr.)</th><th>Accum. Depr. (Cr.)</th><th style={{textAlign:'right'}}>Amount</th>
              </tr></thead>
              <tbody>
                {preview.map(({asset,depr})=>(
                  <tr key={asset.id}>
                    <td style={{fontWeight:700}}>{asset.id} – {asset.name}</td>
                    <td style={{fontFamily:'monospace',fontSize:11,color:asset.deprecExpenseAccount?'#0b1220':'#dc2626'}}>{asset.deprecExpenseAccount||'⚠ missing'}</td>
                    <td style={{fontFamily:'monospace',fontSize:11,color:asset.accumDeprecAccount?'#0b1220':'#dc2626'}}>{asset.accumDeprecAccount||'⚠ missing'}</td>
                    <td style={{textAlign:'right',fontWeight:700}}>{fmtCur(depr)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot><tr>
                <td colSpan={3}>TOTAL DEPRECIATION</td>
                <td style={{textAlign:'right'}}>{fmtCur(preview.reduce((s,r)=>s+r.depr,0))}</td>
              </tr></tfoot>
            </table>
            {postErr&&<div style={{padding:'8px 12px',background:'#fef2f2',border:'1px solid #fecaca',color:'#b91c1c',borderRadius:8,fontSize:12,fontWeight:600,marginBottom:10}}>{postErr}</div>}
            <button className="btn btn-primary" disabled={posting||!!postInfo} onClick={postToJournal}>
              {posting?'Posting…':postInfo?'Already Posted':'Post to Journal'}
            </button>
          </div>
        )}
      </div>
    );
  }

  function InstallmentsTab() {
    const iYears = allInstYears(instAssets);
    const displayYrs = instYear==='all' ? iYears : [parseInt(instYear)];
    if(!instAssets.length) return <div className="empty">No installment assets. Mark assets as "Installment" in the Assets tab.</div>;
    return (
      <div>
        <div style={{display:'flex',gap:8,marginBottom:14,flexWrap:'wrap'}}>
          {['all',...iYears].map(y=>(
            <button key={y} className={`btn btn-sm ${instYear===String(y)?'btn-primary':'btn-ghost'}`} onClick={()=>setInstYear(String(y))}>
              {y==='all'?'All Years':y}
            </button>
          ))}
        </div>
        {displayYrs.map(displayYr=>{
          const allMoSet=new Set();
          instAssets.forEach(a=>buildInstSchedule(a).forEach(r=>{if(instYear==='all'||r.label.endsWith('-'+displayYr)) allMoSet.add(r.label);}));
          const sortedMo=[...allMoSet].sort((a,b)=>{const p=s=>{const[mo,yr]=s.split('-');return new Date(yr,MONTH_NAMES.indexOf(mo));};return p(a)-p(b);});
          const sm={};
          instAssets.forEach(a=>{sm[a.id]={};buildInstSchedule(a).forEach(r=>{sm[a.id][r.label]=r;});});
          return (
            <div key={displayYr} style={{marginBottom:24}}>
              {instYear==='all'&&<div style={{fontWeight:900,fontSize:13,marginBottom:8}}>{displayYr}</div>}
              <div style={{overflowX:'auto'}}>
                <table style={{fontSize:11}}>
                  <thead>
                    <tr>
                      <th style={{minWidth:90}}>Month</th>
                      {instAssets.map(a=><th key={a.id} colSpan={3} style={{textAlign:'center',borderLeft:'2px solid #e5e7eb',minWidth:180}}>{a.name||a.id}</th>)}
                      <th colSpan={2} style={{textAlign:'center',borderLeft:'2px solid #e5e7eb',background:'#fef9c3',minWidth:120}}>Grand Total</th>
                    </tr>
                    <tr>
                      <th></th>
                      {instAssets.map(a=>(
                        <th key={a.id+'h'} colSpan={3} style={{borderLeft:'2px solid #e5e7eb'}}>
                          <span style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',fontSize:9}}>
                            <span style={{textAlign:'right'}}>Principal</span>
                            <span style={{textAlign:'right'}}>Interest</span>
                            <span style={{textAlign:'right'}}>Total</span>
                          </span>
                        </th>
                      ))}
                      <th style={{textAlign:'right',borderLeft:'2px solid #e5e7eb',background:'#fef9c3',fontSize:9}}>Principal</th>
                      <th style={{textAlign:'right',background:'#fef9c3',fontSize:9}}>Interest</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sortedMo.map(mo=>{
                      let gP=0,gI=0;
                      return (
                        <tr key={mo}>
                          <td style={{fontWeight:600,whiteSpace:'nowrap'}}>{mo}</td>
                          {instAssets.map(a=>{
                            const r=sm[a.id]?.[mo];
                            if(!r) return <td key={a.id} colSpan={3} style={{borderLeft:'2px solid #e5e7eb'}}></td>;
                            gP+=r.principal;gI+=r.interest;
                            return (
                              <td key={a.id} colSpan={3} style={{borderLeft:'2px solid #e5e7eb',padding:0}}>
                                <span style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr'}}>
                                  <span style={{textAlign:'right',padding:'7px 5px'}}>{fmtPHP(r.principal)}</span>
                                  <span style={{textAlign:'right',padding:'7px 5px',color:'#dc2626'}}>{fmtPHP(r.interest)}</span>
                                  <span style={{textAlign:'right',padding:'7px 5px',fontWeight:700}}>{fmtPHP(r.principal+r.interest)}</span>
                                </span>
                              </td>
                            );
                          })}
                          <td style={{textAlign:'right',borderLeft:'2px solid #e5e7eb',background:'#fefce8',fontWeight:700}}>{fmtPHP(gP)}</td>
                          <td style={{textAlign:'right',background:'#fefce8',color:'#dc2626',fontWeight:700}}>{fmtPHP(gI)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          );
        })}
      </div>
    );
  }

  function InstCalTab() {
    const prevM=()=>calMonth===0?(setCalMonth(11),setCalYear(y=>y-1)):setCalMonth(m=>m-1);
    const nextM=()=>calMonth===11?(setCalMonth(0),setCalYear(y=>y+1)):setCalMonth(m=>m+1);
    const events={};
    instAssets.forEach(a=>{
      const sched=buildInstSchedule(a),label=MONTH_NAMES[calMonth]+'-'+calYear;
      const row=sched.find(r=>r.label===label);if(!row) return;
      const day=a.installmentStartDate?new Date(a.installmentStartDate).getDate():1;
      if(!events[day]) events[day]=[];
      events[day].push({asset:a,amount:row.principal+row.interest});
    });
    const dim=new Date(calYear,calMonth+1,0).getDate();
    const fdow=new Date(calYear,calMonth,1).getDay();
    const cells=[...Array(fdow).fill(null),...Array.from({length:dim},(_,i)=>i+1)];
    while(cells.length%7) cells.push(null);
    const weeks=Array.from({length:cells.length/7},(_,i)=>cells.slice(i*7,i*7+7));
    const today=new Date();
    const DOW=['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
    return (
      <div>
        <div style={{display:'flex',alignItems:'center',gap:12,marginBottom:14}}>
          <button className="btn btn-ghost btn-sm" onClick={prevM}>◀</button>
          <span style={{fontWeight:900,fontSize:16,minWidth:120}}>{MONTH_NAMES[calMonth]} {calYear}</span>
          <button className="btn btn-ghost btn-sm" onClick={nextM}>▶</button>
          <span style={{marginLeft:'auto',fontSize:12,color:'#64748b'}}>{Object.values(events).flat().length} payment{Object.values(events).flat().length!==1?'s':''} this month</span>
        </div>
        <div className="cal-grid">
          {DOW.map(d=><div key={d} style={{textAlign:'center',fontWeight:800,fontSize:10,color:'#94a3b8',padding:'5px 0',textTransform:'uppercase',letterSpacing:'.06em'}}>{d}</div>)}
          {weeks.map((wk,wi)=>wk.map((day,di)=>(
            <div key={`${wi}-${di}`} className={day?'cal-cell':'cal-empty'}>
              {day&&(<>
                <div className="cal-day" style={{color:day===today.getDate()&&calMonth===today.getMonth()&&calYear===today.getFullYear()?'#f97316':'#0b1220'}}>{day}</div>
                {(events[day]||[]).map((ev,i)=>(
                  <div key={i} className="cal-ev">
                    <div style={{fontWeight:800,color:'#1e40af',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{ev.asset.name||ev.asset.id}</div>
                    <div style={{color:'#3b82f6'}}>{fmtCur(ev.amount)}</div>
                  </div>
                ))}
              </>)}
            </div>
          )))}
        </div>
      </div>
    );
  }

  function InstPaymentTab() {
    const PM={Check:{bg:'#f0f9ff',border:'#bae6fd',color:'#0369a1'},'Auto-Debit':{bg:'#f5f3ff',border:'#ddd6fe',color:'#6d28d9'},'Bank Transfer':{bg:'#f0fdf4',border:'#bbf7d0',color:'#15803d'}};
    if(!instAssets.length) return <div className="empty">No installment assets.</div>;
    // Determine next unpaid installment for each asset
    const nextDueByAsset = {};
    instAssets.forEach(a => {
      const sched = buildInstSchedule(a);
      const paidPeriods = new Set(installmentPayments.filter(p => p.assetId === a.id).map(p => p.period));
      nextDueByAsset[a.id] = sched.find(r => !paidPeriods.has(r.period)) || null;
    });
    return (
      <div style={{overflowX:'auto'}}>
        <table>
          <thead><tr>
            <th>#</th><th>Asset</th><th>Financed</th><th>Term Mo.</th><th>Rate %</th>
            <th>Payment Method</th><th>Next Due</th><th>Auto-Voucher</th><th></th>
          </tr></thead>
          <tbody>
            {instAssets.map((a,idx)=>{
              const pm=a.paymentMethod||'Check',clr=PM[pm]||PM.Check;
              const nd = nextDueByAsset[a.id];
              const ndAmt = nd ? (nd.principal + nd.interest) : 0;
              return (
                <tr key={a.id}>
                  <td style={{color:'#94a3b8',fontSize:10}}>{idx+1}</td>
                  <td style={{fontWeight:700}}>{a.id} – {a.name}</td>
                  <td style={{textAlign:'right'}}>{fmtCur(parseFloat(a.installmentPrincipal)||0)}</td>
                  <td style={{textAlign:'center'}}>{a.installmentTermMonths||'—'}</td>
                  <td style={{textAlign:'center'}}>{a.installmentAnnualRate||'—'}%</td>
                  <td><span className="pill" style={{background:clr.bg,borderColor:clr.border,color:clr.color}}>{pm}</span></td>
                  <td style={{fontSize:11}}>
                    {nd ? (<><strong>{nd.label}</strong> · <span style={{color:'#1d4ed8'}}>{fmtCur(ndAmt)}</span></>) : <span style={{color:'#94a3b8'}}>Fully paid</span>}
                  </td>
                  <td><span className={`pill ${a.pmAutoVoucher?'pill-active':'pill-disposed'}`}>{a.pmAutoVoucher?'On':'Off'}</span></td>
                  <td style={{whiteSpace:'nowrap'}}>
                    <button className="btn btn-ghost btn-sm" onClick={()=>setPmModal({...a})}>Method</button>
                    {nd && (
                      <button className="btn btn-primary btn-sm" style={{marginLeft:4}}
                        onClick={() => setInstPayModal({ asset:a, period:nd.period, label:nd.label, principal:nd.principal, interest:nd.interest })}>
                        Pay
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    );
  }

  function AssetModal() {
    const isEdit=!!(assetModal&&assetModal.id);
    const nextId=nextAssetId();
    const [form,setForm]=useState({id:nextId,name:'',assetType:'',purchaseDate:'',deprecStartDate:'',cost:'',residualValue:'',usefulLifeMonths:'',depreciationMethod:'Straight Line',computationType:'Non Pro Rata',fixedAssetAccount:'',accumDeprecAccount:'',deprecExpenseAccount:'',status:'Active',disposalDate:'',notes:'',isInstallment:'No',installmentPrincipal:'',installmentStartDate:'',installmentTermMonths:'',installmentAnnualRate:'',installmentMethod:'Reducing Balance',installmentPayableAccount:'',installmentAmortizationAccount:'',paymentMethod:'Check',pmChecks:[],pmAdaDay:'',pmAdaBank:'',pmBtBank:'',pmAutoVoucher:false,...assetModal});
    const upd=(k,v)=>setForm(f=>({...f,[k]:v}));
    const onTypeChg=v=>{
      upd('assetType',v);
      const tmpl=types.find(t=>t.name===v);
      if(tmpl){if(!form.depreciationMethod||form.depreciationMethod==='Straight Line') upd('depreciationMethod',tmpl.depreciationMethod||'Straight Line');if(!form.usefulLifeMonths) upd('usefulLifeMonths',tmpl.usefulLifeMonths||'');if(!form.fixedAssetAccount) upd('fixedAssetAccount',tmpl.fixedAssetAccount||'');if(!form.accumDeprecAccount) upd('accumDeprecAccount',tmpl.accumDeprecAccount||'');if(!form.deprecExpenseAccount) upd('deprecExpenseAccount',tmpl.deprecExpenseAccount||'');}
    };
    function submit(){
      if(!form.name.trim()) return alert('Asset name required.');
      if(!(parseFloat(form.cost)>0)) return alert('Cost must be > 0.');
      if(!(parseInt(form.usefulLifeMonths)>0)) return alert('Useful life (months) must be > 0.');
      if(!form.deprecStartDate) return alert('Depreciation start date required.');
      if(form.isInstallment==='Yes'){if(!(parseFloat(form.installmentPrincipal)>0)) return alert('Amount financed must be > 0.');if(!(parseInt(form.installmentTermMonths)>0)) return alert('Installment term must be > 0.');if(!form.installmentStartDate) return alert('Installment start date required.');}
      saveAsset({...form,cost:parseFloat(form.cost)||0,residualValue:parseFloat(form.residualValue)||0,usefulLifeMonths:parseInt(form.usefulLifeMonths)||0,installmentTermMonths:parseInt(form.installmentTermMonths)||0,installmentAnnualRate:parseFloat(form.installmentAnnualRate)||0,installmentPrincipal:parseFloat(form.installmentPrincipal)||0});
    }
    return (
      <div className="backdrop" onClick={e=>e.target===e.currentTarget&&setAssetModal(null)}>
        <div className="modal">
          <div className="modal-h">
            <strong>{isEdit?'Edit Asset':'New Fixed Asset'}</strong>
            {isEdit && <span style={{fontFamily:'monospace',fontSize:12,color:'#f97316',fontWeight:800}}>{form.id}</span>}
            <button className="btn btn-ghost btn-sm" onClick={()=>setAssetModal(null)} style={{marginLeft:'auto'}}>✕</button>
          </div>
          <div className="modal-b">
            <div className="sec-hdr">Asset Details</div>
            <div className="grid4">
              <div className="field col4"><label>Asset Name *</label><input value={form.name} onChange={e=>upd('name',e.target.value)} /></div>
              <div className="field col2"><label>Asset Type</label><select value={form.assetType} onChange={e=>onTypeChg(e.target.value)}><option value="">— None —</option>{types.map(t=><option key={t.id} value={t.name}>{t.name}</option>)}</select></div>
              <div className="field"><label>Purchase Date</label><input type="date" value={form.purchaseDate} onChange={e=>upd('purchaseDate',e.target.value)} /></div>
              <div className="field"><label>Depr. Start Date *</label><input type="date" value={form.deprecStartDate} onChange={e=>upd('deprecStartDate',e.target.value)} /></div>
              <div className="field"><label>Cost *</label><input type="number" value={form.cost} onChange={e=>upd('cost',e.target.value)} /></div>
              <div className="field"><label>Residual Value</label><input type="number" value={form.residualValue} onChange={e=>upd('residualValue',e.target.value)} /></div>
              <div className="field"><label>Useful Life (Mo.) *</label><input type="number" value={form.usefulLifeMonths} onChange={e=>upd('usefulLifeMonths',e.target.value)} /></div>
              <div className="field"><label>Depreciation Method</label><select value={form.depreciationMethod} onChange={e=>upd('depreciationMethod',e.target.value)}>{DEP_METHODS.map(m=><option key={m}>{m}</option>)}</select></div>
              <div className="field"><label>Computation Type</label><select value={form.computationType} onChange={e=>upd('computationType',e.target.value)}>{COMP_TYPES.map(c=><option key={c}>{c}</option>)}</select></div>
              <div className="field col2"><label>Fixed Asset Account</label><AccountCombobox rawAccounts={coaAccounts} value={form.fixedAssetAccount} onChange={v=>upd('fixedAssetAccount',v)} placeholder="— Select Account —" /></div>
              <div className="field col2"><label>Accum. Depr. Account</label><AccountCombobox rawAccounts={coaAccounts} value={form.accumDeprecAccount} onChange={v=>upd('accumDeprecAccount',v)} placeholder="— Select Account —" /></div>
              <div className="field col2"><label>Depr. Expense Account</label><AccountCombobox rawAccounts={coaAccounts} value={form.deprecExpenseAccount} onChange={v=>upd('deprecExpenseAccount',v)} placeholder="— Select Account —" /></div>
              <div className="field"><label>Status</label><select value={form.status} onChange={e=>upd('status',e.target.value)}>{STATUSES.map(s=><option key={s}>{s}</option>)}</select></div>
              {form.status==='Disposed'&&<div className="field"><label>Disposal Date</label><input type="date" value={form.disposalDate} onChange={e=>upd('disposalDate',e.target.value)} /></div>}
              <div className="field col4"><label>Notes</label><input value={form.notes} onChange={e=>upd('notes',e.target.value)} /></div>
            </div>
            <div className="sec-hdr">Installment / Financing</div>
            <div style={{display:'flex',alignItems:'center',gap:10,marginBottom:12}}>
              <input type="checkbox" id="faInstChk" checked={form.isInstallment==='Yes'} onChange={e=>upd('isInstallment',e.target.checked?'Yes':'No')} />
              <label htmlFor="faInstChk" style={{fontSize:13,fontWeight:600,cursor:'pointer'}}>This asset was purchased via installment / financing</label>
            </div>
            {form.isInstallment==='Yes'&&(
              <div className="grid4">
                <div className="field col2"><label>Amount Financed *</label><input type="number" value={form.installmentPrincipal} onChange={e=>upd('installmentPrincipal',e.target.value)} /></div>
                <div className="field"><label>Start Date *</label><input type="date" value={form.installmentStartDate} onChange={e=>upd('installmentStartDate',e.target.value)} /></div>
                <div className="field"><label>Term (Mo.) *</label><input type="number" value={form.installmentTermMonths} onChange={e=>upd('installmentTermMonths',e.target.value)} /></div>
                <div className="field"><label>Annual Rate %</label><input type="number" step="0.01" value={form.installmentAnnualRate} onChange={e=>upd('installmentAnnualRate',e.target.value)} /></div>
                <div className="field"><label>Interest Method</label><select value={form.installmentMethod} onChange={e=>upd('installmentMethod',e.target.value)}>{INST_METHODS.map(m=><option key={m}>{m}</option>)}</select></div>
                <div className="field col2"><label>Payable Account</label><AccountCombobox rawAccounts={coaAccounts} value={form.installmentPayableAccount} onChange={v=>upd('installmentPayableAccount',v)} placeholder="— Select Account —" /></div>
                <div className="field col2"><label>Amortization Expense Account</label><AccountCombobox rawAccounts={coaAccounts} value={form.installmentAmortizationAccount} onChange={v=>upd('installmentAmortizationAccount',v)} placeholder="— Select Account —" /></div>
              </div>
            )}
          </div>
          <div className="modal-f">
            <button className="btn btn-ghost" onClick={()=>setAssetModal(null)}>Cancel</button>
            <button className="btn btn-primary" onClick={submit}>{isEdit?'Save Changes':'Add Asset'}</button>
          </div>
        </div>
      </div>
    );
  }

  function TypeModal() {
    const isEdit=!!(typeModal&&typeModal.id);
    const nextId='FAT-'+String(types.length+1).padStart(3,'0');
    const [form,setForm]=useState({id:nextId,name:'',depreciationMethod:'Straight Line',usefulLifeMonths:'',fixedAssetAccount:'',accumDeprecAccount:'',deprecExpenseAccount:'',...typeModal});
    const upd=(k,v)=>setForm(f=>({...f,[k]:v}));
    return (
      <div className="backdrop" onClick={e=>e.target===e.currentTarget&&setTypeModal(null)}>
        <div className="modal modal-sm" style={{overflow:'visible'}}>
          <div className="modal-h"><strong>{isEdit?'Edit Asset Type':'New Asset Type'}</strong><button className="btn btn-ghost btn-sm" onClick={()=>setTypeModal(null)}>✕</button></div>
          <div className="modal-b" style={{overflow:'visible', paddingBottom:24}}>
            <div className="grid4">
              <div className="field col4"><label>Type Name *</label><input value={form.name} onChange={e=>upd('name',e.target.value)} /></div>
              <div className="field col2"><label>Depreciation Method</label><select value={form.depreciationMethod} onChange={e=>upd('depreciationMethod',e.target.value)}>{DEP_METHODS.map(m=><option key={m}>{m}</option>)}</select></div>
              <div className="field col2"><label>Useful Life (Mo.)</label><input type="number" value={form.usefulLifeMonths} onChange={e=>upd('usefulLifeMonths',e.target.value)} /></div>
              <div className="field col2"><label>Fixed Asset Account</label><AccountCombobox rawAccounts={coaAccounts} value={form.fixedAssetAccount} onChange={v=>upd('fixedAssetAccount',v)} placeholder="— Select Account —" /></div>
              <div className="field col2"><label>Accum. Depr. Account</label><AccountCombobox rawAccounts={coaAccounts} value={form.accumDeprecAccount} onChange={v=>upd('accumDeprecAccount',v)} placeholder="— Select Account —" /></div>
              <div className="field col4"><label>Depr. Expense Account</label><AccountCombobox rawAccounts={coaAccounts} value={form.deprecExpenseAccount} onChange={v=>upd('deprecExpenseAccount',v)} placeholder="— Select Account —" /></div>
            </div>
          </div>
          <div className="modal-f">
            <button className="btn btn-ghost" onClick={()=>setTypeModal(null)}>Cancel</button>
            <button className="btn btn-primary" onClick={()=>{if(!form.name.trim()) return alert('Type name required.');saveType({...form,usefulLifeMonths:parseInt(form.usefulLifeMonths)||0});}}>
              {isEdit?'Save Changes':'Add Type'}
            </button>
          </div>
        </div>
      </div>
    );
  }

  function PmModal() {
    if(!pmModal) return null;
    const a=assets.find(x=>x.id===pmModal.id)||pmModal;
    const PM={Check:{bg:'#f0f9ff',border:'#bae6fd',color:'#0369a1'},'Auto-Debit':{bg:'#f5f3ff',border:'#ddd6fe',color:'#6d28d9'},'Bank Transfer':{bg:'#f0fdf4',border:'#bbf7d0',color:'#15803d'}};
    return (
      <div className="backdrop" onClick={e=>e.target===e.currentTarget&&setPmModal(null)}>
        <div className="modal modal-sm">
          <div className="modal-h"><strong>Payment Method — {a.name||a.id}</strong><button className="btn btn-ghost btn-sm" onClick={()=>setPmModal(null)}>✕</button></div>
          <div className="modal-b">
            <div style={{display:'flex',gap:8,marginBottom:16}}>
              {PM_METHODS.map(pm=><button key={pm} className={`btn btn-sm ${(a.paymentMethod||'Check')===pm?'btn-primary':'btn-ghost'}`} onClick={()=>updateAssetField(a.id,'paymentMethod',pm)}>{pm}</button>)}
            </div>
            {(a.paymentMethod||'Check')==='Check'&&<div className="field"><label>Check Series</label><input value={(a.pmChecks||[]).join(', ')} onChange={e=>updateAssetField(a.id,'pmChecks',e.target.value.split(',').map(s=>s.trim()).filter(Boolean))} /></div>}
            {a.paymentMethod==='Auto-Debit'&&<div className="grid4"><div className="field col2"><label>Debit Day</label><input type="number" min="1" max="31" value={a.pmAdaDay||''} onChange={e=>updateAssetField(a.id,'pmAdaDay',e.target.value)} /></div><div className="field col2"><label>Bank</label><input value={a.pmAdaBank||''} onChange={e=>updateAssetField(a.id,'pmAdaBank',e.target.value)} /></div></div>}
            {a.paymentMethod==='Bank Transfer'&&<div className="field"><label>Bank / Account</label><input value={a.pmBtBank||''} onChange={e=>updateAssetField(a.id,'pmBtBank',e.target.value)} /></div>}
            <div style={{marginTop:14,display:'flex',alignItems:'center',gap:10}}>
              <input type="checkbox" id="faPmAV" checked={!!a.pmAutoVoucher} onChange={e=>updateAssetField(a.id,'pmAutoVoucher',e.target.checked)} />
              <label htmlFor="faPmAV" style={{fontSize:13,fontWeight:600,cursor:'pointer'}}>Auto-Voucher on due date</label>
            </div>
          </div>
          <div className="modal-f">
            <button className="btn btn-ghost" onClick={()=>setPmModal(null)}>Close</button>
            <button className="btn btn-primary" onClick={()=>{saveToFirestore(assets,types);setPmModal(null);showToast('Payment method saved.');}}>Save</button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="fa-wrap">
      <style>{CSS}</style>
      <div className="fa-topbar">
        <div>
          <h1 style={{margin:0,fontSize:18,fontWeight:900}}>Fixed Assets</h1>
        </div>
      </div>
      <div className="fa-tabs">
        {TABS.map(t=><button key={t.key} className={`fa-tab${activeTab===t.key?' fa-tab-active':''}`} onClick={()=>setActiveTab(t.key)}>{t.label}</button>)}
      </div>
      <div className="fa-body">
        {activeTab==='dashboard'&&<DashboardTab />}
        {activeTab==='assets'&&<AssetsTab />}
        {activeTab==='types'&&<TypesTab />}
        {activeTab==='schedule'&&<ScheduleTab />}
        {activeTab==='post'&&<PostTab />}
        {activeTab==='installments'&&<InstallmentsTab />}
        {activeTab==='instcal'&&<InstCalTab />}
        {activeTab==='instpayment'&&<InstPaymentTab />}
      </div>
      {assetModal!==null&&<AssetModal />}
      {typeModal!==null&&<TypeModal />}
      {pmModal!==null&&<PmModal />}
      {instPayModal&&<RecordInstallmentModal info={instPayModal} onClose={()=>setInstPayModal(null)} bankAccounts={bankAccounts} onSaved={()=>{setInstPayModal(null);showToast('Installment payment recorded.');}} />}
      {confirmModal && (
        <div className="backdrop" onClick={() => setConfirmModal(null)}>
          <div style={{width:'min(400px,98vw)',background:'#fff',borderRadius:16,overflow:'hidden',boxShadow:'0 24px 64px rgba(0,0,0,.25)'}} onClick={e=>e.stopPropagation()}>
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
      {toast&&<div className="toast">{toast}</div>}
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// Modal: record an installment payment for a fixed asset.
// Uses the shared issueCheck helper so the check register & checkbook
// inventory stay in sync with what's reflected here.
// ──────────────────────────────────────────────────────────────────────────
function RecordInstallmentModal({ info, onClose, bankAccounts, onSaved }) {
  const a = info.asset;
  const today = new Date().toISOString().slice(0,10);
  const [form, setForm] = useState({
    date: today,
    principal: (info.principal||0).toFixed(2),
    interest:  (info.interest||0).toFixed(2),
    method:    a.paymentMethod || 'Check',
    bank:      a.pmAdaBank || a.pmBtBank || '',
    checkNo:   '',
    autoVoucher: !!a.pmAutoVoucher || true,
    notes:     `Installment ${info.label} (Period ${info.period}) — ${a.name||a.id}`,
  });
  const [activeCb, setActiveCb] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err,  setErr]  = useState('');
  const total = (Number(form.principal)||0) + (Number(form.interest)||0);
  const upd = (k,v) => setForm(f => ({...f,[k]:v}));

  useEffect(() => {
    if (form.method !== 'Check' || !form.bank) { setActiveCb(null); return; }
    let cancel = false;
    getActiveCheckbook(form.bank).then(cb => { if(!cancel) setActiveCb(cb); }).catch(()=>setActiveCb(null));
    return () => { cancel = true; };
  }, [form.bank, form.method]);

  useEffect(() => {
    if (form.method === 'Check' && activeCb && !form.checkNo) {
      setForm(f => ({ ...f, checkNo: String(activeCb.nextCheckNumber||'') }));
    }
  }, [activeCb, form.method]); // eslint-disable-line react-hooks/exhaustive-deps

  async function save() {
    if (!form.date) { setErr('Date required.'); return; }
    if (total <= 0) { setErr('Amount must be > 0.'); return; }
    if (form.method === 'Check' && !form.bank)   { setErr('Select a bank account.'); return; }
    if (form.method === 'Check' && !activeCb)    { setErr('No active checkbook for this bank.'); return; }
    setBusy(true); setErr('');
    try {
      const user = auth.currentUser?.email || '';
      const lbl  = `${a.id} — ${a.name||''}`.trim();

      // Voucher (if auto)
      let voucherDocId = '', voucherIdStr = '';
      if (form.autoVoucher) {
        const lines = [];
        let n = 1;
        if (Number(form.interest) > 0) lines.push({ lineNo:n++, description:`Interest — ${lbl}`, amount:Number(form.interest), category:'Finance Cost', expenseAccountCode:'', contactId:'', contact:lbl, taxType:'N/A', taxRate:0, taxAmt:0 });
        if (Number(form.principal) > 0) lines.push({ lineNo:n++, description:`Principal — ${lbl}`, amount:Number(form.principal), category:a.installmentPayableAccount||'Installment Payable', expenseAccountCode:a.installmentPayableAccount||'', contactId:'', contact:lbl, taxType:'N/A', taxRate:0, taxAmt:0 });
        voucherIdStr = await nextVoucherId('CV', form.date);
        const ref = await addDoc(collection(db,'vouchers'), {
          voucherId: voucherIdStr,
          voucherType: 'CV',
          preparationDate: form.date,
          purposeCategory: 'Asset Installment',
          paymentFromAccountCode: form.bank || '',
          contactSummary: lbl,
          totalAmount: total,
          status: 'Pending',
          notes: form.notes || '',
          assetId: a.id,
          installmentPeriod: info.period,
          lines,
          createdAt: serverTimestamp(), createdBy: user,
          updatedAt: serverTimestamp(), updatedBy: user,
        });
        voucherDocId = ref.id;
      }

      // Issue check (if applicable)
      let checkInfo = null;
      if (form.method === 'Check' && activeCb) {
        checkInfo = await issueCheck({
          bankCode:      form.bank,
          payeeName:     lbl,
          amount:        total,
          netAmount:     total,
          issueDate:     form.date,
          checkNumber:   form.checkNo || undefined,
          referenceType: 'Asset Installment',
          referenceId:   a.id,
          voucherDocId,
          notes:         form.notes,
          user,
        });
      }

      // Record installment payment
      await addDoc(collection(db,'assetInstallmentPayments'), {
        assetId: a.id,
        assetName: a.name||'',
        period: info.period,
        label:  info.label,
        date: form.date,
        principal: Number(form.principal)||0,
        interest:  Number(form.interest)||0,
        total,
        method: form.method,
        bank:   form.bank||'',
        checkId:         checkInfo?.checkId || '',
        checkNumber:     checkInfo?.checkNumber || form.checkNo || '',
        checkRegisterId: checkInfo?.checkRegisterId || '',
        voucherId:    voucherIdStr,
        voucherDocId,
        notes: form.notes || '',
        createdAt: serverTimestamp(), createdBy: user,
      });

      onSaved && onSaved();
    } catch (e) {
      console.error(e);
      setErr(e.message || 'Failed to save.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="backdrop" onClick={e => e.target===e.currentTarget && onClose()}>
      <div className="modal modal-sm">
        <div className="modal-h">
          <div>
            <strong>Record Installment Payment</strong>
            <div style={{fontSize:11,color:'#64748b',marginTop:2}}>{a.id} · {a.name} — {info.label} (Period {info.period})</div>
          </div>
          <button className="btn btn-ghost btn-sm" onClick={onClose}>✕</button>
        </div>
        <div className="modal-b">
          {form.method==='Check' && form.bank && (
            activeCb ? (
              <div style={{background:'#eff6ff',border:'1px solid #bfdbfe',borderLeft:'4px solid #1d4ed8',borderRadius:8,padding:'8px 12px',marginBottom:12,fontSize:12,color:'#1e3a8a',display:'flex',flexWrap:'wrap',gap:10}}>
                <span>📋 <strong>Active Checkbook</strong></span>
                <span>{activeCb.checkbookType}</span>
                <span>Range: <strong>{activeCb.startingNumber}–{activeCb.endingNumber}</strong></span>
                <span>Next: <strong style={{color:'#f97316'}}>{activeCb.nextCheckNumber}</strong></span>
              </div>
            ) : (
              <div style={{background:'#fff7ed',border:'1px solid #fed7aa',borderLeft:'4px solid #f97316',borderRadius:8,padding:'8px 12px',marginBottom:12,fontSize:12,color:'#9a3412'}}>
                ⚠️ No active checkbook for this bank — open Check Registry → Checkbook Management.
              </div>
            )
          )}
          <div className="grid4">
            <div className="field col2"><label>Payment Date</label><input type="date" value={form.date} onChange={e=>upd('date',e.target.value)} /></div>
            <div className="field col2"><label>Method</label>
              <select value={form.method} onChange={e=>upd('method',e.target.value)}>
                {PM_METHODS.map(m => <option key={m}>{m}</option>)}
              </select>
            </div>
            <div className="field col2"><label>Principal ₱</label><input type="number" step="0.01" value={form.principal} onChange={e=>upd('principal',e.target.value)} /></div>
            <div className="field col2"><label>Interest ₱</label><input type="number" step="0.01" value={form.interest} onChange={e=>upd('interest',e.target.value)} /></div>
            <div className="field col2"><label>Bank Account</label>
              {bankAccounts.length > 0 ? (
                <select value={form.bank} onChange={e=>upd('bank',e.target.value)}>
                  <option value="">— Select —</option>
                  {bankAccounts.map(b => <option key={b.id} value={b.code||b.id}>{b.code} — {b.name}</option>)}
                </select>
              ) : (
                <input value={form.bank} onChange={e=>upd('bank',e.target.value)} placeholder="Bank account code" />
              )}
            </div>
            <div className="field col2"><label>{form.method==='Check' ? 'Check #' : 'Reference No.'}</label><input value={form.checkNo} onChange={e=>upd('checkNo',e.target.value)} /></div>
            <div className="field col4"><label>Notes</label><input value={form.notes} onChange={e=>upd('notes',e.target.value)} /></div>
          </div>
          <div style={{display:'flex',alignItems:'center',gap:10,marginBottom:8}}>
            <input type="checkbox" id="instAV" checked={form.autoVoucher} onChange={e=>upd('autoVoucher',e.target.checked)} />
            <label htmlFor="instAV" style={{fontSize:12,fontWeight:600,cursor:'pointer'}}>Auto-create CV voucher</label>
          </div>
          <div style={{padding:'12px 14px',borderRadius:10,background:'#0f172a',color:'#fff',display:'flex',justifyContent:'space-between',alignItems:'center'}}>
            <span style={{fontSize:11,fontWeight:800,color:'#94a3b8',letterSpacing:'.06em'}}>TOTAL</span>
            <strong style={{fontSize:18,fontWeight:900}}>{fmtCur(total)}</strong>
          </div>
          {err && <div style={{marginTop:10,padding:'8px 12px',background:'#fef2f2',border:'1px solid #fecaca',color:'#b91c1c',borderRadius:8,fontSize:12,fontWeight:600}}>{err}</div>}
        </div>
        <div className="modal-f">
          <button className="btn btn-ghost" onClick={onClose} disabled={busy}>Cancel</button>
          <button className="btn btn-primary" onClick={save} disabled={busy||total<=0}>{busy?'Saving…':'Record Payment'}</button>
        </div>
      </div>
    </div>
  );
}

import { useState, useEffect, useRef, useCallback } from 'react';
import { doc, onSnapshot, setDoc, serverTimestamp } from 'firebase/firestore';
import { db, auth } from '../../../firebase.js';

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
  if(compType==='Pro Rata'&&idx===0){const dim=new Date(yyyy,mm,0).getDate();depr*=(dim-deprecStart.getDate()+1)/dim;}
  return Math.round(depr*100)/100;
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
  .modal-sm{width:min(560px,98vw);}
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
  const [schedYear, setSchedYear]   = useState('all');
  const [instYear, setInstYear]     = useState('all');
  const [calMonth, setCalMonth]     = useState(new Date().getMonth());
  const [calYear, setCalYear]       = useState(new Date().getFullYear());
  const saveTimerRef = useRef(null);
  const showToast = msg => { setToast(msg); setTimeout(()=>setToast(''),3000); };
  const askConfirm = (message, onConfirm) => setConfirmModal({ message, onConfirm });

  useEffect(() => {
    const unsub = onSnapshot(doc(db,'fixedAssets','profile'), snap => {
      const d = snap.data() || {};
      setAssets(Array.isArray(d.assets)?d.assets:[]);
      setTypes(Array.isArray(d.types)?d.types:[]);
    });
    return unsub;
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

  const TABS = [
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

  function AssetsTab() {
    return (
      <div>
        <div style={{display:'flex',gap:10,alignItems:'center',marginBottom:12,flexWrap:'wrap'}}>
          <button className="btn btn-primary btn-sm" onClick={()=>setAssetModal({})}>+ Add Asset</button>
          <button className="btn btn-ghost btn-sm" onClick={()=>saveToFirestore(assets,types)}>💾 Save</button>
          {saveStatus&&<span style={{fontSize:11,color:saveStatus==='error'?'#dc2626':'#15803d'}}>{saveStatus==='saving'?'Saving…':saveStatus==='saved'?'Saved ✓':'Error'}</span>}
          <span style={{marginLeft:'auto',fontSize:12,color:'#64748b'}}>{activeAssets.length} active · Total Cost: <strong>{fmtCur(totalCost)}</strong></span>
        </div>
        {assets.length===0?<div className="empty">No assets. Click "+ Add Asset" to begin.</div>:(
          <div style={{overflowX:'auto'}}>
            <table>
              <thead><tr>
                <th>ID</th><th>Name</th><th>Asset Type</th><th>Purchase</th><th>Depr. Start</th>
                <th style={{textAlign:'right'}}>Cost</th><th style={{textAlign:'right'}}>Residual</th>
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
    function buildPreview(){
      if(!postMonth) return;
      setPreview(assets.filter(a=>a.status!=='Disposed').map(a=>{const depr=computeMonthlyDepr(a,postMonth);return depr>0?{asset:a,depr}:null;}).filter(Boolean));
    }
    return (
      <div style={{maxWidth:700}}>
        <p style={{fontSize:13,color:'#64748b',marginTop:0}}>Preview monthly depreciation and post as a journal entry.</p>
        <div style={{display:'flex',gap:10,alignItems:'flex-end',marginBottom:16}}>
          <div className="field" style={{flex:1}}>
            <label>Select Month</label>
            <input type="month" style={{border:'1px solid #e5e7eb',borderRadius:10,padding:'9px 12px',fontSize:13}} value={postMonth} onChange={e=>setPostMonth(e.target.value)} />
          </div>
          <button className="btn btn-ghost btn-sm" onClick={buildPreview}>Preview</button>
        </div>
        {preview.length===0&&postMonth&&<div className="empty" style={{padding:24}}>No depreciation to post for {postMonth}.</div>}
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
                    <td style={{fontFamily:'monospace',fontSize:11}}>{asset.deprecExpenseAccount||'—'}</td>
                    <td style={{fontFamily:'monospace',fontSize:11}}>{asset.accumDeprecAccount||'—'}</td>
                    <td style={{textAlign:'right',fontWeight:700}}>{fmtCur(depr)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot><tr>
                <td colSpan={3}>TOTAL DEPRECIATION</td>
                <td style={{textAlign:'right'}}>{fmtCur(preview.reduce((s,r)=>s+r.depr,0))}</td>
              </tr></tfoot>
            </table>
            <button className="btn btn-primary" disabled={posting} onClick={()=>{setPosting(true);setTimeout(()=>{showToast('Posted depreciation for '+postMonth);setPosting(false);setPreview([]);},800);}}>
              {posting?'Posting…':'Post to Journal'}
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
    return (
      <div style={{overflowX:'auto'}}>
        <table>
          <thead><tr>
            <th>#</th><th>Asset</th><th>Financed</th><th>Term Mo.</th><th>Rate %</th>
            <th>Payment Method</th><th>Details</th><th>Auto-Voucher</th><th></th>
          </tr></thead>
          <tbody>
            {instAssets.map((a,idx)=>{
              const pm=a.paymentMethod||'Check',clr=PM[pm]||PM.Check;
              let details='';
              if(pm==='Check') details=(a.pmChecks||[]).join(', ');
              else if(pm==='Auto-Debit') details=`Day ${a.pmAdaDay||'—'} · ${a.pmAdaBank||'—'}`;
              else if(pm==='Bank Transfer') details=a.pmBtBank||'—';
              return (
                <tr key={a.id}>
                  <td style={{color:'#94a3b8',fontSize:10}}>{idx+1}</td>
                  <td style={{fontWeight:700}}>{a.id} – {a.name}</td>
                  <td style={{textAlign:'right'}}>{fmtCur(parseFloat(a.installmentPrincipal)||0)}</td>
                  <td style={{textAlign:'center'}}>{a.installmentTermMonths||'—'}</td>
                  <td style={{textAlign:'center'}}>{a.installmentAnnualRate||'—'}%</td>
                  <td><span className="pill" style={{background:clr.bg,borderColor:clr.border,color:clr.color}}>{pm}</span></td>
                  <td style={{fontSize:11,color:'#64748b'}}>{details||'—'}</td>
                  <td><span className={`pill ${a.pmAutoVoucher?'pill-active':'pill-disposed'}`}>{a.pmAutoVoucher?'On':'Off'}</span></td>
                  <td><button className="btn btn-ghost btn-sm" onClick={()=>setPmModal({...a})}>Edit</button></td>
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
    const nextId='FA-'+String(assets.length+1).padStart(3,'0');
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
            <span style={{fontFamily:'monospace',fontSize:12,color:'#f97316',fontWeight:800}}>{form.id}</span>
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
              <div className="field col2"><label>Fixed Asset Account</label><input value={form.fixedAssetAccount} onChange={e=>upd('fixedAssetAccount',e.target.value)} placeholder="e.g. 15100" /></div>
              <div className="field col2"><label>Accum. Depr. Account</label><input value={form.accumDeprecAccount} onChange={e=>upd('accumDeprecAccount',e.target.value)} placeholder="e.g. 15200" /></div>
              <div className="field col2"><label>Depr. Expense Account</label><input value={form.deprecExpenseAccount} onChange={e=>upd('deprecExpenseAccount',e.target.value)} placeholder="e.g. 62100" /></div>
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
                <div className="field col2"><label>Payable Account</label><input value={form.installmentPayableAccount} onChange={e=>upd('installmentPayableAccount',e.target.value)} placeholder="e.g. 20100" /></div>
                <div className="field col2"><label>Amortization Expense Account</label><input value={form.installmentAmortizationAccount} onChange={e=>upd('installmentAmortizationAccount',e.target.value)} placeholder="e.g. 63100" /></div>
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
        <div className="modal modal-sm">
          <div className="modal-h"><strong>{isEdit?'Edit Asset Type':'New Asset Type'}</strong><button className="btn btn-ghost btn-sm" onClick={()=>setTypeModal(null)}>✕</button></div>
          <div className="modal-b">
            <div className="grid4">
              <div className="field col4"><label>Type Name *</label><input value={form.name} onChange={e=>upd('name',e.target.value)} /></div>
              <div className="field col2"><label>Depreciation Method</label><select value={form.depreciationMethod} onChange={e=>upd('depreciationMethod',e.target.value)}>{DEP_METHODS.map(m=><option key={m}>{m}</option>)}</select></div>
              <div className="field col2"><label>Useful Life (Mo.)</label><input type="number" value={form.usefulLifeMonths} onChange={e=>upd('usefulLifeMonths',e.target.value)} /></div>
              <div className="field col2"><label>Fixed Asset Account</label><input value={form.fixedAssetAccount} onChange={e=>upd('fixedAssetAccount',e.target.value)} /></div>
              <div className="field col2"><label>Accum. Depr. Account</label><input value={form.accumDeprecAccount} onChange={e=>upd('accumDeprecAccount',e.target.value)} /></div>
              <div className="field col4"><label>Depr. Expense Account</label><input value={form.deprecExpenseAccount} onChange={e=>upd('deprecExpenseAccount',e.target.value)} /></div>
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
          <p style={{margin:0,fontSize:12,color:'#64748b'}}>{assets.length} asset{assets.length!==1?'s':''} · {activeAssets.length} active{totalCost>0?` · Cost: ${fmtCur(totalCost)}`:''}</p>
        </div>
        <div style={{display:'flex',gap:8,alignItems:'center'}}>
          {saveStatus&&<span style={{fontSize:11,color:saveStatus==='error'?'#dc2626':'#15803d'}}>{saveStatus==='saving'?'Saving…':saveStatus==='saved'?'Saved ✓':'Error'}</span>}
          <button className="btn btn-primary btn-sm" onClick={()=>saveToFirestore(assets,types)}>💾 Save All</button>
        </div>
      </div>
      <div className="fa-tabs">
        {TABS.map(t=><button key={t.key} className={`fa-tab${activeTab===t.key?' fa-tab-active':''}`} onClick={()=>setActiveTab(t.key)}>{t.label}</button>)}
      </div>
      <div className="fa-body">
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

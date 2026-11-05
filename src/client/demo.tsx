import {useCallback,useEffect,useId,useRef,useState,type FormEvent} from 'react';
import {Link,useLocation,useNavigate} from 'react-router-dom';
import dialogPolyfill from 'dialog-polyfill';
import {api,RequestError} from './api';
import {t} from './i18n';
import {getItem,removeItem,setItem} from './storage';
import {toast} from './effects';
import {emitLocal} from './live';
import {useStudentSession} from './session';
import {SymbolIcon} from './campus-design';
import type {DemoStatus} from '../shared/demo';

/*
 * One-click demo (一键体验, v3.6). The start dialog lives on the sign-in pages; the bar shows on every page while a demo
 * is open: switch between the student and the courier at any time, let the simulated courier deliver on its own, follow
 * the guide, or end the demo. The bar remembers only "a demo may be open" in this browser; the server is the truth.
 */
const HINT='campusdrop:demo';
export const demoHinted=()=>getItem(HINT)==='1';
// Set while the start dialog hands over to the home page, so the sign-in page does not redirect to /profile meanwhile.
const starting={current:false};
export const demoStarting=()=>starting.current;

export function DemoStart(){
  const dialog=useRef<HTMLDialogElement>(null),id=useId(),navigate=useNavigate(),{setSession}=useStudentSession();
  const [code,setCode]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState('');
  useEffect(()=>{const d=dialog.current;if(d&&typeof d.showModal!=='function')dialogPolyfill.registerDialog(d);},[]);
  async function start(e:FormEvent){
    e.preventDefault();if(busy)return;setBusy(true);setError('');
    try{
      await api<{status:DemoStatus}>('/demo/start','POST',{passcode:code});
      setItem(HINT,'1');setItem('campusdrop:onboarded-v2','1');
      // The guide starts open on wide screens; on a phone it would push the page down, so it starts folded.
      if(window.matchMedia('(min-width: 721px)').matches)setItem('campusdrop:demo-guide','1');else removeItem('campusdrop:demo-guide');
      starting.current=true;dialog.current?.close();setSession('signed-in');
      toast('一键体验已开始','success','你现在是“体验同学”，随时可以切换成配送员');
      navigate('/',{replace:true});window.setTimeout(()=>{starting.current=false;},1500);
    }catch(err){setError((err as Error).message);}finally{setBusy(false);}
  }
  return <div className="demo-start">
    <button type="button" className="secondary demo-start-button" onClick={()=>{setError('');dialog.current?.showModal();}}><SymbolIcon name="map"/>{t('一键体验（评审用）')}</button>
    <dialog ref={dialog} className="demo-dialog" aria-labelledby={`${id}-title`}>
      <form onSubmit={start}>
        <h2 id={`${id}-title`}>{t('一键体验')}</h2>
        <ul className="demo-points">
          <li>{t('自动创建一个“体验同学”和一个“演示配送员”，两个身份可以随时切换。')}</li>
          <li>{t('体验同学住北苑4号楼，已有 3 件待配送的包裹；下单后可以在校园地图上看配送员沿路线过来。')}</li>
          <li>{t('体验数据与真实订单隔离：不会进入真实接单市场、看板和群通知，支付均为模拟。')}</li>
          <li>{t('会退出这台设备上当前登录的账号。')}</li>
        </ul>
        <label htmlFor={`${id}-code`}>{t('体验口令')}</label>
        <input id={`${id}-code`} value={code} onChange={e=>setCode(e.target.value)} autoComplete="off" required maxLength={64}/>
        {error&&<p role="alert" className="field-error">{error}</p>}
        <div className="actions"><button disabled={busy||!code.trim()}>{busy?t('正在准备…'):t('开始体验')}</button><button type="button" className="secondary" onClick={()=>dialog.current?.close()}>{t('取消')}</button></div>
      </form>
    </dialog>
  </div>;
}

const STUDENT_STEPS:[string,string][]=[
  ['/',t('首页：3 件包裹里有 2 件在南十对面，点“合并配送”一起送')],
  ['/orders',t('付款后打开订单：地图上能看到配送员从站点沿校园道路过来')],
  ['/map',t('配送地图：点任意宿舍楼，看最近站点、路线和步行时间')],
  ['/',t('右下角“问问助手”：试试“把南十的两件合并，晚上送寝室”')],
  ['/parcel/new',t('添加快递：粘贴驿站短信，再写一句“晚上送寝室”，一句话下单')],
];
const COURIER_STEPS:[string,string][]=[
  ['/admin',t('配送任务：在接单市场接下体验同学的订单')],
  ['/admin',t('打开订单，依次点“已取件”“配送中”')],
  ['/admin/map',t('作战地图：看楼栋负载和你（演示配送员）在地图上的位置')],
  ['/',t('切回学生，订单页有 4 位收货码；再回来输入核验，订单自动签收')],
  ['/admin/analytics',t('数据看板：成效统计、AI 运营小结和单量预测（演示账号只看到自己的数据）')],
];

export function DemoBar(){
  const location=useLocation(),navigate=useNavigate(),admin=location.pathname.startsWith('/admin');
  const [status,setStatus]=useState<DemoStatus|null>(null),[guide,setGuide]=useState(()=>getItem('campusdrop:demo-guide')==='1'),[busy,setBusy]=useState(false);
  const hinted=demoHinted();
  const end=useCallback(()=>{removeItem(HINT);removeItem('campusdrop:demo-guide');setStatus(null);},[]);
  useEffect(()=>{
    if(!hinted)return;let alive=true;
    api<{status:DemoStatus}>('/demo/status').then(r=>{if(!alive)return;if(r.status.active){setStatus(s=>{if(!s)setGuide(getItem('campusdrop:demo-guide')==='1');return r.status;});}else end();}).catch(()=>{});
    return()=>{alive=false;};
  },[hinted,end,location.pathname]);
  // With "auto delivery" on, nudge the simulated courier every few seconds; pages refetch when it moved something.
  useEffect(()=>{
    if(!status?.active||!status.auto)return;
    const timer=window.setInterval(async()=>{
      if(document.hidden)return;
      try{const r=await api<{steps:number}>('/demo/tick','POST',{});if(r.steps)emitLocal({type:'order',orderId:null,kind:'demo'});}
      catch(error){if(error instanceof RequestError&&(error.status===401||error.status===410))end();}
    },4000);
    return()=>window.clearInterval(timer);
  },[status?.active,status?.auto,end]);
  if(!status?.active)return null;
  async function setAuto(auto:boolean){setBusy(true);try{await api('/demo/auto','PUT',{auto});setStatus(s=>s&&{...s,auto});}catch(e){toast((e as Error).message,'warn');}finally{setBusy(false);}}
  async function asCourier(){
    if(status?.auto){await setAuto(false);toast('已切换为配送员','info','自动配送已暂停，由你来接单和送达');}
    navigate('/admin');
  }
  async function finish(){
    setBusy(true);
    try{await api('/demo/end','POST',{});}catch{/* already over */}
    end();setBusy(false);toast('一键体验已结束','info','体验账号已退出');navigate('/login',{replace:true});
  }
  const steps=admin?COURIER_STEPS:STUDENT_STEPS;
  const toggleGuide=()=>{setGuide(g=>{const next=!g;if(next)setItem('campusdrop:demo-guide','1');else removeItem('campusdrop:demo-guide');return next;});};
  return <aside className="demo-bar" aria-label={t('一键体验')}>
    <div className="demo-bar-row">
      <strong className="demo-badge">{t('一键体验')}</strong>
      <div className="demo-roles" role="group" aria-label={t('体验身份')}>
        <button type="button" aria-pressed={!admin} onClick={()=>navigate('/')}>{t('学生')}</button>
        <button type="button" aria-pressed={admin} onClick={()=>void asCourier()}>{t('配送员')}</button>
      </div>
      <label className="check demo-auto"><input type="checkbox" checked={status.auto} disabled={busy} onChange={e=>void setAuto(e.target.checked)}/>{t('自动配送')}</label>
      <button type="button" className="text-button" aria-expanded={guide} onClick={toggleGuide}>{guide?t('收起向导'):t('体验向导')}</button>
      <button type="button" className="text-button" disabled={busy} onClick={()=>void finish()}>{t('结束体验')}</button>
    </div>
    {guide&&<ol className="demo-steps">{steps.map(([to,text],i)=><li key={i}><Link to={to}>{text}</Link></li>)}
      <li className="muted">{status.auto?t('自动配送已开启：付款后演示配送员会自己接单、取件、出发并送达（约 2 分钟）。'):t('自动配送已关闭：切换到“配送员”自己接单送达，或重新打开自动配送。')}</li></ol>}
  </aside>;
}

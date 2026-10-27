import {RoundHistory} from './service-links';
function randomClientId(){if(crypto.randomUUID)return crypto.randomUUID();return '10000000-1000-4000-8000-100000000000'.replace(/[018]/g,c=>(Number(c)^crypto.getRandomValues(new Uint8Array(1))[0]&(15>>Number(c)/4)).toString(16));}
import {SymbolIcon} from './campus-design';
import { ChoiceSelector,ConfirmAction,PickupCodeInput,ParcelCard,DeliveryModeSelector,PriceSummary,OrderTimeline,MockPaymentDialog,TipSheet,EmptyState,LoadingState,LiveIndicator,SuccessMark } from './components';
import { Suspense,lazy,useCallback,useEffect,useRef,useState,type FormEvent } from 'react';
import { Link,useNavigate,useParams,useLocation } from 'react-router-dom';
import { api } from './api';
import { shouldWatchOrder,useLiveOrder } from './live-order';
import { isUnauthorized,useStudentSession } from './session';
import { playThen,usePointerParallax } from './motion';
import { celebrate,celebrateFrom,toast } from './effects';
import { NoteChips,RatingPanel,SmsRecognizer } from './engagement-ui';
import { NotifyToggle } from './extras';
import { HandoffCodeCard,OrderChat,SlotPicker,orderSlotText,type SlotChoice } from './live-ui';
const OrderLiveMap=lazy(()=>import('./campus-map').then(m=>({default:m.OrderLiveMap})));
import { BounceText } from './bounce-text';
import { systemNotify } from './notify';
import {CARRIERS,MOCK_MESSAGE,STATUS_LABELS} from '../shared/constants';
import type {DeliveryMode,Order,OrderEvent,Parcel,Payment,Station} from '../shared/delivery';
import { getItem,getJson,removeItem,setItem,setJson } from './storage';
import {money,yuan} from './format';
import {priceFen,upgradePriceFen} from '../domain/commerce';
export {money};
/**
 * Fetch one API resource for a page. `enabled:false` skips the request entirely (e.g. visitors who are known to be
 * signed out), so the console and server logs are not filled with expected 401s. `unauthorized` is derived from the
 * HTTP status, never from the error text, because messages carry a trailing request id.
 */
export function useResource<T>(path:string,enabled=true){
  const location=useLocation();const {setSession}=useStudentSession();
  const [data,setData]=useState<T|null>(null),[error,setError]=useState(''),[loading,setLoading]=useState(enabled),[unauthorized,setUnauthorized]=useState(false);
  const generation=useRef(0);
  const refresh=useCallback(async()=>{
    if(!enabled){generation.current++;setLoading(false);return;}
    const version=++generation.current;setLoading(true);
    try{const next=await api<T>(path);if(version===generation.current){setData(next);setError('');setUnauthorized(false);}}
    catch(e){if(version===generation.current){const denied=isUnauthorized(e);setData(null);setError((e as Error).message);setUnauthorized(denied);if(denied&&!path.startsWith('/admin'))setSession('signed-out');}}
    finally{if(version===generation.current)setLoading(false);}
  },[path,enabled,setSession]);
  useEffect(()=>{void refresh();return()=>{generation.current++;};},[refresh,location.key]);
  /** Background refresh: keeps current data on failure and throws so callers (polling) can react, e.g. to 401. */
  const revalidate=useCallback(async()=>{const version=generation.current;const next=await api<T>(path);if(version===generation.current){setData(next);setError('');}},[path]);
  return {data,error,loading,refresh,revalidate,setError,unauthorized};
}
/**
 * useResource for student-only data: waits for the app-wide session check, skips the request for known visitors and
 * reports them as unauthorized. `studentOnly=false` (staff views sharing a component) behaves like plain useResource.
 */
export function useStudentResource<T>(path:string,studentOnly=true){
  const {session}=useStudentSession();
  const ready=!studentOnly||session==='signed-in'||session==='unavailable',signedOut=studentOnly&&session==='signed-out';
  const resource=useResource<T>(path,ready);
  return {...resource,loading:resource.loading||(studentOnly&&session==='unknown'),unauthorized:resource.unauthorized||signedOut,error:signedOut?'请先登录':resource.error};
}
/** Error line for student pages: a sign-in prompt only when the server actually said 401, the plain message otherwise. */
export function Notice({error,unauthorized=false}:{error:string;unauthorized?:boolean}){
  if(!error)return null;
  if(unauthorized)return <SignInPrompt/>;
  return <p role="alert">{error}</p>;
}
export function SignInPrompt({title='登录后继续',text='登录学生账号后，即可查看包裹、订单与配送进度。'}:{title?:string;text?:string}){
  return <EmptyState title={title} icon="person"><p>{text}</p><div className="actions centered"><Link className="button" to="/login">学生登录</Link><Link className="button secondary" to="/register">创建账号</Link></div></EmptyState>;
}
function orderProgress(status:Order['status']){return status==='COMPLETED'||status.startsWith('DELIVERED')?3:status==='OUT_FOR_DELIVERY'?2:status==='PICKED_UP'?1:0;}
/** Remembers what an order looked like when first shown, so only later changes get the step-advance animation. */
function useOrderBaseline(order:Order|undefined){
 const [baseline,setBaseline]=useState<{id:string;status:Order['status']}|null>(null);
 if(order&&baseline?.id!==order.id)setBaseline({id:order.id,status:order.status});
 return order&&baseline?.id===order.id?baseline:null;
}
/** Toast once whenever a watched order moves to a new status while the page is open. */
function useStatusToast(order:Order|undefined){
 const seen=useRef<{id:string;status:Order['status']}|null>(null);
 useEffect(()=>{
  if(!order)return;const prev=seen.current;seen.current={id:order.id,status:order.status};
  if(!prev||prev.id!==order.id||prev.status===order.status)return;
  const done=order.status.startsWith('DELIVERED');
  toast(`订单状态更新：${STATUS_LABELS[order.status]}`,done?'success':['FAILED_PICKUP','DELIVERY_EXCEPTION'].includes(order.status)?'warn':'info',done?'包裹已送达，记得确认收货':order.dormSnapshot.buildingName);
  if(done)celebrate({count:60});
  systemNotify(`包裹${STATUS_LABELS[order.status]}`,done?`${order.dormSnapshot.buildingName} · ${order.dormSnapshot.roomNo}，记得确认收货`:`订单状态更新：${STATUS_LABELS[order.status]}`,`order-${order.id}`);
 },[order]);
}
function CurrentOrderPreview({enabled,onActive}:{enabled:boolean;onActive?:(active:boolean)=>void}){
 const {data,revalidate}=useResource<{orders:Order[]}>('/orders?pageSize=1',enabled);const order=data?.orders[0];
 const active=!!order&&!['COMPLETED','CANCELLED'].includes(order.status);
 useEffect(()=>{onActive?.(active);},[active,onActive]);
 useLiveOrder(order?.status,revalidate);useStatusToast(order);
 const baseline=useOrderBaseline(order);
 if(!order)return null;
 const progress=orderProgress(order.status),startProgress=baseline?orderProgress(baseline.status):progress,statusChanged=!!baseline&&baseline.status!==order.status;
 const live=shouldWatchOrder(order.status)&&order.status!=='WAITING_PAYMENT',finished=order.status==='COMPLETED'||order.status.startsWith('DELIVERED');
 return <article className="current-order"><div className="row"><strong>当前订单{live&&<LiveIndicator/>}</strong><span key={order.status} data-status={order.status} className={statusChanged?'badge just-advanced':'badge'}><BounceText text={STATUS_LABELS[order.status]} playOnMount={statusChanged}/></span></div><p>{order.dormSnapshot.buildingName} · {order.packageSize==='SMALL'?'小件':'大件'} · {money(order.amountFen)}</p>{!['CANCELLED','FAILED_PICKUP','DELIVERY_EXCEPTION'].includes(order.status)&&<ol className="compact-progress" aria-label="当前订单阶段">{['已下单','已取件','配送中','已送达'].map((label,index)=><li key={label} className={(index<=progress?'reached':'')+(index>startProgress&&index<=progress?' just-advanced':'')+(index===progress&&!finished?' current':'')}><span>{index<=progress?'✓':index+1}</span>{label}</li>)}</ol>}{order.serviceNotice&&<p className="muted">{order.serviceNotice}</p>}<Link to={`/orders/${order.id}`}>查看订单详情 ›</Link></article>;
}
function QuickEntry(){
 const navigate=useNavigate();const [code,setCode]=useState(''),[size,setSize]=useState('SMALL'),[mode,setMode]=useState<DeliveryMode>('DOWNSTAIRS');
 // Same price table the server quotes from (domain/commerce), so the preview can never drift from the real fee.
 const rates=([['SMALL','DOWNSTAIRS','小件 · 楼下'],['SMALL','ROOM','小件 · 到寝'],['LARGE','DOWNSTAIRS','大件 · 楼下'],['LARGE','ROOM','大件 · 到寝']] as const).map(([s,m,label])=>[label,priceFen(s,m),s,m] as const);
 const launching=useRef(false);
 return <form className="quick-entry" onSubmit={e=>{e.preventDefault();if(launching.current)return;launching.current=true;
   const go=()=>navigate('/parcel/new',{state:{pickupCode:code,packageSize:size,deliveryMode:mode}});
   playThen(e.currentTarget.querySelector('.launch-order .icon-plane'),[{transform:'none',opacity:1},{transform:'translate(-6px,4px) rotate(-8deg)',opacity:1,offset:.25},{transform:'translate(64px,-26px) rotate(12deg) scale(.7)',opacity:0}],380,go);}}><PickupCodeInput value={code} onChange={setCode}/><div className="quick-choice-grid"><ChoiceSelector label="包裹类型" value={size} onChange={setSize} options={[{value:'SMALL',label:'小件',icon:'box'},{value:'LARGE',label:'大件',icon:'box'}]}/><DeliveryModeSelector value={mode} onChange={setMode}/></div><div className="rate-grid">{rates.map(([label,price,s,m])=>{const current=s===size&&m===mode;return <div key={label} className={current?'is-current':undefined}><small>{label}</small><strong>{yuan(price)}<em>元</em></strong>{current&&<span className="sr-only">（当前选择）</span>}</div>;})}</div><button className="launch-order" type="submit"><SymbolIcon name="plane"/>立即下单<span aria-hidden="true">›</span></button><small className="quick-footnote">下一步确认站点与包裹资料，费用以服务端报价为准 · <Link to="/parcel/new">收到多件？粘贴短信批量登记 ›</Link></small></form>;
}
function greeting(now=new Date()){
  const h=now.getHours(),word=h<5?'夜深了':h<11?'早上好':h<13?'中午好':h<18?'下午好':'晚上好';
  return `${word} · ${now.toLocaleDateString('zh-CN',{month:'long',day:'numeric',weekday:'short'})}`;
}
export function Home(){
  const {session}=useStudentSession();
  // Wait for the session check before asking for private data: visitors then trigger one /me request instead of three 401s.
  const canLoad=session==='signed-in'||session==='unavailable';
  const {data,error,loading,refresh,setError,unauthorized}=useResource<{parcels:Parcel[]}>('/parcels',canLoad);
  const signedOut=session==='signed-out'||unauthorized,checking=session==='unknown'||(canLoad&&loading&&!data);
  const [busy,setBusy]=useState(''),[expanded,setExpanded]=useState(false),[removed,setRemoved]=useState<string[]>([]),[feedback,setFeedback]=useState('');
  const parcels=(data?.parcels??[]).filter(p=>p.status!=='CANCELLED'&&!removed.includes(p.id));
  const heroRef=useRef<HTMLDivElement>(null);usePointerParallax(heroRef);
  // On phones, a student with an order on the way sees its progress before the quick-order form.
  const [hasActiveOrder,setHasActiveOrder]=useState(false);
  async function remove(id:string){setBusy(id);try{await api(`/parcels/${id}`,'DELETE');setRemoved(ids=>[...ids,id]);setFeedback('包裹已移除');await refresh();}catch(e){setError((e as Error).message);}finally{setBusy('');}}
  return <section className="student-home"><div className="home-hero" ref={heroRef}><div className="hero-copy"><p className="hero-greeting" aria-live="off">{greeting()}</p><p className="hero-school">青岛科技大学<span>崂山校区 · CAMPUSDROP</span></p><h1><BounceText text="校园快递配送" variant="drop hover"/></h1><p className="hero-subtitle">让每一份包裹<br/>更快抵达你的身边</p><div className="hero-features"><span><SymbolIcon name="box"/>手动登记</span><span><SymbolIcon name="person"/>校园配送</span><span><SymbolIcon name="order"/>进度可查</span></div></div><span className="hero-note" aria-hidden="true">把时间留给校园生活</span></div>
    <div className={hasActiveOrder?'home-dashboard has-active-order':'home-dashboard'}><div className="home-quick"><div className="panel-heading"><SymbolIcon/><h2>快速下单</h2><small>简单几步 · 安排配送</small></div><p>选择寝室、填写取件码，剩下的交给配送流程。</p><Link className="address-shortcut" to="/profile"><SymbolIcon name="room"/><span>我的收货寝室<small>下单前请确认地址与联系电话</small></span><b>切换 ›</b></Link><QuickEntry/></div>
    <div className="home-live"><CurrentOrderPreview enabled={session==='signed-in'} onActive={setHasActiveOrder}/><div className="panel-heading"><SymbolIcon name="order"/><h2>我的包裹</h2><Link to="/orders">全部订单 ›</Link></div>
      {signedOut?<SignInPrompt title="登录后，查看你的包裹" text="登记包裹、查看配送进度，让期待更近一步。"/>:<>
      {error&&<div className="inline-error"><p role="alert">{error}</p><button type="button" className="text-button" onClick={()=>void refresh()}>重新加载</button></div>}
      {checking&&<LoadingState/>}{data&&parcels.length===0&&<EmptyState title="下一件快递，从这里开始"><p>登记取件码后，就能安排配送。</p><Link className="button secondary" to="/parcel/new">添加第一件快递 →</Link></EmptyState>}<p role="status">{feedback}</p><div className="card-list">{(expanded?parcels:parcels.slice(0,3)).map(p=><ParcelCard key={p.id} parcel={p} busy={busy===p.id} onRemove={()=>void remove(p.id)}/>)}</div>{parcels.length>3&&<button className="secondary" aria-expanded={expanded} onClick={()=>setExpanded(!expanded)}>{expanded?'收起包裹':`更多包裹（还有 ${parcels.length-3} 件）`}</button>}</>}
      <div className="service-shortcuts"><Link to="/guide"><SymbolIcon name="order"/><strong>配送说明</strong><small>计费 · 范围 · 交接</small></Link><Link to="/help"><SymbolIcon name="help"/><strong>常见问题</strong><small>使用指南与解答</small></Link><Link to="/contact"><SymbolIcon name="phone"/><strong>配送联系</strong><small>找到订单接单人</small></Link><Link to="/map"><SymbolIcon name="map"/><strong>校园地图</strong><small>路线 · 步行时间</small></Link></div><div className="campus-message"><SymbolIcon name="plane"/><p>传递的不止包裹<br/><strong>更是校园里的温度</strong></p></div></div></div>
  </section>;
}
const DRAFT_KEY='campusdrop:parcel-draft';
type Draft={code:string;station:string;carrier:string;note:string;size:string};
function readDraft():Draft|null{return getJson(DRAFT_KEY,(v):v is Draft=>!!v&&typeof (v as Draft).code==='string','session');}
function writeDraft(d:Draft){if(d.code||d.note||d.carrier)setJson(DRAFT_KEY,d,'session');else removeItem(DRAFT_KEY,'session');}
function clearDraft(){removeItem(DRAFT_KEY,'session');}
export function NewParcel(){
  const {data,error,loading}=useResource<{stations:Station[]}>('/stations');
  const location=useLocation(),draft=location.state as {pickupCode?:unknown;packageSize?:unknown;deliveryMode?:unknown}|null;
  const [packageSize,setPackageSize]=useState(draft?.packageSize==='LARGE'?'LARGE':'SMALL');
  const [code,setCode]=useState(typeof draft?.pickupCode==='string'?draft.pickupCode.slice(0,20):''),[message,setMessage]=useState(''),[busy,setBusy]=useState(false);
  // Draft survives a refresh or a detour to another page (sessionStorage, this tab only); any hand-off state (quick entry, reorder) wins.
  const saved=useRef(draft?null:readDraft());
  const [station,setStation]=useState(saved.current?.station??''),[carrier,setCarrier]=useState(saved.current?.carrier??''),[note,setNote]=useState(saved.current?.note??'');
  useEffect(()=>{if(saved.current){if(saved.current.code)setCode(saved.current.code);if(saved.current.size)setPackageSize(saved.current.size);}},[]);
  useEffect(()=>{const t=setTimeout(()=>writeDraft({code,station,carrier,note,size:packageSize}),300);return()=>clearTimeout(t);},[code,station,carrier,note,packageSize]);
  useEffect(()=>{if(!station&&data?.stations.length)setStation(data.stations[0].code);},[data,station]);
  useEffect(()=>{void import('./validation');},[]);
  const navigate=useNavigate();

  async function submit(e:FormEvent<HTMLFormElement>){
    e.preventDefault();setMessage('');const form=new FormData(e.currentTarget);
    const {parcelSchema}=await import('./validation');
    const parsed=parcelSchema.safeParse({pickupCode:code,stationCode:form.get('stationCode'),packageSize:form.get('packageSize'),...(carrier?{carrier}:{}),note});
    if(!parsed.success){setMessage('请检查取件码格式和备注，备注不能超过 120 字或包含 HTML');return;}
    setBusy(true);try{const result=await api<{parcel:Parcel}>('/parcels','POST',parsed.data);clearDraft();navigate(`/parcel/${result.parcel.id}`,{state:{deliveryMode:draft?.deliveryMode==='ROOM'?'ROOM':'DOWNSTAIRS'}});}catch(e){setMessage((e as Error).message);}finally{setBusy(false);}
  }
  return <section><Link to="/">← 我的包裹</Link><h1>添加快递</h1><p className="muted">请确认你有权委托领取该包裹。</p><Notice error={error}/>{loading&&!data&&<LoadingState/>}
    {data&&<SmsRecognizer stations={data.stations} stationCode={station} packageSize={packageSize} onStation={setStation} onFill={p=>{setCode(p.pickupCode);if(p.carrier)setCarrier(p.carrier);}} onBulkDone={()=>{clearDraft();navigate('/',{state:{bulk:true}});}}/>}
    <form onSubmit={submit}><PickupCodeInput value={code} onChange={setCode}/>
      <label htmlFor="station">取件站点</label><select id="station" name="stationCode" required value={station} onChange={e=>setStation(e.target.value)}>{data?.stations.map(s=><option key={s.code} value={s.code}>{s.canonicalName}</option>)}</select>
      <ChoiceSelector label="包裹大小" name="packageSize" value={packageSize} onChange={setPackageSize} options={[{value:'SMALL',label:'小件',icon:'box',hint:'轻便包裹'},{value:'LARGE',label:'大件',icon:'box',hint:'较大包裹'}]}/>
      <label htmlFor="carrier">承运商（选填）</label><select id="carrier" name="carrier" value={carrier} onChange={e=>setCarrier(e.target.value)}><option value="">暂不填写</option>{CARRIERS.map(c=><option key={c}>{c}</option>)}</select>
      <label htmlFor="parcel-note">备注（选填）</label><textarea id="parcel-note" name="note" maxLength={120} rows={3} value={note} onChange={e=>setNote(e.target.value)}/><NoteChips value={note} onChange={setNote}/><small>最多 120 字，请勿填写额外取件凭证。</small>
      <p role="alert">{message}</p><button className={busy?'is-busy':undefined} disabled={busy||!data?.stations.length}>{busy?'正在登记…':'保存包裹'}</button>
    </form><p><Link to="/orders">已有订单？前往继续支付或查看配送</Link></p>
  </section>;
}
export function ParcelDetail(){
  const {id}=useParams();const {data,error,loading,unauthorized}=useStudentResource<{parcel:Parcel}>(`/parcels/${id}`);
  const location=useLocation();
  const [mode,setMode]=useState<DeliveryMode>(location.state?.deliveryMode==='ROOM'?'ROOM':'DOWNSTAIRS'),[amount,setAmount]=useState<number|null>(null),[message,setMessage]=useState(''),[busy,setBusy]=useState(false),[slot,setSlot]=useState<SlotChoice|null>(null);
  const navigate=useNavigate();const size=data?.parcel.packageSize;
  useEffect(()=>{let current=true;setAmount(null);if(size)api<{amountFen:number}>('/quotes','POST',{packageSize:size,deliveryMode:mode}).then(r=>{if(current)setAmount(r.amountFen);}).catch(e=>{if(current)setMessage(e.message);});return()=>{current=false;};},[size,mode]);
  async function order(){setBusy(true);try{const r=await api<{order:Order}>('/orders','POST',{parcelId:id,deliveryMode:mode,...(slot?{slotDate:slot.date,slotCode:slot.code}:{})});navigate(`/checkout/${r.order.id}`);}catch(e){setMessage((e as Error).message);}finally{setBusy(false);}}
  return <section><Link to="/">← 我的包裹</Link><h1>安排配送</h1><Notice error={error} unauthorized={unauthorized}/>{loading&&!data&&<LoadingState/>}{data&&<><p className="pickup-code">{data.parcel.pickupCode}</p><p>{size==='SMALL'?'小件':'大件'} · 请再次核对取件码</p>
    <DeliveryModeSelector value={mode} onChange={setMode}/><SlotPicker value={slot} onChange={setSlot}/><PriceSummary amount={amount}/>
    <p className="muted">按已保存的寝室配送，<Link to="/profile">修改寝室</Link>。</p>
    <button className={busy?'is-busy':undefined} disabled={busy||amount===null||data.parcel.status!=='ACTIVE'} onClick={()=>void order()}>{busy?'正在创建…':'确认并下单'}</button></>}
    <p role="alert">{message}</p><Link to="/orders">查看已有订单</Link>
  </section>;
}
/**
 * Order management on the detail page: note, cancel or hide, and the room upgrade. Paying and confirming receipt have
 * their own buttons higher up the page, so they are not repeated here.
 */
function OrderActions({order,refresh,onMessage}:{order:Order;refresh:()=>Promise<void>;onMessage:(message:string)=>void}){
  const [note,setNote]=useState(order.note),[busy,setBusy]=useState(false);const navigate=useNavigate();
  useEffect(()=>setNote(order.note),[order.note]);
  async function act(action:'note'|'cancel'|'hide'|'upgrade'){
    setBusy(true);
    try {
      const result=await api<{message?:string;refund?:{amountFen:number}}>(`/orders/${order.id}/${action}`,action==='note'?'PATCH':'POST',{version:order.version,confirmed:true,...(action==='note'?{note}:{})});
      if(action==='hide'){toast('订单已隐藏','success','退款和审计记录仍然保留');navigate('/orders',{replace:true});return;}
      onMessage(action==='cancel'?`配送已取消，已模拟退款 ${money(result.refund?.amountFen??0)}，未发生真实资金流转`:result.message??(action==='note'?'备注已修改':'配送方式已更新'));await refresh();
    } catch(error){onMessage((error as Error).message);await refresh();}finally{setBusy(false);}
  }
  const closed=['CANCELLED','COMPLETED'].includes(order.status),delivered=order.status.startsWith('DELIVERED');
  return <div className="order-actions"><h2>订单管理</h2>{!closed&&<details><summary>修改备注</summary><label>新备注<textarea maxLength={120} value={note} onChange={e=>setNote(e.target.value)} disabled={busy}/></label><ConfirmAction label="保存备注" title="确认修改备注？" busy={busy} onConfirm={()=>act('note')}><p>{note||'将清空备注'}</p></ConfirmAction></details>}
    <div className="actions">{closed?<ConfirmAction label="隐藏订单" title="确认隐藏订单？" busy={busy} onConfirm={()=>act('hide')}><p>仅从列表移除，不发起新的退款；退款和审计记录仍然保留。</p></ConfirmAction>:delivered||order.status==='WAITING_PAYMENT'?null:<ConfirmAction label="取消配送" title="确认取消配送并模拟退款？" busy={busy} onConfirm={()=>act('cancel')}><p>订单将取消配送并按实际模拟支付金额退款，当前可退 {money(order.refundableFen)}。订单会保留，方便查看退款结果。</p>{order.custodyState==='STAFF'&&<p>包裹已取出，请先联系配送员完成归还与核验，系统才允许取消。</p>}</ConfirmAction>}
    {order.deliveryMode==='DOWNSTAIRS'&&['WAITING_PICKUP','PICKED_UP','OUT_FOR_DELIVERY'].includes(order.status)&&<ConfirmAction label={`改为送到寝室 · 补${yuan(order.upgradeQuoteFen??upgradePriceFen(order.packageSize))}`} title="确认升级配送并模拟补付？" busy={busy} onConfirm={()=>act('upgrade')}><p>额外模拟支付 {money(order.upgradeQuoteFen??upgradePriceFen(order.packageSize))}，改为送到已保存的寝室；未发生真实扣款。</p></ConfirmAction>}</div></div>;

}
/** Start a new parcel with this order's size and delivery mode prefilled. */
function ReorderLink({order}:{order:Order}){
  if(!['COMPLETED','CANCELLED'].includes(order.status))return null;
  return <Link className="reorder-link" to="/parcel/new" state={{packageSize:order.packageSize,deliveryMode:order.deliveryMode}}>再来一单 ›</Link>;
}
/** Key facts of an order as a labelled grid (replaces a column of loose lines). */
function OrderFacts({order:o}:{order:Order}){
  return <dl className="order-facts">
    <div><dt><SymbolIcon name="room"/>收货寝室</dt><dd>{o.dormSnapshot.buildingName} · {o.dormSnapshot.roomNo}</dd></div>
    <div><dt><SymbolIcon name="box"/>包裹与方式</dt><dd>{o.packageSize==='SMALL'?'小件':'大件'} · {o.deliveryMode==='ROOM'?'送到寝室':'送到楼下'}</dd></div>
    <div><dt><SymbolIcon name="home"/>取件站点</dt><dd>{o.stationSnapshot.canonicalName}</dd></div>
    {orderSlotText(o)&&<div><dt><SymbolIcon name="bell"/>预约送达</dt><dd>{orderSlotText(o)}</dd></div>}
    <div><dt><SymbolIcon name="order"/>下单时间</dt><dd>{new Date(o.createdAt*1000).toLocaleString('zh-CN',{hour12:false})}</dd></div>
    <div className="wide"><dt><SymbolIcon name="chat"/>备注</dt><dd>{o.note||'暂无备注'}</dd></div>
    {o.upgradeFen>0&&<div className="wide"><dt><SymbolIcon name="plane"/>升级补款</dt><dd>含升级配送模拟补款 {money(o.upgradeFen)}</dd></div>}
  </dl>;
}
function DeliveryContact({order}:{order:Order}){if(!order.serviceNotice&&!order.assigneePhone&&!order.exceptionNote)return null;return <div className="delivery-contact">{order.serviceNotice&&<p role="status">{order.serviceNotice}</p>}{order.assigneePhone&&<p>接单人联系电话：<a href={`tel:${order.assigneePhone}`}>{order.assigneePhone}</a></p>}{order.exceptionNote&&<p role="alert">配送问题说明：{order.exceptionNote}</p>}</div>;}
const ORDER_TABS={
  ALL:['全部',()=>true],
  ACTIVE:['进行中',(o:Order)=>!['COMPLETED','CANCELLED','DELIVERED_DOWNSTAIRS','DELIVERED_TO_ROOM'].includes(o.status)],
  RECEIPT:['待收货',(o:Order)=>o.status.startsWith('DELIVERED')],
  DONE:['已完成',(o:Order)=>o.status==='COMPLETED'],
  CANCELLED:['已取消',(o:Order)=>o.status==='CANCELLED'],
} satisfies Record<string,[string,(o:Order)=>boolean]>;
export function Orders(){
  const [cursor,setCursor]=useState(''),[back,setBack]=useState<string[]>([]);
  const {data,error,loading,refresh,unauthorized}=useStudentResource<{orders:Order[];nextCursor:string|null}>(`/orders?pageSize=20${cursor?'&cursor='+encodeURIComponent(cursor):''}`);const [tab,setTab]=useState<keyof typeof ORDER_TABS>('ALL');
  const all=data?.orders??[],shown=all.filter(ORDER_TABS[tab][1]);
  return <section><div className="row"><h1>我的订单</h1>{!unauthorized&&<button className="text-button" onClick={()=>void refresh()}>刷新</button>}</div><Notice error={error} unauthorized={unauthorized}/>{loading&&!data&&<LoadingState/>}{data?.orders.length===0&&<p>暂无订单，<Link to="/parcel/new">添加快递</Link>。</p>}
    {all.length>0&&<div className="order-tabs" role="group" aria-label="按状态筛选本页订单">{(Object.keys(ORDER_TABS) as (keyof typeof ORDER_TABS)[]).map(k=>{const n=all.filter(ORDER_TABS[k][1]).length;return <button key={k} type="button" className="chip" aria-pressed={tab===k} onClick={()=>setTab(k)}>{ORDER_TABS[k][0]}<b>{n}</b></button>;})}</div>}
    {all.length>0&&!shown.length&&<p className="muted">本页没有“{ORDER_TABS[tab][0]}”的订单。</p>}
    <div className="card-list">{shown.map(o=><article key={o.id} className="parcel-card"><div className="row"><span className="badge" data-status={o.status}>{STATUS_LABELS[o.status]}</span><strong>{money(o.amountFen)}</strong></div><p className="order-place"><SymbolIcon name="room"/>{o.dormSnapshot.buildingName} · {o.dormSnapshot.roomNo}</p><p className="order-tags"><span>{o.packageSize==='SMALL'?'小件':'大件'}</span><span>{o.deliveryMode==='ROOM'?'送到寝室':'送到楼下'}</span><time dateTime={new Date(o.createdAt*1000).toISOString()}>{new Date(o.createdAt*1000).toLocaleString('zh-CN',{month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'})}</time></p>{(o.exceptionCode||o.exceptionNote)&&<p className="order-alert" role="note">配送遇到问题，请进入详情查看处理说明</p>}<div className="order-primary"><Link className={o.status==='WAITING_PAYMENT'||o.status.startsWith('DELIVERED')?'button':'button secondary'} to={o.status==='WAITING_PAYMENT'?`/checkout/${o.id}`:`/orders/${o.id}`}>{o.status==='WAITING_PAYMENT'?'继续模拟支付':o.status.startsWith('DELIVERED')?'确认收货':'查看详情'} ›</Link><ReorderLink order={o}/></div></article>)}</div>
    {data&&<div className="actions pager"><button className="secondary" disabled={!back.length} onClick={()=>{setCursor(back.at(-1)!);setBack(back.slice(0,-1));}}>订单上一页</button><span>第 {back.length+1} 页</span><button className="secondary" disabled={!data?.nextCursor} onClick={()=>{setBack([...back,cursor]);setCursor(data!.nextCursor!);}}>订单下一页</button></div>}
  </section>;
}
export interface Details {order:Order;events:OrderEvent[];payments:Payment[]}
export function OrderDetail({checkout=false}:{checkout?:boolean}){
  const params=useParams();const id=params.id??params.orderId;const {data,error,refresh,revalidate,loading,unauthorized}=useStudentResource<Details>(`/orders/${id}`);
  useLiveOrder(data?.order.status,revalidate);useStatusToast(data?.order);const {session}=useStudentSession();const baseline=useOrderBaseline(data?.order);const statusChanged=!!baseline&&!!data&&baseline.status!==data.order.status;
  const [message,setMessage]=useState(''),[busy,setBusy]=useState(false);
  async function pay(){setBusy(true);try{await api(`/orders/${id}/mock-pay`,'POST');setMessage('');toast('模拟支付成功','success','订单已进入接单市场，配送员接单后会通知你');celebrate();await refresh();}catch(e){setMessage((e as Error).message);}finally{setBusy(false);}}
  async function cancel(){setBusy(true);try{await api(`/orders/${id}/cancel`,'POST',{version:data!.order.version,confirmed:true});setMessage('订单已取消');await refresh();}catch(e){setMessage((e as Error).message);}finally{setBusy(false);}}
  return <section><Link to="/orders">← 我的订单</Link><h1>{checkout&&data?.order.status==='WAITING_PAYMENT'?'确认模拟支付':'配送进度'}</h1><Notice error={error} unauthorized={unauthorized}/>{loading&&!data&&<LoadingState/>}{data&&<>
    <div className="status-line"><span key={data.order.status} data-status={data.order.status} className={statusChanged?'badge just-advanced':'badge'}><BounceText text={STATUS_LABELS[data.order.status]} playOnMount={statusChanged}/></span>{session==='signed-in'&&shouldWatchOrder(data.order.status)&&data.order.status!=='WAITING_PAYMENT'&&<LiveIndicator/>}</div>{data.order.status==='COMPLETED'&&<div className="success-panel"><SuccessMark/><p><strong><BounceText text="订单已完成"/></strong><br/><small>感谢使用 CampusDrop 校园配送</small></p></div>}{data.order.status==='COMPLETED'&&<RatingPanel orderId={data.order.id}/>}{data.order.handoffCode&&<HandoffCodeCard code={data.order.handoffCode} status={data.order.status}/>}{['WAITING_PICKUP','PICKED_UP','OUT_FOR_DELIVERY'].includes(data.order.status)&&<Suspense fallback={<div className="live-map-skeleton" aria-hidden="true"/>}><OrderLiveMap order={data.order}/></Suspense>}{data.order.hasAssignee&&!['COMPLETED','CANCELLED'].includes(data.order.status)&&<OrderChat orderId={data.order.id} unread={data.order.chatUnreadStudent??0} startOpen={(data.order.chatUnreadStudent??0)>0}/>}<p className="price">{money(data.order.amountFen)}</p><OrderFacts order={data.order}/>
    {data.order.status==='WAITING_PAYMENT'&&<div className="actions"><MockPaymentDialog amount={data.order.amountFen} busy={busy} onPay={pay}/><button className="secondary" disabled={busy} onClick={()=>void cancel()}>取消订单</button></div>}
    {data.payments.some(p=>p.type==='DELIVERY')&&<p className="success">模拟支付成功，未发生真实扣款</p>}
    {data.order.exceptionCode&&<p role="alert">异常原因：{{CODE_INVALID:'取件码无效',SIZE_MISMATCH:'大小件不符',UNREACHABLE:'暂时无法联系',OTHER:'其他异常'}[data.order.exceptionCode]??'其他异常'}，请联系管理员处理。</p>}
    <RoundHistory order={data.order}/>{['DELIVERED_DOWNSTAIRS','DELIVERED_TO_ROOM'].includes(data.order.status)&&<ConfirmAction label="确认收货" title="确认已经收到包裹？" busy={busy} onConfirm={async()=>{setBusy(true);try{await api(`/orders/${id}/receive`,'POST',{version:data.order.version,confirmed:true});await refresh();setMessage('收货已确认，谢谢使用');toast('收货已确认','success','顺手给这次配送打个分吧');celebrate();}catch(e){setMessage((e as Error).message);}finally{setBusy(false);}}}><p>请核对实际包裹。未收到或有问题时，请先发起售后。</p></ConfirmAction>}{session==='signed-in'&&shouldWatchOrder(data.order.status)&&data.order.status!=='WAITING_PAYMENT'&&<NotifyToggle compact/>}<nav className="order-links" aria-label="订单相关操作"><Link to={`/orders/${data.order.id}/receipt`}><SymbolIcon name="order"/>配送凭证</Link><Link to={`/tickets/new?orderId=${data.order.id}`}><SymbolIcon name="help"/>发起售后</Link><Link to="/tickets"><SymbolIcon name="chat"/>我的售后</Link><ReorderLink order={data.order}/></nav><DeliveryContact order={data.order}/>{data.payments.filter(p=>p.type==='REFUND').map(p=><p className="success" key={p.id}>已模拟退款 {money(p.amountFen)}，未发生真实资金流转</p>)}<OrderActions order={data.order} refresh={refresh} onMessage={setMessage}/><OrderTimeline events={data.events}/>
    {data.order.status==='COMPLETED'&&<Link className="button" to={`/tip/${data.order.id}`}>感谢配送 · 模拟打赏</Link>}
    <button className="text-button" onClick={()=>void refresh()}>刷新配送进度</button>
    </>}{message&&<p role="status">{message}</p>}
  </section>;
}
export function TipPage(){
  const {orderId}=useParams();const {data,error,refresh,loading,unauthorized}=useStudentResource<Details>(`/orders/${orderId}`);
  const [amount,setAmount]=useState('2'),[message,setMessage]=useState(''),[busy,setBusy]=useState(false);
  const storageKey=`campusdrop-tip-${orderId}`;const key=useRef(getItem(storageKey,'session')||randomClientId());
  async function tip(){
    if(!/^\d{1,3}(\.\d{1,2})?$/.test(amount)){setMessage('请输入 0.01–100 元，最多两位小数');return;}
    const fen=Math.round(Number(amount)*100);if(fen<1||fen>10000){setMessage('金额应在 0.01–100 元之间');return;}
    setBusy(true);setItem(storageKey,key.current,'session');
    try{await api(`/orders/${orderId}/tips/mock-pay`,'POST',{amountFen:fen,idempotencyKey:key.current});setMessage('打赏成功，未发生真实扣款');toast('谢谢你的心意','success','模拟打赏已送达配送员');celebrateFrom(document.querySelector('.tip-sheet .block-button'));await refresh();}
    catch(e){setMessage((e as Error).message);}finally{setBusy(false);}
  }
  const tipped=data?.payments.some(p=>p.type==='TIP');
  return <section><Link to={`/orders/${orderId}`}>← 订单详情</Link><h1>感谢这次配送</h1><Notice error={error} unauthorized={unauthorized}/>{loading&&!data&&<LoadingState/>}<p>{MOCK_MESSAGE}</p>
    {tipped?<div className="success-panel"><SuccessMark/><p className="success"><BounceText text="已收到你的模拟打赏，谢谢！"/></p></div>:<TipSheet amount={amount} onChange={setAmount} busy={busy} disabled={data?.order.status!=='COMPLETED'} onSubmit={()=>void tip()}/>}
    <p role="status">{message}</p>
  </section>;
}

/* © 2026 专业团队 · CampusDrop v4.5.0 */
import {getLang,locale,t} from './i18n';
import {CouponPicker,CouponTotal,type CouponChoice} from './coupons-ui';
import {SeaChartView} from './sea-chart/SeaChartView';
import {RouteProgress} from './route-progress';
import {coverView,lightOrigin,type SeaChart} from './sea-chart/renderer';
import {RoundHistory} from './service-links';
import {SizeGuide} from './size-guide';
function randomClientId(){if(crypto.randomUUID)return crypto.randomUUID();return '10000000-1000-4000-8000-100000000000'.replace(/[018]/g,c=>(Number(c)^crypto.getRandomValues(new Uint8Array(1))[0]&(15>>Number(c)/4)).toString(16));}
import {SymbolIcon} from './campus-design';
import { ChoiceSelector,ConfirmAction,PickupCodeInput,ParcelCard,DeliveryModeSelector,PriceSummary,OrderTimeline,MockPaymentDialog,TipSheet,EmptyState,LoadingState,LiveIndicator,SuccessMark } from './components';
import { Suspense,lazy,useCallback,useEffect,useRef,useState,type FormEvent,type MouseEvent } from 'react';
import { Link,useNavigate,useParams,useLocation } from 'react-router-dom';
import { api } from './api';
import { shouldWatchOrder,useLiveOrder } from './live-order';
import { isUnauthorized,useStudentSession } from './session';
import { playThen } from './motion';
import { viewTransitionsEnabled,vtName } from './view-transitions';
import { GroupChip,GroupStrip,MergeBanner,RainNotice,WeatherChip,WeatherNotice } from './v3-ui';
import { flyToOrders } from './micro-motion';
import { celebrate,celebrateFrom,toast } from './effects';
import { NoteChips,RatingPanel,SmsRecognizer } from './engagement-ui';
import { NotifyToggle } from './extras';
import { HandoffCodeCard,OrderChat,SlotPicker,orderSlotText,type SlotChoice } from './live-ui';
import { DeliveryPhotoView,DropPlacePicker,LostParcelCard,NearBanner,lostCardVisible,RoommatePanel } from './order-extras';
import { BuildingHeatBoard } from './heat-board';
import { DROP_PLACE_LABELS,type DropPlace } from '../shared/campus-map';
const OrderLiveMap=lazy(()=>import('./campus-map').then(m=>({default:m.OrderLiveMap})));
import { BounceText } from './bounce-text';
import { systemNotify } from './notify';
import {CARRIERS,MOCK_MESSAGE,STATUS_LABELS} from '../shared/constants';
import type {DeliveryMode,Order,OrderEvent,Parcel,Payment,Station} from '../shared/delivery';
import { SIZE_LABELS, SIZE_LIMITS, sizeLabel } from '../shared/delivery';
import { getItem,setItem } from './storage';
import {clearDraft,readDraft,writeDraft} from './parcel-draft';
import {OneSentenceOrder} from './agent-ui';
import {ImpactBoard} from './impact';
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
  const [result,setResult]=useState<{path:string;data:T}|null>(null),[error,setError]=useState(''),[loading,setLoading]=useState(enabled),[unauthorized,setUnauthorized]=useState(false);
  const data=enabled&&result?.path===path?result.data:null;
  const generation=useRef(0);
  const refresh=useCallback(async()=>{
    if(!enabled){generation.current++;setResult(null);setLoading(false);return;}
    const version=++generation.current;setLoading(true);
    try{const next=await api<T>(path);if(version===generation.current){setResult({path,data:next});setError('');setUnauthorized(false);}}
    catch(e){if(version===generation.current){const denied=isUnauthorized(e);setResult(null);setError((e as Error).message);setUnauthorized(denied);if(denied&&!path.startsWith('/admin'))setSession('signed-out');}}
    finally{if(version===generation.current)setLoading(false);}
  },[path,enabled,setSession]);
  useEffect(()=>{void refresh();return()=>{generation.current++;};},[refresh,location.key]);
  /** Background refresh: keeps current data on failure and throws so callers (polling) can react, e.g. to 401. */
  const revalidate=useCallback(async()=>{const version=generation.current;const next=await api<T>(path);if(version===generation.current){setResult({path,data:next});setError('');}},[path]);
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
  return {...resource,loading:resource.loading||(studentOnly&&session==='unknown'),unauthorized:resource.unauthorized||signedOut,error:signedOut?t('请先登录'):resource.error};
}
/** Error line for student pages: a sign-in prompt only when the server actually said 401, the plain message otherwise. */
export function Notice({error,unauthorized=false}:{error:string;unauthorized?:boolean}){
  if(!error)return null;
  if(unauthorized)return <SignInPrompt/>;
  return <p role="alert">{error}</p>;
}
export function SignInPrompt({title=t('登录后继续'),text=t('登录学生账号后，即可查看包裹、订单与配送进度。')}:{title?:string;text?:string}){
  return <EmptyState title={title} icon="person"><p>{text}</p><div className="actions centered"><Link className="button" to="/login">{t('学生登录')}</Link><Link className="button secondary" to="/register">{t('创建账号')}</Link></div></EmptyState>;
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
  toast(t('订单状态更新：{0}',{0:t(STATUS_LABELS[order.status])}),done?'success':['FAILED_PICKUP','DELIVERY_EXCEPTION'].includes(order.status)?'warn':'info',done?t('包裹已送达，记得确认收货'):order.dormSnapshot.buildingName);
  if(done)celebrate({count:60});
  systemNotify(t('包裹{0}',{0:t(STATUS_LABELS[order.status])}),done?t('{0} · {1}，记得确认收货',{0:order.dormSnapshot.buildingName,1:order.dormSnapshot.roomNo}):t('订单状态更新：{0}',{0:t(STATUS_LABELS[order.status])}),`order-${order.id}`);
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
 return <article className="current-order"><div className="row"><strong>{t('当前订单')}{live&&<LiveIndicator/>}</strong><span key={order.status} data-status={order.status} className={statusChanged?'badge just-advanced':'badge'}><BounceText text={t(STATUS_LABELS[order.status])} playOnMount={statusChanged}/></span></div><p>{order.dormSnapshot.buildingName} · {t(sizeLabel(order.packageSize))} · {money(paidOf(order))}</p>{!['CANCELLED','FAILED_PICKUP','DELIVERY_EXCEPTION'].includes(order.status)&&<RouteProgress steps={[t('已下单'),t('已取件'),t('配送中'),t('已送达')]} current={progress} from={statusChanged?startProgress:0} done={finished} label={`${t('当前订单阶段')}：${[t('已下单'),t('已取件'),t('配送中'),t('已送达')][progress]}`}/>}{order.serviceNotice&&<p className="muted">{order.serviceNotice}</p>}<Link to={`/orders/${order.id}`}>{t('查看订单详情 ›')}</Link></article>;
}
/** What was (or will be) paid for an order: fee − coupon − 满减 + v4.5 雨天配送费. */
export const paidOf=(o:Order)=>o.amountFen-(o.discountFen??0)-(o.bundleDiscountFen??0)+(o.rainFen??0);
/** v4.5 · three sizes with their limits (长 × 宽 × 高, 重量), the same table as 配送说明. */
const SIZE_OPTIONS=()=>(['SMALL','LARGE','EXTRA_LARGE'] as const).map(v=>({value:v,label:t(SIZE_LABELS[v]),icon:'box',hint:v==='EXTRA_LARGE'?t('超过大件上限'):t('≤ {0}',{0:SIZE_LIMITS[v].dims})}));
function QuickEntry(){
 const navigate=useNavigate();const {userId}=useStudentSession();const [code,setCode]=useState(''),[size,setSize]=useState('SMALL'),[mode,setMode]=useState<DeliveryMode>('DOWNSTAIRS');
 // Same price table the server quotes from (domain/commerce), so the preview can never drift from the real fee.
 // v4.5: three sizes × two ways would be six tiles; the grid shows the three sizes for the delivery way picked.
 const rates=(['SMALL','LARGE','EXTRA_LARGE'] as const).map(s=>[t(SIZE_LABELS[s]),priceFen(s,mode),s,mode] as const);
 const launching=useRef(false);
 return <form className="quick-entry" onSubmit={e=>{e.preventDefault();if(launching.current)return;launching.current=true;
   const go=()=>navigate('/parcel/new',{state:{pickupCode:code,packageSize:size,deliveryMode:mode,ownerId:userId}});
   playThen(e.currentTarget.querySelector('.launch-order .icon-plane'),[{transform:'none',opacity:1},{transform:'translate(-6px,4px) rotate(-8deg)',opacity:1,offset:.25},{transform:'translate(64px,-26px) rotate(12deg) scale(.7)',opacity:0}],380,go);}}><PickupCodeInput value={code} onChange={setCode}/><div className="quick-choice-grid"><ChoiceSelector label={t('包裹类型')} value={size} onChange={setSize} options={SIZE_OPTIONS().map(o=>({value:o.value,label:o.label,icon:'box'}))}/><DeliveryModeSelector value={mode} onChange={setMode}/></div><div className="rate-grid">{rates.map(([label,price,s,m])=>{const current=s===size&&m===mode;return <div key={label} className={current?'is-current':undefined}><small>{label}</small><strong>{yuan(price)}<em>{t('元')}</em></strong>{current&&<span className="sr-only">{t('（当前选择）')}</span>}</div>;})}</div><button className="launch-order" type="submit"><SymbolIcon name="plane"/>{t('立即下单')}<span aria-hidden="true">›</span></button><small className="quick-footnote">{t('下一步确认站点与包裹资料，费用以服务端报价为准 ·')} <Link to="/parcel/new">{t('收到多件？粘贴短信批量登记 ›')}</Link></small></form>;
}
function greeting(now=new Date()){
  const h=now.getHours(),word=h<5?t('夜深了'):h<11?t('早上好'):h<13?t('中午好'):h<18?t('下午好'):t('晚上好');
  return `${word} · ${now.toLocaleDateString(locale(),{month:'long',day:'numeric',weekday:'short'})}`;
}
/** The hero maps the chart as if it covered the whole viewport (the opening uses the same mapping), so the two meet exactly. */
export const heroView=(_w:number,h:number)=>coverView(window.innerWidth,window.innerHeight,{focusY:window.innerWidth<=720?.8:.7,band:h});
/** A light travels the route every seven seconds: four seconds on the road, then it rests at the campus and fades. */
export function heroLight(chart:SeaChart){chart.onFrame=t=>{const c=t-lightOrigin(),x=(((c%7)+7)%7)/4;chart.state.light=Math.min(1,x);chart.state.lightA=x<1?Math.min(1,x*6):Math.max(0,1-(x-1)*1.6);};}
export function Home(){
  const {session}=useStudentSession();
  // Wait for the session check before asking for private data: visitors then trigger one /me request instead of three 401s.
  const canLoad=session==='signed-in'||session==='unavailable';
  const {data,error,loading,refresh,setError,unauthorized}=useResource<{parcels:Parcel[]}>('/parcels',canLoad);
  const signedOut=session==='signed-out'||unauthorized,checking=session==='unknown'||(canLoad&&loading&&!data);
  const [busy,setBusy]=useState(''),[expanded,setExpanded]=useState(false),[removed,setRemoved]=useState<string[]>([]),[feedback,setFeedback]=useState('');
  const parcels=(data?.parcels??[]).filter(p=>p.status!=='CANCELLED'&&!removed.includes(p.id));
    // On phones, a student with an order on the way sees its progress before the quick-order form.
  const [hasActiveOrder,setHasActiveOrder]=useState(false);
  async function remove(id:string){setBusy(id);try{await api(`/parcels/${id}`,'DELETE');setRemoved(ids=>[...ids,id]);setFeedback(t('包裹已移除'));await refresh();}catch(e){setError((e as Error).message);}finally{setBusy('');}}
  return <section className={session==='signed-in'?'student-home is-member':'student-home'}>
    <div className="home-hero"><SeaChartView className="home-chart" view={heroView} onChart={heroLight}/>
      <div className="hero-copy"><p className="hero-greeting" aria-live="off">{greeting()}</p><h1><BounceText text={t('让每一份包裹')+(getLang()==='en'?' ':'，')} variant="drop"/><br/><BounceText text={t('更快抵达你的身边')+(getLang()==='en'?'.':'。')} variant="drop"/></h1><p className="hero-subtitle">{t('青岛科技大学崂山校区 · 从驿站到你的宿舍楼')}</p><WeatherChip/></div>
      <dl className="chart-legend" aria-label={t('图例')}><div><dt><svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="6.5"/><circle cx="10" cy="10" r="1.8" className="dot"/></svg></dt><dd>{t('宿舍楼')}</dd></div><div><dt><svg viewBox="0 0 20 20" aria-hidden="true"><rect x="6" y="6" width="8" height="8"/></svg></dt><dd>{t('驿站')}</dd></div><div><dt><svg viewBox="0 0 20 20" aria-hidden="true"><path d="M2 14c5-1 7-8 16-8" className="route"/></svg></dt><dd>{t('配送路线')}</dd></div></dl>
    </div>
    <div className={hasActiveOrder?'home-dashboard has-active-order':'home-dashboard'}>
      <div className="home-quick panel"><div className="panel-heading"><h2>{t('快速下单')}</h2><Link className="address-shortcut" to="/profile"><SymbolIcon name="room"/><span>{t('我的收货寝室')}</span><b>{t('切换 ›')}</b></Link></div><RainNotice/><QuickEntry/></div>
      <div className="home-live"><CurrentOrderPreview enabled={session==='signed-in'} onActive={setHasActiveOrder}/>
        <div className="panel-heading"><h2>{t('我的包裹')}</h2><Link to="/orders">{t('全部订单 ›')}</Link></div>
        {signedOut?<SignInPrompt title={t('登录后，查看你的包裹')} text={t('登记包裹、查看配送进度，让期待更近一步。')}/>:<>
        {error&&<div className="inline-error"><p role="alert">{error}</p><button type="button" className="text-button" onClick={()=>void refresh()}>{t('重新加载')}</button></div>}
        {checking&&<LoadingState/>}{data&&parcels.length===0&&<EmptyState title={t('下一件快递，从这里开始')}><p>{t('登记取件码后，就能安排配送。')}</p><Link className="button secondary" to="/parcel/new">{t('添加第一件快递 →')}</Link></EmptyState>}<p role="status">{feedback}</p><MergeBanner parcels={parcels}/>{session==='signed-in'&&parcels.some(p=>p.status==='ACTIVE'&&!p.hasOrder)&&<OneSentenceOrder/>}<div className="card-list">{(expanded?parcels:parcels.slice(0,3)).map(p=><ParcelCard key={p.id} parcel={p} busy={busy===p.id} onRemove={()=>void remove(p.id)}/>)}</div>{parcels.length>3&&<button className="secondary" aria-expanded={expanded} onClick={()=>setExpanded(!expanded)}>{expanded?t('收起包裹'):t('更多包裹（还有 {0} 件）',{0:parcels.length-3})}</button>}</>}
      </div>
    </div>
    <div className="home-more">
      <nav className="service-shortcuts" aria-label={t('校园服务')}><Link to="/send"><SymbolIcon name="send"/><strong>{t('代寄件')}</strong><small>{t('上门取件 · 帮你寄出')}</small></Link><Link to="/map"><SymbolIcon name="map"/><strong>{t('校园地图')}</strong><small>{t('路线 · 步行时间')}</small></Link><Link to="/report"><SymbolIcon name="star"/><strong>{t('年度报告')}</strong><small>{t('这一年的快递足迹')}</small></Link><Link to="/guide"><SymbolIcon name="order"/><strong>{t('配送说明')}</strong><small>{t('计费 · 范围 · 交接')}</small></Link><Link to="/help"><SymbolIcon name="help"/><strong>{t('常见问题')}</strong><small>{t('使用指南与解答')}</small></Link><Link to="/rules"><SymbolIcon name="bell"/><strong>{t('常用配送')}</strong><small>{t('到点自动下单')}</small></Link><Link to="/apply"><SymbolIcon name="person"/><strong>{t('当配送员')}</strong><small>{t('课余兼职 · 在线申请')}</small></Link></nav>
      {/* v4.5: the campus numbers fold away so the home page stays short; they open with one tap. */}
      <details className="home-extra"><summary><SymbolIcon name="map"/><span><strong>{t('校园配送数据')}</strong><small>{t('累计送达、各楼热度')}</small></span></summary><ImpactBoard/><BuildingHeatBoard compact/></details>
    </div>
  </section>;
}
export function NewParcel(){
  const {session,userId}=useStudentSession();
  if(session==='unknown')return <LoadingState/>;
  return <NewParcelForm key={userId??'guest'} userId={userId}/>;
}
function NewParcelForm({userId}:{userId:string|null}){
  const {data,error,loading}=useResource<{stations:Station[]}>('/stations');
  const location=useLocation(),handoff=location.state as {pickupCode?:unknown;packageSize?:unknown;deliveryMode?:unknown;ownerId?:unknown}|null;
  const draft=handoff?.ownerId===userId?handoff:null;
  // A new hand-off wins over an older draft, while refresh of the same history entry restores later edits.
  const saved=useRef(userId?readDraft(userId):null);
  if(draft&&saved.current?.entry!==location.key)saved.current=null;
  const [packageSize,setPackageSize]=useState(saved.current?.size??(draft?.packageSize==='LARGE'||draft?.packageSize==='EXTRA_LARGE'?draft.packageSize:'SMALL'));
  const [code,setCode]=useState(saved.current?.code??(typeof draft?.pickupCode==='string'?draft.pickupCode.slice(0,20):'')),[message,setMessage]=useState(''),[busy,setBusy]=useState(false);
  const [station,setStation]=useState(saved.current?.station??''),[carrier,setCarrier]=useState(saved.current?.carrier??''),[note,setNote]=useState(saved.current?.note??'');
  useEffect(()=>{if(!userId)return;const timer=setTimeout(()=>writeDraft({ownerId:userId,entry:location.key,code,station,carrier,note,size:packageSize}),300);return()=>clearTimeout(timer);},[userId,location.key,code,station,carrier,note,packageSize]);
  useEffect(()=>{if(!station&&data?.stations.length)setStation(data.stations[0].code);},[data,station]);
  useEffect(()=>{void import('./validation');},[]);
  const navigate=useNavigate();

  async function submit(e:FormEvent<HTMLFormElement>){
    e.preventDefault();setMessage('');const form=new FormData(e.currentTarget);
    const {parcelSchema}=await import('./validation');
    const parsed=parcelSchema.safeParse({pickupCode:code,stationCode:form.get('stationCode'),packageSize:form.get('packageSize'),...(carrier?{carrier}:{}),note});
    if(!parsed.success){setMessage(t('请检查取件码格式和备注，备注不能超过 120 字或包含 HTML'));return;}
    setBusy(true);try{const result=await api<{parcel:Parcel}>('/parcels','POST',parsed.data);clearDraft(userId);navigate(`/parcel/${result.parcel.id}`,{state:{deliveryMode:draft?.deliveryMode==='ROOM'?'ROOM':'DOWNSTAIRS'}});}catch(e){setMessage((e as Error).message);}finally{setBusy(false);}
  }
  return <section><Link to="/">{t('← 我的包裹')}</Link><h1>{t('添加快递')}</h1><p className="muted">{t('请确认你有权委托领取该包裹。')}</p><Notice error={error}/>{loading&&!data&&<LoadingState/>}
    {data&&<SmsRecognizer stations={data.stations} stationCode={station} packageSize={packageSize} onStation={setStation} onFill={p=>{setCode(p.pickupCode);if(p.carrier)setCarrier(p.carrier);}} onBulkDone={()=>{clearDraft(userId);navigate('/',{state:{bulk:true}});}}/>}
    <form onSubmit={submit}><PickupCodeInput value={code} onChange={setCode}/>
      <label htmlFor="station">{t('取件站点')}</label><select id="station" name="stationCode" required value={station} onChange={e=>setStation(e.target.value)}>{data?.stations.map(s=><option key={s.code} value={s.code}>{s.canonicalName}</option>)}</select>
      <ChoiceSelector label={t('包裹大小')} name="packageSize" value={packageSize} onChange={setPackageSize} options={SIZE_OPTIONS()}/><SizeGuide/>
      <label htmlFor="carrier">{t('承运商（选填）')}</label><select id="carrier" name="carrier" value={carrier} onChange={e=>setCarrier(e.target.value)}><option value="">{t('暂不填写')}</option>{CARRIERS.map(c=><option key={c} value={c}>{t(c)}</option>)}</select>
      <label htmlFor="parcel-note">{t('备注（选填）')}</label><textarea id="parcel-note" name="note" maxLength={120} rows={3} value={note} onChange={e=>setNote(e.target.value)}/><NoteChips value={note} onChange={setNote}/><small>{t('最多 120 字，请勿填写额外取件凭证。')}</small>
      <p role="alert">{message}</p><button className={busy?'is-busy':undefined} disabled={busy||!data?.stations.length}>{busy?t('正在登记…'):t('保存包裹')}</button>
    </form><p><Link to="/orders">{t('已有订单？前往继续支付或查看配送')}</Link></p>
  </section>;
}
export function ParcelDetail(){
  const {id}=useParams();const {data,error,loading,unauthorized}=useStudentResource<{parcel:Parcel}>(`/parcels/${id}`);
  const location=useLocation();
  const [mode,setMode]=useState<DeliveryMode>(location.state?.deliveryMode==='ROOM'?'ROOM':'DOWNSTAIRS'),[amount,setAmount]=useState<number|null>(null),[message,setMessage]=useState(''),[busy,setBusy]=useState(false),[slot,setSlot]=useState<SlotChoice|null>(null),[place,setPlace]=useState<DropPlace|null>(null);
  const navigate=useNavigate();const size=data?.parcel.packageSize;
  useEffect(()=>{if(mode==='ROOM')setPlace(null);},[mode]);
  useEffect(()=>{let current=true;setAmount(null);if(size)api<{amountFen:number}>('/quotes','POST',{packageSize:size,deliveryMode:mode}).then(r=>{if(current)setAmount(r.amountFen);}).catch(e=>{if(current)setMessage(e.message);});return()=>{current=false;};},[size,mode]);
  const orderButton=useRef<HTMLButtonElement>(null);
  async function order(){setBusy(true);try{const r=await api<{order:Order}>('/orders','POST',{parcelId:id,deliveryMode:mode,...(slot?{slotDate:slot.date,slotCode:slot.code}:{}),...(place&&mode==='DOWNSTAIRS'?{dropPlace:place}:{})});await flyToOrders(orderButton.current);navigate(`/checkout/${r.order.id}`);}catch(e){setMessage((e as Error).message);}finally{setBusy(false);}}
  return <section className="arrange-page"><Link className="back-link" to="/">{t('← 我的包裹')}</Link><h1>{t('安排配送')}</h1><Notice error={error} unauthorized={unauthorized}/>{loading&&!data&&<LoadingState/>}{data&&<><div className="arrange-parcel"><span className="arrange-icon" aria-hidden="true"><SymbolIcon name="box"/></span><div><p className="pickup-code">{data.parcel.pickupCode}</p><p className="muted">{t(sizeLabel(data.parcel.packageSize))}{data.parcel.carrier?` · ${t(data.parcel.carrier)}`:''}{t(' · 请再次核对取件码')}</p></div></div>
    <DeliveryModeSelector value={mode} onChange={setMode}/>{mode==='DOWNSTAIRS'&&<DropPlacePicker value={place} onChange={setPlace}/>}<SlotPicker value={slot} onChange={setSlot}/><WeatherNotice/>
    <p className="muted arrange-address"><SymbolIcon name="room"/><span>{place?t('送到{0}，联系电话按已保存的资料。',{0:t(DROP_PLACE_LABELS[place])}):<>{t('按已保存的寝室配送，')}<Link to="/profile">{t('修改寝室')}</Link>。</>}</span></p>
    {data.parcel.status==='ACTIVE'&&!data.parcel.hasOrder&&<details className="fold-card"><summary><SymbolIcon name="chat"/><span><strong>{t('不想一项项选？')}</strong><small>{t('用一句话说清楚怎么送')}</small></span></summary><OneSentenceOrder parcelIds={[data.parcel.id]} title={t('一句话安排这件快递')}/></details>}
    <p role="alert">{message}</p>
    <div className="action-bar"><PriceSummary amount={amount}/><button ref={orderButton} className={busy?'is-busy':undefined} disabled={busy||amount===null||data.parcel.status!=='ACTIVE'} onClick={()=>void order()}>{busy?t('正在创建…'):t('确认并下单')}</button></div></>}
    {!data&&<p role="alert">{message}</p>}<p className="page-foot-link"><Link to="/orders">{t('查看已有订单')}</Link></p>
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
      if(action==='hide'){toast('订单已隐藏','success',t('退款和审计记录仍然保留'));navigate('/orders',{replace:true});return;}
      onMessage(action==='cancel'?t('配送已取消，已模拟退款 {0}，未发生真实资金流转',{0:money(result.refund?.amountFen??0)}):result.message??(action==='note'?t('备注已修改'):t('配送方式已更新')));await refresh();
    } catch(error){onMessage((error as Error).message);await refresh();}finally{setBusy(false);}
  }
  const closed=['CANCELLED','COMPLETED'].includes(order.status),delivered=order.status.startsWith('DELIVERED');
  return <div className="order-actions"><h2>{t('订单管理')}</h2>{!closed&&<details><summary>{t('修改备注')}</summary><label>{t('新备注')}<textarea maxLength={120} value={note} onChange={e=>setNote(e.target.value)} disabled={busy}/></label><ConfirmAction label={t('保存备注')} title={t('确认修改备注？')} busy={busy} onConfirm={()=>act('note')}><p>{note||t('将清空备注')}</p></ConfirmAction></details>}
    <div className="actions">{closed?<ConfirmAction label={t('隐藏订单')} title={t('确认隐藏订单？')} busy={busy} onConfirm={()=>act('hide')}><p>{t('仅从列表移除，不发起新的退款；退款和审计记录仍然保留。')}</p></ConfirmAction>:delivered||order.status==='WAITING_PAYMENT'?null:order.custodyState==='STAFF'?<p className="muted cancel-blocked">{t('包裹已在配送员手中，暂时不能自行取消。如需取消，请先通过下方聊天或电话联系配送员，把包裹归还站点并完成核验。')}</p>:<ConfirmAction label={t('取消配送')} title={t('确认取消配送并模拟退款？')} busy={busy} onConfirm={()=>act('cancel')}><p>订单将取消配送并按实际模拟支付金额退款，当前可退 {money(order.refundableFen)}。订单会保留，方便查看退款结果。</p></ConfirmAction>}
    {order.deliveryMode==='DOWNSTAIRS'&&!order.dropPlace&&['WAITING_PICKUP','PICKED_UP','OUT_FOR_DELIVERY'].includes(order.status)&&<ConfirmAction label={t('改为送到寝室 · 补{0}',{0:yuan(order.upgradeQuoteFen??upgradePriceFen(order.packageSize))})} title={t('确认升级配送并模拟补付？')} busy={busy} onConfirm={()=>act('upgrade')}><p>额外模拟支付 {money(order.upgradeQuoteFen??upgradePriceFen(order.packageSize))}，改为送到已保存的寝室；未发生真实扣款。</p></ConfirmAction>}</div></div>;

}
/** Start a new parcel with this order's size and delivery mode prefilled. */
function ReorderLink({order}:{order:Order}){
  const {userId}=useStudentSession();
  if(!['COMPLETED','CANCELLED'].includes(order.status))return null;
  return <Link className="reorder-link" to="/parcel/new" state={{packageSize:order.packageSize,deliveryMode:order.deliveryMode,ownerId:userId}}>{t('再来一单 ›')}</Link>;
}
/** Key facts of an order as a labelled grid (replaces a column of loose lines). */
function OrderFacts({order:o}:{order:Order}){
  return <dl className="order-facts">
    <div><dt><SymbolIcon name="room"/>{o.dropPlace?t('送达地点'):t('收货寝室')}</dt><dd>{o.dropPlace?t(DROP_PLACE_LABELS[o.dropPlace]):`${o.dormSnapshot.buildingName} · ${o.dormSnapshot.roomNo}`}</dd></div>
    <div><dt><SymbolIcon name="box"/>{t('包裹与方式')}</dt><dd>{t(sizeLabel(o.packageSize))} · {o.dropPlace?t('送到约定地点'):o.deliveryMode==='ROOM'?t('送到寝室'):t('送到楼下')}</dd></div>
    {o.proxyName&&<div><dt><SymbolIcon name="person"/>{t('代收人')}</dt><dd>{o.proxyName}</dd></div>}
    <div><dt><SymbolIcon name="home"/>{t('取件站点')}</dt><dd>{o.stationSnapshot.canonicalName}</dd></div>
    {orderSlotText(o)&&<div><dt><SymbolIcon name="bell"/>{t('预约送达')}</dt><dd>{orderSlotText(o)}</dd></div>}
    <div><dt><SymbolIcon name="order"/>{t('下单时间')}</dt><dd>{new Date(o.createdAt*1000).toLocaleString(locale(),{hour12:false})}</dd></div>
    <div className="wide"><dt><SymbolIcon name="chat"/>{t('备注')}</dt><dd>{o.note||t('暂无备注')}</dd></div>
    {o.upgradeFen>0&&<div className="wide"><dt><SymbolIcon name="plane"/>{t('升级补款')}</dt><dd>含升级配送模拟补款 {money(o.upgradeFen)}</dd></div>}
  </dl>;
}
/** v4.6 · who is delivering and how to reach them, right under the status: one tap to call, one to open the chat. */
function CourierBar({order:o}:{order:Order}){
  if(!o.hasAssignee||['COMPLETED','CANCELLED','WAITING_PAYMENT'].includes(o.status))return null;
  const stage=o.status==='WAITING_PICKUP'?t('配送员已接单'):o.status==='PICKED_UP'?t('已取件，准备出发'):o.status==='OUT_FOR_DELIVERY'?t('正在送来的路上'):o.status.startsWith('DELIVERED')?t('已送达，等你确认'):t('配送员正在处理');
  const openChat=()=>{const el=document.querySelector<HTMLElement>('.order-chat');if(!el)return;if(!el.classList.contains('expanded'))el.querySelector<HTMLElement>('.order-chat-toggle')?.click();el.scrollIntoView({behavior:'smooth',block:'center'});};
  return <div className="courier-bar"><span className="courier-avatar" aria-hidden="true"><SymbolIcon name="person"/></span><div><strong>{stage}</strong><small>{o.assigneePhone?t('有事可以直接联系'):t('可以给配送员留言')}</small></div><div className="courier-actions">{o.assigneePhone&&<a className="button secondary small" href={`tel:${o.assigneePhone}`} aria-label={t('拨打配送员电话 {0}',{0:o.assigneePhone})}><SymbolIcon name="phone"/>{t('电话')}</a>}<button type="button" className="secondary small" onClick={openChat}><SymbolIcon name="chat"/>{t('留言')}</button></div></div>;
}
function DeliveryContact({order}:{order:Order}){if(!order.serviceNotice&&!order.assigneePhone&&!order.exceptionNote)return null;return <div className="delivery-contact">{order.serviceNotice&&<p role="status">{order.serviceNotice}</p>}{order.assigneePhone&&<p>{t('接单人联系电话：')}<a href={`tel:${order.assigneePhone}`}>{order.assigneePhone}</a></p>}{order.exceptionNote&&<p role="alert">配送问题说明：{order.exceptionNote}</p>}</div>;}
const ORDER_TABS={
  ALL:[t('全部'),()=>true],
  ACTIVE:[t('进行中'),(o:Order)=>!['COMPLETED','CANCELLED','DELIVERED_DOWNSTAIRS','DELIVERED_TO_ROOM'].includes(o.status)],
  RECEIPT:[t('待收货'),(o:Order)=>o.status.startsWith('DELIVERED')],
  DONE:[t('已完成'),(o:Order)=>o.status==='COMPLETED'],
  CANCELLED:[t('已取消'),(o:Order)=>o.status==='CANCELLED'],
} satisfies Record<string,[string,(o:Order)=>boolean]>;
/** Names the clicked card for the page transition, so it morphs into the waybill of the detail page. */
function morphFrom(e:MouseEvent<HTMLElement>,id:string){const card=e.currentTarget.closest('article');if(card instanceof HTMLElement&&viewTransitionsEnabled)card.style.viewTransitionName=vtName('o',id);}
export function Orders(){
  const [cursor,setCursor]=useState(''),[back,setBack]=useState<string[]>([]);
  const {data,error,loading,refresh,unauthorized}=useStudentResource<{orders:Order[];nextCursor:string|null}>(`/orders?pageSize=20${cursor?'&cursor='+encodeURIComponent(cursor):''}`);const [tab,setTab]=useState<keyof typeof ORDER_TABS>('ALL');
  const all=data?.orders??[],shown=all.filter(ORDER_TABS[tab][1]);
  return <section><div className="row"><h1>{t('我的订单')}</h1>{!unauthorized&&<button className="text-button" onClick={()=>void refresh()}>{t('刷新')}</button>}</div><Notice error={error} unauthorized={unauthorized}/>{loading&&!data&&<LoadingState/>}{data?.orders.length===0&&<EmptyState title={t('还没有订单')} icon="order"><p>{t('登记取件码、选好送到哪，订单就会出现在这里。')}</p><Link className="button secondary" to="/parcel/new">{t('添加快递')}</Link></EmptyState>}
    {all.length>0&&<div className="order-tabs" role="group" aria-label={t('按状态筛选本页订单')}>{(Object.keys(ORDER_TABS) as (keyof typeof ORDER_TABS)[]).map(k=>{const n=all.filter(ORDER_TABS[k][1]).length;return <button key={k} type="button" className="chip" aria-pressed={tab===k} onClick={()=>setTab(k)}>{ORDER_TABS[k][0]}<b>{n}</b></button>;})}</div>}
    {all.length>0&&!shown.length&&<p className="muted">本页没有“{ORDER_TABS[tab][0]}”的订单。</p>}
    <div className="card-list">{shown.map(o=><article key={o.id} className="parcel-card"><div className="row"><span className="badge" data-status={o.status}>{t(STATUS_LABELS[o.status])}</span><GroupChip order={o}/><strong>{money(paidOf(o))}</strong></div><p className="order-place"><SymbolIcon name="room"/>{o.dropPlace?t(DROP_PLACE_LABELS[o.dropPlace]):`${o.dormSnapshot.buildingName} · ${o.dormSnapshot.roomNo}`}</p><p className="order-tags"><span>{t(sizeLabel(o.packageSize))}</span><span>{o.deliveryMode==='ROOM'?t('送到寝室'):t('送到楼下')}</span><time dateTime={new Date(o.createdAt*1000).toISOString()}>{new Date(o.createdAt*1000).toLocaleString(locale(),{month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'})}</time></p>{(o.exceptionCode||o.exceptionNote)&&<p className="order-alert" role="note">{t('配送遇到问题，请进入详情查看处理说明')}</p>}<div className="order-primary"><Link className={o.status==='WAITING_PAYMENT'||o.status.startsWith('DELIVERED')?'button':'button secondary'} to={o.status==='WAITING_PAYMENT'?`/checkout/${o.id}`:`/orders/${o.id}`} onClick={e=>morphFrom(e,o.id)}>{o.status==='WAITING_PAYMENT'?t('继续模拟支付'):o.status.startsWith('DELIVERED')?t('确认收货'):t('查看详情')} ›</Link><ReorderLink order={o}/></div></article>)}</div>
    {data&&(back.length>0||!!data.nextCursor)&&<div className="actions pager"><button className="secondary" disabled={!back.length} onClick={()=>{setCursor(back.at(-1)!);setBack(back.slice(0,-1));}}>{t('订单上一页')}</button><span>{t('第 {0} 页',{0:back.length+1})}</span><button className="secondary" disabled={!data?.nextCursor} onClick={()=>{setBack([...back,cursor]);setCursor(data!.nextCursor!);}}>{t('订单下一页')}</button></div>}
  </section>;
}
export interface Details {order:Order;events:OrderEvent[];payments:Payment[]}
export function OrderDetail({checkout=false}:{checkout?:boolean}){
  const params=useParams();const id=params.id??params.orderId;const {data,error,refresh,revalidate,loading,unauthorized}=useStudentResource<Details>(`/orders/${id}`);
  useLiveOrder(data?.order.status,revalidate);useStatusToast(data?.order);const {session}=useStudentSession();const baseline=useOrderBaseline(data?.order);const statusChanged=!!baseline&&!!data&&baseline.status!==data.order.status;
  const [message,setMessage]=useState(''),[busy,setBusy]=useState(false);
  const [coupon,setCoupon]=useState<CouponChoice|null>(null),[bundleFen,setBundleFen]=useState(0),[rainFen,setRainFen]=useState(0);
  async function pay(){setBusy(true);try{await api(`/orders/${id}/mock-pay`,'POST',coupon?{couponId:coupon.couponId,...(coupon.code?{code:coupon.code}:{})}:{});setMessage('');toast('模拟支付成功','success',t('订单已进入接单市场，配送员接单后会通知你'));celebrate();await refresh();}catch(e){setMessage((e as Error).message);}finally{setBusy(false);}}
  async function cancel(){setBusy(true);try{await api(`/orders/${id}/cancel`,'POST',{version:(data?.order??o)!.version,confirmed:true});setMessage(t('订单已取消'));await refresh();}catch(e){setMessage((e as Error).message);}finally{setBusy(false);}}
  const o=data?.order;const live=!!o&&['WAITING_PICKUP','PICKED_UP','OUT_FOR_DELIVERY'].includes(o.status);
  return <section className="order-page"><div className="page-head"><Link className="back-link" to="/orders">{t('← 我的订单')}</Link><h1>{checkout&&o?.status==='WAITING_PAYMENT'?t('确认模拟支付'):t('配送进度')}</h1>{o&&<div className="status-line"><span key={o.status} data-status={o.status} className={statusChanged?'badge just-advanced':'badge'}><BounceText text={t(STATUS_LABELS[o.status])} playOnMount={statusChanged}/></span>{session==='signed-in'&&shouldWatchOrder(o.status)&&o.status!=='WAITING_PAYMENT'&&<LiveIndicator/>}</div>}{o&&<p className="order-brief">{o.dropPlace?t(DROP_PLACE_LABELS[o.dropPlace]):`${o.dormSnapshot.buildingName} · ${o.dormSnapshot.roomNo}`} · {t(sizeLabel(o.packageSize))} · {o.deliveryMode==='ROOM'?t('送到寝室'):t('送到楼下')} · <b>{money(paidOf(o))}</b></p>}</div><Notice error={error} unauthorized={unauthorized}/>{loading&&!o&&<LoadingState/>}{o&&<div className={live?'order-layout is-live':'order-layout'}>
    <div className="order-main">
      <GroupStrip order={o}/>{o.checkoutId&&<Link className="checkout-link" to={`/checkout-batch/${o.checkoutId}`}><SymbolIcon name="box"/>{t('这件属于一次多件下单，查看同一次下单的全部包裹 ›')}</Link>}{live&&!o.slotDate&&<WeatherNotice/>}
      {o.status==='COMPLETED'&&<div className="success-panel"><SuccessMark/><p><strong><BounceText text={t('订单已完成')}/></strong><br/><small>{t('感谢使用 CampusDrop 校园配送')}</small></p></div>}{o.status==='COMPLETED'&&<RatingPanel orderId={o.id}/>}<NearBanner order={o}/><CourierBar order={o}/>{o.handoffCode&&<HandoffCodeCard code={o.handoffCode} status={o.status}/>}{live&&<Suspense fallback={<div className="live-map-skeleton" aria-hidden="true"/>}><OrderLiveMap order={o}/></Suspense>}{o.hasAssignee&&!['COMPLETED','CANCELLED'].includes(o.status)&&<OrderChat orderId={o.id} unread={o.chatUnreadStudent??0} startOpen={(o.chatUnreadStudent??0)>0}/>}{o.hasPhoto&&!lostCardVisible(o)&&<DeliveryPhotoView orderId={o.id}/>}<LostParcelCard order={o}/>
      {o.status==='WAITING_PAYMENT'&&<><CouponPicker orderId={o.id} amountFen={o.amountFen} onChange={setCoupon} onBundle={setBundleFen} onRain={setRainFen}/><CouponTotal amountFen={o.amountFen} choice={coupon} bundleFen={bundleFen} rainFen={rainFen}/></>}
      {o.status==='WAITING_PAYMENT'&&<div className="action-bar"><span className="action-sum"><small>{t('实付')}</small><b>{money(o.amountFen-bundleFen-(coupon?.discountFen??0)+rainFen)}</b></span><button className="text-button" disabled={busy} onClick={()=>void cancel()}>{t('取消订单')}</button><MockPaymentDialog amount={o.amountFen-bundleFen-(coupon?.discountFen??0)+rainFen} busy={busy} onPay={pay}/></div>}
      {o.exceptionCode&&<p role="alert">异常原因：{{CODE_INVALID:t('取件码无效'),SIZE_MISMATCH:t('大小件不符'),UNREACHABLE:t('暂时无法联系'),OTHER:t('其他异常')}[o.exceptionCode]??t('其他异常')}，请联系管理员处理。</p>}
      {['DELIVERED_DOWNSTAIRS','DELIVERED_TO_ROOM'].includes(o.status)&&<div className="action-bar"><span className="action-sum"><small>{o.status==='DELIVERED_TO_ROOM'?t('已送到寝室'):t('已送到楼下')}</small><b className="is-text">{t('拿到包裹后确认')}</b></span><ConfirmAction primary label={t('确认收货')} title={t('确认已经收到包裹？')} busy={busy} onConfirm={async()=>{setBusy(true);try{await api(`/orders/${id}/receive`,'POST',{version:o.version,confirmed:true});await refresh();setMessage(t('收货已确认，谢谢使用'));toast('收货已确认','success',t('顺手给这次配送打个分吧'));celebrate();}catch(e){setMessage((e as Error).message);}finally{setBusy(false);}}}><p>{t('请核对实际包裹。未收到或有问题时，请先发起售后。')}</p></ConfirmAction></div>}
      <h2 className="section-title">{t('配送时间线')}</h2>{data?<OrderTimeline events={data.events}/>:<LoadingState/>}
      <button className="text-button refresh-link" onClick={()=>void refresh()}>{t('刷新配送进度')}</button>
    </div>
    <aside className="order-aside">
      <div className="waybill" style={viewTransitionsEnabled?{viewTransitionName:vtName('o',o.id)}:undefined}><p className="price">{money(paidOf(o))}{((o.discountFen??0)>0||(o.bundleDiscountFen??0)>0||(o.rainFen??0)>0)&&<small className="price-was">{[t('原价 {0}',{0:money(o.amountFen)}),(o.bundleDiscountFen??0)>0?t('多件满减 -{0}',{0:money(o.bundleDiscountFen??0)}):'',(o.discountFen??0)>0?t('优惠券 -{0}',{0:money(o.discountFen??0)}):'',(o.rainFen??0)>0?t('雨天配送费 +{0}',{0:money(o.rainFen??0)}):''].filter(Boolean).join(' · ')}</small>}</p><OrderFacts order={o}/></div>
      {data?.payments.some(p=>p.type==='DELIVERY')&&<p className="pay-note"><SymbolIcon name="check"/>{t('模拟支付成功，未发生真实扣款')}</p>}
      {data?.payments.filter(p=>p.type==='REFUND').map(p=><p className="success" key={p.id}>已模拟退款 {money(p.amountFen)}，未发生真实资金流转</p>)}
      <DeliveryContact order={o}/><RoommatePanel order={o} refresh={refresh}/>
      {session==='signed-in'&&shouldWatchOrder(o.status)&&o.status!=='WAITING_PAYMENT'&&<NotifyToggle compact/>}
      <RoundHistory order={o}/>
      <nav className="order-links" aria-label={t('订单相关操作')}><Link to={`/orders/${o.id}/receipt`}><SymbolIcon name="order"/>{t('配送凭证')}</Link><Link to={`/tickets/new?orderId=${o.id}`}><SymbolIcon name="help"/>{t('发起售后')}</Link><Link to="/tickets"><SymbolIcon name="chat"/>{t('我的售后')}</Link><ReorderLink order={o}/></nav>
      {o.status==='COMPLETED'&&<Link className="button" to={`/tip/${o.id}`}>{t('感谢配送 · 模拟打赏')}</Link>}
      <OrderActions order={o} refresh={refresh} onMessage={setMessage}/>
    </aside>
    </div>}{message&&<p role="status">{message}</p>}
  </section>;
}
export function TipPage(){
  const {orderId}=useParams();const {data,error,refresh,loading,unauthorized}=useStudentResource<Details>(`/orders/${orderId}`);
  const [amount,setAmount]=useState('2'),[message,setMessage]=useState(''),[busy,setBusy]=useState(false);
  const storageKey=`campusdrop-tip-${orderId}`;const key=useRef(getItem(storageKey,'session')||randomClientId());
  async function tip(){
    if(!/^\d{1,3}(\.\d{1,2})?$/.test(amount)){setMessage(t('请输入 0.01–100 元，最多两位小数'));return;}
    const fen=Math.round(Number(amount)*100);if(fen<1||fen>10000){setMessage(t('金额应在 0.01–100 元之间'));return;}
    setBusy(true);setItem(storageKey,key.current,'session');
    try{await api(`/orders/${orderId}/tips/mock-pay`,'POST',{amountFen:fen,idempotencyKey:key.current});setMessage(t('打赏成功，未发生真实扣款'));toast('谢谢你的心意','success',t('模拟打赏已送达配送员'));celebrateFrom(document.querySelector('.tip-sheet .block-button'));await refresh();}
    catch(e){setMessage((e as Error).message);}finally{setBusy(false);}
  }
  const tipped=data?.payments.some(p=>p.type==='TIP');
  return <section><Link to={`/orders/${orderId}`}>{t('← 订单详情')}</Link><h1>{t('感谢这次配送')}</h1><Notice error={error} unauthorized={unauthorized}/>{loading&&!data&&<LoadingState/>}<p>{MOCK_MESSAGE}</p>
    {tipped?<div className="success-panel"><SuccessMark/><p className="success"><BounceText text={t('已收到你的模拟打赏，谢谢！')}/></p></div>:<TipSheet amount={amount} onChange={setAmount} busy={busy} disabled={data?.order.status!=='COMPLETED'} onSubmit={()=>void tip()}/>}
    <p role="status">{message}</p>
  </section>;
}

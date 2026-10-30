import {RouteProgress} from './route-progress';
import { copyText,inWeChat } from './wechat';
import {Suspense,lazy,useCallback,useEffect,useId,useMemo,useState} from 'react';
import {Link,useParams} from 'react-router-dom';
import {api} from './api';
import {toast} from './effects';
import {SymbolIcon} from './campus-design';
import {LoadingState} from './components';
import {locale,t} from './i18n';
import type {Order} from '../shared/delivery';
import type {TrackView} from '../shared/operations-rules';
import {DROP_PLACES,DROP_PLACE_LABELS,campusRoute,type DropPlace} from '../shared/campus-map';
const CampusMap=lazy(()=>import('./campus-map').then(m=>({default:m.CampusMap})));

// ---------------------------------------------------------------- 送到约定地点 (drop-off point)

/** Downstairs delivery can go to the dorm or to a campus landmark (library, canteen …) at the same price. */
export function DropPlacePicker({value,onChange}:{value:DropPlace|null;onChange:(place:DropPlace|null)=>void}){
  const id=useId();
  return <fieldset className="drop-picker"><legend>{t('送达地点')}</legend>
    <div className="drop-options" role="radiogroup" aria-label={t('送达地点')}>
      <button type="button" role="radio" aria-checked={!value} className={value?'':'selected'} onClick={()=>onChange(null)}><SymbolIcon name="room"/><span><strong>{t('宿舍楼下')}</strong><small>{t('按已保存的寝室')}</small></span></button>
      <button type="button" role="radio" aria-checked={!!value} className={value?'selected':''} onClick={()=>onChange(value??'LIBRARY')}><SymbolIcon name="map"/><span><strong>{t('约定地点')}</strong><small>{t('图书馆、餐厅、校门')}</small></span></button>
    </div>
    {value&&<><label htmlFor={id}>{t('选择地点')}</label><select id={id} value={value} onChange={e=>onChange(e.target.value as DropPlace)}>{DROP_PLACES.map(p=><option key={p} value={p}>{t(DROP_PLACE_LABELS[p])}</option>)}</select>
      <small className="muted">{t('价格与楼下配送相同；送到后请尽快取走，配送员不负责看管。')}</small></>}
  </fieldset>;
}

// ---------------------------------------------------------------- 快到了 banner

export function NearBanner({order}:{order:Order}){
  if(order.status!=='OUT_FOR_DELIVERY'||!order.nearNotifiedAt)return null;
  const where=order.dropPlace?t(DROP_PLACE_LABELS[order.dropPlace]):t('楼下');
  return <div className="near-banner" role="status"><span className="near-pulse" aria-hidden="true"/><p><strong>{t('配送员快到了')}</strong><span>{order.proxyName?t('请提醒 {name} 到{where}取件',{name:order.proxyName,where}):t('请准备到{where}取件',{where})}</span></p></div>;
}

// ---------------------------------------------------------------- 室友代收 + 进度分享

export function RoommatePanel({order,refresh}:{order:Order;refresh:()=>Promise<void>}){
  const [name,setName]=useState(order.proxyName??''),[token,setToken]=useState<string|null>(order.shareToken??null),[busy,setBusy]=useState(false),[message,setMessage]=useState('');
  useEffect(()=>{setName(order.proxyName??'');},[order.proxyName]);
  useEffect(()=>{setToken(order.shareToken??null);},[order.shareToken]);
  if(['COMPLETED','CANCELLED','WAITING_PAYMENT'].includes(order.status))return null;
  const link=token?`${location.origin}${location.pathname.startsWith('/')&&!location.hash?'':'/#'}/track/${token}`:'';
  async function saveName(){setBusy(true);setMessage('');try{await api(`/orders/${order.id}/proxy`,'PATCH',{name:name.trim(),version:order.version});await refresh();toast(name.trim()?t('已设置代收人'):t('已清除代收人'),'success');}catch(e){setMessage((e as Error).message);}finally{setBusy(false);}}
  async function share(){setBusy(true);setMessage('');try{const r=await api<{token:string}>(`/orders/${order.id}/share`,'POST');setToken(r.token);}catch(e){setMessage((e as Error).message);}finally{setBusy(false);}}
  async function revoke(){setBusy(true);try{await api(`/orders/${order.id}/share`,'DELETE');setToken(null);toast(t('分享链接已关闭'),'info');}catch(e){setMessage((e as Error).message);}finally{setBusy(false);}}
  async function copy(){
    const text=t('帮我取一下快递～实时进度：{link}',{link});
    if(navigator.share){try{await navigator.share({title:t('CampusDrop 配送进度'),text,url:link});return;}catch{/* fall back to copying */}}
    void copyText(link).then(ok=>ok?toast(t('链接已复制'),'success',inWeChat?t('在微信里直接粘贴发给室友即可'):t('发给室友即可查看进度')):toast(t('复制失败，请手动复制链接'),'warn'));
  }
  return <details className="roommate-panel" open={!!order.proxyName||!!token}><summary><SymbolIcon name="share"/>{t('室友代收与进度分享')}{order.proxyName&&<span className="chip-tag">{order.proxyName}</span>}</summary>
    <p className="muted">{t('自己不在寝室时，可以写上代收人的称呼（配送员会看到），再把只读进度链接发给 TA。链接不显示姓名、电话和房间号，订单结束一天后自动失效。')}</p>
    <div className="inline-form"><label>{t('代收人称呼')}<input maxLength={16} value={name} onChange={e=>setName(e.target.value)} placeholder={t('例如：室友小王')} disabled={busy}/></label><button type="button" className="secondary" disabled={busy||name.trim()===(order.proxyName??'')} onClick={()=>void saveName()}>{t('保存')}</button></div>
    {token?<div className="share-link"><code>{link}</code><div className="actions"><button type="button" onClick={()=>void copy()}>{t('发送给室友')}</button><Link className="text-button" to={`/track/${token}`}>{t('预览')}</Link><button type="button" className="text-button" disabled={busy} onClick={()=>void revoke()}>{t('关闭链接')}</button></div></div>
      :<button type="button" className="secondary" disabled={busy} onClick={()=>void share()}>{t('生成进度链接')}</button>}
    {message&&<p role="alert">{message}</p>}
  </details>;
}

// ---------------------------------------------------------------- 送达照片

export function DeliveryPhotoView({orderId,admin=false}:{orderId:string;admin?:boolean}){
  const [photo,setPhoto]=useState<{dataUrl:string;createdAt:number}|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState('');
  async function load(){setBusy(true);setError('');try{const r=await api<{photo:{dataUrl:string;createdAt:number}}>(`${admin?'/admin':''}/orders/${orderId}/photo`);setPhoto(r.photo);}catch(e){setError((e as Error).message);}finally{setBusy(false);}}
  return <div className="delivery-photo">{photo?<figure><img src={photo.dataUrl} alt={t('配送员拍摄的送达照片')}/><figcaption>{t('送达照片')} · {new Date(photo.createdAt*1000).toLocaleString(locale(),{month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'})} · {t('保留 30 天')}</figcaption></figure>
    :<button type="button" className="secondary" disabled={busy} onClick={()=>void load()}><SymbolIcon name="camera"/>{busy?t('正在加载…'):t('查看送达照片')}</button>}{error&&<p role="alert">{error}</p>}</div>;
}

// ---------------------------------------------------------------- /track/:token — read-only progress for a roommate

const STEPS=['已下单','已取件','配送中','已送达'];
function stepOf(status:string){return ['COMPLETED','DELIVERED_DOWNSTAIRS','DELIVERED_TO_ROOM'].includes(status)?3:status==='OUT_FOR_DELIVERY'?2:status==='PICKED_UP'?1:0;}
export function TrackPage(){
  const {token}=useParams();const [data,setData]=useState<TrackView|null>(null),[error,setError]=useState('');
  const load=useCallback(async()=>{try{const r=await api<{track:TrackView}>(`/track/${token}`);setData(r.track);setError('');}catch(e){setError((e as Error).message);}},[token]);
  useEffect(()=>{void load();const timer=setInterval(()=>{if(!document.hidden)void load();},20000);return()=>clearInterval(timer);},[load]);
  const route=useMemo(()=>data?campusRoute(data.stationCode,data.destination):null,[data]);
  if(error&&!data)return <section className="track-page"><h1>{t('进度链接')}</h1><p role="alert">{error}</p><Link to="/">{t('返回首页')}</Link></section>;
  if(!data)return <section className="track-page"><LoadingState/></section>;
  const step=stepOf(data.status),done=step===3;
  return <section className="track-page"><p className="eyebrow">CAMPUSDROP · {t('只读进度')}</p>
    <h1>{data.proxyName?t('{name}，这是帮同学代收的包裹',{name:data.proxyName}):t('同学分享的配送进度')}</h1>
    <p className="muted">{t('送到')} {data.dropPlace?t(data.dropPlace):data.buildingName}{data.slot&&<> · {t('预约')} {data.slot}</>}</p>
    <RouteProgress steps={STEPS.map(l=>t(l))} current={step} done={done} label={`${t('配送阶段')}：${t(STEPS[step])}`}/>
    {data.status==='CANCELLED'&&<p role="alert">{t('这单已取消')}</p>}
    {data.eta&&!done&&<p className="track-eta"><strong>{data.eta.minutes<=1?t('马上到'):t('约 {n} 分钟',{n:data.eta.minutes})}</strong><small>{data.courier?.source==='gps'?t('按配送员实时定位'):t('按路线估算')}</small></p>}
    {route&&!done&&<Suspense fallback={<div className="live-map-skeleton" aria-hidden="true"/>}><CampusMap route={route} courier={data.courier?{...data.courier,updatedAt:null}:null} fit label={t('配送路线')}/></Suspense>}
    <ol className="track-events">{[...data.events].reverse().map((e,i)=><li key={i}><strong>{t(e.status)}</strong><time>{new Date(e.at*1000).toLocaleString(locale(),{month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'})}</time></li>)}</ol>
    <p className="muted small">{t('此页面不显示姓名、电话、房间号和取件码。每 20 秒自动刷新。')}</p>
  </section>;
}

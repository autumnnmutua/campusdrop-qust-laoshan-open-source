import {Fragment,useCallback,useEffect,useRef,useState,type CSSProperties} from 'react';
import {Link} from 'react-router-dom';
import {api} from './api';
import {toast} from './effects';
import {AdminShell} from './admin-delivery';
import {LoadingState} from './components';
import {useResource} from './student-delivery';
import {CampusMap,buildingLong} from './campus-map';
import type {Admin} from '../shared/contracts';
import type {LiveMapData} from '../shared/live';
import {CALIBRATION_LANDMARKS,buildingByCode,placeById,type LandmarkId} from '../shared/campus-map';
import {DELIVERY_SLOTS,dayLabel,slotByCode,type SlotCode} from '../shared/slots';
import type {MileageRow,Shift,ShiftCapacity} from '../shared/operations-rules';
import {SymbolIcon} from './campus-design';
import {subscribePush,unsubscribePush} from './notify';
import {getItem,removeItem,setItem} from './storage';

// ---------------------------------------------------------------- admin: 作战地图

export function AdminLiveMap(){
  const me=useResource<{admin:Admin}>('/admin/me'),ready=!!me.data;
  const map=useResource<LiveMapData>('/admin/live-map',ready);
  const [picked,setPicked]=useState<string|null>(null);
  const {revalidate}=map;
  useEffect(()=>{if(!ready)return;const t=setInterval(()=>{if(!document.hidden)void revalidate().catch(()=>{});},20000);return()=>clearInterval(t);},[ready,revalidate]);
  const d=map.data,loads=d?.buildings??[];
  const totals=loads.reduce((s,l)=>({active:s.active+l.active,exceptions:s.exceptions+l.exceptions,awaiting:s.awaiting+l.awaitingReceipt}),{active:0,exceptions:0,awaiting:0});
  const ranked=[...loads].sort((a,b)=>b.exceptions-a.exceptions||b.active-a.active).slice(0,8),busiest=Math.max(1,...ranked.map(l=>l.active+l.awaitingReceipt));
  const pickedLoad=picked?loads.find(l=>l.code===picked):null,now=Math.floor(Date.now()/1000);
  return <AdminShell><div className="ops-map"><div className="row"><div><h1>作战地图</h1></div><Link to="/admin/route-sheet">配送路线单 ›</Link></div>
    <div className="ops-stats"><div><small>配送中</small><strong>{totals.active}</strong></div><div><small>待学生确认</small><strong>{totals.awaiting}</strong></div><div className={totals.exceptions?'warn':''}><small>异常</small><strong>{totals.exceptions}</strong></div><div><small>在线配送员</small><strong>{d?.couriers.length??0}</strong></div></div>
    <p role="alert">{map.error}</p>{map.loading&&!d&&<LoadingState/>}
    {d&&<div className="map-layout"><CampusMap loads={loads} couriers={d.couriers} highlight={picked} onBuilding={setPicked} label="配送作战地图：楼栋订单热度与配送员位置">{!d.calibrated&&' · 尚未校准，配送员位置不显示'}</CampusMap>
      <aside className="map-side">{picked&&<div key={picked} className="map-pick"><h2>{buildingLong(picked)}</h2>{pickedLoad?<ul className="pick-stats"><li>配送中 <strong>{pickedLoad.active}</strong></li><li>待确认 <strong>{pickedLoad.awaitingReceipt}</strong></li><li>异常 <strong>{pickedLoad.exceptions}</strong></li></ul>:<p className="muted">这栋楼当前没有进行中的订单。</p>}</div>}
        <h2>楼栋热度</h2>{ranked.length?<ol className="heat-list">{ranked.map(l=><li key={l.code}><button type="button" onClick={()=>setPicked(l.code)}><span>{buildingLong(l.code)}</span><i style={{'--w':`${Math.round((l.active+l.awaitingReceipt)/busiest*100)}%`} as CSSProperties}/><b>{l.active+l.awaitingReceipt}{l.exceptions?<em> · {l.exceptions} 异常</em>:null}</b></button></li>)}</ol>:<p className="muted">授权范围内暂无进行中的订单。</p>}
        <h2>预约时段负载</h2><ul className="slot-load">{d.slots.map(s=>{const label=slotByCode(s.code as SlotCode).label;return <li key={s.date+s.code}><span>{dayLabel(s.date,now)} {label}</span><i style={{'--w':`${s.capacity?Math.min(100,Math.round(s.booked/s.capacity*100)):100}%`} as CSSProperties}/><b>{s.booked}/{s.capacity}</b></li>;})}{!d.slots.length&&<li className="muted">今明两天已没有可预约的时段</li>}</ul>
        <MileageBoard/>
      </aside></div>}
    <ShiftPanel/><CourierShare/><AdminPushToggle/>
    {me.data?.admin.role==='SUPER_ADMIN'&&<CalibrationPanel calibrated={!!d?.calibrated} onSaved={()=>void map.refresh()}/>}
  </div></AdminShell>;
}

/** Courier opt-in location sharing: only while this page is open and the switch is on; stopping deletes the fix. */
function CourierShare(){
  const [on,setOn]=useState(false),[info,setInfo]=useState(''),watch=useRef<number|null>(null),last=useRef(0);
  const stop=useCallback(async(silent=false)=>{if(watch.current!==null)navigator.geolocation.clearWatch(watch.current);watch.current=null;setOn(false);try{await api('/admin/location','DELETE');}catch{/* expires in 2 minutes anyway */}if(!silent)toast('已停止共享位置','info');},[]);
  useEffect(()=>()=>{if(watch.current!==null){navigator.geolocation.clearWatch(watch.current);void api('/admin/location','DELETE').catch(()=>{});}},[]);
  function start(){
    if(!('geolocation' in navigator)){setInfo('当前浏览器不支持定位');return;}
    setOn(true);setInfo('正在获取定位…');
    watch.current=navigator.geolocation.watchPosition(async pos=>{
      // Send at most every 15 s; the server keeps only the latest fix.
      if(Date.now()-last.current<15000)return;last.current=Date.now();
      try{const r=await api<{watchers:number}>('/admin/location','POST',{lat:pos.coords.latitude,lng:pos.coords.longitude,accuracy:Math.min(5000,pos.coords.accuracy)});setInfo(`已共享 · 精度约 ${Math.round(pos.coords.accuracy)} 米 · ${r.watchers} 位同学正在看`);}
      catch(e){setInfo((e as Error).message);}
    },error=>{setInfo(error.code===error.PERMISSION_DENIED?'定位权限被拒绝，请在浏览器设置中允许':'暂时无法定位，请到室外重试');void stop(true);},{enableHighAccuracy:true,maximumAge:10000,timeout:20000});
  }
  return <div className="courier-share"><label className="switch"><input type="checkbox" checked={on} onChange={()=>on?void stop():start()}/><span><strong>出发配送 · 共享我的位置</strong><small>{info||'仅在本页打开且开关开启时共享，订单学生可看到你在地图上的位置；关闭后立即删除。'}</small></span></label></div>;
}

/** Super admin, on site: stand at two landmarks far apart and record the phone's GPS at each. */
function CalibrationPanel({calibrated,onSaved}:{calibrated:boolean;onSaved:()=>void}){
  const [points,setPoints]=useState<{landmark:LandmarkId;lat:number;lng:number}[]>([]),[landmark,setLandmark]=useState<LandmarkId>('YIHAIYUAN'),[busy,setBusy]=useState(false),[message,setMessage]=useState('');
  const name=(id:string)=>placeById(id)?.label??(buildingByCode(id)?buildingLong(id):id);
  function capture(){
    if(!('geolocation' in navigator)){setMessage('当前浏览器不支持定位');return;}
    setBusy(true);setMessage('正在定位，请站在地标门口稍候…');
    navigator.geolocation.getCurrentPosition(pos=>{
      setBusy(false);if(pos.coords.accuracy>40){setMessage(`定位精度约 ${Math.round(pos.coords.accuracy)} 米，误差偏大，建议到开阔处重试`);}else setMessage('');
      setPoints(prev=>[...prev.filter(p=>p.landmark!==landmark),{landmark,lat:pos.coords.latitude,lng:pos.coords.longitude}].slice(-5));
    },()=>{setBusy(false);setMessage('定位失败，请允许定位权限后重试');},{enableHighAccuracy:true,timeout:30000,maximumAge:0});
  }
  async function save(){setBusy(true);try{const r=await api<{calibration:{residualMeters?:number}}>('/admin/map-calibration','PUT',{points});setMessage(points.length>=4?`校准已保存，各地标的定位误差不超过 ${r.calibration.residualMeters??0} 米`:points.length===3?'校准已保存（三点校准可修正平面图的旋转；记录 4 个地标还能估算误差）':'校准已保存（两点校准假设平面图正北朝上；建议记录 3–4 个地标）');toast('地图校准完成','success');setPoints([]);onSaved();}catch(e){setMessage((e as Error).message);}finally{setBusy(false);}}
  async function clear(){setBusy(true);try{await api('/admin/map-calibration','DELETE');setMessage('校准已清除');onSaved();}catch(e){setMessage((e as Error).message);}finally{setBusy(false);}}
  return <details className="calibration"><summary>地图现场校准{calibrated?' · 已校准':' · 未校准'}</summary>
    <p className="muted">官方平面图没有经纬度。请在现场依次站到 3–4 个分散的地标（建议颐海苑站点、北苑餐厅、东门、图书馆），分别点“记录当前位置”。三个以上的点能修正平面图与正北方向的偏差，四个点还会算出误差；只记两个点时按“平面图正北朝上”换算。</p>
    <div className="calibration-row"><label>地标<select value={landmark} onChange={e=>setLandmark(e.target.value as LandmarkId)}>{CALIBRATION_LANDMARKS.map(id=><option key={id} value={id}>{name(id)}</option>)}</select></label><button type="button" className="secondary" disabled={busy} onClick={capture}>记录当前位置</button></div>
    <ol className="calibration-points">{points.map(p=><li key={p.landmark}>{name(p.landmark)} · {p.lat.toFixed(5)}, {p.lng.toFixed(5)}</li>)}</ol>
    <div className="actions"><button type="button" disabled={busy||points.length<2} onClick={()=>void save()}>保存校准（{points.length} 个地标）</button>{points.length>0&&<button type="button" className="text-button" disabled={busy} onClick={()=>setPoints([])}>重新记录</button>}{calibrated&&<button type="button" className="text-button" disabled={busy} onClick={()=>void clear()}>清除校准</button>}</div>
    <p role="status">{message}</p>
  </details>;
}

const ADMIN_PUSH_KEY='campusdrop:push-admin';
/** Courier push: student chat messages arrive on this device even with the workspace closed. */
function AdminPushToggle(){
  const [on,setOn]=useState(getItem(ADMIN_PUSH_KEY)==='1'),[busy,setBusy]=useState(false);
  if(typeof Notification==='undefined')return null;
  async function toggle(){
    setBusy(true);
    try{
      if(on){await unsubscribePush('admin');removeItem(ADMIN_PUSH_KEY);setOn(false);toast('已关闭消息推送','info');return;}
      const permission=Notification.permission==='granted'?'granted':await Notification.requestPermission();
      if(permission!=='granted'){toast('浏览器拒绝了通知权限','warn');return;}
      if(await subscribePush('admin')){setItem(ADMIN_PUSH_KEY,'1');setOn(true);toast('消息推送已开启','success','同学发来消息时会通知这台设备');}
      else toast('当前站点或浏览器暂不支持推送','warn','部署时需配置 VAPID 密钥，iPhone 需先添加到主屏幕');
    }finally{setBusy(false);}
  }
  return <div className="courier-share"><label className="switch"><input type="checkbox" checked={on} disabled={busy} onChange={()=>void toggle()}/><span><strong>同学消息推送</strong><small>{on?'已开启：即使关闭工作台，同学发来的消息也会推送到这台设备':'开启后，订单聊天的新消息会以系统通知提醒你'}</small></span></label></div>;
}

// ---------------------------------------------------------------- 排班 (courier shifts)
const SHIFT_CODES=DELIVERY_SLOTS.map(s=>s.code);
function ShiftPanel(){
  const r=useResource<{shifts:Shift[];dates:string[];shiftCapacity:ShiftCapacity}>('/admin/shifts');const me=useResource<{admin:Admin}>('/admin/me');
  const [mine,setMine]=useState<string[]>([]),[busy,setBusy]=useState(false);
  const myId=me.data?.admin.id,now=Math.floor(Date.now()/1000);
  useEffect(()=>{if(r.data&&myId)setMine(r.data.shifts.filter(s=>s.adminId===myId).map(s=>`${s.date}:${s.code}`));},[r.data,myId]);
  async function save(){setBusy(true);try{await api('/admin/shifts','PUT',{slots:mine.map(k=>{const [date,code]=k.split(':');return {date,code};})});toast('班次已保存','success');await r.refresh();}catch(e){toast((e as Error).message,'warn');}finally{setBusy(false);}}
  const d=r.data;
  return <details className="shift-panel"><summary><SymbolIcon name="calendar"/>我的排班{d?.shiftCapacity.enabled?' · 预约名额按排班计算':''}</summary>
    <p className="muted">勾选你能出勤的时段。{d?.shiftCapacity.enabled?'当前已开启“名额与排班联动”：每个时段的预约名额 = 每人名额 × 排班人数。':'超级管理员在「运营设置」开启“名额与排班联动”后，排班人数会决定每个时段的预约名额。'}</p>
    {d&&<><div className="shift-grid" role="group" aria-label="选择出勤时段"><span/>{SHIFT_CODES.map(c=><b key={c}>{slotByCode(c).label}</b>)}
      {d.dates.map(date=><Fragment key={date}><span>{dayLabel(date,now)}</span>{SHIFT_CODES.map(code=>{const key=`${date}:${code}`,on=mine.includes(key),others=d.shifts.filter(s=>s.date===date&&s.code===code&&s.adminId!==myId);
        return <label key={key} className={on?'on':''}><input type="checkbox" checked={on} onChange={e=>setMine(e.target.checked?[...mine,key]:mine.filter(k=>k!==key))}/><span>{on?'出勤':'—'}</span><small>{others.length?`另有 ${others.map(o=>o.username).join('、')}`:'暂无他人'}</small></label>;})}</Fragment>)}</div>
      <button type="button" disabled={busy} onClick={()=>void save()}>保存我的排班</button></>}
  </details>;
}

// ---------------------------------------------------------------- 今日里程 (route estimate)
function MileageBoard(){
  const r=useResource<{date:string;rows:MileageRow[]}>('/admin/mileage');const rows=r.data?.rows??[];const top=Math.max(1,...rows.map(x=>x.meters));
  return <><h2>今日里程</h2>{rows.length?<ol className="heat-list mileage">{rows.map(x=><li key={x.adminId}><span>{x.username}<small>{x.deliveries} 单{x.unplaced?` · ${x.unplaced} 单未计入`:''}</small></span><i style={{'--w':`${Math.round(x.meters/top*100)}%`} as CSSProperties}/><b>{(x.meters/1000).toFixed(1)} km</b></li>)}</ol>:<p className="muted">今天还没有送达记录。</p>}
    <small className="muted">按校园道路从站点到送达地点往返估算，不是实际步数。</small></>;
}

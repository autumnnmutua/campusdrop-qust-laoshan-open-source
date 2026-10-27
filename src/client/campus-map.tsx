import {useCallback,useEffect,useMemo,useState,type CSSProperties,type KeyboardEvent,type ReactNode} from 'react';
import {Link} from 'react-router-dom';
import {api} from './api';
import {SymbolIcon} from './campus-design';
import {useLiveConnected,useLiveEvents} from './live';
import {useStudentSession} from './session';
import type {Order} from '../shared/delivery';
import type {CourierPosition,MapBuildingLoad,MapCourier,OrderLive} from '../shared/live';
import {BUILDINGS,MAP_HEIGHT,MAP_IMAGE,MAP_WIDTH,campusRoute,pathLength,placeById,routeMeters,routeMinutes,type Point} from '../shared/campus-map';

/*
 * The official campus plan (官方校园平面图) with live layers drawn on top in SVG: dorm hotspots, the walking route,
 * couriers and load. The plan is a single static image, so no map tiles or third-party SDK are needed. Real GPS only
 * appears once a super admin calibrated the map on site; until then courier positions are estimated along the route
 * and labelled as such.
 */
export const buildingShort=(code:string)=>`${code.startsWith('NORTH')?'北':'南'}${Number(code.split('_')[1])}`;
export const buildingLong=(code:string)=>`${code.startsWith('NORTH')?'北苑':'南苑'}${Number(code.split('_')[1])}号楼`;
const pathD=(points:Point[])=>points.map((p,i)=>`${i?'L':'M'}${Math.round(p.x)} ${Math.round(p.y)}`).join(' ');

/** A view box around the given points, padded and kept between landscape and slightly portrait. */
function fitBox(points:Point[]){
  const xs=points.map(p=>p.x),ys=points.map(p=>p.y),pad=150;
  const cx=(Math.min(...xs)+Math.max(...xs))/2,cy=(Math.min(...ys)+Math.max(...ys))/2;
  let w=Math.max(Math.max(...xs)-Math.min(...xs)+pad*2,760),h=Math.max(Math.max(...ys)-Math.min(...ys)+pad*2,480);
  if(w/h>1.8)h=w/1.8;
  if(h/w>1.15)w=h/1.15;
  w=Math.min(w,MAP_WIDTH);h=Math.min(h,MAP_HEIGHT);
  const x=Math.min(MAP_WIDTH-w,Math.max(0,cx-w/2)),y=Math.min(MAP_HEIGHT-h,Math.max(0,cy-h/2));
  return {x,y,w,h};
}

interface MapProps {
  route?:Point[]|null;
  courier?:CourierPosition|null;
  couriers?:MapCourier[];
  loads?:MapBuildingLoad[];
  highlight?:string|null;
  onBuilding?:(code:string)=>void;
  /** Zoom to the route (and courier) instead of showing the whole campus. */
  fit?:boolean;
  label?:string;
  children?:ReactNode;
}
export function CampusMap({route,courier,couriers=[],loads=[],highlight,onBuilding,fit=false,label='青岛科技大学崂山校区官方平面图',children}:MapProps){
  const box=fit&&route?.length?fitBox(courier?[...route,courier]:route):{x:0,y:0,w:MAP_WIDTH,h:MAP_HEIGHT};
  // Markers and strokes are sized for a 1000-unit-wide view and scaled with the zoom so they look the same everywhere.
  const k=box.w/1000;
  // Draw from the station door, not its centre, so the route never covers the station's name.
  route=route&&route.length>2?route.slice(1):route;
  const routeLength=route?pathLength(route):0,maxLoad=Math.max(1,...loads.map(l=>l.active+l.awaitingReceipt));
  const station=placeById('YIHAIYUAN')!;
  return <figure className="campus-map">
    <svg viewBox={`${Math.round(box.x)} ${Math.round(box.y)} ${Math.round(box.w)} ${Math.round(box.h)}`} role="img" aria-label={label} style={{'--k':k.toFixed(3)} as CSSProperties}>
      <image href={MAP_IMAGE} width={MAP_WIDTH} height={MAP_HEIGHT} className="map-plan"/>
      <g className="map-place kind-station"><rect x={station.x-6} y={station.y-6} width={station.w+12} height={station.h+12} rx={8*k}/>
        <circle className="station-pulse" cx={station.x+station.w/2} cy={station.y+station.h/2} r={9*k}/>
        <g transform={`translate(${station.x+station.w/2} ${station.y+station.h+20*k}) scale(${k})`}><rect className="station-tag" x="-40" y="-11" width="80" height="22" rx="11"/><text y="4">取件站点</text></g></g>
      {BUILDINGS.map((b,i)=>{
        const load=loads.find(l=>l.code===b.code),heat=load?(load.active+load.awaitingReceipt)/maxLoad:0;
        const cls=['map-building',highlight===b.code&&'is-target',load?.exceptions&&'has-exception',onBuilding&&'is-clickable'].filter(Boolean).join(' ');
        return <g key={b.code} className={cls} style={{'--heat':heat.toFixed(2),'--i':i} as CSSProperties}
          {...(onBuilding?{role:'button',tabIndex:0,'aria-label':buildingLong(b.code),onClick:()=>onBuilding(b.code),onKeyDown:(e:KeyboardEvent)=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();onBuilding(b.code);}}}:{})}>
          <rect x={b.x} y={b.y} width={b.w} height={b.h} rx={6*k}/><title>{buildingLong(b.code)}</title>
          {load&&load.active+load.awaitingReceipt>0&&<g className="load-badge" transform={`translate(${b.x+b.w-4} ${b.y+4}) scale(${k})`}><circle r="11"/><text y="4">{load.active+load.awaitingReceipt}</text></g>}
          {load?.exceptions?<circle className="exception-ring" cx={b.x+b.w/2} cy={b.y+b.h/2} r={Math.max(b.w,b.h)/2+10}/>:null}
        </g>;
      })}
      {route&&<g className="map-route"><path d={pathD(route)} className="route-glow"/><path d={pathD(route)} className="route-line" style={{'--len':Math.ceil(routeLength)} as CSSProperties}/><path d={pathD(route)} className="route-ants" strokeDasharray={`${(2*k).toFixed(1)} ${(14*k).toFixed(1)}`} style={{'--ant':(-16*k).toFixed(1)} as CSSProperties}/>
        <circle cx={route[0].x} cy={route[0].y} r={9*k} className="route-start"/><g transform={`translate(${route.at(-1)!.x} ${route.at(-1)!.y}) scale(${k})`}><g className="route-end"><path d="M0 -26c-9 0-15 6-15 14 0 10 15 22 15 22s15-12 15-22c0-8-6-14-15-14Z"/><circle cy="-12" r="5"/></g></g></g>}
      {courier&&<g className={`map-courier source-${courier.source}`} style={{transform:`translate(${courier.x}px, ${courier.y}px)`}}><g transform={`scale(${k})`}><circle r="22" className="courier-halo"/><circle r="13" className="courier-dot"/><path d="M-6 -2h8l4 4v4h-12Z" className="courier-glyph"/></g></g>}
      {couriers.map(c=><g key={c.id} className="map-courier source-gps" style={{transform:`translate(${c.x}px, ${c.y}px)`}}><g transform={`scale(${k})`}><circle r="20" className="courier-halo"/><circle r="11" className="courier-dot"/><text y="-18" className="courier-name">{c.username}{c.active?` · ${c.active}单`:''}</text></g></g>)}
      <g className="map-compass" transform={`translate(${box.x+box.w-40*k} ${box.y+40*k}) scale(${k})`} aria-hidden="true"><circle r="24"/><path d="M0 -18 L6 0 L0 18 L-6 0Z"/><text y="-28">N</text></g>
    </svg>
    <figcaption>底图：青岛科技大学崂山校区官方平面图{children}</figcaption>
  </figure>;
}

// ---------------------------------------------------------------- /map: campus map for everyone

export function CampusMapPage(){
  const [picked,setPicked]=useState<string|null>(null);
  const route=useMemo(()=>picked?campusRoute('YIHAIYUAN',picked):null,[picked]);
  const station=placeById('YIHAIYUAN')!;
  return <section className="map-page"><p className="eyebrow">CAMPUSDROP / 校园地图</p><h1>崂山校区配送地图</h1>
    <p className="muted">点选宿舍楼，看看从颐海苑站点出发的配送路线和步行时间。底图为学校官方平面图，路线与时间为估算。</p>
    <div className="map-layout"><CampusMap route={route} highlight={picked} onBuilding={setPicked}/>
      <aside className="map-side">{picked&&route?<div key={picked} className="map-pick"><h2>{buildingLong(picked)}</h2><p className="map-minutes"><strong>{routeMinutes(route)}</strong> 分钟</p><p className="muted">从{station.label}步行约 {routeMeters(route)} 米（估算）</p><Link className="button" to="/parcel/new">安排一单送到这里</Link></div>
        :<div className="map-pick empty"><SymbolIcon name="room"/><p>选择地图上的楼栋</p></div>}
        <ul className="map-legend"><li><i className="lg-station"/>取件站点</li><li><i className="lg-building"/>宿舍楼</li><li><i className="lg-route"/>配送路线</li><li><i className="lg-courier"/>配送员</li></ul></aside></div>
  </section>;
}

// ---------------------------------------------------------------- order detail: ETA + live map

const ETA_BASIS={history:'依据近 30 天同类订单的实际送达用时',distance:'依据站点到楼栋的路线距离估算',slot:'按你预约的送达时段'} as const;
export function OrderLiveMap({order}:{order:Order}){
  const {session}=useStudentSession(),live=useLiveConnected();
  const [data,setData]=useState<OrderLive|null>(null);
  const route=useMemo(()=>campusRoute(order.stationSnapshot.code,order.dormSnapshot.buildingCode),[order.stationSnapshot.code,order.dormSnapshot.buildingCode]);
  const load=useCallback(async()=>{try{setData(await api<OrderLive>(`/orders/${order.id}/live`));}catch{/* keep the last estimate */}},[order.id]);
  useEffect(()=>{if(session==='signed-in')void load();},[load,session,order.status]);
  useLiveEvents(event=>{if(event.type==='location'||event.type==='order')void load();},order.id);
  // Without the socket, refresh the estimate every 30 s while out for delivery and visible.
  useEffect(()=>{if(live||order.status!=='OUT_FOR_DELIVERY')return;const t=setInterval(()=>{if(!document.hidden)void load();},30000);return()=>clearInterval(t);},[live,load,order.status]);
  const eta=data?.eta,courier=data?.courier;
  const arrive=eta?new Date(eta.arriveBy*1000).toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit',hour12:false}):'';
  const stage=order.status==='WAITING_PICKUP'?(order.hasAssignee?'配送员即将去站点取件':'等待配送员接单'):order.status==='PICKED_UP'?'包裹已取出，准备出发':'配送员正在路上';
  return <section className="order-live" aria-label="配送进度地图">
    <div className="eta-card"><div className="eta-copy"><small>{stage}</small>{eta?<><p className="eta-minutes"><strong key={eta.minutes}>{eta.basis==='slot'?eta.label.replace(/^预约 /,''):eta.minutes<=1?'马上到':eta.minutes}</strong>{eta.basis!=='slot'&&eta.minutes>1&&<span>分钟</span>}</p><p className="muted">{eta.basis==='slot'?'预约送达':`预计 ${arrive} 前送达`} · {ETA_BASIS[eta.basis]}</p></>:<p className="eta-minutes"><strong>—</strong></p>}</div>
      {courier&&<span className={`eta-source source-${courier.source}`}>{courier.source==='gps'?'实时定位':'按路线估算'}</span>}</div>
    {route&&<CampusMap route={route} courier={courier} highlight={order.dormSnapshot.buildingCode} fit label={`从${order.stationSnapshot.canonicalName}到${order.dormSnapshot.buildingName}的配送路线`}>{data&&!data.calibrated&&' · 配送员位置为估算'}</CampusMap>}
  </section>;
}

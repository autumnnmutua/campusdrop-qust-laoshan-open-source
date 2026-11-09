/* © 2026 专业团队 · CampusDrop v4.5.0 */
import {locale,t} from './i18n';
import {useCallback,useEffect,useMemo,useState,type CSSProperties,type KeyboardEvent,type ReactNode} from 'react';
import {Link} from 'react-router-dom';
import {api} from './api';
import {SymbolIcon} from './campus-design';
import {useLiveConnected,useLiveEvents} from './live';
import {useStudentSession} from './session';
import type {Order} from '../shared/delivery';
import type {CourierPosition,MapBuildingLoad,MapCourier,OrderLive} from '../shared/live';
import {BUILDINGS,BUILDING_NAMES,DROP_PLACE_LABELS,MAP_HEIGHT,MAP_IMAGE,MAP_WIDTH,STATION_PLACES,campusRoute,nearestStation,pathLength,placeById,routeMeters,routeMinutes,type Point} from '../shared/campus-map';
import {BuildingHeatBoard} from './heat-board';

/*
 * The official campus plan (官方校园平面图) with live layers drawn on top in SVG: dorm hotspots, the walking route,
 * couriers and load. The plan is a single static image, so no map tiles or third-party SDK are needed. Real GPS only
 * appears once a super admin calibrated the map on site; until then courier positions are estimated along the route
 * and labelled as such.
 */
export const buildingShort=(code:string)=>BUILDING_NAMES[code]?t(BUILDING_NAMES[code].short):t('{0}{1}',{0:code.startsWith('NORTH')?t('北'):t('南'),1:Number(code.split('_')[1])});
export const buildingLong=(code:string)=>BUILDING_NAMES[code]?t(BUILDING_NAMES[code].name):t('{0}{1}号楼',{0:code.startsWith('NORTH')?t('北苑'):t('南苑'),1:Number(code.split('_')[1])});
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
export function CampusMap({route,courier,couriers=[],loads=[],highlight,onBuilding,fit=false,label=t('青岛科技大学崂山校区平面图'),children}:MapProps){
  const box=fit&&route?.length?fitBox(courier?[...route,courier]:route):{x:0,y:0,w:MAP_WIDTH,h:MAP_HEIGHT};
  // Markers and strokes are sized for a 1000-unit-wide view and scaled with the zoom so they look the same everywhere.
  const k=box.w/1000;
  // Draw from the station door, not its centre, so the route never covers the station's name.
  route=route&&route.length>2?route.slice(1):route;
  const routeLength=route?pathLength(route):0,maxLoad=Math.max(1,...loads.map(l=>l.active+l.awaitingReceipt));
  const stations=STATION_PLACES.map(id=>placeById(id)!);
  return <figure className="campus-map">
    <svg viewBox={`${Math.round(box.x)} ${Math.round(box.y)} ${Math.round(box.w)} ${Math.round(box.h)}`} role={onBuilding?'group':'img'} aria-label={label} style={{'--k':k.toFixed(3)} as CSSProperties}>
      <image href={MAP_IMAGE} width={MAP_WIDTH} height={MAP_HEIGHT} className="map-plan"/>
      {stations.map(station=>{const name=t(station.label),w=Math.max(80,name.length*(locale()==='en-GB'?7:13)+22);
        // The 南十 station sits in a narrow strip at the west edge of 南苑, so its name goes to the left (off campus).
        const left=station.id==='NANSHI';
        return <g key={station.id} className="map-place kind-station"><rect x={station.x-6} y={station.y-6} width={station.w+12} height={station.h+12} rx={8*k}/>
        <circle className="station-pulse" cx={station.x+station.w/2} cy={station.y+station.h/2} r={9*k}/>
        <g transform={`translate(${left?station.x-14*k-w/2*k:station.x+station.w/2} ${left?station.y+station.h/2:station.y+station.h+20*k}) scale(${k})`}><rect className="station-tag" x={-w/2} y="-11" width={w} height="22" rx="11"/><text y="4">{name}</text></g><title>{name}</title></g>;})}
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
      {couriers.map(c=><g key={c.id} className="map-courier source-gps" style={{transform:`translate(${c.x}px, ${c.y}px)`}}><g transform={`scale(${k})`}><circle r="20" className="courier-halo"/><circle r="11" className="courier-dot"/><text y="-18" className="courier-name">{c.username}{c.active?t(' · {0}单',{0:c.active}):''}</text></g></g>)}
      <g className="map-compass" transform={`translate(${box.x+box.w-40*k} ${box.y+40*k}) scale(${k})`} aria-hidden="true"><circle r="24"/><path d="M0 -18 L6 0 L0 18 L-6 0Z"/><text y="-28">N</text></g>
    </svg>
    <figcaption>{t('底图：青岛科技大学崂山校区官方平面图（2012 年版），原标注“待建”的建筑已按现状改为建成')}{children}</figcaption>
  </figure>;
}

// ---------------------------------------------------------------- /map: campus map for everyone

export function CampusMapPage(){
  const [picked,setPicked]=useState<string|null>(null),[from,setFrom]=useState<string|null>(null);
  // Without a choice, the route starts at the station closest to the picked building.
  const nearest=useMemo(()=>picked?nearestStation(picked,STATION_PLACES)?.code??'YIHAIYUAN':null,[picked]);
  const stationCode=from??nearest??'YIHAIYUAN';
  const route=useMemo(()=>picked?campusRoute(stationCode,picked):null,[picked,stationCode]);
  const station=placeById(stationCode)!;
  return <section className="map-page"><h1>{t('崂山校区配送地图')}</h1>
    <p className="muted">{t('点选楼栋（宿舍楼、图书馆、行政楼、北1–北4、东1–东3 等，除人才公寓外都能送），看看从最近的站点出发的配送路线和步行时间。全校有颐海苑、南十对面两个站点，路线与时间为估算。')}</p>
    <div className="map-layout"><CampusMap route={route} highlight={picked} onBuilding={code=>{setPicked(code);setFrom(null);}}/>
      <aside className="map-side">{picked&&route?<div key={picked+stationCode} className="map-pick"><h2>{buildingLong(picked)}</h2><p className="map-minutes"><strong>{routeMinutes(route)}</strong> {t('分钟')}</p><p className="muted">{t('从{0}步行约 {1} 米（估算）',{0:t(station.label),1:routeMeters(route)})}{stationCode===nearest?t(' · 最近的站点'):''}</p>
        <div className="range-chips" role="group" aria-label={t('出发站点')}>{STATION_PLACES.map(id=><button key={id} type="button" className="chip" aria-pressed={stationCode===id} onClick={()=>setFrom(id)}>{t(placeById(id)!.label)}</button>)}</div>
        <Link className="button" to="/parcel/new">{t('安排一单送到这里')}</Link></div>
        :<div className="map-pick empty"><SymbolIcon name="room"/><p>{t('选择地图上的楼栋')}</p></div>}
        <ul className="map-legend"><li><i className="lg-station"/>{t('取件站点')}</li><li><i className="lg-building"/>{t('可配送楼栋')}</li><li><i className="lg-route"/>{t('配送路线')}</li><li><i className="lg-courier"/>{t('配送员')}</li></ul><BuildingHeatBoard/></aside></div>
  </section>;
}

// ---------------------------------------------------------------- order detail: ETA + live map

const ETA_BASIS={history:t('依据近 30 天同类订单的实际送达用时'),distance:t('依据站点到楼栋的路线距离估算'),slot:t('按你预约的送达时段'),demo:t('一键体验：按模拟配送员的速度估算')} as const;
export function OrderLiveMap({order}:{order:Order}){
  const {session}=useStudentSession(),live=useLiveConnected();
  const [data,setData]=useState<OrderLive|null>(null);
  const destination=order.dropPlace??order.dormSnapshot.buildingCode;
  const route=useMemo(()=>campusRoute(order.stationSnapshot.code,destination),[order.stationSnapshot.code,destination]);
  const load=useCallback(async()=>{try{setData(await api<OrderLive>(`/orders/${order.id}/live`));}catch{/* keep the last estimate */}},[order.id]);
  useEffect(()=>{if(session==='signed-in')void load();},[load,session,order.status]);
  useLiveEvents(event=>{if(event.type==='location'||event.type==='order')void load();},order.id);
  // Without the socket, refresh the estimate every 30 s while out for delivery and visible. A demo order (v3.6) refreshes
  // every 3 s so the simulated courier visibly travels along the route.
  useEffect(()=>{const demo=Boolean(order.demo)&&['WAITING_PICKUP','PICKED_UP','OUT_FOR_DELIVERY'].includes(order.status);if(!demo&&(live||order.status!=='OUT_FOR_DELIVERY'))return;const t=setInterval(()=>{if(!document.hidden)void load();},demo?3000:30000);return()=>clearInterval(t);},[live,load,order.status,order.demo]);
  const eta=data?.eta,courier=data?.courier;
  const arrive=eta?new Date(eta.arriveBy*1000).toLocaleTimeString(locale(),{hour:'2-digit',minute:'2-digit',hour12:false}):'';
  const stage=order.status==='WAITING_PICKUP'?(order.hasAssignee?t('配送员即将去站点取件'):t('等待配送员接单')):order.status==='PICKED_UP'?t('包裹已取出，准备出发'):t('配送员正在路上');
  return <section className="order-live" aria-label={t('配送进度地图')}>
    <div className="eta-card"><div className="eta-copy"><small>{stage}</small>{eta?<><p className="eta-minutes"><strong key={eta.minutes}>{eta.basis==='slot'?eta.label.replace(/^预约 /,''):eta.minutes<=1?t('马上到'):eta.minutes}</strong>{eta.basis!=='slot'&&eta.minutes>1&&<span>{t('分钟')}</span>}</p><p className="muted">{eta.basis==='slot'?t('预约送达'):t('预计 {0} 前送达',{0:arrive})} · {ETA_BASIS[eta.basis]}</p></>:<p className="eta-minutes"><strong>—</strong></p>}</div>
      {courier&&<span className={`eta-source source-${courier.source}`}>{courier.source==='gps'?t('实时定位'):t('按路线估算')}</span>}</div>
    {route&&<CampusMap route={route} courier={courier} highlight={order.dropPlace?null:order.dormSnapshot.buildingCode} fit label={t('从{0}到{1}的配送路线',{0:order.stationSnapshot.canonicalName,1:order.dropPlace?t(DROP_PLACE_LABELS[order.dropPlace]):order.dormSnapshot.buildingName})}>{data&&!data.calibrated&&t(' · 配送员位置为估算')}</CampusMap>}
  </section>;
}

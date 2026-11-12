/* © 2026 专业团队 · CampusDrop v4.7.0 · WM-A372E4790D8B1C09-A0273C8E5C */
import {useEffect,useState} from 'react';
import {api} from './api';
import {t} from './i18n';
import {CountUp} from './components';
import {SymbolIcon} from './campus-design';
import type {Impact} from '../shared/impact';

/*
 * v3.6 · 成效看板. Public aggregates from GET /impact: parcels delivered, walking saved (campus-road round trip from the
 * station, one per trip), rain-or-snow deliveries and the 30-day on-time share. Shown on the home page and, with the
 * last-7-days column, on the admin analytics page.
 */
const one=(n:number)=>n.toFixed(n<10&&n%1?1:0);
export function ImpactBoard({admin=false}:{admin?:boolean}){
  const [data,setData]=useState<Impact|null>(null),[failed,setFailed]=useState(false);
  useEffect(()=>{let on=true;api<{impact:Impact}>('/impact').then(r=>{if(on)setData(r.impact);}).catch(()=>{if(on)setFailed(true);});return()=>{on=false;};},[]);
  if(failed||!data)return null;
  const a=data.all,w=data.last7;
  if(!a.deliveries&&!admin)return null;
  const tr=admin?((s:string,v?:Record<string,string|number>)=>v?s.replace(/\{(\w+)\}/g,(_,k)=>String(v[k]??'')):s):t;
  const tiles:[string,string,number,(n:number)=>string,string,string][]=[
    ['box',tr('已送达'),a.deliveries,n=>String(Math.round(n)),tr('件'),tr('近 7 天 {0} 件',{0:w.deliveries})],
    ['map',tr('帮同学少走'),a.walkKm*10,n=>one(n/10),tr('公里'),tr('约 {0} 小时 · {1} 组',{0:one(a.walkHours),1:a.trips})],
    ['bell',tr('雨雪天送达'),a.wetDeliveries,n=>String(Math.round(n)),tr('件'),tr('按当时记录的天气')],
    ['chart',tr('近 30 天准时率'),data.onTimeRate??0,n=>String(Math.round(n)),'%',data.onTimeRate===null?tr('样本不足 5 单'):tr('共 {0} 单',{0:data.onTimeSample})],
  ];
  return <section className={admin?'impact-board is-admin':'impact-board'} aria-labelledby="impact-title">
    <div className="impact-head"><h2 id="impact-title">{tr('CampusDrop 成效')}</h2><small>{data.since?tr('自 {0} 起 · 已服务 {1} 位同学',{0:data.since,1:a.students}):tr('还没有送达记录')}</small></div>
    <ul>{tiles.map(([icon,label,value,format,unit,hint],i)=><li key={label}><SymbolIcon name={icon}/><small>{label}</small>
      <strong>{i===3&&data.onTimeRate===null?'—':<><CountUp value={value} from={0} format={format}/><em>{unit}</em></>}</strong><span>{hint}</span></li>)}</ul>
    <p className="muted small">{tr('少走的路按校园道路从站点到宿舍楼（或约定地点）往返估算，每个下单组按一次往返计算；分批或分时送达时实际情况可能不同。只统计真实订单，不含一键体验。')}{admin&&data.mergedParcels?` 多件同组的已送达包裹共 ${data.mergedParcels} 件。`:''}</p>
  </section>;
}

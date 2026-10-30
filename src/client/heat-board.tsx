import {useEffect,useState,type CSSProperties} from 'react';
import {api} from './api';
import {t} from './i18n';
import type {BuildingHeat} from '../shared/operations-rules';

/**
 * 本周楼栋热度榜: buildings ranked by paid orders over the last 7 days. Aggregated only, and buildings with fewer than
 * three orders are left out by the server, so no single student's activity can be read from it.
 */
export function BuildingHeatBoard({compact=false}:{compact?:boolean}){
  const [rows,setRows]=useState<BuildingHeat[]|null>(null);
  useEffect(()=>{let on=true;api<{buildings:BuildingHeat[]}>('/stats/buildings').then(r=>{if(on)setRows(r.buildings);}).catch(()=>{if(on)setRows([]);});return()=>{on=false;};},[]);
  if(!rows||(!rows.length&&compact))return null;
  const top=Math.max(1,...rows.map(r=>r.orders));
  return <section className={compact?'heat-board compact':'heat-board'} aria-labelledby="heat-title"><h2 id="heat-title">{t('本周楼栋热度榜')}</h2>
    {rows.length?<ol>{rows.map((r,i)=><li key={r.code}><b className={`heat-rank rank-${i+1}`}>{i+1}</b><span>{r.name}</span><i style={{'--w':`${Math.round(r.orders/top*100)}%`} as CSSProperties} aria-hidden="true"/><strong>{t('{n} 单',{n:r.orders})}</strong></li>)}</ol>
      :<p className="muted">{t('本周订单还不多，热度榜稍后揭晓。')}</p>}
    <small className="muted">{t('近 7 天已支付订单 · 少于 3 单的楼栋不上榜')}</small>
  </section>;
}

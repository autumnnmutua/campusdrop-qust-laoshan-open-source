import {useEffect,useState} from 'react';
import {Link} from 'react-router-dom';
import {api} from './api';
import {STALL_RULES,type StalledOrder} from '../shared/engagement';

export function overdueText(minutes:number){
  if(minutes<60)return `超时 ${Math.max(1,minutes)} 分钟`;
  const h=Math.floor(minutes/60);return h<48?`超时 ${h} 小时`:`超时 ${Math.floor(h/24)} 天`;
}
/**
 * Orders that have sat in one status longer than the team's targets (STALL_RULES), refreshed every minute while
 * the page is open. `compact` is the collapsible strip on the task page; the full card sits on the dashboard.
 */
export function StalledOrders({compact=false}:{compact?:boolean}){
  const [alerts,setAlerts]=useState<StalledOrder[]|null>(null),[open,setOpen]=useState(false);
  useEffect(()=>{
    let on=true;
    const load=()=>{if(!document.hidden)api<{alerts:StalledOrder[]}>('/admin/alerts').then(r=>{if(on)setAlerts(r.alerts);}).catch(()=>{});};
    load();const t=setInterval(load,60000);
    return()=>{on=false;clearInterval(t);};
  },[]);
  if(!alerts)return null;
  if(compact&&!alerts.length)return null;
  const list=compact&&!open?alerts.slice(0,3):alerts;
  return <section className={`stalled${compact?' compact':''}`} aria-labelledby="stalled-title">
    <div className="stalled-head"><h2 id="stalled-title">{alerts.length?<>超时预警 <b>{alerts.length}</b></>:'超时预警'}</h2>
      {compact&&alerts.length>3&&<button type="button" className="text-button" aria-expanded={open} onClick={()=>setOpen(!open)}>{open?'收起':`查看全部 ${alerts.length} 单`}</button>}</div>
    {!alerts.length?<p className="stalled-ok">✓ 当前授权范围内没有超时订单</p>:<ul>{list.map(a=><li key={a.id} data-status={a.status}>
      <span className="stalled-time">{overdueText(a.overdueMinutes)}</span>
      <span className="stalled-main"><strong>{a.building} · {a.roomNo}</strong><small>{a.label}{a.assignee?` · ${a.assignee}`:' · 尚未接单'}</small></span>
      <Link to={`/admin/orders/${a.id}`}>处理 ›</Link></li>)}</ul>}
    {!compact&&<details className="stalled-rules"><summary>预警规则</summary><ul>{STALL_RULES.filter((r,i,all)=>all.findIndex(x=>x.label===r.label)===i).map(r=><li key={r.status}>{r.label}</li>)}</ul><p className="muted">这些是校园配送的运营目标，只在管理端提示，不会向学生承诺送达时间。</p></details>}
  </section>;
}

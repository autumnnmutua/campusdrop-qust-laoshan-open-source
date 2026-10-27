import {useMemo,useState} from 'react';
import {Link} from 'react-router-dom';
import {AdminShell} from './admin-delivery';
import {EmptyState,LoadingState} from './components';
import {useResource} from './student-delivery';
import {STATUS_LABELS} from '../shared/constants';
import {orderSlotText} from './live-ui';
import type {Order,OrderStatus} from '../shared/delivery';
import type {Admin,Building} from '../shared/contracts';

const ROUTE_STATUSES:OrderStatus[]=['WAITING_PICKUP','PICKED_UP','OUT_FOR_DELIVERY'];
/**
 * Printable delivery route sheet: in-progress tasks in the admin's scope, grouped by building and sorted by room so a
 * courier can walk one building at a time and tick parcels off on paper. Phone numbers and pickup codes are left off
 * on purpose — a printed sheet can be lost; both stay one tap away in the workspace.
 */
export function RouteSheet(){
  const me=useResource<{admin:Admin}>('/admin/me'),ready=!!me.data;
  const tasks=useResource<{orders:Order[]}>('/admin/tasks?group=ACTIVE&pageSize=100',ready);
  const buildings=useResource<{buildings:Building[]}>('/admin/dorm-buildings',ready);
  const [building,setBuilding]=useState(''),[statuses,setStatuses]=useState<OrderStatus[]>(['PICKED_UP','OUT_FOR_DELIVERY']);
  const groups=useMemo(()=>{
    const list=(tasks.data?.orders??[]).filter(o=>statuses.includes(o.status)&&(!building||o.dormSnapshot.buildingCode===building));
    const map=new Map<string,Order[]>();
    for(const o of list){const k=o.dormSnapshot.buildingName;map.set(k,[...(map.get(k)??[]),o]);}
    return [...map.entries()].sort(([a],[b])=>a.localeCompare(b,'zh-CN',{numeric:true})).map(([name,orders])=>({name,orders:orders.sort((a,b)=>a.dormSnapshot.roomNo.localeCompare(b.dormSnapshot.roomNo,'zh-CN',{numeric:true}))}));
  },[tasks.data,statuses,building]);
  const total=groups.reduce((s,g)=>s+g.orders.length,0),room=groups.reduce((s,g)=>s+g.orders.filter(o=>o.deliveryMode==='ROOM').length,0);
  const printedAt=new Date().toLocaleString('zh-CN',{hour12:false});
  return <AdminShell><div className="route-sheet-page">
    <div className="route-tools no-print"><div><p className="eyebrow">配送工具</p><h1>配送路线单</h1><p className="muted">按楼栋、房间号排列进行中的任务，打印后可边送边勾选。路线单不包含学生电话和取件码。</p></div>
      <div className="filters route-filters"><label>楼栋<select value={building} onChange={e=>setBuilding(e.target.value)}><option value="">全部授权楼栋</option>{buildings.data?.buildings.map(b=><option key={b.code} value={b.code}>{b.displayName}</option>)}</select></label>
        <fieldset className="route-status"><legend>包含状态</legend>{ROUTE_STATUSES.map(s=><label key={s} className="check"><input type="checkbox" checked={statuses.includes(s)} onChange={e=>setStatuses(e.target.checked?[...statuses,s]:statuses.filter(x=>x!==s))}/>{STATUS_LABELS[s]}</label>)}</fieldset></div>
      <div className="actions"><button type="button" disabled={!total} onClick={()=>window.print()}>打印 / 另存为 PDF</button><Link to="/admin">返回配送工作台</Link></div></div>
    <p role="alert">{tasks.error}</p>{tasks.loading&&!tasks.data&&<LoadingState/>}
    {tasks.data&&!total&&<EmptyState title="没有符合条件的任务" icon="order"><p>可以调整楼栋或状态筛选。</p></EmptyState>}
    {total>0&&<article className="route-sheet" aria-label="配送路线单" tabIndex={0}>
      <header><h2>CampusDrop 配送路线单</h2><p>{total} 单 · 送到寝室 {room} 单 · 楼下 {total-room} 单 · {groups.length} 栋楼</p><p className="route-meta">打印时间 {printedAt}{me.data?` · ${me.data.admin.username}`:''}</p></header>
      {groups.map(g=><section key={g.name} className="route-building"><h3>{g.name}<small>{g.orders.length} 单</small></h3>
        <table><thead><tr><th scope="col" className="tick">✓</th><th scope="col">房间</th><th scope="col">方式</th><th scope="col">大小</th><th scope="col">状态</th><th scope="col">送达时间</th><th scope="col">备注</th><th scope="col">任务号</th></tr></thead>
          <tbody>{g.orders.map(o=><tr key={o.id}><td className="tick"><span className="tick-box" aria-hidden="true"/></td><td className="room">{o.dormSnapshot.roomNo}</td><td>{o.deliveryMode==='ROOM'?'到寝':'楼下'}</td><td>{o.packageSize==='SMALL'?'小件':'大件'}</td><td>{STATUS_LABELS[o.status]}</td><td>{orderSlotText(o)??'尽快'}</td><td className="note">{o.note||'—'}</td><td className="identifier">{o.id.slice(0,8)}</td></tr>)}</tbody></table>
      </section>)}
      <footer>独立校园服务项目 · 路线单仅供配送当班使用，用完请妥善处理</footer>
    </article>}
  </div></AdminShell>;
}

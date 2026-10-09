// Lightweight pieces shared by eagerly loaded pages, kept apart from the lazily loaded service pages.
import {useEffect} from 'react';
import {Link} from 'react-router-dom';
import {useResource} from './student-delivery';
import type {Order} from '../shared/delivery';
import {STATUS_LABELS} from '../shared/delivery';
export function RoundHistory({order}:{order:Order}){return <div className="round-history"><p><strong>第 {(order.returnCount??0)+1} 轮配送</strong> · 已退回 {order.returnCount??0} 次 · {order.status==='WAITING_PICKUP'?(order.hasAssignee?'已接单，待取件':'接单市场等待接单'):order.status==='COMPLETED'?'已完成':order.status.startsWith('DELIVERED')?'已送达，待学生确认':STATUS_LABELS[order.status]}</p>{!!order.returnHistory?.length&&<details><summary>查看全部退回理由（{order.returnHistory.length}轮）</summary><ol>{order.returnHistory.map((h,i)=><li key={i}><strong>第 {i+1} 轮 · {h.adminName}</strong><p>{h.reason}</p><small>{new Date(h.createdAt*1000).toLocaleString()}</small></li>)}</ol></details>}</div>;}
export function MessageLink(){const r=useResource<{unread:number}>('/messages');useEffect(()=>{const t=setInterval(()=>{if(!document.hidden)void r.refresh();},30000);return()=>clearInterval(t);},[r.refresh]);return <Link to="/messages">消息{r.data?.unread?` (${r.data.unread})`:''}</Link>;}

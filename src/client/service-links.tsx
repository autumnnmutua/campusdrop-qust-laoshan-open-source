// Lightweight pieces shared by eagerly loaded pages, kept apart from the lazily loaded service pages.
import {t} from './i18n';
import {useEffect,useState} from 'react';
import {NavLink,useLocation} from 'react-router-dom';
import {api} from './api';
import {isUnauthorized,useStudentSession} from './session';
import type {Order} from '../shared/delivery';
import {STATUS_LABELS} from '../shared/constants';
import {useLiveEvents} from './live';
export function RoundHistory({order}:{order:Order}){return <div className="round-history"><p><strong>{t('第 {0} 轮配送',{0:(order.returnCount??0)+1})}</strong> · {t('已退回 {0} 次',{0:order.returnCount??0})} · {order.status==='WAITING_PICKUP'?(order.hasAssignee?t('已接单，待取件'):t('接单市场等待接单')):order.status==='COMPLETED'?t('已完成'):order.status.startsWith('DELIVERED')?t('已送达，待学生确认'):t(STATUS_LABELS[order.status])}</p>{!!order.returnHistory?.length&&<details><summary>查看全部退回理由（{order.returnHistory.length}轮）</summary><ol>{order.returnHistory.map((h,i)=><li key={i}><strong>第 {i+1} 轮 · {h.adminName}</strong><p>{h.reason}</p><small>{new Date(h.createdAt*1000).toLocaleString()}</small></li>)}</ol></details>}</div>;}
/**
 * Unread message count. Polls only for a signed-in student and stops for good once the session is rejected.
 * Call it once (in the app shell) and pass the number down, so the rail, top bar and tab bar share one poller.
 */
export function useUnreadCount(){
  const {session,setSession}=useStudentSession();const location=useLocation();const [unread,setUnread]=useState(0),[pulse,setPulse]=useState(0);
  useLiveEvents(event=>{if(event.type==='order'||event.type==='chat')setPulse(n=>n+1);});
  useEffect(()=>{
    if(session!=='signed-in'){setUnread(0);return;}
    let active=true;
    const load=async()=>{try{const r=await api<{unread:number}>('/messages');if(active)setUnread(r.unread);}catch(error){if(active&&isUnauthorized(error))setSession('signed-out');}};
    void load();
    const timer=setInterval(()=>{if(!document.hidden)void load();},30000);
    return()=>{active=false;clearInterval(timer);};
  },[session,setSession,location.key,pulse]);
  return unread;
}
export function UnreadDot({count}:{count:number}){return count?<span className="unread-dot" aria-label={t('{0} 条未读',{0:count})}>{count>99?'99+':count}</span>:null;}
export function MessageLink({unread}:{unread:number}){
  return <NavLink to="/messages" className="topbar-messages">{t('消息')}<UnreadDot count={unread}/></NavLink>;
}

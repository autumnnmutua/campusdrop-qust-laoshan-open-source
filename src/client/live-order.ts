import {useEffect,useRef} from 'react';
import {isUnauthorized,useStudentSession} from './session';
import type {OrderStatus} from '../shared/delivery';

/** Statuses that no longer change without the student acting, so there is nothing to watch for. */
const QUIET_STATUSES:ReadonlySet<OrderStatus>=new Set<OrderStatus>(['WAITING_PAYMENT','COMPLETED','CANCELLED']);
export const LIVE_ORDER_INTERVAL_MS=20000;
export function shouldWatchOrder(status:OrderStatus|undefined){return !!status&&!QUIET_STATUSES.has(status);}

/**
 * Near-real-time order refresh: polls only while the tab is visible, the student is signed in and the order can still
 * change. A 401 marks the session signed out, which stops polling everywhere; other failures are ignored silently.
 */
export function useLiveOrder(status:OrderStatus|undefined,revalidate:()=>Promise<void>,intervalMs=LIVE_ORDER_INTERVAL_MS){
  const {session,setSession}=useStudentSession();
  const latest=useRef(revalidate);
  useEffect(()=>{latest.current=revalidate;},[revalidate]);
  const active=session==='signed-in'&&shouldWatchOrder(status);
  useEffect(()=>{
    if(!active)return;
    let stopped=false,inFlight=false,last=Date.now();
    const tick=async()=>{
      if(stopped||inFlight||document.hidden)return;
      inFlight=true;last=Date.now();
      try{await latest.current();}catch(error){if(isUnauthorized(error)){stopped=true;setSession('signed-out');}}
      finally{inFlight=false;}
    };
    const timer=setInterval(()=>void tick(),intervalMs);
    const onVisible=()=>{if(!document.hidden&&Date.now()-last>=intervalMs/2)void tick();};
    document.addEventListener('visibilitychange',onVisible);
    return ()=>{stopped=true;clearInterval(timer);document.removeEventListener('visibilitychange',onVisible);};
  },[active,intervalMs,setSession]);
}

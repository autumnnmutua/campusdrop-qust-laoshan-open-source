import {useEffect,useRef,useSyncExternalStore} from 'react';
import type {LiveEvent} from '../shared/live';

/*
 * One WebSocket per tab to the signed-in actor's live hub (Durable Object). The server only says "order X changed",
 * pages refetch what they show. Deployments that proxy the API (CloudBase, Netlify functions) cannot carry WebSocket
 * upgrades; after a few failed attempts the tab stops trying and pages simply keep their polling.
 */
type Channel='student'|'admin';
type Handler=(event:LiveEvent)=>void;
const handlers=new Set<Handler>();
const statusListeners=new Set<()=>void>();
let socket:WebSocket|null=null,channel:Channel|null=null,connected=false,failures=0,pingTimer=0,retryTimer=0,users=0;
const MAX_FAILURES=4;

function setConnected(next:boolean){if(connected!==next){connected=next;statusListeners.forEach(l=>l());}}
function close(){
  window.clearInterval(pingTimer);window.clearTimeout(retryTimer);
  if(socket){socket.onclose=null;socket.close();socket=null;}
  setConnected(false);
}
function open(){
  if(!channel||socket||failures>=MAX_FAILURES||typeof WebSocket==='undefined')return;
  const url=`${location.protocol==='https:'?'wss':'ws'}://${location.host}/api/v1${channel==='admin'?'/admin':''}/live`;
  let opened=false;
  try{socket=new WebSocket(url);}catch{failures=MAX_FAILURES;return;}
  socket.onopen=()=>{opened=true;failures=0;setConnected(true);pingTimer=window.setInterval(()=>socket?.readyState===WebSocket.OPEN&&socket.send('ping'),25000);};
  socket.onmessage=message=>{
    if(message.data==='pong')return;
    try{const event=JSON.parse(String(message.data)) as LiveEvent;handlers.forEach(h=>h(event));}catch{/* not an event */}
  };
  socket.onclose=()=>{
    window.clearInterval(pingTimer);socket=null;setConnected(false);
    if(!opened)failures++;
    if(!users||!channel)return;
    // Back off 2 s, 4 s, 8 s… up to a minute; a socket that was up reconnects quickly after a network blip.
    retryTimer=window.setTimeout(open,Math.min(60000,2000*2**failures));
  };
}
function onVisibility(){if(!document.hidden&&users&&!socket){failures=Math.min(failures,MAX_FAILURES-1);open();}}

/** Keep the tab's live channel open while the calling component is mounted (and the actor is signed in). */
export function useLiveChannel(kind:Channel|null){
  useEffect(()=>{
    if(!kind)return;
    users++;
    if(channel!==kind){close();channel=kind;failures=0;}
    open();
    document.addEventListener('visibilitychange',onVisibility);
    return()=>{
      users--;document.removeEventListener('visibilitychange',onVisibility);
      if(!users){close();channel=null;}
    };
  },[kind]);
}

/** Call `handler` for every live event (optionally only for one order). The latest handler is always used. */
export function useLiveEvents(handler:Handler,orderId?:string){
  const latest=useRef(handler);
  useEffect(()=>{latest.current=handler;},[handler]);
  useEffect(()=>{
    const h:Handler=event=>{if(!orderId||!('orderId' in event)||event.orderId===orderId||event.orderId===null)latest.current(event);};
    handlers.add(h);return()=>{handlers.delete(h);};
  },[orderId]);
}

export const liveConnected=()=>connected;
export function useLiveConnected(){return useSyncExternalStore(l=>{statusListeners.add(l);return()=>statusListeners.delete(l);},()=>connected,()=>false);}

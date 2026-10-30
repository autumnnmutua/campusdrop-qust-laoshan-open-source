import {useSyncExternalStore} from 'react';
import { inWeChat } from './wechat';
import {getItem,removeItem,setItem} from './storage';
import {api} from './api';

/*
 * Arrival reminders through the browser's own notification centre. Opt-in per browser: the student switches it on,
 * the browser asks for permission, and only then do status changes raise a system notification while the tab is in
 * the background. When the site has web push configured (VAPID keys on the Worker), the browser also subscribes, so
 * notifications arrive even with the site closed; otherwise the open tab checks the order itself.
 */
const KEY='campusdrop:notify',PUSH_KEY='campusdrop:push';
const listeners=new Set<()=>void>();
const emit=()=>listeners.forEach(l=>l());
export type NotifyState='unsupported'|'denied'|'off'|'on';

/** In-app browsers (WeChat) do not deliver web notifications reliably, so the switch is not offered there. */
export function notifySupported(){return typeof window!=='undefined'&&'Notification' in window&&!inWeChat;}
function stored(){return getItem(KEY)==='1';}
export function notifyState():NotifyState{
  if(!notifySupported())return 'unsupported';
  if(Notification.permission==='denied')return 'denied';
  return Notification.permission==='granted'&&stored()?'on':'off';
}
export const notifyEnabled=()=>notifyState()==='on';
let snapshot:NotifyState=typeof window==='undefined'?'unsupported':notifyState();
const refresh=()=>{snapshot=notifyState();emit();};
export function useNotifyState(){return useSyncExternalStore(l=>{listeners.add(l);return()=>listeners.delete(l);},()=>snapshot,()=>'unsupported' as NotifyState);}

export const pushEnabled=()=>getItem(PUSH_KEY)==='1';
type PushOwner='student'|'admin';
const pushPath=(owner:PushOwner)=>owner==='admin'?'/admin/push':'/push';
function keyBytes(base64url:string){const raw=atob(base64url.replace(/-/g,'+').replace(/_/g,'/')+'='.repeat((4-base64url.length%4)%4));return Uint8Array.from(raw,c=>c.charCodeAt(0));}
async function pushRegistration(){
  if(!('serviceWorker' in navigator)||!('PushManager' in window))return null;
  return Promise.race([navigator.serviceWorker.ready,new Promise<null>(r=>setTimeout(()=>r(null),4000))]);
}
/** Subscribe this browser to web push. Permission must already be granted. False when push is unavailable here. */
export async function subscribePush(owner:PushOwner='student'):Promise<boolean>{
  try{
    const reg=await pushRegistration();if(!reg)return false;
    const {publicKey}=await api<{publicKey:string|null}>('/push/key');if(!publicKey)return false;
    const subscribe=()=>reg.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:keyBytes(publicKey)});
    let sub:PushSubscription;
    // A subscription made with an older key (rotated on the server) cannot be reused.
    try{sub=await reg.pushManager.getSubscription()??await subscribe();}catch{await (await reg.pushManager.getSubscription())?.unsubscribe();sub=await subscribe();}
    await api(`${pushPath(owner)}/subscribe`,'POST',sub.toJSON());
    return true;
  }catch{return false;}
}
export async function unsubscribePush(owner:PushOwner='student'){
  try{const sub=await (await pushRegistration())?.pushManager.getSubscription();if(!sub)return;await api(`${pushPath(owner)}/unsubscribe`,'POST',{endpoint:sub.endpoint}).catch(()=>{});await sub.unsubscribe();}catch{/* nothing to undo */}
}

/** Ask for permission and switch reminders on. Some mobile browsers only allow notifications from installed apps. */
export async function enableNotify():Promise<NotifyState|'blocked'>{
  if(!notifySupported())return 'unsupported';
  const permission=Notification.permission==='granted'?'granted':await Notification.requestPermission();
  if(permission!=='granted'){refresh();return notifyState();}
  if(await subscribePush()){setItem(PUSH_KEY,'1');setItem(KEY,'1');refresh();return notifyState();}
  removeItem(PUSH_KEY);
  // Android Chrome throws on `new Notification` outside a service worker; find out now rather than when a parcel arrives.
  try{const probe=new Notification('CampusDrop 到达提醒已开启',{body:'包裹状态变化时，即使切到其他页面也会提醒你。',icon:'/icon-192.png',tag:'campusdrop-notify-test'});setTimeout(()=>probe.close(),4000);}
  catch{refresh();return 'blocked';}
  setItem(KEY,'1'); // if it cannot be remembered, reminders simply stay off
  refresh();return notifyState();
}
export function disableNotify(){removeItem(KEY);if(pushEnabled()){removeItem(PUSH_KEY);void unsubscribePush();}refresh();}

/** System notification, only when enabled and the page is not in front (the in-page toast covers that case). */
export function systemNotify(title:string,body:string,tag:string){
  // With push on, the server already sends this one.
  if(!notifyEnabled()||!document.hidden||pushEnabled())return false;
  try{const n=new Notification(title,{body,icon:'/icon-192.png',tag});n.onclick=()=>{window.focus();n.close();};return true;}catch{return false;}
}

import {useSyncExternalStore} from 'react';
import {getItem,removeItem,setItem} from './storage';

/*
 * Arrival reminders through the browser's own notification centre. Opt-in per browser: the student switches it on,
 * the browser asks for permission, and only then do status changes raise a system notification while the tab is in
 * the background. Nothing is sent from the server; the open tab checks the order itself.
 */
const KEY='campusdrop:notify';
const listeners=new Set<()=>void>();
const emit=()=>listeners.forEach(l=>l());
export type NotifyState='unsupported'|'denied'|'off'|'on';

export function notifySupported(){return typeof window!=='undefined'&&'Notification' in window;}
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

/** Ask for permission and switch reminders on. Some mobile browsers only allow notifications from installed apps. */
export async function enableNotify():Promise<NotifyState|'blocked'>{
  if(!notifySupported())return 'unsupported';
  const permission=Notification.permission==='granted'?'granted':await Notification.requestPermission();
  if(permission!=='granted'){refresh();return notifyState();}
  // Android Chrome throws on `new Notification` outside a service worker; find out now rather than when a parcel arrives.
  try{const probe=new Notification('CampusDrop 到达提醒已开启',{body:'包裹状态变化时，即使切到其他页面也会提醒你。',icon:'/icon-192.png',tag:'campusdrop-notify-test'});setTimeout(()=>probe.close(),4000);}
  catch{refresh();return 'blocked';}
  setItem(KEY,'1'); // if it cannot be remembered, reminders simply stay off
  refresh();return notifyState();
}
export function disableNotify(){removeItem(KEY);refresh();}

/** System notification, only when enabled and the page is not in front (the in-page toast covers that case). */
export function systemNotify(title:string,body:string,tag:string){
  if(!notifyEnabled()||!document.hidden)return false;
  try{const n=new Notification(title,{body,icon:'/icon-192.png',tag});n.onclick=()=>{window.focus();n.close();};return true;}catch{return false;}
}

import {useSyncExternalStore} from 'react';
import {getItem,setItem} from './storage';
import {EN,EN_ERRORS} from './i18n-en';

/*
 * Chinese / English for the student pages. Chinese strings are the keys: `t('我的订单')` returns the same text in Chinese
 * and the English entry from i18n-en.ts when English is on, so an untranslated string simply stays in Chinese instead
 * of breaking. `{name}` placeholders are filled from `vars`. The admin workspace stays Chinese.
 * Switching language reloads the page, so labels computed once at module load are rebuilt as well.
 */
export type Lang='zh'|'en';
const KEY='campusdrop:lang';
let lang:Lang=getItem(KEY)==='en'?'en':'zh';
const listeners=new Set<()=>void>();
function apply(){if(typeof document!=='undefined'){document.documentElement.lang=lang==='en'?'en':'zh-CN';document.documentElement.dataset.lang=lang;}}
apply();

export const getLang=()=>lang;
/** Switching reloads the page: labels kept in module-level constants are then rebuilt in the new language too. */
export function setLang(next:Lang){if(next===lang)return;lang=next;setItem(KEY,next);apply();listeners.forEach(l=>l());if(typeof window!=='undefined')window.location.reload();}
export function useLang():Lang{return useSyncExternalStore(l=>{listeners.add(l);return()=>listeners.delete(l);},()=>lang,()=>lang);}

export function t(zh:string,vars?:Record<string,string|number>):string{
  let text=lang==='en'?EN[zh]??zh:zh;
  if(vars)for(const [k,v] of Object.entries(vars))text=text.split(`{${k}}`).join(String(v));
  return text;
}
/** English for a server error code when one is known; otherwise the server's own (Chinese) message. */
export function errorText(code:string|undefined,message:string):string{
  return lang==='en'&&code&&EN_ERRORS[code]?EN_ERRORS[code]:message;
}
/** Locale for dates and numbers. */
export const locale=()=>lang==='en'?'en-GB':'zh-CN';

import {useSyncExternalStore} from 'react';
import {getItem,setItem} from './storage';

/*
 * Light / dark appearance. Light is the default (v2.9); 'auto' follows the system setting, 'dark' is the night chart. The choice is stored per device and applied as
 * <html data-theme="light|dark">; public/boot.js applies it before the first paint so pages never flash the wrong colours.
 */
export type ThemeMode='auto'|'light'|'dark';
const KEY='campusdrop:theme';
const listeners=new Set<()=>void>();
const media=typeof window!=='undefined'&&typeof window.matchMedia==='function'?window.matchMedia('(prefers-color-scheme: dark)'):null;
let mode:ThemeMode=((v)=>v==='auto'||v==='dark'?v:'light')(getItem(KEY));

export const resolvedTheme=():'light'|'dark'=>mode==='auto'?(media?.matches?'dark':'light'):mode;
function apply(){
  if(typeof document==='undefined')return;
  const theme=resolvedTheme();document.documentElement.dataset.theme=theme;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content',theme==='dark'?'#0c181d':'#eef3f2');
}
apply();
media?.addEventListener?.('change',()=>{if(mode==='auto'){apply();listeners.forEach(l=>l());}});

export const THEME_LABELS:Record<ThemeMode,string>={auto:'跟随系统',light:'浅色',dark:'深色'};
export const getThemeMode=()=>mode;
export function setThemeMode(next:ThemeMode){mode=next;setItem(KEY,next);apply();listeners.forEach(l=>l());}
export function useThemeMode():ThemeMode{return useSyncExternalStore(l=>{listeners.add(l);return()=>listeners.delete(l);},()=>mode,()=>mode);}
/** The theme actually shown ('auto' resolved against the system), re-rendering when either changes. */
export function useResolvedTheme():'light'|'dark'{return useSyncExternalStore(l=>{listeners.add(l);return()=>listeners.delete(l);},resolvedTheme,()=>'light');}

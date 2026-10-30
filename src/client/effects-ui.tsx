import {useEffect,useRef,useState} from 'react';
import {setPageAmbient,usePageAmbient} from './ambient';
import {AMBIENT_LABELS,AmbientField,dismissToast,resolveScene,setAmbientMode,useAmbientMode,useToasts,type AmbientMode} from './effects';
import {prefersReducedMotion} from './motion';
import {setBounceEnabled,useBounceEnabled} from './bounce-text';
import {THEME_LABELS,setThemeMode,useThemeMode,type ThemeMode} from './theme';
import {setLang,t,useLang} from './i18n';

/** Seasonal particles behind nothing and above everything: pointer-transparent, decorative only. */
export function AmbientLayer({enabled}:{enabled:boolean}){
  const ref=useRef<HTMLCanvasElement>(null);const mode=useAmbientMode();const scene=enabled?resolveScene(mode):null;
  useEffect(()=>{
    const canvas=ref.current;if(!canvas||!scene||prefersReducedMotion())return;
    let field:AmbientField|null=null;
    try{field=new AmbientField(canvas,scene);}catch{return;}
    return ()=>field?.destroy();
  },[scene]);
  if(!scene||prefersReducedMotion())return null;
  return <canvas ref={ref} className="ambient-layer" aria-hidden="true"/>;
}

const ORDER:AmbientMode[]=['auto','snow','sakura','bokeh','leaves','off'];
const GLYPH:Record<AmbientMode,string>={auto:'✦',snow:'❄',sakura:'✿',bokeh:'◍',leaves:'❦',off:'○'};
/** Top-bar control to pick the ambient scene. A disclosure with a radio group; closes after a choice or on Escape. */
export function AmbientSwitch(){
  const mode=useAmbientMode();const [open,setOpen]=useState(false);const box=useRef<HTMLDivElement>(null);const bounce=useBounceEnabled();const pageAmbient=usePageAmbient();const theme=useThemeMode(),lang=useLang();
  const reduced=prefersReducedMotion();const current=resolveScene(mode);
  useEffect(()=>{
    if(!open)return;
    const away=(e:PointerEvent)=>{if(!box.current?.contains(e.target as Node))setOpen(false);};
    const key=(e:KeyboardEvent)=>{if(e.key==='Escape'){setOpen(false);box.current?.querySelector<HTMLButtonElement>('.ambient-toggle')?.focus();}};
    document.addEventListener('pointerdown',away);document.addEventListener('keydown',key);
    return ()=>{document.removeEventListener('pointerdown',away);document.removeEventListener('keydown',key);};
  },[open]);
  return <div className="ambient-switch" ref={box}>
    <button type="button" className="ambient-toggle" aria-expanded={open} aria-haspopup="true" onClick={()=>setOpen(!open)} title="切换校园氛围动效">
      <span aria-hidden="true" className={`ambient-glyph scene-${current??'off'}`}>{GLYPH[mode==='auto'&&current?current:mode]}</span><span className="ambient-label">{t('氛围')}</span>
    </button>
    {open&&<div className="ambient-menu" role="group" aria-label="校园氛围动效">
      <p className="ambient-menu-title">校园氛围</p>
      <div role="radiogroup" aria-label="选择氛围">{ORDER.map(m=><button key={m} type="button" role="radio" aria-checked={mode===m} onClick={()=>{setAmbientMode(m);setOpen(false);}}><span aria-hidden="true">{GLYPH[m==='auto'?(resolveScene('auto')??'off'):m]}</span>{AMBIENT_LABELS[m]}{m==='auto'&&<small>当前：{AMBIENT_LABELS[resolveScene('auto')??'off'].split(' · ')[1]}</small>}</button>)}</div>
      <label className="ambient-bounce"><input type="checkbox" checked={bounce} onChange={e=>setBounceEnabled(e.target.checked)}/><span>{t('文字跳动')}<small>{t('标题、状态变化等处的文字跳动效果')}</small></span></label>
      <label className="ambient-bounce"><input type="checkbox" checked={pageAmbient} onChange={e=>setPageAmbient(e.target.checked)}/><span>{t('背景动效')}<small>{t('页面背景的等高线漂移、声呐光圈和鼠标光晕')}</small></span></label>
      <p className="ambient-menu-title">{t('外观')}</p>
      <div className="segmented" role="radiogroup" aria-label={t('外观')}>{(['auto','light','dark'] as ThemeMode[]).map(m=><button key={m} type="button" role="radio" aria-checked={theme===m} onClick={()=>setThemeMode(m)}>{t(THEME_LABELS[m])}</button>)}</div>
      <p className="ambient-menu-title">语言 · Language</p>
      <div className="segmented" role="radiogroup" aria-label="Language">{([['zh','中文'],['en','English']] as const).map(([v,label])=><button key={v} type="button" role="radio" aria-checked={lang===v} lang={v==='en'?'en':'zh-CN'} onClick={()=>{setOpen(false);setLang(v);}}>{label}</button>)}</div>
      <p className="ambient-menu-note">{reduced?'系统已开启“减少动态效果”，氛围动画不会播放。':'鼠标靠近时粒子会避让，轻点页面可以吹散它们。'}</p>
    </div>}
  </div>;
}

const TOAST_ICON={info:'i',success:'✓',warn:'!'} as const;
/** Global toast region. Polite live region so screen readers hear each notice once. */
export function Toaster(){
  const items=useToasts();
  return <div className="toaster" role="status" aria-live="polite" aria-relevant="additions">{items.map(t=><div key={t.id} className={`toast toast-${t.kind}`}>
    <span className="toast-icon" aria-hidden="true">{TOAST_ICON[t.kind]}</span><p><strong>{t.text}</strong>{t.detail&&<small>{t.detail}</small>}</p>
    <button type="button" className="toast-close" aria-label="关闭提示" onClick={()=>dismissToast(t.id)}>×</button></div>)}</div>;
}

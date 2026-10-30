import {useEffect,useRef,useSyncExternalStore} from 'react';
import {getItem,setItem} from './storage';

/*
 * The page background: the chart paper continues behind every student page. Four quiet layers, all compositor-only
 * (transform / opacity), behind the content:
 *  - a faint contour field (art/page-contours.svg, used as a mask so it takes the theme's ink) that drifts very slowly
 *    and moves a little slower than the page when scrolling;
 *  - two broad tints of shallow water and of the route colour, slowly shifting, so the fog is never flat;
 *  - now and then a sonar ring opens at a "contact" somewhere off to the side;
 *  - under a mouse, a soft light follows the pointer a little behind it.
 * Switchable in the 氛围 menu (“背景动效”); with reduced motion only the still contours remain. Not in the admin workspace.
 */
const KEY='campusdrop:page-ambient';
let on=getItem(KEY)!=='off';
const listeners=new Set<()=>void>();
export function setPageAmbient(next:boolean){on=next;setItem(KEY,next?'on':'off');listeners.forEach(l=>l());}
export function usePageAmbient(){return useSyncExternalStore(l=>{listeners.add(l);return()=>listeners.delete(l);},()=>on,()=>true);}

const PINGS:[number,number,number][]=[[9,64,0],[88,34,6],[74,86,12],[22,20,18]];

export function PageAmbient(){
  const enabled=usePageAmbient();const light=useRef<HTMLDivElement>(null);
  useEffect(()=>{
    const el=light.current;if(!enabled||!el)return;
    if(!window.matchMedia?.('(pointer: fine)').matches||window.matchMedia?.('(prefers-reduced-motion: reduce)').matches)return;
    let raf=0,x=-9999,y=-9999;
    const draw=()=>{raf=0;el.style.transform=`translate3d(${x.toFixed(0)}px,${y.toFixed(0)}px,0)`;};
    const move=(e:PointerEvent)=>{if(e.pointerType!=='mouse')return;x=e.clientX;y=e.clientY;el.classList.add('is-on');if(!raf)raf=requestAnimationFrame(draw);};
    const out=()=>el.classList.remove('is-on');
    window.addEventListener('pointermove',move,{passive:true});document.documentElement.addEventListener('pointerleave',out);
    return()=>{cancelAnimationFrame(raf);window.removeEventListener('pointermove',move);document.documentElement.removeEventListener('pointerleave',out);};
  },[enabled]);
  return <div className={enabled?'page-ambient':'page-ambient is-still'} aria-hidden="true">
    <div className="amb-glow amb-glow-a"/><div className="amb-glow amb-glow-b"/>
    <div className="amb-scroll"><div className="amb-contours"/></div>
    {enabled&&PINGS.map(([x,y,d],i)=><span key={i} className="amb-ping" style={{left:`${x}%`,top:`${y}%`,animationDelay:`${d}s`}}><i style={{animationDelay:`${d}s`}}/></span>)}
    <div ref={light} className="amb-light"/>
  </div>;
}

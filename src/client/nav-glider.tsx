import {useLayoutEffect,useRef} from 'react';
import {useLocation} from 'react-router-dom';

/**
 * A marker that glides between the links of a navigation bar: it rests under the current page and, on hover, slides to
 * the link under the pointer (a soft shoal-tint pill follows the pointer too), springing back when the pointer leaves.
 * Placed as the last child of the <nav>; it measures its siblings, so it needs no wiring. Without it (no JS layout,
 * reduced motion) the plain per-link underline is used.
 */
export function NavGlider({kind='bar'}:{kind?:'bar'|'tab'}){
  const ref=useRef<HTMLSpanElement>(null);const {pathname}=useLocation();
  useLayoutEffect(()=>{
    const mark=ref.current,nav=mark?.parentElement;if(!mark||!nav)return;
    const place=(el:Element|null,prop:'--g'|'--h')=>{
      if(!(el instanceof HTMLElement)){nav.style.setProperty(`${prop}o`,'0');return;}
      nav.style.setProperty(`${prop}x`,`${el.offsetLeft}px`);nav.style.setProperty(`${prop}w`,`${el.offsetWidth}px`);nav.style.setProperty(`${prop}o`,'1');
    };
    const active=()=>nav.querySelector('a.active');
    const rest=()=>{place(active(),'--g');nav.style.setProperty('--ho','0');};
    // First placement without a transition, so the marker does not fly in from the left edge on load.
    nav.classList.remove('glider-ready');rest();nav.classList.add('has-glider');
    const raf=requestAnimationFrame(()=>nav.classList.add('glider-ready'));
    const over=(e:PointerEvent)=>{if(e.pointerType!=='mouse')return;const a=(e.target as Element).closest?.('a');if(a&&nav.contains(a)){place(a,'--g');place(a,'--h');}};
    nav.addEventListener('pointerover',over);nav.addEventListener('pointerleave',rest);
    const ro=typeof ResizeObserver!=='undefined'?new ResizeObserver(rest):null;ro?.observe(nav);
    return()=>{cancelAnimationFrame(raf);nav.removeEventListener('pointerover',over);nav.removeEventListener('pointerleave',rest);ro?.disconnect();};
  },[pathname]);
  return <><span className={`nav-hover nav-hover-${kind}`} aria-hidden="true"/><span ref={ref} className={`nav-glider nav-glider-${kind}`} aria-hidden="true"/></>;
}

import {useEffect,useRef,type RefObject} from 'react';

const EASE_OUT='cubic-bezier(.22,1,.36,1)';
/** True when the visitor asked for reduced motion (or the browser cannot tell us). */
export function prefersReducedMotion(){
  return typeof window==='undefined'||typeof window.matchMedia!=='function'||window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/**
 * Student page transition: a short fade/rise of <main> after each route change.
 * BrowserRouter commits route changes inside React transitions, so document.startViewTransition() cannot capture the
 * outgoing page from here; the Web Animations API gives the same entrance without that risk and simply does nothing
 * where unsupported.
 */
export function usePageEnter(ref:RefObject<HTMLElement|null>,key:string,enabled:boolean){
  const first=useRef(true);
  useEffect(()=>{
    if(first.current){first.current=false;return;}
    const el=ref.current;
    if(!enabled||!el||prefersReducedMotion()||typeof el.animate!=='function')return;
    const animation=el.animate([{opacity:0,transform:'translateY(8px)'},{opacity:1,transform:'none'}],{duration:220,easing:EASE_OUT});
    return ()=>animation.cancel();
  },[ref,key,enabled]);
}

const REVEAL_SELECTOR='.home-dashboard>*,.service-shortcuts>a,.campus-message,.card-list>*,.timeline,.information-page section';
/**
 * Scroll reveal. Content stays visible unless IntersectionObserver confirms an element starts fully below the fold;
 * only then is it hidden and faded in when it scrolls into view. Without IO/MutationObserver or with reduced motion
 * nothing is hidden at all.
 */
export function useScrollReveal(ref:RefObject<HTMLElement|null>,key:string,enabled:boolean){
  useEffect(()=>{
    const root=ref.current;
    if(!enabled||!root||prefersReducedMotion()||typeof IntersectionObserver==='undefined'||typeof MutationObserver==='undefined')return;
    const tracked=new WeakSet<Element>(),decided=new WeakSet<Element>();
    const io=new IntersectionObserver(entries=>{
      for(const entry of entries){
        const el=entry.target;
        if(!decided.has(el)){decided.add(el);if(entry.isIntersecting)io.unobserve(el);else el.classList.add('reveal-pending');continue;}
        if(entry.isIntersecting){el.classList.remove('reveal-pending');el.classList.add('reveal-in');io.unobserve(el);}
      }
    });
    let frame=0;
    const scan=()=>{frame=0;root.querySelectorAll(REVEAL_SELECTOR).forEach(el=>{if(!tracked.has(el)){tracked.add(el);io.observe(el);}});};
    const schedule=()=>{if(!frame)frame=requestAnimationFrame(scan);};
    scan();
    const mo=new MutationObserver(schedule);mo.observe(root,{childList:true,subtree:true});
    const showAll=()=>root.querySelectorAll('.reveal-pending').forEach(el=>el.classList.remove('reveal-pending'));
    window.addEventListener('beforeprint',showAll);
    return ()=>{io.disconnect();mo.disconnect();if(frame)cancelAnimationFrame(frame);window.removeEventListener('beforeprint',showAll);showAll();};
  },[ref,key,enabled]);
}

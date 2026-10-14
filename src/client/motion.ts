import {useEffect,useRef,useState,type RefObject} from 'react';

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

/** Adds body.is-scrolled once the page leaves the top, so the sticky top bar can show its separator. Not motion itself. */
export function useScrolledClass(threshold=6){
  useEffect(()=>{
    let frame=0;
    const update=()=>{frame=0;document.body.classList.toggle('is-scrolled',window.scrollY>threshold);};
    const onScroll=()=>{if(!frame)frame=requestAnimationFrame(update);};
    update();window.addEventListener('scroll',onScroll,{passive:true});
    return ()=>{window.removeEventListener('scroll',onScroll);if(frame)cancelAnimationFrame(frame);document.body.classList.remove('is-scrolled');};
  },[threshold]);
}

/**
 * Plays a short "take-off" on an element, then runs `done`. With reduced motion, no WAAPI support or no element,
 * `done` runs immediately, so the action never depends on the animation finishing.
 */
export function playThen(el:Element|null|undefined,keyframes:Keyframe[],duration:number,done:()=>void){
  if(!el||prefersReducedMotion()||typeof (el as HTMLElement).animate!=='function'){done();return;}
  let finished=false;const finish=()=>{if(!finished){finished=true;done();}};
  const animation=(el as HTMLElement).animate(keyframes,{duration,easing:EASE_OUT,fill:'forwards'});
  animation.finished.then(finish,finish);
  setTimeout(finish,duration+120); // safety net if the animation is cancelled or the tab is throttled
}

/**
 * Animated number: eases from the previous value (or `from` on first render) to `value`. Reduced motion, a hidden tab
 * or an unchanged value jump straight to the target. Callers render the result aria-hidden next to the final value.
 */
export function useCountUp(value:number,{duration=650,from}:{duration?:number;from?:number}={}){
  // `current` is the value on screen right now, so an interrupted run (new value, or StrictMode's effect replay)
  // continues from where it visually is instead of jumping to the end.
  const [shown,setShown]=useState(from??value);const current=useRef(from??value);
  useEffect(()=>{
    const start=current.current;
    if(start===value||prefersReducedMotion()||document.hidden){current.current=value;setShown(value);return;}
    let frame=0;const begin=performance.now();
    const step=(now:number)=>{
      const t=Math.min(1,(now-begin)/duration),eased=1-Math.pow(1-t,3),next=t<1?start+(value-start)*eased:value;
      current.current=next;setShown(next);
      if(t<1)frame=requestAnimationFrame(step);
    };
    frame=requestAnimationFrame(step);
    return ()=>cancelAnimationFrame(frame);
  },[value,duration]);
  return shown;
}

/**
 * Material-style press ripple for buttons, added once at the app root. Spans are positioned through CSS custom
 * properties set with CSSOM (allowed by the style-src 'self' CSP) and remove themselves when the animation ends.
 * The mobile tab bar is skipped on purpose (see motion.css).
 */
export function useRipple(){
  useEffect(()=>{
    if(prefersReducedMotion())return;
    const onDown=(event:PointerEvent)=>{
      if(event.button!==0)return;
      const target=(event.target as Element|null)?.closest?.('button:not(:disabled),a.button');
      if(!(target instanceof HTMLElement)||target.closest('.mobile-tabs'))return;
      const box=target.getBoundingClientRect(),size=Math.max(box.width,box.height)*2.2;
      const ripple=document.createElement('span');ripple.className='ripple';ripple.setAttribute('aria-hidden','true');
      ripple.style.setProperty('--rs',`${size}px`);ripple.style.setProperty('--rx',`${event.clientX-box.left}px`);ripple.style.setProperty('--ry',`${event.clientY-box.top}px`);
      target.appendChild(ripple);
      const remove=()=>ripple.remove();ripple.addEventListener('animationend',remove,{once:true});setTimeout(remove,900);
    };
    document.addEventListener('pointerdown',onDown,{passive:true});
    return ()=>document.removeEventListener('pointerdown',onDown);
  },[]);
}

/** Desktop-only pointer parallax: writes --px/--py in [-1,1] on the element; CSS decides what moves and how far. */
export function usePointerParallax(ref:RefObject<HTMLElement|null>){
  useEffect(()=>{
    const el=ref.current;
    if(!el||prefersReducedMotion()||typeof window.matchMedia!=='function'||!window.matchMedia('(hover:hover) and (pointer:fine)').matches)return;
    let frame=0,x=0,y=0;
    const apply=()=>{frame=0;el.style.setProperty('--px',x.toFixed(3));el.style.setProperty('--py',y.toFixed(3));};
    const queue=()=>{if(!frame)frame=requestAnimationFrame(apply);};
    const move=(event:PointerEvent)=>{const box=el.getBoundingClientRect();x=Math.max(-1,Math.min(1,((event.clientX-box.left)/box.width)*2-1));y=Math.max(-1,Math.min(1,((event.clientY-box.top)/box.height)*2-1));queue();};
    const leave=()=>{x=0;y=0;queue();};
    el.addEventListener('pointermove',move);el.addEventListener('pointerleave',leave);
    return ()=>{el.removeEventListener('pointermove',move);el.removeEventListener('pointerleave',leave);if(frame)cancelAnimationFrame(frame);el.style.removeProperty('--px');el.style.removeProperty('--py');};
  },[ref]);
}

const REVEAL_SELECTOR='.home-dashboard>*,.service-shortcuts>a,.campus-message,.card-list>*,.task-grid>*,.timeline,.information-page section,.admin-task-table tbody tr';
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

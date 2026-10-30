/*
 * Small responses to the pointer, installed once for the whole app through delegated listeners (no per-component wiring):
 *  - primary buttons lean a few pixels towards the pointer and carry a soft light where it rests (magnetic);
 *  - panels, order cards and the waybill show a faint sonar-tinted spotlight under the pointer;
 *  - flyToOrders(): after an order is created a parcel arcs from the button into the 订单 navigation item;
 *  - pressing any button sends a sonar ring out from the point pressed (mouse, pen and touch);
 *  - content blocks below the fold rise into place the first time they scroll into view.
 * The pointer lean and spotlight are for a fine pointer only; nothing here runs with prefers-reduced-motion. Everything is set through the CSSOM
 * (custom properties, element.animate), which the style-src 'self' policy allows.
 */
const MAGNETIC='.launch-order, button:not(.secondary):not(.text-button):not(.chip):not([role=tab]):not(.flap):not(.intro-skip), .button:not(.secondary)';
const SPOT='.panel, .parcel-card, .waybill, .home-quick';
const reduced=()=>window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
const fine=()=>window.matchMedia?.('(pointer: fine)').matches;

let installed=false;
export function installMicroMotion(){
  if(installed||typeof window==='undefined')return;installed=true;
  let magnet:HTMLElement|null=null,spot:HTMLElement|null=null,raf=0,last:PointerEvent|null=null;
  const release=(el:HTMLElement|null)=>{if(!el)return;el.style.removeProperty('--mag-x');el.style.removeProperty('--mag-y');el.classList.remove('is-magnet');};
  const frame=()=>{
    raf=0;const e=last;if(!e)return;
    const target=e.target instanceof Element?e.target:null;
    const m=target?.closest<HTMLElement>(MAGNETIC)??null;
    if(m!==magnet){release(magnet);magnet=m&&!(m as HTMLButtonElement).disabled&&!m.closest('.intro, dialog')?m:null;}
    if(magnet){
      const r=magnet.getBoundingClientRect(),dx=e.clientX-(r.left+r.width/2),dy=e.clientY-(r.top+r.height/2);
      const max=Math.min(6,r.width*.04+2);
      magnet.style.setProperty('--mag-x',`${Math.max(-max,Math.min(max,dx*.16)).toFixed(2)}px`);
      magnet.style.setProperty('--mag-y',`${Math.max(-max,Math.min(max,dy*.22)).toFixed(2)}px`);
      magnet.style.setProperty('--mx',`${(e.clientX-r.left).toFixed(0)}px`);magnet.style.setProperty('--my',`${(e.clientY-r.top).toFixed(0)}px`);
      magnet.classList.add('is-magnet');
    }
    const s=target?.closest<HTMLElement>(SPOT)??null;
    if(s!==spot){spot?.classList.remove('is-spot');spot=s;}
    if(spot){const r=spot.getBoundingClientRect();spot.style.setProperty('--sx',`${(e.clientX-r.left).toFixed(0)}px`);spot.style.setProperty('--sy',`${(e.clientY-r.top).toFixed(0)}px`);spot.classList.add('is-spot');}
  };
  document.addEventListener('pointermove',e=>{
    if(e.pointerType!=='mouse'||reduced()||!fine())return;
    last=e;if(!raf)raf=requestAnimationFrame(frame);
  },{passive:true});
  const clear=()=>{release(magnet);magnet=null;spot?.classList.remove('is-spot');spot=null;last=null;};
  document.addEventListener('pointerleave',clear);window.addEventListener('blur',clear);
  document.addEventListener('pointerdown',e=>{release(magnet);magnet=null;if(!reduced())pressRing(e);},{passive:true});
  installReveal();
}

/** A ring from the point pressed, inside the button's own shape. Added as a decorative child and removed when done. */
const PRESSABLE='button, .button, .choice-options [role=radio], .slot-card, .drop-options [role=radio]';
function pressRing(e:PointerEvent){
  if(e.button!==0)return;
  const host=(e.target instanceof Element?e.target:null)?.closest<HTMLElement>(PRESSABLE);
  if(!host||(host as HTMLButtonElement).disabled||host.closest('.intro, .flap, .split-flap'))return;
  const r=host.getBoundingClientRect();if(r.width<24||r.height<20)return;
  if(getComputedStyle(host).position==='static')host.classList.add('has-press');
  const fx=document.createElement('span');fx.className='press-fx';fx.setAttribute('aria-hidden','true');
  const ring=document.createElement('i');const d=Math.hypot(Math.max(e.clientX-r.left,r.right-e.clientX),Math.max(e.clientY-r.top,r.bottom-e.clientY))*2;
  ring.style.width=ring.style.height=`${d.toFixed(0)}px`;ring.style.left=`${(e.clientX-r.left-d/2).toFixed(0)}px`;ring.style.top=`${(e.clientY-r.top-d/2).toFixed(0)}px`;
  fx.appendChild(ring);host.appendChild(fx);
  const done=()=>fx.remove();ring.addEventListener('animationend',done,{once:true});window.setTimeout(done,900);
}

/*
 * Reveal on scroll. Only blocks that are below the fold when they appear are held back (nothing already on screen
 * ever blinks); each rises 14px and fades in once, those arriving together a few tens of milliseconds apart.
 */
const REVEAL='main .panel, main .parcel-card, main .service-index > *, main .stats > *, main .kpi, main .heat-board, main .info-grid > *, main .timeline li, main .inbox-item, main .report-grid > *, main .card-list > *, main .service-shortcuts > a, main .information-page > :is(h2, ol, ul, .fee-calculator, .faq), main .faq details, main .empty-state';
function installReveal(){
  if(typeof IntersectionObserver==='undefined'||typeof MutationObserver==='undefined')return;
  const io=new IntersectionObserver(entries=>{
    let k=0;
    for(const en of entries){
      if(!en.isIntersecting)continue;const el=en.target as HTMLElement;io.unobserve(el);
      el.style.setProperty('--reveal-delay',`${Math.min(k++,5)*60}ms`);
      el.classList.add('is-revealed');el.classList.remove('reveal-wait');
      el.addEventListener('animationend',()=>{el.classList.remove('is-revealed');el.style.removeProperty('--reveal-delay');},{once:true});
    }
  },{rootMargin:'0px 0px -6% 0px'});
  const scan=(root:ParentNode)=>{
    if(reduced())return;
    const fold=window.innerHeight;
    // The admin workspace is a working tool: its lists appear at once.
    if(document.querySelector('.admin-layout, .admin-content'))return;
    root.querySelectorAll<HTMLElement>(REVEAL).forEach(el=>{
      if(el.dataset.revealSeen)return;el.dataset.revealSeen='1';
      if(el.getBoundingClientRect().top<fold-8)return;
      el.classList.add('reveal-wait');io.observe(el);
    });
  };
  let queued=false;
  const mo=new MutationObserver(()=>{if(queued)return;queued=true;requestAnimationFrame(()=>{queued=false;scan(document);});});
  const start=()=>{mo.observe(document.body,{childList:true,subtree:true});scan(document);};
  if(document.body)start();else document.addEventListener('DOMContentLoaded',start,{once:true});
}

/** The visible 订单 link: the top navigation on wide screens, the tab bar on narrow ones. */
function ordersLink(){
  return [...document.querySelectorAll<HTMLElement>('.site-nav a[href$="/orders"], .mobile-tabs a[href$="/orders"]')].find(a=>{const r=a.getBoundingClientRect();return r.width>0&&r.height>0;})??null;
}
/** A parcel lifts off `from` and arcs into the 订单 navigation item, which then gives a small bump. Resolves when it lands (at once when there is nothing to animate). */
export function flyToOrders(from:Element|null):Promise<void>{
  const to=ordersLink();
  if(!from||!to||reduced()||typeof document.body.animate!=='function')return Promise.resolve();
  const a=from.getBoundingClientRect(),b=to.getBoundingClientRect();
  const sx=a.left+a.width/2,sy=a.top+a.height/2,ex=b.left+b.width/2,ey=b.top+b.height/2;
  const el=document.createElement('div');el.className='parcel-flight';el.setAttribute('aria-hidden','true');
  el.innerHTML='<svg viewBox="0 0 28 28"><rect x="4" y="7" width="20" height="16" rx="2.5"/><path d="M4 13h20M14 7v6"/></svg>';
  el.style.left=`${sx-14}px`;el.style.top=`${sy-14}px`;document.body.appendChild(el);
  // A parabola through a point above both ends: sampled into keyframes, the scale shrinking as it nears the link.
  const lift=Math.min(220,Math.max(90,Math.abs(ex-sx)*.35+(sy-ey)*.25)),N=24,frames:Keyframe[]=[];
  for(let i=0;i<=N;i++){
    const k=i/N,x=(ex-sx)*k,y=(ey-sy)*k-lift*4*k*(1-k),s=1-.55*k,rot=-14+28*k;
    frames.push({transform:`translate(${x.toFixed(1)}px,${y.toFixed(1)}px) rotate(${rot.toFixed(1)}deg) scale(${s.toFixed(3)})`,opacity:k>.92?1-(k-.92)/.08:1});
  }
  return new Promise(resolve=>{
    const anim=el.animate(frames,{duration:760,easing:'cubic-bezier(.45,0,.3,1)'});
    const done=()=>{el.remove();to.animate([{transform:'none'},{transform:'translateY(-3px) scale(1.12)'},{transform:'none'}],{duration:420,easing:'cubic-bezier(.3,1.6,.5,1)'});resolve();};
    anim.onfinish=done;anim.oncancel=done;
  });
}

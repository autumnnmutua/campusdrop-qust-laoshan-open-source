import {useEffect,useLayoutEffect,useRef,useState,type CSSProperties} from 'react';
import {prefersReducedMotion} from './motion';

/**
 * Progress drawn as a short route through one fix per step. The stretch already covered is magenta; a parcel glyph
 * travels along the route to the current fix — from where this page last saw the order, so a live status change shows
 * the parcel moving on. Labels sit under their fixes. `current` is the index reached; `done` marks the last step as
 * finished (no pulse).
 */
const D='M14 44 C60 44 92 22 138 22 S216 44 262 44 S340 22 386 22';
type Pt=[number,number];

export function RouteProgress({steps,current,from,done=false,label}:{steps:string[];current:number;from?:number;done?:boolean;label:string}){
  const path=useRef<SVGPathElement>(null);
  const last=Math.max(1,steps.length-1),target=Math.max(0,Math.min(current,last))/last;
  const [fixes,setFixes]=useState<Pt[]>(()=>steps.map((_,i)=>[14+372*i/last,i%2?22:44]));
  const [pos,setPos]=useState<Pt>(fixes[0]);const [drawn,setDrawn]=useState(0);
  useLayoutEffect(()=>{
    const el=path.current;if(!el)return;const total=el.getTotalLength();
    setFixes(Array.from({length:last+1},(_,i)=>{const p=el.getPointAtLength(total*i/last);return [p.x,p.y] as Pt;}));
  },[last]);
  useEffect(()=>{
    const el=path.current;if(!el)return;
    const total=el.getTotalLength(),start=from===undefined?0:Math.max(0,Math.min(from,last))/last;
    const place=(f:number)=>{const p=el.getPointAtLength(total*f);setPos([p.x,p.y]);setDrawn(f);};
    if(prefersReducedMotion()||start===target){place(target);return;}
    let raf=0;const t0=performance.now(),dur=700+Math.abs(target-start)*900;
    const step=(now:number)=>{const k=Math.min(1,(now-t0)/dur),e=1-Math.pow(1-k,3);place(start+(target-start)*e);if(k<1)raf=requestAnimationFrame(step);};
    place(start);raf=requestAnimationFrame(step);
    return()=>cancelAnimationFrame(raf);
  },[target,from,last]);
  return <div className="route-progress-chart" role="img" aria-label={label}>
    <svg viewBox="0 0 400 62" aria-hidden="true">
      <path className="rp-track" d={D}/>
      <path ref={path} className="rp-done" d={D} pathLength={1} style={{strokeDasharray:`${drawn} 2`} as CSSProperties}/>
      {fixes.map(([x,y],i)=><g key={i} className={i<current||(i===current&&done)?'rp-fix is-passed':i===current?'rp-fix is-current':'rp-fix'}><circle cx={x} cy={y} r="5.5"/>{i===current&&!done&&<circle className="rp-ping" cx={x} cy={y} r="5.5"/>}</g>)}
      <g className="rp-parcel" transform={`translate(${pos[0].toFixed(1)} ${pos[1].toFixed(1)})`}><rect x="-7" y="-20" width="14" height="11" rx="2"/><path d="M-7 -15.5h14M0 -20v4.5"/></g>
    </svg>
    <ol>{steps.map((s,i)=><li key={s} className={i<=current?'is-reached':undefined} style={{'--x':`${(fixes[i]?.[0]??0)/4}%`} as CSSProperties}>{s}</li>)}</ol>
  </div>;
}

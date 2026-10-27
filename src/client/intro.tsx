import {useCallback,useEffect,useRef,useState,type CSSProperties,type RefObject} from 'react';
import {getItem,setItem} from './storage';

/*
 * Opening animation, once per browser session — "一滴入海": night is lifting over the sea below Laoshan, a drop of light
 * falls into the water, ripples spread with a splash of light particles, and the CampusDrop parcel mark and name rise
 * from the rings. On the way out a ripple opens from the mark and reveals the app underneath.
 * Skipped for reduced motion, the admin workspace, automated browsers and repeat visits; any tap or key skips it.
 * Add ?intro=1 to the address to see it again.
 */
const KEY='campusdrop:intro-seen';
const TITLE='CampusDrop';
/** Seconds after mount when the drop meets the water. Keep in step with the intro delays in features-live.css. */
const IMPACT=0.85;
const LEAVE_AT=2850,LEAVE_FOR=650;
function shouldShow(){
  if(typeof window==='undefined')return false;
  if(new URLSearchParams(window.location.search).has('intro'))return true;
  if(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches||navigator.webdriver)return false;
  if(window.location.pathname.startsWith('/admin')||window.location.hash.startsWith('#/admin'))return false;
  return !getItem(KEY,'session');
}

/** Smooth ridgeline through the given points (Catmull-Rom as cubic Béziers), closed down to the bottom edge. */
function ridge(points:[number,number][],bottom:number){
  let d=`M${points[0][0]} ${points[0][1]}`;
  for(let i=0;i<points.length-1;i++){
    const p0=points[Math.max(0,i-1)],p1=points[i],p2=points[i+1],p3=points[Math.min(points.length-1,i+2)];
    d+=` C${p1[0]+(p2[0]-p0[0])/6} ${p1[1]+(p2[1]-p0[1])/6} ${p2[0]-(p3[0]-p1[0])/6} ${p2[1]-(p3[1]-p1[1])/6} ${p2[0]} ${p2[1]}`;
  }
  return `${d} V${bottom} H${points[0][0]}Z`;
}
const FAR=ridge([[0,196],[70,176],[130,184],[210,128],[260,146],[330,92],[380,118],[430,104],[520,160],[600,148],[690,182],[790,170],[880,196],[960,148],[1010,162],[1080,84],[1130,112],[1180,100],[1260,150],[1340,138],[1440,166]],320);
const NEAR=ridge([[0,236],[120,222],[230,232],[330,208],[430,226],[560,214],[700,238],[820,226],[930,240],[1060,218],[1180,230],[1300,212],[1440,228]],320);

interface Particle {x:number;y:number;vx:number;vy:number;r:number;sprite:number;born:number;life:number;phase:number;kind:'mote'|'spray'|'crown'}
const COLORS=['#ffffff','#cfe6ff','#ffe2a3','#8fd3ff'];
/** Soft round glows, one per colour, drawn once and stamped every frame. */
function makeSprites(){
  return COLORS.map(color=>{
    const c=document.createElement('canvas');c.width=c.height=64;
    const g=c.getContext('2d')!,grad=g.createRadialGradient(32,32,0,32,32,32);
    grad.addColorStop(0,color);grad.addColorStop(.25,`${color}cc`);grad.addColorStop(1,`${color}00`);
    g.fillStyle=grad;g.fillRect(0,0,64,64);return c;
  });
}
/** Light particles: motes rising through the dark, then spray and a crown of droplets from the point of impact. */
function useParticles(canvas:RefObject<HTMLCanvasElement|null>,core:RefObject<HTMLDivElement|null>,active:boolean){
  useEffect(()=>{
    const el=canvas.current,ctx=el?.getContext('2d');
    if(!active||!el||!ctx||window.matchMedia?.('(prefers-reduced-motion: reduce)').matches)return;
    const sprites=makeSprites(),dpr=Math.min(2,window.devicePixelRatio||1);
    let w=0,h=0,frame=0,splashed=false,last=performance.now();
    const resize=()=>{w=el.clientWidth;h=el.clientHeight;el.width=w*dpr;el.height=h*dpr;ctx.setTransform(dpr,0,0,dpr,0,0);};
    resize();window.addEventListener('resize',resize);
    const rand=(a:number,b:number)=>a+Math.random()*(b-a);
    const particles:Particle[]=Array.from({length:Math.round(Math.min(80,w*h/15000))},()=>({x:rand(0,w),y:rand(0,h),vx:0,vy:-rand(.08,.32),r:rand(.5,1.6),sprite:Math.floor(rand(0,COLORS.length)),born:0,life:Infinity,phase:rand(0,Math.PI*2),kind:'mote' as const}));
    const start=last;
    const tick=(now:number)=>{
      const t=(now-start)/1000,step=Math.min(3,(now-last)/16.7);last=now;
      if(!splashed&&t>=IMPACT&&core.current){
        splashed=true;
        const box=core.current.getBoundingClientRect(),cx=box.left+box.width/2,cy=box.top+box.height/2;
        for(let i=0;i<90;i++){const a=rand(0,Math.PI*2),s=rand(1.2,5.2);particles.push({x:cx,y:cy,vx:Math.cos(a)*s,vy:Math.sin(a)*s,r:rand(.6,1.8),sprite:i%3?1:2,born:t,life:rand(.9,1.8),phase:0,kind:'spray'});}
        for(let i=0;i<26;i++){const a=rand(-Math.PI*.85,-Math.PI*.15),s=rand(2.5,6);particles.push({x:cx,y:cy,vx:Math.cos(a)*s,vy:Math.sin(a)*s,r:rand(1,2.2),sprite:i%2?2:0,born:t,life:rand(.8,1.3),phase:0,kind:'crown'});}
      }
      ctx.clearRect(0,0,w,h);
      ctx.globalCompositeOperation='lighter';
      const fadeIn=Math.min(1,t/.8);
      for(let i=particles.length-1;i>=0;i--){
        const p=particles[i],age=t-p.born;
        if(age>p.life){particles.splice(i,1);continue;}
        if(p.kind==='spray'){p.vx*=.955**step;p.vy*=.955**step;}
        else if(p.kind==='crown'){p.vx*=.985**step;p.vy+=.16*step;}
        else{p.vx=Math.sin(t*.9+p.phase)*.18;if(p.y<-10){p.y=h+10;p.x=rand(0,w);}}
        p.x+=p.vx*step;p.y+=p.vy*step;
        const alpha=p.kind==='mote'?fadeIn*(.35+.35*Math.sin(t*2.4+p.phase)):(1-age/p.life)**1.4;
        const size=p.r*(p.kind==='mote'?6:7);
        ctx.globalAlpha=Math.max(0,alpha);
        ctx.drawImage(sprites[p.sprite],p.x-size/2,p.y-size/2,size,size);
      }
      frame=requestAnimationFrame(tick);
    };
    frame=requestAnimationFrame(tick);
    return()=>{cancelAnimationFrame(frame);window.removeEventListener('resize',resize);};
  },[active,canvas,core]);
}

export function IntroSplash(){
  const [show,setShow]=useState(shouldShow),[leaving,setLeaving]=useState(false),[origin,setOrigin]=useState<CSSProperties>({});
  const canvas=useRef<HTMLCanvasElement>(null),core=useRef<HTMLDivElement>(null);
  const leave=useCallback(()=>{
    // The closing ripple opens from the mark, wherever the layout put it.
    const box=core.current?.getBoundingClientRect();
    if(box)setOrigin({'--cx':`${Math.round(box.left+box.width/2)}px`,'--cy':`${Math.round(box.top+box.height/2)}px`} as CSSProperties);
    setLeaving(true);
  },[]);
  const skip=useCallback(()=>{leave();window.setTimeout(()=>setShow(false),LEAVE_FOR);},[leave]);
  useParticles(canvas,core,show);
  useEffect(()=>{
    if(!show)return;
    setItem(KEY,'1','session');
    const out=window.setTimeout(leave,LEAVE_AT),done=window.setTimeout(()=>setShow(false),LEAVE_AT+LEAVE_FOR);
    const onKey=(e:KeyboardEvent)=>{if(e.key!=='Tab')skip();};
    window.addEventListener('keydown',onKey);
    return()=>{window.clearTimeout(out);window.clearTimeout(done);window.removeEventListener('keydown',onKey);};
  },[show,skip,leave]);
  if(!show)return null;
  return <div className={`intro${leaving?' is-leaving':''}`} style={origin} onClick={skip}>
    <div className="intro-aurora" aria-hidden="true"/>
    <svg className="intro-sea" viewBox="0 0 1440 320" preserveAspectRatio="xMidYMax slice" aria-hidden="true">
      <defs>
        <linearGradient id="intro-far" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#2a5ea6" stopOpacity=".85"/><stop offset=".55" stopColor="#173f7a" stopOpacity=".6"/><stop offset="1" stopColor="#0e2d61" stopOpacity=".2"/></linearGradient>
        <linearGradient id="intro-near" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#123466"/><stop offset="1" stopColor="#081a3c"/></linearGradient>
        <linearGradient id="intro-water" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#123a74"/><stop offset="1" stopColor="#061532"/></linearGradient>
        <linearGradient id="intro-horizon" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stopColor="#8fd3ff" stopOpacity="0"/><stop offset=".5" stopColor="#ffe2a3"/><stop offset="1" stopColor="#8fd3ff" stopOpacity="0"/></linearGradient>
      </defs>
      <path className="intro-ridge far" d={FAR} fill="url(#intro-far)"/>
      <path className="intro-ridge near" d={NEAR} fill="url(#intro-near)"/>
      <rect className="intro-water" y="250" width="1440" height="70" fill="url(#intro-water)"/>
      <rect className="intro-horizon" y="249" width="1440" height="1.5" fill="url(#intro-horizon)"/>
      {[[180,268,70],[430,282,46],[640,262,120],[700,274,64],[940,286,52],[1180,270,90]].map(([x,y,len],i)=><path key={i} className="intro-glint" d={`M${x} ${y}h${len}`} style={{animationDelay:`${i*.37}s`}}/>)}
    </svg>
    {['f1','f2','f3'].map(f=><div key={f} className={`intro-fog ${f}`} aria-hidden="true"/>)}
    <canvas ref={canvas} className="intro-particles" aria-hidden="true"/>
    <div className="intro-stage">
      <div className="intro-core" ref={core}>
        {[0,1,2,3,4].map(i=><span key={i} className="intro-ripple" style={{animationDelay:`${IMPACT+i*.2}s`}} aria-hidden="true"/>)}
        <span className="intro-flash" aria-hidden="true"/>
        <span className="intro-drop" aria-hidden="true"><svg viewBox="-10 -16 20 28"><defs><radialGradient id="intro-drop" cx=".4" cy=".65" r=".7"><stop offset="0" stopColor="#ffffff"/><stop offset="1" stopColor="#ffd27a"/></radialGradient></defs><path d="M0 -15 C4 -7 9 -1 9 4 a9 9 0 0 1 -18 0 C-9 -1 -4 -7 0 -15Z" fill="url(#intro-drop)"/></svg></span>
        <div className="intro-mark" aria-hidden="true">
          <svg viewBox="-60 -60 120 120">
            <circle className="intro-orbit" r="55"/>
            <circle className="intro-ring" r="55" pathLength={1}/>
            <g className="intro-parcel" transform="translate(-32 -32)">
              <path d="M32 13 50 22.5v19L32 51 14 41.5v-19Z" pathLength={1}/><path d="M14 22.5 32 32l18-9.5M32 32v19" pathLength={1}/><path d="M23 17.8 41 27.3" pathLength={1} className="intro-strap"/>
            </g>
          </svg>
        </div>
      </div>
      <p className="intro-title" aria-label={TITLE}>{TITLE.split('').map((c,i)=><span key={i} className={i>=6?'is-drop':undefined} style={{animationDelay:`${1.4+i*.04}s`}}>{c}</span>)}</p>
      <span className="intro-rule" aria-hidden="true"/>
      <p className="intro-sub">青岛科技大学 · 崂山校区</p>
      <p className="intro-tagline">每一份期待，都值得准时抵达</p>
    </div>
    <button type="button" className="intro-skip" onClick={e=>{e.stopPropagation();skip();}}>跳过</button>
  </div>;
}

import {FRAG,MAX_ROUTE,VERT} from './shader';

/** Chart sheet size and the fixed marks on it (chart pixels, y down). Kept in step with chart-art-data.ts. */
export const SHEET={w:1600,h:900};
export const CAMPUS:[number,number]=[905,505];
export const STATION:[number,number]=[762,612];
// Station → campus along the road: two cubic Béziers (the same curve as the SVG fallback).
const ROUTE_CURVES:[number,number][][]=[[[762,612],[790,600],[806,572],[836,560]],[[836,560],[866,548],[884,530],[905,505]]];

function sampleRoute(){
  const pts:[number,number][]=[];
  const steps=Math.floor((MAX_ROUTE-1)/ROUTE_CURVES.length);
  ROUTE_CURVES.forEach(([a,b,c,d],k)=>{
    for(let i=k===0?0:1;i<=steps;i++){const t=i/steps,u=1-t;
      pts.push([u*u*u*a[0]+3*u*u*t*b[0]+3*u*t*t*c[0]+t*t*t*d[0],u*u*u*a[1]+3*u*u*t*b[1]+3*u*t*t*c[1]+t*t*t*d[1]]);}
  });
  const cum=[0];for(let i=1;i<pts.length;i++)cum.push(cum[i-1]+Math.hypot(pts[i][0]-pts[i-1][0],pts[i][1]-pts[i-1][1]));
  const total=cum[cum.length-1];
  return {pts,cum:cum.map(c=>c/total)};
}
const ROUTE=sampleRoute();
/** Point at fraction f (0..1) of the route, in chart pixels. */
export function routePoint(f:number):[number,number]{
  const {pts,cum}=ROUTE;f=Math.min(1,Math.max(0,f));
  let i=1;while(i<cum.length-1&&cum[i]<f)i++;
  const h=(f-cum[i-1])/Math.max(cum[i]-cum[i-1],1e-6);
  return [pts[i-1][0]+(pts[i][0]-pts[i-1][0])*h,pts[i-1][1]+(pts[i][1]-pts[i-1][1])*h];
}

/** Palettes (sRGB 0..1): the paper chart of the light theme, and the night chart of the dark theme. */
const hex=(h:string)=>[1,3,5].map(i=>parseInt(h.slice(i,i+2),16)/255) as [number,number,number];
export type ChartLook='paper'|'night';
const PALETTES={
  paper:{ink:hex('#6f9194'),deep:hex('#e6f0f2'),shallow:hex('#fbfcf9'),sea:hex('#9fc2cc'),coast:hex('#1f5f75'),route:hex('#c0306c'),mark:hex('#0f2833'),paper:1},
  night:{ink:hex('#9fd4cc'),deep:hex('#05121a'),shallow:hex('#0c2630'),sea:hex('#4f9fb8'),coast:hex('#dff3ee'),route:hex('#ff5c9d'),mark:hex('#ffffff'),paper:0},
};
/** The look that goes with the page's theme. */
export const lookForTheme=(theme:'light'|'dark'):ChartLook=>theme==='dark'?'night':'paper';

/** Shared clock: every chart on the page (the opening and the hero) shows the same instant, so hand-overs are seamless. */
const EPOCH=typeof performance!=='undefined'?performance.now():0;
let lightOriginAt=0;
/** Where the hero's route light starts its cycle (the opening sets it so the light continues without a jump). */
export const setLightOrigin=(t:number)=>{lightOriginAt=t;};
export const lightOrigin=()=>lightOriginAt;
/** Development only: a capture script can drive the clock (window.__cdClock, seconds) and redraw every chart at once. */
type CaptureWindow=Window&{__cdClock?:number;__cdDrawAll?:()=>void};
const live=new Set<SeaChart>();
if(import.meta.env.DEV&&typeof window!=='undefined')(window as CaptureWindow).__cdDrawAll=()=>live.forEach(c=>c.draw());
/** While the opening covers the page, the other charts (the hero underneath) skip their frames; they resume at once. */
let heldExcept:SeaChart|null=null;
export function holdOtherCharts(keep:SeaChart|null){
  heldExcept=keep;
  if(!keep)live.forEach(c=>c.resume());
}
export const chartTime=()=>{
  if(import.meta.env.DEV&&typeof window!=='undefined'){const c=(window as CaptureWindow).__cdClock;if(typeof c==='number')return c;}
  return ((typeof performance!=='undefined'?performance.now():0)-EPOCH)/1000;
};

export interface ChartViewport{ox:number;oy:number;scale:number}
/**
 * "Cover" the given box (CSS px) with the sheet. focusY, if given, moves the sheet vertically so that the campus sits at
 * that fraction of `band` (the visible height that matters), but never so far that the sheet leaves a gap.
 */
export function coverView(width:number,height:number,{focusY,band}:{focusY?:number;band?:number}={}):ChartViewport{
  const scale=Math.max(width/SHEET.w,height/SHEET.h);
  const ox=(width-SHEET.w*scale)/2;let oy=(height-SHEET.h*scale)/2;
  // Keep the campus horizontally on screen on narrow phones.
  let x=ox;const cx=CAMPUS[0]*scale+ox;if(cx>width*.82)x-=cx-width*.72;
  if(focusY!==undefined&&band){const want=band*focusY,now=CAMPUS[1]*scale+oy;oy=Math.min(0,Math.max(height-SHEET.h*scale,oy+(want-now)));}
  return {ox:x,oy,scale};
}

export interface ChartState{sweep:number;routeT:number;light:number;lightA:number;fix:number}

export class SeaChart{
  private gl:WebGL2RenderingContext;private prog:WebGLProgram;private loc:Record<string,WebGLUniformLocation|null>={};
  private raf=0;private running=false;private visible=true;private destroyed=false;
  private res=1;private dpr=1;private cssW=0;private cssH=0;private times:number[]=[];
  private view:ChartViewport={ox:0,oy:0,scale:1};
  private ptr={x:-9999,y:-9999,s:0,target:0};private pulseAt={x:0,y:0,t:-99,s:0};
  private io?:IntersectionObserver;private ro?:ResizeObserver;
  state:ChartState={sweep:7,routeT:1,light:0,lightA:1,fix:1};
  /** Called every frame before drawing; the opening uses it to drive state from the clock. */
  onFrame?:(t:number,chart:SeaChart)=>void;
  quality:1|0;

  static create(canvas:HTMLCanvasElement,{quality,look='paper'}:{quality?:1|0;look?:ChartLook}={}):SeaChart|null{
    try{
      const gl=canvas.getContext('webgl2',{antialias:false,alpha:false,depth:false,stencil:false,premultipliedAlpha:false,powerPreference:'low-power',preserveDrawingBuffer:false});
      if(!gl)return null;
      return new SeaChart(canvas,gl,quality??(lowPowerDevice()?0:1),look);
    }catch(e){if(import.meta.env.DEV)console.warn('[sea-chart]',e);return null;}
  }
  private constructor(private canvas:HTMLCanvasElement,gl:WebGL2RenderingContext,quality:1|0,look:ChartLook){
    this.gl=gl;this.quality=quality;
    const sh=(type:number,src:string)=>{const s=gl.createShader(type)!;gl.shaderSource(s,src);gl.compileShader(s);if(!gl.getShaderParameter(s,gl.COMPILE_STATUS))throw new Error(gl.getShaderInfoLog(s)??'shader');return s;};
    const prog=gl.createProgram()!;gl.attachShader(prog,sh(gl.VERTEX_SHADER,VERT));gl.attachShader(prog,sh(gl.FRAGMENT_SHADER,FRAG));gl.linkProgram(prog);
    if(!gl.getProgramParameter(prog,gl.LINK_STATUS))throw new Error(gl.getProgramInfoLog(prog)??'link');
    this.prog=prog;gl.useProgram(prog);
    const buf=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,buf);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-1,-1,3,-1,-1,3]),gl.STATIC_DRAW);
    const a=gl.getAttribLocation(prog,'aPos');gl.enableVertexAttribArray(a);gl.vertexAttribPointer(a,2,gl.FLOAT,false,0,0);
    for(const n of ['uRes','uView','uTime','uPtr','uPulse','uSweep','uRouteT','uLight','uRoute','uRouteCum','uRouteN','uCampus','uStation','uFix','uQuality','uInk','uDeep','uShallow','uSea','uCoast','uRouteC','uMark','uPaper','uK'])this.loc[n]=gl.getUniformLocation(prog,n);
    gl.uniform2fv(this.loc.uRoute,new Float32Array(ROUTE.pts.flat()));gl.uniform1fv(this.loc.uRouteCum,new Float32Array(ROUTE.cum));gl.uniform1i(this.loc.uRouteN,ROUTE.pts.length);
    gl.uniform2f(this.loc.uCampus,CAMPUS[0],CAMPUS[1]);gl.uniform2f(this.loc.uStation,STATION[0],STATION[1]);
    this.setLook(look);
    // Always start at full sharpness; adapt() only lowers it when frames really run long.
    this.res=1;
    canvas.addEventListener('webglcontextlost',this.onLost);
    if(typeof IntersectionObserver!=='undefined'){this.io=new IntersectionObserver(([e])=>{this.visible=e.isIntersecting;this.kick();});this.io.observe(canvas);}
    if(typeof ResizeObserver!=='undefined'){this.ro=new ResizeObserver(()=>this.measure());this.ro.observe(canvas);}
    document.addEventListener('visibilitychange',this.kick);
    this.measure();live.add(this);
  }
  private onLost=(e:Event)=>{e.preventDefault();this.stop();this.destroyed=true;};
  /** Sizes the drawing buffer from the canvas' CSS box, the device pixel ratio and the current resolution scale. */
  measure(){
    const r=this.canvas.getBoundingClientRect();this.cssW=Math.max(1,r.width);this.cssH=Math.max(1,r.height);
    // The screen's own pixel ratio, up to 2 (beyond 2× the hairlines are already crisper than the eye can tell).
    this.dpr=Math.min(window.devicePixelRatio||1,2);
    const w=Math.round(this.cssW*this.dpr*this.res),h=Math.round(this.cssH*this.dpr*this.res);
    if(this.canvas.width!==w||this.canvas.height!==h){this.canvas.width=w;this.canvas.height=h;}
    if(!this.running)this.draw();
  }
  /** Paper or night colours; redraws at once when the theme changes. */
  setLook(look:ChartLook){
    const gl=this.gl,p=PALETTES[look];
    gl.uniform3fv(this.loc.uInk,p.ink);gl.uniform3fv(this.loc.uDeep,p.deep);gl.uniform3fv(this.loc.uShallow,p.shallow);gl.uniform3fv(this.loc.uSea,p.sea);
    gl.uniform3fv(this.loc.uCoast,p.coast);gl.uniform3fv(this.loc.uRouteC,p.route);gl.uniform3fv(this.loc.uMark,p.mark);gl.uniform1f(this.loc.uPaper,p.paper);
    if(!this.running&&this.cssW)this.draw();
  }
  setView(v:ChartViewport){this.view=v;if(!this.running)this.draw();}
  get size(){return {width:this.cssW,height:this.cssH};}
  /** Pointer position in CSS px relative to the canvas; inside=false lets the lens fade out. */
  pointer(x:number,y:number,inside:boolean){this.ptr.x=x;this.ptr.y=y;this.ptr.target=inside?1:0;this.kick();}
  pulse(x:number,y:number){this.pulseAt={x,y,t:chartTime(),s:1};this.kick();}
  start(){this.running=true;this.kick();}
  stop(){this.running=false;cancelAnimationFrame(this.raf);this.raf=0;}
  // Development capture: the recording script steps the clock and draws every chart itself (__cdDrawAll), so the
  // real-time loop stays off and cannot starve the screenshots.
  private kick=()=>{if(this.destroyed)return;if(import.meta.env.DEV&&typeof (window as CaptureWindow).__cdClock==='number')return;if(this.running&&this.visible&&!document.hidden){if(!this.raf)this.raf=requestAnimationFrame(this.frame);}else if(this.raf){cancelAnimationFrame(this.raf);this.raf=0;}};
  private last=0;
  private frame=(now:number)=>{
    this.raf=0;if(!this.running||!this.visible||document.hidden||this.destroyed)return;
    const dt=this.last?now-this.last:16;this.last=now;
    if(heldExcept&&heldExcept!==this){this.raf=requestAnimationFrame(this.frame);return;}
    this.adapt(dt);this.draw();this.raf=requestAnimationFrame(this.frame);
  };
  /** Picks up after a hold: one frame now, then the normal loop. */
  resume(){this.last=0;if(!this.running)this.draw();this.kick();}
  /**
   * Dynamic resolution, careful not to blur for nothing. A display or power mode that runs animation frames at 30 Hz
   * (iOS Low Power Mode, battery savers) gives steady 33 ms frames: that is the frame rate, not an overloaded GPU, so the
   * baseline is the steadiest frame interval seen. Only when the typical frame runs half again over that baseline is
   * the resolution lowered (never below 0.7); also whenever frames run under ~22 fps. It is raised again once frames
   * are back on the baseline.
   */
  private base=Infinity;private calm=0;
  private adapt(dt:number){
    if(import.meta.env.DEV&&typeof (window as CaptureWindow).__cdClock==='number')return;
    if(dt>250){this.times=[];return;}                    // a stall (tab switch, GC): not a measurement
    this.times.push(dt);if(this.times.length<30)return;
    const sorted=[...this.times].sort((a,b)=>a-b),median=sorted[15];this.times=[];
    this.base=Math.min(this.base,Math.max(6,median));
    // Under ~22 fps the GPU is clearly struggling whatever the display does.
    if((median>Math.max(20,this.base*1.5)||median>45)&&this.res>.7){this.res=Math.max(.7,this.res*.85);this.calm=0;this.measure();}
    else if(median<=this.base*1.12&&this.res<1&&++this.calm>=3){this.res=Math.min(1,this.res/.85);this.calm=0;this.measure();}
  }
  draw(){
    if(this.destroyed)return;
    const gl=this.gl,t=chartTime(),k=this.dpr*this.res,s=this.view.scale;
    this.onFrame?.(t,this);
    this.ptr.s+=(this.ptr.target-this.ptr.s)*.06;
    gl.viewport(0,0,this.canvas.width,this.canvas.height);
    gl.uniform2f(this.loc.uRes,this.canvas.width,this.canvas.height);
    gl.uniform3f(this.loc.uView,this.view.ox*k,this.view.oy*k,s*k);
    gl.uniform1f(this.loc.uTime,t);
    gl.uniform3f(this.loc.uPtr,(this.ptr.x-this.view.ox)/s,(this.ptr.y-this.view.oy)/s,this.ptr.s);
    gl.uniform4f(this.loc.uPulse,(this.pulseAt.x-this.view.ox)/s,(this.pulseAt.y-this.view.oy)/s,this.pulseAt.t,this.pulseAt.s);
    const st=this.state,[lx,ly]=routePoint(st.light);
    gl.uniform1f(this.loc.uSweep,st.sweep);gl.uniform1f(this.loc.uRouteT,st.routeT);gl.uniform3f(this.loc.uLight,lx,ly,st.lightA);gl.uniform1f(this.loc.uFix,st.fix);
    gl.uniform1f(this.loc.uQuality,this.quality);gl.uniform1f(this.loc.uK,k);
    gl.drawArrays(gl.TRIANGLES,0,3);
  }
  destroy(){
    this.stop();this.destroyed=true;live.delete(this);this.io?.disconnect();this.ro?.disconnect();
    document.removeEventListener('visibilitychange',this.kick);this.canvas.removeEventListener('webglcontextlost',this.onLost);
    // The context is not force-lost here: React may mount the same canvas again (StrictMode), and a lost context
    // cannot be revived. Dropping the canvas releases it.
  }
}

/** Phones and low-core devices get fewer noise octaves (the resolution is not reduced for them). */
function lowPowerDevice(){
  if(typeof navigator==='undefined')return false;
  const cores=navigator.hardwareConcurrency||4,mobile=/Android|iPhone|iPad|Mobile/i.test(navigator.userAgent);
  return mobile||cores<=4;
}

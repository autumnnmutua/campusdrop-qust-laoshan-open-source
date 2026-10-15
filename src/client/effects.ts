import {useSyncExternalStore} from 'react';
import {prefersReducedMotion} from './motion';
import {getItem,setItem} from './storage';

/* ------------------------------------------------------------------ ambient preference
 * Stored per browser only (a light convenience). Every storage access is wrapped: private windows and blocked
 * site data throw, and the page must behave the same without it. */
export type AmbientMode='auto'|'snow'|'sakura'|'bokeh'|'leaves'|'off';
export type Scene=Exclude<AmbientMode,'auto'|'off'>;
export const AMBIENT_LABELS:Record<AmbientMode,string>={auto:'随季节',snow:'冬 · 雪花',sakura:'春 · 樱花',bokeh:'夏 · 光斑',leaves:'秋 · 落叶',off:'关闭'};
const AMBIENT_KEY='campusdrop:ambient';
const MODES=Object.keys(AMBIENT_LABELS) as AmbientMode[];
/** Campus seasons in Qingdao: Dec–Feb snow, Mar–May cherry blossom, Jun–Aug summer light, Sep–Nov falling leaves. */
export function seasonScene(date=new Date()):Scene{const m=date.getMonth()+1;return m===12||m<=2?'snow':m<=5?'sakura':m<=8?'bokeh':'leaves';}
function readMode():AmbientMode{const v=getItem(AMBIENT_KEY);return MODES.includes(v as AmbientMode)?v as AmbientMode:'auto';}
let ambientMode:AmbientMode=typeof window==='undefined'?'auto':readMode();
const ambientListeners=new Set<()=>void>();
export function setAmbientMode(next:AmbientMode){ambientMode=next;setItem(AMBIENT_KEY,next);ambientListeners.forEach(l=>l());}
export function useAmbientMode(){return useSyncExternalStore(l=>{ambientListeners.add(l);return()=>ambientListeners.delete(l);},()=>ambientMode,()=>'auto' as AmbientMode);}
export function resolveScene(mode:AmbientMode):Scene|null{return mode==='off'?null:mode==='auto'?seasonScene():mode;}

/* ------------------------------------------------------------------ sprites
 * Each particle kind is drawn once into a small offscreen canvas; the frame loop only blits them with a transform. */
type Sprite=HTMLCanvasElement;
function sprite(size:number,draw:(c:CanvasRenderingContext2D,s:number)=>void):Sprite{
  const canvas=document.createElement('canvas');canvas.width=canvas.height=size;const c=canvas.getContext('2d');if(c)draw(c,size);return canvas;
}
function snowSprites():Sprite[]{
  // Soft flakes get a pale-blue rim so they stay visible on white cards and the light-blue page background.
  const dot=(core:string,rim:string)=>sprite(48,(c,s)=>{const g=c.createRadialGradient(s/2,s/2,0,s/2,s/2,s/2);g.addColorStop(0,'#ffffff');g.addColorStop(.42,core);g.addColorStop(.7,rim);g.addColorStop(1,'rgba(150,190,240,0)');c.fillStyle=g;c.beginPath();c.arc(s/2,s/2,s/2,0,Math.PI*2);c.fill();});
  const crystal=(color:string)=>sprite(64,(c,s)=>{
    c.translate(s/2,s/2);c.strokeStyle=color;c.lineCap='round';c.lineWidth=2.4;c.shadowColor='rgba(255,255,255,.9)';c.shadowBlur=4;
    for(let i=0;i<6;i++){c.rotate(Math.PI/3);c.beginPath();c.moveTo(0,0);c.lineTo(0,-s*.42);c.moveTo(0,-s*.24);c.lineTo(-s*.1,-s*.33);c.moveTo(0,-s*.24);c.lineTo(s*.1,-s*.33);c.moveTo(0,-s*.12);c.lineTo(-s*.07,-s*.18);c.moveTo(0,-s*.12);c.lineTo(s*.07,-s*.18);c.stroke();}
  });
  return [dot('rgba(232,242,255,.98)','rgba(140,186,240,.7)'),dot('rgba(220,236,255,.95)','rgba(112,166,234,.62)'),crystal('#7fb0ec'),crystal('#9ac2f0'),crystal('#6aa2e6')];
}
function petalSprites():Sprite[]{
  const petal=(a:string,b:string)=>sprite(56,(c,s)=>{
    c.translate(s/2,s/2);const g=c.createLinearGradient(0,-s*.4,0,s*.4);g.addColorStop(0,a);g.addColorStop(1,b);c.fillStyle=g;
    // Cherry-blossom petal: rounded body with the characteristic notch at the tip.
    c.beginPath();c.moveTo(0,s*.4);c.bezierCurveTo(-s*.42,s*.12,-s*.3,-s*.38,-s*.07,-s*.4);c.lineTo(0,-s*.3);c.lineTo(s*.07,-s*.4);c.bezierCurveTo(s*.3,-s*.38,s*.42,s*.12,0,s*.4);c.fill();
    c.strokeStyle='rgba(255,255,255,.55)';c.lineWidth=1.2;c.beginPath();c.moveTo(0,s*.32);c.lineTo(0,-s*.18);c.stroke();
  });
  return [petal('#ffd6e2','#f58fb0'),petal('#ffe5ed','#f7a8c2'),petal('#ffc4d6','#ec7aa1')];
}
function leafSprites():Sprite[]{
  const leaf=(a:string,b:string)=>sprite(64,(c,s)=>{
    c.translate(s/2,s/2);c.rotate(-.5);const g=c.createLinearGradient(-s*.3,-s*.3,s*.3,s*.3);g.addColorStop(0,a);g.addColorStop(1,b);c.fillStyle=g;
    c.beginPath();c.moveTo(0,-s*.42);c.bezierCurveTo(s*.32,-s*.22,s*.3,s*.18,0,s*.36);c.bezierCurveTo(-s*.3,s*.18,-s*.32,-s*.22,0,-s*.42);c.fill();
    c.strokeStyle='rgba(120,52,10,.45)';c.lineWidth=1.6;c.beginPath();c.moveTo(0,s*.46);c.lineTo(0,-s*.34);
    for(const y of [-.18,0,.16]){c.moveTo(0,s*y);c.lineTo(s*.16,s*(y-.12));c.moveTo(0,s*y);c.lineTo(-s*.16,s*(y-.12));}c.stroke();
  });
  return [leaf('#ffb347','#e8641b'),leaf('#f7d154','#d98a1c'),leaf('#f08a4b','#b8401f'),leaf('#e9b04f','#9c5a1b')];
}
function bokehSprites():Sprite[]{
  const orb=(r:number,g:number,b:number)=>sprite(64,(c,s)=>{const grad=c.createRadialGradient(s/2,s/2,0,s/2,s/2,s/2);grad.addColorStop(0,`rgba(${r},${g},${b},.85)`);grad.addColorStop(.5,`rgba(${r},${g},${b},.42)`);grad.addColorStop(1,`rgba(${r},${g},${b},0)`);c.fillStyle=grad;c.beginPath();c.arc(s/2,s/2,s/2,0,Math.PI*2);c.fill();});
  return [orb(255,206,84),orb(92,170,255),orb(120,220,200),orb(255,160,120)];
}

/* ------------------------------------------------------------------ ambient field */
interface Particle{x:number;y:number;vx:number;vy:number;size:number;rot:number;spin:number;phase:number;depth:number;sprite:number;pushX:number;pushY:number;alpha:number}
const SCENES:Record<Scene,{sprites:()=>Sprite[];density:number;min:number;max:number;size:[number,number];fall:[number,number];sway:number;spin:number;flip:boolean}>={
  snow:{sprites:snowSprites,density:15000,min:34,max:120,size:[8,22],fall:[22,52],sway:16,spin:.6,flip:false},
  sakura:{sprites:petalSprites,density:24000,min:22,max:64,size:[15,26],fall:[28,56],sway:34,spin:1.4,flip:true},
  leaves:{sprites:leafSprites,density:32000,min:16,max:46,size:[22,36],fall:[34,66],sway:40,spin:1.2,flip:true},
  bokeh:{sprites:bokehSprites,density:28000,min:16,max:48,size:[26,72],fall:[-8,8],sway:18,spin:0,flip:false},
};
const rand=(a:number,b:number)=>a+Math.random()*(b-a);

/**
 * Full-viewport particle layer. Draws on a fixed, pointer-transparent canvas; particles drift away from the pointer and
 * scatter on a tap. The loop stops while the tab is hidden and is never started under reduced motion.
 */
export class AmbientField{
  private ctx:CanvasRenderingContext2D;private particles:Particle[]=[];private sprites:Sprite[];private frame=0;private last=0;private time=0;
  private width=0;private height=0;private dpr=1;private pointer:{x:number;y:number}|null=null;private config;
  private readonly onResize=()=>this.resize();
  private readonly onMove=(e:PointerEvent)=>{this.pointer={x:e.clientX,y:e.clientY};};
  private readonly onLeave=()=>{this.pointer=null;};
  private readonly onDown=(e:PointerEvent)=>this.gust(e.clientX,e.clientY);
  private readonly onVisibility=()=>{if(document.hidden)this.stop();else this.start();};
  constructor(private canvas:HTMLCanvasElement,private scene:Scene){
    const ctx=canvas.getContext('2d');if(!ctx)throw new Error('canvas unavailable');this.ctx=ctx;
    this.config=SCENES[scene];this.sprites=this.config.sprites();
    this.resize();
    window.addEventListener('resize',this.onResize,{passive:true});window.addEventListener('pointermove',this.onMove,{passive:true});
    document.addEventListener('pointerleave',this.onLeave);window.addEventListener('blur',this.onLeave);
    window.addEventListener('pointerdown',this.onDown,{passive:true});document.addEventListener('visibilitychange',this.onVisibility);
    this.start();
  }
  private spawn(initial:boolean):Particle{
    const c=this.config,depth=rand(.45,1);
    return {x:rand(-20,this.width+20),y:initial||c.fall[1]<=8?rand(-20,this.height+20):rand(-60,-20),vx:rand(-6,6),vy:rand(c.fall[0],c.fall[1]),size:rand(c.size[0],c.size[1])*depth,
      rot:rand(0,Math.PI*2),spin:rand(-c.spin,c.spin),phase:rand(0,Math.PI*2),depth,sprite:Math.floor(Math.random()*this.sprites.length),pushX:0,pushY:0,alpha:rand(.55,.95)};
  }
  private resize(){
    this.dpr=Math.min(window.devicePixelRatio||1,window.innerWidth<720?1.5:2);
    this.width=window.innerWidth;this.height=window.innerHeight;
    this.canvas.width=Math.round(this.width*this.dpr);this.canvas.height=Math.round(this.height*this.dpr);
    const c=this.config,target=Math.round(Math.min(c.max,Math.max(c.min,this.width*this.height/c.density)));
    while(this.particles.length<target)this.particles.push(this.spawn(true));
    this.particles.length=target;
  }
  /** A tap pushes nearby particles outward, like a breath of wind. */
  private gust(x:number,y:number){
    for(const p of this.particles){const dx=p.x-x,dy=p.y-y,d=Math.hypot(dx,dy);if(d<200&&d>0.1){const f=(1-d/200)*260;p.pushX+=dx/d*f;p.pushY+=dy/d*f;p.spin+=rand(-2,2)*(1-d/200);}}
  }
  private start(){if(!this.frame&&!document.hidden){this.last=performance.now();this.frame=requestAnimationFrame(this.tick);}}
  private stop(){if(this.frame)cancelAnimationFrame(this.frame);this.frame=0;}
  private tick=(now:number)=>{
    const dt=Math.min(.05,(now-this.last)/1000);this.last=now;this.time+=dt;
    const {ctx,width:w,height:h,config:c}=this,wind=Math.sin(this.time*.23)*10+Math.sin(this.time*.071)*6,bokeh=this.scene==='bokeh';
    ctx.setTransform(1,0,0,1,0,0);ctx.clearRect(0,0,this.canvas.width,this.canvas.height);
    for(const p of this.particles){
      // Pointer avoidance: a soft radial push that eases back once the pointer moves on.
      if(this.pointer){const dx=p.x-this.pointer.x,dy=p.y-this.pointer.y,d2=dx*dx+dy*dy;if(d2<12100&&d2>1){const d=Math.sqrt(d2),f=(1-d/110)*90*dt*10;p.pushX+=dx/d*f;p.pushY+=dy/d*f;}}
      p.pushX*=Math.pow(.06,dt);p.pushY*=Math.pow(.06,dt);
      p.phase+=dt*(bokeh?.6:1.3);
      p.x+=(p.vx+wind*p.depth+Math.sin(p.phase)*c.sway*.6+p.pushX)*dt;
      p.y+=(p.vy*p.depth+(bokeh?Math.cos(p.phase*.7)*6:0)+p.pushY)*dt;
      p.rot+=p.spin*dt;
      if(bokeh){if(p.x<-60)p.x=w+50;if(p.x>w+60)p.x=-50;if(p.y<-60)p.y=h+50;if(p.y>h+60)p.y=-50;}
      else if(p.y>h+40||p.x<-80||p.x>w+80){Object.assign(p,this.spawn(false));if(p.x<-20||p.x>w+20)p.x=rand(0,w);}
      const s=p.size,flip=c.flip?Math.cos(p.phase*1.1):1,alpha=bokeh?p.alpha*(.45+.4*Math.sin(p.phase*1.7)):p.alpha*(.55+.45*p.depth);
      const cos=Math.cos(p.rot)*this.dpr,sin=Math.sin(p.rot)*this.dpr;
      ctx.globalAlpha=Math.max(0,Math.min(1,alpha));
      ctx.setTransform(cos,sin,-sin*flip,cos*flip,p.x*this.dpr,p.y*this.dpr);
      ctx.drawImage(this.sprites[p.sprite],-s/2,-s/2,s,s);
    }
    this.frame=requestAnimationFrame(this.tick);
  };
  destroy(){
    this.stop();
    window.removeEventListener('resize',this.onResize);window.removeEventListener('pointermove',this.onMove);document.removeEventListener('pointerleave',this.onLeave);
    window.removeEventListener('blur',this.onLeave);window.removeEventListener('pointerdown',this.onDown);document.removeEventListener('visibilitychange',this.onVisibility);
    this.ctx.setTransform(1,0,0,1,0,0);this.ctx.clearRect(0,0,this.canvas.width,this.canvas.height);
  }
}

/* ------------------------------------------------------------------ confetti */
const CONFETTI_COLORS=['#1568e9','#2fb5ff','#ffc53d','#ff7a59','#28c08f','#a77bff','#ff5d8f'];
/**
 * One celebratory burst on a temporary overlay canvas that removes itself. `origin` is in viewport pixels; by default
 * the burst comes from the upper middle of the screen. Does nothing under reduced motion.
 */
export function celebrate({origin,count}:{origin?:{x:number;y:number};count?:number}={}){
  if(typeof document==='undefined'||prefersReducedMotion())return;
  const canvas=document.createElement('canvas');canvas.className='confetti-layer';canvas.setAttribute('aria-hidden','true');
  const ctx=canvas.getContext('2d');if(!ctx)return;
  const dpr=Math.min(window.devicePixelRatio||1,2),w=window.innerWidth,h=window.innerHeight;canvas.width=w*dpr;canvas.height=h*dpr;document.body.appendChild(canvas);
  const o=origin??{x:w/2,y:h*.32},n=count??(w<720?70:120);
  const bits=Array.from({length:n},()=>{const angle=rand(-Math.PI*.92,-Math.PI*.08),speed=rand(380,860);
    return {x:o.x,y:o.y,vx:Math.cos(angle)*speed,vy:Math.sin(angle)*speed,w:rand(6,11),h:rand(9,16),rot:rand(0,Math.PI*2),spin:rand(-10,10),tilt:rand(0,Math.PI*2),color:CONFETTI_COLORS[Math.floor(Math.random()*CONFETTI_COLORS.length)],round:Math.random()<.28};});
  const total=2600,begin=performance.now();let last=begin;
  const step=(now:number)=>{
    const dt=Math.min(.04,(now-last)/1000),t=now-begin;last=now;
    ctx.setTransform(1,0,0,1,0,0);ctx.clearRect(0,0,canvas.width,canvas.height);
    const fade=t>total*.65?1-(t-total*.65)/(total*.35):1;
    for(const b of bits){
      b.vy+=980*dt;b.vx*=Math.pow(.35,dt);b.vy*=Math.pow(.55,dt);b.x+=b.vx*dt;b.y+=b.vy*dt;b.rot+=b.spin*dt;b.tilt+=dt*8;
      const cos=Math.cos(b.rot)*dpr,sin=Math.sin(b.rot)*dpr,flip=Math.cos(b.tilt);
      ctx.globalAlpha=Math.max(0,fade);ctx.fillStyle=b.color;ctx.setTransform(cos,sin,-sin*flip,cos*flip,b.x*dpr,b.y*dpr);
      if(b.round){ctx.beginPath();ctx.arc(0,0,b.w/2,0,Math.PI*2);ctx.fill();}else ctx.fillRect(-b.w/2,-b.h/2,b.w,b.h);
    }
    if(t<total)requestAnimationFrame(step);else canvas.remove();
  };
  requestAnimationFrame(step);
  setTimeout(()=>canvas.remove(),total+800); // safety net if frames are throttled
}
/** Burst centred on an element (e.g. the button that was just pressed). */
export function celebrateFrom(el:Element|null|undefined,count?:number){
  if(!el){celebrate({count});return;}
  const box=el.getBoundingClientRect();celebrate({origin:{x:box.left+box.width/2,y:box.top+box.height/2},count});
}

/* ------------------------------------------------------------------ toasts */
export type ToastKind='info'|'success'|'warn';
export interface Toast{id:number;text:string;kind:ToastKind;detail?:string}
let toasts:Toast[]=[];let nextToast=1;
const toastListeners=new Set<()=>void>();
const emitToasts=()=>toastListeners.forEach(l=>l());
export function dismissToast(id:number){toasts=toasts.filter(t=>t.id!==id);emitToasts();}
/** Short, non-blocking notice. The latest three stay on screen; each leaves after a few seconds. */
export function toast(text:string,kind:ToastKind='info',detail?:string){
  const id=nextToast++;toasts=[...toasts.slice(-2),{id,text,kind,detail}];emitToasts();
  setTimeout(()=>dismissToast(id),kind==='warn'?6500:4200);
  return id;
}
export function useToasts(){return useSyncExternalStore(l=>{toastListeners.add(l);return()=>toastListeners.delete(l);},()=>toasts,()=>toasts);}

/* ------------------------------------------------------------------ tab title badge */
let baseTitle='';let clearTitle:(()=>void)|null=null;
/** Prefix the tab title with a count (e.g. "(3) 新订单") until the page is visible and focused again. */
export function flagTitle(count:number,label:string){
  if(typeof document==='undefined')return;
  if(!clearTitle)baseTitle=document.title;
  document.title=`(${count}) ${label} · ${baseTitle}`;
  if(clearTitle)return;
  const reset=()=>{if(document.hidden)return;document.title=baseTitle;window.removeEventListener('focus',reset);document.removeEventListener('visibilitychange',reset);clearTitle=null;};
  clearTitle=reset;window.addEventListener('focus',reset);document.addEventListener('visibilitychange',reset);
  if(!document.hidden&&document.hasFocus())setTimeout(reset,6000);
}

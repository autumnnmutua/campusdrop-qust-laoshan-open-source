import {useEffect,useRef,useState} from 'react';
import {Link} from 'react-router-dom';
import {celebrate} from './effects';
import {prefersReducedMotion} from './motion';
import {BounceText} from './bounce-text';
import {getItem,setItem} from './storage';
import {roundRectPath} from './canvas';

/*
 * "接包裹" — a small easter-egg game on the 404 page and /play. Move the trolley with the mouse, a finger, or the
 * arrow keys; catch falling parcels, avoid letting three hit the ground. Purely local: the best score lives in this
 * browser only. Nothing here touches the API.
 */
const BEST_KEY='campusdrop:game-best';
const readBest=()=>Number(getItem(BEST_KEY))||0;
type Phase='ready'|'playing'|'over';
interface Drop{x:number;y:number;vy:number;size:number;big:boolean;gold:boolean;rot:number;spin:number}
interface Pop{x:number;y:number;t:number;text:string}

function drawBox(c:CanvasRenderingContext2D,d:Drop){
  c.save();c.translate(d.x,d.y);c.rotate(d.rot);const s=d.size;
  if(d.gold){c.shadowColor='#ffd54a';c.shadowBlur=18;}
  c.fillStyle=d.gold?'#ffcc33':d.big?'#c98a4b':'#d9a066';c.strokeStyle=d.gold?'#b8860b':'#8a5a2b';c.lineWidth=2;
  roundRectPath(c,-s/2,-s/2,s,s,4);c.fill();c.stroke();
  c.fillStyle='#f3d9a6';c.fillRect(-s*.09,-s/2,s*.18,s);
  c.fillStyle='#1568e9';roundRectPath(c,s*.12,s*.1,s*.26,s*.18,2);c.fill();
  c.restore();
}
function drawCart(c:CanvasRenderingContext2D,x:number,y:number,w:number){
  c.save();c.translate(x,y);
  const g=c.createLinearGradient(0,-28,0,0);g.addColorStop(0,'#4094ff');g.addColorStop(1,'#0862ee');
  c.fillStyle=g;roundRectPath(c,-w/2,-26,w,22,7);c.fill();
  c.fillStyle='#ffffffcc';c.font='bold 12px system-ui,sans-serif';c.textAlign='center';c.fillText('CampusDrop',0,-11);
  c.strokeStyle='#17477f';c.lineWidth=3;c.beginPath();c.moveTo(w/2-4,-26);c.lineTo(w/2+8,-40);c.stroke();
  c.fillStyle='#17477f';for(const dx of [-w/2+12,w/2-12]){c.beginPath();c.arc(dx,2,6,0,Math.PI*2);c.fill();}
  c.restore();
}

export function ParcelGame({title='休息一下：接包裹',asPage=false}:{title?:string;asPage?:boolean}){
  const canvas=useRef<HTMLCanvasElement>(null),wrap=useRef<HTMLDivElement>(null);
  const [phase,setPhase]=useState<Phase>('ready'),[score,setScore]=useState(0),[lives,setLives]=useState(3),[combo,setCombo]=useState(0),[best,setBest]=useState(readBest);
  const reduced=prefersReducedMotion();
  const target=useRef<number|null>(null),bestRef=useRef(best);

  useEffect(()=>{
    if(phase!=='playing')return;
    const el=canvas.current,box=wrap.current;if(!el||!box)return;const ctx2d=el.getContext('2d');if(!ctx2d)return;const c:CanvasRenderingContext2D=ctx2d;
    const dpr=Math.min(window.devicePixelRatio||1,2);let W=0,H=0;
    const fit=()=>{W=box.clientWidth;H=Math.round(Math.min(420,Math.max(300,W*.66)));el.width=W*dpr;el.height=H*dpr;el.style.setProperty('height',`${H}px`);};
    fit();
    let streak=0,cartX=W/2,frame=0,last=performance.now(),spawn=0,elapsed=0,pts=0,hp=3;const drops:Drop[]=[],pops:Pop[]=[];const keys={l:false,r:false};
    const cartW=()=>Math.max(78,W*.17);
    const toLocal=(clientX:number)=>clientX-el.getBoundingClientRect().left;
    const move=(e:PointerEvent)=>{target.current=toLocal(e.clientX);};
    const key=(e:KeyboardEvent,down:boolean)=>{if(e.key==='ArrowLeft'||e.key==='a'){keys.l=down;e.preventDefault();}if(e.key==='ArrowRight'||e.key==='d'){keys.r=down;e.preventDefault();}};
    const kd=(e:KeyboardEvent)=>key(e,true),ku=(e:KeyboardEvent)=>key(e,false);
    const vis=()=>{if(document.hidden){cancelAnimationFrame(frame);frame=0;}else if(!frame){last=performance.now();frame=requestAnimationFrame(tick);}};
    el.addEventListener('pointermove',move);el.addEventListener('pointerdown',move);window.addEventListener('keydown',kd);window.addEventListener('keyup',ku);window.addEventListener('resize',fit);document.addEventListener('visibilitychange',vis);
    function tick(now:number){
      const dt=Math.min(.04,(now-last)/1000);last=now;elapsed+=dt;
      const speed=150+elapsed*7,interval=Math.max(.38,1.05-elapsed*.012);
      spawn-=dt;if(spawn<=0){spawn=interval*(0.7+Math.random()*.6);const gold=Math.random()<.06,big=!gold&&Math.random()<.18;drops.push({x:30+Math.random()*(W-60),y:-30,vy:speed*(.85+Math.random()*.3)*(big?.85:gold?1.25:1),size:big?42:30,big,gold,rot:Math.random()*.6-.3,spin:(Math.random()-.5)*2});}
      if(keys.l)target.current=(target.current??cartX)-420*dt;if(keys.r)target.current=(target.current??cartX)+420*dt;
      if(target.current!==null){target.current=Math.max(cartW()/2,Math.min(W-cartW()/2,target.current));cartX+=(target.current-cartX)*Math.min(1,dt*14);}
      const cy=H-14,cw=cartW();
      for(let i=drops.length-1;i>=0;i--){const d=drops[i];d.y+=d.vy*dt;d.rot+=d.spin*dt;
        if(d.y+d.size/2>=cy-26&&d.y<cy&&Math.abs(d.x-cartX)<cw/2+d.size*.3){drops.splice(i,1);streak+=1;const bonus=streak%5===0?1:0,g=(d.gold?5:d.big?2:1)+bonus;pts+=g;setScore(pts);setCombo(streak);pops.push({x:d.x,y:cy-40,t:0,text:bonus?`连击 ${streak}！+${g}`:d.gold?`金色包裹 +${g}`:`+${g}`});continue;}
        if(d.y-d.size/2>H){drops.splice(i,1);hp-=1;streak=0;setCombo(0);setLives(hp);pops.push({x:d.x,y:H-30,t:0,text:'漏了！'});if(hp<=0){finish();return;}}
      }
      c.setTransform(dpr,0,0,dpr,0,0);c.clearRect(0,0,W,H);
      const sky=c.createLinearGradient(0,0,0,H);sky.addColorStop(0,'#eaf4ff');sky.addColorStop(1,'#d6e8ff');c.fillStyle=sky;c.fillRect(0,0,W,H);
      c.fillStyle='#c4dbf7';c.fillRect(0,H-6,W,6);
      for(const d of drops)drawBox(c,d);drawCart(c,cartX,cy,cw);
      for(let i=pops.length-1;i>=0;i--){const p=pops[i];p.t+=dt;if(p.t>.8){pops.splice(i,1);continue;}c.globalAlpha=1-p.t/.8;c.fillStyle=p.text.startsWith('金')?'#b8860b':p.text.startsWith('连')?'#6a43d8':p.text.startsWith('+')?'#0f7a4e':'#e5484d';c.font='bold 16px system-ui,sans-serif';c.textAlign='center';c.fillText(p.text,p.x,p.y-p.t*40);c.globalAlpha=1;}
      frame=requestAnimationFrame(tick);
    }
    function finish(){
      cancelAnimationFrame(frame);frame=0;
      if(pts>bestRef.current){bestRef.current=pts;setBest(pts);setItem(BEST_KEY,String(pts));celebrate({count:80});}
      setPhase('over');
    }
    frame=requestAnimationFrame(tick);
    return ()=>{cancelAnimationFrame(frame);el.removeEventListener('pointermove',move);el.removeEventListener('pointerdown',move);window.removeEventListener('keydown',kd);window.removeEventListener('keyup',ku);window.removeEventListener('resize',fit);document.removeEventListener('visibilitychange',vis);};
  },[phase]);

  function start(){setScore(0);setLives(3);setCombo(0);target.current=null;setPhase('playing');}
  return <div className="parcel-game">
    <div className="game-head">{asPage?<h1>{title}</h1>:<h2>{title}</h2>}<p className="game-stats" aria-live="off"><span>得分 <strong>{score}</strong></span><span aria-label={`剩余机会 ${lives}`}>{'●'.repeat(lives)}<i>{'○'.repeat(3-lives)}</i></span>{combo>=3&&<span className="game-combo">连击 <strong>{combo}</strong></span>}<span>最高 <strong>{best}</strong></span></p></div>
    <div ref={wrap} className={`game-stage phase-${phase}`}>
      <canvas ref={canvas} aria-label="接包裹游戏画面：左右移动小推车接住掉落的包裹" role="img"/>
      {phase!=='playing'&&<div className="game-overlay">
        {phase==='over'?<><p className="game-result" role="status"><BounceText text={score>0&&score>=best?'新纪录！':'游戏结束'}/> 接住 <strong>{score}</strong> 分</p><button type="button" onClick={start}>再来一局</button></>
        :<><p>移动鼠标、拖动手指或按 ← → 键，用小推车接住掉下来的包裹。大箱子 2 分，金色包裹 5 分，每连续接住 5 个再加 1 分；漏接 3 个就结束。</p>{reduced&&<p className="muted">你开启了“减少动态效果”，游戏画面会持续运动，可以按需开始。</p>}<button type="button" onClick={start}>开始游戏</button></>}
      </div>}
    </div>
    <p className="muted game-foot">最高分只保存在这台设备的浏览器里。玩够了？<Link to="/">回到首页 →</Link></p>
  </div>;
}
export function PlayPage(){return <section className="play-page"><p className="eyebrow">CAMPUSDROP · 彩蛋</p><ParcelGame asPage/></section>;}

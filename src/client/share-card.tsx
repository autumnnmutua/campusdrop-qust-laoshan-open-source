import dialogPolyfill from 'dialog-polyfill';
import {useEffect,useId,useRef,useState} from 'react';
import {resolveScene,toast,useAmbientMode,type Scene} from './effects';
import {downloadBlob} from './csv';
import type {Badge,StudentStats} from '../shared/engagement';
import {roundRectPath} from './canvas';

/*
 * "我的配送足迹" share card: a 1080×1350 PNG drawn on a canvas in the browser. It carries counts and badge names only —
 * never the student's name, phone, room or pickup codes — so it is safe to post. The decoration follows the ambient
 * scene the student picked (or the season).
 */
const W=1080,H=1350;
const PALETTE:Record<Scene|'none',{a:string;b:string;ink:string;dot:string[]}>={
  snow:{a:'#dcecff',b:'#f7fbff',ink:'#0d3f86',dot:['#ffffff','#bcd8fb','#9cc3f5']},
  sakura:{a:'#ffe3ec',b:'#fff8fb',ink:'#8a2350',dot:['#f7a8c2','#ffd6e2','#ec7aa1']},
  bokeh:{a:'#fff3d1',b:'#f3fbff',ink:'#7a4b00',dot:['#ffd16a','#8fc6ff','#9be6d4']},
  leaves:{a:'#ffe7cf',b:'#fffaf3',ink:'#8a3b0a',dot:['#ffb347','#e8641b','#d98a1c']},
  none:{a:'#e3efff',b:'#f8fbff',ink:'#0d3f86',dot:['#bcd8fb','#d9e8ff','#9cc3f5']},
};
function seeded(seed:number){return ()=>{seed=(seed*16807)%2147483647;return (seed-1)/2147483646;};}
const FONT='"PingFang SC","Microsoft YaHei","Noto Sans CJK SC",system-ui,sans-serif';

export function drawShareCard(canvas:HTMLCanvasElement,stats:StudentStats,badges:Badge[],scene:Scene|null){
  canvas.width=W;canvas.height=H;const c=canvas.getContext('2d');if(!c)return;
  const p=PALETTE[scene??'none'],rand=seeded(stats.paidOrders*31+stats.completed*7+11);
  const bg=c.createLinearGradient(0,0,W,H);bg.addColorStop(0,p.a);bg.addColorStop(1,p.b);c.fillStyle=bg;c.fillRect(0,0,W,H);
  // decoration: scene-coloured dots and petals in the margins
  for(let i=0;i<70;i++){const x=rand()*W,y=rand()*H,r=4+rand()*18;c.globalAlpha=.25+rand()*.45;c.fillStyle=p.dot[i%p.dot.length];c.beginPath();
    if(scene==='leaves'||scene==='sakura'){c.ellipse(x,y,r,r*.55,rand()*Math.PI,0,Math.PI*2);}else c.arc(x,y,r,0,Math.PI*2);c.fill();}
  c.globalAlpha=1;
  // card
  c.shadowColor='rgba(20,60,120,.18)';c.shadowBlur=60;c.shadowOffsetY=20;c.fillStyle='rgba(255,255,255,.94)';roundRectPath(c,80,150,W-160,H-300,48);c.fill();c.shadowColor='transparent';
  c.fillStyle='#1568e9';roundRectPath(c,140,210,120,120,30);c.fill();
  c.strokeStyle='#fff';c.lineWidth=7;c.lineJoin='round';c.beginPath();c.moveTo(200,236);c.lineTo(236,256);c.lineTo(236,296);c.lineTo(200,316);c.lineTo(164,296);c.lineTo(164,256);c.closePath();c.moveTo(164,256);c.lineTo(200,276);c.lineTo(236,256);c.moveTo(200,276);c.lineTo(200,316);c.stroke();
  c.fillStyle=p.ink;c.font=`800 54px ${FONT}`;c.fillText('我的配送足迹',290,262);
  c.fillStyle='#4b6488';c.font=`500 30px ${FONT}`;c.fillText('青岛科技大学 · 崂山校区 · CampusDrop',290,312);
  // tiles
  const tiles:[string,number,string][]=[['累计下单',stats.paidOrders,'单'],['少跑驿站',stats.completed,'次'],['送到寝室',stats.roomDeliveries,'次'],['大件配送',stats.largeParcels,'件']];
  tiles.forEach(([label,value,unit],i)=>{const x=140+(i%2)*410,y=390+Math.floor(i/2)*230;
    c.fillStyle='#f3f8ff';roundRectPath(c,x,y,390,200,30);c.fill();c.fillStyle='#4b6488';c.font=`600 30px ${FONT}`;c.fillText(label,x+36,y+62);
    c.fillStyle=p.ink;c.font=`800 92px ${FONT}`;c.fillText(String(value),x+34,y+162);const w=c.measureText(String(value)).width;c.fillStyle='#4b6488';c.font=`600 32px ${FONT}`;c.fillText(unit,x+48+w,y+160);});
  // badges
  const earned=badges.filter(b=>b.earned);
  c.fillStyle=p.ink;c.font=`800 38px ${FONT}`;c.fillText(`成就徽章 ${earned.length}/${badges.length}`,140,920);
  let bx=140,by=960;c.font=`700 32px ${FONT}`;
  for(const b of earned.length?earned:[{id:'none',label:'下一枚徽章，等你来拿',hint:'',earned:false} as Badge]){
    const w=c.measureText(b.label).width+(b.earned?96:60);if(bx+w>W-140){bx=140;by+=86;}
    c.fillStyle=b.earned?'#fff4d6':'#eef3fa';roundRectPath(c,bx,by,w,66,33);c.fill();
    if(b.earned){c.fillStyle='#f0a500';c.beginPath();c.arc(bx+40,by+33,18,0,Math.PI*2);c.fill();c.fillStyle='#fff';c.font=`800 22px ${FONT}`;c.textAlign='center';c.fillText('★',bx+40,by+41);c.textAlign='left';c.font=`700 32px ${FONT}`;}
    c.fillStyle=b.earned?'#6a4a00':'#5a6b83';c.fillText(b.label,bx+(b.earned?70:30),by+45);bx+=w+16;
  }
  c.fillStyle='#4b6488';c.font=`500 28px ${FONT}`;
  c.fillText(`生成于 ${new Date().toLocaleDateString('zh-CN',{year:'numeric',month:'long',day:'numeric'})}`,140,H-200);
  c.textAlign='right';c.fillText('让期待，近一点。',W-140,H-200);c.textAlign='left';
  c.fillStyle='rgba(13,63,134,.55)';c.font=`500 24px ${FONT}`;c.textAlign='center';c.fillText('独立校园服务项目 · 非学校或菜鸟官方产品',W/2,H-90);c.textAlign='left';
}

export function ShareCardButton({stats,badges}:{stats:StudentStats;badges:Badge[]}){
  const dialog=useRef<HTMLDialogElement>(null),canvas=useRef<HTMLCanvasElement>(null),titleId=useId();
  const mode=useAmbientMode();const [url,setUrl]=useState(''),[blob,setBlob]=useState<Blob|null>(null);
  useEffect(()=>{const d=dialog.current;if(d&&typeof d.showModal!=='function')dialogPolyfill.registerDialog(d);},[]);
  function open(){
    const cv=canvas.current;if(!cv)return;drawShareCard(cv,stats,badges,resolveScene(mode));
    // Preview as a data: URL — the site's CSP allows data: images but not blob: ones. The Blob is kept for saving/sharing.
    const preview=cv.toDataURL('image/png');
    cv.toBlob(b=>{if(!b){toast('当前浏览器无法生成图片','warn');return;}setBlob(b);setUrl(preview);dialog.current?.showModal();},'image/png');
  }
  const file=()=>blob?new File([blob],'campusdrop-footprint.png',{type:'image/png'}):null;
  const canShare=typeof navigator!=='undefined'&&typeof navigator.canShare==='function';
  async function share(){const f=file();if(!f)return;try{if(navigator.canShare?.({files:[f]})){await navigator.share({files:[f],title:'我的配送足迹'});}else{downloadBlob('campusdrop-footprint.png',f);toast('当前浏览器不支持直接分享，已改为保存图片','info');}}catch(e){if((e as DOMException)?.name!=='AbortError')toast('分享没有完成','warn');}}
  return <><button type="button" className="secondary share-card-button" onClick={open}>生成分享卡片</button><canvas ref={canvas} hidden/>
    <dialog ref={dialog} className="share-dialog" aria-labelledby={titleId}><h2 id={titleId}>我的配送足迹卡片</h2><p className="muted">卡片只包含订单统计和徽章，不含姓名、电话、寝室或取件码。</p>
      {url&&<img src={url} alt="配送足迹分享卡片预览" width={W} height={H}/>}
      <div className="actions"><button type="button" onClick={()=>{const f=file();if(f){downloadBlob('campusdrop-footprint.png',f);toast('图片已保存','success');}}}>保存图片</button>{canShare&&<button type="button" className="secondary" onClick={()=>void share()}>分享</button>}<button type="button" className="secondary" onClick={()=>dialog.current?.close()}>关闭</button></div>
    </dialog></>;
}

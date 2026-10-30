import dialogPolyfill from 'dialog-polyfill';
import { inWeChat } from './wechat';
import {useEffect,useId,useRef,useState} from 'react';
import {resolveScene,toast,useAmbientMode,type Scene} from './effects';
import {downloadBlob} from './csv';
import type {Badge,StudentStats} from '../shared/engagement';
import {roundRectPath} from './canvas';
import {loadChart} from './chart-art';

/*
 * "我的配送足迹" share card: a 1080×1350 PNG drawn on a canvas in the browser. It carries counts and badge names only —
 * never the student's name, phone, room or pickup codes — so it is safe to post. The decoration follows the ambient
 * scene the student picked (or the season).
 */
const W=1080,H=1350;
/** The accent follows the ambient scene the student picked; everything else is the chart sheet. */
const ACCENT:Record<Scene|'none',string>={snow:'#1c5b73',sakura:'#a3245a',bokeh:'#8a5a00',leaves:'#8a5a00',none:'#a3245a'};
const FONT='"PingFang SC","Microsoft YaHei","Noto Sans CJK SC",system-ui,sans-serif';
const SERIF='"Newsreader","Songti SC","STSong","Noto Serif SC","Noto Serif CJK SC","PingFang SC","Microsoft YaHei",serif';
const INK='#0f2833',MUTED='#4d646b',LINE='#b9c9c8';

export async function drawShareCard(canvas:HTMLCanvasElement,stats:StudentStats,badges:Badge[],scene:Scene|null){
  canvas.width=W;canvas.height=H;const c=canvas.getContext('2d');if(!c)return;
  const accent=ACCENT[scene??'none'];
  try{await document.fonts?.load(`450 100px "Newsreader"`);}catch{/* system fonts then */}
  c.fillStyle='#e8edeb';c.fillRect(0,0,W,H);
  try{const chart=await loadChart();const k=.62;c.save();c.translate(W-chart.w*k+160,H-chart.h*k+40);c.scale(k,k);c.lineWidth=1.2/k;c.lineJoin='round';
    c.strokeStyle=LINE;for(const l of chart.contours)c.stroke(new Path2D(l.d));c.strokeStyle=INK;c.lineWidth=2/k;c.stroke(new Path2D(chart.coast));
    c.strokeStyle=accent;c.lineWidth=4/k;c.lineCap='round';c.stroke(new Path2D(chart.route));c.restore();}catch{/* complete without it */}
  c.strokeStyle=INK;c.lineWidth=2;c.strokeRect(36,36,W-72,H-72);c.lineWidth=1;c.strokeRect(48,48,W-96,H-96);
  // the mark: a fix ring with a short route
  c.strokeStyle=INK;c.lineWidth=4;c.beginPath();c.arc(152,186,34,0,Math.PI*2);c.stroke();c.fillStyle=INK;c.beginPath();c.arc(152,186,9,0,Math.PI*2);c.fill();
  c.strokeStyle=accent;c.lineWidth=7;c.lineCap='round';c.beginPath();c.moveTo(96,246);c.bezierCurveTo(110,240,118,228,126,216);c.stroke();
  c.fillStyle=INK;c.font=`600 54px ${SERIF}`;c.fillText('我的配送足迹',220,186);
  c.fillStyle=MUTED;c.font=`500 28px ${FONT}`;c.fillText('青岛科技大学 · 崂山校区 · CampusDrop',222,236);
  const tiles:[string,number,string][]=[['累计下单',stats.paidOrders,'单'],['少跑驿站',stats.completed,'次'],['送到寝室',stats.roomDeliveries,'次'],['大件配送',stats.largeParcels,'件']];
  const top=320,cw=(W-192)/2,ch=200;c.strokeStyle=INK;c.lineWidth=2;c.beginPath();c.moveTo(96,top);c.lineTo(W-96,top);c.stroke();c.strokeStyle=LINE;c.lineWidth=1.5;
  tiles.forEach(([label,value,unit],i)=>{const x=96+(i%2)*cw,y=top+Math.floor(i/2)*ch;
    if(i%2){c.beginPath();c.moveTo(x,y+24);c.lineTo(x,y+ch-24);c.stroke();}
    c.beginPath();c.moveTo(96,y+ch);c.lineTo(W-96,y+ch);c.stroke();
    const ox=x+(i%2?36:0);c.fillStyle=MUTED;c.font=`500 28px ${FONT}`;c.fillText(label,ox,y+62);
    c.fillStyle=INK;c.font=`450 100px ${SERIF}`;c.fillText(String(value),ox-4,y+165);const w=c.measureText(String(value)).width;c.fillStyle=MUTED;c.font=`500 30px ${FONT}`;c.fillText(unit,ox+w+10,y+163);});
  const earned=badges.filter(b=>b.earned);
  c.fillStyle=INK;c.font=`600 36px ${SERIF}`;c.fillText(`成就徽章 ${earned.length}/${badges.length}`,96,top+ch*2+96);
  let bx=96,by=top+ch*2+130;c.font=`600 30px ${FONT}`;
  for(const b of earned.length?earned:[{id:'none',label:'下一枚徽章，等你来拿',hint:'',earned:false} as Badge]){
    const w=c.measureText(b.label).width+(b.earned?84:56);if(bx+w>W-96){bx=96;by+=80;}
    c.strokeStyle=b.earned?INK:LINE;c.lineWidth=2;roundRectPath(c,bx,by,w,60,30);c.stroke();
    if(b.earned){c.fillStyle=accent;c.beginPath();c.arc(bx+34,by+30,9,0,Math.PI*2);c.fill();}
    c.fillStyle=b.earned?INK:MUTED;c.fillText(b.label,bx+(b.earned?56:28),by+41);bx+=w+14;
  }
  c.fillStyle=MUTED;c.font=`500 26px ${FONT}`;
  c.fillText(`生成于 ${new Date().toLocaleDateString('zh-CN',{year:'numeric',month:'long',day:'numeric'})}`,96,H-150);
  c.font=`500 22px ${FONT}`;c.fillText('独立校园服务项目 · 非学校或菜鸟官方产品',96,H-100);
}

export function ShareCardButton({stats,badges}:{stats:StudentStats;badges:Badge[]}){
  const dialog=useRef<HTMLDialogElement>(null),canvas=useRef<HTMLCanvasElement>(null),titleId=useId();
  const mode=useAmbientMode();const [url,setUrl]=useState(''),[blob,setBlob]=useState<Blob|null>(null);
  useEffect(()=>{const d=dialog.current;if(d&&typeof d.showModal!=='function')dialogPolyfill.registerDialog(d);},[]);
  async function open(){
    const cv=canvas.current;if(!cv)return;await drawShareCard(cv,stats,badges,resolveScene(mode));
    // Preview as a data: URL — the site's CSP allows data: images but not blob: ones. The Blob is kept for saving/sharing.
    const preview=cv.toDataURL('image/png');
    cv.toBlob(b=>{if(!b){toast('当前浏览器无法生成图片','warn');return;}setBlob(b);setUrl(preview);dialog.current?.showModal();},'image/png');
  }
  const file=()=>blob?new File([blob],'campusdrop-footprint.png',{type:'image/png'}):null;
  const canShare=typeof navigator!=='undefined'&&typeof navigator.canShare==='function';
  async function share(){const f=file();if(!f)return;try{if(navigator.canShare?.({files:[f]})){await navigator.share({files:[f],title:'我的配送足迹'});}else{downloadBlob('campusdrop-footprint.png',f);toast('当前浏览器不支持直接分享，已改为保存图片','info');}}catch(e){if((e as DOMException)?.name!=='AbortError')toast('分享没有完成','warn');}}
  return <><button type="button" className="secondary share-card-button" onClick={()=>void open()}>生成分享卡片</button><canvas ref={canvas} hidden/>
    <dialog ref={dialog} className="share-dialog" aria-labelledby={titleId}><h2 id={titleId}>我的配送足迹卡片</h2><p className="muted">卡片只包含订单统计和徽章，不含姓名、电话、寝室或取件码。</p>
      {url&&<img src={url} alt="配送足迹分享卡片预览" width={W} height={H}/>}
      {inWeChat&&<p className="wechat-hint" role="note">长按上面的图片，选择「保存图片」或「发送给朋友」。</p>}<div className="actions">{!inWeChat&&<button type="button" onClick={()=>{const f=file();if(f){downloadBlob('campusdrop-footprint.png',f);toast('图片已保存','success');}}}>保存图片</button>}{canShare&&!inWeChat&&<button type="button" className="secondary" onClick={()=>void share()}>分享</button>}<button type="button" className="secondary" onClick={()=>dialog.current?.close()}>关闭</button></div>
    </dialog></>;
}

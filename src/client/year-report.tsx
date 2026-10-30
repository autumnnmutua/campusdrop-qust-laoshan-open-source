import dialogPolyfill from 'dialog-polyfill';
import { inWeChat } from './wechat';
import {useEffect,useId,useRef,useState} from 'react';
import {Link} from 'react-router-dom';
import {toast} from './effects';
import {downloadBlob} from './csv';
import {CountUp,LoadingState} from './components';
import {Notice,useStudentResource} from './student-delivery';
import {SymbolIcon} from './campus-design';
import {locale,t} from './i18n';
import type {YearReport} from '../shared/operations-rules';
import {loadChart} from './chart-art';

/*
 * "我的校园快递年度报告": a student's own year in numbers, from their own orders only, plus a shareable image that
 * carries no name, phone, room or pickup code. The walking distance is a route estimate (station → dorm and back).
 */
const W=1080,H=1500,FONT='"PingFang SC","Microsoft YaHei","Noto Sans CJK SC",system-ui,sans-serif';
const km=(m:number)=>m>=1000?`${(m/1000).toFixed(1)} km`:`${m} m`;

function highlights(r:YearReport):string[]{
  const out:string[]=[];
  if(r.orders)out.push(t('这一年你下了 {n} 单，其中 {c} 单已经顺利完成。',{n:r.orders,c:r.completed}));
  if(r.meters)out.push(t('配送员替你往返跑了约 {d}（按校园道路估算）。',{d:km(r.meters)}));
  if(r.busiestSlot)out.push(t('你最常预约「{slot}」时段送达。',{slot:t(r.busiestSlot)}));
  else if(r.busiestHour!==null)out.push(t('你最常在 {h}:00–{h1}:00 之间下单。',{h:r.busiestHour,h1:r.busiestHour+1}));
  if(r.topCarrier)out.push(t('最常收到的是 {c} 的包裹。',{c:r.topCarrier}));
  if(r.room)out.push(t('{n} 次直接送到了寝室门口。',{n:r.room}));
  if(r.sends)out.push(t('还通过上门取件寄出了 {n} 个包裹。',{n:r.sends}));
  if(r.ratings)out.push(t('你给配送员留下了 {n} 次评价，谢谢你的反馈。',{n:r.ratings}));
  return out;
}

const SERIF='"Newsreader","Songti SC","STSong","Noto Serif SC","Noto Serif CJK SC","PingFang SC","Microsoft YaHei",serif';
const INK='#0f2833',MUTED='#4d646b',LINE='#b9c9c8',ROUTE='#a3245a';
/** The share image is drawn as a chart sheet: fog paper, a neatline, the Laoshan contours and the figures in ink. */
async function draw(canvas:HTMLCanvasElement,r:YearReport){
  canvas.width=W;canvas.height=H;const c=canvas.getContext('2d');if(!c)return;
  try{await Promise.all([document.fonts?.load(`450 120px "Newsreader"`),document.fonts?.load(`italic 450 60px "Newsreader"`)]);}catch{/* system fonts then */}
  c.fillStyle='#e8edeb';c.fillRect(0,0,W,H);
  try{const chart=await loadChart();const k=H*.42/chart.h*1.25;c.save();c.translate(W-chart.w*k+120,-60);c.scale(k,k);c.lineWidth=1.2/k;c.lineJoin='round';
    c.strokeStyle=LINE;for(const l of chart.contours)c.stroke(new Path2D(l.d));
    c.setLineDash([5/k,5/k]);c.strokeStyle='#8fb0b6';for(const l of chart.isobaths)c.stroke(new Path2D(l.d));c.setLineDash([]);
    c.strokeStyle=INK;c.lineWidth=2/k;c.stroke(new Path2D(chart.coast));c.strokeStyle=ROUTE;c.lineWidth=4/k;c.lineCap='round';c.stroke(new Path2D(chart.route));
    c.restore();}catch{/* the sheet is complete without the drawing */}
  c.strokeStyle=INK;c.lineWidth=2;c.strokeRect(36,36,W-72,H-72);c.lineWidth=1;c.strokeRect(48,48,W-96,H-96);
  c.fillStyle=INK;c.font=`italic 450 64px ${SERIF}`;c.fillText('CampusDrop',96,170);
  c.font=`450 168px ${SERIF}`;c.fillText(String(r.year),90,430);
  c.font=`500 56px ${SERIF}`;c.fillText(t('我的校园快递年度报告'),96,520);
  c.fillStyle=MUTED;c.font=`500 28px ${FONT}`;c.fillText(t('青岛科技大学 · 崂山校区 · CampusDrop'),96,575);
  const tiles:[string,string][]=[[t('登记包裹'),String(r.parcels)],[t('配送订单'),String(r.orders)],[t('送到寝室'),String(r.room)],[t('替你跑路'),km(r.meters)]];
  const top=640,cw=(W-192)/2,ch=200;c.strokeStyle=INK;c.lineWidth=2;c.beginPath();c.moveTo(96,top);c.lineTo(W-96,top);c.stroke();
  c.strokeStyle=LINE;c.lineWidth=1.5;
  tiles.forEach(([label,value],i)=>{const x=96+(i%2)*cw,y=top+Math.floor(i/2)*ch;
    if(i%2){c.beginPath();c.moveTo(x,y+24);c.lineTo(x,y+ch-24);c.stroke();}
    c.beginPath();c.moveTo(96,y+ch);c.lineTo(W-96,y+ch);c.stroke();
    c.fillStyle=MUTED;c.font=`500 28px ${FONT}`;c.fillText(label,x+(i%2?36:0),y+62);
    c.fillStyle=INK;c.font=`450 100px ${SERIF}`;c.fillText(value,x+(i%2?32:-4),y+165);});
  let y=top+ch*2+90;c.font=`500 32px ${FONT}`;
  for(const line of highlights(r).slice(0,5)){
    const chunks=line.match(/.{1,25}/gu)??[line];
    c.fillStyle=ROUTE;c.fillRect(96,y-20,10,10);c.fillStyle=INK;
    for(const chunk of chunks){c.fillText(chunk,128,y);y+=48;}
    y+=14;if(y>H-170)break;
  }
  c.fillStyle=MUTED;c.font=`500 22px ${FONT}`;c.textAlign='center';c.fillText(t('数据来自你自己的订单 · 不含姓名、电话、寝室和取件码'),W/2,H-86);c.textAlign='left';
}

export function YearReportPage(){
  const thisYear=new Date().getFullYear();const [year,setYear]=useState(thisYear);
  const r=useStudentResource<{report:YearReport}>(`/me/report?year=${year}`);
  const dialog=useRef<HTMLDialogElement>(null),canvas=useRef<HTMLCanvasElement>(null),titleId=useId();const [url,setUrl]=useState(''),[blob,setBlob]=useState<Blob|null>(null);
  useEffect(()=>{const d=dialog.current;if(d&&typeof d.showModal!=='function')dialogPolyfill.registerDialog(d);},[]);
  const report=r.data?.report;
  async function open(){const cv=canvas.current;if(!cv||!report)return;await draw(cv,report);const preview=cv.toDataURL('image/png');cv.toBlob(b=>{if(!b){toast(t('当前浏览器无法生成图片'),'warn');return;}setBlob(b);setUrl(preview);dialog.current?.showModal();},'image/png');}
  const name=`campusdrop-${year}.png`;
  return <section className="year-report"><Link to="/profile">← {t('我的寝室')}</Link>
    <div className="row"><h1>{t('{year} 年度快递报告',{year})}</h1><div className="range-chips" role="group" aria-label={t('选择年份')}>{[thisYear-1,thisYear].map(y=><button key={y} type="button" className="chip" aria-pressed={y===year} onClick={()=>setYear(y)}>{y}</button>)}</div></div>
    <Notice error={r.error} unauthorized={r.unauthorized}/>{r.loading&&!report&&<LoadingState/>}
    {report&&<>{report.orders===0&&report.parcels===0?<p className="muted">{t('这一年还没有记录，下一件快递从这里开始。')}</p>:<>
      <div className="report-tiles">
        <div><small>{t('登记包裹')}</small><strong><CountUp value={report.parcels} from={0}/></strong></div>
        <div><small>{t('配送订单')}</small><strong><CountUp value={report.orders} from={0}/></strong></div>
        <div><small>{t('送到寝室')}</small><strong><CountUp value={report.room} from={0}/></strong></div>
        <div><small>{t('替你跑路')}</small><strong>{km(report.meters)}</strong></div>
      </div>
      <ul className="report-lines">{highlights(report).map(line=><li key={line}><SymbolIcon name="star"/>{line}</li>)}</ul>
      {report.firstAt&&<p className="muted">{t('第一单')}：{new Date(report.firstAt*1000).toLocaleDateString(locale(),{month:'long',day:'numeric'})}{report.lastAt&&report.lastAt!==report.firstAt?` · ${t('最近一单')}：${new Date(report.lastAt*1000).toLocaleDateString(locale(),{month:'long',day:'numeric'})}`:''}</p>}
      <p className="muted small">{t('“替你跑路”按校园道路从站点到宿舍往返估算，仅统计已完成的订单。')}</p>
      <button type="button" onClick={()=>void open()}><SymbolIcon name="share"/>{t('生成分享图')}</button></>}</>}
    <canvas ref={canvas} hidden/>
    <dialog ref={dialog} className="share-dialog" aria-labelledby={titleId}><h2 id={titleId}>{t('年度报告分享图')}</h2>{url&&<img src={url} alt={t('年度报告分享图预览')} width={W} height={H}/>}
      {inWeChat&&<p className="wechat-hint" role="note">{t('长按上面的图片，选择「保存图片」或「发送给朋友」。')}</p>}<div className="actions">{!inWeChat&&<button type="button" onClick={()=>{if(blob){downloadBlob(name,new File([blob],name,{type:'image/png'}));toast(t('图片已保存'),'success');}}}>{t('保存图片')}</button>}<button type="button" className="secondary" onClick={()=>dialog.current?.close()}>{t('关闭')}</button></div></dialog>
  </section>;
}

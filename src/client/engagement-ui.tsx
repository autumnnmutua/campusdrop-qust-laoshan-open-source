import dialogPolyfill from 'dialog-polyfill';
import {Suspense,lazy,useCallback,useEffect,useId,useMemo,useRef,useState,useSyncExternalStore,type ReactNode} from 'react';
import {Link,useLocation} from 'react-router-dom';
import {api,RequestError} from './api';
import {SymbolIcon} from './campus-design';
import {CountUp} from './components';
import {celebrate,celebrateFrom,toast} from './effects';
import {appendChip,removeChip} from './note-text';
import {imageFiles} from './image-files';
// Loaded on demand: screenshot OCR (only once the SMS panel is opened) and the share card (only on the profile page).
const ScreenshotReader=lazy(()=>import('./screenshot-reader').then(m=>({default:m.ScreenshotReader})));
const ShareCardButton=lazy(()=>import('./share-card').then(m=>({default:m.ShareCardButton})));
import {BounceText} from './bounce-text';
import {priceFen,upgradePriceFen} from '../domain/commerce';
import {CARRIERS} from '../shared/constants';
import type {Parcel,Station} from '../shared/delivery';
import {mergeOcrCodes,ANNOUNCEMENT_LEVEL_LABELS,RATING_TAGS_BAD,RATING_TAGS_GOOD,badgesFor,recognizePickupCodes} from '../shared/engagement-rules';
import type {Announcement,Rating,RecognizedParcel,StudentStats} from '../shared/engagement';
import {getItem,getList as readList,setItem,setList as writeList,storageAvailable} from './storage';

import {yuan} from './format';

/* ================================================================== announcements */
const DISMISSED_KEY='campusdrop:dismissed-announcements';
/** Campus-wide notices from operations. Pause notices cannot be dismissed; failures are silent (the banner is optional). */
export function AnnouncementBanner(){
  const [items,setItems]=useState<Announcement[]>([]),[dismissed,setDismissed]=useState(()=>readList(DISMISSED_KEY));
  // Fetched on first load, then again on navigation or when the tab returns if the last fetch is over 5 minutes old,
  // so a notice published (or taken down) mid-session reaches students without a full reload.
  const {pathname}=useLocation(),last=useRef(0);
  useEffect(()=>{
    let on=true;
    const load=()=>{if(document.hidden||Date.now()-last.current<300000)return;last.current=Date.now();api<{announcements:Announcement[]}>('/announcements').then(r=>{if(on)setItems(r.announcements);}).catch(()=>{last.current=0;});};
    load();document.addEventListener('visibilitychange',load);
    return()=>{on=false;document.removeEventListener('visibilitychange',load);};
  },[pathname]);
  const visible=items.filter(a=>a.level==='PAUSE'||!dismissed.includes(a.id));
  if(!visible.length)return null;
  return <div className="announcements">{visible.map(a=><div key={a.id} className={`announcement level-${a.level.toLowerCase()}`} role={a.level==='PAUSE'?'alert':undefined}>
    <span className="announcement-tag"><BounceText text={ANNOUNCEMENT_LEVEL_LABELS[a.level]}/></span>
    <p><strong>{a.title}</strong>{a.body&&<span>{a.body}</span>}{a.endsAt&&<small>有效至 {new Date(a.endsAt*1000).toLocaleString('zh-CN',{month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'})}</small>}</p>
    {a.level!=='PAUSE'&&<button type="button" className="announcement-close" aria-label={`关闭公告：${a.title}`} onClick={()=>{const next=[...dismissed,a.id];setDismissed(next);writeList(DISMISSED_KEY,next);}}>×</button>}
  </div>)}</div>;
}

/* ================================================================== SMS recognition */
type BulkState={code:string;state:'pending'|'ok'|'error';message?:string};
/**
 * Paste the station's pickup SMS and pull the codes out locally (nothing is uploaded until the student saves). One code
 * fills the form; several can be registered together with the station and size chosen below.
 */
export function SmsRecognizer({stations,stationCode,packageSize,onFill,onStation,onBulkDone}:{stations:(Station&{aliasesJson?:string})[];stationCode:string;packageSize:string;onFill:(p:RecognizedParcel)=>void;onStation:(code:string)=>void;onBulkDone:(created:Parcel[])=>void}){
  const id=useId();const [text,setText]=useState(''),[picked,setPicked]=useState<string[]>([]),[bulk,setBulk]=useState<BulkState[]>([]),[busy,setBusy]=useState(false),[incoming,setIncoming]=useState<File[]>([]),[open,setOpen]=useState(false),[dragging,setDragging]=useState(false);
  // Codes read from a screenshot are appended as a labelled line, so they flow through the same review list as SMS text.
  const addShotCodes=(codes:string[],label:string)=>{setText(t=>`${t}${t&&!t.endsWith('\n')?'\n':''}【${label}】取件码 ${codes.join('、')}\n`.slice(0,2000));setOpen(true);};
  const clearIncoming=useCallback(()=>setIncoming([]),[]);
  const takeFiles=(files:File[])=>{if(files.length){setOpen(true);setIncoming(files);}};
  // Across messages and screenshots, a code that is a strict suffix of another ("7-5-2739" next to "87-5-2739") is
  // almost always an OCR slip that dropped a leading digit, so only the longer one is kept.
  const found=useMemo(()=>{const all=recognizePickupCodes(text);const keep=new Set(mergeOcrCodes([all.map(p=>p.pickupCode)]));return all.filter(p=>keep.has(p.pickupCode)).slice(0,10);},[text]);
  const matchedStation=useMemo(()=>stations.find(s=>[s.canonicalName,...(()=>{try{return JSON.parse(s.aliasesJson??'[]') as string[];}catch{return [];}})()].some(n=>n&&text.includes(n))),[stations,text]);
  useEffect(()=>{setPicked(found.map(f=>f.pickupCode));setBulk([]);},[found]);
  // Apply a station found in the SMS once per newly matched station; a later manual choice is left alone.
  const appliedStation=useRef('');
  useEffect(()=>{if(matchedStation&&appliedStation.current!==matchedStation.code){appliedStation.current=matchedStation.code;onStation(matchedStation.code);}if(!matchedStation)appliedStation.current='';},[matchedStation,onStation]);
  async function registerAll(){
    const list=found.filter(f=>picked.includes(f.pickupCode));if(!list.length||!stationCode)return;
    setBusy(true);setBulk(list.map(f=>({code:f.pickupCode,state:'pending'})));const created:Parcel[]=[];
    for(const f of list){
      try{const r=await api<{parcel:Parcel}>('/parcels','POST',{pickupCode:f.pickupCode,stationCode,packageSize,...(f.carrier&&(CARRIERS as readonly string[]).includes(f.carrier)?{carrier:f.carrier}:{})});created.push(r.parcel);setBulk(b=>b.map(x=>x.code===f.pickupCode?{...x,state:'ok'}:x));}
      catch(e){setBulk(b=>b.map(x=>x.code===f.pickupCode?{...x,state:'error',message:(e as Error).message}:x));}
    }
    setBusy(false);
    if(created.length){toast(`已登记 ${created.length} 件包裹`,'success',created.length<list.length?`${list.length-created.length} 件未成功，请查看下方原因`:'可以回到首页逐件安排配送');if(created.length===list.length)onBulkDone(created);}
  }
  return <details className={`sms-recognizer${dragging?' is-dragging':''}`} open={open||text.length>0||undefined} onToggle={e=>setOpen((e.currentTarget as HTMLDetailsElement).open)}
    onDragOver={e=>{if(Array.from(e.dataTransfer.items).some(i=>i.kind==='file')){e.preventDefault();setDragging(true);}}} onDragLeave={()=>setDragging(false)}
    onDrop={e=>{const files=imageFiles(e.dataTransfer.files);setDragging(false);if(files.length){e.preventDefault();takeFiles(files);}}}>
    <summary><SymbolIcon name="chat"/><span>粘贴短信或上传截图，自动识别取件码<small>识别只在你的手机或电脑上进行，短信和图片都不会上传</small></span></summary>
    <label htmlFor={id} className="sr-only">驿站短信内容</label>
    <textarea id={id} rows={4} maxLength={2000} value={text} onChange={e=>setText(e.target.value)} onPaste={e=>{const files=imageFiles(e.clipboardData.items);if(files.length){e.preventDefault();takeFiles(files);}}} placeholder={'例如：【菜鸟驿站】您的中通包裹已到颐海苑站点，请凭 87-5-2739 取件…\n可以一次粘贴多条短信，也可以直接粘贴截图'}/>
    {(open||text.length>0||incoming.length>0)&&<Suspense fallback={<p className="muted shot-loading">正在准备截图识别…</p>}><ScreenshotReader onCodes={addShotCodes} incoming={incoming} onIncomingHandled={clearIncoming}/></Suspense>}
    {text&&!found.length&&<p className="muted">没有找到形如 87-5-2739 的取件码，请检查短信内容，或直接在下方手动填写。</p>}
    {found.length>0&&<div className="sms-results" aria-live="polite">
      <p><strong>识别到 {found.length} 个取件码</strong>{matchedStation&&<small>已匹配站点：{matchedStation.canonicalName}</small>}</p>
      <ul>{found.map(f=>{const s=bulk.find(b=>b.code===f.pickupCode);return <li key={f.pickupCode} className={s?`is-${s.state}`:undefined}>
        {found.length>1?<label className="check"><input type="checkbox" disabled={busy||!!s} checked={picked.includes(f.pickupCode)} onChange={e=>setPicked(e.target.checked?[...picked,f.pickupCode]:picked.filter(c=>c!==f.pickupCode))}/><span className="pickup-code">{f.pickupCode}</span></label>:<span className="pickup-code">{f.pickupCode}</span>}
        <span className="badge">{f.carrier??'承运商未识别'}</span>
        {s?.state==='ok'&&<span className="sms-state">✓ 已登记</span>}{s?.state==='pending'&&<span className="sms-state">登记中…</span>}{s?.state==='error'&&<span className="sms-state" role="alert">{s.message}</span>}
        {found.length===1&&<button type="button" className="secondary" onClick={()=>{onFill(f);toast('已填入取件码','success',f.carrier?`承运商：${f.carrier}`:undefined);}}>填入表单</button>}
      </li>;})}</ul>
      {found.length>1&&<div className="actions"><button type="button" className={busy?'is-busy':undefined} disabled={busy||!picked.length||!stationCode||bulk.length>0} onClick={()=>void registerAll()}>{busy?'正在登记…':`按下方站点与大小，批量登记 ${picked.length} 件`}</button><button type="button" className="text-button" disabled={busy} onClick={()=>{setText('');setBulk([]);}}>清空</button></div>}
    </div>}
  </details>;
}

/* ================================================================== note chips */
const NOTE_CHIPS=['放门口即可','到了请打电话','易碎请轻放','放楼下快递架','晚上 9 点后在寝'];
const CUSTOM_NOTES_KEY='campusdrop:custom-notes';
/**
 * Built-in quick notes plus up to six of the student's own, saved in this browser only. A custom note is any short
 * phrase from the note box ("宿舍楼下有小黄车" etc.); it can be removed with its × button.
 */
export function NoteChips({value,onChange}:{value:string;onChange:(v:string)=>void}){
  const [custom,setCustom]=useState(()=>readList(CUSTOM_NOTES_KEY).slice(-6));
  const save=(next:string[])=>{setCustom(next);writeList(CUSTOM_NOTES_KEY,next);};
  const candidate=value.trim();
  const canSave=candidate.length>0&&candidate.length<=20&&!/[<>]/.test(candidate)&&![...NOTE_CHIPS,...custom].includes(candidate);
  const chip=(text:string,own:boolean)=>{const on=value.includes(text);return <span key={(own?'c:':'b:')+text} className={own?'chip-wrap own':'chip-wrap'}>
    <button type="button" aria-pressed={on} className="chip" onClick={()=>onChange(on?removeChip(value,text):appendChip(value,text))}>{on?'✓ ':'+ '}{text}</button>
    {own&&<button type="button" className="chip-remove" aria-label={`删除常用备注：${text}`} onClick={()=>{save(custom.filter(c=>c!==text));toast('已删除常用备注','info',text);}}>×</button>}</span>;};
  return <div className="note-chips" role="group" aria-label="常用备注">{NOTE_CHIPS.map(c=>chip(c,false))}{custom.map(c=>chip(c,true))}
    {canSave&&<button type="button" className="chip chip-save" onClick={()=>{save([...custom,candidate].slice(-6));toast('已存为常用备注','success','下次一点即填，只保存在这台设备上');}}>☆ 存为常用</button>}</div>;
}

/* ================================================================== fee calculator */
function Stepper({label,value,onChange}:{label:string;value:number;onChange:(v:number)=>void}){
  return <div className="stepper"><span>{label}</span><div><button type="button" className="secondary" aria-label={`减少${label}`} disabled={value<=0} onClick={()=>onChange(value-1)}>−</button><output aria-live="polite">{value}</output><button type="button" className="secondary" aria-label={`增加${label}`} disabled={value>=9} onClick={()=>onChange(value+1)}>+</button></div></div>;
}
/** Price preview built from the same pricing function the server uses; the order page still shows the server quote. */
export function FeeCalculator(){
  const [small,setSmall]=useState(1),[large,setLarge]=useState(0),[room,setRoom]=useState(false);
  const mode=room?'ROOM':'DOWNSTAIRS';const total=small*priceFen('SMALL',mode)+large*priceFen('LARGE',mode);
  return <div className="fee-calculator"><div className="fee-inputs"><Stepper label="小件" value={small} onChange={setSmall}/><Stepper label="大件" value={large} onChange={setLarge}/>
    <label className="switch"><input type="checkbox" checked={room} onChange={e=>setRoom(e.target.checked)}/><span>送到寝室门口</span></label></div>
    <div className="fee-result"><small>预计费用</small><strong><CountUp value={total} format={yuan}/></strong>
      <ul>{small>0&&<li>小件 × {small} · {yuan(priceFen('SMALL',mode))}/件</li>}{large>0&&<li>大件 × {large} · {yuan(priceFen('LARGE',mode))}/件</li>}{!small&&!large&&<li>加一件包裹试试</li>}</ul>
      {!room&&(small||large)?<p className="muted">下单后仍可升级到寝：小件补 {yuan(upgradePriceFen('SMALL'))}，大件补 {yuan(upgradePriceFen('LARGE'))}。</p>:null}
      <p className="muted">每件包裹单独下单计费，不设打包折扣；实际金额以下单时的服务端报价为准。</p></div></div>;
}

/* ================================================================== FAQ */
const FAQ:[string,string,string][]=[
  ['下单','取件码怎么填写？','可以手动输入，例如 87-5-2739；也可以在“添加快递”页粘贴驿站短信自动识别。识别只在你的浏览器里进行，系统不会读取菜鸟账号或短信。'],
  ['下单','能直接识别截图里的取件码吗？','可以。在“添加快递”页展开“粘贴短信或上传截图”，点“上传截图识别”选择图片，也可以直接粘贴截图或拖进来，一次最多 6 张。识别在你的手机或电脑上完成，图片不会上传；第一次使用需要下载约 7 MB 的识别引擎，之后会缓存。图片识别偶尔会认错或漏掉数字，登记前请对照截图核对；快递公司需要手动选择。'],
  ['下单','一次收到好几件快递怎么办？','在“添加快递”页一次粘贴多条短信，勾选要登记的取件码，按同一个站点和大小批量登记，再回到首页逐件安排配送。'],
  ['下单','费用怎么算？','小件楼下 2 元、到寝 3 元；大件楼下 5 元、到寝 7 元。配送说明页有费用计算器，实际金额以下单时的服务端报价为准。'],
  ['支付','为什么是模拟支付？','当前版本用于测试流程，支付、补款、退款和打赏都不会发生真实资金流转。'],
  ['订单','取消后订单还在？','取消配送会保留订单和退款记录，你可以确认退款信息后再隐藏订单。'],
  ['订单','配送员退单后怎么办？','订单会重新进入接单市场。如果包裹已经取出，必须先完成归还，并由另一位管理员核验。'],
  ['订单','订单状态多久更新一次？','站点支持实时通道时，状态变化会立即推送到页面；否则订单详情页在配送过程中每 20 秒自动刷新一次。状态变化时页面顶部会弹出提示。'],
  ['订单','收货码是什么？','付款后订单页会显示 4 位收货码。配送员送到时请当面告诉 TA，配送员输入核验通过后订单自动签收，不用你再点“确认收货”。请不要提前把收货码发给别人。'],
  ['订单','可以预约送达时间吗？','可以。安排配送时选择今天到后天的午间（11:30–13:00）、傍晚（17:00–19:00）或晚间（20:00–22:00），每个时段有名额上限，开始前 30 分钟截止预约。'],
  ['订单','怎么联系配送员？','配送员接单后，订单详情页会出现“和配送员沟通”，可以发文字或点常用语。聊天只在本订单内可见，订单完成后保留 90 天自动清理。'],
  ['订单','预计送达时间准吗？','预计时间依据近 30 天同楼栋的实际送达用时估算，样本不够时按站点到楼栋的路线距离估算，仅供参考。地图底图是学校官方平面图，配送员位置在未校准时为估算。'],
  ['账号','怎么注销账号？','在“我的寝室”页底部选择“注销账号”。需要先完成或取消所有进行中的订单。注销后姓名、电话、寝室、聊天和消息会被删除，订单只保留匿名记录用于对账。'],
  ['评价','评价会被公开吗？','不会。确认收货后可以给本次配送打 1–5 星，评价只给运营管理员用来改进服务，其他同学看不到。每单只能评价一次。'],
  ['评价','徽章是怎么获得的？','徽章完全根据你的真实订单计算，例如完成第 1 单、累计 5 单、3 次送到寝室等。徽章不设排行，也不能兑换任何东西。'],
  ['订单','包裹到了能提醒我吗？','可以。在“我的寝室”页或配送中的订单页打开“到达提醒”，浏览器询问时选择允许。之后包裹状态变化时，即使切到其他页面也会弹出系统通知（需要这个网页仍然开着）。部分手机浏览器只允许已添加到主屏幕的网页发通知。'],
  ['订单','能开具配送凭证吗？','订单详情页底部有“配送凭证”，可以打印或另存为 PDF。凭证只记录模拟支付，不是发票，也不能用于报销。'],
  ['下单','怎样快速再下一单？','已完成或已取消的订单旁边有“再来一单”，会带上上次的包裹大小和配送方式，你只需要填写新的取件码。'],
  ['账号','怎样切换账号？','点击页面上的“退出登录 / 切换账号”，退出后会回到登录页。'],
  ['体验','页面上飘的雪花 / 樱花能关掉吗？','可以。点击顶部的“氛围”按钮，选择“关闭”或其他季节效果。系统开启“减少动态效果”时，这些动画会自动停止。'],
  ['下单','能保存自己常用的备注吗？','可以。在“添加快递”的备注框里写好一句（20 字以内），点“☆ 存为常用”，下次一点即填；最多保存 6 条，只保存在当前设备的浏览器里，点旁边的 × 可以删除。'],
  ['体验','配送足迹能分享吗？','“我的寝室”页的配送足迹下方有“生成分享卡片”，会生成一张图片，只包含订单数量和徽章，不含姓名、电话、寝室或取件码，可以保存或直接分享。'],
  ['体验','有没有快捷搜索？','电脑上按 Ctrl+K（Mac 按 ⌘K）或点击顶部的“搜索”，可以快速跳转到任意页面，也能直接切换氛围动效。'],
  ['体验','能把网站加到手机桌面吗？','可以。在手机浏览器的菜单里选择“添加到主屏幕”，之后就可以像 App 一样从桌面打开。具体入口因浏览器而异。'],
];
function highlight(text:string,q:string):ReactNode{if(!q)return text;const i=text.toLowerCase().indexOf(q.toLowerCase());if(i<0)return text;return <>{text.slice(0,i)}<mark>{text.slice(i,i+q.length)}</mark>{highlight(text.slice(i+q.length),q)}</>;}
export function FaqSearch(){
  const [q,setQ]=useState(''),[topic,setTopic]=useState('全部');const id=useId();
  const topics=['全部',...new Set(FAQ.map(f=>f[0]))];const query=q.trim();
  const list=FAQ.filter(([t,question,answer])=>(topic==='全部'||t===topic)&&(!query||question.includes(query)||answer.includes(query)));
  return <div className="faq"><label htmlFor={id} className="faq-search"><SymbolIcon name="help"/><input id={id} type="search" value={q} onChange={e=>setQ(e.target.value)} placeholder="搜索问题，例如：短信、退款、评价" autoComplete="off"/></label>
    <div className="faq-topics" role="group" aria-label="问题分类">{topics.map(t=><button key={t} type="button" className="chip" aria-pressed={topic===t} onClick={()=>setTopic(t)}>{t}</button>)}</div>
    <p className="sr-only" aria-live="polite">找到 {list.length} 个问题</p>
    {list.map(([t,question,answer])=><details key={question} open={query.length>0||undefined}><summary><span className="faq-topic">{t}</span>{highlight(question,query)}</summary><p>{highlight(answer,query)}</p></details>)}
    {!list.length&&<p className="muted">没有找到相关问题。可以换个关键词，或者<Link to="/tickets/new">发起售后工单</Link>。</p>}
    <button type="button" className="secondary" onClick={()=>openOnboarding()}>重新查看新手引导</button></div>;
}

/* ================================================================== footprint & badges */
const BADGES_KEY='campusdrop:badges-seen';
export function FootprintPanel(){
  const [stats,setStats]=useState<StudentStats|null>(null);
  useEffect(()=>{let on=true;api<{stats:StudentStats}>('/me/stats').then(r=>{if(on)setStats(r.stats);}).catch(()=>{});return()=>{on=false;};},[]);
  const [fresh,setFresh]=useState<string[]>([]);
  // Celebrate badges this browser has not seen yet (first visit included), once each.
  useEffect(()=>{
    if(!stats)return;const earnedNow=badgesFor(stats).filter(b=>b.earned),seen=readList(BADGES_KEY);
    const unseen=earnedNow.filter(b=>!seen.includes(b.id));if(!unseen.length)return;
    writeList(BADGES_KEY,[...seen,...unseen.map(b=>b.id)]);setFresh(unseen.map(b=>b.id));
    const t=setTimeout(()=>{toast(`解锁新徽章：${unseen.map(b=>b.label).join('、')}`,'success',unseen.length>1?`一次解锁 ${unseen.length} 枚`:unseen[0].hint);celebrate({count:90});},700);
    return()=>clearTimeout(t);
  },[stats]);
  if(!stats)return null;
  const badges=badgesFor(stats),earned=badges.filter(b=>b.earned).length;
  const since=stats.firstOrderAt?Math.max(1,Math.ceil((Date.now()/1000-stats.firstOrderAt)/86400)):0;
  return <section className="footprint" aria-labelledby="footprint-title"><div className="footprint-head"><h2 id="footprint-title">我的配送足迹</h2>{since>0&&<small>第一次下单至今 {since} 天</small>}</div>
    <div className="footprint-tiles">
      <div><small>累计下单</small><strong><CountUp value={stats.paidOrders} from={0}/></strong></div>
      <div><small>少跑驿站</small><strong><CountUp value={stats.completed} from={0}/><em>次</em></strong></div>
      <div><small>送到寝室</small><strong><CountUp value={stats.roomDeliveries} from={0}/><em>次</em></strong></div>
      <div><small>大件配送</small><strong><CountUp value={stats.largeParcels} from={0}/><em>件</em></strong></div>
    </div>
    <div className="badge-head"><h3>成就徽章</h3><small>{earned} / {badges.length}</small></div>
    <ul className="badge-grid">{badges.map((b,i)=><li key={b.id} className={b.earned?(fresh.includes(b.id)?'is-earned is-new':'is-earned'):undefined} data-badge={b.id} data-index={i}><span className="badge-medal" aria-hidden="true">{b.earned?'★':'☆'}</span><strong>{fresh.includes(b.id)?<BounceText text={b.label}/>:b.label}</strong><small>{b.hint}</small><span className="sr-only">{b.earned?'已获得':'未获得'}</span></li>)}</ul>
    {stats.paidOrders>0&&<Suspense fallback={null}><ShareCardButton stats={stats} badges={badges}/></Suspense>}
    {stats.paidOrders===0&&<p className="muted">还没有配送记录。<Link to="/parcel/new">登记第一件快递 →</Link></p>}
  </section>;
}

/* ================================================================== rating */
const STAR_WORDS=['','很不满意','不太满意','一般','满意','非常满意'];
export function RatingPanel({orderId}:{orderId:string}){
  const [state,setState]=useState<{eligible:boolean;rating:Rating|null}|null>(null),[stars,setStars]=useState(0),[hover,setHover]=useState(0),[tags,setTags]=useState<string[]>([]),[comment,setComment]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const submitRef=useRef<HTMLButtonElement>(null);
  useEffect(()=>{let on=true;api<{eligible:boolean;rating:Rating|null}>(`/orders/${orderId}/rating`).then(r=>{if(on)setState(r);}).catch(()=>{});return()=>{on=false;};},[orderId]);
  if(!state?.eligible)return null;
  if(state.rating)return <div className="rating-panel is-done"><h2>你的评价</h2><p className="rating-stars" aria-label={`${state.rating.stars} 星`}>{'★'.repeat(state.rating.stars)}<span aria-hidden="true">{'★'.repeat(5-state.rating.stars)}</span></p>{state.rating.tags.length>0&&<p className="rating-tags">{state.rating.tags.map(t=><span key={t} className="chip">{t}</span>)}</p>}{state.rating.comment&&<blockquote>{state.rating.comment}</blockquote>}<small className="muted">评价仅运营管理员可见，用于改进配送服务。</small></div>;
  const pool=stars>=4?RATING_TAGS_GOOD:stars>0?RATING_TAGS_BAD:[];const shown=hover||stars;
  async function submit(){
    setBusy(true);setError('');
    try{const r=await api<{rating:Rating}>(`/orders/${orderId}/rating`,'POST',{stars,tags:tags.filter(t=>(pool as readonly string[]).includes(t)),comment});setState({eligible:true,rating:r.rating});toast('感谢你的评价','success','你的反馈会帮助配送服务变得更好');if(stars>=4)celebrateFrom(submitRef.current,60);}
    catch(e){setError(e instanceof RequestError&&e.status===503?'评价功能正在升级，请稍后再试。':(e as Error).message);}finally{setBusy(false);}
  }
  return <div className="rating-panel"><h2>为这次配送打个分</h2><p className="muted">评价只给运营管理员看，不会公开。</p>
    <div className="star-picker" role="radiogroup" aria-label="评分" onPointerLeave={()=>setHover(0)}>{[1,2,3,4,5].map(n=><button key={n} type="button" role="radio" aria-checked={stars===n} aria-label={`${n} 星 · ${STAR_WORDS[n]}`} className={n<=shown?'is-lit':undefined} onPointerEnter={()=>setHover(n)} onClick={()=>{setStars(n);setTags([]);}}>★</button>)}<span className="star-word" aria-hidden="true">{STAR_WORDS[shown]}</span></div>
    {pool.length>0&&<div className="note-chips" role="group" aria-label="评价标签">{pool.map(t=>{const on=tags.includes(t);return <button key={t} type="button" className="chip" aria-pressed={on} onClick={()=>setTags(on?tags.filter(x=>x!==t):[...tags,t])}>{t}</button>;})}</div>}
    {stars>0&&<label>想说的话（选填）<textarea maxLength={120} rows={2} value={comment} onChange={e=>setComment(e.target.value)} placeholder={stars>=4?'谢谢配送员～':'哪里可以做得更好？'}/></label>}
    {error&&<p role="alert">{error}</p>}
    <button ref={submitRef} type="button" className={busy?'is-busy':undefined} disabled={!stars||busy} onClick={()=>void submit()}>{busy?'正在提交…':'提交评价'}</button></div>;
}

/* ================================================================== onboarding */
const ONBOARD_KEY='campusdrop:onboarded-v2';
let onboardingOpen=false;const onboardingListeners=new Set<()=>void>();
export function openOnboarding(){onboardingOpen=true;onboardingListeners.forEach(l=>l());}
function closeOnboarding(){onboardingOpen=false;setItem(ONBOARD_KEY,'1');onboardingListeners.forEach(l=>l());}
const STEPS=[
  {icon:'chat',title:'登记包裹',text:'粘贴驿站短信自动识别取件码，或者手动填写。一次收到好几件，也能批量登记。'},
  {icon:'room',title:'选择配送',text:'送到楼下或寝室门口，小件 2 元起。下单前会显示服务端报价，当前均为模拟支付。'},
  {icon:'plane',title:'跟踪与收货',text:'在校园地图上看配送路线和预计送达时间。见到配送员时出示 4 位收货码，核验后自动签收。'},
];
/** Three-step introduction, shown once per browser and reopenable from the FAQ page. */
export function Onboarding({autoOpen}:{autoOpen:boolean}){
  const open=useSyncExternalStore(l=>{onboardingListeners.add(l);return()=>onboardingListeners.delete(l);},()=>onboardingOpen,()=>false);
  const ref=useRef<HTMLDialogElement>(null),[step,setStep]=useState(0),titleId=useId();
  useEffect(()=>{if(!autoOpen)return;// Without storage the guide could not remember being seen and would reopen on every visit, so skip it there.
    const seen=getItem(ONBOARD_KEY)==='1'||!storageAvailable();if(!seen){const t=setTimeout(openOnboarding,900);return()=>clearTimeout(t);}},[autoOpen]);
  useEffect(()=>{const d=ref.current;if(!d)return;if(typeof d.showModal!=='function')dialogPolyfill.registerDialog(d);if(open&&!d.open){setStep(0);d.showModal();}if(!open&&d.open)d.close();},[open]);
  const s=STEPS[step],last=step===STEPS.length-1;
  return <dialog ref={ref} className="onboarding" aria-labelledby={titleId} onClose={()=>{if(onboardingOpen)closeOnboarding();}}>
    <p className="eyebrow">新手引导 · {step+1}/{STEPS.length}</p>
    <div key={step} className="onboarding-step"><span className={`onboarding-icon icon-${s.icon}`} aria-hidden="true"><SymbolIcon name={s.icon}/></span><h2 id={titleId}>{s.title}</h2><p>{s.text}</p></div>
    <ol className="onboarding-dots" aria-hidden="true">{STEPS.map((_,i)=><li key={i} className={i===step?'is-current':i<step?'is-done':undefined}/>)}</ol>
    <div className="actions">{step>0&&<button type="button" className="secondary" onClick={()=>setStep(step-1)}>上一步</button>}<button type="button" onClick={()=>{if(last){closeOnboarding();celebrate({count:70});}else setStep(step+1);}}>{last?'开始使用':'下一步'}</button>{!last&&<button type="button" className="text-button" onClick={closeOnboarding}>跳过</button>}</div>
  </dialog>;
}

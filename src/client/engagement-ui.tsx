import {getLang,locale,t} from './i18n';
import {FAQ_EN} from './faq-en';
import dialogPolyfill from 'dialog-polyfill';
import {Suspense,lazy,useCallback,useEffect,useId,useMemo,useRef,useState,useSyncExternalStore,type ReactNode} from 'react';
import {Link,useLocation} from 'react-router-dom';
import {api,RequestError} from './api';
import {SymbolIcon} from './campus-design';
import {CountUp} from './components';
import {Odometer} from './odometer';
import {celebrate,celebrateFrom,toast} from './effects';
import {appendChip,removeChip} from './note-text';
import {imageFiles} from './image-files';
import {FAQ} from '../shared/knowledge';
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
  const [items,setItems]=useState<Announcement[]>([]),[dismissed,setDismissed]=useState(()=>readList(DISMISSED_KEY)),[pause,setPause]=useState<{paused:boolean;reason:string}|null>(null);
  // Fetched on first load, then again on navigation or when the tab returns if the last fetch is over 5 minutes old,
  // so a notice published (or taken down) mid-session reaches students without a full reload.
  const {pathname}=useLocation(),last=useRef(0);
  useEffect(()=>{
    let on=true;
    const load=()=>{if(document.hidden||Date.now()-last.current<300000)return;last.current=Date.now();api<{announcements:Announcement[];pause?:{paused:boolean;reason:string}}>('/announcements').then(r=>{if(on){setItems(r.announcements);setPause(r.pause??null);}}).catch(()=>{last.current=0;});};
    load();document.addEventListener('visibilitychange',load);
    return()=>{on=false;document.removeEventListener('visibilitychange',load);};
  },[pathname]);
  const visible=items.filter(a=>a.level==='PAUSE'||!dismissed.includes(a.id));
  if(!visible.length&&!pause?.paused)return null;
  return <div className="announcements">{pause?.paused&&<div className="announcement level-pause" role="alert"><span className="announcement-tag">{t('暂停接单')}</span><p><strong>{t('暂时不能新下单和预约')}</strong><span>{pause.reason}</span></p></div>}{visible.map(a=><div key={a.id} className={`announcement level-${a.level.toLowerCase()}`} role={a.level==='PAUSE'?'alert':undefined}>
    <span className="announcement-tag"><BounceText text={t(ANNOUNCEMENT_LEVEL_LABELS[a.level])}/></span>
    <p><strong>{a.title}</strong>{a.body&&<span>{a.body}</span>}{a.endsAt&&<small>有效至 {new Date(a.endsAt*1000).toLocaleString('zh-CN',{month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'})}</small>}</p>
    {a.level!=='PAUSE'&&<button type="button" className="announcement-close" aria-label={t('关闭公告：{0}',{0:a.title})} onClick={()=>{const next=[...dismissed,a.id];setDismissed(next);writeList(DISMISSED_KEY,next);}}>×</button>}
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
    if(created.length){toast(t('已登记 {0} 件包裹',{0:created.length}),'success',created.length<list.length?t('{0} 件未成功，请查看下方原因',{0:list.length-created.length}):t('可以回到首页逐件安排配送'));if(created.length===list.length)onBulkDone(created);}
  }
  return <details className={`sms-recognizer${dragging?' is-dragging':''}`} open={open||text.length>0||undefined} onToggle={e=>setOpen((e.currentTarget as HTMLDetailsElement).open)}
    onDragOver={e=>{if(Array.from(e.dataTransfer.items).some(i=>i.kind==='file')){e.preventDefault();setDragging(true);}}} onDragLeave={()=>setDragging(false)}
    onDrop={e=>{const files=imageFiles(e.dataTransfer.files);setDragging(false);if(files.length){e.preventDefault();takeFiles(files);}}}>
    <summary><SymbolIcon name="chat"/><span>{t('粘贴短信或上传截图，自动识别取件码')}<small>{t('识别默认在你的手机或电脑上进行，短信和图片不会上传（除非你主动选择大模型识别）')}</small></span></summary>
    <label htmlFor={id} className="sr-only">{t('驿站短信内容')}</label>
    <textarea id={id} rows={4} maxLength={2000} value={text} onChange={e=>setText(e.target.value)} onPaste={e=>{const files=imageFiles(e.clipboardData.items);if(files.length){e.preventDefault();takeFiles(files);}}} placeholder={t('例如：【菜鸟驿站】您的中通包裹已到颐海苑站点，请凭 87-5-2739 取件…\n可以一次粘贴多条短信，也可以直接粘贴截图')}/>
    {(open||text.length>0||incoming.length>0)&&<Suspense fallback={<p className="muted shot-loading">{t('正在准备截图识别…')}</p>}><ScreenshotReader onCodes={addShotCodes} incoming={incoming} onIncomingHandled={clearIncoming}/></Suspense>}
    {text&&!found.length&&<p className="muted">{t('没有找到形如 87-5-2739 的取件码，请检查短信内容，或直接在下方手动填写。')}</p>}
    {found.length>0&&<div className="sms-results" aria-live="polite">
      <p><strong>识别到 {found.length} 个取件码</strong>{matchedStation&&<small>已匹配站点：{matchedStation.canonicalName}</small>}</p>
      <ul>{found.map(f=>{const s=bulk.find(b=>b.code===f.pickupCode);return <li key={f.pickupCode} className={s?`is-${s.state}`:undefined}>
        {found.length>1?<label className="check"><input type="checkbox" disabled={busy||!!s} checked={picked.includes(f.pickupCode)} onChange={e=>setPicked(e.target.checked?[...picked,f.pickupCode]:picked.filter(c=>c!==f.pickupCode))}/><span className="pickup-code">{f.pickupCode}</span></label>:<span className="pickup-code">{f.pickupCode}</span>}
        <span className="badge">{f.carrier??t('承运商未识别')}</span>
        {s?.state==='ok'&&<span className="sms-state">{t('✓ 已登记')}</span>}{s?.state==='pending'&&<span className="sms-state">{t('登记中…')}</span>}{s?.state==='error'&&<span className="sms-state" role="alert">{s.message}</span>}
        {found.length===1&&<button type="button" className="secondary" onClick={()=>{onFill(f);toast('已填入取件码','success',f.carrier?t('承运商：{0}',{0:f.carrier}):undefined);}}>{t('填入表单')}</button>}
      </li>;})}</ul>
      {found.length>1&&<div className="actions"><button type="button" className={busy?'is-busy':undefined} disabled={busy||!picked.length||!stationCode||bulk.length>0} onClick={()=>void registerAll()}>{busy?t('正在登记…'):t('按下方站点与大小，批量登记 {0} 件',{0:picked.length})}</button><button type="button" className="text-button" disabled={busy} onClick={()=>{setText('');setBulk([]);}}>{t('清空')}</button></div>}
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
    <button type="button" aria-pressed={on} className="chip" onClick={()=>onChange(on?removeChip(value,text):appendChip(value,text))}>{on?'✓ ':'+ '}{t(text)}</button>
    {own&&<button type="button" className="chip-remove" aria-label={t('删除常用备注：{0}',{0:text})} onClick={()=>{save(custom.filter(c=>c!==text));toast('已删除常用备注','info',text);}}>×</button>}</span>;};
  return <div className="note-chips" role="group" aria-label={t('常用备注')}>{NOTE_CHIPS.map(c=>chip(c,false))}{custom.map(c=>chip(c,true))}
    {canSave&&<button type="button" className="chip chip-save" onClick={()=>{save([...custom,candidate].slice(-6));toast('已存为常用备注','success',t('下次一点即填，只保存在这台设备上'));}}>{t('☆ 存为常用')}</button>}</div>;
}

/* ================================================================== fee calculator */
function Stepper({label,value,onChange}:{label:string;value:number;onChange:(v:number)=>void}){
  return <div className="stepper"><span>{label}</span><div><button type="button" className="secondary" aria-label={t('减少{0}',{0:label})} disabled={value<=0} onClick={()=>onChange(value-1)}>−</button><output aria-live="polite">{value}</output><button type="button" className="secondary" aria-label={t('增加{0}',{0:label})} disabled={value>=9} onClick={()=>onChange(value+1)}>+</button></div></div>;
}
/** Price preview built from the same pricing function the server uses; the order page still shows the server quote. */
export function FeeCalculator(){
  const [small,setSmall]=useState(1),[large,setLarge]=useState(0),[room,setRoom]=useState(false);
  const mode=room?'ROOM':'DOWNSTAIRS';const total=small*priceFen('SMALL',mode)+large*priceFen('LARGE',mode);
  return <div className="fee-calculator"><div className="fee-inputs"><Stepper label={t('小件')} value={small} onChange={setSmall}/><Stepper label={t('大件')} value={large} onChange={setLarge}/>
    <label className="switch"><input type="checkbox" checked={room} onChange={e=>setRoom(e.target.checked)}/><span>{t('送到寝室门口')}</span></label></div>
    <div className="fee-result"><small>{t('预计费用')}</small><strong><Odometer value={total} format={yuan}/></strong>
      <ul>{small>0&&<li>{t('小件 × {0} · {1}/件',{0:small,1:yuan(priceFen('SMALL',mode))})}</li>}{large>0&&<li>{t('大件 × {0} · {1}/件',{0:large,1:yuan(priceFen('LARGE',mode))})}</li>}{!small&&!large&&<li>{t('加一件包裹试试')}</li>}</ul>
      {!room&&(small||large)?<p className="muted">{t('下单后仍可升级到寝：小件补 {0}，大件补 {1}。',{0:yuan(upgradePriceFen('SMALL')),1:yuan(upgradePriceFen('LARGE'))})}</p>:null}
      <p className="muted">{t('每件包裹单独下单计费，不设打包折扣；实际金额以下单时的服务端报价为准。')}</p></div></div>;
}

/* ================================================================== FAQ */
// The FAQ lives in shared/knowledge.ts: the same entries answer the 智能助手 (worker) and this page.
function highlight(text:string,q:string):ReactNode{if(!q)return text;const i=text.toLowerCase().indexOf(q.toLowerCase());if(i<0)return text;return <>{text.slice(0,i)}<mark>{text.slice(i,i+q.length)}</mark>{highlight(text.slice(i+q.length),q)}</>;}
/** The FAQ in the reader's language: English entries from faq-en.ts where they exist (topic stays the Chinese key). */
const faq:[string,string,string][]=FAQ.map(([tp,q,a])=>{const en=getLang()==='en'?FAQ_EN[q]:undefined;return en?[tp,en[0],en[1]]:[tp,q,a];});
export function FaqSearch(){
  const [q,setQ]=useState(''),[topic,setTopic]=useState(t('全部'));const id=useId();
  const topics=[t('全部'),...new Set(FAQ.map(f=>f[0]))];const query=q.trim();
  const list=faq.filter(([tp,question,answer])=>(topic===t('全部')||tp===topic)&&(!query||question.toLowerCase().includes(query.toLowerCase())||answer.toLowerCase().includes(query.toLowerCase())));
  return <div className="faq"><label htmlFor={id} className="faq-search"><SymbolIcon name="help"/><input id={id} type="search" value={q} onChange={e=>setQ(e.target.value)} placeholder={t('搜索问题，例如：短信、退款、评价')} autoComplete="off"/></label>
    <div className="faq-topics" role="group" aria-label={t('问题分类')}>{topics.map(tp=><button key={tp} type="button" className="chip" aria-pressed={topic===tp} onClick={()=>setTopic(tp)}>{t(tp)}</button>)}</div>
    <p className="sr-only" aria-live="polite">找到 {list.length} 个问题</p>
    {list.map(([tp,question,answer])=><details key={question} open={query.length>0||undefined}><summary><span className="faq-topic">{t(tp)}</span>{highlight(question,query)}</summary><p>{highlight(answer,query)}</p></details>)}
    {!list.length&&<p className="muted">{t('没有找到相关问题。可以换个关键词，或者')}<Link to="/tickets/new">{t('发起售后工单')}</Link>。</p>}
    <button type="button" className="secondary" onClick={()=>openOnboarding()}>{t('重新查看新手引导')}</button></div>;
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
    const timer=setTimeout(()=>{toast(t('解锁新徽章：{0}',{0:unseen.map(b=>t(b.label)).join(locale()==='en-GB'?', ':'、')}),'success',unseen.length>1?t('一次解锁 {0} 枚',{0:unseen.length}):t(unseen[0].hint));celebrate({count:90});},700);
    return()=>clearTimeout(timer);
  },[stats]);
  if(!stats)return null;
  const badges=badgesFor(stats),earned=badges.filter(b=>b.earned).length;
  const since=stats.firstOrderAt?Math.max(1,Math.ceil((Date.now()/1000-stats.firstOrderAt)/86400)):0;
  return <section className="footprint" aria-labelledby="footprint-title"><div className="footprint-head"><h2 id="footprint-title">{t('我的配送足迹')}</h2>{since>0&&<small>{t('第一次下单至今 {0} 天',{0:since})}</small>}</div>
    <div className="footprint-tiles">
      <div><small>{t('累计下单')}</small><strong><CountUp value={stats.paidOrders} from={0}/></strong></div>
      <div><small>{t('少跑驿站')}</small><strong><CountUp value={stats.completed} from={0}/><em>{t('次')}</em></strong></div>
      <div><small>{t('送到寝室')}</small><strong><CountUp value={stats.roomDeliveries} from={0}/><em>{t('次')}</em></strong></div>
      <div><small>{t('大件配送')}</small><strong><CountUp value={stats.largeParcels} from={0}/><em>{t('件')}</em></strong></div>
    </div>
    <div className="badge-head"><h3>{t('成就徽章')}</h3><small>{earned} / {badges.length}</small></div>
    <ul className="badge-grid">{badges.map((b,i)=><li key={b.id} className={b.earned?(fresh.includes(b.id)?'is-earned is-new':'is-earned'):undefined} data-badge={b.id} data-index={i}><span className="badge-medal" aria-hidden="true">{b.earned?'★':'☆'}</span><strong>{fresh.includes(b.id)?<BounceText text={t(b.label)}/>:t(b.label)}</strong><small>{t(b.hint)}</small><span className="sr-only">{b.earned?t('已获得'):t('未获得')}</span></li>)}</ul>
    {stats.paidOrders>0&&<Suspense fallback={null}><ShareCardButton stats={stats} badges={badges}/></Suspense>}
    {stats.paidOrders===0&&<p className="muted">{t('还没有配送记录。')}<Link to="/parcel/new">{t('登记第一件快递 →')}</Link></p>}
  </section>;
}

/* ================================================================== rating */
const STAR_WORDS=['',t('很不满意'),t('不太满意'),t('一般'),t('满意'),t('非常满意')];
export function RatingPanel({orderId}:{orderId:string}){
  const [state,setState]=useState<{eligible:boolean;rating:Rating|null}|null>(null),[stars,setStars]=useState(0),[hover,setHover]=useState(0),[tags,setTags]=useState<string[]>([]),[comment,setComment]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const submitRef=useRef<HTMLButtonElement>(null);
  useEffect(()=>{let on=true;api<{eligible:boolean;rating:Rating|null}>(`/orders/${orderId}/rating`).then(r=>{if(on)setState(r);}).catch(()=>{});return()=>{on=false;};},[orderId]);
  if(!state?.eligible)return null;
  if(state.rating)return <div className="rating-panel is-done"><h2>{t('你的评价')}</h2><p className="rating-stars" aria-label={t('{0} 星',{0:state.rating.stars})}>{'★'.repeat(state.rating.stars)}<span aria-hidden="true">{'★'.repeat(5-state.rating.stars)}</span></p>{state.rating.tags.length>0&&<p className="rating-tags">{state.rating.tags.map(t=><span key={t} className="chip">{t}</span>)}</p>}{state.rating.comment&&<blockquote>{state.rating.comment}</blockquote>}<small className="muted">{t('评价仅运营管理员可见，用于改进配送服务。')}</small></div>;
  const pool=stars>=4?RATING_TAGS_GOOD:stars>0?RATING_TAGS_BAD:[];const shown=hover||stars;
  async function submit(){
    setBusy(true);setError('');
    try{const r=await api<{rating:Rating}>(`/orders/${orderId}/rating`,'POST',{stars,tags:tags.filter(t=>(pool as readonly string[]).includes(t)),comment});setState({eligible:true,rating:r.rating});toast('感谢你的评价','success',t('你的反馈会帮助配送服务变得更好'));if(stars>=4)celebrateFrom(submitRef.current,60);}
    catch(e){setError(e instanceof RequestError&&e.status===503?t('评价功能正在升级，请稍后再试。'):(e as Error).message);}finally{setBusy(false);}
  }
  return <div className="rating-panel"><h2>{t('为这次配送打个分')}</h2><p className="muted">{t('评价只给运营管理员看，不会公开。')}</p>
    <div className="star-picker" role="radiogroup" aria-label={t('评分')} onPointerLeave={()=>setHover(0)}>{[1,2,3,4,5].map(n=><button key={n} type="button" role="radio" aria-checked={stars===n} aria-label={t('{0} 星 · {1}',{0:n,1:STAR_WORDS[n]})} className={n<=shown?'is-lit':undefined} onPointerEnter={()=>setHover(n)} onClick={()=>{setStars(n);setTags([]);}}>★</button>)}<span className="star-word" aria-hidden="true">{STAR_WORDS[shown]}</span></div>
    {pool.length>0&&<div className="note-chips" role="group" aria-label={t('评价标签')}>{pool.map(tag=>{const on=tags.includes(tag);return <button key={tag} type="button" className="chip" aria-pressed={on} onClick={()=>setTags(on?tags.filter(x=>x!==tag):[...tags,tag])}>{t(tag)}</button>;})}</div>}
    {stars>0&&<label>{t('想说的话（选填）')}<textarea maxLength={120} rows={2} value={comment} onChange={e=>setComment(e.target.value)} placeholder={stars>=4?t('谢谢配送员～'):t('哪里可以做得更好？')}/></label>}
    {error&&<p role="alert">{error}</p>}
    <button ref={submitRef} type="button" className={busy?'is-busy':undefined} disabled={!stars||busy} onClick={()=>void submit()}>{busy?t('正在提交…'):t('提交评价')}</button></div>;
}

/* ================================================================== onboarding */
const ONBOARD_KEY='campusdrop:onboarded-v2';
let onboardingOpen=false;const onboardingListeners=new Set<()=>void>();
export function openOnboarding(){onboardingOpen=true;onboardingListeners.forEach(l=>l());}
function closeOnboarding(){onboardingOpen=false;setItem(ONBOARD_KEY,'1');onboardingListeners.forEach(l=>l());}
const STEPS=[
  {icon:'chat',title:t('登记包裹'),text:t('粘贴驿站短信自动识别取件码，或者手动填写。一次收到好几件，也能批量登记。')},
  {icon:'room',title:t('选择配送'),text:t('送到楼下或寝室门口，小件 2 元起。下单前会显示服务端报价，当前均为模拟支付。')},
  {icon:'plane',title:t('跟踪与收货'),text:t('在校园地图上看配送路线和预计送达时间。见到配送员时出示 4 位收货码，核验后自动签收。')},
];
/** Three-step introduction, shown once per browser and reopenable from the FAQ page. */
export function Onboarding({autoOpen}:{autoOpen:boolean}){
  const open=useSyncExternalStore(l=>{onboardingListeners.add(l);return()=>onboardingListeners.delete(l);},()=>onboardingOpen,()=>false);
  const ref=useRef<HTMLDialogElement>(null),[step,setStep]=useState(0),titleId=useId();
  useEffect(()=>{if(!autoOpen)return;// Without storage the guide could not remember being seen and would reopen on every visit, so skip it there.
    const seen=getItem(ONBOARD_KEY)==='1'||!storageAvailable();if(seen)return;
    // Wait for the opening sequence to finish (html.intro-open), then give the page a moment before the guide.
    let t=0;const tryOpen=()=>{t=window.setTimeout(()=>{if(document.documentElement.classList.contains('intro-open'))tryOpen();else openOnboarding();},900);};
    tryOpen();return()=>clearTimeout(t);},[autoOpen]);
  useEffect(()=>{const d=ref.current;if(!d)return;if(typeof d.showModal!=='function')dialogPolyfill.registerDialog(d);if(open&&!d.open){setStep(0);d.showModal();}if(!open&&d.open)d.close();},[open]);
  const s=STEPS[step],last=step===STEPS.length-1;
  return <dialog ref={ref} className="onboarding" aria-labelledby={titleId} onClose={()=>{if(onboardingOpen)closeOnboarding();}}>
    <p className="eyebrow">新手引导 · {step+1}/{STEPS.length}</p>
    <div key={step} className="onboarding-step"><span className={`onboarding-icon icon-${s.icon}`} aria-hidden="true"><SymbolIcon name={s.icon}/></span><h2 id={titleId}>{s.title}</h2><p>{s.text}</p></div>
    <ol className="onboarding-dots" aria-hidden="true">{STEPS.map((_,i)=><li key={i} className={i===step?'is-current':i<step?'is-done':undefined}/>)}</ol>
    <div className="actions">{step>0&&<button type="button" className="secondary" onClick={()=>setStep(step-1)}>{t('上一步')}</button>}<button type="button" onClick={()=>{if(last){closeOnboarding();celebrate({count:70});}else setStep(step+1);}}>{last?t('开始使用'):t('下一步')}</button>{!last&&<button type="button" className="text-button" onClick={closeOnboarding}>{t('跳过')}</button>}</div>
  </dialog>;
}

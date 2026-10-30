import {RouteProgress} from './route-progress';
import {dayText,slotText} from './i18n-labels';
import {useEffect,useState,type FormEvent} from 'react';
import {Link,useNavigate,useParams} from 'react-router-dom';
import {api} from './api';
import {celebrate,toast} from './effects';
import {SymbolIcon} from './campus-design';
import {ChoiceSelector,ConfirmAction,EmptyState,LoadingState} from './components';
import {Notice,useStudentResource} from './student-delivery';
import {useLiveEvents} from './live';
import {money} from './format';
import {locale,t} from './i18n';
import {CARRIERS} from '../shared/constants';
import {SEND_STATUS_LABELS,type SendRequest} from '../shared/operations-rules';
import {DELIVERY_SLOTS,type SlotCode} from '../shared/slots';

/*
 * 代寄件 for students: book a window, a courier collects the parcel from the room and hands it in at the station.
 * Paid with the same mock payment as deliveries (no real money); cancellable until the courier has collected it.
 */
type SendList={sends:SendRequest[];load:{date:string;code:SlotCode;n:number}[];capacity:number;prices:{SMALL:number;LARGE:number}};
type Slots={now:number;slots:{date:string;code:SlotCode;open:boolean}[];paused:boolean;pauseReason:string};
const SEND_STEPS=['WAITING_PICKUP','PICKED_UP','DROPPED'] as const;

export function SendPage(){
  const list=useStudentResource<SendList>('/sends');const navigate=useNavigate();
  const [slots,setSlots]=useState<Slots|null>(null),[size,setSize]=useState('SMALL'),[carrier,setCarrier]=useState(''),[note,setNote]=useState(''),[slot,setSlot]=useState(''),[busy,setBusy]=useState(false),[message,setMessage]=useState('');
  useEffect(()=>{let on=true;api<Slots>('/slots').then(r=>{if(on)setSlots(r);}).catch(()=>{});return()=>{on=false;};},[]);
  useLiveEvents(event=>{if(event.type==='send')void list.revalidate().catch(()=>{});});
  const price=list.data?.prices[size as 'SMALL'|'LARGE']??null;
  // A window is bookable for sending when it is still open for orders and has send capacity left.
  const windows=(slots?.slots??[]).filter(s=>s.open).map(s=>({...s,used:list.data?.load.find(l=>l.date===s.date&&l.code===s.code)?.n??0})).filter(s=>s.used<(list.data?.capacity??20));
  async function submit(e:FormEvent){
    e.preventDefault();setMessage('');
    const [date,code]=slot.split(':');
    if(!carrier||!date){setMessage(t('请选择快递公司和上门时段'));return;}
    setBusy(true);
    try{const r=await api<{send:SendRequest;message:string}>('/sends','POST',{packageSize:size,carrier,note:note.trim(),slotDate:date,slotCode:code,confirmed:true});toast(t('寄件已预约'),'success',t('已模拟支付，未发生真实扣款'));celebrate({count:40});navigate(`/send/${r.send.id}`);}
    catch(err){setMessage((err as Error).message);}finally{setBusy(false);}
  }
  const active=(list.data?.sends??[]).filter(s=>s.status==='WAITING_PICKUP'||s.status==='PICKED_UP'),past=(list.data?.sends??[]).filter(s=>s.status==='DROPPED'||s.status==='CANCELLED');
  return <section className="send-page"><h1>{t('上门取件 · 帮你寄出')}</h1>
    <p className="muted">{t('约好时段，配送员到寝室取走要寄的包裹，交到站点寄出。请先在快递 App 下好寄件单，把面单码或订单号写在备注里。')}</p>
    <Notice error={list.error} unauthorized={list.unauthorized}/>{list.loading&&!list.data&&<LoadingState/>}
    {slots?.paused&&<p className="pause-note" role="alert"><SymbolIcon name="pause"/>{t('暂停接单中')}: {slots.pauseReason}</p>}
    {list.data&&<>
      {active.length>0&&<><h2>{t('进行中')}</h2><div className="card-list">{active.map(s=><SendCard key={s.id} send={s}/>)}</div></>}
      <h2>{t('预约寄件')}</h2>
      <form className="send-form" onSubmit={submit}>
        <ChoiceSelector label={t('包裹大小')} value={size} onChange={setSize} options={[{value:'SMALL',label:t('小件'),icon:'box',hint:money(list.data.prices.SMALL)},{value:'LARGE',label:t('大件'),icon:'box',hint:money(list.data.prices.LARGE)}]}/>
        <label htmlFor="send-carrier">{t('寄件快递公司')}</label><select id="send-carrier" required value={carrier} onChange={e=>setCarrier(e.target.value)}><option value="">{t('请选择')}</option>{CARRIERS.map(c=><option key={c} value={c}>{c}</option>)}</select>
        <label htmlFor="send-slot">{t('上门时段')}</label><select id="send-slot" required value={slot} onChange={e=>setSlot(e.target.value)}><option value="">{windows.length?t('请选择'):t('暂无可预约时段')}</option>{slots&&windows.map(w=>{const def=DELIVERY_SLOTS.find(d=>d.code===w.code)!;return <option key={w.date+w.code} value={`${w.date}:${w.code}`}>{dayText(w.date,slots.now)} {t(def.label)} {def.start}–{def.end}</option>;})}</select>
        <label htmlFor="send-note">{t('备注（选填）')}</label><textarea id="send-note" rows={2} maxLength={120} value={note} onChange={e=>setNote(e.target.value)} placeholder={t('例如：寄件码 1234，纸箱已封好')}/>
        <div className="price-summary"><span>{t('上门取件费用')}<small>{t('模拟支付，未发生真实扣款')}</small></span><strong className="price">{price===null?'—':money(price)}</strong></div>
        {message&&<p role="alert">{message}</p>}
        <button className={busy?'is-busy':undefined} disabled={busy||!!slots?.paused}><SymbolIcon name="send"/>{busy?t('正在提交…'):t('预约并模拟支付')}</button>
      </form>
      {past.length>0&&<><h2>{t('历史寄件')}</h2><div className="card-list">{past.map(s=><SendCard key={s.id} send={s}/>)}</div></>}
      {!list.data.sends.length&&<EmptyState title={t('还没有寄件记录')} icon="send"><p>{t('需要寄快递时，在这里约个时间就好。')}</p></EmptyState>}
    </>}
  </section>;
}
function SendCard({send:s}:{send:SendRequest}){
  return <article className="parcel-card send-card"><div className="row"><span className="badge" data-status={s.status==='DROPPED'?'COMPLETED':s.status==='CANCELLED'?'CANCELLED':'WAITING_PICKUP'}>{t(SEND_STATUS_LABELS[s.status])}</span><strong>{money(s.amountFen)}</strong></div>
    <p>{s.carrier} · {s.packageSize==='SMALL'?t('小件'):t('大件')} · {slotText(s.slotDate,s.slotCode,Math.floor(Date.now()/1000))}</p><Link to={`/send/${s.id}`}>{t('查看详情')} ›</Link></article>;
}

export function SendDetail(){
  const {id}=useParams();const r=useStudentResource<{send:SendRequest}>(`/sends/${id}`);const [busy,setBusy]=useState(false),[message,setMessage]=useState('');
  useLiveEvents(event=>{if(event.type==='send'&&(!event.id||event.id===id))void r.revalidate().catch(()=>{});});
  const s=r.data?.send;
  async function cancel(){setBusy(true);try{const res=await api<{message:string}>(`/sends/${id}/cancel`,'POST',{version:s!.version,confirmed:true});setMessage(res.message);await r.refresh();}catch(e){setMessage((e as Error).message);}finally{setBusy(false);}}
  const step=s?SEND_STEPS.indexOf(s.status as typeof SEND_STEPS[number]):-1;
  return <section className="send-page"><Link to="/send">← {t('代寄件')}</Link><h1>{t('寄件进度')}</h1><Notice error={r.error} unauthorized={r.unauthorized}/>{r.loading&&!s&&<LoadingState/>}
    {s&&<>
      <div className="status-line"><span className="badge" data-status={s.status==='DROPPED'?'COMPLETED':s.status==='CANCELLED'?'CANCELLED':'WAITING_PICKUP'}>{t(SEND_STATUS_LABELS[s.status])}</span></div>
      {s.status!=='CANCELLED'&&<RouteProgress steps={SEND_STEPS.map(k=>t(SEND_STATUS_LABELS[k]))} current={step} done={s.status==='DROPPED'} label={`${t('寄件阶段')}：${t(SEND_STATUS_LABELS[SEND_STEPS[step]])}`}/>}
      <dl className="order-facts">
        <div><dt><SymbolIcon name="room"/>{t('上门地址')}</dt><dd>{s.buildingName} · {s.roomNo}</dd></div>
        <div><dt><SymbolIcon name="calendar"/>{t('上门时段')}</dt><dd>{slotText(s.slotDate,s.slotCode,Math.floor(Date.now()/1000))}</dd></div>
        <div><dt><SymbolIcon name="box"/>{t('包裹')}</dt><dd>{s.carrier} · {s.packageSize==='SMALL'?t('小件'):t('大件')}</dd></div>
        <div><dt><SymbolIcon name="home"/>{t('交寄站点')}</dt><dd>{s.stationName}</dd></div>
        {s.trackingNo&&<div><dt><SymbolIcon name="order"/>{t('运单号')}</dt><dd className="identifier">{s.trackingNo}</dd></div>}
        <div className="wide"><dt><SymbolIcon name="chat"/>{t('备注')}</dt><dd>{s.note||t('暂无备注')}</dd></div>
      </dl>
      <p className="success">{t('已模拟支付')} {money(s.amountFen)}{s.refundedFen?` · ${t('已模拟退款')} ${money(s.refundedFen)}`:''}</p>
      {s.assigneePhone&&s.status!=='DROPPED'&&s.status!=='CANCELLED'&&<p>{t('上门配送员电话')}：<a href={`tel:${s.assigneePhone}`}>{s.assigneePhone}</a></p>}
      {s.cancelReason&&s.status==='CANCELLED'&&<p className="muted">{t('取消原因')}：{s.cancelReason}</p>}
      {s.pickedAt&&<p className="muted">{t('上门取件时间')}：{new Date(s.pickedAt*1000).toLocaleString(locale())}</p>}
      {s.droppedAt&&<p className="muted">{t('交到站点时间')}：{new Date(s.droppedAt*1000).toLocaleString(locale())}</p>}
      {s.status==='WAITING_PICKUP'&&<ConfirmAction label={t('取消寄件')} title={t('确认取消这次寄件？')} busy={busy} onConfirm={cancel}><p>{t('取消后按支付金额模拟退款，未发生真实资金流转。')}</p></ConfirmAction>}
      {message&&<p role="status">{message}</p>}
    </>}
  </section>;
}

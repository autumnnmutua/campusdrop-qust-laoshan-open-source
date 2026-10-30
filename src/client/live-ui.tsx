import {dayText,slotText} from './i18n-labels';
import {getLang,locale,t} from './i18n';
import {SplitFlap} from './split-flap';
import {useCallback,useEffect,useRef,useState,type CSSProperties,type ClipboardEvent,type FormEvent,type KeyboardEvent} from 'react';
import {api} from './api';
import {celebrate,toast} from './effects';
import {useLiveConnected,useLiveEvents} from './live';
import {SymbolIcon} from './campus-design';
import type {ChatMessage} from '../shared/live';
import type {Order} from '../shared/delivery';
import {DELIVERY_SLOTS,type SlotAvailability,type SlotCode} from '../shared/slots';

// ---------------------------------------------------------------- 收货码 (student side)

/** The 4-digit receipt code. Digits flip in one by one; the student can hide it when others are around. */
export function HandoffCodeCard({code,status}:{code:string;status:Order['status']}){
  const [hidden,setHidden]=useState(false);
  const near=status==='OUT_FOR_DELIVERY'||status.startsWith('DELIVERED');
  return <section className={`handoff-code-card${near?' is-near':''}`} aria-labelledby="handoff-code-title">
    <div className="handoff-code-head"><h2 id="handoff-code-title"><SymbolIcon name="bell"/>{t('收货码')}</h2><button type="button" className="text-button" onClick={()=>setHidden(h=>!h)}>{hidden?t('显示'):t('隐藏')}</button></div>
    <SplitFlap className="handoff-digits" value={hidden?'•'.repeat(code.length):code} label={hidden?t('收货码已隐藏'):t('收货码 {0}',{0:code.split('').join(' ')})}/>
    <p className="muted">{near?t('配送员到达时，把这 4 位数字告诉 TA，核验通过即自动签收。'):t('配送员送达时需要核对这串数字，请不要提前发给任何人。')}</p>
  </section>;
}

// ---------------------------------------------------------------- 收货码 (courier side)

/** Four single-digit boxes; typing advances, Backspace goes back, pasting "1234" fills all four and submits. */
export function CourierCodeEntry({order,refresh}:{order:Order;refresh:()=>Promise<void>}){
  const [digits,setDigits]=useState(['','','','']),[busy,setBusy]=useState(false),[error,setError]=useState(''),[shake,setShake]=useState(0);
  const boxes=useRef<(HTMLInputElement|null)[]>([]);
  useEffect(()=>{setDigits(['','','','']);setError('');},[order.id,order.version]);
  if(!['OUT_FOR_DELIVERY','DELIVERED_DOWNSTAIRS','DELIVERED_TO_ROOM'].includes(order.status)||order.pendingHandoff)return null;
  async function verify(code:string){
    setBusy(true);setError('');
    try{
      await api(`/admin/orders/${order.id}/handoff-code`,'POST',{code,version:order.version});
      toast('收货码核验通过','success',t('订单已自动签收完成'));celebrate({count:50});await refresh();
    }catch(e){setError((e as Error).message);setShake(n=>n+1);setDigits(['','','','']);boxes.current[0]?.focus();}
    finally{setBusy(false);}
  }
  function put(index:number,value:string){
    const next=[...digits];next[index]=value.replace(/\D/g,'').slice(-1);setDigits(next);
    if(next[index]&&index<3)boxes.current[index+1]?.focus();
    if(next.every(Boolean))void verify(next.join(''));
  }
  function key(index:number,e:KeyboardEvent<HTMLInputElement>){if(e.key==='Backspace'&&!digits[index]&&index>0)boxes.current[index-1]?.focus();}
  function paste(e:ClipboardEvent<HTMLInputElement>){
    const code=e.clipboardData.getData('text').replace(/\D/g,'').slice(0,4);if(code.length!==4)return;
    e.preventDefault();setDigits(code.split(''));void verify(code);
  }
  function submit(e:FormEvent){e.preventDefault();if(digits.every(Boolean))void verify(digits.join(''));}
  return <form className="courier-code" onSubmit={submit}>
    <p><strong>{t('当面核验收货码')}</strong><small>{t('请同学出示订单页的 4 位收货码，输入后自动签收，无需对方再点确认。')}</small></p>
    <div key={shake} className={shake?'code-boxes shake':'code-boxes'} role="group" aria-label={t('收货码')}>
      {digits.map((d,i)=><input key={i} ref={el=>{boxes.current[i]=el;}} value={d} inputMode="numeric" autoComplete="one-time-code" maxLength={1} aria-label={t('第 {0} 位',{0:i+1})} disabled={busy} onChange={e=>put(i,e.target.value)} onKeyDown={e=>key(i,e)} onPaste={paste}/>)}
    </div>
    {error&&<p role="alert">{error}</p>}
  </form>;
}

// ---------------------------------------------------------------- 预约配送时段

export interface SlotChoice {date:string;code:SlotCode}
/** "尽快送达" or one bookable window; full and closed windows stay visible but cannot be chosen. */
export function SlotPicker({value,onChange}:{value:SlotChoice|null;onChange:(slot:SlotChoice|null)=>void}){
  const [data,setData]=useState<{now:number;slots:(SlotAvailability&{sameBuilding?:number})[];paused?:boolean;pauseReason?:string}|null>(null),[error,setError]=useState('');
  useEffect(()=>{let current=true;api<{now:number;slots:(SlotAvailability&{sameBuilding?:number})[];paused?:boolean;pauseReason?:string}>('/slots').then(r=>{if(current)setData(r);}).catch(e=>{if(current)setError((e as Error).message);});return()=>{current=false;};},[]);
  const dates=data?[...new Set(data.slots.map(s=>s.date))]:[];
  const [day,setDay]=useState('');
  const shownDay=day||value?.date||dates.find(d=>data!.slots.some(s=>s.date===d&&s.open))||dates[0];
  if(error)return <p className="muted">{t('预约时段暂时无法读取，将按“尽快送达”安排。')}</p>;
  return <fieldset className="slot-picker"><legend>{t('送达时间')}</legend>{data?.paused&&<p className="pause-note" role="alert">{t('暂停接单中')}: {data.pauseReason||t('请稍后再试')}</p>}
    <button type="button" className={`slot-asap${value?'':' selected'}`} aria-pressed={!value} onClick={()=>onChange(null)}><SymbolIcon name="plane"/><span><strong>{t('尽快送达')}</strong><small>{t('配送员接单后立即安排')}</small></span></button>
    {data&&<>
      <div className="slot-days" role="tablist" aria-label={t('预约日期')}>{dates.map(d=><button key={d} type="button" role="tab" aria-selected={d===shownDay} className={d===shownDay?'active':''} onClick={()=>setDay(d)}>{dayText(d,data.now)}<small>{d.slice(5).replace('-','/')}</small></button>)}</div>
      <div className="slot-grid">{DELIVERY_SLOTS.map(slot=>{
        const s=data.slots.find(x=>x.date===shownDay&&x.code===slot.code);if(!s)return null;
        const chosen=value?.date===s.date&&value.code===s.code,left=s.capacity-s.booked,ratio=Math.min(1,s.booked/s.capacity);
        return <button key={slot.code} type="button" className={`slot-card${chosen?' selected':''}`} disabled={!s.open} aria-pressed={chosen} onClick={()=>onChange({date:s.date,code:s.code})}>
          <strong>{t(slot.label)}</strong><span>{slot.start}–{slot.end}</span>
          <i className="slot-meter" style={{'--fill':ratio} as CSSProperties} aria-hidden="true"/>
          <small>{!s.open?(s.capacity===0?t('暂无排班'):left<=0?t('已约满'):data.paused?t('暂停中'):t('已截止')):left<=5?t('仅剩 {0} 个名额',{0:left}):t('剩余 {0}',{0:left})}</small>
          {s.open&&!!s.sameBuilding&&<em className="slot-neighbours">本楼已有 {s.sameBuilding} 单</em>}
        </button>;
      })}</div>
      {value&&<p className="slot-summary" role="status">{getLang()==='en'?<>{t('将在')} <strong>{slotText(value.date,value.code,data.now)}</strong></>:<>将在 <strong>{slotText(value.date,value.code,data.now)}</strong> 送达</>}{(()=>{const n=data.slots.find(x=>x.date===value.date&&x.code===value.code)?.sameBuilding??0;return n?t('，和本楼另外 {0} 单一起配送',{0:n}):'';})()}</p>}
    </>}
  </fieldset>;
}
/** Short label for a booked order, or null when it is "as soon as possible". */
export function orderSlotText(order:Pick<Order,'slotDate'|'slotCode'>){return order.slotDate&&order.slotCode?slotText(order.slotDate,order.slotCode,Math.floor(Date.now()/1000)):null;}

// ---------------------------------------------------------------- 订单聊天

const STUDENT_PHRASES=[t('我在寝室，直接送上来吧'),t('放楼下快递架就好'),t('麻烦快到时打个电话'),t('我晚点下楼取，谢谢')];
const COURIER_PHRASES=[t('已取件，正在路上'),t('我到楼下了'),t('包裹放在楼下快递架'),t('稍等，大约 5 分钟到')];
const clock=(t:number)=>new Date(t*1000).toLocaleTimeString(locale(),{hour:'2-digit',minute:'2-digit',hour12:false});

/** Order thread between the student and the assigned courier. Opens once someone has taken the order. */
export function OrderChat({orderId,admin=false,unread=0,startOpen=false}:{orderId:string;admin?:boolean;unread?:number;startOpen?:boolean}){
  const base=admin?`/admin/orders/${orderId}/chat`:`/orders/${orderId}/chat`;
  const [expanded,setExpanded]=useState(startOpen),[messages,setMessages]=useState<ChatMessage[]>([]),[open,setOpen]=useState(true),[observer,setObserver]=useState(false),[text,setText]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState(''),[badge,setBadge]=useState(unread);
  const list=useRef<HTMLOListElement>(null),live=useLiveConnected();
  useEffect(()=>setBadge(unread),[unread]);
  const load=useCallback(async()=>{try{const r=await api<{messages:ChatMessage[];open:boolean;observer?:boolean}>(base);setMessages(r.messages);setOpen(r.open);setObserver(!!r.observer);setBadge(0);setError('');}catch(e){setError((e as Error).message);}},[base]);
  useEffect(()=>{if(expanded)void load();},[expanded,load]);
  useLiveEvents(event=>{if(event.type!=='chat')return;if(expanded)void load();else setBadge(n=>n+1);},orderId);
  // Without the live socket, an open thread checks for replies every 15 s while visible.
  useEffect(()=>{if(!expanded||live)return;const t=setInterval(()=>{if(!document.hidden)void load();},15000);return()=>clearInterval(t);},[expanded,live,load]);
  useEffect(()=>{const el=list.current;if(el)el.scrollTop=el.scrollHeight;},[messages,expanded]);
  async function send(body:string){
    const clean=body.trim();if(!clean||busy)return;setBusy(true);setError('');
    try{const r=await api<{messages:ChatMessage[];open:boolean}>(base,'POST',{body:clean});setMessages(r.messages);setText('');}
    catch(e){setError((e as Error).message);}finally{setBusy(false);}
  }
  const phrases=admin?COURIER_PHRASES:STUDENT_PHRASES;
  return <section className={`order-chat${expanded?' expanded':''}`}>
    <button type="button" className="order-chat-toggle" aria-expanded={expanded} onClick={()=>setExpanded(v=>!v)}><SymbolIcon name="chat"/><span>{admin?t('和同学沟通'):t('和配送员沟通')}</span>{badge>0&&<span className="unread-dot">{badge>99?'99+':badge}</span>}<b aria-hidden="true">{expanded?t('收起'):t('展开')}</b></button>
    {expanded&&<div className="order-chat-body">
      <ol ref={list} className="chat-list" aria-live="polite">{messages.length===0&&<li className="chat-empty">{open?t('还没有消息，可以先打个招呼。'):observer?t('这单还没有聊天记录。'):t('接单后才能开始聊天。')}</li>}
        {messages.map(m=><li key={m.id} className={m.mine?'mine':'theirs'}><p>{m.body}</p><small>{clock(m.createdAt)}{m.mine&&(m.readAt?t(' · 已读'):t(' · 未读'))}</small></li>)}</ol>
      {open?<>
        <div className="chat-phrases">{phrases.map(p=><button key={p} type="button" disabled={busy} onClick={()=>void send(p)}>{p}</button>)}</div>
        <form className="chat-compose" onSubmit={e=>{e.preventDefault();void send(text);}}><label className="sr-only" htmlFor={`chat-${orderId}`}>{t('消息')}</label><input id={`chat-${orderId}`} maxLength={300} value={text} onChange={e=>setText(e.target.value)} placeholder={t('输入消息，最多 300 字')} autoComplete="off"/><button disabled={busy||!text.trim()}>{t('发送')}</button></form>
      </>:<p className="muted">{observer?t('仅接单的配送员可以回复；你查看消息不会让同学看到“已读”。'):messages.length?t('订单已结束，聊天记录仅保留 90 天。'):''}</p>}
      {error&&<p role="alert">{error}</p>}
    </div>}
  </section>;
}

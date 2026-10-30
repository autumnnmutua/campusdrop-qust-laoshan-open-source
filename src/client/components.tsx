import {locale,t} from './i18n';
import { copyText } from './wechat';
import dialogPolyfill from 'dialog-polyfill';
import 'dialog-polyfill/dist/dialog-polyfill.css';
import {SymbolIcon} from './campus-design';
import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import type { Building } from '../shared/contracts';
import {MOCK_MESSAGE,STATUS_LABELS,pickupCodeRegex} from '../shared/constants';
import type {DeliveryMode,Order,OrderEvent,Parcel} from '../shared/delivery';
import { api } from './api';
import { useCountUp } from './motion';
import { Odometer } from './odometer';
import { toast } from './effects';

import { money } from './format';

/** Replace this component's contents when approved campus imagery is available. */
export function ImagePlaceholder({ label, compact = false }: { label: string; compact?: boolean }) {
  return <div className={`image-placeholder ${compact ? 'compact' : ''}`}><picture><source type="image/webp" srcSet="/images/qust-laoshan-960.webp 960w, /images/qust-laoshan.webp 1672w" sizes="(max-width: 720px) 100vw, 640px"/><img src="/images/qust-laoshan.jpg" alt={t('{0} · 校园主题插画',{0:label})} loading="lazy" decoding="async" width={1672} height={941}/></picture><span>{t('QUST / 校园生活')}</span></div>;
}

export function PickupCodeInput({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const id = useId(), invalid = value.length > 0 && !pickupCodeRegex.test(value.trim());
  return <div><label htmlFor={id}>{t('取件码')}</label><input id={id} value={value} onChange={e => onChange(e.target.value)} placeholder="87-5-2739" required maxLength={20} autoComplete="off" spellCheck={false} aria-invalid={invalid} aria-describedby={`${id}-help`} className="code-input" />
    <small id={`${id}-help`}>{t('第一段 1–3 位数字，第二段 1 位，最后一段 4 位。')}</small>{invalid && <p role="alert">{t('取件码格式不正确，例如 107-2-6382')}</p>}</div>;
}

export function ParcelCard({ parcel: p, busy, onRemove }: { parcel: Parcel; busy: boolean; onRemove: () => void }) {
  return <article className="parcel-card"><div className="row"><strong className="pickup-code">{p.pickupCode}</strong><button type="button" className="copy-code" aria-label={t('复制取件码 {0}',{0:p.pickupCode})} onClick={()=>void copyText(p.pickupCode).then(ok=>ok?toast('取件码已复制','success',p.pickupCode):toast('复制失败，请长按取件码手动复制','warn'))}>{t('复制')}</button><span className="badge">{p.packageSize === 'SMALL' ? t('小件') : t('大件')}</span></div><p>{p.carrier || t('未填写承运商')} · {p.status === 'ACTIVE' ? t('待安排') : p.status === 'CLOSED' ? t('配送完成') : t('已移除')}{p.status === 'ACTIVE' && !p.hasOrder && Date.now() / 1000 - p.createdAt >= 2 * 86400 && <span className="waiting-tag" title={t('登记已超过 2 天，记得取件或安排配送')}>已等 {Math.floor((Date.now() / 1000 - p.createdAt) / 86400)} 天</span>}</p>{p.note && <p className="muted">{p.note}</p>}{p.status === 'ACTIVE' && <div className="actions"><Link to={`/parcel/${p.id}`}>{t('选择配送 →')}</Link><button className="text-button" disabled={busy} onClick={onRemove}>{busy ? t('正在移除…') : t('移除')}</button></div>}</article>;
}

export function DormSelector({ buildings, zone, building, room, onZone, onBuilding, onRoom }: { buildings: Building[]; zone: 'SOUTH' | 'NORTH'; building: string; room: string; onZone: (v: 'SOUTH' | 'NORTH') => void; onBuilding: (v: string) => void; onRoom: (v: string) => void }) {
  const id = useId();
  return <fieldset className="dorm-selector"><legend>{t('配送地址 · 崂山校区')}</legend><label htmlFor={`${id}-zone`}>{t('宿舍区域')}</label><select id={`${id}-zone`} value={zone} onChange={e => { onZone(e.target.value as 'SOUTH' | 'NORTH'); onBuilding(''); }}><option value="SOUTH">{t('南苑')}</option><option value="NORTH">{t('北苑')}</option></select><label htmlFor={`${id}-building`}>{t('宿舍楼')}</label><select id={`${id}-building`} required value={building} onChange={e => onBuilding(e.target.value)}><option value="">{t('请选择宿舍楼')}</option>{buildings.filter(b => b.zone === zone).map(b => <option key={b.code} value={b.code}>{b.displayName}</option>)}</select><label>{t('房间号')}<input required maxLength={32} value={room} onChange={e => onRoom(e.target.value)} placeholder={t('例如 B412')} /></label></fieldset>;
}

export function DeliveryModeSelector({ value, onChange }: { value: DeliveryMode; onChange: (value: DeliveryMode) => void }) {
 return <ChoiceSelector label={t('配送方式')} value={value} onChange={v=>onChange(v as DeliveryMode)} options={[{value:'DOWNSTAIRS',label:t('楼下配送'),icon:'person',hint:t('宿舍楼下')},{value:'ROOM',label:t('送至寝室'),icon:'room',hint:t('已存寝室')}]}/>;
}
/**
 * Card-style single choice. One accessible radio group (arrow keys, Home/End, roving tabindex) replaces the earlier
 * visually hidden <select> + button pair, which screen readers announced twice. `name` submits through a hidden field.
 */
export function ChoiceSelector({label,value,onChange,options,name}:{label:string;value:string;onChange:(v:string)=>void;options:{value:string;label:string;icon:string;hint?:string}[];name?:string}){
 const id=useId(),refs=useRef<(HTMLButtonElement|null)[]>([]);
 const index=Math.max(0,options.findIndex(o=>o.value===value));
 function onKeyDown(event:KeyboardEvent<HTMLDivElement>){
  const step=event.key==='ArrowRight'||event.key==='ArrowDown'?1:event.key==='ArrowLeft'||event.key==='ArrowUp'?-1:0;
  if(!step&&event.key!=='Home'&&event.key!=='End')return;
  event.preventDefault();
  const next=event.key==='Home'?0:event.key==='End'?options.length-1:(index+step+options.length)%options.length;
  onChange(options[next].value);refs.current[next]?.focus();
 }
 return <div className="choice-selector"><span className="choice-label" id={`${id}-label`}>{label}</span>{name&&<input type="hidden" name={name} value={value}/>}
  <div className="choice-options" role="radiogroup" aria-labelledby={`${id}-label`} onKeyDown={onKeyDown}>{options.map((o,i)=>{const checked=value===o.value;return <button key={o.value} ref={el=>{refs.current[i]=el;}} type="button" role="radio" aria-checked={checked} tabIndex={i===index?0:-1} onClick={()=>onChange(o.value)}><SymbolIcon name={o.icon}/><span>{o.label}{o.hint&&<small>{o.hint}</small>}</span><i aria-hidden="true">{checked?'✓':''}</i></button>;})}</div></div>;
}

export function PriceSummary({ amount }: { amount: number | null }) {
  return <div className="price-summary" aria-live="polite"><span>{t('本次配送费用')}<small>{t('以订单确认金额为准')}</small></span><strong key={amount === null ? 'pending' : 'quoted'} className={amount === null ? 'price is-pending' : 'price'}>{amount === null ? t('报价中…') : <Odometer value={amount} format={money}/>}</strong></div>;
}

export function OrderTimeline({ events }: { events: OrderEvent[] }) {
  // Events present at first render are history; only ones arriving later (live refresh) animate in.
  const [initialIds] = useState(() => new Set(events.map(e => e.id)));
  return <ol className="timeline" aria-label={t('配送时间线')}>{events.map((e, index) => <li key={e.id} className={initialIds.has(e.id) ? undefined : 'just-advanced'} aria-current={index === events.length - 1 ? 'step' : undefined}><strong>{t(STATUS_LABELS[e.toStatus])}</strong>{e.detail&&<p>{e.detail}</p>}<time dateTime={new Date(e.createdAt * 1000).toISOString()}>{new Date(e.createdAt * 1000).toLocaleString(locale())}</time></li>)}</ol>;
}

export function MockPaymentDialog({ amount, busy, onPay }: { amount: number; busy: boolean; onPay: () => Promise<void> }) {
  const ref = useRef<HTMLDialogElement>(null), id = useId();
  useEffect(()=>{if(ref.current&&typeof ref.current.showModal!=='function')dialogPolyfill.registerDialog(ref.current);},[]);
  return <><button disabled={busy} onClick={() => ref.current?.showModal()}>模拟支付 {money(amount)}</button><dialog ref={ref} aria-labelledby={id} onCancel={e => { if (busy) e.preventDefault(); }}><p className="eyebrow">{t('支付确认')}</p><h2 id={id}>{t('这是一笔模拟支付')}</h2><p>{MOCK_MESSAGE}</p><PriceSummary amount={amount} /><div className="actions"><button className={busy ? 'is-busy' : undefined} disabled={busy} onClick={() => { void onPay().finally(() => ref.current?.close()); }}>{busy ? t('正在处理…') : t('确认模拟支付')}</button><button className="secondary" disabled={busy} onClick={() => ref.current?.close()}>{t('返回订单')}</button></div></dialog></>;
}

export function TipSheet({ amount, onChange, busy, disabled, onSubmit }: { amount: string; onChange: (v: string) => void; busy: boolean; disabled: boolean; onSubmit: () => void }) {
  const id = useId();
  return <div className="tip-sheet"><p className="muted">{t('一点心意，由你决定。')}</p><div className="tip-options">{[1, 2, 5, 10].map(n => <button key={n} aria-pressed={amount === String(n)} className={amount === String(n) ? '' : 'secondary'} onClick={() => onChange(String(n))} disabled={busy}>{n} 元</button>)}</div><label htmlFor={id}>{t('自定义金额（元）')}</label><input id={id} inputMode="decimal" value={amount} onChange={e => onChange(e.target.value)} disabled={busy} aria-describedby={`${id}-hint`} /><small id={`${id}-hint`}>{t('0.01–100 元；自愿模拟打赏，不影响配送。')}</small><button className={busy ? 'block-button is-busy' : 'block-button'} disabled={disabled || busy} onClick={onSubmit}>{busy ? t('正在处理…') : t('确认模拟打赏')}</button></div>;
}

export function SensitiveValue({ orderId, version }: { orderId: string; version: number }) {
  const [code, setCode] = useState(''), [message, setMessage] = useState(''), [busy, setBusy] = useState(false);
  const generation = useRef(0);
  useEffect(() => { setCode(''); setMessage(''); generation.current++; const hide = () => { if (document.hidden) { generation.current++; setCode(''); } }; document.addEventListener('visibilitychange', hide); return () => { generation.current++; document.removeEventListener('visibilitychange', hide); }; }, [orderId, version]);
  useEffect(() => { if (!code) return; const timer = setTimeout(() => setCode(''), 30000); return () => clearTimeout(timer); }, [code]);
  async function reveal(action: 'VIEW' | 'COPY') {
    const current = generation.current; setBusy(true); setMessage('');
    try { const result = await api<{ pickupCode: string }>(`/admin/orders/${orderId}/pickup-code`, 'POST', { action }); if (generation.current !== current || document.hidden) return; setCode(result.pickupCode); if (action === 'COPY') { if(navigator.clipboard?.writeText){await navigator.clipboard.writeText(result.pickupCode);setMessage(t('已复制取件码'));}else{setMessage(t('当前浏览器不支持自动复制，请长按下方取件码复制'));} } }
    catch (e) { if (generation.current === current) setMessage((e as Error).message); } finally { setBusy(false); }
  }
  return <div className="sensitive-value"><small>{t('取件凭证 · 每次查看和复制均留痕')}</small><div className="actions"><button className="secondary" disabled={busy} onClick={() => void reveal('VIEW')}>{t('查看取件码')}</button><button className="secondary" disabled={busy} onClick={() => void reveal('COPY')}>{t('复制取件码')}</button>{code && <strong className="pickup-code">{code}</strong>}</div>{code && <small>{t('30 秒后自动隐藏，切换页面时隐藏。')}</small>}<span role="status">{message}</span></div>;
}

export function AdminTaskTable({ orders, renderTask }: { orders: Order[]; renderTask: (order: Order) => ReactNode }) {
  return <div className="admin-task-table"><table><caption>{t('当前授权范围的配送任务')}</caption><thead><tr><th scope="col">{t('任务编号')}</th><th scope="col">{t('配送详情与操作')}</th></tr></thead><tbody>{orders.map(o => <tr key={o.id}><th scope="row"><span className="task-number">{o.id.slice(0, 8)}</span></th><td>{renderTask(o)}</td></tr>)}</tbody></table></div>;
}

export function ConfirmAction({label,title,children,busy,onConfirm,canConfirm=true,validationMessage}:{label:string;title:string;children:ReactNode;busy:boolean;onConfirm:()=>Promise<void>;canConfirm?:boolean;validationMessage?:string}){
  const ref=useRef<HTMLDialogElement>(null),id=useId();
  useEffect(()=>{if(ref.current&&typeof ref.current.showModal!=='function')dialogPolyfill.registerDialog(ref.current);},[]);
  return <><button className="secondary" disabled={busy} onClick={()=>ref.current?.showModal()}>{label}</button><dialog ref={ref} aria-labelledby={id} onCancel={e=>{if(busy)e.preventDefault();}}><h2 id={id}>{title}</h2>{children}{!canConfirm&&validationMessage&&<p role="status">{validationMessage}</p>}<div className="actions"><button className={busy?'is-busy':undefined} disabled={busy||!canConfirm} onClick={()=>void onConfirm().finally(()=>ref.current?.close())}>{busy?t('正在处理…'):t('确认操作')}</button><button className="secondary" disabled={busy} onClick={()=>ref.current?.close()}>{t('暂不操作')}</button></div></dialog></>;
}
export function EmptyState({ title, children, icon = 'box' }: { title: string; children?: ReactNode; icon?: string }) { return <div className="empty-state"><span className="empty-icon" aria-hidden="true"><SymbolIcon name={icon}/></span><h3>{title}</h3>{children}</div>; }
/** Skeleton placeholder; the status text stays available to screen readers. */
export function LoadingState({ label = t('正在加载，请稍候…') }: { label?: string }) { return <div className="skeleton" role="status" aria-live="polite"><span className="sr-only">{label}</span><span className="skeleton-line title" aria-hidden="true"/><span className="skeleton-line wide" aria-hidden="true"/><span className="skeleton-line mid" aria-hidden="true"/><span className="skeleton-block" aria-hidden="true"/></div>; }

/** Number that rolls to its value; screen readers get only the final value. */
export function CountUp({ value, from, format = String }: { value: number; from?: number; format?: (n: number) => string }) {
  const shown = useCountUp(value, { from });
  return <><span aria-hidden="true">{format(Math.round(shown))}</span><span className="sr-only">{format(value)}</span></>;
}
/** Animated check mark for completed steps (stroke draw; static under reduced motion). */
export function SuccessMark() { return <svg className="success-mark" viewBox="0 0 52 52" aria-hidden="true"><circle cx="26" cy="26" r="24"/><path d="M15 27.5l7.5 7.5L38 19"/></svg>; }
/** Shown while an order is being refreshed automatically. */
export function LiveIndicator({ label = t('实时更新中') }: { label?: string }) { return <span className="live-indicator"><i aria-hidden="true"/>{label}</span>; }

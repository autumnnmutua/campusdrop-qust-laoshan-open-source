import dialogPolyfill from 'dialog-polyfill';
import 'dialog-polyfill/dist/dialog-polyfill.css';
import {SymbolIcon} from './campus-design';
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import type { Building } from '../shared/contracts';
import { MOCK_MESSAGE, pickupCodeSchema, STATUS_LABELS, type DeliveryMode, type Order, type OrderEvent, type Parcel } from '../shared/delivery';
import { api } from './api';

const money = (fen: number) => `¥${(fen / 100).toFixed(2)}`;

/** Replace this component's contents when approved campus imagery is available. */
export function ImagePlaceholder({ label, compact = false }: { label: string; compact?: boolean }) {
  return <div className={`image-placeholder ${compact ? 'compact' : ''}`}><picture><source type="image/webp" srcSet="/images/qust-laoshan-960.webp 960w, /images/qust-laoshan.webp 1672w" sizes="(max-width: 720px) 100vw, 640px"/><img src="/images/qust-laoshan.jpg" alt={`${label} · 校园主题插画`} loading="lazy" decoding="async" width={1672} height={941}/></picture><span>QUST / 校园生活</span></div>;
}

export function PickupCodeInput({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const id = useId(), invalid = value.length > 0 && !pickupCodeSchema.safeParse(value).success;
  return <div><label htmlFor={id}>取件码</label><input id={id} value={value} onChange={e => onChange(e.target.value)} placeholder="87-5-2739" required maxLength={20} autoComplete="off" spellCheck={false} aria-invalid={invalid} aria-describedby={`${id}-help`} className="code-input" />
    <small id={`${id}-help`}>第一段 1–3 位数字，第二段 1 位，最后一段 4 位。</small>{invalid && <p role="alert">取件码格式不正确，例如 107-2-6382</p>}</div>;
}

export function ParcelCard({ parcel: p, busy, onRemove }: { parcel: Parcel; busy: boolean; onRemove: () => void }) {
  return <article className="parcel-card"><div className="row"><strong className="pickup-code">{p.pickupCode}</strong><span className="badge">{p.packageSize === 'SMALL' ? '小件' : '大件'}</span></div><p>{p.carrier || '未填写承运商'} · {p.status === 'ACTIVE' ? '待安排' : p.status === 'CLOSED' ? '配送完成' : '已移除'}</p>{p.note && <p className="muted">{p.note}</p>}{p.status === 'ACTIVE' && <div className="actions"><Link to={`/parcel/${p.id}`}>选择配送 →</Link><button className="text-button" disabled={busy} onClick={onRemove}>{busy ? '正在移除…' : '移除'}</button></div>}</article>;
}

export function DormSelector({ buildings, zone, building, room, onZone, onBuilding, onRoom }: { buildings: Building[]; zone: 'SOUTH' | 'NORTH'; building: string; room: string; onZone: (v: 'SOUTH' | 'NORTH') => void; onBuilding: (v: string) => void; onRoom: (v: string) => void }) {
  const id = useId();
  return <fieldset className="dorm-selector"><legend>配送地址 · 崂山校区</legend><label htmlFor={`${id}-zone`}>宿舍区域</label><select id={`${id}-zone`} value={zone} onChange={e => { onZone(e.target.value as 'SOUTH' | 'NORTH'); onBuilding(''); }}><option value="SOUTH">南苑</option><option value="NORTH">北苑</option></select><label htmlFor={`${id}-building`}>宿舍楼</label><select id={`${id}-building`} required value={building} onChange={e => onBuilding(e.target.value)}><option value="">请选择宿舍楼</option>{buildings.filter(b => b.zone === zone).map(b => <option key={b.code} value={b.code}>{b.displayName}</option>)}</select><label>房间号<input required maxLength={32} value={room} onChange={e => onRoom(e.target.value)} placeholder="例如 B412" /></label></fieldset>;
}

export function DeliveryModeSelector({ value, onChange }: { value: DeliveryMode; onChange: (value: DeliveryMode) => void }) {
 return <ChoiceSelector label="配送方式" value={value} onChange={v=>onChange(v as DeliveryMode)} options={[{value:'DOWNSTAIRS',label:'楼下配送',icon:'person',hint:'至宿舍楼下'},{value:'ROOM',label:'送至寝室',icon:'room',hint:'至已保存的寝室'}]}/>;
}
export function ChoiceSelector({label,value,onChange,options,name}:{label:string;value:string;onChange:(v:string)=>void;options:{value:string;label:string;icon:string;hint?:string}[];name?:string}){
 const id=useId();return <div className="choice-selector"><label htmlFor={id}>{label}</label><select className="choice-native" id={id} name={name} value={value} onChange={e=>onChange(e.target.value)}>{options.map(o=><option key={o.value} value={o.value}>{o.label}</option>)}</select><div className="choice-options">{options.map(o=><button key={o.value} type="button" aria-pressed={value===o.value} onClick={()=>onChange(o.value)}><SymbolIcon name={o.icon}/><span>{o.label}{o.hint&&<small>{o.hint}</small>}</span><i aria-hidden="true">{value===o.value?'✓':''}</i></button>)}</div></div>;
}

export function PriceSummary({ amount }: { amount: number | null }) {
  return <div className="price-summary" aria-live="polite"><span>本次配送费用<small>以订单确认金额为准</small></span><strong className="price">{amount === null ? '报价中…' : money(amount)}</strong></div>;
}

export function OrderTimeline({ events }: { events: OrderEvent[] }) {
  return <ol className="timeline" aria-label="配送时间线">{events.map((e, index) => <li key={e.id} aria-current={index === events.length - 1 ? 'step' : undefined}><strong>{STATUS_LABELS[e.toStatus]}</strong>{e.detail&&<p>{e.detail}</p>}<time dateTime={new Date(e.createdAt * 1000).toISOString()}>{new Date(e.createdAt * 1000).toLocaleString('zh-CN')}</time></li>)}</ol>;
}

export function MockPaymentDialog({ amount, busy, onPay }: { amount: number; busy: boolean; onPay: () => Promise<void> }) {
  const ref = useRef<HTMLDialogElement>(null), id = useId();
  useEffect(()=>{if(ref.current&&typeof ref.current.showModal!=='function')dialogPolyfill.registerDialog(ref.current);},[]);
  return <><button disabled={busy} onClick={() => ref.current?.showModal()}>模拟支付 {money(amount)}</button><dialog ref={ref} aria-labelledby={id} onCancel={e => { if (busy) e.preventDefault(); }}><p className="eyebrow">支付确认</p><h2 id={id}>这是一笔模拟支付</h2><p>{MOCK_MESSAGE}</p><PriceSummary amount={amount} /><div className="actions"><button disabled={busy} onClick={() => { void onPay().finally(() => ref.current?.close()); }}>{busy ? '正在处理…' : '确认模拟支付'}</button><button className="secondary" disabled={busy} onClick={() => ref.current?.close()}>返回订单</button></div></dialog></>;
}

export function TipSheet({ amount, onChange, busy, disabled, onSubmit }: { amount: string; onChange: (v: string) => void; busy: boolean; disabled: boolean; onSubmit: () => void }) {
  const id = useId();
  return <div className="tip-sheet"><p className="muted">一点心意，由你决定。</p><div className="tip-options">{[1, 2, 5, 10].map(n => <button key={n} aria-pressed={amount === String(n)} className={amount === String(n) ? '' : 'secondary'} onClick={() => onChange(String(n))} disabled={busy}>{n} 元</button>)}</div><label htmlFor={id}>自定义金额（元）</label><input id={id} inputMode="decimal" value={amount} onChange={e => onChange(e.target.value)} disabled={busy} aria-describedby={`${id}-hint`} /><small id={`${id}-hint`}>0.01–100 元；自愿模拟打赏，不影响配送。</small><button className="block-button" disabled={disabled || busy} onClick={onSubmit}>{busy ? '正在处理…' : '确认模拟打赏'}</button></div>;
}

export function SensitiveValue({ orderId, version }: { orderId: string; version: number }) {
  const [code, setCode] = useState(''), [message, setMessage] = useState(''), [busy, setBusy] = useState(false);
  const generation = useRef(0);
  useEffect(() => { setCode(''); setMessage(''); generation.current++; const hide = () => { if (document.hidden) { generation.current++; setCode(''); } }; document.addEventListener('visibilitychange', hide); return () => { generation.current++; document.removeEventListener('visibilitychange', hide); }; }, [orderId, version]);
  useEffect(() => { if (!code) return; const timer = setTimeout(() => setCode(''), 30000); return () => clearTimeout(timer); }, [code]);
  async function reveal(action: 'VIEW' | 'COPY') {
    const current = generation.current; setBusy(true); setMessage('');
    try { const result = await api<{ pickupCode: string }>(`/admin/orders/${orderId}/pickup-code`, 'POST', { action }); if (generation.current !== current || document.hidden) return; setCode(result.pickupCode); if (action === 'COPY') { if(navigator.clipboard?.writeText){await navigator.clipboard.writeText(result.pickupCode);setMessage('已复制取件码');}else{setMessage('当前浏览器不支持自动复制，请长按下方取件码复制');} } }
    catch (e) { if (generation.current === current) setMessage((e as Error).message); } finally { setBusy(false); }
  }
  return <div className="sensitive-value"><small>取件凭证 · 每次查看和复制均留痕</small><div className="actions"><button className="secondary" disabled={busy} onClick={() => void reveal('VIEW')}>查看取件码</button><button className="secondary" disabled={busy} onClick={() => void reveal('COPY')}>复制取件码</button>{code && <strong className="pickup-code">{code}</strong>}</div>{code && <small>30 秒后自动隐藏，切换页面时隐藏。</small>}<span role="status">{message}</span></div>;
}

export function AdminTaskTable({ orders, renderTask }: { orders: Order[]; renderTask: (order: Order) => ReactNode }) {
  return <div className="admin-task-table"><table><caption>当前授权范围的配送任务</caption><thead><tr><th scope="col">任务编号</th><th scope="col">配送详情与操作</th></tr></thead><tbody>{orders.map(o => <tr key={o.id}><th scope="row"><span className="task-number">{o.id.slice(0, 8)}</span></th><td>{renderTask(o)}</td></tr>)}</tbody></table></div>;
}

export function ConfirmAction({label,title,children,busy,onConfirm,canConfirm=true,validationMessage}:{label:string;title:string;children:ReactNode;busy:boolean;onConfirm:()=>Promise<void>;canConfirm?:boolean;validationMessage?:string}){
  const ref=useRef<HTMLDialogElement>(null),id=useId();
  useEffect(()=>{if(ref.current&&typeof ref.current.showModal!=='function')dialogPolyfill.registerDialog(ref.current);},[]);
  return <><button className="secondary" disabled={busy} onClick={()=>ref.current?.showModal()}>{label}</button><dialog ref={ref} aria-labelledby={id} onCancel={e=>{if(busy)e.preventDefault();}}><h2 id={id}>{title}</h2>{children}{!canConfirm&&validationMessage&&<p role="status">{validationMessage}</p>}<div className="actions"><button disabled={busy||!canConfirm} onClick={()=>void onConfirm().finally(()=>ref.current?.close())}>{busy?'正在处理…':'确认操作'}</button><button className="secondary" disabled={busy} onClick={()=>ref.current?.close()}>暂不操作</button></div></dialog></>;
}
export function EmptyState({ title, children }: { title: string; children?: ReactNode }) { return <div className="empty-state"><span aria-hidden="true">○</span><h3>{title}</h3>{children}</div>; }
export function LoadingState() { return <div className="loading-state" role="status" aria-live="polite">正在加载，请稍候…</div>; }

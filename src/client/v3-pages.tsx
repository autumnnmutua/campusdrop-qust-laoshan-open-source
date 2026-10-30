import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { api } from './api';
import { t } from './i18n';
import { money } from './format';
import { toast, celebrate } from './effects';
import { flyToOrders } from './micro-motion';
import { SymbolIcon } from './campus-design';
import { DeliveryModeSelector, EmptyState, LoadingState, MockPaymentDialog, PriceSummary } from './components';
import { SlotPicker, type SlotChoice } from './live-ui';
import { DropPlacePicker } from './order-extras';
import { Notice, useStudentResource } from './student-delivery';
import { WeatherNotice } from './v3-ui';
import { priceFen } from '../domain/commerce';
import { STATUS_LABELS } from '../shared/constants';
import { DELIVERY_SLOTS, slotByCode, type SlotCode } from '../shared/slots';
import { DROP_PLACE_LABELS, type DropPlace } from '../shared/campus-map';
import type { DeliveryMode, Parcel } from '../shared/delivery';
import { GROUP_MAX_PARCELS, RULES_PER_STUDENT, RULE_LEAD_HOURS, WEEKDAY_LABELS, weekdayText, type DeliveryRule, type OrderGroup } from '../shared/v3';

/*
 * v3.0 student pages, loaded on demand: 合并配送 (choose parcels → one order set), the merged delivery page (pay all,
 * cancel the unpaid ones, see every parcel), and 常用配送 (standing delivery rules).
 */

// ---------------------------------------------------------------- 合并配送：选择包裹
export function MergeOrder() {
  const [params] = useSearchParams();
  const { data, error, loading, unauthorized } = useStudentResource<{ parcels: Parcel[] }>('/parcels');
  const waiting = useMemo(() => (data?.parcels ?? []).filter(p => p.status === 'ACTIVE' && !p.hasOrder), [data]);
  const stations = useMemo(() => [...new Set(waiting.map(p => p.stationCode))], [waiting]);
  const station = params.get('station') && stations.includes(params.get('station')!) ? params.get('station')! : stations.find(s => waiting.filter(p => p.stationCode === s).length >= 2) ?? stations[0];
  const here = waiting.filter(p => p.stationCode === station);
  const [picked, setPicked] = useState<string[] | null>(null);
  const chosen = picked ?? here.slice(0, GROUP_MAX_PARCELS).map(p => p.id);
  const [mode, setMode] = useState<DeliveryMode>('DOWNSTAIRS'), [slot, setSlot] = useState<SlotChoice | null>(null), [place, setPlace] = useState<DropPlace | null>(null);
  const [busy, setBusy] = useState(false), [message, setMessage] = useState('');
  const navigate = useNavigate(), submit = useRef<HTMLButtonElement>(null);
  useEffect(() => { if (mode === 'ROOM') setPlace(null); }, [mode]);
  const items = here.filter(p => chosen.includes(p.id)), total = items.reduce((s, p) => s + priceFen(p.packageSize, mode), 0);
  const toggle = (id: string, on: boolean) => {
    const next = on ? [...chosen, id] : chosen.filter(x => x !== id);
    if (next.length > GROUP_MAX_PARCELS) { toast(t('一次最多合并 {0} 件', { 0: GROUP_MAX_PARCELS }), 'warn'); return; }
    setPicked(next);
  };
  async function order(e: FormEvent) {
    e.preventDefault(); setBusy(true); setMessage('');
    try {
      const r = await api<{ group: OrderGroup }>('/order-groups', 'POST', { parcelIds: items.map(p => p.id), deliveryMode: mode, ...(slot ? { slotDate: slot.date, slotCode: slot.code } : {}), ...(place && mode === 'DOWNSTAIRS' ? { dropPlace: place } : {}) });
      await flyToOrders(submit.current);
      navigate(`/checkout-group/${r.group.id}`);
    } catch (err) { setMessage((err as Error).message); } finally { setBusy(false); }
  }
  return <section className="merge-page"><Link className="back-link" to="/">{t('← 我的包裹')}</Link><h1>{t('合并配送')}</h1>
    <p className="muted">{t('同一站点的几件包裹，交给同一位配送员一次送到：一次支付、一个收货码、核验一次全部签收。每件包裹照常计价，没有额外费用。')}</p>
    <Notice error={error} unauthorized={unauthorized}/>{loading && !data && <LoadingState/>}
    {data && here.length < 2 && <EmptyState title={t('现在没有可以合并的包裹')} icon="box"><p>{t('同一站点至少有 2 件还没下单的包裹时，可以合并配送。')}</p><Link className="button secondary" to="/parcel/new">{t('登记包裹 →')}</Link></EmptyState>}
    {data && here.length >= 2 && <form onSubmit={order}>
      {stations.length > 1 && <p className="muted">{t('不同站点的包裹需要分开下单；这里显示的是同一站点的包裹。')}</p>}
      <fieldset className="merge-list"><legend>{t('选择要一起送的包裹（{0}/{1}）', { 0: items.length, 1: GROUP_MAX_PARCELS })}</legend>
        {here.map(p => <label key={p.id} className={chosen.includes(p.id) ? 'merge-item is-on' : 'merge-item'}>
          <input type="checkbox" checked={chosen.includes(p.id)} onChange={e => toggle(p.id, e.target.checked)}/>
          <span className="pickup-code">{p.pickupCode}</span><span className="badge">{p.packageSize === 'SMALL' ? t('小件') : t('大件')}</span>
          <small>{p.carrier || t('未填写承运商')}</small><b>{money(priceFen(p.packageSize, mode))}</b>
        </label>)}
      </fieldset>
      <DeliveryModeSelector value={mode} onChange={setMode}/>{mode === 'DOWNSTAIRS' && <DropPlacePicker value={place} onChange={setPlace}/>}<SlotPicker value={slot} onChange={setSlot}/>
      <WeatherNotice/>
      <PriceSummary amount={items.length >= 2 ? total : null}/>
      {slot && <p className="muted">{t('预约时段时，{0} 件包裹各占一个名额。', { 0: items.length })}</p>}
      <p className="muted">{place ? t('送到{0}，联系电话按已保存的资料。', { 0: t(DROP_PLACE_LABELS[place]) }) : <>{t('按已保存的寝室配送，')}<Link to="/profile">{t('修改寝室')}</Link>。</>}</p>
      <button ref={submit} className={busy ? 'is-busy' : undefined} disabled={busy || items.length < 2}>{busy ? t('正在创建…') : t('确认合并下单（{0} 件）', { 0: items.length })}</button>
      <p role="alert">{message}</p>
    </form>}
  </section>;
}

// ---------------------------------------------------------------- 合并配送单：支付、查看
export function GroupCheckout() {
  const { id } = useParams();
  const { data, error, loading, unauthorized, refresh } = useStudentResource<{ group: OrderGroup }>(`/order-groups/${id}`);
  const [busy, setBusy] = useState(false), [message, setMessage] = useState('');
  const g = data?.group, live = g?.orders.filter(o => o.status !== 'CANCELLED') ?? [];
  async function pay() {
    setBusy(true); setMessage('');
    try { const r = await api<{ paid: number; missed: number; message: string }>(`/order-groups/${id}/mock-pay`, 'POST'); toast(t('模拟支付成功'), 'success', r.message); if (!r.missed) celebrate(); else setMessage(r.message); await refresh(); }
    catch (e) { setMessage((e as Error).message); } finally { setBusy(false); }
  }
  async function cancel() {
    setBusy(true); setMessage('');
    try { await api(`/order-groups/${id}/cancel-unpaid`, 'POST'); toast(t('未支付的订单已取消'), 'info'); await refresh(); }
    catch (e) { setMessage((e as Error).message); } finally { setBusy(false); }
  }
  return <section className="group-page"><Link className="back-link" to="/orders">{t('← 我的订单')}</Link>
    <h1>{g?.unpaidCount ? t('确认合并配送') : t('合并配送')}</h1>
    <Notice error={error} unauthorized={unauthorized}/>{loading && !data && <LoadingState/>}
    {g && <>
      {g.origin === 'RULE' && <p className="rule-note"><SymbolIcon name="bell"/>{t('这单由“常用配送”规则自动生成；不需要的话取消即可，不影响规则。')} <Link to="/rules">{t('管理规则 ›')}</Link></p>}
      <div className="group-sheet">
        <div className="group-sheet-head"><span className="merge-stack" aria-hidden="true"><i/><i/><i/></span><div><strong>{t('{0} 件包裹 · 一次送达', { 0: live.length })}</strong><small>{t('收货码相同：配送员核验一次，全部签收')}</small></div><p className="price">{money(g.totalFen)}</p></div>
        <ol className="group-items">{g.orders.map(o => <li key={o.id} className={o.status === 'CANCELLED' ? 'is-cancelled' : undefined}>
          <span className="badge" data-status={o.status}>{t(STATUS_LABELS[o.status])}</span>
          <span>{o.packageSize === 'SMALL' ? t('小件') : t('大件')} · {o.dropPlace ? t(DROP_PLACE_LABELS[o.dropPlace]) : `${o.dormSnapshot.buildingName}${o.deliveryMode === 'ROOM' ? t(' · 到寝') : t(' · 楼下')}`}{o.slotDate && o.slotCode ? ` · ${o.slotDate.slice(5)} ${t(slotByCode(o.slotCode).label)}` : ''}</span>
          <b>{money(o.amountFen)}</b><Link to={`/orders/${o.id}`}>{t('详情 ›')}</Link>
        </li>)}</ol>
      </div>
      {g.unpaidCount > 0 ? <div className="actions"><MockPaymentDialog amount={g.unpaidFen} busy={busy} onPay={pay}/><button type="button" className="secondary" disabled={busy} onClick={() => void cancel()}>{t('取消未支付的 {0} 件', { 0: g.unpaidCount })}</button></div>
        : live.length > 0 && <p className="success">{t('已全部支付（模拟），配送员接单后会一起取件、一起送达。')}</p>}
      <p role="alert">{message}</p>
      <WeatherNotice/>
    </>}
  </section>;
}

// ---------------------------------------------------------------- 常用配送
const MODE_TEXT: Record<DeliveryMode, string> = { DOWNSTAIRS: '送到楼下', ROOM: '送到寝室' };
function RuleForm({ initial, onSave, onCancel }: { initial?: DeliveryRule; onSave: (v: { weekdays: number; slotCode: SlotCode; deliveryMode: DeliveryMode; dropPlace: DropPlace | null }) => Promise<void>; onCancel?: () => void }) {
  const [days, setDays] = useState(initial?.weekdays ?? 31), [slot, setSlot] = useState<SlotCode>(initial?.slotCode ?? 'NIGHT');
  const [mode, setMode] = useState<DeliveryMode>(initial?.deliveryMode ?? 'DOWNSTAIRS'), [place, setPlace] = useState<DropPlace | null>(initial?.dropPlace ?? null), [busy, setBusy] = useState(false);
  useEffect(() => { if (mode === 'ROOM') setPlace(null); }, [mode]);
  return <form className="rule-form" onSubmit={async e => { e.preventDefault(); setBusy(true); try { await onSave({ weekdays: days, slotCode: slot, deliveryMode: mode, dropPlace: mode === 'DOWNSTAIRS' ? place : null }); } finally { setBusy(false); } }}>
    <fieldset><legend>{t('哪几天')}</legend>
      <div className="weekday-row">{WEEKDAY_LABELS.map((d, i) => <button key={d} type="button" className="chip" aria-pressed={Boolean(days & (1 << i))} onClick={() => setDays(days ^ (1 << i))}>{t(d)}</button>)}</div>
      <div className="weekday-presets"><button type="button" className="text-button" onClick={() => setDays(31)}>{t('工作日')}</button><button type="button" className="text-button" onClick={() => setDays(127)}>{t('每天')}</button><button type="button" className="text-button" onClick={() => setDays(96)}>{t('周末')}</button></div>
    </fieldset>
    <fieldset><legend>{t('哪个时段')}</legend><div className="segmented" role="radiogroup" aria-label={t('时段')}>{DELIVERY_SLOTS.map(s => <button key={s.code} type="button" role="radio" aria-checked={slot === s.code} onClick={() => setSlot(s.code)}>{t(s.label)} <small>{s.start}–{s.end}</small></button>)}</div></fieldset>
    <DeliveryModeSelector value={mode} onChange={setMode}/>{mode === 'DOWNSTAIRS' && <DropPlacePicker value={place} onChange={setPlace}/>}
    <div className="actions"><button disabled={busy || !days}>{busy ? t('正在保存…') : initial ? t('保存修改') : t('添加规则')}</button>{onCancel && <button type="button" className="secondary" onClick={onCancel}>{t('取消')}</button>}</div>
  </form>;
}
export function RulesPage() {
  const { data, error, loading, unauthorized, refresh } = useStudentResource<{ rules: DeliveryRule[] }>('/me/rules');
  const [editing, setEditing] = useState<string | 'new' | null>(null), [message, setMessage] = useState('');
  const rules = data?.rules ?? [];
  async function run(task: () => Promise<unknown>, done: string) {
    setMessage('');
    try { await task(); toast(done, 'success'); setEditing(null); await refresh(); } catch (e) { setMessage((e as Error).message); }
  }
  return <section className="rules-page"><h1>{t('常用配送')}</h1>
    <p className="muted">{t('设好“哪几天、哪个时段、送到哪里”。到了那天，时段开始前 {0} 小时起，系统会把你已登记、还没下单的包裹自动生成订单（同一站点的自动合并），并发消息提醒你在时段截止前完成模拟支付。不支付的订单会在截止时自动取消；你随时可以暂停或删除规则。', { 0: RULE_LEAD_HOURS })}</p>
    <Notice error={error} unauthorized={unauthorized}/>{loading && !data && <LoadingState/>}
    {data && <>
      {rules.length === 0 && editing !== 'new' && <EmptyState title={t('还没有常用配送规则')} icon="bell"><p>{t('例如：工作日晚间 20:00–22:00，送到楼下。')}</p></EmptyState>}
      <div className="card-list">{rules.map(r => <article key={r.id} className={r.active ? 'parcel-card rule-card' : 'parcel-card rule-card is-paused'}>
        {editing === r.id ? <RuleForm initial={r} onCancel={() => setEditing(null)} onSave={v => run(() => api(`/me/rules/${r.id}`, 'PATCH', v), t('规则已更新'))}/> : <>
          <div className="row"><strong>{t(weekdayText(r.weekdays))} · {t(slotByCode(r.slotCode).label)} {slotByCode(r.slotCode).start}–{slotByCode(r.slotCode).end}</strong><span className="badge" data-status={r.active ? 'WAITING_PICKUP' : 'CANCELLED'}>{r.active ? t('生效中') : t('已暂停')}</span></div>
          <p>{r.dropPlace ? t(DROP_PLACE_LABELS[r.dropPlace]) : t(MODE_TEXT[r.deliveryMode])}{r.lastRunDate ? t(' · 最近一次：{0}', { 0: r.lastRunDate.slice(5).replace('-', '/') }) : ''}</p>
          {r.lastNotice && <p className="muted">{t('上次未能生成订单：{0}', { 0: r.lastNotice })}</p>}
          <div className="actions">
            <button type="button" className="secondary" onClick={() => void run(() => api(`/me/rules/${r.id}`, 'PATCH', { active: !r.active }), r.active ? t('规则已暂停') : t('规则已恢复'))}>{r.active ? t('暂停') : t('恢复')}</button>
            <button type="button" className="secondary" onClick={() => setEditing(r.id)}>{t('修改')}</button>
            <button type="button" className="text-button" onClick={() => void run(() => api(`/me/rules/${r.id}`, 'DELETE'), t('规则已删除'))}>{t('删除')}</button>
          </div>
        </>}
      </article>)}</div>
      {editing === 'new' ? <div className="panel"><h2>{t('新规则')}</h2><RuleForm onCancel={() => setEditing(null)} onSave={v => run(() => api('/me/rules', 'POST', v), t('规则已添加'))}/></div>
        : rules.length < RULES_PER_STUDENT && <button type="button" onClick={() => setEditing('new')}>{t('添加常用配送规则')}</button>}
      {rules.length >= RULES_PER_STUDENT && <p className="muted">{t('最多 {0} 条规则。', { 0: RULES_PER_STUDENT })}</p>}
      <p role="alert">{message}</p>
    </>}
  </section>;
}

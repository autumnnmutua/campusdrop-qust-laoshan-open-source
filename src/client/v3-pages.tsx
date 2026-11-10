/* © 2026 专业团队 · CampusDrop v4.5.0 */
import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { CouponPicker, CouponTotal, type CouponChoice } from './coupons-ui';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from './api';
import { getLang, t } from './i18n';
import { money } from './format';
import { toast, celebrate } from './effects';
import { flyToOrders } from './micro-motion';
import { SymbolIcon } from './campus-design';
import { DeliveryModeSelector, EmptyState, LoadingState, MockPaymentDialog } from './components';
import { HandoffCodeCard, SlotPicker, type SlotChoice } from './live-ui';
import { DropPlacePicker } from './order-extras';
import { Notice, useResource, useStudentResource } from './student-delivery';
import { WeatherNotice } from './v3-ui';
import { priceFen } from '../domain/commerce';
import { STATUS_LABELS } from '../shared/constants';
import { DELIVERY_SLOTS, slotByCode, type SlotCode } from '../shared/slots';
import { DROP_PLACES, DROP_PLACE_LABELS, type DropPlace } from '../shared/campus-map';
import { CHECKOUT_MAX_PARCELS, DEFAULT_BUNDLE, bundleDiscount, sortedTiers, tierLabel, tierLabelEn, type BundleSetting, type BundleTier, type CheckoutDetail } from '../shared/bundle';
import type { DeliveryMode, Order, Parcel, Station } from '../shared/delivery';
import { sizeLabel } from '../shared/delivery';
import { GROUP_MAX_PARCELS, RULES_PER_STUDENT, RULE_LEAD_HOURS, WEEKDAY_LABELS, weekdayText, type DeliveryRule, type OrderGroup } from '../shared/v3';

/*
 * v3.0 student pages, loaded on demand: 合并配送 (choose parcels → one order set), the merged delivery page (pay all,
 * cancel the unpaid ones, see every parcel), and 常用配送 (standing delivery rules).
 */

// ---------------------------------------------------------------- 多件下单：选择包裹（v3.8）
/** Destination of one parcel: downstairs, the room, or a campus drop-off point (priced as downstairs). */
type Dest = 'DOWNSTAIRS' | 'ROOM' | `PLACE:${DropPlace}`;
const destMode = (d: Dest): DeliveryMode => d === 'ROOM' ? 'ROOM' : 'DOWNSTAIRS';
const destPlace = (d: Dest): DropPlace | undefined => d.startsWith('PLACE:') ? d.slice(6) as DropPlace : undefined;
function useBundleSetting(): BundleSetting | null {
  const [b, setB] = useState<BundleSetting | null>(null);
  useEffect(() => { let on = true; api<{ bundle: BundleSetting }>('/pricing/bundle').then(r => { if (on) setB(r.bundle); }).catch(() => { if (on) setB(DEFAULT_BUNDLE); }); return () => { on = false; }; }, []);
  return b;
}
const tierText = (tier: BundleTier) => getLang() === 'en' ? tierLabelEn(tier) : tierLabel(tier);
/** “满 15 减 2 · 满 20 减 3” as a row of chips; the reached tier is highlighted. */
export function BundleTiers({ setting, reached }: { setting: BundleSetting | null; reached?: BundleTier | null }) {
  if (!setting?.enabled || !setting.tiers.length) return null;
  return <ul className="bundle-tiers" aria-label={t('多件满减')}>{sortedTiers(setting).map(tier => <li key={tier.minFen} className={reached?.minFen === tier.minFen ? 'is-on' : undefined}>{tierText(tier)}</li>)}</ul>;
}

export function MergeOrder() {
  const { data, error, loading, unauthorized } = useStudentResource<{ parcels: Parcel[] }>('/parcels');
  const waiting = useMemo(() => (data?.parcels ?? []).filter(p => p.status === 'ACTIVE' && !p.hasOrder), [data]);
  const stations = useMemo(() => [...new Set(waiting.map(p => p.stationCode))], [waiting]);
  const bundle = useBundleSetting(), stationList = useResource<{ stations: Station[] }>('/stations');
  const [picked, setPicked] = useState<string[] | null>(null), [dest, setDest] = useState<Record<string, Dest>>({});
  const chosen = picked ?? waiting.slice(0, CHECKOUT_MAX_PARCELS).map(p => p.id);
  const [slot, setSlot] = useState<SlotChoice | null>(null), [busy, setBusy] = useState(false), [message, setMessage] = useState('');
  const navigate = useNavigate(), submit = useRef<HTMLButtonElement>(null);
  const destOf = (id: string): Dest => dest[id] ?? 'DOWNSTAIRS';
  const items = waiting.filter(p => chosen.includes(p.id));
  const amounts = items.map(p => priceFen(p.packageSize, destMode(destOf(p.id))));
  const total = amounts.reduce((a, b) => a + b, 0), b = bundleDiscount(bundle, amounts);
  const toggle = (id: string, on: boolean) => {
    const next = on ? [...chosen, id] : chosen.filter(x => x !== id);
    if (next.length > CHECKOUT_MAX_PARCELS) { toast(t('一次最多 {0} 件', { 0: CHECKOUT_MAX_PARCELS }), 'warn'); return; }
    setPicked(next);
  };
  const setAll = (d: Dest) => setDest(Object.fromEntries(waiting.map(p => [p.id, d])));
  const allSame = items.length > 0 && items.every(p => destOf(p.id) === destOf(items[0].id)) ? destOf(items[0].id) : null;
  const stationName = (code: string) => stationList.data?.stations.find(x => x.code === code)?.canonicalName ?? code;
  async function order(e: FormEvent) {
    e.preventDefault(); setBusy(true); setMessage('');
    try {
      const r = await api<{ checkout: CheckoutDetail }>('/checkouts', 'POST', { items: items.map(p => { const d = destOf(p.id), place = destPlace(d); return { parcelId: p.id, deliveryMode: destMode(d), ...(place ? { dropPlace: place } : {}) }; }), ...(slot ? { slotDate: slot.date, slotCode: slot.code } : {}) });
      await flyToOrders(submit.current);
      navigate(`/checkout-batch/${r.checkout.id}`);
    } catch (err) { setMessage((err as Error).message); } finally { setBusy(false); }
  }
  const destOptions = (size: Parcel['packageSize']) => <>
    <option value="DOWNSTAIRS">{t('送到楼下')} · {money(priceFen(size, 'DOWNSTAIRS'))}</option>
    <option value="ROOM">{t('送到寝室')} · {money(priceFen(size, 'ROOM'))}</option>
    <optgroup label={t('约定地点（按楼下计价）')}>{DROP_PLACES.map(place => <option key={place} value={`PLACE:${place}`}>{t(DROP_PLACE_LABELS[place])} · {money(priceFen(size, 'DOWNSTAIRS'))}</option>)}</optgroup>
  </>;
  return <section className="merge-page multi-order"><Link className="back-link" to="/">{t('← 我的包裹')}</Link>
    <div className="multi-head"><div><p className="eyebrow">{t('多件下单')}</p><h1>{t('几件包裹，一次搞定')}</h1>
      <p className="muted">{t('勾选要一起送的包裹，大件小件、不同站点都可以；每件可单独选择送达地点。同一站点送往同一处的包裹按每组最多 {0} 件分组，同组通常一起送，特殊情况可能分批。', { 0: GROUP_MAX_PARCELS })}</p></div>
      <BundleTiers setting={bundle} reached={b.tier}/></div>
    <Notice error={error} unauthorized={unauthorized}/>{loading && !data && <LoadingState/>}
    {data && waiting.length === 0 && <EmptyState title={t('现在没有可以下单的包裹')} icon="box"><p>{t('登记包裹后，就可以在这里一次选好几件。')}</p><Link className="button secondary" to="/parcel/new">{t('登记包裹 →')}</Link></EmptyState>}
    {data && waiting.length > 0 && <form onSubmit={order} className="multi-layout">
      <div className="multi-main">
        <fieldset className="multi-bulk"><legend>{t('统一设置')}</legend>
          <div className="segmented" role="radiogroup" aria-label={t('全部送到')}>
            {(['DOWNSTAIRS', 'ROOM'] as Dest[]).map(d => <button key={d} type="button" role="radio" aria-checked={allSame === d} onClick={() => setAll(d)}>{d === 'ROOM' ? t('全部送到寝室') : t('全部送到楼下')}</button>)}
            <button type="button" role="radio" aria-checked={!!allSame && allSame.startsWith('PLACE:')} onClick={() => setAll('PLACE:LIBRARY')}>{t('全部送到约定地点')}</button>
          </div>
          <small className="muted">{t('统一设置后，仍可以在下面逐件调整。')}</small>
        </fieldset>
        {stations.map(code => <fieldset key={code} className="merge-list multi-list"><legend>{stationName(code)}</legend>
          {waiting.filter(p => p.stationCode === code).map(p => { const on = chosen.includes(p.id), id = `dest-${p.id}`; return <div key={p.id} className={on ? 'merge-item multi-item is-on' : 'merge-item multi-item'}>
            <label className="multi-pick"><input type="checkbox" checked={on} onChange={e => toggle(p.id, e.target.checked)}/>
              <span className="pickup-code">{p.pickupCode}</span><span className="badge" data-size={p.packageSize}>{t(sizeLabel(p.packageSize))}</span><small>{p.carrier || t('未填写承运商')}</small></label>
            <label className="multi-dest" htmlFor={id}><span className="sr-only">{t('送到哪里')}</span>
              <select id={id} value={destOf(p.id)} disabled={!on} onChange={e => setDest({ ...dest, [p.id]: e.target.value as Dest })}>{destOptions(p.packageSize)}</select></label>
            <b>{money(priceFen(p.packageSize, destMode(destOf(p.id))))}</b>
          </div>; })}
        </fieldset>)}
        <SlotPicker value={slot} onChange={setSlot}/>
        <WeatherNotice/>
      </div>
      <aside className="multi-summary panel" aria-live="polite">
        <h2>{t('已选 {0} 件', { 0: items.length })}</h2>
        <dl className="coupon-total"><div><dt>{t('配送费')}</dt><dd>{money(total)}</dd></div>
          {b.discountFen > 0 && b.tier && <div><dt>{t('多件满减')} <small>{tierText(b.tier)}</small></dt><dd>-{money(b.discountFen)}</dd></div>}
          <div className="is-pay"><dt>{t('预计应付')}</dt><dd>{money(total - b.discountFen)}</dd></div></dl>
        {b.next && <div className="bundle-progress"><span style={{ ['--p' as string]: `${Math.min(100, Math.round(total / b.next.tier.minFen * 100))}%` }}/><small>{b.eligible ? t('再加 {0} 可享{1}', { 0: money(b.next.needFen), 1: tierText(b.next.tier) }) : t('选 2 件及以上、满 {0} 元可享多件满减', { 0: (b.next.tier.minFen / 100).toString() })}</small></div>}
        <p className="muted small">{t('优惠券在下一步自动匹配最省钱的一张，也可以输入优惠码。')}</p>
        {slot && <p className="muted small">{t('预约时段时，{0} 件包裹各占一个名额。', { 0: items.length })}</p>}
        <p className="muted small">{t('寝室按已保存的资料，')}<Link to="/profile">{t('修改寝室')}</Link>。</p>
        <button ref={submit} className={busy ? 'is-busy' : undefined} disabled={busy || items.length < 1}>{busy ? t('正在创建…') : t('确认下单（{0} 件）', { 0: items.length })}</button>
        <p role="alert">{message}</p>
      </aside>
    </form>}
  </section>;
}

// ---------------------------------------------------------------- 多件下单：支付、查看（v3.8）
export function BatchCheckout() {
  const { id } = useParams();
  const { data, error, loading, unauthorized, refresh } = useStudentResource<{ checkout: CheckoutDetail }>(`/checkouts/${id}`);
  const [busy, setBusy] = useState(false), [message, setMessage] = useState(''), [coupon, setCoupon] = useState<CouponChoice | null>(null), [bundleFen, setBundleFen] = useState(0), [rainFen, setRainFen] = useState(0);
  const c = data?.checkout, live = c?.orders.filter(o => o.status !== 'CANCELLED') ?? [];
  async function pay() {
    setBusy(true); setMessage('');
    try { const r = await api<{ message: string }>(`/checkouts/${id}/mock-pay`, 'POST', coupon ? { couponId: coupon.couponId, ...(coupon.code ? { code: coupon.code } : {}) } : {}); toast(t('模拟支付成功'), 'success', r.message); celebrate(); await refresh(); }
    catch (e) { setMessage((e as Error).message); } finally { setBusy(false); }
  }
  async function cancel() {
    setBusy(true); setMessage('');
    try { await api(`/checkouts/${id}/cancel-unpaid`, 'POST'); toast(t('未支付的订单已取消'), 'info'); await refresh(); }
    catch (e) { setMessage((e as Error).message); } finally { setBusy(false); }
  }
  const where = (o: Order) => o.dropPlace ? t(DROP_PLACE_LABELS[o.dropPlace]) : `${o.dormSnapshot.buildingName}${o.deliveryMode === 'ROOM' ? t(' · 到寝') : t(' · 楼下')}`;
  return <section className="group-page batch-page"><Link className="back-link" to="/orders">{t('← 我的订单')}</Link>
    <h1>{c?.unpaidCount ? t('确认多件下单') : t('多件下单')}</h1>
    <Notice error={error} unauthorized={unauthorized}/>{loading && !data && <LoadingState/>}
    {c && <>
      <div className="group-sheet">
        <div className="group-sheet-head"><span className="merge-stack" aria-hidden="true"><i/><i/><i/></span><div><strong>{t('{0} 件包裹 · {1} 个配送组', { 0: live.length, 1: c.trips.length })}</strong><small>{t('同站点、同目的地的包裹通常一起送；如分批配送，每批分别核验收货码')}</small></div><p className="price">{money(c.totalFen)}</p></div>
        <ul className="trip-list">{c.trips.map((trip, i) => <li key={i}><span className="trip-from">{trip.stationName}</span><span className="trip-arrow" aria-hidden="true">→</span><span className="trip-to">{trip.dropPlace ? t(DROP_PLACE_LABELS[trip.dropPlace]) : `${trip.buildingName}${trip.mode === 'ROOM' ? t(' · 到寝') : t(' · 楼下')}`}</span><span className="badge">{trip.count > 1 ? t('同组 {0} 件', { 0: trip.count }) : t('1 件')}</span></li>)}</ul>
        <ol className="group-items">{c.orders.map(o => <li key={o.id} className={o.status === 'CANCELLED' ? 'is-cancelled' : undefined}>
          <span className="badge" data-status={o.status}>{t(STATUS_LABELS[o.status])}</span>
          <span>{t(sizeLabel(o.packageSize))} · {o.stationSnapshot.canonicalName} → {where(o)}{o.slotDate && o.slotCode ? ` · ${o.slotDate.slice(5)} ${t(slotByCode(o.slotCode).label)}` : ''}</span>
          <b>{money(o.amountFen)}</b><Link to={`/orders/${o.id}`}>{t('详情 ›')}</Link>
        </li>)}</ol>
      </div>
      {c.handoffCode && <HandoffCodeCard code={c.handoffCode} status={live.find(o => o.status !== 'WAITING_PAYMENT')?.status ?? 'WAITING_PICKUP'}/>}
      {c.unpaidCount > 0 && <><CouponPicker checkoutId={c.id} amountFen={c.unpaidFen} onChange={setCoupon} onBundle={setBundleFen} onRain={setRainFen}/><CouponTotal amountFen={c.unpaidFen} choice={coupon} bundleFen={bundleFen} rainFen={rainFen}/></>}
      {!c.unpaidCount && live.length > 0 && <dl className="coupon-total is-paid"><div><dt>{t('配送费')}</dt><dd>{money(c.totalFen)}</dd></div>
        {c.bundleFen > 0 && <div><dt>{t('多件满减')}</dt><dd>-{money(c.bundleFen)}</dd></div>}{c.couponFen > 0 && <div><dt>{t('优惠券')}</dt><dd>-{money(c.couponFen)}</dd></div>}{(c.rainFen ?? 0) > 0 && <div><dt>{t('雨天配送费')}</dt><dd>+{money(c.rainFen ?? 0)}</dd></div>}
        <div className="is-pay"><dt>{t('实付（模拟）')}</dt><dd>{money(c.paidFen)}</dd></div></dl>}
      {c.unpaidCount > 0 ? <div className="actions"><MockPaymentDialog amount={c.unpaidFen - bundleFen - (coupon?.discountFen ?? 0) + rainFen} busy={busy} onPay={pay}/><button type="button" className="secondary" disabled={busy} onClick={() => void cancel()}>{t('取消未支付的 {0} 件', { 0: c.unpaidCount })}</button></div>
        : live.length > 0 && <p className="success">{t('已全部支付（模拟）；分开付款或配送安排变化时可能分批送达。单件取消会退回这件实际支付的金额。')}</p>}
      <p role="alert">{message}</p>
      <WeatherNotice/>
    </>}
  </section>;
}

// ---------------------------------------------------------------- 合并配送单：支付、查看
export function GroupCheckout() {
  const { id } = useParams();
  const { data, error, loading, unauthorized, refresh } = useStudentResource<{ group: OrderGroup }>(`/order-groups/${id}`);
  const [busy, setBusy] = useState(false), [message, setMessage] = useState(''), [coupon, setCoupon] = useState<CouponChoice | null>(null), [bundleFen, setBundleFen] = useState(0), [rainFen, setRainFen] = useState(0);
  const g = data?.group, live = g?.orders.filter(o => o.status !== 'CANCELLED') ?? [];
  async function pay() {
    setBusy(true); setMessage('');
    try { const r = await api<{ paid: number; missed: number; message: string }>(`/order-groups/${id}/mock-pay`, 'POST', coupon ? { couponId: coupon.couponId, ...(coupon.code ? { code: coupon.code } : {}) } : {}); toast(t('模拟支付成功'), 'success', r.message); if (!r.missed) celebrate(); else setMessage(r.message); await refresh(); }
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
        <div className="group-sheet-head"><span className="merge-stack" aria-hidden="true"><i/><i/><i/></span><div><strong>{t('{0} 件包裹 · 合并配送', { 0: live.length })}</strong><small>{t('通常一起送达；如分批配送，每批分别核验收货码')}</small></div><p className="price">{money(g.totalFen)}</p></div>
        <ol className="group-items">{g.orders.map(o => <li key={o.id} className={o.status === 'CANCELLED' ? 'is-cancelled' : undefined}>
          <span className="badge" data-status={o.status}>{t(STATUS_LABELS[o.status])}</span>
          <span>{t(sizeLabel(o.packageSize))} · {o.dropPlace ? t(DROP_PLACE_LABELS[o.dropPlace]) : `${o.dormSnapshot.buildingName}${o.deliveryMode === 'ROOM' ? t(' · 到寝') : t(' · 楼下')}`}{o.slotDate && o.slotCode ? ` · ${o.slotDate.slice(5)} ${t(slotByCode(o.slotCode).label)}` : ''}</span>
          <b>{money(o.amountFen)}</b><Link to={`/orders/${o.id}`}>{t('详情 ›')}</Link>
        </li>)}</ol>
      </div>
      {g.unpaidCount > 0 && <><CouponPicker groupId={g.id} amountFen={g.unpaidFen} onChange={setCoupon} onBundle={setBundleFen} onRain={setRainFen}/><CouponTotal amountFen={g.unpaidFen} choice={coupon} bundleFen={bundleFen} rainFen={rainFen}/></>}
      {!g.unpaidCount && ((g.discountFen ?? 0) > 0 || (g.bundleFen ?? 0) > 0 || (g.rainFen ?? 0) > 0) && <p className="muted">{t('已优惠 {0}，实付 {1}', { 0: money((g.discountFen ?? 0) + (g.bundleFen ?? 0)), 1: money(g.totalFen - (g.discountFen ?? 0) - (g.bundleFen ?? 0) + (g.rainFen ?? 0)) })}</p>}
      {g.unpaidCount > 0 ? <div className="actions"><MockPaymentDialog amount={g.unpaidFen - bundleFen - (coupon?.discountFen ?? 0) + rainFen} busy={busy} onPay={pay}/><button type="button" className="secondary" disabled={busy} onClick={() => void cancel()}>{t('取消未支付的 {0} 件', { 0: g.unpaidCount })}</button></div>
        : live.length > 0 && <p className="success">{t('已全部支付（模拟）；分开付款或配送安排变化时可能分批送达。')}</p>}
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

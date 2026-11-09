/* © 2026 专业团队 · CampusDrop v4.5.0 */
import { useEffect, useState, useSyncExternalStore } from 'react';
import { Link } from 'react-router-dom';
import { api } from './api';
import { getLang, t } from './i18n';
import { SymbolIcon } from './campus-design';
import type { Order, Parcel } from '../shared/delivery';
import { CHECKOUT_MAX_PARCELS } from '../shared/bundle';
import type { WeatherInfo } from '../shared/v3';

/*
 * v3.0 pieces used on the main student pages (kept small; the full pages are in v3-pages.tsx, loaded on demand):
 * the weather chip and notice, the "merge these parcels" suggestion, and the merged-delivery labels on orders.
 */

// ---------------------------------------------------------------- weather
// One request per page view, shared by every chip and notice on the page; refreshed after 10 minutes.
let weather: WeatherInfo | null = null, loadedAt = 0, loading: Promise<void> | null = null;
const listeners = new Set<() => void>();
function loadWeather() {
  if (loading || Date.now() - loadedAt < 600_000) return;
  loading = api<{ weather: WeatherInfo }>('/weather').then(r => { weather = r.weather; loadedAt = Date.now(); listeners.forEach(l => l()); })
    .catch(() => { loadedAt = Date.now(); }).finally(() => { loading = null; });
}
export function useWeather(): WeatherInfo | null {
  useEffect(loadWeather, []);
  return useSyncExternalStore(l => { listeners.add(l); return () => listeners.delete(l); }, () => weather, () => null);
}
/** Open-Meteo's data is CC BY 4.0: credited, with the licence linked, wherever an observation is shown. */
export function WeatherCredit() {
  return <small className="weather-credit"><a href="https://open-meteo.com/" target="_blank" rel="noopener noreferrer">{t('天气数据：Open-Meteo.com')}</a> · <a href="https://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noopener noreferrer">CC BY 4.0</a>{t('，已按配送需要归类')}</small>;
}
/** Hero chip: current conditions at the campus (when observed), coloured by the delivery level. */
export function WeatherChip() {
  const w = useWeather();
  if (!w?.enabled || (!w.observed && w.level === 'CLEAR')) return null;
  const o = w.observed;
  return <p className={`weather-chip level-${w.level.toLowerCase()}`}>
    <span className="weather-glyph" aria-hidden="true">{w.level === 'SEVERE' ? '⛈\uFE0E' : w.level === 'WET' ? '☂\uFE0E' : '☀\uFE0E'}</span>
    <span>{o ? `${t(o.label)}${o.temperature != null ? ` · ${Math.round(o.temperature)}°C` : ''}` : w.level === 'SEVERE' ? t('恶劣天气') : t('雨雪天气')}
      {w.level !== 'CLEAR' && <b>{w.level === 'SEVERE' ? t(' · 配送可能明显延迟') : t(' · 配送可能稍慢')}</b>}</span>
    {o && <WeatherCredit/>}
  </p>;
}
/** The server writes the notice in Chinese; English readers get the same facts (the operator's own note stays as written). */
function weatherNoticeEn(w: WeatherInfo): string {
  const head = w.level === 'SEVERE' ? 'Severe weather: deliveries may be noticeably delayed' : 'Rain or snow: deliveries may be a little slower';
  const note = w.notice.match(/。([^。]+。?)$/)?.[1]?.trim();
  return `${head}; "as soon as possible" estimates include an extra ${w.paddingMinutes} minutes.${note ? ` ${note}` : ''}`;
}
/** v4.5 · 雨天配送费: told before anyone pays (home page, ordering and payment pages). */
export function RainNotice() {
  const w = useWeather(), r = w?.rain;
  if (!r?.active) return null;
  const text = getLang() === 'en' ? `${r.label ? `${t(r.label)}: ` : 'Rain: '}roads are slippery and deliveries take longer, so a ¥2.00 rainy-day fee is added once per order, however many parcels you order together.` : r.notice;
  return <div className="rain-notice" role="note"><span className="weather-glyph" aria-hidden="true">{'☂\uFE0E'}</span><p><strong>{t('雨天配送费')}</strong>{text}</p></div>;
}
/** Notice on the ordering and order pages when the weather slows deliveries (and the rain surcharge when it applies). */
export function WeatherNotice() {
  const w = useWeather();
  if (w?.rain?.active && (!w.enabled || w.level === 'CLEAR' || !w.notice)) return <RainNotice/>;
  if (!w?.enabled || w.level === 'CLEAR' || !w.notice) return null;
  if (w.rain?.active) return <><RainNotice/><div className={`weather-notice level-${w.level.toLowerCase()}`} role="note"><span className="weather-glyph" aria-hidden="true">{w.level === 'SEVERE' ? '⛈\uFE0E' : '☂\uFE0E'}</span><p>{getLang() === 'en' ? weatherNoticeEn(w) : w.notice}{w.observed && <><br/><WeatherCredit/></>}</p></div></>;
  return <div className={`weather-notice level-${w.level.toLowerCase()}`} role="note"><span className="weather-glyph" aria-hidden="true">{w.level === 'SEVERE' ? '⛈\uFE0E' : '☂\uFE0E'}</span><p>{getLang() === 'en' ? weatherNoticeEn(w) : w.notice}{w.observed && <><br/><WeatherCredit/></>}</p></div>;
}

// ---------------------------------------------------------------- merged delivery
/** Parcels that can go into one merged delivery: waiting, without an order, grouped by station (2 or more). */
export function mergeable(parcels: Parcel[]): { station: string; parcels: Parcel[] } | null {
  const waiting = parcels.filter(p => p.status === 'ACTIVE' && !p.hasOrder);
  // v3.8: any stations, sizes and destinations can go into one 多件下单; the station is kept for older links only.
  return waiting.length >= 2 ? { station: waiting[0].stationCode, parcels: waiting } : null;
}
export function MergeBanner({ parcels }: { parcels: Parcel[] }) {
  const m = mergeable(parcels);
  if (!m) return null;
  const n = Math.min(m.parcels.length, CHECKOUT_MAX_PARCELS);
  return <div className="merge-banner">
    <span className="merge-stack" aria-hidden="true"><i/><i/><i/></span>
    <p><strong>{t('有 {0} 件包裹可以一起下单', { 0: m.parcels.length })}</strong><small>{t('多件下单：大小件、送到哪里都能混搭，一次支付还能享多件满减')}</small></p>
    <Link className="button" to="/parcel/merge">{t('多件下单 {0} 件', { 0: n })}<span aria-hidden="true"> ›</span></Link>
  </div>;
}
/** Small label on an order card. */
export function GroupChip({ order }: { order: Order }) {
  if (!order.groupId || (order.groupSize ?? 0) < 2) return null;
  return <span className="group-chip" title={t('合并配送：同一位配送员一次送达')}><SymbolIcon name="box"/>{t('合并 {0} 件', { 0: order.groupSize ?? 0 })}</span>;
}
/** On the order page: the other parcels of the same merged delivery, with the group page. */
export function GroupStrip({ order }: { order: Order }) {
  const [count, setCount] = useState(order.groupSize ?? 0);
  useEffect(() => setCount(order.groupSize ?? 0), [order.groupSize]);
  if (!order.groupId || count < 2) return null;
  return <Link className="group-strip" to={`/checkout-group/${order.groupId}`}>
    <span className="merge-stack" aria-hidden="true"><i/><i/><i/></span>
    <span><strong>{t('合并配送 · 共 {0} 件', { 0: count })}</strong><small>{order.ruleId ? t('由常用配送规则生成 · ') : ''}{t('同一位配送员一次送达，收货码相同，核验一次即全部签收')}</small></span>
    <span aria-hidden="true">›</span>
  </Link>;
}

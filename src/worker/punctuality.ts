import type { Env } from './types';
import { ApiError, json } from './http';
import { requireAdmin } from './session';
import { orderScope } from './order-access';
import { slotByCode, slotTime, type SlotCode } from '../shared/slots';
import { ASAP_TARGETS, PUNCTUALITY_DAYS, type PunctualityReport, type PunctualityRow, type WeatherLevel } from '../shared/v3';

/*
 * On-time dashboard (准时率看板). For every order first marked delivered in the range: a booked-window order is on
 * time when delivered by the end of its window; an "as soon as possible" order when delivered within the chosen target
 * after payment. Grouped by courier, building, window, day and the weather logged for that hour. Scoped like every other
 * admin view (a courier sees their own orders). Counts are exact; minutes are medians/averages of the rows shown.
 */
const now = () => Math.floor(Date.now() / 1000);
const DELIVERED = "('DELIVERED_DOWNSTAIRS','DELIVERED_TO_ROOM')";
const cnDate = (t: number) => new Date((t + 8 * 3600) * 1000).toISOString().slice(0, 10);
const cnHour = (t: number) => new Date((t + 8 * 3600) * 1000).toISOString().slice(0, 13);
const median = (v: number[]) => { if (!v.length) return null; const s = [...v].sort((a, b) => a - b), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const SLOT_NAMES: Record<string, string> = { NOON: '午间', EVENING: '傍晚', NIGHT: '晚间', ASAP: '尽快送达' };
const WEATHER_NAMES: Record<string, string> = { CLEAR: '无雨雪', WET: '雨雪', SEVERE: '恶劣天气', UNKNOWN: '无天气记录' };

type Row = { id: string; slotDate: string | null; slotCode: SlotCode | null; building: string | null; buildingCode: string; deliveredAt: number; paidAt: number | null; pickedAt: number | null; claimedAt: number | null; courier: string | null };

export async function punctuality(env: Env, admin: Parameters<typeof orderScope>[0], days: number, asapTarget: number): Promise<PunctualityReport> {
  const to = now(), from = to - days * 86400, scope = orderScope(admin);
  const rows = (await env.DB.prepare(`SELECT o.id,o.slot_date AS slotDate,o.slot_code AS slotCode,json_extract(o.dorm_snapshot_json,'$.buildingName') AS building,o.dorm_building_code AS buildingCode,
      (SELECT min(e.created_at) FROM order_events e WHERE e.order_id=o.id AND e.to_status IN ${DELIVERED}) AS deliveredAt,
      (SELECT min(p.created_at) FROM payments p WHERE p.order_id=o.id AND p.type='DELIVERY') AS paidAt,
      (SELECT min(e.created_at) FROM order_events e WHERE e.order_id=o.id AND e.to_status='PICKED_UP') AS pickedAt,
      (SELECT b.created_at FROM batch_items bi JOIN delivery_batches b ON b.id=bi.batch_id WHERE bi.order_id=o.id) AS claimedAt,
      (SELECT a.username FROM batch_items bi JOIN delivery_batches b ON b.id=bi.batch_id JOIN admin_users a ON a.id=b.assignee_admin_id WHERE bi.order_id=o.id) AS courier
    FROM delivery_orders o WHERE ${scope.sql} AND EXISTS(SELECT 1 FROM order_events e WHERE e.order_id=o.id AND e.to_status IN ${DELIVERED} AND e.created_at>=? AND e.created_at<?)
    ORDER BY o.id LIMIT 5000`).bind(...scope.params, from, to).all<Row>()).results.filter(r => r.deliveredAt >= from);
  let weather = new Map<string, WeatherLevel>();
  try {
    const logs = (await env.DB.prepare('SELECT hour,level FROM weather_log WHERE hour>=? AND hour<=?').bind(cnHour(from), cnHour(to)).all<{ hour: string; level: WeatherLevel }>()).results;
    weather = new Map(logs.map(l => [l.hour, l.level]));
  } catch (error) { if (!/no such table/i.test(String(error))) throw error; }

  type Scored = Row & { onTime: boolean; minutes: number | null; lateMinutes: number; slotKey: string; weatherKey: string };
  const scored: Scored[] = rows.map(r => {
    const slotKey = r.slotCode ?? 'ASAP';
    const deadline = r.slotDate && r.slotCode ? slotTime(r.slotDate, slotByCode(r.slotCode).end) : r.paidAt != null ? r.paidAt + asapTarget * 60 : null;
    const late = deadline == null ? 0 : Math.max(0, Math.round((r.deliveredAt - deadline) / 60));
    return { ...r, slotKey, onTime: deadline != null && r.deliveredAt <= deadline, lateMinutes: late, minutes: r.paidAt != null ? (r.deliveredAt - r.paidAt) / 60 : null, weatherKey: weather.get(cnHour(r.deliveredAt)) ?? 'UNKNOWN' };
  });
  const group = (key: (r: Scored) => string, label: (k: string, r: Scored) => string): PunctualityRow[] => {
    const m = new Map<string, { label: string; rows: Scored[] }>();
    for (const r of scored) { const k = key(r), g = m.get(k) ?? { label: label(k, r), rows: [] }; g.rows.push(r); m.set(k, g); }
    return [...m.entries()].map(([k, g]) => summary(k, g.label, g.rows)).sort((a, b) => b.delivered - a.delivered);
  };
  const summary = (key: string, label: string, list: Scored[]): PunctualityRow => {
    const mins = list.map(r => r.minutes).filter((v): v is number => v != null);
    return { key, label, delivered: list.length, onTime: list.filter(r => r.onTime).length, avgMinutes: mins.length ? Math.round(mins.reduce((a, b) => a + b, 0) / mins.length) : null };
  };
  const byDay = group(r => cnDate(r.deliveredAt), k => k.slice(5).replace('-', '/')).sort((a, b) => a.key.localeCompare(b.key));
  const claimWaits = scored.filter(r => r.claimedAt != null && r.paidAt != null && r.claimedAt >= r.paidAt).map(r => (r.claimedAt! - r.paidAt!) / 60);
  const rides = scored.filter(r => r.pickedAt != null && r.deliveredAt >= r.pickedAt).map(r => (r.deliveredAt - r.pickedAt!) / 60);
  const round = (v: number | null) => v == null ? null : Math.round(v);
  return {
    days, asapTarget, from, to,
    total: summary('ALL', '全部', scored),
    byCourier: group(r => r.courier ?? '—', k => k === '—' ? '已移除配送员' : k),
    byBuilding: group(r => r.buildingCode, (_, r) => r.building ?? r.buildingCode),
    bySlot: group(r => r.slotKey, k => SLOT_NAMES[k] ?? k),
    byDay,
    byWeather: group(r => r.weatherKey, k => WEATHER_NAMES[k] ?? k),
    claimMedian: round(median(claimWaits)), rideMedian: round(median(rides)),
    late: scored.filter(r => !r.onTime && r.lateMinutes > 0).sort((a, b) => b.lateMinutes - a.lateMinutes).slice(0, 12)
      .map(r => ({ id: r.id, building: r.building ?? r.buildingCode, courier: r.courier ?? '已移除配送员', slot: r.slotDate && r.slotCode ? `${r.slotDate.slice(5)} ${SLOT_NAMES[r.slotCode]}` : '尽快送达', lateMinutes: r.lateMinutes, deliveredAt: r.deliveredAt })),
  };
}

export async function punctualityRoutes(request: Request, env: Env): Promise<Response | null> {
  const url = new URL(request.url);
  if (url.pathname !== '/api/v1/admin/punctuality' || request.method !== 'GET') return null;
  const admin = await requireAdmin(request, env);
  const days = Number(url.searchParams.get('days') ?? 14), target = Number(url.searchParams.get('asap') ?? 60);
  if (!(PUNCTUALITY_DAYS as readonly number[]).includes(days) || !(ASAP_TARGETS as readonly number[]).includes(target)) throw new ApiError(400, 'INVALID_FILTER', '统计范围只支持 7、14、30 天，尽快送达目标只支持 45、60、90 分钟');
  return json({ report: await punctuality(env, admin, days, target) });
}

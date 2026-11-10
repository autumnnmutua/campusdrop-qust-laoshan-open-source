/* © 2026 专业团队 · CampusDrop v4.5.0 */
import type { Env } from './types';
import { json } from './http';
import { campusRoute, routeMeters, WALK_SPEED } from '../shared/campus-map';
import { slotByCode, slotTime, type SlotCode } from '../shared/slots';
import type { Impact, ImpactWindow } from '../shared/impact';

/*
 * v3.6 · 成效看板 (GET /impact, public). Aggregates only — no order, student or building is identifiable. Real orders
 * only (demo orders excluded). Walking saved is an estimate: the campus-road route from the parcel's station to the
 * dorm door (or the chosen drop-off point) and back, once per order group, at the map's scale. Actual delivery may be
 * split or occur at different times, so this is an estimate. On-time follows the on-time
 * dashboard's rule. Cached for five minutes.
 */
const now = () => Math.floor(Date.now() / 1000);
const cnDate = (t: number) => new Date((t + 8 * 3600) * 1000).toISOString().slice(0, 10);
const cnHour = (t: number) => new Date((t + 8 * 3600) * 1000).toISOString().slice(0, 13);
const DELIVERED = "('DELIVERED_DOWNSTAIRS','DELIVERED_TO_ROOM')";
type Row = { id: string; trip: string; userId: string; station: string; dest: string; groupId: string | null; deliveredAt: number; paidAt: number | null; slotDate: string | null; slotCode: SlotCode | null };

const legCache = new Map<string, number | null>();
function roundTripMeters(station: string, dest: string): number | null {
  const key = `${station}>${dest}`;
  if (!legCache.has(key)) { const path = campusRoute(station, dest); legCache.set(key, path ? routeMeters(path) * 2 : null); }
  return legCache.get(key)!;
}
function summarise(rows: Row[], wet: Map<string, string>): ImpactWindow {
  const trips = new Map<string, Row>();
  for (const r of rows) if (!trips.has(r.trip)) trips.set(r.trip, r);
  let meters = 0;
  for (const r of trips.values()) meters += roundTripMeters(r.station, r.dest) ?? 0;
  const round1 = (v: number) => Math.round(v * 10) / 10;
  return {
    deliveries: rows.length, trips: trips.size, walkKm: round1(meters / 1000), walkHours: round1(meters / WALK_SPEED / 3600),
    wetDeliveries: rows.filter(r => ['WET', 'SEVERE'].includes(wet.get(cnHour(r.deliveredAt)) ?? '')).length,
    students: new Set(rows.map(r => r.userId)).size,
  };
}

export async function impact(env: Env): Promise<Impact> {
  const t = now();
  const rows = (await env.DB.prepare(`SELECT o.id,coalesce(o.group_id,o.id) AS trip,o.user_id AS userId,o.station_code AS station,coalesce(o.drop_place,o.dorm_building_code) AS dest,o.group_id AS groupId,
      (SELECT min(e.created_at) FROM order_events e WHERE e.order_id=o.id AND e.to_status IN ${DELIVERED}) AS deliveredAt,
      (SELECT min(p.created_at) FROM payments p WHERE p.order_id=o.id AND p.type='DELIVERY') AS paidAt,o.slot_date AS slotDate,o.slot_code AS slotCode
    FROM delivery_orders o WHERE o.demo_group IS NULL AND o.status IN ('DELIVERED_DOWNSTAIRS','DELIVERED_TO_ROOM','COMPLETED')
    ORDER BY o.created_at DESC LIMIT 20000`).all<Row>()).results.filter(r => r.deliveredAt != null);
  let wet = new Map<string, string>();
  if (rows.length) {
    const first = Math.min(...rows.map(r => r.deliveredAt));
    try { wet = new Map((await env.DB.prepare('SELECT hour,level FROM weather_log WHERE hour>=?').bind(cnHour(first)).all<{ hour: string; level: string }>()).results.map(l => [l.hour, l.level])); }
    catch (error) { if (!/no such table/i.test(String(error))) throw error; }
  }
  const recent = rows.filter(r => r.deliveredAt >= t - 30 * 86400);
  const onTime = recent.filter(r => {
    const deadline = r.slotDate && r.slotCode ? slotTime(r.slotDate, slotByCode(r.slotCode).end) : r.paidAt != null ? r.paidAt + 3600 : null;
    return deadline != null && r.deliveredAt <= deadline;
  }).length;
  const groups = new Map<string, number>();
  for (const r of rows) if (r.groupId) groups.set(r.groupId, (groups.get(r.groupId) ?? 0) + 1);
  return {
    all: summarise(rows, wet), last7: summarise(rows.filter(r => r.deliveredAt >= t - 7 * 86400), wet),
    onTimeRate: recent.length >= 5 ? Math.round(onTime / recent.length * 100) : null, onTimeSample: recent.length,
    mergedParcels: [...groups.values()].filter(n => n > 1).reduce((a, b) => a + b, 0),
    since: rows.length ? cnDate(Math.min(...rows.map(r => r.deliveredAt))) : null, generatedAt: t,
  };
}

export async function impactRoutes(request: Request, env: Env): Promise<Response | null> {
  const path = new URL(request.url).pathname.replace(/^\/api\/v1/, '');
  if (path !== '/impact' || request.method !== 'GET') return null;
  return json({ impact: await impact(env) }, 200, new Headers({ 'Cache-Control': 'public, max-age=300' }));
}

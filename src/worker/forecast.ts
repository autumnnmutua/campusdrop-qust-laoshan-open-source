/* © 2026 专业团队 · CampusDrop v4.5.0 */
import type { Env } from './types';
import { json } from './http';
import { requireAdmin } from './session';
import { orderScope } from './order-access';
import { weatherInfo } from './weather';
import { bookableDates } from '../shared/slots';
import { addDays, asapWindow, buildForecast, FORECAST_SLOTS, type DayCounts, type ForecastSlotCode } from '../shared/forecast';

/*
 * v3.6 · 单量预测与排班建议 (GET /admin/forecast). Scoped like every admin view (a courier sees only orders they
 * delivered; demo accounts only their demo). The model itself lives in shared/forecast.ts. Shifts and staffing advice
 * are shown to super admins only, since only they schedule couriers.
 */
const now = () => Math.floor(Date.now() / 1000);
const CN = 8 * 3600;
const cnDate = (t: number) => new Date((t + CN) * 1000).toISOString().slice(0, 10);
const cnHourNum = (t: number) => new Date((t + CN) * 1000).getUTCHours();

export async function forecastRoutes(request: Request, env: Env): Promise<Response | null> {
  const path = new URL(request.url).pathname.replace(/^\/api\/v1/, '');
  if (path !== '/admin/forecast' || request.method !== 'GET') return null;
  const admin = await requireAdmin(request, env), scope = orderScope(admin), t = now(), today = cnDate(t), since = addDays(today, -56);
  const rows = (await env.DB.prepare(`SELECT o.slot_date AS slotDate,o.slot_code AS slotCode,min(p.created_at) AS paidAt,
      (SELECT b.assignee_admin_id FROM batch_items bi JOIN delivery_batches b ON b.id=bi.batch_id WHERE bi.order_id=o.id) AS courier
    FROM delivery_orders o JOIN payments p ON p.order_id=o.id AND p.type='DELIVERY'
    WHERE ${scope.sql} AND o.status<>'CANCELLED' GROUP BY o.id HAVING paidAt>=? LIMIT 20000`).bind(...scope.params, Date.parse(`${since}T00:00:00+08:00`) / 1000)
    .all<{ slotDate: string | null; slotCode: ForecastSlotCode | null; paidAt: number; courier: string | null }>()).results;
  const first = await env.DB.prepare(`SELECT min(p.created_at) AS t FROM delivery_orders o JOIN payments p ON p.order_id=o.id AND p.type='DELIVERY' WHERE ${scope.sql}`).bind(...scope.params).first<number>('t');
  const daily = new Map<string, DayCounts>(), perCourier = new Map<string, number>();
  for (const r of rows) {
    const date = r.slotDate && r.slotCode ? r.slotDate : cnDate(r.paidAt), code = r.slotCode && (FORECAST_SLOTS as readonly string[]).includes(r.slotCode) ? r.slotCode : asapWindow(cnHourNum(r.paidAt));
    const day = daily.get(date) ?? { NOON: 0, EVENING: 0, NIGHT: 0 }; day[code]++; daily.set(date, day);
    if (r.courier && date < today) perCourier.set(`${r.courier}|${date}|${code}`, (perCourier.get(`${r.courier}|${date}|${code}`) ?? 0) + 1);
  }
  const wetDays = new Set<string>();
  try {
    for (const l of (await env.DB.prepare("SELECT hour FROM weather_log WHERE hour>=? AND level IN ('WET','SEVERE')").bind(`${since}T00`).all<{ hour: string }>()).results) {
      const hour = Number(l.hour.slice(11, 13));
      if (hour >= 10 && hour <= 21) wetDays.add(l.hour.slice(0, 10));
    }
  } catch (error) { if (!/no such table/i.test(String(error))) throw error; }
  const weather = await weatherInfo(env).catch(() => null);
  let shifts: Map<string, number> | null = null;
  if (admin.role === 'SUPER_ADMIN') {
    // Staffing compares with the shifts of the same world: real couriers for a real super admin, the demo's own for a demo.
    const dates = bookableDates(t);
    shifts = new Map((await env.DB.prepare(`SELECT s.slot_date||s.slot_code AS k,count(*) AS n FROM courier_shifts s JOIN admin_users a ON a.id=s.admin_id
      WHERE a.status='ACTIVE' AND coalesce(a.demo_group,'')=coalesce((SELECT demo_group FROM admin_users WHERE id=?),'') AND s.slot_date IN (${dates.map(() => '?').join(',')}) GROUP BY s.slot_date,s.slot_code`).bind(admin.id, ...dates).all<{ k: string; n: number }>()).results.map(r => [r.k, r.n]));
  }
  const report = buildForecast({
    daily, firstDay: first ? cnDate(first) : null, today, wetDays,
    weatherNow: weather?.enabled ? weather.level : 'UNKNOWN', perCourierSamples: [...perCourier.values()], shifts, generatedAt: t,
  });
  return json({ forecast: report, staffing: shifts !== null });
}

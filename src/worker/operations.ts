import type { Env } from './types';
import { ApiError, body, json } from './http';
import { requireAdmin, requireStudent, requireSuper } from './session';
import { rateLimit } from './rate-limit';
import { orderScope } from './order-access';
import { publish } from './live';
import {
  maskWebhook, notifyGroup, orderingPause, readSetting, shiftCapacity, testWebhook, webhookSetting, writeSetting,
} from './settings';
import {
  COURIER_SHARE, DEFAULT_SHIFT_QUOTA, pauseSchema, shiftCapacitySchema, shiftsSchema, webhookSchema, webhookTestSchema,
  type BuildingHeat, type Forecast, type InsightsExtra, type MileageRow, type MonthReport, type SettlementRow, type Shift,
  type ShiftCapacity, type WebhookSetting, type YearReport,
} from '../shared/operations';
import { bookableDates, slotByCode, type SlotCode } from '../shared/slots';
import { campusRoute, planRoute, routeMeters, DROP_PLACE_LABELS, type DropPlace } from '../shared/campus-map';
import type { Admin } from '../shared/contracts';
import { ANALYTICS_RANGES } from './engagement';

/*
 * v2.7 operations endpoints: ordering pause, group webhook, courier shifts and shift-based capacity, mock settlement,
 * courier mileage, auto-batch planning, the building heat board, the student's year report and the monthly report.
 * Numbers are computed from the database at request time; nothing here is an estimate presented as a fact — walking
 * distances are labelled as route estimates and forecasts as averages of past weeks.
 */
const DAY = 86400, CN = 8 * 3600;
const now = () => Math.floor(Date.now() / 1000);
const cnDate = (t: number) => new Date((t + CN) * 1000).toISOString().slice(0, 10);
const dayStart = (date: string) => Date.parse(`${date}T00:00:00+08:00`) / 1000;
const PAID = "EXISTS(SELECT 1 FROM payments p WHERE p.order_id=o.id AND p.type='DELIVERY')";
const DELIVERED = "('DELIVERED_DOWNSTAIRS','DELIVERED_TO_ROOM')";
const roundTrip = (station: string, dest: string) => { const r = campusRoute(station, dest); return r ? routeMeters(r) * 2 : null; };

// ---------------------------------------------------------------- settlement (模拟结算), Monday-based weeks
function weekRange(param: string | null): { from: number; to: number; monday: string } {
  const today = cnDate(now());
  const base = param && /^\d{4}-\d{2}-\d{2}$/.test(param) ? param : today;
  const d = new Date(`${base}T00:00:00+08:00`), weekday = (new Date((dayStart(base) + CN) * 1000).getUTCDay() + 6) % 7;
  if (Number.isNaN(d.getTime())) throw new ApiError(400, 'INVALID_FILTER', '日期格式不正确');
  const from = dayStart(base) - weekday * DAY;
  return { from, to: from + 7 * DAY, monday: cnDate(from) };
}
async function settlement(env: Env, admin: Admin, week: string | null) {
  const { from, to, monday } = weekRange(week), scope = orderScope(admin);
  const own = admin.role === 'DELIVERY_STAFF' ? ' AND b.assignee_admin_id=?' : '';
  const deliveries = (await env.DB.prepare(`SELECT b.assignee_admin_id AS adminId,a.username,count(*) AS n,sum(o.amount_fen+o.delivery_upgrade_fen+o.upgrade_surcharge_fen) AS fen
    FROM delivery_orders o JOIN batch_items bi ON bi.order_id=o.id JOIN delivery_batches b ON b.id=bi.batch_id JOIN admin_users a ON a.id=b.assignee_admin_id
    WHERE ${PAID} AND ${scope.sql} AND o.status IN ('DELIVERED_DOWNSTAIRS','DELIVERED_TO_ROOM','COMPLETED')
    AND (SELECT max(e.created_at) FROM order_events e WHERE e.order_id=o.id AND e.to_status IN ${DELIVERED}) BETWEEN ? AND ?${own} GROUP BY b.assignee_admin_id`)
    .bind(...scope.params, from, to - 1, ...(own ? [admin.id] : [])).all<{ adminId: string; username: string; n: number; fen: number }>()).results;
  const tips = (await env.DB.prepare(`SELECT b.assignee_admin_id AS adminId,sum(p.amount_fen) AS fen FROM payments p JOIN delivery_orders o ON o.id=p.order_id
    JOIN batch_items bi ON bi.order_id=o.id JOIN delivery_batches b ON b.id=bi.batch_id WHERE p.type='TIP' AND p.created_at BETWEEN ? AND ? AND ${scope.sql}${own} GROUP BY b.assignee_admin_id`)
    .bind(from, to - 1, ...scope.params, ...(own ? [admin.id] : [])).all<{ adminId: string; fen: number }>()).results;
  const sends = (await env.DB.prepare(`SELECT s.assignee_admin_id AS adminId,a.username,count(*) AS n,sum(s.amount_fen) AS fen FROM send_requests s JOIN admin_users a ON a.id=s.assignee_admin_id
    WHERE s.status='DROPPED' AND s.dropped_at BETWEEN ? AND ?${admin.role === 'DELIVERY_STAFF' ? ' AND s.assignee_admin_id=?' : ''} GROUP BY s.assignee_admin_id`)
    .bind(from, to - 1, ...(admin.role === 'DELIVERY_STAFF' ? [admin.id] : [])).all<{ adminId: string; username: string; n: number; fen: number }>().catch(() => ({ results: [] }))).results;
  const rows = new Map<string, SettlementRow>();
  const row = (id: string, username: string) => { if (!rows.has(id)) rows.set(id, { adminId: id, username, deliveries: 0, deliveryFen: 0, sends: 0, sendFen: 0, tipFen: 0, payoutFen: 0 }); return rows.get(id)!; };
  for (const d of deliveries) Object.assign(row(d.adminId, d.username), { deliveries: d.n, deliveryFen: d.fen });
  // Sends are counted only for super admins and the couriers themselves (send requests are not scoped by building).
  if (admin.role === 'SUPER_ADMIN' || admin.role === 'DELIVERY_STAFF') for (const s of sends) Object.assign(row(s.adminId, s.username), { sends: s.n, sendFen: s.fen });
  for (const t of tips) if (rows.has(t.adminId)) rows.get(t.adminId)!.tipFen = t.fen;
  for (const r of rows.values()) r.payoutFen = Math.round((r.deliveryFen + r.sendFen) * COURIER_SHARE) + r.tipFen;
  return { week: monday, from, to, share: COURIER_SHARE, rows: [...rows.values()].sort((a, b) => b.payoutFen - a.payoutFen) };
}

// ---------------------------------------------------------------- courier mileage (route estimate, round trip)
async function mileage(env: Env, admin: Admin, date: string | null): Promise<{ date: string; rows: MileageRow[] }> {
  const day = date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : cnDate(now()), from = dayStart(day), scope = orderScope(admin);
  const rows = (await env.DB.prepare(`SELECT b.assignee_admin_id AS adminId,a.username,o.station_code AS station,COALESCE(o.drop_place,o.dorm_building_code) AS dest
    FROM delivery_orders o JOIN batch_items bi ON bi.order_id=o.id JOIN delivery_batches b ON b.id=bi.batch_id JOIN admin_users a ON a.id=b.assignee_admin_id
    WHERE ${PAID} AND ${scope.sql} AND EXISTS(SELECT 1 FROM order_events e WHERE e.order_id=o.id AND e.to_status IN ${DELIVERED} AND e.created_at BETWEEN ? AND ?)`)
    .bind(...scope.params, from, from + DAY - 1).all<{ adminId: string; username: string; station: string; dest: string }>()).results;
  const out = new Map<string, MileageRow>();
  for (const r of rows) {
    const m = out.get(r.adminId) ?? { adminId: r.adminId, username: r.username, deliveries: 0, meters: 0, unplaced: 0 };
    const meters = roundTrip(r.station, r.dest);
    m.deliveries++; if (meters === null) m.unplaced++; else m.meters += meters;
    out.set(r.adminId, m);
  }
  return { date: day, rows: [...out.values()].sort((a, b) => b.meters - a.meters) };
}

// ---------------------------------------------------------------- auto-batch planning (一键排线)
async function batchPlan(env: Env, admin: Admin, slot: string | null) {
  if (admin.role === 'DELIVERY_STAFF') throw new ApiError(403, 'FORBIDDEN', '配送人员不能分配任务');
  const scope = orderScope(admin);
  let filter = 'o.slot_date IS NULL', params: string[] = [];
  if (slot && slot !== 'ASAP') {
    const m = /^(\d{4}-\d{2}-\d{2}):(NOON|EVENING|NIGHT)$/.exec(slot);
    if (!m) throw new ApiError(400, 'INVALID_FILTER', '时段格式不正确');
    filter = 'o.slot_date=? AND o.slot_code=?'; params = [m[1], m[2]];
  }
  const rows = (await env.DB.prepare(`SELECT o.id,o.station_code AS station,COALESCE(o.drop_place,o.dorm_building_code) AS dest,o.drop_place AS dropPlace,
      json_extract(o.dorm_snapshot_json,'$.buildingName') AS buildingName,o.package_size AS packageSize,
      CASE WHEN o.delivery_upgrade_fen>0 THEN 'ROOM' ELSE o.delivery_mode END AS deliveryMode,o.created_at AS createdAt
    FROM delivery_orders o WHERE o.status='WAITING_PICKUP' AND o.student_deleted=0 AND NOT EXISTS(SELECT 1 FROM batch_items WHERE order_id=o.id)
    AND ${PAID} AND ${filter} AND ${scope.sql} ORDER BY o.created_at LIMIT 200`).bind(...params, ...scope.params)
    .all<{ id: string; station: string; dest: string; dropPlace: DropPlace | null; buildingName: string; packageSize: string; deliveryMode: string; createdAt: number }>()).results;
  if (!rows.length) return { orders: [], plan: null, remaining: 0, station: null };
  // One batch = one station; take the station with the most waiting orders, oldest orders first, at most 20.
  const byStation = new Map<string, typeof rows>();
  for (const r of rows) byStation.set(r.station, [...(byStation.get(r.station) ?? []), r]);
  const [station, group] = [...byStation.entries()].sort((a, b) => b[1].length - a[1].length)[0];
  const picked = group.slice(0, 20), plan = planRoute(station, picked.map(r => r.dest));
  const rank = new Map(plan.order.map((code, i) => [code, i]));
  picked.sort((a, b) => (rank.get(a.dest)! - rank.get(b.dest)!) || a.createdAt - b.createdAt);
  return {
    station, plan, remaining: rows.length - picked.length,
    orders: picked.map(r => ({ id: r.id, dest: r.dest, label: r.dropPlace ? DROP_PLACE_LABELS[r.dropPlace] : r.buildingName, packageSize: r.packageSize, deliveryMode: r.deliveryMode })),
  };
}

// ---------------------------------------------------------------- building heat board (public, aggregated)
async function buildingHeat(env: Env): Promise<{ days: number; buildings: BuildingHeat[] }> {
  const since = now() - 7 * DAY;
  const rows = (await env.DB.prepare(`SELECT o.dorm_building_code AS code,(SELECT display_name FROM dorm_buildings WHERE code=o.dorm_building_code) AS name,count(*) AS orders
    FROM delivery_orders o WHERE ${PAID} AND o.created_at>=? GROUP BY o.dorm_building_code HAVING count(*)>=3 ORDER BY orders DESC,code LIMIT 5`).bind(since).all<BuildingHeat>()).results;
  // Buildings with fewer than three orders are left out so a single student's activity cannot be singled out.
  return { days: 7, buildings: rows };
}

// ---------------------------------------------------------------- student year report
async function yearReport(env: Env, userId: string, year: number): Promise<YearReport> {
  const from = dayStart(`${year}-01-01`), to = dayStart(`${year + 1}-01-01`);
  const [parcels, orders, carriers, slots, hours, sends, ratings, routes] = await env.DB.batch([
    env.DB.prepare('SELECT count(*) AS n FROM parcels WHERE user_id=? AND created_at BETWEEN ? AND ?').bind(userId, from, to - 1),
    env.DB.prepare(`SELECT count(*) AS orders,coalesce(sum(o.status='COMPLETED'),0) AS completed,coalesce(sum(o.delivery_mode='ROOM' OR o.delivery_upgrade_fen>0),0) AS room,
      coalesce(sum(o.package_size='LARGE'),0) AS large,coalesce(sum(o.drop_place IS NOT NULL),0) AS dropPlaces,min(o.created_at) AS firstAt,max(o.created_at) AS lastAt
      FROM delivery_orders o WHERE o.user_id=? AND ${PAID} AND o.created_at BETWEEN ? AND ?`).bind(userId, from, to - 1),
    env.DB.prepare("SELECT carrier,count(*) AS n FROM parcels WHERE user_id=? AND carrier IS NOT NULL AND carrier<>'其他' AND created_at BETWEEN ? AND ? GROUP BY carrier ORDER BY n DESC LIMIT 1").bind(userId, from, to - 1),
    env.DB.prepare(`SELECT o.slot_code AS code,count(*) AS n FROM delivery_orders o WHERE o.user_id=? AND ${PAID} AND o.slot_code IS NOT NULL AND o.created_at BETWEEN ? AND ? GROUP BY o.slot_code ORDER BY n DESC LIMIT 1`).bind(userId, from, to - 1),
    env.DB.prepare(`SELECT cast(strftime('%H',o.created_at+${CN},'unixepoch') AS INTEGER) AS h,count(*) AS n FROM delivery_orders o WHERE o.user_id=? AND ${PAID} AND o.created_at BETWEEN ? AND ? GROUP BY h ORDER BY n DESC LIMIT 1`).bind(userId, from, to - 1),
    env.DB.prepare("SELECT count(*) AS n FROM send_requests WHERE user_id=? AND status<>'CANCELLED' AND created_at BETWEEN ? AND ?").bind(userId, from, to - 1),
    env.DB.prepare('SELECT count(*) AS n FROM order_ratings WHERE user_id=? AND created_at BETWEEN ? AND ?').bind(userId, from, to - 1),
    env.DB.prepare(`SELECT o.station_code AS station,COALESCE(o.drop_place,o.dorm_building_code) AS dest FROM delivery_orders o WHERE o.user_id=? AND o.status='COMPLETED' AND o.created_at BETWEEN ? AND ?`).bind(userId, from, to - 1),
  ]);
  const o = orders.results[0] as { orders: number; completed: number; room: number; large: number; dropPlaces: number; firstAt: number | null; lastAt: number | null };
  const meters = (routes.results as { station: string; dest: string }[]).reduce((s, r) => s + (roundTrip(r.station, r.dest) ?? 0), 0);
  const slot = (slots.results[0] as { code: SlotCode } | undefined)?.code;
  return {
    year, parcels: (parcels.results[0] as { n: number }).n, orders: o.orders, completed: o.completed, room: o.room, large: o.large, dropPlaces: o.dropPlaces,
    sends: (sends.results[0] as { n: number }).n, topCarrier: (carriers.results[0] as { carrier: string } | undefined)?.carrier ?? null,
    busiestSlot: slot ? slotByCode(slot).label : null, busiestHour: (hours.results[0] as { h: number } | undefined)?.h ?? null,
    firstAt: o.firstAt, lastAt: o.lastAt, meters, ratings: (ratings.results[0] as { n: number }).n,
  };
}

// ---------------------------------------------------------------- monthly operations report
async function monthReport(env: Env, admin: Admin, month: string): Promise<MonthReport> {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new ApiError(400, 'INVALID_FILTER', '月份格式应为 2026-10');
  const [y, m] = month.split('-').map(Number), from = dayStart(`${month}-01`), next = m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`, to = dayStart(`${next}-01`);
  const days = Math.round((to - from) / DAY), scope = orderScope(admin);
  const q = (sql: string, ...extra: (string | number)[]) => env.DB.prepare(sql).bind(...scope.params, ...extra);
  const scoped = `FROM delivery_orders o WHERE ${scope.sql} AND o.created_at BETWEEN ? AND ?`;
  const [totals, daily, buildings, slots, speed, ratings, staff] = await env.DB.batch([
    q(`SELECT count(*) AS orders,coalesce(sum(${PAID}),0) AS paid,coalesce(sum(o.status='COMPLETED'),0) AS completed,coalesce(sum(o.status='CANCELLED' AND ${PAID}),0) AS cancelled,
      coalesce(sum(EXISTS(SELECT 1 FROM order_events e WHERE e.order_id=o.id AND e.to_status IN ('FAILED_PICKUP','DELIVERY_EXCEPTION'))),0) AS exceptions ${scoped}`, from, to - 1),
    q(`SELECT date(o.created_at+${CN},'unixepoch') AS day,count(*) AS count ${scoped} AND ${PAID} GROUP BY day ORDER BY day`, from, to - 1),
    q(`SELECT coalesce(json_extract(o.dorm_snapshot_json,'$.buildingName'),o.dorm_building_code) AS building,count(*) AS count ${scoped} AND ${PAID} GROUP BY building ORDER BY count DESC LIMIT 8`, from, to - 1),
    q(`SELECT coalesce(o.slot_code,'ASAP') AS code,count(*) AS count ${scoped} AND ${PAID} GROUP BY code ORDER BY count DESC`, from, to - 1),
    q(`SELECT avg(done-start)/60.0 AS minutes FROM (SELECT (SELECT min(e.created_at) FROM order_events e WHERE e.order_id=o.id AND e.to_status='WAITING_PICKUP') AS start,
      (SELECT max(e.created_at) FROM order_events e WHERE e.order_id=o.id AND e.to_status IN ${DELIVERED}) AS done ${scoped}) WHERE start IS NOT NULL AND done>=start`, from, to - 1),
    q(`SELECT avg(r.stars) AS stars,count(*) AS n FROM order_ratings r JOIN delivery_orders o ON o.id=r.order_id WHERE ${scope.sql} AND r.created_at BETWEEN ? AND ?`, from, to - 1),
    q(`SELECT a.username AS name,count(*) AS delivered FROM delivery_orders o JOIN batch_items bi ON bi.order_id=o.id JOIN delivery_batches b ON b.id=bi.batch_id JOIN admin_users a ON a.id=b.assignee_admin_id
      WHERE ${scope.sql} AND o.status IN ('DELIVERED_DOWNSTAIRS','DELIVERED_TO_ROOM','COMPLETED') AND o.created_at BETWEEN ? AND ? GROUP BY a.id ORDER BY delivered DESC LIMIT 8`, from, to - 1),
  ]);
  const t = totals.results[0] as { orders: number; paid: number; completed: number; cancelled: number; exceptions: number };
  const r = ratings.results[0] as { stars: number | null; n: number }, minutes = (speed.results[0] as { minutes: number | null } | undefined)?.minutes ?? null;
  const sends = admin.role === 'SUPER_ADMIN' ? await env.DB.prepare("SELECT count(*) AS n FROM send_requests WHERE status='DROPPED' AND created_at BETWEEN ? AND ?").bind(from, to - 1).first<number>('n').catch(() => 0) ?? 0 : 0;
  const newStudents = admin.role === 'SUPER_ADMIN' ? await env.DB.prepare('SELECT count(*) AS n FROM users WHERE created_at BETWEEN ? AND ? AND deleted_at IS NULL').bind(from, to - 1).first<number>('n') ?? 0 : null;
  const byDay = new Map((daily.results as { day: string; count: number }[]).map(d => [d.day, d.count]));
  return {
    month, days, orders: t.orders, paid: t.paid, completed: t.completed, cancelled: t.cancelled, exceptions: t.exceptions,
    avgMinutes: minutes === null ? null : Math.round(minutes), avgStars: r.stars === null ? null : Math.round(r.stars * 10) / 10, ratings: r.n, sends, newStudents,
    daily: Array.from({ length: days }, (_, i) => { const day = cnDate(from + i * DAY); return { day, count: byDay.get(day) ?? 0 }; }),
    buildings: buildings.results as { building: string; count: number }[], slots: slots.results as { code: string; count: number }[], staff: staff.results as { name: string; delivered: number }[],
  };
}

// ---------------------------------------------------------------- analytics: funnel, repeat rate, reach, forecast
async function insightsExtra(env: Env, admin: Admin, days: number): Promise<InsightsExtra> {
  const today = dayStart(cnDate(now())), since = today - (days - 1) * DAY, scope = orderScope(admin);
  const q = (sql: string, ...extra: (string | number)[]) => env.DB.prepare(sql).bind(...scope.params, ...extra);
  const [funnel, students, reach, history] = await env.DB.batch([
    q(`SELECT count(*) AS orders,coalesce(sum(${PAID}),0) AS paid,
      coalesce(sum(o.status IN ('DELIVERED_DOWNSTAIRS','DELIVERED_TO_ROOM','COMPLETED')),0) AS delivered,coalesce(sum(o.status='COMPLETED'),0) AS completed,
      coalesce(sum(EXISTS(SELECT 1 FROM order_ratings r WHERE r.order_id=o.id)),0) AS rated FROM delivery_orders o WHERE ${scope.sql} AND o.created_at>=?`, since),
    q(`SELECT count(*) AS students,coalesce(sum(n>=2),0) AS repeaters FROM (SELECT o.user_id,count(*) AS n FROM delivery_orders o WHERE ${scope.sql} AND ${PAID} AND o.created_at>=? GROUP BY o.user_id)`, since),
    q(`SELECT coalesce(json_extract(o.dorm_snapshot_json,'$.buildingName'),o.dorm_building_code) AS building,count(DISTINCT o.user_id) AS students,count(*) AS orders
      FROM delivery_orders o WHERE ${scope.sql} AND ${PAID} AND o.created_at>=? GROUP BY building ORDER BY students DESC,orders DESC LIMIT 10`, since),
    // Last four full weeks, per Beijing date and hour, for the "same weekday" forecast.
    q(`SELECT date(o.created_at+${CN},'unixepoch') AS day,cast(strftime('%H',o.created_at+${CN},'unixepoch') AS INTEGER) AS hour,count(*) AS n
      FROM delivery_orders o WHERE ${scope.sql} AND ${PAID} AND o.created_at>=? AND o.created_at<? GROUP BY day,hour`, today - 28 * DAY, today),
  ]);
  const parcels = admin.role === 'SUPER_ADMIN' ? await env.DB.prepare('SELECT count(*) AS n FROM parcels WHERE created_at>=?').bind(since).first<number>('n') : null;
  const f = funnel.results[0] as InsightsExtra['funnel'], s = students.results[0] as { students: number; repeaters: number };
  const firstOrder = await env.DB.prepare(`SELECT min(o.created_at) AS t FROM delivery_orders o WHERE ${scope.sql} AND ${PAID}`).bind(...scope.params).first<number>('t');
  const rows = history.results as { day: string; hour: number; n: number }[];
  const forecast: Forecast[] = [0, 1, 2].map(offset => {
    const date = cnDate(today + offset * DAY + 3600), weekday = new Date((dayStart(date) + CN) * 1000).getUTCDay();
    // The same weekday in each of the last four weeks, counted only for weeks the service already existed.
    const sameDays = [1, 2, 3, 4].map(w => cnDate(dayStart(date) - w * 7 * DAY + 3600)).filter(d => firstOrder !== null && dayStart(d) + DAY > firstOrder);
    const perDay = sameDays.map(d => rows.filter(r => r.day === d).reduce((sum, r) => sum + r.n, 0));
    const hours = new Map<number, number>();
    for (const r of rows) if (sameDays.includes(r.day)) hours.set(r.hour, (hours.get(r.hour) ?? 0) + r.n);
    const peak = [...hours.entries()].sort((a, b) => b[1] - a[1])[0];
    return { date, weekday, samples: sameDays.length, expected: sameDays.length ? Math.round(perDay.reduce((a, b) => a + b, 0) / sameDays.length * 10) / 10 : 0, peakHour: peak ? peak[0] : null };
  });
  return {
    funnel: { ...f, parcels }, students: s.students, repeatRate: s.students ? Math.round(s.repeaters / s.students * 1000) / 10 : null,
    buildingsReached: reach.results as InsightsExtra['buildingsReached'], forecast,
  };
}

// ---------------------------------------------------------------- shifts
async function listShifts(env: Env): Promise<Shift[]> {
  const dates = bookableDates(now());
  return (await env.DB.prepare(`SELECT s.admin_id AS adminId,a.username,s.slot_date AS date,s.slot_code AS code FROM courier_shifts s JOIN admin_users a ON a.id=s.admin_id
    WHERE a.status='ACTIVE' AND s.slot_date IN (${dates.map(() => '?').join(',')}) ORDER BY s.slot_date,s.slot_code,a.username`).bind(...dates).all<Shift>()).results;
}

export async function operationsRoutes(request: Request, env: Env): Promise<Response | null> {
  const url = new URL(request.url), path = url.pathname.replace('/api/v1', ''), method = request.method;

  if (path === '/stats/buildings' && method === 'GET') return json(await buildingHeat(env));
  if (path === '/me/report' && method === 'GET') {
    const user = await requireStudent(request, env), year = Number(url.searchParams.get('year') ?? new Date((now() + 8 * 3600) * 1000).getUTCFullYear());
    if (!Number.isInteger(year) || year < 2024 || year > 2100) throw new ApiError(400, 'INVALID_FILTER', '年份不正确');
    return json({ report: await yearReport(env, user.id, year) });
  }

  if (!path.startsWith('/admin/')) return null;
  if (!/^\/admin\/(settings|shifts|settlement|mileage|report|insights|batches\/plan)(\/|$)/.test(path)) return null;
  const admin = await requireAdmin(request, env);

  if (path === '/admin/settings/pause') {
    if (method === 'GET') return json({ pause: await orderingPause(env) });
    if (method === 'PUT') {
      requireSuper(admin);
      const data = await body(request, pauseSchema), value = { ...data, since: data.paused ? now() : null };
      await env.DB.batch([writeSetting(env, 'ordering_pause', value, admin.id),
        env.DB.prepare("INSERT INTO audit_logs(id,actor_type,actor_id,action,resource_id,metadata_redacted) VALUES(?,'ADMIN',?,?,'ordering_pause',json_object('reason',?))")
          .bind(crypto.randomUUID(), admin.id, data.paused ? 'ORDERING_PAUSED' : 'ORDERING_RESUMED', data.reason)]);
      await notifyGroup(env, 'PAUSE', data.paused ? `已暂停接单：${data.reason}` : '已恢复接单');
      return json({ pause: value });
    }
  }
  if (path === '/admin/settings/webhook') {
    requireSuper(admin);
    if (method === 'GET') { const s = await webhookSetting(env); return json({ webhook: s ? { ...s, url: maskWebhook(s.url) } : null }); }
    if (method === 'PUT') {
      const data = await body(request, webhookSchema) as WebhookSetting;
      await env.DB.batch([writeSetting(env, 'webhook', data, admin.id),
        env.DB.prepare("INSERT INTO audit_logs(id,actor_type,actor_id,action,resource_id) VALUES(?,'ADMIN',?,'WEBHOOK_UPDATED','webhook')").bind(crypto.randomUUID(), admin.id)]);
      return json({ webhook: { ...data, url: maskWebhook(data.url) } });
    }
    if (method === 'DELETE') { await env.DB.prepare("DELETE FROM app_settings WHERE key='webhook'").run(); return json({ webhook: null }); }
  }
  if (path === '/admin/settings/webhook/test' && method === 'POST') {
    requireSuper(admin); await body(request, webhookTestSchema); await rateLimit(env, `webhook-test:${admin.id}`, 10);
    const setting = await webhookSetting(env);
    if (!setting) throw new ApiError(409, 'WEBHOOK_MISSING', '请先保存机器人地址');
    return json({ ok: await testWebhook(setting) });
  }
  if (path === '/admin/settings/shift-capacity') {
    if (method === 'GET') return json({ shiftCapacity: (await shiftCapacity(env)) ?? { enabled: false, quota: DEFAULT_SHIFT_QUOTA } });
    if (method === 'PUT') {
      requireSuper(admin);
      const data = await body(request, shiftCapacitySchema) as ShiftCapacity;
      await writeSetting(env, 'shift_capacity', data, admin.id).run();
      return json({ shiftCapacity: data });
    }
  }
  if (path === '/admin/shifts') {
    if (method === 'GET') return json({ shifts: await listShifts(env), dates: bookableDates(now()), shiftCapacity: (await readSetting<ShiftCapacity>(env, 'shift_capacity')) ?? { enabled: false, quota: DEFAULT_SHIFT_QUOTA } });
    if (method === 'PUT') {
      const data = await body(request, shiftsSchema), dates = bookableDates(now());
      if (data.slots.some(s => !dates.includes(s.date))) throw new ApiError(400, 'INVALID_INPUT', '只能登记今天到后天的班次');
      await env.DB.batch([
        env.DB.prepare(`DELETE FROM courier_shifts WHERE admin_id=? AND slot_date IN (${dates.map(() => '?').join(',')})`).bind(admin.id, ...dates),
        ...data.slots.map(s => env.DB.prepare('INSERT INTO courier_shifts(admin_id,slot_date,slot_code) VALUES(?,?,?)').bind(admin.id, s.date, s.code)),
      ]);
      // Capacity may have changed for students looking at the slot picker; the hub only relays "something changed".
      await publish(env, `admin:${admin.id}`, { type: 'hello' }).catch(() => {});
      return json({ shifts: await listShifts(env) });
    }
  }
  if (path === '/admin/settlement' && method === 'GET') return json(await settlement(env, admin, url.searchParams.get('week')));
  if (path === '/admin/mileage' && method === 'GET') return json(await mileage(env, admin, url.searchParams.get('date')));
  if (path === '/admin/report' && method === 'GET') {
    const month = url.searchParams.get('month') ?? cnDate(now()).slice(0, 7);
    return json({ report: await monthReport(env, admin, month), generatedAt: now() });
  }
  if (path === '/admin/insights' && method === 'GET') {
    const days = Number(url.searchParams.get('days') ?? 14);
    if (!(ANALYTICS_RANGES as readonly number[]).includes(days)) throw new ApiError(400, 'INVALID_FILTER', '统计范围只支持 7、14、30 天');
    return json({ insights: await insightsExtra(env, admin, days) });
  }
  if (path === '/admin/batches/plan' && method === 'GET') return json(await batchPlan(env, admin, url.searchParams.get('slot')));
  return null;
}

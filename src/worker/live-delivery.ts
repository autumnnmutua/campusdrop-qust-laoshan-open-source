import type { Env } from './types';
import type { Admin } from '../shared/contracts';
import { CAMPUS_ID } from '../shared/constants';
import { ApiError, body, json } from './http';
import { requireAdmin, requireStudent, requireSuper } from './session';
import { rateLimit } from './rate-limit';
import { requireContact } from './admin-contact';
import { adminOrder, orderScope } from './order-access';
import { ownOrder, serializeOrder, type OrderRow } from './orders';
import { background } from './background';
import { publish } from './live';
import { sendPush } from './push';
import { calibrationSchema, chatMessageSchema, handoffCodeSchema, locationSchema, type ChatMessage, type CourierPosition, type LiveMapData, type OrderEta, type OrderLive } from '../shared/live';
import { bookableDates, DELIVERY_SLOTS, slotByCode, slotLabel, slotTime, type SlotAvailability, type SlotCode } from '../shared/slots';
import { campusRoute, landmarkPoint, pointAlong, projectGps, routeMinutes, calibrationUsable, type Calibration } from '../shared/campus-map';

const now = () => Math.floor(Date.now() / 1000);
const CLOSED = ['COMPLETED', 'CANCELLED'];

async function assigneeOf(env: Env, orderId: string): Promise<string | null> {
  return env.DB.prepare('SELECT b.assignee_admin_id AS id FROM batch_items bi JOIN delivery_batches b ON b.id=bi.batch_id WHERE bi.order_id=?').bind(orderId).first<string>('id');
}

// ---------------------------------------------------------------- handoff code (收货码)

/** Student-only: the code is never part of admin order payloads, so a courier can only learn it from the student. */
export async function handoffCodeFor(env: Env, row: OrderRow): Promise<string | null> {
  if (CLOSED.includes(row.status) || row.status === 'WAITING_PAYMENT') return null;
  return env.DB.prepare('SELECT handoff_code AS code FROM delivery_orders WHERE id=?').bind(row.id).first<string>('code');
}

/** Courier enters the code at the door: marks the order delivered (if not yet) and signs for it in one transaction. */
async function verifyHandoff(env: Env, admin: Admin, id: string, code: string, version: number) {
  await requireContact(env, admin.id);
  const row = await adminOrder(env, admin, id);
  if (!['OUT_FOR_DELIVERY', 'DELIVERED_DOWNSTAIRS', 'DELIVERED_TO_ROOM'].includes(row.status)) throw new ApiError(409, 'HANDOFF_NOT_READY', '出发配送后才能核验收货码');
  if (row.version !== version) throw new ApiError(409, 'STALE_ORDER', '订单已更新，请刷新后重试');
  if (row.pendingHandoff) throw new ApiError(409, 'HANDOFF_PENDING', '包裹交接处理中，请先完成交接核验');
  await rateLimit(env, `handoff-code:${id}`, 6);
  const stored = await env.DB.prepare('SELECT handoff_code AS code FROM delivery_orders WHERE id=?').bind(id).first<string>('code');
  if (!stored || stored !== code) throw new ApiError(400, 'HANDOFF_CODE_WRONG', '收货码不正确，请让同学打开订单详情核对（15 分钟内最多尝试 6 次）');
  const scope = orderScope(admin), delivered = row.deliveryMode === 'ROOM' ? 'DELIVERED_TO_ROOM' : 'DELIVERED_DOWNSTAIRS';
  const statements: D1PreparedStatement[] = [];
  if (row.status === 'OUT_FOR_DELIVERY') statements.push(env.DB.prepare(`UPDATE delivery_orders AS o SET status=?,version=version+1,updated_at=unixepoch(),last_actor_type='ADMIN',last_actor_id=?,service_notice=''
    WHERE id=? AND version=? AND handoff_code=? AND ${scope.sql}`).bind(delivered, admin.id, id, version, code, ...scope.params));
  statements.push(env.DB.prepare(`UPDATE delivery_orders AS o SET status='COMPLETED',received_at=unixepoch(),handoff_verified_at=unixepoch(),version=version+1,updated_at=unixepoch(),last_actor_type='ADMIN',last_actor_id=?
    WHERE id=? AND version=? AND status IN ('DELIVERED_DOWNSTAIRS','DELIVERED_TO_ROOM') AND handoff_code=? AND ${scope.sql} RETURNING id`)
    .bind(admin.id, id, row.status === 'OUT_FOR_DELIVERY' ? version + 1 : version, code, ...scope.params));
  const results = await env.DB.batch(statements);
  if (!results[results.length - 1].results.length) throw new ApiError(409, 'STALE_ORDER', '订单已更新，请刷新后重试');
  return serializeOrder(await adminOrder(env, admin, id));
}

// ---------------------------------------------------------------- delivery slots

export async function slotAvailability(env: Env): Promise<{ now: number; slots: SlotAvailability[] }> {
  const t = now(), dates = bookableDates(t);
  const rows = (await env.DB.prepare(`SELECT slot_date AS date,slot_code AS code,count(*) AS booked FROM delivery_orders WHERE slot_date IN (${dates.map(() => '?').join(',')}) AND status<>'CANCELLED' GROUP BY slot_date,slot_code`)
    .bind(...dates).all<{ date: string; code: SlotCode; booked: number }>()).results;
  const slots = dates.flatMap(date => DELIVERY_SLOTS.map(slot => {
    const booked = rows.find(r => r.date === date && r.code === slot.code)?.booked ?? 0;
    return { date, code: slot.code, booked, capacity: slot.capacity, open: booked < slot.capacity && slotTime(date, slot.start) - 30 * 60 > t };
  }));
  return { now: t, slots };
}

// ---------------------------------------------------------------- chat

const chatOpen = (row: OrderRow) => Boolean(row.hasAssignee) && !CLOSED.includes(row.status);
async function readChat(env: Env, orderId: string, viewer: 'STUDENT' | 'ADMIN'): Promise<ChatMessage[]> {
  // Opening the thread marks the other side's messages read.
  await env.DB.prepare('UPDATE order_messages SET read_at=unixepoch() WHERE order_id=? AND sender_kind<>? AND read_at IS NULL').bind(orderId, viewer).run();
  const rows = (await env.DB.prepare('SELECT id,sender_kind AS senderKind,body,created_at AS createdAt,read_at AS readAt FROM order_messages WHERE order_id=? ORDER BY id DESC LIMIT 100')
    .bind(orderId).all<Omit<ChatMessage, 'mine'>>()).results;
  return rows.reverse().map(m => ({ ...m, mine: m.senderKind === viewer }));
}

// ---------------------------------------------------------------- calibration, ETA, positions

async function calibration(env: Env): Promise<Calibration | null> {
  const raw = await env.DB.prepare('SELECT points_json AS points FROM map_calibration WHERE campus_id=?').bind(CAMPUS_ID).first<string>('points');
  return raw ? JSON.parse(raw) as Calibration : null;
}
async function historySeconds(env: Env, fromStatus: string, building: string | null): Promise<number | null> {
  const row = await env.DB.prepare(`SELECT avg(d.created_at-s.created_at) AS secs,count(*) AS n FROM order_events s
    JOIN order_events d ON d.order_id=s.order_id AND d.to_status IN ('DELIVERED_DOWNSTAIRS','DELIVERED_TO_ROOM') AND d.created_at>s.created_at AND d.created_at-s.created_at<21600
    JOIN delivery_orders o ON o.id=s.order_id
    WHERE s.to_status=? AND s.created_at>unixepoch()-2592000 AND (? IS NULL OR o.dorm_building_code=?)`)
    .bind(fromStatus, building, building).first<{ secs: number | null; n: number }>();
  return row?.secs && row.n >= (building ? 3 : 5) ? row.secs : null;
}
/** Remaining time from delivery history (same building, else campus-wide), else from route length. */
async function estimateEta(env: Env, order: ReturnType<typeof serializeOrder>, statusSince: number): Promise<OrderEta | null> {
  if (!['WAITING_PICKUP', 'PICKED_UP', 'OUT_FOR_DELIVERY'].includes(order.status)) return null;
  const t = now();
  if (order.slotDate && order.slotCode && order.status !== 'OUT_FOR_DELIVERY') {
    const slot = slotByCode(order.slotCode), start = slotTime(order.slotDate, slot.start), end = slotTime(order.slotDate, slot.end);
    if (end > t) return { minutes: Math.max(1, Math.round((Math.max(start, t) - t) / 60)), basis: 'slot', arriveBy: end, label: `预约 ${slotLabel(order.slotDate, order.slotCode, t)}` };
  }
  const building = order.dormSnapshot.buildingCode;
  const history = await historySeconds(env, order.status, building) ?? await historySeconds(env, order.status, null);
  const route = campusRoute(order.stationSnapshot.code, building);
  const fallback = (route ? routeMinutes(route) : 10) * 60 + (order.status === 'WAITING_PICKUP' ? 25 * 60 : order.status === 'PICKED_UP' ? 6 * 60 : 0);
  const total = history ?? fallback, remaining = Math.max(60, total - (t - statusSince));
  const minutes = Math.round(remaining / 60);
  return { minutes, basis: history ? 'history' : 'distance', arriveBy: t + remaining, label: minutes <= 1 ? '马上就到' : `约 ${minutes} 分钟` };
}
async function courierPosition(env: Env, order: ReturnType<typeof serializeOrder>, eta: OrderEta | null, statusSince: number, cal: Calibration | null): Promise<CourierPosition | null> {
  if (!['PICKED_UP', 'OUT_FOR_DELIVERY'].includes(order.status)) return null;
  const route = campusRoute(order.stationSnapshot.code, order.dormSnapshot.buildingCode);
  if (!route) return null;
  if (order.status === 'PICKED_UP') return { ...route[0], source: 'estimate', updatedAt: null };
  const assignee = await assigneeOf(env, order.id);
  if (assignee && cal) {
    const fix = await env.DB.prepare('SELECT lat,lng,updated_at AS updatedAt FROM courier_locations WHERE admin_id=? AND updated_at>unixepoch()-120').bind(assignee).first<{ lat: number; lng: number; updatedAt: number }>();
    const point = fix && projectGps(cal, fix.lat, fix.lng);
    if (point && fix) return { ...point, source: 'gps', updatedAt: fix.updatedAt };
  }
  const elapsed = now() - statusSince, total = elapsed + (eta ? eta.arriveBy - now() : 600);
  const point = pointAlong(route, Math.min(0.94, elapsed / Math.max(total, 1)));
  return { x: Math.round(point.x), y: Math.round(point.y), source: 'estimate', updatedAt: null };
}
async function orderLive(env: Env, row: OrderRow): Promise<OrderLive> {
  const order = serializeOrder(row), cal = await calibration(env);
  const since = await env.DB.prepare('SELECT max(created_at) AS t FROM order_events WHERE order_id=? AND to_status=?').bind(order.id, order.status).first<number>('t') ?? order.createdAt;
  const eta = await estimateEta(env, order, since);
  return { eta, courier: await courierPosition(env, order, eta, since, cal), calibrated: Boolean(cal) };
}

async function liveMap(env: Env, admin: Admin): Promise<LiveMapData> {
  const scope = orderScope(admin), dates = bookableDates(now()).slice(0, 2);
  const [loads, couriers, slots, cal] = await Promise.all([
    env.DB.prepare(`SELECT o.dorm_building_code AS code,
      sum(o.status IN ('WAITING_PICKUP','PICKED_UP','OUT_FOR_DELIVERY')) AS active,
      sum(o.status IN ('FAILED_PICKUP','DELIVERY_EXCEPTION')) AS exceptions,
      sum(o.status IN ('DELIVERED_DOWNSTAIRS','DELIVERED_TO_ROOM')) AS awaitingReceipt
      FROM delivery_orders o WHERE o.status NOT IN ('WAITING_PAYMENT','COMPLETED','CANCELLED') AND ${scope.sql} GROUP BY o.dorm_building_code`).bind(...scope.params).all<LiveMapData['buildings'][number]>(),
    env.DB.prepare(`SELECT l.admin_id AS id,a.username,l.lat,l.lng,l.updated_at AS updatedAt,
      (SELECT count(*) FROM batch_items bi JOIN delivery_batches b ON b.id=bi.batch_id JOIN delivery_orders o ON o.id=bi.order_id WHERE b.assignee_admin_id=l.admin_id AND o.status IN ('PICKED_UP','OUT_FOR_DELIVERY')) AS active
      FROM courier_locations l JOIN admin_users a ON a.id=l.admin_id WHERE a.status='ACTIVE' AND l.updated_at>unixepoch()-300 AND (?<>'DELIVERY_STAFF' OR l.admin_id=?)`)
      .bind(admin.role, admin.id).all<{ id: string; username: string; lat: number; lng: number; updatedAt: number; active: number }>(),
    env.DB.prepare(`SELECT slot_date AS date,slot_code AS code,count(*) AS booked FROM delivery_orders WHERE slot_date IN (?,?) AND status<>'CANCELLED' GROUP BY slot_date,slot_code`).bind(...dates).all<{ date: string; code: string; booked: number }>(),
    calibration(env),
  ]);
  return {
    buildings: loads.results,
    couriers: cal ? couriers.results.flatMap(c => { const p = projectGps(cal, c.lat, c.lng); return p ? [{ id: c.id, username: c.username, x: p.x, y: p.y, updatedAt: c.updatedAt, active: c.active }] : []; }) : [],
    calibrated: Boolean(cal), slots: slots.results,
  };
}

// ---------------------------------------------------------------- routes

export async function liveDeliveryRoutes(request: Request, env: Env): Promise<Response | null> {
  const path = new URL(request.url).pathname.replace('/api/v1', ''), method = request.method;
  if (path === '/slots' && method === 'GET') { await requireStudent(request, env); return json(await slotAvailability(env)); }
  const student = /^\/orders\/([a-f0-9-]{36})\/(chat|live)$/.exec(path);
  if (student) {
    const user = await requireStudent(request, env), row = await ownOrder(env, user.id, student[1]);
    if (student[2] === 'live' && method === 'GET') return json(await orderLive(env, row));
    if (student[2] === 'chat' && method === 'GET') return json({ messages: await readChat(env, row.id, 'STUDENT'), open: chatOpen(row) });
    if (student[2] === 'chat' && method === 'POST') {
      if (!chatOpen(row)) throw new ApiError(409, 'CHAT_CLOSED', '配送员接单后、订单完成前可以发消息');
      await rateLimit(env, `chat:${user.id}`, 60);
      const data = await body(request, chatMessageSchema);
      await env.DB.prepare("INSERT INTO order_messages(order_id,sender_kind,sender_id,body) VALUES(?,'STUDENT',?,?)").bind(row.id, user.id, data.body).run();
      const assignee = await assigneeOf(env, row.id), order = serializeOrder(row);
      if (assignee) background(Promise.all([
        publish(env, `admin:${assignee}`, { type: 'chat', orderId: row.id }),
        sendPush(env, 'ADMIN', assignee, { title: `${order.dormSnapshot.buildingName} 的同学发来消息`, body: data.body.slice(0, 60), url: '/admin', tag: `chat-${row.id}` }),
      ]));
      return json({ messages: await readChat(env, row.id, 'STUDENT'), open: true }, 201);
    }
  }
  if (!path.startsWith('/admin/')) return null;
  const adminChat = /^\/admin\/orders\/([a-f0-9-]{36})\/(chat|handoff-code)$/.exec(path);
  if (adminChat) {
    const admin = await requireAdmin(request, env), id = adminChat[1];
    if (adminChat[2] === 'handoff-code' && method === 'POST') {
      const data = await body(request, handoffCodeSchema);
      return json({ order: await verifyHandoff(env, admin, id, data.code, data.version), message: '收货码核验通过，订单已完成' });
    }
    const row = await adminOrder(env, admin, id);
    if (adminChat[2] === 'chat' && method === 'GET') return json({ messages: await readChat(env, id, 'ADMIN'), open: chatOpen(row) });
    if (adminChat[2] === 'chat' && method === 'POST') {
      if (!chatOpen(row)) throw new ApiError(409, 'CHAT_CLOSED', '订单已结束，不能再发送消息');
      await rateLimit(env, `chat-admin:${admin.id}`, 120);
      const data = await body(request, chatMessageSchema);
      // The notify_order_chat trigger writes the student's inbox row; the request fan-out turns it into live + push.
      await env.DB.prepare("INSERT INTO order_messages(order_id,sender_kind,sender_id,body) VALUES(?,'ADMIN',?,?)").bind(id, admin.id, data.body).run();
      return json({ messages: await readChat(env, id, 'ADMIN'), open: true }, 201);
    }
  }
  if (path === '/admin/location') {
    const admin = await requireAdmin(request, env);
    if (method === 'DELETE') { await env.DB.prepare('DELETE FROM courier_locations WHERE admin_id=?').bind(admin.id).run(); return json({ ok: true }); }
    if (method === 'POST') {
      await rateLimit(env, `location:${admin.id}`, 300);
      const data = await body(request, locationSchema);
      await env.DB.prepare(`INSERT INTO courier_locations(admin_id,lat,lng,accuracy,updated_at) VALUES(?,?,?,?,unixepoch())
        ON CONFLICT(admin_id) DO UPDATE SET lat=excluded.lat,lng=excluded.lng,accuracy=excluded.accuracy,updated_at=unixepoch()`).bind(admin.id, data.lat, data.lng, data.accuracy).run();
      const watchers = (await env.DB.prepare(`SELECT o.id,o.user_id AS userId FROM delivery_orders o JOIN batch_items bi ON bi.order_id=o.id JOIN delivery_batches b ON b.id=bi.batch_id
        WHERE b.assignee_admin_id=? AND o.status='OUT_FOR_DELIVERY'`).bind(admin.id).all<{ id: string; userId: string }>()).results;
      background(Promise.all(watchers.map(w => publish(env, `student:${w.userId}`, { type: 'location', orderId: w.id }))));
      return json({ ok: true, watchers: watchers.length });
    }
  }
  if (path === '/admin/live-map' && method === 'GET') return json(await liveMap(env, await requireAdmin(request, env)));
  if (path === '/admin/map-calibration') {
    const admin = await requireAdmin(request, env);
    if (method === 'GET') { const cal = await calibration(env); return json({ calibrated: Boolean(cal), calibration: admin.role === 'SUPER_ADMIN' ? cal : null }); }
    if (method === 'PUT') {
      requireSuper(admin);
      const data = await body(request, calibrationSchema);
      const [a, b] = data.points.map(p => ({ ...landmarkPoint(p.landmark)!, lat: p.lat, lng: p.lng }));
      const cal: Calibration = { a, b };
      if (!calibrationUsable(cal)) throw new ApiError(400, 'CALIBRATION_TOO_CLOSE', '两个地标相距太近或方向一致，请选择地图上横向和纵向都相隔较远的两个地标');
      await env.DB.batch([
        env.DB.prepare(`INSERT INTO map_calibration(campus_id,points_json,updated_by) VALUES(?,?,?) ON CONFLICT(campus_id) DO UPDATE SET points_json=excluded.points_json,updated_by=excluded.updated_by,updated_at=unixepoch()`).bind(CAMPUS_ID, JSON.stringify(cal), admin.id),
        env.DB.prepare("INSERT INTO audit_logs(id,actor_type,actor_id,action,resource_id) VALUES(?,'ADMIN',?,'MAP_CALIBRATED',?)").bind(crypto.randomUUID(), admin.id, CAMPUS_ID),
      ]);
      return json({ calibrated: true, calibration: cal });
    }
    if (method === 'DELETE') { requireSuper(admin); await env.DB.prepare('DELETE FROM map_calibration WHERE campus_id=?').bind(CAMPUS_ID).run(); return json({ calibrated: false }); }
  }
  return null;
}

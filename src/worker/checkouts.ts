/* © 2026 专业团队 · CampusDrop v4.5.0 */
import type { Env } from './types';
import { ApiError, body, json, optionalBody } from './http';
import { requireAdmin, requireStudent, requireSuper } from './session';
import { rateLimit } from './rate-limit';
import { payOrders, payableOrders } from './payment';
import { activeStation, newHandoffCode, orderColumns, orderInsert, orderPrerequisites, serializeOrder, windowLoad, type OrderRow } from './orders';
import { bundleSetting, writeSetting } from './settings';
import { cancelStudentOrder } from './order-operations';
import { payWithCouponSchema } from '../shared/coupons';
import { bundleSettingSchema, checkoutCreateSchema, type CheckoutDetail, type CheckoutTrip } from '../shared/bundle';
import { GROUP_MAX_PARCELS } from '../shared/v3';
import { DROP_PLACE_LABELS, type DropPlace } from '../shared/campus-map';
import type { DeliveryMode, PackageSize, Station } from '../shared/delivery';

/*
 * v3.8 · 多件下单. The student picks several waiting parcels — any stations, sizes and destinations (楼下, 到寝, or a
 * campus drop-off point, chosen per parcel) — and one booked window or "as soon as possible". One checkout is created:
 * parcels of the same station going to the same place become a merged delivery (one courier trip, max 6), the rest are
 * separate trips. All orders share one door code and are paid in one payment (payment.ts: 多件满减, coupon, window
 * check, all or nothing). Cancelling a paid parcel later refunds what was actually paid for it.
 */
const destination = (o: { dropPlace?: DropPlace | null; deliveryMode: DeliveryMode; dormSnapshot: { buildingName: string } }) =>
  o.dropPlace ? DROP_PLACE_LABELS[o.dropPlace] : `${o.dormSnapshot.buildingName}${o.deliveryMode === 'ROOM' ? ' · 到寝' : ' · 楼下'}`;

async function checkoutDetail(env: Env, userId: string, id: string): Promise<CheckoutDetail> {
  const head = await env.DB.prepare('SELECT created_at AS createdAt FROM checkouts WHERE id=? AND user_id=?').bind(id, userId).first<{ createdAt: number }>();
  if (!head) throw new ApiError(404, 'NOT_FOUND', '这次下单不存在');
  const rows = (await env.DB.prepare(`SELECT ${orderColumns},(SELECT amount_fen FROM payments p WHERE p.order_id=o.id AND p.type='DELIVERY') AS paidAmount
    FROM delivery_orders o WHERE o.checkout_id=? AND o.user_id=? AND o.student_deleted=0 ORDER BY o.created_at,o.id`).bind(id, userId).all<OrderRow & { paidAmount: number | null }>()).results;
  const orders = rows.map(serializeOrder), live = orders.filter(o => o.status !== 'CANCELLED'), unpaid = live.filter(o => o.status === 'WAITING_PAYMENT');
  const trips = new Map<string, CheckoutTrip>();
  for (const o of live) {
    const key = o.groupId ?? o.id, trip = trips.get(key) ?? { stationName: o.stationSnapshot.canonicalName, destination: destination(o), dropPlace: o.dropPlace ?? null, mode: o.deliveryMode, buildingName: o.dormSnapshot.buildingName, count: 0, groupId: o.groupId ?? null };
    trip.count++; trips.set(key, trip);
  }
  const paidRows = rows.filter(r => r.paidAmount != null && r.status !== 'CANCELLED');
  const codeRow = await env.DB.prepare("SELECT handoff_code AS code FROM delivery_orders WHERE checkout_id=? AND user_id=? AND status NOT IN ('WAITING_PAYMENT','COMPLETED','CANCELLED') LIMIT 1").bind(id, userId).first<string>('code');
  return {
    handoffCode: codeRow ?? null,
    id, createdAt: head.createdAt, orders, trips: [...trips.values()],
    totalFen: live.reduce((s, o) => s + o.amountFen, 0), unpaidFen: unpaid.reduce((s, o) => s + o.amountFen, 0), unpaidCount: unpaid.length,
    couponFen: paidRows.reduce((s, r) => s + (r.discountFen ?? 0), 0), bundleFen: paidRows.reduce((s, r) => s + (r.bundleDiscountFen ?? 0), 0),
    paidFen: paidRows.reduce((s, r) => s + (r.paidAmount ?? 0), 0), rainFen: paidRows.reduce((s, r) => s + (r.rainFen ?? 0), 0),
  };
}

type ParcelRow = { id: string; stationCode: string; packageSize: PackageSize; note: string; status: string };
async function createCheckout(env: Env, request: Request): Promise<string> {
  const user = await requireStudent(request, env), data = await body(request, checkoutCreateSchema);
  await rateLimit(env, `checkout:${user.id}`, 30);
  const ids = data.items.map(i => i.parcelId);
  const found = (await env.DB.prepare(`SELECT id,station_code AS stationCode,CASE WHEN oversize=1 THEN 'EXTRA_LARGE' ELSE size END AS packageSize,note,status FROM parcels WHERE user_id=? AND id IN (${ids.map(() => '?').join(',')})`)
    .bind(user.id, ...ids).all<ParcelRow>()).results;
  if (found.length !== ids.length) throw new ApiError(404, 'NOT_FOUND', '有包裹不存在，请刷新后重新选择');
  if (found.some(p => p.status !== 'ACTIVE')) throw new ApiError(409, 'PARCEL_CLOSED', '有包裹已经结束，请刷新后重新选择');
  const slot = data.slotDate && data.slotCode ? { date: data.slotDate, code: data.slotCode } : undefined;
  // Shared checks (service open, window open and staffed, dorm address set). Mode and drop place are per parcel.
  const { address, capacity } = await orderPrerequisites(env, user, 'DOWNSTAIRS', slot, undefined);
  if (slot && !user.demo && await windowLoad(env, slot.date, slot.code) + ids.length > capacity) throw new ApiError(409, 'SLOT_FULL', `这个时段只剩不到 ${ids.length} 个名额了，请换一个时段，或选择尽快送达`);
  const stations = new Map<string, Station>();
  for (const code of new Set(found.map(p => p.stationCode))) stations.set(code, await activeStation(env, code));
  // Trips: same station + same destination; a merged delivery carries at most GROUP_MAX_PARCELS parcels.
  const trips = new Map<string, { station: string; mode: DeliveryMode; dropPlace?: DropPlace; parcels: ParcelRow[] }[]>();
  for (const item of data.items) {
    const parcel = found.find(p => p.id === item.parcelId)!, key = `${parcel.stationCode}|${item.deliveryMode}|${item.dropPlace ?? ''}`;
    const list = trips.get(key) ?? [];
    let last = list[list.length - 1];
    if (!last || last.parcels.length >= GROUP_MAX_PARCELS) { last = { station: parcel.stationCode, mode: item.deliveryMode, dropPlace: item.dropPlace, parcels: [] }; list.push(last); }
    last.parcels.push(parcel); trips.set(key, list);
  }
  const checkoutId = crypto.randomUUID(), code = newHandoffCode(), statements: D1PreparedStatement[] = [];
  statements.push(env.DB.prepare('INSERT INTO checkouts(id,user_id) VALUES(?,?)').bind(checkoutId, user.id));
  const orderIds: string[] = [], orderAt: number[] = [];
  for (const trip of [...trips.values()].flat()) {
    const groupId = trip.parcels.length > 1 ? crypto.randomUUID() : undefined;
    if (groupId) statements.push(env.DB.prepare("INSERT INTO order_groups(id,user_id,station_code,origin) VALUES(?,?,?,'STUDENT')").bind(groupId, user.id, trip.station));
    for (const parcel of trip.parcels) {
      const id = crypto.randomUUID();
      orderIds.push(id); orderAt.push(statements.length);
      statements.push(orderInsert(env, id, { user, parcel, address, station: stations.get(trip.station)!, mode: trip.mode, slot, dropPlace: trip.dropPlace, capacity, code, groupId, checkoutId }));
    }
  }
  let results: D1Result[];
  try { results = await env.DB.batch(statements); }
  catch (error) {
    if (String(error).includes('UNIQUE constraint')) throw new ApiError(409, 'ORDER_EXISTS', '所选包裹中有已经下单的，请刷新后重新选择');
    throw error;
  }
  const created = orderIds.filter((_, i) => results[orderAt[i]].meta.changes);
  if (created.length !== orderIds.length) {
    // A parcel closed, or the window filled up, between the checks and the insert: undo the rest, nothing half-made.
    for (const id of created) await env.DB.prepare("UPDATE delivery_orders SET status='CANCELLED',version=version+1,updated_at=unixepoch(),last_actor_type='SYSTEM',last_actor_id='system',service_notice='多件下单未完成，已自动撤销' WHERE id=? AND status='WAITING_PAYMENT'").bind(id).run();
    if (slot && await windowLoad(env, slot.date, slot.code) >= capacity) throw new ApiError(409, 'SLOT_FULL', '这个时段刚刚约满了，请换一个时段，或选择尽快送达');
    throw new ApiError(409, 'PARCEL_CLOSED', '所选包裹的状态已更新，请刷新后重新选择');
  }
  return checkoutId;
}

export async function checkoutRoutes(request: Request, env: Env): Promise<Response | null> {
  const url = new URL(request.url), method = request.method, path = url.pathname.replace(/^\/api\/v1/, '');
  if (path === '/pricing/bundle' && method === 'GET') return json({ bundle: await bundleSetting(env) });
  if (path === '/admin/settings/bundle') {
    const admin = await requireAdmin(request, env);
    if (method === 'GET') return json({ bundle: await bundleSetting(env) });
    if (method === 'PUT') {
      requireSuper(admin);
      const data = await body(request, bundleSettingSchema), value = { enabled: data.enabled, tiers: [...data.tiers].sort((a, b) => a.minFen - b.minFen) };
      await env.DB.batch([writeSetting(env, 'bundle_discount', value, admin.id),
        env.DB.prepare("INSERT INTO audit_logs(id,actor_type,actor_id,action,resource_id,metadata_redacted) VALUES(?,'ADMIN',?,'BUNDLE_DISCOUNT_UPDATED','bundle_discount',?)")
          .bind(crypto.randomUUID(), admin.id, JSON.stringify(value))]);
      return json({ bundle: value });
    }
    return null;
  }
  if (path === '/checkouts' && method === 'POST') {
    const id = await createCheckout(env, request), user = await requireStudent(request, env);
    return json({ checkout: await checkoutDetail(env, user.id, id) }, 201);
  }
  const m = /^\/checkouts\/([a-f0-9-]{36})(?:\/(mock-pay|cancel-unpaid))?$/.exec(path);
  if (!m) return null;
  const user = await requireStudent(request, env), id = m[1];
  if (!m[2] && method === 'GET') return json({ checkout: await checkoutDetail(env, user.id, id) });
  if (m[2] === 'mock-pay' && method === 'POST') {
    await checkoutDetail(env, user.id, id);
    const r = await payOrders(env, user.id, await payableOrders(env, user.id, { checkoutId: id }), await optionalBody(request, payWithCouponSchema));
    return json({ checkout: await checkoutDetail(env, user.id, id), paid: r.paid, message: r.paid ? '模拟支付成功，未发生真实扣款' : '没有需要支付的订单' });
  }
  if (m[2] === 'cancel-unpaid' && method === 'POST') {
    const detail = await checkoutDetail(env, user.id, id);
    for (const o of detail.orders.filter(x => x.status === 'WAITING_PAYMENT')) await cancelStudentOrder(env, user.id, o.id, o.version);
    return json({ checkout: await checkoutDetail(env, user.id, id) });
  }
  return null;
}

import type { Env } from './types';
import { ApiError, body, json } from './http';
import { requireStudent } from './session';
import type { Student } from '../shared/contracts';
import type { DeliveryMode, Order, Parcel } from '../shared/delivery';
import { groupOrderSchema, type OrderGroup } from '../shared/v3';
import { slotLabel, slotOpen, type SlotCode } from '../shared/slots';
import { DROP_PLACE_LABELS, type DropPlace } from '../shared/campus-map';
import { activeStation, newHandoffCode, orderColumns, orderInsert, orderPrerequisites, serializeOrder, windowLoad, type OrderRow } from './orders';
import { capacityFor, notifyGroupLater, requireOrderingOpen, SLOT_HOLDING } from './settings';
import { cancelStudentOrder } from './order-operations';

/*
 * Merged delivery (多件合并配送). A group is a set of ordinary one-parcel orders of one student, from one station, with
 * one delivery choice and one door code. Each order is priced and kept exactly like a single order; the group only
 * adds "pay together", "claimed together" and "signed for together". Groups are created by the student (this file)
 * or by a standing rule (rules.ts, through createOrderSet).
 */
const now = () => Math.floor(Date.now() / 1000);

/** Creates orders for the given parcels in one transaction; two or more become a group. Returns the new order ids. */
export async function createOrderSet(env: Env, user: Student, parcels: Pick<Parcel, 'id' | 'stationCode' | 'packageSize' | 'note'>[], mode: DeliveryMode,
  slot: { date: string; code: SlotCode } | undefined, dropPlace: DropPlace | undefined, ruleId?: string): Promise<{ groupId: string | null; ids: string[] }> {
  const { address, capacity } = await orderPrerequisites(env, user, mode, slot, dropPlace);
  const stationCode = parcels[0].stationCode;
  if (parcels.some(p => p.stationCode !== stationCode)) throw new ApiError(400, 'GROUP_STATION', '合并配送的包裹需要在同一个站点，请按站点分开下单');
  const station = await activeStation(env, stationCode);
  const groupId = parcels.length > 1 ? crypto.randomUUID() : null, code = newHandoffCode(), ids = parcels.map(() => crypto.randomUUID());
  const statements: D1PreparedStatement[] = [];
  if (groupId) statements.push(env.DB.prepare('INSERT INTO order_groups(id,user_id,station_code,origin,rule_id) VALUES(?,?,?,?,?)').bind(groupId, user.id, stationCode, ruleId ? 'RULE' : 'STUDENT', ruleId ?? null));
  parcels.forEach((parcel, i) => statements.push(orderInsert(env, ids[i], { user, parcel, address, station, mode, slot, dropPlace, capacity, code, groupId: groupId ?? undefined, ruleId })));
  let results: D1Result[];
  try { results = await env.DB.batch(statements); }
  catch (error) {
    if (String(error).includes('UNIQUE constraint')) throw new ApiError(409, 'ORDER_EXISTS', '所选包裹中有已经下单的，请刷新后重新选择');
    throw error;
  }
  const created = ids.filter((_, i) => results[(groupId ? 1 : 0) + i].meta.changes);
  if (created.length !== ids.length) {
    // A parcel closed, or the window filled up, between the checks and the insert: undo the rest, nothing half-made.
    for (const id of created) await env.DB.prepare("UPDATE delivery_orders SET status='CANCELLED',version=version+1,updated_at=unixepoch(),last_actor_type='SYSTEM',last_actor_id='system',service_notice='合并下单未完成，已自动撤销' WHERE id=? AND status='WAITING_PAYMENT'").bind(id).run();
    if (slot && await windowLoad(env, slot.date, slot.code) >= capacity) throw new ApiError(409, 'SLOT_FULL', '这个时段刚刚约满了，请换一个时段，或选择尽快送达');
    throw new ApiError(409, 'PARCEL_CLOSED', '所选包裹的状态已更新，请刷新后重新选择');
  }
  return { groupId, ids };
}

async function ownGroupRows(env: Env, userId: string, groupId: string): Promise<{ origin: 'STUDENT' | 'RULE'; createdAt: number; rows: OrderRow[] }> {
  const group = await env.DB.prepare('SELECT origin,created_at AS createdAt FROM order_groups WHERE id=? AND user_id=?').bind(groupId, userId).first<{ origin: 'STUDENT' | 'RULE'; createdAt: number }>();
  if (!group) throw new ApiError(404, 'NOT_FOUND', '合并配送单不存在');
  const rows = (await env.DB.prepare(`SELECT ${orderColumns} FROM delivery_orders o WHERE o.group_id=? AND o.user_id=? AND o.student_deleted=0 ORDER BY o.created_at,o.id`).bind(groupId, userId).all<OrderRow>()).results;
  return { ...group, rows };
}
export async function groupDetail(env: Env, userId: string, groupId: string): Promise<OrderGroup> {
  const { origin, createdAt, rows } = await ownGroupRows(env, userId, groupId);
  const orders: Order[] = rows.map(serializeOrder), live = orders.filter(o => o.status !== 'CANCELLED'), unpaid = live.filter(o => o.status === 'WAITING_PAYMENT');
  return { id: groupId, createdAt, origin, orders, totalFen: live.reduce((s, o) => s + o.amountFen, 0), unpaidFen: unpaid.reduce((s, o) => s + o.amountFen, 0), unpaidCount: unpaid.length };
}

/**
 * Pays every unpaid member. The booked window is checked for room for all of them first; each payment is the same
 * conditional INSERT a single order uses, in one D1 transaction, so a window can never be overbooked.
 */
async function payGroup(env: Env, userId: string, groupId: string): Promise<{ group: OrderGroup; paid: number; missed: number }> {
  const { rows } = await ownGroupRows(env, userId, groupId);
  const unpaid = rows.filter(r => r.status === 'WAITING_PAYMENT');
  if (!unpaid.length) return { group: await groupDetail(env, userId, groupId), paid: 0, missed: 0 };
  await requireOrderingOpen(env);
  const t = now(), first = unpaid[0], slot = first.slotDate && first.slotCode ? { date: first.slotDate, code: first.slotCode } : null;
  if (slot && !slotOpen(slot.date, slot.code, t)) throw new ApiError(409, 'SLOT_CLOSED', '预约的时段已停止预约，请取消后重新下单并选择其他时段');
  const capacity = slot ? await capacityFor(env, slot.date, slot.code) : 0;
  if (slot && await windowLoad(env, slot.date, slot.code) + unpaid.length > capacity) throw new ApiError(409, 'SLOT_FULL', `这个时段只剩不到 ${unpaid.length} 个名额了，请取消后换一个时段，或选择尽快送达`);
  await env.DB.batch(unpaid.map(r => env.DB.prepare(`INSERT INTO payments(id,order_id,type,provider,amount_fen,status,idempotency_key)
      SELECT ?,id,'DELIVERY','MOCK',amount_fen,'SUCCEEDED','delivery' FROM delivery_orders o
      WHERE o.id=? AND o.user_id=? AND o.status='WAITING_PAYMENT'
      AND NOT EXISTS(SELECT 1 FROM payments WHERE order_id=? AND type='DELIVERY')
      AND (o.slot_date IS NULL OR (SELECT count(*) FROM delivery_orders x WHERE x.slot_date=o.slot_date AND x.slot_code=o.slot_code AND x.${SLOT_HOLDING})<?)`)
    .bind(crypto.randomUUID(), r.id, userId, r.id, capacity)));
  const group = await groupDetail(env, userId, groupId);
  const missed = group.unpaidCount, paid = unpaid.length - missed;
  if (paid) {
    const o = group.orders.find(x => x.status !== 'CANCELLED' && x.status !== 'WAITING_PAYMENT') ?? group.orders[0];
    const where = o.dropPlace ? DROP_PLACE_LABELS[o.dropPlace] : `${o.dormSnapshot.buildingName}${o.deliveryMode === 'ROOM' ? ' · 到寝' : ' · 楼下'}`;
    notifyGroupLater(env, 'NEW_ORDER', `新订单（合并 ${paid} 件）：${where} · ${slot ? slotLabel(slot.date, slot.code, t) : '尽快送达'}`, `group:${groupId}:${paid}`);
  }
  return { group, paid, missed };
}

/** Cancels the members that are still unpaid (paid members are cancelled one by one from their own order page). */
async function cancelUnpaid(env: Env, userId: string, groupId: string): Promise<OrderGroup> {
  const { rows } = await ownGroupRows(env, userId, groupId);
  for (const r of rows.filter(x => x.status === 'WAITING_PAYMENT')) await cancelStudentOrder(env, userId, r.id, r.version);
  return groupDetail(env, userId, groupId);
}

export async function groupRoutes(request: Request, env: Env): Promise<Response | null> {
  const url = new URL(request.url), method = request.method, path = url.pathname.replace(/^\/api\/v1/, '');
  if (path === '/order-groups' && method === 'POST') {
    const user = await requireStudent(request, env), data = await body(request, groupOrderSchema);
    const found = (await env.DB.prepare(`SELECT id,station_code AS stationCode,size AS packageSize,note,status FROM parcels WHERE user_id=? AND id IN (${data.parcelIds.map(() => '?').join(',')})`)
      .bind(user.id, ...data.parcelIds).all<Pick<Parcel, 'id' | 'stationCode' | 'packageSize' | 'note' | 'status'>>()).results;
    if (found.length !== data.parcelIds.length) throw new ApiError(404, 'NOT_FOUND', '有包裹不存在，请刷新后重新选择');
    if (found.some(p => p.status !== 'ACTIVE')) throw new ApiError(409, 'PARCEL_CLOSED', '有包裹已经结束，请刷新后重新选择');
    const ordered = data.parcelIds.map(id => found.find(p => p.id === id)!);
    const slot = data.slotDate && data.slotCode ? { date: data.slotDate, code: data.slotCode } : undefined;
    const { groupId } = await createOrderSet(env, user, ordered, data.deliveryMode, slot, data.dropPlace);
    return json({ group: await groupDetail(env, user.id, groupId!) }, 201);
  }
  const m = /^\/order-groups\/([a-f0-9-]{36})(?:\/(mock-pay|cancel-unpaid))?$/.exec(path);
  if (!m) return null;
  const user = await requireStudent(request, env), id = m[1];
  if (!m[2] && method === 'GET') return json({ group: await groupDetail(env, user.id, id) });
  if (m[2] === 'mock-pay' && method === 'POST') {
    const result = await payGroup(env, user.id, id);
    if (result.missed && !result.paid) throw new ApiError(409, 'SLOT_FULL', '这个时段刚刚约满了，请取消后换一个时段，或选择尽快送达');
    return json({ ...result, message: result.missed ? `已支付 ${result.paid} 件；${result.missed} 件因时段名额不足未能支付，请取消这几件后重新下单` : '模拟支付成功，未发生真实扣款' });
  }
  if (m[2] === 'cancel-unpaid' && method === 'POST') return json({ group: await cancelUnpaid(env, user.id, id) });
  return null;
}

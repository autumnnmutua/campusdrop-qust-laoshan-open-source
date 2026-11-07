/* © 2026 专业团队 · CampusDrop v4.0.0 */
import type { Env } from './types';
import { ApiError, json } from './http';
import { requireAdmin } from './session';
import { orderScope } from './order-access';
import { PILOT_ASAP_TARGET, PILOT_PERIODS, quantile, ratio, type PilotDay, type PilotReport, type PilotWeek } from '../shared/pilot';
import { beijingDate, slotByCode, slotTime, type SlotCode } from '../shared/slots';

/*
 * v3.8 · GET /admin/pilot-report?days=7|14|30|0 — the trial report (shared/pilot.ts has the definitions). Paid orders
 * the admin may see (orderScope), real trials without test accounts; one query for the orders, one for the tickets,
 * the rest is arithmetic here.
 */
const DAY = 86400, MIN = 60;
type Row = {
  id: string; userId: string; status: string; slotDate: string | null; slotCode: SlotCode | null; amountFen: number; discountFen: number; bundleFen: number;
  together: number; paidAt: number; paidFen: number; claimedAt: number | null; pickedAt: number | null; deliveredAt: number | null; exception: number;
  stars: number | null; courier: string | null; refundFen: number | null; tipFen: number | null;
};
const DELIVERED = "('DELIVERED_DOWNSTAIRS','DELIVERED_TO_ROOM')";

export async function pilotReport(env: Env, admin: Parameters<typeof orderScope>[0], days: number, t = Math.floor(Date.now() / 1000)): Promise<PilotReport> {
  const scope = orderScope(admin);
  const rows = (await env.DB.prepare(`SELECT o.id,o.user_id AS userId,o.status,o.slot_date AS slotDate,o.slot_code AS slotCode,o.amount_fen AS amountFen,o.discount_fen AS discountFen,
      o.bundle_discount_fen AS bundleFen,(o.checkout_id IS NOT NULL OR o.group_id IS NOT NULL) AS together,p.created_at AS paidAt,p.amount_fen AS paidFen,
      (SELECT b.created_at FROM batch_items bi JOIN delivery_batches b ON b.id=bi.batch_id WHERE bi.order_id=o.id) AS claimedAt,
      (SELECT b.assignee_admin_id FROM batch_items bi JOIN delivery_batches b ON b.id=bi.batch_id WHERE bi.order_id=o.id) AS courier,
      (SELECT min(e.created_at) FROM order_events e WHERE e.order_id=o.id AND e.to_status='PICKED_UP') AS pickedAt,
      (SELECT min(e.created_at) FROM order_events e WHERE e.order_id=o.id AND e.to_status IN ${DELIVERED}) AS deliveredAt,
      EXISTS(SELECT 1 FROM order_events e WHERE e.order_id=o.id AND e.to_status IN ('DELIVERY_EXCEPTION','FAILED_PICKUP')) AS exception,
      (SELECT r.stars FROM order_ratings r WHERE r.order_id=o.id) AS stars,
      (SELECT a.amount_fen FROM order_adjustments a WHERE a.order_id=o.id AND a.kind='REFUND') AS refundFen,
      (SELECT sum(x.amount_fen) FROM payments x WHERE x.order_id=o.id AND x.type='TIP') AS tipFen
    FROM delivery_orders o JOIN payments p ON p.order_id=o.id AND p.type='DELIVERY'
    WHERE ${scope.sql} AND o.seed_data=0 AND (o.demo_group IS NOT NULL OR NOT EXISTS(SELECT 1 FROM users u WHERE u.id=o.user_id AND u.test_account=1))
    ORDER BY p.created_at LIMIT 20000`).bind(...scope.params).all<Row>()).results;
  const firstOrderAt = rows.length ? rows[0].paidAt : null;
  const today = slotTime(beijingDate(t), '00:00');
  const from = days ? today - (days - 1) * DAY : (firstOrderAt !== null ? slotTime(beijingDate(firstOrderAt), '00:00') : today);
  const span = Math.max(1, Math.round((today - from) / DAY) + 1);
  const firstPaid = new Map<string, number>();
  for (const r of rows) if (!firstPaid.has(r.userId)) firstPaid.set(r.userId, r.paidAt);
  const inPeriod = rows.filter(r => r.paidAt >= from && r.paidAt <= t);
  const onTimeOf = (r: Row) => {
    if (r.deliveredAt === null) return false;
    if (r.slotDate && r.slotCode) return r.deliveredAt <= slotTime(r.slotDate, slotByCode(r.slotCode).end);
    return r.deliveredAt - r.paidAt <= PILOT_ASAP_TARGET * MIN;
  };
  const users = new Set(inPeriod.map(r => r.userId)), newUsers = [...users].filter(u => (firstPaid.get(u) ?? 0) >= from);
  const daysByUser = new Map<string, Set<string>>();
  for (const r of inPeriod) { const set = daysByUser.get(r.userId) ?? new Set<string>(); set.add(beijingDate(r.paidAt)); daysByUser.set(r.userId, set); }
  const repeatUsers = [...daysByUser.values()].filter(s => s.size >= 2).length;
  const delivered = inPeriod.filter(r => r.deliveredAt !== null), onTime = delivered.filter(onTimeOf);
  const asap = delivered.filter(r => !r.slotDate).map(r => (r.deliveredAt! - r.paidAt) / MIN);
  const claims = inPeriod.filter(r => !r.slotDate && r.claimedAt !== null).map(r => (r.claimedAt! - r.paidAt) / MIN);
  const rides = delivered.filter(r => r.pickedAt !== null).map(r => (r.deliveredAt! - r.pickedAt!) / MIN);
  const rated = inPeriod.filter(r => r.stars !== null), stars: [number, number, number, number, number] = [0, 0, 0, 0, 0];
  for (const r of rated) stars[r.stars! - 1]++;
  const cancelled = inPeriod.filter(r => r.status === 'CANCELLED');
  const exceptions = inPeriod.filter(r => r.exception);
  // Tickets on orders the admin may see, opened in the period.
  const scope2 = orderScope(admin);
  const tickets = (await env.DB.prepare(`SELECT t.status,t.created_at AS createdAt,t.updated_at AS updatedAt FROM support_tickets t JOIN delivery_orders o ON o.id=t.order_id
    WHERE ${scope2.sql} AND o.seed_data=0 AND (o.demo_group IS NOT NULL OR NOT EXISTS(SELECT 1 FROM users u WHERE u.id=o.user_id AND u.test_account=1)) AND t.created_at BETWEEN ? AND ?`).bind(...scope2.params, from, t).all<{ status: string; createdAt: number; updatedAt: number }>()).results;
  const resolved = tickets.filter(x => x.status === 'RESOLVED' || x.status === 'CLOSED');
  // Couriers: deliveries per courier per day they delivered anything.
  const courierDays = new Set(delivered.filter(r => r.courier).map(r => `${r.courier}|${beijingDate(r.deliveredAt!)}`));
  const couriers = new Set(delivered.filter(r => r.courier).map(r => r.courier!));
  const daily: PilotDay[] = Array.from({ length: span }, (_, i) => {
    const start = from + i * DAY, end = start + DAY, list = inPeriod.filter(r => r.paidAt >= start && r.paidAt < end);
    const dUsers = new Set(list.map(r => r.userId)), dDelivered = list.filter(r => r.deliveredAt !== null);
    return { date: beijingDate(start), orders: list.length, users: dUsers.size, newUsers: [...dUsers].filter(u => (firstPaid.get(u) ?? 0) >= start && (firstPaid.get(u) ?? 0) < end).length, delivered: dDelivered.length, onTime: dDelivered.filter(onTimeOf).length };
  });
  const weekly: PilotWeek[] = [];
  for (let w = 0; w * 7 < span; w++) {
    const start = from + w * 7 * DAY, end = Math.min(start + 7 * DAY, today + DAY), list = inPeriod.filter(r => r.paidAt >= start && r.paidAt < end);
    const wUsers = new Set(list.map(r => r.userId)), wDelivered = list.filter(r => r.deliveredAt !== null), wRated = list.filter(r => r.stars !== null);
    weekly.push({ label: `第 ${w + 1} 周`, from: beijingDate(start), to: beijingDate(end - 1), orders: list.length, users: wUsers.size,
      newUsers: [...wUsers].filter(u => (firstPaid.get(u) ?? 0) >= start && (firstPaid.get(u) ?? 0) < end).length,
      onTimeRate: ratio(wDelivered.filter(onTimeOf).length, wDelivered.length), avgStars: wRated.length ? wRated.reduce((a, r) => a + r.stars!, 0) / wRated.length : null,
      tickets: tickets.filter(x => x.createdAt >= start && x.createdAt < end).length });
  }
  const round1 = (v: number | null) => v === null ? null : Math.round(v * 10) / 10;
  return {
    days, from, to: t, firstOrderAt, testData: Boolean(admin.demo),
    users: users.size, newUsers: newUsers.length, repeatUsers, repeatRate: ratio(repeatUsers, users.size), ordersPerUser: round1(ratio(inPeriod.length, users.size)),
    orders: inPeriod.length, multiOrders: inPeriod.filter(r => r.together).length, cancelledAfterPay: cancelled.length, cancelRate: ratio(cancelled.length, inPeriod.length),
    delivered: delivered.length, onTime: onTime.length, onTimeRate: ratio(onTime.length, delivered.length), bookedShare: ratio(inPeriod.filter(r => r.slotDate).length, inPeriod.length),
    asapMedian: round1(quantile(asap, 0.5)), asapP90: round1(quantile(asap, 0.9)), claimMedian: round1(quantile(claims, 0.5)), rideMedian: round1(quantile(rides, 0.5)),
    exceptions: exceptions.length, exceptionRate: ratio(exceptions.length, inPeriod.length),
    rated: rated.length, ratedShare: ratio(rated.length, delivered.length), avgStars: rated.length ? Math.round(rated.reduce((a, r) => a + r.stars!, 0) / rated.length * 100) / 100 : null, stars,
    tickets: tickets.length, ticketsPer100: round1(ratio(tickets.length * 100, inPeriod.length)), ticketsResolved: resolved.length,
    resolveMedianHours: round1(quantile(resolved.map(x => (x.updatedAt - x.createdAt) / 3600), 0.5)),
    grossFen: inPeriod.reduce((a, r) => a + r.amountFen, 0), couponFen: inPeriod.reduce((a, r) => a + r.discountFen, 0), bundleFen: inPeriod.reduce((a, r) => a + r.bundleFen, 0),
    paidFen: inPeriod.reduce((a, r) => a + r.paidFen, 0), refundFen: inPeriod.reduce((a, r) => a + (r.refundFen ?? 0), 0), tipFen: inPeriod.reduce((a, r) => a + (r.tipFen ?? 0), 0),
    couriers: couriers.size, perCourierDay: round1(ratio(delivered.filter(r => r.courier).length, courierDays.size)),
    daily, weekly,
  };
}

export async function pilotRoutes(request: Request, env: Env): Promise<Response | null> {
  const url = new URL(request.url);
  if (url.pathname !== '/api/v1/admin/pilot-report' || request.method !== 'GET') return null;
  const admin = await requireAdmin(request, env);
  if (admin.role === 'DELIVERY_STAFF') throw new ApiError(403, 'FORBIDDEN', '实测报告仅管理员可查看');
  const days = Number(url.searchParams.get('days') ?? '0');
  if (!(PILOT_PERIODS as readonly number[]).includes(days)) throw new ApiError(400, 'INVALID_FILTER', '统计周期只能是 7、14、30 天或全部');
  return json({ report: await pilotReport(env, admin, days) });
}

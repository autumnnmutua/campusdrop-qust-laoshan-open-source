import type { Env } from './types';
import { ApiError } from './http';
import { couponBatch, couponForPayment, settleCoupon } from './coupons';
import { bundleSetting, capacityFor, notifyGroupLater, requireOrderingOpen, SLOT_HOLDING } from './settings';
import { windowLoad } from './orders';
import { bundleDiscount, type BundleResult } from '../shared/bundle';
import { splitDiscount } from '../shared/coupons';
import { slotLabel, slotOpen, type SlotCode } from '../shared/slots';
import { DROP_PLACE_LABELS, type DropPlace } from '../shared/campus-map';

/*
 * v3.8 · one mock payment for one or more unpaid orders of a student (a single order, a merged delivery, a 多件下单
 * checkout). The same steps for all of them, in one D1 transaction:
 *   1. 多件满减 on the whole payment (two or more parcels reaching a tier), split over the parcels;
 *   2. the chosen coupon on what is left (its redemption is refused when the account already used it);
 *   3. one payment per order for price − coupon − bundle (the payment_guard trigger checks the sum).
 * Booked windows are checked for room for all of the payment's orders at once, and each payment INSERT repeats that
 * check against the parcels of this payment still unpaid, so either every order is paid or none is.
 */
export interface Payable { id: string; amountFen: number; slotDate: string | null; slotCode: SlotCode | null; demo: number; dropPlace: DropPlace | null; buildingName: string; mode: 'ROOM' | 'DOWNSTAIRS'; size: 'SMALL' | 'LARGE' }
const now = () => Math.floor(Date.now() / 1000);

/** Unpaid orders of this student among `ids` (or matching a group / checkout), oldest first. */
export async function payableOrders(env: Env, userId: string, target: { orderId?: string; groupId?: string; checkoutId?: string }): Promise<Payable[]> {
  const where = target.orderId ? 'o.id=?' : target.groupId ? 'o.group_id=?' : 'o.checkout_id=?';
  return (await env.DB.prepare(`SELECT o.id,o.amount_fen AS amountFen,o.slot_date AS slotDate,o.slot_code AS slotCode,o.demo_group IS NOT NULL AS demo,o.drop_place AS dropPlace,
      json_extract(o.dorm_snapshot_json,'$.buildingName') AS buildingName,o.delivery_mode AS mode,o.package_size AS size
    FROM delivery_orders o WHERE o.user_id=? AND o.status='WAITING_PAYMENT' AND o.student_deleted=0 AND ${where}
    AND NOT EXISTS(SELECT 1 FROM payments p WHERE p.order_id=o.id AND p.type='DELIVERY') ORDER BY o.created_at,o.id`)
    .bind(userId, target.orderId ?? target.groupId ?? target.checkoutId).all<Payable>()).results;
}

/** The bundle discount for paying `orders` together, and each order's share. */
export async function bundleFor(env: Env, amounts: number[]): Promise<BundleResult & { shares: number[] }> {
  const result = bundleDiscount(await bundleSetting(env), amounts);
  return { ...result, shares: splitDiscount(result.discountFen, amounts) };
}

export async function payOrders(env: Env, userId: string, orders: Payable[], choice: { couponId?: string; code?: string } = {}): Promise<{ paid: number; bundleFen: number; couponFen: number }> {
  if (!orders.length) return { paid: 0, bundleFen: 0, couponFen: 0 };
  if (!orders[0].demo) await requireOrderingOpen(env);
  const t = now();
  // Every booked window in this payment must still be open and have room for all of its parcels.
  const windows = new Map<string, { date: string; code: SlotCode; n: number }>();
  for (const o of orders) if (o.slotDate && o.slotCode) {
    const key = o.slotDate + o.slotCode, w = windows.get(key) ?? { date: o.slotDate, code: o.slotCode, n: 0 };
    w.n++; windows.set(key, w);
  }
  const capacity = new Map<string, number>();
  for (const [key, w] of windows) {
    if (!slotOpen(w.date, w.code, t)) throw new ApiError(409, 'SLOT_CLOSED', '预约的时段已停止预约，请取消后重新下单并选择其他时段');
    const cap = await capacityFor(env, w.date, w.code);
    capacity.set(key, cap);
    if (!orders[0].demo && await windowLoad(env, w.date, w.code) + w.n > cap) throw new ApiError(409, 'SLOT_FULL', w.n > 1 ? `这个时段只剩不到 ${w.n} 个名额了，请取消后换一个时段，或选择尽快送达` : '这个时段刚刚约满了，请取消这单后重新下单，换一个时段或选择尽快送达');
  }
  const amounts = orders.map(o => o.amountFen), bundle = await bundleFor(env, amounts);
  const left = amounts.map((a, i) => a - bundle.shares[i]);
  const coupon = await couponForPayment(env, { id: userId }, orders.map((o, i) => ({ id: o.id, amountFen: left[i] })), choice);
  const rid = coupon?.redemptionId ?? null, ids = JSON.stringify(orders.map(o => o.id));
  await couponBatch(env, [
    // Fresh discounts for this attempt (a coupon, when chosen, is written by the statements that follow).
    ...orders.map((o, i) => env.DB.prepare("UPDATE delivery_orders SET bundle_discount_fen=?,discount_fen=0,coupon_redemption_id=NULL WHERE id=? AND user_id=? AND status='WAITING_PAYMENT'").bind(bundle.shares[i], o.id, userId)),
    ...(coupon?.statements ?? []),
    ...orders.map(o => env.DB.prepare(`INSERT INTO payments(id,order_id,type,provider,amount_fen,status,idempotency_key)
      SELECT ?,id,'DELIVERY','MOCK',amount_fen-discount_fen-bundle_discount_fen,'SUCCEEDED','delivery' FROM delivery_orders o
      WHERE o.id=? AND o.user_id=? AND o.status='WAITING_PAYMENT'
      AND NOT EXISTS(SELECT 1 FROM payments WHERE order_id=? AND type='DELIVERY')
      AND (? IS NULL OR o.coupon_redemption_id=?)
      AND (o.slot_date IS NULL OR o.demo_group IS NOT NULL OR
        (SELECT count(*) FROM delivery_orders x WHERE x.slot_date=o.slot_date AND x.slot_code=o.slot_code AND x.${SLOT_HOLDING})
        + (SELECT count(*) FROM delivery_orders y WHERE y.id IN (SELECT value FROM json_each(?)) AND y.status='WAITING_PAYMENT' AND y.slot_date=o.slot_date AND y.slot_code=o.slot_code) <= ?)`)
      .bind(crypto.randomUUID(), o.id, userId, o.id, rid, rid, ids, capacity.get((o.slotDate ?? '') + (o.slotCode ?? '')) ?? 0)),
  ]);
  if (coupon) await settleCoupon(env, coupon.redemptionId);
  const paidIds = new Set((await env.DB.prepare(`SELECT order_id AS id FROM payments WHERE type='DELIVERY' AND order_id IN (SELECT value FROM json_each(?))`).bind(ids).all<{ id: string }>()).results.map(r => r.id));
  if (!paidIds.size) {
    await env.DB.prepare("UPDATE delivery_orders SET bundle_discount_fen=0 WHERE id IN (SELECT value FROM json_each(?)) AND status='WAITING_PAYMENT'").bind(ids).run();
    if (coupon && !await env.DB.prepare('SELECT 1 FROM coupon_redemptions WHERE id=?').bind(coupon.redemptionId).first()) throw new ApiError(409, 'COUPON_UNAVAILABLE', '这张优惠券刚刚被用掉了，请重新选择');
    if (windows.size) throw new ApiError(409, 'SLOT_FULL', '这个时段刚刚约满了，请取消后重新下单，换一个时段或选择尽快送达');
    throw new ApiError(409, 'PAYMENT_NOT_ALLOWED', '订单已变化，请刷新');
  }
  const paid = orders.filter(o => paidIds.has(o.id));
  if (!paid[0].demo) {
    const first = paid[0], slot = first.slotDate && first.slotCode ? slotLabel(first.slotDate, first.slotCode, t) : '尽快送达';
    const place = (o: Payable) => o.dropPlace ? DROP_PLACE_LABELS[o.dropPlace] : `${o.buildingName}${o.mode === 'ROOM' ? ' · 到寝' : ' · 楼下'}`;
    const places = [...new Set(paid.map(place))];
    notifyGroupLater(env, 'NEW_ORDER', paid.length === 1 ? `新订单：${place(first)} · ${first.size === 'SMALL' ? '小件' : '大件'} · ${slot}`
      : `新订单（一次支付 ${paid.length} 件）：${places.slice(0, 3).join('、')}${places.length > 3 ? ' 等' : ''} · ${slot}`, `pay:${paid.map(o => o.id).sort()[0]}:${paid.length}`);
  }
  return { paid: paid.length, bundleFen: paid.reduce((s, o) => s + bundle.shares[orders.indexOf(o)], 0), couponFen: coupon ? [...coupon.shares.entries()].filter(([id]) => paidIds.has(id)).reduce((s, [, v]) => s + v, 0) : 0 };
}

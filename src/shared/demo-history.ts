/* © 2026 专业团队 · CampusDrop v4.7.0 · WM-A372E4790D8B1C09-E3C6A10A41 */
/*
 * v3.8 · the one-click demo's shared test data (测试数据). A pure planner (unit-tested): given "now", the active
 * buildings and stations and a seed, it lays out a few weeks of finished test deliveries for the reports — students
 * joining over time and coming back, couriers on shift, booked windows and "as soon as possible" orders, parcels paid
 * together with 多件满减, new-account coupons, ratings, tips, a few delivery exceptions, refunds and after-sales tickets.
 * worker/demo-history.ts writes the plan once a day; every demo then reads the same set. Everything here is made up.
 */
import { slotByCode, slotTime, beijingDate, type SlotCode } from './slots.ts';
import { RATING_TAGS_GOOD } from './engagement-rules.ts';
import { bundleDiscount, type BundleSetting } from './bundle.ts';
import { splitDiscount } from './coupons.ts';
import { DROP_PLACES, type DropPlace } from './campus-map.ts';

export const HISTORY_DAYS = 21;
export interface HistoryBuilding { code: string; zone: 'SOUTH' | 'NORTH'; name: string }
export interface HistoryStation { code: string }
export interface HistoryStudent { id: string; name: string; building: string; zone: 'SOUTH' | 'NORTH'; buildingName: string; room: string; joinedAt: number }
export interface HistoryCourier { id: string; name: string }
export interface HistoryEvent { from: string | null; to: string; at: number; actor: 'STUDENT' | 'ADMIN'; detail?: string }
export interface HistoryOrder {
  id: string; parcelId: string; student: number; courier: number; station: string; size: 'SMALL' | 'LARGE'; mode: 'DOWNSTAIRS' | 'ROOM';
  dropPlace: DropPlace | null; slot: { date: string; code: SlotCode } | null; amountFen: number; discountFen: number; bundleFen: number;
  checkout: string | null; group: string | null; batch: string; status: 'COMPLETED' | 'CANCELLED';
  createdAt: number; paidAt: number; finalAt: number; receivedAt: number | null; events: HistoryEvent[];
  rating?: { stars: number; tags: string[]; comment: string; at: number }; tipFen?: number; refundAt?: number; handoff: string;
}
export interface HistoryTicket { order: string; category: 'NOT_RECEIVED' | 'DAMAGED' | 'WRONG_DELIVERY' | 'REFUND' | 'OTHER'; subject: string; status: 'OPEN' | 'IN_PROGRESS' | 'RESOLVED' | 'CLOSED'; messages: { by: 'STUDENT' | 'ADMIN'; body: string; at: number }[] }
export interface HistoryPlan {
  students: HistoryStudent[]; couriers: HistoryCourier[]; orders: HistoryOrder[]; tickets: HistoryTicket[];
  checkouts: { id: string; student: number; at: number }[]; groups: { id: string; student: number; station: string; at: number }[];
  batches: { id: string; courier: number; station: string; at: number }[];
}

const MIN = 60, HOUR = 3600, DAY = 86400;
const SURNAMES = ['李', '王', '张', '刘', '陈', '杨', '赵', '黄', '周', '吴', '徐', '孙', '胡', '朱', '高', '林', '何', '郭', '马', '罗', '梁', '宋', '郑', '谢', '韩', '唐', '冯', '于', '董', '萧'];
const COURIERS = ['配送员·李明', '配送员·王晨', '配送员·张悦', '配送员·刘洋', '配送员·陈思', '配送员·赵宇'];
const COMMENTS = ['很快，谢谢！', '放在楼下架子上，很好找', '准时送到，辛苦了', '电话沟通很及时', '包装完好，点赞', '下雨天也很准时', '态度很好', '', '', '', ''];
const LATE_COMMENTS = ['比预约时间晚了一点', '', '稍微有点慢'];
const TICKETS: Omit<HistoryTicket, 'order' | 'status' | 'messages'>[] = [
  { category: 'NOT_RECEIVED', subject: '显示已送到楼下，没找到' }, { category: 'DAMAGED', subject: '外箱有压痕' },
  { category: 'WRONG_DELIVERY', subject: '送到了隔壁楼' }, { category: 'REFUND', subject: '重复下单，申请退款' }, { category: 'OTHER', subject: '希望放在门口' },
];
const REPLIES: Record<HistoryTicket['category'], [string, string]> = {
  NOT_RECEIVED: ['订单显示送到楼下了，我下去没看到。', '放在一楼快递架第二层，贴了收货码后四位；已陪同学找到。'],
  DAMAGED: ['收到时外箱一角压扁了，东西没坏。', '核对入库照片：入库时就有压痕，已向驿站反馈，感谢告知。'],
  WRONG_DELIVERY: ['包裹送到隔壁楼了。', '已经取回并送到正确的楼，抱歉耽误了时间。'],
  REFUND: ['同一个包裹下了两单，想退一单。', '已核实，重复的那单已取消并模拟退款。'],
  OTHER: ['以后能直接放门口吗？', '可以，下单时在备注写“放门口”，配送员会照做。'],
};

export function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const pick = <T>(r: () => number, list: readonly T[]): T => list[Math.floor(r() * list.length)];
const between = (r: () => number, lo: number, hi: number) => Math.round(lo + r() * (hi - lo));
const midnight = (now: number, daysAgo: number) => slotTime(beijingDate(now - daysAgo * DAY), '00:00');
const price = (size: 'SMALL' | 'LARGE', mode: 'DOWNSTAIRS' | 'ROOM') => size === 'SMALL' ? (mode === 'ROOM' ? 300 : 200) : (mode === 'ROOM' ? 700 : 500);

/** Orders on the day `i` days into the test (0 = first day): a pilot that grows, quieter at weekends. */
export function ordersOnDay(i: number, weekend: boolean, r: () => number): number {
  const base = 7 + i * 1.05, noise = 0.85 + r() * 0.3;
  return Math.max(3, Math.round(base * noise * (weekend ? 0.62 : 1)));
}

export function planHistory(now: number, seed: number, buildings: HistoryBuilding[], stations: HistoryStation[], bundle: BundleSetting | null, id: () => string): HistoryPlan {
  const r = seededRandom(seed), first = midnight(now, HISTORY_DAYS);
  const stationCodes = stations.map(s => s.code), near = (zone: string) => zone === 'SOUTH' ? (stationCodes.includes('NANSHI') ? 'NANSHI' : stationCodes[0]) : (stationCodes.includes('YIHAIYUAN') ? 'YIHAIYUAN' : stationCodes[0]);
  // Students: dorm residents mostly, a few in offices and labs; they join over the test (a third on the first days).
  const dorms = buildings.filter(b => /^(SOUTH|NORTH)_\d+$/.test(b.code)), others = buildings.filter(b => !dorms.includes(b));
  const students: HistoryStudent[] = Array.from({ length: 78 }, (_, k) => {
    const b = k % 7 === 6 && others.length ? pick(r, others) : pick(r, dorms.length ? dorms : buildings);
    const joinDay = k < 26 ? between(r, 0, 2) : between(r, 1, HISTORY_DAYS - 2);
    return { id: id(), name: `${SURNAMES[k % SURNAMES.length]}同学`, building: b.code, zone: b.zone, buildingName: b.name, room: /^(SOUTH|NORTH)_\d+$/.test(b.code) ? `${between(r, 1, 6)}${String(between(r, 1, 30)).padStart(2, '0')}` : `${between(r, 1, 4)}0${between(r, 1, 9)} 室`, joinedAt: first + joinDay * DAY + between(r, 8, 21) * HOUR };
  });
  const couriers: HistoryCourier[] = COURIERS.map(name => ({ id: id(), name }));
  // How keen each student is: a few order often, most now and then.
  const keen = students.map(() => 0.25 + Math.pow(r(), 2.2) * 3);
  const firstOrder = new Set<number>();
  const plan: HistoryPlan = { students, couriers, orders: [], tickets: [], checkouts: [], groups: [], batches: [] };
  const rainyDay = between(r, 5, HISTORY_DAYS - 4);

  for (let d = 0; d < HISTORY_DAYS; d++) {
    const day = first + d * DAY, date = beijingDate(day + HOUR), weekday = new Date((day + 9 * HOUR) * 1000).getUTCDay();
    const weekend = weekday === 0 || weekday === 6, rainy = d === rainyDay;
    let count = ordersOnDay(d, weekend, r) + (rainy ? 4 : 0);
    const active = students.map((s, k) => ({ k, w: s.joinedAt <= day + 20 * HOUR ? keen[k] : 0 })).filter(x => x.w > 0);
    while (count > 0 && active.length) {
      // Who orders: weighted by keenness.
      let roll = r() * active.reduce((a, x) => a + x.w, 0), k = active[0].k;
      for (const x of active) { roll -= x.w; if (roll <= 0) { k = x.k; break; } }
      const s = students[k];
      const asap = r() < 0.38, code = pick(r, ['NOON', 'EVENING', 'EVENING', 'NIGHT', 'NIGHT'] as SlotCode[]);
      const start = slotTime(date, slotByCode(code).start), end = slotTime(date, slotByCode(code).end);
      const paidAt = asap ? day + between(r, 9 * 60 + 30, 21 * 60) * MIN : start - between(r, 25, 120) * MIN;
      // Only days fully in the past: everything about the order (receipt, rating) has happened before now.
      if ((asap ? paidAt + 5 * HOUR : end + 4 * HOUR) > now) { count--; continue; }
      // Several parcels at once now and then (one payment, 多件满减 when the total reaches a tier).
      const n = r() < 0.17 ? between(r, 2, 5) : 1;
      const parcels = Array.from({ length: n }, () => {
        // People who pay for several at once often have a big box among them (that is when carrying is a chore).
        const size = r() < (n > 1 ? 0.5 : 0.28) ? 'LARGE' as const : 'SMALL' as const, place = r() < 0.08 ? pick(r, DROP_PLACES) : null;
        const mode = place ? 'DOWNSTAIRS' as const : r() < 0.56 ? 'ROOM' as const : 'DOWNSTAIRS' as const;
        return { size, mode, place, station: r() < 0.72 ? near(s.zone) : pick(r, stationCodes) };
      });
      const amounts = parcels.map(p => price(p.size, p.mode));
      const b = n > 1 ? bundleDiscount(bundle, amounts) : { discountFen: 0 };
      const bundleShares = splitDiscount(b.discountFen, amounts), left = amounts.map((a, i) => a - bundleShares[i]);
      // Coupons: most new students use the 新人五折券 on their first payment; now and then a code (QUST 立减 1 元).
      let coupon = 0;
      if (!firstOrder.has(k)) { firstOrder.add(k); if (r() < 0.72) coupon = Math.max(0, Math.min(Math.floor(left.reduce((a, c) => a + c, 0) / 2), left.reduce((a, c) => a + c, 0) - n)); }
      else if (r() < 0.07 && left.reduce((a, c) => a + c, 0) >= 200) coupon = 100;
      const couponShares = splitDiscount(coupon, left);
      const checkout = n > 1 ? id() : null, handoff = String(between(r, 0, 9999)).padStart(4, '0');
      if (checkout) plan.checkouts.push({ id: checkout, student: k, at: paidAt - 60 });
      const courier = between(r, 0, couriers.length - 1), slow = rainy ? 1.35 : 1;
      // Trips: same station and destination travel together (a merged group); each trip is one courier batch.
      const trips = new Map<string, { group: string | null; batch: string; items: number[] }>();
      parcels.forEach((p, i) => { const key = `${p.station}|${p.mode}|${p.place ?? ''}`; const t = trips.get(key) ?? { group: null, batch: id(), items: [] }; t.items.push(i); trips.set(key, t); });
      for (const [key, t] of trips) {
        const station = key.split('|')[0];
        if (t.items.length > 1) { t.group = id(); plan.groups.push({ id: t.group, student: k, station, at: paidAt - 60 }); }
        const claimedAt = asap ? paidAt + Math.round(between(r, 2, 14) * slow) * MIN : Math.max(paidAt + between(r, 3, 12) * MIN, start - between(r, 20, 55) * MIN);
        plan.batches.push({ id: t.batch, courier, station, at: claimedAt });
        const late = !asap && r() < (rainy ? 0.16 : 0.04), exception = r() < 0.025, cancelled = !exception && r() < 0.018;
        const ride = Math.round(between(r, 6, 15) * slow) * MIN;
        let pickedAt = asap ? claimedAt + Math.round(between(r, 4, 16) * slow) * MIN : Math.min(end - ride - between(r, 8, 25) * MIN, start + between(r, 0, 30) * MIN);
        if (late) pickedAt = end - ride + between(r, 3, 14) * MIN;
        const departAt = pickedAt + between(r, 2, 5) * MIN, exceptionAt = exception ? departAt + between(r, 4, 9) * MIN : 0;
        const deliveredAt = exception ? exceptionAt + between(r, 18, 35) * MIN : departAt + ride;
        for (const i of t.items) {
          const p = parcels[i], o: HistoryOrder = {
            id: id(), parcelId: id(), student: k, courier, station, size: p.size, mode: p.mode, dropPlace: p.place, slot: asap ? null : { date, code },
            amountFen: amounts[i], discountFen: couponShares[i], bundleFen: bundleShares[i], checkout, group: t.group, batch: t.batch,
            status: cancelled ? 'CANCELLED' : 'COMPLETED', createdAt: paidAt - between(r, 1, 3) * MIN, paidAt, finalAt: 0, receivedAt: null, events: [], handoff,
          };
          const ev = (from: string | null, to: string, at: number, actor: 'STUDENT' | 'ADMIN' = 'ADMIN', detail?: string) => o.events.push({ from, to, at, actor, ...(detail ? { detail } : {}) });
          ev(null, 'WAITING_PAYMENT', o.createdAt, 'STUDENT'); ev('WAITING_PAYMENT', 'WAITING_PICKUP', paidAt, 'STUDENT');
          if (cancelled) {
            const at = Math.min(claimedAt, paidAt + between(r, 5, 25) * MIN);
            ev('WAITING_PICKUP', 'CANCELLED', at, 'STUDENT'); o.finalAt = at; o.refundAt = at + 5;
          } else {
            const delivered = p.mode === 'ROOM' ? 'DELIVERED_TO_ROOM' : 'DELIVERED_DOWNSTAIRS';
            ev('WAITING_PICKUP', 'PICKED_UP', pickedAt); ev('PICKED_UP', 'OUT_FOR_DELIVERY', departAt);
            if (exception) { ev('OUT_FOR_DELIVERY', 'DELIVERY_EXCEPTION', exceptionAt, 'ADMIN', '电话没有接通，稍后再送'); ev('DELIVERY_EXCEPTION', 'OUT_FOR_DELIVERY', exceptionAt + between(r, 5, 12) * MIN); }
            ev('OUT_FOR_DELIVERY', delivered, deliveredAt);
            o.receivedAt = deliveredAt + between(r, 3, 95) * MIN; ev(delivered, 'COMPLETED', o.receivedAt, 'STUDENT'); o.finalAt = o.receivedAt;
            if (r() < 0.63) {
              const x = r(), stars = late || exception ? (x < 0.5 ? 4 : 3) : x < 0.78 ? 5 : x < 0.95 ? 4 : 3;
              const tags = stars <= 3 ? ['送达较慢'] : [...new Set([pick(r, RATING_TAGS_GOOD), pick(r, RATING_TAGS_GOOD)])];
              o.rating = { stars, tags, comment: stars <= 3 ? pick(r, LATE_COMMENTS) : pick(r, COMMENTS), at: o.receivedAt + between(r, 1, 40) * MIN };
              if (stars === 5 && r() < 0.12) o.tipFen = pick(r, [100, 200, 300]);
            }
          }
          plan.orders.push(o);
        }
      }
      count -= n;
    }
  }
  // After-sales tickets on about one order in 70; the newest one is still open.
  const done = plan.orders.filter(o => o.status === 'COMPLETED');
  const ticketCount = Math.max(4, Math.round(plan.orders.length / 70));
  for (let i = 0; i < ticketCount && done.length; i++) {
    const o = done[Math.floor((i + 0.5) / ticketCount * done.length)], kind = TICKETS[i % TICKETS.length];
    if (plan.tickets.some(t => t.order === o.id)) continue;
    const opened = (o.receivedAt ?? o.finalAt) + between(r, 10, 120) * MIN, replied = opened + between(r, 25, 240) * MIN;
    if (opened > now - MIN) continue;
    const newest = i === ticketCount - 1, answered = replied <= now - MIN;
    plan.tickets.push({ order: o.id, ...kind, status: !answered ? 'OPEN' : newest ? 'IN_PROGRESS' : r() < 0.7 ? 'RESOLVED' : 'CLOSED',
      messages: [{ by: 'STUDENT', body: REPLIES[kind.category][0], at: opened }, ...(answered ? [{ by: 'ADMIN' as const, body: REPLIES[kind.category][1], at: replied }] : [])] });
  }
  return plan;
}

/*
 * v3.7 · one-click demo data plan. Pure functions (unit-tested): who lives where, and which orders the demo starts with —
 * three weeks of finished deliveries (for 结算, 月报, 准时率, 数据看板 and the forecast) plus a realistic current
 * workload for the couriers: orders waiting in the market, claimed but not yet collected, collected and waiting to set
 * off, on the way, delivered and waiting for the student, and one delivery exception. The worker turns the plan into
 * rows (worker/demo-seed.ts). Everything here is made up for the demo and only ever lives under the demo's own group.
 */
import { slotOpen, slotTime, slotByCode, beijingDate, bookableDates, type SlotCode } from './slots.ts';
import { RATING_TAGS_GOOD } from './engagement-rules.ts';

export type DemoStationCode = 'YIHAIYUAN' | 'NANSHI';
export interface DemoPerson { name: string; zone: 'SOUTH' | 'NORTH'; building: string; buildingName: string; room: string }
/** Index 0 is the visitor's own student; the rest are neighbours whose orders keep the couriers busy. */
export const DEMO_PEOPLE: DemoPerson[] = [
  { name: '体验同学', zone: 'NORTH', building: 'NORTH_04', buildingName: '北苑4号楼', room: '301' },
  { name: '林同学', zone: 'SOUTH', building: 'SOUTH_02', buildingName: '南苑2号楼', room: '412' },
  { name: '周同学', zone: 'SOUTH', building: 'LIBRARY_HALL', buildingName: '图书馆', room: '三楼研修间 12' },
  { name: '陈老师', zone: 'NORTH', building: 'NORTH_B1', buildingName: '北1楼', room: '305 办公室' },
  { name: '王同学', zone: 'NORTH', building: 'EAST_2', buildingName: '东2楼', room: '208 实验室' },
  { name: '赵同学', zone: 'SOUTH', building: 'SOUTH_07', buildingName: '南苑7号楼', room: '516' },
  { name: '孙同学', zone: 'NORTH', building: 'GYM', buildingName: '体育馆', room: '一楼器材室' },
  { name: '吴同学', zone: 'NORTH', building: 'NORTH_07', buildingName: '北苑7号楼', room: '622' },
];

export type DemoStage = 'DONE' | 'DELIVERED' | 'OUT' | 'PICKED' | 'CLAIMED' | 'MARKET' | 'EXCEPTION';
export type DemoCourier = 'courier' | 'senior';
export interface DemoOrderPlan {
  person: number;
  station: DemoStationCode;
  size: 'SMALL' | 'LARGE';
  mode: 'DOWNSTAIRS' | 'ROOM';
  carrier: string;
  slot: { date: string; code: SlotCode } | null;
  stage: DemoStage;
  courier: DemoCourier | null;
  createdAt: number; paidAt: number;
  claimedAt?: number; pickedAt?: number; departAt?: number; deliveredAt?: number; exceptionAt?: number; receivedAt?: number;
  rating?: { stars: number; tags: string[]; comment: string; at: number };
  tipFen?: number;
  /** Key used by the ticket plan to point at this order. */
  ref?: string;
}
export interface DemoTicketPlan {
  ref: string; category: 'NOT_RECEIVED' | 'DAMAGED' | 'WRONG_DELIVERY' | 'REFUND' | 'OTHER'; subject: string;
  status: 'OPEN' | 'IN_PROGRESS' | 'RESOLVED' | 'CLOSED';
  messages: { by: 'STUDENT' | 'courier' | 'senior'; body: string; after: number }[];
}

const MIN = 60, HOUR = 3600, DAY = 86400;
const CARRIERS = ['中通', '圆通', '韵达', '申通', '顺丰', '京东', '极兔', '邮政'];
const COMMENTS = ['很快，谢谢！', '放在楼下架子上，很好找', '下雨天还准时送到，辛苦了', '电话沟通很及时', '', '', '', '包装完好，点赞'];

/** Small deterministic generator so a plan can be reproduced in tests (mulberry32). */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const pick = <T>(rand: () => number, list: readonly T[]): T => list[Math.floor(rand() * list.length)];
const between = (rand: () => number, lo: number, hi: number) => Math.round(lo + rand() * (hi - lo));
/** Beijing midnight (epoch seconds) of the day that is `daysAgo` days before `now`. */
const midnight = (now: number, daysAgo: number) => slotTime(beijingDate(now - daysAgo * DAY), '00:00');
/** The station nearer to a building, by side of campus (南十 for the west of 南苑, 颐海苑 otherwise). */
const stationFor = (rand: () => number, person: DemoPerson): DemoStationCode => person.zone === 'SOUTH' && rand() < 0.6 ? 'NANSHI' : rand() < 0.35 ? 'NANSHI' : 'YIHAIYUAN';

/** First window still open for booking, or null (then the order is "as soon as possible"). */
export function nextOpenSlot(now: number): { date: string; code: SlotCode } | null {
  for (const date of bookableDates(now)) for (const code of ['NOON', 'EVENING', 'NIGHT'] as SlotCode[]) if (slotOpen(date, code, now)) return { date, code };
  return null;
}

/** One finished delivery on a past day. `late` makes it miss its window by a few minutes (real life does). */
function finished(rand: () => number, now: number, daysAgo: number, person: number, courier: DemoCourier, late = false): DemoOrderPlan {
  const who = DEMO_PEOPLE[person], day = midnight(now, daysAgo), date = beijingDate(day + HOUR);
  const asap = rand() < 0.35, code = pick(rand, ['NOON', 'EVENING', 'EVENING', 'NIGHT'] as SlotCode[]);
  const size = rand() < 0.25 ? 'LARGE' : 'SMALL', mode = rand() < 0.55 ? 'ROOM' : 'DOWNSTAIRS';
  const ride = between(rand, 6, 14) * MIN;
  let paidAt: number, claimedAt: number, pickedAt: number;
  if (asap) {
    paidAt = day + between(rand, 10 * 60, 20 * 60 + 30) * MIN;
    claimedAt = paidAt + between(rand, 2, 12) * MIN; pickedAt = claimedAt + between(rand, 4, 12) * MIN;
  } else {
    const start = slotTime(date, slotByCode(code).start), end = slotTime(date, slotByCode(code).end);
    paidAt = start - between(rand, 35, 180) * MIN; claimedAt = Math.max(paidAt + between(rand, 3, 10) * MIN, start - between(rand, 15, 45) * MIN);
    pickedAt = Math.min(end - ride - 15 * MIN, start + between(rand, 0, 25) * MIN);
    if (late) pickedAt = end - ride + between(rand, 3, 9) * MIN;
  }
  const departAt = pickedAt + between(rand, 2, 5) * MIN, deliveredAt = departAt + ride;
  const receivedAt = deliveredAt + between(rand, 4, 80) * MIN;
  const plan: DemoOrderPlan = {
    person, station: stationFor(rand, who), size, mode, carrier: pick(rand, CARRIERS), slot: asap ? null : { date, code },
    stage: 'DONE', courier, createdAt: paidAt - between(rand, 1, 4) * MIN, paidAt, claimedAt, pickedAt, departAt, deliveredAt, receivedAt,
  };
  if (rand() < 0.7) {
    const r = rand(), stars = late ? 3 : r < 0.72 ? 5 : r < 0.94 ? 4 : 3;
    const tags = stars === 3 ? ['送达较慢'] : [...new Set([pick(rand, RATING_TAGS_GOOD), pick(rand, RATING_TAGS_GOOD)])];
    plan.rating = { stars, tags, comment: stars === 3 ? '' : pick(rand, COMMENTS), at: receivedAt + between(rand, 1, 20) * MIN };
    if (stars === 5 && rand() < 0.18) plan.tipFen = pick(rand, [100, 200, 300]);
  }
  return plan;
}

/**
 * The demo's orders. History covers the last 21 days (fewer on weekends); the visitor's own student has a few past
 * orders too (two with after-sales tickets). The live part is built around `now`.
 */
export function planDemoOrders(now: number, rand: () => number): DemoOrderPlan[] {
  const plans: DemoOrderPlan[] = [];
  const own: Record<number, string> = { 19: 'own-old', 13: 'own-damaged', 8: 'own-tip', 4: 'own-recent' };
  for (let daysAgo = 21; daysAgo >= 1; daysAgo--) {
    const weekday = new Date((midnight(now, daysAgo) + 8 * HOUR + HOUR) * 1000).getUTCDay();
    const weekend = weekday === 0 || weekday === 6;
    const count = weekend ? (rand() < 0.5 ? 1 : 0) : rand() < 0.15 ? 2 : 1;
    for (let i = 0; i < count; i++) {
      const courier: DemoCourier = rand() < 0.68 ? 'courier' : 'senior';
      plans.push(finished(rand, now, daysAgo, between(rand, 1, DEMO_PEOPLE.length - 1), courier, daysAgo % 9 === 3 && i === 0));
    }
    if (own[daysAgo]) {
      const p = finished(rand, now, daysAgo, 0, 'courier');
      p.ref = own[daysAgo];
      if (p.ref === 'own-tip') { p.rating = { stars: 5, tags: ['准时送达', '态度友好'], comment: '晚上还送到寝室，谢谢！', at: p.receivedAt! + 5 * MIN }; p.tipFen = 200; }
      if (p.ref === 'own-damaged') { p.size = 'LARGE'; p.rating = undefined; p.tipFen = undefined; }
      plans.push(p);
    }
    if (daysAgo === 3) { const p = finished(rand, now, daysAgo, 3, 'courier'); p.ref = 'n-wrong'; p.rating = undefined; p.tipFen = undefined; plans.push(p); }
    if (daysAgo === 6) { const p = finished(rand, now, daysAgo, 5, 'senior'); p.ref = 'n-refund'; p.rating = undefined; p.tipFen = undefined; plans.push(p); }
  }
  // The visitor's student: delivered downstairs two days ago, not confirmed yet — a ticket says it was not found.
  const lost = finished(rand, now, 2, 0, 'courier');
  Object.assign(lost, { stage: 'DELIVERED', mode: 'DOWNSTAIRS', receivedAt: undefined, rating: undefined, tipFen: undefined, ref: 'own-lost' });
  plans.push(lost);

  // ---- live workload
  const slot = nextOpenSlot(now);
  const live = (person: number, stage: DemoStage, courier: DemoCourier | null, minutesAgo: number, extra: Partial<DemoOrderPlan> = {}): DemoOrderPlan => {
    const who = DEMO_PEOPLE[person], paidAt = now - minutesAgo * MIN;
    const p: DemoOrderPlan = { person, station: stationFor(rand, who), size: 'SMALL', mode: 'ROOM', carrier: pick(rand, CARRIERS), slot: null, stage, courier, createdAt: paidAt - 2 * MIN, paidAt, ...extra };
    if (stage !== 'MARKET') p.claimedAt = paidAt + Math.min(6, minutesAgo / 4) * MIN;
    return p;
  };
  plans.push(
    live(1, 'MARKET', null, 22, { slot, ref: 'n-market' }),
    live(2, 'MARKET', null, 6, { mode: 'DOWNSTAIRS' }),
    live(3, 'MARKET', null, 15, { size: 'LARGE', mode: 'DOWNSTAIRS', slot }),
    live(7, 'MARKET', null, 3, {}),
    live(4, 'CLAIMED', 'courier', 34, {}),
    live(5, 'PICKED', 'courier', 26, { pickedAt: now - 11 * MIN }),
    live(6, 'PICKED', 'courier', 24, { pickedAt: now - 9 * MIN, size: 'LARGE' }),
    live(5, 'OUT', 'courier', 30, { pickedAt: now - 6 * MIN, departAt: now - 40, mode: 'DOWNSTAIRS' }),
    live(3, 'EXCEPTION', 'courier', 70, { pickedAt: now - 52 * MIN, departAt: now - 48 * MIN, exceptionAt: now - 36 * MIN }),
    live(4, 'DELIVERED', 'courier', 75, { pickedAt: now - 58 * MIN, departAt: now - 55 * MIN, deliveredAt: now - 44 * MIN, mode: 'DOWNSTAIRS' }),
    live(1, 'PICKED', 'senior', 28, { pickedAt: now - 8 * MIN }),
    live(6, 'DELIVERED', 'senior', 150, { pickedAt: now - 128 * MIN, departAt: now - 125 * MIN, deliveredAt: now - 112 * MIN }),
  );
  // The live part stays on "today": never earlier than the history it follows.
  return plans.sort((a, b) => a.createdAt - b.createdAt);
}

export const DEMO_TICKETS: DemoTicketPlan[] = [
  { ref: 'own-damaged', category: 'DAMAGED', subject: '外箱一角压扁了', status: 'RESOLVED', messages: [
    { by: 'STUDENT', body: '收到的时候外箱一角压扁了，里面的杯子没碎，想确认一下是哪个环节压到的。', after: 40 * MIN },
    { by: 'senior', body: '已核对驿站入库照片：入库时外箱就有压痕，配送途中没有挤压。已经向驿站反馈。杯子没事就好，需要退配送费的话直接回复我。', after: 3 * HOUR },
  ] },
  { ref: 'own-lost', category: 'NOT_RECEIVED', subject: '显示已送到楼下，但没找到', status: 'IN_PROGRESS', messages: [
    { by: 'STUDENT', body: '订单显示已送到楼下，我下楼没看到包裹。', after: 50 * MIN },
    { by: 'courier', body: '我放在北苑4号楼一楼快递架第二层，贴了你的收货码后四位，麻烦再看一下；还找不到的话我晚上过去一起找。', after: 75 * MIN },
  ] },
  { ref: 'n-wrong', category: 'WRONG_DELIVERY', subject: '收到的不是我的包裹', status: 'OPEN', messages: [
    { by: 'STUDENT', body: '今天送来的包裹收件人不是我，取件码也对不上，包裹先放在办公室了。', after: 2 * HOUR },
  ] },
  { ref: 'n-refund', category: 'REFUND', subject: '重复下单，申请退配送费', status: 'CLOSED', messages: [
    { by: 'STUDENT', body: '同一件包裹不小心下了两单，申请退其中一单的配送费。', after: 20 * MIN },
    { by: 'senior', body: '已核实，重复的那单已取消并模拟退款，原路退回。', after: 2 * HOUR },
  ] },
  { ref: 'n-market', category: 'OTHER', subject: '能不能放门口，不用敲门', status: 'OPEN', messages: [
    { by: 'STUDENT', body: '室友在睡觉，送到后放门口就好，不用敲门，谢谢。', after: 3 * MIN },
  ] },
];

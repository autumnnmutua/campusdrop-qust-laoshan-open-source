/* © 2026 专业团队 · CampusDrop v4.7.0 · WM-A372E4790D8B1C09-CDBB3F5732 */
import type { Env } from './types';
import { CAMPUS_ID } from '../shared/contracts';
import { DEMO_PEOPLE, DEMO_TICKETS, planDemoOrders, seededRandom, type DemoOrderPlan } from '../shared/demo-plan';

/*
 * v3.7 · writes the demo's starting data (shared/demo-plan.ts) under its demo_group: neighbour students, recent
 * finished deliveries with ratings and a few tips, the couriers' current workload and after-sales tickets. Orders go
 * through the same table triggers as real ones (payment → market → batch → each status step), so every guard still
 * holds; afterwards the event, message and ticket times are moved back to when the plan says they happened.
 * All statements run in a few D1 batches (one query each against the per-request limit).
 */
const hex = (n: number) => Array.from(crypto.getRandomValues(new Uint8Array(n)), b => b.toString(16).padStart(2, '0')).join('');
const pickupCode = (rand: () => number) => `${10 + Math.floor(rand() * 80)}-${1 + Math.floor(rand() * 9)}-${1000 + Math.floor(rand() * 9000)}`;
const handoff = (rand: () => number) => String(Math.floor(rand() * 10000)).padStart(4, '0');
const priceFen = (size: string, mode: string) => size === 'SMALL' ? (mode === 'ROOM' ? 300 : 200) : (mode === 'ROOM' ? 700 : 500);
const PHONES = ['13800000010', '13800000011', '13800000012', '13800000013', '13800000014', '13800000015', '13800000016', '13800000017'];

export interface DemoIds { group: string; tag: string; studentId: string; courierId: string; seniorId: string }

export async function seedDemo(env: Env, ids: DemoIds, now: number): Promise<{ orders: number; statements: number; rowsWritten: number }> {
  const rand = seededRandom(parseInt(ids.tag, 16) || 1);
  const db = env.DB, s: D1PreparedStatement[] = [];
  // Neighbour students (index 0 is the visitor's own student, already created).
  const users = [ids.studentId, ...DEMO_PEOPLE.slice(1).map(() => crypto.randomUUID())];
  DEMO_PEOPLE.forEach((p, i) => {
    if (i === 0) return;
    s.push(db.prepare("INSERT INTO users(id,username,password_hash,name,phone,demo_group,created_at) VALUES(?,?,'demo$no-password',?,?,?,?)").bind(users[i], `demo_${ids.tag}_${i}`, p.name, PHONES[i], ids.group, now - 30 * 86400));
    s.push(db.prepare('INSERT INTO user_addresses(id,user_id,campus_id,zone,dorm_building_code,room_no,valid_from) VALUES(?,?,?,?,?,?,?)').bind(crypto.randomUUID(), users[i], CAMPUS_ID, p.zone, p.building, p.room, now - 30 * 86400));
  });
  const admins = { courier: ids.courierId, senior: ids.seniorId };
  const plans = planDemoOrders(now, rand), orderIds = new Map<string, { id: string; plan: DemoOrderPlan }>();
  for (const plan of plans) {
    const who = DEMO_PEOPLE[plan.person], userId = users[plan.person], orderId = crypto.randomUUID(), parcelId = crypto.randomUUID();
    if (plan.ref) orderIds.set(plan.ref, { id: orderId, plan });
    const amount = priceFen(plan.size, plan.mode), admin = plan.courier ? admins[plan.courier] : null;
    const phone = plan.person === 0 ? '13800000000' : PHONES[plan.person];
    s.push(db.prepare('INSERT INTO parcels(id,user_id,pickup_code,station_code,size,carrier,note,created_at) VALUES(?,?,?,?,?,?,?,?)')
      .bind(parcelId, userId, pickupCode(rand), plan.station, plan.size, plan.carrier, '', plan.createdAt - 1800));
    s.push(db.prepare(`INSERT INTO delivery_orders(id,parcel_id,user_id,campus_id,zone,dorm_building_code,station_code,package_size,delivery_mode,amount_fen,
        price_snapshot_json,dorm_snapshot_json,station_snapshot_json,last_actor_type,last_actor_id,handoff_code,slot_date,slot_code,demo_group,created_at,updated_at)
      SELECT ?,?,?,?,?,?,?,?,?,?,?,?,json_object('code',code,'canonicalName',canonical_name,'relativeLocation',relative_location,'lat',lat,'lng',lng),'STUDENT',?,?,?,?,?,?,? FROM stations WHERE code=?`)
      .bind(orderId, parcelId, userId, CAMPUS_ID, who.zone, who.building, plan.station, plan.size, plan.mode, amount,
        JSON.stringify({ version: 1, packageSize: plan.size, deliveryMode: plan.mode, amountFen: amount }),
        JSON.stringify({ campusId: CAMPUS_ID, zone: who.zone, buildingCode: who.building, buildingName: who.buildingName, roomNo: who.room, name: who.name, phone }),
        userId, handoff(rand), plan.slot?.date ?? null, plan.slot?.code ?? null, ids.group, plan.createdAt, plan.createdAt, plan.station));
    s.push(db.prepare("INSERT INTO payments(id,order_id,type,provider,amount_fen,status,idempotency_key,created_at) VALUES(?,?,'DELIVERY','MOCK',?,'SUCCEEDED',?,?)").bind(crypto.randomUUID(), orderId, amount, `demo-${hex(6)}`, plan.paidAt));
    if (admin && plan.claimedAt) {
      const batchId = crypto.randomUUID();
      s.push(db.prepare('INSERT INTO delivery_batches(id,station_code,assignee_admin_id,created_by,created_at) VALUES(?,?,?,?,?)').bind(batchId, plan.station, admin, admin, plan.claimedAt));
      s.push(db.prepare('INSERT INTO batch_items(batch_id,order_id,sort_order) VALUES(?,?,0)').bind(batchId, orderId));
    }
    const step = (status: string, at: number, extra = '', ...bind: (string | number)[]) =>
      s.push(db.prepare(`UPDATE delivery_orders SET status=?,version=version+1,last_actor_type='ADMIN',last_actor_id=?,updated_at=?${extra} WHERE id=?`).bind(status, admin, at, ...bind, orderId));
    if (admin && plan.pickedAt) step('PICKED_UP', plan.pickedAt);
    if (admin && plan.departAt) step('OUT_FOR_DELIVERY', plan.departAt);
    if (admin && plan.exceptionAt) step('DELIVERY_EXCEPTION', plan.exceptionAt, ",exception_code='UNREACHABLE',exception_note=?", '电话两次没有接通，包裹暂由配送员保管，稍后再联系');
    const delivered = plan.mode === 'ROOM' ? 'DELIVERED_TO_ROOM' : 'DELIVERED_DOWNSTAIRS';
    if (admin && plan.deliveredAt) step(delivered, plan.deliveredAt);
    if (plan.receivedAt) s.push(db.prepare("UPDATE delivery_orders SET status='COMPLETED',version=version+1,received_at=?,last_actor_type='STUDENT',last_actor_id=user_id,updated_at=? WHERE id=?").bind(plan.receivedAt, plan.receivedAt, orderId));
    // Move the timeline back to when it happened (the triggers stamped "now").
    const times: [string, number | undefined][] = [['WAITING_PAYMENT', plan.createdAt], ['WAITING_PICKUP', plan.paidAt], ['CLAIMED', plan.claimedAt], ['PICKED_UP', plan.pickedAt], ['OUT_FOR_DELIVERY', plan.departAt],
      ['DELIVERY_EXCEPTION', plan.exceptionAt], [delivered, plan.deliveredAt], ['COMPLETED', plan.receivedAt]];
    const known = times.filter((x): x is [string, number] => x[1] !== undefined);
    const caseOf = (col: string) => `CASE ${known.map(() => `WHEN ${col}=? THEN ?`).join(' ')} ELSE created_at END`, caseBind = known.flat();
    s.push(db.prepare(`UPDATE order_events SET created_at=${caseOf('to_status')} WHERE order_id=?`).bind(...caseBind, orderId));
    // Messages (only the visitor's own student reads them): history reads as already seen, the rest stays unread.
    const done = plan.stage === 'DONE';
    if (plan.person === 0) s.push(db.prepare(`UPDATE inbox_messages SET created_at=${caseOf('kind')}${done ? ',read_at=coalesce(read_at,created_at)' : ''} WHERE order_id=?`).bind(...caseBind, orderId));
    if (plan.rating) s.push(db.prepare('INSERT INTO order_ratings(order_id,user_id,stars,tags_json,comment,created_at) VALUES(?,?,?,?,?,?)').bind(orderId, userId, plan.rating.stars, JSON.stringify(plan.rating.tags), plan.rating.comment, plan.rating.at));
    if (plan.tipFen && plan.rating) s.push(db.prepare("INSERT INTO payments(id,order_id,type,provider,amount_fen,status,idempotency_key,created_at) VALUES(?,?,'TIP','MOCK',?,'SUCCEEDED',?,?)").bind(crypto.randomUUID(), orderId, plan.tipFen, `demo-tip-${hex(6)}`, plan.rating.at + 30));
  }
  // After-sales tickets on the orders the plan marked.
  for (const ticket of DEMO_TICKETS) {
    const target = orderIds.get(ticket.ref);
    if (!target) continue;
    const id = crypto.randomUUID(), base = target.plan.deliveredAt ?? target.plan.paidAt, userId = users[target.plan.person];
    const opened = base + ticket.messages[0].after, last = base + ticket.messages[ticket.messages.length - 1].after;
    s.push(db.prepare('INSERT INTO support_tickets(id,order_id,user_id,category,subject,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)').bind(id, target.id, userId, ticket.category, ticket.subject, ticket.status, opened, last));
    for (const m of ticket.messages) {
      const actor = m.by === 'STUDENT' ? userId : admins[m.by];
      s.push(db.prepare('INSERT INTO ticket_messages(ticket_id,actor_kind,actor_id,body,created_at) VALUES(?,?,?,?,?)').bind(id, m.by === 'STUDENT' ? 'STUDENT' : 'ADMIN', actor, m.body, base + m.after));
    }
    const seen = ticket.status === 'RESOLVED' || ticket.status === 'CLOSED';
    s.push(db.prepare(`UPDATE support_tickets SET updated_at=?,version=? WHERE id=?`).bind(last, ticket.messages.length, id));
    s.push(db.prepare(`UPDATE inbox_messages SET created_at=?${seen ? ',read_at=?' : ''} WHERE order_id=? AND kind LIKE 'TICKET%'`).bind(...(seen ? [last, last] : [last]), target.id));
  }
  // Shifts for the next days, so the scheduling page is not empty.
  for (const [offset, code] of [[0, 'EVENING'], [0, 'NIGHT'], [1, 'NOON'], [1, 'EVENING'], [2, 'NIGHT']] as const) {
    const date = new Date((now + 8 * 3600 + offset * 86400) * 1000).toISOString().slice(0, 10);
    s.push(db.prepare('INSERT OR IGNORE INTO courier_shifts(admin_id,slot_date,slot_code,created_at) VALUES(?,?,?,?)').bind(ids.courierId, date, code, now - 86400));
  }
  let written = 0;
  for (let i = 0; i < s.length; i += 300) for (const r of await db.batch(s.slice(i, i + 300))) written += r.meta?.rows_written ?? 0;
  return { orders: plans.length, statements: s.length, rowsWritten: written };
}

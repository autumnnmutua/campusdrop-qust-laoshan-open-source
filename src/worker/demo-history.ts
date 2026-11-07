/* © 2026 专业团队 · CampusDrop v4.0.0 */
import type { Env } from './types';
import { CAMPUS_ID } from '../shared/contracts';
import { planHistory, type HistoryBuilding, type HistoryStation } from '../shared/demo-history';
import { beijingDate } from '../shared/slots';
import { bundleSetting } from './settings';

/*
 * v3.8 · the demo's shared test data (测试数据). Once a day the first one-click demo builds a fresh set from
 * shared/demo-history.ts; every demo then reads the newest ready set (orderScope adds it for the demo's 超级管理员).
 * Rows are written in their final state with set-based INSERT … SELECT FROM json_each(?) statements — a dozen
 * statements in one D1 batch, about 45 written rows per test order including indexes, instead of every demo writing its
 * own copy (finished orders carry no door code, as the daily privacy job would have cleared it). Migration 0017's triggers let exactly these rows skip the live steps and make them read-only once ready.
 * Older sets stay in the database, hidden (only the newest ready set is ever read).
 */
const now = () => Math.floor(Date.now() / 1000);
const TAKEOVER_SECONDS = 300;
const NO_PASSWORD = 'demo$no-password';

/** The newest ready set's group (or null), building today's set first when nobody has yet. */
export async function ensureDemoHistory(env: Env, t = now()): Promise<string | null> {
  const day = beijingDate(t);
  const ready = () => env.DB.prepare("SELECT group_id AS g FROM demo_history_sets WHERE status='READY' ORDER BY day DESC LIMIT 1").first<string>('g');
  const today = await env.DB.prepare('SELECT group_id AS g,status,created_at AS at FROM demo_history_sets WHERE day=?').bind(day).first<{ g: string; status: string; at: number }>();
  if (today?.status === 'READY') return today.g;
  const group = `history-${crypto.randomUUID()}`;
  const claimed = !today
    ? await env.DB.prepare("INSERT INTO demo_history_sets(day,group_id,status,created_at) VALUES(?,?,'BUILDING',?) ON CONFLICT(day) DO NOTHING RETURNING group_id AS g").bind(day, group, t).first<string>('g')
    : today.at < t - TAKEOVER_SECONDS
      ? await env.DB.prepare("UPDATE demo_history_sets SET group_id=?,status='BUILDING',created_at=? WHERE day=? AND group_id=? AND status<>'READY' RETURNING group_id AS g").bind(group, t, day, today.g).first<string>('g')
      : null;
  if (!claimed) return ready();
  try {
    const orders = await buildHistory(env, group, t);
    await env.DB.prepare("UPDATE demo_history_sets SET status='READY',orders=?,ready_at=unixepoch() WHERE group_id=?").bind(orders, group).run();
    console.log(JSON.stringify({ event: 'demo_history_ready', day, orders }));
    return group;
  } catch (error) {
    console.error(JSON.stringify({ event: 'demo_history_failed', day, error: String(error).slice(0, 300) }));
    await env.DB.prepare("UPDATE demo_history_sets SET status='FAILED' WHERE group_id=?").bind(group).run().catch(() => undefined);
    return ready();
  }
}

async function buildHistory(env: Env, group: string, t: number): Promise<number> {
  const db = env.DB;
  const buildings = (await db.prepare('SELECT code,zone,display_name AS name FROM dorm_buildings WHERE active=1').all<HistoryBuilding>()).results;
  const stations = (await db.prepare('SELECT code FROM stations WHERE active=1').all<HistoryStation>()).results;
  const seed = parseInt(beijingDate(t).replace(/-/g, ''), 10);
  const plan = planHistory(t, seed, buildings, stations, await bundleSetting(env), () => crypto.randomUUID());
  const tag = group.slice(8, 14);
  const students = plan.students.map((s, i) => ({ id: s.id, username: `hist_${tag}_${i}`, name: s.name, phone: `1380001${String(1000 + i).slice(-4)}`, at: s.joinedAt - 3 * 86400 }));
  const couriers = plan.couriers.map(c => ({ id: c.id, username: c.name, at: t - 60 * 86400 }));
  const orders = plan.orders.map(o => {
    const s = plan.students[o.student], paid = o.amountFen - o.discountFen - o.bundleFen;
    return {
      id: o.id, parcel: o.parcelId, user: s.id, zone: s.zone, building: s.building, station: o.station, size: o.size, mode: o.mode, amount: o.amountFen,
      price: JSON.stringify({ version: 1, packageSize: o.size, deliveryMode: o.mode, amountFen: o.amountFen }),
      dorm: JSON.stringify({ campusId: CAMPUS_ID, zone: s.zone, buildingCode: s.building, buildingName: s.buildingName, roomNo: s.room, name: s.name, phone: students[o.student].phone }),
      status: o.status, cancelled: o.status === 'CANCELLED' ? 1 : 0, created: o.createdAt, updated: o.finalAt, received: o.receivedAt, handoff: o.handoff,
      slotDate: o.slot?.date ?? null, slotCode: o.slot?.code ?? null, place: o.dropPlace, groupId: o.group, checkout: o.checkout, discount: o.discountFen, bundle: o.bundleFen,
      paid, paidAt: o.paidAt, courier: plan.couriers[o.courier].id, batch: o.batch, version: o.events.length - 1,
    };
  });
  const events = plan.orders.flatMap(o => o.events.map(e => ({ o: o.id, f: e.from, s: e.to, a: e.actor, id: e.actor === 'STUDENT' ? plan.students[o.student].id : plan.couriers[o.courier].id, at: e.at, d: e.detail ?? '' })));
  const ratings = plan.orders.filter(o => o.rating).map(o => ({ o: o.id, u: plan.students[o.student].id, s: o.rating!.stars, tags: JSON.stringify(o.rating!.tags), c: o.rating!.comment, at: o.rating!.at }));
  const tips = plan.orders.filter(o => o.tipFen && o.rating).map(o => ({ o: o.id, f: o.tipFen, at: o.rating!.at + 30 }));
  const refunds = plan.orders.filter(o => o.refundAt).map(o => ({ o: o.id, f: o.amountFen - o.discountFen - o.bundleFen, at: o.refundAt }));
  const items = plan.orders.filter(o => o.status === 'COMPLETED').map((o, i) => ({ b: o.batch, o: o.id, n: i }));
  const tickets = plan.tickets.map(tk => { const o = plan.orders.find(x => x.id === tk.order)!; return { id: crypto.randomUUID(), o: o.id, u: plan.students[o.student].id, c: o.courier, k: tk.category, s: tk.subject, st: tk.status, at: tk.messages[0].at, up: tk.messages[tk.messages.length - 1].at, v: tk.messages.length, m: tk.messages }; });
  const messages = tickets.flatMap(tk => tk.m.map(m => ({ t: tk.id, k: m.by, a: m.by === 'STUDENT' ? tk.u : plan.couriers[tk.c].id, b: m.body, at: m.at })));
  const J = (v: unknown) => JSON.stringify(v), x = (k: string) => `json_extract(value,'$.${k}')`;
  const statements: D1PreparedStatement[] = [
    // Earlier sets' couriers give up the display names (usernames are unique), so today's set can use them.
    db.prepare("UPDATE admin_users SET username=username||'#'||substr(id,1,8) WHERE demo_group LIKE 'history-%' AND demo_group<>? AND instr(username,'#')=0").bind(group),
    db.prepare(`INSERT INTO users(id,username,password_hash,name,phone,demo_group,created_at) SELECT ${x('id')},${x('username')},?,${x('name')},${x('phone')},?,${x('at')} FROM json_each(?)`).bind(NO_PASSWORD, group, J(students)),
    db.prepare(`INSERT INTO admin_users(id,username,password_hash,role,phone,demo_group,created_at) SELECT ${x('id')},${x('username')},?,'DELIVERY_STAFF',NULL,?,${x('at')} FROM json_each(?)`).bind(NO_PASSWORD, group, J(couriers)),
    db.prepare(`INSERT INTO checkouts(id,user_id,created_at) SELECT ${x('id')},${x('u')},${x('at')} FROM json_each(?)`).bind(J(plan.checkouts.map(c => ({ id: c.id, u: plan.students[c.student].id, at: c.at })))),
    db.prepare(`INSERT INTO order_groups(id,user_id,station_code,origin,created_at) SELECT ${x('id')},${x('u')},${x('s')},'STUDENT',${x('at')} FROM json_each(?)`).bind(J(plan.groups.map(g => ({ id: g.id, u: plan.students[g.student].id, s: g.station, at: g.at })))),
    db.prepare(`INSERT INTO parcels(id,user_id,pickup_code,station_code,size,carrier,note,status,created_at) SELECT ${x('parcel')},${x('user')},
      printf('%02d-%d-%04d',10+abs(random())%80,1+abs(random())%9,1000+abs(random())%9000),${x('station')},${x('size')},
      CASE abs(random())%6 WHEN 0 THEN '中通' WHEN 1 THEN '圆通' WHEN 2 THEN '韵达' WHEN 3 THEN '顺丰' WHEN 4 THEN '京东' ELSE '极兔' END,'','CLOSED',${x('created')}-1800 FROM json_each(?)`).bind(J(orders)),
    db.prepare(`INSERT INTO delivery_orders(id,parcel_id,user_id,campus_id,zone,dorm_building_code,station_code,package_size,delivery_mode,amount_fen,price_snapshot_json,dorm_snapshot_json,station_snapshot_json,
        status,version,last_actor_type,last_actor_id,created_at,updated_at,student_cancelled,received_at,handoff_code,slot_date,slot_code,drop_place,group_id,checkout_id,demo_group,discount_fen,bundle_discount_fen,demo_history)
      SELECT ${x('id')},${x('parcel')},${x('user')},?,${x('zone')},${x('building')},${x('station')},${x('size')},${x('mode')},${x('amount')},${x('price')},${x('dorm')},
        json_object('code',st.code,'canonicalName',st.canonical_name,'relativeLocation',st.relative_location,'lat',st.lat,'lng',st.lng),
        ${x('status')},${x('version')},'STUDENT',${x('user')},${x('created')},${x('updated')},${x('cancelled')},${x('received')},NULL,${x('slotDate')},${x('slotCode')},${x('place')},${x('groupId')},${x('checkout')},?,${x('discount')},${x('bundle')},1
      FROM json_each(?) JOIN stations st ON st.code=${x('station')}`).bind(CAMPUS_ID, group, J(orders)),
    db.prepare(`INSERT INTO payments(id,order_id,type,provider,amount_fen,status,idempotency_key,created_at) SELECT lower(hex(randomblob(16))),${x('id')},'DELIVERY','MOCK',${x('paid')},'SUCCEEDED','history',${x('paidAt')} FROM json_each(?)`).bind(J(orders)),
    db.prepare(`INSERT INTO delivery_batches(id,station_code,assignee_admin_id,created_by,created_at) SELECT ${x('id')},${x('s')},${x('a')},${x('a')},${x('at')} FROM json_each(?)`).bind(J(plan.batches.map(b => ({ id: b.id, s: b.station, a: plan.couriers[b.courier].id, at: b.at })))),
    db.prepare(`INSERT INTO batch_items(batch_id,order_id,sort_order) SELECT ${x('b')},${x('o')},${x('n')} FROM json_each(?)`).bind(J(items)),
    db.prepare(`INSERT INTO order_events(order_id,from_status,to_status,actor_type,actor_id,created_at,detail) SELECT ${x('o')},${x('f')},${x('s')},${x('a')},${x('id')},${x('at')},${x('d')} FROM json_each(?)`).bind(J(events)),
    db.prepare(`INSERT INTO order_ratings(order_id,user_id,stars,tags_json,comment,created_at) SELECT ${x('o')},${x('u')},${x('s')},${x('tags')},${x('c')},${x('at')} FROM json_each(?)`).bind(J(ratings)),
    db.prepare(`INSERT INTO payments(id,order_id,type,provider,amount_fen,status,idempotency_key,created_at) SELECT lower(hex(randomblob(16))),${x('o')},'TIP','MOCK',${x('f')},'SUCCEEDED','history-tip',${x('at')} FROM json_each(?)`).bind(J(tips)),
    db.prepare(`INSERT INTO order_adjustments(id,order_id,kind,amount_fen,created_at) SELECT lower(hex(randomblob(16))),${x('o')},'REFUND',${x('f')},${x('at')} FROM json_each(?)`).bind(J(refunds)),
    db.prepare(`INSERT INTO support_tickets(id,order_id,user_id,category,subject,status,created_at,updated_at) SELECT ${x('id')},${x('o')},${x('u')},${x('k')},${x('s')},${x('st')},${x('at')},${x('up')} FROM json_each(?)`).bind(J(tickets.map(tk => ({ id: tk.id, o: tk.o, u: tk.u, k: tk.k, s: tk.s, st: tk.st, at: tk.at, up: tk.up })))),
    db.prepare(`INSERT INTO ticket_messages(ticket_id,actor_kind,actor_id,body,created_at) SELECT ${x('t')},${x('k')},${x('a')},${x('b')},${x('at')} FROM json_each(?)`).bind(J(messages)),
    // The message trigger stamped "now" on the tickets; put back when the conversation actually happened.
    db.prepare(`UPDATE support_tickets SET updated_at=(SELECT ${x('up')} FROM json_each(?1) WHERE ${x('id')}=support_tickets.id),version=(SELECT ${x('v')} FROM json_each(?1) WHERE ${x('id')}=support_tickets.id)
      WHERE id IN (SELECT ${x('id')} FROM json_each(?1))`).bind(J(tickets.map(tk => ({ id: tk.id, up: tk.up, v: tk.v })))),
  ];
  const results = await db.batch(statements);
  console.log(JSON.stringify({ event: 'demo_history_rows', orders: orders.length, rowsWritten: results.reduce((a, r) => a + (r.meta?.rows_written ?? 0), 0) }));
  return orders.length;
}

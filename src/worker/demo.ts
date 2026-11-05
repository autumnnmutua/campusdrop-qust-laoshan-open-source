import type { Env } from './types';
import type { Admin } from '../shared/contracts';
import { CAMPUS_ID } from '../shared/contracts';
import { ApiError, body, json } from './http';
import { digest } from '../domain/password';
import { createSession, revokeSession, requireAdmin, requireStudent } from './session';
import { rateLimit } from './rate-limit';
import { createParcel } from './parcels';
import { claimOrder } from './order-self-service';
import { changeStatus } from './delivery-admin';
import { demoAutoSchema, demoRoleSchema, demoStartSchema, DEMO_RIDE_SECONDS, DEMO_STEPS, type DemoStatus } from '../shared/demo';
import { seedDemo } from './demo-seed';
import { grantOnRegister } from './coupons';

/*
 * One-click demo (一键体验, v3.6; v3.7 adds a third role and starting data). A visitor with the passcode gets throw-away
 * accounts that share a demo_group id: a student (北苑4号楼, three parcels waiting), a courier and a 超级管理员 (v3.7.1:
 * SUPER_ADMIN fenced into the demo — every courier's tasks, tickets, coupons, reports; site-wide settings are read-only,
 * see requireSuper), plus neighbour
 * students whose three weeks of orders fill the reports and keep the couriers busy (worker/demo-seed.ts). The student
 * cookie and one admin cookie are set at once; PUT /demo/role swaps the admin cookie between the two couriers. Demo orders carry the group id: real operators,
 * couriers, dashboards, slot capacity and group notifications never see them (orderScope and friends), and the demo
 * courier sees only its own student's orders. With "auto" on, the simulated courier moves the orders along by itself
 * (the page calls POST /demo/tick every few seconds); with it off, the visitor plays the courier. Accounts have no
 * password, cannot sign in by name, and are disabled by the daily job after a day.
 */
const now = () => Math.floor(Date.now() / 1000);
const hex = (n: number) => Array.from(crypto.getRandomValues(new Uint8Array(n)), b => b.toString(16).padStart(2, '0')).join('');
const code = () => `${10 + Math.floor(Math.random() * 80)}-${1 + Math.floor(Math.random() * 9)}-${1000 + Math.floor(Math.random() * 9000)}`;
const NO_PASSWORD = 'demo$no-password';
export const DEMO_DAILY_DEFAULT = 12;

async function passcodeMatches(env: Env, given: string): Promise<boolean> {
  const expected = env.DEMO_PASSCODE?.trim() || 'off';
  if (expected.toLowerCase() === 'off') throw new ApiError(404, 'DEMO_DISABLED', '本站未开启一键体验');
  // Compare digests so the check takes the same time whatever was typed.
  return (await digest(`demo:${given.trim()}`)) === (await digest(`demo:${expected}`));
}

type Session = { id: string; userId: string; adminId: string; seniorId: string | null; auto: number; createdAt: number };
async function sessionFor(request: Request, env: Env): Promise<Session | null> {
  const student = await requireStudent(request, env).catch(() => null);
  const admin = student ? null : await requireAdmin(request, env).catch(() => null);
  const actor = student?.demo ? { where: 'user_id=?', id: student.id } : admin?.demo ? { where: '(admin_id=?1 OR senior_id=?1)', id: admin.id } : null;
  if (!actor) return null;
  return env.DB.prepare(`SELECT id,user_id AS userId,admin_id AS adminId,senior_id AS seniorId,auto,created_at AS createdAt FROM demo_sessions WHERE ${actor.where} AND ended_at IS NULL ORDER BY created_at DESC LIMIT 1`)
    .bind(actor.id).first<Session>();
}

async function courier(env: Env, adminId: string): Promise<Admin> {
  const row = await env.DB.prepare("SELECT id,username,role,phone FROM admin_users WHERE id=? AND status='ACTIVE'").bind(adminId).first<Omit<Admin, 'scopes'>>();
  if (!row) throw new ApiError(410, 'DEMO_ENDED', '这次体验已结束，请重新开始');
  return { ...row, scopes: [], demo: true };
}

/** Moves the group's paid orders one step when their time has come. Returns how many steps were taken. */
async function advance(env: Env, s: Session): Promise<number> {
  const t = now();
  const rows = (await env.DB.prepare(`SELECT o.id,o.status,o.version,o.delivery_mode AS mode,o.delivery_upgrade_fen AS upgrade,
      (SELECT b.created_at FROM batch_items bi JOIN delivery_batches b ON b.id=bi.batch_id WHERE bi.order_id=o.id) AS claimedAt,
      coalesce((SELECT max(e.created_at) FROM order_events e WHERE e.order_id=o.id),o.created_at) AS since
    FROM delivery_orders o WHERE o.user_id=? AND o.demo_group IS NOT NULL AND o.status IN ('WAITING_PICKUP','PICKED_UP','OUT_FOR_DELIVERY')
    AND EXISTS(SELECT 1 FROM payments p WHERE p.order_id=o.id AND p.type='DELIVERY') ORDER BY o.created_at LIMIT 12`)
    .bind(s.userId).all<{ id: string; status: string; version: number; mode: string; upgrade: number; claimedAt: number | null; since: number }>()).results;
  if (!rows.length) return 0;
  const admin = await courier(env, s.adminId);
  let steps = 0;
  const done = new Set<string>();
  for (const r of rows) {
    if (done.has(r.id)) continue;
    const since = Math.max(r.since, r.claimedAt ?? 0);
    try {
      if (r.status === 'WAITING_PICKUP' && r.claimedAt == null && t - r.since >= DEMO_STEPS.claim) { await claimOrder(env, admin, r.id); steps++; }
      else if (r.status === 'WAITING_PICKUP' && r.claimedAt != null && t - since >= DEMO_STEPS.pickup) { await changeStatus(env, admin, r.id, { status: 'PICKED_UP', version: r.version }); steps++; }
      else if (r.status === 'PICKED_UP' && t - since >= DEMO_STEPS.depart) { await changeStatus(env, admin, r.id, { status: 'OUT_FOR_DELIVERY', version: r.version }); steps++; }
      else if (r.status === 'OUT_FOR_DELIVERY' && t - since >= DEMO_RIDE_SECONDS) {
        await changeStatus(env, admin, r.id, { status: r.mode === 'ROOM' || r.upgrade > 0 ? 'DELIVERED_TO_ROOM' : 'DELIVERED_DOWNSTAIRS', version: r.version }); steps++;
      }
    } catch { /* the visitor (as courier) or a group sibling moved it first: next tick looks again */ }
    // A merged delivery moves together: the rest of its group was moved by the same call.
    const group = await env.DB.prepare('SELECT group_id AS g FROM delivery_orders WHERE id=?').bind(r.id).first<string>('g');
    if (group) for (const x of (await env.DB.prepare('SELECT id FROM delivery_orders WHERE group_id=?').bind(group).all<{ id: string }>()).results) done.add(x.id);
  }
  return steps;
}

export async function demoRoutes(request: Request, env: Env): Promise<Response | null> {
  const path = new URL(request.url).pathname.replace(/^\/api\/v1/, ''), method = request.method;
  if (!path.startsWith('/demo/')) return null;

  if (path === '/demo/start' && method === 'POST') {
    const ip = request.headers.get('CF-Connecting-IP') ?? 'local';
    await rateLimit(env, `demo:ip:${ip}`, 12);
    const data = await body(request, demoStartSchema);
    if (!(await passcodeMatches(env, data.passcode))) throw new ApiError(403, 'DEMO_PASSCODE', '体验口令不正确');
    await rateLimit(env, `demo:global:${new Date((now() + 8 * 3600) * 1000).toISOString().slice(0, 13)}`, 120);
    // Each demo writes its starting data (a few thousand rows with indexes), so the number per day is capped: on the
    // free plan the database allows 100,000 written rows a day for the whole site.
    const daily = Math.max(1, Math.min(200, Number(env.DEMO_DAILY_LIMIT) || DEMO_DAILY_DEFAULT));
    const today = Date.parse(`${new Date((now() + 8 * 3600) * 1000).toISOString().slice(0, 10)}T00:00:00+08:00`) / 1000;
    const started = await env.DB.prepare('SELECT count(*) AS n FROM demo_sessions WHERE created_at>=?').bind(today).first<number>('n') ?? 0;
    if (started >= daily) throw new ApiError(429, 'DEMO_DAILY_LIMIT', `今天的一键体验次数已用完（每天 ${daily} 次），请明天再试`);
    const group = crypto.randomUUID(), studentId = crypto.randomUUID(), adminId = crypto.randomUUID(), seniorId = crypto.randomUUID(), tag = hex(3);
    const t = now();
    await env.DB.batch([
      env.DB.prepare('INSERT INTO users(id,username,password_hash,name,phone,demo_group,created_at) VALUES(?,?,?,?,?,?,?)').bind(studentId, `demo_${tag}`, NO_PASSWORD, '体验同学', '13800000000', group, t - 30 * 86400),
      env.DB.prepare("INSERT INTO admin_users(id,username,password_hash,role,phone,demo_group,created_at) VALUES(?,?,?,'DELIVERY_STAFF',?,?,?)").bind(adminId, `演示配送员-${tag}`, NO_PASSWORD, '13800000001', group, t - 40 * 86400),
      // The demo's 超级管理员: sees the whole demo (orderScope still keeps it inside its own demo group).
      env.DB.prepare("INSERT INTO admin_users(id,username,password_hash,role,phone,demo_group,created_at) VALUES(?,?,?,'SUPER_ADMIN',?,?,?)").bind(seniorId, `超级管理员-${tag}`, NO_PASSWORD, '13800000002', group, t - 90 * 86400),
      env.DB.prepare("INSERT INTO user_addresses(id,user_id,campus_id,zone,dorm_building_code,room_no,valid_from) VALUES(?,?,?,'NORTH','NORTH_04','301',?)").bind(crypto.randomUUID(), studentId, CAMPUS_ID, t - 30 * 86400),
      env.DB.prepare('INSERT INTO demo_sessions(id,user_id,admin_id,senior_id,auto) VALUES(?,?,?,?,1)').bind(group, studentId, adminId, seniorId),
      // v3.7.1: like a new account, the demo student holds the 新人五折券, so checkout shows the coupon picked automatically.
      grantOnRegister(env, studentId, group),
      env.DB.prepare("INSERT INTO audit_logs(id,actor_type,actor_id,action,resource_id) VALUES(?,'STUDENT',?,'DEMO_STARTED',?)").bind(crypto.randomUUID(), studentId, group),
    ]);
    // Two parcels at 南十对面 (they can travel together) and one at 颐海苑; the dorm is 北苑4号楼, the longest walk on campus.
    const seeded = await seedDemo(env, { group, tag, studentId, courierId: adminId, seniorId }, t);
    console.log(JSON.stringify({ event: 'demo_seeded', ...seeded }));
    for (const p of [{ stationCode: 'NANSHI', packageSize: 'SMALL', carrier: '中通' }, { stationCode: 'NANSHI', packageSize: 'LARGE', carrier: '顺丰' }, { stationCode: 'YIHAIYUAN', packageSize: 'SMALL', carrier: '韵达' }] as const)
      await createParcel(env, studentId, { ...p, pickupCode: code(), note: '' });
    const headers = new Headers();
    headers.append('Set-Cookie', await createSession(request, env, 'student', studentId));
    headers.append('Set-Cookie', await createSession(request, env, 'admin', adminId));
    return json({ ok: true, status: { active: true, auto: true, courierName: `演示配送员-${tag}`, seniorName: `超级管理员-${tag}`, adminRole: 'courier', studentUsername: `demo_${tag}` } satisfies DemoStatus }, 201, headers);
  }

  const s = await sessionFor(request, env);
  if (path === '/demo/status' && method === 'GET') {
    if (!s) return json({ status: { active: false, auto: false, courierName: null, seniorName: null, adminRole: null, studentUsername: null } satisfies DemoStatus });
    const names = new Map((await env.DB.prepare('SELECT id,username FROM admin_users WHERE id IN (?,?)').bind(s.adminId, s.seniorId ?? s.adminId).all<{ id: string; username: string }>()).results.map(r => [r.id, r.username]));
    const admin = await requireAdmin(request, env).catch(() => null);
    const adminRole = admin?.id === s.seniorId ? 'super' : admin?.id === s.adminId ? 'courier' : null;
    const studentUsername = await env.DB.prepare('SELECT username FROM users WHERE id=?').bind(s.userId).first<string>('username');
    return json({ status: { active: true, auto: Boolean(s.auto), courierName: names.get(s.adminId) ?? null, seniorName: s.seniorId ? names.get(s.seniorId) ?? null : null, adminRole, studentUsername } satisfies DemoStatus });
  }
  if (!s) throw new ApiError(401, 'DEMO_REQUIRED', '一键体验已结束或未开始');
  if (path === '/demo/tick' && method === 'POST') {
    await rateLimit(env, `demo:tick:${s.id}`, 600);
    return json({ steps: s.auto ? await advance(env, s) : 0, auto: Boolean(s.auto) });
  }
  if (path === '/demo/role' && method === 'PUT') {
    const data = await body(request, demoRoleSchema), target = data.role === 'courier' ? s.adminId : s.seniorId;
    if (!target) throw new ApiError(409, 'DEMO_ROLE_MISSING', '这次体验没有超级管理员身份，请结束后重新开始');
    const headers = new Headers();
    headers.append('Set-Cookie', await createSession(request, env, 'admin', target));
    return json({ role: data.role === 'courier' ? 'courier' : 'super' }, 200, headers);
  }
  if (path === '/demo/auto' && method === 'PUT') {
    const data = await body(request, demoAutoSchema);
    await env.DB.prepare('UPDATE demo_sessions SET auto=? WHERE id=?').bind(data.auto ? 1 : 0, s.id).run();
    return json({ auto: data.auto });
  }
  if (path === '/demo/end' && method === 'POST') {
    await env.DB.batch(endStatements(env, `SELECT '${s.id.replace(/[^a-f0-9-]/g, '')}' AS id`));
    const headers = new Headers();
    headers.append('Set-Cookie', await revokeSession(request, env, 'student'));
    headers.append('Set-Cookie', await revokeSession(request, env, 'admin'));
    return json({ ok: true }, 200, headers);
  }
  return null;
}

/**
 * Closing demos: every account of the group is signed out and disabled. A courier still holding unfinished demo tasks
 * stays ACTIVE (the admin_active_task_guard trigger would refuse), but has no session and cannot sign in, so it is just
 * as closed. Their orders stay, hidden from operators.
 */
function endStatements(env: Env, which: string): D1PreparedStatement[] {
  const groups = `SELECT id FROM demo_sessions WHERE id IN (${which})`;
  return [
    env.DB.prepare(`UPDATE users SET status='DISABLED' WHERE demo_group IN (${groups}) AND status='ACTIVE'`),
    env.DB.prepare(`UPDATE admin_users SET status='DISABLED' WHERE demo_group IN (${groups}) AND status='ACTIVE' AND NOT EXISTS(SELECT 1 FROM delivery_batches b JOIN batch_items bi ON bi.batch_id=b.id JOIN delivery_orders o ON o.id=bi.order_id
      WHERE b.assignee_admin_id=admin_users.id AND o.status NOT IN ('CANCELLED','COMPLETED','DELIVERED_DOWNSTAIRS','DELIVERED_TO_ROOM'))`),
    env.DB.prepare(`DELETE FROM sessions WHERE user_id IN (SELECT id FROM users WHERE demo_group IN (${groups})) OR admin_id IN (SELECT id FROM admin_users WHERE demo_group IN (${groups}))`),
    env.DB.prepare(`UPDATE demo_sessions SET ended_at=unixepoch() WHERE id IN (${which}) AND ended_at IS NULL`),
  ];
}
/** Daily: demos older than a day are closed. */
export function demoCleanupStatements(env: Env): D1PreparedStatement[] {
  return endStatements(env, 'SELECT id FROM demo_sessions WHERE ended_at IS NULL AND created_at<unixepoch()-86400');
}

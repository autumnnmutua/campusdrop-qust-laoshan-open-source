/* © 2026 专业团队 · CampusDrop v4.5.0 */
import type { Env } from './types';
import { ApiError, body, json } from './http';
import { requireAdmin, requireStudent, requireSuperView } from './session';
import { rateLimit } from './rate-limit';
import { hashPassword } from '../domain/password';
import { applicationReviewSchema, courierApplicationSchema, type CourierApplication } from '../shared/courier-apply';

/*
 * v4.5 · 同学申请当兼职配送员 (see shared/courier-apply.ts). One open application per student. In the one-click demo
 * the demo's 超级管理员 reviews the demo's own applications (the account it creates belongs to the demo group).
 */
const columns = `a.id,a.real_name AS realName,a.phone,a.college,a.grade,a.slots_json AS slotsJson,a.zone,a.intro,a.desired_username AS desiredUsername,
  a.building_code AS buildingCode,(SELECT display_name FROM dorm_buildings WHERE code=a.building_code) AS buildingName,a.room_no AS roomNo,
  a.status,a.note,a.created_at AS createdAt,a.reviewed_at AS reviewedAt`;
type Row = Omit<CourierApplication, 'slots'> & { slotsJson: string };
const out = ({ slotsJson, ...r }: Row): CourierApplication => ({ ...r, slots: JSON.parse(slotsJson) });
const usernameTaken = async (env: Env, username: string, exceptId = '') =>
  Boolean(await env.DB.prepare("SELECT 1 FROM admin_users WHERE username=? UNION ALL SELECT 1 FROM courier_applications WHERE desired_username=? COLLATE NOCASE AND status='PENDING' AND id<>? LIMIT 1")
    .bind(username, username, exceptId).first());
const adminUsernameTaken = async (env: Env, username: string) =>
  Boolean(await env.DB.prepare('SELECT 1 FROM admin_users WHERE username=? LIMIT 1').bind(username).first());

export async function courierApplicationRoutes(request: Request, env: Env): Promise<Response | null> {
  const path = new URL(request.url).pathname.replace(/^\/api\/v1/, ''), method = request.method;

  // ---------------------------------------------------------------- student
  if (path === '/courier-applications/mine') {
    const user = await requireStudent(request, env);
    if (method === 'GET') {
      // The latest application drives the progress view; earlier ones are listed below it, like 我的售后工单.
      const rows = (await env.DB.prepare(`SELECT ${columns} FROM courier_applications a WHERE a.user_id=? ORDER BY a.created_at DESC,a.rowid DESC LIMIT 10`).bind(user.id).all<Row>()).results.map(out);
      const home = await env.DB.prepare('SELECT a.dorm_building_code AS buildingCode,a.zone,a.room_no AS roomNo FROM user_addresses a WHERE a.user_id=? AND a.valid_to IS NULL').bind(user.id).first<{ buildingCode: string; zone: string; roomNo: string }>();
      return json({ application: rows[0] ?? null, applications: rows, profile: { name: user.name, phone: user.phone, buildingCode: home?.buildingCode ?? '', zone: home?.zone ?? '', roomNo: home?.roomNo ?? '' } });
    }
    if (method === 'POST') {
      await rateLimit(env, `courier-apply:${user.id}`, 10);
      const data = await body(request, courierApplicationSchema);
      if (await env.DB.prepare("SELECT 1 FROM courier_applications WHERE user_id=? AND status='PENDING'").bind(user.id).first()) throw new ApiError(409, 'APPLICATION_PENDING', '你已经有一份申请在审核中，可以先撤回再重新提交');
      if (await usernameTaken(env, data.desiredUsername)) throw new ApiError(409, 'USERNAME_TAKEN', '这个配送员账号名已被使用，请换一个');
      if (!await env.DB.prepare('SELECT 1 FROM dorm_buildings WHERE code=? AND active=1').bind(data.buildingCode).first()) throw new ApiError(400, 'BUILDING_UNKNOWN', '请选择住的楼栋');
      const id = crypto.randomUUID(), demo = await env.DB.prepare('SELECT demo_group FROM users WHERE id=?').bind(user.id).first<string | null>('demo_group');
      try {
        // Reserve the name in the same write as the application. A separate pre-check is not
        // sufficient when two students submit the same desired username concurrently.
        const inserted = await env.DB.prepare(`INSERT INTO courier_applications(id,user_id,real_name,phone,college,grade,slots_json,zone,building_code,room_no,intro,desired_username,password_hash,demo_group)
          SELECT ?,?,?,?,?,?,?,?,?,?,?,?,?,? WHERE NOT EXISTS(SELECT 1 FROM admin_users WHERE username=?)
          AND NOT EXISTS(SELECT 1 FROM courier_applications WHERE desired_username=? COLLATE NOCASE AND status='PENDING')`)
          .bind(id, user.id, data.realName, data.phone, data.college, data.grade, JSON.stringify(data.slots), data.zone, data.buildingCode, data.roomNo, data.intro,
            data.desiredUsername, await hashPassword(data.password), demo ?? null, data.desiredUsername, data.desiredUsername).run();
        if (!inserted.meta.changes) throw new ApiError(409, 'USERNAME_TAKEN', '这个配送员账号名已被使用，请换一个');
      } catch (error) {
        if (String(error).includes('UNIQUE')) throw new ApiError(409, 'APPLICATION_PENDING', '你已经有一份申请在审核中');
        throw error;
      }
      await env.DB.prepare("INSERT INTO inbox_messages(user_id,kind,title,link) VALUES(?,'COURIER_APPLICATION',?,'/apply')")
        .bind(user.id, `配送员申请已提交（账号 ${data.desiredUsername}），审核结果会通过站内消息通知你`).run();
      const row = await env.DB.prepare(`SELECT ${columns} FROM courier_applications a WHERE a.id=?`).bind(id).first<Row>();
      return json({ application: out(row!) }, 201);
    }
  }
  if (path === '/courier-applications/mine/withdraw' && method === 'POST') {
    const user = await requireStudent(request, env);
    const r = await env.DB.prepare("UPDATE courier_applications SET status='WITHDRAWN',reviewed_at=unixepoch() WHERE user_id=? AND status='PENDING'").bind(user.id).run();
    if (!r.meta.changes) throw new ApiError(409, 'NOTHING_TO_WITHDRAW', '没有审核中的申请');
    return json({ withdrawn: true });
  }

  // ---------------------------------------------------------------- super admin
  if (path !== '/admin/courier-applications' && !path.startsWith('/admin/courier-applications/')) return null;
  const admin = await requireAdmin(request, env);
  requireSuperView(admin);
  const world = await env.DB.prepare("SELECT coalesce(demo_group,'') AS w FROM admin_users WHERE id=?").bind(admin.id).first<string>('w') ?? '';
  if (path === '/admin/courier-applications' && method === 'GET') {
    const status = new URL(request.url).searchParams.get('status') ?? 'PENDING';
    if (!['PENDING', 'APPROVED', 'REJECTED', 'WITHDRAWN', 'ALL'].includes(status)) throw new ApiError(400, 'VALIDATION_ERROR', '状态不正确');
    const rows = (await env.DB.prepare(`SELECT ${columns},u.name AS studentName,u.username AS studentUsername,
        (SELECT count(*) FROM delivery_orders o WHERE o.user_id=a.user_id AND o.status='COMPLETED') AS completedOrders
      FROM courier_applications a JOIN users u ON u.id=a.user_id WHERE coalesce(a.demo_group,'')=? AND (?='ALL' OR a.status=?)
      ORDER BY a.status<>'PENDING',a.created_at DESC,a.id LIMIT 100`).bind(world, status, status).all<Row>()).results;
    const pending = await env.DB.prepare("SELECT count(*) AS n FROM courier_applications WHERE status='PENDING' AND coalesce(demo_group,'')=?").bind(world).first<number>('n') ?? 0;
    return json({ applications: rows.map(out), pending });
  }
  const m = /^\/admin\/courier-applications\/([a-f0-9-]{36})\/review$/.exec(path);
  if (!m || method !== 'POST') return null;
  await rateLimit(env, `courier-review:${admin.id}`, 60);
  const data = await body(request, applicationReviewSchema);
  const app = await env.DB.prepare(`SELECT a.id,a.user_id AS userId,a.real_name AS realName,a.phone,a.desired_username AS username,a.password_hash AS passwordHash,a.status
    FROM courier_applications a WHERE a.id=? AND coalesce(a.demo_group,'')=?`).bind(m[1], world).first<{ id: string; userId: string; realName: string; phone: string; username: string; passwordHash: string; status: string }>();
  if (!app) throw new ApiError(404, 'NOT_FOUND', '申请不存在');
  if (app.status !== 'PENDING') throw new ApiError(409, 'APPLICATION_REVIEWED', '这份申请已经处理过了，请刷新');

  if (data.decision === 'REJECT') {
    const r = await env.DB.batch([
      env.DB.prepare("UPDATE courier_applications SET status='REJECTED',note=?,reviewed_by=?,reviewed_at=unixepoch() WHERE id=? AND status='PENDING'").bind(data.note, admin.id, app.id),
      env.DB.prepare("INSERT INTO inbox_messages(user_id,kind,title,link) SELECT ?,'COURIER_APPLICATION',?,'/apply' WHERE changes()>0").bind(app.userId, `配送员申请未通过：${data.note}`.slice(0, 120)),
      env.DB.prepare("INSERT INTO audit_logs(id,actor_type,actor_id,action,resource_id,metadata_redacted) SELECT ?,'ADMIN',?,'COURIER_APPLICATION_REJECTED',?,? WHERE changes()>0").bind(crypto.randomUUID(), admin.id, app.id, JSON.stringify({ note: data.note })),
    ]);
    if (!r[0].meta.changes) throw new ApiError(409, 'APPLICATION_REVIEWED', '这份申请已经处理过了，请刷新');
    return json({ status: 'REJECTED' });
  }

  // Legacy databases can contain duplicate pending usernames created before the atomic insert.
  // Let one be approved; the admin username UNIQUE constraint arbitrates simultaneous reviews.
  if (await adminUsernameTaken(env, app.username)) throw new ApiError(409, 'USERNAME_TAKEN', `账号名 ${app.username} 已被占用，请让同学撤回后换一个重新申请`);
  const codes = [...new Set(data.buildings)];
  if (codes.length) {
    const known = (await env.DB.prepare(`SELECT count(*) AS n FROM dorm_buildings WHERE active=1 AND code IN (${codes.map(() => '?').join(',')})`).bind(...codes).first<number>('n')) ?? 0;
    if (known !== codes.length) throw new ApiError(400, 'BUILDING_UNKNOWN', '有楼栋不存在或已停用');
  }
  const adminId = crypto.randomUUID();
  try {
    const r = await env.DB.batch([
      // The account first (the application points at it), only while the application is still pending.
      env.DB.prepare("INSERT INTO admin_users(id,username,password_hash,role,phone,demo_group) SELECT ?,?,?,'DELIVERY_STAFF',?,nullif(?,'') WHERE EXISTS(SELECT 1 FROM courier_applications WHERE id=? AND status='PENDING')")
        .bind(adminId, app.username, app.passwordHash, app.phone, world, app.id),
      env.DB.prepare("UPDATE courier_applications SET status='APPROVED',note=?,reviewed_by=?,reviewed_at=unixepoch(),admin_id=? WHERE id=? AND status='PENDING' AND EXISTS(SELECT 1 FROM admin_users WHERE id=?)").bind(data.note, admin.id, adminId, app.id, adminId),
      ...codes.map(code => env.DB.prepare(`INSERT INTO building_couriers(world,building_code,admin_id,assigned_by) SELECT ?,?,?,? WHERE EXISTS(SELECT 1 FROM admin_users WHERE id=?)
        ON CONFLICT(world,building_code) DO UPDATE SET admin_id=excluded.admin_id,assigned_by=excluded.assigned_by,updated_at=unixepoch()`).bind(world, code, adminId, admin.id, adminId)),
      env.DB.prepare("INSERT INTO inbox_messages(user_id,kind,title,link) SELECT ?,'COURIER_APPLICATION',?,'/admin/login' WHERE EXISTS(SELECT 1 FROM admin_users WHERE id=?)")
        .bind(app.userId, `配送员申请已通过：用你申请的账号 ${app.username} 登录配送员工作台${codes.length ? `，已为你分配 ${codes.length} 栋楼` : ''}`, adminId),
      env.DB.prepare("INSERT INTO audit_logs(id,actor_type,actor_id,action,resource_id,metadata_redacted) SELECT ?,'ADMIN',?,'COURIER_APPLICATION_APPROVED',?,? WHERE EXISTS(SELECT 1 FROM courier_applications WHERE id=? AND status='APPROVED' AND admin_id=?)")
        .bind(crypto.randomUUID(), admin.id, app.id, JSON.stringify({ adminId, username: app.username, buildings: codes }), app.id, adminId),
    ]);
    if (!r[1].meta.changes) throw new ApiError(409, 'APPLICATION_REVIEWED', '这份申请已经处理过了，请刷新');
  } catch (error) {
    if (String(error).includes('UNIQUE')) throw new ApiError(409, 'USERNAME_TAKEN', `账号名 ${app.username} 已被占用`);
    throw error;
  }
  return json({ status: 'APPROVED', adminId, username: app.username, buildings: codes.length });
}

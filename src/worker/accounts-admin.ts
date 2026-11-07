/* © 2026 专业团队 · CampusDrop v4.0.0 */
import type { Env } from './types';
import { ApiError, body, json } from './http';
import { requireAdmin, requireSuper, requireSuperView } from './session';
import { rateLimit } from './rate-limit';
import { studentDeletionStatements } from './account';
import { studentAdminDeleteSchema as deleteSchema, studentTestFlagSchema as testFlagSchema } from '../shared/contracts';

/*
 * v3.9 · 账号管理 for super admins: find student accounts, mark the ones used only for testing (left out of 实测报告)
 * and clear accounts that should not exist any more (the same anonymisation as a student's own 注销). Staff accounts
 * keep their own page (管理员). Inside the one-click demo the list shows the demo's accounts and is read-only.
 */
export interface StudentAccount { id: string; username: string; name: string; phoneMasked: string; createdAt: number; status: string; testAccount: boolean; orders: number; openOrders: number; lastOrderAt: number | null }
const mask = (phone: string) => phone && phone.length >= 7 ? `${phone.slice(0, 3)}****${phone.slice(-4)}` : '—';

export async function accountsAdminRoutes(request: Request, env: Env): Promise<Response | null> {
  const url = new URL(request.url), method = request.method, path = url.pathname.replace(/^\/api\/v1/, '');
  if (!path.startsWith('/admin/accounts/')) return null;
  const admin = await requireAdmin(request, env);
  requireSuperView(admin);
  const world = "coalesce(u.demo_group,'')=coalesce((SELECT demo_group FROM admin_users WHERE id=?),'') AND (u.demo_group IS NULL OR u.demo_group NOT LIKE 'history-%')";

  if (path === '/admin/accounts/students' && method === 'GET') {
    const q = (url.searchParams.get('q') ?? '').trim().slice(0, 32), page = Math.max(1, Math.min(1000, Number(url.searchParams.get('page')) || 1));
    const like = `%${q.replace(/[%_\\]/g, m => `\\${m}`)}%`;
    const rows = (await env.DB.prepare(`SELECT u.id,u.username,u.name,u.phone,u.created_at AS createdAt,u.status,u.test_account AS testAccount,
        (SELECT count(*) FROM delivery_orders o WHERE o.user_id=u.id) AS orders,
        (SELECT count(*) FROM delivery_orders o WHERE o.user_id=u.id AND o.status NOT IN ('COMPLETED','CANCELLED') AND o.student_deleted=0) AS openOrders,
        (SELECT max(o.created_at) FROM delivery_orders o WHERE o.user_id=u.id) AS lastOrderAt
      FROM users u WHERE ${world} AND u.deleted_at IS NULL AND (?='' OR u.username LIKE ? ESCAPE '\\' OR u.name LIKE ? ESCAPE '\\')
      ORDER BY u.created_at DESC,u.id LIMIT 51 OFFSET ?`).bind(admin.id, q, like, like, (page - 1) * 50)
      .all<Omit<StudentAccount, 'phoneMasked' | 'testAccount'> & { phone: string; testAccount: number }>()).results;
    const total = await env.DB.prepare(`SELECT count(*) AS n FROM users u WHERE ${world} AND u.deleted_at IS NULL`).bind(admin.id).first<number>('n') ?? 0;
    return json({ students: rows.slice(0, 50).map(({ phone, testAccount, ...r }) => ({ ...r, testAccount: Boolean(testAccount), phoneMasked: mask(phone) })), page, hasMore: rows.length > 50, total });
  }
  const m = /^\/admin\/accounts\/students\/([a-f0-9-]{36})\/(test-flag|delete)$/.exec(path);
  if (m && method === 'POST') {
    requireSuper(admin);
    await rateLimit(env, `accounts-admin:${admin.id}`, 120);
    const target = await env.DB.prepare('SELECT u.id,u.username FROM users u WHERE u.id=? AND u.deleted_at IS NULL AND u.demo_group IS NULL').bind(m[1]).first<{ id: string; username: string }>();
    if (!target) throw new ApiError(404, 'NOT_FOUND', '账号不存在或已注销');
    if (m[2] === 'test-flag') {
      const d = await body(request, testFlagSchema);
      await env.DB.batch([
        env.DB.prepare('UPDATE users SET test_account=? WHERE id=?').bind(d.testAccount ? 1 : 0, target.id),
        env.DB.prepare("INSERT INTO audit_logs(id,actor_type,actor_id,action,resource_id) VALUES(?,'ADMIN',?,?,?)").bind(crypto.randomUUID(), admin.id, d.testAccount ? 'ACCOUNT_MARKED_TEST' : 'ACCOUNT_UNMARKED_TEST', target.id),
      ]);
      return json({ ok: true });
    }
    await body(request, deleteSchema);
    const open = await env.DB.prepare("SELECT count(*) AS n FROM delivery_orders WHERE user_id=? AND status NOT IN ('COMPLETED','CANCELLED') AND student_deleted=0").bind(target.id).first<number>('n') ?? 0;
    const sending = await env.DB.prepare("SELECT count(*) AS n FROM send_requests WHERE user_id=? AND status IN ('WAITING_PICKUP','PICKED_UP')").bind(target.id).first<number>('n') ?? 0;
    if (open || sending) throw new ApiError(409, 'ACCOUNT_HAS_ORDERS', `这个账号还有 ${open + sending} 个未完成的订单或代寄件，请先处理完再注销`);
    await env.DB.batch(studentDeletionStatements(env, target.id, 'ADMIN', admin.id));
    return json({ ok: true });
  }
  return null;
}

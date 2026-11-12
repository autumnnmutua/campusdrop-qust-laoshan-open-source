/* © 2026 专业团队 · CampusDrop v4.7.0 · WM-A372E4790D8B1C09-A54A92B616 */
import { digest, randomToken } from '../domain/password';
import type { Admin, Student, Scope } from '../shared/contracts';
import type { Env } from './types';
import { ApiError } from './http';
export type ActorKind = 'student' | 'admin';
const now = () => Math.floor(Date.now() / 1000);
export function localCookie(request: Request, env: Env): boolean {
  const u = new URL(request.url);
  return env.APP_ENV === 'development' && u.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(u.hostname);
}
export function cookieName(request: Request, env: Env, kind: ActorKind): string {
  return `${localCookie(request, env) ? '' : '__Host-'}campusdrop_${kind}`;
}
function cookie(request: Request, env: Env, kind: ActorKind, token: string, age: number): string {
  return `${cookieName(request, env, kind)}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${age}${localCookie(request, env) ? '' : '; Secure'}`;
}
function tokenFrom(request: Request, env: Env, kind: ActorKind): string | null {
  const name = cookieName(request, env, kind);
  const values = (request.headers.get('Cookie') ?? '').split(';').map(x => x.trim()).filter(x => x.startsWith(`${name}=`));
  if (values.length !== 1) return null;
  const token = values[0].slice(name.length + 1);
  return /^[a-f0-9]{64}$/.test(token) ? token : null;
}
export async function revokeSession(request: Request, env: Env, kind: ActorKind): Promise<string> {
  const token = tokenFrom(request, env, kind);
  if (token) await env.DB.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(await digest(token)).run();
  return cookie(request, env, kind, '', 0);
}
// Keep session creation available as statements so registration can commit it with the new account.
export async function prepareSession(request: Request, env: Env, kind: ActorKind, id: string, expectedPasswordHash?: string): Promise<{ statements: D1PreparedStatement[]; cookie: string }> {
  const token = randomToken(); const age = kind === 'admin' ? 7200 : 43200;
  const tokenHash = await digest(token);
  const old = tokenFrom(request, env, kind);
  // For password login, recheck the verified hash and account state inside the session INSERT. A password reset
  // that wins the race must not be followed by a new session authenticated with the previous password.
  const insert = expectedPasswordHash === undefined
    ? env.DB.prepare('INSERT INTO sessions(token_hash, user_id, admin_id, expires_at) VALUES (?, ?, ?, ?)')
      .bind(tokenHash, kind === 'student' ? id : null, kind === 'admin' ? id : null, now() + age)
    : env.DB.prepare(`INSERT INTO sessions(token_hash, user_id, admin_id, expires_at)
        SELECT ?, ?, ?, ? WHERE EXISTS(SELECT 1 FROM ${kind === 'admin' ? 'admin_users' : 'users'}
        WHERE id=? AND status='ACTIVE' AND password_hash=? AND demo_group IS NULL${kind === 'admin' ? ' AND (development_only=0 OR ?=1)' : ''})`)
      .bind(...[tokenHash, kind === 'student' ? id : null, kind === 'admin' ? id : null, now() + age, id, expectedPasswordHash,
        ...(kind === 'admin' ? [localCookie(request, env) ? 1 : 0] : [])]);
  const statements = [
    env.DB.prepare('DELETE FROM sessions WHERE expires_at <= ?').bind(now()),
    insert,
  ];
  if (old) statements.push(env.DB.prepare('DELETE FROM sessions WHERE token_hash = ? AND EXISTS(SELECT 1 FROM sessions WHERE token_hash = ?)').bind(await digest(old), tokenHash));
  return { statements, cookie: cookie(request, env, kind, token, age) };
}
export async function createSession(request: Request, env: Env, kind: ActorKind, id: string, expectedPasswordHash?: string): Promise<string> {
  const { statements, cookie } = await prepareSession(request, env, kind, id, expectedPasswordHash);
  const results = await env.DB.batch(statements);
  if (!results[1].meta.changes) throw new ApiError(401, 'INVALID_CREDENTIALS', '用户名或密码错误');
  return cookie;
}
async function sessionHash(request: Request, env: Env, kind: ActorKind): Promise<string> {
  const token = tokenFrom(request, env, kind);
  if (!token) throw new ApiError(401, 'AUTH_REQUIRED', '请先登录');
  return digest(token);
}
export async function requireStudent(request: Request, env: Env): Promise<Student> {
  const student = await env.DB.prepare(`SELECT u.id, u.username, u.name, u.phone, u.demo_group IS NOT NULL AS demo FROM sessions s
    JOIN users u ON u.id = s.user_id WHERE s.token_hash = ? AND s.expires_at > ? AND u.status = 'ACTIVE'`)
    .bind(await sessionHash(request, env, 'student'), now()).first<Student>();
  if (!student) throw new ApiError(401, 'SESSION_INVALID', '登录已过期或账号已停用');
  return { ...student, demo: Boolean(student.demo) };
}
export async function requireAdmin(request: Request, env: Env): Promise<Admin> {
  const admin = await env.DB.prepare(`SELECT a.id, a.username, a.role, a.phone, a.demo_group IS NOT NULL AS demo FROM sessions s
    JOIN admin_users a ON a.id = s.admin_id WHERE s.token_hash = ? AND s.expires_at > ? AND a.status = 'ACTIVE' AND (a.development_only=0 OR ?=1)`)
    .bind(await sessionHash(request, env, 'admin'), now(),localCookie(request,env)?1:0).first<Omit<Admin, 'scopes'>>();
  if (!admin) throw new ApiError(401, 'SESSION_INVALID', '登录已过期或账号已停用');
  const scopes = await env.DB.prepare('SELECT campus_id AS campusId, zone, building_code AS buildingCode FROM admin_scopes WHERE admin_id = ?').bind(admin.id).all<Scope>();
  return { ...admin, demo: Boolean(admin.demo), scopes: scopes.results };
}
/**
 * Super-admin only. The one-click demo's 超级管理员 (v3.7.1) is a SUPER_ADMIN fenced into its demo group: it may open
 * every page, but anything that changes the whole site (pausing orders, announcements, admin accounts, weather, the
 * group robot, map calibration, account recovery) is refused, because it would reach the real service.
 */
export function requireSuper(admin: Admin): void {
  requireSuperView(admin);
  if (admin.demo) throw new ApiError(403, 'DEMO_READONLY', '体验中的超级管理员不能修改全站设置（会影响真实运营），可以查看页面了解功能');
}
/** Super-admin pages a demo super admin may read too; the handler must keep what it returns inside the demo group. */
export function requireSuperView(admin: Admin): void {
  if (admin.role !== 'SUPER_ADMIN') throw new ApiError(403, 'FORBIDDEN', '仅超级管理员可执行此操作');
}
/** A real super admin (not the demo's): may see site-wide numbers such as all send requests or all new students. */
export const isRealSuper = (admin: Admin) => admin.role === 'SUPER_ADMIN' && !admin.demo;

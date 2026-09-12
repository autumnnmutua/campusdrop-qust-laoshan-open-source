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
export async function createSession(request: Request, env: Env, kind: ActorKind, id: string): Promise<string> {
  const token = randomToken(); const age = kind === 'admin' ? 7200 : 43200;
  const old = tokenFrom(request, env, kind);
  const statements = [
    env.DB.prepare('DELETE FROM sessions WHERE expires_at <= ?').bind(now()),
    env.DB.prepare('INSERT INTO sessions(token_hash, user_id, admin_id, expires_at) VALUES (?, ?, ?, ?)')
      .bind(await digest(token), kind === 'student' ? id : null, kind === 'admin' ? id : null, now() + age),
  ];
  if (old) statements.push(env.DB.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(await digest(old)));
  await env.DB.batch(statements);
  return cookie(request, env, kind, token, age);
}
async function sessionHash(request: Request, env: Env, kind: ActorKind): Promise<string> {
  const token = tokenFrom(request, env, kind);
  if (!token) throw new ApiError(401, 'AUTH_REQUIRED', '请先登录');
  return digest(token);
}
export async function requireStudent(request: Request, env: Env): Promise<Student> {
  const student = await env.DB.prepare(`SELECT u.id, u.username, u.name, u.phone FROM sessions s
    JOIN users u ON u.id = s.user_id WHERE s.token_hash = ? AND s.expires_at > ? AND u.status = 'ACTIVE'`)
    .bind(await sessionHash(request, env, 'student'), now()).first<Student>();
  if (!student) throw new ApiError(401, 'SESSION_INVALID', '登录已过期或账号已停用');
  return student;
}
export async function requireAdmin(request: Request, env: Env): Promise<Admin> {
  const admin = await env.DB.prepare(`SELECT a.id, a.username, a.role, a.phone FROM sessions s
    JOIN admin_users a ON a.id = s.admin_id WHERE s.token_hash = ? AND s.expires_at > ? AND a.status = 'ACTIVE' AND (a.development_only=0 OR ?=1)`)
    .bind(await sessionHash(request, env, 'admin'), now(),localCookie(request,env)?1:0).first<Omit<Admin, 'scopes'>>();
  if (!admin) throw new ApiError(401, 'SESSION_INVALID', '登录已过期或账号已停用');
  const scopes = await env.DB.prepare('SELECT campus_id AS campusId, zone, building_code AS buildingCode FROM admin_scopes WHERE admin_id = ?').bind(admin.id).all<Scope>();
  return { ...admin, scopes: scopes.results };
}
export function requireSuper(admin: Admin): void {
  if (admin.role !== 'SUPER_ADMIN') throw new ApiError(403, 'FORBIDDEN', '仅超级管理员可执行此操作');
}

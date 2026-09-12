import { digest } from '../domain/password';
import type { Env } from './types';
import { ApiError } from './http';
export async function rateLimit(env: Env, key: string, limit: number): Promise<void> {
  const time = Math.floor(Date.now() / 1000);
  const row = await env.DB.prepare(`INSERT INTO rate_limits (key_hash, count, expires_at) VALUES (?, 1, ?)
    ON CONFLICT(key_hash) DO UPDATE SET count = IIF(expires_at<=?,1,count+1),expires_at=IIF(expires_at<=?,excluded.expires_at,expires_at) RETURNING count`)
    .bind(await digest(key), time + 900,time,time).first<{ count: number }>();
  if (!row || row.count > limit) throw new ApiError(429, 'RATE_LIMITED', '操作过于频繁，请在 15 分钟后重试');
}
export async function authRateLimit(request: Request, env: Env, action: string): Promise<void> {
  const ip = request.headers.get('CF-Connecting-IP') ?? 'local';
  await rateLimit(env, `${action}:ip:${ip}`, action === 'register' ? 10 : 30);
}

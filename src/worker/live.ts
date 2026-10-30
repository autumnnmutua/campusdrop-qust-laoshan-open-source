import { DurableObject } from 'cloudflare:workers';
import type { Env } from './types';
import type { LiveEvent } from '../shared/live';
import { STATUS_LABELS } from '../shared/constants';
import { ApiError } from './http';
import { requireAdmin, requireStudent } from './session';
import { sendPush } from './push';

/**
 * One hub per signed-in actor ("student:<id>" or "admin:<id>"). Pages keep a WebSocket open to their own hub; the
 * worker posts small "something changed" events and the page refetches what it shows. Events carry ids and kinds only,
 * never personal data. Hibernation keeps idle sockets free, and ping/pong is answered without waking the object.
 */
export class LiveHub extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'));
  }
  async fetch(request: Request): Promise<Response> {
    if (request.headers.get('Upgrade') === 'websocket') {
      if (this.ctx.getWebSockets().length >= 12) return new Response('too many connections', { status: 429 });
      const [client, server] = Object.values(new WebSocketPair());
      this.ctx.acceptWebSocket(server);
      return new Response(null, { status: 101, webSocket: client });
    }
    const event = await request.text();
    // "bye" (sign-out, account deletion, admin disabled): tell open tabs, then close their sockets for good (4001 = do
    // not reconnect); a later sign-in opens a fresh socket.
    const bye = event === '{"type":"bye"}';
    for (const socket of this.ctx.getWebSockets()) {
      try { socket.send(event); if (bye) socket.close(4001, 'signed out'); } catch { /* socket is closing */ }
    }
    return new Response(null, { status: 204 });
  }
  async webSocketMessage(): Promise<void> { /* clients only send ping, which the auto-response answers */ }
  async webSocketClose(socket: WebSocket, code: number): Promise<void> {
    try { socket.close(code === 1005 ? 1000 : code, 'bye'); } catch { /* already closed */ }
  }
}

export async function publish(env: Env, channel: string, event: LiveEvent): Promise<void> {
  if (!env.LIVE) return;
  await env.LIVE.get(env.LIVE.idFromName(channel)).fetch('https://live.internal/publish', { method: 'POST', body: JSON.stringify(event) });
}

/** GET /api/v1/live (students) and /api/v1/admin/live (admins): upgrade to the caller's own hub. */
export async function liveRoute(request: Request, env: Env): Promise<Response | null> {
  const path = new URL(request.url).pathname;
  if (path !== '/api/v1/live' && path !== '/api/v1/admin/live') return null;
  if (request.headers.get('Upgrade') !== 'websocket') throw new ApiError(426, 'UPGRADE_REQUIRED', '需要 WebSocket 连接');
  // Cookies are SameSite=Strict already; the Origin check also stops other sites opening a socket with them.
  if (request.headers.get('Origin') !== env.APP_ORIGIN) throw new ApiError(403, 'ORIGIN_REJECTED', '请从本站页面连接');
  if (!env.LIVE) throw new ApiError(503, 'LIVE_UNAVAILABLE', '实时通道未配置，页面会自动改为定时刷新');
  const channel = path.startsWith('/api/v1/admin/') ? `admin:${(await requireAdmin(request, env)).id}` : `student:${(await requireStudent(request, env)).id}`;
  return env.LIVE.get(env.LIVE.idFromName(channel)).fetch(request);
}

/** Highest inbox id before a mutating request, so the fan-out afterwards only looks at rows that request created. */
export async function inboxWatermark(env: Env): Promise<number> {
  return (await env.DB.prepare('SELECT COALESCE(max(id),0) AS id FROM inbox_messages').first<number>('id')) ?? 0;
}

/**
 * Inbox rows are written by database triggers for every student-facing change (status, claim, release, refund, chat),
 * so they are the one place to fan out from. Each row is claimed once via pushed_at, then announced on the student's
 * live socket and, unless the student caused it themselves, sent as a web push.
 */
export async function fanOut(env: Env, after: number, causedByStudent: boolean): Promise<void> {
  const rows = (await env.DB.prepare('UPDATE inbox_messages SET pushed_at=unixepoch() WHERE id>? AND pushed_at IS NULL RETURNING user_id AS userId,order_id AS orderId,kind,title,link')
    .bind(after).all<{ userId: string; orderId: string | null; kind: string; title: string; link: string | null }>()).results;
  await Promise.all(rows.map(async row => {
    await publish(env, `student:${row.userId}`, row.kind === 'CHAT' && row.orderId ? { type: 'chat', orderId: row.orderId }
      : row.kind.startsWith('SEND_') ? { type: 'send', id: row.link?.split('/').pop() ?? null } : { type: 'order', orderId: row.orderId, kind: row.kind });
    if (causedByStudent) return;
    const status = STATUS_LABELS[row.kind as keyof typeof STATUS_LABELS];
    // The inbox title already names the building and what happened ("南苑7号楼 · 配送员已出发").
    await sendPush(env, 'STUDENT', row.userId, {
      title: row.kind === 'CHAT' ? '配送员发来新消息' : row.kind === 'NEAR' ? '配送员快到了' : 'CampusDrop 校园快递',
      body: row.title || (status ? `订单进度：${status}` : '你有一条新消息'),
      url: row.link ?? (row.orderId ? `/orders/${row.orderId}` : '/messages'),
      tag: row.orderId ?? 'inbox',
    });
  }));
}

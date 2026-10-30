import type { Env } from './types';
import { ApiError, body, json } from './http';
import { requireAdmin, requireStudent } from './session';
import { rateLimit } from './rate-limit';
import { adminOrder } from './order-access';
import { ownOrder, serializeOrder, orderColumns, type OrderRow } from './orders';
import { requireContact } from './admin-contact';
import { orderLive } from './live-delivery';
import { nearSchema, proxySchema, type TrackView } from '../shared/operations';
import { DROP_PLACE_LABELS } from '../shared/campus-map';
import { STATUS_LABELS } from '../shared/constants';
import { slotLabel } from '../shared/slots';

/*
 * Order extras added in v2.7: roommate pickup (代收人 + read-only tracking link), the courier's "almost there" notice
 * and delivery photos (送达拍照存证). Everything here is scoped exactly like the order itself: the student who owns it,
 * or an admin whose scope covers it.
 */
const now = () => Math.floor(Date.now() / 1000);
const CLOSED = ['COMPLETED', 'CANCELLED'];
export const PHOTO_MAX_BYTES = 200 * 1024;

// ---------------------------------------------------------------- "almost there" (快到了)
/**
 * Tell the student once that the courier is about to arrive: an inbox row (turned into a live event and a web push by
 * the request fan-out). Returns whether this call was the one that sent it.
 */
export async function markNear(env: Env, orderId: string): Promise<boolean> {
  const row = await env.DB.prepare(`UPDATE delivery_orders SET near_notified_at=unixepoch() WHERE id=? AND status='OUT_FOR_DELIVERY' AND near_notified_at IS NULL
    RETURNING user_id AS userId,json_extract(dorm_snapshot_json,'$.buildingName') AS building,drop_place AS dropPlace,proxy_name AS proxyName`).bind(orderId)
    .first<{ userId: string; building: string; dropPlace: keyof typeof DROP_PLACE_LABELS | null; proxyName: string }>();
  if (!row) return false;
  const where = row.dropPlace ? DROP_PLACE_LABELS[row.dropPlace] : row.building;
  await env.DB.prepare("INSERT INTO inbox_messages(user_id,order_id,kind,title) VALUES(?,?,'NEAR',?)")
    .bind(row.userId, orderId, `${where} · 配送员快到了，${row.proxyName ? `请提醒${row.proxyName}准备取件` : '请准备取件'}`).run();
  return true;
}

// ---------------------------------------------------------------- photos
function bytesOf(value: unknown): Uint8Array {
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  if (Array.isArray(value)) return Uint8Array.from(value as number[]);
  return new Uint8Array();
}
function base64(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 0x8000) out += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(out);
}
function imageKind(bytes: Uint8Array): 'image/jpeg' | 'image/webp' | null {
  if (bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  const ascii = (from: number, to: number) => String.fromCharCode(...bytes.subarray(from, to));
  if (bytes.length > 12 && ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP') return 'image/webp';
  return null;
}
async function readPhotoBody(request: Request): Promise<{ bytes: Uint8Array; mime: 'image/jpeg' | 'image/webp' }> {
  const declared = request.headers.get('Content-Type')?.split(';')[0].trim();
  if (declared !== 'image/jpeg' && declared !== 'image/webp') throw new ApiError(415, 'IMAGE_REQUIRED', '请上传 JPEG 或 WebP 图片');
  if (Number(request.headers.get('Content-Length')) > PHOTO_MAX_BYTES) throw new ApiError(413, 'PHOTO_TOO_LARGE', '照片超过 200 KB，请重新拍摄（页面会自动压缩）');
  const reader = request.body?.getReader();
  if (!reader) throw new ApiError(400, 'INVALID_INPUT', '缺少照片');
  const chunks: Uint8Array[] = []; let size = 0;
  while (true) {
    const next = await reader.read(); if (next.done) break;
    size += next.value.byteLength;
    if (size > PHOTO_MAX_BYTES) { await reader.cancel(); throw new ApiError(413, 'PHOTO_TOO_LARGE', '照片超过 200 KB，请重新拍摄（页面会自动压缩）'); }
    chunks.push(next.value);
  }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  const mime = imageKind(bytes);
  if (!mime || mime !== declared) throw new ApiError(415, 'IMAGE_REQUIRED', '文件不是有效的 JPEG 或 WebP 图片');
  return { bytes, mime };
}
async function photoOf(env: Env, orderId: string) {
  const row = await env.DB.prepare('SELECT mime,bytes,created_at AS createdAt FROM delivery_photos WHERE order_id=?').bind(orderId).first<{ mime: string; bytes: unknown; createdAt: number }>();
  if (!row) throw new ApiError(404, 'NOT_FOUND', '这单还没有送达照片');
  // Returned as a data URL inside JSON: works with the strict CSP (img-src data:) and through the JSON-only API proxies.
  return { photo: { dataUrl: `data:${row.mime};base64,${base64(bytesOf(row.bytes))}`, createdAt: row.createdAt } };
}

// ---------------------------------------------------------------- public tracking view
async function trackView(env: Env, token: string): Promise<TrackView> {
  const row = await env.DB.prepare(`SELECT ${orderColumns},o.updated_at AS updatedAt FROM delivery_orders o WHERE o.share_token=? AND o.student_deleted=0
    AND EXISTS(SELECT 1 FROM payments p WHERE p.order_id=o.id AND p.type='DELIVERY')`).bind(token).first<OrderRow & { updatedAt: number }>();
  // Links stop working a day after the order closes.
  if (!row || (CLOSED.includes(row.status) && row.updatedAt < now() - 86400)) throw new ApiError(404, 'NOT_FOUND', '链接已失效或已被同学关闭');
  const order = serializeOrder(row), live = await orderLive(env, row);
  const events = (await env.DB.prepare('SELECT to_status AS status,created_at AS at FROM order_events WHERE order_id=? ORDER BY id').bind(order.id).all<{ status: string; at: number }>()).results
    .filter((e, i, list) => i === 0 || e.status !== list[i - 1].status);
  return {
    status: order.status, buildingName: order.dormSnapshot.buildingName, dropPlace: order.dropPlace ? DROP_PLACE_LABELS[order.dropPlace] : null,
    proxyName: order.proxyName ?? '', slot: order.slotDate && order.slotCode ? slotLabel(order.slotDate, order.slotCode, now()) : null,
    events: events.map(e => ({ status: STATUS_LABELS[e.status as keyof typeof STATUS_LABELS] ?? e.status, at: e.at })),
    eta: live.eta ? { minutes: live.eta.minutes, label: live.eta.label, basis: live.eta.basis } : null,
    courier: live.courier ? { x: live.courier.x, y: live.courier.y, source: live.courier.source } : null,
    stationCode: order.stationSnapshot.code, destination: order.dropPlace ?? order.dormSnapshot.buildingCode, updatedAt: now(),
  };
}

export async function orderExtraRoutes(request: Request, env: Env): Promise<Response | null> {
  const path = new URL(request.url).pathname.replace('/api/v1', ''), method = request.method;

  const track = /^\/track\/([0-9a-f]{32})$/.exec(path);
  if (track && method === 'GET') {
    await rateLimit(env, `track:ip:${request.headers.get('CF-Connecting-IP') ?? 'local'}`, 240);
    return json({ track: await trackView(env, track[1]) });
  }

  const student = /^\/orders\/([a-f0-9-]{36})\/(proxy|share|photo)$/.exec(path);
  if (student) {
    const user = await requireStudent(request, env), id = student[1];
    const row = await ownOrder(env, user.id, id);
    if (student[2] === 'photo' && method === 'GET') return json(await photoOf(env, row.id));
    if (student[2] === 'proxy' && method === 'PATCH') {
      const data = await body(request, proxySchema);
      if (CLOSED.includes(row.status)) throw new ApiError(409, 'ORDER_CLOSED', '订单已结束，不能再修改代收人');
      const result = await env.DB.prepare("UPDATE delivery_orders SET proxy_name=?,version=version+1,updated_at=unixepoch() WHERE id=? AND user_id=? AND version=? AND status NOT IN ('COMPLETED','CANCELLED')")
        .bind(data.name, id, user.id, data.version).run();
      if (!result.meta.changes) throw new ApiError(409, 'STALE_ORDER', '订单已变化，请刷新后再修改');
      return json({ order: serializeOrder(await ownOrder(env, user.id, id)) });
    }
    if (student[2] === 'share' && method === 'POST') {
      if (CLOSED.includes(row.status) || row.status === 'WAITING_PAYMENT') throw new ApiError(409, 'ORDER_CLOSED', '支付后、订单完成前可以分享进度');
      await rateLimit(env, `share:${user.id}`, 30);
      const token = [...crypto.getRandomValues(new Uint8Array(16))].map(b => b.toString(16).padStart(2, '0')).join('');
      // Keeps an existing link; a fresh one is made only when there is none (or after the student turned it off).
      await env.DB.prepare('UPDATE delivery_orders SET share_token=? WHERE id=? AND user_id=? AND share_token IS NULL').bind(token, id, user.id).run();
      return json({ token: await env.DB.prepare('SELECT share_token AS t FROM delivery_orders WHERE id=?').bind(id).first<string>('t') });
    }
    if (student[2] === 'share' && method === 'DELETE') {
      await env.DB.prepare('UPDATE delivery_orders SET share_token=NULL WHERE id=? AND user_id=?').bind(id, user.id).run();
      return json({ token: null });
    }
  }

  const admin = /^\/admin\/orders\/([a-f0-9-]{36})\/(photo|near)$/.exec(path);
  if (admin) {
    const actor = await requireAdmin(request, env), id = admin[1];
    const row = await adminOrder(env, actor, id);
    if (admin[2] === 'photo' && method === 'GET') return json(await photoOf(env, row.id));
    if (admin[2] === 'photo' && method === 'PUT') {
      await requireContact(env, actor.id);
      if (!['OUT_FOR_DELIVERY', 'DELIVERED_DOWNSTAIRS', 'DELIVERED_TO_ROOM', 'COMPLETED'].includes(row.status)) throw new ApiError(409, 'PHOTO_NOT_READY', '出发配送后才能上传送达照片');
      await rateLimit(env, `photo:${actor.id}`, 60);
      const { bytes, mime } = await readPhotoBody(request);
      await env.DB.batch([
        env.DB.prepare(`INSERT INTO delivery_photos(order_id,admin_id,mime,bytes) VALUES(?,?,?,?)
          ON CONFLICT(order_id) DO UPDATE SET admin_id=excluded.admin_id,mime=excluded.mime,bytes=excluded.bytes,created_at=unixepoch()`).bind(id, actor.id, mime, bytes),
        env.DB.prepare("INSERT INTO audit_logs(id,actor_type,actor_id,action,resource_id,metadata_redacted) VALUES(?,'ADMIN',?,'DELIVERY_PHOTO_SAVED',?,json_object('bytes',?))").bind(crypto.randomUUID(), actor.id, id, bytes.length),
        env.DB.prepare("INSERT INTO inbox_messages(user_id,order_id,kind,title) SELECT user_id,id,'PHOTO',COALESCE(json_extract(dorm_snapshot_json,'$.buildingName'),'你的订单')||' · 配送员上传了送达照片' FROM delivery_orders WHERE id=?").bind(id),
      ]);
      return json({ ok: true, bytes: bytes.length });
    }
    if (admin[2] === 'near' && method === 'POST') {
      const data = await body(request, nearSchema);
      if (row.version !== data.version) throw new ApiError(409, 'STALE_ORDER', '订单已更新，请刷新后重试');
      if (row.status !== 'OUT_FOR_DELIVERY') throw new ApiError(409, 'NEAR_NOT_READY', '出发配送后才能通知同学');
      const sent = await markNear(env, id);
      return json({ sent, message: sent ? '已通知同学：配送员快到了' : '已经通知过同学了' });
    }
  }
  return null;
}

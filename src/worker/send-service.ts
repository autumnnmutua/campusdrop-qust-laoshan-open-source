import type { Env } from './types';
import { ApiError, body, json } from './http';
import { requireAdmin, requireStudent } from './session';
import { rateLimit } from './rate-limit';
import { requireContact } from './admin-contact';
import { readAddress } from './addresses';
import { publish } from './live';
import { background } from './background';
import { SEND_SLOT_CAPACITY, notifyGroupLater, requireOrderingOpen } from './settings';
import { CAMPUS_ID } from '../shared/constants';
import type { Admin } from '../shared/contracts';
import { sendActionSchema, sendCancelSchema, sendCreateSchema, sendDropSchema, type SendRequest } from '../shared/operations';
import { slotLabel, slotOpen, type SlotCode } from '../shared/slots';

/*
 * 代寄件 (send service): the student books a window, a courier collects the parcel from their room and hands it in at
 * the station. Priced like room delivery and paid with the same mock payment (no real money). The flow is deliberately
 * small — WAITING_PICKUP → PICKED_UP → DROPPED, or CANCELLED — and every transition is version-guarded.
 */
export const sendPriceFen = (size: 'SMALL' | 'LARGE') => (size === 'SMALL' ? 300 : 700);
const now = () => Math.floor(Date.now() / 1000);

const columns = `s.id,s.status,s.package_size AS packageSize,s.carrier,s.note,s.slot_date AS slotDate,s.slot_code AS slotCode,s.amount_fen AS amountFen,
  s.refunded_fen AS refundedFen,s.tracking_no AS trackingNo,s.cancel_reason AS cancelReason,s.version,s.created_at AS createdAt,s.picked_at AS pickedAt,s.dropped_at AS droppedAt,
  json_extract(s.dorm_snapshot_json,'$.buildingName') AS buildingName,json_extract(s.dorm_snapshot_json,'$.roomNo') AS roomNo,
  (SELECT canonical_name FROM stations WHERE code=s.station_code) AS stationName,s.assignee_admin_id IS NOT NULL AS hasAssignee,
  (SELECT a.phone FROM admin_users a WHERE a.id=s.assignee_admin_id AND a.status='ACTIVE') AS assigneePhone`;
const adminColumns = `${columns},json_extract(s.dorm_snapshot_json,'$.name') AS studentName,json_extract(s.dorm_snapshot_json,'$.phone') AS studentPhone,
  (SELECT username FROM admin_users WHERE id=s.assignee_admin_id) AS assignee`;
const shape = (r: SendRequest) => ({ ...r, hasAssignee: Boolean(r.hasAssignee) });

/** Which send requests an admin may see: same building/zone rules as orders; couriers see the open pool and their own. */
function sendScope(admin: Admin): { sql: string; params: string[] } {
  if (admin.role === 'SUPER_ADMIN') return { sql: 's.campus_id=?', params: [CAMPUS_ID] };
  if (admin.role === 'DELIVERY_STAFF') return { sql: "s.campus_id=? AND (s.assignee_admin_id=? OR (s.assignee_admin_id IS NULL AND s.status='WAITING_PICKUP'))", params: [CAMPUS_ID, admin.id] };
  return {
    sql: `s.campus_id=? AND EXISTS(SELECT 1 FROM admin_scopes sc WHERE sc.admin_id=? AND sc.campus_id=s.campus_id AND (sc.zone IS NULL OR sc.zone=s.zone)
      AND (sc.building_code IS NULL OR sc.building_code=s.dorm_building_code) AND (?='ZONE_ADMIN' OR sc.building_code IS NOT NULL))`,
    params: [CAMPUS_ID, admin.id, admin.role],
  };
}
async function ownSend(env: Env, userId: string, id: string): Promise<SendRequest> {
  const row = await env.DB.prepare(`SELECT ${columns} FROM send_requests s WHERE s.id=? AND s.user_id=?`).bind(id, userId).first<SendRequest>();
  if (!row) throw new ApiError(404, 'NOT_FOUND', '寄件预约不存在');
  return shape(row);
}
async function adminSend(env: Env, admin: Admin, id: string): Promise<SendRequest & { assigneeId: string | null }> {
  const scope = sendScope(admin);
  const row = await env.DB.prepare(`SELECT ${adminColumns},s.assignee_admin_id AS assigneeId FROM send_requests s WHERE s.id=? AND ${scope.sql}`).bind(id, ...scope.params).first<SendRequest & { assigneeId: string | null }>();
  if (!row) throw new ApiError(404, 'NOT_FOUND', '寄件预约不存在或不在你的授权范围');
  return { ...shape(row), assigneeId: row.assigneeId };
}
async function announce(env: Env, id: string) {
  const owner = await env.DB.prepare('SELECT user_id AS u FROM send_requests WHERE id=?').bind(id).first<string>('u');
  if (owner) background(publish(env, `student:${owner}`, { type: 'send', id }));
}

export async function sendRoutes(request: Request, env: Env): Promise<Response | null> {
  const url = new URL(request.url), path = url.pathname.replace('/api/v1', ''), method = request.method;

  // ---------------------------------------------------------------- student
  if (path === '/sends' || path.startsWith('/sends/')) {
    const user = await requireStudent(request, env);
    if (path === '/sends' && method === 'GET') {
      const rows = (await env.DB.prepare(`SELECT ${columns} FROM send_requests s WHERE s.user_id=? ORDER BY s.created_at DESC,s.id DESC LIMIT 50`).bind(user.id).all<SendRequest>()).results;
      const load = (await env.DB.prepare("SELECT slot_date AS date,slot_code AS code,count(*) AS n FROM send_requests WHERE status<>'CANCELLED' AND slot_date>=? GROUP BY slot_date,slot_code")
        .bind(new Date((now() + 8 * 3600) * 1000).toISOString().slice(0, 10)).all<{ date: string; code: SlotCode; n: number }>()).results;
      return json({ sends: rows.map(shape), load, capacity: SEND_SLOT_CAPACITY, prices: { SMALL: sendPriceFen('SMALL'), LARGE: sendPriceFen('LARGE') } });
    }
    if (path === '/sends' && method === 'POST') {
      await requireOrderingOpen(env);
      await rateLimit(env, `send:${user.id}`, 20);
      const data = await body(request, sendCreateSchema), t = now();
      if (!slotOpen(data.slotDate, data.slotCode, t)) throw new ApiError(409, 'SLOT_CLOSED', '该时段已停止预约，请选择其他时段');
      const address = await readAddress(env, user.id);
      if (!address) throw new ApiError(400, 'ADDRESS_REQUIRED', '请先填写寝室资料，配送员会按寝室上门取件');
      const station = await env.DB.prepare('SELECT code,canonical_name AS name FROM stations WHERE campus_id=? AND active=1 ORDER BY code LIMIT 1').bind(CAMPUS_ID).first<{ code: string; name: string }>();
      if (!station) throw new ApiError(409, 'LOCATION_INACTIVE', '暂无可用站点');
      const id = crypto.randomUUID();
      const result = await env.DB.prepare(`INSERT INTO send_requests(id,user_id,campus_id,zone,dorm_building_code,dorm_snapshot_json,station_code,package_size,carrier,note,slot_date,slot_code,amount_fen)
        SELECT ?,?,?,?,?,?,?,?,?,?,?,?,? WHERE (SELECT count(*) FROM send_requests WHERE slot_date=? AND slot_code=? AND status<>'CANCELLED')<?
        AND (SELECT count(*) FROM send_requests WHERE user_id=? AND status IN ('WAITING_PICKUP','PICKED_UP'))<3`)
        .bind(id, user.id, CAMPUS_ID, address.zone, address.buildingCode, JSON.stringify({ ...address, name: user.name, phone: user.phone }), station.code,
          data.packageSize, data.carrier, data.note, data.slotDate, data.slotCode, sendPriceFen(data.packageSize),
          data.slotDate, data.slotCode, SEND_SLOT_CAPACITY, user.id).run();
      if (!result.meta.changes) {
        const open = await env.DB.prepare("SELECT count(*) AS n FROM send_requests WHERE user_id=? AND status IN ('WAITING_PICKUP','PICKED_UP')").bind(user.id).first<number>('n');
        if ((open ?? 0) >= 3) throw new ApiError(409, 'SEND_LIMIT', '你已有 3 个未完成的寄件预约，完成后再预约新的');
        throw new ApiError(409, 'SLOT_FULL', '这个时段的寄件名额已满，请换一个时段');
      }
      await env.DB.prepare("INSERT INTO audit_logs(id,actor_type,actor_id,action,resource_id) VALUES(?,'STUDENT',?,'SEND_BOOKED_MOCK_PAID',?)").bind(crypto.randomUUID(), user.id, id).run();
      notifyGroupLater(env, 'NEW_SEND', `新寄件预约：${address.buildingName} · ${data.packageSize === 'SMALL' ? '小件' : '大件'} · ${data.carrier} · ${slotLabel(data.slotDate, data.slotCode, t)}`, `send:${id}`);
      return json({ send: await ownSend(env, user.id, id), message: '已预约并模拟支付，未发生真实扣款' }, 201);
    }
    const match = /^\/sends\/([a-f0-9-]{36})(?:\/(cancel))?$/.exec(path);
    if (match && method === 'GET' && !match[2]) return json({ send: await ownSend(env, user.id, match[1]) });
    if (match && method === 'POST' && match[2] === 'cancel') {
      const data = await body(request, sendActionSchema);
      const result = await env.DB.prepare("UPDATE send_requests SET status='CANCELLED',refunded_fen=amount_fen,cancel_reason='学生取消',version=version+1,updated_at=unixepoch() WHERE id=? AND user_id=? AND version=? AND status='WAITING_PICKUP'")
        .bind(match[1], user.id, data.version).run();
      if (!result.meta.changes) throw new ApiError(409, 'CANCEL_NOT_ALLOWED', '配送员已上门取件后不能自行取消，请联系配送员');
      return json({ send: await ownSend(env, user.id, match[1]), message: '已取消并模拟退款，未发生真实资金流转' });
    }
  }

  // ---------------------------------------------------------------- admin / courier
  if (path === '/admin/sends' || path.startsWith('/admin/sends/')) {
    const admin = await requireAdmin(request, env), scope = sendScope(admin);
    if (path === '/admin/sends' && method === 'GET') {
      const group = url.searchParams.get('group') === 'CLOSED' ? "s.status IN ('DROPPED','CANCELLED')" : "s.status IN ('WAITING_PICKUP','PICKED_UP')";
      const rows = (await env.DB.prepare(`SELECT ${adminColumns} FROM send_requests s WHERE ${group} AND ${scope.sql} ORDER BY s.slot_date,s.slot_code,s.created_at LIMIT 100`)
        .bind(...scope.params).all<SendRequest>()).results;
      // Before a courier takes the job, the pool shows the building and window only — no name, phone or room.
      return json({ sends: rows.map(r => (r.hasAssignee || admin.role !== 'DELIVERY_STAFF' ? shape(r) : { ...shape(r), studentName: '', studentPhone: '', roomNo: '' })) });
    }
    const match = /^\/admin\/sends\/([a-f0-9-]{36})\/(claim|pickup|drop|cancel)$/.exec(path);
    if (match && method === 'POST') {
      await requireContact(env, admin.id);
      const id = match[1], row = await adminSend(env, admin, id);
      const mine = row.assigneeId === admin.id;
      if (match[2] === 'claim') {
        const data = await body(request, sendActionSchema);
        const result = await env.DB.prepare("UPDATE send_requests SET assignee_admin_id=?,version=version+1,updated_at=unixepoch() WHERE id=? AND version=? AND status='WAITING_PICKUP' AND assignee_admin_id IS NULL")
          .bind(admin.id, id, data.version).run();
        if (!result.meta.changes) throw new ApiError(409, 'CLAIM_UNAVAILABLE', '这单寄件已被接走或已变化，请刷新');
      } else if (match[2] === 'pickup') {
        const data = await body(request, sendActionSchema);
        if (!mine) throw new ApiError(403, 'FORBIDDEN', '请先接单');
        const result = await env.DB.prepare("UPDATE send_requests SET status='PICKED_UP',picked_at=unixepoch(),version=version+1,updated_at=unixepoch() WHERE id=? AND version=? AND assignee_admin_id=? AND status='WAITING_PICKUP'")
          .bind(id, data.version, admin.id).run();
        if (!result.meta.changes) throw new ApiError(409, 'STALE_ORDER', '寄件状态已变化，请刷新');
      } else if (match[2] === 'drop') {
        const data = await body(request, sendDropSchema);
        if (!mine) throw new ApiError(403, 'FORBIDDEN', '请先接单');
        const result = await env.DB.prepare("UPDATE send_requests SET status='DROPPED',dropped_at=unixepoch(),tracking_no=?,version=version+1,updated_at=unixepoch() WHERE id=? AND version=? AND assignee_admin_id=? AND status='PICKED_UP'")
          .bind(data.trackingNo, id, data.version, admin.id).run();
        if (!result.meta.changes) throw new ApiError(409, 'STALE_ORDER', '寄件状态已变化，请刷新');
      } else {
        const data = await body(request, sendCancelSchema);
        if (!mine && admin.role === 'DELIVERY_STAFF') throw new ApiError(403, 'FORBIDDEN', '只能取消自己接的寄件');
        const result = await env.DB.prepare("UPDATE send_requests SET status='CANCELLED',refunded_fen=amount_fen,cancel_reason=?,version=version+1,updated_at=unixepoch() WHERE id=? AND version=? AND status IN ('WAITING_PICKUP','PICKED_UP')")
          .bind(data.reason, id, data.version).run();
        if (!result.meta.changes) throw new ApiError(409, 'STALE_ORDER', '寄件状态已变化，请刷新');
      }
      await announce(env, id);
      return json({ send: await adminSend(env, admin, id) });
    }
  }
  return null;
}

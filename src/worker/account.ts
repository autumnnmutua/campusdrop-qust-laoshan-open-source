import type { Env } from './types';
import { ApiError, body, json } from './http';
import { requireStudent, revokeSession } from './session';
import { accountDeleteSchema } from '../shared/live';
import { DUMMY_HASH } from '../domain/password';
import { rateLimit } from './rate-limit';
import { publish } from './live';

/**
 * Self-service account deletion (账号注销). Orders and mock payments are kept as anonymous records so refunds and
 * courier statistics stay consistent; everything that identifies the student is removed or scrubbed.
 */
export async function accountRoutes(request: Request, env: Env): Promise<Response | null> {
  const path = new URL(request.url).pathname;
  if (path !== '/api/v1/me/delete' || request.method !== 'POST') return null;
  const user = await requireStudent(request, env);
  await rateLimit(env, `account-delete:${user.id}`, 5);
  await body(request, accountDeleteSchema);
  const open = await env.DB.prepare("SELECT count(*) AS n FROM delivery_orders WHERE user_id=? AND status NOT IN ('COMPLETED','CANCELLED') AND student_deleted=0").bind(user.id).first<number>('n');
  if (open) throw new ApiError(409, 'ACCOUNT_HAS_ORDERS', `还有 ${open} 个订单未完成，请先确认收货或取消后再注销`);
  const sending = await env.DB.prepare("SELECT count(*) AS n FROM send_requests WHERE user_id=? AND status IN ('WAITING_PICKUP','PICKED_UP')").bind(user.id).first<number>('n');
  if (sending) throw new ApiError(409, 'ACCOUNT_HAS_ORDERS', `还有 ${sending} 个代寄件未完成，请等待寄出或取消后再注销`);
  const scrubbed = "json_set(dorm_snapshot_json,'$.name','已注销用户','$.phone','','$.roomNo','—')";
  await env.DB.batch([
    // deleted_at first: the snapshot trigger only lets a deleted account's snapshot change.
    env.DB.prepare("UPDATE users SET deleted_at=unixepoch(),status='DISABLED',username='deleted_'||lower(hex(randomblob(12))),name='已注销用户',phone='',password_hash=? WHERE id=?").bind(DUMMY_HASH, user.id),
    env.DB.prepare(`UPDATE delivery_orders SET dorm_snapshot_json=${scrubbed},order_note='',handoff_code=NULL,proxy_name='',share_token=NULL WHERE user_id=?`).bind(user.id),
    env.DB.prepare(`UPDATE send_requests SET dorm_snapshot_json=${scrubbed},note='',tracking_no='' WHERE user_id=?`).bind(user.id),
    env.DB.prepare('DELETE FROM delivery_photos WHERE order_id IN (SELECT id FROM delivery_orders WHERE user_id=?)').bind(user.id),
    env.DB.prepare("UPDATE parcels SET status=CASE WHEN status='ACTIVE' THEN 'CANCELLED' ELSE status END,pickup_code='已清理',note='' WHERE user_id=?").bind(user.id),
    env.DB.prepare('DELETE FROM user_addresses WHERE user_id=?').bind(user.id),
    env.DB.prepare('DELETE FROM delivery_rules WHERE user_id=?').bind(user.id),
    env.DB.prepare('DELETE FROM order_messages WHERE order_id IN (SELECT id FROM delivery_orders WHERE user_id=?)').bind(user.id),
    env.DB.prepare('DELETE FROM inbox_messages WHERE user_id=?').bind(user.id),
    env.DB.prepare("DELETE FROM push_subscriptions WHERE owner_kind='STUDENT' AND owner_id=?").bind(user.id),
    env.DB.prepare("DELETE FROM recovery_tokens WHERE actor_kind='student' AND actor_id=?").bind(user.id),
    env.DB.prepare('DELETE FROM sessions WHERE user_id=?').bind(user.id),
    env.DB.prepare("INSERT INTO audit_logs(id,actor_type,actor_id,action,resource_id) VALUES(?,'STUDENT',?,'ACCOUNT_DELETED',?)").bind(crypto.randomUUID(), user.id, user.id),
  ]);
  await publish(env, `student:${user.id}`, { type: 'bye' }).catch(() => {});
  return json({ ok: true }, 200, { 'Set-Cookie': await revokeSession(request, env, 'student') });
}

/**
 * Daily data minimisation (cron): pickup codes of finished parcels after 30 days, chat after 90 days, handoff codes a
 * week after an order closes, stale courier positions after a day.
 */
export function cleanupStatements(env: Env): D1PreparedStatement[] {
  return [
    env.DB.prepare("UPDATE parcels SET pickup_code='已清理' WHERE status<>'ACTIVE' AND pickup_code<>'已清理' AND created_at<unixepoch()-2592000"),
    env.DB.prepare('DELETE FROM order_messages WHERE created_at<unixepoch()-7776000'),
    env.DB.prepare("UPDATE delivery_orders SET handoff_code=NULL WHERE handoff_code IS NOT NULL AND status IN ('COMPLETED','CANCELLED') AND updated_at<unixepoch()-604800"),
    env.DB.prepare('DELETE FROM courier_locations WHERE updated_at<unixepoch()-86400'),
    // v2.7: delivery photos after 30 days, tracking links a day after the order closed, old shifts and webhook keys.
    env.DB.prepare('DELETE FROM delivery_photos WHERE created_at<unixepoch()-2592000'),
    env.DB.prepare("UPDATE delivery_orders SET share_token=NULL WHERE share_token IS NOT NULL AND status IN ('COMPLETED','CANCELLED') AND updated_at<unixepoch()-86400"),
    env.DB.prepare("DELETE FROM courier_shifts WHERE slot_date<date(unixepoch()+28800-604800,'unixepoch')"),
    env.DB.prepare('DELETE FROM webhook_log WHERE sent_at<unixepoch()-2592000'),
  ];
}

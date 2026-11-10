/* © 2026 专业团队 · CampusDrop v4.5.0 */
import type { Env } from './types';
import { ApiError, body, json } from './http';
import { requireAdmin, requireSuperView } from './session';
import { rateLimit } from './rate-limit';
import { dispatchUpdateSchema, planDispatch, type DispatchBuilding, type DispatchOverview } from '../shared/dispatch';

/*
 * v4.5 · 楼栋分配 (who delivers the 小件 of each building). Super admins see and change it; in the one-click demo the
 * demo's 超级管理员 changes the demo's own assignments only (world = its demo group), which never reach the real site.
 * Couriers read their own buildings (GET /admin/dispatch/mine).
 */
const DAY = 86400;
const now = () => Math.floor(Date.now() / 1000);

async function worldOf(env: Env, adminId: string): Promise<string> {
  return await env.DB.prepare("SELECT coalesce(demo_group,'') AS w FROM admin_users WHERE id=?").bind(adminId).first<string>('w') ?? '';
}
async function current(env: Env, world: string): Promise<Record<string, string>> {
  const rows = (await env.DB.prepare('SELECT building_code AS code,admin_id AS adminId FROM building_couriers WHERE world=?').bind(world).all<{ code: string; adminId: string }>()).results;
  return Object.fromEntries(rows.map(r => [r.code, r.adminId]));
}

export async function dispatchOverview(env: Env, adminId: string, world: string, canEdit: boolean): Promise<DispatchOverview> {
  const since = now() - 30 * DAY;
  const [buildings, couriers, assigned] = await Promise.all([
    env.DB.prepare(`SELECT b.code,b.display_name AS name,b.zone,
        (SELECT count(*) FROM delivery_orders o WHERE o.dorm_building_code=b.code AND o.package_size='SMALL' AND o.demo_history=0 AND o.status<>'WAITING_PAYMENT'
          AND coalesce(o.demo_group,'')=? AND o.created_at>=?) AS orders30,
        (SELECT count(*) FROM delivery_orders o JOIN batch_items bi ON bi.order_id=o.id WHERE bi.batch_id LIKE 'auto-%' AND o.dorm_building_code=b.code
          AND o.status='WAITING_PICKUP' AND coalesce(o.demo_group,'')=?) AS waiting
      FROM dorm_buildings b WHERE b.active=1 ORDER BY b.sort_order,b.code`).bind(world, since, world).all<DispatchBuilding & { waiting: number }>(),
    env.DB.prepare(`SELECT a.id,a.username AS name,a.role,coalesce(a.phone,'')<>'' AS phone,
        (SELECT count(*) FROM building_couriers bc WHERE bc.admin_id=a.id AND bc.world=?) AS buildings,
        (SELECT count(*) FROM delivery_batches b JOIN batch_items bi ON bi.batch_id=b.id JOIN delivery_orders o ON o.id=bi.order_id
          WHERE b.assignee_admin_id=a.id AND b.id LIKE 'auto-%' AND o.status='WAITING_PICKUP') AS waiting,
        (SELECT count(*) FROM delivery_batches b JOIN batch_items bi ON bi.batch_id=b.id JOIN delivery_orders o ON o.id=bi.order_id
          WHERE b.assignee_admin_id=a.id AND o.status='COMPLETED' AND o.demo_history=0 AND b.created_at>=?) AS orders30
      FROM admin_users a WHERE a.status='ACTIVE' AND a.role IN ('DELIVERY_STAFF','SUPER_ADMIN') AND coalesce(a.demo_group,'')=?
      ORDER BY a.role='SUPER_ADMIN',a.created_at,a.username`).bind(world, since, world).all<{ id: string; name: string; role: string; phone: number; buildings: number; waiting: number; orders30: number }>(),
    current(env, world),
  ]);
  // The automatic plan uses couriers (not super admins) who can be reached by phone; a super admin can still be picked by hand.
  const planners = couriers.results.filter(c => c.role === 'DELIVERY_STAFF' && c.phone).map(c => ({ id: c.id, name: c.name }));
  void adminId;
  return {
    world: world ? 'DEMO' : 'SITE', canEdit,
    buildings: buildings.results.map(b => ({ ...b, adminId: assigned[b.code] ?? null })),
    couriers: couriers.results.map(c => ({ ...c, phone: Boolean(c.phone) })),
    plan: planDispatch(buildings.results, planners, assigned),
  };
}

export async function dispatchRoutes(request: Request, env: Env): Promise<Response | null> {
  const path = new URL(request.url).pathname.replace(/^\/api\/v1/, ''), method = request.method;
  if (path !== '/admin/dispatch' && path !== '/admin/dispatch/mine') return null;
  const admin = await requireAdmin(request, env);
  const world = await worldOf(env, admin.id);

  if (path === '/admin/dispatch/mine' && method === 'GET') {
    const rows = (await env.DB.prepare(`SELECT b.code,b.display_name AS name,b.zone FROM building_couriers bc JOIN dorm_buildings b ON b.code=bc.building_code
      WHERE bc.admin_id=? AND bc.world=? ORDER BY b.sort_order,b.code`).bind(admin.id, world).all<{ code: string; name: string; zone: string }>()).results;
    return json({ buildings: rows });
  }
  requireSuperView(admin);
  if (method === 'GET') return json(await dispatchOverview(env, admin.id, world, true));
  if (method !== 'PUT') return null;

  await rateLimit(env, `dispatch:${admin.id}`, 60);
  const data = await body(request, dispatchUpdateSchema);
  const codes = [...new Set(data.assignments.map(a => a.buildingCode))];
  if (codes.length !== data.assignments.length) throw new ApiError(400, 'DUPLICATE_BUILDING', '同一栋楼只能出现一次');
  const known = new Set((await env.DB.prepare(`SELECT code FROM dorm_buildings WHERE active=1 AND code IN (${codes.map(() => '?').join(',')})`).bind(...codes).all<{ code: string }>()).results.map(r => r.code));
  const missing = codes.find(c => !known.has(c));
  if (missing) throw new ApiError(400, 'BUILDING_UNKNOWN', `楼栋 ${missing} 不存在或已停用`);
  const ids = [...new Set(data.assignments.map(a => a.adminId).filter((v): v is string => Boolean(v)))];
  if (ids.length) {
    const ok = new Map((await env.DB.prepare(`SELECT id,coalesce(phone,'')<>'' AS phone FROM admin_users WHERE status='ACTIVE' AND role IN ('DELIVERY_STAFF','SUPER_ADMIN')
      AND coalesce(demo_group,'')=? AND id IN (${ids.map(() => '?').join(',')})`).bind(world, ...ids).all<{ id: string; phone: number }>()).results.map(r => [r.id, Boolean(r.phone)]));
    const bad = ids.find(id => !ok.has(id));
    if (bad) throw new ApiError(400, 'COURIER_INVALID', '所选配送员不存在、已停用，或不属于当前站点');
    if (ids.some(id => !ok.get(id))) throw new ApiError(400, 'CONTACT_REQUIRED', '所选配送员还没有填写联系电话，填写后才能负责楼栋');
  }

  const before = await current(env, world);
  const statements: D1PreparedStatement[] = [];
  for (const a of data.assignments) {
    statements.push(a.adminId
      ? env.DB.prepare(`INSERT INTO building_couriers(world,building_code,admin_id,assigned_by,updated_at)
          VALUES(?,?,(SELECT id FROM admin_users WHERE id=? AND status='ACTIVE' AND role IN ('DELIVERY_STAFF','SUPER_ADMIN')
            AND coalesce(phone,'')<>'' AND coalesce(demo_group,'')=?),?,unixepoch())
          ON CONFLICT(world,building_code) DO UPDATE SET admin_id=excluded.admin_id,assigned_by=excluded.assigned_by,updated_at=excluded.updated_at`).bind(world, a.buildingCode, a.adminId, world, admin.id)
      : env.DB.prepare('DELETE FROM building_couriers WHERE world=? AND building_code=?').bind(world, a.buildingCode));
  }
  const changed = data.assignments.filter(a => (before[a.buildingCode] ?? null) !== a.adminId);
  statements.push(env.DB.prepare("INSERT INTO audit_logs(id,actor_type,actor_id,action,resource_id,metadata_redacted) VALUES(?,'ADMIN',?,'DISPATCH_UPDATED',?,?)")
    .bind(crypto.randomUUID(), admin.id, world || 'site', JSON.stringify({ changed: changed.map(a => ({ building: a.buildingCode, from: before[a.buildingCode] ?? null, to: a.adminId })), moveWaiting: data.moveWaiting })));
  try { await env.DB.batch(statements); }
  catch (error) {
    if (String(error).includes('NOT NULL constraint failed: building_couriers.admin_id'))
      throw new ApiError(409, 'COURIER_CHANGED', '所选配送员状态已变化，请刷新后重新分配');
    throw error;
  }

  // Small orders already handed to the previous courier and not picked up yet follow the building to its new courier
  // (one batch per merged delivery). Orders already picked up, or going back to the market, stay where they are.
  let moved = 0, skipped = 0;
  if (data.moveWaiting) for (const a of changed) {
    if (!a.adminId) continue;
    const waiting = (await env.DB.prepare(`SELECT o.id,o.group_id AS groupId,o.station_code AS station,bi.batch_id AS batchId,o.version FROM delivery_orders o JOIN batch_items bi ON bi.order_id=o.id
        JOIN delivery_batches b ON b.id=bi.batch_id WHERE b.id LIKE 'auto-%' AND b.assignee_admin_id<>? AND o.dorm_building_code=? AND coalesce(o.demo_group,'')=?
        AND o.status='WAITING_PICKUP' AND o.custody_state<>'STAFF' AND o.student_deleted=0 AND o.student_cancelled=0
        AND NOT EXISTS(SELECT 1 FROM parcel_handoffs h WHERE h.order_id=o.id AND h.status='PENDING')`).bind(a.adminId, a.buildingCode, world)
      .all<{ id: string; groupId: string | null; station: string; batchId: string; version: number }>()).results;
    const byKey = new Map<string, typeof waiting>();
    for (const o of waiting) { const k = `${o.groupId ?? o.id}|${o.station}`; byKey.set(k, [...(byKey.get(k) ?? []), o]); }
    for (const list of byKey.values()) {
      const batchId = `auto-m-${crypto.randomUUID()}`;
      try {
        await env.DB.batch([
          // Validate every old batch relation and the current building assignment inside the same transaction as the move.
          // A stale row makes the required assignee NULL, so the NOT NULL constraint rolls the whole batch back.
          env.DB.prepare(`INSERT INTO delivery_batches(id,station_code,assignee_admin_id,created_by)
            VALUES(?,?,(SELECT target.id FROM admin_users target WHERE target.id=? AND target.status='ACTIVE'
              AND target.role IN ('DELIVERY_STAFF','SUPER_ADMIN') AND coalesce(target.phone,'')<>''
              AND coalesce(target.demo_group,'')=?
              AND EXISTS(SELECT 1 FROM building_couriers bc WHERE bc.world=? AND bc.building_code=? AND bc.admin_id=target.id)
              AND NOT EXISTS(SELECT 1 FROM json_each(?) selected WHERE NOT EXISTS(
                SELECT 1 FROM delivery_orders o JOIN batch_items bi ON bi.order_id=o.id
                JOIN delivery_batches previous ON previous.id=bi.batch_id
                WHERE o.id=json_extract(selected.value,'$.id') AND bi.batch_id=json_extract(selected.value,'$.batchId')
                  AND o.version=json_extract(selected.value,'$.version') AND previous.id LIKE 'auto-%' AND previous.assignee_admin_id<>target.id
                  AND o.dorm_building_code=? AND coalesce(o.demo_group,'')=? AND o.status='WAITING_PICKUP'
                  AND o.custody_state<>'STAFF' AND o.student_deleted=0 AND o.student_cancelled=0
                  AND NOT EXISTS(SELECT 1 FROM parcel_handoffs h WHERE h.order_id=o.id AND h.status='PENDING')
              ))),?)`).bind(batchId, list[0].station, a.adminId, world, world, a.buildingCode,
                JSON.stringify(list.map(({ id, batchId: oldBatch, version }) => ({ id, batchId: oldBatch, version }))), a.buildingCode, world, admin.id),
          ...list.map(o => env.DB.prepare('DELETE FROM batch_items WHERE order_id=? AND batch_id=?').bind(o.id, o.batchId)),
          ...list.map((o, i) => env.DB.prepare('INSERT INTO batch_items(batch_id,order_id,sort_order) VALUES(?,?,?)').bind(batchId, o.id, i)),
          // Changing responsibility invalidates any old single-order screen as well as old batch actions.
          ...list.map(o => env.DB.prepare('UPDATE delivery_orders SET version=version+1,updated_at=unixepoch() WHERE id=?').bind(o.id)),
        ]);
        moved += list.length;
      } catch (error) {
        // The assignment is already saved. Report any group that could not be moved so it can be checked.
        skipped += list.length;
        if (!String(error).includes('NOT NULL constraint failed: delivery_batches.assignee_admin_id')) console.error('Dispatch transfer failed; an order group was skipped.');
      }
    }
  }
  return json({ ...(await dispatchOverview(env, admin.id, world, true)), moved, skipped });
}

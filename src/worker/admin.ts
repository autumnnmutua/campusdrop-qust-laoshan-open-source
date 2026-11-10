/* © 2026 专业团队 · CampusDrop v4.5.0 */
import type { z } from 'zod';
import { CAMPUS_ID, type Admin, type Building, createAdminSchema, type Scope, type AdminRole } from '../shared/contracts';
import { hashPassword } from '../domain/password';
import { ApiError } from './http';
import type { Env } from './types';
import { requireSuper } from './session';
export async function adminBuildings(env: Env, admin: Admin): Promise<Building[]> {
  if (admin.role === 'DELIVERY_STAFF') return []; // Delivery staff access assigned orders, never a whole building.
  const rows = await env.DB.prepare(`SELECT b.code, b.display_name AS displayName, b.zone FROM dorm_buildings b
    WHERE b.campus_id = ? AND b.active = 1 AND (? = 'SUPER_ADMIN' OR EXISTS (
      SELECT 1 FROM admin_scopes s WHERE s.admin_id = ? AND s.campus_id = b.campus_id
      AND (s.zone IS NULL OR s.zone = b.zone) AND (s.building_code IS NULL OR s.building_code = b.code)
      AND (? = 'ZONE_ADMIN' OR (? = 'BUILDING_ADMIN' AND s.building_code IS NOT NULL))
    )) ORDER BY b.zone DESC, b.sort_order`)
    .bind(CAMPUS_ID, admin.role, admin.id, admin.role, admin.role).all<Building>();
  return rows.results;
}
export async function createAdmin(env: Env, actor: Admin, data: z.infer<typeof createAdminSchema>): Promise<string> {
  requireSuper(actor);
  for (const scope of data.scopes) {
    if (!scope.buildingCode) continue;
    const building = await env.DB.prepare('SELECT zone FROM dorm_buildings WHERE code = ? AND campus_id = ? AND active = 1')
      .bind(scope.buildingCode, CAMPUS_ID).first<{ zone: string }>();
    if (!building || (scope.zone && building.zone !== scope.zone)) throw new ApiError(400, 'INVALID_SCOPE', '授权楼栋不存在、已停用或与区域不匹配');
  }
  const id = crypto.randomUUID();
  const passwordHash = await hashPassword(data.password);
  try {
    await env.DB.batch([
      env.DB.prepare('INSERT INTO admin_users(id, username, password_hash, role) VALUES (?, ?, ?, ?)')
        .bind(id, data.username, passwordHash, data.role),
      ...data.scopes.map(s => env.DB.prepare('INSERT INTO admin_scopes(id, admin_id, campus_id, zone, building_code) VALUES (?, ?, ?, ?, ?)')
        .bind(crypto.randomUUID(), id, CAMPUS_ID, s.zone, s.buildingCode)),
      env.DB.prepare(`INSERT INTO audit_logs(id, actor_type, actor_id, action, resource_id) VALUES (?, 'ADMIN', ?, 'ADMIN_CREATED', ?)`)
        .bind(crypto.randomUUID(), actor.id, id),
    ]);
  } catch (error) {
    if (String(error).includes('UNIQUE constraint')) throw new ApiError(409, 'ADMIN_CONFLICT', '用户名或授权范围重复');
    throw error;
  }
  return id;
}
export async function updateAdminScopes(env:Env,actor:Admin,id:string,role:AdminRole,scopes:Scope[]):Promise<void>{
  requireSuper(actor);
  const target=await env.DB.prepare('SELECT role FROM admin_users WHERE id=?').bind(id).first<{role:AdminRole}>();
  if(!target)throw new ApiError(404,'NOT_FOUND','管理员不存在');
  if(target.role==='SUPER_ADMIN')throw new ApiError(403,'SUPER_ADMIN_PROTECTED','超级管理员不通过此接口调整');
  const parsed=createAdminSchema.safeParse({username:'scope_check',password:'scope-validation-only',role,scopes});
  if(!parsed.success)throw new ApiError(400,'INVALID_SCOPE','角色与授权范围不匹配');
  for(const s of scopes){
    if(!s.buildingCode)continue;
    const found=await env.DB.prepare('SELECT zone FROM dorm_buildings WHERE code=? AND active=1 AND campus_id=?').bind(s.buildingCode,CAMPUS_ID).first<{zone:string}>();
    if(!found||(s.zone&&found.zone!==s.zone))throw new ApiError(400,'INVALID_SCOPE','授权楼栋与区域不匹配');
  }
  const auditId=crypto.randomUUID();
  try{
    // Evaluate the proposed role and scopes together with the update. An unfinished assigned task must stay visible
    // to its assignee; doing a separate read before this transaction would race with a new claim or assignment.
    const result=await env.DB.batch([
      env.DB.prepare(`UPDATE admin_users SET role=? WHERE id=? AND NOT EXISTS (
        SELECT 1 FROM (
          SELECT o.campus_id,o.zone,o.dorm_building_code FROM delivery_batches b
            JOIN batch_items bi ON bi.batch_id=b.id JOIN delivery_orders o ON o.id=bi.order_id
            WHERE b.assignee_admin_id=? AND o.status NOT IN ('CANCELLED','COMPLETED','DELIVERED_DOWNSTAIRS','DELIVERED_TO_ROOM')
          UNION ALL
          SELECT campus_id,zone,dorm_building_code FROM send_requests
            WHERE assignee_admin_id=? AND status IN ('WAITING_PICKUP','PICKED_UP')
        ) task WHERE ? NOT IN ('SUPER_ADMIN','DELIVERY_STAFF') AND NOT EXISTS (
          SELECT 1 FROM json_each(?) proposed
          WHERE json_extract(proposed.value,'$.campusId')=task.campus_id
            AND (json_extract(proposed.value,'$.zone') IS NULL OR json_extract(proposed.value,'$.zone')=task.zone)
            AND (json_extract(proposed.value,'$.buildingCode') IS NULL OR json_extract(proposed.value,'$.buildingCode')=task.dorm_building_code)
            AND (?='ZONE_ADMIN' OR json_extract(proposed.value,'$.buildingCode') IS NOT NULL)
        )
      )`).bind(role,id,id,id,role,JSON.stringify(scopes),role),
      env.DB.prepare("INSERT INTO audit_logs(id,actor_type,actor_id,action,resource_id) SELECT ?,'ADMIN',?,'ADMIN_SCOPE_CHANGED',? WHERE changes()>0").bind(auditId,actor.id,id),
      env.DB.prepare('DELETE FROM admin_scopes WHERE admin_id=? AND EXISTS(SELECT 1 FROM audit_logs WHERE id=?)').bind(id,auditId),
      ...scopes.map(s=>env.DB.prepare('INSERT INTO admin_scopes(id,admin_id,campus_id,zone,building_code) SELECT ?,?,?,?,? WHERE EXISTS(SELECT 1 FROM audit_logs WHERE id=?)')
        .bind(crypto.randomUUID(),id,CAMPUS_ID,s.zone,s.buildingCode,auditId)),
    ]);
    if(!result[0].meta.changes)throw new ApiError(409,'ADMIN_HAS_TASKS','新角色或授权范围无法处理已有任务，请先完成任务或保留相应权限');
  }catch(error){if(String(error).includes('UNIQUE constraint'))throw new ApiError(400,'INVALID_SCOPE','授权范围重复');throw error;}
}

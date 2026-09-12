import type { Env } from './types';
import { ApiError } from './http';
import { CAMPUS_ID,type Admin } from '../shared/contracts';
import { orderColumns,type OrderRow } from './orders';
export function orderScope(admin:Admin):{sql:string;params:string[]} {
  return {sql:`EXISTS(SELECT 1 FROM admin_users current_admin WHERE current_admin.id=? AND current_admin.status='ACTIVE' AND current_admin.role=?) AND o.campus_id=? AND (?='SUPER_ADMIN' OR
    (? IN ('ZONE_ADMIN','BUILDING_ADMIN') AND EXISTS(SELECT 1 FROM admin_scopes s WHERE s.admin_id=? AND s.campus_id=o.campus_id
      AND (s.zone IS NULL OR s.zone=o.zone) AND (s.building_code IS NULL OR s.building_code=o.dorm_building_code)
      AND (?='ZONE_ADMIN' OR s.building_code IS NOT NULL))) OR
    (?='DELIVERY_STAFF' AND EXISTS(SELECT 1 FROM batch_items bi JOIN delivery_batches b ON b.id=bi.batch_id WHERE bi.order_id=o.id AND b.assignee_admin_id=?)))`,
    params:[admin.id,admin.role,CAMPUS_ID,admin.role,admin.role,admin.id,admin.role,admin.role,admin.id]};
}
export async function adminOrder(env:Env,admin:Admin,id:string):Promise<OrderRow> {
  const scope=orderScope(admin);
  const row=await env.DB.prepare(`SELECT ${orderColumns} FROM delivery_orders o WHERE o.id=? AND EXISTS(SELECT 1 FROM payments p WHERE p.order_id=o.id AND p.type='DELIVERY') AND ${scope.sql}`)
    .bind(id,...scope.params).first<OrderRow>();
  if(!row) throw new ApiError(404,'NOT_FOUND','订单不存在或不在你的授权范围');
  return row;
}

import {cursorPage,cursorResult} from './pagination';
import {taskQuerySchema} from '../shared/delivery';
import { upgradePriceFen } from '../domain/commerce';
import { requireContact } from './admin-contact';
import type { Env } from './types';
import type { Admin } from '../shared/contracts';
import { CAMPUS_ID } from '../shared/contracts';
import type { AvailableOrder } from '../shared/delivery';
import { ApiError } from './http';
import { ownOrder,serializeOrder } from './orders';
import { orderScope } from './order-access';

function availableScope(admin:Admin){
  return admin.role==='DELIVERY_STAFF'
    ? {sql:"o.campus_id=? AND EXISTS(SELECT 1 FROM admin_users WHERE id=? AND role='DELIVERY_STAFF' AND status='ACTIVE')",params:[CAMPUS_ID,admin.id]}
    : orderScope(admin);
}
const available="o.status='WAITING_PICKUP' AND o.student_deleted=0 AND NOT EXISTS(SELECT 1 FROM batch_items WHERE order_id=o.id) AND EXISTS(SELECT 1 FROM payments WHERE order_id=o.id AND type='DELIVERY')";
export async function availableOrders(env:Env,admin:Admin,request:Request){
 const parsed=taskQuerySchema.safeParse(Object.fromEntries(new URL(request.url).searchParams));if(!parsed.success)throw new ApiError(400,'INVALID_FILTER','筛选条件不正确');
 const f=parsed.data,scope=availableScope(admin),key=JSON.stringify([admin.id,'market',f.building??'',f.packageSize??'',f.deliveryMode??'']);const {limit,cursor}=cursorPage(request,key);
 const where=[available,scope.sql],params:(string|number)[]=[...scope.params];
 for(const [v,col] of [[f.building,'o.dorm_building_code'],[f.packageSize,'o.package_size'],[f.deliveryMode,"CASE WHEN o.delivery_upgrade_fen>0 THEN 'ROOM' ELSE o.delivery_mode END"]])if(v){where.push(col+'=?');params.push(v);}
 if(cursor){where.push('(o.created_at>? OR (o.created_at=? AND o.id>?))');params.push(cursor.time,cursor.time,cursor.id);}
 const rows=(await env.DB.prepare(`SELECT o.id,o.created_at AS createdAt,json_extract(o.dorm_snapshot_json,'$.buildingName') AS buildingName,
 json_extract(o.station_snapshot_json,'$.canonicalName') AS stationName,o.package_size AS packageSize,
 CASE WHEN o.delivery_upgrade_fen>0 THEN 'ROOM' ELSE o.delivery_mode END AS deliveryMode,o.amount_fen+o.delivery_upgrade_fen+o.upgrade_surcharge_fen AS amountFen
 FROM delivery_orders o WHERE ${where.join(' AND ')} ORDER BY o.created_at,o.id LIMIT ?`).bind(...params,limit+1).all<AvailableOrder&{createdAt:number}>()).results;
 const result=cursorResult(rows,limit,key);return {orders:result.items,nextCursor:result.nextCursor,hasMore:result.hasMore,pageSize:limit};
}
export async function claimOrder(env:Env,admin:Admin,id:string){
  await requireContact(env,admin.id);
  const assigned=await env.DB.prepare('SELECT b.id,b.assignee_admin_id AS assignee FROM batch_items bi JOIN delivery_batches b ON b.id=bi.batch_id WHERE bi.order_id=?').bind(id).first<{id:string;assignee:string}>();
  if(assigned?.assignee===admin.id)return {batchId:assigned.id};
  const scope=availableScope(admin),batchId=crypto.randomUUID();
  // Both batch and item use conditional SQL. A concurrent claim hits the unique order_id constraint.
  try {
    const result=await env.DB.batch([
      env.DB.prepare(`INSERT INTO delivery_batches(id,station_code,assignee_admin_id,created_by)
        SELECT ?,o.station_code,?,? FROM delivery_orders o WHERE o.id=? AND ${available} AND ${scope.sql}`).bind(batchId,admin.id,admin.id,id,...scope.params),
      env.DB.prepare(`INSERT INTO batch_items(batch_id,order_id,sort_order) SELECT ?,?,0 WHERE EXISTS(SELECT 1 FROM delivery_batches WHERE id=?)`).bind(batchId,id,batchId),
      env.DB.prepare("INSERT INTO audit_logs(id,actor_type,actor_id,action,resource_id) SELECT ?,'ADMIN',?,'ORDER_CLAIMED',? WHERE EXISTS(SELECT 1 FROM delivery_batches WHERE id=?)").bind(crypto.randomUUID(),admin.id,id,batchId),
    ]);
    if(!result[0].meta.changes)throw new ApiError(409,'CLAIM_UNAVAILABLE','订单已被接走或状态已变化，请刷新待接订单');
  } catch(error){
    if(String(error).includes('UNIQUE constraint')||String(error).includes('BATCH_ORDER_INVALID'))throw new ApiError(409,'CLAIM_UNAVAILABLE','订单已被接走，请刷新待接订单');
    throw error;
  }
  return {batchId};
}
export async function updateOrderNote(env:Env,userId:string,id:string,note:string,version:number){
  await ownOrder(env,userId,id);
  const result=await env.DB.prepare("UPDATE delivery_orders SET order_note=?,version=version+1,updated_at=unixepoch(),last_actor_type='STUDENT',last_actor_id=? WHERE id=? AND user_id=? AND student_deleted=0 AND version=?")
    .bind(note,userId,id,userId,version).run();
  if(!result.meta.changes)throw new ApiError(409,'STALE_ORDER','订单已变化，请刷新后再修改备注');
  return serializeOrder(await ownOrder(env,userId,id));
}
export async function upgradeOrder(env:Env,userId:string,id:string,version:number){
  const row=await ownOrder(env,userId,id);
  if(row.upgradeFen>0)return serializeOrder(row);
  try {
    await env.DB.prepare(`INSERT INTO order_adjustments(id,order_id,kind,amount_fen)
      SELECT ?,o.id,'UPGRADE',CASE WHEN o.package_size='LARGE' THEN 200 ELSE 100 END FROM delivery_orders o WHERE o.id=? AND o.user_id=? AND o.version=? AND o.student_deleted=0
      AND o.delivery_mode='DOWNSTAIRS' AND o.delivery_upgrade_fen=0 AND o.status IN ('WAITING_PICKUP','PICKED_UP','OUT_FOR_DELIVERY')
      AND EXISTS(SELECT 1 FROM payments WHERE order_id=o.id AND type='DELIVERY') AND NOT EXISTS(SELECT 1 FROM order_adjustments WHERE order_id=o.id AND kind='UPGRADE')`)
      .bind(crypto.randomUUID(),id,userId,version).run();
  } catch(error){if(String(error).includes('UPGRADE_NOT_ALLOWED'))throw new ApiError(409,'UPGRADE_NOT_ALLOWED','订单已变化，无法升级配送');throw error;}
  const updated=await ownOrder(env,userId,id);
  if(updated.upgradeFen!==upgradePriceFen(row.packageSize))throw new ApiError(409,'UPGRADE_NOT_ALLOWED','请刷新订单；仅已支付且未送达的楼下配送可升级');
  return serializeOrder(updated);
}
export async function deleteStudentOrder(env:Env,userId:string,id:string,version:number){
  const existing=await ownOrder(env,userId,id,true);
  if(existing.status.startsWith('DELIVERED'))throw new ApiError(409,'STUDENT_RECEIPT_REQUIRED','请先确认收货，再隐藏订单');
  if(existing.custodyState==='STAFF')throw new ApiError(409,'HANDOFF_REQUIRED','包裹已取出，请先联系配送员完成归还交接，再取消退款');
  const removed=await env.DB.prepare('SELECT student_deleted AS deleted FROM delivery_orders WHERE id=? AND user_id=?').bind(id,userId).first<{deleted:number}>();
  if(!removed?.deleted){
    const result=await env.DB.prepare("UPDATE delivery_orders SET student_deleted=1,version=version+1,updated_at=unixepoch(),last_actor_type='STUDENT',last_actor_id=? WHERE id=? AND user_id=? AND version=? AND student_deleted=0")
      .bind(userId,id,userId,version).run();
    if(!result.meta.changes)throw new ApiError(409,'STALE_ORDER','订单已变化，请刷新后重新确认删除');
  }
  const refundFen=await env.DB.prepare("SELECT amount_fen FROM order_adjustments WHERE order_id=? AND kind='REFUND'").bind(id).first<number>('amount_fen')??0;
  return {deleted:true,refundFen,provider:'MOCK',message:refundFen?`订单已删除，已模拟退款 ${(refundFen/100).toFixed(2)} 元，未发生真实资金流转`:'订单已从列表移除，没有可退的配送费用'};
}

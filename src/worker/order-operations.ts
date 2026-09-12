import type { Env } from './types';
import type { Admin } from '../shared/contracts';
import { ApiError } from './http';
import { requireContact } from './admin-contact';
import { adminOrder,orderScope } from './order-access';
import { ownOrder,serializeOrder } from './orders';
import type { Handoff } from '../shared/delivery';

export async function releaseOrder(env:Env,admin:Admin,id:string,version:number,reason:string){
  await requireContact(env,admin.id);
  const row=await adminOrder(env,admin,id);
  if(row.version!==version||!['WAITING_PICKUP','FAILED_PICKUP','DELIVERY_EXCEPTION'].includes(row.status))throw new ApiError(409,'INVALID_TRANSITION','订单状态已变化，无法退回市场');
  if(row.custodyState==='STAFF'||row.pendingHandoff)throw new ApiError(409,'HANDOFF_REQUIRED','已取件包裹需先归还原站点，并由另一位有权限的管理员核验');
  const scope=orderScope(admin);
  const result=await env.DB.prepare(`INSERT INTO order_releases(id,order_id,order_version,admin_id,reason)
    SELECT ?,o.id,o.version,?,? FROM delivery_orders o WHERE o.id=? AND o.version=? AND o.student_deleted=0 AND o.student_cancelled=0 AND o.custody_state<>'STAFF' AND ${scope.sql}`)
    .bind(crypto.randomUUID(),admin.id,reason,id,version,...scope.params).run();
  if(!result.meta.changes)throw new ApiError(409,'STALE_ORDER','订单已更新，请刷新');
  return {id,status:'WAITING_PICKUP' as const,version:row.version+1,released:true};
}
export async function cancelStudentOrder(env:Env,userId:string,id:string,version:number){
  const row=await ownOrder(env,userId,id);
  if(row.status==='CANCELLED')return {order:serializeOrder(row),refund:await refundStatus(env,userId,id)};
  if(row.custodyState==='STAFF'||row.pendingHandoff)throw new ApiError(409,'HANDOFF_REQUIRED','包裹已取出，请先联系配送员归还原站点并完成交接核验');
  if(['DELIVERED_DOWNSTAIRS','DELIVERED_TO_ROOM','COMPLETED'].includes(row.status))throw new ApiError(409,'CANCEL_NOT_ALLOWED','已送达订单不能取消，可从列表隐藏或联系售后');
  const result=await env.DB.prepare("UPDATE delivery_orders SET student_cancelled=1,version=version+1,last_actor_type='STUDENT',last_actor_id=?,updated_at=unixepoch() WHERE id=? AND user_id=? AND version=? AND student_deleted=0 AND student_cancelled=0 AND custody_state<>'STAFF'")
    .bind(userId,id,userId,version).run();
  if(!result.meta.changes)throw new ApiError(409,'STALE_ORDER','订单已变化，请刷新并重新确认');
  return {order:serializeOrder(await ownOrder(env,userId,id)),refund:await refundStatus(env,userId,id)};
}
export async function refundStatus(env:Env,userId:string,id:string){
  await ownOrder(env,userId,id,true);
  const row=await env.DB.prepare("SELECT amount_fen AS amountFen,provider,status,created_at AS createdAt FROM order_adjustments WHERE order_id=? AND kind='REFUND'").bind(id).first();
  return row??{amountFen:0,provider:'MOCK',status:'NONE'};
}
export async function hideStudentOrder(env:Env,userId:string,id:string,version:number){
  const row=await ownOrder(env,userId,id,true);
  if(!['CANCELLED','COMPLETED'].includes(row.status))throw new ApiError(409,'HIDE_NOT_ALLOWED','请先确认收货或取消配送，再隐藏记录');
  const hidden=await env.DB.prepare('SELECT student_deleted AS hidden FROM delivery_orders WHERE id=?').bind(id).first<number>('hidden');
  if(hidden)return {hidden:true};
  const result=await env.DB.prepare("UPDATE delivery_orders SET student_deleted=1,version=version+1,last_actor_type='STUDENT',last_actor_id=? WHERE id=? AND user_id=? AND version=? AND status IN ('CANCELLED','COMPLETED')").bind(userId,id,userId,version).run();
  if(!result.meta.changes)throw new ApiError(409,'STALE_ORDER','订单已变化，请刷新');
  return {hidden:true};
}
export async function handoffs(env:Env,admin:Admin,id:string){
  await adminOrder(env,admin,id);
  return (await env.DB.prepare("SELECT id,requested_by AS requestedBy,station_code AS stationCode,location,note,CASE WHEN rejected=1 THEN 'REJECTED' ELSE status END AS status,rejection_reason AS rejectionReason,revision,confirmed_by AS confirmedBy,created_at AS createdAt FROM parcel_handoffs WHERE order_id=? ORDER BY created_at DESC,id").bind(id).all<Handoff>()).results;
}
export async function requestHandoff(env:Env,admin:Admin,id:string,version:number,location:string,note:string){
  await requireContact(env,admin.id);const row=await adminOrder(env,admin,id);
  if(row.version!==version||row.status!=='DELIVERY_EXCEPTION'||row.custodyState!=='STAFF'||row.pendingHandoff)throw new ApiError(409,'HANDOFF_INVALID','请先标记配送异常；交接申请只能提交一次');
  const scope=orderScope(admin),handoffId=crypto.randomUUID();
  const result=await env.DB.prepare(`INSERT INTO parcel_handoffs(id,order_id,requested_by,station_code,location,note)
    SELECT ?,o.id,?,o.station_code,?,? FROM delivery_orders o WHERE o.id=? AND o.version=? AND o.custody_state='STAFF' AND o.status='DELIVERY_EXCEPTION' AND ${scope.sql}`)
    .bind(handoffId,admin.id,location,note,id,version,...scope.params).run();
  if(!result.meta.changes)throw new ApiError(409,'STALE_ORDER','订单已变化，请刷新');
  return {handoffId};
}
export async function confirmHandoff(env:Env,admin:Admin,id:string,handoffId:string,version:number){
  await requireContact(env,admin.id);const row=await adminOrder(env,admin,id);
  if(admin.role==='DELIVERY_STAFF')throw new ApiError(403,'FORBIDDEN','需由有权限的区域、楼栋或超级管理员现场核验');
  const h=await env.DB.prepare("SELECT requested_by AS requestedBy,CASE WHEN rejected=1 THEN 'REJECTED' ELSE status END AS status FROM parcel_handoffs WHERE id=? AND order_id=?").bind(handoffId,id).first<{requestedBy:string;status:string}>();
  if(!h)throw new ApiError(404,'NOT_FOUND','交接记录不存在');
  if(h.requestedBy===admin.id)throw new ApiError(403,'SELF_CONFIRM','交接申请人不能核验自己的交接');
  if(h.status==='REJECTED')throw new ApiError(409,'HANDOFF_INVALID','已驳回的申请不可核验，请重新提交');
  if(h.status==='CONFIRMED')return {confirmed:true};
  if(row.version!==version)throw new ApiError(409,'STALE_ORDER','订单已变化，请刷新');
  const scope=orderScope(admin);
  const result=await env.DB.prepare(`UPDATE parcel_handoffs SET status='CONFIRMED',confirmed_by=?,confirmed_at=unixepoch() WHERE id=? AND order_id=? AND status='PENDING' AND rejected=0 AND requested_by<>? AND EXISTS(SELECT 1 FROM delivery_orders o WHERE o.id=? AND o.version=? AND o.custody_state='STAFF' AND o.status='DELIVERY_EXCEPTION' AND ${scope.sql})`)
    .bind(admin.id,handoffId,id,admin.id,id,version,...scope.params).run();
  if(!result.meta.changes)throw new ApiError(409,'STALE_ORDER','交接或授权已变化，请刷新');
  return {confirmed:true};
}
export async function reviseHandoff(env:Env,admin:Admin,id:string,handoffId:string,version:number,location:string,note:string){
 await requireContact(env,admin.id);const row=await adminOrder(env,admin,id);
 if(row.version!==version||row.custodyState!=='STAFF'||row.status!=='DELIVERY_EXCEPTION')throw new ApiError(409,'HANDOFF_INVALID','订单已变化，请刷新');
 const scope=orderScope(admin);
 const result=await env.DB.prepare(`UPDATE parcel_handoffs SET location=?,note=?,revision=revision+1 WHERE id=? AND order_id=? AND requested_by=? AND status='PENDING' AND rejected=0 AND EXISTS(SELECT 1 FROM delivery_orders o WHERE o.id=? AND o.version=? AND ${scope.sql})`).bind(location,note,handoffId,id,admin.id,id,version,...scope.params).run();
 if(!result.meta.changes)throw new ApiError(409,'HANDOFF_INVALID','只有申请人可修改待核验申请，请刷新');
 return {updated:true};
}
export async function rejectHandoff(env:Env,admin:Admin,id:string,handoffId:string,version:number,reason:string){
 await requireContact(env,admin.id);const row=await adminOrder(env,admin,id);
 if(admin.role==='DELIVERY_STAFF')throw new ApiError(403,'FORBIDDEN','无核验权限');
 if(row.version!==version||row.custodyState!=='STAFF')throw new ApiError(409,'HANDOFF_INVALID','订单已变化，请刷新');
 const scope=orderScope(admin);
 const result=await env.DB.prepare(`UPDATE parcel_handoffs SET rejected=1,rejection_reason=?,reviewed_by=?,revision=revision+1 WHERE id=? AND order_id=? AND requested_by<>? AND status='PENDING' AND rejected=0 AND EXISTS(SELECT 1 FROM delivery_orders o WHERE o.id=? AND o.version=? AND ${scope.sql})`).bind(reason,admin.id,handoffId,id,admin.id,id,version,...scope.params).run();
 if(!result.meta.changes)throw new ApiError(409,'HANDOFF_INVALID','不能驳回本人、已核验或已驳回的申请');
 return {rejected:true};
}

export async function handoffHistory(env:Env,admin:Admin,id:string){await adminOrder(env,admin,id);return (await env.DB.prepare('SELECT c.id,c.handoff_id AS handoffId,c.action,c.prior_location AS priorLocation,c.prior_note AS priorNote,c.reason,c.created_at AS createdAt FROM handoff_changes c JOIN parcel_handoffs h ON h.id=c.handoff_id WHERE h.order_id=? ORDER BY c.id DESC LIMIT 100').bind(id).all()).results;}

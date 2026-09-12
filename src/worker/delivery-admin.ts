import {cursorPage,cursorResult} from './pagination';
import { releaseOrder } from './order-operations';
import { requireContact } from './admin-contact';
import { z } from 'zod';
import type { Env } from './types';
import { ApiError } from './http';
import type { Admin } from '../shared/contracts';
import { adminOrder,orderScope } from './order-access';
import { nextStatuses } from '../domain/commerce';
import { taskQuerySchema, type OrderStatus, type transitionSchema } from '../shared/delivery';
import { orderColumns, serializeOrder, type OrderRow } from './orders';
export { adminOrder,orderScope } from './order-access';
export async function adminTasks(env:Env,admin:Admin,request:Request) {
  const parsed=taskQuerySchema.safeParse(Object.fromEntries(new URL(request.url).searchParams));
  if(!parsed.success) throw new ApiError(400,'INVALID_FILTER','筛选条件不正确');
  const filters=parsed.data,scope=orderScope(admin);
  const where=[scope.sql,"EXISTS(SELECT 1 FROM payments p WHERE p.order_id=o.id AND p.type='DELIVERY')"];const params:(string|number)[]=[...scope.params];
  for(const [key,column] of [['status','o.status'],['building','o.dorm_building_code'],['packageSize','o.package_size'],['deliveryMode',"CASE WHEN o.delivery_upgrade_fen=100 THEN 'ROOM' ELSE o.delivery_mode END"]] as const){
    if(filters[key]){where.push(`${column}=?`);params.push(filters[key]);}
  }
  if(filters.group&&filters.group!=='ALL'){
    if(filters.status)throw new ApiError(400,'INVALID_FILTER','订单分类与具体状态请择一筛选');
    const groups:Record<string,string>={ACTIVE:"o.status NOT IN ('WAITING_PAYMENT','DELIVERED_DOWNSTAIRS','DELIVERED_TO_ROOM','COMPLETED','CANCELLED')",AWAITING_RECEIPT:"o.status IN ('DELIVERED_DOWNSTAIRS','DELIVERED_TO_ROOM')",CLOSED:"o.status IN ('COMPLETED','CANCELLED')"};
    where.push(groups[filters.group]);
  }
  const key=JSON.stringify([admin.id,'tasks',filters.group??'ALL',filters.status??'',filters.building??'',filters.packageSize??'',filters.deliveryMode??'']),{limit,cursor}=cursorPage(request,key);
  if(!cursor&&filters.page>100)throw new ApiError(400,'CURSOR_REQUIRED','深页查询请使用游标');
  if(cursor){where.push('(o.created_at<? OR (o.created_at=? AND o.id<?))');params.push(cursor.time,cursor.time,cursor.id);}
  const rows=await env.DB.prepare(`SELECT ${orderColumns} FROM delivery_orders o WHERE ${where.join(' AND ')} ORDER BY o.created_at DESC,o.id DESC LIMIT ? OFFSET ?`)
    .bind(...params,limit+1,cursor?0:(filters.page-1)*limit).all<OrderRow>();
  const result=cursorResult(rows.results,limit,key);return {orders:result.items.map(serializeOrder),page:filters.page,nextCursor:result.nextCursor,hasMore:result.hasMore};
}
export async function dashboard(env:Env,admin:Admin) {
  const scope=orderScope(admin);
  const counts=await env.DB.prepare(`SELECT status,count(*) AS count FROM delivery_orders o WHERE ${scope.sql} GROUP BY status`).bind(...scope.params).all();
  return {counts:counts.results};
}
export function transitionStatement(env:Env,admin:Admin,row:OrderRow,data:z.infer<typeof transitionSchema>):D1PreparedStatement {
  if(row.version!==data.version||!nextStatuses(row.status,row.deliveryMode).includes(data.status)) throw new ApiError(409,'INVALID_TRANSITION','订单状态已变化，或不允许此操作');
  if(row.pendingHandoff||(row.custodyState==='RETURNED'&&row.status!=='WAITING_PICKUP'))throw new ApiError(409,'HANDOFF_PENDING','包裹交接处理中或已归还，请完成核验并退回市场');
  const exception=['FAILED_PICKUP','DELIVERY_EXCEPTION'].includes(data.status);
  if(exception&&!data.exceptionCode) throw new ApiError(400,'EXCEPTION_REASON_REQUIRED','请选择异常原因');
  const scope=orderScope(admin);
  // RETURNING is checked by the caller. Audit + parcel closure use DB triggers.
  return env.DB.prepare(`UPDATE delivery_orders AS o SET status=?,version=version+1,updated_at=unixepoch(),last_actor_type='ADMIN',last_actor_id=?,exception_code=?,exception_note=?,service_notice=''
    WHERE id=? AND version=? AND ${scope.sql} RETURNING id`)
    .bind(data.status,admin.id,exception?data.exceptionCode!:null,exception?(data.exceptionNote??''):'',row.id,data.version,...scope.params);
}
export async function changeStatus(env:Env,admin:Admin,id:string,data:z.infer<typeof transitionSchema>) {
  await requireContact(env,admin.id);
  const row=await adminOrder(env,admin,id);
  if(data.status==='COMPLETED')throw new ApiError(409,'STUDENT_RECEIPT_REQUIRED','请等待学生确认收货');
  if(data.status==='CANCELLED')return releaseOrder(env,admin,id,data.version,data.exceptionNote||'配送员取消接单');
  const result=await transitionStatement(env,admin,row,data).all();
  if(!result.results.length) throw new ApiError(409,'STALE_ORDER','订单已更新，请刷新后重试');
  return serializeOrder(await adminOrder(env,admin,id));
}
export async function pickupCode(env:Env,admin:Admin,id:string,action:'VIEW'|'COPY') {
  const row=await adminOrder(env,admin,id);
  if(['CANCELLED','COMPLETED'].includes(row.status)) throw new ApiError(403,'CODE_HIDDEN','已结束任务不再展示取件码');
  const scope=orderScope(admin);
  const from=`FROM delivery_orders o JOIN parcels p ON p.id=o.parcel_id WHERE o.id=? AND o.status NOT IN ('COMPLETED','CANCELLED') AND ${scope.sql}`;
  // One D1 transaction: current authorization, code read and audit cannot drift apart.
  const [read]=await env.DB.batch<{pickupCode:string}>([
    env.DB.prepare(`SELECT p.pickup_code AS pickupCode ${from}`).bind(id,...scope.params),
    env.DB.prepare(`INSERT INTO audit_logs(id,actor_type,actor_id,action,resource_id,metadata_redacted)
      SELECT ?,'ADMIN',?,?,o.id,json_object('masked','***-*-'||substr(p.pickup_code,-4)) ${from}`)
      .bind(crypto.randomUUID(),admin.id,`PICKUP_CODE_${action}`,id,...scope.params),
  ]);
  if(!read.results.length)throw new ApiError(404,'NOT_FOUND','订单不存在或不在你的授权范围');
  return read.results[0];
}
export async function createBatch(env:Env,admin:Admin,ids:string[],assigneeId:string) {
  if(admin.role==='DELIVERY_STAFF') throw new ApiError(403,'FORBIDDEN','配送人员不能自行分配任务');
  await requireContact(env,admin.id);
  await requireContact(env,assigneeId);
  const rows:OrderRow[]=[];
  for(const id of ids) rows.push(await adminOrder(env,admin,id));
  if(rows.some(r=>r.status!=='WAITING_PICKUP')) throw new ApiError(409,'BATCH_ORDER_INVALID','仅待取件订单可加入批次');
  if(new Set(rows.map(r=>JSON.parse(r.stationJson).code)).size!==1) throw new ApiError(400,'MIXED_STATIONS','一个批次只能包含同一站点');
  const assignee=await env.DB.prepare("SELECT id,username,role FROM admin_users WHERE id=? AND status='ACTIVE'").bind(assigneeId).first<Omit<Admin,'scopes'>>();
  if(!assignee) throw new ApiError(400,'INVALID_ASSIGNEE','配送负责人不存在或已停用');
  if(assignee.role!=='DELIVERY_STAFF') for(const row of rows) await adminOrder(env,{...assignee,scopes:[]},row.id);
  rows.sort((a,b)=>{
    const da=JSON.parse(a.dormJson),db=JSON.parse(b.dormJson);
    return da.zone.localeCompare(db.zone)||da.buildingCode.localeCompare(db.buildingCode)||a.createdAt-b.createdAt||a.id.localeCompare(b.id);
  });
  const id=crypto.randomUUID();
  const creatorScope=orderScope(admin),assigneeScope=orderScope({...assignee,scopes:[]});
  const grant=assignee.role==='DELIVERY_STAFF'
    ? {sql:"EXISTS(SELECT 1 FROM admin_users recipient WHERE recipient.id=? AND recipient.role='DELIVERY_STAFF' AND recipient.status='ACTIVE')",params:[assigneeId]}
    : assigneeScope;
  try {
    await env.DB.batch([
      env.DB.prepare('INSERT INTO delivery_batches(id,station_code,assignee_admin_id,created_by) VALUES(?,?,?,?)').bind(id,JSON.parse(rows[0].stationJson).code,assigneeId,admin.id),
      // A revoked grant produces NULL, so the existing item guard aborts the whole batch.
      ...rows.map((row,i)=>env.DB.prepare(`INSERT INTO batch_items(batch_id,order_id,sort_order)
        VALUES(?,(SELECT o.id FROM delivery_orders o WHERE o.id=? AND ${creatorScope.sql} AND ${grant.sql}),?)`)
        .bind(id,row.id,...creatorScope.params,...grant.params,i)),
      env.DB.prepare("INSERT INTO audit_logs(id,actor_type,actor_id,action,resource_id) VALUES(?,'ADMIN',?,'BATCH_CREATED',?)").bind(crypto.randomUUID(),admin.id,id),
    ]);
  }catch(error){
    if(String(error).includes('UNIQUE constraint')) throw new ApiError(409,'ORDER_ALREADY_BATCHED','部分订单已经分配到批次，请刷新');
    if(String(error).includes('BATCH_ORDER_INVALID')) throw new ApiError(409,'BATCH_ORDER_INVALID','订单或负责人状态已变化，请刷新');
    throw error;
  }
  return {id};
}
export async function listBatches(env:Env,admin:Admin) {
  const scope=orderScope(admin);
  return (await env.DB.prepare(`SELECT b.id,b.station_code AS stationCode,b.assignee_admin_id AS assigneeAdminId,a.username AS assigneeName,b.created_at AS createdAt,
    count(*) AS orderCount FROM delivery_batches b JOIN admin_users a ON a.id=b.assignee_admin_id
    JOIN batch_items bi ON bi.batch_id=b.id JOIN delivery_orders o ON o.id=bi.order_id
    WHERE ${scope.sql} GROUP BY b.id ORDER BY b.created_at DESC,b.id LIMIT 100`).bind(...scope.params).all()).results;
}
export async function batchOrders(env:Env,admin:Admin,id:string):Promise<OrderRow[]> {
  const scope=orderScope(admin);
  const rows=await env.DB.prepare(`SELECT ${orderColumns} FROM delivery_orders o JOIN batch_items bi ON bi.order_id=o.id WHERE bi.batch_id=? AND ${scope.sql} ORDER BY bi.sort_order`)
    .bind(id,...scope.params).all<OrderRow>();
  if(!rows.results.length) throw new ApiError(404,'NOT_FOUND','批次不存在或不在授权范围');
  return rows.results;
}
export async function batchTransition(env:Env,admin:Admin,id:string,status:OrderStatus,versions:Record<string,number>,exceptionCode?:'CODE_INVALID'|'SIZE_MISMATCH'|'UNREACHABLE'|'OTHER',exceptionNote?:string) {
  const rows=await batchOrders(env,admin,id);
  if(Object.keys(versions).length!==rows.length||rows.some(r=>versions[r.id]===undefined)) throw new ApiError(400,'INVALID_BATCH_VERSIONS','请刷新当前批次后操作');
  // Partial success is explicit and each individual transition is atomic + version guarded.
  const results: {id:string;ok:boolean;code?:string}[]=[];
  for(const row of rows){
    try{await changeStatus(env,admin,row.id,{status,version:versions[row.id],exceptionCode,exceptionNote});results.push({id:row.id,ok:true});}
    catch(error){if(!(error instanceof ApiError)) throw error;results.push({id:row.id,ok:false,code:error.code});}
  }
  return {results};
}
export async function bulkPickup(env:Env,admin:Admin,ids:string[]){
 const scope=orderScope(admin),marks=ids.map(()=>'?').join(',');
 const authorized=`SELECT o.id,p.pickup_code AS pickupCode,json_extract(o.dorm_snapshot_json,'$.buildingName') AS buildingName,json_extract(o.dorm_snapshot_json,'$.roomNo') AS roomNo,json_extract(o.dorm_snapshot_json,'$.phone') AS phone,json_extract(o.station_snapshot_json,'$.canonicalName') AS stationName,o.order_note AS note,o.status FROM delivery_orders o JOIN parcels p ON p.id=o.parcel_id WHERE o.id IN (${marks}) AND o.status NOT IN ('COMPLETED','CANCELLED') AND o.student_deleted=0 AND EXISTS(SELECT 1 FROM payments WHERE order_id=o.id AND type='DELIVERY') AND ${scope.sql}`;
 const params=[...ids,...scope.params],count=ids.length;
 const result=await env.DB.batch([
  env.DB.prepare(`WITH allowed AS (${authorized}) SELECT * FROM allowed WHERE (SELECT count(*) FROM allowed)=? ORDER BY buildingName,roomNo,id`).bind(...params,count),
  env.DB.prepare(`WITH allowed AS (${authorized}) INSERT INTO audit_logs(id,actor_type,actor_id,action,resource_id,metadata_redacted) SELECT lower(hex(randomblob(16))),'ADMIN',?,'BULK_PICKUP_CODE_VIEW',id,json_object('masked','***-*-'||substr(pickupCode,-4)) FROM allowed WHERE (SELECT count(*) FROM allowed)=?`).bind(...params,admin.id,count)
 ]);
 if(result[0].results.length!==count)throw new ApiError(404,'NOT_FOUND','部分订单已结束或不在授权范围，请刷新并重新选择');
 return {items:result[0].results,expiresIn:30};
}

import type { Env } from './types';
import { ApiError } from './http';
import { CAMPUS_ID, type Student } from '../shared/contracts';
import type { DeliveryMode, Order, OrderEvent, Payment, Station, DormSnapshot } from '../shared/delivery';
import { priceFen } from '../domain/commerce';
import { ownParcel } from './parcels';
import { readAddress } from './addresses';
export interface OrderRow extends Omit<Order,'dormSnapshot'|'stationSnapshot'> {
  returnsJson:string;userId:string; dormJson:string; stationJson:string;
}
export const orderColumns=`EXISTS(SELECT 1 FROM batch_items WHERE order_id=o.id) AS hasAssignee,o.received_at AS receivedAt,(SELECT count(*) FROM order_releases WHERE order_id=o.id) AS returnCount,(SELECT json_group_array(json_object('version',r.order_version,'reason',r.reason,'createdAt',r.created_at,'adminName',COALESCE(a.username,'已移除管理员'))) FROM (SELECT * FROM order_releases WHERE order_id=o.id ORDER BY order_version) r LEFT JOIN admin_users a ON a.id=r.admin_id) AS returnsJson,o.custody_state AS custodyState,CASE WHEN o.package_size='LARGE' THEN 200 ELSE 100 END AS upgradeQuoteFen,(SELECT id FROM parcel_handoffs WHERE order_id=o.id AND status='PENDING' AND rejected=0) AS pendingHandoff,o.id,o.parcel_id AS parcelId,o.user_id AS userId,o.package_size AS packageSize,CASE WHEN o.delivery_upgrade_fen=100 THEN 'ROOM' ELSE o.delivery_mode END AS deliveryMode,
  o.amount_fen+o.delivery_upgrade_fen+o.upgrade_surcharge_fen AS amountFen,o.delivery_upgrade_fen+o.upgrade_surcharge_fen AS upgradeFen,o.order_note AS note,CASE WHEN o.status IN ('DELIVERED_DOWNSTAIRS','DELIVERED_TO_ROOM','COMPLETED') THEN 0 ELSE COALESCE((SELECT amount_fen FROM payments WHERE order_id=o.id AND type='DELIVERY'),0)+o.delivery_upgrade_fen+o.upgrade_surcharge_fen-COALESCE((SELECT amount_fen FROM order_adjustments WHERE order_id=o.id AND kind='REFUND'),0) END AS refundableFen,o.status,o.version,o.created_at AS createdAt,o.dorm_snapshot_json AS dormJson,o.station_snapshot_json AS stationJson,o.exception_code AS exceptionCode,o.exception_note AS exceptionNote,o.service_notice AS serviceNotice,
  (SELECT a.phone FROM batch_items bi JOIN delivery_batches b ON b.id=bi.batch_id JOIN admin_users a ON a.id=b.assignee_admin_id WHERE bi.order_id=o.id AND a.status='ACTIVE') AS assigneePhone`;
export function serializeOrder(row:OrderRow):Order {
  const {returnsJson,userId:_userId,dormJson,stationJson,...order}=row;
  void _userId;
  return {...order,hasAssignee:Boolean(order.hasAssignee),returnHistory:(JSON.parse(returnsJson||'[]') as {version:number;reason:string;createdAt:number;adminName:string}[]).sort((a,b)=>a.version-b.version),dormSnapshot:JSON.parse(dormJson) as DormSnapshot,stationSnapshot:JSON.parse(stationJson) as Station};
}
export async function ownOrder(env:Env,userId:string,id:string,includeDeleted=false):Promise<OrderRow> {
  const row=await env.DB.prepare(`SELECT ${orderColumns} FROM delivery_orders o WHERE o.id=? AND o.user_id=? AND (?=1 OR o.student_deleted=0)`).bind(id,userId,includeDeleted?1:0).first<OrderRow>();
  if(!row) throw new ApiError(404,'NOT_FOUND','订单不存在');
  return row;
}
export async function orderDetails(env:Env,row:OrderRow) {
  const [events,payments]=await Promise.all([
    env.DB.prepare('SELECT id,from_status AS fromStatus,to_status AS toStatus,created_at AS createdAt,detail FROM order_events WHERE order_id=? ORDER BY id').bind(row.id).all<OrderEvent>(),
    env.DB.prepare('SELECT id,type,provider,amount_fen AS amountFen,status,created_at AS createdAt FROM payments WHERE order_id=? UNION ALL SELECT id,kind AS type,provider,amount_fen AS amountFen,status,created_at AS createdAt FROM order_adjustments WHERE order_id=? ORDER BY createdAt,id').bind(row.id,row.id).all<Payment>(),
  ]);
  return {order:serializeOrder(row),events:events.results,payments:payments.results};
}
export async function createOrder(env:Env,user:Student,parcelId:string,mode:DeliveryMode):Promise<Order> {
  const parcel=await ownParcel(env,user.id,parcelId);
  if(parcel.status!=='ACTIVE') throw new ApiError(409,'PARCEL_CLOSED','包裹已经结束');
  const address=await readAddress(env,user.id);
  if(!address) throw new ApiError(400,'ADDRESS_REQUIRED','请先填写寝室资料');
  const active=await env.DB.prepare('SELECT code FROM dorm_buildings WHERE code=? AND active=1').bind(address.buildingCode).first();
  const station=await env.DB.prepare('SELECT code,canonical_name AS canonicalName,relative_location AS relativeLocation,lat,lng FROM stations WHERE code=? AND active=1').bind(parcel.stationCode).first<Station>();
  if(!active||!station) throw new ApiError(409,'LOCATION_INACTIVE','宿舍楼或站点已停用，请更新资料');
  const id=crypto.randomUUID(), amount=priceFen(parcel.packageSize,mode);
  try {
    const result=await env.DB.prepare(`INSERT INTO delivery_orders(id,parcel_id,user_id,campus_id,zone,dorm_building_code,station_code,package_size,delivery_mode,amount_fen,
      price_snapshot_json,dorm_snapshot_json,station_snapshot_json,last_actor_type,last_actor_id,order_note)
      SELECT ?,?,?,?,?,?,?,?,?,?,?,?,?,'STUDENT',?,? WHERE EXISTS(SELECT 1 FROM parcels WHERE id=? AND user_id=? AND status='ACTIVE')`)
      .bind(id,parcelId,user.id,CAMPUS_ID,address.zone,address.buildingCode,parcel.stationCode,parcel.packageSize,mode,amount,
        JSON.stringify({version:1,packageSize:parcel.packageSize,deliveryMode:mode,amountFen:amount}),
        JSON.stringify({...address,name:user.name,phone:user.phone}),JSON.stringify(station),user.id,parcel.note,parcelId,user.id).run();
    if(!result.meta.changes) throw new ApiError(409,'PARCEL_CLOSED','包裹状态已更新，请刷新');
  }catch(error){
    if(String(error).includes('UNIQUE constraint')) throw new ApiError(409,'ORDER_EXISTS','这个包裹已有订单，请前往我的订单继续');
    throw error;
  }
  return serializeOrder(await ownOrder(env,user.id,id));
}
export class MockPaymentProvider {
  async pay(env:Env,userId:string,orderId:string):Promise<Order> {
    const row=await ownOrder(env,userId,orderId);
    const existing=await env.DB.prepare("SELECT id FROM payments WHERE order_id=? AND type='DELIVERY'").bind(orderId).first();
    if(existing) return serializeOrder(row);
    if(row.status!=='WAITING_PAYMENT') throw new ApiError(409,'PAYMENT_NOT_ALLOWED','当前订单不能支付');
    // Conditional INSERT + trigger keep payment record and order transition atomic in D1.
    await env.DB.prepare(`INSERT INTO payments(id,order_id,type,provider,amount_fen,status,idempotency_key)
      SELECT ?,id,'DELIVERY','MOCK',amount_fen,'SUCCEEDED','delivery' FROM delivery_orders
      WHERE id=? AND user_id=? AND status='WAITING_PAYMENT'
      AND NOT EXISTS(SELECT 1 FROM payments WHERE order_id=? AND type='DELIVERY')`)
      .bind(crypto.randomUUID(),orderId,userId,orderId).run();
    const paid=await env.DB.prepare("SELECT id FROM payments WHERE order_id=? AND type='DELIVERY'").bind(orderId).first();
    if(!paid) throw new ApiError(409,'PAYMENT_NOT_ALLOWED','订单已变化，请刷新');
    return serializeOrder(await ownOrder(env,userId,orderId));
  }
  async tip(env:Env,userId:string,orderId:string,amountFen:number,key:string):Promise<Payment> {
    const row=await ownOrder(env,userId,orderId);
    if(row.status!=='COMPLETED') throw new ApiError(409,'ORDER_NOT_COMPLETED','配送完成后才能打赏');
    await env.DB.prepare(`INSERT INTO payments(id,order_id,type,provider,amount_fen,status,idempotency_key)
      SELECT ?,?,'TIP','MOCK',?,'SUCCEEDED',? WHERE NOT EXISTS(SELECT 1 FROM payments WHERE order_id=? AND type='TIP' AND idempotency_key=?)`)
      .bind(crypto.randomUUID(),orderId,amountFen,key,orderId,key).run();
    const payment=await env.DB.prepare("SELECT id,type,provider,amount_fen AS amountFen,status,created_at AS createdAt FROM payments WHERE order_id=? AND type='TIP' AND idempotency_key=?")
      .bind(orderId,key).first<Payment>();
    if(!payment||payment.amountFen!==amountFen) throw new ApiError(409,'IDEMPOTENCY_CONFLICT','本次打赏已提交，请勿改变金额重复发送');
    return payment;
  }
}

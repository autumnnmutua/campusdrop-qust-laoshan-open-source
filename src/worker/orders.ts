import type { Env } from './types';
import { ApiError } from './http';
import { CAMPUS_ID, type Student } from '../shared/contracts';
import type { DeliveryMode, Order, OrderEvent, Payment, Station, DormSnapshot, PackageSize } from '../shared/delivery';
import { priceFen } from '../domain/commerce';
import { ownParcel } from './parcels';
import { readAddress } from './addresses';
import { slotLabel, slotOpen, type SlotCode } from '../shared/slots';
import { DROP_PLACE_LABELS, type DropPlace } from '../shared/campus-map';
import { SLOT_HOLDING, capacityFor, notifyGroupLater, requireOrderingOpen } from './settings';

/** Four random digits from the CSPRNG; shown to the student, entered by the courier at the door. */
const handoffCode = () => String(crypto.getRandomValues(new Uint32Array(1))[0] % 10000).padStart(4, '0');
export interface OrderRow extends Omit<Order,'dormSnapshot'|'stationSnapshot'> {
  returnsJson:string;userId:string; dormJson:string; stationJson:string;
}
export const orderColumns=`o.group_id AS groupId,(SELECT count(*) FROM delivery_orders g WHERE o.group_id IS NOT NULL AND g.group_id=o.group_id AND g.status<>'CANCELLED') AS groupSize,o.rule_id AS ruleId,o.drop_place AS dropPlace,o.proxy_name AS proxyName,o.near_notified_at AS nearNotifiedAt,EXISTS(SELECT 1 FROM delivery_photos ph WHERE ph.order_id=o.id) AS hasPhoto,o.slot_date AS slotDate,o.slot_code AS slotCode,o.handoff_verified_at AS handoffVerifiedAt,(SELECT count(*) FROM order_messages m WHERE m.order_id=o.id AND m.sender_kind='ADMIN' AND m.read_at IS NULL) AS chatUnreadStudent,(SELECT count(*) FROM order_messages m WHERE m.order_id=o.id AND m.sender_kind='STUDENT' AND m.read_at IS NULL) AS chatUnreadCourier,EXISTS(SELECT 1 FROM batch_items WHERE order_id=o.id) AS hasAssignee,o.received_at AS receivedAt,(SELECT count(*) FROM order_releases WHERE order_id=o.id) AS returnCount,(SELECT json_group_array(json_object('version',r.order_version,'reason',r.reason,'createdAt',r.created_at,'adminName',COALESCE(a.username,'已移除管理员'))) FROM (SELECT * FROM order_releases WHERE order_id=o.id ORDER BY order_version) r LEFT JOIN admin_users a ON a.id=r.admin_id) AS returnsJson,o.custody_state AS custodyState,CASE WHEN o.package_size='LARGE' THEN 200 ELSE 100 END AS upgradeQuoteFen,(SELECT id FROM parcel_handoffs WHERE order_id=o.id AND status='PENDING' AND rejected=0) AS pendingHandoff,o.id,o.parcel_id AS parcelId,o.user_id AS userId,o.package_size AS packageSize,CASE WHEN o.delivery_upgrade_fen=100 THEN 'ROOM' ELSE o.delivery_mode END AS deliveryMode,
  o.amount_fen+o.delivery_upgrade_fen+o.upgrade_surcharge_fen AS amountFen,o.delivery_upgrade_fen+o.upgrade_surcharge_fen AS upgradeFen,o.order_note AS note,CASE WHEN o.status IN ('DELIVERED_DOWNSTAIRS','DELIVERED_TO_ROOM','COMPLETED') THEN 0 ELSE COALESCE((SELECT amount_fen FROM payments WHERE order_id=o.id AND type='DELIVERY'),0)+o.delivery_upgrade_fen+o.upgrade_surcharge_fen-COALESCE((SELECT amount_fen FROM order_adjustments WHERE order_id=o.id AND kind='REFUND'),0) END AS refundableFen,o.status,o.version,o.created_at AS createdAt,o.dorm_snapshot_json AS dormJson,o.station_snapshot_json AS stationJson,o.exception_code AS exceptionCode,o.exception_note AS exceptionNote,o.service_notice AS serviceNotice,
  (SELECT a.phone FROM batch_items bi JOIN delivery_batches b ON b.id=bi.batch_id JOIN admin_users a ON a.id=b.assignee_admin_id WHERE bi.order_id=o.id AND a.status='ACTIVE') AS assigneePhone`;
export function serializeOrder(row:OrderRow):Order {
  const {returnsJson,userId:_userId,dormJson,stationJson,...order}=row;
  void _userId;
  return {...order,hasAssignee:Boolean(order.hasAssignee),hasPhoto:Boolean(order.hasPhoto),returnHistory:(JSON.parse(returnsJson||'[]') as {version:number;reason:string;createdAt:number;adminName:string}[]).sort((a,b)=>a.version-b.version),dormSnapshot:JSON.parse(dormJson) as DormSnapshot,stationSnapshot:JSON.parse(stationJson) as Station};
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
/** Paid orders already holding a place in a booked window. */
export async function windowLoad(env:Env,date:string,code:SlotCode):Promise<number>{
  return await env.DB.prepare(`SELECT count(*) AS n FROM delivery_orders WHERE slot_date=? AND slot_code=? AND ${SLOT_HOLDING}`).bind(date,code).first<number>('n')??0;
}
export interface OrderPlan { user: Student; parcel: { id: string; stationCode: string; packageSize: PackageSize; note: string }; address: NonNullable<Awaited<ReturnType<typeof readAddress>>>; station: Station; mode: DeliveryMode; slot?: { date: string; code: SlotCode }; dropPlace?: DropPlace; capacity: number; code: string; groupId?: string; ruleId?: string }
/** The conditional INSERT shared by single, merged and rule-created orders (the parcel must still be active; a booked window must still have room). */
export function orderInsert(env: Env, id: string, p: OrderPlan): D1PreparedStatement {
  const amount = priceFen(p.parcel.packageSize, p.mode);
  return env.DB.prepare(`INSERT INTO delivery_orders(id,parcel_id,user_id,campus_id,zone,dorm_building_code,station_code,package_size,delivery_mode,amount_fen,
      price_snapshot_json,dorm_snapshot_json,station_snapshot_json,last_actor_type,last_actor_id,order_note,handoff_code,slot_date,slot_code,drop_place,group_id,rule_id)
      SELECT ?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM parcels WHERE id=? AND user_id=? AND status='ACTIVE')
      AND (? IS NULL OR (SELECT count(*) FROM delivery_orders WHERE slot_date=? AND slot_code=? AND ${SLOT_HOLDING})<?)`)
    .bind(id, p.parcel.id, p.user.id, CAMPUS_ID, p.address.zone, p.address.buildingCode, p.parcel.stationCode, p.parcel.packageSize, p.mode, amount,
      JSON.stringify({ version: 1, packageSize: p.parcel.packageSize, deliveryMode: p.mode, amountFen: amount }),
      JSON.stringify({ ...p.address, name: p.user.name, phone: p.user.phone }), JSON.stringify(p.station), p.ruleId ? 'SYSTEM' : 'STUDENT', p.ruleId ? 'system' : p.user.id,
      p.parcel.note, p.code, p.slot?.date ?? null, p.slot?.code ?? null, p.dropPlace ?? null, p.groupId ?? null, p.ruleId ?? null, p.parcel.id, p.user.id,
      p.slot?.date ?? null, p.slot?.date ?? null, p.slot?.code ?? null, p.capacity);
}
/** Checks shared by every way of creating an order; returns what the INSERT needs (except the parcel). */
export async function orderPrerequisites(env: Env, user: Student, mode: DeliveryMode, slot?: { date: string; code: SlotCode }, dropPlace?: DropPlace) {
  await requireOrderingOpen(env);
  if (dropPlace && mode !== 'DOWNSTAIRS') throw new ApiError(400, 'DROP_PLACE_MODE', '送到约定地点按楼下配送计价，请选择楼下配送');
  const t = Math.floor(Date.now() / 1000);
  if (slot && !slotOpen(slot.date, slot.code, t)) throw new ApiError(409, 'SLOT_CLOSED', '该时段已停止预约，请选择其他时段');
  const capacity = slot ? await capacityFor(env, slot.date, slot.code) : 0;
  if (slot && capacity <= 0) throw new ApiError(409, 'SLOT_FULL', '这个时段暂无配送员排班，请换一个时段，或选择尽快送达');
  const address = await readAddress(env, user.id);
  if (!address) throw new ApiError(400, 'ADDRESS_REQUIRED', '请先填写寝室资料');
  const active = await env.DB.prepare('SELECT code FROM dorm_buildings WHERE code=? AND active=1').bind(address.buildingCode).first();
  if (!active) throw new ApiError(409, 'LOCATION_INACTIVE', '宿舍楼或站点已停用，请更新资料');
  return { address, capacity };
}
export async function activeStation(env: Env, code: string): Promise<Station> {
  const station = await env.DB.prepare('SELECT code,canonical_name AS canonicalName,relative_location AS relativeLocation,lat,lng FROM stations WHERE code=? AND active=1').bind(code).first<Station>();
  if (!station) throw new ApiError(409, 'LOCATION_INACTIVE', '宿舍楼或站点已停用，请更新资料');
  return station;
}
export const newHandoffCode = handoffCode;
export async function createOrder(env:Env,user:Student,parcelId:string,mode:DeliveryMode,slot?:{date:string;code:SlotCode},dropPlace?:DropPlace):Promise<Order> {
  const {address,capacity}=await orderPrerequisites(env,user,mode,slot,dropPlace);
  const parcel=await ownParcel(env,user.id,parcelId);
  if(parcel.status!=='ACTIVE') throw new ApiError(409,'PARCEL_CLOSED','包裹已经结束');
  const station=await activeStation(env,parcel.stationCode);
  const id=crypto.randomUUID();
  try {
    // Capacity counts paid orders only (an unpaid order no longer blocks a window); it is checked again atomically at
    // payment. The check here stops students from starting orders for a window that is already full.
    const result=await orderInsert(env,id,{user,parcel,address,station,mode,slot,dropPlace,capacity,code:handoffCode()}).run();
    if(!result.meta.changes){
      if(slot&&await windowLoad(env,slot.date,slot.code)>=capacity) throw new ApiError(409,'SLOT_FULL','这个时段刚刚约满了，请换一个时段，或选择尽快送达');
      throw new ApiError(409,'PARCEL_CLOSED','包裹状态已更新，请刷新');
    }
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
    await requireOrderingOpen(env);
    // A booked window is checked again at payment: it may have closed, or filled up, since the order was created.
    const t=Math.floor(Date.now()/1000),slot=row.slotDate&&row.slotCode?{date:row.slotDate,code:row.slotCode}:null;
    if(slot&&!slotOpen(slot.date,slot.code,t)) throw new ApiError(409,'SLOT_CLOSED','预约的时段已停止预约，请取消这单后重新下单并选择其他时段');
    const capacity=slot?await capacityFor(env,slot.date,slot.code):0;
    // Conditional INSERT + trigger keep payment record and order transition atomic in D1; the window count sits in
    // the same statement, so two students cannot both pay for the last place.
    await env.DB.prepare(`INSERT INTO payments(id,order_id,type,provider,amount_fen,status,idempotency_key)
      SELECT ?,id,'DELIVERY','MOCK',amount_fen,'SUCCEEDED','delivery' FROM delivery_orders o
      WHERE o.id=? AND o.user_id=? AND o.status='WAITING_PAYMENT'
      AND NOT EXISTS(SELECT 1 FROM payments WHERE order_id=? AND type='DELIVERY')
      AND (o.slot_date IS NULL OR (SELECT count(*) FROM delivery_orders x WHERE x.slot_date=o.slot_date AND x.slot_code=o.slot_code AND x.${SLOT_HOLDING})<?)`)
      .bind(crypto.randomUUID(),orderId,userId,orderId,capacity).run();
    const paid=await env.DB.prepare("SELECT id FROM payments WHERE order_id=? AND type='DELIVERY'").bind(orderId).first();
    if(!paid){
      if(slot&&await windowLoad(env,slot.date,slot.code)>=capacity) throw new ApiError(409,'SLOT_FULL','这个时段刚刚约满了，请取消这单后重新下单，换一个时段或选择尽快送达');
      throw new ApiError(409,'PAYMENT_NOT_ALLOWED','订单已变化，请刷新');
    }
    const order=serializeOrder(await ownOrder(env,userId,orderId));
    const where=order.dropPlace?DROP_PLACE_LABELS[order.dropPlace]:`${order.dormSnapshot.buildingName}${order.deliveryMode==='ROOM'?' · 到寝':' · 楼下'}`;
    notifyGroupLater(env,'NEW_ORDER',`新订单：${where} · ${order.packageSize==='SMALL'?'小件':'大件'} · ${slot?slotLabel(slot.date,slot.code,t):'尽快送达'}`,`order:${orderId}`);
    return order;
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

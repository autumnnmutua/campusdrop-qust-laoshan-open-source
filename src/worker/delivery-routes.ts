import {bulkCodes} from '../shared/support';
import {cursorPage,cursorResult} from './pagination';
import { handoffHistory,reviseHandoff,rejectHandoff,cancelStudentOrder,hideStudentOrder,refundStatus,releaseOrder,handoffs,requestHandoff,confirmHandoff } from './order-operations';
import { listPageSchema,releaseSchema,handoffSchema } from '../shared/delivery';
import { z } from 'zod';
import type { Env } from './types';
import { ApiError,body,json } from './http';
import { requireAdmin,requireStudent,requireSuper } from './session';
import { batchSchema,batchTransitionSchema,MOCK_MESSAGE,orderSchema,parcelSchema,quoteSchema,tipSchema,transitionSchema } from '../shared/delivery';
import { createParcel,ownParcel,parcelColumns,cancelParcel } from './parcels';
import type { Parcel } from '../shared/delivery';
import { priceFen } from '../domain/commerce';
import { createOrder,MockPaymentProvider,orderColumns,orderDetails,ownOrder,serializeOrder,type OrderRow } from './orders';
import { bulkPickup,adminOrder,adminTasks,batchOrders,batchTransition,changeStatus,createBatch,dashboard,listBatches,pickupCode } from './delivery-admin';
import { noteUpdateSchema,orderActionSchema } from '../shared/delivery';
import { availableOrders,claimOrder,updateOrderNote,upgradeOrder,deleteStudentOrder } from './order-self-service';
import { rateLimit } from './rate-limit';
export async function deliveryRoutes(request:Request,env:Env):Promise<Response|null> {
  const path=new URL(request.url).pathname.replace('/api/v1','');const method=request.method;
  if(path==='/quotes'&&method==='POST'){
    await requireStudent(request,env);const data=await body(request,quoteSchema);
    return json({amountFen:priceFen(data.packageSize,data.deliveryMode),...data});
  }
  if(path==='/parcels'||path.startsWith('/parcels/')){
    const user=await requireStudent(request,env);
    if(path==='/parcels'&&method==='POST'){
      await rateLimit(env,`parcel:${user.id}`,60);
      return json({parcel:await createParcel(env,user.id,await body(request,parcelSchema))},201);
    }
    if(path==='/parcels'&&method==='GET')return json({parcels:(await env.DB.prepare(`SELECT ${parcelColumns} FROM parcels WHERE user_id=? ORDER BY created_at DESC,id LIMIT 100`).bind(user.id).all<Parcel>()).results});
    const match=/^\/parcels\/([a-f0-9-]{36})$/.exec(path);
    if(match&&method==='GET')return json({parcel:await ownParcel(env,user.id,match[1])});
    if(match&&method==='DELETE'){await cancelParcel(env,user.id,match[1]);return json({ok:true});}
  }
  if(path==='/orders'||path.startsWith('/orders/')){
    const user=await requireStudent(request,env);
    if(path==='/orders'&&method==='POST'){
      await rateLimit(env,`order:${user.id}`,60);const data=await body(request,orderSchema);
      return json({order:await createOrder(env,user,data.parcelId,data.deliveryMode)},201);
    }
    if(path==='/orders'&&method==='GET'){
      const parsed=listPageSchema.safeParse(Object.fromEntries(new URL(request.url).searchParams));if(!parsed.success)throw new ApiError(400,'INVALID_FILTER','分页条件不正确');
      const {page,pageSize}=parsed.data,key=JSON.stringify([user.id,'orders']),{cursor}=cursorPage(request,key);
      if(!cursor&&page>100)throw new ApiError(400,'CURSOR_REQUIRED','深页查询请使用游标');
      const condition=cursor?' AND (o.created_at<? OR (o.created_at=? AND o.id<?))':'';
      const rows=(await env.DB.prepare(`SELECT ${orderColumns} FROM delivery_orders o WHERE o.user_id=? AND o.student_deleted=0${condition} ORDER BY o.created_at DESC,o.id DESC LIMIT ? OFFSET ?`).bind(user.id,...(cursor?[cursor.time,cursor.time,cursor.id]:[]),pageSize+1,cursor?0:(page-1)*pageSize).all<OrderRow>()).results;
      const result=cursorResult(rows,pageSize,key);return json({orders:result.items.map(serializeOrder),page,pageSize,hasMore:result.hasMore,nextCursor:result.nextCursor});
    }
    const match=/^\/orders\/([a-f0-9-]{36})(?:\/(mock-pay|tips\/mock-pay|cancel|note|upgrade|hide|refund))?$/.exec(path);
    if(match){
      const id=match[1],action=match[2];
      if(action==='hide'&&method==='POST'){const data=await body(request,orderActionSchema);return json(await hideStudentOrder(env,user.id,id,data.version));}
      if(action==='refund'&&method==='GET')return json({refund:await refundStatus(env,user.id,id)});
      if(!action&&method==='DELETE'){const data=await body(request,orderActionSchema);return json(await deleteStudentOrder(env,user.id,id,data.version));}
      if(action==='note'&&method==='PATCH'){const data=await body(request,noteUpdateSchema);return json({order:await updateOrderNote(env,user.id,id,data.note,data.version)});}
      if(action==='upgrade'&&method==='POST'){const data=await body(request,orderActionSchema);return json({order:await upgradeOrder(env,user.id,id,data.version),message:'已按服务端报价模拟补付，未发生真实扣款'});}
      if(!action&&method==='GET')return json(await orderDetails(env,await ownOrder(env,user.id,id)));
      if(action==='mock-pay'&&method==='POST'){
        await rateLimit(env,`payment:${user.id}`,60);
        return json({order:await new MockPaymentProvider().pay(env,user.id,id),message:MOCK_MESSAGE});
      }
      if(action==='tips/mock-pay'&&method==='POST'){
        await rateLimit(env,`tip:${user.id}`,60);const data=await body(request,tipSchema);
        return json({payment:await new MockPaymentProvider().tip(env,user.id,id,data.amountFen,data.idempotencyKey),message:MOCK_MESSAGE});
      }
      if(action==='cancel'&&method==='POST'){
        // Legacy Web clients without a body can only cancel an unpaid order.
        if(!request.body){
          await ownOrder(env,user.id,id);
          const result=await env.DB.prepare("UPDATE delivery_orders SET status='CANCELLED',version=version+1,last_actor_type='STUDENT',last_actor_id=? WHERE id=? AND user_id=? AND status='WAITING_PAYMENT'").bind(user.id,id,user.id).run();
          if(!result.meta.changes)throw new ApiError(409,'CANCEL_NOT_ALLOWED','请刷新页面后确认取消配送');
          return json({order:serializeOrder(await ownOrder(env,user.id,id))});
        }
        const data=await body(request,orderActionSchema);return json(await cancelStudentOrder(env,user.id,id,data.version));
      }
    }
  }
  if(/^\/admin\/(dashboard|tasks|available|assignees|orders|batches|audit)(?:\/|$)/.test(path)){
    const admin=await requireAdmin(request,env);
    if(path==='/admin/orders/bulk-pickup'&&method==='POST'){const d=await body(request,bulkCodes);await rateLimit(env,`bulk-code:${admin.id}`,30);return json(await bulkPickup(env,admin,d.orderIds));}
    if(path==='/admin/available'&&method==='GET')return json(await availableOrders(env,admin,request));
    const claim=/^\/admin\/orders\/([a-f0-9-]{36})\/claim$/.exec(path);
    if(claim&&method==='POST'){await body(request,z.object({confirmed:z.literal(true)}).strict());return json(await claimOrder(env,admin,claim[1]));}
    if(path==='/admin/dashboard'&&method==='GET')return json(await dashboard(env,admin));
    if(path==='/admin/tasks'&&method==='GET')return json(await adminTasks(env,admin,request));
    if(path==='/admin/assignees'&&method==='GET'){
      if(admin.role==='DELIVERY_STAFF')throw new ApiError(403,'FORBIDDEN','配送人员不能分配任务');
      return json({admins:(await env.DB.prepare("SELECT id,username,role FROM admin_users WHERE status='ACTIVE' AND (role='DELIVERY_STAFF' OR id=?) ORDER BY username").bind(admin.id).all()).results});
    }
    const edit=/^\/admin\/orders\/([a-f0-9-]{36})\/handoffs\/([a-f0-9-]{36})(?:\/(reject))?$/.exec(path);
    if(edit&&method==='PATCH'&&!edit[3]){const data=await body(request,handoffSchema);return json(await reviseHandoff(env,admin,edit[1],edit[2],data.version,data.location,data.note));}
    if(edit&&method==='POST'&&edit[3]){const data=await body(request,releaseSchema);return json(await rejectHandoff(env,admin,edit[1],edit[2],data.version,data.reason));}
    const operation=/^\/admin\/orders\/([a-f0-9-]{36})\/(release|handoffs)(?:\/([a-f0-9-]{36})\/confirm)?$/.exec(path);
    if(operation){
      const id=operation[1];
      if(operation[2]==='release'&&method==='POST'&&!operation[3]){const data=await body(request,releaseSchema);return json(await releaseOrder(env,admin,id,data.version,data.reason));}
      if(operation[2]==='handoffs'){
        if(method==='GET'&&!operation[3])return json({handoffs:await handoffs(env,admin,id),changes:await handoffHistory(env,admin,id)});
        if(method==='POST'&&operation[3]){const data=await body(request,orderActionSchema);return json(await confirmHandoff(env,admin,id,operation[3],data.version));}
        if(method==='POST'&&!operation[3]){const data=await body(request,handoffSchema);return json(await requestHandoff(env,admin,id,data.version,data.location,data.note),201);}
      }
    }
    const orderMatch=/^\/admin\/orders\/([a-f0-9-]{36})(?:\/(status|pickup-code))?$/.exec(path);
    if(orderMatch){
      const id=orderMatch[1],action=orderMatch[2];
      if(!action&&method==='GET')return json(await orderDetails(env,await adminOrder(env,admin,id)));
      if(action==='status'&&method==='PATCH')return json({order:await changeStatus(env,admin,id,await body(request,transitionSchema))});
      if(action==='pickup-code'&&method==='POST'){
        const data=await body(request,z.object({action:z.enum(['VIEW','COPY'])}).strict());
        return json(await pickupCode(env,admin,id,data.action));
      }
    }
    if(path==='/admin/batches'&&method==='POST'){
      const data=await body(request,batchSchema);return json(await createBatch(env,admin,data.orderIds,data.assigneeAdminId),201);
    }
    if(path==='/admin/batches'&&method==='GET')return json({batches:await listBatches(env,admin)});
    const batchMatch=/^\/admin\/batches\/([a-f0-9-]{36})(?:\/(status))?$/.exec(path);
    if(batchMatch&&method==='GET'&&!batchMatch[2])return json({orders:(await batchOrders(env,admin,batchMatch[1])).map(serializeOrder)});
    if(batchMatch&&method==='PATCH'&&batchMatch[2]==='status'){
      const data=await body(request,batchTransitionSchema);
      return json(await batchTransition(env,admin,batchMatch[1],data.status,data.versions,data.exceptionCode,data.exceptionNote));
    }
    if(path==='/admin/audit'&&method==='GET'){
      requireSuper(admin);
      return json({logs:(await env.DB.prepare('SELECT id,actor_type AS actorType,actor_id AS actorId,action,resource_id AS resourceId,metadata_redacted AS metadata,created_at AS createdAt FROM audit_logs ORDER BY created_at DESC,rowid DESC LIMIT 100').all()).results});
    }
  }
  return null;
}

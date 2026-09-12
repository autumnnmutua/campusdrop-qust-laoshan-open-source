import { z } from 'zod';
export const pickupCodeRegex = /^\d{1,3}-\d-\d{4}$/;
export const pickupCodeSchema = z.string().trim().regex(pickupCodeRegex, '取件码格式应为 87-5-2739 或 107-2-6382');
export const sizeSchema = z.enum(['SMALL','LARGE']);
export const modeSchema = z.enum(['DOWNSTAIRS','ROOM']);
export const CARRIERS = ['申通','中通','圆通','韵达','顺丰','京东','邮政','极兔','其他'] as const;
export const parcelSchema = z.object({
  pickupCode: pickupCodeSchema, stationCode: z.string().min(1).max(64), packageSize: sizeSchema,
  carrier: z.enum(CARRIERS).optional(),
  note: z.string().trim().max(120).refine(v => !/[<>\p{Cc}]/u.test(v)).optional(),
}).strict();
export const noteUpdateSchema=z.object({note:parcelSchema.shape.note.unwrap(),version:z.number().int().nonnegative(),confirmed:z.literal(true)}).strict();
export const orderActionSchema=z.object({version:z.number().int().nonnegative(),confirmed:z.literal(true)}).strict();
export interface AvailableOrder { id:string; buildingName:string; stationName:string; packageSize:PackageSize; deliveryMode:DeliveryMode; amountFen:number }
export const quoteSchema = z.object({ packageSize: sizeSchema, deliveryMode: modeSchema });
// Unknown price fields are stripped; they never affect the price computed by the server.
export const orderSchema = z.object({ parcelId: z.uuid(), deliveryMode: modeSchema });
export const ORDER_STATUSES = ['WAITING_PAYMENT','WAITING_PICKUP','PICKED_UP','OUT_FOR_DELIVERY','DELIVERED_DOWNSTAIRS','DELIVERED_TO_ROOM','COMPLETED','CANCELLED','FAILED_PICKUP','DELIVERY_EXCEPTION'] as const;
export const statusSchema = z.enum(ORDER_STATUSES);
export const exceptionSchema = z.enum(['CODE_INVALID','SIZE_MISMATCH','UNREACHABLE','OTHER']);
export const exceptionNoteSchema = z.string().trim().max(240).refine(v=>!/[<>\p{Cc}]/u.test(v),'请使用普通文字说明问题');
export const releaseSchema=z.object({version:z.number().int().nonnegative(),confirmed:z.literal(true),reason:exceptionNoteSchema.pipe(z.string().min(1))}).strict();
export const handoffSchema=z.object({version:z.number().int().nonnegative(),confirmed:z.literal(true),location:exceptionNoteSchema.pipe(z.string().min(1).max(120)),note:exceptionNoteSchema.pipe(z.string().min(1))}).strict();
export interface Handoff {id:string;requestedBy:string;stationCode:string;location:string;note:string;rejectionReason?:string;revision?:number;status:'PENDING'|'CONFIRMED'|'REJECTED';confirmedBy:string|null;createdAt:number}
export const transitionSchema = z.object({ status: statusSchema, version: z.number().int().nonnegative(), exceptionCode: exceptionSchema.optional(), exceptionNote: exceptionNoteSchema.optional() }).strict();
export const batchSchema = z.object({ orderIds: z.array(z.uuid()).min(1).max(20).refine(v => new Set(v).size===v.length), assigneeAdminId: z.uuid() }).strict();
export const batchTransitionSchema = z.object({ status: statusSchema, versions: z.record(z.uuid(),z.number().int().nonnegative()), exceptionCode: exceptionSchema.optional(), exceptionNote: exceptionNoteSchema.optional() }).strict();
export const tipSchema = z.object({ amountFen: z.number().int().min(1).max(10000), idempotencyKey: z.uuid() }).strict();
export const taskGroupSchema=z.enum(['ALL','ACTIVE','AWAITING_RECEIPT','CLOSED']);
export const TASK_GROUP_LABELS={ALL:'全部订单',ACTIVE:'进行中',AWAITING_RECEIPT:'待学生签收',CLOSED:'已完成 / 已取消'} as const;
export const taskQuerySchema = z.object({
  group:taskGroupSchema.optional(),
  cursor:z.string().max(1500).optional(),pageSize:z.coerce.number().int().min(1).max(100).optional(),
  status: statusSchema.optional(), building: z.string().max(64).optional(), deliveryMode: modeSchema.optional(),
  packageSize: sizeSchema.optional(), page: z.coerce.number().int().min(1).max(100000).default(1),
}).strict();
export type OrderStatus = z.infer<typeof statusSchema>;
export type PackageSize = z.infer<typeof sizeSchema>;
export type DeliveryMode = z.infer<typeof modeSchema>;
export type ParcelInput = z.infer<typeof parcelSchema>;
export interface Parcel { id: string; pickupCode: string; stationCode: string; packageSize: PackageSize; carrier: string|null; note: string; status: string; createdAt: number }
export interface DormSnapshot { campusId: string; zone: string; buildingCode: string; buildingName: string; roomNo: string; name: string; phone: string }
export interface Station { code: string; canonicalName: string; relativeLocation: string; lat: number|null; lng: number|null }
export interface Order { hasAssignee?:boolean; receivedAt?:number|null;returnCount?:number;returnHistory?:{reason:string;createdAt:number;adminName:string}[]; custodyState?:'NONE'|'STAFF'|'RETURNED'|'DELIVERED'; upgradeQuoteFen?:number; pendingHandoff?:string|null; assigneePhone?:string|null; serviceNotice?:string; exceptionNote?:string; refundableFen:number; note:string; upgradeFen:number; id: string; parcelId: string; packageSize: PackageSize; deliveryMode: DeliveryMode; amountFen: number; status: OrderStatus; version: number; createdAt: number; dormSnapshot: DormSnapshot; stationSnapshot: Station; exceptionCode: string|null }
export interface Payment { id: string; type: 'DELIVERY'|'TIP'|'UPGRADE'|'REFUND'; provider: 'MOCK'; amountFen: number; status: 'SUCCEEDED'; createdAt: number }
export interface OrderEvent { detail?:string; id: number; fromStatus: OrderStatus|null; toStatus: OrderStatus; createdAt: number }
export const STATUS_LABELS: Record<OrderStatus,string> = { WAITING_PAYMENT:'待模拟支付', WAITING_PICKUP:'待取件', PICKED_UP:'已取件', OUT_FOR_DELIVERY:'配送中', DELIVERED_DOWNSTAIRS:'已送到楼下', DELIVERED_TO_ROOM:'已送到寝室', COMPLETED:'已完成', CANCELLED:'已取消', FAILED_PICKUP:'取件失败', DELIVERY_EXCEPTION:'配送异常' };
export const MOCK_MESSAGE = '模拟支付，未发生真实扣款';

export const listPageSchema=z.object({cursor:z.string().max(1500).optional(),page:z.coerce.number().int().min(1).max(100000).default(1),pageSize:z.coerce.number().int().min(1).max(100).default(100)});

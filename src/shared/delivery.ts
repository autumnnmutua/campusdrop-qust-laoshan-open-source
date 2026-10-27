import { z } from 'zod';
import { CARRIERS,ORDER_STATUSES,pickupCodeRegex } from './constants.ts';
import { SLOT_CODES,type SlotCode } from './slots.ts';
export { CARRIERS,MOCK_MESSAGE,ORDER_STATUSES,pickupCodeRegex,STATUS_LABELS,TASK_GROUP_LABELS } from './constants.ts';
export const pickupCodeSchema = z.string().trim().regex(pickupCodeRegex, '取件码格式应为 87-5-2739 或 107-2-6382');
export const sizeSchema = z.enum(['SMALL','LARGE']);
export const modeSchema = z.enum(['DOWNSTAIRS','ROOM']);
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
export const orderSchema = z.object({
  parcelId: z.uuid(), deliveryMode: modeSchema,
  // Optional booked window; omitted means "as soon as possible". Both fields or neither.
  slotDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(), slotCode: z.enum(SLOT_CODES).optional(),
}).refine(v => (v.slotDate === undefined) === (v.slotCode === undefined), '预约时段需同时提供日期和时段');
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
export interface Order {
  /** Shown to the student while the order is in progress; the courier enters it at the door to sign for them. */
  handoffCode?:string|null; handoffVerifiedAt?:number|null;
  slotDate?:string|null; slotCode?:SlotCode|null;
  /** Unread chat messages: from the courier (for the student) and from the student (for the courier). */
  chatUnreadStudent?:number; chatUnreadCourier?:number;
  hasAssignee?:boolean; receivedAt?:number|null;returnCount?:number;returnHistory?:{reason:string;createdAt:number;adminName:string}[]; custodyState?:'NONE'|'STAFF'|'RETURNED'|'DELIVERED'; upgradeQuoteFen?:number; pendingHandoff?:string|null; assigneePhone?:string|null; serviceNotice?:string; exceptionNote?:string; refundableFen:number; note:string; upgradeFen:number; id: string; parcelId: string; packageSize: PackageSize; deliveryMode: DeliveryMode; amountFen: number; status: OrderStatus; version: number; createdAt: number; dormSnapshot: DormSnapshot; stationSnapshot: Station; exceptionCode: string|null }
export interface Payment { id: string; type: 'DELIVERY'|'TIP'|'UPGRADE'|'REFUND'; provider: 'MOCK'; amountFen: number; status: 'SUCCEEDED'; createdAt: number }
export interface OrderEvent { detail?:string; id: number; fromStatus: OrderStatus|null; toStatus: OrderStatus; createdAt: number }

export const listPageSchema=z.object({cursor:z.string().max(1500).optional(),page:z.coerce.number().int().min(1).max(100000).default(1),pageSize:z.coerce.number().int().min(1).max(100).default(100)});

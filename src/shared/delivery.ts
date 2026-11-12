/* © 2026 专业团队 · CampusDrop v4.7.0 · WM-A372E4790D8B1C09-88C33F2C68 */
import { z } from 'zod';
import { CARRIERS,ORDER_STATUSES,pickupCodeRegex } from './constants.ts';
import { SLOT_CODES,type SlotCode } from './slots.ts';
import { DROP_PLACES,type DropPlace } from './campus-map.ts';
export { CARRIERS,MOCK_MESSAGE,ORDER_STATUSES,pickupCodeRegex,STATUS_LABELS,TASK_GROUP_LABELS } from './constants.ts';
export const pickupCodeSchema = z.string().trim().regex(pickupCodeRegex, '取件码格式应为 87-5-2739 或 107-2-6382');
export const sizeSchema = z.enum(['SMALL','LARGE','EXTRA_LARGE']);
/*
 * v4.5 · three parcel sizes. 超大件 is stored as a 大件 (the database keeps its two sizes) plus a fixed 3 元 surcharge
 * (oversize_fen), so its price is 8 元 楼下 / 10 元 送寝 and every existing rule for 大件 (upgrade price, refunds) holds.
 */
export const OVERSIZE_FEN = 300;
export const SIZE_LABELS = { SMALL: '小件', LARGE: '大件', EXTRA_LARGE: '超大件' } as const;
export const SIZE_LIMITS = {
  SMALL: { dims: '40 × 30 × 20 cm', weight: '3 kg', text: '不超过 40 × 30 × 20 cm、3 kg' },
  LARGE: { dims: '70 × 50 × 40 cm', weight: '10 kg', text: '不超过 70 × 50 × 40 cm、10 kg' },
  EXTRA_LARGE: { dims: '超过大件上限', weight: '超过 10 kg', text: '超过大件尺寸，或超过 10 kg' },
} as const;
export const sizeLabel = (size: string | null | undefined) => SIZE_LABELS[(size ?? 'SMALL') as keyof typeof SIZE_LABELS] ?? '小件';
/** 大件 and 超大件 go to the 接单市场 for couriers to take; 小件 are handed to the courier responsible for the building. */
export const isBulky = (size: string | null | undefined) => size === 'LARGE' || size === 'EXTRA_LARGE';
export const modeSchema = z.enum(['DOWNSTAIRS','ROOM']);
export const parcelSchema = z.object({
  pickupCode: pickupCodeSchema, stationCode: z.string().min(1).max(64), packageSize: sizeSchema,
  carrier: z.enum(CARRIERS).optional(),
  note: z.string().trim().max(120).refine(v => !/[<>\p{Cc}]/u.test(v)).optional(),
}).strict();
export const noteUpdateSchema=z.object({note:parcelSchema.shape.note.unwrap(),version:z.number().int().nonnegative(),confirmed:z.literal(true)}).strict();
export const orderActionSchema=z.object({version:z.number().int().nonnegative(),confirmed:z.literal(true)}).strict();
export interface AvailableOrder { courierFen?:number; rainFen?:number; groupId?:string|null; groupSize?:number; id:string; buildingName:string; buildingCode?:string; stationName:string; packageSize:PackageSize; deliveryMode:DeliveryMode; amountFen:number; slotDate?:string|null; slotCode?:SlotCode|null; dropPlace?:DropPlace|null }
export const quoteSchema = z.object({ packageSize: sizeSchema, deliveryMode: modeSchema });
// Unknown price fields are stripped; they never affect the price computed by the server.
export const orderSchema = z.object({
  parcelId: z.uuid(), deliveryMode: modeSchema,
  // Optional booked window; omitted means "as soon as possible". Both fields or neither.
  slotDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(), slotCode: z.enum(SLOT_CODES).optional(),
  // Optional campus drop-off point instead of the dorm; only with downstairs delivery.
  dropPlace: z.enum(DROP_PLACES).optional(),
}).refine(v => (v.slotDate === undefined) === (v.slotCode === undefined), '预约时段需同时提供日期和时段')
  .refine(v => v.dropPlace === undefined || v.deliveryMode === 'DOWNSTAIRS', '送到约定地点时请选择楼下配送价');
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
export interface Parcel { id: string; pickupCode: string; stationCode: string; packageSize: PackageSize; carrier: string|null; note: string; status: string; createdAt: number; hasOrder?: number|boolean }
export interface DormSnapshot { campusId: string; zone: string; buildingCode: string; buildingName: string; roomNo: string; name: string; phone: string }
export interface Station { code: string; canonicalName: string; relativeLocation: string; lat: number|null; lng: number|null }
export interface Order {
  /** v4.5: rain surcharge share on this order (paid = amountFen − discounts + rainFen); 超大件 surcharge inside amountFen; courierFen = what the courier gets. */
  rainFen?:number; oversizeFen?:number; courierFen?:number;
  /** v3.6 one-click demo: made by a demo account; invisible to real operators. */
  demo?:boolean;
  /** v3.7.1 coupon: what the coupon took off the delivery fee (amountFen stays the full price; paid = amountFen − discountFen). */
  discountFen?:number;
  /** v3.8 多件满减: this parcel's share of the bundle discount; paid = amountFen − discountFen − bundleDiscountFen. */
  bundleDiscountFen?:number;
  /** v3.8 多件下单: the checkout (one payment for several parcels) this order was created in. */
  checkoutId?:string|null;
  /** v3.0 merged delivery: the group this order belongs to and how many of its orders are not cancelled. */
  groupId?:string|null; groupSize?:number; ruleId?:string|null;
  /** Shown to the student while the order is in progress; the courier enters it at the door to sign for them. */
  handoffCode?:string|null; handoffVerifiedAt?:number|null;
  slotDate?:string|null; slotCode?:SlotCode|null;
  /** Campus drop-off point instead of the dorm (priced as downstairs). */
  dropPlace?:DropPlace|null;
  /** Roommate who will collect the parcel, shown to the courier; and the student's own tracking link token. */
  proxyName?:string; shareToken?:string|null;
  nearNotifiedAt?:number|null; hasPhoto?:boolean;
  /** Unread chat messages: from the courier (for the student) and from the student (for the courier). */
  chatUnreadStudent?:number; chatUnreadCourier?:number;
  hasAssignee?:boolean; /** v4.5: handed to the courier responsible for the building (小件按楼分配), not taken from the market. */ dispatched?:boolean; receivedAt?:number|null;returnCount?:number;returnHistory?:{reason:string;createdAt:number;adminName:string}[]; custodyState?:'NONE'|'STAFF'|'RETURNED'|'DELIVERED'; upgradeQuoteFen?:number; pendingHandoff?:string|null; assigneePhone?:string|null; serviceNotice?:string; exceptionNote?:string; refundableFen:number; note:string; upgradeFen:number; id: string; parcelId: string; packageSize: PackageSize; deliveryMode: DeliveryMode; amountFen: number; status: OrderStatus; version: number; createdAt: number; dormSnapshot: DormSnapshot; stationSnapshot: Station; exceptionCode: string|null }
export interface Payment { id: string; type: 'DELIVERY'|'TIP'|'UPGRADE'|'REFUND'; provider: 'MOCK'; amountFen: number; status: 'SUCCEEDED'; createdAt: number }
export interface OrderEvent { detail?:string; id: number; fromStatus: OrderStatus|null; toStatus: OrderStatus; createdAt: number }

export const listPageSchema=z.object({cursor:z.string().max(1500).optional(),page:z.coerce.number().int().min(1).max(100000).default(1),pageSize:z.coerce.number().int().min(1).max(100).default(100)});

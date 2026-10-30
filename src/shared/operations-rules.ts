/**
 * v2.7 operations: plain values and types shared by the worker and the client (zod-free, so pages that only show labels
 * do not pull in the validation library). Schemas live in operations.ts.
 */
import { DELIVERY_SLOTS, type SlotCode } from './slots.ts';

// ---------------------------------------------------------------- send service (代寄件)
export const SEND_STATUSES = ['WAITING_PICKUP', 'PICKED_UP', 'DROPPED', 'CANCELLED'] as const;
export type SendStatus = typeof SEND_STATUSES[number];
export const SEND_STATUS_LABELS: Record<SendStatus, string> = { WAITING_PICKUP: '等待上门', PICKED_UP: '已上门取件', DROPPED: '已交站点寄出', CANCELLED: '已取消' };
/** Send pick-ups per booked window, on top of (and independent from) delivery capacity. */
export const SEND_SLOT_CAPACITY = 20;
export interface SendRequest {
  id: string; status: SendStatus; packageSize: 'SMALL' | 'LARGE'; carrier: string; note: string;
  slotDate: string; slotCode: SlotCode; amountFen: number; refundedFen: number; trackingNo: string; cancelReason: string;
  buildingName: string; roomNo: string; stationName: string; version: number;
  createdAt: number; pickedAt: number | null; droppedAt: number | null; hasAssignee: boolean; assigneePhone?: string | null;
  /** Admin views only. */
  studentName?: string; studentPhone?: string; assignee?: string | null;
}

// ---------------------------------------------------------------- operations settings
export interface OrderingPause { paused: boolean; reason: string; since?: number | null }
export const WEBHOOK_KINDS = ['wecom', 'feishu'] as const;
export type WebhookKind = typeof WEBHOOK_KINDS[number];
export const WEBHOOK_KIND_LABELS: Record<WebhookKind, string> = { wecom: '企业微信群机器人', feishu: '飞书群机器人' };
export const WEBHOOK_EVENTS = ['NEW_ORDER', 'NEW_SEND', 'STALLED', 'PAUSE'] as const;
export type WebhookEvent = typeof WEBHOOK_EVENTS[number];
export const WEBHOOK_EVENT_LABELS: Record<WebhookEvent, string> = { NEW_ORDER: '新的已支付订单', NEW_SEND: '新的代寄件预约', STALLED: '订单超时预警', PAUSE: '暂停 / 恢复接单' };
/** Only the official bot endpoints are accepted, so the setting cannot be turned into a request to any other host. */
export const WEBHOOK_HOSTS: Record<WebhookKind, string[]> = { wecom: ['qyapi.weixin.qq.com'], feishu: ['open.feishu.cn', 'open.larksuite.com'] };
export interface WebhookSetting { kind: WebhookKind; url: string; events: WebhookEvent[] }
/** Courier-shift capacity: when on, each window takes `quota` orders per courier who signed up for it. */
export interface ShiftCapacity { enabled: boolean; quota: Record<SlotCode, number> }
export const DEFAULT_SHIFT_QUOTA: Record<SlotCode, number> = { NOON: 15, EVENING: 20, NIGHT: 15 };
export function windowCapacity(code: SlotCode, shiftCapacity: ShiftCapacity | null, couriersOnShift: number): number {
  const fixed = DELIVERY_SLOTS.find(s => s.code === code)!.capacity;
  return shiftCapacity?.enabled ? Math.max(0, (shiftCapacity.quota[code] ?? DEFAULT_SHIFT_QUOTA[code]) * couriersOnShift) : fixed;
}
export interface Shift { adminId: string; username: string; date: string; code: SlotCode }

// ---------------------------------------------------------------- settlement (模拟结算)
/** Courier share of the (mock) delivery fee; tips go to the courier in full. Illustrative only — no money moves. */
export const COURIER_SHARE = 0.8;
export interface SettlementRow { adminId: string; username: string; deliveries: number; deliveryFen: number; sends: number; sendFen: number; tipFen: number; payoutFen: number }

// ---------------------------------------------------------------- reports and boards
export interface MileageRow { adminId: string; username: string; deliveries: number; meters: number; unplaced: number }
export interface BuildingHeat { code: string; name: string; orders: number }
export interface YearReport {
  year: number; parcels: number; orders: number; completed: number; room: number; large: number; sends: number;
  topCarrier: string | null; busiestSlot: string | null; busiestHour: number | null; firstAt: number | null; lastAt: number | null;
  meters: number; ratings: number; dropPlaces: number;
}
export interface MonthReport {
  month: string; days: number; orders: number; paid: number; completed: number; cancelled: number; exceptions: number;
  avgMinutes: number | null; avgStars: number | null; ratings: number; sends: number; newStudents: number | null;
  daily: { day: string; count: number }[]; buildings: { building: string; count: number }[];
  slots: { code: string; count: number }[]; staff: { name: string; delivered: number }[];
}
export interface Funnel { parcels: number | null; orders: number; paid: number; delivered: number; completed: number; rated: number }
export interface Forecast { date: string; weekday: number; expected: number; samples: number; peakHour: number | null }
export interface InsightsExtra { funnel: Funnel; repeatRate: number | null; students: number; buildingsReached: { building: string; students: number; orders: number }[]; forecast: Forecast[] }

// ---------------------------------------------------------------- public tracking (室友代收)
export interface TrackView {
  status: string; buildingName: string; dropPlace: string | null; proxyName: string; slot: string | null;
  events: { status: string; at: number }[]; eta: { minutes: number; label: string; basis: string } | null;
  courier: { x: number; y: number; source: 'gps' | 'estimate' } | null; stationCode: string; destination: string; updatedAt: number;
}

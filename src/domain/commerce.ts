/* © 2026 专业团队 · CampusDrop v4.7.0 · WM-A372E4790D8B1C09-4194E01D75 */
import type { DeliveryMode, OrderStatus, PackageSize } from '../shared/delivery';
/** The fee the student sees for one parcel (超大件 = 大件 + 3 元: 8 元 楼下 / 10 元 送寝). */
export function priceFen(size: PackageSize, mode: DeliveryMode): number {
  return { SMALL: { DOWNSTAIRS: 200, ROOM: 300 }, LARGE: { DOWNSTAIRS: 500, ROOM: 700 }, EXTRA_LARGE: { DOWNSTAIRS: 800, ROOM: 1000 } }[size][mode];
}
/** What the delivery_orders.amount_fen column holds (its CHECK knows two sizes); 超大件 adds oversize_fen on top. */
export function basePriceFen(size: PackageSize, mode: DeliveryMode): number { return priceFen(size === 'EXTRA_LARGE' ? 'LARGE' : size, mode); }
export function upgradePriceFen(size:PackageSize):number { return size==='SMALL'?100:200; }
export function nextStatuses(status: OrderStatus, mode: DeliveryMode): OrderStatus[] {
  const transitions: Record<OrderStatus, OrderStatus[]> = {
    WAITING_PAYMENT: ['CANCELLED'], WAITING_PICKUP: ['PICKED_UP','FAILED_PICKUP','CANCELLED'],
    PICKED_UP: ['OUT_FOR_DELIVERY','DELIVERY_EXCEPTION'],
    OUT_FOR_DELIVERY: [mode==='ROOM'?'DELIVERED_TO_ROOM':'DELIVERED_DOWNSTAIRS','DELIVERY_EXCEPTION'],
    DELIVERED_DOWNSTAIRS:['COMPLETED'], DELIVERED_TO_ROOM:['COMPLETED'],
    COMPLETED:[], CANCELLED:[], FAILED_PICKUP:['WAITING_PICKUP','CANCELLED'], DELIVERY_EXCEPTION:['OUT_FOR_DELIVERY','CANCELLED'],
  };
  return transitions[status];
}
export function maskPickupCode(code: string): string { return `***-*-${code.slice(-4)}`; }

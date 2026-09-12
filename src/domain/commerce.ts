import type { DeliveryMode, OrderStatus, PackageSize } from '../shared/delivery';
export function priceFen(size: PackageSize, mode: DeliveryMode): number {
  return { SMALL: { DOWNSTAIRS: 200, ROOM: 300 }, LARGE: { DOWNSTAIRS: 500, ROOM: 700 } }[size][mode];
}
export function upgradePriceFen(size:PackageSize):number { return size==='LARGE'?200:100; }
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

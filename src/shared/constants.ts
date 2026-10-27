/**
 * Plain values shared by the worker and the client. This module stays free of zod so the client's first-load bundle can
 * use labels without the validation library; the schema modules re-export everything here.
 */
export const CAMPUS_ID = 'QUST_LAOSHAN' as const;
export const pickupCodeRegex = /^\d{1,3}-\d-\d{4}$/;
export const CARRIERS = ['申通','中通','圆通','韵达','顺丰','京东','邮政','极兔','其他'] as const;
export const ORDER_STATUSES = ['WAITING_PAYMENT','WAITING_PICKUP','PICKED_UP','OUT_FOR_DELIVERY','DELIVERED_DOWNSTAIRS','DELIVERED_TO_ROOM','COMPLETED','CANCELLED','FAILED_PICKUP','DELIVERY_EXCEPTION'] as const;
export const TASK_GROUP_LABELS={ALL:'全部订单',ACTIVE:'进行中',AWAITING_RECEIPT:'待学生签收',CLOSED:'已完成 / 已取消'} as const;
export const STATUS_LABELS: Record<typeof ORDER_STATUSES[number],string> = { WAITING_PAYMENT:'待模拟支付', WAITING_PICKUP:'待取件', PICKED_UP:'已取件', OUT_FOR_DELIVERY:'配送中', DELIVERED_DOWNSTAIRS:'已送到楼下', DELIVERED_TO_ROOM:'已送到寝室', COMPLETED:'已完成', CANCELLED:'已取消', FAILED_PICKUP:'取件失败', DELIVERY_EXCEPTION:'配送异常' };
export const MOCK_MESSAGE = '模拟支付，未发生真实扣款';

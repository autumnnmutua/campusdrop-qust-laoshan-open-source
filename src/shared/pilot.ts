/*
 * v3.8 · 实测报告 (the trial report). What the project needs to show from a real trial: who used it and came back,
 * whether deliveries were on time and how long they took, what people thought, what went wrong, and what it cost.
 * The worker computes it from the orders the admin may see (real trials exclude demo and test accounts; inside the
 * one-click demo the report reads the demo's test data). Definitions are listed on the page (统计口径).
 */
export const PILOT_PERIODS = [7, 14, 30, 0] as const;   // 0 = everything so far
export const PILOT_ASAP_TARGET = 60;                    // minutes; same default as the on-time dashboard

export interface PilotDay { date: string; orders: number; users: number; newUsers: number; delivered: number; onTime: number }
export interface PilotWeek { label: string; from: string; to: string; orders: number; users: number; newUsers: number; onTimeRate: number | null; avgStars: number | null; tickets: number }
export interface PilotReport {
  days: number; from: number; to: number; firstOrderAt: number | null;
  /** True inside the one-click demo: the numbers are test data. */
  testData: boolean;
  users: number; newUsers: number; repeatUsers: number; repeatRate: number | null; ordersPerUser: number | null;
  orders: number; multiOrders: number; cancelledAfterPay: number; cancelRate: number | null;
  delivered: number; onTime: number; onTimeRate: number | null; bookedShare: number | null;
  asapMedian: number | null; asapP90: number | null; claimMedian: number | null; rideMedian: number | null;
  exceptions: number; exceptionRate: number | null;
  rated: number; ratedShare: number | null; avgStars: number | null; stars: [number, number, number, number, number];
  tickets: number; ticketsPer100: number | null; ticketsResolved: number; resolveMedianHours: number | null;
  grossFen: number; couponFen: number; bundleFen: number; paidFen: number; refundFen: number; tipFen: number;
  couriers: number; perCourierDay: number | null;
  daily: PilotDay[]; weekly: PilotWeek[];
}

/** Value at quantile q (0–1) of an unsorted list, or null when empty (nearest-rank). */
export function quantile(values: number[], q: number): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(q * sorted.length) - 1))];
}
export const ratio = (a: number, b: number) => b ? a / b : null;

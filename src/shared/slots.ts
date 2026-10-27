/**
 * Booked delivery windows (预约配送时段), shared by the worker (validation, capacity) and the client (picker, labels).
 * All times are Beijing time; dates are YYYY-MM-DD strings so they compare and index as text. Zod-free on purpose.
 */
export const DELIVERY_SLOTS = [
  { code: 'NOON', label: '午间', start: '11:30', end: '13:00', capacity: 40 },
  { code: 'EVENING', label: '傍晚', start: '17:00', end: '19:00', capacity: 60 },
  { code: 'NIGHT', label: '晚间', start: '20:00', end: '22:00', capacity: 40 },
] as const;
export type SlotCode = typeof DELIVERY_SLOTS[number]['code'];
export const SLOT_CODES = DELIVERY_SLOTS.map(s => s.code) as [SlotCode, ...SlotCode[]];
/** Days that can be booked, starting today. */
export const SLOT_BOOKING_DAYS = 3;
/** A window closes for booking this many minutes before it starts, so couriers can plan the run. */
export const SLOT_LEAD_MINUTES = 30;

export interface SlotAvailability { date: string; code: SlotCode; booked: number; capacity: number; open: boolean }

export const slotByCode = (code: SlotCode) => DELIVERY_SLOTS.find(s => s.code === code)!;
/** Beijing calendar date of an epoch-second timestamp. */
export function beijingDate(epochSeconds: number): string {
  return new Date((epochSeconds + 8 * 3600) * 1000).toISOString().slice(0, 10);
}
/** Epoch seconds of a Beijing wall-clock time on a date. */
export function slotTime(date: string, hhmm: string): number {
  return Date.parse(`${date}T${hhmm}:00+08:00`) / 1000;
}
export function bookableDates(now: number): string[] {
  return Array.from({ length: SLOT_BOOKING_DAYS }, (_, i) => beijingDate(now + i * 86400));
}
/** Whether a window can still be chosen at `now` (capacity is checked separately against the database). */
export function slotOpen(date: string, code: SlotCode, now: number): boolean {
  return bookableDates(now).includes(date) && slotTime(date, slotByCode(code).start) - SLOT_LEAD_MINUTES * 60 > now;
}
export function dayLabel(date: string, now: number): string {
  const offset = bookableDates(now).indexOf(date);
  if (offset === 0) return '今天';
  if (offset === 1) return '明天';
  if (offset === 2) return '后天';
  const [, m, d] = date.split('-');
  return `${Number(m)}月${Number(d)}日`;
}
/** "今天 傍晚 17:00–19:00"; `now` decides today/tomorrow wording. */
export function slotLabel(date: string, code: SlotCode, now: number): string {
  const slot = slotByCode(code);
  return `${dayLabel(date, now)} ${slot.label} ${slot.start}–${slot.end}`;
}

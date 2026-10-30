import { z } from 'zod';
import { modeSchema } from './delivery.ts';
import { SLOT_CODES, type SlotCode } from './slots.ts';
import { DROP_PLACES, type DropPlace } from './campus-map.ts';
import type { DeliveryMode, Order } from './delivery.ts';

/*
 * v3.0 contracts shared by the worker and the client: merged delivery (order groups), standing delivery rules,
 * weather linkage and the on-time dashboard. Zod schemas validate requests; plain functions hold the rules both
 * sides must agree on (weather levels, ETA padding, on-time definition).
 */

// ---------------------------------------------------------------- merged delivery (多件合并配送)
/** At most this many parcels in one merged delivery (one courier carries them in one trip). */
export const GROUP_MAX_PARCELS = 6;
export const groupOrderSchema = z.object({
  parcelIds: z.array(z.uuid()).min(2, '合并配送至少选择 2 件包裹').max(GROUP_MAX_PARCELS, `一次最多合并 ${GROUP_MAX_PARCELS} 件`)
    .refine(v => new Set(v).size === v.length, '包裹不能重复选择'),
  deliveryMode: modeSchema,
  slotDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(), slotCode: z.enum(SLOT_CODES).optional(),
  dropPlace: z.enum(DROP_PLACES).optional(),
}).strict()
  .refine(v => (v.slotDate === undefined) === (v.slotCode === undefined), '预约时段需同时提供日期和时段')
  .refine(v => v.dropPlace === undefined || v.deliveryMode === 'DOWNSTAIRS', '送到约定地点时请选择楼下配送价');
export interface OrderGroup {
  id: string; createdAt: number; origin: 'STUDENT' | 'RULE';
  orders: Order[];
  /** Sum over the members that are not cancelled; unpaid = still waiting for the mock payment. */
  totalFen: number; unpaidFen: number; unpaidCount: number;
}

// ---------------------------------------------------------------- standing delivery rules (常用配送规则)
export const RULES_PER_STUDENT = 3;
/** Orders are prepared this long before the window starts (and until the window closes for booking). */
export const RULE_LEAD_HOURS = 3;
export const WEEKDAY_LABELS = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'] as const;
const ruleFields = {
  weekdays: z.number().int().min(1, '请至少选择一天').max(127),
  slotCode: z.enum(SLOT_CODES),
  deliveryMode: modeSchema,
  dropPlace: z.enum(DROP_PLACES).nullable().optional(),
};
export const ruleCreateSchema = z.object(ruleFields).strict()
  .refine(v => !v.dropPlace || v.deliveryMode === 'DOWNSTAIRS', '送到约定地点时请选择楼下配送');
export const ruleUpdateSchema = z.object({ ...ruleFields, active: z.boolean() }).partial().strict()
  .refine(v => Object.keys(v).length > 0, '没有要修改的内容');
export interface DeliveryRule {
  id: string; weekdays: number; slotCode: SlotCode; deliveryMode: DeliveryMode; dropPlace: DropPlace | null;
  active: boolean; lastRunDate: string | null; lastNotice: string | null; createdAt: number;
}
/** "周一至周五" / "周一、周三、周五" / "每天". */
export function weekdayText(mask: number): string {
  if (mask === 127) return '每天';
  if (mask === 31) return '周一至周五';
  if (mask === 96) return '周六、周日';
  return WEEKDAY_LABELS.filter((_, i) => mask & (1 << i)).join('、');
}
/** Monday-based weekday bit of a Beijing calendar date (YYYY-MM-DD). */
export function weekdayBit(date: string): number {
  const d = new Date(`${date}T12:00:00+08:00`).getUTCDay();   // 0 = Sunday
  return 1 << ((d + 6) % 7);
}

// ---------------------------------------------------------------- weather (天气联动)
export type WeatherLevel = 'CLEAR' | 'WET' | 'SEVERE';
export const WEATHER_OVERRIDES = ['AUTO', 'CLEAR', 'WET', 'SEVERE'] as const;
export const weatherSettingSchema = z.object({
  enabled: z.boolean(),
  override: z.enum(WEATHER_OVERRIDES),
  note: z.string().trim().max(80).refine(v => !/[<>\p{Cc}]/u.test(v), '请使用普通文字'),
}).strict();
/** Campus point used for the forecast (Wikipedia infobox for QUST: 36°07′08″N 120°28′44″E; ample for a weather grid). */
export const WEATHER_POINT = { latitude: 36.119, longitude: 120.479 } as const;
/** Extra minutes added to "as soon as possible" arrival estimates. */
export const WEATHER_PADDING: Record<WeatherLevel, number> = { CLEAR: 0, WET: 10, SEVERE: 20 };
/** WMO weather interpretation codes (as used by Open-Meteo) → short Chinese label. */
const WMO: Record<number, string> = {
  0: '晴', 1: '晴间少云', 2: '多云', 3: '阴', 45: '雾', 48: '雾凇',
  51: '小毛毛雨', 53: '毛毛雨', 55: '强毛毛雨', 56: '冻毛毛雨', 57: '强冻毛毛雨',
  61: '小雨', 63: '中雨', 65: '大雨', 66: '冻雨', 67: '强冻雨',
  71: '小雪', 73: '中雪', 75: '大雪', 77: '米雪',
  80: '阵雨', 81: '中阵雨', 82: '强阵雨', 85: '阵雪', 86: '强阵雪',
  95: '雷雨', 96: '雷雨伴冰雹', 97: '强雷雨', 99: '强雷雨伴冰雹',
};
export const weatherLabel = (code: number | null | undefined) => code == null ? '天气未知' : WMO[code] ?? '天气未知';
const SEVERE_CODES = new Set([65, 67, 75, 82, 86, 95, 96, 97, 99]);
const WET_CODES = new Set([51, 53, 55, 56, 57, 61, 63, 66, 71, 73, 77, 80, 81, 85]);
export interface WeatherObservation {
  at: number; code: number | null; temperature: number | null; precipitation: number | null;
  windGust: number | null; rainChanceNext2h: number | null;
}
/**
 * Delivery level from an observation. SEVERE: heavy rain or snow, thunderstorms, gusts from Beaufort 8 (17.2 m/s), or
 * more than 7.6 mm of precipitation in the hour (the usual threshold for heavy rain). WET: any rain, drizzle or snow,
 * at least 0.2 mm, or a 70 % chance of rain within two hours.
 */
export function weatherLevel(o: WeatherObservation): WeatherLevel {
  if ((o.code != null && SEVERE_CODES.has(o.code)) || (o.windGust ?? 0) >= 17.2 || (o.precipitation ?? 0) > 7.6) return 'SEVERE';
  if ((o.code != null && WET_CODES.has(o.code)) || (o.precipitation ?? 0) >= 0.2 || (o.rainChanceNext2h ?? 0) >= 70) return 'WET';
  return 'CLEAR';
}
const num = z.number().finite().nullable().optional();
const responseSchema = z.object({
  current: z.object({ time: z.string(), temperature_2m: num, precipitation: num, weather_code: num, wind_gusts_10m: num }),
  hourly: z.object({ precipitation_probability: z.array(z.number().nullable()).optional() }).optional(),
});
/** Parses an Open-Meteo /v1/forecast response into an observation (null when the shape is not what we asked for). */
export function parseWeather(raw: unknown, at: number): WeatherObservation | null {
  const r = responseSchema.safeParse(raw);
  if (!r.success) return null;
  const c = r.data.current, chances = (r.data.hourly?.precipitation_probability ?? []).slice(0, 2).filter((v): v is number => typeof v === 'number');
  return { at, code: c.weather_code ?? null, temperature: c.temperature_2m ?? null, precipitation: c.precipitation ?? null, windGust: c.wind_gusts_10m ?? null, rainChanceNext2h: chances.length ? Math.max(...chances) : null };
}

export interface WeatherInfo {
  enabled: boolean;
  /** The level in effect: the operator's choice, or the observed one when it is recent, else CLEAR. */
  level: WeatherLevel;
  source: 'OBSERVED' | 'MANUAL' | 'NONE';
  observed: (WeatherObservation & { label: string }) | null;
  notice: string; paddingMinutes: number;
}
export function weatherNotice(level: WeatherLevel, label: string, note: string): string {
  const extra = note ? ` ${note}` : '', what = label ? `（${label}）` : '';
  if (level === 'SEVERE') return `恶劣天气${what}：配送可能明显延迟，“尽快送达”的预计时间已多留 ${WEATHER_PADDING.SEVERE} 分钟；如需暂停接单会另行公告。${extra}`;
  if (level === 'WET') return `雨雪天气${what}：配送可能比平时慢一些，“尽快送达”的预计时间已多留 ${WEATHER_PADDING.WET} 分钟。${extra}`;
  return note;
}

// ---------------------------------------------------------------- on-time dashboard (准时率看板)
export const PUNCTUALITY_DAYS = [7, 14, 30] as const;
export const ASAP_TARGETS = [45, 60, 90] as const;
/**
 * On time: a booked-window order delivered by the end of its window; an "as soon as possible" order delivered within
 * the target minutes after payment. Delivered = the first DELIVERED_* status (courier marks it, or the door code).
 */
export interface PunctualityRow { key: string; label: string; delivered: number; onTime: number; avgMinutes: number | null }
export interface PunctualityReport {
  days: number; asapTarget: number; from: number; to: number;
  total: PunctualityRow;
  byCourier: PunctualityRow[]; byBuilding: PunctualityRow[]; bySlot: PunctualityRow[]; byDay: PunctualityRow[];
  byWeather: PunctualityRow[];
  /** Median minutes from payment to a courier claiming the order, and from pick-up to delivery. */
  claimMedian: number | null; rideMedian: number | null;
  late: { id: string; building: string; courier: string; slot: string; lateMinutes: number; deliveredAt: number }[];
}
export const rate = (r: { delivered: number; onTime: number }) => r.delivered ? r.onTime / r.delivered : null;

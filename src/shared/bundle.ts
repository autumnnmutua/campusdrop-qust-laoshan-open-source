/* © 2026 专业团队 · CampusDrop v4.7.0 · WM-A372E4790D8B1C09-59F098B48B */
import { z } from 'zod';
import { modeSchema, type Order } from './delivery.ts';
import { SLOT_CODES } from './slots.ts';
import { DROP_PLACES, type DropPlace } from './campus-map.ts';

/*
 * v3.8 · 多件下单 and 多件满减. Shared by the worker (validation, pricing) and the client (the order page shows the same
 * numbers before anything is sent). Pure functions here are unit-tested.
 *
 * 多件满减: paying for two or more parcels in one payment and reaching a tier takes the tier's amount off that payment
 * (default 满 15 元减 2 元, 满 20 元减 3 元; only the best tier counts). It is split over the parcels in proportion to
 * their price; a coupon then applies to what is left. Every parcel still pays at least 0.01 元.
 */
export interface BundleTier { minFen: number; offFen: number }
export interface BundleSetting { enabled: boolean; tiers: BundleTier[] }
export const DEFAULT_BUNDLE: BundleSetting = { enabled: true, tiers: [{ minFen: 1500, offFen: 200 }, { minFen: 2000, offFen: 300 }] };
/** 满减 needs at least this many parcels in the payment (it is a multi-parcel offer). */
export const BUNDLE_MIN_PARCELS = 2;
export const CHECKOUT_MAX_PARCELS = 10;

export interface BundleResult {
  /** Amount taken off the whole payment (0 when no tier applies). */
  discountFen: number;
  tier: BundleTier | null;
  /** The next better tier and how much more would reach it (shown as “再加 x 元可减 y 元”). */
  next: { tier: BundleTier; needFen: number } | null;
  /** False when the payment has fewer than BUNDLE_MIN_PARCELS parcels or the offer is switched off. */
  eligible: boolean;
}
const yuan = (fen: number) => (fen / 100).toFixed(fen % 100 ? (fen % 10 ? 2 : 1) : 0);
export const tierLabel = (t: BundleTier) => `满 ${yuan(t.minFen)} 减 ${yuan(t.offFen)}`;
export const tierLabelEn = (t: BundleTier) => `¥${yuan(t.offFen)} off from ¥${yuan(t.minFen)}`;

/** Tiers in ascending order of threshold. */
export const sortedTiers = (s: BundleSetting) => [...s.tiers].sort((a, b) => a.minFen - b.minFen);

export function bundleDiscount(setting: BundleSetting | null, amounts: number[]): BundleResult {
  const s = setting ?? DEFAULT_BUNDLE, total = amounts.reduce((a, b) => a + b, 0), tiers = sortedTiers(s);
  const eligible = s.enabled && tiers.length > 0 && amounts.length >= BUNDLE_MIN_PARCELS;
  if (!s.enabled || !tiers.length) return { discountFen: 0, tier: null, next: null, eligible: false };
  const reached = tiers.filter(t => t.minFen <= total).sort((a, b) => b.offFen - a.offFen)[0] ?? null;
  const better = tiers.find(t => t.minFen > total && t.offFen > (reached?.offFen ?? 0)) ?? null;
  const next = better ? { tier: better, needFen: better.minFen - total } : null;
  if (!eligible || !reached) return { discountFen: 0, tier: null, next, eligible };
  return { discountFen: Math.max(0, Math.min(reached.offFen, total - amounts.length)), tier: reached, next, eligible };
}

const tierSchema = z.object({ minFen: z.number().int().min(100).max(100000), offFen: z.number().int().min(1).max(10000) }).strict();
export const bundleSettingSchema = z.object({ enabled: z.boolean(), tiers: z.array(tierSchema).max(5) }).strict().superRefine((v, ctx) => {
  const bad = (message: string) => ctx.addIssue({ code: 'custom', path: ['tiers'], message });
  const tiers = sortedTiers(v);
  if (v.enabled && !tiers.length) bad('开启满减时至少需要一档');
  if (tiers.some(t => t.offFen >= t.minFen)) bad('减免金额需要小于门槛金额');
  if (new Set(tiers.map(t => t.minFen)).size !== tiers.length) bad('每档的门槛金额不能相同');
  if (tiers.some((t, i) => i > 0 && t.offFen <= tiers[i - 1].offFen)) bad('门槛越高，减免应越多');
});

// ---------------------------------------------------------------- 多件下单 request
const checkoutItem = z.object({ parcelId: z.uuid(), deliveryMode: modeSchema, dropPlace: z.enum(DROP_PLACES).optional() }).strict()
  .refine(v => v.dropPlace === undefined || v.deliveryMode === 'DOWNSTAIRS', '送到约定地点时请选择楼下配送价');
export const checkoutCreateSchema = z.object({
  items: z.array(checkoutItem).min(1, '请至少选择 1 件包裹').max(CHECKOUT_MAX_PARCELS, `一次最多 ${CHECKOUT_MAX_PARCELS} 件`)
    .refine(v => new Set(v.map(i => i.parcelId)).size === v.length, '包裹不能重复选择'),
  slotDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(), slotCode: z.enum(SLOT_CODES).optional(),
}).strict().refine(v => (v.slotDate === undefined) === (v.slotCode === undefined), '预约时段需同时提供日期和时段');
export type CheckoutCreate = z.infer<typeof checkoutCreateSchema>;

/** A trip inside a checkout: the parcels of one station going to one place (2 or more travel as a merged delivery). */
export interface CheckoutTrip {
  stationName: string; count: number; groupId: string | null;
  /** Chinese summary (for logs and older clients); pages compose their own text from the fields below. */
  destination: string; dropPlace: DropPlace | null; mode: 'DOWNSTAIRS' | 'ROOM'; buildingName: string;
}
export interface CheckoutDetail {
  id: string; createdAt: number; orders: Order[]; trips: CheckoutTrip[];
  /** Sums over the parcels not cancelled; coupon / bundle / paid cover the paid ones. */
  totalFen: number; unpaidFen: number; unpaidCount: number; couponFen: number; bundleFen: number; paidFen: number;
  /** v4.5 雨天配送费 on the paid parcels. */
  rainFen?: number;
  /** The door code shared by the checkout's parcels (student-only, once paid and while a parcel is on its way). */
  handoffCode: string | null;
}

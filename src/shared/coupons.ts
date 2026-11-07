/* © 2026 专业团队 · CampusDrop v4.0.0 */
import { z } from 'zod';
import type { BundleTier } from './bundle.ts';

/*
 * v3.7.1 · 优惠券 / 优惠码 for the delivery fee. Shared by the worker (validation, pricing) and the client (checkout,
 * admin form). Pure functions here are unit-tested.
 *
 * Two kinds of use, as the project owner asked:
 *  - 每个账号限用一次 (PER_ACCOUNT): every account may use the code (or its own personal coupon) once;
 *    an optional total cap limits how many accounts get it.
 *  - 全站只能用一次 (ONCE_TOTAL): the code works once on the whole site — the first account to pay with it.
 * Issued as a code people type (CODE), a personal coupon sent to named accounts (PERSONAL), or a coupon every new
 * account receives at registration (NEW_USER). Codes are matched case-insensitively.
 */
export const COUPON_CODE = /^[A-Z0-9]{3,20}$/;
/** Typed codes: case and spaces do not matter ("qust", " Qust " and "QUST" are the same code). */
export const normalizeCode = (raw: string) => raw.normalize('NFKC').replace(/\s+/g, '').toUpperCase();

export type CouponKind = 'CODE' | 'PERSONAL' | 'NEW_USER';
export type CouponUsage = 'PER_ACCOUNT' | 'ONCE_TOTAL';
export type DiscountType = 'RATE' | 'AMOUNT';

export interface CouponRule { discountType: DiscountType; discountValue: number; minSpendFen: number; maxDiscountFen: number | null }
/** One coupon as a student sees it at checkout or in “我的优惠券”. */
export interface CouponOption {
  id: string; name: string; summary: string; rule: CouponRule; source: 'WALLET' | 'CODE' | 'AUTO';
  code: string | null; expiresAt: number | null;
  /** Discount on the amount being paid, and what is left to pay; 0 / null when it does not apply (see reason). */
  discountFen: number; payFen: number | null; reason: string | null;
}
export interface CouponQuote {
  amountFen: number; orders: number; options: CouponOption[]; best: string | null; code?: { ok: boolean; message: string; id: string | null };
  /** v3.8 多件满减 on this payment (taken off before the coupon). */
  bundle?: { discountFen: number; tier: BundleTier | null; next: { tier: BundleTier; needFen: number } | null; eligible: boolean };
}
export interface AdminCoupon {
  id: string; name: string; kind: CouponKind; usage: CouponUsage; code: string | null; summary: string;
  discountType: DiscountType; discountValue: number; minSpendFen: number; maxDiscountFen: number | null; totalLimit: number | null;
  autoApply: boolean; validDays: number | null; startsAt: number | null; endsAt: number | null; status: 'ACTIVE' | 'DISABLED';
  used: number; granted: number; createdAt: number;
  /** A real starting coupon shown to the demo's super admin: usable in the demo, not editable. */
  readonly?: boolean;
}

const yuan = (fen: number) => (fen / 100).toFixed(fen % 100 ? (fen % 10 ? 2 : 1) : 0);
/** “五折”, “八五折”, “立减 1 元”, plus the threshold and cap. */
export function couponSummary(rule: CouponRule): string {
  const parts = [rule.discountType === 'RATE' ? rateLabel(rule.discountValue) : `立减 ${yuan(rule.discountValue)} 元`];
  if (rule.minSpendFen > 0) parts.push(`满 ${yuan(rule.minSpendFen)} 元可用`);
  if (rule.discountType === 'RATE' && rule.maxDiscountFen) parts.push(`最多减 ${yuan(rule.maxDiscountFen)} 元`);
  return parts.join(' · ');
}
/** The same summary in English (the page translates; coupon names stay as the operator wrote them). */
export function couponSummaryEn(rule: CouponRule): string {
  const parts = [rule.discountType === 'RATE' ? `${100 - rule.discountValue}% off` : `¥${yuan(rule.discountValue)} off`];
  if (rule.minSpendFen > 0) parts.push(`on orders from ¥${yuan(rule.minSpendFen)}`);
  if (rule.discountType === 'RATE' && rule.maxDiscountFen) parts.push(`up to ¥${yuan(rule.maxDiscountFen)}`);
  return parts.join(' · ');
}
/** 50 → 五折, 85 → 八五折, 88 → 八八折, 95 → 九五折 (Chinese “折” counts what is still paid). */
export function rateLabel(rate: number): string {
  const d = ['零', '一', '二', '三', '四', '五', '六', '七', '八', '九'];
  return rate % 10 ? `${d[Math.floor(rate / 10)]}${d[rate % 10]}折` : `${d[rate / 10]}折`;
}

/**
 * Discount for paying `amounts` (fen, one per order) together, or 0 when the coupon does not apply.
 * Every order still pays at least 0.01 元 (a payment is never zero).
 */
export function couponDiscount(rule: CouponRule, amounts: number[]): number {
  const total = amounts.reduce((a, b) => a + b, 0);
  if (!amounts.length || total < rule.minSpendFen) return 0;
  let d = rule.discountType === 'RATE' ? Math.floor(total * (100 - rule.discountValue) / 100) : rule.discountValue;
  if (rule.discountType === 'RATE' && rule.maxDiscountFen) d = Math.min(d, rule.maxDiscountFen);
  return Math.max(0, Math.min(d, total - amounts.length));
}
/** Splits a discount over the orders in proportion to their price; each order keeps at least 1 fen to pay. */
export function splitDiscount(discount: number, amounts: number[]): number[] {
  const total = amounts.reduce((a, b) => a + b, 0);
  if (!discount || !total) return amounts.map(() => 0);
  const share = amounts.map(a => Math.min(a - 1, Math.floor(discount * a / total)));
  let left = discount - share.reduce((a, b) => a + b, 0);
  // Hand out what rounding left over, biggest orders first, never below 1 fen to pay.
  const order = amounts.map((a, i) => i).sort((x, y) => amounts[y] - amounts[x]);
  while (left > 0) {
    let moved = false;
    for (const i of order) { if (left && share[i] < amounts[i] - 1) { share[i]++; left--; moved = true; } }
    if (!moved) break;
  }
  return share;
}

// ---------------------------------------------------------------- request schemas
const couponIdField = z.uuid();
/** Paying: an explicit coupon (with its code when it is a typed code), or none. */
export const payWithCouponSchema = z.object({ couponId: couponIdField.optional(), code: z.string().trim().min(1).max(40).optional() }).strict();
export const couponQuoteQuery = z.object({ orderId: z.uuid().optional(), groupId: z.uuid().optional(), checkoutId: z.uuid().optional(), code: z.string().trim().max(40).optional() }).strict()
  .refine(v => [v.orderId, v.groupId, v.checkoutId].filter(Boolean).length === 1, { message: 'orderId、groupId、checkoutId 三选一' });
const usernames = z.array(z.string().trim().min(3).max(32).regex(/^[A-Za-z0-9_]+$/)).max(100);
export const couponCreateSchema = z.object({
  name: z.string().trim().min(1).max(40),
  kind: z.enum(['CODE', 'PERSONAL', 'NEW_USER']),
  usage: z.enum(['PER_ACCOUNT', 'ONCE_TOTAL']),
  code: z.string().max(40).optional(),
  discountType: z.enum(['RATE', 'AMOUNT']),
  /** RATE: share still paid in percent (10–95); AMOUNT: fen off (1–5000). */
  discountValue: z.number().int(),
  minSpendFen: z.number().int().min(0).max(100000).default(0),
  maxDiscountFen: z.number().int().min(1).max(100000).nullable().optional(),
  totalLimit: z.number().int().min(1).max(1000000).nullable().optional(),
  autoApply: z.boolean().default(false),
  validDays: z.number().int().min(1).max(366).nullable().optional(),
  endsAt: z.number().int().positive().nullable().optional(),
  usernames: usernames.optional(),
}).strict().superRefine((v, ctx) => {
  const bad = (path: string, message: string) => ctx.addIssue({ code: 'custom', path: [path], message });
  if (v.discountType === 'RATE' && (v.discountValue < 10 || v.discountValue > 95)) bad('discountValue', '折扣需在一折到九五折之间');
  if (v.discountType === 'AMOUNT' && (v.discountValue < 1 || v.discountValue > 5000)) bad('discountValue', '立减金额需在 0.01–50 元之间');
  if (v.kind === 'CODE' && !COUPON_CODE.test(normalizeCode(v.code ?? ''))) bad('code', '优惠码为 3–20 位字母或数字');
  if (v.kind !== 'CODE' && v.autoApply) bad('autoApply', '只有优惠码可以设置自动匹配');
  if (v.kind === 'PERSONAL' && !v.usernames?.length) bad('usernames', '专属券需要填写至少一个用户名');
  if (v.kind === 'NEW_USER' && v.usage === 'ONCE_TOTAL') bad('usage', '新人券每个新账号各一张，不能设为全站只用一次');
});
export type CouponCreate = z.infer<typeof couponCreateSchema>;
export const couponStatusSchema = z.object({ status: z.enum(['ACTIVE', 'DISABLED']) }).strict();

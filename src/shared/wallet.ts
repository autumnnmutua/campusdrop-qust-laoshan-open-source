/* © 2026 专业团队 · CampusDrop v4.5.0 */
import { z } from 'zod';

/*
 * v3.9 · platform fee and the courier wallet (simulated money, like every payment on the site).
 * The platform keeps PLATFORM_FEE_FEN of every delivered parcel (配送 and 代寄件); the courier gets the rest of the
 * fee at full price (coupons and 满减 are borne by the platform) plus every tip. Couriers withdraw to WeChat, Alipay
 * or a bank card; a super admin reviews each request. Only masked account details are ever stored.
 */
export const PLATFORM_FEE_FEN = 20;
export const WITHDRAW_MIN_FEN = 100;
export const WITHDRAW_MAX_FEN = 500000;
export const WITHDRAW_MAX_PENDING = 3;
export const PAYOUT_ACCOUNTS_MAX = 5;

/** What the courier earns for one order with this full fee (never below 0). */
export const courierEarning = (feeFen: number) => Math.max(0, feeFen - PLATFORM_FEE_FEN);

export type PayoutMethod = 'WECHAT' | 'ALIPAY' | 'BANK';
export const PAYOUT_METHOD_LABELS: Record<PayoutMethod, string> = { WECHAT: '微信', ALIPAY: '支付宝', BANK: '银行卡' };
export type LedgerKind = 'DELIVERY' | 'SEND' | 'TIP' | 'WITHDRAW' | 'WITHDRAW_RETURN';
export const LEDGER_LABELS: Record<LedgerKind, string> = { DELIVERY: '配送收入', SEND: '代寄件收入', TIP: '打赏', WITHDRAW: '提现', WITHDRAW_RETURN: '提现退回' };
export type WithdrawStatus = 'PENDING' | 'PAID' | 'REJECTED';
export const WITHDRAW_STATUS_LABELS: Record<WithdrawStatus, string> = { PENDING: '审核中', PAID: '已到账（模拟）', REJECTED: '已退回' };

/** Bank card numbers: 12–19 digits passing the Luhn check (UnionPay cards follow it as well). */
export function luhnValid(digits: string): boolean {
  if (!/^\d{12,19}$/.test(digits)) return false;
  let sum = 0;
  for (let i = 0; i < digits.length; i++) {
    let d = Number(digits[digits.length - 1 - i]);
    if (i % 2 === 1) { d *= 2; if (d > 9) d -= 9; }
    sum += d;
  }
  return sum % 10 === 0;
}
/** "6222 **** **** 1234", "138****5678", "ab***z@qq.com", "wx***89". Only this and the last four are kept. */
export function maskAccount(method: PayoutMethod, raw: string): { masked: string; last4: string } {
  const v = raw.replace(/\s+/g, '');
  if (method === 'BANK') return { masked: `${v.slice(0, 4)} **** **** ${v.slice(-4)}`, last4: v.slice(-4) };
  if (/^1\d{10}$/.test(v)) return { masked: `${v.slice(0, 3)}****${v.slice(-4)}`, last4: v.slice(-4) };
  const at = v.indexOf('@');
  if (at > 0) { const name = v.slice(0, at); return { masked: `${name.slice(0, Math.min(2, name.length))}***${v.slice(at)}`, last4: name.slice(-Math.min(4, name.length)) }; }
  return { masked: `${v.slice(0, 2)}***${v.slice(-2)}`, last4: v.slice(-Math.min(4, v.length)) };
}
export const accountLabel = (a: { method: PayoutMethod; accountMasked: string; bankName?: string | null }) =>
  a.method === 'BANK' ? `${a.bankName ?? '银行卡'} ${a.accountMasked}` : `${PAYOUT_METHOD_LABELS[a.method]} ${a.accountMasked}`;

const name = z.string().trim().min(1, '请填写收款人姓名').max(20).refine(v => !/[<>\p{Cc}]/u.test(v), '请使用普通文字');
export const payoutAccountSchema = z.object({
  method: z.enum(['WECHAT', 'ALIPAY', 'BANK']),
  accountName: name,
  account: z.string().trim().min(2).max(40),
  bankName: z.string().trim().min(2).max(20).optional(),
}).strict().superRefine((v, ctx) => {
  const bad = (path: string, message: string) => ctx.addIssue({ code: 'custom', path: [path], message });
  const raw = v.account.replace(/\s+/g, '');
  if (v.method === 'BANK') {
    if (!luhnValid(raw)) bad('account', '银行卡号不正确，请核对（12–19 位数字）');
    if (!v.bankName) bad('bankName', '请填写开户银行');
  } else {
    if (v.bankName) bad('bankName', '只有银行卡需要开户银行');
    if (v.method === 'WECHAT' && !/^(1\d{10}|[A-Za-z][-_A-Za-z0-9]{5,19})$/.test(raw)) bad('account', '请填写微信号（6–20 位，字母开头）或绑定的手机号');
    if (v.method === 'ALIPAY' && !/^(1\d{10}|[^\s@]{1,40}@[^\s@]+\.[A-Za-z]{2,})$/.test(raw)) bad('account', '请填写支付宝账号（手机号或邮箱）');
  }
});
export type PayoutAccountInput = z.infer<typeof payoutAccountSchema>;
export const withdrawSchema = z.object({
  accountId: z.uuid(),
  amountFen: z.number().int().min(WITHDRAW_MIN_FEN, '单次最少提现 1 元').max(WITHDRAW_MAX_FEN, '单次最多提现 5000 元'),
}).strict();
export const withdrawReviewSchema = z.object({
  action: z.enum(['PAY', 'REJECT']),
  note: z.string().trim().max(120).default(''),
}).strict().refine(v => v.action === 'PAY' || v.note.length >= 2, { message: '退回时请写明原因', path: ['note'] });

export interface PayoutAccount { id: string; method: PayoutMethod; accountName: string; accountMasked: string; bankName: string | null; createdAt: number }
export interface LedgerEntry { id: string; kind: LedgerKind; refId: string; grossFen: number; feeFen: number; amountFen: number; createdAt: number }
export interface Withdrawal { id: string; adminId: string; username?: string; method: PayoutMethod; accountLabel: string; amountFen: number; status: WithdrawStatus; note: string; reviewedAt: number | null; paidRef: string | null; createdAt: number }
export interface Wallet {
  balanceFen: number; pendingFen: number; earnedFen: number; feeFen: number; withdrawnFen: number;
  /** This week and in total: delivered parcels counted in the wallet. */
  parcels: number; tipsFen: number;
  accounts: PayoutAccount[]; withdrawals: Withdrawal[]; entries: LedgerEntry[];
}

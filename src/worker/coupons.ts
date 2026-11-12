/* © 2026 专业团队 · CampusDrop v4.7.0 · WM-A372E4790D8B1C09-32619791A3 */
import type { Env } from './types';
import { rainSurchargeNow } from './weather';
import { rainNotice } from '../shared/v3';
import type { Admin, Student } from '../shared/contracts';
import { ApiError, body, json } from './http';
import { requireAdmin, requireStudent, requireSuperView } from './session';
import { rateLimit } from './rate-limit';
import { bundleFor, payableOrders } from './payment';
import {
  COUPON_CODE, couponCreateSchema, couponDiscount, couponQuoteQuery, couponStatusSchema, couponSummary, normalizeCode, splitDiscount,
  type AdminCoupon, type CouponOption, type CouponQuote, type CouponRule,
} from '../shared/coupons';

/*
 * v3.7.1 · coupons (shared/coupons.ts has the rules and the arithmetic). Students: GET /coupons (wallet),
 * GET /coupons/quote (checkout options and the cheapest one), and pay with { couponId, code } through the usual
 * mock-pay endpoints. Super admins: /admin/coupons. Everything stays inside its world: a demo's coupons only reach
 * that demo's accounts, and real coupons used inside a demo do not count against their real total.
 */
const now = () => Math.floor(Date.now() / 1000);

interface CouponRow {
  id: string; code: string | null; name: string; scope: 'PERSONAL' | 'PUBLIC'; discountType: 'RATE' | 'AMOUNT'; discountValue: number;
  minSpendFen: number; maxDiscountFen: number | null; totalLimit: number | null; autoApply: number; grantOnRegister: number; validDays: number | null;
  startsAt: number | null; endsAt: number | null; status: 'ACTIVE' | 'DISABLED'; demoGroup: string | null; createdAt: number;
}
const COLS = `c.id,c.code,c.name,c.scope,c.discount_type AS discountType,c.discount_value AS discountValue,c.min_spend_fen AS minSpendFen,
  c.max_discount_fen AS maxDiscountFen,c.total_limit AS totalLimit,c.auto_apply AS autoApply,c.grant_on_register AS grantOnRegister,c.valid_days AS validDays,
  c.starts_at AS startsAt,c.ends_at AS endsAt,c.status,c.demo_group AS demoGroup,c.created_at AS createdAt`;
const rule = (c: CouponRow): CouponRule => ({ discountType: c.discountType, discountValue: c.discountValue, minSpendFen: c.minSpendFen, maxDiscountFen: c.maxDiscountFen });
const groupOf = async (env: Env, table: 'users' | 'admin_users', id: string) => env.DB.prepare(`SELECT demo_group AS g FROM ${table} WHERE id=?`).bind(id).first<string | null>('g');
/** Uses that count against a coupon's total: those made in the same world (real, or this demo). */
const USED_IN_WORLD = `(SELECT count(*) FROM coupon_redemptions r JOIN users ru ON ru.id=r.user_id WHERE r.coupon_id=c.id AND r.status='USED' AND coalesce(ru.demo_group,'')=coalesce(?,''))`;

type Candidate = CouponRow & { grantExpires: number | null; usedWorld: number; usedByMe: number; matchedByCode: number };
/** Coupons this student could use now: personal grants, auto-applied public coupons, and the typed code. */
async function candidates(env: Env, user: Pick<Student, 'id'>, code: string | null): Promise<Candidate[]> {
  const t = now(), group = await groupOf(env, 'users', user.id);
  const rows = (await env.DB.prepare(`SELECT ${COLS},g.expires_at AS grantExpires,${USED_IN_WORLD} AS usedWorld,
      EXISTS(SELECT 1 FROM coupon_redemptions r WHERE r.coupon_id=c.id AND r.user_id=? AND r.status='USED') AS usedByMe,
      (c.code IS NOT NULL AND c.code=?) AS matchedByCode
    FROM coupons c LEFT JOIN coupon_grants g ON g.coupon_id=c.id AND g.user_id=?
    WHERE c.status='ACTIVE' AND (c.starts_at IS NULL OR c.starts_at<=?) AND (c.ends_at IS NULL OR c.ends_at>?)
      AND ((c.demo_group IS NULL AND (? IS NULL OR c.created_by IS NULL)) OR c.demo_group=?)
      AND ((c.scope='PERSONAL' AND g.id IS NOT NULL AND (g.expires_at IS NULL OR g.expires_at>?)) OR (c.scope='PUBLIC' AND (c.auto_apply=1 OR c.code=?)))
    ORDER BY c.created_at`).bind(group, user.id, code, user.id, t, t, group, group, t, code).all<Candidate>()).results;
  // The same code inside a demo and on the real site: the demo's own wins for a demo account.
  const preferred = new Map<string, Candidate>();
  for (const r of rows) if (r.code) { const seen = preferred.get(r.code); if (!seen || (r.demoGroup && !seen.demoGroup)) preferred.set(r.code, r); }
  return rows.filter(r => !r.code || preferred.get(r.code) === r);
}
function evaluate(c: Candidate, amounts: number[]): CouponOption {
  const total = amounts.reduce((a, b) => a + b, 0);
  let reason: string | null = null;
  if (c.usedByMe) reason = '这个账号已经用过';
  else if (c.totalLimit !== null && c.usedWorld >= c.totalLimit) reason = c.totalLimit === 1 ? '已被别的同学用掉了（全站只能用一次）' : '已经被领完了';
  else if (total < c.minSpendFen) reason = `满 ${(c.minSpendFen / 100).toFixed(2)} 元可用`;
  const discount = reason ? 0 : couponDiscount(rule(c), amounts);
  if (!reason && discount <= 0) reason = '金额太小，用不了这张券';
  const expiresAt = c.scope === 'PERSONAL' ? c.grantExpires ?? c.endsAt : c.endsAt;
  return { id: c.id, name: c.name, summary: couponSummary(rule(c)), rule: rule(c), source: c.scope === 'PERSONAL' ? 'WALLET' : c.autoApply ? 'AUTO' : 'CODE', code: c.scope === 'PUBLIC' && !c.autoApply ? c.code : null,
    expiresAt, discountFen: discount, payFen: discount ? total - discount : null, reason };
}

export interface Payable { id: string; amountFen: number }

/**
 * Checkout options for one order, a merged group or a 多件下单 checkout (v3.8). 多件满减 comes off first; the coupons
 * are then evaluated on what is left, exactly as the payment will do.
 */
export async function quote(env: Env, user: Student, target: { orderId?: string; groupId?: string; checkoutId?: string }, rawCode?: string): Promise<CouponQuote> {
  const orders = await payableOrders(env, user.id, target), amounts = orders.map(o => o.amountFen);
  const bundle = await bundleFor(env, amounts), left = amounts.map((a, i) => a - bundle.shares[i]);
  const code = rawCode ? normalizeCode(rawCode) : null;
  if (code) await rateLimit(env, `coupon-code:${user.id}`, 30);
  const list = await candidates(env, user, code && COUPON_CODE.test(code) ? code : null);
  const options = list.map(c => evaluate(c, left)).sort((a, b) => b.discountFen - a.discountFen);
  const best = options.find(o => o.discountFen > 0 && o.source !== 'CODE') ?? null;
  const result: CouponQuote = { amountFen: amounts.reduce((a, b) => a + b, 0), orders: orders.length, options, best: best?.id ?? null,
    bundle: { discountFen: bundle.discountFen, tier: bundle.tier, next: bundle.next, eligible: bundle.eligible } };
  if (orders.length) { const rain = await rainSurchargeNow(env); result.rain = { fen: rain.fen, label: rain.label, notice: rainNotice(rain.fen > 0, rain.label) }; }
  if (code) {
    const hit = list.find(c => c.code === code), option = hit && options.find(o => o.id === hit.id);
    result.code = !hit ? { ok: false, message: '优惠码不存在、已过期或已停用', id: null }
      : option?.reason ? { ok: false, message: option.reason, id: hit.id } : { ok: true, message: `已使用优惠码，${option?.summary ?? ''}`, id: hit.id };
    // A valid typed code becomes the suggestion when it is the better deal.
    if (result.code.ok && option && option.discountFen >= (best?.discountFen ?? 0)) result.best = hit!.id;
  }
  return result;
}

/**
 * The statements that attach a coupon to a payment: one redemption (refused when the account already used it, or the
 * total is used up), then the discount on each order — only when that redemption exists. The payment INSERTs must
 * require `coupon_redemption_id` so that a refused coupon never turns into a full-price payment.
 */
export async function couponForPayment(env: Env, user: Pick<Student, 'id'>, orders: Payable[], choice: { couponId?: string; code?: string }):
  Promise<{ redemptionId: string; statements: D1PreparedStatement[]; shares: Map<string, number> } | null> {
  if (!choice.couponId) return null;
  const code = choice.code ? normalizeCode(choice.code) : null;
  const c = (await candidates(env, user, code)).find(x => x.id === choice.couponId);
  // A typed code must come with the code itself: knowing an id is not enough.
  if (!c || (c.scope === 'PUBLIC' && !c.autoApply && c.code !== code)) throw new ApiError(409, 'COUPON_UNAVAILABLE', '这张优惠券现在不能用，请重新选择');
  const option = evaluate(c, orders.map(o => o.amountFen));
  if (option.reason || !option.discountFen) throw new ApiError(409, 'COUPON_UNAVAILABLE', option.reason ?? '这张优惠券现在不能用');
  const shares = splitDiscount(option.discountFen, orders.map(o => o.amountFen)), redemptionId = crypto.randomUUID();
  const group = await groupOf(env, 'users', user.id);
  const statements = [
    env.DB.prepare(`INSERT INTO coupon_redemptions(id,coupon_id,user_id,discount_fen)
      SELECT ?,c.id,?,? FROM coupons c WHERE c.id=? AND c.status='ACTIVE'
      AND (c.starts_at IS NULL OR c.starts_at<=unixepoch()) AND (c.ends_at IS NULL OR c.ends_at>unixepoch())
      AND ((c.scope='PERSONAL' AND EXISTS(SELECT 1 FROM coupon_grants g WHERE g.coupon_id=c.id AND g.user_id=? AND (g.expires_at IS NULL OR g.expires_at>unixepoch())))
        OR (c.scope='PUBLIC' AND (c.auto_apply=1 OR c.code=?)))
      AND NOT EXISTS(SELECT 1 FROM coupon_redemptions r WHERE r.coupon_id=c.id AND r.user_id=? AND r.status='USED')
      AND (c.total_limit IS NULL OR ${USED_IN_WORLD}<c.total_limit)`).bind(redemptionId, user.id, option.discountFen, c.id, user.id, code, user.id, group),
    ...orders.map((o, i) => env.DB.prepare(`UPDATE delivery_orders SET discount_fen=?,coupon_redemption_id=? WHERE id=? AND user_id=? AND status='WAITING_PAYMENT'
      AND EXISTS(SELECT 1 FROM coupon_redemptions WHERE id=?)`).bind(shares[i], redemptionId, o.id, user.id, redemptionId)),
  ];
  return { redemptionId, statements, shares: new Map(orders.map((o, i) => [o.id, shares[i]])) };
}
/** Runs a payment batch; two payments racing for the same coupon end in a clear message instead of a server error. */
export async function couponBatch(env: Env, statements: D1PreparedStatement[]): Promise<void> {
  try { await env.DB.batch(statements); }
  catch (error) {
    if (/UNIQUE constraint failed: coupon_redemptions|DISCOUNT_FIXED/.test(String(error))) throw new ApiError(409, 'COUPON_UNAVAILABLE', '这张优惠券刚刚被用掉了，请重新选择');
    throw error;
  }
}
/** After a payment: orders that did not get paid (window full) drop the discount; a use with nothing paid is released. */
export async function settleCoupon(env: Env, redemptionId: string): Promise<{ paid: number }> {
  const rows = (await env.DB.prepare(`SELECT o.id,o.discount_fen AS d,EXISTS(SELECT 1 FROM payments p WHERE p.order_id=o.id AND p.type='DELIVERY') AS paid
    FROM delivery_orders o WHERE o.coupon_redemption_id=?`).bind(redemptionId).all<{ id: string; d: number; paid: number }>()).results;
  const unpaid = rows.filter(r => !r.paid), paidDiscount = rows.filter(r => r.paid).reduce((a, r) => a + r.d, 0);
  if (!unpaid.length) return { paid: rows.length };
  await env.DB.batch([
    ...unpaid.map(r => env.DB.prepare("UPDATE delivery_orders SET discount_fen=0,coupon_redemption_id=NULL WHERE id=? AND status='WAITING_PAYMENT'").bind(r.id)),
    paidDiscount ? env.DB.prepare('UPDATE coupon_redemptions SET discount_fen=? WHERE id=?').bind(paidDiscount, redemptionId)
      : env.DB.prepare("UPDATE coupon_redemptions SET status='RELEASED',released_at=unixepoch() WHERE id=? AND status='USED'").bind(redemptionId),
  ]);
  return { paid: rows.length - unpaid.length };
}

/** New accounts receive every active new-user coupon of their world (registration; one-click demo students). */
export function grantOnRegister(env: Env, userId: string, demoGroup: string | null = null): D1PreparedStatement {
  return env.DB.prepare(`INSERT OR IGNORE INTO coupon_grants(id,coupon_id,user_id,granted_at,expires_at)
    SELECT lower(hex(randomblob(16))),c.id,?,unixepoch(),CASE WHEN c.valid_days IS NULL THEN c.ends_at ELSE unixepoch()+c.valid_days*86400 END
    FROM coupons c WHERE c.grant_on_register=1 AND c.status='ACTIVE' AND (c.ends_at IS NULL OR c.ends_at>unixepoch())
    AND ((c.demo_group IS NULL AND (?2 IS NULL OR c.created_by IS NULL)) OR c.demo_group=?2)`).bind(userId, demoGroup);
}

/** “我的优惠券”: personal coupons (unused, used, expired) and the ones applied automatically. */
async function wallet(env: Env, user: Student) {
  const t = now(), group = await groupOf(env, 'users', user.id);
  const rows = (await env.DB.prepare(`SELECT ${COLS},g.expires_at AS grantExpires,
      EXISTS(SELECT 1 FROM coupon_redemptions r WHERE r.coupon_id=c.id AND r.user_id=? AND r.status='USED') AS used
    FROM coupons c LEFT JOIN coupon_grants g ON g.coupon_id=c.id AND g.user_id=?
    WHERE ((c.demo_group IS NULL AND (?3 IS NULL OR c.created_by IS NULL)) OR c.demo_group=?3) AND ((c.scope='PERSONAL' AND g.id IS NOT NULL) OR (c.scope='PUBLIC' AND c.auto_apply=1 AND c.status='ACTIVE'))
    ORDER BY c.created_at DESC LIMIT 50`).bind(user.id, user.id, group).all<CouponRow & { grantExpires: number | null; used: number }>()).results;
  return rows.map(c => {
    const expiresAt = c.grantExpires ?? c.endsAt;
    const state = c.used ? 'USED' : c.status !== 'ACTIVE' || (expiresAt !== null && expiresAt <= t) ? 'EXPIRED' : 'AVAILABLE';
    return { id: c.id, name: c.name, summary: couponSummary(rule(c)), rule: rule(c), expiresAt, state };
  });
}

// ---------------------------------------------------------------- admin
const kindOf = (c: CouponRow): AdminCoupon['kind'] => c.scope === 'PUBLIC' ? 'CODE' : c.grantOnRegister ? 'NEW_USER' : 'PERSONAL';
async function adminList(env: Env, admin: Admin): Promise<AdminCoupon[]> {
  const group = await groupOf(env, 'admin_users', admin.id);
  const rows = (await env.DB.prepare(`SELECT ${COLS},${USED_IN_WORLD} AS used,(SELECT count(*) FROM coupon_grants g WHERE g.coupon_id=c.id) AS granted
    FROM coupons c WHERE coalesce(c.demo_group,'')=coalesce(?2,'') OR (?2 IS NOT NULL AND c.demo_group IS NULL AND c.created_by IS NULL)
    ORDER BY c.demo_group IS NULL,c.created_at DESC LIMIT 100`).bind(group, group).all<CouponRow & { used: number; granted: number }>()).results;
  return rows.map(c => ({
    id: c.id, name: c.name, kind: kindOf(c), usage: c.totalLimit === 1 ? 'ONCE_TOTAL' : 'PER_ACCOUNT', code: c.code, summary: couponSummary(rule(c)),
    discountType: c.discountType, discountValue: c.discountValue, minSpendFen: c.minSpendFen, maxDiscountFen: c.maxDiscountFen, totalLimit: c.totalLimit,
    autoApply: Boolean(c.autoApply), validDays: c.validDays, startsAt: c.startsAt, endsAt: c.endsAt, status: c.status, used: c.used, granted: c.granted, createdAt: c.createdAt,
    // The demo's super admin sees the real starting codes too (to try them), but cannot change them.
    ...(group && !c.demoGroup ? { readonly: true } : {}),
  }));
}
async function adminCreate(env: Env, admin: Admin, request: Request): Promise<string> {
  const d = await body(request, couponCreateSchema), group = await groupOf(env, 'admin_users', admin.id), id = crypto.randomUUID(), t = now();
  if (d.endsAt && d.endsAt <= t) throw new ApiError(400, 'INVALID_INPUT', '截止时间需要晚于现在');
  const code = d.kind === 'CODE' ? normalizeCode(d.code ?? '') : null;
  const totalLimit = d.usage === 'ONCE_TOTAL' ? 1 : d.totalLimit ?? null;
  let users: { id: string; username: string }[] = [];
  if (d.kind === 'PERSONAL') {
    const names = [...new Set(d.usernames!.map(u => u.toLowerCase()))];
    users = (await env.DB.prepare(`SELECT id,username FROM users WHERE lower(username) IN (${names.map(() => '?').join(',')}) AND status='ACTIVE' AND deleted_at IS NULL
      AND coalesce(demo_group,'')=coalesce(?,'')`).bind(...names, group).all<{ id: string; username: string }>()).results;
    const missing = names.filter(n => !users.some(u => u.username.toLowerCase() === n));
    if (missing.length) throw new ApiError(400, 'COUPON_USERS_MISSING', `找不到这些学生账号：${missing.slice(0, 8).join('、')}${missing.length > 8 ? ' 等' : ''}`);
  }
  const expires = d.validDays ? t + d.validDays * 86400 : d.endsAt ?? null;
  try {
    await env.DB.batch([
      env.DB.prepare(`INSERT INTO coupons(id,code,name,scope,discount_type,discount_value,min_spend_fen,max_discount_fen,total_limit,auto_apply,grant_on_register,valid_days,ends_at,demo_group,created_by)
        VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(id, code, d.name, d.kind === 'CODE' ? 'PUBLIC' : 'PERSONAL', d.discountType, d.discountValue, d.minSpendFen,
        d.discountType === 'RATE' ? d.maxDiscountFen ?? null : null, totalLimit, d.autoApply ? 1 : 0, d.kind === 'NEW_USER' ? 1 : 0, d.validDays ?? null, d.endsAt ?? null, group, admin.id),
      ...users.map(u => env.DB.prepare('INSERT INTO coupon_grants(id,coupon_id,user_id,expires_at) VALUES(?,?,?,?)').bind(crypto.randomUUID(), id, u.id, expires)),
      env.DB.prepare("INSERT INTO audit_logs(id,actor_type,actor_id,action,resource_id,metadata_redacted) VALUES(?,'ADMIN',?,'COUPON_CREATED',?,json_object('kind',?,'code',?,'grants',?))")
        .bind(crypto.randomUUID(), admin.id, id, d.kind, code, users.length),
    ]);
  } catch (error) {
    if (String(error).includes('UNIQUE constraint')) throw new ApiError(409, 'COUPON_CODE_TAKEN', '这个优惠码已经存在，换一个吧');
    throw error;
  }
  return id;
}

export async function couponRoutes(request: Request, env: Env): Promise<Response | null> {
  const url = new URL(request.url), path = url.pathname.replace(/^\/api\/v1/, ''), method = request.method;
  if (path === '/coupons' && method === 'GET') return json({ coupons: await wallet(env, await requireStudent(request, env)) });
  if (path === '/coupons/quote' && method === 'GET') {
    const user = await requireStudent(request, env);
    const q = couponQuoteQuery.safeParse(Object.fromEntries(url.searchParams));
    if (!q.success) throw new ApiError(400, 'INVALID_FILTER', '请指定要支付的订单');
    return json({ quote: await quote(env, user, q.data, q.data.code) });
  }
  if (path === '/admin/coupons') {
    const admin = await requireAdmin(request, env); requireSuperView(admin);
    if (method === 'GET') return json({ coupons: await adminList(env, admin) });
    if (method === 'POST') { await rateLimit(env, `coupon-create:${admin.id}`, 30); return json({ id: await adminCreate(env, admin, request) }, 201); }
  }
  const status = /^\/admin\/coupons\/([a-f0-9-]{36})\/status$/.exec(path);
  if (status && method === 'PUT') {
    const admin = await requireAdmin(request, env); requireSuperView(admin);
    const d = await body(request, couponStatusSchema), group = await groupOf(env, 'admin_users', admin.id);
    const r = await env.DB.prepare("UPDATE coupons SET status=? WHERE id=? AND coalesce(demo_group,'')=coalesce(?,'')").bind(d.status, status[1], group).run();
    if (!r.meta.changes) throw new ApiError(404, 'NOT_FOUND', '优惠券不存在，或不在你可以管理的范围');
    await env.DB.prepare("INSERT INTO audit_logs(id,actor_type,actor_id,action,resource_id) VALUES(?,'ADMIN',?,?,?)").bind(crypto.randomUUID(), admin.id, d.status === 'ACTIVE' ? 'COUPON_ENABLED' : 'COUPON_DISABLED', status[1]).run();
    return json({ ok: true });
  }
  return null;
}

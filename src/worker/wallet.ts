/* © 2026 专业团队 · CampusDrop v4.0.0 */
import type { Env } from './types';
import type { Admin } from '../shared/contracts';
import { ApiError, body, json } from './http';
import { requireAdmin, requireSuperView } from './session';
import { rateLimit } from './rate-limit';
import {
  PAYOUT_ACCOUNTS_MAX, WITHDRAW_MAX_PENDING, accountLabel, maskAccount, payoutAccountSchema, withdrawReviewSchema, withdrawSchema,
  type LedgerEntry, type PayoutAccount, type Wallet, type Withdrawal,
} from '../shared/wallet';

/*
 * v3.9 · courier wallet and withdrawals (migration 0018 has the ledger and its triggers; shared/wallet.ts the rules).
 * Every admin has a wallet (couriers use it; a super admin who delivers too). Withdrawals are reviewed by a super
 * admin of the same world: the real site's, or — inside a one-click demo — the demo's own 超级管理员 for the demo's
 * courier. All money is simulated; payout accounts are stored masked.
 */
const SAME_WORLD = "coalesce(a.demo_group,'')=coalesce((SELECT demo_group FROM admin_users WHERE id=?),'')";
const ACCOUNT_COLS = 'id,method,account_name AS accountName,account_masked AS accountMasked,bank_name AS bankName,created_at AS createdAt';
const WITHDRAW_COLS = `w.id,w.admin_id AS adminId,a.username,w.method,w.account_label AS accountLabel,w.amount_fen AS amountFen,w.status,w.note,w.reviewed_at AS reviewedAt,w.paid_ref AS paidRef,w.created_at AS createdAt`;

async function wallet(env: Env, admin: Admin): Promise<Wallet> {
  const [sums, totals, accounts, withdrawals, entries] = await Promise.all([
    env.DB.prepare(`SELECT coalesce(sum(amount_fen),0) AS balance,
        coalesce(sum(CASE WHEN kind IN ('DELIVERY','SEND','TIP') THEN amount_fen END),0) AS earned,
        coalesce(sum(fee_fen),0) AS fee, coalesce(sum(CASE WHEN kind IN ('DELIVERY','SEND') THEN 1 END),0) AS parcels,
        coalesce(sum(CASE WHEN kind='TIP' THEN amount_fen END),0) AS tips FROM courier_ledger WHERE admin_id=?`).bind(admin.id)
      .first<{ balance: number; earned: number; fee: number; parcels: number; tips: number }>(),
    env.DB.prepare(`SELECT coalesce(sum(CASE WHEN status='PENDING' THEN amount_fen END),0) AS pending,coalesce(sum(CASE WHEN status='PAID' THEN amount_fen END),0) AS paid
      FROM courier_withdrawals WHERE admin_id=?`).bind(admin.id).first<{ pending: number; paid: number }>(),
    env.DB.prepare(`SELECT ${ACCOUNT_COLS} FROM courier_payout_accounts WHERE admin_id=? AND removed_at IS NULL ORDER BY created_at`).bind(admin.id).all<PayoutAccount>(),
    env.DB.prepare(`SELECT ${WITHDRAW_COLS} FROM courier_withdrawals w JOIN admin_users a ON a.id=w.admin_id WHERE w.admin_id=? ORDER BY w.created_at DESC LIMIT 30`).bind(admin.id).all<Withdrawal>(),
    env.DB.prepare('SELECT id,kind,ref_id AS refId,gross_fen AS grossFen,fee_fen AS feeFen,amount_fen AS amountFen,created_at AS createdAt FROM courier_ledger WHERE admin_id=? ORDER BY created_at DESC,id LIMIT 60').bind(admin.id).all<LedgerEntry>(),
  ]);
  const list = withdrawals.results;
  return {
    balanceFen: sums?.balance ?? 0, earnedFen: sums?.earned ?? 0, feeFen: sums?.fee ?? 0, parcels: sums?.parcels ?? 0, tipsFen: sums?.tips ?? 0,
    pendingFen: totals?.pending ?? 0, withdrawnFen: totals?.paid ?? 0,
    accounts: accounts.results, withdrawals: list, entries: entries.results,
  };
}

const constraint = (error: unknown): never => {
  const m = String(error);
  if (m.includes('WITHDRAW_EXCEEDS_BALANCE')) throw new ApiError(409, 'WITHDRAW_EXCEEDS_BALANCE', '可提现余额不足，请刷新后重试');
  if (m.includes('WITHDRAW_ACCOUNT_INVALID')) throw new ApiError(409, 'WITHDRAW_ACCOUNT_INVALID', '收款账户不存在或已删除，请重新选择');
  if (m.includes('WITHDRAW_ALREADY_REVIEWED')) throw new ApiError(409, 'WITHDRAW_ALREADY_REVIEWED', '这笔提现已经处理过了，请刷新');
  throw error;
};

export async function walletRoutes(request: Request, env: Env): Promise<Response | null> {
  const url = new URL(request.url), method = request.method, path = url.pathname.replace(/^\/api\/v1/, '');
  if (!path.startsWith('/admin/wallet') && !path.startsWith('/admin/withdrawals')) return null;
  const admin = await requireAdmin(request, env);

  if (path === '/admin/wallet' && method === 'GET') return json({ wallet: await wallet(env, admin) });
  if (path === '/admin/wallet/accounts' && method === 'POST') {
    await rateLimit(env, `payout-account:${admin.id}`, 20);
    const d = await body(request, payoutAccountSchema);
    const count = await env.DB.prepare('SELECT count(*) AS n FROM courier_payout_accounts WHERE admin_id=? AND removed_at IS NULL').bind(admin.id).first<number>('n') ?? 0;
    if (count >= PAYOUT_ACCOUNTS_MAX) throw new ApiError(409, 'PAYOUT_ACCOUNTS_FULL', `最多保存 ${PAYOUT_ACCOUNTS_MAX} 个收款账户，请先删除不用的`);
    const { masked, last4 } = maskAccount(d.method, d.account), id = crypto.randomUUID();
    await env.DB.batch([
      env.DB.prepare('INSERT INTO courier_payout_accounts(id,admin_id,method,account_name,account_masked,account_last4,bank_name) VALUES(?,?,?,?,?,?,?)')
        .bind(id, admin.id, d.method, d.accountName, masked, last4, d.method === 'BANK' ? d.bankName : null),
      env.DB.prepare("INSERT INTO audit_logs(id,actor_type,actor_id,action,resource_id,metadata_redacted) VALUES(?,'ADMIN',?,'PAYOUT_ACCOUNT_ADDED',?,json_object('method',?))").bind(crypto.randomUUID(), admin.id, id, d.method),
    ]);
    return json({ wallet: await wallet(env, admin) }, 201);
  }
  const acc = /^\/admin\/wallet\/accounts\/([a-f0-9-]{36})$/.exec(path);
  if (acc && method === 'DELETE') {
    const pending = await env.DB.prepare("SELECT 1 FROM courier_withdrawals WHERE account_id=? AND status='PENDING'").bind(acc[1]).first();
    if (pending) throw new ApiError(409, 'PAYOUT_ACCOUNT_IN_USE', '这个账户还有审核中的提现，处理完后再删除');
    const r = await env.DB.prepare('UPDATE courier_payout_accounts SET removed_at=unixepoch() WHERE id=? AND admin_id=? AND removed_at IS NULL').bind(acc[1], admin.id).run();
    if (!r.meta.changes) throw new ApiError(404, 'NOT_FOUND', '收款账户不存在');
    return json({ wallet: await wallet(env, admin) });
  }
  if (path === '/admin/wallet/withdrawals' && method === 'POST') {
    await rateLimit(env, `withdraw:${admin.id}`, 10);
    const d = await body(request, withdrawSchema);
    const pending = await env.DB.prepare("SELECT count(*) AS n FROM courier_withdrawals WHERE admin_id=? AND status='PENDING'").bind(admin.id).first<number>('n') ?? 0;
    if (pending >= WITHDRAW_MAX_PENDING) throw new ApiError(409, 'WITHDRAW_TOO_MANY', `已有 ${pending} 笔提现在审核中，处理完后再申请`);
    const account = await env.DB.prepare(`SELECT ${ACCOUNT_COLS} FROM courier_payout_accounts WHERE id=? AND admin_id=? AND removed_at IS NULL`).bind(d.accountId, admin.id).first<PayoutAccount>();
    if (!account) throw new ApiError(409, 'WITHDRAW_ACCOUNT_INVALID', '收款账户不存在或已删除，请重新选择');
    const id = crypto.randomUUID();
    try {
      await env.DB.batch([
        env.DB.prepare('INSERT INTO courier_withdrawals(id,admin_id,account_id,method,account_label,amount_fen) VALUES(?,?,?,?,?,?)').bind(id, admin.id, account.id, account.method, accountLabel(account), d.amountFen),
        env.DB.prepare("INSERT INTO audit_logs(id,actor_type,actor_id,action,resource_id,metadata_redacted) VALUES(?,'ADMIN',?,'WITHDRAW_REQUESTED',?,json_object('amountFen',?))").bind(crypto.randomUUID(), admin.id, id, d.amountFen),
      ]);
    } catch (error) { constraint(error); }
    return json({ wallet: await wallet(env, admin), message: '提现申请已提交，等待审核（模拟交易，不会产生真实转账）' }, 201);
  }

  // ---------------- review (super admin of the same world)
  if (path === '/admin/withdrawals' && method === 'GET') {
    requireSuperView(admin);
    const status = url.searchParams.get('status') === 'ALL' ? null : 'PENDING';
    const rows = (await env.DB.prepare(`SELECT ${WITHDRAW_COLS} FROM courier_withdrawals w JOIN admin_users a ON a.id=w.admin_id
      WHERE ${SAME_WORLD} AND (? IS NULL OR w.status=?) ORDER BY w.status='PENDING' DESC,w.created_at DESC LIMIT 100`).bind(admin.id, status, status).all<Withdrawal>()).results;
    const totals = await env.DB.prepare(`SELECT coalesce(sum(l.fee_fen),0) AS fee,coalesce(sum(CASE WHEN l.kind IN ('DELIVERY','SEND') THEN 1 END),0) AS parcels,
        coalesce(sum(l.amount_fen),0) AS balances FROM courier_ledger l JOIN admin_users a ON a.id=l.admin_id WHERE ${SAME_WORLD}`).bind(admin.id).first<{ fee: number; parcels: number; balances: number }>();
    const money = await env.DB.prepare(`SELECT coalesce(sum(CASE WHEN w.status='PENDING' THEN w.amount_fen END),0) AS pending,coalesce(sum(CASE WHEN w.status='PAID' THEN w.amount_fen END),0) AS paid
      FROM courier_withdrawals w JOIN admin_users a ON a.id=w.admin_id WHERE ${SAME_WORLD}`).bind(admin.id).first<{ pending: number; paid: number }>();
    return json({ withdrawals: rows, summary: { platformFeeFen: totals?.fee ?? 0, parcels: totals?.parcels ?? 0, courierBalancesFen: totals?.balances ?? 0, pendingFen: money?.pending ?? 0, paidFen: money?.paid ?? 0 } });
  }
  const rev = /^\/admin\/withdrawals\/([a-f0-9-]{36})\/review$/.exec(path);
  if (rev && method === 'POST') {
    requireSuperView(admin);
    const d = await body(request, withdrawReviewSchema);
    const target = await env.DB.prepare(`SELECT w.id,w.admin_id AS adminId FROM courier_withdrawals w JOIN admin_users a ON a.id=w.admin_id WHERE w.id=? AND ${SAME_WORLD}`).bind(rev[1], admin.id).first<{ id: string; adminId: string }>();
    if (!target) throw new ApiError(404, 'NOT_FOUND', '提现申请不存在，或不在你可以处理的范围');
    if (target.adminId === admin.id) throw new ApiError(403, 'WITHDRAW_SELF_REVIEW', '不能审核自己的提现，请让另一位超级管理员处理');
    const paidRef = d.action === 'PAY' ? `MOCK-${Date.now().toString(36).toUpperCase()}-${crypto.randomUUID().slice(0, 6).toUpperCase()}` : null;
    let changed = 0;
    try {
      const results = await env.DB.batch([
        env.DB.prepare("UPDATE courier_withdrawals SET status=?,note=?,reviewed_by=?,reviewed_at=unixepoch(),paid_ref=? WHERE id=? AND status='PENDING'")
          .bind(d.action === 'PAY' ? 'PAID' : 'REJECTED', d.note, admin.id, paidRef, target.id),
        // Only when the review above actually changed the request (changes() is the previous statement's row count).
        env.DB.prepare("INSERT INTO audit_logs(id,actor_type,actor_id,action,resource_id,metadata_redacted) SELECT ?,'ADMIN',?,?,?,json_object('note',?) WHERE changes()>0")
          .bind(crypto.randomUUID(), admin.id, d.action === 'PAY' ? 'WITHDRAW_PAID' : 'WITHDRAW_REJECTED', target.id, d.note),
      ]);
      changed = results[0].meta.changes;
    } catch (error) { constraint(error); }
    if (!changed) throw new ApiError(409, 'WITHDRAW_ALREADY_REVIEWED', '这笔提现已经处理过了，请刷新');
    return json({ ok: true, paidRef });
  }
  return null;
}

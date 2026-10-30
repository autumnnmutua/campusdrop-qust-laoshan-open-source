import type { Env } from './types';
import { ApiError, body, json } from './http';
import { requireStudent } from './session';
import { ruleCreateSchema, ruleUpdateSchema, RULE_LEAD_HOURS, RULES_PER_STUDENT, weekdayBit, type DeliveryRule } from '../shared/v3';
import { DELIVERY_SLOTS, SLOT_LEAD_MINUTES, beijingDate, slotLabel, slotTime, type SlotCode } from '../shared/slots';
import type { DeliveryMode, Parcel } from '../shared/delivery';
import type { DropPlace } from '../shared/campus-map';
import type { Student } from '../shared/contracts';
import { orderingPause } from './settings';
import { createOrderSet } from './order-groups';

/*
 * Standing delivery rules (常用配送规则): "on these weekdays, deliver whatever I have in this window". From
 * RULE_LEAD_HOURS before a window until it closes for booking, the frequent job (every 10 minutes) turns the student's
 * waiting parcels into unpaid orders for that window — merged when there are several from one station — and sends one
 * inbox message with the payment link. Payment stays the student's own step (mock). Unpaid rule orders are cancelled
 * when the window closes for booking (jobs.ts).
 */
const now = () => Math.floor(Date.now() / 1000);
type RuleRow = { id: string; weekdays: number; slotCode: SlotCode; deliveryMode: DeliveryMode; dropPlace: DropPlace | null; active: number; lastRunDate: string | null; lastNotice: string | null; createdAt: number };
const COLS = 'id,weekdays,slot_code AS slotCode,delivery_mode AS deliveryMode,drop_place AS dropPlace,active,last_run_date AS lastRunDate,last_notice AS lastNotice,created_at AS createdAt';
const toRule = (r: RuleRow): DeliveryRule => ({ ...r, active: Boolean(r.active) });

async function listRules(env: Env, userId: string): Promise<DeliveryRule[]> {
  return (await env.DB.prepare(`SELECT ${COLS} FROM delivery_rules WHERE user_id=? ORDER BY created_at`).bind(userId).all<RuleRow>()).results.map(toRule);
}

export async function ruleRoutes(request: Request, env: Env): Promise<Response | null> {
  const url = new URL(request.url), method = request.method, path = url.pathname.replace(/^\/api\/v1/, '');
  if (path === '/me/rules') {
    const user = await requireStudent(request, env);
    if (method === 'GET') return json({ rules: await listRules(env, user.id) });
    if (method === 'POST') {
      const data = await body(request, ruleCreateSchema);
      const count = await env.DB.prepare('SELECT count(*) AS n FROM delivery_rules WHERE user_id=?').bind(user.id).first<number>('n') ?? 0;
      if (count >= RULES_PER_STUDENT) throw new ApiError(409, 'RULE_LIMIT', `最多设置 ${RULES_PER_STUDENT} 条常用配送规则`);
      await env.DB.prepare('INSERT INTO delivery_rules(id,user_id,weekdays,slot_code,delivery_mode,drop_place) VALUES(?,?,?,?,?,?)')
        .bind(crypto.randomUUID(), user.id, data.weekdays, data.slotCode, data.deliveryMode, data.dropPlace ?? null).run();
      return json({ rules: await listRules(env, user.id) }, 201);
    }
    return null;
  }
  const m = /^\/me\/rules\/([a-f0-9-]{36})$/.exec(path);
  if (!m) return null;
  const user = await requireStudent(request, env);
  if (method === 'DELETE') {
    await env.DB.prepare('DELETE FROM delivery_rules WHERE id=? AND user_id=?').bind(m[1], user.id).run();
    return json({ rules: await listRules(env, user.id) });
  }
  if (method === 'PATCH') {
    const data = await body(request, ruleUpdateSchema);
    const current = await env.DB.prepare(`SELECT ${COLS} FROM delivery_rules WHERE id=? AND user_id=?`).bind(m[1], user.id).first<RuleRow>();
    if (!current) throw new ApiError(404, 'NOT_FOUND', '规则不存在');
    const next = { ...current, ...data, dropPlace: data.dropPlace === undefined ? current.dropPlace : data.dropPlace };
    if (next.dropPlace && next.deliveryMode !== 'DOWNSTAIRS') throw new ApiError(400, 'DROP_PLACE_MODE', '送到约定地点时请选择楼下配送');
    await env.DB.prepare('UPDATE delivery_rules SET weekdays=?,slot_code=?,delivery_mode=?,drop_place=?,active=?,updated_at=unixepoch() WHERE id=? AND user_id=?')
      .bind(next.weekdays, next.slotCode, next.deliveryMode, next.dropPlace ?? null, (data.active ?? Boolean(current.active)) ? 1 : 0, m[1], user.id).run();
    return json({ rules: await listRules(env, user.id) });
  }
  return null;
}

/** Windows that rules are preparing for right now: from RULE_LEAD_HOURS before the start until booking closes (with 10 minutes left to pay). */
export function preparingWindows(t: number): { date: string; code: SlotCode; closesAt: number }[] {
  const date = beijingDate(t);
  return DELIVERY_SLOTS.map(s => ({ date, code: s.code, start: slotTime(date, s.start) }))
    .filter(w => t >= w.start - RULE_LEAD_HOURS * 3600 && t < w.start - SLOT_LEAD_MINUTES * 60 - 600)
    .map(w => ({ date: w.date, code: w.code, closesAt: w.start - SLOT_LEAD_MINUTES * 60 }));
}

/** Frequent-job step. Bounded per run; a student who already ordered a parcel by hand is simply not touched for it. */
export async function runRules(env: Env, t = now()): Promise<number> {
  const windows = preparingWindows(t);
  if (!windows.length || (await orderingPause(env)).paused) return 0;
  let created = 0;
  for (const w of windows) {
    const bit = weekdayBit(w.date);
    const rules = (await env.DB.prepare(`SELECT r.id,r.user_id AS userId,r.delivery_mode AS deliveryMode,r.drop_place AS dropPlace,u.username,u.name,u.phone
      FROM delivery_rules r JOIN users u ON u.id=r.user_id WHERE r.active=1 AND r.slot_code=? AND (r.weekdays & ?)<>0 AND u.status='ACTIVE' AND u.deleted_at IS NULL
      AND EXISTS(SELECT 1 FROM parcels p WHERE p.user_id=r.user_id AND p.status='ACTIVE' AND p.created_at<?
        AND NOT EXISTS(SELECT 1 FROM delivery_orders o WHERE o.parcel_id=p.id AND o.status<>'CANCELLED'))
      ORDER BY r.created_at LIMIT 100`).bind(w.code, bit, t - 60)
      .all<{ id: string; userId: string; deliveryMode: DeliveryMode; dropPlace: DropPlace | null; username: string; name: string; phone: string }>()).results;
    for (const rule of rules) {
      const user: Student = { id: rule.userId, username: rule.username, name: rule.name, phone: rule.phone } as Student;
      const parcels = (await env.DB.prepare(`SELECT id,station_code AS stationCode,size AS packageSize,note FROM parcels p WHERE p.user_id=? AND p.status='ACTIVE' AND p.created_at<?
        AND NOT EXISTS(SELECT 1 FROM delivery_orders o WHERE o.parcel_id=p.id AND o.status<>'CANCELLED') ORDER BY p.created_at LIMIT 12`).bind(rule.userId, t - 60)
        .all<Pick<Parcel, 'id' | 'stationCode' | 'packageSize' | 'note'>>()).results;
      const byStation = new Map<string, typeof parcels>();
      for (const p of parcels) byStation.set(p.stationCode, [...(byStation.get(p.stationCode) ?? []), p]);
      const links: string[] = [];let made = 0, notice = '';
      for (const set of byStation.values()) for (let i = 0; i < set.length; i += 6) {
        try {
          const r = await createOrderSet(env, user, set.slice(i, i + 6), rule.deliveryMode, { date: w.date, code: w.code }, rule.dropPlace ?? undefined, rule.id);
          made += r.ids.length; links.push(r.groupId ? `/checkout-group/${r.groupId}` : `/checkout/${r.ids[0]}`);
        } catch (error) {
          // Room full, no shift, address missing …: told once per rule and day, then the rule waits for the next window.
          notice = error instanceof ApiError ? error.message : '暂时无法生成订单';
        }
      }
      const closes = new Date((w.closesAt + 8 * 3600) * 1000).toISOString().slice(11, 16);
      const statements: D1PreparedStatement[] = [env.DB.prepare('UPDATE delivery_rules SET last_run_date=?,last_notice=? WHERE id=?').bind(w.date, made ? null : notice || null, rule.id)];
      if (made) statements.push(env.DB.prepare("INSERT INTO inbox_messages(user_id,kind,title,link) VALUES(?,'RULE_ORDER',?,?)")
        .bind(rule.userId, `常用配送：已为 ${made} 件包裹生成${slotLabel(w.date, w.code, t)}的订单，请在 ${closes} 前完成模拟支付${links.length > 1 ? `（共 ${links.length} 单，可在“我的订单”查看）` : ''}`, links.length === 1 ? links[0] : '/orders'));
      else if (notice) statements.push(env.DB.prepare(`INSERT INTO inbox_messages(user_id,kind,title,link) SELECT ?,'RULE_NOTICE',?,'/rules' WHERE NOT EXISTS(SELECT 1 FROM delivery_rules WHERE id=? AND last_run_date=? AND last_notice IS NOT NULL)`)
        .bind(rule.userId, `常用配送：${slotLabel(w.date, w.code, t)}未能生成订单（${notice}）`, rule.id, w.date));
      // The notice row is written before the rule is marked, so the NOT EXISTS above sees yesterday's state.
      await env.DB.batch(statements.reverse());
      created += made;
    }
  }
  return created;
}

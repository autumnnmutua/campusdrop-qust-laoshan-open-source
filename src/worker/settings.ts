import type { Env } from './types';
import { ApiError } from './http';
import { background } from './background';
import { DELIVERY_SLOTS, slotTime, type SlotCode } from '../shared/slots';
import {
  DEFAULT_SHIFT_QUOTA, SEND_SLOT_CAPACITY, WEBHOOK_HOSTS, windowCapacity,
  type OrderingPause, type ShiftCapacity, type WebhookEvent, type WebhookSetting,
} from '../shared/operations-rules';

/*
 * Operations settings (app_settings) and what depends on them: the ordering pause, booked-window capacity (fixed or
 * from courier shifts) and the group-chat webhook. Every reader tolerates a database that has not run migration 0011
 * yet, so the order flow keeps working during a staged upgrade.
 */
type SettingKey = 'ordering_pause' | 'webhook' | 'shift_capacity';
const missing = (error: unknown) => /no such (table|column)/i.test(String(error));

export async function readSetting<T>(env: Env, key: SettingKey): Promise<T | null> {
  try {
    const raw = await env.DB.prepare('SELECT value_json AS v FROM app_settings WHERE key=?').bind(key).first<string>('v');
    return raw ? JSON.parse(raw) as T : null;
  } catch (error) { if (missing(error)) return null; throw error; }
}
export function writeSetting(env: Env, key: SettingKey, value: unknown, adminId: string): D1PreparedStatement {
  return env.DB.prepare(`INSERT INTO app_settings(key,value_json,updated_by) VALUES(?,?,?)
    ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json,updated_by=excluded.updated_by,updated_at=unixepoch()`).bind(key, JSON.stringify(value), adminId);
}

// ---------------------------------------------------------------- ordering pause
export async function orderingPause(env: Env): Promise<OrderingPause> {
  return (await readSetting<OrderingPause>(env, 'ordering_pause')) ?? { paused: false, reason: '' };
}
export async function requireOrderingOpen(env: Env): Promise<void> {
  const pause = await orderingPause(env);
  if (pause.paused) throw new ApiError(409, 'ORDERING_PAUSED', `暂停接单中：${pause.reason || '请稍后再试'}`);
}

// ---------------------------------------------------------------- booked-window capacity
export async function shiftCapacity(env: Env): Promise<ShiftCapacity | null> {
  return readSetting<ShiftCapacity>(env, 'shift_capacity');
}
/** Couriers on shift per window for the given dates (only counted when shift capacity is on). */
export async function shiftCounts(env: Env, dates: string[]): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  if (!dates.length) return counts;
  try {
    const rows = (await env.DB.prepare(`SELECT s.slot_date AS date,s.slot_code AS code,count(*) AS n FROM courier_shifts s JOIN admin_users a ON a.id=s.admin_id
      WHERE a.status='ACTIVE' AND s.slot_date IN (${dates.map(() => '?').join(',')}) GROUP BY s.slot_date,s.slot_code`).bind(...dates).all<{ date: string; code: string; n: number }>()).results;
    for (const r of rows) counts.set(r.date + r.code, r.n);
  } catch (error) { if (!missing(error)) throw error; }
  return counts;
}
export async function capacityFor(env: Env, date: string, code: SlotCode): Promise<number> {
  const setting = await shiftCapacity(env);
  const couriers = setting?.enabled ? (await shiftCounts(env, [date])).get(date + code) ?? 0 : 0;
  return windowCapacity(code, setting, couriers);
}
/** Orders that hold a place in a window: paid and not cancelled. Unpaid orders no longer reserve capacity. */
export const SLOT_HOLDING = "status NOT IN ('WAITING_PAYMENT','CANCELLED')";
export { DEFAULT_SHIFT_QUOTA, SEND_SLOT_CAPACITY };
/** A window can be booked until SLOT_LEAD minutes before it starts. */
export const windowStart = (date: string, code: SlotCode) => slotTime(date, DELIVERY_SLOTS.find(s => s.code === code)!.start);

// ---------------------------------------------------------------- group webhook (企业微信 / 飞书)
export async function webhookSetting(env: Env): Promise<WebhookSetting | null> {
  return readSetting<WebhookSetting>(env, 'webhook');
}
/** Masked for display: the bot key is a secret (anyone holding it can post to the group). */
export const maskWebhook = (url: string) => url.replace(/(key=|hook\/)([A-Za-z0-9-]{4})[A-Za-z0-9-]+/, '$1$2••••');
async function post(setting: WebhookSetting, text: string): Promise<boolean> {
  const url = new URL(setting.url);
  if (url.protocol !== 'https:' || !WEBHOOK_HOSTS[setting.kind].includes(url.hostname)) return false;
  const body = setting.kind === 'wecom' ? { msgtype: 'text', text: { content: text } } : { msg_type: 'text', content: { text } };
  const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), redirect: 'manual', signal: AbortSignal.timeout(8000) });
  return response.ok;
}
/**
 * Post a short operational line to the team's group chat. No names, phone numbers, rooms or pickup codes are ever
 * included — only building, size and window. `dedupe` makes the same alert go out once.
 */
export async function notifyGroup(env: Env, event: WebhookEvent, text: string, dedupe?: string): Promise<void> {
  const setting = await webhookSetting(env);
  if (!setting?.events.includes(event)) return;
  if (dedupe) {
    const claimed = await env.DB.prepare('INSERT INTO webhook_log(key) VALUES(?) ON CONFLICT(key) DO NOTHING RETURNING key').bind(dedupe).first();
    if (!claimed) return;
  }
  await post(setting, `【CampusDrop】${text}`).catch(() => false);
}
export function notifyGroupLater(env: Env, event: WebhookEvent, text: string, dedupe?: string): void {
  background(notifyGroup(env, event, text, dedupe));
}
export async function testWebhook(setting: WebhookSetting): Promise<boolean> {
  return post(setting, '【CampusDrop】群通知测试：配置成功，之后会在这里收到选中的运营提醒。').catch(() => false);
}

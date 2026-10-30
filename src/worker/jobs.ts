import type { Env } from './types';
import { cleanupStatements } from './account';
import { fanOut, inboxWatermark } from './live';
import { notifyGroup } from './settings';
import { STALL_RULES } from '../shared/engagement-rules';
import { DELIVERY_SLOTS, SLOT_LEAD_MINUTES } from '../shared/slots';
import { runRules } from './rules';
import { refreshWeather } from './weather';

/** Epoch seconds of the start of an order's booked window (Beijing time), as SQL over slot_date / slot_code. */
const SLOT_START_SQL = `(CAST(strftime('%s',slot_date||' '||CASE slot_code ${DELIVERY_SLOTS.map(s => `WHEN '${s.code}' THEN '${s.start}'`).join(' ')} END) AS INTEGER)-28800)`;

/*
 * Scheduled work. The frequent job (every 10 minutes) expires unpaid orders, reminds students about parcels that have
 * waited at the station, and sends stalled-order alerts to the team's group chat; the daily job prunes old data.
 * Inbox rows created here are fanned out (live event + web push) just like rows created by a request.
 */
const now = () => Math.floor(Date.now() / 1000);
const beijingHour = () => new Date((now() + 8 * 3600) * 1000).getUTCHours();
/** Days a parcel may sit registered without a delivery order before the student gets one reminder. */
export const PARCEL_REMINDER_DAYS = 2;
/** Unpaid orders: a booked window is held back only briefly; "as soon as possible" orders get a day. */
export const UNPAID_SLOT_MINUTES = 30, UNPAID_ASAP_HOURS = 24;

export async function frequentJobs(env: Env): Promise<void> {
  const watermark = await inboxWatermark(env);
  await env.DB.batch([
    // The status trigger writes the student's inbox row ("订单已取消"), the fan-out below turns it into a push.
    // Orders a standing rule prepared stay open until their window closes for booking; the others as before.
    env.DB.prepare(`UPDATE delivery_orders SET status='CANCELLED',version=version+1,updated_at=unixepoch(),last_actor_type='SYSTEM',last_actor_id='system',
      service_notice=IIF(rule_id IS NOT NULL,'常用配送生成的订单未在时段截止前支付，已自动取消。',IIF(slot_date IS NULL,'超过 24 小时未支付，系统已自动取消，可以重新下单。','超过 30 分钟未支付，预约名额已释放，可以重新下单。'))
      WHERE status='WAITING_PAYMENT' AND NOT EXISTS(SELECT 1 FROM payments p WHERE p.order_id=delivery_orders.id AND p.type='DELIVERY')
      AND ((rule_id IS NOT NULL AND slot_date IS NOT NULL AND unixepoch()>=${SLOT_START_SQL}-?)
        OR (rule_id IS NULL AND ((slot_date IS NOT NULL AND created_at<unixepoch()-?) OR created_at<unixepoch()-?)))`).bind(SLOT_LEAD_MINUTES * 60, UNPAID_SLOT_MINUTES * 60, UNPAID_ASAP_HOURS * 3600),
  ]);
  // Parcel reminders only in the daytime (10:00–20:59 Beijing), once per parcel.
  if (beijingHour() >= 10 && beijingHour() <= 20) {
    await env.DB.batch([
      env.DB.prepare(`INSERT INTO inbox_messages(user_id,kind,title,link)
        SELECT p.user_id,'PARCEL_WAITING','包裹 '||substr(p.pickup_code,-4)||' 已登记 '||((unixepoch()-p.created_at)/86400)||' 天，还没安排配送，记得取件或下单','/parcel/'||p.id
        FROM parcels p WHERE p.status='ACTIVE' AND p.reminded_at IS NULL AND p.created_at<unixepoch()-?
        AND NOT EXISTS(SELECT 1 FROM delivery_orders o WHERE o.parcel_id=p.id AND o.status<>'CANCELLED')
        AND EXISTS(SELECT 1 FROM users u WHERE u.id=p.user_id AND u.status='ACTIVE') ORDER BY p.created_at,p.id LIMIT 200`).bind(PARCEL_REMINDER_DAYS * 86400),
      // Mark exactly the parcels reminded above (same filter and order), so a backlog over 200 is picked up next run.
      env.DB.prepare(`UPDATE parcels SET reminded_at=unixepoch() WHERE id IN (SELECT p.id FROM parcels p WHERE p.status='ACTIVE' AND p.reminded_at IS NULL AND p.created_at<unixepoch()-?
        AND NOT EXISTS(SELECT 1 FROM delivery_orders o WHERE o.parcel_id=p.id AND o.status<>'CANCELLED')
        AND EXISTS(SELECT 1 FROM users u WHERE u.id=p.user_id AND u.status='ACTIVE') ORDER BY p.created_at,p.id LIMIT 200)`).bind(PARCEL_REMINDER_DAYS * 86400),
    ]);
  }
  // v3.0: standing rules prepare orders for upcoming windows (their inbox rows go out with the fan-out below);
  // the weather snapshot is refreshed at most every 30 minutes. Neither may stop the rest of the job.
  await runRules(env).catch(error => console.error('rules', error));
  await refreshWeather(env).catch(error => console.error('weather', error));
  await fanOut(env, watermark, false);
  // Stalled orders → group chat, once per order and status. No names, rooms or phone numbers.
  const t = now(), cases = STALL_RULES.map(r => `WHEN '${r.status}' THEN ${r.minutes}`).join(' ');
  const stalled = (await env.DB.prepare(`SELECT * FROM (SELECT o.id,o.status,json_extract(o.dorm_snapshot_json,'$.buildingName') AS building,
      coalesce((SELECT max(e.created_at) FROM order_events e WHERE e.order_id=o.id AND e.to_status=o.status),o.updated_at) AS since,CASE o.status ${cases} END AS limitMinutes
    FROM delivery_orders o WHERE o.status IN (${STALL_RULES.map(r => `'${r.status}'`).join(',')}) AND EXISTS(SELECT 1 FROM payments p WHERE p.order_id=o.id AND p.type='DELIVERY'))
    WHERE (?-since)/60>=limitMinutes ORDER BY since LIMIT 20`).bind(t).all<{ id: string; status: string; building: string; since: number; limitMinutes: number }>()).results;
  for (const s of stalled) {
    const rule = STALL_RULES.find(r => r.status === s.status);
    await notifyGroup(env, 'STALLED', `超时预警：${s.building} · ${rule?.label ?? s.status}（已超过 ${Math.floor((t - s.since) / 60) - s.limitMinutes} 分钟）`, `stall:${s.id}:${s.status}`);
  }
}

export async function dailyJobs(env: Env): Promise<void> {
  await env.DB.batch([
    env.DB.prepare('DELETE FROM rate_limits WHERE expires_at<=unixepoch()'),
    env.DB.prepare('DELETE FROM recovery_tokens WHERE expires_at<=unixepoch() OR used_at IS NOT NULL'),
    env.DB.prepare('DELETE FROM error_events WHERE created_at<unixepoch()-604800'),
    ...cleanupStatements(env),
  ]);
}

/** One ten-minute trigger also runs daily cleanup at 03:20 UTC (11:20 Beijing). */
export async function scheduled(controller: ScheduledController, env: Env): Promise<void> {
  if (controller.cron.startsWith('*/')) {
    const scheduledAt = new Date(controller.scheduledTime);
    try {
      await frequentJobs(env);
    } finally {
      if (scheduledAt.getUTCHours() === 3 && scheduledAt.getUTCMinutes() === 20) await dailyJobs(env);
    }
  } else await dailyJobs(env);
}

import type { Env } from './types';
import { ApiError, body, json } from './http';
import { requireAdmin, requireStudent, requireSuper } from './session';
import { rateLimit } from './rate-limit';
import { orderScope } from './order-access';
import { STALL_RULES, announcementArchive, announcementCreate, ratingCreate, type Analytics, type StalledOrder, type StudentStats } from '../shared/engagement';
import type { Admin } from '../shared/contracts';
import type { OrderStatus } from '../shared/delivery';

const DAY = 86400, CN_OFFSET = 8 * 3600;
const PAID = "EXISTS(SELECT 1 FROM payments p WHERE p.order_id=o.id AND p.type='DELIVERY')";
const ROOM = "(CASE WHEN o.delivery_upgrade_fen=100 THEN 'ROOM' ELSE o.delivery_mode END)";
const now = () => Math.floor(Date.now() / 1000);
/** Start of today in Asia/Shanghai (UTC+8, no DST), as a unix timestamp. */
const dayStart = (t = now()) => Math.floor((t + CN_OFFSET) / DAY) * DAY - CN_OFFSET;
const cnDate = (t: number) => new Date((t + CN_OFFSET) * 1000).toISOString().slice(0, 10);

/**
 * v2 tables arrive with migration 0009. Until it is applied, read paths answer as if empty so the
 * existing order flow keeps working; write paths still surface a clear error.
 */
function missingTable(error: unknown): boolean { return /no such table: (announcements|order_ratings)/i.test(String(error)); }
async function orEmpty<T>(run: () => Promise<T>, fallback: T): Promise<T> {
  try { return await run(); } catch (error) { if (missingTable(error)) return fallback; throw error; }
}
async function write<T>(run: () => Promise<T>): Promise<T> {
  try { return await run(); } catch (error) {
    if (missingTable(error)) throw new ApiError(503, 'FEATURE_NOT_READY', '此功能需要先完成数据库升级（迁移 0009）');
    if (String(error).includes('RATING_NOT_ALLOWED')) throw new ApiError(409, 'RATING_NOT_ALLOWED', '只能评价自己已完成的订单');
    if (String(error).includes('UNIQUE constraint') || String(error).includes('PRIMARY KEY')) throw new ApiError(409, 'ALREADY_RATED', '这单已经评价过了');
    throw error;
  }
}

interface AnnouncementRow { id: string; level: string; title: string; body: string; status: string; startsAt: number; endsAt: number | null; createdAt: number; archivedAt: number | null; author?: string }
const announcementColumns = 'a.id,a.level,a.title,a.body,a.status,a.starts_at AS startsAt,a.ends_at AS endsAt,a.created_at AS createdAt,a.archived_at AS archivedAt';

async function studentStats(env: Env, userId: string): Promise<StudentStats> {
  const row = await env.DB.prepare(`SELECT count(*) AS paidOrders,
      coalesce(sum(o.status='COMPLETED'),0) AS completed,
      coalesce(sum(o.status NOT IN ('COMPLETED','CANCELLED')),0) AS active,
      coalesce(sum(o.status='COMPLETED' AND ${ROOM}='ROOM'),0) AS roomDeliveries,
      coalesce(sum(o.status='COMPLETED' AND o.package_size='LARGE'),0) AS largeParcels,
      min(o.created_at) AS firstOrderAt
    FROM delivery_orders o WHERE o.user_id=? AND ${PAID}`).bind(userId).first<Omit<StudentStats, 'ratingsGiven'>>();
  const ratingsGiven = await orEmpty(async () => (await env.DB.prepare('SELECT count(*) AS n FROM order_ratings WHERE user_id=?').bind(userId).first<number>('n')) ?? 0, 0);
  return { paidOrders: 0, completed: 0, active: 0, roomDeliveries: 0, largeParcels: 0, firstOrderAt: null, ...row, ratingsGiven };
}

export const ANALYTICS_RANGES = [7, 14, 30] as const;
async function analytics(env: Env, admin: Admin, days: number): Promise<Analytics> {
  const scope = orderScope(admin), today = dayStart(), since = today - (days - 1) * DAY;
  const scoped = `FROM delivery_orders o WHERE ${PAID} AND ${scope.sql}`;
  const q = (sql: string, ...extra: (string | number)[]) => env.DB.prepare(sql).bind(...scope.params, ...extra);
  const [trendRes, statusRes, buildingRes, mixRes, speedRes, heatRes] = await env.DB.batch([
    q(`SELECT date(o.created_at+${CN_OFFSET},'unixepoch') AS day,count(*) AS count ${scoped} AND o.created_at>=? GROUP BY day`, since),
    q(`SELECT o.status,count(*) AS count ${scoped} GROUP BY o.status ORDER BY count DESC`),
    q(`SELECT coalesce(json_extract(o.dorm_snapshot_json,'$.buildingName'),o.dorm_building_code) AS building,count(*) AS count ${scoped} AND o.created_at>=? GROUP BY building ORDER BY count DESC,building LIMIT 8`, since),
    q(`SELECT o.package_size AS size,${ROOM} AS mode,count(*) AS count ${scoped} AND o.created_at>=? GROUP BY size,mode`, since),
    q(`SELECT avg(done-start)/60.0 AS minutes FROM (SELECT
        (SELECT min(e.created_at) FROM order_events e WHERE e.order_id=o.id AND e.to_status='WAITING_PICKUP') AS start,
        (SELECT max(e.created_at) FROM order_events e WHERE e.order_id=o.id AND e.to_status IN ('DELIVERED_DOWNSTAIRS','DELIVERED_TO_ROOM')) AS done
        ${scoped} AND o.created_at>=?) WHERE start IS NOT NULL AND done>=start`, since),
    // Weekday (0 = Sunday in SQLite) x hour in Beijing time, for staffing the busy slots.
    q(`SELECT cast(strftime('%w',o.created_at+${CN_OFFSET},'unixepoch') AS INTEGER) AS dow,cast(strftime('%H',o.created_at+${CN_OFFSET},'unixepoch') AS INTEGER) AS hour,count(*) AS count ${scoped} AND o.created_at>=? GROUP BY dow,hour`, since),
  ]);
  // KPI timestamps are bound before the scope params, so this statement is prepared on its own.
  const kpi = await env.DB.prepare(`SELECT coalesce(sum(o.created_at>=?),0) AS today, coalesce(sum(o.created_at>=?),0) AS last7,
      coalesce(sum(o.status NOT IN ('COMPLETED','CANCELLED')),0) AS active,
      coalesce(sum(o.status='COMPLETED'),0) AS completed, coalesce(sum(o.status IN ('COMPLETED','CANCELLED')),0) AS closed ${scoped}`)
    .bind(today, today - 6 * DAY, ...scope.params).first<{ today: number; last7: number; active: number; completed: number; closed: number }>();
  const byDay = new Map((trendRes.results as { day: string; count: number }[]).map(r => [r.day, r.count]));
  const trend = Array.from({ length: days }, (_, i) => { const day = cnDate(since + i * DAY); return { day, count: byDay.get(day) ?? 0 }; });
  // Rows Monday..Sunday, 24 hourly columns.
  const heatmap = Array.from({ length: 7 }, () => Array<number>(24).fill(0));
  for (const r of heatRes.results as { dow: number; hour: number; count: number }[]) heatmap[(r.dow + 6) % 7][r.hour] = r.count;
  const minutes = (speedRes.results[0] as { minutes: number | null } | undefined)?.minutes ?? null;

  const ratings = await orEmpty(async () => {
    const joined = `FROM order_ratings r JOIN delivery_orders o ON o.id=r.order_id WHERE ${scope.sql}`;
    const [summary, dist, tags, recent] = await env.DB.batch([
      q(`SELECT avg(r.stars) AS avgStars,count(*) AS n ${joined}`),
      q(`SELECT r.stars,count(*) AS count ${joined} GROUP BY r.stars`),
      q(`SELECT t.value AS tag,count(*) AS count ${joined.replace('WHERE', ', json_each(r.tags_json) t WHERE')} GROUP BY t.value ORDER BY count DESC LIMIT 9`),
      q(`SELECT r.stars,r.tags_json AS tagsJson,r.comment,r.created_at AS createdAt,coalesce(json_extract(o.dorm_snapshot_json,'$.buildingName'),o.dorm_building_code) AS building ${joined} ORDER BY r.created_at DESC LIMIT 8`),
    ]);
    const s = summary.results[0] as { avgStars: number | null; n: number };
    const distribution = [0, 0, 0, 0, 0];
    for (const r of dist.results as { stars: number; count: number }[]) distribution[r.stars - 1] = r.count;
    return {
      avgStars: s.avgStars === null ? null : Math.round(s.avgStars * 10) / 10, count: s.n,
      distribution, tags: tags.results as { tag: string; count: number }[],
      recent: (recent.results as { stars: number; tagsJson: string; comment: string; createdAt: number; building: string }[])
        .map(({ tagsJson, ...r }) => ({ ...r, tags: JSON.parse(tagsJson) as string[] })),
    };
  }, { avgStars: null, count: 0, distribution: [0, 0, 0, 0, 0], tags: [], recent: [] });

  // Per-assignee performance. Ratings are joined only when the 0009 tables exist.
  const staffSql = (withRatings: boolean) => `SELECT a.username AS name,count(*) AS orders,
      coalesce(sum(o.status IN ('DELIVERED_DOWNSTAIRS','DELIVERED_TO_ROOM','COMPLETED')),0) AS delivered,
      avg((SELECT max(e.created_at) FROM order_events e WHERE e.order_id=o.id AND e.to_status IN ('DELIVERED_DOWNSTAIRS','DELIVERED_TO_ROOM'))
        -(SELECT min(e.created_at) FROM order_events e WHERE e.order_id=o.id AND e.to_status='PICKED_UP'))/60.0 AS avgMinutes,
      ${withRatings ? 'avg(r.stars)' : 'NULL'} AS avgStars,${withRatings ? 'count(r.order_id)' : '0'} AS ratings
    FROM delivery_orders o JOIN batch_items bi ON bi.order_id=o.id JOIN delivery_batches b ON b.id=bi.batch_id JOIN admin_users a ON a.id=b.assignee_admin_id
    ${withRatings ? 'LEFT JOIN order_ratings r ON r.order_id=o.id' : ''}
    WHERE ${PAID} AND ${scope.sql} AND o.created_at>=? GROUP BY a.id ORDER BY delivered DESC,orders DESC LIMIT 12`;
  type StaffRow = Analytics['staff'][number];
  let staffRows: StaffRow[];
  try { staffRows = (await q(staffSql(true), since).all<StaffRow>()).results; }
  catch (error) { if (!missingTable(error)) throw error; staffRows = (await q(staffSql(false), since).all<StaffRow>()).results; }
  const staff = staffRows.map(r => ({ ...r, avgMinutes: r.avgMinutes === null ? null : Math.max(0, Math.round(r.avgMinutes)), avgStars: r.avgStars === null ? null : Math.round(r.avgStars * 10) / 10 }));
  const k = kpi ?? { today: 0, last7: 0, active: 0, completed: 0, closed: 0 };
  return {
    kpis: { ...k, completionRate: k.closed ? Math.round(k.completed / k.closed * 1000) / 10 : null,
      avgDeliveryMinutes: minutes === null ? null : Math.round(minutes), avgStars: ratings.avgStars, ratingCount: ratings.count },
    days, trend, heatmap, staff,
    statuses: statusRes.results as { status: OrderStatus; count: number }[],
    buildings: buildingRes.results as { building: string; count: number }[],
    mix: mixRes.results as Analytics['mix'],
    ratings: { distribution: ratings.distribution, tags: ratings.tags, recent: ratings.recent },
  };
}

/** Orders in the admin's scope that have stayed in one status longer than STALL_RULES allows, most overdue first. */
async function stalledOrders(env: Env, admin: Admin): Promise<StalledOrder[]> {
  const scope = orderScope(admin), t = now();
  const cases = STALL_RULES.map(r => `WHEN '${r.status}' THEN ${r.minutes}`).join(' ');
  const rows = await env.DB.prepare(`SELECT * FROM (SELECT o.id,o.status,
      json_extract(o.dorm_snapshot_json,'$.buildingName') AS building,json_extract(o.dorm_snapshot_json,'$.roomNo') AS roomNo,
      coalesce((SELECT max(e.created_at) FROM order_events e WHERE e.order_id=o.id AND e.to_status=o.status),o.updated_at,o.created_at) AS since,
      CASE o.status ${cases} END AS limitMinutes,
      (SELECT a.username FROM batch_items bi JOIN delivery_batches b ON b.id=bi.batch_id JOIN admin_users a ON a.id=b.assignee_admin_id WHERE bi.order_id=o.id) AS assignee
    FROM delivery_orders o WHERE ${PAID} AND ${scope.sql} AND o.status IN (${STALL_RULES.map(r => `'${r.status}'`).join(',')}))
    WHERE (?-since)/60>=limitMinutes ORDER BY (?-since)*1.0/limitMinutes DESC LIMIT 50`)
    .bind(...scope.params, t, t).all<{ id: string; status: StalledOrder['status']; building: string; roomNo: string; since: number; limitMinutes: number; assignee: string | null }>();
  return rows.results.map(({ limitMinutes, ...r }) => ({ ...r, label: STALL_RULES.find(x => x.status === r.status)?.label ?? '', overdueMinutes: Math.max(0, Math.floor((t - r.since) / 60) - limitMinutes) }));
}

export async function engagementRoutes(request: Request, env: Env): Promise<Response | null> {
  const path = new URL(request.url).pathname.replace('/api/v1', ''), method = request.method;

  if (path === '/announcements' && method === 'GET') {
    const t = now();
    const rows = await orEmpty(async () => (await env.DB.prepare(`SELECT ${announcementColumns} FROM announcements a
      WHERE a.status='ACTIVE' AND a.starts_at<=? AND (a.ends_at IS NULL OR a.ends_at>?) ORDER BY CASE a.level WHEN 'PAUSE' THEN 0 WHEN 'NOTICE' THEN 1 ELSE 2 END,a.starts_at DESC LIMIT 3`)
      .bind(t, t).all<AnnouncementRow>()).results, [] as AnnouncementRow[]);
    return json({ announcements: rows });
  }

  if (path === '/me/stats' && method === 'GET') {
    const user = await requireStudent(request, env);
    return json({ stats: await studentStats(env, user.id) });
  }

  const rating = /^\/orders\/([a-f0-9-]{36})\/rating$/.exec(path);
  if (rating) {
    const user = await requireStudent(request, env), orderId = rating[1];
    const order = await env.DB.prepare('SELECT status FROM delivery_orders WHERE id=? AND user_id=?').bind(orderId, user.id).first<{ status: string }>();
    if (!order) throw new ApiError(404, 'NOT_FOUND', '订单不存在');
    if (method === 'GET') {
      const row = await orEmpty(() => env.DB.prepare('SELECT stars,tags_json AS tagsJson,comment,created_at AS createdAt FROM order_ratings WHERE order_id=?')
        .bind(orderId).first<{ stars: number; tagsJson: string; comment: string; createdAt: number }>(), null);
      return json({ eligible: order.status === 'COMPLETED', rating: row ? { stars: row.stars, tags: JSON.parse(row.tagsJson) as string[], comment: row.comment, createdAt: row.createdAt } : null });
    }
    if (method === 'POST') {
      await rateLimit(env, `rating:${user.id}`, 30);
      const data = await body(request, ratingCreate);
      if (order.status !== 'COMPLETED') throw new ApiError(409, 'RATING_NOT_ALLOWED', '确认收货后才能评价');
      await write(() => env.DB.prepare('INSERT INTO order_ratings(order_id,user_id,stars,tags_json,comment) VALUES(?,?,?,?,?)')
        .bind(orderId, user.id, data.stars, JSON.stringify(data.tags), data.comment).run());
      return json({ rating: { ...data, createdAt: now() } }, 201);
    }
  }

  if (!path.startsWith('/admin/')) return null;

  if (path === '/admin/alerts' && method === 'GET') {
    const admin = await requireAdmin(request, env);
    return json({ alerts: await stalledOrders(env, admin), checkedAt: now() });
  }

  if (path === '/admin/analytics' && method === 'GET') {
    const admin = await requireAdmin(request, env);
    const days = Number(new URL(request.url).searchParams.get('days') ?? 14);
    if (!(ANALYTICS_RANGES as readonly number[]).includes(days)) throw new ApiError(400, 'INVALID_FILTER', '统计范围只支持 7、14、30 天');
    return json({ analytics: await analytics(env, admin, days), generatedAt: now() });
  }

  if (path === '/admin/announcements') {
    const admin = await requireAdmin(request, env); requireSuper(admin);
    if (method === 'GET') {
      const rows = await orEmpty(async () => (await env.DB.prepare(`SELECT ${announcementColumns},coalesce(u.username,'已移除管理员') AS author
        FROM announcements a LEFT JOIN admin_users u ON u.id=a.created_by ORDER BY a.created_at DESC,a.id DESC LIMIT 30`).all<AnnouncementRow>()).results, [] as AnnouncementRow[]);
      return json({ announcements: rows });
    }
    if (method === 'POST') {
      await rateLimit(env, `announce:${admin.id}`, 20);
      const data = await body(request, announcementCreate), id = crypto.randomUUID(), t = now();
      await write(() => env.DB.batch([
        env.DB.prepare('INSERT INTO announcements(id,level,title,body,starts_at,ends_at,created_by) VALUES(?,?,?,?,?,?,?)')
          .bind(id, data.level, data.title, data.body, t, data.durationHours ? t + data.durationHours * 3600 : null, admin.id),
        env.DB.prepare("INSERT INTO audit_logs(id,actor_type,actor_id,action,resource_id) VALUES(?,'ADMIN',?,'ANNOUNCEMENT_PUBLISHED',?)").bind(crypto.randomUUID(), admin.id, id),
      ]));
      return json({ id }, 201);
    }
  }
  const archive = /^\/admin\/announcements\/([a-f0-9-]{36})\/archive$/.exec(path);
  if (archive && method === 'POST') {
    const admin = await requireAdmin(request, env); requireSuper(admin);
    await body(request, announcementArchive);
    const [updated] = await write(() => env.DB.batch([
      env.DB.prepare("UPDATE announcements SET status='ARCHIVED',archived_at=unixepoch() WHERE id=? AND status='ACTIVE' RETURNING id").bind(archive[1]),
      env.DB.prepare("INSERT INTO audit_logs(id,actor_type,actor_id,action,resource_id) SELECT ?,'ADMIN',?,'ANNOUNCEMENT_ARCHIVED',? WHERE changes()>0").bind(crypto.randomUUID(), admin.id, archive[1]),
    ]));
    if (!updated.results.length) throw new ApiError(404, 'NOT_FOUND', '公告不存在或已下线');
    return json({ ok: true });
  }
  return null;
}

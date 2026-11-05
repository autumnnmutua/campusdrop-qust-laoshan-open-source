import type { Env } from './types';
import { ApiError, body, json } from './http';
import { requireAdmin, requireStudent } from './session';
import { rateLimit } from './rate-limit';
import { weatherInfo } from './weather';
import { punctuality } from './punctuality';
import { orderScope } from './order-access';
import { priceFen, upgradePriceFen } from '../domain/commerce';
import { CAMPUS_ID, STATUS_LABELS } from '../shared/constants';
import { DELIVERY_SLOTS, slotLabel, type SlotCode } from '../shared/slots';
import { FAQ, searchFaq } from '../shared/knowledge';
import { assistantAskSchema, type AssistantLink, type AssistantReply, type OpsSummary } from '../shared/assistant';
import { rate, type PunctualityRow } from '../shared/v3';
import { aiBase, aiModel, chat, cleanAnswer, countFallback, takeQuota, visionConfigured, visionModel } from './ai-model';
import { localDeliveryPlan, modelAssistant } from './agent';
import type { Student } from '../shared/contracts';

/*
 * v3.5 · AI features.
 *
 * 智能助手 (POST /assistant, students): answers questions about the service and the student's own deliveries. The
 * context sent to the model is built here from the database and contains no name, phone, room number, pickup code,
 * receipt code or free-text note: only statuses, stations, buildings, windows and the service rules / FAQ entries
 * retrieved for the question (retrieval-augmented). The answer is plain text, rendered as text by the client; links
 * come from a fixed list here, never from the model.
 *
 * AI 运营小结 (GET /admin/ops-summary, operators): the model turns the on-time figures of the admin's own scope into
 * three to five sentences. The figures are computed here and returned alongside, so the summary can be checked.
 *
 * The model is any OpenAI-compatible chat-completions endpoint set by the operator (secrets): AI_API_KEY, optional
 * AI_BASE_URL (default 阿里云百炼 https://dashscope.aliyuncs.com/compatible-mode/v1) and AI_MODEL (default qwen-plus).
 * Without a key, over the daily cap (AI_DAILY_LIMIT, default 300 assistant + 60 summary calls) or on any model error,
 * both features answer from local rules and FAQ retrieval and say so.
 */
const now = () => Math.floor(Date.now() / 1000);
const yuan = (fen: number) => `${(fen / 100).toFixed(fen % 100 ? 2 : 0)} 元`;

// ---------------------------------------------------------------- 智能助手
type OrderRow = { id: string; groupId: string | null; status: keyof typeof STATUS_LABELS; stationName: string; building: string; dropPlace: string | null; slotDate: string | null; slotCode: SlotCode | null; mode: 'DOWNSTAIRS' | 'ROOM'; groupSize: number; hasAssignee: number };
async function studentContext(env: Env, userId: string) {
  const t = now();
  const orders = (await env.DB.prepare(`SELECT o.id,o.group_id AS groupId,o.status,json_extract(o.station_snapshot_json,'$.canonicalName') AS stationName,
      json_extract(o.dorm_snapshot_json,'$.buildingName') AS building,o.drop_place AS dropPlace,o.slot_date AS slotDate,o.slot_code AS slotCode,o.delivery_mode AS mode,
      CASE WHEN o.group_id IS NULL THEN 1 ELSE (SELECT count(*) FROM delivery_orders g WHERE g.group_id=o.group_id AND g.status<>'CANCELLED') END AS groupSize,
      EXISTS(SELECT 1 FROM batch_items bi WHERE bi.order_id=o.id) AS hasAssignee
    FROM delivery_orders o WHERE o.user_id=? AND o.student_deleted=0 AND o.status NOT IN ('COMPLETED','CANCELLED') ORDER BY o.created_at DESC LIMIT 8`).bind(userId).all<OrderRow>()).results;
  const waiting = (await env.DB.prepare(`SELECT (SELECT canonical_name FROM stations s WHERE s.code=p.station_code) AS station,count(*) AS n FROM parcels p
    WHERE p.user_id=? AND p.status='ACTIVE' AND NOT EXISTS(SELECT 1 FROM delivery_orders o WHERE o.parcel_id=p.id AND o.status<>'CANCELLED') GROUP BY p.station_code`).bind(userId).all<{ station: string; n: number }>()).results;
  const stations = (await env.DB.prepare('SELECT canonical_name AS name,relative_location AS location FROM stations WHERE campus_id=? AND active=1 ORDER BY sort_order,code').bind(CAMPUS_ID).all<{ name: string; location: string }>()).results;
  const weather = await weatherInfo(env).catch(() => null);
  // A merged delivery is one line, not one per parcel.
  const seen = new Set<string>();
  const shown = orders.filter(o => { if (!o.groupId) return true; const key = `${o.groupId}:${o.status}`; if (seen.has(key)) return false; seen.add(key); return true; });
  const orderLines = shown.map(o => {
    const where = o.dropPlace ? '约定地点' : o.building;
    const when = o.slotDate && o.slotCode ? slotLabel(o.slotDate, o.slotCode, t) : '尽快送达';
    const stage = o.status === 'WAITING_PICKUP' && !o.hasAssignee ? '待取件（等待配送员接单）' : STATUS_LABELS[o.status];
    return `${where} · ${o.mode === 'ROOM' ? '送到寝室' : '楼下'} · ${when} · ${stage} · 从${o.stationName}出发${o.groupSize > 1 ? ` · 合并配送 ${o.groupSize} 件` : ''}`;
  });
  const waitingLines = waiting.map(w => `${w.station}：${w.n} 件已登记、还没安排配送`);
  return { orders, orderLines, waitingLines, stations, weather };
}
const SERVICE_FACTS = () => [
  `费用：小件楼下 ${yuan(priceFen('SMALL', 'DOWNSTAIRS'))}、送到寝室 ${yuan(priceFen('SMALL', 'ROOM'))}；大件楼下 ${yuan(priceFen('LARGE', 'DOWNSTAIRS'))}、送到寝室 ${yuan(priceFen('LARGE', 'ROOM'))}；下单后升级到寝补小件 ${yuan(upgradePriceFen('SMALL'))}、大件 ${yuan(upgradePriceFen('LARGE'))}。支付均为模拟，不发生真实扣款。`,
  `预约时段：${DELIVERY_SLOTS.map(s => `${s.label} ${s.start}–${s.end}`).join('、')}，可约今天到后天，开始前 30 分钟截止；也可以选“尽快送达”。`,
  '代寄件：配送员上门取件后交到站点寄出，小件 3 元、大件 7 元（模拟支付），两个站点都可以寄。',
];
const LINKS: [RegExp, AssistantLink][] = [
  [/到哪|进度|状态|订单|什么时候到|送到了|配送员|收货码/, { label: '我的订单', to: '/orders' }],
  [/登记|取件码|短信|截图|添加/, { label: '添加快递', to: '/parcel/new' }],
  [/多少钱|费用|价格|价钱|收费|贵/, { label: '配送说明与费用计算器', to: '/guide' }],
  [/站点|驿站|在哪|位置|地图|南十|颐海苑/, { label: '校园配送地图', to: '/map' }],
  [/寄件|代寄|寄快递|寄出/, { label: '代寄件', to: '/send' }],
  [/一起送|合并|好几件|多件/, { label: '合并配送', to: '/parcel/merge' }],
  [/每周|固定|自动|常用/, { label: '常用配送', to: '/rules' }],
  [/售后|投诉|丢|坏|退款|赔/, { label: '发起售后', to: '/tickets/new' }],
];
const linksFor = (q: string) => LINKS.filter(([re]) => re.test(q)).map(([, l]) => l).slice(0, 3);
const ORDER_INTENT = /到哪|进度|状态|我的订单|我的包裹|什么时候到|送到了吗|到了吗|多久到|还要多久|我有几[单件]|还有几[单件]|有几[单件]包裹|where is|track|my order|my parcel/i;

function localAnswer(question: string, ctx: Awaited<ReturnType<typeof studentContext>>): { answer: string; references: string[] } {
  if (ORDER_INTENT.test(question)) {
    const parts: string[] = [];
    if (ctx.orderLines.length) parts.push(`你有 ${ctx.orderLines.length} 项配送进行中：\n${ctx.orderLines.map(l => `· ${l}`).join('\n')}`);
    else parts.push('你目前没有进行中的配送订单。');
    if (ctx.waitingLines.length) parts.push(`另外，${ctx.waitingLines.join('；')}。可以在首页安排配送，同一站点 2 件以上可以合并配送。`);
    if (ctx.weather?.enabled && ctx.weather.level !== 'CLEAR' && ctx.weather.notice) parts.push(ctx.weather.notice.replace(/\s+/g, '').replace(/([^。！？])$/, '$1。'));
    parts.push('具体进度和预计送达时间以订单页为准。');
    return { answer: parts.join('\n'), references: [] };
  }
  // Common questions answered from the live rules (exact prices, windows, stations) before FAQ retrieval.
  const facts = SERVICE_FACTS();
  if (/多少钱|费用|价格|价钱|收费|几块|贵|便宜|差多少/.test(question) && !/寄/.test(question)) return { answer: `${facts[0]}\n合并配送每件照常计价；实际金额以下单时的报价为准。`, references: ['费用怎么算？'] };
  if (/寄/.test(question) && /多少钱|费用|价格|收费|怎么|如何|流程/.test(question)) return { answer: `${facts[2]}在“代寄件”页预约上门时段，可以选择交寄站点；请先在快递 App 下好寄件单，把面单码写在备注里。`, references: ['南十对面的驿站能寄件吗？'] };
  if (/预约|时段|几点|晚上|中午|傍晚|什么时候送/.test(question) && !/寄/.test(question)) return { answer: `${facts[1]}每个时段有名额上限，约满即止。`, references: ['可以预约送达时间吗？'] };
  if (/几个站点|哪些站点|站点在哪|驿站在哪|有哪些驿站|取件点/.test(question) || (/在哪|位置|怎么走/.test(question) && /站|驿站|南十|颐海苑|怡海苑/.test(question))) return { answer: `现在有 ${ctx.stations.length} 个站点：${ctx.stations.map(x => `${x.name}（${x.location}）`).join('；')}。登记包裹时选择包裹实际所在的站点。`, references: ['有几个取件站点？'] };
  const hits = searchFaq(question, 2);
  if (hits.length && hits[0].score >= 1.2) {
    const extra = hits[1] && hits[1].score >= hits[0].score * 0.8 ? `\n\n相关：${hits[1].question}${hits[1].answer}` : '';
    return { answer: `${hits[0].answer}${extra}`, references: hits.slice(0, extra ? 2 : 1).map(h => h.question) };
  }
  if (!/[\u4e00-\u9fff]/.test(question)) return { answer: 'Without an AI model configured, the assistant answers in Chinese only. Try asking in Chinese, for example “我的包裹到哪了？” or “费用怎么算？”.', references: [] };
  return {
    answer: '这个问题我暂时回答不了。我可以帮你查包裹进度、算配送费用，介绍两个站点、预约时段、合并配送、常用配送和代寄件。也可以在“常见问题”里搜索，或者发起售后工单联系运营同学。',
    references: [],
  };
}

async function assistantReply(env: Env, user: Student, message: string, history: { role: 'user' | 'assistant'; content: string }[]): Promise<AssistantReply> {
  const userId = user.id;
  const ctx = await studentContext(env, userId);
  const hits = searchFaq(message, 4);
  const links = linksFor(message);
  // v3.6: a sentence that asks for a delivery ("把南十的两件合并，晚上送寝室") gets drafts from the agent planner.
  const local = async (reason: NonNullable<AssistantReply['fallbackReason']>): Promise<AssistantReply> => {
    await countFallback(env, 'ASSISTANT');
    const plan = await localDeliveryPlan(env, user, message).catch(() => null);
    if (plan) return { answer: plan.answer, source: 'LOCAL', model: null, fallbackReason: reason, links: plan.drafts.length ? [] : links, references: [], drafts: plan.drafts, steps: plan.steps };
    return { ...localAnswer(message, ctx), source: 'LOCAL', model: null, fallbackReason: reason, links };
  };
  if (!env.AI_API_KEY || !aiBase(env)) return local('NOT_CONFIGURED');
  if (!await takeQuota(env, 'ASSISTANT')) return local('DAILY_LIMIT');
  const knowledge = (hits.length ? hits : searchFaq('站点 费用 预约', 3)).map(h => `问：${h.question}\n答：${h.answer}`).join('\n\n');
  const system = [
    '你是“CampusDrop 校园快递”（青岛科技大学崂山校区的校园包裹配送服务，独立项目，非学校或菜鸟官方产品）的智能助手。',
    '只根据下面提供的“服务规则”“相关问答”和“该同学的订单”回答；资料里没有的内容就直接说不知道，并建议在常见问题中查找或发起售后工单，不要编造时间、价格、电话或政策。',
    '你不能替同学付款、取消或修改已有订单（安排新配送只能生成草稿，由同学确认），只能说明在哪个页面操作。不要索要或复述密码、取件码、收货码、电话号码。',
    '用简体中文回答（对方用英文时用英文），口语化、具体，一般不超过 150 字，不用 Markdown 标题和表格。',
    '',
    '【服务规则】',
    ...SERVICE_FACTS(),
    `站点：${ctx.stations.map(s => `${s.name}（${s.location}）`).join('；')}。`,
    ctx.weather?.enabled ? `当前天气联动：${ctx.weather.level === 'CLEAR' ? '天气正常，没有额外延迟' : ctx.weather.notice ?? '雨雪天气，配送可能稍慢'}` : '天气联动未开启。',
    '',
    '【相关问答】',
    knowledge,
    '',
    '【该同学的订单（只含状态，不含个人信息）】',
    ctx.orderLines.length ? ctx.orderLines.join('\n') : '没有进行中的订单',
    ctx.waitingLines.length ? ctx.waitingLines.join('\n') : '没有待安排配送的包裹',
  ].join('\n');
  try {
    const plan = await modelAssistant(env, user, message, history, system);
    return { answer: plan.answer, source: 'MODEL', model: aiModel(env), fallbackReason: null, links: plan.drafts.length ? [] : links, references: hits.slice(0, 3).map(h => h.question), drafts: plan.drafts, steps: plan.steps };
  } catch {
    return local('MODEL_ERROR');
  }
}

// ---------------------------------------------------------------- AI 运营小结
const pct = (r: PunctualityRow | undefined) => { const v = r ? rate(r) : null; return v == null ? null : Math.round(v * 100); };
async function opsSummary(env: Env, admin: Parameters<typeof orderScope>[0], days: number): Promise<OpsSummary> {
  const report = await punctuality(env, admin, days, 60);
  const scope = orderScope(admin);
  const open = await env.DB.prepare(`SELECT
      sum(CASE WHEN o.status='WAITING_PICKUP' AND NOT EXISTS(SELECT 1 FROM batch_items bi WHERE bi.order_id=o.id) THEN 1 ELSE 0 END) AS unclaimed,
      sum(CASE WHEN o.status='DELIVERY_EXCEPTION' THEN 1 ELSE 0 END) AS exceptions,
      sum(CASE WHEN o.status IN ('PICKED_UP','OUT_FOR_DELIVERY') THEN 1 ELSE 0 END) AS onTheWay
    FROM delivery_orders o WHERE ${scope.sql} AND o.status IN ('WAITING_PICKUP','PICKED_UP','OUT_FOR_DELIVERY','DELIVERY_EXCEPTION')
      AND EXISTS(SELECT 1 FROM payments p WHERE p.order_id=o.id AND p.type='DELIVERY')`).bind(...scope.params).first<{ unclaimed: number | null; exceptions: number | null; onTheWay: number | null }>();
  const rated = (rows: PunctualityRow[]) => rows.filter(r => r.delivered >= 5 && rate(r) != null).sort((a, b) => rate(a)! - rate(b)!);
  const worstBuilding = rated(report.byBuilding)[0], worstSlot = rated(report.bySlot)[0];
  const wet = report.byWeather.find(r => r.key === 'WET'), severe = report.byWeather.find(r => r.key === 'SEVERE'), clear = report.byWeather.find(r => r.key === 'CLEAR');
  const busiest = [...report.byDay].sort((a, b) => b.delivered - a.delivered)[0];
  const facts: OpsSummary['facts'] = {
    统计天数: days, 已送达: report.total.delivered, 准时率: pct(report.total), 平均配送分钟: report.total.avgMinutes,
    接单等待中位数分钟: report.claimMedian, 路上用时中位数分钟: report.rideMedian,
    准时率最低楼栋: worstBuilding ? `${worstBuilding.label} ${pct(worstBuilding)}%（${worstBuilding.onTime}/${worstBuilding.delivered}）` : null,
    准时率最低时段: worstSlot ? `${worstSlot.label} ${pct(worstSlot)}%` : null,
    无雨雪准时率: pct(clear), 雨雪准时率: pct(wet), 恶劣天气准时率: pct(severe),
    单量最多的一天: busiest ? `${busiest.label}（${busiest.delivered} 单）` : null,
    当前待接单: open?.unclaimed ?? 0, 当前配送中: open?.onTheWay ?? 0, 当前配送异常: open?.exceptions ?? 0,
  };
  const generatedAt = now();
  const local = (): string[] => {
    if (!report.total.delivered) return [`近 ${days} 天暂无送达记录，暂时无法分析准时率。`, `当前待接单 ${facts.当前待接单} 单、配送中 ${facts.当前配送中} 单。`];
    const out = [`近 ${days} 天共送达 ${report.total.delivered} 单，准时率 ${facts.准时率}%，平均配送 ${report.total.avgMinutes ?? '—'} 分钟，接单等待中位数 ${report.claimMedian ?? '—'} 分钟。`];
    if (worstBuilding && (pct(worstBuilding) ?? 100) < (facts.准时率 as number)) out.push(`准时率最低的楼栋是${facts.准时率最低楼栋}，可以优先排查这栋楼的路线或安排。`);
    if (wet && clear && (pct(wet) ?? 100) < (pct(clear) ?? 0) - 5) out.push(`雨雪天准时率 ${pct(wet)}%，比无雨雪时（${pct(clear)}%）低 ${(pct(clear) ?? 0) - (pct(wet) ?? 0)} 个百分点，雨天可以提前增加配送员或在运营设置里手动指定天气等级。`);
    if (worstSlot && (pct(worstSlot) ?? 100) < 85) out.push(`${facts.准时率最低时段}的时段准时率偏低，可以考虑调低该时段名额或增加排班。`);
    if ((facts.当前配送异常 as number) > 0) out.push(`当前有 ${facts.当前配送异常} 单配送异常，请尽快处理归还与核验。`);
    if ((facts.当前待接单 as number) > 0) out.push(`当前还有 ${facts.当前待接单} 单等待接单。`);
    return out.slice(0, 5);
  };
  const base = { days, generatedAt, facts };
  if (!env.AI_API_KEY || !aiBase(env)) { await countFallback(env, 'OPS_SUMMARY'); return { ...base, bullets: local(), source: 'LOCAL', model: null, fallbackReason: 'NOT_CONFIGURED' }; }
  if (!await takeQuota(env, 'OPS_SUMMARY')) { await countFallback(env, 'OPS_SUMMARY'); return { ...base, bullets: local(), source: 'LOCAL', model: null, fallbackReason: 'DAILY_LIMIT' }; }
  try {
    const text = await chat(env, [
      { role: 'system', content: '你是校园快递配送服务的运营分析助手。只根据给出的统计数据写 3 到 5 条简短的中文运营小结，每条一行、以“· ”开头，先说结论再给一个可执行的建议；不要编造数据里没有的数字或原因，数据不足时直接说明。' },
      { role: 'user', content: `统计数据（JSON）：${JSON.stringify(facts)}` },
    ], 500);
    const bullets = cleanAnswer(text, 1200).split('\n').map(l => l.replace(/^[·•\-\d.、\s]+/, '').trim()).filter(Boolean).slice(0, 5);
    if (!bullets.length) throw new Error('empty');
    return { ...base, bullets, source: 'MODEL', model: aiModel(env), fallbackReason: null };
  } catch {
    await countFallback(env, 'OPS_SUMMARY');
    return { ...base, bullets: local(), source: 'LOCAL', model: null, fallbackReason: 'MODEL_ERROR' };
  }
}

export async function aiRoutes(request: Request, env: Env): Promise<Response | null> {
  const url = new URL(request.url), path = url.pathname.replace(/^\/api\/v1/, ''), method = request.method;
  if (path === '/assistant' && method === 'POST') {
    const user = await requireStudent(request, env);
    await rateLimit(env, `assistant:${user.id}`, 30);
    const data = await body(request, assistantAskSchema);
    return json({ reply: await assistantReply(env, user, data.message, data.history ?? []) });
  }
  if (path === '/assistant/status' && method === 'GET') {
    return json({ configured: !!env.AI_API_KEY && !!aiBase(env), model: env.AI_API_KEY ? aiModel(env) : null, faq: FAQ.length, vision: visionConfigured(env), visionModel: visionConfigured(env) ? visionModel(env) : null });
  }
  if (path === '/admin/ops-summary' && method === 'GET') {
    const admin = await requireAdmin(request, env);
    const days = Number(url.searchParams.get('days') ?? 7);
    if (![7, 14, 30].includes(days)) throw new ApiError(400, 'INVALID_FILTER', '统计范围只支持 7、14、30 天');
    await rateLimit(env, `ops-summary:${admin.id}`, 12);
    return json({ summary: await opsSummary(env, admin, days) });
  }
  return null;
}

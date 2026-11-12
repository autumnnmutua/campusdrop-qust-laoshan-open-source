/* © 2026 专业团队 · CampusDrop v4.7.0 · WM-A372E4790D8B1C09-39D76AD9C9 */
import type { Env } from './types';
import type { Student } from '../shared/contracts';
import { body, json } from './http';
import { requireStudent } from './session';
import { rateLimit } from './rate-limit';
import { readAddress } from './addresses';
import { slotAvailability } from './live-delivery';
import { priceFen } from '../domain/commerce';
import { slotLabel, type SlotCode, SLOT_CODES } from '../shared/slots';
import { GROUP_MAX_PARCELS } from '../shared/v3';
import { DROP_PLACES, DROP_PLACE_LABELS, type DropPlace } from '../shared/campus-map';
import { agentPlanSchema, isDropPlace, parseDeliveryIntent, resolveSlot, type AgentDraft, type AgentPlan, type AgentStep, type DeliveryIntent } from '../shared/agent';
import { aiConfigured, aiModel, cleanAnswer, completion, countFallback, takeQuota, type WireMessage } from './ai-model';

/*
 * v3.6 · 智能体助手 / 一句话下单 (planning only).
 *
 * The planner works with four tools over the student's own data: list the waiting parcels, list the open windows,
 * quote a price and draft a delivery. A draft is checked here exactly as an order would be (own parcels, not yet
 * ordered, one station per merged delivery, at most six, drop-off point only with downstairs pricing, window open and
 * not full) but nothing is written: the student confirms a draft in the page, which calls POST /orders or
 * /order-groups and goes on to checkout. With a model configured the model chooses the tool calls (OpenAI-compatible
 * function calling); otherwise the rule-based parser in shared/agent.ts drives the same tools. Tool results sent to the
 * model never contain pickup codes, names, phone numbers or room numbers; parcels are referred to as P1, P2 ….
 */
const now = () => Math.floor(Date.now() / 1000);
const yuan = (fen: number) => `${(fen / 100).toFixed(fen % 100 ? 2 : 0)} 元`;
const SIZE = { SMALL: '小件', LARGE: '大件', EXTRA_LARGE: '超大件' } as const;

type Waiting = { id: string; stationCode: string; stationName: string; packageSize: 'SMALL' | 'LARGE'; carrier: string | null; createdAt: number };
async function waitingParcels(env: Env, userId: string, only?: string[]): Promise<Waiting[]> {
  const rows = (await env.DB.prepare(`SELECT p.id,p.station_code AS stationCode,coalesce(s.canonical_name,p.station_code) AS stationName,CASE WHEN p.oversize=1 THEN 'EXTRA_LARGE' ELSE p.size END AS packageSize,p.carrier,p.created_at AS createdAt
    FROM parcels p LEFT JOIN stations s ON s.code=p.station_code WHERE p.user_id=? AND p.status='ACTIVE'
    AND NOT EXISTS(SELECT 1 FROM delivery_orders o WHERE o.parcel_id=p.id AND o.status<>'CANCELLED') ORDER BY p.created_at,p.id LIMIT 30`).bind(userId).all<Waiting>()).results;
  return only ? rows.filter(r => only.includes(r.id)) : rows;
}

type Slots = Awaited<ReturnType<typeof slotAvailability>>;
interface Ctx { env: Env; user: Student; t: number; hasAddress: boolean; parcels: Waiting[]; slots: Slots; refs: Map<string, Waiting>; steps: AgentStep[]; drafts: AgentDraft[] }
async function context(env: Env, user: Student, only?: string[]): Promise<Ctx> {
  const address = await readAddress(env, user.id);
  const [parcels, slots] = await Promise.all([waitingParcels(env, user.id, only), slotAvailability(env, address?.buildingCode ?? null)]);
  return { env, user, t: now(), hasAddress: !!address, parcels, slots, refs: new Map(parcels.map((p, i) => [`P${i + 1}`, p])), steps: [], drafts: [] };
}
const slotState = (c: Ctx, date: string, code: SlotCode) => c.slots.slots.find(s => s.date === date && s.code === code);
const isOpen = (c: Ctx) => (date: string, code: SlotCode) => !!slotState(c, date, code)?.open;

/** Checks and prices one delivery; the error text is what the student (or the model) is told. */
function draft(c: Ctx, parcels: Waiting[], mode: 'DOWNSTAIRS' | 'ROOM', slot: { date: string; code: SlotCode } | null, dropPlace: DropPlace | null): AgentDraft | string {
  if (!c.hasAddress) return '请先在“我的”里填写寝室资料';
  if (!parcels.length) return '没有选中包裹';
  if (parcels.length > GROUP_MAX_PARCELS) return `一次最多合并 ${GROUP_MAX_PARCELS} 件`;
  if (new Set(parcels.map(p => p.stationCode)).size > 1) return '合并配送只能是同一站点的包裹，不同站点请分成两单';
  if (dropPlace && mode !== 'DOWNSTAIRS') return '送到约定地点按楼下配送计价，不能选送到寝室';
  if (slot) {
    const state = slotState(c, slot.date, slot.code);
    if (!state) return '只能预约今天到后天的时段';
    if (c.slots.paused && !c.user.demo) return `暂停接单中：${c.slots.pauseReason || '请稍后再试'}`;
    if (!state.open) return `${slotLabel(slot.date, slot.code, c.t)} 已停止预约或已约满`;
    if (state.capacity - state.booked < parcels.length) return `${slotLabel(slot.date, slot.code, c.t)} 只剩 ${Math.max(0, state.capacity - state.booked)} 个名额`;
  } else if (c.slots.paused && !c.user.demo) return `暂停接单中：${c.slots.pauseReason || '请稍后再试'}`;
  const amountFen = parcels.reduce((sum, p) => sum + priceFen(p.packageSize, mode), 0);
  const where = dropPlace ? `送到${DROP_PLACE_LABELS[dropPlace]}` : mode === 'ROOM' ? '送到寝室' : '送到楼下';
  const when = slot ? slotLabel(slot.date, slot.code, c.t) : '尽快送达';
  const what = parcels.length > 1 ? `${parcels.length} 件合并配送` : `${SIZE[parcels[0].packageSize]}${parcels[0].carrier ? `（${parcels[0].carrier}）` : ''}`;
  return {
    parcelIds: parcels.map(p => p.id), parcels: parcels.map(p => ({ id: p.id, packageSize: p.packageSize, carrier: p.carrier })),
    stationCode: parcels[0].stationCode, stationName: parcels[0].stationName, deliveryMode: mode, slotDate: slot?.date ?? null, slotCode: slot?.code ?? null, dropPlace,
    amountFen, summary: `${parcels[0].stationName} ${what} · ${where} · ${when} · ${yuan(amountFen)}`,
  };
}
function keep(c: Ctx, d: AgentDraft) {
  // A later draft replaces any earlier one that shares a parcel.
  c.drafts = c.drafts.filter(x => !x.parcelIds.some(id => d.parcelIds.includes(id)));
  c.drafts.push(d);
}
const parcelLine = (c: Ctx) => {
  const by = new Map<string, number>();
  for (const p of c.parcels) by.set(p.stationName, (by.get(p.stationName) ?? 0) + 1);
  return c.parcels.length ? `${c.parcels.length} 件：${[...by.entries()].map(([s, n]) => `${s} ${n} 件`).join('、')}` : '没有待安排的包裹';
};
const openLine = (c: Ctx) => { const open = c.slots.slots.filter(s => s.open); return open.length ? `${open.length} 个时段可约，最近：${slotLabel(open[0].date, open[0].code, c.t)}` : '近三天没有可约时段，可以选尽快送达'; };

// ---------------------------------------------------------------- rule-based planner
function intentText(i: DeliveryIntent, slot: { date: string; code: SlotCode } | null | 'CLOSED', c: Ctx): string {
  const parts = [i.dropPlace ? `送到${DROP_PLACE_LABELS[i.dropPlace]}` : i.mode === 'ROOM' ? '送到寝室' : i.mode === 'DOWNSTAIRS' ? '送到楼下' : '配送方式未说明（按楼下）'];
  parts.push(slot === 'CLOSED' ? '想要的时段已约满或已截止' : slot ? slotLabel(slot.date, slot.code, c.t) : '尽快送达');
  if (i.station) parts.push(i.station === 'NANSHI' ? '只看南十对面站点' : '只看颐海苑站点');
  if (i.count) parts.push(`${i.count} 件`);
  if (i.size) parts.push(SIZE[i.size]);
  if (i.carrier) parts.push(i.carrier);
  if (!i.merge) parts.push('分开配送');
  return parts.join(' · ');
}
function localPlan(c: Ctx, message: string, forced: boolean): AgentPlan | null {
  const intent = parseDeliveryIntent(message);
  if (!intent.wantsDelivery && !forced) return null;
  const slot = resolveSlot(intent, c.t, isOpen(c));
  c.steps.push({ tool: 'understand', label: '理解需求', detail: intentText(intent, slot, c), ok: true });
  c.steps.push({ tool: 'list_parcels', label: '查询待配送包裹', detail: parcelLine(c), ok: c.parcels.length > 0 });
  const base = { source: 'LOCAL' as const, model: null, fallbackReason: null };
  if (!c.parcels.length) return { ...base, answer: '你目前没有已登记、还没安排配送的包裹。先在“添加快递”里粘贴驿站短信或填写取件码，再告诉我怎么送。', drafts: [], steps: c.steps };
  let pick = c.parcels.filter(p => (!intent.station || p.stationCode === intent.station) && (!intent.size || p.packageSize === intent.size) && (!intent.carrier || p.carrier === intent.carrier));
  if (!pick.length) return { ...base, answer: `没有找到符合条件的待配送包裹（${intentText(intent, slot, c)}）。你现在有 ${parcelLine(c)}。`, drafts: [], steps: c.steps };
  if (intent.count && intent.count < pick.length) {
    // "两件" means two parcels of one station when possible, so they can travel together.
    const byStation = [...new Set(pick.map(p => p.stationCode))].map(code => pick.filter(p => p.stationCode === code)).sort((a, b) => b.length - a.length);
    pick = (byStation[0].length >= intent.count ? byStation[0] : pick).slice(0, intent.count);
  }
  c.steps.push({ tool: 'list_slots', label: '查询可约时段', detail: slot === 'CLOSED' ? `想要的时段不可约；${openLine(c)}` : slot ? `${slotLabel(slot.date, slot.code, c.t)}：已约 ${slotState(c, slot.date, slot.code)?.booked ?? 0} / ${slotState(c, slot.date, slot.code)?.capacity ?? 0}` : '尽快送达，不占预约名额', ok: slot !== 'CLOSED' });
  if (slot === 'CLOSED') {
    const open = c.slots.slots.filter(s => s.open).slice(0, 3).map(s => slotLabel(s.date, s.code, c.t));
    return { ...base, answer: `你想要的时段已经截止或约满了。${open.length ? `还可以约：${open.join('、')}；` : ''}也可以说“尽快送”。换个说法再试一次吧。`, drafts: [], steps: c.steps };
  }
  const mode = intent.dropPlace ? 'DOWNSTAIRS' : intent.mode ?? 'DOWNSTAIRS';
  const groups = intent.merge ? [...new Set(pick.map(p => p.stationCode))].map(code => pick.filter(p => p.stationCode === code)) : pick.map(p => [p]);
  const problems: string[] = [];
  for (const g of groups) for (let i = 0; i < g.length; i += GROUP_MAX_PARCELS) {
    const d = draft(c, g.slice(i, i + GROUP_MAX_PARCELS), mode, slot, intent.dropPlace);
    if (typeof d === 'string') problems.push(d); else keep(c, d);
  }
  const total = c.drafts.reduce((s, d) => s + d.amountFen, 0);
  c.steps.push({ tool: 'quote', label: '计算费用', detail: c.drafts.length ? `${c.drafts.map(d => `${d.parcels.length} 件 ${yuan(d.amountFen)}`).join('，')}，合计 ${yuan(total)}` : '—', ok: c.drafts.length > 0 });
  c.steps.push({ tool: 'draft', label: '生成待确认订单', detail: c.drafts.length ? `${c.drafts.length} 个配送待你确认${problems.length ? `；${problems.join('；')}` : ''}` : problems.join('；'), ok: c.drafts.length > 0 });
  if (!c.drafts.length) return { ...base, answer: `没能生成订单：${problems.join('；')}。`, drafts: [], steps: c.steps };
  const merged = c.drafts.filter(d => d.parcels.length > 1).length;
  const answer = [
    `按“${message.trim().slice(0, 40)}”，我准备了 ${c.drafts.length} 个待确认的配送${merged ? `（同一站点的包裹已分组，通常一起送，特殊情况可能分批）` : ''}，合计 ${yuan(total)}。`,
    problems.length ? `另外：${problems.join('；')}。` : '',
    '核对后点“确认下单”，再到支付页完成模拟支付；不合适可以点“修改”。',
  ].filter(Boolean).join('\n');
  return { ...base, answer, drafts: c.drafts, steps: c.steps };
}

// ---------------------------------------------------------------- model planner (function calling)
const TOOLS = [
  { type: 'function', function: { name: 'list_waiting_parcels', description: '列出该同学已登记、还没安排配送的包裹。返回 ref（P1、P2…）、站点、大小、承运商；不含取件码。', parameters: { type: 'object', properties: {}, required: [] } } },
  { type: 'function', function: { name: 'list_open_slots', description: '列出今天到后天可预约的配送时段及剩余名额。不预约时段即为“尽快送达”。', parameters: { type: 'object', properties: {}, required: [] } } },
  { type: 'function', function: { name: 'quote', description: '计算配送费（单件）。', parameters: { type: 'object', properties: { package_size: { type: 'string', enum: ['SMALL', 'LARGE'] }, delivery_mode: { type: 'string', enum: ['DOWNSTAIRS', 'ROOM'] } }, required: ['package_size', 'delivery_mode'] } } },
  { type: 'function', function: {
    name: 'draft_delivery',
    description: '生成一个待同学确认的配送草稿（不会真正下单）。同一站点的 2–6 件包裹可以合并成一个配送；不同站点要分开调用。约定地点只能配合 DOWNSTAIRS。',
    parameters: { type: 'object', properties: {
      parcel_refs: { type: 'array', items: { type: 'string' }, description: '包裹 ref，如 ["P1","P2"]' },
      delivery_mode: { type: 'string', enum: ['DOWNSTAIRS', 'ROOM'], description: 'DOWNSTAIRS=送到楼下，ROOM=送到寝室' },
      slot_date: { type: 'string', description: '预约日期 YYYY-MM-DD；尽快送达时不填' },
      slot_code: { type: 'string', enum: [...SLOT_CODES], description: 'NOON 午间 / EVENING 傍晚 / NIGHT 晚间；尽快送达时不填' },
      drop_place: { type: 'string', enum: [...DROP_PLACES], description: '送到校园约定地点（可选）' },
    }, required: ['parcel_refs', 'delivery_mode'] },
  } },
];
const s = (v: unknown) => typeof v === 'string' ? v : '';
function runTool(c: Ctx, name: string, rawArgs: string): unknown {
  let args: Record<string, unknown> = {};
  try { const parsed = JSON.parse(rawArgs || '{}'); if (parsed && typeof parsed === 'object') args = parsed as Record<string, unknown>; } catch { return { error: '参数不是合法 JSON' }; }
  if (name === 'list_waiting_parcels') {
    c.steps.push({ tool: 'list_parcels', label: '查询待配送包裹', detail: parcelLine(c), ok: c.parcels.length > 0 });
    return { parcels: [...c.refs.entries()].map(([ref, p]) => ({ ref, station: p.stationName, station_code: p.stationCode, size: p.packageSize, carrier: p.carrier })) };
  }
  if (name === 'list_open_slots') {
    c.steps.push({ tool: 'list_slots', label: '查询可约时段', detail: openLine(c), ok: true });
    return { paused: c.slots.paused && !c.user.demo, slots: c.slots.slots.filter(x => x.open).map(x => ({ date: x.date, code: x.code, label: slotLabel(x.date, x.code, c.t), remaining: Math.max(0, x.capacity - x.booked) })) };
  }
  if (name === 'quote') {
    const size = s(args.package_size), mode = s(args.delivery_mode);
    if (!['SMALL', 'LARGE'].includes(size) || !['DOWNSTAIRS', 'ROOM'].includes(mode)) return { error: '参数不正确' };
    const fen = priceFen(size as 'SMALL', mode as 'ROOM');
    c.steps.push({ tool: 'quote', label: '计算费用', detail: `${SIZE[size as 'SMALL']} · ${mode === 'ROOM' ? '送到寝室' : '楼下'} ${yuan(fen)}`, ok: true });
    return { amount_yuan: fen / 100 };
  }
  if (name === 'draft_delivery') {
    const refs = Array.isArray(args.parcel_refs) ? [...new Set(args.parcel_refs.map(s))] : [];
    const parcels = refs.map(r => c.refs.get(r.toUpperCase())).filter((p): p is Waiting => !!p);
    const mode = s(args.delivery_mode) === 'ROOM' ? 'ROOM' : 'DOWNSTAIRS';
    const date = s(args.slot_date), code = s(args.slot_code);
    const slot = date && (SLOT_CODES as readonly string[]).includes(code) ? { date, code: code as SlotCode } : null;
    const place = isDropPlace(args.drop_place) ? args.drop_place : null;
    const result = parcels.length !== refs.length ? '有包裹编号不存在，请先调用 list_waiting_parcels' : (date || code) && !slot ? '时段参数不完整' : draft(c, parcels, mode, slot, place);
    c.steps.push({ tool: 'draft', label: '生成待确认订单', detail: typeof result === 'string' ? `未通过：${result}` : result.summary, ok: typeof result !== 'string' });
    if (typeof result === 'string') return { ok: false, error: result };
    keep(c, result);
    return { ok: true, draft: result.summary, note: '草稿已展示给同学，需同学点击“确认下单”后才会创建订单' };
  }
  return { error: '未知工具' };
}

/** Model-driven plan. Throws on any model failure so the caller can fall back to the rules. */
async function modelPlan(c: Ctx, system: string, history: { role: 'user' | 'assistant'; content: string }[], message: string): Promise<AgentPlan> {
  const messages: WireMessage[] = [{ role: 'system', content: system }, ...history.slice(-6), { role: 'user', content: message }];
  let calls = 0;
  for (let round = 0; round < 5; round++) {
    const reply = await completion(c.env, { messages, tools: TOOLS, max_tokens: 500 });
    if (!reply.tool_calls?.length) {
      const answer = cleanAnswer(reply.content ?? '');
      if (!answer && !c.drafts.length) throw new Error('empty model answer');
      return { answer: answer || '已为你准备好待确认的配送，请核对后确认下单。', drafts: c.drafts, steps: c.steps, source: 'MODEL', model: aiModel(c.env), fallbackReason: null };
    }
    messages.push({ role: 'assistant', content: reply.content ?? '', tool_calls: reply.tool_calls });
    for (const call of reply.tool_calls) {
      if (++calls > 10) throw new Error('too many tool calls');
      messages.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify(runTool(c, call.function.name, call.function.arguments)) });
    }
  }
  if (c.drafts.length) return { answer: '已为你准备好待确认的配送，请核对后确认下单。', drafts: c.drafts, steps: c.steps, source: 'MODEL', model: aiModel(c.env), fallbackReason: null };
  throw new Error('no answer after tool rounds');
}
export const AGENT_RULES = [
  '你可以帮同学“安排配送”：先调用 list_waiting_parcels 和 list_open_slots 查清楚，再调用 draft_delivery 生成草稿。同一站点的多件包裹优先合并配送，每组最多 6 件，超出时分组；同学没说时间就是尽快送达，没说送到哪里就是楼下。',
  '草稿不是订单：生成后告诉同学核对并点“确认下单”，然后去支付页完成模拟支付。绝不能说“已下单”“已付款”。',
  '同学只是问问题（费用、规则、进度）时直接回答，不要生成草稿。',
];

/**
 * Plans a delivery for a sentence. `forced` = the caller knows the sentence is about arranging a delivery (the
 * one-sentence box); otherwise null is returned when the rules do not see a delivery request and no model is used.
 */
export async function planDelivery(env: Env, user: Student, message: string, opts: { only?: string[]; forced: boolean; history?: { role: 'user' | 'assistant'; content: string }[]; system?: string; quotaTaken?: boolean }): Promise<AgentPlan | null> {
  const c = await context(env, user, opts.only);
  const fallback = (reason: AgentPlan['fallbackReason']): AgentPlan | null => {
    const fresh: Ctx = { ...c, steps: [], drafts: [] };
    const plan = localPlan(fresh, message, opts.forced);
    return plan ? { ...plan, fallbackReason: reason } : null;
  };
  if (!aiConfigured(env)) return fallback('NOT_CONFIGURED');
  if (!opts.quotaTaken && !await takeQuota(env, 'ASSISTANT')) { await countFallback(env, 'ASSISTANT'); return fallback('DAILY_LIMIT'); }
  const system = opts.system ?? [
    '你是“CampusDrop 校园快递”（青岛科技大学崂山校区校园包裹配送服务）的下单助手。用简体中文（对方用英文时用英文）简短回答，不用 Markdown。',
    ...AGENT_RULES,
    opts.only ? '同学刚登记了这些包裹，只为它们安排配送。' : '',
    `现在是北京时间 ${new Date((c.t + 8 * 3600) * 1000).toISOString().slice(0, 16).replace('T', ' ')}。`,
  ].filter(Boolean).join('\n');
  try {
    return await modelPlan(c, system, opts.history ?? [], opts.forced ? `请帮我安排配送：${message}` : message);
  } catch {
    await countFallback(env, 'ASSISTANT');
    return fallback('MODEL_ERROR');
  }
}

/** For the assistant (v3.5 panel): the rules see a delivery request → a local plan; otherwise null. */
export async function localDeliveryPlan(env: Env, user: Student, message: string): Promise<AgentPlan | null> {
  if (!parseDeliveryIntent(message).wantsDelivery) return null;
  return localPlan(await context(env, user), message, false);
}
/** For the assistant with a model: the full tool loop with the assistant's own system prompt. Throws on model failure. */
export async function modelAssistant(env: Env, user: Student, message: string, history: { role: 'user' | 'assistant'; content: string }[], system: string): Promise<AgentPlan> {
  return modelPlan(await context(env, user), `${system}\n\n【安排配送】\n${AGENT_RULES.join('\n')}\n现在是北京时间 ${new Date((now() + 8 * 3600) * 1000).toISOString().slice(0, 16).replace('T', ' ')}。`, history, message);
}

export async function agentRoutes(request: Request, env: Env): Promise<Response | null> {
  const path = new URL(request.url).pathname.replace(/^\/api\/v1/, '');
  if (path !== '/agent/plan' || request.method !== 'POST') return null;
  const user = await requireStudent(request, env);
  await rateLimit(env, `assistant:${user.id}`, 30);
  const data = await body(request, agentPlanSchema);
  return json({ plan: await planDelivery(env, user, data.message, { only: data.parcelIds, forced: true }) });
}

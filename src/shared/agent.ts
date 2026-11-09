/* © 2026 专业团队 · CampusDrop v4.5.0 */
import { z } from 'zod';
import { DELIVERY_SLOTS, bookableDates, slotOpen, type SlotCode } from './slots.ts';
import { DROP_PLACES, DROP_PLACE_LABELS, type DropPlace } from './campus-map.ts';
import { CARRIERS } from './constants.ts';
import type { AiSource } from './assistant.ts';

/*
 * v3.6 · 智能体助手 and 一句话下单. The assistant can now plan a delivery: it looks up the student's waiting parcels and
 * the open windows, works out the price and returns one or more DRAFT orders with the steps it took. Nothing is ordered
 * until the student taps "确认下单" on a draft, which goes through the ordinary order endpoints (and then checkout).
 * With a model configured the planning is done by the model through tool calls; without one, by the rule-based
 * parser below — the same tools, the same drafts.
 */
export const AGENT_MAX_CHARS = 120;
export const agentPlanSchema = z.object({
  message: z.string().trim().min(1, '请写一句话，例如“晚上送寝室”').max(AGENT_MAX_CHARS, `请控制在 ${AGENT_MAX_CHARS} 字以内`),
  /** Limit the plan to these parcels (the one-sentence box on the add-parcel page passes the parcel just saved). */
  parcelIds: z.array(z.uuid()).min(1).max(6).optional(),
}).strict();
export type AgentPlanInput = z.infer<typeof agentPlanSchema>;

export interface AgentDraftParcel { id: string; packageSize: 'SMALL' | 'LARGE'; carrier: string | null }
/** A delivery the agent proposes; one parcel = one order, two or more = a merged delivery (合并配送). */
export interface AgentDraft {
  parcelIds: string[];
  parcels: AgentDraftParcel[];
  stationCode: string;
  stationName: string;
  deliveryMode: 'DOWNSTAIRS' | 'ROOM';
  slotDate: string | null;
  slotCode: SlotCode | null;
  dropPlace: DropPlace | null;
  amountFen: number;
  /** One line: "南苑十号楼对面站点 2 件合并 · 送到寝室 · 今天 晚间 20:00–22:00". */
  summary: string;
}
/** One step of the agent's work, shown to the student under the answer ("查看智能体步骤"). */
export interface AgentStep { tool: 'understand' | 'list_parcels' | 'list_slots' | 'quote' | 'draft' | 'list_orders'; label: string; detail: string; ok: boolean }
export interface AgentPlan {
  answer: string;
  drafts: AgentDraft[];
  steps: AgentStep[];
  source: AiSource;
  model: string | null;
  fallbackReason: 'NOT_CONFIGURED' | 'DAILY_LIMIT' | 'MODEL_ERROR' | null;
}

// ---------------------------------------------------------------- rule-based understanding (no model needed)
export interface DeliveryIntent {
  /** The sentence asks for a delivery to be arranged (not a question about how delivery works). */
  wantsDelivery: boolean;
  mode: 'DOWNSTAIRS' | 'ROOM' | null;
  /** 0 = today, 1 = tomorrow, 2 = the day after. */
  dayOffset: number | null;
  slotCode: SlotCode | null;
  asap: boolean;
  station: 'NANSHI' | 'YIHAIYUAN' | null;
  dropPlace: DropPlace | null;
  /** Merge parcels of one station into one delivery (默认合并；“分开送”关闭). */
  merge: boolean;
  /** How many parcels the sentence names ("两件"), when it does. */
  count: number | null;
  size: 'SMALL' | 'LARGE' | 'EXTRA_LARGE' | null;
  carrier: typeof CARRIERS[number] | null;
}
const NUMBERS: Record<string, number> = { 一: 1, 两: 2, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, '1': 1, '2': 2, '3': 3, '4': 4, '5': 5, '6': 6 };
const DROP_WORDS: [RegExp, DropPlace][] = [
  [/图书馆/, 'LIBRARY'], [/南苑?(餐厅|食堂)/, 'SOUTH_CANTEEN'], [/北苑?(餐厅|食堂)/, 'NORTH_CANTEEN'], [/体育场|操场/, 'STADIUM'],
  [/南门/, 'SOUTH_GATE'], [/西门/, 'WEST_GATE'], [/东门/, 'EAST_GATE'],
];
export function parseDeliveryIntent(raw: string): DeliveryIntent {
  const text = raw.replace(/\s+/g, '').toLowerCase();
  const dropPlace = DROP_WORDS.find(([re]) => re.test(text))?.[1] ?? null;
  const room = /寝室|宿舍门口|送上楼|上楼|到寝|门口|room|door/.test(text) && !/楼下/.test(text);
  const mode: DeliveryIntent['mode'] = dropPlace ? 'DOWNSTAIRS' : room ? 'ROOM' : /楼下|downstairs/.test(text) ? 'DOWNSTAIRS' : null;
  const dayOffset = /后天/.test(text) ? 2 : /明天|明晚|明早|明中午|tomorrow/.test(text) ? 1 : /今天|今晚|今中午|today|tonight/.test(text) ? 0 : null;
  const slotCode: SlotCode | null = /中午|午间|午饭|noon|lunch/.test(text) ? 'NOON'
    : /傍晚|下午|晚饭|evening/.test(text) ? 'EVENING'
    : /晚上|晚间|今晚|明晚|夜里|睡前|night|tonight/.test(text) ? 'NIGHT' : null;
  const asap = /尽快|马上|立刻|现在|越快越好|急|asap|now/.test(text);
  const station = /南十|南苑十|南10|nanshi/.test(text) ? 'NANSHI' : /颐海苑|怡海苑|颐海|yihaiyuan/.test(text) ? 'YIHAIYUAN' : null;
  const countMatch = /([一两二三四五六1-6])(件|个|单)/.exec(text);
  const count = countMatch ? NUMBERS[countMatch[1]] ?? null : null;
  const size = /超大件|特大|超大|extra[- ]?large/.test(text) ? 'EXTRA_LARGE' : /大件|大的|large/.test(text) ? 'LARGE' : /小件|小的|small/.test(text) ? 'SMALL' : null;
  const carrier = CARRIERS.find(c => c !== '其他' && text.includes(c)) ?? null;
  const merge = !/分开|单独|各自|separate/.test(text);
  const verb = /送|配送|下单|安排|deliver|bring/.test(text);
  const polite = /帮我|麻烦|请|给我|替我|把|help|please/.test(text);
  const question = /怎么|如何|多少|多久|什么|为什么|能不能|可不可以|是否|吗|呢|\?|？|how|what|why|can i|is it/.test(text);
  const concrete = mode !== null || dayOffset !== null || slotCode !== null || asap || station !== null || dropPlace !== null || count !== null || /合并|一起|全部|都/.test(text);
  return { wantsDelivery: verb && concrete && (polite || !question), mode, dayOffset, slotCode, asap, station, dropPlace, merge, count, size, carrier };
}

/** The window a sentence asks for, resolved against `now`: the named day and window, or the first open one that fits. */
export function resolveSlot(intent: Pick<DeliveryIntent, 'dayOffset' | 'slotCode' | 'asap'>, now: number, isOpen: (date: string, code: SlotCode) => boolean = (d, c) => slotOpen(d, c, now)): { date: string; code: SlotCode } | null | 'CLOSED' {
  if (intent.asap || (intent.dayOffset === null && intent.slotCode === null)) return null;
  const dates = bookableDates(now);
  const days = intent.dayOffset !== null ? [dates[intent.dayOffset]] : dates;
  const codes = intent.slotCode ? [intent.slotCode] : DELIVERY_SLOTS.map(s => s.code);
  for (const date of days) for (const code of codes) if (date && isOpen(date, code)) return { date, code };
  return 'CLOSED';
}
export const dropPlaceText = (p: DropPlace | null) => p ? DROP_PLACE_LABELS[p] : null;
export const isDropPlace = (v: unknown): v is DropPlace => typeof v === 'string' && (DROP_PLACES as readonly string[]).includes(v);

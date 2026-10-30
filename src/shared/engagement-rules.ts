/** Engagement rules and labels without zod, so the client can use them from its first-load bundle. */
import type { OrderStatus } from './delivery';

// ---------------------------------------------------------------- announcements
export const ANNOUNCEMENT_LEVELS = ['INFO', 'NOTICE', 'PAUSE'] as const;
export const ANNOUNCEMENT_LEVEL_LABELS = { INFO: '通知', NOTICE: '提醒', PAUSE: '暂停服务' } as const;
export type AnnouncementLevel = typeof ANNOUNCEMENT_LEVELS[number];
export interface Announcement { id: string; level: AnnouncementLevel; title: string; body: string; status: 'ACTIVE' | 'ARCHIVED'; startsAt: number; endsAt: number | null; createdAt: number; archivedAt?: number | null; author?: string; targets?: string[] | null }

// ---------------------------------------------------------------- ratings
export const RATING_TAGS_GOOD = ['准时送达', '包裹完好', '沟通及时', '态度友好', '放置位置准确'] as const;
export const RATING_TAGS_BAD = ['送达较慢', '包装受损', '联系不上', '放错位置'] as const;
export const RATING_TAGS = [...RATING_TAGS_GOOD, ...RATING_TAGS_BAD] as const;
export interface Rating { stars: number; tags: string[]; comment: string; createdAt: number }

// ---------------------------------------------------------------- student stats
export interface StudentStats {
  paidOrders: number; completed: number; active: number; roomDeliveries: number; largeParcels: number;
  ratingsGiven: number; firstOrderAt: number | null;
}
export interface Badge { id: string; label: string; hint: string; earned: boolean }
/** Badges are derived from real order counts only; there is no ranking and nothing to farm. */
export function badgesFor(s: StudentStats): Badge[] {
  return [
    { id: 'first', label: '初次相遇', hint: '完成第 1 单配送', earned: s.completed >= 1 },
    { id: 'five', label: '校园常客', hint: '累计完成 5 单', earned: s.completed >= 5 },
    { id: 'ten', label: '配送老友', hint: '累计完成 10 单', earned: s.completed >= 10 },
    { id: 'room', label: '直达寝室', hint: '有 3 单送到寝室', earned: s.roomDeliveries >= 3 },
    { id: 'big', label: '大件搬运', hint: '完成过大件配送', earned: s.largeParcels >= 1 },
    { id: 'voice', label: '热心反馈', hint: '评价过 3 次服务', earned: s.ratingsGiven >= 3 },
  ];
}

// ---------------------------------------------------------------- admin analytics
export interface Analytics {
  kpis: { today: number; last7: number; active: number; completed: number; closed: number; completionRate: number | null; avgDeliveryMinutes: number | null; avgStars: number | null; ratingCount: number };
  days: number;
  trend: { day: string; count: number }[];
  /** 7 rows (Monday first) x 24 hours, Beijing time, within the selected range. */
  heatmap: number[][];
  statuses: { status: OrderStatus; count: number }[];
  buildings: { building: string; count: number }[];
  mix: { size: 'SMALL' | 'LARGE'; mode: 'DOWNSTAIRS' | 'ROOM'; count: number }[];
  /** Per assignee within the range; only orders that were claimed (assigned to a batch) count. */
  staff: { name: string; orders: number; delivered: number; avgMinutes: number | null; avgStars: number | null; ratings: number }[];
  ratings: { distribution: number[]; tags: { tag: string; count: number }[]; recent: { stars: number; tags: string[]; comment: string; building: string; createdAt: number }[] };
}

// ---------------------------------------------------------------- overdue order alerts
/**
 * How long an order may sit in one status before the workspace flags it. These are operating targets chosen for the
 * campus service, not guarantees shown to students; adjust them here if the team works to different times.
 */
export const STALL_RULES = [
  { status: 'WAITING_PICKUP', minutes: 120, label: '待取件超过 2 小时' },
  { status: 'PICKED_UP', minutes: 120, label: '已取件超过 2 小时未出发' },
  { status: 'OUT_FOR_DELIVERY', minutes: 60, label: '配送中超过 1 小时' },
  { status: 'DELIVERED_DOWNSTAIRS', minutes: 1440, label: '送达超过 24 小时学生未确认' },
  { status: 'DELIVERED_TO_ROOM', minutes: 1440, label: '送达超过 24 小时学生未确认' },
  { status: 'FAILED_PICKUP', minutes: 720, label: '取件失败超过 12 小时未处理' },
  { status: 'DELIVERY_EXCEPTION', minutes: 720, label: '配送异常超过 12 小时未处理' },
] as const satisfies readonly { status: OrderStatus; minutes: number; label: string }[];
export interface StalledOrder { id: string; status: OrderStatus; label: string; building: string; roomNo: string; since: number; overdueMinutes: number; assignee: string | null }

// ---------------------------------------------------------------- SMS pickup-code recognition (runs in the browser only)
export interface RecognizedParcel { pickupCode: string; carrier?: string }
const CARRIER_HINTS: [RegExp, string][] = [
  [/申通/, '申通'], [/中通/, '中通'], [/圆通/, '圆通'], [/韵达/, '韵达'], [/顺丰/, '顺丰'],
  [/京东/, '京东'], [/邮政|EMS|邮件/i, '邮政'], [/极兔/, '极兔'],
];
/**
 * Pull pickup codes such as 87-5-2739 out of pasted station SMS text. Accepts common separators
 * (-, －, —, space) and returns unique codes in the order they appear, each with the carrier named
 * nearest before it in the same message when there is one.
 */
export function recognizePickupCodes(text: string): RecognizedParcel[] {
  const normalized = text.replace(/[－—–―]/g, '-').replace(/\u3000/g, ' ');
  const found: RecognizedParcel[] = []; const seen = new Set<string>();
  const re = /(?<![\d-])(\d{1,3})\s*-\s*(\d)\s*-\s*(\d{4})(?![\d-])/g;
  for (let m = re.exec(normalized); m; m = re.exec(normalized)) {
    const code = `${m[1]}-${m[2]}-${m[3]}`;
    if (seen.has(code)) continue; seen.add(code);
    const before = normalized.slice(Math.max(0, m.index - 60), m.index);
    let carrier: string | undefined, at = -1;
    for (const [hint, name] of CARRIER_HINTS) { const i = before.search(hint); if (i > at) { at = i; carrier = name; } }
    found.push(carrier ? { pickupCode: code, carrier } : { pickupCode: code });
  }
  return found;
}

// ---------------------------------------------------------------- pickup codes from OCR text (screenshots)
/** Characters OCR commonly confuses with digits, and what they most likely were. */
const OCR_DIGIT: Record<string, string> = { O: '0', o: '0', D: '0', Q: '0', I: '1', l: '1', '|': '1', '!': '1', i: '1', S: '5', s: '5', B: '8', Z: '2', z: '2' };
const LOOK = '0-9OoDQIl|!iSsBZz';
const OCR_CODE = new RegExp(`(?<![${LOOK}-])([${LOOK}]{1,3})\\s*[-—–―－~=_]\\s*([${LOOK}])\\s*[-—–―－~=_]\\s*([${LOOK}]{4})(?![${LOOK}])`, 'g');
/**
 * Pickup codes from OCR output of a screenshot. More forgiving than recognizePickupCodes: it accepts the dash
 * look-alikes OCR produces and maps letter/digit confusions (O→0, l→1, S→5, B→8 …) — but only inside a candidate
 * shaped like a code, and only when most of its characters were read as real digits, so ordinary words are never
 * turned into numbers. Carriers are not guessed (the on-device model reads Latin text and digits only).
 */
export function recognizeOcrCodes(text: string): RecognizedParcel[] {
  const out: RecognizedParcel[] = [], seen = new Set<string>();
  for (const m of text.matchAll(OCR_CODE)) {
    const raw = m[1] + m[2] + m[3];
    const realDigits = raw.replace(/\D/g, '').length;
    if (realDigits / raw.length < 0.75) continue;
    const fix = (s: string) => s.replace(/[^0-9]/g, c => OCR_DIGIT[c] ?? c);
    const code = `${fix(m[1])}-${fix(m[2])}-${fix(m[3])}`;
    if (!/^\d{1,3}-\d-\d{4}$/.test(code) || seen.has(code)) continue;
    seen.add(code); out.push({ pickupCode: code });
  }
  return out;
}

/**
 * Merge codes from both passes. OCR's most common slip on a pickup code is dropping a leading digit
 * ("7-5-2739" for "87-5-2739"), so a code that is a strict suffix of another found code is discarded.
 */
export function mergeOcrCodes(lists:string[][]):string[]{
  const all=[...new Set(lists.flat())];
  return all.filter(code=>!all.some(other=>other!==code&&other.length>code.length&&other.endsWith(code)));
}

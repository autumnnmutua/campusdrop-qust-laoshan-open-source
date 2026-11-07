/* © 2026 专业团队 · CampusDrop v4.0.0 */
/*
 * v3.6 · 单量预测与排班建议. Pure functions (unit-tested): the worker supplies paid orders per Beijing date and delivery
 * window; "as soon as possible" orders are put in the window nearest their payment time.
 *
 * Per window: weighted mean of the same weekday in the last four weeks (weights 4-3-2-1, recent first, only weeks the
 * service already ran) × a trend factor (last 14 days vs the 28 before, clamped 0.75–1.33, only with ≥10 orders in
 * each) × a weather factor for today (average day with rain/snow vs a dry day, clamped 0.7–1.5, only with ≥3 days of
 * each and only when it is wet now). The error band is the backtest's mean absolute error over the last 14 days, each
 * day predicted from the data before it. Staffing: expected orders ÷ orders one courier delivers in a window (median of
 * history, or 8 when there are fewer than 5 samples), rounded up.
 */
export const FORECAST_SLOTS = ['NOON', 'EVENING', 'NIGHT'] as const;
export type ForecastSlotCode = typeof FORECAST_SLOTS[number];
export type DayCounts = Record<ForecastSlotCode, number>;
export const DEFAULT_PER_COURIER = 8;

export interface ForecastSlot { code: ForecastSlotCode; /** Paid orders already in this window. */ booked: number; expected: number; low: number; high: number; suggested: number; scheduled: number | null; status: 'ok' | 'short' | 'over' | 'none' }
export interface ForecastDay { date: string; weekday: number; insufficient: boolean; samples: number; total: number | null; weatherFactor: number | null; slots: ForecastSlot[] }
export interface ForecastReport {
  days: ForecastDay[];
  trend: number; trendApplied: boolean;
  backtest: { days: number; mae: number | null; mape: number | null };
  perCourier: number; perCourierBasis: 'history' | 'default';
  weather: { level: 'CLEAR' | 'WET' | 'SEVERE' | 'UNKNOWN'; factor: number | null; wetDays: number; dryDays: number };
  historyDays: number;
  generatedAt: number;
}

const DAY = 86400;
export const asapWindow = (hour: number): ForecastSlotCode => hour < 15 ? 'NOON' : hour < 19 ? 'EVENING' : 'NIGHT';
export const addDays = (date: string, n: number) => new Date(Date.parse(`${date}T00:00:00Z`) + n * DAY * 1000).toISOString().slice(0, 10);
export const weekdayOf = (date: string) => new Date(`${date}T00:00:00Z`).getUTCDay();
const sum = (c: DayCounts | undefined) => c ? c.NOON + c.EVENING + c.NIGHT : 0;
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const round1 = (v: number) => Math.round(v * 10) / 10;

/** Same-weekday weighted means per window for `date`, from days strictly before `asOf`. Null when <2 samples. */
export function baseFor(daily: Map<string, DayCounts>, date: string, firstDay: string, asOf: string): { counts: DayCounts; samples: number } | null {
  const weights = [4, 3, 2, 1], acc: DayCounts = { NOON: 0, EVENING: 0, NIGHT: 0 };
  let total = 0, samples = 0;
  weights.forEach((w, i) => {
    const d = addDays(date, -7 * (i + 1));
    if (d < firstDay || d >= asOf) return;
    const c = daily.get(d) ?? { NOON: 0, EVENING: 0, NIGHT: 0 };
    for (const k of FORECAST_SLOTS) acc[k] += c[k] * w;
    total += w; samples++;
  });
  if (samples < 2) return null;
  for (const k of FORECAST_SLOTS) acc[k] /= total;
  return { counts: acc, samples };
}
/** Last 14 days vs the 28 before `asOf` (exclusive). */
export function trendAt(daily: Map<string, DayCounts>, asOf: string): { factor: number; applied: boolean } {
  let recent = 0, before = 0;
  for (let i = 1; i <= 42; i++) { const n = sum(daily.get(addDays(asOf, -i))); if (i <= 14) recent += n; else before += n; }
  if (recent < 10 || before < 10) return { factor: 1, applied: false };
  return { factor: round1(clamp(recent / (before / 2), 0.75, 1.33) * 100) / 100, applied: true };
}
export function backtest(daily: Map<string, DayCounts>, firstDay: string, today: string): ForecastReport['backtest'] {
  const errors: number[] = [], pct: number[] = [];
  for (let i = 1; i <= 14; i++) {
    const d = addDays(today, -i);
    const base = baseFor(daily, d, firstDay, d);
    if (!base) continue;
    const predicted = sum(base.counts) * trendAt(daily, d).factor, actual = sum(daily.get(d));
    errors.push(Math.abs(predicted - actual));
    if (actual > 0) pct.push(Math.abs(predicted - actual) / actual);
  }
  return { days: errors.length, mae: errors.length ? round1(errors.reduce((a, b) => a + b, 0) / errors.length) : null, mape: pct.length >= 3 ? Math.round(pct.reduce((a, b) => a + b, 0) / pct.length * 100) : null };
}
export function median(values: number[]): number | null {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b), m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

export function buildForecast(input: {
  daily: Map<string, DayCounts>; firstDay: string | null; today: string; horizon?: number;
  wetDays: Set<string>; weatherNow: ForecastReport['weather']['level'];
  perCourierSamples: number[]; shifts: Map<string, number> | null; generatedAt: number;
}): ForecastReport {
  const { daily, today } = input, firstDay = input.firstDay ?? today;
  const trend = trendAt(daily, today), bt = backtest(daily, firstDay, today);
  const perMedian = median(input.perCourierSamples), perCourier = input.perCourierSamples.length >= 5 && perMedian ? Math.max(1, perMedian) : DEFAULT_PER_COURIER;
  // Weather factor from the history: average orders on a wet day vs a dry day.
  const past = [...daily.keys()].filter(d => d < today && d >= firstDay);
  const wet = past.filter(d => input.wetDays.has(d)), dry = past.filter(d => !input.wetDays.has(d));
  const avg = (list: string[]) => list.reduce((a, d) => a + sum(daily.get(d)), 0) / list.length;
  const factor = wet.length >= 3 && dry.length >= 3 && avg(dry) > 0 ? round1(clamp(avg(wet) / avg(dry), 0.7, 1.5) * 100) / 100 : null;
  const band = bt.mae;
  const days: ForecastDay[] = Array.from({ length: input.horizon ?? 3 }, (_, offset) => {
    const date = addDays(today, offset), base = baseFor(daily, date, firstDay, today);
    const wf = offset === 0 && factor !== null && (input.weatherNow === 'WET' || input.weatherNow === 'SEVERE') ? factor : null;
    if (!base) return { date, weekday: weekdayOf(date), insufficient: true, samples: 0, total: null, weatherFactor: null, slots: [] };
    const k = trend.factor * (wf ?? 1);
    const slots = FORECAST_SLOTS.map(code => {
      const booked = daily.get(date)?.[code] ?? 0;
      const expected = Math.max(booked, round1(base.counts[code] * k)), share = sum(base.counts) ? base.counts[code] / sum(base.counts) : 1 / 3;
      const margin = band !== null ? band * share : Math.sqrt(expected);
      const suggested = expected < 0.5 ? 0 : Math.ceil((expected + margin / 2) / perCourier);
      const scheduled = input.shifts ? input.shifts.get(date + code) ?? 0 : null;
      const status: ForecastSlot['status'] = scheduled === null ? 'none' : scheduled < suggested ? 'short' : scheduled > suggested + 1 ? 'over' : 'ok';
      return { code, booked, expected, low: round1(Math.max(0, expected - margin)), high: round1(expected + margin), suggested, scheduled, status };
    });
    return { date, weekday: weekdayOf(date), insufficient: false, samples: base.samples, total: round1(slots.reduce((a, s) => a + s.expected, 0)), weatherFactor: wf, slots };
  });
  return {
    days, trend: trend.factor, trendApplied: trend.applied, backtest: bt, perCourier, perCourierBasis: input.perCourierSamples.length >= 5 ? 'history' : 'default',
    weather: { level: input.weatherNow, factor, wetDays: wet.length, dryDays: dry.length },
    historyDays: past.length, generatedAt: input.generatedAt,
  };
}

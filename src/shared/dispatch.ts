/* © 2026 专业团队 · CampusDrop v4.7.0 · WM-A372E4790D8B1C09-7A7F4306EF */
import { z } from 'zod';
import { planRoute } from './campus-map.ts';

/*
 * v4.5 · 小件按楼分配 (dispatch by building). Each building has one courier responsible for its 小件: a paid small order
 * goes straight to them (see migration 0019). 大件 and 超大件 stay in the 接单市场.
 *
 * The automatic plan keeps every courier's buildings next to each other and their workloads close:
 *   1. the buildings are put in walking order (the same nearest-neighbour + 2-opt tour as 一键排线, from the 颐海苑 station);
 *   2. couriers are shared between 南苑 and 北苑 in proportion to the work there (each side gets at least one when there
 *      are two or more couriers), so nobody has to cross the campus between two runs;
 *   3. each side's tour is cut into consecutive stretches so that the busiest courier has as little as possible
 *      (an exact linear partition; the work of a building is its small orders in the last 30 days, plus one so a quiet
 *      building still counts);
 *   4. stretches go to the couriers who already hold most of those buildings, so re-planning moves as little as it can.
 * A super admin can apply it as is, or change any building by hand.
 */
export interface DispatchBuilding { code: string; name: string; zone: 'SOUTH' | 'NORTH'; orders30: number }
export interface DispatchCourier { id: string; name: string }
export interface PlanGroup { adminId: string; buildings: string[]; work: number }
export interface DispatchPlan { groups: PlanGroup[]; assignments: Record<string, string> }

const work = (b: DispatchBuilding) => b.orders30 + 1;

/** Walking order over all buildings; buildings missing from the plan go after the last one of their zone. */
export function tourOrder(buildings: DispatchBuilding[]): DispatchBuilding[] {
  const byCode = new Map(buildings.map(b => [b.code, b]));
  const route = planRoute('YIHAIYUAN', buildings.map(b => b.code));
  const placed = route.order.filter(c => !route.unplaced.includes(c)).map(c => byCode.get(c)!).filter(Boolean);
  for (const code of route.unplaced) {
    const b = byCode.get(code)!;
    let at = -1;
    placed.forEach((p, i) => { if (p.zone === b.zone) at = i; });
    placed.splice(at < 0 ? placed.length : at + 1, 0, b);
  }
  return placed;
}

/** Cut a sequence into k consecutive parts minimising the largest sum (exact DP; n and k are small). */
export function linearPartition(weights: number[], k: number): number[][] {
  const n = weights.length;
  if (!n) return [];
  k = Math.max(1, Math.min(k, n));
  const prefix = [0];
  for (const w of weights) prefix.push(prefix[prefix.length - 1] + w);
  const sum = (i: number, j: number) => prefix[j] - prefix[i];
  // best[p][j]: smallest possible maximum when the first j items are cut into p parts.
  const best = Array.from({ length: k + 1 }, () => Array(n + 1).fill(Infinity) as number[]);
  const cut = Array.from({ length: k + 1 }, () => Array(n + 1).fill(0) as number[]);
  best[0][0] = 0;
  for (let p = 1; p <= k; p++) for (let j = p; j <= n; j++) for (let i = p - 1; i < j; i++) {
    const v = Math.max(best[p - 1][i], sum(i, j));
    // Ties prefer the more even split (smaller last part), so equal workloads come out as even as possible.
    if (v < best[p][j] || (v === best[p][j] && sum(i, j) < sum(cut[p][j], j))) { best[p][j] = v; cut[p][j] = i; }
  }
  const parts: number[][] = [];
  let j = n;
  for (let p = k; p >= 1; p--) { const i = cut[p][j]; parts.unshift(Array.from({ length: j - i }, (_, x) => i + x)); j = i; }
  return parts.filter(part => part.length);
}

/** Share k couriers between the zones by work (largest remainder), at least one each when k allows. */
function shareCouriers(zones: { zone: string; work: number }[], k: number): number[] {
  if (zones.length <= 1 || k < zones.length) return zones.map((_, i) => (i === 0 ? k : 0));
  const total = zones.reduce((s, z) => s + z.work, 0) || 1, spare = k - zones.length;
  const raw = zones.map(z => (z.work / total) * spare);
  const out = raw.map(r => 1 + Math.floor(r));
  let left = k - out.reduce((s, v) => s + v, 0);
  const order = raw.map((r, i) => [r - Math.floor(r), i] as const).sort((a, b) => b[0] - a[0]);
  for (const [, i] of order) { if (left <= 0) break; out[i]++; left--; }
  return out;
}

export function planDispatch(buildings: DispatchBuilding[], couriers: DispatchCourier[], current: Record<string, string> = {}): DispatchPlan {
  if (!couriers.length || !buildings.length) return { groups: [], assignments: {} };
  const tour = tourOrder(buildings);
  const zones = (['SOUTH', 'NORTH'] as const).map(zone => ({ zone, list: tour.filter(b => b.zone === zone) })).filter(z => z.list.length);
  const shares = shareCouriers(zones.map(z => ({ zone: z.zone, work: z.list.reduce((s, b) => s + work(b), 0) })), couriers.length);
  // Fewer couriers than zones: one walk over the whole tour.
  const runs: DispatchBuilding[][] = [];
  if (couriers.length < zones.length) runs.push(...linearPartition(tour.map(work), couriers.length).map(part => part.map(i => tour[i])));
  else zones.forEach((z, zi) => runs.push(...linearPartition(z.list.map(work), shares[zi]).map(part => part.map(i => z.list[i]))));
  // Hand each stretch to the free courier who already holds most of it (largest overlap first).
  const pairs: [number, number, number][] = [];
  runs.forEach((run, r) => couriers.forEach((c, ci) => pairs.push([run.filter(b => current[b.code] === c.id).length, r, ci])));
  pairs.sort((a, b) => b[0] - a[0] || a[1] - b[1] || a[2] - b[2]);
  const runOwner = new Map<number, number>(), used = new Set<number>();
  for (const [, r, ci] of pairs) if (!runOwner.has(r) && !used.has(ci)) { runOwner.set(r, ci); used.add(ci); }
  const groups: PlanGroup[] = runs.map((run, r) => ({ adminId: couriers[runOwner.get(r)!].id, buildings: run.map(b => b.code), work: run.reduce((s, b) => s + work(b), 0) }));
  const assignments: Record<string, string> = {};
  for (const g of groups) for (const code of g.buildings) assignments[code] = g.adminId;
  return { groups, assignments };
}

/** PUT /admin/dispatch: the buildings to set (adminId null = back to the 接单市场). */
export const dispatchUpdateSchema = z.object({
  assignments: z.array(z.object({ buildingCode: z.string().regex(/^[A-Z0-9_]{2,32}$/), adminId: z.string().min(8).max(64).nullable() })).min(1).max(80),
  /** Also hand over small orders already dispatched to the old courier and not yet picked up. */
  moveWaiting: z.boolean().default(true),
});
export type DispatchUpdate = z.infer<typeof dispatchUpdateSchema>;

export interface DispatchOverview {
  world: 'SITE' | 'DEMO';
  canEdit: boolean;
  buildings: (DispatchBuilding & { adminId: string | null; waiting: number })[];
  couriers: (DispatchCourier & { role: string; phone: boolean; buildings: number; waiting: number; orders30: number })[];
  plan: DispatchPlan;
}

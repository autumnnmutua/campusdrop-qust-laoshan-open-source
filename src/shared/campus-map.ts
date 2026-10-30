/**
 * Laoshan campus on the official campus plan (官方校园平面图) plus the walking graph used for routes and ETAs.
 * Shared by the worker (ETA, GPS projection) and the client (drawing). Zod-free.
 *
 * Coordinates are pixels of public/images/campus-map-official.webp (2000 × 1882, north up). Building hotspots, doors
 * and the road graph were traced by hand over that image. Only dorms the plan labels as student dorms are placed:
 * 南苑 1–10 and 北苑 2/3/6/7/8. Codes without a labelled building on the plan (NORTH_01/05/09, SOUTH_11) have no
 * hotspot, so they get no route and their ETA falls back to delivery history — nothing is guessed.
 * The diagonal road across the open ground in the middle of the plan is still under construction, so it is left out of
 * the graph and routes between 南苑 and 北苑 follow the east loop past the library.
 * Live courier positions only appear after a super admin calibrates the map on site (two GPS fixes at two landmarks);
 * until then the map shows estimated progress along the route.
 */
export const MAP_WIDTH = 2000;
export const MAP_HEIGHT = 1882;
export const MAP_IMAGE = '/images/campus-map-official.webp';
/** Scale from the standard 400 m track on the plan (≈176 m long ↔ ≈320 px). An estimate, good enough for ETAs. */
export const METERS_PER_UNIT = 0.55;
/** Walking speed with parcels, metres per second. */
export const WALK_SPEED = 1.25;

export interface Point { x: number; y: number }
export interface MapBuilding { code: string; x: number; y: number; w: number; h: number; door: Point }
export interface MapPlace { id: string; label: string; x: number; y: number; w: number; h: number; kind: 'station' | 'landmark' | 'gate'; door?: Point }

/** Road junctions along the grey roads of the plan. */
export const NODES: Record<string, Point> = {
  // 南苑: the road between the two dorm rows (y≈1407), the one below the lower row (y≈1566) and the station lane (y≈1690).
  R2W: { x: 350, y: 1407 }, R2A: { x: 543, y: 1407 }, R2B: { x: 745, y: 1407 }, R2C: { x: 948, y: 1407 },
  R3W: { x: 425, y: 1566 }, R3A: { x: 543, y: 1566 }, R3D: { x: 705, y: 1570 }, R3B: { x: 745, y: 1566 }, R3E: { x: 900, y: 1566 },
  STW: { x: 410, y: 1690 }, STA: { x: 543, y: 1690 }, STD: { x: 622, y: 1690 },
  WEST_GATE: { x: 497, y: 1852 },
  // Main north–south road past the teaching buildings.
  M1: { x: 948, y: 1242 }, M2: { x: 948, y: 1140 },
  // East loop: along the teaching buildings to the library roundabout, then north-east round the open ground to 北苑.
  E1: { x: 1180, y: 1120 }, E2: { x: 1415, y: 1092 }, E3: { x: 1530, y: 970 }, E4: { x: 1610, y: 870 },
  E5: { x: 1680, y: 750 }, E6: { x: 1722, y: 600 }, E7: { x: 1712, y: 553 }, E8: { x: 1570, y: 555 },
  // 北苑 grid.
  N1: { x: 885, y: 282 }, N2: { x: 1065, y: 282 }, N3: { x: 1240, y: 282 }, N4: { x: 1395, y: 282 },
  N5: { x: 1065, y: 472 }, N7: { x: 1240, y: 472 }, N9: { x: 1395, y: 472 },
  N6: { x: 1065, y: 640 }, N12: { x: 1195, y: 642 }, N8: { x: 1240, y: 640 }, N10: { x: 1395, y: 632 },
  M3: { x: 885, y: 750 }, N11: { x: 1140, y: 750 },
};
export const EDGES: [string, string][] = [
  ['R2W', 'R2A'], ['R2A', 'R2B'], ['R2B', 'R2C'],
  ['R3W', 'R3A'], ['R3A', 'R3D'], ['R3D', 'R3B'], ['R3B', 'R3E'],
  ['R2A', 'R3A'], ['R3A', 'STA'], ['R2B', 'R3B'], ['STW', 'STA'], ['STA', 'STD'],
  ['R3D', 'STD'], ['STD', 'WEST_GATE'],
  ['R2C', 'M1'], ['M1', 'M2'],
  ['M2', 'E1'], ['E1', 'E2'], ['E2', 'E3'], ['E3', 'E4'], ['E4', 'E5'], ['E5', 'E6'], ['E6', 'E7'], ['E7', 'E8'], ['E8', 'N10'],
  ['M3', 'N1'], ['N1', 'N2'], ['N2', 'N3'], ['N3', 'N4'],
  ['N2', 'N5'], ['N5', 'N6'], ['N3', 'N7'], ['N7', 'N8'], ['N4', 'N9'], ['N9', 'N10'],
  ['N5', 'N7'], ['N7', 'N9'], ['N6', 'N12'], ['N12', 'N8'], ['N8', 'N10'],
  ['M3', 'N11'], ['N11', 'N12'],
];

const building = (code: string, x: number, y: number, w: number, h: number, door: Point): MapBuilding => ({ code, x, y, w, h, door });
export const BUILDINGS: MapBuilding[] = [
  building('SOUTH_10', 365, 1285, 110, 90, { x: 420, y: 1407 }),
  building('SOUTH_09', 475, 1285, 110, 90, { x: 530, y: 1407 }),
  building('SOUTH_01', 400, 1425, 125, 130, { x: 462, y: 1407 }),
  building('SOUTH_02', 555, 1430, 85, 120, { x: 598, y: 1407 }),
  building('SOUTH_03', 640, 1430, 90, 120, { x: 685, y: 1407 }),
  building('SOUTH_04', 765, 1435, 120, 115, { x: 825, y: 1407 }),
  building('SOUTH_07', 420, 1575, 95, 32, { x: 467, y: 1566 }),
  building('SOUTH_06', 550, 1575, 125, 95, { x: 612, y: 1566 }),
  building('SOUTH_05', 765, 1575, 120, 75, { x: 825, y: 1566 }),
  building('SOUTH_08', 445, 1635, 70, 36, { x: 543, y: 1652 }),
  building('NORTH_06', 1080, 130, 145, 140, { x: 1152, y: 282 }),
  building('NORTH_02', 1255, 130, 140, 140, { x: 1325, y: 282 }),
  building('NORTH_07', 1080, 300, 145, 140, { x: 1065, y: 370 }),
  building('NORTH_03', 1255, 300, 135, 140, { x: 1240, y: 370 }),
  building('NORTH_08', 1080, 490, 145, 90, { x: 1152, y: 472 }),
];

export const PLACES: MapPlace[] = [
  { id: 'YIHAIYUAN', label: '颐海苑站点', x: 440, y: 1700, w: 80, h: 34, kind: 'station', door: { x: 480, y: 1690 } },
  { id: 'SOUTH_CANTEEN', label: '南苑餐厅', x: 790, y: 1290, w: 110, h: 75, kind: 'landmark' },
  { id: 'NORTH_CANTEEN', label: '北苑餐厅', x: 1420, y: 362, w: 165, h: 110, kind: 'landmark' },
  { id: 'STADIUM', label: '体育场', x: 900, y: 1420, w: 140, h: 320, kind: 'landmark' },
  { id: 'LIBRARY', label: '图书馆', x: 1612, y: 1060, w: 70, h: 200, kind: 'landmark' },
  { id: 'WEST_GATE', label: '西门', x: 470, y: 1820, w: 54, h: 40, kind: 'gate' },
  { id: 'SOUTH_GATE', label: '南门', x: 1382, y: 1588, w: 54, h: 40, kind: 'gate' },
  { id: 'EAST_GATE', label: '东门', x: 1920, y: 1125, w: 44, h: 60, kind: 'gate' },
];
/** Landmarks a super admin can stand at to calibrate GPS: far apart in both directions works best. */
export const CALIBRATION_LANDMARKS = ['YIHAIYUAN', 'WEST_GATE', 'SOUTH_GATE', 'EAST_GATE', 'SOUTH_CANTEEN', 'NORTH_CANTEEN', 'STADIUM', 'LIBRARY', 'NORTH_08', 'NORTH_02', 'SOUTH_04'] as const;
export type LandmarkId = typeof CALIBRATION_LANDMARKS[number];

export const buildingByCode = (code: string) => BUILDINGS.find(b => b.code === code);
export const placeById = (id: string) => PLACES.find(p => p.id === id);
export const center = (r: { x: number; y: number; w: number; h: number }): Point => ({ x: r.x + r.w / 2, y: r.y + r.h / 2 });
export function landmarkPoint(id: string): Point | undefined {
  const target = placeById(id) ?? buildingByCode(id);
  return target && center(target);
}

const dist = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);
export function pathLength(path: Point[]): number {
  let total = 0;
  for (let i = 1; i < path.length; i++) total += dist(path[i - 1], path[i]);
  return total;
}
/** Point at a fraction (0–1) of the way along a path. */
export function pointAlong(path: Point[], fraction: number): Point {
  const target = pathLength(path) * Math.min(1, Math.max(0, fraction));
  let walked = 0;
  for (let i = 1; i < path.length; i++) {
    const step = dist(path[i - 1], path[i]);
    if (walked + step >= target && step > 0) {
      const t = (target - walked) / step;
      return { x: path[i - 1].x + (path[i].x - path[i - 1].x) * t, y: path[i - 1].y + (path[i].y - path[i - 1].y) * t };
    }
    walked += step;
  }
  return path[path.length - 1];
}

/** Closest point on the road graph to a door: the edge it sits on and where it meets it. */
function snapToRoad(p: Point): { edge: [string, string]; at: Point } {
  let best = { edge: EDGES[0], at: NODES[EDGES[0][0]], d: Infinity };
  for (const edge of EDGES) {
    const a = NODES[edge[0]], b = NODES[edge[1]], dx = b.x - a.x, dy = b.y - a.y;
    const t = Math.min(1, Math.max(0, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy)));
    const at = { x: a.x + dx * t, y: a.y + dy * t }, d = dist(p, at);
    if (d < best.d) best = { edge, at, d };
  }
  return best;
}

/** Shortest walk along campus roads between two doors (Dijkstra over the small road graph), door to door. */
function walkBetween(fromDoor: Point, toDoor: Point): Point[] | null {
  const start = snapToRoad(fromDoor), end = snapToRoad(toDoor);
  const points: Record<string, Point> = { ...NODES, FROM: start.at, TO: end.at };
  const adjacency = new Map<string, [string, number][]>();
  const link = (a: string, b: string) => {
    const d = dist(points[a], points[b]);
    adjacency.set(a, [...(adjacency.get(a) ?? []), [b, d]]);
    adjacency.set(b, [...(adjacency.get(b) ?? []), [a, d]]);
  };
  for (const [a, b] of EDGES) link(a, b);
  for (const n of start.edge) link('FROM', n);
  for (const n of end.edge) link('TO', n);
  if (start.edge.join() === end.edge.join()) link('FROM', 'TO');
  const best = new Map<string, number>([['FROM', 0]]), previous = new Map<string, string>(), open = new Set(['FROM']);
  while (open.size) {
    const current = [...open].reduce((a, b) => (best.get(a)! <= best.get(b)! ? a : b));
    open.delete(current);
    if (current === 'TO') break;
    for (const [next, d] of adjacency.get(current) ?? []) {
      const candidate = best.get(current)! + d;
      if (candidate < (best.get(next) ?? Infinity)) { best.set(next, candidate); previous.set(next, current); open.add(next); }
    }
  }
  if (!previous.has('TO')) return null;
  const nodes = ['TO'];
  while (nodes[0] !== 'FROM') nodes.unshift(previous.get(nodes[0])!);
  const path = [fromDoor, ...nodes.map(n => points[n]), toDoor];
  return path.filter((p, i) => i === 0 || dist(p, path[i - 1]) > 1);
}

/** Drop-off points a student may choose instead of their dorm (priced as downstairs). */
export const DROP_PLACES = ['LIBRARY', 'SOUTH_CANTEEN', 'NORTH_CANTEEN', 'STADIUM', 'SOUTH_GATE', 'WEST_GATE', 'EAST_GATE'] as const;
export type DropPlace = typeof DROP_PLACES[number];
export const DROP_PLACE_LABELS: Record<DropPlace, string> = {
  LIBRARY: '图书馆门口', SOUTH_CANTEEN: '南苑餐厅门口', NORTH_CANTEEN: '北苑餐厅门口', STADIUM: '体育场入口',
  SOUTH_GATE: '南门', WEST_GATE: '西门', EAST_GATE: '东门',
};
/** Where a destination code (dorm building or drop-off place) is on the plan: its door and its centre. */
function destination(code: string): { door: Point; centre: Point } | null {
  const b = buildingByCode(code);
  if (b) return { door: b.door, centre: center(b) };
  const p = placeById(code);
  if (p && (DROP_PLACES as readonly string[]).includes(code)) return { door: p.door ?? center(p), centre: center(p) };
  return null;
}
export const hasLocation = (code: string) => destination(code) !== null;

/** Walking route from a station to a dorm building or drop-off place, centre to centre. Null when not on the plan. */
export function campusRoute(stationCode: string, destinationCode: string): Point[] | null {
  const from = placeById(stationCode), to = destination(destinationCode);
  if (!from?.door || !to) return null;
  const walk = walkBetween(from.door, to.door);
  if (!walk) return null;
  const path = [center(from), ...walk, to.centre];
  return path.filter((p, i) => i === 0 || dist(p, path[i - 1]) > 1);
}

export interface RoutePlan {
  /** Destination codes in walking order. */
  order: string[];
  /** One leg per stop: metres and minutes from the previous stop (the station for the first). */
  legs: { code: string; meters: number; minutes: number }[];
  totalMeters: number;
  totalMinutes: number;
  /** Codes that are not on the plan (no hotspot); they go last in their original order. */
  unplaced: string[];
}
const metersOf = (path: Point[]) => pathLength(path) * METERS_PER_UNIT;
/**
 * Visiting order for a delivery run: nearest stop first, then a 2-opt pass to remove crossings. With at most a couple
 * of dozen stops this is instant and close to optimal; it is a walking estimate, not a promise.
 */
export function planRoute(stationCode: string, codes: string[]): RoutePlan {
  const unique = [...new Set(codes)], placed = unique.filter(hasLocation), unplaced = unique.filter(c => !hasLocation(c));
  const station = placeById(stationCode);
  if (!station?.door || !placed.length) return { order: [...placed, ...unplaced], legs: [], totalMeters: 0, totalMinutes: 0, unplaced };
  const doors: Record<string, Point> = { START: station.door };
  for (const c of placed) doors[c] = destination(c)!.door;
  const cache = new Map<string, number>();
  const cost = (a: string, b: string) => {
    const key = a < b ? `${a}|${b}` : `${b}|${a}`;
    if (!cache.has(key)) { const w = walkBetween(doors[a], doors[b]); cache.set(key, w ? metersOf(w) : dist(doors[a], doors[b]) * METERS_PER_UNIT * 1.4); }
    return cache.get(key)!;
  };
  // Nearest neighbour from the station.
  const order: string[] = [], left = new Set(placed);
  let at = 'START';
  while (left.size) {
    const next = [...left].reduce((a, b) => (cost(at, a) <= cost(at, b) ? a : b));
    order.push(next); left.delete(next); at = next;
  }
  // 2-opt on the open path START → order[0] → … → order[n-1].
  const length = (seq: string[]) => seq.reduce((sum, c, i) => sum + cost(i ? seq[i - 1] : 'START', c), 0);
  let improved = order.length > 2;
  for (let round = 0; improved && round < 20; round++) {
    improved = false;
    for (let i = 0; i < order.length - 1; i++) for (let j = i + 1; j < order.length; j++) {
      const candidate = [...order.slice(0, i), ...order.slice(i, j + 1).reverse(), ...order.slice(j + 1)];
      if (length(candidate) + 0.5 < length(order)) { order.splice(0, order.length, ...candidate); improved = true; }
    }
  }
  const legs = order.map((code, i) => { const meters = cost(i ? order[i - 1] : 'START', code); return { code, meters: Math.round(meters / 10) * 10, minutes: Math.max(1, Math.round(meters / WALK_SPEED / 60)) }; });
  const totalMeters = legs.reduce((s, l) => s + l.meters, 0);
  return { order: [...order, ...unplaced], legs, totalMeters, totalMinutes: Math.round(legs.reduce((s, l) => s + l.meters, 0) / WALK_SPEED / 60) + legs.length * 2, unplaced };
}
export function routeMinutes(path: Point[]): number {
  return Math.max(3, Math.round((pathLength(path) * METERS_PER_UNIT) / WALK_SPEED / 60) + 2);
}
export const routeMeters = (path: Point[]) => Math.round((pathLength(path) * METERS_PER_UNIT) / 10) * 10;

/**
 * GPS → plan calibration. Two fixes at two landmarks project each axis separately (the original v2.6 method, which
 * assumes the plan is drawn north-up). Three to five fixes fit a full affine transform by least squares, which also
 * absorbs a rotated or skewed plan, and report how far each landmark lands from where it should (the residual).
 */
export type CalibrationPoint = Point & { lat: number; lng: number; landmark?: string };
export interface Calibration { a?: CalibrationPoint; b?: CalibrationPoint; points?: CalibrationPoint[]; affine?: number[]; residualMeters?: number }
const pointsOf = (c: Calibration): CalibrationPoint[] => c.points ?? [c.a, c.b].filter((p): p is CalibrationPoint => !!p);
function solve3(m: number[][], v: number[]): number[] | null {
  // Cramer's rule for a 3×3 system.
  const det = (a: number[][]) => a[0][0] * (a[1][1] * a[2][2] - a[1][2] * a[2][1]) - a[0][1] * (a[1][0] * a[2][2] - a[1][2] * a[2][0]) + a[0][2] * (a[1][0] * a[2][1] - a[1][1] * a[2][0]);
  const d = det(m);
  if (Math.abs(d) < 1e-18) return null;
  return [0, 1, 2].map(col => det(m.map((row, r) => row.map((x, c) => (c === col ? v[r] : x)))) / d);
}
/** Least-squares affine fit [ax, bx, cx, ay, by, cy]: x = ax·lng + bx·lat + cx, y = ay·lng + by·lat + cy. */
export function fitAffine(points: CalibrationPoint[]): number[] | null {
  if (points.length < 3) return null;
  // Centre the coordinates so the normal equations stay well conditioned at campus scale (~0.01°).
  const lng0 = points.reduce((s, p) => s + p.lng, 0) / points.length, lat0 = points.reduce((s, p) => s + p.lat, 0) / points.length;
  const rows = points.map(p => [(p.lng - lng0) * 1e4, (p.lat - lat0) * 1e4, 1]);
  const ata = [0, 1, 2].map(i => [0, 1, 2].map(j => rows.reduce((s, r) => s + r[i] * r[j], 0)));
  const fx = solve3(ata, [0, 1, 2].map(i => rows.reduce((s, r, k) => s + r[i] * points[k].x, 0)));
  const fy = solve3(ata, [0, 1, 2].map(i => rows.reduce((s, r, k) => s + r[i] * points[k].y, 0)));
  if (!fx || !fy) return null;
  // Back to raw degrees.
  const ax = fx[0] * 1e4, bx = fx[1] * 1e4, ay = fy[0] * 1e4, by = fy[1] * 1e4;
  return [ax, bx, fx[2] - ax * lng0 - bx * lat0, ay, by, fy[2] - ay * lng0 - by * lat0];
}
function rawProject(c: Calibration, lat: number, lng: number): Point | null {
  if (c.affine?.length === 6) { const [ax, bx, cx, ay, by, cy] = c.affine; return { x: ax * lng + bx * lat + cx, y: ay * lng + by * lat + cy }; }
  const [a, b] = pointsOf(c);
  if (!a || !b) return null;
  return { x: a.x + ((lng - a.lng) * (b.x - a.x)) / (b.lng - a.lng), y: a.y + ((lat - a.lat) * (b.y - a.y)) / (b.lat - a.lat) };
}
/** Builds a stored calibration from 2–5 landmark fixes, or explains why it cannot be used. */
export function buildCalibration(points: CalibrationPoint[]): { calibration: Calibration } | { error: string } {
  if (points.length === 2) {
    const [a, b] = points, c: Calibration = { a, b };
    return calibrationUsable(c) ? { calibration: c } : { error: '两个地标相距太近或方向一致，请选择地图上横向和纵向都相隔较远的两个地标' };
  }
  const xs = points.map(p => p.x), ys = points.map(p => p.y);
  if (Math.max(...xs) - Math.min(...xs) < 160 || Math.max(...ys) - Math.min(...ys) < 160) return { error: '地标分布太集中，请选择东西、南北都相距较远的地标' };
  const affine = fitAffine(points);
  if (!affine) return { error: '这几个地标几乎在一条直线上，请换一个不在同一直线上的地标' };
  const residuals = points.map(p => { const q = rawProject({ affine }, p.lat, p.lng)!; return dist(p, q) * METERS_PER_UNIT; });
  const residualMeters = Math.round(Math.max(...residuals));
  if (residualMeters > 60) return { error: `定位误差约 ${residualMeters} 米，偏大。请在开阔处重新记录，或检查是否选错了地标` };
  return { calibration: { points, affine, residualMeters } };
}
export function calibrationUsable(c: Calibration): boolean {
  if (c.affine?.length === 6) return c.affine.every(Number.isFinite);
  const [a, b] = pointsOf(c);
  return !!a && !!b && Math.abs(a.lat - b.lat) > 0.0004 && Math.abs(a.lng - b.lng) > 0.0004 && Math.abs(a.x - b.x) > 160 && Math.abs(a.y - b.y) > 160;
}
/** Map position for a GPS fix, or null when it falls well outside the campus plan. */
export function projectGps(c: Calibration, lat: number, lng: number): Point | null {
  if (!calibrationUsable(c)) return null;
  const p = rawProject(c, lat, lng);
  if (!p) return null;
  const margin = 0.12;
  if (p.x < -MAP_WIDTH * margin || p.x > MAP_WIDTH * (1 + margin) || p.y < -MAP_HEIGHT * margin || p.y > MAP_HEIGHT * (1 + margin)) return null;
  return { x: Math.round(Math.min(MAP_WIDTH, Math.max(0, p.x))), y: Math.round(Math.min(MAP_HEIGHT, Math.max(0, p.y))) };
}
/** Straight-line metres from a plan point to a destination's door (buildings and drop-off places). */
export function metersToDestination(p: Point, code: string): number | null {
  const d = destination(code);
  return d ? Math.round(dist(p, d.door) * METERS_PER_UNIT) : null;
}

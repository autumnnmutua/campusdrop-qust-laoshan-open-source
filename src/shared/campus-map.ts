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

/** Walking route from a station to a dorm building along campus roads (Dijkstra over the small road graph). */
export function campusRoute(stationCode: string, buildingCode: string): Point[] | null {
  const from = placeById(stationCode), to = buildingByCode(buildingCode);
  if (!from?.door || !to) return null;
  const start = snapToRoad(from.door), end = snapToRoad(to.door);
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
  const path = [center(from), from.door, ...nodes.map(n => points[n]), to.door, center(to)];
  return path.filter((p, i) => i === 0 || dist(p, path[i - 1]) > 1);
}
export function routeMinutes(path: Point[]): number {
  return Math.max(3, Math.round((pathLength(path) * METERS_PER_UNIT) / WALK_SPEED / 60) + 2);
}
export const routeMeters = (path: Point[]) => Math.round((pathLength(path) * METERS_PER_UNIT) / 10) * 10;

/** Two GPS fixes at two map landmarks. Positions are projected per axis, which suits a north-up campus plan. */
export interface Calibration { a: Point & { lat: number; lng: number }; b: Point & { lat: number; lng: number } }
export function calibrationUsable(c: Calibration): boolean {
  return Math.abs(c.a.lat - c.b.lat) > 0.0004 && Math.abs(c.a.lng - c.b.lng) > 0.0004 && Math.abs(c.a.x - c.b.x) > 160 && Math.abs(c.a.y - c.b.y) > 160;
}
/** Map position for a GPS fix, or null when it falls well outside the campus plan. */
export function projectGps(c: Calibration, lat: number, lng: number): Point | null {
  if (!calibrationUsable(c)) return null;
  const x = c.a.x + ((lng - c.a.lng) * (c.b.x - c.a.x)) / (c.b.lng - c.a.lng);
  const y = c.a.y + ((lat - c.a.lat) * (c.b.y - c.a.y)) / (c.b.lat - c.a.lat);
  const margin = 0.12;
  if (x < -MAP_WIDTH * margin || x > MAP_WIDTH * (1 + margin) || y < -MAP_HEIGHT * margin || y > MAP_HEIGHT * (1 + margin)) return null;
  return { x: Math.round(Math.min(MAP_WIDTH, Math.max(0, x))), y: Math.round(Math.min(MAP_HEIGHT, Math.max(0, y))) };
}

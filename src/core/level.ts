import { GATES, LOCKS, STRUCTURE, ZONES, ZONE_LAYER, type LockKind, type ZoneDef } from './hospital';
import type { Vec2 } from './math';

export const Tile = {
  Floor: 0,
  Wall: 1,
  Door: 2,
  Locker: 3,
  Drawer: 4,
  Vent: 5,
  Tap: 6,
  FuseBox: 7,
  Radio: 8,
  Gate: 9,
  Window: 10,
  Bed: 11,
  Cabinet: 12,
} as const;
export type TileId = (typeof Tile)[keyof typeof Tile];

export type WallObjectKind = 'locker' | 'drawer' | 'vent' | 'tap' | 'fusebox' | 'radio' | 'gate';

export interface WallObject {
  kind: WallObjectKind;
  cell: number;
  /** The floor cell you stand in to use it. */
  access: number;
  /** Unit direction from the access cell into the object. */
  dx: number;
  dy: number;
}

export interface DoorDef {
  cell: number;
  /** Axis of travel through the door. 'x' = you walk east/west through it. */
  axis: 'x' | 'y';
  lock: LockKind | null;
  /** The two floor cells the door connects. */
  sides: [number, number];
}

export type RegionKind = 'room' | 'corridor' | 'exterior' | 'nest';

export interface RegionLink {
  region: number;
  /** Door cell, or -1 for an open border (archway, zone seam). */
  via: number;
}

export interface Region {
  id: number;
  zone: number;
  cells: number[];
  links: RegionLink[];
  center: number;
  kind: RegionKind;
  /** A room with exactly one way in. The bait planner loves these [T]. */
  deadEnd: boolean;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export type MarkerKind = 'fuse' | 'key' | 'item' | 'note' | 'survivor' | 'nest';

export interface Level {
  w: number;
  h: number;
  tiles: Uint8Array;
  zoneOf: Int8Array;
  regionOf: Int16Array;
  zones: readonly ZoneDef[];
  regions: Region[];
  doors: DoorDef[];
  doorIndex: Map<number, number>;
  wallObjects: WallObject[];
  wallObjectAt: Map<number, WallObject>;
  beds: { cell: number; access: number[] }[];
  spawn: number;
  markers: Record<MarkerKind, number[]>;
  gateInfo: Map<number, { id: 'bay' | 'garden'; label: string }>;
}

const WALL_OBJECT_CHARS: Record<string, { tile: TileId; kind: WallObjectKind }> = {
  L: { tile: Tile.Locker, kind: 'locker' },
  D: { tile: Tile.Drawer, kind: 'drawer' },
  v: { tile: Tile.Vent, kind: 'vent' },
  t: { tile: Tile.Tap, kind: 'tap' },
  F: { tile: Tile.FuseBox, kind: 'fusebox' },
  R: { tile: Tile.Radio, kind: 'radio' },
  G: { tile: Tile.Gate, kind: 'gate' },
};

const MARKER_CHARS: Record<string, MarkerKind | 'spawn'> = {
  S: 'spawn',
  f: 'fuse',
  k: 'key',
  i: 'item',
  n: 'note',
  p: 'survivor',
  x: 'nest',
};

export const idx = (level: Level, x: number, y: number): number => y * level.w + x;
export const cellX = (level: Level, c: number): number => c % level.w;
export const cellY = (level: Level, c: number): number => Math.floor(c / level.w);
export const inBounds = (level: Level, x: number, y: number): boolean =>
  x >= 0 && y >= 0 && x < level.w && y < level.h;

export function cellCenter(level: Level, c: number): Vec2 {
  return { x: (c % level.w) + 0.5, y: Math.floor(c / level.w) + 0.5 };
}

export function cellAt(level: Level, p: Vec2): number {
  const x = Math.floor(p.x);
  const y = Math.floor(p.y);
  if (!inBounds(level, x, y)) return -1;
  return y * level.w + x;
}

/** Floor-like cells you can stand in (beds are furniture you can hide under, not stand in). */
export const isFloorTile = (t: number): boolean => t === Tile.Floor;

/** Static opacity: everything except floor, beds and doors (doors are dynamic). */
export const isStaticOpaque = (t: number): boolean =>
  t !== Tile.Floor && t !== Tile.Bed && t !== Tile.Door;

export function cellDistance(level: Level, a: number, b: number): number {
  return Math.hypot(cellX(level, a) - cellX(level, b), cellY(level, a) - cellY(level, b));
}

export function neighbors4(level: Level, c: number): number[] {
  const x = c % level.w;
  const y = Math.floor(c / level.w);
  const out: number[] = [];
  if (x > 0) out.push(c - 1);
  if (x < level.w - 1) out.push(c + 1);
  if (y > 0) out.push(c - level.w);
  if (y < level.h - 1) out.push(c + level.w);
  return out;
}

export function parseLevel(): Level {
  const h = STRUCTURE.length;
  const w = STRUCTURE[0]!.length;
  if (ZONE_LAYER.length !== h) throw new Error('zone layer height mismatch');
  const tiles = new Uint8Array(w * h).fill(Tile.Wall);
  const zoneOf = new Int8Array(w * h).fill(-1);
  const regionOf = new Int16Array(w * h).fill(-1);
  const markers: Record<MarkerKind, number[]> = { fuse: [], key: [], item: [], note: [], survivor: [], nest: [] };
  let spawn = -1;
  const zoneIndex = new Map(ZONES.map((z, i) => [z.key, i]));

  for (let y = 0; y < h; y++) {
    const row = STRUCTURE[y]!;
    const zrow = ZONE_LAYER[y]!;
    if (row.length !== w || zrow.length !== w) throw new Error(`row ${y} width mismatch`);
    for (let x = 0; x < w; x++) {
      const ch = row[x]!;
      const c = y * w + x;
      const wo = WALL_OBJECT_CHARS[ch];
      if (wo) tiles[c] = wo.tile;
      else if (ch === '#') tiles[c] = Tile.Wall;
      else if (ch === 'W') tiles[c] = Tile.Window;
      else if (ch === 'c') tiles[c] = Tile.Cabinet;
      else if (ch === '+' || ch === '=') tiles[c] = Tile.Door;
      else if (ch === 'b') tiles[c] = Tile.Bed;
      else {
        tiles[c] = Tile.Floor;
        const m = MARKER_CHARS[ch];
        if (m === 'spawn') spawn = c;
        else if (m) markers[m].push(c);
        else if (ch !== '.') throw new Error(`unknown map char '${ch}' at ${x},${y}`);
      }
      const zk = zrow[x]!;
      if (zk !== '#') {
        const zi = zoneIndex.get(zk);
        if (zi === undefined) throw new Error(`unknown zone '${zk}' at ${x},${y}`);
        zoneOf[c] = zi;
      }
    }
  }
  if (spawn < 0) throw new Error('map has no spawn');

  const level: Level = {
    w,
    h,
    tiles,
    zoneOf,
    regionOf,
    zones: ZONES,
    regions: [],
    doors: [],
    doorIndex: new Map(),
    wallObjects: [],
    wallObjectAt: new Map(),
    beds: [],
    spawn,
    markers,
    gateInfo: new Map(),
  };

  const walkable = (c: number) => tiles[c] === Tile.Floor;

  // Doors: axis from which neighbours are floor.
  for (let c = 0; c < w * h; c++) {
    if (tiles[c] !== Tile.Door) continue;
    const x = c % w;
    const y = Math.floor(c / w);
    const ew = x > 0 && x < w - 1 && walkable(c - 1) && walkable(c + 1);
    const ns = y > 0 && y < h - 1 && walkable(c - w) && walkable(c + w);
    if (!ew && !ns) throw new Error(`door at ${x},${y} connects nothing`);
    const lock = STRUCTURE[y]![x] === '=' ? (LOCKS[`${x},${y}`] ?? null) : null;
    if (STRUCTURE[y]![x] === '=' && !lock) throw new Error(`locked door at ${x},${y} has no lock entry`);
    const axis = ew ? 'x' : 'y';
    const sides: [number, number] = axis === 'x' ? [c - 1, c + 1] : [c - w, c + w];
    level.doorIndex.set(c, level.doors.length);
    level.doors.push({ cell: c, axis, lock, sides });
  }

  // Wall objects: exactly one floor neighbour is the access cell.
  for (let c = 0; c < w * h; c++) {
    const ch = STRUCTURE[Math.floor(c / w)]![c % w]!;
    const wo = WALL_OBJECT_CHARS[ch];
    if (!wo) continue;
    const acc = neighbors4(level, c).filter(walkable);
    if (acc.length !== 1) throw new Error(`wall object ${ch} at ${c % w},${Math.floor(c / w)} needs one access cell`);
    const a = acc[0]!;
    const obj: WallObject = {
      kind: wo.kind,
      cell: c,
      access: a,
      dx: (c % w) - (a % w),
      dy: Math.floor(c / w) - Math.floor(a / w),
    };
    level.wallObjects.push(obj);
    level.wallObjectAt.set(c, obj);
    if (wo.kind === 'gate') {
      const info = GATES[`${c % w},${Math.floor(c / w)}`];
      if (!info) throw new Error('gate without metadata');
      level.gateInfo.set(c, info);
    }
  }

  for (let c = 0; c < w * h; c++) {
    if (tiles[c] !== Tile.Bed) continue;
    level.beds.push({ cell: c, access: neighbors4(level, c).filter(walkable) });
  }

  buildRegions(level);
  return level;
}

function buildRegions(level: Level): void {
  const { w, h, tiles, zoneOf, regionOf } = level;
  const inRegion = (c: number) => tiles[c] === Tile.Floor || tiles[c] === Tile.Bed;
  for (let start = 0; start < w * h; start++) {
    if (!inRegion(start) || regionOf[start] !== -1) continue;
    const id = level.regions.length;
    const zone = zoneOf[start]!;
    const cells: number[] = [];
    const stack = [start];
    regionOf[start] = id;
    while (stack.length) {
      const c = stack.pop()!;
      cells.push(c);
      for (const n of neighbors4(level, c)) {
        if (regionOf[n] === -1 && inRegion(n) && zoneOf[n] === zone) {
          regionOf[n] = id;
          stack.push(n);
        }
      }
    }
    let x0 = w;
    let y0 = h;
    let x1 = 0;
    let y1 = 0;
    let sx = 0;
    let sy = 0;
    for (const c of cells) {
      const x = c % w;
      const y = Math.floor(c / w);
      x0 = Math.min(x0, x);
      y0 = Math.min(y0, y);
      x1 = Math.max(x1, x);
      y1 = Math.max(y1, y);
      sx += x;
      sy += y;
    }
    const mx = sx / cells.length;
    const my = sy / cells.length;
    let center = cells[0]!;
    let best = Infinity;
    for (const c of cells) {
      if (tiles[c] !== Tile.Floor) continue;
      const d = (c % w - mx) ** 2 + (Math.floor(c / w) - my) ** 2;
      if (d < best) {
        best = d;
        center = c;
      }
    }
    const zdef = level.zones[zone]!;
    // Corridors (straight, L or T shaped) have almost no cells surrounded on all four sides.
    const inThis = new Set(cells);
    let interior = 0;
    for (const c of cells) if (neighbors4(level, c).every((n) => inThis.has(n))) interior++;
    const longest = Math.max(x1 - x0, y1 - y0) + 1;
    const isCorridor = longest >= 8 && interior / cells.length < 0.12;
    const kind: RegionKind = zdef.key === 'n' ? 'nest' : zdef.exterior ? 'exterior' : isCorridor ? 'corridor' : 'room';
    level.regions.push({ id, zone, cells, links: [], center, kind, deadEnd: false, x0, y0, x1, y1 });
  }

  const link = (a: number, b: number, via: number) => {
    if (a === b || a < 0 || b < 0) return;
    const ra = level.regions[a]!;
    if (!ra.links.some((l) => l.region === b && l.via === via)) ra.links.push({ region: b, via });
  };
  for (const d of level.doors) {
    const ra = regionOf[d.sides[0]]!;
    const rb = regionOf[d.sides[1]]!;
    link(ra, rb, d.cell);
    link(rb, ra, d.cell);
  }
  for (let c = 0; c < w * h; c++) {
    const r = regionOf[c]!;
    if (r < 0) continue;
    for (const n of neighbors4(level, c)) {
      const rn = regionOf[n]!;
      if (rn >= 0 && rn !== r) link(r, rn, -1);
    }
  }
  for (const r of level.regions) {
    const distinct = new Set(r.links.map((l) => l.region));
    r.deadEnd = r.kind !== 'corridor' && distinct.size === 1 && r.links.length === 1;
  }
}

/**
 * Grid line-of-sight (Amanatides & Woo). The start cell is ignored; the end cell is tested,
 * so a target inside an opaque cell (a hidden player) is not visible.
 */
export function losClear(level: Level, a: Vec2, b: Vec2, blocks: (cell: number) => boolean): boolean {
  let x = Math.floor(a.x);
  let y = Math.floor(a.y);
  const ex = Math.floor(b.x);
  const ey = Math.floor(b.y);
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const stepX = dx > 0 ? 1 : -1;
  const stepY = dy > 0 ? 1 : -1;
  const tDeltaX = dx !== 0 ? Math.abs(1 / dx) : Infinity;
  const tDeltaY = dy !== 0 ? Math.abs(1 / dy) : Infinity;
  let tMaxX = dx !== 0 ? (dx > 0 ? x + 1 - a.x : a.x - x) * tDeltaX : Infinity;
  let tMaxY = dy !== 0 ? (dy > 0 ? y + 1 - a.y : a.y - y) * tDeltaY : Infinity;
  let guard = 0;
  while ((x !== ex || y !== ey) && guard++ < 512) {
    if (tMaxX < tMaxY) {
      tMaxX += tDeltaX;
      x += stepX;
    } else {
      tMaxY += tDeltaY;
      y += stepY;
    }
    if (!inBounds(level, x, y)) return false;
    if (blocks(y * level.w + x)) return false;
  }
  return true;
}

export function zoneOfPos(level: Level, p: Vec2): ZoneDef | null {
  const c = cellAt(level, p);
  if (c < 0) return null;
  const z = level.zoneOf[c]!;
  return z >= 0 ? level.zones[z]! : null;
}

export function regionOfCell(level: Level, c: number): Region | null {
  if (c < 0) return null;
  const r = level.regionOf[c]!;
  return r >= 0 ? level.regions[r]! : null;
}

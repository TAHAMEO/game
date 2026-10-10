import * as THREE from 'three';
import { cellCenter, Tile, type Level, type WallObject } from '../core/level';
import { DOOR_H, WALL_H } from './constants';
import type { GeoBuilder, V3 } from './geo';
import { DIRS, EXT_WALL_H, isOpenTile, type LevelGeometry } from './level3d';

/**
 * A wall face's local frame. `a` runs along the face (to the right as you look at it),
 * `y` is up, `d` comes out of the wall into the room (negative goes into the wall).
 */
export class Frame {
  readonly r: V3;
  constructor(
    readonly cx: number,
    readonly cz: number,
    readonly n: V3,
  ) {
    // r = up × n: to your right as you face the wall
    this.r = [n[2], 0, -n[0]];
  }

  at(a: number, y: number, d: number): V3 {
    return [this.cx + this.r[0] * a + this.n[0] * d, y, this.cz + this.r[2] * a + this.n[2] * d];
  }

  box(b: GeoBuilder, a0: number, a1: number, y0: number, y1: number, d0: number, d1: number, span = 1): void {
    const p = this.at(a0, y0, d0);
    const q = this.at(a1, y1, d1);
    b.box([Math.min(p[0], q[0]), Math.min(p[1], q[1]), Math.min(p[2], q[2])], [Math.max(p[0], q[0]), Math.max(p[1], q[1]), Math.max(p[2], q[2])], span);
  }

  /** A rectangle in the face plane at depth d, facing out of the wall (or into it). */
  quad(b: GeoBuilder, a0: number, a1: number, y0: number, y1: number, d: number, facingOut = true, span = 1): void {
    const n: V3 = facingOut ? this.n : [-this.n[0], 0, -this.n[2]];
    const c = this.at((a0 + a1) / 2, 0, d);
    b.wall(c[0], c[2], n, Math.abs(a1 - a0), y0, y1, span);
  }

  /** A rectangle perpendicular to the face, at offset a, facing +r (or -r), spanning depth d0..d1. */
  side(b: GeoBuilder, a: number, y0: number, y1: number, d0: number, d1: number, facingRight: boolean, span = 1): void {
    const n: V3 = facingRight ? this.r : [-this.r[0], 0, -this.r[2]];
    const c = this.at(a, 0, (d0 + d1) / 2);
    b.wall(c[0], c[2], n, Math.abs(d1 - d0), y0, y1, span);
  }

  /** Matrix whose x axis is along the face, y up, z out of the wall. */
  matrix(a: number, y: number, d: number, extra?: THREE.Matrix4): THREE.Matrix4 {
    const m = new THREE.Matrix4().makeBasis(new THREE.Vector3(...this.r), new THREE.Vector3(0, 1, 0), new THREE.Vector3(...this.n));
    const p = this.at(a, y, d);
    m.setPosition(p[0], p[1], p[2]);
    if (extra) m.multiply(extra);
    return m;
  }
}

export function faceFrame(level: Level, wallCell: number, openCell: number): Frame {
  const x = wallCell % level.w;
  const y = Math.floor(wallCell / level.w);
  const dx = (openCell % level.w) - x;
  const dy = Math.floor(openCell / level.w) - y;
  return new Frame(x + 0.5 + dx * 0.5, y + 0.5 + dy * 0.5, [dx, 0, dy]);
}

const cyl = (r: number, h: number, seg = 12, rTop = r) => new THREE.CylinderGeometry(rTop, r, h, seg, 1);
const rotX = (a: number) => new THREE.Matrix4().makeRotationX(a);
const rotZ = (a: number) => new THREE.Matrix4().makeRotationZ(a);

/** Cell-hash for deterministic dressing. */
const hash = (n: number) => {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return s - Math.floor(s);
};

export interface FurnitureAnchors {
  /** Hinge frame of each hiding locker's door, by wall cell. */
  lockers: Map<number, Frame>;
  drawers: Map<number, Frame>;
  taps: Map<number, Frame>;
  fuseBox: Frame | null;
  radio: Frame | null;
  gates: Map<number, Frame>;
  windows: Frame[];
  vents: Map<number, Frame>;
  beds: Map<number, { center: V3; along: 'x' | 'z'; head: number }>;
  signs: { frame: Frame; text: string; sub?: string; y: number; seed: number }[];
  exits: { frame: Frame; y: number }[];
  posters: { frame: Frame; a: number; y: number; index: number }[];
}

/**
 * Static furniture and fittings, merged into the level's material buckets. Moving parts
 * (doors, locker doors, drawer trays, levers) are made by `objects.ts` at the anchors
 * recorded here.
 */
export function buildFurniture(L: LevelGeometry): FurnitureAnchors {
  const level = L.level;
  const A: FurnitureAnchors = {
    lockers: new Map(),
    drawers: new Map(),
    taps: new Map(),
    fuseBox: null,
    radio: null,
    gates: new Map(),
    windows: [],
    vents: new Map(),
    beds: new Map(),
    signs: [],
    exits: [],
    posters: [],
  };
  // Claims first: the level builder skips (or shortens) the walls these replace.
  for (const wo of level.wallObjects) {
    if (wo.kind === 'locker') L.claim(wo.cell, wo.access, 1.32);
    else if (wo.kind === 'drawer') L.claim(wo.cell, wo.access, 1.6);
    else if (wo.kind === 'gate') L.claim(wo.cell, wo.access);
  }
  for (let c = 0; c < level.w * level.h; c++) {
    if (level.tiles[c] !== Tile.Window) continue;
    for (const n of openNeighbours(level, c)) L.claim(c, n);
  }
  for (const wo of level.wallObjects) {
    const f = faceFrame(level, wo.cell, wo.access);
    switch (wo.kind) {
      case 'locker':
        lockerBank(L, f, wo);
        A.lockers.set(wo.cell, f);
        break;
      case 'drawer':
        drawerBank(L, f, wo);
        A.drawers.set(wo.cell, f);
        break;
      case 'vent':
        vent(L, f);
        A.vents.set(wo.cell, f);
        break;
      case 'tap':
        sink(L, f);
        A.taps.set(wo.cell, f);
        break;
      case 'fusebox':
        fuseBox(L, f);
        A.fuseBox = f;
        break;
      case 'radio':
        radioConsole(L, f);
        A.radio = f;
        break;
      case 'gate':
        gateArch(L, f, wo);
        A.gates.set(wo.cell, f);
        break;
    }
  }
  for (let c = 0; c < level.w * level.h; c++) {
    if (level.tiles[c] !== Tile.Window) continue;
    for (const n of openNeighbours(level, c)) {
      const f = faceFrame(level, c, n);
      windowFrame(L, f, c, n);
      A.windows.push(f);
    }
  }
  for (const bed of level.beds) A.beds.set(bed.cell, hospitalBed(L, bed.cell));
  cabinets(L);
  signage(L, A);
  return A;
}

function openNeighbours(level: Level, c: number): number[] {
  const x = c % level.w;
  const y = Math.floor(c / level.w);
  const out: number[] = [];
  for (const d of DIRS) {
    const nx = x + d.dx;
    const ny = y + d.dy;
    if (nx < 0 || ny < 0 || nx >= level.w || ny >= level.h) continue;
    const n = ny * level.w + nx;
    if (isOpenTile(level.tiles[n]!)) out.push(n);
  }
  return out;
}

// =========================================================================== wall objects

function lockerBank(L: LevelGeometry, f: Frame, wo: WallObject): void {
  const B = (m: string) => L.builder(m, f.cx, f.cz);
  const metal = B('metal:locker');
  const dark = B('black');
  const steel = B('steel');
  // the two closed neighbours
  for (const [a0, a1] of [
    [-0.5, -0.215],
    [0.215, 0.5],
  ] as const) {
    f.box(metal, a0 + 0.008, a1 - 0.008, 0.07, 1.29, -0.01, 0.006);
    for (let k = 0; k < 5; k++) {
      const y = 1.06 + k * 0.034;
      f.box(dark, a0 + 0.05, a1 - 0.05, y, y + 0.012, 0.006, 0.0085);
      f.box(dark, a0 + 0.05, a1 - 0.05, 0.14 + k * 0.034, 0.152 + k * 0.034, 0.006, 0.0085);
    }
    const hx = a0 < 0 ? a1 - 0.05 : a0 + 0.05;
    f.box(steel, hx - 0.012, hx + 0.012, 0.6, 0.74, 0.006, 0.026);
  }
  // body: plinth, top rail, dividers
  f.box(dark, -0.5, 0.5, 0, 0.07, -0.012, 0.0);
  f.box(metal, -0.5, 0.5, 1.29, 1.32, -0.02, 0.01);
  for (const a of [-0.215, 0.215]) f.box(metal, a - 0.01, a + 0.01, 0.07, 1.29, -0.012, 0.009);
  f.box(metal, -0.5, -0.49, 0.07, 1.29, -0.012, 0.009);
  f.box(metal, 0.49, 0.5, 0.07, 1.29, -0.012, 0.009);
  // the hiding locker's inside, seen from within
  const inside = B('metal:lockerIn');
  const D = -0.46;
  f.quad(inside, -0.205, 0.205, 0.07, 1.29, D, true);
  f.side(inside, -0.205, 0.07, 1.29, D, 0, true);
  f.side(inside, 0.205, 0.07, 1.29, D, 0, false);
  const top = f.at(0, 1.29, D / 2);
  const bottom = f.at(0, 0.07, D / 2);
  const hw = 0.205;
  const xs = [f.at(-hw, 0, D), f.at(hw, 0, 0)];
  const x0 = Math.min(xs[0]![0], xs[1]![0]);
  const x1 = Math.max(xs[0]![0], xs[1]![0]);
  const z0 = Math.min(xs[0]![2], xs[1]![2]);
  const z1 = Math.max(xs[0]![2], xs[1]![2]);
  inside.flat(x0, z0, x1, z1, top[1], false, 1);
  inside.flat(x0, z0, x1, z1, bottom[1], true, 1);
  // a coat hook and a shelf
  f.box(inside, -0.2, 0.2, 1.12, 1.135, D, D + 0.3);
  steel.merge(cyl(0.008, 0.08), f.matrix(0.1, 1.0, D + 0.05, rotX(Math.PI / 2)));
  void wo;
}

function drawerBank(L: LevelGeometry, f: Frame, wo: WallObject): void {
  const steel = L.builder('steel', f.cx, f.cz);
  const dark = L.builder('black', f.cx, f.cz);
  const rows: [number, number][] = [
    [0.1, 0.5],
    [0.58, 0.98],
    [1.06, 1.46],
  ];
  // cladding around the middle (hiding) drawer
  f.box(steel, -0.5, 0.5, 0, 0.56, -0.02, 0.0);
  f.box(steel, -0.5, 0.5, 1.0, 1.6, -0.02, 0.0);
  f.box(steel, -0.5, -0.32, 0.56, 1.0, -0.02, 0.0);
  f.box(steel, 0.32, 0.5, 0.56, 1.0, -0.02, 0.0);
  for (const [i, [y0, y1]] of rows.entries()) {
    if (i === 1) continue;
    f.box(steel, -0.31, 0.31, y0, y1, 0.0, 0.025);
    f.box(dark, 0.2, 0.27, (y0 + y1) / 2 - 0.02, (y0 + y1) / 2 + 0.02, 0.025, 0.045);
  }
  // the tunnel the middle drawer slides out of
  const inside = L.builder('steel:dark', f.cx, f.cz);
  const D = -0.96;
  f.quad(inside, -0.32, 0.32, 0.56, 1.0, D, true);
  f.side(inside, -0.32, 0.56, 1.0, D, 0, true);
  f.side(inside, 0.32, 0.56, 1.0, D, 0, false);
  const p = f.at(-0.32, 0, D);
  const q = f.at(0.32, 0, 0);
  inside.flat(Math.min(p[0], q[0]), Math.min(p[2], q[2]), Math.max(p[0], q[0]), Math.max(p[2], q[2]), 1.0, false, 1);
  inside.flat(Math.min(p[0], q[0]), Math.min(p[2], q[2]), Math.max(p[0], q[0]), Math.max(p[2], q[2]), 0.56, true, 1);
  void wo;
}

function vent(L: LevelGeometry, f: Frame): void {
  const steel = L.builder('metal:vent', f.cx, f.cz);
  const dark = L.builder('black', f.cx, f.cz);
  const y0 = 1.32;
  const y1 = 1.6;
  f.quad(dark, -0.27, 0.27, y0, y1, 0.003, true);
  f.box(steel, -0.3, 0.3, y0 - 0.03, y0, 0, 0.02);
  f.box(steel, -0.3, 0.3, y1, y1 + 0.03, 0, 0.02);
  f.box(steel, -0.3, -0.27, y0, y1, 0, 0.02);
  f.box(steel, 0.27, 0.3, y0, y1, 0, 0.02);
  for (let k = 0; k < 6; k++) {
    const y = y0 + 0.02 + k * 0.045;
    steel.merge(new THREE.BoxGeometry(0.54, 0.008, 0.03), f.matrix(0, y + 0.01, 0.012, rotX(-0.6)));
  }
}

function sink(L: LevelGeometry, f: Frame): void {
  const ceramic = L.builder('ceramic', f.cx, f.cz);
  const steel = L.builder('steel', f.cx, f.cz);
  const dark = L.builder('black', f.cx, f.cz);
  const mirror = L.builder('mirror', f.cx, f.cz);
  f.box(ceramic, -0.25, 0.25, 0.7, 0.74, 0, 0.36);
  f.box(ceramic, -0.25, 0.25, 0.74, 0.86, 0, 0.03);
  f.box(ceramic, -0.25, 0.25, 0.74, 0.86, 0.33, 0.36);
  f.box(ceramic, -0.25, -0.22, 0.74, 0.86, 0.03, 0.33);
  f.box(ceramic, 0.22, 0.25, 0.74, 0.86, 0.03, 0.33);
  f.box(dark, -0.06, 0.06, 0.741, 0.745, 0.13, 0.25);
  steel.merge(cyl(0.025, 0.66), f.matrix(0, 0.37, 0.14));
  steel.merge(cyl(0.012, 0.14), f.matrix(0, 0.93, 0.05));
  steel.merge(cyl(0.011, 0.13), f.matrix(0, 1.0, 0.11, rotX(Math.PI / 2)));
  for (const a of [-0.1, 0.1]) steel.merge(cyl(0.018, 0.03, 8), f.matrix(a, 0.89, 0.05));
  f.box(mirror, -0.21, 0.21, 1.0, 1.44, 0.0, 0.01);
  f.box(steel, -0.23, 0.23, 0.98, 1.0, 0, 0.02);
  f.box(steel, -0.23, 0.23, 1.44, 1.46, 0, 0.02);
  f.box(steel, -0.23, -0.21, 1.0, 1.44, 0, 0.02);
  f.box(steel, 0.21, 0.23, 1.0, 1.44, 0, 0.02);
}

function fuseBox(L: LevelGeometry, f: Frame): void {
  const box = L.builder('metal:grey', f.cx, f.cz);
  const dark = L.builder('black', f.cx, f.cz);
  const y0 = 0.72;
  const y1 = 1.38;
  f.box(box, -0.27, 0.27, y0, y0 + 0.02, 0, 0.14);
  f.box(box, -0.27, 0.27, y1 - 0.02, y1, 0, 0.14);
  f.box(box, -0.27, -0.25, y0, y1, 0, 0.14);
  f.box(box, 0.25, 0.27, y0, y1, 0, 0.14);
  f.box(dark, -0.25, 0.25, y0 + 0.02, y1 - 0.02, 0, 0.02);
  // the door, swung open
  box.merge(new THREE.BoxGeometry(0.02, y1 - y0, 0.52), f.matrix(-0.27, (y0 + y1) / 2, 0.14 + 0.26, new THREE.Matrix4().makeRotationY(0.25)));
  // three sockets and the breaker housing
  for (const a of [-0.13, 0, 0.13]) dark.merge(cyl(0.035, 0.05, 12), f.matrix(a, 1.2, 0.045, rotX(Math.PI / 2)));
  f.box(box, 0.08, 0.22, 0.86, 1.06, 0.02, 0.06);
  // cables out of the top
  for (const a of [-0.15, -0.05, 0.05]) dark.merge(cyl(0.012, WALL_H - y1, 6), f.matrix(a, (WALL_H + y1) / 2, 0.06));
}

function radioConsole(L: LevelGeometry, f: Frame): void {
  const wood = L.builder('wood', f.cx, f.cz);
  const body = L.builder('metal:radio', f.cx, f.cz);
  const dark = L.builder('black', f.cx, f.cz);
  const steel = L.builder('steel', f.cx, f.cz);
  f.box(wood, -0.42, 0.42, 0.72, 0.76, 0, 0.38);
  for (const a of [-0.38, 0.38]) f.box(wood, a - 0.02, a + 0.02, 0.0, 0.72, 0.3, 0.34);
  f.box(body, -0.3, 0.2, 0.76, 1.02, 0.04, 0.3);
  f.quad(dark, -0.26, -0.04, 0.8, 0.98, 0.301, true);
  for (const [a, y] of [
    [0.03, 0.94],
    [0.12, 0.94],
    [0.03, 0.84],
    [0.12, 0.84],
  ] as const)
    steel.merge(cyl(0.022, 0.03, 12), f.matrix(a, y, 0.31, rotX(Math.PI / 2)));
  // handset on its hook, and an antenna
  f.box(dark, 0.24, 0.36, 0.77, 0.81, 0.08, 0.26);
  steel.merge(cyl(0.006, 0.6, 6), f.matrix(-0.22, 1.32, 0.12));
}

function gateArch(L: LevelGeometry, f: Frame, wo: WallObject): void {
  const zk = L.zoneKey(wo.access);
  const wall = L.builder(`wall:${zk}`, f.cx, f.cz);
  const H = EXT_WALL_H;
  const top = 1.75;
  f.quad(wall, -0.5, -0.42, 0, H, 0, true, 2);
  f.quad(wall, 0.42, 0.5, 0, H, 0, true, 2);
  f.quad(wall, -0.42, 0.42, top, H, 0, true, 2);
  // the short passage through the wall
  f.side(wall, -0.42, 0, top, -1.0, 0, true, 2);
  f.side(wall, 0.42, 0, top, -1.0, 0, false, 2);
  const p = f.at(-0.42, 0, -1.0);
  const q = f.at(0.42, 0, 0);
  wall.flat(Math.min(p[0], q[0]), Math.min(p[2], q[2]), Math.max(p[0], q[0]), Math.max(p[2], q[2]), top, false, 2);
  L.builder(`floor:${zk}`, f.cx, f.cz).flat(Math.min(p[0], q[0]), Math.min(p[2], q[2]), Math.max(p[0], q[0]), Math.max(p[2], q[2]), 0.001, true, 2);
  const rust = L.builder('rust', f.cx, f.cz);
  // gate posts
  for (const a of [-0.46, 0.46]) rust.merge(new THREE.BoxGeometry(0.07, top + 0.2, 0.07), f.matrix(a, (top + 0.2) / 2, 0.03));
}

function windowFrame(L: LevelGeometry, f: Frame, cell: number, open: number): void {
  const zk = L.zoneKey(open);
  const wall = L.builder(`wall:${zk}`, f.cx, f.cz);
  const H = L.wallHeightFacing(open);
  const a0 = -0.34;
  const a1 = 0.34;
  const y0 = 0.62;
  const y1 = 1.42;
  const D = -0.24;
  f.quad(wall, -0.5, 0.5, 0, y0, 0, true, 2);
  f.quad(wall, -0.5, 0.5, y1, H, 0, true, 2);
  f.quad(wall, -0.5, a0, y0, y1, 0, true, 2);
  f.quad(wall, a1, 0.5, y0, y1, 0, true, 2);
  // reveals
  f.side(wall, a0, y0, y1, D, 0, true, 2);
  f.side(wall, a1, y0, y1, D, 0, false, 2);
  const p = f.at(a0, 0, D);
  const q = f.at(a1, 0, 0);
  wall.flat(Math.min(p[0], q[0]), Math.min(p[2], q[2]), Math.max(p[0], q[0]), Math.max(p[2], q[2]), y1, false, 2);
  const sill = L.builder('wood', f.cx, f.cz);
  f.box(sill, a0 - 0.06, a1 + 0.06, y0 - 0.035, y0, D, 0.07);
  const frame = L.builder('frame:window', f.cx, f.cz);
  f.box(frame, a0, a1, y0, y0 + 0.04, D - 0.02, D + 0.02);
  f.box(frame, a0, a1, y1 - 0.04, y1, D - 0.02, D + 0.02);
  f.box(frame, a0, a0 + 0.04, y0, y1, D - 0.02, D + 0.02);
  f.box(frame, a1 - 0.04, a1, y0, y1, D - 0.02, D + 0.02);
  f.box(frame, -0.015, 0.015, y0, y1, D - 0.015, D + 0.015);
  f.box(frame, a0, a1, (y0 + y1) / 2 - 0.015, (y0 + y1) / 2 + 0.015, D - 0.015, D + 0.015);
  // glass and the night beyond it
  f.quad(L.builder(hash(cell) < 0.35 ? 'glass:cracked' : 'glass', f.cx, f.cz), a0, a1, y0, y1, D, true);
  f.quad(L.builder('outside', f.cx, f.cz), a0 - 0.1, a1 + 0.1, y0 - 0.1, y1 + 0.1, D - 0.5, true);
  f.side(wall, a0, y0, y1, D - 0.5, D, true, 2);
  f.side(wall, a1, y0, y1, D - 0.5, D, false, 2);
}

// =========================================================================== beds

function hospitalBed(L: LevelGeometry, cell: number): { center: V3; along: 'x' | 'z'; head: number } {
  const level = L.level;
  const x = cell % level.w;
  const y = Math.floor(cell / level.w);
  const solid = (dx: number, dy: number) => {
    const nx = x + dx;
    const ny = y + dy;
    if (nx < 0 || ny < 0 || nx >= level.w || ny >= level.h) return true;
    const t = level.tiles[ny * level.w + nx]!;
    return !isOpenTile(t);
  };
  let along: 'x' | 'z' = 'z';
  let head = -1;
  if (solid(0, -1) !== solid(0, 1)) {
    along = 'z';
    head = solid(0, -1) ? -1 : 1;
  } else if (solid(-1, 0) !== solid(1, 0)) {
    along = 'x';
    head = solid(-1, 0) ? -1 : 1;
  } else head = hash(cell) < 0.5 ? -1 : 1;
  const c = cellCenter(level, cell);
  const len = 0.98;
  const wid = 0.54;
  // local helpers: l along the bed (toward the head = +), w across it
  const P = (l: number, yy: number, w: number): V3 => (along === 'z' ? [c.x + w, yy, c.y + l * head] : [c.x + l * head, yy, c.y + w]);
  const boxL = (b: GeoBuilder, l0: number, l1: number, y0: number, y1: number, w0: number, w1: number) => {
    const p = P(l0, y0, w0);
    const q = P(l1, y1, w1);
    b.box([Math.min(p[0], q[0]), y0, Math.min(p[2], q[2])], [Math.max(p[0], q[0]), y1, Math.max(p[2], q[2])], 1);
  };
  const frame = L.builder('metal:bed', c.x, c.y);
  const dark = L.builder('black', c.x, c.y);
  const mattress = L.builder('fabric:mattress', c.x, c.y);
  const sheet = L.builder('fabric:sheet', c.x, c.y);
  const hl = len / 2;
  const hw = wid / 2;
  // legs and casters
  for (const l of [-hl + 0.05, hl - 0.05]) {
    for (const w of [-hw + 0.03, hw - 0.03]) {
      const p = P(l, 0.17, w);
      frame.merge(cyl(0.014, 0.24, 8), new THREE.Matrix4().makeTranslation(p[0], 0.17, p[2]));
      const q = P(l, 0.035, w);
      dark.merge(cyl(0.035, 0.03, 10), new THREE.Matrix4().makeTranslation(q[0], 0.035, q[2]).multiply(rotZ(Math.PI / 2)));
    }
  }
  // base rails and spring deck
  boxL(frame, -hl, hl, 0.27, 0.3, -hw, -hw + 0.03);
  boxL(frame, -hl, hl, 0.27, 0.3, hw - 0.03, hw);
  boxL(dark, -hl + 0.02, hl - 0.02, 0.285, 0.305, -hw + 0.03, hw - 0.03);
  // head and foot boards
  boxL(frame, hl - 0.03, hl, 0.27, 0.78, -hw, hw);
  boxL(frame, -hl, -hl + 0.03, 0.27, 0.62, -hw, hw);
  // side rails, folded down
  boxL(frame, -hl + 0.15, hl - 0.15, 0.35, 0.37, -hw - 0.02, -hw);
  boxL(frame, -hl + 0.15, hl - 0.15, 0.35, 0.37, hw, hw + 0.02);
  // mattress, sheet, pillow, a blanket pushed down
  boxL(mattress, -hl + 0.03, hl - 0.03, 0.305, 0.43, -hw + 0.02, hw - 0.02);
  boxL(sheet, -hl + 0.02, hl - 0.06, 0.43, 0.445, -hw + 0.01, hw - 0.01);
  boxL(sheet, hl - 0.26, hl - 0.06, 0.445, 0.5, -hw + 0.08, hw - 0.08);
  const r = hash(cell + 3);
  boxL(L.builder('fabric:blanket', c.x, c.y), -hl + 0.04, -hl + 0.3 + r * 0.2, 0.445, 0.48, -hw - 0.005, hw + 0.005);
  return { center: [c.x, 0, c.y], along, head };
}

// =========================================================================== cabinet cells

function cabinets(L: LevelGeometry): void {
  const level = L.level;
  const seen = new Set<number>();
  for (let c = 0; c < level.w * level.h; c++) {
    if (level.tiles[c] !== Tile.Cabinet || seen.has(c)) continue;
    const group: number[] = [];
    const stack = [c];
    seen.add(c);
    while (stack.length) {
      const k = stack.pop()!;
      group.push(k);
      const x = k % level.w;
      const y = Math.floor(k / level.w);
      for (const d of DIRS) {
        const nx = x + d.dx;
        const ny = y + d.dy;
        if (nx < 0 || ny < 0 || nx >= level.w || ny >= level.h) continue;
        const n = ny * level.w + nx;
        if (level.tiles[n] === Tile.Cabinet && !seen.has(n)) {
          seen.add(n);
          stack.push(n);
        }
      }
    }
    const zk = L.zoneKey(group[0]!);
    const xs = group.map((g) => g % level.w);
    const ys = group.map((g) => Math.floor(g / level.w));
    const bx0 = Math.min(...xs);
    const bx1 = Math.max(...xs) + 1;
    const by0 = Math.min(...ys);
    const by1 = Math.max(...ys) + 1;
    // floor under the furniture (it stands in the room)
    for (const g of group) {
      const gx = g % level.w;
      const gy = Math.floor(g / level.w);
      L.builder(`floor:${zk}`, gx, gy).flat(gx, gy, gx + 1, gy + 1, 0, true, 2);
      if (!L.isExterior(g)) L.builder(`ceil:${zk}`, gx, gy).flat(gx, gy, gx + 1, gy + 1, WALL_H, false, 2);
    }
    switch (zk) {
      case 'c':
        for (const g of group) (hash(g) < 0.4 ? angel : gravestone)(L, g);
        break;
      case 'a':
        ambulance(L, bx0, by0, bx1, by1);
        break;
      case 'm':
        boiler(L, bx0, by0, bx1, by1);
        break;
      case 'g':
        autopsyTable(L, bx0, by0, bx1, by1);
        break;
      case 's':
        for (const g of group) (hash(g) < 0.55 ? securityDesk : filingCabinet)(L, g);
        break;
      case 'r':
        waitingChairs(L, bx0, by0, bx1, by1);
        break;
      default:
        for (const g of group) shelving(L, g);
    }
  }
}

function cellBox(level: Level, g: number): [number, number] {
  return [g % level.w, Math.floor(g / level.w)];
}

function gravestone(L: LevelGeometry, g: number): void {
  const [x, y] = cellBox(L.level, g);
  const stone = L.builder('stone', x, y);
  const cx = x + 0.5;
  const cz = y + 0.5;
  stone.box([cx - 0.36, 0, cz - 0.4], [cx + 0.36, 0.08, cz + 0.4], 1);
  const tilt = (hash(g + 5) - 0.5) * 0.18;
  const m = new THREE.Matrix4().makeTranslation(cx, 0.42, cz - 0.2).multiply(rotX(tilt));
  stone.merge(new THREE.BoxGeometry(0.5, 0.7, 0.1), m);
  stone.merge(new THREE.CylinderGeometry(0.25, 0.25, 0.1, 16, 1, false, 0, Math.PI), new THREE.Matrix4().makeTranslation(cx, 0.77, cz - 0.2).multiply(rotX(tilt)).multiply(new THREE.Matrix4().makeRotationX(Math.PI / 2)).multiply(new THREE.Matrix4().makeRotationY(Math.PI / 2)));
  // a dead shrub in the plot
  const twig = L.builder('wood:dark', x, y);
  for (let i = 0; i < 5; i++) {
    const a = hash(g * 7 + i) * Math.PI * 2;
    twig.merge(cyl(0.008, 0.35, 5, 0.003), new THREE.Matrix4().makeTranslation(cx + Math.cos(a) * 0.12, 0.22, cz + 0.15 + Math.sin(a) * 0.1).multiply(rotZ((hash(g + i) - 0.5) * 0.9)));
  }
}

function angel(L: LevelGeometry, g: number): void {
  const [x, y] = cellBox(L.level, g);
  const stone = L.builder('stone', x, y);
  const cx = x + 0.5;
  const cz = y + 0.5;
  const face = hash(g + 1) * Math.PI * 2;
  const R = new THREE.Matrix4().makeTranslation(cx, 0, cz).multiply(new THREE.Matrix4().makeRotationY(face));
  const at = (m: THREE.Matrix4) => R.clone().multiply(m);
  stone.merge(new THREE.BoxGeometry(0.62, 0.42, 0.62), at(new THREE.Matrix4().makeTranslation(0, 0.21, 0)));
  stone.merge(new THREE.BoxGeometry(0.7, 0.06, 0.7), at(new THREE.Matrix4().makeTranslation(0, 0.44, 0)));
  // robe
  const robe = new THREE.LatheGeometry(
    [
      new THREE.Vector2(0.0, 0),
      new THREE.Vector2(0.26, 0),
      new THREE.Vector2(0.22, 0.3),
      new THREE.Vector2(0.16, 0.62),
      new THREE.Vector2(0.17, 0.78),
      new THREE.Vector2(0.12, 0.86),
      new THREE.Vector2(0.0, 0.88),
    ],
    18,
  );
  stone.merge(robe, at(new THREE.Matrix4().makeTranslation(0, 0.47, 0)));
  // head bowed into its hands
  stone.merge(new THREE.SphereGeometry(0.085, 14, 10), at(new THREE.Matrix4().makeTranslation(0, 1.42, 0.06)));
  for (const s of [-1, 1]) {
    stone.merge(cyl(0.035, 0.32, 8), at(new THREE.Matrix4().makeTranslation(s * 0.08, 1.28, 0.1).multiply(rotX(-1.1)).multiply(rotZ(s * 0.3))));
    // wings
    const wing = new THREE.BoxGeometry(0.04, 0.62, 0.3);
    stone.merge(wing, at(new THREE.Matrix4().makeTranslation(s * 0.2, 1.22, -0.18).multiply(new THREE.Matrix4().makeRotationY(s * 0.5)).multiply(rotZ(s * -0.25))));
  }
}

function ambulance(L: LevelGeometry, x0: number, y0: number, x1: number, y1: number): void {
  const w = x1 - x0;
  const d = y1 - y0;
  const alongX = w >= d;
  const len = (alongX ? w : d) - 0.2;
  const wid = (alongX ? d : w) - 0.6;
  const cx = (x0 + x1) / 2;
  const cz = (y0 + y1) / 2;
  const R = new THREE.Matrix4().makeTranslation(cx, 0, cz).multiply(new THREE.Matrix4().makeRotationY(alongX ? 0 : Math.PI / 2));
  const at = (tx: number, ty: number, tz: number) => R.clone().multiply(new THREE.Matrix4().makeTranslation(tx, ty, tz));
  const body = L.builder('metal:ambulance', cx, cz);
  const dark = L.builder('black', cx, cz);
  const glass = L.builder('glass:dark', cx, cz);
  const red = L.builder('metal:red', cx, cz);
  const boxLen = len * 0.68;
  body.merge(new THREE.BoxGeometry(boxLen, 1.15, wid), at(-len / 2 + boxLen / 2, 0.85, 0));
  body.merge(new THREE.BoxGeometry(len - boxLen, 0.62, wid * 0.96), at(len / 2 - (len - boxLen) / 2, 0.62, 0));
  body.merge(new THREE.BoxGeometry((len - boxLen) * 0.7, 0.4, wid * 0.94), at(len / 2 - (len - boxLen) * 0.6, 1.1, 0));
  glass.merge(new THREE.BoxGeometry(0.02, 0.32, wid * 0.86), at(len / 2 - (len - boxLen) * 0.25, 1.08, 0));
  red.merge(new THREE.BoxGeometry(boxLen + 0.01, 0.12, wid + 0.01), at(-len / 2 + boxLen / 2, 0.85, 0));
  red.merge(new THREE.BoxGeometry(0.3, 0.06, 0.5), at(-len / 2 + boxLen - 0.2, 1.45, 0));
  for (const s of [-1, 1]) {
    for (const l of [-len / 2 + 0.45, len / 2 - 0.4]) dark.merge(cyl(0.2, 0.14, 16), at(l, 0.2, s * (wid / 2 - 0.05)).multiply(rotX(Math.PI / 2)));
  }
  dark.merge(new THREE.BoxGeometry(len, 0.18, wid * 0.9), at(0, 0.27, 0));
}

function boiler(L: LevelGeometry, x0: number, y0: number, x1: number, y1: number): void {
  const cx = (x0 + x1) / 2;
  const cz = (y0 + y1) / 2;
  const rust = L.builder('rust', cx, cz);
  const metal = L.builder('metal:grey', cx, cz);
  const steel = L.builder('steel', cx, cz);
  const r = Math.min(x1 - x0, y1 - y0) * 0.36;
  metal.merge(cyl(r, 1.35, 24), new THREE.Matrix4().makeTranslation(cx, 0.72, cz));
  rust.merge(cyl(r + 0.02, 0.06, 24), new THREE.Matrix4().makeTranslation(cx, 1.4, cz));
  rust.merge(cyl(r + 0.03, 0.06, 24), new THREE.Matrix4().makeTranslation(cx, 0.05, cz));
  // pipes up into the ceiling and across
  for (const [ox, oz] of [
    [0.25, 0.1],
    [-0.2, -0.25],
  ] as const) {
    rust.merge(cyl(0.05, WALL_H - 1.2, 10), new THREE.Matrix4().makeTranslation(cx + ox, (WALL_H + 1.2) / 2, cz + oz));
  }
  rust.merge(cyl(0.05, x1 - x0, 10), new THREE.Matrix4().makeTranslation(cx, WALL_H - 0.12, cz + 0.1).multiply(rotZ(Math.PI / 2)));
  // gauges and a valve wheel
  steel.merge(cyl(0.07, 0.04, 16), new THREE.Matrix4().makeTranslation(cx, 1.05, cz + r).multiply(rotX(Math.PI / 2)));
  steel.merge(new THREE.TorusGeometry(0.1, 0.012, 6, 18), new THREE.Matrix4().makeTranslation(cx + r * 0.7, 0.8, cz + r * 0.75));
}

function autopsyTable(L: LevelGeometry, x0: number, y0: number, x1: number, y1: number): void {
  const cx = (x0 + x1) / 2;
  const cz = (y0 + y1) / 2;
  const steel = L.builder('steel', cx, cz);
  const sheet = L.builder('fabric:sheet', cx, cz);
  steel.merge(cyl(0.12, 0.7, 16, 0.08), new THREE.Matrix4().makeTranslation(cx, 0.35, cz));
  steel.box([cx - 0.36, 0.7, cz - 0.95], [cx + 0.36, 0.78, cz + 0.95], 1);
  steel.box([cx - 0.36, 0.78, cz - 0.95], [cx - 0.33, 0.83, cz + 0.95], 1);
  steel.box([cx + 0.33, 0.78, cz - 0.95], [cx + 0.36, 0.83, cz + 0.95], 1);
  // something under the sheet
  const body = new THREE.CapsuleGeometry(0.17, 1.15, 6, 14);
  sheet.merge(body, new THREE.Matrix4().makeTranslation(cx, 0.9, cz).multiply(rotX(Math.PI / 2)).multiply(new THREE.Matrix4().makeScale(1, 1, 0.6)));
  sheet.merge(new THREE.SphereGeometry(0.13, 14, 10), new THREE.Matrix4().makeTranslation(cx, 0.92, cz - 0.78).multiply(new THREE.Matrix4().makeScale(1, 0.75, 1.1)));
  // instrument tray
  steel.merge(cyl(0.015, 0.85, 8), new THREE.Matrix4().makeTranslation(cx + 0.62, 0.42, cz + 0.55));
  steel.box([cx + 0.45, 0.85, cz + 0.42], [cx + 0.8, 0.87, cz + 0.7], 1);
}

function securityDesk(L: LevelGeometry, g: number): void {
  const [x, y] = cellBox(L.level, g);
  const cx = x + 0.5;
  const cz = y + 0.5;
  const wood = L.builder('wood', cx, cz);
  const plastic = L.builder('plastic:beige', cx, cz);
  const dark = L.builder('black', cx, cz);
  wood.box([cx - 0.45, 0.62, cz - 0.38], [cx + 0.45, 0.66, cz + 0.38], 1);
  for (const sx of [-0.42, 0.42]) wood.box([cx + sx - 0.03, 0, cz - 0.36], [cx + sx + 0.03, 0.62, cz + 0.36], 1);
  // a CRT monitor
  plastic.box([cx - 0.2, 0.66, cz - 0.22], [cx + 0.2, 1.0, cz + 0.16], 1);
  dark.box([cx - 0.16, 0.7, cz + 0.16], [cx + 0.16, 0.96, cz + 0.165], 1);
  plastic.box([cx - 0.24, 0.66, cz + 0.2], [cx + 0.24, 0.68, cz + 0.33], 1);
}

function filingCabinet(L: LevelGeometry, g: number): void {
  const [x, y] = cellBox(L.level, g);
  const cx = x + 0.5;
  const cz = y + 0.5;
  const metal = L.builder('metal:grey', cx, cz);
  const steel = L.builder('steel', cx, cz);
  metal.box([cx - 0.28, 0, cz - 0.32], [cx + 0.28, 1.25, cz + 0.32], 1);
  for (let i = 0; i < 4; i++) {
    const yy = 0.12 + i * 0.3;
    steel.box([cx - 0.08, yy + 0.12, cz + 0.32], [cx + 0.08, yy + 0.15, cz + 0.35], 1);
  }
}

function waitingChairs(L: LevelGeometry, x0: number, y0: number, x1: number, y1: number): void {
  const alongX = x1 - x0 >= y1 - y0;
  const n = Math.round((alongX ? x1 - x0 : y1 - y0) * 2);
  const cx = (x0 + x1) / 2;
  const cz = (y0 + y1) / 2;
  const plastic = L.builder('plastic:orange', cx, cz);
  const steel = L.builder('steel', cx, cz);
  const len = alongX ? x1 - x0 : y1 - y0;
  for (let i = 0; i < n; i++) {
    const t = -len / 2 + (i + 0.5) * (len / n);
    const px = alongX ? cx + t : cx;
    const pz = alongX ? cz : cz + t;
    const rot = alongX ? 0 : Math.PI / 2;
    const R = new THREE.Matrix4().makeTranslation(px, 0, pz).multiply(new THREE.Matrix4().makeRotationY(rot));
    plastic.merge(new THREE.BoxGeometry(0.42, 0.05, 0.4), R.clone().multiply(new THREE.Matrix4().makeTranslation(0, 0.4, 0)));
    plastic.merge(new THREE.BoxGeometry(0.42, 0.42, 0.04), R.clone().multiply(new THREE.Matrix4().makeTranslation(0, 0.64, -0.2).multiply(rotX(-0.12))));
  }
  const p = alongX ? [cx - len / 2 + 0.1, cx + len / 2 - 0.1] : [cz - len / 2 + 0.1, cz + len / 2 - 0.1];
  for (const v of p) steel.merge(cyl(0.025, 0.38, 8), new THREE.Matrix4().makeTranslation(alongX ? v : cx, 0.19, alongX ? cz : v));
  if (alongX) steel.box([cx - len / 2 + 0.05, 0.34, cz - 0.04], [cx + len / 2 - 0.05, 0.38, cz + 0.04], 1);
  else steel.box([cx - 0.04, 0.34, cz - len / 2 + 0.05], [cx + 0.04, 0.38, cz + len / 2 - 0.05], 1);
}

function shelving(L: LevelGeometry, g: number): void {
  const [x, y] = cellBox(L.level, g);
  const cx = x + 0.5;
  const cz = y + 0.5;
  const metal = L.builder('metal:grey', cx, cz);
  const box = L.builder('cardboard', cx, cz);
  for (const [sx, sz] of [
    [-0.4, -0.3],
    [0.4, -0.3],
    [-0.4, 0.3],
    [0.4, 0.3],
  ] as const)
    metal.box([cx + sx - 0.02, 0, cz + sz - 0.02], [cx + sx + 0.02, 1.5, cz + sz + 0.02], 1);
  for (let i = 0; i < 4; i++) {
    const yy = 0.15 + i * 0.42;
    metal.box([cx - 0.42, yy, cz - 0.32], [cx + 0.42, yy + 0.025, cz + 0.32], 1);
    const k = hash(g * 13 + i);
    if (k < 0.75) box.box([cx - 0.3 + k * 0.2, yy + 0.025, cz - 0.2], [cx + 0.05 + k * 0.2, yy + 0.25 + k * 0.08, cz + 0.22], 1);
  }
}

// =========================================================================== signs

const ZONE_SIGNS: Record<string, { text: string; sub?: string }> = {
  n: { text: 'NO ENTRY' },
  o: { text: 'Old Wing', sub: 'Sealed by order' },
  u: { text: 'Surgery', sub: 'Theatres 1–3' },
  h: { text: 'Main Hall' },
  s: { text: 'Security & Records' },
  r: { text: 'Reception' },
  w: { text: 'West Ward', sub: 'Beds 1–24' },
  e: { text: 'East Ward', sub: 'Beds 25–48' },
  c: { text: 'Chapel Garden' },
  a: { text: 'Ambulance Bay' },
  m: { text: 'Maintenance', sub: 'Staff only' },
  g: { text: 'Mortuary', sub: 'Authorised staff' },
};

function signage(L: LevelGeometry, A: FurnitureAnchors): void {
  const level = L.level;
  let seed = 1;
  for (const d of level.doors) {
    const [s0, s1] = d.sides;
    const z0 = L.zoneKey(s0);
    const z1 = L.zoneKey(s1);
    const x = d.cell % level.w;
    const y = Math.floor(d.cell / level.w);
    for (const [from, to, toZone] of [
      [s0, s1, z1],
      [s1, s0, z0],
    ] as const) {
      const fz = L.zoneKey(from);
      const dx = (from % level.w) - x;
      const dy = Math.floor(from / level.w) - y;
      const f = new Frame(x + 0.5 + dx * 0.5, y + 0.5 + dy * 0.5, [dx, 0, dy]);
      if (fz !== toZone && ZONE_SIGNS[toZone]) {
        A.signs.push({ frame: f, text: ZONE_SIGNS[toZone]!.text, sub: ZONE_SIGNS[toZone]!.sub, y: DOOR_H + 0.2, seed: seed++ });
      } else if (hash(d.cell * 3 + from) < 0.18 && !L.isExterior(from)) {
        A.exits.push({ frame: f, y: DOOR_H + 0.17 });
      }
      void to;
    }
  }
  // posters on long interior walls
  let idx = 0;
  for (let c = 0; c < level.w * level.h; c++) {
    if (level.tiles[c] !== Tile.Wall) continue;
    const x = c % level.w;
    const y = Math.floor(c / level.w);
    for (const d of DIRS) {
      const nx = x + d.dx;
      const ny = y + d.dy;
      if (nx < 0 || ny < 0 || nx >= level.w || ny >= level.h) continue;
      const n = ny * level.w + nx;
      if (level.tiles[n] !== Tile.Floor || L.isExterior(n)) continue;
      const zk = L.zoneKey(n);
      if (zk === 'n' || zk === 'm' || zk === 'g') continue;
      if (hash(c * 4 + d.dx * 2 + d.dy + 17) > 0.045) continue;
      A.posters.push({ frame: faceFrame(level, c, n), a: (hash(c) - 0.5) * 0.4, y: 0.78 + hash(c + 9) * 0.12, index: idx++ });
    }
  }
}

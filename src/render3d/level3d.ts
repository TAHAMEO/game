import * as THREE from 'three';
import { Tile, type Level } from '../core/level';
import { DEFAULT_LOOK, DOOR_H, WALL_H, ZONE_LOOK, type ZoneLook } from './constants';
import { ChunkedBuilders, GeoBuilder, type V3 } from './geo';
import type { MaterialKit } from './materials';

/** Exterior walls (the building's face, around the garden and the bay) stand taller. */
export const EXT_WALL_H = 3.6;

export const DIRS: ReadonlyArray<{ dx: number; dy: number; n: V3 }> = [
  { dx: 1, dy: 0, n: [1, 0, 0] },
  { dx: -1, dy: 0, n: [-1, 0, 0] },
  { dx: 0, dy: 1, n: [0, 0, 1] },
  { dx: 0, dy: -1, n: [0, 0, -1] },
];

export const isOpenTile = (t: number): boolean => t === Tile.Floor || t === Tile.Bed || t === Tile.Door;

/** Faces the furniture builder takes over (lockers, drawers, windows, gates fill the whole face). */
export interface FaceClaim {
  cell: number;
  /** Open cell the face looks into. */
  into: number;
  /** Cover only up to this height; plain wall above it. */
  upTo: number;
}

export class LevelGeometry {
  readonly group = new THREE.Group();
  readonly builders = new ChunkedBuilders(8);
  private readonly claims = new Map<string, number>();

  constructor(
    readonly level: Level,
    private readonly kit: MaterialKit,
  ) {
    this.group.name = 'level';
  }

  // -------------------------------------------------------------------- queries

  zoneKey(c: number): string {
    const lvl = this.level;
    const z = c >= 0 ? lvl.zoneOf[c]! : -1;
    if (z >= 0) return lvl.zones[z]!.key;
    const x = c % lvl.w;
    const y = Math.floor(c / lvl.w);
    for (const d of DIRS) {
      const nx = x + d.dx;
      const ny = y + d.dy;
      if (nx < 0 || ny < 0 || nx >= lvl.w || ny >= lvl.h) continue;
      const zz = lvl.zoneOf[ny * lvl.w + nx]!;
      if (zz >= 0) return lvl.zones[zz]!.key;
    }
    return 'h';
  }

  look(c: number): ZoneLook {
    return ZONE_LOOK[this.zoneKey(c)] ?? DEFAULT_LOOK;
  }

  isExterior(c: number): boolean {
    const z = this.level.zoneOf[c]!;
    return z >= 0 && this.level.zones[z]!.exterior;
  }

  wallHeightFacing(open: number): number {
    return this.isExterior(open) ? EXT_WALL_H : WALL_H;
  }

  /** Let a model own a wall face (no plain wall there, or only above `upTo`). */
  claim(cell: number, into: number, upTo = WALL_H + 10): void {
    this.claims.set(`${cell}>${into}`, upTo);
  }

  builder(material: string, x: number, z: number): GeoBuilder {
    return this.builders.get(material, x, z);
  }

  // -------------------------------------------------------------------- build

  build(): void {
    const lvl = this.level;
    const { w, h, tiles } = lvl;
    for (let c = 0; c < w * h; c++) {
      const x = c % w;
      const y = Math.floor(c / w);
      const t = tiles[c]!;
      if (isOpenTile(t)) {
        this.floorAndCeiling(c, x, y);
        continue;
      }
      if (t === Tile.Cabinet) continue;
      for (const d of DIRS) {
        const nx = x + d.dx;
        const ny = y + d.dy;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const n = ny * w + nx;
        if (!isOpenTile(tiles[n]!)) continue;
        this.wallFace(c, n, x, y, d);
      }
    }
    for (const d of lvl.doors) this.doorway(d.cell, d.axis, d.sides);
  }

  private floorAndCeiling(c: number, x: number, y: number): void {
    const look = this.look(c);
    const zk = this.zoneKey(c);
    this.builder(`floor:${zk}`, x, y).flat(x, y, x + 1, y + 1, 0, true, 2);
    if (look.ceil && this.level.tiles[c] !== Tile.Door) this.builder(`ceil:${zk}`, x, y).flat(x, y, x + 1, y + 1, WALL_H, false, 2);
  }

  private wallFace(s: number, n: number, x: number, y: number, d: { dx: number; dy: number; n: V3 }): void {
    const lvl = this.level;
    const intoDoor = lvl.tiles[n] === Tile.Door;
    const fcx = x + 0.5 + d.dx * 0.5;
    const fcz = y + 0.5 + d.dy * 0.5;
    const zk = this.zoneKey(n);
    const top = intoDoor ? DOOR_H : this.wallHeightFacing(n);
    const claim = this.claims.get(`${s}>${n}`);
    const from = claim !== undefined ? Math.min(top, claim) : 0;
    if (from < top) this.builder(`wall:${zk}`, fcx, fcz).wall(fcx, fcz, d.n, 1, from, top, 2);
    if (intoDoor || this.isExterior(n)) return;
    // Baseboard: a dark vinyl cove along the foot of every interior wall.
    if (claim === undefined || claim > 0.2) this.baseboard(fcx, fcz, d.n);
    const r = lvl.regionOf[n]!;
    if (r >= 0 && lvl.regions[r]!.kind === 'corridor' && claim === undefined) this.handrail(fcx, fcz, d.n);
  }

  private baseboard(cx: number, cz: number, n: V3): void {
    const b = this.builder('trim', cx, cz);
    const off = 0.012;
    const px = cx + n[0] * off;
    const pz = cz + n[2] * off;
    b.wall(px, pz, n, 1, 0, 0.075, 1);
    // top lip
    const r: V3 = [-n[2], 0, n[0]];
    const x0 = cx - r[0] * 0.5;
    const z0 = cz - r[2] * 0.5;
    const x1 = cx + r[0] * 0.5 + n[0] * off;
    const z1 = cz + r[2] * 0.5 + n[2] * off;
    b.flat(Math.min(x0, x1), Math.min(z0, z1), Math.max(x0, x1), Math.max(z0, z1), 0.075, true, 1);
  }

  private handrail(cx: number, cz: number, n: V3): void {
    const r: V3 = [-n[2], 0, n[0]];
    const rail = this.builder('rail', cx, cz);
    const y = 0.56;
    const off = 0.07;
    const half = 0.5;
    const ax = cx + n[0] * off;
    const az = cz + n[2] * off;
    const min: V3 = [Math.min(ax - r[0] * half, ax + r[0] * half) - Math.abs(n[0]) * 0.025, y - 0.025, Math.min(az - r[2] * half, az + r[2] * half) - Math.abs(n[2]) * 0.025];
    const max: V3 = [Math.max(ax - r[0] * half, ax + r[0] * half) + Math.abs(n[0]) * 0.025, y + 0.025, Math.max(az - r[2] * half, az + r[2] * half) + Math.abs(n[2]) * 0.025];
    rail.box(min, max, 1);
    // a bracket into the wall
    const bx = cx + n[0] * 0.035;
    const bz = cz + n[2] * 0.035;
    this.builder('steel', cx, cz).box(
      [bx - 0.012 - Math.abs(n[0]) * 0.035, y - 0.06, bz - 0.012 - Math.abs(n[2]) * 0.035],
      [bx + 0.012 + Math.abs(n[0]) * 0.035, y - 0.02, bz + 0.012 + Math.abs(n[2]) * 0.035],
      1,
    );
  }

  /** Lintel over the opening, frames on both faces. */
  private doorway(cell: number, axis: 'x' | 'y', sides: [number, number]): void {
    const lvl = this.level;
    const x = cell % lvl.w;
    const y = Math.floor(cell / lvl.w);
    const zk = this.zoneKey(cell);
    // soffit
    this.builder(`wall:${zk}`, x + 0.5, y + 0.5).flat(x, y, x + 1, y + 1, DOOR_H, false, 2);
    for (const side of sides) {
      const sx = side % lvl.w;
      const sy = Math.floor(side / lvl.w);
      const dx = sx - x;
      const dy = sy - y;
      const n: V3 = [dx, 0, dy];
      const fcx = x + 0.5 + dx * 0.5;
      const fcz = y + 0.5 + dy * 0.5;
      const top = this.wallHeightFacing(side);
      this.builder(`wall:${this.zoneKey(side)}`, fcx, fcz).wall(fcx, fcz, n, 1, DOOR_H, top, 2);
      this.doorFrame(fcx, fcz, n, axis);
    }
  }

  private doorFrame(cx: number, cz: number, n: V3, axis: 'x' | 'y'): void {
    void axis;
    const b = this.builder('frame', cx, cz);
    const r: V3 = [-n[2], 0, n[0]];
    const depth = 0.035;
    const post = 0.075;
    const px = (o: number): [number, number] => [cx + r[0] * o + n[0] * depth * 0.5, cz + r[2] * o + n[2] * depth * 0.5];
    const span = (c0: [number, number], wAlong: number, y0: number, y1: number) => {
      const hx = Math.abs(r[0]) * wAlong * 0.5 + Math.abs(n[0]) * depth * 0.5;
      const hz = Math.abs(r[2]) * wAlong * 0.5 + Math.abs(n[2]) * depth * 0.5;
      b.box([c0[0] - hx, y0, c0[1] - hz], [c0[0] + hx, y1, c0[1] + hz], 1);
    };
    span(px(-0.5 + post / 2), post, 0, DOOR_H + post);
    span(px(0.5 - post / 2), post, 0, DOOR_H + post);
    span(px(0), 1, DOOR_H, DOOR_H + post);
  }

  // -------------------------------------------------------------------- meshes

  /** Merge every bucket into meshes with the right materials. */
  finish(materialFor: (key: string) => THREE.Material): void {
    for (const [key, b] of this.builders.entries()) {
      if (b.empty) continue;
      const geo = b.build();
      const mesh = new THREE.Mesh(geo, materialFor(key));
      mesh.receiveShadow = true;
      mesh.castShadow = !key.startsWith('floor') && !key.startsWith('ceil');
      mesh.matrixAutoUpdate = false;
      mesh.name = key;
      this.group.add(mesh);
    }
    void this.kit;
  }
}

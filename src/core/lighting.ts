import { cellCenter, isStaticOpaque, losClear, Tile, type Level } from './level';
import type { Vec2 } from './math';
import type { Rng } from './rng';

export type FixtureKind = 'main' | 'emergency' | 'lamp';

export interface Fixture {
  id: number;
  cell: number;
  region: number;
  kind: FixtureKind;
  color: [number, number, number];
  intensity: number;
  radius: number;
  /** Broken by the Entity (light manipulation). Permanent for the run. */
  broken: boolean;
  /** 0..1 render-side instability. Rises with the debt [Z]. */
  flicker: number;
  cells: Int32Array;
  weights: Float32Array;
}

const FLUORESCENT: [number, number, number] = [0.9, 1.0, 0.94];
const EMERGENCY: [number, number, number] = [1.0, 0.16, 0.1];
const SODIUM: [number, number, number] = [1.0, 0.62, 0.28];
const MOON: [number, number, number] = [0.16, 0.2, 0.3];
const NEST_GLOW: [number, number, number] = [0.42, 0.62, 0.5];

/**
 * Per-cell light. Fixtures are generated from the map's regions, so the lighting is
 * a system the Entity can reason about (and break), not hand-placed set dressing.
 */
export class Lighting {
  readonly fixtures: Fixture[] = [];
  readonly r: Float32Array;
  readonly g: Float32Array;
  readonly b: Float32Array;
  readonly lum: Float32Array;
  readonly regionFixtures = new Map<number, Fixture[]>();
  powered = false;
  /** Bumped on every change so renderers / planners can cache. */
  version = 0;

  constructor(private readonly level: Level, rng: Rng) {
    const n = level.w * level.h;
    this.r = new Float32Array(n);
    this.g = new Float32Array(n);
    this.b = new Float32Array(n);
    this.lum = new Float32Array(n);
    this.generate(rng);
    this.recompute();
  }

  private generate(rng: Rng): void {
    const { level } = this;
    for (const region of level.regions) {
      const zone = level.zones[region.zone]!;
      if (zone.key === 'o') continue; // the old wing has been dark for years
      if (region.kind === 'nest') {
        // Something wet on the walls holds a little light. Enough to read the hoard by [W].
        this.add(region.center, region.id, 'emergency', NEST_GLOW, 0.95, 7, 0.15);
        continue;
      }
      const floor = region.cells.filter((c) => level.tiles[c] === Tile.Floor);
      if (floor.length === 0) continue;
      if (region.kind === 'exterior') {
        for (const c of farthestPoints(level, floor, region.center, 2)) this.add(c, region.id, 'lamp', SODIUM, 0.9, 7.5, 0);
        continue;
      }
      const area = floor.length;
      const k = region.kind === 'corridor' ? Math.max(1, Math.ceil(area / 2 / 6)) : Math.max(1, Math.round(area / 24));
      const radius = region.kind === 'corridor' ? 5 : Math.max(4.5, Math.sqrt(area) * 0.95);
      const spots = farthestPoints(level, floor, region.center, k);
      for (const c of spots) {
        const flicker = rng.chance(0.25) ? rng.range(0.2, 0.7) : 0;
        this.add(c, region.id, 'main', FLUORESCENT, 1.0, radius, flicker);
      }
      if (region.kind === 'corridor' || rng.chance(0.3)) {
        this.add(spots[0]!, region.id, 'emergency', EMERGENCY, 0.42, 4.2, rng.chance(0.3) ? 0.3 : 0);
      }
    }
  }

  private add(
    cell: number,
    region: number,
    kind: FixtureKind,
    color: [number, number, number],
    intensity: number,
    radius: number,
    flicker: number,
  ): void {
    const { level } = this;
    const origin = cellCenter(level, cell);
    const cells: number[] = [];
    const weights: number[] = [];
    const r = Math.ceil(radius);
    const ox = cell % level.w;
    const oy = Math.floor(cell / level.w);
    const blocks = (c: number) => isStaticOpaque(level.tiles[c]!);
    for (let y = oy - r; y <= oy + r; y++) {
      for (let x = ox - r; x <= ox + r; x++) {
        if (x < 0 || y < 0 || x >= level.w || y >= level.h) continue;
        const c = y * level.w + x;
        const d = Math.hypot(x - ox, y - oy);
        if (d > radius) continue;
        // Walls are lit from the cell in front of them, so only light open cells.
        if (isStaticOpaque(level.tiles[c]!)) continue;
        if (!losClear(level, origin, cellCenter(level, c), blocks)) continue;
        const wgt = Math.pow(1 - d / radius, 1.5);
        cells.push(c);
        weights.push(wgt);
      }
    }
    const f: Fixture = {
      id: this.fixtures.length,
      cell,
      region,
      kind,
      color,
      intensity,
      radius,
      broken: false,
      flicker,
      cells: Int32Array.from(cells),
      weights: Float32Array.from(weights),
    };
    this.fixtures.push(f);
    const list = this.regionFixtures.get(region) ?? [];
    list.push(f);
    this.regionFixtures.set(region, list);
  }

  isOn(f: Fixture): boolean {
    return !f.broken && (f.kind === 'emergency' || this.powered);
  }

  setPower(on: boolean): void {
    if (this.powered === on) return;
    this.powered = on;
    this.recompute();
  }

  /** The Entity kills a light [M, T: darkness funnels]. */
  kill(id: number): void {
    const f = this.fixtures[id];
    if (!f || f.broken) return;
    f.broken = true;
    this.recompute();
  }

  recompute(): void {
    const { level, r, g, b, lum } = this;
    r.fill(0);
    g.fill(0);
    b.fill(0);
    for (let c = 0; c < level.w * level.h; c++) {
      const z = level.zoneOf[c]!;
      if (z >= 0 && level.zones[z]!.exterior) {
        r[c] = MOON[0];
        g[c] = MOON[1];
        b[c] = MOON[2];
      }
    }
    for (const f of this.fixtures) {
      if (!this.isOn(f)) continue;
      for (let i = 0; i < f.cells.length; i++) {
        const c = f.cells[i]!;
        const wgt = f.weights[i]! * f.intensity;
        r[c] = r[c]! + f.color[0] * wgt;
        g[c] = g[c]! + f.color[1] * wgt;
        b[c] = b[c]! + f.color[2] * wgt;
      }
    }
    for (let c = 0; c < lum.length; c++) lum[c] = 0.3 * r[c]! + 0.59 * g[c]! + 0.11 * b[c]!;
    this.version++;
  }

  lumAt(cell: number): number {
    return cell >= 0 ? this.lum[cell]! : 0;
  }

  /** Bilinear luminance at a world position. */
  sample(p: Vec2): number {
    const { level, lum } = this;
    const fx = p.x - 0.5;
    const fy = p.y - 0.5;
    const x0 = Math.floor(fx);
    const y0 = Math.floor(fy);
    const tx = fx - x0;
    const ty = fy - y0;
    const at = (x: number, y: number) =>
      x < 0 || y < 0 || x >= level.w || y >= level.h ? 0 : lum[y * level.w + x]!;
    const a = at(x0, y0) * (1 - tx) + at(x0 + 1, y0) * tx;
    const c = at(x0, y0 + 1) * (1 - tx) + at(x0 + 1, y0 + 1) * tx;
    return a * (1 - ty) + c * ty;
  }

  fixturesInRegion(region: number): Fixture[] {
    return this.regionFixtures.get(region) ?? [];
  }
}

/** Farthest-point sampling: spread `k` fixtures across a region. */
function farthestPoints(level: Level, cells: number[], first: number, k: number): number[] {
  const start = cells.includes(first) ? first : cells[0]!;
  const chosen = [start];
  const w = level.w;
  while (chosen.length < k) {
    let best = -1;
    let bestD = -1;
    for (const c of cells) {
      let md = Infinity;
      for (const s of chosen) {
        const d = Math.hypot((c % w) - (s % w), Math.floor(c / w) - Math.floor(s / w));
        if (d < md) md = d;
      }
      if (md > bestD) {
        bestD = md;
        best = c;
      }
    }
    if (best < 0 || bestD < 3) break;
    chosen.push(best);
  }
  return chosen;
}

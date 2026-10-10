import * as THREE from 'three';

export type V3 = [number, number, number];

const UP: V3 = [0, 1, 0];

export const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const add = (a: V3, b: V3, k = 1): V3 => [a[0] + b[0] * k, a[1] + b[1] * k, a[2] + b[2] * k];
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

/**
 * Accumulates triangles for one merged mesh. Quads are wound counter-clockwise as seen
 * from the side their normal faces. UVs default to world space (`span` units per texture
 * repeat), so every surface built from the same material has the same texel density and
 * patterns line up across seams.
 */
export class GeoBuilder {
  readonly pos: number[] = [];
  readonly nor: number[] = [];
  readonly uv: number[] = [];
  readonly col: number[] = [];
  readonly idx: number[] = [];
  /** Optional per-vertex colour (for tinting merged pieces). */
  color: V3 | null = null;

  get empty(): boolean {
    return this.idx.length === 0;
  }

  private vert(p: V3, n: V3, u: number, v: number): number {
    const i = this.pos.length / 3;
    this.pos.push(p[0], p[1], p[2]);
    this.nor.push(n[0], n[1], n[2]);
    this.uv.push(u, v);
    const c = this.color ?? [1, 1, 1];
    this.col.push(c[0], c[1], c[2]);
    return i;
  }

  /** A quad from four corners (counter-clockwise from the front) with explicit uvs. */
  quad(p0: V3, p1: V3, p2: V3, p3: V3, n: V3, uv: [number, number, number, number, number, number, number, number]): void {
    const a = this.vert(p0, n, uv[0], uv[1]);
    const b = this.vert(p1, n, uv[2], uv[3]);
    const c = this.vert(p2, n, uv[4], uv[5]);
    const d = this.vert(p3, n, uv[6], uv[7]);
    this.idx.push(a, b, c, a, c, d);
  }

  /**
   * A vertical rectangle facing `n` (horizontal unit vector), centred on (cx, cz) at the
   * bottom edge, `w` wide, from y0 to y1. World-space uvs: u along the face, v = height.
   */
  wall(cx: number, cz: number, n: V3, w: number, y0: number, y1: number, span = 2, uOff = 0, vOff = 0): void {
    const r = cross(UP, n);
    const o: V3 = [cx - r[0] * (w / 2), y0, cz - r[2] * (w / 2)];
    const p0 = o;
    const p1 = add(o, r, w);
    const p2: V3 = [p1[0], y1, p1[2]];
    const p3: V3 = [p0[0], y1, p0[2]];
    const u0 = dot(p0, r) / span + uOff;
    const u1 = dot(p1, r) / span + uOff;
    this.quad(p0, p1, p2, p3, n, [u0, y0 / span + vOff, u1, y0 / span + vOff, u1, y1 / span + vOff, u0, y1 / span + vOff]);
  }

  /** A horizontal rectangle at height y, facing up (or down). World uvs on x/z. */
  flat(x0: number, z0: number, x1: number, z1: number, y: number, up: boolean, span = 2): void {
    if (up) {
      this.quad([x0, y, z1], [x1, y, z1], [x1, y, z0], [x0, y, z0], [0, 1, 0], [x0 / span, -z1 / span, x1 / span, -z1 / span, x1 / span, -z0 / span, x0 / span, -z0 / span]);
    } else {
      this.quad([x0, y, z0], [x1, y, z0], [x1, y, z1], [x0, y, z1], [0, -1, 0], [x0 / span, z0 / span, x1 / span, z0 / span, x1 / span, z1 / span, x0 / span, z1 / span]);
    }
  }

  /** Axis-aligned box, world-space uvs on every face. `skip` names faces to leave out. */
  box(min: V3, max: V3, span = 2, skip = ''): void {
    const [x0, y0, z0] = min;
    const [x1, y1, z1] = max;
    const w = x1 - x0;
    const d = z1 - z0;
    if (!skip.includes('+x')) this.wall(x1, (z0 + z1) / 2, [1, 0, 0], d, y0, y1, span);
    if (!skip.includes('-x')) this.wall(x0, (z0 + z1) / 2, [-1, 0, 0], d, y0, y1, span);
    if (!skip.includes('+z')) this.wall((x0 + x1) / 2, z1, [0, 0, 1], w, y0, y1, span);
    if (!skip.includes('-z')) this.wall((x0 + x1) / 2, z0, [0, 0, -1], w, y0, y1, span);
    if (!skip.includes('+y')) this.flat(x0, z0, x1, z1, y1, true, span);
    if (!skip.includes('-y')) this.flat(x0, z0, x1, z1, y0, false, span);
  }

  /** Append any geometry, transformed. */
  merge(geo: THREE.BufferGeometry, m: THREE.Matrix4): void {
    const g = geo.index ? geo.toNonIndexed() : geo;
    const p = g.getAttribute('position');
    const n = g.getAttribute('normal');
    const t = g.getAttribute('uv');
    const nm = new THREE.Matrix3().getNormalMatrix(m);
    const v = new THREE.Vector3();
    const base = this.pos.length / 3;
    const c = this.color ?? [1, 1, 1];
    for (let i = 0; i < p.count; i++) {
      v.fromBufferAttribute(p, i).applyMatrix4(m);
      this.pos.push(v.x, v.y, v.z);
      v.fromBufferAttribute(n, i).applyMatrix3(nm).normalize();
      this.nor.push(v.x, v.y, v.z);
      this.uv.push(t ? t.getX(i) : 0, t ? t.getY(i) : 0);
      this.col.push(c[0], c[1], c[2]);
      this.idx.push(base + i);
    }
    if (g !== geo) g.dispose();
  }

  build(withColor = false): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    if (withColor) g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setIndex(this.idx);
    g.computeBoundingSphere();
    g.computeBoundingBox();
    return g;
  }
}

/** Buckets of builders keyed by material and spatial chunk, so merged meshes still cull. */
export class ChunkedBuilders {
  private readonly map = new Map<string, GeoBuilder>();

  constructor(private readonly chunk = 8) {}

  get(material: string, x: number, z: number): GeoBuilder {
    const key = `${material}|${Math.floor(x / this.chunk)},${Math.floor(z / this.chunk)}`;
    let b = this.map.get(key);
    if (!b) {
      b = new GeoBuilder();
      this.map.set(key, b);
    }
    return b;
  }

  *entries(): Generator<[string, GeoBuilder]> {
    for (const [k, b] of this.map) yield [k.split('|')[0]!, b];
  }
}

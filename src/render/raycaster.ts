import { BEAM_HALF, VIEW_FOV } from '../core/director/perception';
import type { Pose } from '../core/entity';
import { cellCenter, Tile } from '../core/level';
import { angleDiff, angleTo, dist } from '../core/math';
import type { Sim } from '../core/sim';
import type { Survivor } from '../core/survivors';
import { World } from '../core/world';
import { buildEntityFrames, buildItemSprites, buildSurvivorFrames, type EntityFrame } from './sprites';
import { buildTextures, ZONE_MATERIALS, type Tex } from './textures';

interface SpriteDraw {
  x: number;
  y: number;
  tex: Tex;
  /** World height in wall units. */
  height: number;
  /** Lift off the floor in wall units. */
  lift: number;
  alpha: boolean;
  depth: number;
  /** Override light (fog uses its own). */
  glow?: number;
}

const AMBIENT = 0.018;
const TORCH = [1.0, 0.92, 0.78] as const;

/**
 * Software raycaster drawing into a small framebuffer that the page scales up.
 * Lo-fi on purpose: a 400×225 image with per-pixel light is cheap and reads as dread.
 */
export class Renderer {
  readonly W: number;
  readonly H: number;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly img: ImageData;
  private readonly buf: Uint32Array;
  private readonly zbuf: Float32Array;
  private readonly wallTex: Tex[] = [];
  private readonly wallIdx = new Map<string, number>();
  private readonly floorTex: Tex[] = [];
  private readonly ceilTex: Tex[] = [];
  private readonly entityFrames: Record<EntityFrame, Tex>;
  private readonly items: Record<string, Tex>;
  private survivorFrames = new Map<number, ReturnType<typeof buildSurvivorFrames>>();
  private sim: Sim | null = null;
  private cellWall = new Int16Array(0);
  private cellFloor = new Int16Array(0);
  private cellCeil = new Int16Array(0);
  private lr = new Float32Array(0);
  private lg = new Float32Array(0);
  private lb = new Float32Array(0);
  private readonly coneLut = new Float32Array(256);
  private readonly spillLut = new Float32Array(256);
  private readonly handprint: Uint8Array;
  private grain = 0;

  constructor(canvas: HTMLCanvasElement, W = 400, H = 225) {
    this.W = W;
    this.H = H;
    canvas.width = W;
    canvas.height = H;
    this.ctx = canvas.getContext('2d', { alpha: false, willReadFrequently: true })!;
    this.img = this.ctx.createImageData(W, H);
    this.buf = new Uint32Array(this.img.data.buffer);
    this.zbuf = new Float32Array(W);
    const t = buildTextures();
    for (const [name, tex] of Object.entries(t.walls)) {
      this.wallIdx.set(name, this.wallTex.length);
      this.wallTex.push(tex);
    }
    this.floorTex.push(...Object.values(t.floors));
    this.ceilTex.push(...Object.values(t.ceilings));
    this.floorNames = Object.keys(t.floors);
    this.ceilNames = Object.keys(t.ceilings);
    this.entityFrames = buildEntityFrames();
    this.items = buildItemSprites();
    // r² LUT for the torch cone (index = r² / 0.6 * 255).
    for (let i = 0; i < 256; i++) {
      const r = Math.sqrt((i / 255) * 0.6);
      const k = Math.min(1, Math.max(0, (BEAM_HALF + 0.05 - r) / (BEAM_HALF - 0.02)));
      this.coneLut[i] = k * k * (3 - 2 * k);
      const s = Math.min(1, Math.max(0, (1.0 - r) / 0.65));
      this.spillLut[i] = s * s * 0.22;
    }
    this.handprint = makeHandprint();
  }

  private floorNames: string[];
  private ceilNames: string[];

  private bind(sim: Sim): void {
    this.sim = sim;
    const lvl = sim.level;
    const n = lvl.w * lvl.h;
    this.cellWall = new Int16Array(n);
    this.cellFloor = new Int16Array(n);
    this.cellCeil = new Int16Array(n);
    for (let c = 0; c < n; c++) {
      const z = lvl.zoneOf[c]!;
      const key = z >= 0 ? lvl.zones[z]!.key : 'h';
      const mat = ZONE_MATERIALS[key] ?? ZONE_MATERIALS.h!;
      this.cellWall[c] = this.wallIdx.get(mat.wall) ?? 0;
      this.cellFloor[c] = Math.max(0, this.floorNames.indexOf(mat.floor));
      this.cellCeil[c] = Math.max(0, this.ceilNames.indexOf(mat.ceil));
    }
    this.lr = new Float32Array(n);
    this.lg = new Float32Array(n);
    this.lb = new Float32Array(n);
    this.survivorFrames.clear();
    for (const sv of sim.survivors.list) this.survivorFrames.set(sv.id, buildSurvivorFrames(sv.def.color));
  }

  // ======================================================================= lighting

  /** Base light plus per-frame flicker. The debt makes everything less steady [Z]. */
  private updateLight(sim: Sim, t: number): void {
    const L = sim.world.lighting;
    this.lr.set(L.r);
    this.lg.set(L.g);
    this.lb.set(L.b);
    const floor = sim.director.floor;
    for (const f of L.fixtures) {
      if (!L.isOn(f)) continue;
      const level = f.flicker + floor * (f.kind === 'main' ? 0.45 : 0.25);
      if (level <= 0.02) continue;
      const n = hash(Math.floor(t * 9) * 0.37 + f.id * 13.17);
      let mul: number;
      if (n < level * 0.3) mul = 0.1 + n;
      else mul = 1 - level * 0.12 * (0.5 + 0.5 * Math.sin(t * 47 + f.id));
      if (mul >= 0.999) continue;
      const k = (1 - mul) * f.intensity;
      for (let i = 0; i < f.cells.length; i++) {
        const c = f.cells[i]!;
        const w = f.weights[i]! * k;
        this.lr[c] = this.lr[c]! - f.color[0] * w;
        this.lg[c] = this.lg[c]! - f.color[1] * w;
        this.lb[c] = this.lb[c]! - f.color[2] * w;
      }
    }
  }

  // ======================================================================= frame

  render(sim: Sim, t: number): void {
    if (this.sim !== sim) this.bind(sim);
    this.updateLight(sim, t);
    const { W, H, buf, zbuf } = this;
    const lvl = sim.level;
    const world = sim.world;
    const pl = sim.player;
    const lw = lvl.w;
    const lh = lvl.h;
    const tiles = lvl.tiles;
    const lr = this.lr;
    const lg = this.lg;
    const lb = this.lb;

    const px = pl.pos.x;
    const py = pl.pos.y;
    const dirX = Math.cos(pl.angle);
    const dirY = Math.sin(pl.angle);
    const tanHalf = Math.tan(VIEW_FOV / 2);
    const planeX = -dirY * tanHalf;
    const planeY = dirX * tanHalf;
    const hScale = W / (2 * tanHalf);
    const moving = pl.speed > 0.3 && !pl.hidden;
    const bob = moving ? Math.sin(pl.bob) * (pl.sprinting ? 2.4 : 1.4) : 0;
    const horizon = H / 2 + bob + (pl.hidden?.kind === 'bed' ? 10 : 0);
    const eye = pl.eye;

    // torch
    const fl = pl.flashlight;
    let torch = 0;
    if (fl.on) {
      torch = fl.battery < 0.25 ? 0.35 + fl.battery * 2.6 : 1;
      if (fl.battery < 0.2 && hash(Math.floor(t * 14)) < 0.18) torch *= 0.25;
    } else if (sim.time < fl.faultUntil) {
      // dying sputter during a fault [S]
      torch = hash(Math.floor(t * 20)) < 0.12 ? 0.6 : 0;
    }
    if (pl.hidden && pl.hidden.kind !== 'bed') torch *= 0.25; // the beam is mostly inside the locker

    const colAngle2 = new Float32Array(W);
    for (let x = 0; x < W; x++) {
      const camX = (2 * x) / W - 1;
      const a = Math.atan(camX * tanHalf);
      colAngle2[x] = a * a;
    }
    const rowAngle2 = new Float32Array(H);
    for (let y = 0; y < H; y++) {
      const a = Math.atan((y + 0.5 - horizon) / hScale);
      rowAngle2[y] = a * a;
    }
    const coneLut = this.coneLut;
    const spillLut = this.spillLut;
    const lut = (x: number, y: number) => {
      let i = ((colAngle2[x]! + rowAngle2[y]!) / 0.6) * 255;
      if (i > 255) i = 255;
      return i | 0;
    };

    // ---------------------------------------------------------------- floor & ceiling
    const rdlx = dirX - planeX;
    const rdly = dirY - planeY;
    const rdrx = dirX + planeX;
    const rdry = dirY + planeY;
    for (let y = 0; y < H; y++) {
      const floorRow = y + 0.5 > horizon;
      const dy = floorRow ? y + 0.5 - horizon : horizon - (y + 0.5);
      if (dy < 0.5) {
        for (let x = 0; x < W; x++) buf[y * W + x] = 0xff000000;
        continue;
      }
      const rowDist = ((floorRow ? eye : 1 - eye) * hScale) / dy;
      const stepX = (rowDist * (rdrx - rdlx)) / W;
      const stepY = (rowDist * (rdry - rdly)) / W;
      let fx = px + rowDist * rdlx;
      let fy = py + rowDist * rdly;
      const fall = torch > 0 ? (torch * 1.45) / (1 + 0.22 * rowDist * rowDist) : 0;
      const spillFall = torch > 0 ? torch / (1 + 0.3 * rowDist * rowDist) : 0;
      const texs = floorRow ? this.floorTex : this.ceilTex;
      const cellTex = floorRow ? this.cellFloor : this.cellCeil;
      let o = y * W;
      for (let x = 0; x < W; x++, o++, fx += stepX, fy += stepY) {
        const cx = fx | 0;
        const cy = fy | 0;
        if (fx < 0 || fy < 0 || cx >= lw || cy >= lh) {
          buf[o] = 0xff000000;
          continue;
        }
        const c = cy * lw + cx;
        const tex = texs[cellTex[c]!]!;
        const tx = ((fx - cx) * 64) & 63;
        const ty = ((fy - cy) * 64) & 63;
        const col = tex.data[ty * 64 + tx]!;
        // bilinear light
        const gx = fx - 0.5;
        const gy = fy - 0.5;
        let x0 = gx | 0;
        let y0 = gy | 0;
        if (gx < 0) x0 = -1;
        if (gy < 0) y0 = -1;
        const ax = gx - x0;
        const ay = gy - y0;
        const i00 = x0 >= 0 && y0 >= 0 && x0 < lw && y0 < lh ? y0 * lw + x0 : -1;
        const i10 = x0 + 1 >= 0 && y0 >= 0 && x0 + 1 < lw && y0 < lh ? y0 * lw + x0 + 1 : -1;
        const i01 = x0 >= 0 && y0 + 1 >= 0 && x0 < lw && y0 + 1 < lh ? (y0 + 1) * lw + x0 : -1;
        const i11 = x0 + 1 < lw && y0 + 1 < lh && x0 + 1 >= 0 && y0 + 1 >= 0 ? (y0 + 1) * lw + x0 + 1 : -1;
        const w00 = (1 - ax) * (1 - ay);
        const w10 = ax * (1 - ay);
        const w01 = (1 - ax) * ay;
        const w11 = ax * ay;
        let r = AMBIENT;
        let g = AMBIENT;
        let b = AMBIENT;
        if (i00 >= 0) {
          r += lr[i00]! * w00;
          g += lg[i00]! * w00;
          b += lb[i00]! * w00;
        }
        if (i10 >= 0) {
          r += lr[i10]! * w10;
          g += lg[i10]! * w10;
          b += lb[i10]! * w10;
        }
        if (i01 >= 0) {
          r += lr[i01]! * w01;
          g += lg[i01]! * w01;
          b += lb[i01]! * w01;
        }
        if (i11 >= 0) {
          r += lr[i11]! * w11;
          g += lg[i11]! * w11;
          b += lb[i11]! * w11;
        }
        if (torch > 0) {
          const li = lut(x, y);
          const f = coneLut[li]! * fall + spillLut[li]! * spillFall;
          r += TORCH[0] * f;
          g += TORCH[1] * f;
          b += TORCH[2] * f;
        }
        buf[o] = shade(col, r, g, b);
      }
    }

    // ---------------------------------------------------------------- walls
    const thermalHeat = this.thermalByCell(sim);
    for (let x = 0; x < W; x++) {
      const camX = (2 * x) / W - 1;
      const rdx = dirX + planeX * camX;
      const rdy = dirY + planeY * camX;
      let mapX = px | 0;
      let mapY = py | 0;
      const ddx = rdx === 0 ? 1e30 : Math.abs(1 / rdx);
      const ddy = rdy === 0 ? 1e30 : Math.abs(1 / rdy);
      let stepX: number;
      let stepY: number;
      let sdx: number;
      let sdy: number;
      if (rdx < 0) {
        stepX = -1;
        sdx = (px - mapX) * ddx;
      } else {
        stepX = 1;
        sdx = (mapX + 1 - px) * ddx;
      }
      if (rdy < 0) {
        stepY = -1;
        sdy = (py - mapY) * ddy;
      } else {
        stepY = 1;
        sdy = (mapY + 1 - py) * ddy;
      }
      let side = 0;
      let perp = 30;
      let texIdx = 0;
      let u = 0;
      let hitCell = -1;
      let frontCell = (py | 0) * lw + (px | 0);
      let hit = false;
      for (let guard = 0; guard < 96 && !hit; guard++) {
        if (sdx < sdy) {
          sdx += ddx;
          mapX += stepX;
          side = 0;
        } else {
          sdy += ddy;
          mapY += stepY;
          side = 1;
        }
        if (mapX < 0 || mapY < 0 || mapX >= lw || mapY >= lh) break;
        const c = mapY * lw + mapX;
        const t = tiles[c]!;
        if (t === Tile.Floor || t === Tile.Bed) {
          frontCell = c;
          continue;
        }
        if (t === Tile.Door) {
          const door = world.doorAt.get(c)!;
          // Thin sliding door in the middle of the cell (Wolfenstein-style).
          if (door.axis === 'x') {
            const tt = (mapX + 0.5 - px) / rdx;
            const yh = py + tt * rdy;
            const frac = yh - mapY;
            if (tt > 0 && frac >= 0 && frac < 1 && frac >= door.open) {
              hit = true;
              perp = tt;
              side = 0;
              u = frac - door.open;
              texIdx = this.wallIdx.get(door.locked ? 'doorLocked' : 'door')!;
              hitCell = c;
            }
          } else {
            const tt = (mapY + 0.5 - py) / rdy;
            const xh = px + tt * rdx;
            const frac = xh - mapX;
            if (tt > 0 && frac >= 0 && frac < 1 && frac >= door.open) {
              hit = true;
              perp = tt;
              side = 1;
              u = frac - door.open;
              texIdx = this.wallIdx.get(door.locked ? 'doorLocked' : 'door')!;
              hitCell = c;
            }
          }
          if (!hit) frontCell = c;
          continue;
        }
        hit = true;
        hitCell = c;
        perp = side === 0 ? sdx - ddx : sdy - ddy;
        let wx = side === 0 ? py + perp * rdy : px + perp * rdx;
        wx -= Math.floor(wx);
        u = wx;
        if ((side === 0 && rdx > 0) || (side === 1 && rdy < 0)) u = 1 - u;
        texIdx = this.wallTextureFor(sim, c, t, frontCell);
      }
      zbuf[x] = perp;
      if (!hit) continue;
      const tex = this.wallTex[texIdx]!;
      const lineH = hScale / Math.max(perp, 0.02);
      const top = horizon - (1 - eye) * lineH;
      const bottom = horizon + eye * lineH;
      const y0 = Math.max(0, Math.ceil(top));
      const y1 = Math.min(H - 1, Math.floor(bottom));
      const tx = Math.min(63, (u * 64) | 0);
      // light from the open cell in front of the face
      const hx = px + perp * rdx;
      const hy = py + perp * rdy;
      const nx = side === 0 ? -stepX : 0;
      const ny = side === 1 ? -stepY : 0;
      const L = this.sampleLight(hx + nx * 0.5, hy + ny * 0.5);
      const shadeSide = side === 1 ? 0.82 : 1;
      const fall = torch > 0 ? (torch * 1.45) / (1 + 0.22 * perp * perp) : 0;
      const spillFall = torch > 0 ? torch / (1 + 0.3 * perp * perp) : 0;
      const heat = thermalHeat.get(hitCell) ?? 0;
      const cold = heat > 0 && world.isCold(frontCell);
      const texStep = 64 / lineH;
      let texPos = (y0 - top) * texStep;
      for (let y = y0; y <= y1; y++, texPos += texStep) {
        const ty = Math.min(63, texPos | 0);
        let col = tex.data[ty * 64 + tx]!;
        if (cold && this.handprint[ty * 64 + tx]) col = frost(col, heat); // condensation handprint [V]
        let r = (AMBIENT + L[0]) * shadeSide;
        let g = (AMBIENT + L[1]) * shadeSide;
        let b = (AMBIENT + L[2]) * shadeSide;
        if (torch > 0) {
          const li = lut(x, y);
          const f = coneLut[li]! * fall + spillLut[li]! * spillFall;
          r += TORCH[0] * f;
          g += TORCH[1] * f;
          b += TORCH[2] * f;
        }
        buf[y * W + x] = shade(col, r, g, b);
      }
    }

    // ---------------------------------------------------------------- sprites
    const sprites = this.collectSprites(sim, t);
    const invDet = 1 / (planeX * dirY - dirX * planeY);
    for (const s of sprites) {
      const rx = s.x - px;
      const ry = s.y - py;
      s.depth = invDet * (-planeY * rx + planeX * ry);
    }
    sprites.sort((a, b) => b.depth - a.depth);
    for (const s of sprites) {
      const depth = s.depth;
      if (depth < 0.08) continue;
      const rx = s.x - px;
      const ry = s.y - py;
      const tX = invDet * (dirY * rx - dirX * ry);
      const screenX = (W / 2) * (1 + tX / depth);
      const pxPerUnit = hScale / depth;
      const hPx = s.height * pxPerUnit;
      const wPx = hPx * (s.tex.w / s.tex.h);
      const floorY = horizon + (eye - s.lift) * pxPerUnit;
      const topY = floorY - hPx;
      const x0 = Math.max(0, Math.ceil(screenX - wPx / 2));
      const x1 = Math.min(W - 1, Math.floor(screenX + wPx / 2));
      const y0 = Math.max(0, Math.ceil(topY));
      const y1 = Math.min(H - 1, Math.floor(floorY));
      if (x0 > x1 || y0 > y1) continue;
      const L = this.sampleLight(s.x, s.y);
      const fall = torch > 0 ? (torch * 1.45) / (1 + 0.22 * depth * depth) : 0;
      const spillFall = torch > 0 ? torch / (1 + 0.3 * depth * depth) : 0;
      const tw = s.tex.w;
      const th = s.tex.h;
      for (let x = x0; x <= x1; x++) {
        if (depth >= zbuf[x]!) continue;
        const tx = Math.min(tw - 1, (((x - (screenX - wPx / 2)) / wPx) * tw) | 0);
        for (let y = y0; y <= y1; y++) {
          const ty = Math.min(th - 1, (((y - topY) / hPx) * th) | 0);
          const col = s.tex.data[ty * tw + tx]!;
          const a = col >>> 24;
          if (a < 16) continue;
          let r = AMBIENT + L[0] + (s.glow ?? 0);
          let g = AMBIENT + L[1] + (s.glow ?? 0);
          let b = AMBIENT + L[2] + (s.glow ?? 0);
          if (torch > 0) {
            const li = lut(x, y);
            const f = coneLut[li]! * fall + spillLut[li]! * spillFall;
            r += TORCH[0] * f;
            g += TORCH[1] * f;
            b += TORCH[2] * f;
          }
          const o = y * W + x;
          if (s.alpha || a < 250) buf[o] = blend(buf[o]!, shade(col, r, g, b), a / 255);
          else buf[o] = shade(col, r, g, b);
        }
      }
    }

    this.post(sim, t, horizon);
    this.ctx.putImageData(this.img, 0, 0);
  }

  private thermalByCell(sim: Sim): Map<number, number> {
    const m = new Map<number, number>();
    if (!sim.features.thermalResidue) return m;
    for (const mark of sim.world.thermal) {
      const h = World.heatOf(mark, sim.time);
      if (h > 0.05) m.set(mark.cell, Math.max(m.get(mark.cell) ?? 0, h));
    }
    return m;
  }

  private sampleLight(x: number, y: number): [number, number, number] {
    const lvl = this.sim!.level;
    const lw = lvl.w;
    const lh = lvl.h;
    const gx = x - 0.5;
    const gy = y - 0.5;
    const x0 = Math.floor(gx);
    const y0 = Math.floor(gy);
    const ax = gx - x0;
    const ay = gy - y0;
    let r = 0;
    let g = 0;
    let b = 0;
    for (let k = 0; k < 4; k++) {
      const cx = x0 + (k & 1);
      const cy = y0 + (k >> 1);
      if (cx < 0 || cy < 0 || cx >= lw || cy >= lh) continue;
      const w = (k & 1 ? ax : 1 - ax) * (k >> 1 ? ay : 1 - ay);
      const c = cy * lw + cx;
      r += this.lr[c]! * w;
      g += this.lg[c]! * w;
      b += this.lb[c]! * w;
    }
    return [r, g, b];
  }

  private wallTextureFor(sim: Sim, cell: number, t: number, front: number): number {
    const idx = this.wallIdx;
    switch (t) {
      case Tile.Locker: {
        const spot = sim.world.spotAt.get(cell);
        return idx.get(spot?.ajar ? 'lockerAjar' : 'locker')!;
      }
      case Tile.Drawer:
        return idx.get('drawer')!;
      case Tile.Vent:
        return idx.get('vent')!;
      case Tile.Tap:
        return idx.get('tap')!;
      case Tile.FuseBox:
        return idx.get('fusebox')!;
      case Tile.Radio:
        return idx.get('radio')!;
      case Tile.Gate: {
        const g = sim.world.gateAt.get(cell);
        return idx.get(g?.open ? 'gateOpen' : 'gate')!;
      }
      case Tile.Window:
        return idx.get('window')!;
      case Tile.Cabinet: {
        const z = sim.level.zoneOf[front]!;
        const key = z >= 0 ? sim.level.zones[z]!.key : '';
        return idx.get(key === 'c' ? 'hedge' : key === 'a' ? 'vehicle' : key === 'm' ? 'machinery' : 'shelves')!;
      }
      default:
        return this.cellWall[front] ?? 0;
    }
  }

  // ======================================================================= sprites

  private collectSprites(sim: Sim, t: number): SpriteDraw[] {
    const out: SpriteDraw[] = [];
    const world = sim.world;
    const lvl = sim.level;
    const pl = sim.player;
    const add = (x: number, y: number, tex: Tex, height: number, lift = 0, alpha = false, glow?: number) => {
      const s: SpriteDraw = { x, y, tex, height, lift, alpha, depth: 0 };
      if (glow !== undefined) s.glow = glow;
      out.push(s);
    };
    for (const spot of world.spots) {
      if (spot.kind !== 'bed' || pl.hidden === spot) continue;
      const c = cellCenter(lvl, spot.cell);
      add(c.x, c.y, spot.cluttered ? this.items.bedJunk! : this.items.bed!, 0.42);
    }
    for (const it of world.items) {
      if (it.state !== 'ground') continue;
      add(it.pos.x, it.pos.y, this.items[it.kind]!, 0.22);
    }
    for (const p of world.projectiles) add(p.pos.x, p.pos.y, this.items.bottle!, 0.16, 0.45);
    for (const pr of world.props) {
      if (pr.kind === 'survivorBody') {
        const fr = this.framesForColor(pr.color ?? [120, 120, 120]);
        add(pr.pos.x, pr.pos.y, fr.body, 0.18);
      } else if (pr.kind === 'remains') add(pr.pos.x, pr.pos.y, this.items.remains!, 0.42);
      else if (pr.kind === 'sign') add(pr.pos.x, pr.pos.y, this.items.sign!, 0.5);
      else if (pr.kind === 'debris') add(pr.pos.x, pr.pos.y, this.items.debris!, 0.16);
      else add(pr.pos.x, pr.pos.y, this.items.trophy!, 0.24);
    }
    for (const sv of sim.survivors.list) {
      if (!sv.alive || sv.spot) continue;
      const fr = this.survivorFrames.get(sv.id)!;
      add(sv.pos.x, sv.pos.y, sv.waving ? fr.wave : fr.idle, 0.8);
    }
    // the Entity — or whoever it is wearing [X]
    const e = sim.entity;
    const camPos = pl.pos;
    const dCam = dist(e.pos, camPos);
    if (e.disguise !== null && dCam > 5.5) {
      const sv = sim.survivors.list[e.disguise]!;
      const fr = this.survivorFrames.get(sv.id) ?? this.framesFor(sv);
      add(e.pos.x, e.pos.y, e.pose === 'wave' ? fr.wave : fr.idle, 0.8);
    } else if (dCam > 0.15) {
      add(e.pos.x, e.pos.y, this.entityFrame(e.pose, e.angle, angleTo(e.pos, camPos), t), 1.02);
    }
    // perceptual noise: drawn with exactly the same art [S]
    for (const ph of sim.director.perception.phantoms) {
      const pose: Pose = ph.pose === 'walk' ? 'walk' : ph.pose === 'tilt' ? 'tilt' : 'idle';
      add(ph.pos.x, ph.pos.y, this.entityFrame(pose, ph.angle, angleTo(ph.pos, camPos), t), 1.02);
    }
    // breath fog [V]
    for (const f of world.fog) {
      const age = sim.time - f.t;
      const k = Math.max(0, 1 - age / 2.6);
      const rise = age * 0.06;
      add(f.pos.x, f.pos.y, this.items.fog!, 0.18 * f.size * (0.6 + age * 0.4), 0.38 + rise, true, 0.05 * k);
    }
    return out;
  }

  private framesFor(sv: Survivor) {
    const fr = buildSurvivorFrames(sv.def.color);
    this.survivorFrames.set(sv.id, fr);
    return fr;
  }

  private colorFrames = new Map<string, ReturnType<typeof buildSurvivorFrames>>();
  private framesForColor(c: [number, number, number]) {
    const k = c.join(',');
    let fr = this.colorFrames.get(k);
    if (!fr) {
      fr = buildSurvivorFrames(c);
      this.colorFrames.set(k, fr);
    }
    return fr;
  }

  private entityFrame(pose: Pose, facing: number, toCam: number, t: number): Tex {
    const F = this.entityFrames;
    const front = Math.abs(angleDiff(facing, toCam)) < Math.PI / 2;
    const step = Math.floor(t * 3.2) % 2 === 0;
    switch (pose) {
      case 'walk':
        return front ? (step ? F.walkA : F.walkB) : step ? F.backWalkA : F.backWalkB;
      case 'tilt':
        return front ? F.tilt : F.back;
      case 'inhale':
        return front ? F.inhale : F.back;
      case 'lunge':
        return F.lunge;
      case 'reach':
        return front ? F.reach : F.back;
      case 'crouch':
        return F.crouch;
      case 'feed':
        return F.feed;
      case 'turnaway':
        return front ? F.idle : F.back;
      case 'wave':
      case 'idle':
      default:
        return front ? F.idle : F.back;
    }
  }

  // ======================================================================= post

  private post(sim: Sim, t: number, horizon: number): void {
    const { W, H, buf } = this;
    const pl = sim.player;
    // Hiding views [J]
    const spot = pl.hidden;
    if (spot && (spot.kind === 'locker' || spot.kind === 'drawer')) {
      for (let y = 0; y < H; y++) {
        let open: boolean;
        if (spot.kind === 'drawer') open = Math.abs(y - horizon) < 7;
        else {
          const band = Math.floor((y - H * 0.18) / 13);
          open = y > H * 0.18 && y < H * 0.62 && (y - H * 0.18) % 13 < 5 && band >= 0;
        }
        if (open) continue;
        for (let x = 0; x < W; x++) {
          const o = y * W + x;
          buf[o] = darken(buf[o]!, 0.06);
        }
      }
    } else if (spot && spot.kind === 'bed') {
      const under = Math.floor(H * 0.4);
      for (let y = 0; y < under; y++) {
        for (let x = 0; x < W; x++) {
          const o = y * W + x;
          const spring = (x + y * 2) % 11 === 0 || y === under - 1;
          buf[o] = spring ? 0xff1a1a1c : 0xff060607;
        }
      }
    }
    if (pl.transition) {
      const k = pl.transition.t / pl.transition.dur;
      const dark = pl.transition.entering ? 1 - k * 0.7 : 0.3 + k * 0.7;
      for (let o = 0; o < buf.length; o++) buf[o] = darken(buf[o]!, dark);
    }
    // hurt flash
    const hurt = sim.time - pl.lastHurt;
    const red = hurt < 0.8 ? 1 - hurt / 0.8 : 0;
    // vignette + grain (constant: these are style, never a meter)
    this.grain = (this.grain + 1) & 1023;
    const cx = W / 2;
    const cy = H / 2;
    const maxD = cx * cx + cy * cy;
    let seed = (t * 1000) | 0;
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const o = y * W + x;
        const dx = x - cx;
        const dy = y - cy;
        const v = 1 - ((dx * dx + dy * dy) / maxD) * 0.55;
        seed = (seed * 1103515245 + 12345) & 0x7fffffff;
        const n = ((seed >> 16) & 15) - 7;
        let c = buf[o]!;
        let r = (c & 255) * v + n;
        let g = ((c >> 8) & 255) * v + n;
        let b = ((c >> 16) & 255) * v + n;
        if (red > 0) {
          r = r + (90 - r) * red * 0.5;
          g *= 1 - red * 0.6;
          b *= 1 - red * 0.6;
        }
        c = 0xff000000 | (clampByte(b) << 16) | (clampByte(g) << 8) | clampByte(r);
        buf[o] = c;
      }
    }
    if (!pl.alive) {
      for (let o = 0; o < buf.length; o++) buf[o] = darken(buf[o]!, 0.25);
    }
  }
}

function clampByte(v: number): number {
  return v < 0 ? 0 : v > 255 ? 255 : v | 0;
}

function shade(col: number, r: number, g: number, b: number): number {
  const cr = (col & 255) * r;
  const cg = ((col >> 8) & 255) * g;
  const cb = ((col >> 16) & 255) * b;
  return 0xff000000 | ((cb > 255 ? 255 : cb | 0) << 16) | ((cg > 255 ? 255 : cg | 0) << 8) | (cr > 255 ? 255 : cr | 0);
}

function blend(dst: number, src: number, a: number): number {
  const r = (dst & 255) * (1 - a) + (src & 255) * a;
  const g = ((dst >> 8) & 255) * (1 - a) + ((src >> 8) & 255) * a;
  const b = ((dst >> 16) & 255) * (1 - a) + ((src >> 16) & 255) * a;
  return 0xff000000 | ((b | 0) << 16) | ((g | 0) << 8) | (r | 0);
}

function darken(c: number, k: number): number {
  const r = (c & 255) * k;
  const g = ((c >> 8) & 255) * k;
  const b = ((c >> 16) & 255) * k;
  return 0xff000000 | ((b | 0) << 16) | ((g | 0) << 8) | (r | 0);
}

/** Pale condensation over a texel, stronger when fresher. */
function frost(c: number, heat: number): number {
  const k = Math.min(0.65, heat * 0.7);
  const r = (c & 255) * (1 - k) + 225 * k;
  const g = ((c >> 8) & 255) * (1 - k) + 232 * k;
  const b = ((c >> 16) & 255) * (1 - k) + 238 * k;
  return 0xff000000 | ((b | 0) << 16) | ((g | 0) << 8) | (r | 0);
}

function hash(x: number): number {
  const s = Math.sin(x * 127.1 + 311.7) * 43758.5453;
  return s - Math.floor(s);
}

/** A palm and four fingers at hand height, as a 64×64 mask. */
function makeHandprint(): Uint8Array {
  const m = new Uint8Array(64 * 64);
  const set = (x: number, y: number) => {
    if (x >= 0 && y >= 0 && x < 64 && y < 64) m[y * 64 + x] = 1;
  };
  const cx = 40;
  const cy = 34;
  for (let y = -4; y <= 4; y++) for (let x = -3; x <= 3; x++) if (x * x * 0.8 + y * y * 0.6 < 11) set(cx + x, cy + y);
  for (let f = 0; f < 4; f++) {
    const fx = cx - 3 + f * 2;
    for (let k = 0; k < 6 - Math.abs(f - 1.5); k++) set(fx, cy - 5 - k);
  }
  for (let k = 0; k < 4; k++) set(cx + 4 + k, cy - 1 - k);
  return m;
}

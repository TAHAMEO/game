import * as THREE from 'three';
import { cellCenter, type Level } from '../core/level';
import type { Sim } from '../core/sim';
import { World } from '../core/world';
import type { DoorState, HidingSpot, Item, Prop } from '../core/types';
import { animateHuman, buildHuman, type HumanModel } from './characters';
import { exitTexture, handprintTexture, posterTexture, signTexture, writingTexture } from './canvasTex';
import { DOOR_H } from './constants';
import { Frame, faceFrame, type FurnitureAnchors } from './furniture';
import type { MaterialKit } from './materials';
import type { Models } from './models';

const hash = (n: number) => {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return s - Math.floor(s);
};

interface DoorView {
  door: DoorState;
  slide: THREE.Group;
  /** Unit vector the panel slides along (world), and the closed position. */
  dir: THREE.Vector3;
  base: THREE.Vector3;
  chain: THREE.Object3D | null;
  barricade: THREE.Object3D;
  prints: THREE.Mesh[];
}

interface LockerView {
  spot: HidingSpot;
  hinge: THREE.Object3D;
  angle: number;
  prints: THREE.Mesh;
  body: THREE.Object3D | null;
}

interface DrawerView {
  spot: HidingSpot;
  slide: THREE.Object3D;
  frame: Frame;
  out: number;
  prints: THREE.Mesh;
}

/**
 * Everything in the world that moves or changes during a run: doors, locker doors,
 * drawers, what lies on the floor, what it kept, the breath that hangs in the cold, the
 * handprints that condense on cold metal, running water, the breaker, the radio, the gates.
 */
export class Objects3D {
  readonly group = new THREE.Group();
  private readonly runGroup = new THREE.Group();
  private doors: DoorView[] = [];
  private lockers: LockerView[] = [];
  private drawers: DrawerView[] = [];
  private bedJunk = new Map<number, THREE.Object3D>();
  private items = new Map<number, THREE.Object3D>();
  private props = new Map<number, THREE.Object3D>();
  private projectiles: THREE.Object3D[] = [];
  private fog: THREE.Sprite[] = [];
  private water = new Map<number, THREE.Mesh>();
  private fuses: THREE.Object3D[] = [];
  private lever: THREE.Object3D | null = null;
  private fuseLamp: THREE.Mesh | null = null;
  private radioLamp: THREE.Mesh | null = null;
  private gates = new Map<number, { left: THREE.Object3D; right: THREE.Object3D; chain: THREE.Object3D; angle: number }>();
  private readonly handTex = handprintTexture();
  private readonly fogTex: THREE.Texture;
  private readonly printMat: THREE.MeshBasicMaterial;
  private readonly bodies: HumanModel[] = [];
  private sim: Sim | null = null;

  constructor(
    private readonly level: Level,
    private readonly kit: MaterialKit,
    private readonly models: Models,
    private readonly anchors: FurnitureAnchors,
  ) {
    this.group.name = 'objects';
    this.group.add(this.runGroup);
    this.fogTex = softDot();
    this.printMat = new THREE.MeshBasicMaterial({ map: this.handTex, color: 0xdfe8f0, transparent: true, opacity: 0, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 });
    this.buildSigns();
    this.buildStaticFittings();
  }

  // ========================================================================== static, once

  private buildSigns(): void {
    for (const s of this.anchors.signs) {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(0.62, 0.155), this.kit.plain({ map: signTexture(s.text, { sub: s.sub, seed: s.seed }), roughness: 0.55 }, `sign:${s.text}:${s.seed}`));
      m.matrixAutoUpdate = false;
      m.matrix.copy(s.frame.matrix(0, s.y, 0.012));
      this.group.add(m);
    }
    const exitMat = new THREE.MeshBasicMaterial({ map: exitTexture(), color: new THREE.Color(1.6, 1.6, 1.6) });
    const exitBox = new THREE.BoxGeometry(0.3, 0.11, 0.05);
    for (const e of this.anchors.exits) {
      const m = new THREE.Mesh(exitBox, exitMat);
      m.matrixAutoUpdate = false;
      m.matrix.copy(e.frame.matrix(0, e.y, 0.03));
      this.group.add(m);
    }
    for (const p of this.anchors.posters) {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(0.3, 0.42), this.kit.plain({ map: posterTexture(p.index), roughness: 0.8, transparent: true, alphaTest: 0.5 }, `poster:${p.index}`));
      m.matrixAutoUpdate = false;
      m.matrix.copy(p.frame.matrix(p.a, p.y + 0.21, 0.004));
      m.receiveShadow = true;
      this.group.add(m);
    }
  }

  /** Fittings that move with the objectives: breaker lever and fuses, lamps, the gates. */
  private buildStaticFittings(): void {
    const A = this.anchors;
    const steel = this.kit.surface('steel');
    if (A.fuseBox) {
      const f = A.fuseBox;
      for (const a of [-0.13, 0, 0.13]) {
        const fu = this.models.fuse();
        fu.rotation.z = Math.PI / 2;
        const holder = new THREE.Object3D();
        holder.matrixAutoUpdate = false;
        holder.matrix.copy(f.matrix(a, 1.2, 0.07));
        holder.add(fu);
        fu.rotation.set(0, Math.PI / 2, 0);
        holder.visible = false;
        this.group.add(holder);
        this.fuses.push(holder);
      }
      const lever = new THREE.Object3D();
      lever.matrixAutoUpdate = false;
      lever.matrix.copy(f.matrix(0.15, 0.96, 0.06));
      const arm = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.16, 0.03).translate(0, 0.07, 0.02), this.kit.plain({ color: 0x7a1a14, roughness: 0.4 }, 'lever'));
      arm.castShadow = true;
      const pivot = new THREE.Object3D();
      pivot.add(arm);
      lever.add(pivot);
      this.group.add(lever);
      this.lever = pivot;
      this.fuseLamp = new THREE.Mesh(new THREE.SphereGeometry(0.014, 10, 8), new THREE.MeshBasicMaterial({ color: 0x220000 }));
      this.fuseLamp.matrixAutoUpdate = false;
      this.fuseLamp.matrix.copy(f.matrix(-0.18, 1.32, 0.03));
      this.group.add(this.fuseLamp);
    }
    if (A.radio) {
      this.radioLamp = new THREE.Mesh(new THREE.SphereGeometry(0.011, 10, 8), new THREE.MeshBasicMaterial({ color: 0x110800 }));
      this.radioLamp.matrixAutoUpdate = false;
      this.radioLamp.matrix.copy(A.radio.matrix(-0.15, 0.99, 0.3));
      this.group.add(this.radioLamp);
    }
    for (const [cell, f] of A.taps) {
      const water = new THREE.Mesh(new THREE.CylinderGeometry(0.005, 0.007, 0.13, 8), new THREE.MeshBasicMaterial({ color: 0x8aa0b4, transparent: true, opacity: 0.55 }));
      water.matrixAutoUpdate = false;
      water.matrix.copy(f.matrix(0, 0.925, 0.165));
      water.visible = false;
      this.group.add(water);
      this.water.set(cell, water);
    }
    const rust = this.kit.surface('rust');
    for (const [cell, f] of A.gates) {
      const leaf = (side: number) => {
        const hinge = new THREE.Object3D();
        hinge.matrixAutoUpdate = false;
        hinge.matrix.copy(f.matrix(side * 0.41, 0, -0.05));
        const swing = new THREE.Object3D();
        hinge.add(swing);
        const w = 0.41;
        const bars = new THREE.Group();
        for (let i = 0; i < 6; i++) {
          const b = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 1.66, 6), rust);
          b.position.set(-side * (0.04 + i * (w - 0.06) / 5), 0.85, 0);
          b.castShadow = true;
          bars.add(b);
        }
        for (const y of [0.1, 0.9, 1.65]) {
          const rail = new THREE.Mesh(new THREE.BoxGeometry(w, 0.03, 0.025), rust);
          rail.position.set((-side * w) / 2, y, 0);
          rail.castShadow = true;
          bars.add(rail);
        }
        swing.add(bars);
        this.group.add(hinge);
        return swing;
      };
      const left = leaf(-1);
      const right = leaf(1);
      const chain = new THREE.Object3D();
      chain.matrixAutoUpdate = false;
      chain.matrix.copy(f.matrix(0, 0.9, 0.0));
      for (let i = 0; i < 7; i++) {
        const link = new THREE.Mesh(new THREE.TorusGeometry(0.018, 0.005, 6, 10), steel);
        link.position.set(-0.06 + i * 0.02, Math.sin(i * 0.9) * 0.012, 0.01);
        link.rotation.y = i % 2 ? Math.PI / 2 : 0;
        chain.add(link);
      }
      const lock = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.06, 0.025), this.kit.plain({ color: 0x8a7a40, metalness: 1, roughness: 0.35 }, 'padlock'));
      lock.position.set(0.02, -0.05, 0.015);
      chain.add(lock);
      this.group.add(chain);
      this.gates.set(cell, { left, right, chain, angle: 0 });
    }
  }

  // ========================================================================== per run

  bind(sim: Sim): void {
    this.sim = sim;
    this.clearRun();
    for (const d of sim.world.doors) this.doors.push(this.makeDoor(d));
    for (const spot of sim.world.spots) {
      if (spot.kind === 'locker') this.lockers.push(this.makeLocker(spot));
      else if (spot.kind === 'drawer') this.drawers.push(this.makeDrawer(spot));
      else this.makeBedJunk(spot);
    }
    for (const w of sim.story.writings) this.makeWriting(sim, w);
  }

  private clearRun(): void {
    for (const c of [...this.runGroup.children]) this.runGroup.remove(c);
    this.doors = [];
    this.lockers = [];
    this.drawers = [];
    this.bedJunk.clear();
    this.items.clear();
    this.props.clear();
    this.projectiles = [];
    this.bodies.length = 0;
  }

  private doorLook(d: DoorState): { color: number; recipe: string } {
    const level = this.level;
    const zones = d.sides.map((s) => {
      const z = level.zoneOf[s]!;
      return z >= 0 ? level.zones[z]!.key : 'h';
    });
    if (d.lock === 'sealed' || zones.includes('o')) return { color: 0x5a4a38, recipe: 'wood' };
    if (zones.includes('g') || zones.includes('u')) return { color: 0xb8bcbe, recipe: 'steel' };
    if (zones.includes('m')) return { color: 0x3e5a4a, recipe: 'metal' };
    if (zones.includes('c') || zones.includes('a')) return { color: 0x4a4c50, recipe: 'metal' };
    return { color: 0x8aa2ac, recipe: 'metal' };
  }

  private makeDoor(d: DoorState): DoorView {
    const level = this.level;
    const c = cellCenter(level, d.cell);
    const x = d.cell % level.w;
    const y = Math.floor(d.cell / level.w);
    // which way it slides: into whichever jamb is solid
    const along: [number, number] = d.axis === 'x' ? [0, 1] : [1, 0];
    const solid = (dx: number, dy: number) => {
      const t = level.tiles[(y + dy) * level.w + (x + dx)];
      return t !== undefined && t !== 0 && t !== 2;
    };
    const sgn = solid(-along[0], -along[1]) ? -1 : 1;
    const dir = new THREE.Vector3(along[0] * sgn, 0, along[1] * sgn);
    const base = new THREE.Vector3(c.x, 0, c.y);
    const slide = new THREE.Group();
    slide.position.copy(base);
    if (d.axis === 'x') slide.rotation.y = Math.PI / 2;
    const look = this.doorLook(d);
    const mat = this.kit.surface(look.recipe, { color: look.color });
    const W = 0.9;
    const H = DOOR_H - 0.015;
    const panel = new THREE.Mesh(new THREE.BoxGeometry(W, H, 0.05), mat);
    panel.position.y = H / 2;
    panel.castShadow = true;
    panel.receiveShadow = true;
    slide.add(panel);
    const glassMat = this.kit.plain({ color: 0x0c0f12, roughness: 0.08, metalness: 0.3 }, 'door-glass');
    if (look.recipe !== 'wood') {
      for (const s of [-1, 1]) {
        const g = new THREE.Mesh(new THREE.PlaneGeometry(0.2, 0.32), glassMat);
        g.position.set(0.18, 1.0, s * 0.0255);
        if (s < 0) g.rotation.y = Math.PI;
        slide.add(g);
        const kick = new THREE.Mesh(new THREE.BoxGeometry(W - 0.04, 0.16, 0.004), this.kit.surface('steel'));
        kick.position.set(0, 0.09, s * 0.027);
        slide.add(kick);
        const plate = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.22, 0.008), this.kit.surface('steel'));
        plate.position.set(-0.34, 0.7, s * 0.028);
        slide.add(plate);
      }
    }
    // handprints condense on the cold side of the door [V]
    const prints: THREE.Mesh[] = [];
    for (const s of [-1, 1]) {
      const p = new THREE.Mesh(new THREE.PlaneGeometry(0.11, 0.11), this.printMat.clone());
      p.position.set(-0.3, 0.68, s * 0.031);
      if (s < 0) p.rotation.y = Math.PI;
      slide.add(p);
      prints.push(p);
    }
    this.runGroup.add(slide);
    let chain: THREE.Object3D | null = null;
    if (d.lock === 'sealed') {
      const planks = new THREE.Group();
      const wood = this.kit.surface('wood', { color: 0x6a5a48 });
      for (const s of [-1, 1]) {
        for (const [yy, rot] of [
          [0.45, 0.35],
          [0.95, -0.3],
          [0.7, 0.05],
        ] as const) {
          const pl = new THREE.Mesh(new THREE.BoxGeometry(1.05, 0.12, 0.025), wood);
          pl.position.set(0, yy, s * 0.06);
          pl.rotation.z = rot;
          pl.castShadow = true;
          planks.add(pl);
        }
        const notice = new THREE.Mesh(new THREE.PlaneGeometry(0.34, 0.2), this.kit.plain({ map: signTexture('SEALED BY ORDER', { bg: '#d9d2bc', fg: '#6a1a14', seed: 77 }), roughness: 0.8 }, 'sealed-notice'));
        notice.position.set(0.05, 1.18, s * 0.075);
        if (s < 0) notice.rotation.y = Math.PI;
        planks.add(notice);
      }
      slide.add(planks);
    } else if (d.lock === 'maintenance' || d.lock === 'pharmacy') {
      chain = new THREE.Group();
      const steel = this.kit.surface('steel');
      for (const s of [-1, 1]) {
        for (let i = 0; i < 9; i++) {
          const link = new THREE.Mesh(new THREE.TorusGeometry(0.02, 0.006, 6, 10), steel);
          link.position.set(-0.4 + i * 0.022, 0.72 + Math.sin(i * 0.7) * 0.03, s * 0.05);
          link.rotation.x = i % 2 ? Math.PI / 2 : 0;
          chain.add(link);
        }
        const label = d.lock === 'maintenance' ? 'STAFF ONLY' : 'PHARMACY';
        const sign = new THREE.Mesh(new THREE.PlaneGeometry(0.3, 0.1), this.kit.plain({ map: signTexture(label, { bg: '#7a1a14', fg: '#f2eadb', seed: 12 }), roughness: 0.6 }, `lock:${label}`));
        sign.position.set(0.1, 1.15, s * 0.032);
        if (s < 0) sign.rotation.y = Math.PI;
        slide.add(sign);
      }
      slide.add(chain);
    }
    // the barricade it builds on its own side of a door [Y]
    const barricade = new THREE.Group();
    const side = d.sides[0];
    const sc = cellCenter(level, side);
    const off = new THREE.Vector3(sc.x - c.x, 0, sc.y - c.y).normalize();
    const gurney = new THREE.Mesh(new THREE.BoxGeometry(0.95, 0.12, 0.45), this.kit.surface('metal', { color: 0xc8c2b0 }));
    gurney.position.set(c.x + off.x * 0.62, 0.42, c.y + off.z * 0.62);
    gurney.rotation.set(0.6, d.axis === 'x' ? Math.PI / 2 : 0, 0.15);
    gurney.castShadow = true;
    const cab = new THREE.Mesh(new THREE.BoxGeometry(0.5, 1.1, 0.4), this.kit.surface('metal', { color: 0x7a7c78 }));
    cab.position.set(c.x + off.x * 0.85 + (d.axis === 'x' ? 0 : 0.2), 0.55, c.y + off.z * 0.85 + (d.axis === 'x' ? 0.2 : 0));
    cab.rotation.y = 0.2;
    cab.castShadow = true;
    barricade.add(gurney, cab);
    barricade.visible = false;
    this.runGroup.add(barricade);
    return { door: d, slide, dir, base, chain, barricade, prints };
  }

  private makeLocker(spot: HidingSpot): LockerView {
    const f = this.anchors.lockers.get(spot.cell)!;
    const root = new THREE.Object3D();
    root.matrixAutoUpdate = false;
    root.matrix.copy(f.matrix(-0.205, 0, 0.006));
    const hinge = new THREE.Object3D();
    root.add(hinge);
    const mat = this.kit.surface('metal', { color: 0x6c8390 });
    const W = 0.405;
    const T = 0.012;
    const seg = (y0: number, y1: number, a0 = 0, a1 = W) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(a1 - a0, y1 - y0, T), mat);
      m.position.set((a0 + a1) / 2, (y0 + y1) / 2, 0);
      m.castShadow = true;
      m.receiveShadow = true;
      hinge.add(m);
    };
    // solid door with real vent slits at eye height: you can see out between the bars
    seg(0.07, 0.92);
    seg(1.25, 1.29);
    seg(0.92, 1.25, 0, 0.06);
    seg(0.92, 1.25, W - 0.06, W);
    for (let k = 0; k < 8; k++) {
      const y = 0.925 + k * 0.042;
      const slat = new THREE.Mesh(new THREE.BoxGeometry(W - 0.12, 0.012, T), mat);
      slat.position.set(W / 2, y + 0.006, 0);
      slat.castShadow = true;
      hinge.add(slat);
    }
    const handle = new THREE.Mesh(new THREE.BoxGeometry(0.022, 0.13, 0.024), this.kit.surface('steel'));
    handle.position.set(W - 0.05, 0.68, 0.012);
    hinge.add(handle);
    const prints = new THREE.Mesh(new THREE.PlaneGeometry(0.1, 0.1), this.printMat.clone());
    prints.position.set(W - 0.1, 0.78, T / 2 + 0.002);
    hinge.add(prints);
    this.runGroup.add(root);
    let body: THREE.Object3D | null = null;
    if (spot.body) body = this.makeProppedBody(f);
    return { spot, hinge, angle: 0, prints, body };
  }

  private makeProppedBody(f: Frame): THREE.Object3D {
    const h = buildHuman(this.kit, { top: 0x55606a, bottom: 0x3a4048, skin: 0x8a8070, hair: 0x2a2420 });
    animateHuman(h, { pose: 'propped', speed: 0, t: 0, dt: 1, seed: 0, phase: 0 });
    for (let i = 0; i < 4; i++) animateHuman(h, { pose: 'propped', speed: 0, t: i, dt: 1, seed: 0, phase: 0 });
    const holder = new THREE.Object3D();
    holder.matrixAutoUpdate = false;
    holder.matrix.copy(f.matrix(0, 0.07, -0.24, new THREE.Matrix4().makeRotationY(0)));
    holder.add(h.root);
    h.root.scale.setScalar(0.95);
    this.runGroup.add(holder);
    this.bodies.push(h);
    return holder;
  }

  private makeDrawer(spot: HidingSpot): DrawerView {
    const f = this.anchors.drawers.get(spot.cell)!;
    const root = new THREE.Object3D();
    root.matrixAutoUpdate = false;
    root.matrix.copy(f.matrix(0, 0, 0));
    const slide = new THREE.Object3D();
    root.add(slide);
    const steel = this.kit.surface('steel');
    const front = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.4, 0.025), steel);
    front.position.set(0, 0.78, 0.0125);
    front.castShadow = true;
    slide.add(front);
    const tray = new THREE.Mesh(new THREE.BoxGeometry(0.58, 0.03, 0.92), steel);
    tray.position.set(0, 0.6, -0.46);
    slide.add(tray);
    const latch = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.04, 0.02), this.kit.plain({ color: 0x111111, roughness: 0.5 }, 'latch'));
    latch.position.set(0.23, 0.78, 0.034);
    slide.add(latch);
    const num = spot.id % 9;
    const label = new THREE.Mesh(new THREE.PlaneGeometry(0.08, 0.05), this.kit.plain({ map: signTexture(String(num === 4 ? 4 : num + 1), { bg: '#d8d4c4', fg: '#111', seed: num }), roughness: 0.6 }, `drawernum:${num}`));
    label.position.set(-0.2, 0.93, 0.026);
    slide.add(label);
    const prints = new THREE.Mesh(new THREE.PlaneGeometry(0.1, 0.1), this.printMat.clone());
    prints.position.set(0.12, 0.74, 0.027);
    slide.add(prints);
    if (spot.body) {
      const h = buildHuman(this.kit, { top: 0xd8d6d0, bottom: 0xd8d6d0, skin: 0x8a8070, hair: 0x2a2420 });
      for (let i = 0; i < 5; i++) animateHuman(h, { pose: 'dead', speed: 0, t: i, dt: 1, seed: 0, phase: 0 });
      h.root.rotation.y = Math.PI / 2;
      h.root.position.set(0.0, 0.58, -0.5);
      h.root.scale.setScalar(0.85);
      slide.add(h.root);
      this.bodies.push(h);
    }
    this.runGroup.add(root);
    return { spot, slide, frame: f, out: 0, prints };
  }

  private makeBedJunk(spot: HidingSpot): void {
    const bed = this.anchors.beds.get(spot.cell);
    if (!bed) return;
    const g = new THREE.Group();
    const card = this.kit.plain({ color: 0x8a6a45, roughness: 0.92 }, 'cardboard');
    const b1 = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.2, 0.26), card);
    b1.position.set(-0.15, 0.1, 0.02);
    b1.rotation.y = 0.3;
    const b2 = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.16, 0.22), card);
    b2.position.set(0.18, 0.08, -0.05);
    b2.rotation.y = -0.2;
    const roll = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.5, 14).rotateZ(Math.PI / 2), this.kit.surface('fabric', { color: 0x6a7d86 }));
    roll.position.set(0.02, 0.1, 0.16);
    for (const m of [b1, b2, roll]) {
      m.castShadow = true;
      m.receiveShadow = true;
      g.add(m);
    }
    g.position.set(bed.center[0], 0, bed.center[2]);
    if (bed.along === 'x') g.rotation.y = Math.PI / 2;
    g.visible = spot.cluttered;
    this.runGroup.add(g);
    this.bedJunk.set(spot.id, g);
  }

  private makeWriting(sim: Sim, w: { cell: number; face: 'e' | 'w' | 's' | 'n'; text: string; u: number; v: number; scale: number }): void {
    const level = this.level;
    const dx = w.face === 'e' ? 1 : w.face === 'w' ? -1 : 0;
    const dy = w.face === 's' ? 1 : w.face === 'n' ? -1 : 0;
    const open = w.cell + dx + dy * level.w;
    const f = faceFrame(level, w.cell, open);
    const names = w.text === '@names' ? sim.memory.data.story.names : undefined;
    const tex = writingTexture(w.text, w.cell, names);
    const s = names ? 1 : 0.9 * w.scale;
    const m = new THREE.Mesh(new THREE.PlaneGeometry(0.98 * s, 0.49 * s), this.kit.plain({ map: tex, transparent: true, roughness: 0.6, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1 }, `writing:${w.cell}:${w.text}`));
    m.matrixAutoUpdate = false;
    m.matrix.copy(f.matrix((w.u - 0.5) * 0.4, names ? 0.85 : 0.6 + w.v * 0.7, 0.003));
    m.receiveShadow = true;
    this.runGroup.add(m);
  }

  // ========================================================================== per frame

  update(sim: Sim, dt: number, t: number): void {
    if (this.sim !== sim) this.bind(sim);
    const k = (rate: number) => 1 - Math.exp(-dt * rate);
    // doors
    for (const v of this.doors) {
      const d = v.door;
      const slideBy = d.open * 0.92;
      v.slide.position.copy(v.base).addScaledVector(v.dir, slideBy);
      if (v.chain) v.chain.visible = d.locked;
      v.barricade.visible = d.jammed;
      this.printsOn(sim, d.cell, v.prints);
    }
    // hiding lockers: closed, ajar, torn open by it, swinging as someone climbs in or out
    for (const v of this.lockers) {
      const target = this.lockerTarget(sim, v.spot);
      v.angle += (target - v.angle) * k(target > v.angle + 0.5 ? 14 : 7);
      v.hinge.rotation.y = -v.angle;
      this.printsOn(sim, v.spot.cell, [v.prints]);
      if (v.body) v.body.visible = true;
    }
    for (const v of this.drawers) {
      const target = this.drawerTarget(sim, v.spot);
      v.out += (target - v.out) * k(6);
      v.slide.position.set(0, 0, v.out);
      this.printsOn(sim, v.spot.cell, [v.prints]);
    }
    for (const spot of sim.world.spots) {
      const junk = this.bedJunk.get(spot.id);
      if (junk) junk.visible = spot.cluttered;
    }
    this.syncItems(sim, t);
    this.syncProps(sim);
    this.syncProjectiles(sim, t);
    this.syncFog(sim);
    // water
    for (const tap of sim.world.taps) {
      const w = this.water.get(tap.cell);
      if (w) {
        w.visible = tap.running > 0;
        w.scale.x = w.scale.z = 1 + Math.sin(t * 40) * 0.15;
      }
    }
    // breaker, radio, gates
    const power = sim.objectives.powerOn;
    for (const f of this.fuses) f.visible = power;
    if (this.lever) this.lever.rotation.x += ((power ? -0.9 : 0.9) - this.lever.rotation.x) * k(8);
    if (this.fuseLamp) (this.fuseLamp.material as THREE.MeshBasicMaterial).color.setRGB(power ? 0.2 : 0.25 + 0.2 * Math.max(0, Math.sin(t * 3)), power ? 2.2 : 0.01, power ? 0.4 : 0.01);
    if (this.radioLamp) {
      const calling = sim.objectives.calls.some((c) => sim.time - c.t < 7);
      const blink = calling && Math.sin(t * 12) > 0;
      (this.radioLamp.material as THREE.MeshBasicMaterial).color.setRGB(power ? (blink ? 3 : 1.6) : 0.02, power ? (blink ? 0.3 : 0.9) : 0.01, power ? 0.1 : 0.0);
    }
    for (const g of sim.world.gates) {
      const v = this.gates.get(g.cell);
      if (!v) continue;
      v.angle += ((g.open ? 1.35 : 0) - v.angle) * k(1.5);
      v.left.rotation.y = v.angle;
      v.right.rotation.y = -v.angle;
      v.chain.visible = !g.open;
    }
    for (const b of this.bodies) void b;
  }

  private lockerTarget(sim: Sim, spot: HidingSpot): number {
    const ent = sim.entity;
    const s = ent.state;
    if (s.kind === 'check' && s.spot === spot.id && s.phase === 'open') return 1.75;
    if (s.kind === 'kill' && s.spot === spot.id) return 1.9;
    for (const p of sim.players) {
      const tr = p.transition;
      if (tr && tr.spot === spot) return 1.2 * Math.sin(Math.PI * Math.min(1, tr.t / tr.dur));
    }
    if (spot.occupant) return 0;
    if (spot.ajar) return 0.2;
    return 0;
  }

  private drawerTarget(sim: Sim, spot: HidingSpot): number {
    const s = sim.entity.state;
    if ((s.kind === 'check' && s.spot === spot.id && s.phase === 'open') || (s.kind === 'kill' && s.spot === spot.id)) return 0.7;
    for (const p of sim.players) {
      const tr = p.transition;
      if (tr && tr.spot === spot) return 0.75 * Math.sin(Math.PI * Math.min(1, tr.t / tr.dur));
      if (p.hidden === spot) return 0.035;
    }
    if (spot.ajar) return 0.12;
    return 0;
  }

  /** Condensation shows only in the cold [V]: a print fades with the heat that made it. */
  private printsOn(sim: Sim, cell: number, meshes: THREE.Mesh[]): void {
    let heat = 0;
    if (sim.features.thermalResidue) {
      for (const m of sim.world.thermal) {
        if (m.cell !== cell) continue;
        heat = Math.max(heat, World.heatOf(m, sim.time));
      }
    }
    // cold if any open neighbour is a cold zone
    const cold = heat > 0 && this.coldAround(sim, cell);
    for (const me of meshes) {
      const mat = me.material as THREE.MeshBasicMaterial;
      mat.opacity = cold ? Math.min(0.55, heat * 0.65) : 0;
      me.visible = mat.opacity > 0.01;
    }
  }

  private coldCache = new Map<number, boolean>();
  private coldAround(sim: Sim, cell: number): boolean {
    let v = this.coldCache.get(cell);
    if (v === undefined) {
      const w = this.level.w;
      v = [cell, cell - 1, cell + 1, cell - w, cell + w].some((c) => c >= 0 && sim.world.isCold(c));
      this.coldCache.set(cell, v);
    }
    return v;
  }

  private syncItems(sim: Sim, t: number): void {
    for (const it of sim.world.items) {
      let o = this.items.get(it.id);
      if (!o) {
        o = this.makeItem(it);
        this.items.set(it.id, o);
        this.runGroup.add(o);
      }
      o.visible = it.state === 'ground';
      if (o.visible) o.position.set(it.pos.x, 0, it.pos.y);
    }
    void t;
  }

  private makeItem(it: Item): THREE.Object3D {
    const m = this.models;
    let o: THREE.Object3D;
    switch (it.kind) {
      case 'fuse':
        o = m.fuse();
        break;
      case 'key':
        o = m.key();
        break;
      case 'battery':
        o = m.battery();
        break;
      case 'bottle': {
        o = new THREE.Group();
        const b = m.bottle();
        b.rotation.z = Math.PI / 2;
        b.position.y = 0.034;
        o.add(b);
        break;
      }
      case 'note':
        o = m.paper('note', it.id);
        break;
      case 'record':
        o = m.paper('record', it.id);
        break;
      default:
        o = m.cloth(it.id);
    }
    const holder = new THREE.Group();
    holder.add(o);
    o.rotation.y += hash(it.id) * Math.PI * 2;
    return holder;
  }

  private syncProps(sim: Sim): void {
    for (const pr of sim.world.props) {
      if (this.props.has(pr.id)) continue;
      const o = this.makeProp(pr);
      o.position.set(pr.pos.x, 0, pr.pos.y);
      o.rotation.y = hash(pr.id + 5) * Math.PI * 2;
      this.props.set(pr.id, o);
      this.runGroup.add(o);
    }
  }

  private makeProp(pr: Prop): THREE.Object3D {
    switch (pr.kind) {
      case 'remains':
      case 'survivorBody': {
        const c = pr.color ?? [70, 75, 80];
        const top = new THREE.Color(c[0] / 255, c[1] / 255, c[2] / 255);
        const h = buildHuman(this.kit, { top, bottom: top.clone().multiplyScalar(0.8), skin: 0x8a7f72, hair: 0x221c18 });
        for (let i = 0; i < 6; i++) animateHuman(h, { pose: 'dead', speed: 0, t: i * 0.3 + pr.id, dt: 1, seed: pr.id, phase: 0 });
        this.bodies.push(h);
        const g = new THREE.Group();
        g.add(h.root);
        h.root.position.y = 0.0;
        return g;
      }
      case 'sign':
        return this.models.nestSign(pr.label, pr.id);
      case 'debris':
        return pr.label === 'a ceiling tile' ? this.models.ceilingTile() : this.models.cloth(pr.id);
      default:
        return this.models.trophy(pr.label, pr.id);
    }
  }

  private syncProjectiles(sim: Sim, t: number): void {
    const ps = sim.world.projectiles;
    while (this.projectiles.length < ps.length) {
      const b = this.models.bottle();
      this.projectiles.push(b);
      this.runGroup.add(b);
    }
    this.projectiles.forEach((o, i) => {
      const p = ps[i];
      o.visible = !!p;
      if (!p) return;
      o.position.set(p.pos.x, 0.75 - p.t * p.t * 0.6, p.pos.y);
      o.rotation.set(t * 11, t * 7, 0);
    });
  }

  private syncFog(sim: Sim): void {
    const list = sim.world.fog;
    while (this.fog.length < list.length) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.fogTex, color: 0xdfe4ea, transparent: true, opacity: 0, depthWrite: false }));
      this.fog.push(s);
      this.runGroup.add(s);
    }
    const cam = sim.player;
    this.fog.forEach((s, i) => {
      const f = list[i];
      s.visible = !!f;
      if (!f) return;
      const age = sim.time - f.t;
      const k = Math.max(0, 1 - age / 2.6);
      // your own breath is drawn by the camera; this is everyone else's and what leaks from hiding
      const own = Math.hypot(f.pos.x - cam.pos.x, f.pos.y - cam.pos.y) < 1.0 && f.spot < 0;
      const mat = s.material as THREE.SpriteMaterial;
      mat.opacity = own ? 0 : 0.22 * k * Math.min(1, f.size);
      const size = 0.25 + age * 0.35 * f.size;
      s.scale.set(size, size, 1);
      s.position.set(f.pos.x, 0.95 + age * 0.08, f.pos.y);
    });
  }
}

function softDot(): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grd.addColorStop(0, 'rgba(255,255,255,1)');
  grd.addColorStop(0.5, 'rgba(255,255,255,0.35)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

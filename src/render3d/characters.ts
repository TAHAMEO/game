import * as THREE from 'three';
import type { MaterialKit } from './materials';

/** Joint hierarchy with eased rotations toward a target pose. */
export class Rig {
  readonly joints = new Map<string, THREE.Object3D>();
  private readonly target = new Map<string, THREE.Quaternion>();
  private readonly e = new THREE.Euler();
  private readonly q = new THREE.Quaternion();

  add(name: string, parent: THREE.Object3D, x: number, y: number, z: number): THREE.Object3D {
    const j = new THREE.Object3D();
    j.name = name;
    j.position.set(x, y, z);
    parent.add(j);
    this.joints.set(name, j);
    this.target.set(name, new THREE.Quaternion());
    return j;
  }

  j(name: string): THREE.Object3D {
    return this.joints.get(name)!;
  }

  /** Set a joint's target rotation (radians, XYZ order). */
  set(name: string, x: number, y = 0, z = 0): void {
    const t = this.target.get(name);
    if (!t) return;
    this.e.set(x, y, z, 'XYZ');
    t.setFromEuler(this.e);
  }

  /** Ease every joint toward its target. `snap` = per-joint override rate. */
  apply(dt: number, rate = 10, snap?: Record<string, number>): void {
    for (const [name, j] of this.joints) {
      const t = this.target.get(name)!;
      const r = snap?.[name] ?? rate;
      const k = 1 - Math.exp(-dt * r);
      this.q.copy(j.quaternion).slerp(t, k);
      j.quaternion.copy(this.q);
    }
  }

  reset(): void {
    for (const [name, j] of this.joints) j.quaternion.copy(this.target.get(name)!);
  }
}

/** A limb segment hanging down from its joint (length L), tapered from r0 to r1. */
function limb(L: number, r0: number, r1: number, seg = 10): THREE.BufferGeometry {
  const g = new THREE.CylinderGeometry(r1, r0, L, seg, 4, false);
  g.translate(0, -L / 2, 0);
  // round the ends a little
  const p = g.getAttribute('position');
  for (let i = 0; i < p.count; i++) {
    const y = p.getY(i);
    const t = -y / L;
    const bulge = 1 + 0.12 * Math.sin(t * Math.PI);
    p.setX(i, p.getX(i) * bulge);
    p.setZ(i, p.getZ(i) * bulge);
  }
  g.computeVertexNormals();
  return g;
}

/**
 * A bony limb segment hanging from its joint: a knob at the top (the joint), a thin shaft,
 * a little overlap above the joint so bent segments never show a seam.
 */
function boneLimb(L: number, rTop: number, rBot: number, knob = 1.35, seg = 12, noise = 0): THREE.BufferGeometry {
  const pts: THREE.Vector2[] = [];
  const steps = 14;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const y = rTop * 0.6 - t * (L + rTop * 0.6);
    const base = rTop + (rBot - rTop) * t;
    const knobK = Math.exp(-((t - 0.04) ** 2) / 0.004) * (knob - 1);
    const shaft = 1 - 0.18 * Math.sin(Math.PI * t);
    const r = base * (shaft + knobK);
    pts.push(new THREE.Vector2(Math.max(0.0005, r), y));
  }
  pts.unshift(new THREE.Vector2(0.0001, rTop * 0.6 + rTop * 0.4));
  pts.push(new THREE.Vector2(0.0001, -L - rBot * 0.3));
  const g = new THREE.LatheGeometry(pts.reverse(), seg);
  if (noise) {
    const p = g.getAttribute('position');
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i);
      const y = p.getY(i);
      const z = p.getZ(i);
      const n = 1 + noise * Math.sin(y * 91 + x * 40) * Math.cos(z * 73 + y * 37);
      p.setXYZ(i, x * n, y, z * n);
    }
  }
  g.computeVertexNormals();
  return g;
}

function sphere(r: number, sx = 1, sy = 1, sz = 1, seg = 16): THREE.BufferGeometry {
  return new THREE.SphereGeometry(r, seg, Math.max(8, Math.floor(seg * 0.7))).scale(sx, sy, sz);
}

function part(parent: THREE.Object3D, geo: THREE.BufferGeometry, mat: THREE.Material, x = 0, y = 0, z = 0, uvScale = 1): THREE.Mesh {
  if (uvScale !== 1) {
    const uv = geo.getAttribute('uv');
    if (uv) for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * uvScale, uv.getY(i) * uvScale);
  }
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  m.castShadow = true;
  m.receiveShadow = true;
  parent.add(m);
  return m;
}

// ============================================================================ the Entity

export interface EntityModel {
  root: THREE.Group;
  rig: Rig;
  jaw: THREE.Object3D;
  chest: THREE.Mesh;
  skin: THREE.MeshStandardMaterial;
  /** Joint lengths for the animator. */
  dims: { hip: number; thigh: number; shin: number };
}

/** Its torso: a rib cage you can count, a waist you could close a hand around. */
function entityTorso(): THREE.BufferGeometry {
  const pts: THREE.Vector2[] = [];
  // pelvis, the waist you could close a hand around, the cage, the narrow shoulders
  const prof = [
    [-0.05, 0.0005],
    [-0.04, 0.045],
    [-0.01, 0.07],
    [0.03, 0.068],
    [0.08, 0.05],
    [0.14, 0.036],
    [0.2, 0.042],
    [0.26, 0.07],
    [0.33, 0.088],
    [0.4, 0.09],
    [0.45, 0.08],
    [0.49, 0.06],
    [0.52, 0.03],
    [0.535, 0.0005],
  ];
  for (const [y, r] of prof) pts.push(new THREE.Vector2(r!, y!));
  const g = new THREE.LatheGeometry(pts, 40);
  const p = g.getAttribute('position');
  for (let i = 0; i < p.count; i++) {
    let x = p.getX(i);
    const y = p.getY(i);
    let z = p.getZ(i);
    z *= 0.66; // flat, front to back
    const a = Math.atan2(z, x);
    const front = Math.max(0, Math.sin(a));
    const back = Math.max(0, -Math.sin(a));
    // ribs: deep grooves between them, front and sides of the cage
    if (y > 0.22 && y < 0.45) {
      const ph = (y - 0.22) * 88;
      const groove = Math.pow(Math.max(0, Math.cos(ph)), 6);
      const k = 1 - groove * 0.11 * (0.35 + front) * Math.sin(((y - 0.22) / 0.23) * Math.PI);
      x *= k;
      z *= k;
    }
    // sunken belly, under the cage
    if (y > 0.08 && y < 0.24) z *= 1 - 0.32 * front * Math.sin(((y - 0.08) / 0.16) * Math.PI);
    // shoulder blades and the spine, pushing out of the back
    if (back > 0.2 && y > 0.36 && y < 0.48) {
      const bl = Math.exp(-((Math.abs(x) - 0.045) ** 2) / 0.0004) * Math.sin(((y - 0.36) / 0.12) * Math.PI);
      z -= bl * 0.016 * back;
    }
    if (back > 0.97 && y > 0.0 && y < 0.5) z -= 0.011 * Math.pow(Math.max(0, Math.sin(y * 82)), 2);
    // hip bones
    if (y > -0.02 && y < 0.05 && front > 0.3) {
      const hb = Math.exp(-((Math.abs(x) - 0.05) ** 2) / 0.0003);
      z += hb * 0.01 * front;
    }
    p.setXYZ(i, x, y, z);
  }
  g.computeVertexNormals();
  return g;
}

/**
 * Its head: a long skull swept back, no eyes, and where the face should be a deep ridged
 * dish like the inside of an ear, wet and dark at the centre. It listens with its whole head.
 */
function entityHead(): THREE.BufferGeometry {
  const g = new THREE.SphereGeometry(0.1, 56, 42);
  const p = g.getAttribute('position');
  const col = new Float32Array(p.count * 3);
  for (let i = 0; i < p.count; i++) {
    let x = p.getX(i);
    let y = p.getY(i);
    let z = p.getZ(i);
    const ox = x;
    const oy = y;
    // long skull, swept back and up
    y *= 1.28;
    x *= 0.82;
    if (z < 0) {
      z *= 1.55;
      y += -z * 0.35;
    }
    let tint = 1;
    let red = 0;
    if (z > 0) {
      const r = Math.sqrt(ox * ox * 1.1 + (oy + 0.004) * (oy + 0.004) * 0.75);
      const R = 0.094;
      const dish = Math.max(0, 1 - r / R);
      // deep bowl with spiralling folds, like cartilage
      const ang = Math.atan2(oy, ox);
      const folds = Math.sin(r * 210 + ang * 1.5) * 0.006 * Math.sqrt(dish) * (1 - dish * 0.6);
      z = z - Math.pow(dish, 0.7) * 0.15 + folds;
      const rim = Math.exp(-((r - R * 0.93) ** 2) / 0.00008);
      z += rim * 0.016;
      tint = 1 - Math.pow(dish, 0.6) * 0.85;
      red = Math.pow(dish, 1.4);
    }
    p.setXYZ(i, x, y, z);
    // pale skin outside; deep wet red-black inside the dish
    col[i * 3] = tint * (1 - red * 0.2) + red * 0.2;
    col[i * 3 + 1] = tint * (1 - red * 0.6) + red * 0.03;
    col[i * 3 + 2] = tint * (1 - red * 0.6) + red * 0.04;
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.computeVertexNormals();
  return g;
}

export function buildEntity(kit: MaterialKit): EntityModel {
  // ashen, mottled, wet: barely there in the dark (a faint emissive keeps a shape in pitch black)
  const skinOpts = { color: 0xd6d2c8, sheen: 0.25, sheenColor: 0x2a2424, clearcoat: 0.55, emissive: 0x0b0a0a, emissiveIntensity: 1, fill: 0.6, direct: 0.9, normalScale: 1.4 };
  const skin = kit.surface('corpse', skinOpts) as THREE.MeshStandardMaterial;
  const face = kit.surface('corpse', { ...skinOpts, vertexColors: true }) as THREE.MeshStandardMaterial;
  const dark = kit.plain({ color: 0x080404, roughness: 0.35 }, 'entity-dark');
  const tooth = kit.plain({ color: 0xb8ae96, roughness: 0.4 }, 'entity-tooth');
  const nail = kit.plain({ color: 0x3a3226, roughness: 0.3 }, 'entity-nail');
  const root = new THREE.Group();
  root.name = 'entity';
  const rig = new Rig();
  const hip = 0.84;
  const thigh = 0.43;
  const shin = 0.42;
  const hips = rig.add('hips', root, 0, hip, 0);
  const spine = rig.add('spine', hips, 0, 0.02, 0);
  const torsoGeo = entityTorso();
  const chest = part(spine, torsoGeo, skin, 0, -0.02, 0, 3);
  // collarbones
  for (const s of [-1, 1]) part(spine, limb(0.12, 0.009, 0.007, 6).rotateZ((s * Math.PI) / 2.3), skin, s * 0.01, 0.47, 0.035);
  const neck = rig.add('neck', spine, 0, 0.5, 0.005);
  part(neck, boneLimb(0.19, 0.024, 0.019, 1.1, 12, 0.04).rotateX(Math.PI), skin, 0, 0, 0, 2);
  const head = rig.add('head', neck, 0, 0.17, 0.0);
  // the neck meets the skull at the back, so the dish faces forward, clear of it
  part(head, entityHead(), face, 0, 0.075, 0.04, 1.6);
  // The maw: at the bottom of the dish, a throat that dilates when it breathes in or strikes,
  // ringed with teeth that point inward.
  const jaw = new THREE.Object3D();
  jaw.position.set(0, 0.07, -0.004);
  head.add(jaw);
  part(jaw, new THREE.CircleGeometry(0.03, 24), dark, 0, 0, 0.001);
  for (let k = 0; k < 14; k++) {
    const a = (k / 14) * Math.PI * 2;
    const tooth1 = new THREE.ConeGeometry(0.0028, 0.016, 4);
    tooth1.rotateZ(Math.PI / 2);
    const tm = part(jaw, tooth1, tooth, Math.cos(a) * 0.03, Math.sin(a) * 0.03, 0.004);
    tm.rotation.z = a;
  }
  jaw.scale.setScalar(0.3);
  for (const s of [-1, 1]) {
    const L = s < 0 ? 'L' : 'R';
    const sh = rig.add(`shoulder${L}`, spine, s * 0.115, 0.46, -0.008);
    part(sh, sphere(0.03, 1.2, 0.9, 1), skin);
    const ua = rig.add(`upperArm${L}`, sh, 0, 0, 0);
    part(ua, boneLimb(0.37, 0.026, 0.019, 1.3, 12, 0.05), skin, 0, 0, 0, 2.5);
    const el = rig.add(`forearm${L}`, ua, 0, -0.37, 0);
    part(el, boneLimb(0.35, 0.021, 0.014, 1.45, 12, 0.05), skin, 0, 0, 0, 2.5);
    const hand = rig.add(`hand${L}`, el, 0, -0.35, 0);
    part(hand, new THREE.BoxGeometry(0.05, 0.07, 0.018).translate(0, -0.03, 0), skin);
    for (let f = 0; f < 4; f++) {
      const fx = (f - 1.5) * 0.013;
      const l1 = 0.09 - Math.abs(f - 1.5) * 0.01;
      const f1 = rig.add(`finger${L}${f}`, hand, fx, -0.065, 0);
      part(f1, limb(l1, 0.0062, 0.005, 6), skin);
      part(f1, sphere(0.0065, 1, 1.2, 1, 6), skin, 0, -l1, 0);
      const f2 = rig.add(`finger${L}${f}b`, f1, 0, -l1, 0);
      part(f2, limb(0.08, 0.005, 0.0025, 6), skin);
      part(f2, new THREE.ConeGeometry(0.004, 0.022, 5).rotateX(Math.PI), nail, 0, -0.085, 0.001);
    }
    const th = rig.add(`thigh${L}`, hips, s * 0.055, -0.03, 0);
    part(th, boneLimb(thigh, 0.038, 0.026, 1.15, 12, 0.04), skin, 0, 0, 0, 2.5);
    const kn = rig.add(`shin${L}`, th, 0, -thigh, 0);
    part(kn, boneLimb(shin, 0.027, 0.016, 1.55, 12, 0.05), skin, 0, 0, 0, 2.5);
    const ft = rig.add(`foot${L}`, kn, 0, -shin, 0);
    part(ft, new THREE.BoxGeometry(0.05, 0.03, 0.17).translate(0, -0.012, 0.055), skin);
  }
  root.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) o.frustumCulled = true;
  });
  return { root, rig, jaw, chest, skin, dims: { hip, thigh, shin } };
}

export type EntityPose = 'idle' | 'walk' | 'tilt' | 'inhale' | 'turnaway' | 'lunge' | 'reach' | 'crouch' | 'feed' | 'wave';

export interface EntityAnim {
  pose: EntityPose;
  speed: number;
  /** Seconds, for idle motion. */
  t: number;
  dt: number;
  /** Stable per instance, so two of them never move in step. */
  seed: number;
  /** Accumulated stride phase. */
  phase: number;
  /** Which way the head tips when it listens. */
  tiltSide: number;
}

const noise1 = (x: number) => {
  const i = Math.floor(x);
  const f = x - i;
  const h = (n: number) => {
    const s = Math.sin(n * 127.1) * 43758.5453;
    return s - Math.floor(s);
  };
  const u = f * f * (3 - 2 * f);
  return h(i) * (1 - u) + h(i + 1) * u;
};

/** Drive the Entity's rig from its simulation pose. Returns the stride phase to keep. */
export function animateEntity(m: EntityModel, a: EntityAnim): number {
  const r = m.rig;
  const t = a.t + a.seed * 10;
  const running = a.speed > 2.4;
  const moving = a.speed > 0.15 && (a.pose === 'walk' || a.pose === 'idle' || a.pose === 'turnaway');
  const stride = running ? 1.25 : 0.95;
  let phase = a.phase;
  if (moving) phase += (a.speed * a.dt) / stride;
  const ph = phase * Math.PI;
  // twitches: rare, sharp
  const tw = noise1(t * 3.1) > 0.82 ? (noise1(t * 40) - 0.5) * 0.5 : 0;
  const breathe = Math.sin(t * 1.3) * 0.025;
  m.chest.scale.set(1 + breathe * 0.5, 1, 1 + breathe);
  let jaw = 0;
  const hipsY = m.dims.hip;
  r.j('hips').position.y = hipsY;
  // defaults: hunched, arms hanging forward of the body, head thrust out on the long neck
  for (const n of r.joints.keys()) r.set(n, 0, 0, 0);
  r.set('shoulderL', -0.25, 0, -0.06);
  r.set('shoulderR', -0.25, 0, 0.06);
  r.set('upperArmL', -0.1, 0, -0.1);
  r.set('upperArmR', -0.1, 0, 0.1);
  r.set('forearmL', -0.25);
  r.set('forearmR', -0.25);
  for (const L of ['L', 'R']) for (let f = 0; f < 4; f++) {
    r.set(`finger${L}${f}`, -0.3 - f * 0.06, 0, (f - 1.5) * 0.05);
    r.set(`finger${L}${f}b`, -0.45);
  }
  const sway = Math.sin(t * 0.6) * 0.04;
  r.set('spine', 0.34, sway, 0.06);
  r.set('neck', 0.5, 0, -0.08);
  r.set('head', -0.5 + tw * 0.3, tw, 0.12 + tw * 0.6);
  r.set('shoulderL', -0.25, 0, -0.14);
  r.set('thighL', -0.12, 0, -0.03);
  r.set('thighR', -0.18, 0, 0.05);
  r.set('shinL', 0.22);
  r.set('shinR', 0.3);
  r.set('footL', -0.1);
  r.set('footR', -0.12);
  const snap: Record<string, number> = { head: tw ? 40 : 8, neck: 8 };
  if (moving) {
    const amp = running ? 0.85 : 0.55;
    const s = Math.sin(ph);
    const c = Math.cos(ph);
    // legs: long strides, the left one drags a little
    r.set('thighL', -s * amp * 0.9);
    r.set('thighR', s * amp);
    r.set('shinL', Math.max(0, c) * amp * 1.2 + 0.1);
    r.set('shinR', Math.max(0, -c) * amp * 1.3 + 0.1);
    r.set('footL', s * 0.25);
    r.set('footR', -s * 0.25);
    r.j('hips').position.y = hipsY - Math.abs(c) * 0.03 - (running ? 0.08 : 0);
    r.set('hips', 0, s * 0.12, c * 0.05);
    r.set('spine', running ? 0.62 : 0.36, -s * 0.15, 0);
    if (running) {
      // arms forward, reaching, fingers spread
      r.set('upperArmL', -1.0 + s * 0.4, 0, -0.35);
      r.set('upperArmR', -1.0 - s * 0.4, 0, 0.35);
      r.set('forearmL', -0.5);
      r.set('forearmR', -0.5);
      r.set('neck', 0.75);
      r.set('head', -0.7 + tw, tw, 0);
      jaw = 0.4;
    } else {
      r.set('upperArmL', -0.1 + s * 0.22, 0, -0.1);
      r.set('upperArmR', -0.1 - s * 0.22, 0, 0.1);
    }
  }
  switch (a.pose) {
    case 'tilt':
      // the listen: the whole head tips to one side and stays there, dish toward the sound
      r.set('neck', 0.3);
      r.set('head', -0.3, a.tiltSide * 0.35, a.tiltSide * 1.05);
      r.set('spine', 0.22);
      for (const L of ['L', 'R']) for (let f = 0; f < 4; f++) r.set(`finger${L}${f}`, -0.1, 0, (f - 1.5) * 0.15);
      snap.head = 3.2;
      break;
    case 'inhale':
      r.set('spine', 0.05);
      r.set('neck', 0.1);
      r.set('head', -0.75);
      r.set('shoulderL', -0.1, 0, -0.3);
      r.set('shoulderR', -0.1, 0, 0.3);
      m.chest.scale.set(1.1, 1, 1.24);
      jaw = 0.65;
      break;
    case 'turnaway':
      r.set('neck', 0.3, a.tiltSide * 0.6, 0);
      r.set('head', 0.1, a.tiltSide * 0.5, 0);
      snap.neck = 1.4;
      snap.head = 1.4;
      break;
    case 'lunge':
      r.set('spine', 0.75);
      r.set('neck', 0.35);
      r.set('head', -0.5);
      r.set('upperArmL', -1.55, 0, -0.25);
      r.set('upperArmR', -1.55, 0, 0.25);
      r.set('forearmL', -0.2);
      r.set('forearmR', -0.2);
      r.set('thighL', -0.7);
      r.set('shinL', 0.6);
      r.set('thighR', 0.4);
      r.set('shinR', 0.3);
      r.j('hips').position.y = hipsY - 0.12;
      for (const L of ['L', 'R']) for (let f = 0; f < 4; f++) r.set(`finger${L}${f}`, 0.2 + (f - 1.5) * 0.1, 0, (f - 1.5) * 0.12);
      jaw = 1;
      snap.spine = 18;
      snap.upperArmL = 18;
      snap.upperArmR = 18;
      break;
    case 'reach':
      r.set('spine', 0.5);
      r.set('neck', 0.2);
      r.set('upperArmR', -1.25, 0, 0.1);
      r.set('forearmR', -0.15);
      r.set('upperArmL', -0.2, 0, -0.3);
      r.set('head', -0.5, 0, 0.3);
      break;
    case 'crouch':
      r.j('hips').position.y = hipsY * 0.45;
      r.set('thighL', -1.7, 0, 0.2);
      r.set('thighR', -1.7, 0, -0.2);
      r.set('shinL', 2.2);
      r.set('shinR', 2.2);
      r.set('spine', 0.95);
      r.set('neck', 0.4);
      r.set('head', -0.6, 0, 0.4);
      r.set('upperArmL', -1.2, 0, -0.3);
      r.set('upperArmR', -0.9, 0, 0.3);
      break;
    case 'feed': {
      r.j('hips').position.y = hipsY * 0.42;
      r.set('thighL', -1.8, 0, 0.3);
      r.set('thighR', -1.6, 0, -0.3);
      r.set('shinL', 2.3);
      r.set('shinR', 2.1);
      const bob = Math.max(0, Math.sin(t * 3.2)) ** 3;
      r.set('spine', 1.05 + bob * 0.2);
      r.set('neck', 0.6 + bob * 0.4);
      r.set('head', -0.2 + bob * 0.3, 0, 0);
      r.set('upperArmL', -1.3, 0, -0.4);
      r.set('upperArmR', -1.3, 0, 0.4);
      r.set('forearmL', -0.9);
      r.set('forearmR', -0.9);
      jaw = 0.3 + bob * 0.6;
      break;
    }
    case 'wave':
      r.set('upperArmR', -2.6, 0, 0.3);
      r.set('forearmR', -0.3 + Math.sin(t * 8) * 0.4);
      break;
    default:
      break;
  }
  const open = 0.28 + jaw * 0.95;
  m.jaw.scale.setScalar(m.jaw.scale.x + (open - m.jaw.scale.x) * (1 - Math.exp(-a.dt * (jaw > 0.5 ? 18 : 6))));
  r.apply(a.dt, 9, snap);
  return phase;
}

// ============================================================================ humans

export interface HumanLook {
  top: THREE.ColorRepresentation;
  bottom: THREE.ColorRepresentation;
  skin: THREE.ColorRepresentation;
  hair: THREE.ColorRepresentation;
  /** A white coat over the top. */
  coat?: boolean;
}

export interface HumanModel {
  root: THREE.Group;
  rig: Rig;
  /** Where a torch sits in the right hand. */
  torchMount: THREE.Object3D;
  dims: { hip: number };
}

export function buildHuman(kit: MaterialKit, look: HumanLook): HumanModel {
  const top = kit.surface('fabric', { color: look.top, normalScale: 0.6 });
  const bottom = kit.surface('fabric', { color: look.bottom, normalScale: 0.6 });
  const skin = kit.surface('skin', { color: look.skin, sheen: 0.25, sheenColor: 0x6a3a30, normalScale: 0.5 });
  const hair = kit.plain({ color: look.hair, roughness: 0.7 }, `hair:${new THREE.Color(look.hair).getHexString()}`);
  const shoe = kit.plain({ color: 0x141414, roughness: 0.6 }, 'shoe');
  const dark = kit.plain({ color: 0x0c0a0a, roughness: 0.6 }, 'eye');
  const root = new THREE.Group();
  root.name = 'human';
  const rig = new Rig();
  const hip = 0.55;
  const hips = rig.add('hips', root, 0, hip, 0);
  part(hips, sphere(0.085, 1.1, 0.75, 0.75), bottom);
  const spine = rig.add('spine', hips, 0, 0.03, 0);
  const torso = new THREE.LatheGeometry(
    [
      new THREE.Vector2(0.075, 0),
      new THREE.Vector2(0.078, 0.08),
      new THREE.Vector2(0.088, 0.2),
      new THREE.Vector2(0.092, 0.28),
      new THREE.Vector2(0.075, 0.33),
      new THREE.Vector2(0.03, 0.36),
    ],
    20,
  ).scale(1, 1, 0.68);
  part(spine, torso, look.coat ? kit.surface('fabric', { color: 0xe8e6e0 }) : top);
  if (look.coat) part(spine, new THREE.CylinderGeometry(0.095, 0.105, 0.22, 16, 1, true).scale(1, 1, 0.72).translate(0, -0.06, 0), kit.surface('fabric', { color: 0xe8e6e0 }));
  const neck = rig.add('neck', spine, 0, 0.35, 0);
  part(neck, limb(0.05, 0.026, 0.028, 10).rotateX(Math.PI), skin);
  const head = rig.add('head', neck, 0, 0.055, 0);
  part(head, sphere(0.068, 0.9, 1.12, 1.0, 22), skin, 0, 0.05, 0);
  part(head, sphere(0.071, 0.93, 0.9, 1.02, 18).translate(0, 0.012, -0.008), hair, 0, 0.06, -0.004).scale.set(1, 1, 1);
  for (const s of [-1, 1]) part(head, sphere(0.009, 1.4, 0.8, 0.6, 8), dark, s * 0.024, 0.06, 0.06);
  part(head, sphere(0.012, 0.7, 1, 1.1, 8), skin, 0, 0.042, 0.068);
  for (const s of [-1, 1]) {
    const L = s < 0 ? 'L' : 'R';
    const sh = rig.add(`shoulder${L}`, spine, s * 0.105, 0.3, 0);
    const ua = rig.add(`upperArm${L}`, sh, 0, 0, 0);
    part(ua, limb(0.17, 0.03, 0.026), look.coat ? kit.surface('fabric', { color: 0xe8e6e0 }) : top);
    const fa = rig.add(`forearm${L}`, ua, 0, -0.17, 0);
    part(fa, limb(0.155, 0.024, 0.019), look.coat ? kit.surface('fabric', { color: 0xe8e6e0 }) : skin);
    const hand = rig.add(`hand${L}`, fa, 0, -0.155, 0);
    part(hand, sphere(0.022, 0.8, 1.4, 0.55, 10).translate(0, -0.025, 0), skin);
    const th = rig.add(`thigh${L}`, hips, s * 0.05, -0.02, 0);
    part(th, limb(0.27, 0.042, 0.034), bottom);
    const sn = rig.add(`shin${L}`, th, 0, -0.27, 0);
    part(sn, limb(0.25, 0.032, 0.024), bottom);
    const ft = rig.add(`foot${L}`, sn, 0, -0.25, 0);
    part(ft, new THREE.BoxGeometry(0.05, 0.035, 0.12).translate(0, -0.012, 0.03), shoe);
  }
  const torchMount = new THREE.Object3D();
  torchMount.position.set(0, -0.04, 0.02);
  rig.j('handR').add(torchMount);
  return { root, rig, torchMount, dims: { hip } };
}

export type HumanPose = 'idle' | 'scared' | 'walk' | 'run' | 'crouch' | 'wave' | 'dead' | 'torch' | 'propped';

export interface HumanAnim {
  pose: HumanPose;
  speed: number;
  t: number;
  dt: number;
  seed: number;
  phase: number;
  /** Look pitch for players (radians). */
  pitch?: number;
}

export function animateHuman(m: HumanModel, a: HumanAnim): number {
  const r = m.rig;
  const t = a.t + a.seed * 7;
  let phase = a.phase;
  const moving = a.speed > 0.2 && a.pose !== 'dead' && a.pose !== 'propped';
  const run = a.pose === 'run' || a.speed > 3;
  if (moving) phase += (a.speed * a.dt) / (run ? 0.95 : 0.75);
  const ph = phase * Math.PI;
  for (const n of r.joints.keys()) r.set(n, 0, 0, 0);
  const hips = r.j('hips');
  hips.position.set(0, m.dims.hip, 0);
  hips.rotation.set(0, 0, 0);
  r.set('upperArmL', 0.05, 0, 0.08);
  r.set('upperArmR', 0.05, 0, -0.08);
  r.set('forearmL', -0.2);
  r.set('forearmR', -0.2);
  const breathe = Math.sin(t * 1.6) * 0.02;
  r.set('spine', 0.05 + breathe);
  if (moving) {
    const amp = run ? 0.75 : 0.45;
    const s = Math.sin(ph);
    const c = Math.cos(ph);
    r.set('thighL', -s * amp);
    r.set('thighR', s * amp);
    r.set('shinL', Math.max(0, c) * amp * 1.3);
    r.set('shinR', Math.max(0, -c) * amp * 1.3);
    r.set('upperArmL', s * amp * 0.7, 0, 0.08);
    r.set('upperArmR', -s * amp * 0.7, 0, -0.08);
    r.set('forearmL', -0.4 - (run ? 0.6 : 0));
    r.set('forearmR', -0.4 - (run ? 0.6 : 0));
    r.set('spine', run ? 0.25 : 0.08);
    hips.position.y = m.dims.hip - Math.abs(c) * 0.015;
  }
  switch (a.pose) {
    case 'scared':
      // arms wrapped around itself, shoulders up, glancing about
      r.set('spine', 0.25);
      r.set('upperArmL', -0.9, 0.4, 0.5);
      r.set('upperArmR', -0.9, -0.4, -0.5);
      r.set('forearmL', -1.6);
      r.set('forearmR', -1.6);
      r.set('head', 0.2, Math.sin(t * 0.7) * 0.6, 0);
      break;
    case 'crouch':
      hips.position.y = m.dims.hip * 0.55;
      r.set('thighL', -1.4, 0, 0.15);
      r.set('thighR', -1.4, 0, -0.15);
      r.set('shinL', 2.0);
      r.set('shinR', 2.0);
      r.set('spine', 0.45);
      break;
    case 'wave':
      r.set('upperArmR', -2.5, 0, -0.35);
      r.set('forearmR', -0.4 + Math.sin(t * 9) * 0.5);
      r.set('head', -0.1, 0, 0.1);
      break;
    case 'torch':
      r.set('upperArmR', -1.25 - (a.pitch ?? 0) * 0.8, 0, -0.05);
      r.set('forearmR', -0.15);
      r.set('head', -(a.pitch ?? 0) * 0.7, 0, 0);
      break;
    case 'dead':
      hips.position.y = 0.06;
      hips.rotation.set(-Math.PI / 2, 0, 0.1);
      r.set('upperArmL', -0.4, 0, 1.1);
      r.set('upperArmR', 0.3, 0, -0.9);
      r.set('forearmL', -0.6);
      r.set('thighL', 0.1, 0, 0.25);
      r.set('thighR', -0.3, 0, -0.1);
      r.set('shinR', 0.6);
      r.set('head', 0.2, 0.9, 0);
      break;
    case 'propped':
      hips.position.y = m.dims.hip * 0.85;
      r.set('spine', 0.45);
      r.set('neck', 0.6);
      r.set('head', 0.5, 0.3, 0.4);
      r.set('upperArmL', 0.1, 0, 0.15);
      r.set('upperArmR', 0.1, 0, -0.15);
      r.set('thighL', -0.3);
      r.set('thighR', -0.2);
      r.set('shinL', 0.5);
      r.set('shinR', 0.4);
      break;
    default:
      r.set('head', 0, Math.sin(t * 0.3) * 0.25, 0);
  }
  r.apply(a.dt, 8);
  return phase;
}

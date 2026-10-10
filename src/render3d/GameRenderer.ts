import * as THREE from 'three';
import { cellAt, cellCenter, type Level } from '../core/level';
import type { Player } from '../core/player';
import type { Sim } from '../core/sim';
import type { GameEvent } from '../core/types';
import { Actors3D } from './actors3d';
import { eyeHeight, WALL_H } from './constants';
import { Fixtures3D } from './fixtures3d';
import { Torch } from './flashlight';
import { Models } from './models';
import { Objects3D } from './objects3d';
import { Post } from './post';
import { guessQuality, QUALITY, type Quality, type QualityName } from './quality';
import { horizontalToVerticalFov, makeRenderer, SCREEN_HFOV, World3D } from './Renderer3D';

export interface RenderFrame {
  /** Real seconds since the last frame. */
  dt: number;
  /** Real seconds (wall clock) — effects run on it, so they play even while the sim is paused. */
  t: number;
  /** Whose eyes we see through (the local player, or someone a dead player is watching). */
  viewId: number;
  /** Attract mode: a slow drift for the title screen. */
  attract?: boolean;
}

interface Timed {
  at: number;
  fn: () => void;
}

const hash1 = (x: number) => {
  const s = Math.sin(x * 127.1 + 311.7) * 43758.5453;
  return s - Math.floor(s);
};

/**
 * The 3D presentation of a run. Reads the simulation each frame — never writes it — and
 * plays the presentation-only events (scares, visions, lightning, shakes) on a wall clock.
 */
export class GameRenderer {
  readonly renderer: THREE.WebGLRenderer;
  readonly camera: THREE.PerspectiveCamera;
  quality: Quality;
  world!: World3D;
  ready = false;
  private post!: Post;
  private torch!: Torch;
  private fixtures!: Fixtures3D;
  private objects!: Objects3D;
  private actors!: Actors3D;
  private models!: Models;
  private readonly fpTorch = new THREE.Group();
  private boundSim: Sim | null = null;
  // presentation state
  private eye = 0.5;
  private shake = 0;
  private scare = 0;
  private hurt = 0;
  private lightning = 0;
  private flashes: { at: number; s: number }[] = [];
  private visionStart = -1;
  private visionEnd = -1;
  private deathAt = -1;
  private torchOverride: { until: number; fn: (t: number) => number } | null = null;
  private timeline: Timed[] = [];
  private fovPunch = 0;
  private lastHurtSeen = -99;
  private frameTimes: number[] = [];
  private scale = 1;
  private readonly tmp = new THREE.Vector3();
  private readonly look = new THREE.Vector3();
  private readonly up = new THREE.Vector3(0, 1, 0);
  /** Exposure, eased (visions brighten the frame). */
  private exposure = 1.05;
  /** The player's brightness setting (a multiplier on exposure). */
  brightness = 1;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    quality: QualityName | 'auto' = 'auto',
  ) {
    const q = quality === 'auto' ? guessQuality() : quality;
    this.quality = QUALITY[q];
    this.renderer = makeRenderer(canvas, q);
    this.camera = new THREE.PerspectiveCamera(60, 16 / 9, 0.03, 70);
  }

  async init(level: Level, onProgress: (k: number) => void = () => {}): Promise<void> {
    this.resize();
    this.world = new World3D(this.renderer, level, this.quality);
    await this.world.build(onProgress);
    const w = this.world;
    this.models = new Models(w.kit);
    this.fixtures = new Fixtures3D(level, w.kit, w.grid);
    this.objects = new Objects3D(level, w.kit, this.models, w.anchors);
    this.actors = new Actors3D(w.kit, w.scene, w.cookie);
    w.scene.add(this.fixtures.group, this.objects.group, this.actors.group, this.camera);
    this.torch = new Torch(w.scene, { shadows: this.quality.shadowMap, volumetric: this.quality.volumetric, dust: this.quality.dust, cookie: w.cookie, local: true });
    this.buildFirstPersonTorch();
    this.post = new Post(this.renderer, w.scene, this.camera, this.quality);
    this.resize();
    // compile shaders before the first real frame (no hitch on the first look around)
    this.renderer.compile(w.scene, this.camera);
    this.ready = true;
  }

  private buildFirstPersonTorch(): void {
    const kit = this.world.kit;
    const black = kit.plain({ color: 0x161616, roughness: 0.45, metalness: 0.5 }, 'fp-torch');
    // the wide end (the lens) points away from you, down the view
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.016, 0.16, 16).rotateX(-Math.PI / 2), black);
    const head = new THREE.Mesh(new THREE.CylinderGeometry(0.026, 0.018, 0.045, 18).rotateX(-Math.PI / 2), black);
    head.position.z = -0.095;
    const lens = new THREE.Mesh(new THREE.CircleGeometry(0.021, 18), new THREE.MeshBasicMaterial({ color: 0xfff2d8 }));
    lens.position.z = -0.1185;
    const hand = new THREE.Mesh(new THREE.SphereGeometry(0.035, 14, 10).scale(1, 0.75, 1.5), kit.surface('skin', { color: 0xc89a7c, normalScale: 0.5 }));
    hand.position.set(0.004, -0.012, 0.03);
    this.fpTorch.add(body, head, lens, hand);
    this.fpTorch.position.set(0.13, -0.14, -0.21);
    this.fpTorch.rotation.set(0.04, 0.06, 0);
    this.fpTorch.traverse((o) => {
      o.castShadow = false;
      o.receiveShadow = false;
    });
    this.camera.add(this.fpTorch);
  }

  resize(): void {
    const w = this.canvas.clientWidth || window.innerWidth;
    const h = this.canvas.clientHeight || window.innerHeight;
    const pr = Math.min(window.devicePixelRatio || 1, this.quality.pixelRatio) * this.scale;
    this.renderer.setPixelRatio(pr);
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / Math.max(1, h);
    this.camera.updateProjectionMatrix();
    this.post?.setSize(w, h, pr);
    this.torch?.setViewHeight(h * pr);
  }

  // ===================================================================== events

  /** Presentation events for whoever we are watching through. */
  handle(events: GameEvent[], sim: Sim, viewId: number, t: number): void {
    for (const e of events) {
      if (e.to !== undefined && e.to !== viewId) continue;
      switch (e.type) {
        case 'shake':
          this.shake = Math.min(1, this.shake + 0.6 * e.amount);
          this.hurt = 1;
          break;
        case 'lightning':
          this.flashes.push({ at: t, s: e.strength }, { at: t + 0.12 + hash1(t) * 0.1, s: e.strength * 0.7 });
          break;
        case 'scare':
          this.stageScare(e, sim, t);
          break;
        case 'story':
          if (e.beat.kind === 'vision') {
            this.visionStart = t;
            this.visionEnd = t + e.beat.duration;
          }
          break;
        case 'death':
          if (e.player === viewId) this.deathAt = t;
          break;
        case 'sound':
          if (e.kind === 'doorBash' && e.volume > 0.5) this.shake = Math.min(1, this.shake + 0.15);
          if (e.kind === 'thud' && e.volume > 0.4) this.shake = Math.min(1, this.shake + 0.35);
          break;
      }
    }
  }

  private stageScare(e: Extract<GameEvent, { type: 'scare' }>, sim: Sim, t: number): void {
    const viewer = sim.players[e.to ?? sim.localId] ?? sim.player;
    const me = { x: viewer.pos.x, y: viewer.pos.y };
    switch (e.kind) {
      case 'lunge':
      case 'kill':
        this.scare = 1;
        this.shake = 1;
        this.fovPunch = -10;
        break;
      case 'flicker': {
        // torch dies; in the dark frame it is standing right there; then nothing
        const pos = e.pos!;
        this.torchOverride = { until: t + 1.1, fn: (tt) => (tt - t < 0.16 ? 0 : tt - t < 0.55 ? 0.8 : tt - t < 0.72 ? 0 : 1) };
        this.at(t + 0.16, () => this.actors.showApparition(pos, me, 'inhale', t + 0.55, t));
        this.at(t + 0.18, () => {
          this.scare = 0.9;
          this.shake = Math.min(1, this.shake + 0.5);
        });
        break;
      }
      case 'behind': {
        const pos = e.pos!;
        this.actors.showApparition(pos, me, 'lunge', t + 0.42, t);
        this.scare = 1;
        this.shake = 0.9;
        this.fovPunch = -8;
        break;
      }
      case 'window': {
        const pos = e.pos!;
        // pressed against the glass from outside
        const c = cellAt(sim.level, pos);
        const into = cellCenter(sim.level, c);
        const dx = pos.x - into.x;
        const dy = pos.y - into.y;
        const outside = { x: pos.x - Math.sign(dx) * 0.45 * (Math.abs(dx) > Math.abs(dy) ? 1 : 0), y: pos.y - Math.sign(dy) * 0.45 * (Math.abs(dy) >= Math.abs(dx) ? 1 : 0) };
        this.actors.showApparition(outside, me, 'reach', t + 0.7, t);
        this.scare = 0.8;
        this.shake = 0.5;
        break;
      }
      case 'locker': {
        const pos = e.pos!;
        this.actors.showApparition(pos, me, 'inhale', t + 0.6, t);
        this.scare = 0.7;
        this.shake = 0.4;
        break;
      }
      case 'drop':
        this.shake = Math.min(1, this.shake + 0.6);
        this.scare = 0.4;
        break;
      case 'whisper':
        this.scare = 0.15;
        break;
    }
  }

  private at(time: number, fn: () => void): void {
    this.timeline.push({ at: time, fn });
  }

  // ===================================================================== frame

  render(sim: Sim, f: RenderFrame): void {
    if (!this.ready) return;
    if (this.boundSim !== sim) {
      this.boundSim = sim;
      this.fixtures.bind(sim.world.lighting);
      this.deathAt = -1;
      this.visionEnd = -1;
      this.torchOverride = null;
      this.timeline = [];
      this.actors.hideApparition();
      this.lastHurtSeen = sim.player.lastHurt;
    }
    const { dt, t } = f;
    for (let i = this.timeline.length - 1; i >= 0; i--) {
      if (t >= this.timeline[i]!.at) {
        this.timeline[i]!.fn();
        this.timeline.splice(i, 1);
      }
    }
    const viewer = sim.players[f.viewId] ?? sim.player;
    if (viewer.lastHurt !== this.lastHurtSeen) {
      this.lastHurtSeen = viewer.lastHurt;
      this.hurt = 1;
    }
    // light
    const w = this.world;
    w.grid.update(sim, t);
    this.fixtures.update();
    this.lightning = 0;
    for (let i = this.flashes.length - 1; i >= 0; i--) {
      const fl = this.flashes[i]!;
      const age = t - fl.at;
      if (age < 0) continue;
      if (age > 1.2) {
        this.flashes.splice(i, 1);
        continue;
      }
      this.lightning = Math.max(this.lightning, fl.s * Math.exp(-age * 6) * (age < 0.05 ? age / 0.05 : 1));
    }
    w.grid.uniforms.gridLightning.value = this.lightning * 1.6;
    w.outsideUniforms.uTime.value = t;
    w.outsideUniforms.uLightning.value = this.lightning;
    w.outsideUniforms.uHeadlights.value = sim.objectives.arrived ? 0.5 + 0.5 * Math.sin(t * 0.6) : 0;
    // the camera
    this.placeCamera(sim, viewer, f);
    // the torch
    this.updateTorch(sim, viewer, dt, t);
    // world
    this.objects.update(sim, dt, t);
    this.actors.update(sim, dt, t, { viewer, camPos: this.camera.position, wallClock: t });
    w.sky.update(this.camera, t, this.lightning);
    w.rain.update(this.camera.position, t, this.lightning);
    this.fog(sim, viewer);
    // grade
    this.updatePost(sim, viewer, dt, t);
    this.post.frame(dt);
    this.adapt(dt);
  }

  private placeCamera(sim: Sim, pl: Player, f: RenderFrame): void {
    const cam = this.camera;
    const dt = f.dt;
    const t = f.t;
    this.eye += (pl.eye - this.eye) * (1 - Math.exp(-dt * 10));
    let px = pl.pos.x;
    let pz = pl.pos.y;
    let py = eyeHeight(this.eye);
    let yaw = pl.angle;
    let pitch = pl.pitch;
    let roll = 0;
    // hiding: inside the locker, the drawer, under the bed
    const spot = pl.hidden ?? pl.transition?.spot ?? null;
    if (spot) {
      const inside = this.hidePosition(sim, spot);
      let k = 1;
      if (pl.transition) {
        const p = Math.min(1, pl.transition.t / pl.transition.dur);
        k = pl.transition.entering ? p : 1 - p;
      }
      k = k * k * (3 - 2 * k);
      const acc = cellCenter(sim.level, spot.access);
      const ox = pl.transition ? acc.x : pl.pos.x;
      const oz = pl.transition ? acc.y : pl.pos.y;
      px = ox + (inside.x - ox) * k;
      pz = oz + (inside.z - oz) * k;
      py = eyeHeight(0.5) + (inside.y - eyeHeight(0.5)) * k;
    } else if (pl.alive && !f.attract) {
      // walking: bob and sway; standing: breath
      const moving = pl.speed > 0.3;
      const amp = pl.sprinting ? 0.024 : pl.crouching ? 0.008 : 0.014;
      if (moving) {
        py += Math.sin(pl.bob) * amp;
        const sway = Math.cos(pl.bob * 0.5) * amp * 0.6;
        px += -Math.sin(yaw) * sway;
        pz += Math.cos(yaw) * sway;
        roll += Math.cos(pl.bob * 0.5) * amp * 0.5;
      }
      py += Math.sin(t * (1.1 + pl.exertion * 2.2)) * (0.003 + pl.exertion * 0.008);
    }
    // death: you go down, and the last thing you see is it
    if (!pl.alive && this.deathAt >= 0) {
      const k = Math.min(1, (t - this.deathAt) / 1.4);
      const e = k * k;
      py += (0.12 - py) * e;
      roll += e * 1.15;
      pitch += e * 0.5;
    }
    // shake
    this.shake = Math.max(0, this.shake - dt * 1.6);
    const s = this.shake * this.shake;
    if (s > 0) {
      px += (hash1(t * 61) - 0.5) * 0.05 * s;
      py += (hash1(t * 53 + 4) - 0.5) * 0.05 * s;
      yaw += (hash1(t * 47 + 9) - 0.5) * 0.06 * s;
      pitch += (hash1(t * 43 + 2) - 0.5) * 0.05 * s;
    }
    cam.position.set(px, py, pz);
    this.look.set(Math.cos(yaw) * Math.cos(pitch), Math.sin(pitch), Math.sin(yaw) * Math.cos(pitch));
    if (!pl.alive && this.deathAt >= 0 && sim.entity) {
      // turn toward its face
      const head = this.actors.entityHead(this.tmp);
      const toward = head.sub(cam.position).normalize();
      const k = Math.min(1, (t - this.deathAt) / 0.6);
      this.look.lerp(toward, k * 0.85).normalize();
    }
    cam.up.copy(this.up);
    cam.lookAt(cam.position.x + this.look.x, cam.position.y + this.look.y, cam.position.z + this.look.z);
    if (roll) cam.rotateZ(roll);
    cam.updateMatrixWorld();
    // field of view: a punch on scares, a little wider when you run
    this.fovPunch *= Math.exp(-dt * 5);
    const hf = SCREEN_HFOV + (pl.sprinting ? 0.05 : 0) + (this.fovPunch * Math.PI) / 180;
    const vf = horizontalToVerticalFov(hf, cam.aspect);
    if (Math.abs(cam.fov - vf) > 0.01) {
      cam.fov += (vf - cam.fov) * (1 - Math.exp(-dt * 8));
      cam.updateProjectionMatrix();
    }
    this.fpTorch.visible = pl.alive && !pl.hidden && !pl.transition && !f.attract;
    if (this.fpTorch.visible) {
      const moving = pl.speed > 0.3;
      this.fpTorch.position.set(0.13 + (moving ? Math.cos(pl.bob * 0.5) * 0.008 : 0), -0.14 + (moving ? Math.sin(pl.bob) * 0.006 : 0), -0.21);
    }
  }

  private hidePosition(sim: Sim, spot: NonNullable<Player['hidden']>): THREE.Vector3 {
    const A = this.world.anchors;
    if (spot.kind === 'locker') {
      const f = A.lockers.get(spot.cell);
      if (f) {
        const p = f.at(0, eyeHeight(0.5) - 0.02, -0.21);
        return new THREE.Vector3(p[0], p[1], p[2]);
      }
    } else if (spot.kind === 'drawer') {
      const f = A.drawers.get(spot.cell);
      if (f) {
        const p = f.at(0, 0.74, -0.45);
        return new THREE.Vector3(p[0], p[1], p[2]);
      }
    } else {
      const c = cellCenter(sim.level, spot.cell);
      return new THREE.Vector3(c.x, 0.17, c.y);
    }
    const c = cellCenter(sim.level, spot.access);
    return new THREE.Vector3(c.x, eyeHeight(0.5), c.y);
  }

  private updateTorch(sim: Sim, pl: Player, dt: number, t: number): void {
    const fl = pl.flashlight;
    let power = 0;
    if (fl.on) {
      power = fl.battery < 0.25 ? 0.35 + fl.battery * 2.6 : 1;
      if (fl.battery < 0.2 && hash1(Math.floor(t * 14)) < 0.18) power *= 0.25;
    } else if (sim.time < fl.faultUntil) {
      power = hash1(Math.floor(t * 20)) < 0.12 ? 0.6 : 0;
    }
    // in a locker or a drawer the torch is pointed at your feet: no light leaks but a little
    if (pl.hidden && pl.hidden.kind !== 'bed') power *= 0.0;
    if (pl.transition && pl.transition.spot.kind !== 'bed') power *= pl.transition.entering ? 1 - pl.transition.t / pl.transition.dur : pl.transition.t / pl.transition.dur;
    if (!pl.alive) power *= Math.max(0, 1 - (t - this.deathAt) / 1.5);
    if (this.torchOverride) {
      if (t > this.torchOverride.until) this.torchOverride = null;
      else power *= this.torchOverride.fn(t);
    }
    const cam = this.camera;
    // the beam leaves the lens of the torch in your hand, in front of it (so it never lights the torch)
    const origin = new THREE.Vector3(0.13, -0.135, -0.34).applyMatrix4(cam.matrixWorld);
    const aim = new THREE.Vector3(0, 0.02, -1).normalize().transformDirection(cam.matrixWorld);
    let reach = this.beamReach(sim, origin, aim);
    // the beam stops at the Entity (or what you think is the Entity) when it is in the way
    for (const body of this.actors.bodiesInView(this.tmp)) {
      const to = body.sub(origin);
      const along = to.dot(aim);
      if (along > 0.05 && along < reach && to.addScaledVector(aim, -along).length() < 0.32 + along * 0.43) reach = along;
    }
    this.torch.update(origin, aim, { on: power > 0, power }, dt, t, reach, pl.hidden ? 40 : 16);
    const lensMat = (this.fpTorch.children[2] as THREE.Mesh).material as THREE.MeshBasicMaterial;
    lensMat.color.setScalar(0.15 + power * 3.5);
  }

  /** How far the beam runs before it meets a wall, the floor or the ceiling. */
  private beamReach(sim: Sim, o: THREE.Vector3, d: THREE.Vector3): number {
    let reach = 9;
    if (d.y < -0.02) reach = Math.min(reach, o.y / -d.y);
    if (d.y > 0.02) reach = Math.min(reach, (WALL_H - o.y) / d.y);
    const h = Math.hypot(d.x, d.z);
    if (h > 1e-3) {
      for (let s = 0.2; s < reach * h; s += 0.2) {
        const c = cellAt(sim.level, { x: o.x + (d.x / h) * s, y: o.z + (d.z / h) * s });
        if (c < 0 || sim.world.isOpaque(c)) {
          reach = Math.min(reach, s / h);
          break;
        }
      }
    }
    return reach;
  }

  private fog(sim: Sim, pl: Player): void {
    const fog = this.world.scene.fog as THREE.FogExp2;
    const z = sim.level.zoneOf[pl.soundCell] ?? -1;
    const zone = z >= 0 ? sim.level.zones[z]! : null;
    const target = zone?.exterior ? 0.05 : zone?.cold ? 0.085 : 0.068;
    fog.density += (target - fog.density) * 0.03;
  }

  private updatePost(sim: Sim, pl: Player, dt: number, t: number): void {
    const u = this.post.uniforms;
    u.uTime.value = t;
    this.scare = Math.max(0, this.scare - dt * 2.2);
    this.hurt = Math.max(0, this.hurt - dt * 0.9);
    u.uScare.value = this.scare;
    u.uHurt.value = Math.max(this.hurt, pl.wounded ? 0.12 + 0.06 * Math.sin(t * 3.2) : 0);
    let vision = 0;
    if (t < this.visionEnd) {
      const a = Math.min(1, (t - this.visionStart) / 0.9);
      const b = Math.min(1, (this.visionEnd - t) / 1.2);
      vision = Math.min(a, b);
    }
    u.uVision.value = vision;
    // holding your breath narrows the world (by time held, not by what you have left)
    const held = pl.breath.holding ? pl.breath.held : 0;
    u.uBreath.value = Math.max(0, Math.min(1, (held - 2.5) / 6));
    u.uDeath.value = !pl.alive && this.deathAt >= 0 ? Math.min(1, (t - this.deathAt) / 2.4) : 0;
    let fade = 0;
    if (pl.transition) {
      const p = pl.transition.t / pl.transition.dur;
      fade = Math.sin(Math.PI * Math.min(1, p)) * 0.55;
    }
    u.uFade.value = fade;
    u.uWarp.value = pl.exertion * 0.4;
    u.uGrain.value = 0.065;
    this.exposure += ((vision > 0 ? 1.9 : 1.05) - this.exposure) * (1 - Math.exp(-dt * 3));
    this.renderer.toneMappingExposure = this.exposure * this.brightness;
    void sim;
  }

  /** Dynamic resolution: keep frames under ~20 ms by trading pixels, never effects. */
  private adapt(dt: number): void {
    this.frameTimes.push(dt);
    if (this.frameTimes.length < 90) return;
    const avg = this.frameTimes.reduce((a, b) => a + b, 0) / this.frameTimes.length;
    this.frameTimes.length = 0;
    const before = this.scale;
    if (avg > 0.024) this.scale = Math.max(this.quality.minScale, this.scale - 0.08);
    else if (avg < 0.014) this.scale = Math.min(1, this.scale + 0.05);
    if (this.scale !== before) this.resize();
  }

  /** Recreate everything at a new quality (textures, shadows, effects). */
  async setQuality(q: QualityName, level: Level, onProgress?: (k: number) => void): Promise<void> {
    this.ready = false;
    this.world.dispose();
    this.post.dispose();
    this.torch.dispose();
    this.quality = QUALITY[q];
    this.boundSim = null;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, this.quality.pixelRatio));
    this.camera.remove(this.fpTorch);
    this.fpTorch.clear();
    await this.init(level, onProgress);
  }
}

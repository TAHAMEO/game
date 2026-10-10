import * as THREE from 'three';
import type { Pose } from '../core/entity';
import { dist, type Vec2 } from '../core/math';
import type { Player } from '../core/player';
import type { Sim } from '../core/sim';
import { animateEntity, animateHuman, buildEntity, buildHuman, type EntityModel, type HumanLook, type HumanModel, type HumanPose } from './characters';
import { eyeHeight } from './constants';
import { Torch } from './flashlight';
import type { MaterialKit } from './materials';

const hash = (n: number) => {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return s - Math.floor(s);
};
const nameHash = (s: string) => {
  let h = 7;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h;
};

const SKINS = [0xd8b094, 0xc28c6c, 0x8d5a3c, 0x6a4028, 0xe6c4a8, 0xa87454];
const HAIR = [0x1a1410, 0x3a2a1c, 0x6a4a2a, 0x8a8278, 0x2a2220, 0xb08a5a];

/** What each of the night staff wears (other players see it). */
export function lookFor(name: string): HumanLook {
  const h = nameHash(name);
  const skin = SKINS[h % SKINS.length]!;
  const hair = HAIR[(h >> 3) % HAIR.length]!;
  const role = name.split(' ')[0]!.toLowerCase();
  switch (role) {
    case 'nurse':
      return { top: h % 2 ? 0x24406a : 0x2f6e72, bottom: h % 2 ? 0x1f3658 : 0x285e62, skin, hair };
    case 'dr.':
      return { top: 0x5a7da0, bottom: 0x2e3440, skin, hair, coat: true };
    case 'orderly':
      return { top: 0x8fb8a0, bottom: 0x7aa88e, skin, hair };
    case 'clerk':
      return { top: 0xa89470, bottom: 0x4a3c30, skin, hair };
    case 'security':
      return { top: 0x1e2a44, bottom: 0x18203a, skin, hair };
    case 'cleaner':
      return { top: 0x6e2a32, bottom: 0x3a2a2a, skin, hair };
    case 'paramedic':
      return { top: 0x2f5e3a, bottom: 0x24402c, skin, hair };
    case 'chaplain':
      return { top: 0x16161a, bottom: 0x16161a, skin, hair };
    default:
      return { top: 0x5a6068, bottom: 0x2c3036, skin, hair };
  }
}

interface EntityInstance {
  model: EntityModel;
  phase: number;
  yaw: number;
  tiltSide: number;
  lastTell: number;
}

interface HumanInstance {
  model: HumanModel;
  phase: number;
  yaw: number;
  torch: Torch | null;
}

/**
 * The living things in the world: the Entity (and whoever it is wearing), the shapes your
 * panic shows you — drawn with the Entity's own model, identically — survivors, and in a
 * shared run the other players, each with their own torch lighting the dark.
 */
export class Actors3D {
  readonly group = new THREE.Group();
  private readonly entity: EntityInstance;
  private readonly phantoms: EntityInstance[] = [];
  private readonly apparition: EntityInstance;
  private apparitionUntil = -1;
  private apparitionPose: Pose = 'idle';
  private readonly survivors = new Map<number, HumanInstance>();
  private readonly disguises = new Map<number, HumanInstance>();
  private readonly players = new Map<number, HumanInstance>();
  private readonly corpses = new Map<number, HumanInstance>();
  private readonly v = new THREE.Vector3();
  private sim: Sim | null = null;

  constructor(
    private readonly kit: MaterialKit,
    private readonly scene: THREE.Scene,
    private readonly cookie: THREE.Texture,
  ) {
    this.group.name = 'actors';
    const mk = (): EntityInstance => {
      const model = buildEntity(kit);
      model.root.visible = false;
      this.group.add(model.root);
      return { model, phase: 0, yaw: 0, tiltSide: 1, lastTell: -1 };
    };
    this.entity = mk();
    for (let i = 0; i < 3; i++) this.phantoms.push(mk());
    this.apparition = mk();
  }

  private bind(sim: Sim): void {
    this.sim = sim;
    for (const m of [...this.survivors.values(), ...this.disguises.values(), ...this.players.values(), ...this.corpses.values()]) {
      this.group.remove(m.model.root);
      if (m.torch) {
        m.torch.dispose();
        this.scene.remove(m.torch.light, m.torch.target, m.torch.beam);
      }
    }
    this.survivors.clear();
    this.disguises.clear();
    this.players.clear();
    this.corpses.clear();
    for (const sv of sim.survivors.list) {
      const look: HumanLook = { top: rgb(sv.def.color), bottom: rgb(sv.def.color, 0.8), skin: SKINS[sv.id * 2 + 1]!, hair: HAIR[sv.id + 1]! };
      this.survivors.set(sv.id, this.human(look, false));
      // the thing that wears them uses the same clothes, the same face
      this.disguises.set(sv.id, this.human(look, false));
    }
  }

  private human(look: HumanLook, torch: boolean): HumanInstance {
    const model = buildHuman(this.kit, look);
    model.root.visible = false;
    this.group.add(model.root);
    let t: Torch | null = null;
    if (torch) t = new Torch(this.scene, { shadows: 0, volumetric: true, dust: 0, cookie: this.cookie, local: false });
    return { model, phase: 0, yaw: 0, torch: t };
  }

  /** A scare's apparition: the Entity, somewhere it isn't, for a moment [scares]. */
  showApparition(pos: Vec2, faceToward: Vec2, pose: Pose, until: number, t: number): void {
    const a = this.apparition;
    a.model.root.visible = true;
    a.model.root.position.set(pos.x, 0, pos.y);
    a.yaw = Math.PI / 2 - Math.atan2(faceToward.y - pos.y, faceToward.x - pos.x);
    a.model.root.rotation.y = a.yaw;
    this.apparitionUntil = until;
    this.apparitionPose = pose;
    void t;
  }

  hideApparition(): void {
    this.apparitionUntil = -1;
    this.apparition.model.root.visible = false;
  }

  /** The Entity's head in world space (for the camera's death and scare framing). */
  entityHead(out: THREE.Vector3): THREE.Vector3 {
    return this.entity.model.rig.j('head').getWorldPosition(out);
  }

  update(sim: Sim, dt: number, t: number, view: { viewer: Player; camPos: THREE.Vector3; wallClock: number }): void {
    if (this.sim !== sim) this.bind(sim);
    const camPos2 = { x: view.camPos.x, y: view.camPos.z };
    // ------------------------------------------------------------ the Entity, or its disguise
    const e = sim.entity;
    const dCam = dist(e.pos, camPos2);
    const disguised = e.disguise !== null && dCam > 5.5;
    for (const [id, d] of this.disguises) {
      const on = disguised && e.disguise === id;
      d.model.root.visible = on;
      if (on) this.placeHuman(d, e.pos, e.angle, e.pose === 'wave' ? 'wave' : 'idle', e.speedNow, dt, t, id + 9);
    }
    const ent = this.entity;
    ent.model.root.visible = !disguised && dCam > 0.12;
    if (ent.model.root.visible) {
      if (e.tell && e.tell.id !== ent.lastTell) {
        ent.lastTell = e.tell.id;
        ent.tiltSide = e.tell.id % 2 ? 1 : -1;
      }
      this.placeEntity(ent, e.pos, e.angle, e.pose, e.speedNow, dt, t, 0.37, e.stateKind === 'lunge' ? 30 : 7);
    }
    // ------------------------------------------------------------ what only you see [S]
    const phantoms = view.viewer.perception.phantoms;
    this.phantoms.forEach((p, i) => {
      const ph = phantoms[i];
      p.model.root.visible = !!ph;
      if (!ph) return;
      const pose: Pose = ph.pose === 'walk' ? 'walk' : ph.pose === 'tilt' ? 'tilt' : 'idle';
      this.placeEntity(p, ph.pos, ph.angle, pose, ph.pose === 'walk' ? 1.1 : 0, dt, t, 0.71 + i, 20);
    });
    if (this.apparitionUntil >= 0) {
      if (view.wallClock > this.apparitionUntil) this.hideApparition();
      else {
        const a = this.apparition;
        a.phase = animateEntity(a.model, { pose: this.apparitionPose as never, speed: 0, t, dt, seed: 0.9, phase: a.phase, tiltSide: 1 });
      }
    }
    // ------------------------------------------------------------ survivors
    for (const sv of sim.survivors.list) {
      const inst = this.survivors.get(sv.id);
      if (!inst) continue;
      const on = sv.alive && !sv.spot;
      inst.model.root.visible = on;
      if (!on) continue;
      const facing = Math.atan2(camPos2.y - sv.pos.y, camPos2.x - sv.pos.x);
      this.placeHuman(inst, sv.pos, facing, sv.waving ? 'wave' : 'scared', 0, dt, t, sv.id);
    }
    // ------------------------------------------------------------ the others in a shared run
    for (const p of sim.players) {
      if (p === view.viewer) continue;
      let inst = this.players.get(p.id);
      if (!inst) {
        inst = this.human(lookFor(p.name), true);
        this.players.set(p.id, inst);
      }
      const visible = p.active && !p.hidden;
      inst.model.root.visible = visible;
      if (inst.torch) inst.torch.light.visible = false;
      if (!p.alive) {
        let c = this.corpses.get(p.id);
        if (!c) {
          c = this.human(lookFor(p.name), false);
          this.corpses.set(p.id, c);
          c.model.root.position.set(p.pos.x, 0, p.pos.y);
          c.model.root.rotation.y = hash(p.id) * 6.28;
          for (let i = 0; i < 6; i++) animateHuman(c.model, { pose: 'dead', speed: 0, t: i, dt: 1, seed: p.id, phase: 0 });
        }
        c.model.root.visible = !p.hidden;
      }
      if (!visible) {
        if (inst.torch) inst.torch.update(this.v.set(0, -10, 0), this.v, { on: false, power: 0 }, dt, t, 0);
        continue;
      }
      const pose: HumanPose = p.crouching ? 'crouch' : p.sprinting ? 'run' : 'torch';
      this.placeHuman(inst, p.pos, p.angle, pose, p.speed, dt, t, p.id + 3, p.pitch);
      // their torch, from their hand, where they are looking
      if (inst.torch) {
        const fl = p.flashlight;
        const on = fl.on && fl.battery > 0.01;
        const origin = new THREE.Vector3();
        inst.model.torchMount.getWorldPosition(origin);
        const aim = new THREE.Vector3(Math.cos(p.angle) * Math.cos(p.pitch), Math.sin(p.pitch), Math.sin(p.angle) * Math.cos(p.pitch));
        inst.torch.update(origin, aim, { on, power: fl.battery < 0.25 ? 0.35 + fl.battery * 2.6 : 1 }, dt, t, 6, 20);
      }
      void eyeHeight;
    }
  }

  private placeEntity(inst: EntityInstance, pos: Vec2, angle: number, pose: Pose, speed: number, dt: number, t: number, seed: number, turnRate: number): void {
    const root = inst.model.root;
    root.position.set(pos.x, 0, pos.y);
    const target = Math.PI / 2 - angle;
    inst.yaw = turnAngle(inst.yaw, target, dt * turnRate);
    root.rotation.y = inst.yaw;
    inst.phase = animateEntity(inst.model, { pose: pose as never, speed, t, dt, seed, phase: inst.phase, tiltSide: inst.tiltSide });
  }

  private placeHuman(inst: HumanInstance, pos: Vec2, angle: number, pose: HumanPose, speed: number, dt: number, t: number, seed: number, pitch?: number): void {
    const root = inst.model.root;
    root.position.set(pos.x, 0, pos.y);
    const target = Math.PI / 2 - angle;
    inst.yaw = turnAngle(inst.yaw, target, dt * 10);
    root.rotation.y = inst.yaw;
    const anim: Parameters<typeof animateHuman>[1] = { pose, speed, t, dt, seed, phase: inst.phase };
    if (pitch !== undefined) anim.pitch = pitch;
    inst.phase = animateHuman(inst.model, anim);
  }
}

function rgb(c: [number, number, number], k = 1): THREE.Color {
  return new THREE.Color((c[0] / 255) * k, (c[1] / 255) * k, (c[2] / 255) * k);
}

function turnAngle(a: number, b: number, max: number): number {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  if (Math.abs(d) <= max) return b;
  return a + Math.sign(d) * max;
}

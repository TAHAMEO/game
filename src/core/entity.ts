import { TUNING } from './config';
import { cellAt, cellCenter, Tile } from './level';
import { angleDiff, angleTo, clamp01, dist, lerp, smoothstep, turnToward, wrapAngle, type Vec2 } from './math';
import { findPath } from './path';
import type { MoveMode, Plan, PlanStep } from './plans';
import type { Sim } from './sim';
import type { FogPuff, HidingSpot, Item, Noise, ThermalMark } from './types';
import { World } from './world';

export type TellKind = 'tilt' | 'inhale' | 'turn' | 'snap';

/** Body language [B]. A tell is a fact about intent — unless it's a lie [Y]. */
export interface Tell {
  id: number;
  kind: TellKind;
  t0: number;
  dur: number;
  fake: boolean;
}

export type Pose = 'idle' | 'walk' | 'tilt' | 'inhale' | 'turnaway' | 'lunge' | 'reach' | 'crouch' | 'feed' | 'wave';

export type EntityState =
  | { kind: 'rest'; until: number }
  | { kind: 'roam'; dest: number; pauseUntil: number }
  | { kind: 'listen'; until: number; fake: boolean; resume: EntityState }
  | { kind: 'investigate'; target: Vec2; precise: boolean; reason: string; arrived: boolean; lookUntil: number; checks: number[] }
  | { kind: 'hunt'; center: Vec2; radius: number; until: number; point: number; reason: string; checks: number[]; trail: number }
  | { kind: 'chase'; lostAt: number; survivor: number | null }
  | { kind: 'lunge'; t: number; struck: boolean; recover: number; survivor: number | null }
  | { kind: 'check'; spot: number; phase: 'approach' | 'inhale' | 'open' | 'linger'; t: number; fake: boolean; certain: boolean; reason: string; queue: number[] }
  | { kind: 'leave'; phase: 'turn' | 'walk'; t: number; dest: number; fake: boolean; from: Vec2 }
  | { kind: 'feint'; until: number; origin: Vec2 }
  | { kind: 'plan'; plan: Plan; step: number; t: number; arrived: boolean }
  | { kind: 'feed'; until: number }
  | { kind: 'retreat'; dest: number; then: 'rest' | 'feed' }
  | { kind: 'kill'; t: number; victim: 'player' | number; spot: number | null }
  | { kind: 'mimic'; survivor: number; cell: number; until: number; nextCall: number; arrived: boolean };

interface Percepts {
  vis: number;
  beamOnMe: boolean;
  sound: { noise: Noise; pos: Vec2; margin: number } | null;
  thermal: ThermalMark | null;
  fog: FogPuff | null;
  scent: Vec2 | null;
  survivor: number | null;
}

const E = TUNING.entity;
/** Attunement only applies to sounds that physically reached it. */
const lv0 = (n: Noise): boolean => (n.entityLevel ?? 0) > 0;
const LOUD = TUNING.loudness;

const HEAR_BASE: Record<EntityState['kind'], number> = {
  rest: 20,
  feed: 21,
  roam: 15,
  retreat: 15,
  plan: 13,
  leave: 13,
  listen: 5,
  investigate: 10,
  hunt: 10,
  check: 11,
  chase: 12,
  lunge: 30,
  kill: 40,
  feint: 6,
  mimic: 9,
};
/** A plan waiting in ambush listens harder than one on the move. */
const HEAR_AMBUSH = 8;

export class Entity {
  pos: Vec2;
  angle = 0;
  state: EntityState;
  stateT = 0;
  /** Accumulated certainty that it is seeing you (0..1+). */
  suspicion = 0;
  lkp: Vec2 | null = null;
  lkpT = -999;
  tell: Tell | null = null;
  pose: Pose = 'idle';
  /** Survivor it is currently wearing [X]. */
  disguise: number | null = null;
  carrying: Item | null = null;
  /** Dragging a survivor's body home [W]. */
  carryingBody: number | null = null;
  /** Human-readable reason for its current behaviour (designer overlay). */
  reason = 'waking';
  moving = false;
  speedNow = 0;
  sawHideSpot: number | null = null;
  private nav = { goal: -1, path: [] as number[], repathAt: 0, mode: 'roam' as MoveMode };
  private stepAccum = 0;
  private nextScent = 0;
  private nextThermalScan = 0;
  private trailT = -999;
  private tellSeq = 1;
  private lastBeamRespect = -999;
  private percepts: Percepts = { vis: 0, beamOnMe: false, sound: null, thermal: null, fog: null, scent: null, survivor: null };
  private lastNoiseId = 0;
  private closingPlan = false;

  constructor(private readonly sim: Sim) {
    const nest = sim.level.markers.nest;
    const start = nest.length ? nest[0]! : sim.level.spawn;
    this.pos = cellCenter(sim.level, start);
    // The first stretch of a run is genuinely quiet [Z].
    this.state = { kind: 'rest', until: 45 };
  }

  get cell(): number {
    return cellAt(this.sim.level, this.pos);
  }

  get stateKind(): EntityState['kind'] {
    return this.state.kind;
  }

  /** Is it actively looking for, or at, someone? (encounter bookkeeping) */
  get threatening(): boolean {
    const k = this.state.kind;
    return k === 'chase' || k === 'lunge' || k === 'hunt' || k === 'investigate' || k === 'check' || k === 'listen' || k === 'feint' || k === 'kill';
  }

  hearingThreshold(): number {
    const d = this.sim.director;
    return (this.planIsCommitted() ? HEAR_AMBUSH : HEAR_BASE[this.state.kind]) - 7 * d.floor + d.hearingShift();
  }

  // ===================================================================== update

  update(dt: number): void {
    const sim = this.sim;
    this.stateT += dt;
    this.moving = false;
    if (this.tell && sim.time > this.tell.t0 + this.tell.dur) this.tell = null;
    this.sense(dt);
    this.react(dt);
    this.tick(dt);
    if (!this.moving) this.speedNow = 0;
    this.pose = this.computePose();
  }

  private setState(s: EntityState, reason: string): void {
    const prevState = this.state;
    const prev = prevState.kind;
    // A head-tilt only pauses a plan: it ends when it does not go back to it.
    const leaving = prevState.kind === 'plan' ? prevState : prevState.kind === 'listen' && prevState.resume.kind === 'plan' ? prevState.resume : null;
    const pausing = s.kind === 'listen' && s.resume === leaving;
    if (leaving && leaving !== s && !pausing && !this.closingPlan) {
      // Perception pulled it off the plan: whatever it was carrying hits the floor.
      this.dropCarried();
      const step = leaving.plan.steps[leaving.step];
      const sprung = step?.op === 'ambush' && leaving.arrived && (s.kind === 'chase' || s.kind === 'investigate' || s.kind === 'lunge');
      this.sim.director.onPlanFinished(leaving.plan, s.kind === 'mimic' ? 'done' : sprung ? 'sprung' : 'interrupted');
    }
    this.state = s;
    this.stateT = 0;
    this.reason = reason;
    this.nav.goal = -1;
    if (s.kind !== 'mimic') this.disguise = null;
    if (prev !== s.kind) this.sim.director.onEntityState(prev, s.kind, reason);
    this.sim.log('entity', `${s.kind}: ${reason}`);
  }

  private startTell(kind: TellKind, dur: number, fake: boolean): Tell {
    const sim = this.sim;
    const tell: Tell = { id: this.tellSeq++, kind, t0: sim.time, dur, fake };
    this.tell = tell;
    const sound = kind === 'tilt' ? 'tilt' : kind === 'inhale' ? 'inhale' : kind === 'turn' ? 'sigh' : 'snap';
    const loud = kind === 'snap' ? 34 : kind === 'inhale' ? 22 : kind === 'turn' ? 16 : 18;
    const n = sim.emitNoise(sound, this.pos, loud, 'entity');
    sim.director.onTell(tell, n.playerLevel ?? 0);
    return tell;
  }

  // ===================================================================== senses [A, V]

  private sense(dt: number): void {
    const sim = this.sim;
    const p: Percepts = { vis: 0, beamOnMe: false, sound: null, thermal: null, fog: null, scent: null, survivor: null };
    const sight = this.sightOfPlayer();
    p.vis = sight.vis;
    p.beamOnMe = sight.beam;

    // Hearing: everything not yet processed, loudest margin wins.
    const threshold = this.hearingThreshold();
    for (const n of sim.recentNoises) {
      if (n.id <= this.lastNoiseId) continue;
      if (n.source === 'entity') continue;
      const lv = (n.entityLevel ?? 0) + (lv0(n) ? sim.director.attunement(n) : 0);
      const margin = lv - threshold;
      if (margin < 0) continue;
      if (sim.director.ignoresNoise(n)) continue;
      if (!p.sound || margin > p.sound.margin) {
        const err = Math.max(0.25, Math.min(3, (1 - margin / 25) * 2.6));
        const a = sim.rng.range(0, Math.PI * 2);
        const r = sim.rng.range(0, err);
        let pos = { x: n.pos.x + Math.cos(a) * r, y: n.pos.y + Math.sin(a) * r };
        if (sim.world.isSolid(cellAt(sim.level, pos))) pos = { ...n.pos };
        p.sound = { noise: n, pos, margin };
      }
    }
    if (sim.recentNoises.length) this.lastNoiseId = Math.max(this.lastNoiseId, sim.recentNoises[sim.recentNoises.length - 1]!.id);

    // [V] Thermal residue — only read while actively hunting.
    const k = this.state.kind;
    const hunting = k === 'hunt' || k === 'investigate' || k === 'check' || (k === 'chase' && sight.vis === 0);
    if (sim.features.thermalResidue && hunting && sim.time >= this.nextThermalScan) {
      this.nextThermalScan = sim.time + 0.4;
      let best: ThermalMark | null = null;
      for (const m of sim.world.thermal) {
        if (m.t <= this.trailT) continue;
        if (World.heatOf(m, sim.time) < 0.18) continue;
        if (dist(this.pos, m.pos) > 7) continue;
        if (!this.seesSurface(m.cell, m.pos)) continue;
        if (!best || m.t > best.t) best = m;
      }
      p.thermal = best;
    }

    // [V] Breath fog: a slow, silent beacon.
    if (sim.features.breathFog && k !== 'rest' && k !== 'feed') {
      for (const f of sim.world.fog) {
        const d = dist(this.pos, f.pos);
        const lit = sim.world.lighting.sample(f.pos);
        const range = lit > 0.05 ? 11 : 5;
        if (d > range) continue;
        if (!this.seesPoint(f.pos, this.fov())) continue;
        p.fog = f;
        break;
      }
    }

    // [V] The mark: it tracks you across zones without sight or sound.
    if (sim.features.theMark && sim.player.isMarked && sim.time >= this.nextScent) {
      this.nextScent = sim.time + 3.5;
      const pp = sim.player.hidden ? cellCenter(sim.level, sim.player.hidden.access) : sim.player.pos;
      p.scent = { x: pp.x + sim.rng.range(-1, 1), y: pp.y + sim.rng.range(-1, 1) };
      if (sim.world.isSolid(cellAt(sim.level, p.scent))) p.scent = { ...pp };
    }

    // Survivors in the open are prey too [L, X].
    for (const sv of sim.survivors.list) {
      if (!sv.alive || sv.spot) continue;
      const d = dist(this.pos, sv.pos);
      if (d > 12) continue;
      const lit = sim.world.lighting.sample(sv.pos);
      if (d > lerp(3, 12, smoothstep(0.02, 0.4, lit))) continue;
      if (this.seesPoint(sv.pos, this.fov())) {
        p.survivor = sv.id;
        break;
      }
    }
    this.percepts = p;
    void dt;
  }

  fov(): number {
    const k = this.state.kind;
    if (k === 'feint') return Math.PI * 2;
    if (k === 'hunt' || k === 'chase' || k === 'investigate' || k === 'check' || k === 'mimic' || this.planIsCommitted()) return E.fovHunt;
    if (k === 'rest' || k === 'feed') return E.fovRoam * 0.6;
    return E.fovRoam;
  }

  /**
   * Prints sit on doors and locker latches — opaque cells. It sees the *face* of the
   * surface: a point just in front of it, on its own side.
   */
  seesSurface(cell: number, pt: Vec2): boolean {
    const { level, world } = this.sim;
    let face = pt;
    const door = world.doorAt.get(cell);
    const wo = level.wallObjectAt.get(cell);
    const toward = (side: number) => {
      const c = cellCenter(level, cell);
      const s = cellCenter(level, side);
      return { x: c.x + (s.x - c.x) * 0.55, y: c.y + (s.y - c.y) * 0.55 };
    };
    if (door) {
      const [a, b] = door.sides;
      face = toward(dist(cellCenter(level, a), this.pos) <= dist(cellCenter(level, b), this.pos) ? a : b);
    } else if (wo) face = toward(wo.access);
    if (dist(this.pos, face) < 0.3) return true;
    return world.los(this.pos, face);
  }

  seesPoint(pt: Vec2, fov: number): boolean {
    const a = Math.abs(angleDiff(this.angle, angleTo(this.pos, pt)));
    if (a > fov / 2) return false;
    return this.sim.world.los(this.pos, pt);
  }

  /** How visible is the player to it right now? Light, stance, motion, the torch [A, S]. */
  sightOfPlayer(): { vis: number; beam: boolean } {
    const sim = this.sim;
    const pl = sim.player;
    if (!pl.alive || !pl.exposed) return { vis: 0, beam: false };
    const d = dist(this.pos, pl.pos);
    if (d > 26) return { vis: 0, beam: false };
    const los = sim.world.los(this.pos, pl.pos);
    if (!los) return { vis: 0, beam: this.beamSpotSeen() };
    const inFov = Math.abs(angleDiff(this.angle, angleTo(this.pos, pl.pos))) <= this.fov() / 2;
    let vis = 0;
    if (inFov) {
      // A lit torch lights you, too: you are a beacon in the dark [S].
      const light = sim.world.lighting.sample(pl.pos) + (pl.flashlight.on ? 0.2 : 0);
      const lt = smoothstep(0.015, 0.4, light);
      const range = lerp(3.2, E.sightRange, lt) * sim.director.sightMultiplier();
      if (d < range) vis = Math.pow(1 - d / range, 0.7);
      const stance = pl.crouching ? 0.6 : 1;
      const motion = pl.speed < 0.2 ? 0.55 : pl.sprinting ? 1.3 : 1;
      vis *= stance * motion;
    }
    if (d < 1.4) vis = Math.max(vis, 0.75);
    let beam = false;
    if (pl.flashlight.on) {
      const off = Math.abs(angleDiff(pl.angle, angleTo(pl.pos, this.pos)));
      if (off < 0.38 && d < 22) {
        beam = true;
        vis = Math.max(vis, 0.95 * (1 - d / 24) * sim.director.beamMultiplier());
      }
    }
    if (!beam && !inFov) return { vis: 0, beam: false };
    if (!beam && pl.flashlight.on) vis = Math.max(vis, this.beamSpotSeen() ? 0.25 : 0);
    return { vis: clamp01(vis), beam };
  }

  /** Can it see the spot your torch is painting on the wall? */
  private beamSpotSeen(): boolean {
    const sim = this.sim;
    const pl = sim.player;
    if (!pl.flashlight.on) return false;
    const d = pl.dir;
    let spot = { ...pl.pos };
    for (let s = 0.5; s <= 6; s += 0.5) {
      const q = { x: pl.pos.x + d.x * s, y: pl.pos.y + d.y * s };
      if (sim.world.isOpaque(cellAt(sim.level, q))) break;
      spot = q;
    }
    if (dist(this.pos, spot) > 16) return false;
    return this.seesPoint(spot, this.fov());
  }

  // ===================================================================== reactions

  private isPassive(): boolean {
    const k = this.state.kind;
    if (k === 'retreat' && this.carryingBody !== null) return false;
    return k === 'roam' || k === 'rest' || k === 'retreat' || k === 'leave' || k === 'feed' || (k === 'plan' && !this.planIsCommitted());
  }

  /** The ambush step a plan is on, with the killing ground it watches. */
  private trapStep(): Extract<PlanStep, { op: 'ambush' }> | null {
    if (this.state.kind !== 'plan') return null;
    const step = this.state.plan.steps[this.state.step];
    return step?.op === 'ambush' ? step : null;
  }

  private planIsCommitted(): boolean {
    if (this.state.kind !== 'plan') return false;
    const step = this.state.plan.steps[this.state.step];
    return !!step && step.op === 'ambush';
  }

  private react(dt: number): void {
    const sim = this.sim;
    const pc = this.percepts;
    const k = this.state.kind;
    if (k === 'lunge' || k === 'kill') return;
    const pl = sim.player;
    const floor = sim.director.floor;
    const ambushing = k === 'mimic' || k === 'feint' || this.planIsCommitted();

    // ---- the torch [S: flashlight tax]
    if (pc.beamOnMe && k !== 'chase') {
      const resp = sim.director.beamResponse();
      if (resp === 'respect' && sim.time - this.lastBeamRespect > 6) {
        this.lastBeamRespect = sim.time;
        sim.director.onBeamRespected();
        this.startLeave(false, 'the light is on it — it lets the light win (for now)');
        return;
      }
      if (resp === 'betray') {
        sim.director.onBeamBetrayal();
        this.suspicion = 1.2;
        this.lkp = { ...pl.pos };
        this.lkpT = sim.time;
        this.setState({ kind: 'chase', lostAt: sim.time, survivor: null }, 'it walks into the beam');
        return;
      }
    }

    // ---- sight
    if (pc.vis > 0) {
      const alert = k === 'hunt' || k === 'investigate' || k === 'check' || k === 'chase' || ambushing;
      this.suspicion += pc.vis * (alert ? 2.6 : 1.7) * (1 + 0.8 * floor) * dt;
      this.lkp = { ...pl.pos };
      this.lkpT = sim.time;
      if (pl.transition?.entering) this.sawHideSpot = pl.transition.spot.id;
      const d = dist(this.pos, pl.pos);
      if (k === 'mimic') return; // it wants you to come closer
      if (ambushing && (this.suspicion > 0.2 || d < 4)) {
        if (k === 'feint') sim.director.onFeintResolved(true);
        this.startTell('snap', 0.3, false);
        this.setState({ kind: 'chase', lostAt: sim.time, survivor: null }, ambushing ? 'the trap springs' : 'seen');
        return;
      }
      if (k !== 'chase' && (this.suspicion >= 1 || (d < 2.4 && pc.vis > 0.3))) {
        this.setState({ kind: 'chase', lostAt: sim.time, survivor: null }, 'it sees you');
        return;
      }
      if (this.suspicion >= 0.3 && this.state.kind === 'investigate') {
        this.state.target = { ...pl.pos };
        this.state.precise = true;
        this.state.arrived = false;
        return;
      }
      if (this.suspicion >= 0.3 && (this.isPassive() || k === 'hunt' || k === 'listen')) {
        this.investigate(pl.pos, true, 'a glimpse of movement');
        return;
      }
    } else {
      this.suspicion = Math.max(0, this.suspicion - dt * 0.12 * (1 - 0.6 * floor));
    }
    if (k === 'chase') {
      // While chasing, sounds keep it on you after line of sight breaks.
      const s = pc.sound;
      if (s && s.noise.source === 'player' && pc.vis === 0 && s.margin > 4) {
        this.lkp = { ...s.pos };
        this.lkpT = sim.time;
      }
      if (pc.scent && pc.vis === 0) {
        this.lkp = { ...pc.scent };
        this.lkpT = sim.time;
      }
      return;
    }

    // ---- [V] the mark: scent overrides almost everything
    if (pc.scent && !ambushing && k !== 'check') {
      if (pl.hidden && sim.director.checkScore(pl.hidden, 'scent') > 0.6 && dist(this.pos, pc.scent) < 6) {
        this.beginCheck([pl.hidden.id], false, 'it can smell you in there');
        return;
      }
      if (k !== 'investigate' || dist((this.state as { target: Vec2 }).target, pc.scent) > 3) {
        this.investigate(pc.scent, false, 'following the mark');
        return;
      }
    }

    // ---- [V] breath fog
    if (pc.fog && !ambushing && k !== 'check') {
      if (pc.fog.spot >= 0) {
        this.beginCheck([pc.fog.spot], true, 'breath fog leaking from a hiding place');
        return;
      }
      if (k !== 'investigate' || !(this.state as { precise: boolean }).precise) {
        this.investigate(pc.fog.pos, true, 'breath hanging in the cold');
        return;
      }
    }

    // ---- [V] thermal residue: reconstruct the path, print by print
    if (pc.thermal && (k === 'hunt' || k === 'investigate')) {
      const m = pc.thermal;
      this.trailT = m.t;
      sim.director.onThermalRead(m);
      const spot = sim.world.spotAt.get(m.cell);
      if (spot && (m.surface === 'locker' || m.surface === 'drawer' || m.surface === 'bed')) {
        const newest = !sim.world.thermal.some((o) => o.t > m.t);
        // A warm latch is a strong lead, not a certainty: the hotter, the likelier it looks.
        if (newest && sim.rng.chance(0.3 + 0.6 * World.heatOf(m, sim.time))) {
          this.beginCheck([spot.id], false, 'warm handprints on the latch');
          return;
        }
      }
      const target = sim.world.level.tiles[m.cell] === Tile.Door ? m.pos : cellCenter(sim.level, sim.level.wallObjectAt.get(m.cell)?.access ?? m.cell);
      this.investigate(target, true, `reading a warm print on a ${m.surface}`);
      return;
    }

    // ---- hearing
    // Dragging a body home [W], it tunes the building out, its victim's last scream included.
    // Only you, loud and close, turn it around.
    const carrying = this.carryingBody !== null;
    const s = pc.sound && (!carrying || (pc.sound.noise.source === 'player' && pc.sound.margin >= 18)) ? pc.sound : null;
    if (s) {
      const n = s.noise;
      if (ambushing) {
        // A feint listens for *anything* you do; an ambush for its killing ground, and for
        // anything right on top of it.
        const trap = this.trapStep();
        const near =
          k === 'feint' || (trap ? dist(s.pos, trap.watch) <= trap.radius || dist(s.pos, this.pos) < 2.5 : dist(s.pos, this.pos) < 6);
        if (near || s.margin > 22) {
          if (k === 'feint') {
            sim.director.onFeintResolved(true);
            this.startTell('snap', 0.3, false);
          }
          this.investigate(s.pos, true, k === 'feint' ? 'you moved too soon' : 'something walked into the trap');
        }
        return;
      }
      if (k === 'check' && this.state.kind === 'check' && this.state.phase !== 'approach') return;
      if (k === 'listen') {
        this.investigate(s.pos, true, 'it heard you while it listened');
        return;
      }
      if (n.kind === 'glass' && n.origin && sim.director.counterActive('distract')) {
        // [Y] It has learned the glass: it walks to the hand that threw it.
        sim.director.onDistractionCountered();
        this.investigate(n.origin, true, 'it ignores the bottle and goes to where it was thrown from');
        return;
      }
      if (s.margin < 6 && (this.isPassive() || k === 'hunt' || k === 'investigate')) {
        this.beginListen(s.pos);
        return;
      }
      if (n.kind === 'glass') sim.director.onDistractionTaken(n);
      const reason =
        n.source === 'survivor' ? 'a survivor made a sound' : n.kind === 'glass' ? 'breaking glass' : n.kind === 'breaker' ? 'the breaker — the loudest thing in the building' : `heard ${n.kind}`;
      this.investigate(s.pos, s.margin > 12, reason);
      return;
    }

    // ---- survivors [L, X]
    if (pc.survivor !== null && (this.isPassive() || k === 'hunt' || k === 'investigate')) {
      this.setState({ kind: 'chase', lostAt: sim.time, survivor: pc.survivor }, `hunting ${sim.survivors.list[pc.survivor]!.def.name}`);
    }
  }

  // ===================================================================== state entry helpers

  investigate(target: Vec2, precise: boolean, reason: string): void {
    this.setState({ kind: 'investigate', target: { ...target }, precise, reason, arrived: false, lookUntil: 0, checks: [] }, reason);
  }

  hunt(center: Vec2, radius: number, reason: string, duration?: number): void {
    const sim = this.sim;
    const dur = duration ?? lerp(25, 45, sim.director.floor) + sim.rng.range(0, 10);
    this.setState({ kind: 'hunt', center: { ...center }, radius, until: sim.time + dur, point: -1, reason, checks: [], trail: 0 }, reason);
  }

  private beginListen(heard: Vec2): void {
    const sim = this.sim;
    const fake = sim.director.shouldFake('tilt', { entity: this });
    // A real tilt is short. A faked one outlasts your breath [Y].
    const dur = fake ? sim.rng.range(9, 12) : sim.rng.range(1.6, 2.2);
    const resume = this.state.kind === 'listen' ? this.state.resume : this.state;
    this.angle = angleTo(this.pos, heard);
    this.setState({ kind: 'listen', until: sim.time + dur, fake, resume }, fake ? 'a long, patient listen (it knows you hold your breath)' : 'it heard something faint and listens');
    this.startTell('tilt', dur, fake);
  }

  beginCheck(spots: number[], certain: boolean, reason: string): void {
    if (!spots.length) return;
    const [first, ...rest] = spots;
    this.setState({ kind: 'check', spot: first!, phase: 'approach', t: 0, fake: false, certain, reason, queue: rest }, reason);
  }

  /** Forced by the Director when a baited spot gets taken [T: offered safety]. */
  /** Go and open `spot` now. False if it is busy (chasing, killing, checking) and cannot. */
  forceCheck(spot: HidingSpot, reason: string): boolean {
    const k = this.state.kind;
    if (k === 'chase' || k === 'lunge' || k === 'kill' || k === 'check') return false;
    this.beginCheck([spot.id], true, reason);
    return true;
  }

  startLeave(allowFake: boolean, reason: string): void {
    const sim = this.sim;
    const fake = allowFake && sim.director.shouldFake('turn', { entity: this });
    const dest = sim.director.leaveTarget(this);
    this.setState({ kind: 'leave', phase: 'turn', t: 0, dest, fake, from: { ...this.pos } }, fake ? 'it turns away… (a feint)' : reason);
    this.startTell('turn', 1.4, fake);
  }

  /** The plan it is carrying out, or has paused to listen. */
  get activePlan(): Plan | null {
    const s = this.state;
    if (s.kind === 'plan') return s.plan;
    if (s.kind === 'listen' && s.resume.kind === 'plan') return s.resume.plan;
    return null;
  }

  startPlan(plan: Plan): void {
    this.setState({ kind: 'plan', plan, step: 0, t: 0, arrived: false }, `[${plan.section}] ${plan.reason}`);
  }

  /** Take a body to drag home [W]. One it was already carrying is dropped where it stands. */
  private takeBody(id: number): void {
    if (this.carryingBody !== null && this.carryingBody !== id) this.sim.survivors.depositBody(this.carryingBody, this.pos);
    this.carryingBody = id;
  }

  retreat(then: 'rest' | 'feed', reason: string): void {
    const nest = this.sim.level.markers.nest;
    const dest = nest.length ? this.sim.rng.pick(nest) : this.cell;
    this.setState({ kind: 'retreat', dest, then }, reason);
  }

  // ===================================================================== per-state behaviour

  private tick(dt: number): void {
    const sim = this.sim;
    const s = this.state;
    switch (s.kind) {
      case 'rest':
      case 'feed':
        if (sim.time >= s.until) this.idleNext(s.kind === 'feed' ? 'done feeding' : 'stirs');
        break;
      case 'roam': {
        if (sim.time < s.pauseUntil) {
          this.angle = wrapAngle(this.angle + Math.sin(sim.time * 0.9) * dt * 0.8);
          break;
        }
        const r = this.goTo(s.dest, 'roam', dt);
        if (r === 'arrived') {
          s.pauseUntil = sim.time + sim.rng.range(0.8, 3) * (1 - 0.6 * sim.director.floor);
          this.idleNext('arrived', true);
        } else if (r === 'blocked') this.idleNext('blocked');
        break;
      }
      case 'listen':
        if (sim.time >= s.until) {
          const resume = s.resume;
          if (resume.kind === 'listen' || resume.kind === 'check' || resume.kind === 'lunge' || resume.kind === 'kill') this.idleNext('heard nothing more');
          else this.setState(resume, resume.kind === 'plan' ? `[${resume.plan.section}] ${resume.plan.reason}` : `heard nothing more; back to ${resume.kind}`);
        }
        break;
      case 'investigate':
        this.tickInvestigate(s, dt);
        break;
      case 'hunt':
        this.tickHunt(s, dt);
        break;
      case 'chase':
        this.tickChase(s, dt);
        break;
      case 'lunge':
        this.tickLunge(s, dt);
        break;
      case 'check':
        this.tickCheck(s, dt);
        break;
      case 'leave':
        this.tickLeave(s, dt);
        break;
      case 'feint':
        if (sim.time >= s.until) {
          sim.director.onFeintResolved(false);
          this.idleNext('the feint went unanswered');
        }
        break;
      case 'plan':
        this.tickPlan(s, dt);
        break;
      case 'retreat': {
        const r = this.goTo(s.dest, 'roam', dt);
        if (r !== 'moving') {
          if (this.carryingBody !== null) {
            sim.survivors.depositBody(this.carryingBody, this.pos);
            this.carryingBody = null;
          }
          const dur = s.then === 'feed' ? sim.rng.range(30, 50) : sim.director.restDuration();
          this.setState(s.then === 'feed' ? { kind: 'feed', until: sim.time + dur } : { kind: 'rest', until: sim.time + dur }, s.then === 'feed' ? 'feeding in the nest' : 'resting in the nest');
        }
        break;
      }
      case 'kill':
        this.tickKill(s, dt);
        break;
      case 'mimic':
        this.tickMimic(s, dt);
        break;
    }
  }

  /** Ask the Director what to do next when nothing is pressing. */
  private idleNext(why: string, keepRoamPause = false): void {
    const sim = this.sim;
    const act = sim.director.nextActivity(this);
    switch (act.kind) {
      case 'roam':
        if (keepRoamPause && this.state.kind === 'roam') {
          this.state.dest = act.cell;
          this.reason = act.reason;
        } else this.setState({ kind: 'roam', dest: act.cell, pauseUntil: 0 }, act.reason);
        break;
      case 'hunt':
        this.hunt(act.center, act.radius, act.reason);
        break;
      case 'plan':
        this.startPlan(act.plan);
        break;
      case 'retreat':
        this.retreat('rest', act.reason);
        break;
    }
    void why;
  }

  private tickInvestigate(s: Extract<EntityState, { kind: 'investigate' }>, dt: number): void {
    const sim = this.sim;
    if (!s.arrived) {
      const goal = this.nearestOpenCell(s.target);
      const r = this.goTo(goal, s.precise ? 'hunt' : 'investigate', dt);
      if (r === 'moving') return;
      s.arrived = true;
      s.lookUntil = sim.time + sim.rng.range(1.5, 3);
      // Which hiding places nearby deserve a look?
      s.checks = sim.director.chooseChecks(this, s.target, s.precise ? 3.5 : 5);
      return;
    }
    this.angle = wrapAngle(this.angle + dt * 1.6 * Math.sin(sim.time * 1.3));
    if (sim.time < s.lookUntil) return;
    if (s.checks.length) {
      this.beginCheck(s.checks, false, 'searching the hiding places near the noise');
      return;
    }
    if (this.suspicion > 0.25 || sim.director.wantsHunt()) {
      this.hunt(s.target, 6, 'not convinced — searching the area');
      return;
    }
    this.startLeave(true, 'nothing here — it moves on');
  }

  private tickHunt(s: Extract<EntityState, { kind: 'hunt' }>, dt: number): void {
    const sim = this.sim;
    if (sim.time >= s.until) {
      this.startLeave(true, 'gives up the search');
      return;
    }
    if (s.checks.length) {
      this.beginCheck(s.checks, false, 'hunting through hiding places');
      return;
    }
    if (s.point < 0) {
      s.point = sim.director.huntPoint(this, s.center, s.radius);
    }
    const r = this.goTo(s.point, 'hunt', dt);
    if (r === 'moving') return;
    s.point = -1;
    s.trail++;
    if (sim.rng.chance(0.55)) s.checks = sim.director.chooseChecks(this, this.pos, 3);
  }

  private tickChase(s: Extract<EntityState, { kind: 'chase' }>, dt: number): void {
    const sim = this.sim;
    const pl = sim.player;
    if (s.survivor !== null) {
      const sv = sim.survivors.list[s.survivor]!;
      if (!sv.alive || sv.spot) {
        if (sv.alive && sv.spot) this.beginCheck([sv.spot.id], true, `${sv.def.name} hid — it saw where`);
        else this.idleNext('prey gone');
        return;
      }
      if (dist(this.pos, sv.pos) <= E.reach) {
        this.setState({ kind: 'lunge', t: 0, struck: false, recover: 0.8, survivor: sv.id }, `lunging at ${sv.def.name}`);
        this.startTell('inhale', E.lungeWindup, false);
        return;
      }
      this.goTo(cellAt(sim.level, sv.pos), 'chase', dt, sv.pos);
      return;
    }
    const sees = this.percepts.vis > 0.05;
    if (sees) s.lostAt = sim.time;
    if (!pl.exposed && pl.hidden) {
      const spot = pl.hidden;
      if (this.sawHideSpot === spot.id && sim.time - this.lkpT < 2.5) {
        this.beginCheck([spot.id], true, 'it watched you climb in');
        return;
      }
    }
    if (!pl.alive) {
      this.idleNext('quarry dead');
      return;
    }
    const d = dist(this.pos, pl.pos);
    if (pl.exposed && d <= E.reach && sim.world.los(this.pos, pl.pos)) {
      this.setState({ kind: 'lunge', t: 0, struck: false, recover: 0, survivor: null }, 'within reach');
      this.startTell('inhale', E.lungeWindup, false);
      return;
    }
    if (!sees && sim.time - s.lostAt > 2.6) {
      sim.director.onChaseLost();
      this.hunt(this.lkp ?? pl.pos, 6, 'lost sight of you');
      return;
    }
    const target = sees ? pl.pos : (this.lkp ?? pl.pos);
    const r = this.goTo(cellAt(sim.level, target), 'chase', dt, target);
    if (r === 'arrived' && !sees) {
      sim.director.onChaseLost();
      this.hunt(target, 5, 'reached where you were');
    }
  }

  private tickLunge(s: Extract<EntityState, { kind: 'lunge' }>, dt: number): void {
    const sim = this.sim;
    const pl = sim.player;
    s.t += dt;
    const targetPos = s.survivor !== null ? sim.survivors.list[s.survivor]!.pos : pl.pos;
    if (!s.struck) this.angle = turnToward(this.angle, angleTo(this.pos, targetPos), dt * 8);
    if (!s.struck && s.t >= E.lungeWindup) {
      s.struck = true;
      // the lunge itself carries it forward
      const a = this.angle;
      const step = { x: this.pos.x + Math.cos(a) * 0.35, y: this.pos.y + Math.sin(a) * 0.35 };
      if (!sim.world.isSolid(cellAt(sim.level, step))) this.pos = step;
      if (s.survivor !== null) {
        const sv = sim.survivors.list[s.survivor]!;
        if (sv.alive && !sv.spot && dist(this.pos, sv.pos) <= E.reach + 0.4) {
          sim.survivors.kill(sv.id, 'caught in the open');
          this.takeBody(sv.id);
          this.retreat('feed', `drags ${sv.def.name} back to the nest`);
          return;
        }
        s.recover = 0.7;
      } else {
        const d = dist(this.pos, pl.pos);
        if (pl.exposed && d <= E.reach + 0.35 && sim.world.los(this.pos, pl.pos)) {
          const killed = pl.hurt('It caught you in the open.');
          if (killed) {
            this.setState({ kind: 'kill', t: 0, victim: 'player', spot: null }, 'the kill');
            return;
          }
          sim.director.onPlayerHit();
          this.markPlayer('wound');
          s.recover = 1.7;
        } else {
          sim.director.onNearMiss();
          if (d < 2.4) this.markPlayer('near miss');
          s.recover = 0.75;
        }
      }
    }
    if (s.struck && s.t >= E.lungeWindup + s.recover) {
      if (s.survivor !== null) this.idleNext('missed');
      else this.setState({ kind: 'chase', lostAt: sim.time, survivor: null }, 'after you');
    }
  }

  private markPlayer(why: string): void {
    const sim = this.sim;
    if (!sim.features.theMark) return;
    const wasMarked = sim.player.isMarked;
    sim.player.markedUntil = sim.time + 100;
    if (!wasMarked) {
      sim.notice('Something black and wet soaked through your sleeve. It smells like the morgue.', 6);
      sim.director.onMarked(why);
    }
  }

  private tickCheck(s: Extract<EntityState, { kind: 'check' }>, dt: number): void {
    const sim = this.sim;
    const spot = sim.world.spots[s.spot]!;
    s.t += dt;
    switch (s.phase) {
      case 'approach': {
        const r = this.goTo(spot.access, s.certain ? 'hunt' : 'investigate', dt);
        if (r === 'blocked') {
          this.nextCheck(s);
          return;
        }
        if (r === 'moving') return;
        this.angle = angleTo(this.pos, cellCenter(sim.level, spot.cell));
        // [Y] faked inhale: it pretends to commit, hoping you bolt.
        const playerInside = spot.occupant?.kind === 'player';
        const fake = !s.certain && sim.director.shouldFake('inhale', { entity: this, spot });
        s.fake = fake;
        s.t = 0;
        if (fake || s.certain || sim.director.checkScore(spot, 'inhale') > 0.7 || playerInside) {
          s.phase = 'inhale';
          this.startTell('inhale', fake ? 1.1 : 0.8, fake);
        } else s.phase = 'open';
        return;
      }
      case 'inhale':
        if (s.t < (s.fake ? 1.1 : 0.8)) return;
        s.t = 0;
        s.phase = s.fake ? 'linger' : 'open';
        return;
      case 'linger':
        // Bluff: it never opens. It waits to see whether you break.
        if (s.t > 3.2) {
          sim.director.onFakeCheckResolved(spot, false);
          this.nextCheck(s);
        }
        return;
      case 'open':
        if (spot.kind !== 'bed') spot.ajar = true;
        if (s.t === dt || s.t < dt * 1.5) sim.emitNoise(spot.kind === 'bed' ? 'drag' : 'locker', cellCenter(sim.level, spot.access), 24, 'entity');
        if (s.t < 0.9) return;
        spot.lastChecked = sim.time;
        if (spot.occupant?.kind === 'player') {
          sim.director.onSpotChecked(spot, true);
          this.setState({ kind: 'kill', t: 0, victim: 'player', spot: spot.id }, `found you in the ${spot.kind}`);
          return;
        }
        if (spot.occupant?.kind === 'survivor') {
          const id = spot.occupant.id;
          sim.survivors.kill(id, `pulled from a ${spot.kind}`);
          this.takeBody(id);
          this.retreat('feed', `drags ${sim.survivors.list[id]!.def.name} back to the nest`);
          return;
        }
        sim.director.onSpotChecked(spot, false);
        this.nextCheck(s);
        return;
    }
  }

  private nextCheck(s: Extract<EntityState, { kind: 'check' }>): void {
    const next = s.queue.shift();
    if (next !== undefined) {
      s.spot = next;
      s.phase = 'approach';
      s.t = 0;
      s.fake = false;
      this.nav.goal = -1;
      return;
    }
    if (this.suspicion > 0.3 || this.sim.director.wantsHunt()) this.hunt(this.pos, 6, 'still searching');
    else this.startLeave(true, 'checked the hiding places');
  }

  private tickLeave(s: Extract<EntityState, { kind: 'leave' }>, dt: number): void {
    const sim = this.sim;
    s.t += dt;
    if (s.phase === 'turn') {
      // The slow turn [B]: away from wherever it suspects you are.
      const away = this.lkp ? angleTo(this.lkp, this.pos) : this.angle + Math.PI;
      this.angle = turnToward(this.angle, away, dt * (Math.PI / 1.4));
      if (s.t >= 1.4) {
        s.phase = 'walk';
        s.t = 0;
      }
      return;
    }
    const r = this.goTo(s.dest, 'roam', dt);
    if (r === 'blocked') {
      s.dest = sim.director.leaveTarget(this);
      return;
    }
    if (s.fake && dist(this.pos, s.from) >= 3) {
      // [Y] the feint: stop just out of sight and listen backwards.
      this.setState({ kind: 'feint', until: sim.time + sim.rng.range(5, 7.5), origin: s.from }, 'stopped just past the corner — listening behind it');
      return;
    }
    if (r !== 'moving') this.idleNext('left');
  }

  private tickKill(s: Extract<EntityState, { kind: 'kill' }>, dt: number): void {
    const sim = this.sim;
    s.t += dt;
    if (s.victim === 'player') {
      if (s.t > 0.9 && sim.player.alive) {
        const spot = s.spot !== null ? sim.world.spots[s.spot]! : null;
        sim.player.die(spot ? `It found you in the ${spot.kind === 'bed' ? 'dark under the bed' : spot.kind}.` : 'It caught you in the open.');
      }
      if (s.t > 2) this.retreat('feed', 'takes you home');
    }
  }

  private tickMimic(s: Extract<EntityState, { kind: 'mimic' }>, dt: number): void {
    const sim = this.sim;
    if (!s.arrived) {
      const r = this.goTo(s.cell, 'stalk', dt);
      if (r === 'blocked') return this.idleNext('mimic spot unreachable');
      if (r === 'arrived') s.arrived = true;
      return;
    }
    this.disguise = s.survivor;
    const pl = sim.player;
    const d = dist(this.pos, pl.pos);
    this.angle = turnToward(this.angle, angleTo(this.pos, pl.pos), dt * 2);
    if (sim.time >= s.nextCall) {
      s.nextCall = sim.time + sim.rng.range(6, 10);
      sim.survivors.mimicCall(s.survivor, this.pos);
    }
    if (pl.exposed && d < 3.2 && sim.world.los(this.pos, pl.pos)) {
      this.disguise = null;
      sim.director.onMimicSprung(s.survivor);
      this.setState({ kind: 'lunge', t: 0, struck: false, recover: 0, survivor: null }, 'you came when it called');
      this.startTell('inhale', E.lungeWindup, false);
      return;
    }
    if (sim.time >= s.until) {
      this.disguise = null;
      this.idleNext('nobody came');
    }
  }

  // ===================================================================== plans [T, U, X, Y]

  private tickPlan(s: Extract<EntityState, { kind: 'plan' }>, dt: number): void {
    const sim = this.sim;
    const step = s.plan.steps[s.step];
    if (!step) {
      this.closingPlan = true;
      sim.director.onPlanFinished(s.plan, 'done');
      this.idleNext('plan complete');
      this.closingPlan = false;
      return;
    }
    s.t += dt;
    const advance = () => {
      s.step++;
      s.t = 0;
      s.arrived = false;
      this.nav.goal = -1;
    };
    const world = sim.world;
    switch (step.op) {
      case 'goto': {
        const r = this.goTo(step.cell, step.mode, dt);
        if (r === 'arrived') advance();
        else if (r === 'blocked') this.abortPlan(s.plan, 'path blocked');
        return;
      }
      case 'knock': {
        // Choose the grate now, relative to where you are *now*: the noise must come from behind you.
        const amb = s.plan.steps.slice(s.step).find((x) => x.op === 'ambush');
        const ventId = step.vent >= 0 ? step.vent : sim.director.bait.herdVent(amb && amb.op === 'ambush' ? amb.watch : this.pos);
        const vent = world.vents[ventId];
        if (!vent) {
          advance();
          return;
        }
        sim.emitNoise('knock', cellCenter(sim.level, vent.access), LOUD.ventKnock, 'entity');
        sim.log('T', `herding: knocked the ducts — the sound came out of a grate ${Math.round(dist(this.pos, cellCenter(sim.level, vent.access)))} cells away`);
        advance();
        return;
      }
      case 'pickup': {
        const item = world.items.find((i) => i.id === step.item);
        if (!item || item.state !== 'ground') return this.abortPlan(s.plan, 'item already taken');
        const r = this.goTo(cellAt(sim.level, item.pos), 'stalk', dt);
        if (r === 'blocked') return this.abortPlan(s.plan, 'cannot reach item');
        if (r !== 'arrived') return;
        item.state = 'entity';
        this.carrying = item;
        sim.emitNoise('pickup', item.pos, 6, 'entity');
        advance();
        return;
      }
      case 'drop': {
        const r = this.goTo(step.cell, 'stalk', dt);
        if (r === 'blocked') return this.abortPlan(s.plan, 'cannot reach drop point');
        if (r !== 'arrived') return;
        if (this.carrying) {
          const c = cellCenter(sim.level, step.cell);
          this.carrying.pos = { x: c.x + sim.rng.range(-0.2, 0.2), y: c.y + sim.rng.range(-0.2, 0.2) };
          this.carrying.state = 'ground';
          this.carrying.relocated = true;
          sim.log('T', `relocation: left the ${this.carrying.kind} somewhere enclosed`);
          this.carrying = null;
        }
        advance();
        return;
      }
      case 'ajar':
      case 'clear': {
        const spot = world.spots[step.spot]!;
        const r = this.goTo(spot.access, 'stalk', dt);
        if (r === 'blocked') return this.abortPlan(s.plan, 'cannot reach spot');
        if (r !== 'arrived') return;
        if (step.op === 'ajar') spot.ajar = true;
        else spot.cluttered = false;
        if (!spot.occupant) spot.baited = true;
        sim.director.onSpotBaited(spot);
        advance();
        return;
      }
      case 'killLight': {
        const f = world.lighting.fixtures[step.fixture]!;
        if (f.broken) return advance();
        const fc = cellCenter(sim.level, f.cell);
        if (dist(this.pos, fc) > 2.5 || !world.los(this.pos, fc)) {
          const r = this.goTo(f.cell, 'stalk', dt);
          if (r === 'blocked') return advance();
          return;
        }
        world.lighting.kill(f.id);
        sim.emitNoise('lightPop', fc, 26, 'entity');
        advance();
        return;
      }
      case 'jam': {
        const door = world.doors[step.door]!;
        const side = door.sides[0];
        const r = this.goTo(side, 'stalk', dt);
        if (r === 'blocked') return this.abortPlan(s.plan, 'cannot reach door');
        if (r !== 'arrived') return;
        // Re-check on arrival: you may have moved since the plan was made.
        const inDoorway = (p: Vec2) => cellAt(sim.level, p) === door.cell;
        if (inDoorway(sim.player.pos) || sim.survivors.list.some((sv) => sv.alive && inDoorway(sv.pos))) {
          return this.abortPlan(s.plan, 'someone is in the doorway');
        }
        if (world.wouldStrand(door.cell, sim.player.soundCell)) return this.abortPlan(s.plan, 'it would cut you off from the way out');
        door.target = 0;
        door.jammed = true;
        world.lockVersion++;
        sim.emitNoise('drag', cellCenter(sim.level, door.cell), 24, 'entity');
        sim.log('Y', 'dismantling: barricaded a door on your safe route');
        advance();
        return;
      }
      case 'ambush': {
        if (!s.arrived) {
          const r = this.goTo(step.cell, 'stalk', dt);
          if (r === 'blocked') return this.abortPlan(s.plan, 'ambush point unreachable');
          if (r !== 'arrived') return;
          s.arrived = true;
          s.t = 0;
        }
        this.angle = turnToward(this.angle, step.facing, dt * 3);
        if (s.t >= step.duration) advance();
        return;
      }
      case 'mimic':
        this.setState(
          { kind: 'mimic', survivor: step.survivor, cell: step.cell, until: sim.time + step.duration, nextCall: 0, arrived: false },
          `[X] wearing ${sim.survivors.list[step.survivor]!.def.name}`,
        );
        return;
      case 'wait':
        if (s.t >= step.duration) advance();
        return;
    }
  }

  private abortPlan(plan: Plan, why: string): void {
    this.dropCarried();
    this.closingPlan = true;
    this.sim.director.onPlanFinished(plan, 'aborted');
    this.sim.log('entity', `plan ${plan.kind} aborted: ${why}`);
    this.idleNext('plan aborted');
    this.closingPlan = false;
  }

  private dropCarried(): void {
    if (this.carrying) {
      this.carrying.state = 'ground';
      this.carrying.pos = { ...this.pos };
      this.carrying.relocated = true;
      this.carrying = null;
    }
  }

  // ===================================================================== movement

  private speedFor(mode: MoveMode): number {
    const floor = this.sim.director.floor;
    switch (mode) {
      case 'stalk':
        return E.stalkSpeed;
      case 'roam':
        return E.roamSpeed * (1 + 0.2 * floor);
      case 'investigate':
        return E.investigateSpeed * (1 + 0.15 * floor);
      case 'hunt':
        return E.huntSpeed * (1 + 0.15 * floor);
      case 'chase':
        return E.chaseSpeed + 0.35 * floor;
    }
  }

  private nearestOpenCell(p: Vec2): number {
    const sim = this.sim;
    const c = cellAt(sim.level, p);
    if (c >= 0 && sim.world.entityPassable(c)) return c;
    let best = this.cell;
    let bd = Infinity;
    const cx = Math.floor(p.x);
    const cy = Math.floor(p.y);
    for (let y = cy - 2; y <= cy + 2; y++) {
      for (let x = cx - 2; x <= cx + 2; x++) {
        if (x < 0 || y < 0 || x >= sim.level.w || y >= sim.level.h) continue;
        const n = y * sim.level.w + x;
        if (sim.level.tiles[n] !== Tile.Floor) continue;
        const d = Math.hypot(x + 0.5 - p.x, y + 0.5 - p.y);
        if (d < bd) {
          bd = d;
          best = n;
        }
      }
    }
    return best;
  }

  /**
   * Walk toward a cell along an A* path, opening doors as it goes. `exact` lets the
   * last stretch close on a moving target instead of a cell centre.
   */
  goTo(cell: number, mode: MoveMode, dt: number, exact?: Vec2): 'moving' | 'arrived' | 'blocked' {
    const sim = this.sim;
    const { level, world } = sim;
    if (cell < 0) return 'blocked';
    const here = this.cell;
    const speed = this.speedFor(mode);
    if (here === cell) {
      const t = exact ?? cellCenter(level, cell);
      if (dist(this.pos, t) < 0.12) return 'arrived';
      this.stepToward(t, speed, dt, mode);
      return 'moving';
    }
    if (this.nav.goal !== cell || this.nav.path.length === 0 || sim.time >= this.nav.repathAt || this.nav.mode !== mode) {
      const path = findPath(level, here, cell, { passable: world.entityPassable, extraCost: this.costFn(mode) });
      if (!path) {
        this.nav.goal = -1;
        return 'blocked';
      }
      this.nav = { goal: cell, path, repathAt: sim.time + (mode === 'chase' ? 0.3 : 2.5), mode };
    }
    while (this.nav.path.length && this.nav.path[0] === here) this.nav.path.shift();
    const next = this.nav.path[0];
    if (next === undefined) return 'arrived';
    if (level.tiles[next] === Tile.Door) {
      const door = world.doorAt.get(next)!;
      if (door.open < 0.85) {
        if (door.target !== 1) {
          if (door.jammed) {
            // It shoves its own barricade aside on the way through.
            door.jammed = false;
            world.lockVersion++;
          }
          door.target = 1;
          const counter = sim.director.counterActive('doors');
          // A closed door costs it time — until it learns that you rely on doors [Y].
          door.speed = counter ? 0.15 : mode === 'chase' ? 0.6 : mode === 'stalk' ? 1.4 : 0.55;
          const loud = counter ? LOUD.doorBash : mode === 'chase' ? LOUD.door + 8 : mode === 'stalk' ? LOUD.doorQuiet : LOUD.door;
          sim.emitNoise(loud >= LOUD.doorBash ? 'doorBash' : 'door', cellCenter(level, next), loud, 'entity');
        }
        this.angle = turnToward(this.angle, angleTo(this.pos, cellCenter(level, next)), dt * 6);
        return 'moving';
      }
    }
    const isLast = this.nav.path.length === 1;
    const target = isLast && exact ? exact : cellCenter(level, next);
    this.stepToward(target, speed, dt, mode);
    if (cellAt(level, this.pos) === next && dist(this.pos, cellCenter(level, next)) < 0.4) this.nav.path.shift();
    return 'moving';
  }

  private costFn(mode: MoveMode): ((c: number) => number) | undefined {
    const sim = this.sim;
    if (mode === 'stalk') {
      // Stalking prefers darkness and avoids your sight lines.
      const pl = sim.player;
      const lum = sim.world.lighting.lum;
      return (c) => {
        let cost = lum[c]! * 5;
        const p = cellCenter(sim.level, c);
        if (pl.alive && dist(p, pl.pos) < 10) {
          const off = Math.abs(angleDiff(pl.angle, angleTo(pl.pos, p)));
          if (off < 0.9 && sim.world.los(pl.pos, p)) cost += 4;
        }
        return cost;
      };
    }
    if (mode === 'chase') return undefined;
    return (c) => (sim.level.tiles[c] === Tile.Door ? 0.6 : 0);
  }

  private stepToward(t: Vec2, speed: number, dt: number, mode: MoveMode): void {
    const sim = this.sim;
    const dx = t.x - this.pos.x;
    const dy = t.y - this.pos.y;
    const d = Math.hypot(dx, dy);
    if (d < 1e-4) return;
    const step = Math.min(d, speed * dt);
    this.pos = { x: this.pos.x + (dx / d) * step, y: this.pos.y + (dy / d) * step };
    this.moving = true;
    this.speedNow = speed;
    this.angle = turnToward(this.angle, Math.atan2(dy, dx), dt * (mode === 'chase' ? 12 : 6));
    this.stepAccum += step;
    const stride = mode === 'chase' ? 1.25 : 0.95;
    if (this.stepAccum >= stride) {
      this.stepAccum -= stride;
      const loud =
        mode === 'stalk' ? LOUD.entityStepStalk : mode === 'chase' ? LOUD.entityStepChase : mode === 'roam' ? LOUD.entityStepRoam : LOUD.entityStepHunt;
      sim.emitNoise('entityStep', this.pos, loud, 'entity');
    }
  }

  // ===================================================================== presentation

  private computePose(): Pose {
    const s = this.state;
    if (this.tell && this.tell.kind === 'tilt') return 'tilt';
    if (this.tell && this.tell.kind === 'inhale') return 'inhale';
    switch (s.kind) {
      case 'lunge':
        return s.struck ? 'lunge' : 'inhale';
      case 'check':
        if (s.phase === 'open') return this.sim.world.spots[s.spot]!.kind === 'bed' ? 'crouch' : 'reach';
        return this.moving ? 'walk' : 'idle';
      case 'kill':
        return 'reach';
      case 'feed':
        return 'feed';
      case 'mimic':
        return s.arrived ? 'wave' : this.moving ? 'walk' : 'idle';
      case 'feint':
        return 'turnaway';
      default:
        return this.moving ? 'walk' : 'idle';
    }
  }
}

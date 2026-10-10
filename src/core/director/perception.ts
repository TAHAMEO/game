import { cellAt, cellCenter, Tile } from '../level';
import { angleDiff, angleTo, dist, type Vec2 } from '../math';
import type { Player } from '../player';
import type { Sim } from '../sim';
import type { SoundKind } from '../types';

/** Horizontal field of view of the player's camera (radians). Shared with the renderer. */
export const VIEW_FOV = (68 * Math.PI) / 180;
const HALF_FOV = VIEW_FOV / 2;
/** Half-angle of the torch beam. */
export const BEAM_HALF = 0.38;

/** A shape at the edge of vision that was never there [S]. Rendered with the Entity's own sprite. */
export interface Phantom {
  id: number;
  pos: Vec2;
  angle: number;
  born: number;
  until: number;
  pose: 'idle' | 'walk' | 'tilt';
}

type SignalKind = 'shape' | 'steps' | 'door' | 'breath';

interface Signal {
  id: number;
  kind: SignalKind;
  pos: Vec2;
  t: number;
  startOff: number;
  reacted: boolean;
  wasSprinting: boolean;
}

/**
 * S. UNRELIABLE SENSES — perceptual noise. Calm players perceive the world accurately;
 * as the live stress estimate rises, the player starts receiving false signals. Always
 * peripheral, ambient, deniable. The Entity benefits from the mistakes this causes
 * without doing anything. Each player has their own: in a shared run, what one of you
 * sees at the edge of the torchlight, the others do not.
 */
export class Perception {
  readonly phantoms: Phantom[] = [];
  readonly signals: Signal[] = [];
  /** Signals emitted this run, for the designer overlay. */
  emitted = 0;
  private queue: { t: number; kind: SoundKind; pos: Vec2; loud: number }[] = [];
  private nextAllowed = 20;
  private seq = 1;

  constructor(
    private readonly sim: Sim,
    private readonly pl: Player,
  ) {}

  /** Signals per second at a given stress. Zero below the calm threshold. */
  static rate(stress: number): number {
    if (stress < 0.28) return 0;
    const x = (stress - 0.28) / 0.72;
    return 0.015 + 0.2 * Math.pow(x, 1.4);
  }

  update(dt: number): void {
    const sim = this.sim;
    const pl = this.pl;
    const t = sim.time;

    for (let i = this.queue.length - 1; i >= 0; i--) {
      const q = this.queue[i]!;
      if (t >= q.t) {
        if (pl.active) sim.emitPhantomSound(q.kind, q.pos, q.loud, pl);
        this.queue.splice(i, 1);
      }
    }
    // Shapes vanish the moment you look straight at them, or light them.
    for (let i = this.phantoms.length - 1; i >= 0; i--) {
      const ph = this.phantoms[i]!;
      const off = Math.abs(angleDiff(pl.angle, angleTo(pl.pos, ph.pos)));
      const lit = pl.flashlight.on && off < BEAM_HALF && dist(pl.pos, ph.pos) < 12;
      if (t >= ph.until || off < HALF_FOV * 0.45 || lit || !pl.active) this.phantoms.splice(i, 1);
    }
    this.watchReactions();

    if (!sim.features.perceptualNoise || !pl.active) return;
    const stress = pl.stress.value;
    const lambda = Perception.rate(stress);
    if (lambda <= 0 || t < this.nextAllowed) return;
    if (sim.rng.next() < lambda * dt) {
      if (this.spawn()) this.nextAllowed = t + sim.rng.range(3, 7);
    }
  }

  private spawn(): boolean {
    const sim = this.sim;
    const pl = this.pl;
    const options: SignalKind[] = pl.hidden ? ['breath', 'steps', 'door'] : ['shape', 'shape', 'steps', 'steps', 'door'];
    for (let attempt = 0; attempt < 3; attempt++) {
      const kind = sim.rng.pick(options);
      const ok = kind === 'shape' ? this.spawnShape() : kind === 'steps' ? this.spawnSteps() : kind === 'door' ? this.spawnDoor() : this.spawnBreath();
      if (ok) {
        this.emitted++;
        sim.director.profile.ghostSignals++;
        sim.log('S', `false ${kind}${sim.players.length > 1 ? ` for ${pl.shortName}` : ''} (stress ${pl.stress.value.toFixed(2)})`);
        sim.scares.onFalseSignal(pl, kind, kind === 'shape' ? (this.phantoms[this.phantoms.length - 1] ?? null) : null);
        return true;
      }
    }
    return false;
  }

  private record(kind: SignalKind, pos: Vec2): void {
    const pl = this.pl;
    this.signals.push({
      id: this.seq++,
      kind,
      pos,
      t: this.sim.time,
      startOff: Math.abs(angleDiff(pl.angle, angleTo(pl.pos, pos))),
      reacted: false,
      wasSprinting: pl.sprinting,
    });
  }

  /** A shape at the edge of vision, in the dark, just outside the beam. */
  private spawnShape(): boolean {
    const sim = this.sim;
    const pl = this.pl;
    const ent = sim.entity;
    for (let i = 0; i < 14; i++) {
      const side = sim.rng.chance(0.5) ? 1 : -1;
      const a = pl.angle + side * (HALF_FOV - sim.rng.range(0.02, 0.1));
      const d = sim.rng.range(5, 12);
      const pos = { x: pl.pos.x + Math.cos(a) * d, y: pl.pos.y + Math.sin(a) * d };
      const c = cellAt(sim.level, pos);
      if (c < 0 || sim.level.tiles[c] !== Tile.Floor) continue;
      if (sim.world.lighting.sample(pos) > 0.12) continue;
      if (!sim.world.los(pl.pos, pos)) continue;
      if (dist(ent.pos, pos) < 4) continue;
      const until = sim.time + sim.rng.range(0.45, 1.1);
      this.phantoms.push({ id: this.seq++, pos, angle: angleTo(pos, pl.pos) + sim.rng.range(-1, 1), born: sim.time, until, pose: sim.rng.pick(['idle', 'walk', 'tilt'] as const) });
      this.record('shape', pos);
      return true;
    }
    return false;
  }

  /** Footsteps that weren't there — behind you, or just to the side. */
  private spawnSteps(): boolean {
    const sim = this.sim;
    const pl = this.pl;
    for (let i = 0; i < 12; i++) {
      const a = pl.angle + Math.PI + sim.rng.range(-1.4, 1.4);
      const d = sim.rng.range(5, 10);
      const pos = { x: pl.pos.x + Math.cos(a) * d, y: pl.pos.y + Math.sin(a) * d };
      const c = cellAt(sim.level, pos);
      if (c < 0 || sim.level.tiles[c] !== Tile.Floor) continue;
      const heading = sim.rng.range(0, Math.PI * 2);
      const n = sim.rng.int(3, 5);
      let p = { ...pos };
      for (let k = 0; k < n; k++) {
        this.queue.push({ t: sim.time + k * sim.rng.range(0.42, 0.55), kind: 'entityStep', pos: { ...p }, loud: 27 });
        const next = { x: p.x + Math.cos(heading) * 0.8, y: p.y + Math.sin(heading) * 0.8 };
        if (!sim.world.isSolid(cellAt(sim.level, next))) p = next;
      }
      this.record('steps', pos);
      return true;
    }
    return false;
  }

  /** A door sound from an empty hall — a door you can't see from here. */
  private spawnDoor(): boolean {
    const sim = this.sim;
    const pl = this.pl;
    const doors = sim.world.doors.filter((d) => {
      const p = cellCenter(sim.level, d.cell);
      const dd = dist(p, pl.pos);
      return dd > 5 && dd < 14 && !sim.world.los(pl.pos, p) && dist(p, sim.entity.pos) > 5;
    });
    if (!doors.length) return false;
    const door = sim.rng.pick(doors);
    const pos = cellCenter(sim.level, door.cell);
    sim.emitPhantomSound('door', pos, 30, pl);
    this.record('door', pos);
    return true;
  }

  /** Breathing just outside your hiding place. */
  private spawnBreath(): boolean {
    const sim = this.sim;
    const spot = this.pl.hidden;
    if (!spot) return false;
    const a = cellCenter(sim.level, spot.access);
    const pos = { x: a.x + sim.rng.range(-1.2, 1.2), y: a.y + sim.rng.range(-1.2, 1.2) };
    if (sim.world.isSolid(cellAt(sim.level, pos))) return false;
    sim.emitPhantomSound('inhale', pos, 14, this.pl);
    this.record('breath', pos);
    return true;
  }

  /** Did you flinch? Hunting ghosts feeds the stress it came from. */
  private watchReactions(): void {
    const sim = this.sim;
    const pl = this.pl;
    for (let i = this.signals.length - 1; i >= 0; i--) {
      const s = this.signals[i]!;
      const age = sim.time - s.t;
      if (age > 1.8) {
        this.signals.splice(i, 1);
        continue;
      }
      if (s.reacted) continue;
      const off = Math.abs(angleDiff(pl.angle, angleTo(pl.pos, s.pos)));
      const turned = s.startOff - off > 0.7 && pl.turnRate > 2.5;
      const bolted = pl.sprinting && !s.wasSprinting;
      if (turned || bolted) this.flinch(s, turned ? 'turned to look' : 'ran');
    }
  }

  /** Called by the Director for discrete reactions (throw, torch, hide) right after a signal. */
  noteAction(what: string): void {
    for (const s of this.signals) if (!s.reacted && this.sim.time - s.t < 1.8) this.flinch(s, what);
  }

  private flinch(s: Signal, what: string): void {
    const sim = this.sim;
    s.reacted = true;
    sim.director.profile.ghostReactions++;
    this.pl.stress.spike(0.08);
    sim.log('S', `you reacted to a false ${s.kind} (${what})`);
  }
}

export type TaxPhase = 'none' | 'lull' | 'betray' | 'exposed';

/**
 * S. THE FLASHLIGHT TAX. Heavy torch reliance is logged. The Director first lets the
 * light feel safe (the Entity backs away from the beam), then — at the exact moment you
 * depend on it — the light fails and the Entity comes for it. Afterwards the beam is a
 * beacon. Once learned, the lull is shorter on every later run.
 */
export class FlashlightTax {
  phase: TaxPhase = 'none';
  lullEvents = 0;
  private highSince = -1;
  private lowSince = -1;
  private lullSince = 0;
  private betrayAt = 0;

  constructor(private readonly sim: Sim) {}

  update(): void {
    const sim = this.sim;
    if (!sim.features.flashlightTax) {
      this.phase = 'none';
      return;
    }
    const t = sim.time;
    const reliance = sim.director.profile.flashlightReliance;
    const learned = sim.memory.learned('beam');
    const pl = sim.focus;
    switch (this.phase) {
      case 'none':
        if (reliance > 0.55) {
          if (this.highSince < 0) this.highSince = t;
          if (t - this.highSince > (learned ? 25 : 70)) {
            this.phase = 'lull';
            this.lullSince = t;
            sim.log('S', 'flashlight tax: you lean on the torch — it will let the light feel safe');
          }
        } else this.highSince = -1;
        break;
      case 'lull': {
        if (reliance < 0.3) {
          if (this.lowSince < 0) this.lowSince = t;
          if (t - this.lowSince > 60) {
            this.phase = 'none';
            this.highSince = -1;
            break;
          }
        } else this.lowSince = -1;
        const ready = this.lullEvents >= 2 || t - this.lullSince > (learned ? 45 : 100);
        const dark = sim.world.lighting.sample(pl.pos) < 0.15;
        const ent = sim.entity;
        const near = dist(ent.pos, pl.pos) < 13;
        if (ready && dark && pl.flashlight.on && pl.exposed && near && ent.stateKind !== 'chase' && ent.stateKind !== 'lunge') {
          this.phase = 'betray';
          this.betrayAt = t;
          pl.faultFlashlight(sim.rng.range(3.5, 5.5));
          ent.investigate(pl.pos, true, '[S] the light it let you trust goes out — and it comes');
          sim.log('S', 'flashlight tax: BETRAYAL — the torch dies while it is close');
        }
        break;
      }
      case 'betray':
        if (t - this.betrayAt > 8) {
          this.phase = 'exposed';
          if (sim.memory.learn('beam')) sim.log('K', 'it learned to hunt the beam');
        }
        break;
      case 'exposed':
        break;
    }
  }

  beamResponse(): 'respect' | 'betray' | 'none' {
    if (this.phase === 'lull') return 'respect';
    if (this.phase === 'betray') return 'betray';
    return 'none';
  }

  beamMultiplier(): number {
    return this.phase === 'exposed' || this.phase === 'betray' ? 1.8 : 1;
  }

  onRespected(): void {
    this.lullEvents++;
  }

  onBetrayalConsumed(): void {
    this.phase = 'exposed';
    if (this.sim.memory.learn('beam')) this.sim.log('K', 'it learned to hunt the beam');
  }
}

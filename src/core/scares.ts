import type { ScareLevel } from './config';
import type { Phantom } from './director/perception';
import { cellAt, cellCenter, Tile } from './level';
import { angleDiff, angleTo, dist, type Vec2 } from './math';
import type { Player } from './player';
import { Rng } from './rng';
import type { Sim } from './sim';
import type { GameEvent, ScareKind } from './types';

interface Pending {
  armed: number;
  startAngle: number;
}

/**
 * Jump scares, staged by the Director — never on a timer, never during a real chase, and
 * never two close together. Most are your own panic made visible (the Entity knows nothing
 * of them); one is physical: something comes down through the ceiling tiles, and that noise
 * is real, so it can draw the real thing to you.
 *
 * The real strikes — its hand finding you in the open, the locker door torn open — are
 * flagged too, so the presentation can give them the full sting.
 *
 * Own random stream, so turning scares off never changes anything else in a run.
 */
export class Scares {
  readonly level: ScareLevel;
  /** Staged this run (for the designer view). */
  staged = 0;
  readonly history: { t: number; kind: ScareKind; player: number }[] = [];
  private readonly rng: Rng;
  private readonly ready = new Map<number, number>();
  private readonly pending = new Map<number, Pending>();
  private nextRoll = 0;

  constructor(private readonly sim: Sim) {
    this.level = sim.config.scares ?? 'normal';
    this.rng = new Rng((sim.config.seed ^ 0x5ca7e1) >>> 0);
  }

  private gap(): number {
    return this.level === 'intense' ? this.rng.range(45, 80) : this.rng.range(95, 170);
  }

  /** When a player may next be scared (for tests and the designer view). */
  readyAt(pl: Player): number {
    return this.ready.get(pl.id) ?? 0;
  }

  update(dt: number): void {
    void dt;
    if (this.level === 'off') return;
    const sim = this.sim;
    for (const [id, p] of this.pending) {
      const pl = sim.players[id];
      if (!pl || !pl.active || pl.hidden || sim.time - p.armed > 3.5) {
        this.pending.delete(id);
        continue;
      }
      // You heard it behind you, and you turned around.
      if (Math.abs(angleDiff(p.startAngle, pl.angle)) > 2.1) {
        this.pending.delete(id);
        const pos = this.ahead(pl, 1.25, 1.6);
        if (pos) this.stage(pl, 'behind', 0.95, pos);
      }
    }
    if (sim.time < this.nextRoll) return;
    this.nextRoll = sim.time + 1;
    for (const pl of sim.players) {
      if (!pl.active || sim.time < 75) continue;
      if (sim.time < this.readyAt(pl) || this.pending.has(pl.id)) continue;
      if (sim.entity.target === pl.id) continue; // a real chase needs no help
      if (sim.director.phase === 'relax' && !this.rng.chance(0.25)) continue;
      const base = this.level === 'intense' ? 0.05 : 0.025;
      const p = base * (0.4 + pl.stress.value + 0.5 * sim.director.floor);
      if (this.rng.chance(p)) this.tryStage(pl);
    }
  }

  private tryStage(pl: Player): boolean {
    const sim = this.sim;
    const options: ScareKind[] = [];
    if (pl.hidden) {
      if (pl.hidden.kind !== 'bed' && pl.hiddenFor > 6) options.push('locker');
      options.push('whisper');
    } else {
      const dark = sim.world.lighting.sample(pl.pos) < 0.12;
      if (pl.flashlight.on && dark) options.push('flicker', 'flicker');
      options.push('behind', 'drop', 'whisper');
      if (this.nearWindow(pl)) options.push('window', 'window', 'window');
    }
    this.rng.shuffle(options);
    for (const kind of options) {
      if (this.build(pl, kind)) return true;
    }
    return false;
  }

  private build(pl: Player, kind: ScareKind): boolean {
    const sim = this.sim;
    switch (kind) {
      case 'flicker': {
        // The torch stutters. In the dark frame between, it is standing right there.
        const pos = this.ahead(pl, 2.2, 3.6);
        if (!pos) return false;
        this.stage(pl, 'flicker', 1, pos);
        return true;
      }
      case 'behind': {
        // Footsteps right behind you. Turn around and see.
        const back = pl.angle + Math.PI + this.rng.range(-0.5, 0.5);
        const at = { x: pl.pos.x + Math.cos(back) * 2.2, y: pl.pos.y + Math.sin(back) * 2.2 };
        if (sim.world.isSolid(cellAt(sim.level, at))) return false;
        for (let k = 0; k < 2; k++) {
          sim.emitPhantomSound('entityStep', { x: at.x + Math.cos(back) * k * 0.7, y: at.y + Math.sin(back) * k * 0.7 }, 30, pl);
        }
        this.pending.set(pl.id, { armed: sim.time, startAngle: pl.angle });
        this.ready.set(pl.id, sim.time + 12);
        sim.log('scare', `footsteps behind ${pl.name} — waiting for them to turn`);
        return true;
      }
      case 'window': {
        const w = this.nearWindow(pl);
        if (!w) return false;
        sim.events.push({ type: 'lightning', strength: 1 });
        this.stage(pl, 'window', 1, w);
        return true;
      }
      case 'drop': {
        // Something comes down through the ceiling tiles. This one is real: everything hears it.
        const pos = this.ahead(pl, 1.6, 2.8);
        if (!pos) return false;
        const z = sim.level.zoneOf[cellAt(sim.level, pos)]!;
        if (z < 0 || sim.level.zones[z]!.exterior) return false;
        sim.world.props.push({
          id: sim.world.newId(),
          kind: 'debris',
          pos,
          label: 'a ceiling tile',
          examine: 'A ceiling tile, and a slick of something dark. Above it the void is black. Something was lying up there.',
        });
        sim.emitNoise('thud', pos, 44, 'world');
        this.stage(pl, 'drop', 0.85, pos, false);
        return true;
      }
      case 'locker': {
        const spot = pl.hidden;
        if (!spot) return false;
        const at = cellCenter(sim.level, spot.access);
        sim.emitPhantomSound('inhale', at, 18, pl);
        this.stage(pl, 'locker', 0.9, at);
        return true;
      }
      case 'whisper':
        this.stage(pl, 'whisper', 0.5);
        return true;
      default:
        return false;
    }
  }

  private stage(pl: Player, kind: ScareKind, intensity: number, pos?: Vec2, phantom = true): void {
    const sim = this.sim;
    const ev: GameEvent = { type: 'scare', kind, intensity, phantom, to: pl.id };
    if (pos) ev.pos = { ...pos };
    sim.events.push(ev);
    this.ready.set(pl.id, sim.time + this.gap());
    this.staged++;
    this.history.push({ t: sim.time, kind, player: pl.id });
    if (this.history.length > 30) this.history.shift();
    pl.stress.spike(0.12 * intensity);
    sim.log('scare', `${kind} for ${pl.name}${phantom ? '' : ' (real)'}`);
  }

  /** A floor cell straight ahead, in sight, at a given range. */
  private ahead(pl: Player, near: number, far: number): Vec2 | null {
    const sim = this.sim;
    for (let i = 0; i < 6; i++) {
      const d = this.rng.range(near, far);
      const a = pl.angle + this.rng.range(-0.12, 0.12);
      const pos = { x: pl.pos.x + Math.cos(a) * d, y: pl.pos.y + Math.sin(a) * d };
      const c = cellAt(sim.level, pos);
      if (c < 0 || sim.level.tiles[c] !== Tile.Floor) continue;
      if (!sim.world.los(pl.pos, pos)) continue;
      if (dist(sim.entity.pos, pos) < 3) continue;
      return pos;
    }
    return null;
  }

  /** The face of a window close by, in front of you. */
  private nearWindow(pl: Player): Vec2 | null {
    const sim = this.sim;
    const { level } = sim;
    const cx = Math.floor(pl.pos.x);
    const cy = Math.floor(pl.pos.y);
    let best: Vec2 | null = null;
    let bd = Infinity;
    for (let y = cy - 4; y <= cy + 4; y++) {
      for (let x = cx - 4; x <= cx + 4; x++) {
        if (x < 0 || y < 0 || x >= level.w || y >= level.h) continue;
        if (level.tiles[y * level.w + x] !== Tile.Window) continue;
        const c = { x: x + 0.5, y: y + 0.5 };
        // the face that looks into the building
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
          const n = (y + dy) * level.w + (x + dx);
          if (x + dx < 0 || y + dy < 0 || x + dx >= level.w || y + dy >= level.h || level.tiles[n] !== Tile.Floor) continue;
          const face = { x: c.x + dx * 0.5, y: c.y + dy * 0.5 };
          const d = dist(face, pl.pos);
          if (d > 4.5 || d < 1) continue;
          if (Math.abs(angleDiff(pl.angle, angleTo(pl.pos, face))) > 0.6) continue;
          if (!sim.world.los(pl.pos, { x: face.x + dx * 0.05, y: face.y + dy * 0.05 })) continue;
          if (d < bd) {
            bd = d;
            best = face;
          }
        }
      }
    }
    return best;
  }

  // ------------------------------------------------------------------ real strikes

  /** Its hand found you in the open. */
  onStrike(pl: Player): void {
    const sim = this.sim;
    this.ready.set(pl.id, Math.max(this.readyAt(pl), sim.time + 40));
    if (this.level === 'off') return;
    sim.events.push({ type: 'scare', kind: 'lunge', intensity: 1, phantom: false, pos: { ...sim.entity.pos }, to: pl.id });
  }

  /** It opened your hiding place, and you were in it. */
  onFound(pl: Player): void {
    const sim = this.sim;
    if (this.level === 'off') return;
    sim.events.push({ type: 'scare', kind: 'kill', intensity: 1, phantom: false, pos: { ...sim.entity.pos }, to: pl.id });
  }

  /** Perception just showed this player something false [S]. Footsteps can become a turn-around. */
  onFalseSignal(pl: Player, kind: string, phantom: Phantom | null): void {
    void phantom;
    const sim = this.sim;
    if (this.level === 'off' || kind !== 'steps' || pl.hidden) return;
    if (sim.time < 75 || sim.time < this.readyAt(pl) || this.pending.has(pl.id)) return;
    if (this.rng.chance(this.level === 'intense' ? 0.5 : 0.25)) {
      this.pending.set(pl.id, { armed: sim.time, startAngle: pl.angle });
      this.ready.set(pl.id, sim.time + 12);
    }
  }
}

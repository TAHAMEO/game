import type { Entity, Tell, TellKind } from '../entity';
import { angleDiff, angleTo, dist } from '../math';
import type { TellKindKey } from '../persistence';
import type { Player } from '../player';
import type { Sim } from '../sim';
import type { HidingSpot } from '../types';
import { BEAM_HALF, VIEW_FOV } from './perception';

interface TellRecord {
  tell: Tell;
  perceived: boolean;
  audible: boolean;
  startHidden: boolean;
  startDist: number;
  maxSpeed: number;
  movedAfter: boolean;
  noisy: boolean;
  enteredHide: boolean;
  exitedHide: boolean;
  losBroken: boolean;
  windowEnd: number;
}

interface Encounter {
  start: number;
  lastThreat: number;
  tactics: Set<string>;
  /** Players already dead when it began. */
  deaths: number;
}

export interface FakeContext {
  entity: Entity;
  spot?: HidingSpot;
}

/** A tactic is "yours" after this many escapes with it. */
const DISMANTLE_WINS = 3;

/**
 * Y. THE LEARNED TELL / META-ADAPTATION. The Director reads its own output and inverts
 * it: once you reliably read the Entity's body language it starts lying with it; once a
 * tactic reliably saves you, it takes that tactic away. The knowledge persists across
 * deaths — the arms race has no ceiling.
 */
export class Adaptation {
  readonly runReads: Record<TellKindKey, { seen: number; read: number }> = {
    tilt: { seen: 0, read: 0 },
    inhale: { seen: 0, read: 0 },
    turn: { seen: 0, read: 0 },
  };
  readonly runWins = new Map<string, number>();
  readonly recent: Set<string>[] = [];
  encounter: Encounter | null = null;
  escapes = 0;
  comfort = 0;
  shifts = 0;
  fakeBoostUntil = -1;
  fakesShown = 0;
  fakesTaken = 0;
  private records: TellRecord[] = [];

  constructor(private readonly sim: Sim) {}

  // ------------------------------------------------------------------ tells

  accuracy(kind: TellKindKey): number {
    const s = this.sim.memory.data.tellStats[kind];
    return (s.read + 1) / (s.seen + 2);
  }

  onTell(tell: Tell, audibleLevel: number): void {
    if (tell.kind === 'snap') return;
    const sim = this.sim;
    const pl = sim.focus;
    if (tell.fake) this.fakesShown++;
    this.records.push({
      tell,
      perceived: false,
      audible: audibleLevel >= 5,
      startHidden: !!pl.hidden,
      startDist: dist(pl.pos, sim.entity.pos),
      maxSpeed: 0,
      movedAfter: false,
      noisy: false,
      enteredHide: false,
      exitedHide: false,
      losBroken: false,
      windowEnd: tell.t0 + tell.dur + (tell.kind === 'turn' ? 4 : tell.kind === 'inhale' ? 1 : 0.3),
    });
  }

  /** Can a player see the Entity right now? Used for tell perception (and fear). */
  playerSeesEntity(pl: Player = this.sim.focus): boolean {
    const sim = this.sim;
    const ent = sim.entity;
    if (!pl.active) return false;
    const d = dist(pl.pos, ent.pos);
    if (d > 15) return false;
    const off = Math.abs(angleDiff(pl.angle, angleTo(pl.pos, ent.pos)));
    if (off > VIEW_FOV / 2 + 0.05) return false;
    if (!sim.world.los(pl.pos, ent.pos)) return false;
    const lit = sim.world.lighting.sample(ent.pos) > 0.035 || (pl.flashlight.on && off < BEAM_HALF && d < 14) || d < 2.5;
    return lit;
  }

  notePlayerNoise(loudness: number, kind: string): void {
    if (kind === 'breath' || loudness < 12) return;
    for (const r of this.records) if (this.sim.time <= r.windowEnd) r.noisy = true;
  }

  noteHide(entering: boolean): void {
    for (const r of this.records) {
      if (this.sim.time > r.windowEnd) continue;
      if (entering) r.enteredHide = true;
      else r.exitedHide = true;
    }
  }

  private updateTells(): void {
    const sim = this.sim;
    const pl = sim.focus;
    const sees = this.records.length ? this.playerSeesEntity() : false;
    for (let i = this.records.length - 1; i >= 0; i--) {
      const r = this.records[i]!;
      const t = sim.time;
      if (t <= r.tell.t0 + r.tell.dur) r.perceived ||= sees || r.audible;
      r.maxSpeed = Math.max(r.maxSpeed, pl.speed);
      if (t >= r.tell.t0 + r.tell.dur && pl.speed > 0.6) r.movedAfter = true;
      if (!sim.world.los(pl.pos, sim.entity.pos)) r.losBroken = true;
      if (t < r.windowEnd) continue;
      this.records.splice(i, 1);
      this.finalize(r);
    }
  }

  private finalize(r: TellRecord): void {
    const sim = this.sim;
    if (!r.perceived || r.tell.kind === 'snap') return;
    const kind = r.tell.kind as TellKindKey;
    const pl = sim.focus;
    let read: boolean;
    switch (kind) {
      case 'tilt':
        read = !r.noisy && r.maxSpeed < 0.45;
        break;
      case 'inhale':
        if (r.startHidden && !r.tell.fake && !r.exitedHide) return; // nothing you could have done
        read = dist(pl.pos, sim.entity.pos) > r.startDist + 0.8 || r.losBroken || r.enteredHide || r.exitedHide;
        break;
      case 'turn':
        read = r.movedAfter || r.exitedHide;
        break;
    }
    if (r.tell.fake) {
      if (read) {
        this.fakesTaken++;
        sim.log('Y', `you believed a FAKE ${kind} — exactly as you were taught`);
      }
      return; // lies don't count toward how well you read the truth
    }
    const stats = sim.memory.data.tellStats[kind];
    stats.seen++;
    this.runReads[kind].seen++;
    if (read) {
      stats.read++;
      this.runReads[kind].read++;
      sim.director.stress.spike(-0.02);
    }
    if (stats.seen >= 3 && this.accuracy(kind) >= 0.62 && !sim.memory.learned(`fake:${kind}`)) {
      if (!sim.features.fakedTells) return;
      sim.memory.learn(`fake:${kind}`);
      sim.memory.addXp(1);
      sim.log('Y', `it noticed you read its ${kind === 'turn' ? 'slow turn' : kind === 'tilt' ? 'head-tilt' : 'inhale'}. It will start lying with it.`);
      sim.journal(kind === 'turn' ? 'When it turns its back, it is leaving. (Is it?)' : kind === 'tilt' ? 'When its head tilts, it is listening. Hold still. Hold your breath.' : 'The breath in means it is about to move. Go.');
    }
  }

  shouldFake(kind: TellKind, ctx: FakeContext): boolean {
    const sim = this.sim;
    if (!sim.features.fakedTells || kind === 'snap') return false;
    if (!sim.memory.learned(`fake:${kind}`)) return false;
    const pl = sim.focus;
    const d = dist(pl.pos, ctx.entity.pos);
    if (kind === 'tilt' && (d > 9 || d < 2.5)) return false;
    if (kind === 'turn' && d > 12) return false;
    if (kind === 'inhale') {
      if (!pl.hidden || !ctx.spot) return false;
      if (dist(pl.pos, ctx.entity.pos) > 7) return false;
    }
    const boost = sim.time < this.fakeBoostUntil ? 1.4 : 1;
    const p = Math.min(0.85, (0.35 + 0.4 * this.accuracy(kind as TellKindKey)) * boost);
    return sim.rng.chance(p);
  }

  // ------------------------------------------------------------------ tactics

  addTactic(tactic: string): void {
    if (this.encounter) this.encounter.tactics.add(tactic);
  }

  private updateEncounter(): void {
    const sim = this.sim;
    const ent = sim.entity;
    const k = ent.stateKind;
    const players = sim.players.filter((p) => p.active);
    // An encounter is anyone's: it runs while it threatens any of you.
    const threat = players.some((pl) => {
      const d = dist(ent.pos, pl.pos);
      return k === 'chase' || k === 'lunge' || (ent.threatening && d < 9) || (k === 'feint' && d < 12);
    });
    if (threat) {
      if (!this.encounter) {
        this.encounter = { start: sim.time, lastThreat: sim.time, tactics: new Set(), deaths: sim.players.filter((p) => !p.alive).length };
        sim.log('Y', 'encounter begins');
      }
      this.encounter.lastThreat = sim.time;
    }
    const e = this.encounter;
    if (!e) return;
    for (const pl of players) if (pl.hidden) e.tactics.add(`hide:${pl.hidden.kind}`);
    // A death ends it: nobody escaped this one.
    const dead = sim.players.filter((p) => !p.alive).length;
    if (!players.length || dead > e.deaths) {
      this.encounter = null;
      return;
    }
    if (sim.time - e.lastThreat > 8) this.endEncounter(e);
  }

  private endEncounter(e: Encounter): void {
    const sim = this.sim;
    this.encounter = null;
    this.escapes++;
    sim.director.onEscape();
    const tactics = [...e.tactics];
    sim.log('Y', `you escaped (${tactics.length ? tactics.join(', ') : 'nothing in particular'})`);
    this.recent.push(e.tactics);
    if (this.recent.length > 6) this.recent.shift();
    for (const t of tactics) {
      this.runWins.set(t, (this.runWins.get(t) ?? 0) + 1);
      const wins = (sim.memory.data.tacticWins[t] ?? 0) + 1;
      sim.memory.data.tacticWins[t] = wins;
      const lastThree = this.recent.slice(-3).filter((s) => s.has(t)).length;
      if (wins >= DISMANTLE_WINS && lastThree >= 2 && sim.features.strategyDismantling && !sim.memory.learned(`counter:${t}`)) {
        sim.memory.learn(`counter:${t}`);
        sim.memory.addXp(1);
        sim.log('Y', `DISMANTLING: "${t}" keeps saving you. Next time it won't.`);
      }
    }
  }

  counterActive(tactic: string): boolean {
    return this.sim.features.strategyDismantling && this.sim.memory.learned(`counter:${tactic}`);
  }

  /** Regions that have been your safe route out of a chase — the planner barricades these. */
  routeCounters(): number[] {
    if (!this.sim.features.strategyDismantling) return [];
    return Object.keys(this.sim.memory.data.learned)
      .filter((k) => k.startsWith('counter:route:'))
      .map((k) => Number(k.slice('counter:route:'.length)))
      .filter((n) => Number.isFinite(n));
  }

  // ------------------------------------------------------------------ moving goalposts

  private updateComfort(dt: number): void {
    const sim = this.sim;
    if (!sim.features.movingGoalposts) return;
    const ent = sim.entity;
    const active = ent.stateKind !== 'rest' && ent.stateKind !== 'retreat' && ent.stateKind !== 'feed';
    const progressing = sim.time - sim.director.profile.lastProgressT < 120 || this.escapes > 0;
    if (sim.director.stress.value < 0.3 && active && progressing && sim.focus.active) this.comfort += dt;
    else this.comfort = Math.max(0, this.comfort - dt * 0.5);
    if (this.comfort > 45) this.shift();
  }

  /** Comfort is always the signal that something is about to change. */
  private shift(): void {
    const sim = this.sim;
    this.comfort = 0;
    this.shifts++;
    const opts = ['preempt', 'stalk'] as const;
    const learnedFakes = (['tilt', 'inhale', 'turn'] as const).some((k) => sim.memory.learned(`fake:${k}`));
    const choice = learnedFakes && sim.rng.chance(0.4) ? 'fakes' : sim.rng.pick(opts);
    if (choice === 'fakes') this.fakeBoostUntil = sim.time + 90;
    else if (choice === 'preempt') sim.director.bait.forceNext = true;
    else sim.director.stalkUntil = sim.time + 60;
    sim.log('Y', `you got comfortable — the ground shifts (${choice})`);
  }

  update(dt: number): void {
    this.updateTells();
    this.updateEncounter();
    this.updateComfort(dt);
  }
}

import type { Entity, EntityState, Tell, TellKind } from '../entity';
import { cellAt, cellCenter, Tile } from '../level';
import { clamp01, dist, lerp, type Vec2 } from '../math';
import { distanceField } from '../path';
import type { Plan, PlanOutcome } from '../plans';
import type { Sim } from '../sim';
import type { DoorState, HidingSpot, Item, Noise, Note, Prop, ThermalMark } from '../types';
import { World } from '../world';
import { Adaptation, type FakeContext } from './adaptation';
import { BaitPlanner } from './bait';
import { Debt } from './debt';
import { FlashlightTax, Perception } from './perception';
import { Profile } from './profile';
import { StressModel } from './stress';

export type Phase = 'build' | 'peak' | 'relax';

export type Activity =
  | { kind: 'roam'; cell: number; reason: string }
  | { kind: 'hunt'; center: Vec2; radius: number; reason: string }
  | { kind: 'plan'; plan: Plan }
  | { kind: 'retreat'; reason: string };

/**
 * The Director. It never moves the Entity directly and never scripts a scare: it reads
 * the player (stress, profile), keeps the pacing, and hands the Entity intentions —
 * where to roam, where to hunt, which plan to try. The Entity still has to walk there
 * and use its own senses.
 */
export class Director {
  readonly stress = new StressModel();
  readonly profile: Profile;
  readonly debt: Debt;
  readonly perception: Perception;
  readonly flashTax: FlashlightTax;
  readonly adapt: Adaptation;
  readonly bait: BaitPlanner;
  phase: Phase = 'relax';
  phaseT = 0;
  menace = 0;
  stalkUntil = -1;
  /** For the designer overlay: the last thing the Director decided and why. */
  lastDecision = '';
  private punishedHide: HidingSpot | null = null;
  private lastEntityHeard = -99;
  private runXpFromEscapes = 0;
  private relaxDur = 45;

  constructor(private readonly sim: Sim) {
    this.profile = new Profile(sim);
    this.debt = new Debt(sim.features.risingFloor);
    this.perception = new Perception(sim);
    this.flashTax = new FlashlightTax(sim);
    this.adapt = new Adaptation(sim);
    this.bait = new BaitPlanner(sim);
  }

  /** Z: the Entity's rising baseline awareness, 0..1. */
  get floor(): number {
    return this.debt.floor;
  }

  /** Effective Entity Knowledge tier: persisted tier, nudged up as the run drags on. */
  get tier(): number {
    const base = this.sim.config.tierOverride ?? this.sim.memory.tier;
    return Math.min(4, base + (this.floor > 0.6 ? 1 : 0));
  }

  // ================================================================== update

  update(dt: number): void {
    const sim = this.sim;
    const pl = sim.player;
    const ent = sim.entity;
    const d = dist(ent.pos, pl.pos);
    const seen = this.adapt.playerSeesEntity();
    const heard = sim.time - this.lastEntityHeard < 3;
    const threat = clamp01(
      (ent.stateKind === 'chase' || ent.stateKind === 'lunge' ? 0.7 : 0) +
        (seen ? 0.45 : 0) +
        (heard ? 0.2 : 0) +
        (ent.threatening && d < 8 ? 0.25 : 0),
    );
    this.stress.update(dt, {
      turnRate: pl.turnRate,
      sprinting: pl.sprinting,
      threat,
      hidden: !!pl.hidden,
      reversals: this.profile.reversals,
    });
    this.profile.update(dt);
    const zone = sim.world.zoneIndexAt(pl.cell);
    this.debt.update(dt, {
      hiddenFor: pl.hidden ? pl.hiddenFor : 0,
      sinceProgress: sim.time - this.profile.lastProgressT,
      speed: pl.speed,
      inFalseLead: this.inFalseLead(zone),
    });
    this.perception.update(dt);
    this.flashTax.update();
    this.adapt.update(dt);
    this.bait.update();
    this.pacing(dt, threat);
    this.punishingPause();
    this.chaseMercy(dt);
    this.considerPlans();
  }

  private nextPlanCheck = 0;

  /**
   * The Entity doesn't only react [T]: while it is idling about, the Director keeps
   * asking whether there is a board worth setting. Rate-limited; never interrupts a hunt.
   */
  private considerPlans(): void {
    const sim = this.sim;
    if (sim.time < this.nextPlanCheck || this.phase === 'relax' || !sim.player.alive) return;
    this.nextPlanCheck = sim.time + 4;
    const k = sim.entity.stateKind;
    const passive = k === 'roam' || (k === 'leave' && sim.entity.stateT > 2);
    if (!passive || this.bait.active) return;
    const plan = this.bait.choose(sim.entity);
    if (plan) {
      this.lastDecision = `plan ${plan.kind}`;
      sim.entity.startPlan(plan);
    }
  }

  private inFalseLead(zone: number): boolean {
    const sim = this.sim;
    if (!sim.features.falseLeads) return false;
    if (zone >= 0 && sim.world.falseLeadZones.has(zone) && sim.world.notes.some((n) => n.read && n.falseLead && n.pointsToZone === zone)) return true;
    // Loitering at a door that will never open.
    for (const door of sim.world.doors) {
      if (!door.locked || door.lock === 'maintenance') continue;
      if (dist(cellCenter(sim.level, door.cell), sim.player.pos) < 2.5) return true;
    }
    return false;
  }

  private pacing(dt: number, threat: number): void {
    const sim = this.sim;
    const ent = sim.entity;
    this.phaseT += dt;
    if (threat > 0.3) this.menace += dt * (ent.stateKind === 'chase' ? 0.15 : 0.07);
    else this.menace -= dt * 0.025;
    this.menace = clamp01(this.menace);
    const floor = this.floor;
    switch (this.phase) {
      case 'relax':
        if (this.phaseT > this.relaxDur) this.setPhase('build', 'the quiet is over');
        break;
      case 'build':
        if (this.phaseT > lerp(75, 15, floor) || this.menace > 0.6) this.setPhase('peak', 'pressure builds');
        break;
      case 'peak':
        if ((this.menace > 0.9 && ent.stateKind !== 'chase') || this.phaseT > lerp(70, 110, floor)) {
          // Early on you get real quiet stretches. Late in the debt you get almost none.
          this.relaxDur = Math.max(5, 50 * (1 - 0.88 * floor)) + sim.rng.range(0, 6 * (1 - floor));
          this.setPhase('relax', `a breather of ~${Math.round(this.relaxDur)}s`);
        }
        break;
    }
  }

  private setPhase(p: Phase, why: string): void {
    this.phase = p;
    this.phaseT = 0;
    if (p === 'relax') this.menace *= 0.4;
    this.sim.log('director', `phase → ${p} (${why})`);
  }

  private chaseFor = 0;

  /**
   * A chase is a set piece the Director paces, not a race to the death: after a while
   * the Entity breaks off — with the slow turn, which may itself be a feint [Y]. The
   * debt shortens the leash [Z]: late in a run, chases last much longer.
   */
  private chaseMercy(dt: number): void {
    const sim = this.sim;
    const ent = sim.entity;
    const k = ent.stateKind;
    if (k !== 'chase' && k !== 'lunge') {
      this.chaseFor = 0;
      return;
    }
    this.chaseFor += dt;
    const leash = lerp(14, 34, this.floor);
    if (k === 'chase' && this.chaseFor > leash && dist(ent.pos, sim.player.pos) > 2) {
      this.chaseFor = 0;
      sim.log('director', `chase called off after ${leash.toFixed(0)}s (the leash grows with the debt)`);
      ent.startLeave(true, 'it slows — and lets you go. This time.');
    }
  }

  /** J: the punishing pause. Hiding too long draws it in. */
  private punishingPause(): void {
    const sim = this.sim;
    const pl = sim.player;
    const spot = pl.hidden;
    if (!spot) {
      this.punishedHide = null;
      return;
    }
    const grace = lerp(30, 12, this.floor);
    if (pl.hiddenFor < grace || this.punishedHide === spot) return;
    const ent = sim.entity;
    const k = ent.stateKind;
    if (k === 'roam' || k === 'rest' || k === 'retreat' || k === 'leave') {
      this.punishedHide = spot;
      ent.hunt(cellCenter(sim.level, spot.access), 3.5, '[J] you have been still too long', 25);
    }
  }

  // ================================================================== entity intentions

  nextActivity(entity: Entity): Activity {
    const sim = this.sim;
    const pl = sim.player;
    const nest = sim.level.markers.nest;
    const decide = (a: Activity): Activity => {
      this.lastDecision = a.kind === 'plan' ? `plan ${a.plan.kind}` : `${a.kind}: ${a.reason}`;
      return a;
    };
    if (this.phase === 'relax' && !pl.isMarked) {
      const home = nest.length ? cellCenter(sim.level, nest[0]!) : entity.pos;
      if (dist(entity.pos, home) > 4) return decide({ kind: 'retreat', reason: 'the Director gives you a breath (shorter every time)' });
      return decide({ kind: 'roam', cell: this.leaveTarget(entity), reason: 'drifting' });
    }
    const plan = this.bait.choose(entity);
    if (plan) return decide({ kind: 'plan', plan });
    const stalking = sim.time < this.stalkUntil;
    if (this.phase === 'peak' || stalking || sim.rng.chance(this.floor * 0.35)) {
      // Fear feeds it: the more stressed you are, the tighter its guess.
      const err = lerp(9, 2.5, Math.max(this.stress.value, this.floor, stalking ? 0.8 : 0));
      const a = sim.rng.range(0, Math.PI * 2);
      const r = sim.rng.range(0, err);
      let center = { x: pl.pos.x + Math.cos(a) * r, y: pl.pos.y + Math.sin(a) * r };
      if (sim.world.isSolid(cellAt(sim.level, center))) center = { ...pl.pos };
      return decide({ kind: 'hunt', center, radius: lerp(7, 4, this.floor), reason: stalking ? '[Y] stalking you' : `hunting near you (guess ±${err.toFixed(1)})` });
    }
    return decide({ kind: 'roam', cell: this.roamTarget(), reason: `roaming (drawn toward you ${Math.round(this.roamBias() * 100)}%)` });
  }

  private reach: Float32Array | null = null;
  private reachVersion = -1;

  /** Can the Entity actually walk to this cell? (Locked doors wall parts of the map off.) */
  reachable(cell: number): boolean {
    const sim = this.sim;
    if (cell < 0) return false;
    if (!this.reach || this.reachVersion !== sim.world.lockVersion) {
      const src = sim.level.markers.nest[0] ?? sim.entity.cell;
      this.reach = distanceField(sim.level, [src], sim.world.entityPassable);
      this.reachVersion = sim.world.lockVersion;
    }
    return Number.isFinite(this.reach[cell]!);
  }

  roamBias(): number {
    if (this.sim.time < this.stalkUntil) return 1;
    return clamp01(0.12 + 0.75 * this.floor + 0.35 * this.stress.value);
  }

  roamTarget(): number {
    const sim = this.sim;
    const { level } = sim;
    const bias = this.roamBias();
    let best = level.spawn;
    let bestScore = Infinity;
    const from = sim.entity.pos;
    for (let i = 0; i < 16; i++) {
      const r = sim.rng.pick(level.regions);
      const c = sim.rng.pick(r.cells);
      if (level.tiles[c] !== Tile.Floor || !this.reachable(c)) continue;
      const p = cellCenter(level, c);
      // Short legs: it re-decides often, which is what makes it feel like it is thinking.
      if (dist(p, from) > 24 && i < 12) continue;
      const score = bias * dist(p, sim.player.pos) + (1 - bias) * sim.rng.range(0, 40);
      if (score < bestScore) {
        bestScore = score;
        best = c;
      }
    }
    return best;
  }

  leaveTarget(entity: Entity): number {
    const sim = this.sim;
    const { level } = sim;
    let best = entity.cell;
    let bestD = -1;
    for (let i = 0; i < 14; i++) {
      const r = sim.rng.pick(level.regions);
      const c = sim.rng.pick(r.cells);
      if (level.tiles[c] !== Tile.Floor || !this.reachable(c)) continue;
      const p = cellCenter(level, c);
      const d = dist(p, sim.player.pos);
      if (d > bestD && dist(p, entity.pos) < 26) {
        bestD = d;
        best = c;
      }
    }
    return best;
  }

  huntPoint(entity: Entity, center: Vec2, radius: number): number {
    const sim = this.sim;
    const { level } = sim;
    let best = cellAt(level, center);
    let bestScore = -Infinity;
    for (let i = 0; i < 16; i++) {
      const a = sim.rng.range(0, Math.PI * 2);
      const r = sim.rng.range(0, radius);
      const c = cellAt(level, { x: center.x + Math.cos(a) * r, y: center.y + Math.sin(a) * r });
      if (c < 0 || level.tiles[c] !== Tile.Floor || !this.reachable(c)) continue;
      const p = cellCenter(level, c);
      let score = sim.rng.range(0, 1);
      for (const s of sim.world.spots) if (dist(cellCenter(level, s.access), p) < 2.5) score += 0.4;
      for (const m of sim.world.thermal) if (dist(m.pos, p) < 3) score += World.heatOf(m, sim.time);
      if (dist(p, entity.pos) < 1.5) score -= 2;
      if (score > bestScore) {
        bestScore = score;
        best = c;
      }
    }
    return best >= 0 ? best : entity.cell;
  }

  wantsHunt(): boolean {
    return this.phase === 'peak' || this.sim.rng.chance(this.floor * 0.5);
  }

  restDuration(): number {
    return lerp(40, 8, this.floor);
  }

  hearingShift(): number {
    return (this.phase === 'relax' ? 4 : 0) - 2 * this.stress.value;
  }

  sightMultiplier(): number {
    return 1 + 0.25 * this.floor;
  }

  beamMultiplier(): number {
    return this.flashTax.beamMultiplier();
  }

  beamResponse(): 'respect' | 'betray' | 'none' {
    return this.flashTax.beamResponse();
  }

  /** Bonus loudness for sounds it has learned to listen for [Y]. */
  attunement(n: Noise): number {
    if (n.kind === 'click' && this.adapt.counterActive('dark')) return 12;
    return 0;
  }

  ignoresNoise(n: Noise): boolean {
    return n.kind === 'hum' && this.sim.objectives.powerOn;
  }

  counterActive(tactic: string): boolean {
    return this.adapt.counterActive(tactic);
  }

  shouldFake(kind: TellKind, ctx: FakeContext): boolean {
    return this.adapt.shouldFake(kind, ctx);
  }

  /** How much does a hiding place deserve a look? */
  checkScore(spot: HidingSpot, ctx: 'search' | 'scent' | 'inhale'): number {
    const sim = this.sim;
    const pl = sim.player;
    let s = 0.12;
    if (spot.body) return -1;
    if (spot.occupant?.kind === 'player') {
      const grace = lerp(30, 12, this.floor);
      s += clamp01((pl.hiddenFor - grace) / 25) * 0.6; // J: the punishing pause
      s += 0.25 * this.floor;
      if (ctx === 'scent') s += 0.8;
    }
    if (spot.occupant?.kind === 'survivor') s += 0.25;
    if (sim.features.thermalResidue) {
      const m = sim.world.thermal.find((t) => t.cell === spot.cell);
      if (m) s += 0.5 * World.heatOf(m, sim.time);
    }
    if (sim.features.breathFog && sim.world.fog.some((f) => f.spot === spot.id)) s += 0.8;
    if (spot.baited && spot.occupant) s += 1;
    if (this.adapt.counterActive(`hide:${spot.kind}`)) s += 0.55;
    if (sim.time - spot.lastChecked < 30) s -= 0.5;
    if (spot.ajar && !spot.baited) s -= 0.1;
    return s;
  }

  chooseChecks(entity: Entity, center: Vec2, radius: number): number[] {
    const sim = this.sim;
    const fav = this.profile.favouriteHide();
    const extra = fav && this.adapt.counterActive(`hide:${fav}`) ? 1 : 0;
    const n = 1 + Math.round(2 * this.floor) + extra;
    const scored = sim.world.spots
      .filter((s) => dist(cellCenter(sim.level, s.access), center) <= radius)
      .map((s) => ({ s, score: this.checkScore(s, 'search') + sim.rng.range(0, 0.15) }))
      .sort((a, b) => b.score - a.score);
    const out: number[] = [];
    for (const { s, score } of scored) {
      if (out.length >= n) break;
      if (sim.rng.next() < score) out.push(s.id);
    }
    void entity;
    return out;
  }

  // ================================================================== entity hooks

  onEntityState(prev: EntityState['kind'], next: EntityState['kind'], reason: string): void {
    void prev;
    void reason;
    if (next === 'chase') this.stress.spike(0.15);
  }

  onTell(tell: Tell, audibleLevel: number): void {
    this.adapt.onTell(tell, audibleLevel);
  }


  onFeintResolved(sprung: boolean): void {
    this.sim.log('Y', sprung ? 'the feint worked — you moved when it turned away' : 'you waited out the feint');
    if (!sprung) this.sim.journal('It turned away, and it did not leave. It waited just out of sight.');
  }

  onFakeCheckResolved(spot: HidingSpot, sprung: boolean): void {
    void spot;
    this.sim.log('Y', sprung ? 'you bolted at the false breath' : 'you held your nerve through a bluff');
  }

  onBeamRespected(): void {
    this.flashTax.onRespected();
    this.sim.log('S', 'flashlight tax (lull): it backs away from your beam');
  }

  onBeamBetrayal(): void {
    this.flashTax.onBetrayalConsumed();
    this.sim.player.faultFlashlight(this.sim.rng.range(3.5, 5.5));
    this.sim.log('S', 'flashlight tax: it walks straight into the beam now');
  }

  onDistractionTaken(n: Noise): void {
    void n;
    this.profile.throwsTaken++;
    this.adapt.addTactic('distract');
  }

  onDistractionCountered(): void {
    this.sim.journal('It walked past the bottle. It came to where I threw it from.');
  }

  onThermalRead(m: ThermalMark): void {
    this.sim.log('V', `it reads a warm print on a ${m.surface}`);
  }

  onChaseLost(): void {
    const sim = this.sim;
    const r = sim.world.regionAt(sim.player.cell);
    if (r >= 0 && sim.level.regions[r]!.kind === 'corridor') this.adapt.addTactic(`route:${r}`);
  }

  onPlayerHit(): void {
    this.stress.spike(0.5);
  }

  onNearMiss(): void {
    this.stress.spike(0.35);
    this.sim.log('director', 'near miss');
  }

  onMarked(why: string): void {
    this.sim.log('V', `you are marked (${why}) — it can track you across zones until you wash`);
  }

  onSpotChecked(spot: HidingSpot, found: boolean): void {
    this.sim.log('entity', `checked a ${spot.kind}${found ? ' — FOUND' : ''}`);
  }

  onSpotBaited(spot: HidingSpot): void {
    this.sim.log('T', `offered safety: a ${spot.kind} is now ${spot.kind === 'bed' ? 'clear underneath' : 'ajar'}`);
  }

  onMimicSprung(survivor: number): void {
    this.sim.log('X', `you followed ${this.sim.survivors.list[survivor]!.def.name}'s voice`);
  }

  onPlanFinished(plan: Plan, outcome: PlanOutcome): void {
    this.bait.onFinished(plan, outcome);
  }

  onEscape(): void {
    const sim = this.sim;
    this.menace = clamp01(this.menace + 0.35);
    if (this.runXpFromEscapes < 3) {
      this.runXpFromEscapes += 0.5;
      sim.memory.addXp(0.5);
    }
    this.profile.progress();
  }

  // ================================================================== player hooks


  /** Every real noise passes through here (for tell reads and stress). */
  onNoise(n: Noise): void {
    if (n.source === 'player') this.adapt.notePlayerNoise(n.loudness, n.kind);
    if (n.source === 'entity' && (n.playerLevel ?? 0) >= 6) this.lastEntityHeard = this.sim.time;
  }

  onGasp(): void {
    this.stress.spike(0.1);
  }

  onFlashlight(on: boolean, faulted: boolean): void {
    if (faulted) return;
    if (on) this.perception.noteAction('torch on');
    else if (this.adapt.encounter) this.adapt.addTactic('dark');
    this.stress.spike(0.02);
  }

  onHide(spot: HidingSpot, entering: boolean): void {
    this.adapt.noteHide(entering);
    if (entering) {
      this.profile.hideCounts[spot.kind]++;
      this.sim.memory.data.hideKinds[spot.kind]++;
      this.perception.noteAction('hid');
    }
  }

  onDoor(door: DoorState, closing: boolean): void {
    const sim = this.sim;
    if (closing && dist(sim.entity.pos, cellCenter(sim.level, door.cell)) < 10) this.adapt.addTactic('doors');
  }

  onJammedDoor(door: DoorState): void {
    void door;
    this.sim.journal('A door I always used is blocked now. Something put it there.');
  }

  onThrow(): void {
    this.profile.throws++;
    this.perception.noteAction('threw a bottle');
  }

  onPickup(item: Item): void {
    if (item.kind === 'fuse' || item.kind === 'key') this.profile.progress();
    if (item.relocated) this.sim.log('T', `you found the ${item.kind} where it left it`);
  }

  onNoteRead(note: Note): void {
    if (note.falseLead) this.sim.log('U', `false lead read: "${note.title}"`);
  }

  onFalseLeadAttempt(): void {
    this.stress.spike(0.02);
  }

  onExamine(prop: Prop): void {
    if (prop.kind === 'sign' || prop.kind === 'remains') this.sim.log('W', `you read the nest: ${prop.label}`);
  }

  onFoundRemains(): void {
    this.stress.spike(0.25);
    this.sim.log('W', 'you found your own remains');
  }

  onWashed(): void {
    const sim = this.sim;
    if (sim.memory.learn('mark')) sim.log('K', 'it learned you go to water when marked');
  }

  onBreakerStart(): void {
    this.sim.log('U', 'you are committed at the breaker');
  }

  onPowerRestored(): void {
    const sim = this.sim;
    this.profile.progress();
    if (sim.memory.learn('breaker')) sim.log('K', 'it learned you must stand at the fuse box');
  }

  onRadio(fake: boolean): void {
    const sim = this.sim;
    this.profile.progress();
    sim.memory.learn('radio');
    if (fake) sim.log('U', 'it answered the radio in the rescuer’s voice');
  }
}

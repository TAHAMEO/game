import { defaultConfig, MAX_PLAYERS, type Features, type SimConfig } from './config';
import { Director } from './director/director';
import { Entity } from './entity';
import { CHARACTER_NAMES } from './hospital';
import { idleInput, type InputState } from './input';
import { cellAt, cellCenter, parseLevel, type Level } from './level';
import { angleTo, clamp01, dist, type Vec2 } from './math';
import { dressNest } from './nest';
import { Objectives } from './objectives';
import { Persistence, type KVStore, MemoryStore } from './persistence';
import { Player } from './player';
import { Rng } from './rng';
import { Scares } from './scares';
import { SoundField } from './sound';
import { Story } from './story';
import { Survivors } from './survivors';
import type { GameEvent, Noise, NoiseSource, SoundKind, ThermalMark, VoiceSig } from './types';
import { Weather } from './weather';
import { World } from './world';

export type RunPhase = 'playing' | 'dead' | 'escaped';

export interface LogEntry {
  t: number;
  tag: string;
  text: string;
}

export interface SayOptions {
  voice?: VoiceSig;
  radio?: boolean;
  mimic?: boolean;
  duration?: number;
  volume?: number;
  pos?: Vec2;
  /** The noise the words rode on: each player hears them at their own loudness. */
  noise?: Noise;
  /** Only this player hears it. */
  to?: number;
}

let sharedLevel: Level | null = null;
const IDLE: InputState = Object.freeze(idleInput());

/**
 * One run of THE QUIET. Engine-agnostic: no DOM, no timers, fixed timestep, seeded.
 * The presentation layer feeds `InputState` in and drains `GameEvent`s out.
 *
 * A run holds one or more players. Most of what the Director reads is about one of them
 * at a time — the `focus`: whoever the Entity is after, or else whoever has strayed
 * furthest from the others. With one player the focus is simply you.
 */
export class Sim {
  readonly config: SimConfig;
  readonly features: Features;
  readonly rng: Rng;
  readonly level: Level;
  readonly world: World;
  readonly memory: Persistence;
  readonly players: Player[] = [];
  /** Fuses and keys belong to everyone who went in [shared runs]. */
  readonly team = { fuses: 0, keys: new Set<string>() };
  readonly entity: Entity;
  readonly director: Director;
  readonly objectives: Objectives;
  readonly survivors: Survivors;
  readonly story: Story;
  readonly scares: Scares;
  readonly weather: Weather;
  readonly runNumber: number;
  /** Which seat this copy of the run presents (the presentation layer's "you"). */
  localId = 0;
  /** The player the Director is reading right now. */
  focus: Player;
  time = 0;
  phase: RunPhase = 'playing';
  events: GameEvent[] = [];
  recentNoises: Noise[] = [];
  readonly designerLog: LogEntry[] = [];
  private readonly sound: SoundField;
  /** A stream of its own, so a shared run never reshuffles what a solo run rolls. */
  private readonly groupRng: Rng;
  private noiseSeq = 0;
  private lastSave = 0;
  private focusUntil = 0;
  private deathsThisRun = 0;

  constructor(config: SimConfig = defaultConfig(), store: KVStore = new MemoryStore()) {
    this.config = config;
    this.features = config.features;
    this.rng = new Rng(config.seed);
    this.groupRng = new Rng((config.seed ^ 0x2545f491) >>> 0);
    sharedLevel ??= parseLevel();
    this.level = sharedLevel;
    this.memory = new Persistence(store);
    this.memory.data.runs++;
    this.runNumber = this.memory.data.runs;
    this.memory.save();
    this.world = new World(this.level, this.rng.fork(), { falseLeads: this.features.falseLeads });
    this.sound = new SoundField(this.level);
    const lastName = this.memory.data.lastCharacter?.name;
    const names = CHARACTER_NAMES.filter((n) => n !== lastName);
    const first = this.rng.pick(names);
    this.players.push(new Player(this, first, 0));
    const count = Math.max(1, Math.min(MAX_PLAYERS, Math.floor(config.players ?? 1)));
    const others = this.groupRng.shuffle(names.filter((n) => n !== first));
    for (let i = 1; i < count; i++) this.players.push(new Player(this, others[(i - 1) % others.length]!, i));
    this.focus = this.players[0]!;
    this.director = new Director(this);
    this.entity = new Entity(this);
    this.objectives = new Objectives(this);
    this.survivors = new Survivors(this);
    dressNest(this);
    this.story = new Story(this);
    this.scares = new Scares(this);
    this.weather = new Weather(this);
    const who = this.players.map((p) => p.name).join(', ');
    this.log('run', `run ${this.runNumber} — ${who}. Entity Knowledge tier ${this.director.tier} (xp ${this.memory.data.xp}).`);
  }

  /** The player this copy presents. In the single-player game, simply the player. */
  get player(): Player {
    return this.players[this.localId] ?? this.players[0]!;
  }

  /** Players still in the building and alive. */
  get activePlayers(): Player[] {
    return this.players.filter((p) => p.active);
  }

  // =================================================================== stepping

  /**
   * Advance one fixed step. `input` is the single player's input, or one per player
   * (by id) in a shared run; players without one stand still.
   */
  step(dt: number, input: InputState | readonly InputState[]): void {
    if (this.phase !== 'playing') return;
    this.time += dt;
    const inputs: readonly InputState[] = Array.isArray(input) ? input : [input as InputState];
    for (const p of this.players) p.update(dt, inputs[p.id] ?? IDLE);
    this.world.update(dt, this.time);
    this.updateProjectiles(dt);
    this.chooseFocus();
    this.director.update(dt);
    this.entity.update(dt);
    this.survivors.update(dt);
    this.objectives.update();
    this.story.update(dt);
    this.scares.update(dt);
    this.weather.update();
    const cutoff = this.time - 1.5;
    while (this.recentNoises.length && this.recentNoises[0]!.t < cutoff) this.recentNoises.shift();
    if (this.time - this.lastSave > 30) {
      this.lastSave = this.time;
      this.memory.save();
    }
  }

  /** Hand accumulated presentation events to the caller. */
  drainEvents(): GameEvent[] {
    const e = this.events;
    this.events = [];
    return e;
  }

  /**
   * Whom the Director reads. Whoever the Entity is engaged with; otherwise, every so
   * often, whoever has strayed from the others (it picks off the one who wanders alone),
   * then whoever is most frightened.
   */
  private chooseFocus(): void {
    const active = this.activePlayers;
    if (active.length === 0) return;
    if (active.length === 1) {
      this.focus = active[0]!;
      return;
    }
    const engaged = this.entity.target;
    if (engaged !== null && this.players[engaged]?.active) {
      this.focus = this.players[engaged]!;
      this.focusUntil = this.time + 8;
      return;
    }
    if (this.focus.active && this.time < this.focusUntil) return;
    let best = active[0]!;
    let bestScore = -Infinity;
    for (const p of active) {
      const alone = active.every((o) => o === p || dist(o.pos, p.pos) > 6);
      const score = (alone ? 1 : 0) + 0.6 * p.stress.value + this.groupRng.range(0, 0.35);
      if (score > bestScore) {
        bestScore = score;
        best = p;
      }
    }
    if (best !== this.focus) this.log('director', `the Director turns its attention to ${best.name}`);
    this.focus = best;
    this.focusUntil = this.time + this.groupRng.range(18, 30);
  }

  private updateProjectiles(dt: number): void {
    const ps = this.world.projectiles;
    for (let i = ps.length - 1; i >= 0; i--) {
      const p = ps[i]!;
      p.t += dt;
      const next = { x: p.pos.x + p.vel.x * dt, y: p.pos.y + p.vel.y * dt };
      if (this.world.isSolid(cellAt(this.level, next)) || p.t > 0.9) {
        this.emitNoise('glass', p.pos, 62, 'world', { origin: p.origin });
        ps.splice(i, 1);
      } else p.pos = next;
    }
  }

  // =================================================================== sound

  /**
   * A real sound. Propagated once through the building and sampled for every listener:
   * the Entity, each survivor, and every player's ears (volume + apparent direction).
   */
  emitNoise(kind: SoundKind, pos: Vec2, loudness: number, source: NoiseSource, extra: Partial<Noise> = {}): Noise {
    let cell = cellAt(this.level, pos);
    if (cell < 0) cell = this.focus.cell;
    const n: Noise = { id: ++this.noiseSeq, kind, pos: { ...pos }, cell, loudness, source, t: this.time, ...extra };
    if (source === 'player' && n.player === undefined) n.player = 0;
    this.sound.propagate(cell, loudness, this.world.doorOpenness);
    n.entityLevel = this.sound.levelAt(this.entity?.cell ?? -1);
    if (kind === 'breaker') n.entityLevel = Math.max(n.entityLevel, 60); // heard from anywhere in the building
    n.playerLevels = this.players.map((p) => this.sound.levelAt(p.soundCell));
    n.playerLevel = n.playerLevels[this.focus.id] ?? 0;
    n.survivorLevels = (this.survivors?.list ?? []).map((s) => this.sound.levelAt(cellAt(this.level, s.pos)));
    this.recentNoises.push(n);
    this.director?.onNoise(n);
    for (const p of this.players) {
      if (!p.active) continue;
      if (source === 'player' && n.player === p.id) {
        this.events.push({ type: 'sound', kind, pos: n.pos, volume: clamp01(loudness / 50), dir: p.angle, phantom: false, source, player: p.id, to: p.id });
        continue;
      }
      const lv = n.playerLevels[p.id] ?? 0;
      if (lv <= 0.5 && kind !== 'breaker') continue;
      const vol = kind === 'breaker' ? 1 : clamp01(lv / 45);
      const dir = this.sound.apparentDirection(p.soundCell) ?? angleTo(p.pos, pos);
      const ev: GameEvent = { type: 'sound', kind, pos: n.pos, volume: vol, dir, phantom: false, source, to: p.id };
      if (n.speaker !== undefined) ev.speaker = n.speaker;
      if (n.player !== undefined) ev.player = n.player;
      this.events.push(ev);
    }
    return n;
  }

  /** A sound only one player hears — made by their own panic [S]. The Entity hears nothing. */
  emitPhantomSound(kind: SoundKind, pos: Vec2, loudness: number, to: Player = this.focus): void {
    const cell = cellAt(this.level, pos);
    if (cell < 0) return;
    this.sound.propagate(cell, loudness, this.world.doorOpenness);
    const pc = to.soundCell;
    const lv = this.sound.levelAt(pc);
    if (lv <= 0.5) return;
    const dir = this.sound.apparentDirection(pc) ?? angleTo(to.pos, pos);
    this.events.push({ type: 'sound', kind, pos: { ...pos }, volume: clamp01(lv / 45), dir, phantom: true, source: 'phantom', to: to.id });
  }

  // =================================================================== world helpers

  /** Leave heat on a surface [V]. */
  touch(cell: number, pos: Vec2, surface: ThermalMark['surface']): void {
    if (this.features.thermalResidue) this.world.addThermal(cell, pos, surface, this.time);
  }

  /** A diegetic line of text. `to` = one player; otherwise everyone. */
  notice(text: string, duration = 3.5, to?: number): void {
    const ev: GameEvent = { type: 'notice', text, duration };
    if (to !== undefined) ev.to = to;
    this.events.push(ev);
  }

  say(speaker: string, text: string, o: SayOptions = {}): void {
    const duration = o.duration ?? Math.max(3, text.length / 14);
    const base: GameEvent = { type: 'subtitle', speaker, text, duration };
    if (o.voice) base.voice = o.voice;
    if (o.radio) base.radio = true;
    if (o.mimic) base.mimic = true;
    if (o.to !== undefined) {
      const p = this.players[o.to];
      const ev: GameEvent = { ...base };
      if (o.volume !== undefined) ev.volume = o.volume;
      if (o.pos && p) ev.dir = angleTo(p.pos, o.pos);
      ev.to = o.to;
      this.events.push(ev);
      return;
    }
    if (!o.pos) {
      const ev: GameEvent = { ...base };
      if (o.volume !== undefined) ev.volume = o.volume;
      this.events.push(ev);
      return;
    }
    // Spoken somewhere in the building: each player hears it from where they stand.
    for (const p of this.players) {
      if (!p.active) continue;
      let volume = o.volume;
      if (o.noise?.playerLevels) volume = Math.min(1, (o.noise.playerLevels[p.id] ?? 0) / 30);
      else if (this.players.length > 1 && dist(p.pos, o.pos) > 12) continue;
      const ev: GameEvent = { ...base, dir: angleTo(p.pos, o.pos), to: p.id };
      if (volume !== undefined) ev.volume = volume;
      this.events.push(ev);
    }
  }

  log(tag: string, text: string): void {
    this.designerLog.push({ t: this.time, tag, text });
    if (this.designerLog.length > 80) this.designerLog.shift();
  }

  /** Player counter-knowledge [K]: diegetic notes that survive death. */
  journal(text: string): void {
    const j = this.memory.data.journal;
    if (j.includes(text)) return;
    j.push(text);
    this.notice('(You scrawl something in the notebook.)', 2.5);
  }

  // =================================================================== run end

  onPlayerDeath(pl: Player, cause: string): void {
    if (this.phase !== 'playing') return;
    this.events.push({ type: 'death', cause, player: pl.id });
    this.recordDeath(pl, cause);
    // The dead keep their last view; the hiding place is free for whoever is still alive.
    if (pl.hidden && this.players.length > 1) pl.hidden.occupant = null;
    if (this.players.length > 1 && this.activePlayers.length) this.notice(`${pl.name} is gone.`, 6);
    this.checkRunEnd();
  }

  onEscape(pl: Player = this.focus): void {
    if (this.phase !== 'playing' || !pl.active) return;
    pl.escaped = true;
    pl.channel = null;
    pl.readingNote = null;
    pl.readingRecord = null;
    if (pl.hidden) {
      pl.hidden.occupant = null;
      pl.hidden = null;
    }
    this.events.push({ type: 'escape', player: pl.id });
    const data = this.memory.data;
    data.escapes++;
    this.memory.addXp(3);
    // [W] "Your previous body" is the life just before this one. If nobody died this run, nobody is left behind.
    if (this.deathsThisRun === 0) data.lastCharacter = null;
    if (this.players.length > 1 && this.activePlayers.length) this.notice(`${pl.name} made it through the gate.`, 6);
    this.checkRunEnd();
  }

  private recordDeath(pl: Player, cause: string): void {
    const data = this.memory.data;
    data.deaths++;
    this.memory.addXp(this.deathsThisRun === 0 ? 3 : 1.5);
    this.deathsThisRun++;
    const run = this.runNumber;
    data.trophies.push({ kind: 'item', label: `${pl.shortName}'s torch`, run });
    // Carried things go with whoever is the last to hold them.
    if (this.activePlayers.length === 0) {
      for (let i = 0; i < pl.inv.fuses; i++) data.trophies.push({ kind: 'item', label: 'a fuse', run });
      if (pl.inv.keys.has('maintenance')) data.trophies.push({ kind: 'item', label: 'a maintenance key', run });
    }
    if (pl.inv.bottles > 0) data.trophies.push({ kind: 'item', label: 'an empty bottle', run });
    data.trophies.push({ kind: 'debris', label: 'torn scrubs', run });
    if (data.trophies.length > 60) data.trophies.splice(0, data.trophies.length - 60);
    const zone = this.level.zones[this.level.zoneOf[pl.soundCell]!]?.name ?? 'somewhere';
    data.lastCharacter = { name: pl.name, run, cell: pl.soundCell, zone, cause, spot: pl.hidden ? pl.hidden.id : null };
  }

  /** The run ends when nobody is left inside. */
  private checkRunEnd(): void {
    if (this.activePlayers.length > 0) return;
    const anyOut = this.players.some((p) => p.escaped);
    this.phase = anyOut ? 'escaped' : 'dead';
    this.events.push({ type: 'runEnd', outcome: this.phase });
    const data = this.memory.data;
    data.flashlightReliance = data.flashlightReliance * 0.6 + this.director.profile.flashlightReliance * 0.4;
    this.story.onRunEnd();
    this.memory.save();
    this.log('run', `${this.phase === 'dead' ? 'death' : 'escape'}. Entity Knowledge now ${data.xp} xp (tier ${this.memory.tier}).`);
  }

  /** Where in the world the presented player is. */
  get playerZone(): string {
    const z = this.level.zoneOf[this.player.soundCell]!;
    return z >= 0 ? this.level.zones[z]!.name : '';
  }

  cellCenter(c: number): Vec2 {
    return cellCenter(this.level, c);
  }
}

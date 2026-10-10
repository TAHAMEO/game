import { defaultConfig, type Features, type SimConfig } from './config';
import { Director } from './director/director';
import { Entity } from './entity';
import { CHARACTER_NAMES } from './hospital';
import type { InputState } from './input';
import { cellAt, cellCenter, parseLevel, type Level } from './level';
import { angleTo, clamp01, type Vec2 } from './math';
import { dressNest } from './nest';
import { Objectives } from './objectives';
import { Persistence, type KVStore, MemoryStore } from './persistence';
import { Player } from './player';
import { Rng } from './rng';
import { SoundField } from './sound';
import { Survivors } from './survivors';
import type { GameEvent, Noise, NoiseSource, SoundKind, ThermalMark, VoiceSig } from './types';
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
}

let sharedLevel: Level | null = null;

/**
 * One run of THE QUIET. Engine-agnostic: no DOM, no timers, fixed timestep, seeded.
 * The presentation layer feeds `InputState` in and drains `GameEvent`s out.
 */
export class Sim {
  readonly config: SimConfig;
  readonly features: Features;
  readonly rng: Rng;
  readonly level: Level;
  readonly world: World;
  readonly memory: Persistence;
  readonly player: Player;
  readonly entity: Entity;
  readonly director: Director;
  readonly objectives: Objectives;
  readonly survivors: Survivors;
  readonly runNumber: number;
  time = 0;
  phase: RunPhase = 'playing';
  events: GameEvent[] = [];
  recentNoises: Noise[] = [];
  readonly designerLog: LogEntry[] = [];
  private readonly sound: SoundField;
  private noiseSeq = 0;
  private lastSave = 0;

  constructor(config: SimConfig = defaultConfig(), store: KVStore = new MemoryStore()) {
    this.config = config;
    this.features = config.features;
    this.rng = new Rng(config.seed);
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
    this.player = new Player(this, this.rng.pick(names));
    this.director = new Director(this);
    this.entity = new Entity(this);
    this.objectives = new Objectives(this);
    this.survivors = new Survivors(this);
    dressNest(this);
    this.log('run', `run ${this.runNumber} — ${this.player.name}. Entity Knowledge tier ${this.director.tier} (xp ${this.memory.data.xp}).`);
  }

  // =================================================================== stepping

  step(dt: number, input: InputState): void {
    if (this.phase !== 'playing') return;
    this.time += dt;
    this.player.update(dt, input);
    this.world.update(dt, this.time);
    this.updateProjectiles(dt);
    this.director.update(dt);
    this.entity.update(dt);
    this.survivors.update(dt);
    this.objectives.update();
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
   * the Entity, each survivor, and the player's ears (volume + apparent direction).
   */
  emitNoise(kind: SoundKind, pos: Vec2, loudness: number, source: NoiseSource, extra: Partial<Noise> = {}): Noise {
    let cell = cellAt(this.level, pos);
    if (cell < 0) cell = this.player.cell;
    const n: Noise = { id: ++this.noiseSeq, kind, pos: { ...pos }, cell, loudness, source, t: this.time, ...extra };
    this.sound.propagate(cell, loudness, this.world.doorOpenness);
    n.entityLevel = this.sound.levelAt(this.entity?.cell ?? -1);
    if (kind === 'breaker') n.entityLevel = Math.max(n.entityLevel, 60); // heard from anywhere in the building
    const pc = this.player.soundCell;
    n.playerLevel = this.sound.levelAt(pc);
    n.survivorLevels = (this.survivors?.list ?? []).map((s) => this.sound.levelAt(cellAt(this.level, s.pos)));
    const dir = this.sound.apparentDirection(pc) ?? angleTo(this.player.pos, pos);
    this.recentNoises.push(n);
    this.director?.onNoise(n);
    if (source === 'player') {
      this.events.push({ type: 'sound', kind, pos: n.pos, volume: clamp01(loudness / 50), dir: this.player.angle, phantom: false, source });
    } else if (n.playerLevel > 0.5 || kind === 'breaker') {
      const vol = kind === 'breaker' ? 1 : clamp01(n.playerLevel / 45);
      const ev: GameEvent = { type: 'sound', kind, pos: n.pos, volume: vol, dir, phantom: false, source };
      if (n.speaker !== undefined) ev.speaker = n.speaker;
      this.events.push(ev);
    }
    return n;
  }

  /** A sound only you hear — made by your own panic [S]. The Entity hears nothing. */
  emitPhantomSound(kind: SoundKind, pos: Vec2, loudness: number): void {
    const cell = cellAt(this.level, pos);
    if (cell < 0) return;
    this.sound.propagate(cell, loudness, this.world.doorOpenness);
    const pc = this.player.soundCell;
    const lv = this.sound.levelAt(pc);
    if (lv <= 0.5) return;
    const dir = this.sound.apparentDirection(pc) ?? angleTo(this.player.pos, pos);
    this.events.push({ type: 'sound', kind, pos: { ...pos }, volume: clamp01(lv / 45), dir, phantom: true, source: 'phantom' });
  }


  // =================================================================== world helpers

  /** Leave heat on a surface [V]. */
  touch(cell: number, pos: Vec2, surface: ThermalMark['surface']): void {
    if (this.features.thermalResidue) this.world.addThermal(cell, pos, surface, this.time);
  }

  notice(text: string, duration = 3.5): void {
    this.events.push({ type: 'notice', text, duration });
  }

  say(speaker: string, text: string, o: SayOptions = {}): void {
    const ev: GameEvent = { type: 'subtitle', speaker, text, duration: o.duration ?? Math.max(3, text.length / 14) };
    if (o.voice) ev.voice = o.voice;
    if (o.radio) ev.radio = true;
    if (o.mimic) ev.mimic = true;
    if (o.volume !== undefined) ev.volume = o.volume;
    if (o.pos) ev.dir = angleTo(this.player.pos, o.pos);
    this.events.push(ev);
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

  onPlayerDeath(cause: string): void {
    if (this.phase !== 'playing') return;
    this.phase = 'dead';
    this.events.push({ type: 'death', cause });
    this.finishRun('death', cause);
  }

  onEscape(): void {
    if (this.phase !== 'playing') return;
    this.phase = 'escaped';
    this.events.push({ type: 'escape' });
    this.finishRun('escape', '');
  }

  private finishRun(outcome: 'death' | 'escape', cause: string): void {
    const data = this.memory.data;
    const pl = this.player;
    if (outcome === 'death') {
      data.deaths++;
      this.memory.addXp(3);
      const run = this.runNumber;
      data.trophies.push({ kind: 'item', label: `${pl.name.split(' ').pop()}'s torch`, run });
      for (let i = 0; i < pl.inv.fuses; i++) data.trophies.push({ kind: 'item', label: 'a fuse', run });
      if (pl.inv.keys.has('maintenance')) data.trophies.push({ kind: 'item', label: 'a maintenance key', run });
      if (pl.inv.bottles > 0) data.trophies.push({ kind: 'item', label: 'an empty bottle', run });
      data.trophies.push({ kind: 'debris', label: 'torn scrubs', run });
      if (data.trophies.length > 60) data.trophies.splice(0, data.trophies.length - 60);
      const zone = this.level.zones[this.level.zoneOf[pl.soundCell]!]?.name ?? 'somewhere';
      data.lastCharacter = { name: pl.name, run, cell: pl.soundCell, zone, cause, spot: pl.hidden ? pl.hidden.id : null };
    } else {
      data.escapes++;
      this.memory.addXp(3);
    }
    data.flashlightReliance = data.flashlightReliance * 0.6 + this.director.profile.flashlightReliance * 0.4;
    this.memory.save();
    this.log('run', `${outcome}. Entity Knowledge now ${data.xp} xp (tier ${this.memory.tier}).`);
  }

  /** Where in the world the player is, for presentation. */
  get playerZone(): string {
    const z = this.level.zoneOf[this.player.soundCell]!;
    return z >= 0 ? this.level.zones[z]!.name : '';
  }

  cellCenter(c: number): Vec2 {
    return cellCenter(this.level, c);
  }
}


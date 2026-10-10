import { defaultConfig, PRESETS, type Features, type ScareLevel } from '../src/core/config';
import { idleInput, type InputState } from '../src/core/input';
import { MemoryStore } from '../src/core/persistence';
import { Sim } from '../src/core/sim';
import type { GameEvent } from '../src/core/types';

export const DT = 1 / 60;

export interface MakeOpts {
  seed?: number;
  features?: Partial<Features>;
  tier?: number | null;
  store?: MemoryStore;
  /** How many people go in (default 1). */
  players?: number;
  /** The system tests for S–Z run without staged scares or the story layer unless asked. */
  scares?: ScareLevel;
  story?: boolean;
}

export function makeSim(opts: MakeOpts = {}): Sim {
  const cfg = defaultConfig(opts.seed ?? 1);
  cfg.features = { ...PRESETS.full, ...(opts.features ?? {}) };
  cfg.tierOverride = opts.tier ?? null;
  cfg.players = opts.players ?? 1;
  cfg.scares = opts.scares ?? 'off';
  cfg.story = opts.story ?? false;
  return new Sim(cfg, opts.store ?? new MemoryStore());
}

/** Step the sim for `seconds`, collecting every presentation event. */
export function step(sim: Sim, seconds: number, input: Partial<InputState> | ((s: Sim) => Partial<InputState>) = {}): GameEvent[] {
  const events: GameEvent[] = [];
  const n = Math.round(seconds / DT);
  for (let i = 0; i < n; i++) {
    const inp = { ...idleInput(), ...(typeof input === 'function' ? input(sim) : input) };
    sim.step(DT, inp);
    events.push(...sim.drainEvents());
  }
  return events;
}

/** Cell-centre position. */
export const at = (x: number, y: number) => ({ x: x + 0.5, y: y + 0.5 });

export function placePlayer(sim: Sim, x: number, y: number, angle = 0): void {
  sim.player.pos = at(x, y);
  sim.player.angle = angle;
  sim.player.vel = { x: 0, y: 0 };
}

export function placeEntity(sim: Sim, x: number, y: number, angle = 0): void {
  sim.entity.pos = at(x, y);
  sim.entity.angle = angle;
}

/** Keep the Entity out of the way (in the nest, asleep) for tests about other systems. */
export function sedateEntity(sim: Sim): void {
  sim.entity.update = () => {};
  placeEntity(sim, 2, 2);
}

/** Pin the live stress estimate to a value (tests of what stress *does*, not how it's measured). */
export function pinStress(sim: Sim, value: number): void {
  sim.director.stress.update = () => {};
  sim.director.stress.value = value;
}

export function cell(sim: Sim, x: number, y: number): number {
  return y * sim.level.w + x;
}

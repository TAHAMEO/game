import type { Sim } from '../core/sim';
import type { GameEvent } from '../core/types';
import type { InputController } from '../ui/input';

/** The simulation's fixed step. */
export const STEP = 1 / 60;
/** Never run more than this many steps in one frame (a long hitch is dropped, not replayed). */
export const MAX_STEPS = 6;

/**
 * One run, however it is being played: alone, hosting friends, or as a guest in someone
 * else's building. The presentation layer only ever talks to this.
 */
export interface Session {
  readonly kind: 'solo' | 'host' | 'client';
  /** The run to present. For a guest, a copy kept in step with the host's. */
  readonly sim: Sim;
  /** Your seat in the run. */
  readonly localId: number;
  /** The run keeps going while you are in a menu (it does when other people are in it). */
  readonly live: boolean;
  /** Advance by `dt` real seconds; returns the presentation events for this machine. */
  tick(dt: number, input: InputController | null): GameEvent[];
  /** Something to tell the player about the connection (null when all is well). */
  readonly status: string | null;
  dispose(): void;
}

/** Fixed-step accumulator shared by the sessions that step a simulation themselves. */
export class StepClock {
  private acc = 0;
  steps(dt: number): number {
    this.acc += dt;
    const n = Math.min(MAX_STEPS, Math.floor(this.acc / STEP));
    this.acc -= n * STEP;
    if (this.acc > STEP * MAX_STEPS) this.acc = 0;
    return n;
  }
}

/** Alone in the building. */
export class SoloSession implements Session {
  readonly kind = 'solo';
  readonly localId = 0;
  readonly live = false;
  readonly status = null;
  private readonly clock = new StepClock();

  constructor(readonly sim: Sim) {}

  tick(dt: number, input: InputController | null): GameEvent[] {
    const steps = this.clock.steps(dt);
    if (input) for (const inp of input.frame(dt, steps)) this.sim.step(STEP, inp);
    return this.sim.drainEvents();
  }

  dispose(): void {}
}

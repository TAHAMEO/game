import { Rng } from './rng';
import type { Sim } from './sim';

/**
 * The storm that took the power. Lightning is shared by everyone in the run (it comes
 * through every window at once) and means nothing to the Entity: it is weather, not noise.
 */
export class Weather {
  private readonly rng: Rng;
  private next: number;
  /** Time of the last flash (for the designer view and the renderer). */
  lastFlash = -99;

  constructor(private readonly sim: Sim) {
    this.rng = new Rng((sim.config.seed ^ 0x7e47be) >>> 0);
    this.next = 18 + this.rng.range(0, 25);
  }

  update(): void {
    const sim = this.sim;
    if (sim.time < this.next) return;
    this.next = sim.time + this.rng.range(28, 80);
    this.lastFlash = sim.time;
    sim.events.push({ type: 'lightning', strength: this.rng.range(0.35, 1) });
  }
}

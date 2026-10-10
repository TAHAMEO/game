import { clamp01, ewma, smoothstep } from '../math';

export interface StressSample {
  /** |camera turn| rad/s */
  turnRate: number;
  sprinting: boolean;
  /** 0..1 how present the real threat is (proximity, visibility, chase). */
  threat: number;
  hidden: boolean;
  /** Movement direction reversals per second (ping-ponging in a corridor). */
  reversals: number;
}

/**
 * The live stress estimate — fear as input. It is inferred purely from behaviour:
 * how frantically you look around, whether you sprint at nothing, how close the real
 * thing is, whether you hide. It is never shown to the player [S: no sanity bar].
 */
export class StressModel {
  fast = 0;
  slow = 0;
  /** Event spikes (near misses, gasps, flinching at ghosts), decaying. */
  spikes = 0;
  value = 0;
  readonly components = { look: 0, sprint: 0, threat: 0, hide: 0, dither: 0 };

  update(dt: number, s: StressSample): void {
    const c = this.components;
    c.look = smoothstep(1.4, 6, s.turnRate);
    c.sprint = s.sprinting ? (s.threat > 0.4 ? 0.5 : 1) : 0; // sprinting at nothing reads as panic
    c.threat = s.threat;
    c.hide = s.hidden ? 1 : 0;
    c.dither = clamp01(s.reversals / 1.5);
    const instant = 0.24 * c.look + 0.18 * c.sprint + 0.36 * c.threat + 0.12 * c.hide + 0.1 * c.dither;
    this.fast = ewma(this.fast, instant, dt, 3);
    this.slow = ewma(this.slow, this.fast, dt, 40);
    this.spikes = Math.max(0, this.spikes - this.spikes * dt / 10);
    this.value = clamp01(0.55 * this.fast + 0.45 * this.slow * 1.6 + this.spikes);
  }

  spike(amount: number): void {
    this.spikes = Math.min(0.6, this.spikes + amount);
  }
}

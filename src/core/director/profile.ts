import { ewma } from '../math';
import type { Sim } from '../sim';
import type { HideKind } from '../types';

/**
 * Player profile logging. The Director watches how you play — not to grade you, but
 * so the Entity can use it against you: the light you lean on [S], the lit routes you
 * prefer [T], the hiding place you trust [Y].
 */
export class Profile {
  /** Fraction of dark time spent with the torch on (EWMA). */
  flashlightReliance = 0;
  /** Fraction of moving time spent in lit cells (EWMA). */
  lightPreference = 0.5;
  readonly hideCounts: Record<HideKind, number> = { locker: 0, drawer: 0, bed: 0 };
  ghostSignals = 0;
  ghostReactions = 0;
  throws = 0;
  throwsTaken = 0;
  lastProgressT = 0;
  readonly regionTime = new Map<number, number>();
  reversals = 0;
  private lastMove = { x: 0, y: 0 };

  constructor(private readonly sim: Sim) {}

  update(dt: number): void {
    const sim = this.sim;
    const pl = sim.focus;
    if (!pl.active) return;
    const lum = sim.world.lighting.sample(pl.pos);
    if (lum < 0.18 && !pl.hidden) {
      this.flashlightReliance = ewma(this.flashlightReliance, pl.flashlight.on ? 1 : 0, dt, 90);
    }
    if (pl.speed > 0.5) {
      this.lightPreference = ewma(this.lightPreference, lum > 0.25 ? 1 : 0, dt, 120);
      const v = pl.vel;
      const len = Math.hypot(v.x, v.y);
      if (len > 0.5) {
        const dot = (v.x * this.lastMove.x + v.y * this.lastMove.y) / len;
        this.reversals = ewma(this.reversals, dot < -0.5 ? 1 / dt : 0, dt, 4);
        this.lastMove = { x: v.x / len, y: v.y / len };
      }
    } else this.reversals = ewma(this.reversals, 0, dt, 4);
    const r = sim.world.regionAt(pl.cell);
    if (r >= 0) this.regionTime.set(r, (this.regionTime.get(r) ?? 0) + dt);
  }

  favouriteHide(): HideKind | null {
    let best: HideKind | null = null;
    let n = 0;
    for (const k of Object.keys(this.hideCounts) as HideKind[]) {
      if (this.hideCounts[k] > n) {
        n = this.hideCounts[k];
        best = k;
      }
    }
    return best;
  }

  progress(): void {
    this.lastProgressT = this.sim.time;
  }
}

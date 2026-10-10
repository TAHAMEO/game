/**
 * Z. THE DEBT — time as dread. The Entity's baseline awareness rises with the clock
 * and rises faster while you linger: over-hiding, indecision, chasing false leads.
 * There is no visible timer; the floor is felt through ambience, flicker, and the
 * shrinking silences between its visits.
 */
export interface DebtContext {
  hiddenFor: number;
  /** Seconds since the last objective progress (item, power, radio). */
  sinceProgress: number;
  speed: number;
  inFalseLead: boolean;
}

export class Debt {
  /** Seconds of "felt" time including lingering penalties. */
  effectiveTime = 0;
  floor = 0;
  readonly lingering = { overHiding: 0, indecision: 0, falseLeads: 0 };

  constructor(
    private readonly enabled: boolean,
    /** Characteristic time for the floor to reach ~63%. */
    private readonly tau = 540,
  ) {}

  update(dt: number, ctx: DebtContext): void {
    if (!this.enabled) {
      this.floor = 0;
      return;
    }
    let rate = 1;
    if (ctx.hiddenFor > 20) {
      rate += 0.6;
      this.lingering.overHiding += dt;
    }
    if (ctx.inFalseLead) {
      rate += 1;
      this.lingering.falseLeads += dt;
    }
    if (ctx.sinceProgress > 90 && ctx.speed < 0.6 && ctx.hiddenFor <= 20) {
      rate += 0.5;
      this.lingering.indecision += dt;
    }
    this.effectiveTime += dt * rate;
    this.floor = 1 - Math.exp(-this.effectiveTime / this.tau);
  }
}

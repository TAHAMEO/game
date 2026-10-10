import { noise, type NoiseBuffers, tone } from './synth';

interface Voice {
  osc: OscillatorNode;
  gain: GainNode;
}

/**
 * The score. Never a tune: a drone that thickens with the debt, string clusters that rise
 * when you see or hear it (or think you do), a heartbeat pulse and stabs when it is on you.
 * Then silence — the score goes quiet after every scare, because silence is the loudest
 * thing in this building.
 */
export class Score {
  readonly out: GainNode;
  private readonly droneGain: GainNode;
  private readonly droneFilter: BiquadFilterNode;
  private readonly dissonance: GainNode;
  private readonly strings: GainNode;
  private readonly stringVoices: Voice[] = [];
  private readonly chaseGain: GainNode;
  private tension = 0;
  private chase = 0;
  private duckUntil = 0;
  private nextPulse = 0;
  private nextStab = 0;
  private nextCluster = 0;

  constructor(
    private readonly ctx: AudioContext,
    dest: AudioNode,
    private readonly noiseBufs: NoiseBuffers,
  ) {
    this.out = ctx.createGain();
    this.out.gain.value = 1;
    this.out.connect(dest);
    // drone: low fifths, detuned, through a breathing low-pass
    this.droneFilter = ctx.createBiquadFilter();
    this.droneFilter.type = 'lowpass';
    this.droneFilter.frequency.value = 220;
    this.droneFilter.Q.value = 2;
    this.droneGain = ctx.createGain();
    this.droneGain.gain.value = 0;
    this.droneFilter.connect(this.droneGain).connect(this.out);
    for (const [f, type, g] of [
      [41.2, 'sawtooth', 0.5],
      [41.5, 'sawtooth', 0.5],
      [61.7, 'triangle', 0.6],
      [82.4, 'sine', 0.4],
    ] as const) {
      const o = ctx.createOscillator();
      o.type = type;
      o.frequency.value = f;
      const og = ctx.createGain();
      og.gain.value = g;
      o.connect(og).connect(this.droneFilter);
      o.start();
    }
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 1 / 11;
    const lfoG = ctx.createGain();
    lfoG.gain.value = 90;
    lfo.connect(lfoG).connect(this.droneFilter.frequency);
    lfo.start();
    // a dissonant voice that creeps in with the debt [Z]
    this.dissonance = ctx.createGain();
    this.dissonance.gain.value = 0;
    const d = ctx.createOscillator();
    d.type = 'sawtooth';
    d.frequency.value = 58.27;
    d.connect(this.dissonance).connect(this.droneFilter);
    d.start();
    // string cluster: high, close, trembling
    this.strings = ctx.createGain();
    this.strings.gain.value = 0;
    const sf = ctx.createBiquadFilter();
    sf.type = 'lowpass';
    sf.frequency.value = 3200;
    this.strings.connect(sf).connect(this.out);
    for (const f of [622.3, 659.3, 698.5, 739.99, 1244.5, 1318.5]) {
      const o = ctx.createOscillator();
      o.type = 'triangle';
      o.frequency.value = f;
      const trem = ctx.createOscillator();
      trem.frequency.value = 5 + Math.random() * 3;
      const tg = ctx.createGain();
      tg.gain.value = 0.4;
      const g = ctx.createGain();
      g.gain.value = 0.5;
      trem.connect(tg).connect(g.gain);
      const drift = ctx.createOscillator();
      drift.frequency.value = 0.05 + Math.random() * 0.08;
      const dg = ctx.createGain();
      dg.gain.value = f * 0.012;
      drift.connect(dg).connect(o.frequency);
      o.connect(g).connect(this.strings);
      o.start();
      trem.start();
      drift.start();
      this.stringVoices.push({ osc: o, gain: g });
    }
    this.chaseGain = ctx.createGain();
    this.chaseGain.gain.value = 0;
    this.chaseGain.connect(this.out);
  }

  /** Hold the score down for a beat (after a scare). */
  duck(seconds: number): void {
    this.duckUntil = Math.max(this.duckUntil, this.ctx.currentTime + seconds);
  }

  update(dt: number, s: { tension: number; chase: boolean; floor: number; alive: boolean; vision: number }): void {
    const ctx = this.ctx;
    const now = ctx.currentTime;
    const k = (tau: number) => 1 - Math.exp(-dt / tau);
    this.tension += (s.tension - this.tension) * k(s.tension > this.tension ? 0.8 : 4);
    this.chase += ((s.chase ? 1 : 0) - this.chase) * k(s.chase ? 0.4 : 3);
    const ducked = now < this.duckUntil ? 0.15 : 1;
    const alive = s.alive ? 1 : 0.25;
    // calm: under the building's own sound; it climbs with the debt and with fear
    this.droneGain.gain.setTargetAtTime((0.032 + 0.1 * s.floor + 0.13 * this.tension) * ducked * alive * (1 - s.vision * 0.7), now, 1.2);
    this.dissonance.gain.setTargetAtTime(Math.max(0, s.floor - 0.35) * 0.4 + this.tension * 0.15, now, 3);
    this.strings.gain.setTargetAtTime(Math.max(0, this.tension - 0.25) * 0.032 * ducked * alive, now, 1.5);
    this.chaseGain.gain.setTargetAtTime(this.chase * 0.9 * ducked, now, 0.3);
    // when it is on you: a pulse like a running heart, and stabs
    if (this.chase > 0.05) {
      if (now >= this.nextPulse) {
        const bpm = 132;
        this.nextPulse = Math.max(now, this.nextPulse) + 60 / bpm;
        const o = { ctx, dest: this.chaseGain, t: this.nextPulse, noise: this.noiseBufs };
        tone(o, { f0: 58, f1: 34, env: { peak: 0.55, dur: 0.22 } });
        noise(o, { colour: 'brown', type: 'lowpass', f0: 180, env: { peak: 0.35, attack: 0.003, dur: 0.12 } });
        if (Math.random() < 0.35) noise(o, { at: 0.23, type: 'bandpass', f0: 2500, q: 1, env: { peak: 0.06, attack: 0.002, dur: 0.05 } });
      }
      if (now >= this.nextStab) {
        this.nextStab = now + 1.6 + Math.random() * 2.5;
        const o = { ctx, dest: this.chaseGain, t: now + 0.02, noise: this.noiseBufs };
        const base = [146.8, 155.6, 220, 233.1][Math.floor(Math.random() * 4)]!;
        for (const r of [1, 1.06, 1.5, 2.12]) {
          tone(o, { wave: 'sawtooth', f0: base * r, env: { peak: 0.045, attack: 0.01, dur: 0.7 }, filter: { type: 'lowpass', f: 2600, f1: 500 } });
        }
      }
    } else {
      this.nextPulse = now;
    }
    // now and then, a cluster swells out of the drone and dies (more often, the worse it gets)
    if (s.alive && now >= this.nextCluster) {
      this.nextCluster = now + 25 + Math.random() * 40 * (1 - 0.6 * s.floor);
      if (this.chase < 0.1 && now > this.duckUntil) {
        const o = { ctx, dest: this.out, t: now, noise: this.noiseBufs };
        for (const f of [103.8, 110, 116.5]) tone(o, { wave: 'sawtooth', f0: f, f1: f * 0.985, env: { peak: 0.018, attack: 3, dur: 6.5 }, filter: { type: 'lowpass', f: 300, f1: 900 } });
      }
    }
    void this.stringVoices;
  }
}

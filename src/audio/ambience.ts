import { grains, modal, noise, type NoiseBuffers, type Out, tone } from './synth';

export interface AmbienceState {
  exterior: boolean;
  /** 0..1 how much sky this place sees (windows, outdoors). */
  sky: number;
  /** 0..1 fluorescent light around you (powered fixtures). */
  light: number;
  powerOn: boolean;
  cold: boolean;
  floor: number;
  alive: boolean;
  zone: string;
}

type Spot = (make: (o: Out) => void, angle: number, dist: number, height: number, volume: number, wet: number) => void;

/**
 * The building breathing around you: room tone, rain on the roof and against the windows,
 * wind outside, the buzz of the tubes once the power is back, drips, pipes, metal settling,
 * and very rarely something that should not be there at all.
 */
export class Ambience {
  readonly out: GainNode;
  private readonly roomTone: GainNode;
  private readonly rainOut: GainNode;
  private readonly rainIn: GainNode;
  private readonly wind: GainNode;
  private readonly buzz: GainNode;
  private readonly hvac: GainNode;
  private nextDrip = 3;
  private nextCreak = 15;
  private nextDistant = 30;
  private nextUncanny = 120;
  private clock = 0;

  constructor(
    private readonly ctx: AudioContext,
    dest: AudioNode,
    private readonly noiseBufs: NoiseBuffers,
    private readonly spot: Spot,
  ) {
    this.out = ctx.createGain();
    this.out.connect(dest);
    this.roomTone = this.loop('brown', 'lowpass', 180, 0.7, 0);
    this.rainOut = this.loop('pink', 'bandpass', 2800, 0.5, 0);
    this.rainIn = this.loop('pink', 'lowpass', 700, 0.7, 0);
    this.wind = this.loop('pink', 'bandpass', 420, 1.2, 0);
    // wind gusts
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.09;
    const lg = ctx.createGain();
    lg.gain.value = 0.5;
    const windMod = ctx.createGain();
    windMod.gain.value = 0.5;
    lfo.connect(lg).connect(windMod.gain);
    lfo.start();
    this.wind.disconnect();
    this.wind.connect(windMod).connect(this.out);
    // fluorescent buzz: 120 Hz and its harmonics, a little rough
    this.buzz = ctx.createGain();
    this.buzz.gain.value = 0;
    const bf = ctx.createBiquadFilter();
    bf.type = 'bandpass';
    bf.frequency.value = 900;
    bf.Q.value = 0.6;
    for (const [f, g] of [
      [120, 0.4],
      [240, 0.25],
      [360, 0.2],
      [1080, 0.08],
    ] as const) {
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = f;
      const og = ctx.createGain();
      og.gain.value = g;
      o.connect(og).connect(bf);
      o.start();
    }
    bf.connect(this.buzz).connect(this.out);
    // building plant: 60 Hz and air in the ducts, once there is power
    this.hvac = ctx.createGain();
    this.hvac.gain.value = 0;
    const h = ctx.createOscillator();
    h.frequency.value = 60;
    h.connect(this.hvac);
    h.start();
    const air = this.loop('brown', 'bandpass', 260, 0.5, 1);
    air.disconnect();
    air.connect(this.hvac);
    this.hvac.connect(this.out);
  }

  private loop(colour: keyof NoiseBuffers, type: BiquadFilterType, f: number, q: number, gain: number): GainNode {
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBufs[colour];
    src.loop = true;
    src.playbackRate.value = 0.97 + Math.random() * 0.06;
    const fl = ctx.createBiquadFilter();
    fl.type = type;
    fl.frequency.value = f;
    fl.Q.value = q;
    const g = ctx.createGain();
    g.gain.value = gain;
    src.connect(fl).connect(g).connect(this.out);
    src.start(0, Math.random() * 2);
    return g;
  }

  update(dt: number, s: AmbienceState): void {
    const now = this.ctx.currentTime;
    this.clock += dt;
    const alive = s.alive ? 1 : 0.3;
    this.roomTone.gain.setTargetAtTime((s.exterior ? 0.02 : 0.07) * alive, now, 1);
    this.rainOut.gain.setTargetAtTime((s.exterior ? 0.11 : 0.0) * alive, now, 0.8);
    this.rainIn.gain.setTargetAtTime((s.exterior ? 0 : 0.03 + 0.14 * s.sky) * alive, now, 0.8);
    this.wind.gain.setTargetAtTime((s.exterior ? 0.09 : 0.012 + 0.03 * s.sky) * alive, now, 1.2);
    this.buzz.gain.setTargetAtTime(s.powerOn && !s.exterior ? 0.006 + 0.02 * s.light : 0, now, 0.3);
    this.hvac.gain.setTargetAtTime(s.powerOn && !s.exterior ? 0.02 : 0, now, 1);
    if (!s.alive) return;
    const R = Math.random;
    // drips in the cold, wet places
    this.nextDrip -= dt;
    if (this.nextDrip <= 0) {
      this.nextDrip = (s.cold ? 1.5 : 5) + R() * (s.cold ? 3 : 9);
      const pitch = 900 + R() * 900;
      this.spot((o) => tone(o, { f0: pitch, f1: pitch * 0.6, env: { peak: 0.2, attack: 0.002, dur: 0.12 } }), R() * Math.PI * 2, 2 + R() * 6, 0.05, 0.25, 0.5);
    }
    // the building settles: creaks and ticks, more often as the silences shrink [Z]
    this.nextCreak -= dt;
    if (this.nextCreak <= 0) {
      this.nextCreak = 14 * (1 - 0.6 * s.floor) + R() * 18;
      const f0 = 80 + R() * 60;
      this.spot(
        (o) => {
          tone(o, { wave: 'sawtooth', f0, f1: f0 * 1.4, env: { peak: 0.25, attack: 0.2, dur: 0.9 }, filter: { type: 'bandpass', f: 520, q: 6 } });
          noise(o, { type: 'bandpass', f0: 500, f1: 700, q: 6, env: { peak: 0.2, attack: 0.2, dur: 0.9 } });
        },
        R() * Math.PI * 2,
        4 + R() * 8,
        1.6,
        0.12 + 0.1 * s.floor,
        0.7,
      );
    }
    // far away: pipes knocking, a door, metal groaning
    this.nextDistant -= dt;
    if (this.nextDistant <= 0) {
      this.nextDistant = 25 + R() * 40;
      const k = Math.floor(R() * 3);
      this.spot(
        (o) => {
          if (k === 0) for (let i = 0; i < 4; i++) modal(o, i * 0.18 + R() * 0.05, [[180 + R() * 40, 0.4, 0.5], [510, 0.2, 0.3]]);
          else if (k === 1) {
            tone(o, { wave: 'sawtooth', f0: 55, f1: 45, env: { peak: 0.35, attack: 1.2, dur: 3.2 }, filter: { type: 'bandpass', f: 220, q: 9 } });
            grains(o, 1, 2, 6, { f: 900, spread: 0.6, peak: 0.08 });
          } else {
            noise(o, { type: 'lowpass', f0: 600, env: { peak: 0.5, attack: 0.005, dur: 0.4 } });
            tone(o, { f0: 90, f1: 50, env: { peak: 0.5, dur: 0.3 } });
          }
        },
        R() * Math.PI * 2,
        14,
        1.0,
        0.14,
        0.95,
      );
    }
    // very rarely, something that should not be there: a child humming, a music box, a laugh
    this.nextUncanny -= dt;
    if (this.nextUncanny <= 0) {
      this.nextUncanny = 90 + R() * 120 * (1 - 0.5 * s.floor);
      const k = Math.floor(R() * 3);
      this.spot(
        (o) => {
          if (k === 0) musicBox(o, 0.18);
          else if (k === 1) humming(o, 0.12);
          else for (const at of [0, 0.18, 0.33]) tone(o, { at, wave: 'triangle', f0: 520 - at * 120, f1: 480 - at * 120, env: { peak: 0.08, attack: 0.02, dur: 0.14 }, vibrato: { rate: 8, depth: 12 } });
        },
        R() * Math.PI * 2,
        10,
        1.1,
        0.1,
        0.9,
      );
    }
  }
}

/** Six slow notes from a wind-up box, slightly out of tune, slowing down. */
export function musicBox(o: Out, peak: number): void {
  const notes = [1046.5, 1318.5, 1568, 1318.5, 1174.7, 987.8, 1046.5];
  let at = 0;
  notes.forEach((f, i) => {
    modal(o, at, [
      [f * (1 + (Math.random() - 0.5) * 0.008), peak, 1.4],
      [f * 2.76, peak * 0.25, 0.4],
    ]);
    at += 0.38 + i * 0.05;
  });
}

/** A child humming somewhere: a voice with no words, a little flat. */
export function humming(o: Out, peak: number): void {
  const notes = [392, 440, 392, 349.2, 329.6];
  let at = 0;
  for (const f of notes) {
    tone(o, { at, wave: 'triangle', f0: f * 0.99, f1: f * 0.985, env: { peak, attack: 0.08, dur: 0.55 }, vibrato: { rate: 5.5, depth: 4 }, filter: { type: 'lowpass', f: 1400 } });
    at += 0.55;
  }
}

/** Church bell, struck once, far away. */
export function bell(o: Out, peak: number): void {
  modal(o, 0, [
    [220, peak, 6],
    [440, peak * 0.6, 4],
    [528, peak * 0.4, 3.5],
    [660, peak * 0.3, 3],
    [880, peak * 0.2, 2],
    [1320, peak * 0.1, 1.2],
  ]);
}

/** The old two-tone telephone ring. */
export function phoneRing(o: Out, peak: number): void {
  for (let r = 0; r < 3; r++) {
    for (let k = 0; k < 20; k++) {
      const at = r * 3 + k * 0.05;
      tone(o, { at, f0: 440, env: { peak, attack: 0.002, dur: 0.045 } });
      tone(o, { at, f0: 480, env: { peak: peak * 0.8, attack: 0.002, dur: 0.045 } });
    }
  }
}

/** A hospital PA: chime, hiss. */
export function paChime(o: Out, peak: number): void {
  tone(o, { f0: 659.3, env: { peak, attack: 0.01, dur: 0.6 } });
  tone(o, { at: 0.45, f0: 523.3, env: { peak, attack: 0.01, dur: 0.9 } });
  noise(o, { type: 'bandpass', f0: 2500, q: 0.5, env: { peak: peak * 0.3, attack: 0.05, dur: 3, shape: 'hold', release: 0.4 } });
}

/**
 * Procedural impulse responses for the convolution reverb: each kind of space in the
 * hospital gets its own tail — tiled theatres ring, the boiler room booms, a ward is short
 * and soft, outside is a dark slap off the walls, a locker is a tin can around your head.
 */
export interface SpaceSpec {
  /** Tail length in seconds (to roughly -60 dB). */
  decay: number;
  preDelay: number;
  /** How quickly highs die compared to lows (0 = bright, 1 = dull). */
  damping: number;
  /** Early reflections: [delay s, gain]. */
  early: ReadonlyArray<[number, number]>;
  /** Metallic ring: comb resonances in Hz. */
  ring?: ReadonlyArray<number>;
  gain: number;
}

export const SPACES: Record<string, SpaceSpec> = {
  corridor: { decay: 1.9, preDelay: 0.012, damping: 0.35, early: [[0.018, 0.5], [0.031, 0.35], [0.052, 0.25], [0.077, 0.15]], gain: 1 },
  room: { decay: 0.9, preDelay: 0.006, damping: 0.55, early: [[0.009, 0.45], [0.017, 0.3], [0.026, 0.2]], gain: 0.9 },
  tile: { decay: 2.4, preDelay: 0.01, damping: 0.15, early: [[0.011, 0.6], [0.019, 0.45], [0.033, 0.35], [0.05, 0.25]], ring: [1240, 2210], gain: 1.1 },
  hall: { decay: 2.8, preDelay: 0.02, damping: 0.3, early: [[0.025, 0.5], [0.045, 0.35], [0.08, 0.25], [0.12, 0.2]], gain: 1.05 },
  old: { decay: 1.5, preDelay: 0.01, damping: 0.7, early: [[0.012, 0.35], [0.024, 0.25]], gain: 0.85 },
  plant: { decay: 3.2, preDelay: 0.018, damping: 0.25, early: [[0.02, 0.5], [0.037, 0.4], [0.061, 0.3], [0.09, 0.22]], ring: [180, 412, 733], gain: 1.15 },
  outside: { decay: 0.7, preDelay: 0.03, damping: 0.8, early: [[0.11, 0.35], [0.19, 0.18]], gain: 0.7 },
  nest: { decay: 1.3, preDelay: 0.008, damping: 0.75, early: [[0.01, 0.4], [0.022, 0.3]], gain: 0.9 },
  locker: { decay: 0.22, preDelay: 0.001, damping: 0.2, early: [[0.0016, 0.7], [0.0031, 0.5], [0.0047, 0.4]], ring: [520, 905, 1480], gain: 1.2 },
};

export function makeImpulse(ctx: BaseAudioContext, spec: SpaceSpec): AudioBuffer {
  const sr = ctx.sampleRate;
  const len = Math.floor(sr * (spec.decay + spec.preDelay + 0.1));
  const buf = ctx.createBuffer(2, len, sr);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    const pre = Math.floor(spec.preDelay * sr);
    // diffuse tail: noise under an exponential envelope, low-passed harder as it ages
    let lp = 0;
    for (let i = pre; i < len; i++) {
      const t = (i - pre) / sr;
      const env = Math.exp((-6.9 * t) / spec.decay);
      const x = (Math.random() * 2 - 1) * env;
      const k = Math.min(0.98, 0.05 + spec.damping * Math.min(1, t / spec.decay) * 0.93);
      lp = lp * k + x * (1 - k);
      d[i] = lp * (1 + spec.damping * 1.5);
    }
    for (const [delay, g] of spec.early) {
      const i = pre + Math.floor((delay + (ch ? 0.0007 : 0)) * sr);
      if (i < len) {
        d[i] = d[i]! + g * (ch ? 0.9 : 1);
        if (i + 1 < len) d[i + 1] = d[i + 1]! + g * 0.5;
      }
    }
    if (spec.ring) {
      for (const f of spec.ring) {
        const w = (2 * Math.PI * f) / sr;
        for (let i = pre; i < len; i++) {
          const t = (i - pre) / sr;
          d[i] = d[i]! + Math.sin(w * i + ch) * Math.exp((-6.9 * t) / (spec.decay * 0.6)) * 0.04;
        }
      }
    }
    // normalise
    let peak = 0;
    for (let i = 0; i < len; i++) peak = Math.max(peak, Math.abs(d[i]!));
    const s = peak > 0 ? (0.6 * spec.gain) / peak : 1;
    for (let i = 0; i < len; i++) d[i] = d[i]! * s;
  }
  return buf;
}

/** Which space a zone (and region kind) sounds like. */
export function spaceFor(zoneKey: string, regionKind: string, hiddenIn: string | null): string {
  if (hiddenIn === 'locker' || hiddenIn === 'drawer') return 'locker';
  switch (zoneKey) {
    case 'u':
    case 'g':
      return 'tile';
    case 'm':
      return 'plant';
    case 'o':
      return 'old';
    case 'n':
      return 'nest';
    case 'c':
    case 'a':
      return 'outside';
    case 'h':
    case 'r':
      return regionKind === 'corridor' ? 'hall' : 'corridor';
    default:
      return regionKind === 'corridor' ? 'corridor' : 'room';
  }
}

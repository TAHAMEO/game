/**
 * Procedural sound building blocks. Every sound in the game is made from these at the
 * moment it plays — filtered noise, tones, struck metal modes, vocal formants — so there
 * is nothing to download and every footstep is a little different.
 */

export interface NoiseBuffers {
  white: AudioBuffer;
  pink: AudioBuffer;
  brown: AudioBuffer;
}

export type NoiseColour = keyof NoiseBuffers;

export function makeNoise(ctx: BaseAudioContext, seconds = 3): NoiseBuffers {
  const n = Math.floor(ctx.sampleRate * seconds);
  const white = ctx.createBuffer(1, n, ctx.sampleRate);
  const pink = ctx.createBuffer(1, n, ctx.sampleRate);
  const brown = ctx.createBuffer(1, n, ctx.sampleRate);
  const w = white.getChannelData(0);
  const p = pink.getChannelData(0);
  const b = brown.getChannelData(0);
  let b0 = 0;
  let b1 = 0;
  let b2 = 0;
  let b3 = 0;
  let b4 = 0;
  let b5 = 0;
  let b6 = 0;
  let last = 0;
  for (let i = 0; i < n; i++) {
    const x = Math.random() * 2 - 1;
    w[i] = x;
    // Paul Kellet's pink filter
    b0 = 0.99886 * b0 + x * 0.0555179;
    b1 = 0.99332 * b1 + x * 0.0750759;
    b2 = 0.969 * b2 + x * 0.153852;
    b3 = 0.8665 * b3 + x * 0.3104856;
    b4 = 0.55 * b4 + x * 0.5329522;
    b5 = -0.7616 * b5 - x * 0.016898;
    p[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + x * 0.5362) * 0.11;
    b6 = x * 0.115926;
    last = (last + 0.02 * x) / 1.02;
    b[i] = last * 3.5;
  }
  return { white, pink, brown };
}

export interface Out {
  ctx: BaseAudioContext;
  dest: AudioNode;
  /** Start time (ctx time). */
  t: number;
  noise: NoiseBuffers;
}

export interface Env {
  peak: number;
  attack?: number;
  /** Total length including attack. */
  dur: number;
  /** 'exp' decays naturally; 'hold' sustains then releases over the last `release` seconds. */
  shape?: 'exp' | 'hold';
  release?: number;
}

function envelope(g: GainNode, start: number, e: Env): number {
  const a = Math.max(0.001, e.attack ?? 0.005);
  const end = start + e.dur;
  const p = Math.max(0.0001, e.peak);
  g.gain.setValueAtTime(0.0001, start);
  g.gain.exponentialRampToValueAtTime(p, start + a);
  if (e.shape === 'hold') {
    const r = Math.min(e.dur - a, e.release ?? 0.1);
    g.gain.setValueAtTime(p, Math.max(start + a, end - r));
    g.gain.exponentialRampToValueAtTime(0.0001, end);
  } else {
    g.gain.exponentialRampToValueAtTime(0.0001, end);
  }
  return end;
}

export interface NoiseSpec {
  at?: number;
  colour?: NoiseColour;
  type?: BiquadFilterType;
  f0: number;
  f1?: number;
  q?: number;
  env: Env;
  /** Playback rate (pitch of the noise texture). */
  rate?: number;
  /** A second filter in series. */
  type2?: BiquadFilterType;
  f2?: number;
  q2?: number;
}

export function noise(o: Out, s: NoiseSpec): void {
  const ctx = o.ctx;
  const start = o.t + (s.at ?? 0);
  const src = ctx.createBufferSource();
  src.buffer = o.noise[s.colour ?? 'white'];
  src.playbackRate.value = s.rate ?? 1;
  const f = ctx.createBiquadFilter();
  f.type = s.type ?? 'bandpass';
  f.Q.value = s.q ?? 1;
  f.frequency.setValueAtTime(s.f0, start);
  if (s.f1 !== undefined) f.frequency.exponentialRampToValueAtTime(Math.max(20, s.f1), start + s.env.dur);
  const g = ctx.createGain();
  const end = envelope(g, start, s.env);
  let head: AudioNode = f;
  if (s.type2) {
    const f2 = ctx.createBiquadFilter();
    f2.type = s.type2;
    f2.frequency.value = s.f2 ?? 1000;
    f2.Q.value = s.q2 ?? 0.7;
    f.connect(f2);
    head = f2;
  }
  src.connect(f);
  head.connect(g).connect(o.dest);
  const len = src.buffer!.duration;
  src.start(start, Math.random() * Math.max(0, len - s.env.dur - 0.1), s.env.dur + 0.05);
  src.stop(end + 0.05);
}

export interface ToneSpec {
  at?: number;
  wave?: OscillatorType;
  f0: number;
  f1?: number;
  env: Env;
  detune?: number;
  vibrato?: { rate: number; depth: number };
  filter?: { type: BiquadFilterType; f: number; q?: number; f1?: number };
}

export function tone(o: Out, s: ToneSpec): void {
  const ctx = o.ctx;
  const start = o.t + (s.at ?? 0);
  const osc = ctx.createOscillator();
  osc.type = s.wave ?? 'sine';
  osc.frequency.setValueAtTime(s.f0, start);
  if (s.f1 !== undefined) osc.frequency.exponentialRampToValueAtTime(Math.max(10, s.f1), start + s.env.dur);
  if (s.detune) osc.detune.value = s.detune;
  if (s.vibrato) {
    const lfo = ctx.createOscillator();
    lfo.frequency.value = s.vibrato.rate;
    const lg = ctx.createGain();
    lg.gain.value = s.vibrato.depth;
    lfo.connect(lg).connect(osc.frequency);
    lfo.start(start);
    lfo.stop(start + s.env.dur + 0.1);
  }
  const g = ctx.createGain();
  const end = envelope(g, start, s.env);
  let head: AudioNode = osc;
  if (s.filter) {
    const f = ctx.createBiquadFilter();
    f.type = s.filter.type;
    f.Q.value = s.filter.q ?? 0.7;
    f.frequency.setValueAtTime(s.filter.f, start);
    if (s.filter.f1) f.frequency.exponentialRampToValueAtTime(s.filter.f1, start + s.env.dur);
    osc.connect(f);
    head = f;
  }
  head.connect(g).connect(o.dest);
  osc.start(start);
  osc.stop(end + 0.05);
}

/** Struck metal, glass, wood: a set of decaying partials. */
export function modal(o: Out, at: number, partials: ReadonlyArray<[freq: number, amp: number, decay: number]>, gain = 1): void {
  const ctx = o.ctx;
  const start = o.t + at;
  for (const [f, a, d] of partials) {
    const osc = ctx.createOscillator();
    osc.frequency.value = f * (1 + (Math.random() - 0.5) * 0.01);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, start);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0001, a * gain), start + 0.002);
    g.gain.exponentialRampToValueAtTime(0.0001, start + d);
    osc.connect(g).connect(o.dest);
    osc.start(start);
    osc.stop(start + d + 0.05);
  }
}

/** Many tiny clicks: gravel, debris, rain on glass, glass fragments, a rattle of chain. */
export function grains(o: Out, at: number, dur: number, count: number, spec: { f: number; spread: number; q?: number; peak: number; len?: number; colour?: NoiseColour }): void {
  for (let i = 0; i < count; i++) {
    const tt = at + Math.pow(Math.random(), 1.6) * dur;
    noise(o, {
      at: tt,
      colour: spec.colour ?? 'white',
      type: 'bandpass',
      f0: spec.f * (1 + (Math.random() - 0.5) * spec.spread),
      q: spec.q ?? 4,
      env: { peak: spec.peak * (0.4 + Math.random() * 0.6), attack: 0.001, dur: spec.len ?? 0.025 },
    });
  }
}

/** Vowel formants (Hz) for voiced and breathy sounds. */
export const VOWELS = {
  a: [800, 1150, 2900],
  e: [400, 1600, 2700],
  i: [350, 1700, 2700],
  o: [450, 800, 2830],
  u: [325, 700, 2530],
  h: [600, 1300, 2500],
} as const;

/** A voiced sound through vowel formants: screams, groans, moans, gasps with voice in them. */
export function voiced(
  o: Out,
  s: { at?: number; f0: number; f1?: number; vowel: readonly [number, number, number]; vowel1?: readonly [number, number, number]; env: Env; breath?: number; vibrato?: number; wave?: OscillatorType; jitter?: number },
): void {
  const ctx = o.ctx;
  const start = o.t + (s.at ?? 0);
  const end = start + s.env.dur;
  const sum = ctx.createGain();
  sum.gain.value = 1;
  const osc = ctx.createOscillator();
  osc.type = s.wave ?? 'sawtooth';
  osc.frequency.setValueAtTime(s.f0, start);
  if (s.f1) osc.frequency.exponentialRampToValueAtTime(s.f1, end);
  if (s.vibrato) {
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 5.5 + Math.random();
    const lg = ctx.createGain();
    lg.gain.value = s.vibrato;
    lfo.connect(lg).connect(osc.frequency);
    lfo.start(start);
    lfo.stop(end + 0.1);
  }
  if (s.jitter) {
    const j = ctx.createBufferSource();
    j.buffer = o.noise.brown;
    const jg = ctx.createGain();
    jg.gain.value = s.jitter;
    j.connect(jg).connect(osc.frequency);
    j.start(start, Math.random());
    j.stop(end + 0.1);
  }
  osc.connect(sum);
  if (s.breath) {
    const nsrc = ctx.createBufferSource();
    nsrc.buffer = o.noise.white;
    const ng = ctx.createGain();
    ng.gain.value = s.breath;
    nsrc.connect(ng).connect(sum);
    nsrc.start(start, Math.random());
    nsrc.stop(end + 0.1);
  }
  const g = ctx.createGain();
  envelope(g, start, s.env);
  const v0 = s.vowel;
  const v1 = s.vowel1 ?? v0;
  const gains = [1, 0.55, 0.25];
  for (let k = 0; k < 3; k++) {
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.Q.value = 7 + k * 3;
    f.frequency.setValueAtTime(v0[k]!, start);
    f.frequency.linearRampToValueAtTime(v1[k]!, end);
    const fg = ctx.createGain();
    fg.gain.value = gains[k]!;
    sum.connect(f).connect(fg).connect(g);
  }
  g.connect(o.dest);
  osc.start(start);
  osc.stop(end + 0.1);
}

export const rand = (lo: number, hi: number) => lo + Math.random() * (hi - lo);

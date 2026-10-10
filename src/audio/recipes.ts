import type { SoundKind } from '../core/types';
import { grains, modal, noise, type Out, rand, tone, voiced, VOWELS } from './synth';

export type Surface = 'tile' | 'wood' | 'concrete' | 'grass' | 'asphalt' | 'wet';

/** What a floor sounds like, by zone. */
export function surfaceFor(zoneKey: string): Surface {
  switch (zoneKey) {
    case 'o':
      return 'wood';
    case 'm':
      return 'concrete';
    case 'c':
      return 'grass';
    case 'a':
      return 'asphalt';
    case 'n':
      return 'wet';
    default:
      return 'tile';
  }
}

/** A human footstep: heel, then the floor, then the toe. `w` = weight (crouch .3, walk .6, run 1). */
export function footstep(o: Out, surface: Surface, weight: number): void {
  const w = weight * 1.6;
  tone(o, { f0: 95, f1: 52, env: { peak: 0.32 * w, dur: 0.09 }, filter: { type: 'lowpass', f: 320 } });
  switch (surface) {
    case 'tile':
      noise(o, { type: 'bandpass', f0: 2700 + rand(-300, 300), q: 1.1, env: { peak: 0.24 * w, attack: 0.001, dur: 0.035 } });
      noise(o, { at: 0.06 + rand(0, 0.02), type: 'bandpass', f0: 2100, q: 1.4, env: { peak: 0.1 * w, attack: 0.001, dur: 0.025 } });
      if (Math.random() < 0.08 * w) tone(o, { at: 0.03, wave: 'sawtooth', f0: 1700, f1: 2300, env: { peak: 0.012, dur: 0.07 }, filter: { type: 'bandpass', f: 2000, q: 8 } });
      break;
    case 'wood':
      noise(o, { type: 'bandpass', f0: 850, q: 1, env: { peak: 0.28 * w, attack: 0.002, dur: 0.07 } });
      if (Math.random() < 0.25) tone(o, { at: 0.02, wave: 'sawtooth', f0: rand(140, 190), f1: rand(170, 230), env: { peak: 0.05 * w, attack: 0.05, dur: 0.3 }, filter: { type: 'bandpass', f: 620, q: 7 } });
      break;
    case 'concrete':
      noise(o, { type: 'bandpass', f0: 1500, q: 0.8, env: { peak: 0.26 * w, attack: 0.001, dur: 0.05 } });
      grains(o, 0, 0.07, 5, { f: 3600, spread: 0.6, peak: 0.05 * w });
      break;
    case 'grass':
      noise(o, { type: 'lowpass', f0: 1300, env: { peak: 0.22 * w, attack: 0.01, dur: 0.14 } });
      grains(o, 0, 0.1, 10, { f: 2600, spread: 0.7, peak: 0.045 * w });
      noise(o, { at: 0.02, type: 'bandpass', f0: 520, q: 3, env: { peak: 0.08 * w, attack: 0.01, dur: 0.12 } });
      break;
    case 'asphalt':
      noise(o, { type: 'bandpass', f0: 1100, q: 1.4, env: { peak: 0.22 * w, attack: 0.001, dur: 0.05 } });
      noise(o, { at: 0.01, type: 'highpass', f0: 3200, env: { peak: 0.12 * w, attack: 0.005, dur: 0.14 } });
      break;
    case 'wet':
      noise(o, { type: 'bandpass', f0: 420, f1: 260, q: 4, env: { peak: 0.3 * w, attack: 0.005, dur: 0.16 } });
      tone(o, { f0: 130, f1: 80, env: { peak: 0.12 * w, dur: 0.1 } });
      break;
  }
}

/** Its footfall: too heavy, wet, a click of bone, and the other foot dragging after. */
export function entityStep(o: Out, surface: Surface): void {
  tone(o, { f0: 58, f1: 33, env: { peak: 0.95, dur: 0.26 } });
  noise(o, { type: 'lowpass', f0: 420, env: { peak: 0.4, attack: 0.002, dur: 0.16 } });
  noise(o, { at: 0.012, type: 'bandpass', f0: 3400, q: 9, env: { peak: 0.32, attack: 0.001, dur: 0.02 } });
  noise(o, { at: 0.005, type: 'bandpass', f0: surface === 'tile' ? 950 : 600, q: 3, env: { peak: 0.22, attack: 0.002, dur: 0.07 } });
  noise(o, { at: 0.13 + rand(0, 0.06), type: 'bandpass', f0: 700, f1: 520, q: 2.2, env: { peak: 0.14, attack: 0.06, dur: 0.36 } });
}

const R = rand;

/** Every other sound in the building, by kind. */
export function play(o: Out, kind: SoundKind, surface: Surface): void {
  switch (kind) {
    case 'step':
      footstep(o, surface, 0.7);
      break;
    case 'entityStep':
      entityStep(o, surface);
      break;
    case 'door':
      modal(o, 0, [
        [2800, 0.28, 0.03],
        [4100, 0.18, 0.025],
      ]);
      noise(o, { at: 0.02, type: 'bandpass', f0: 300, f1: 360, q: 1.5, env: { peak: 0.42, attack: 0.08, dur: 0.5 }, rate: R(0.8, 1.2) });
      tone(o, { at: 0.05, wave: 'sawtooth', f0: R(850, 1000), f1: R(1050, 1250), env: { peak: 0.025, attack: 0.1, dur: 0.38 }, filter: { type: 'bandpass', f: 1000, q: 10 } });
      tone(o, { at: 0.48, f0: 120, f1: 70, env: { peak: 0.4, dur: 0.12 } });
      noise(o, { at: 0.48, type: 'lowpass', f0: 900, env: { peak: 0.3, attack: 0.002, dur: 0.08 } });
      break;
    case 'doorBash':
      tone(o, { f0: 72, f1: 34, env: { peak: 1, dur: 0.42 } });
      noise(o, { type: 'lowpass', f0: 2600, f1: 300, env: { peak: 0.9, attack: 0.001, dur: 0.5 } });
      modal(o, 0.004, [
        [182, 0.4, 0.9],
        [411, 0.3, 0.65],
        [693, 0.22, 0.45],
        [1270, 0.14, 0.3],
      ]);
      grains(o, 0.05, 0.45, 14, { f: 3000, spread: 0.6, peak: 0.12 });
      break;
    case 'locker':
      modal(o, 0, [
        [2600, 0.22, 0.04],
        [3900, 0.16, 0.03],
      ]);
      tone(o, { at: 0.01, wave: 'sawtooth', f0: 240, f1: 205, env: { peak: 0.035, attack: 0.08, dur: 0.36 }, filter: { type: 'bandpass', f: 820, q: 8 } });
      modal(o, 0.025, [
        [410, 0.3, 0.95],
        [637, 0.22, 0.75],
        [1015, 0.15, 0.5],
        [1462, 0.1, 0.35],
      ]);
      tone(o, { at: 0.02, f0: 110, f1: 60, env: { peak: 0.38, dur: 0.1 } });
      break;
    case 'glass':
      noise(o, { type: 'highpass', f0: 3000, f1: 6000, env: { peak: 0.9, attack: 0.001, dur: 0.24 } });
      tone(o, { f0: 160, f1: 80, env: { peak: 0.3, dur: 0.1 } });
      modal(
        o,
        0,
        Array.from({ length: 9 }, () => [R(2000, 7500), R(0.05, 0.16), R(0.05, 0.35)] as [number, number, number]),
      );
      grains(o, 0.05, 0.65, 34, { f: 6200, spread: 0.7, peak: 0.12, len: 0.015 });
      break;
    case 'whoosh':
      noise(o, { type: 'bandpass', f0: 380, f1: 1600, q: 2, env: { peak: 0.35, attack: 0.08, dur: 0.28 } });
      break;
    case 'gasp':
      voiced(o, { f0: 190, f1: 230, vowel: VOWELS.h, vowel1: VOWELS.a, breath: 1.2, env: { peak: 0.35, attack: 0.03, dur: 0.42 } });
      noise(o, { type: 'bandpass', f0: 1300, f1: 1700, q: 2, env: { peak: 0.6, attack: 0.02, dur: 0.4 } });
      break;
    case 'exhale':
      noise(o, { type: 'bandpass', f0: 950, f1: 480, q: 2, env: { peak: 0.45, attack: 0.08, dur: 0.85 } });
      voiced(o, { f0: 115, f1: 100, vowel: VOWELS.h, breath: 1.5, env: { peak: 0.06, attack: 0.1, dur: 0.7 } });
      break;
    case 'breath':
      noise(o, { type: 'bandpass', f0: 1150, f1: 1450, q: 3, env: { peak: 0.64, attack: 0.28, dur: 0.62 } });
      noise(o, { at: 0.7, type: 'bandpass', f0: 820, f1: 480, q: 2.2, env: { peak: 0.56, attack: 0.08, dur: 0.85 } });
      break;
    case 'tap':
      noise(o, { type: 'bandpass', f0: 2400 + R(-300, 300), q: 1.2, env: { peak: 0.42, attack: 0.05, dur: 0.58, shape: 'hold', release: 0.1 } });
      grains(o, 0, 0.5, 18, { f: 1400, spread: 0.8, q: 12, peak: 0.08, len: 0.03 });
      break;
    case 'breaker':
      tone(o, { f0: 70, f1: 38, env: { peak: 1, dur: 0.65 } });
      noise(o, { type: 'lowpass', f0: 3200, f1: 300, env: { peak: 0.9, attack: 0.001, dur: 0.36 } });
      modal(o, 0, [
        [222, 0.5, 1.3],
        [341, 0.32, 0.9],
        [587, 0.2, 0.6],
      ]);
      tone(o, { at: 0.35, wave: 'sawtooth', f0: 48, f1: 60, env: { peak: 0.16, attack: 0.6, dur: 2.8 }, filter: { type: 'lowpass', f: 420 } });
      tone(o, { at: 0.5, f0: 120, env: { peak: 0.06, attack: 0.8, dur: 3.2, shape: 'hold', release: 0.8 } });
      break;
    case 'radio':
      tone(o, { wave: 'square', f0: 1250, env: { peak: 0.06, dur: 0.07 }, filter: { type: 'bandpass', f: 1300, q: 4 } });
      noise(o, { at: 0.04, type: 'bandpass', f0: 1800, f1: 2300, q: 0.7, env: { peak: 0.5, attack: 0.02, dur: 0.7 } });
      grains(o, 0.05, 0.6, 8, { f: 4200, spread: 0.5, peak: 0.3 });
      break;
    case 'rattle':
      for (let k = 0; k < 3; k++) {
        grains(o, k * 0.1, 0.09, 4, { f: 2100, spread: 0.5, q: 6, peak: 0.4, len: 0.04 });
        modal(o, k * 0.1, [
          [1800, 0.12, 0.12],
          [2950, 0.08, 0.08],
        ]);
      }
      tone(o, { f0: 140, f1: 90, env: { peak: 0.25, dur: 0.12 } });
      break;
    case 'click':
      noise(o, { type: 'highpass', f0: 4200, env: { peak: 0.5, attack: 0.0005, dur: 0.008 } });
      noise(o, { at: 0.034, type: 'highpass', f0: 3800, env: { peak: 0.35, attack: 0.0005, dur: 0.009 } });
      modal(o, 0, [[3200, 0.05, 0.02]]);
      break;
    case 'knock':
      for (let i = 0; i < 3; i++) {
        const at = i * (0.26 + R(0, 0.08));
        modal(o, at, [
          [138, 0.6, 0.55],
          [377, 0.32, 0.38],
          [611, 0.18, 0.26],
          [1032, 0.08, 0.15],
        ]);
        noise(o, { at, type: 'bandpass', f0: 1200, q: 2, env: { peak: 0.5, attack: 0.001, dur: 0.06 } });
      }
      break;
    case 'tilt':
      // the neck: a run of small cracks as the head goes over, then the wet click of listening
      for (const at of [0, 0.05, 0.09, 0.17]) noise(o, { at: at + R(0, 0.015), type: 'bandpass', f0: R(2600, 3600), q: 6, env: { peak: 0.75, attack: 0.0008, dur: 0.016 } });
      tone(o, { at: 0.02, wave: 'sawtooth', f0: 82, f1: 58, env: { peak: 0.13, attack: 0.05, dur: 0.32 }, filter: { type: 'bandpass', f: 300, q: 5 } });
      noise(o, { at: 0.3, type: 'bandpass', f0: 1500, q: 10, env: { peak: 0.25, attack: 0.002, dur: 0.03 } });
      break;
    case 'inhale':
      // its breath in: long, wet, rattling, through something that should not be a throat
      voiced(o, { f0: 68, f1: 96, vowel: VOWELS.u, vowel1: VOWELS.a, breath: 1.6, jitter: 18, env: { peak: 0.32, attack: 0.65, dur: 1.05 } });
      noise(o, { type: 'bandpass', f0: 480, f1: 1900, q: 3, env: { peak: 0.75, attack: 0.72, dur: 1.05 } });
      grains(o, 0.2, 0.75, 16, { f: 320, spread: 0.5, q: 3, peak: 0.16, len: 0.045, colour: 'pink' });
      break;
    case 'sigh':
      noise(o, { type: 'bandpass', f0: 700, f1: 240, q: 2.5, env: { peak: 0.6, attack: 0.25, dur: 1.4 } });
      voiced(o, { f0: 86, f1: 58, vowel: VOWELS.a, vowel1: VOWELS.o, breath: 1.3, jitter: 14, env: { peak: 0.2, attack: 0.3, dur: 1.4 } });
      break;
    case 'snap':
      noise(o, { type: 'highpass', f0: 2500, env: { peak: 1, attack: 0.001, dur: 0.05 } });
      tone(o, { f0: 92, f1: 44, env: { peak: 0.9, dur: 0.3 } });
      voiced(o, { at: 0.03, f0: 620, f1: 940, vowel: VOWELS.i, breath: 0.6, jitter: 40, env: { peak: 0.28, attack: 0.01, dur: 0.28 } });
      break;
    case 'cough':
      for (const at of [0, 0.22]) {
        voiced(o, { at, f0: R(150, 190), vowel: VOWELS.h, vowel1: VOWELS.a, breath: 2.2, env: { peak: 0.35, attack: 0.008, dur: 0.15 } });
        noise(o, { at, type: 'bandpass', f0: 900, q: 2, env: { peak: 0.5, attack: 0.005, dur: 0.12 } });
      }
      break;
    case 'voice':
      voiced(o, { f0: R(170, 230), vowel: [VOWELS.a, VOWELS.e, VOWELS.o][Math.floor(R(0, 3))]!, breath: 0.6, env: { peak: 0.05, attack: 0.1, dur: 0.6 } });
      break;
    case 'lightPop':
      noise(o, { type: 'highpass', f0: 3000, env: { peak: 0.9, attack: 0.0008, dur: 0.035 } });
      grains(o, 0.02, 0.4, 14, { f: 6200, spread: 0.6, peak: 0.15, len: 0.014 });
      noise(o, { at: 0.01, type: 'bandpass', f0: 7000, q: 0.8, env: { peak: 0.1, attack: 0.01, dur: 0.42 } });
      modal(o, 0.02, [
        [3100, 0.08, 0.2],
        [4800, 0.06, 0.15],
      ]);
      break;
    case 'pickup':
      noise(o, { type: 'bandpass', f0: 2500, q: 0.8, env: { peak: 0.22, attack: 0.005, dur: 0.1 } });
      modal(o, 0.02, [[2900, 0.04, 0.03]]);
      break;
    case 'drag':
      noise(o, { type: 'bandpass', f0: 360, f1: 270, q: 3, env: { peak: 0.55, attack: 0.1, dur: 0.62 }, rate: R(0.8, 1.1) });
      grains(o, 0.05, 0.5, 10, { f: 900, spread: 0.6, peak: 0.08 });
      break;
    case 'hum':
      tone(o, { wave: 'sawtooth', f0: 60, env: { peak: 0.08, attack: 0.1, dur: 0.55, shape: 'hold', release: 0.1 }, filter: { type: 'lowpass', f: 320 } });
      tone(o, { f0: 120, env: { peak: 0.04, attack: 0.1, dur: 0.55, shape: 'hold', release: 0.1 } });
      break;
    case 'gate':
      tone(o, { wave: 'sawtooth', f0: 142, f1: 108, env: { peak: 0.2, attack: 0.3, dur: 1.8 }, filter: { type: 'bandpass', f: 460, q: 9 }, vibrato: { rate: 3, depth: 6 } });
      grains(o, 0.1, 1.2, 10, { f: 2200, spread: 0.5, q: 6, peak: 0.25, len: 0.04 });
      modal(o, 1.6, [
        [262, 0.4, 1.0],
        [520, 0.2, 0.6],
        [889, 0.1, 0.4],
      ]);
      break;
    case 'scream':
      voiced(o, { f0: R(480, 560), f1: R(380, 460), vowel: VOWELS.a, vowel1: VOWELS.e, breath: 0.6, vibrato: 18, jitter: 30, env: { peak: 0.75, attack: 0.04, dur: 1.25 } });
      noise(o, { type: 'bandpass', f0: 1600, q: 2, env: { peak: 0.22, attack: 0.04, dur: 1.0 } });
      break;
    case 'thud':
      noise(o, { type: 'lowpass', f0: 1800, f1: 200, env: { peak: 1, attack: 0.002, dur: 0.5 } });
      tone(o, { f0: 82, f1: 40, env: { peak: 0.9, dur: 0.36 } });
      grains(o, 0.05, 0.6, 24, { f: 2500, spread: 0.8, peak: 0.2 });
      noise(o, { at: 0.03, type: 'bandpass', f0: 600, q: 3, env: { peak: 0.4, attack: 0.002, dur: 0.15 } });
      break;
    case 'whisper':
      whisper(o, 5 + Math.floor(R(0, 4)), 0.5);
      break;
    case 'thunder':
      thunder(o, 1);
      break;
  }
}

/** Unvoiced syllables through vowel formants: speech you can almost make out. */
export function whisper(o: Out, syllables: number, peak: number): void {
  const vs = [VOWELS.a, VOWELS.e, VOWELS.i, VOWELS.o, VOWELS.u];
  let at = 0;
  for (let i = 0; i < syllables; i++) {
    const v = vs[Math.floor(R(0, vs.length))]!;
    const len = R(0.09, 0.2);
    for (let k = 0; k < 2; k++) noise(o, { at, colour: 'white', type: 'bandpass', f0: v[k + 1]! * R(0.95, 1.05), q: 9, env: { peak: peak * (k ? 0.6 : 1), attack: 0.02, dur: len } });
    if (Math.random() < 0.4) noise(o, { at: at + len * 0.8, type: 'highpass', f0: 5000, env: { peak: peak * 0.5, attack: 0.01, dur: 0.07 } });
    at += len + R(0.02, 0.09);
  }
}

/** Distance in the strength: a close crack, then the roll. */
export function thunder(o: Out, strength: number): void {
  const near = strength > 0.75;
  if (near) noise(o, { type: 'highpass', f0: 1400, env: { peak: 0.55 * strength, attack: 0.003, dur: 0.35 } });
  noise(o, { colour: 'brown', type: 'lowpass', f0: 420, f1: 110, env: { peak: 1.0 * strength, attack: near ? 0.02 : 0.25, dur: 4.2 } });
  for (let i = 0; i < 4; i++) noise(o, { at: R(0.4, 2.6), colour: 'brown', type: 'lowpass', f0: 240, env: { peak: R(0.3, 0.7) * strength, attack: 0.15, dur: R(0.8, 1.6) } });
}

/** The sting: a full-orchestra stab of noise and clustered strings, and a drop under it. */
export function stinger(o: Out, power: number): void {
  const strength = power * 0.6;
  noise(o, { type: 'highpass', f0: 800, env: { peak: 0.6 * strength, attack: 0.002, dur: 0.6 } });
  for (const f of [146.8, 155.6, 207.7, 220, 311.1, 329.6, 415.3, 440]) {
    tone(o, { wave: 'sawtooth', f0: f * R(0.995, 1.005), f1: f * 0.97, env: { peak: 0.06 * strength, attack: 0.004, dur: 1.4 }, filter: { type: 'lowpass', f: 4200, f1: 900 } });
  }
  tone(o, { f0: 70, f1: 28, env: { peak: 0.9 * strength, dur: 1.2 } });
  voiced(o, { f0: 880, f1: 760, vowel: VOWELS.i, breath: 0.8, jitter: 60, env: { peak: 0.15 * strength, attack: 0.005, dur: 0.6 } });
}

/** A rising swell that ends on nothing (it is the silence after it that hurts). */
export function swell(o: Out, dur: number, strength: number): void {
  noise(o, { colour: 'pink', type: 'bandpass', f0: 300, f1: 3000, q: 1, env: { peak: 0.3 * strength, attack: dur * 0.95, dur } });
  for (const f of [220, 233.1, 246.9]) tone(o, { wave: 'sawtooth', f0: f, f1: f * 1.06, env: { peak: 0.04 * strength, attack: dur * 0.95, dur }, filter: { type: 'lowpass', f: 600, f1: 3000 } });
}

/** A heartbeat, lub-dub. */
export function heartbeat(o: Out, strength: number): void {
  tone(o, { f0: 62, f1: 44, env: { peak: 0.7 * strength, attack: 0.008, dur: 0.16 } });
  tone(o, { at: 0.17, f0: 58, f1: 40, env: { peak: 0.5 * strength, attack: 0.008, dur: 0.14 } });
  noise(o, { colour: 'brown', type: 'lowpass', f0: 140, env: { peak: 0.4 * strength, attack: 0.005, dur: 0.12 } });
}

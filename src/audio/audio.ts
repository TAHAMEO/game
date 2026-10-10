import { angleDiff } from '../core/math';
import type { Sim } from '../core/sim';
import type { GameEvent, SoundKind, VoiceSig } from '../core/types';

interface Chain {
  input: AudioNode;
  t: number;
}

/**
 * Procedural WebAudio. Every sound is synthesised, so there are no assets to load and
 * phantom sounds [S] are, by construction, byte-for-byte the same recipes as real ones.
 */
export class AudioEngine {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private sfx!: GainNode;
  private noiseBuf!: AudioBuffer;
  private drone: { g: GainNode; o3g: GainNode; lfo: OscillatorNode } | null = null;
  private room: GainNode | null = null;
  private hum: GainNode | null = null;
  private wind: GainNode | null = null;
  private muffle!: BiquadFilterNode;
  private nextCreak = 20;
  tts = true;
  volume = 0.9;

  get started(): boolean {
    return this.ctx !== null;
  }

  /** Must be called from a user gesture. */
  start(): void {
    if (this.ctx) {
      void this.ctx.resume();
      return;
    }
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    const ctx = new AC();
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.gain.value = this.volume;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 4;
    this.master.connect(comp).connect(ctx.destination);
    this.muffle = ctx.createBiquadFilter();
    this.muffle.type = 'lowpass';
    this.muffle.frequency.value = 20000;
    this.sfx = ctx.createGain();
    this.sfx.connect(this.muffle).connect(this.master);
    const len = ctx.sampleRate * 2;
    this.noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    this.buildAmbience();
  }

  setVolume(v: number): void {
    this.volume = v;
    if (this.ctx) this.master.gain.value = v;
  }

  private buildAmbience(): void {
    const ctx = this.ctx!;
    const g = ctx.createGain();
    g.gain.value = 0.02;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 220;
    lp.connect(g).connect(this.master);
    const o1 = ctx.createOscillator();
    o1.frequency.value = 41;
    const o2 = ctx.createOscillator();
    o2.type = 'triangle';
    o2.frequency.value = 61.9;
    o1.connect(lp);
    o2.connect(lp);
    // A dissonant third voice that only creeps in as the debt rises [Z].
    const o3 = ctx.createOscillator();
    o3.type = 'sawtooth';
    o3.frequency.value = 58.3;
    const o3g = ctx.createGain();
    o3g.gain.value = 0;
    o3.connect(o3g).connect(lp);
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 1 / 9;
    const lfoG = ctx.createGain();
    lfoG.gain.value = 0.008;
    lfo.connect(lfoG).connect(g.gain);
    for (const o of [o1, o2, o3, lfo]) o.start();
    this.drone = { g, o3g, lfo };

    this.room = this.loopNoise(380, 0.6, 0.012);
    this.wind = this.loopNoise(260, 0.8, 0);
    const hum = ctx.createGain();
    hum.gain.value = 0;
    for (const f of [60, 120]) {
      const o = ctx.createOscillator();
      o.frequency.value = f;
      const og = ctx.createGain();
      og.gain.value = f === 60 ? 1 : 0.4;
      o.connect(og).connect(hum);
      o.start();
    }
    hum.connect(this.master);
    this.hum = hum;
  }

  private loopNoise(freq: number, q: number, vol: number): GainNode {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.loop = true;
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = freq;
    f.Q.value = q;
    const g = ctx.createGain();
    g.gain.value = vol;
    src.connect(f).connect(g).connect(this.master);
    src.start();
    return g;
  }

  /** Ambience follows the run: the drone thickens with the debt, the building hums once powered. */
  update(sim: Sim, dt: number): void {
    const ctx = this.ctx;
    if (!ctx || !this.drone) return;
    const now = ctx.currentTime;
    const floor = sim.director.floor;
    const pl = sim.player;
    const zoneIdx = sim.level.zoneOf[pl.soundCell]!;
    const exterior = zoneIdx >= 0 && sim.level.zones[zoneIdx]!.exterior;
    const alive = pl.alive ? 1 : 0.2;
    this.drone.g.gain.setTargetAtTime((0.018 + 0.05 * floor) * alive, now, 1.5);
    this.drone.o3g.gain.setTargetAtTime(Math.max(0, floor - 0.35) * 0.35, now, 3);
    this.room!.gain.setTargetAtTime(exterior ? 0.004 : 0.012, now, 1);
    this.wind!.gain.setTargetAtTime(exterior ? 0.035 : 0, now, 1);
    this.hum!.gain.setTargetAtTime(sim.objectives.powerOn && !exterior ? 0.006 : 0, now, 0.5);
    const hiddenInMetal = pl.hidden && pl.hidden.kind !== 'bed';
    this.muffle.frequency.setTargetAtTime(hiddenInMetal ? 1400 : 20000, now, 0.08);
    // The building settles more often as the silences shrink [Z].
    this.nextCreak -= dt;
    if (this.nextCreak <= 0 && pl.alive) {
      this.nextCreak = 25 * (1 - 0.7 * floor) + Math.random() * 20;
      this.creak(0.05 + 0.05 * floor, Math.random() * 2 - 1);
    }
  }

  handle(events: GameEvent[], sim: Sim): void {
    if (!this.ctx) return;
    for (const e of events) {
      if (e.type === 'sound') {
        const rel = angleDiff(sim.player.angle, e.dir);
        const own = e.source === 'player';
        const pan = own ? 0 : Math.max(-1, Math.min(1, Math.sin(rel) * 0.9));
        const behind = !own && Math.abs(rel) > Math.PI / 2;
        this.play(e.kind, e.volume, pan, behind);
      } else if (e.type === 'subtitle') {
        if (e.radio) this.play('radio', 0.7, 0, false);
        if (this.tts && e.text !== '—') this.speak(e.text, e.voice, e.volume ?? 1, e.radio === true);
      } else if (e.type === 'death') {
        this.play('scream', 0.4, 0, false);
      } else if (e.type === 'power') {
        this.play('breaker', 1, 0, false);
      }
    }
  }

  /** Drop queued speech, so voices from the last life don't follow you into the next. */
  silenceVoices(): void {
    try {
      window.speechSynthesis?.cancel();
    } catch {
      /* speech unavailable */
    }
  }

  private speak(text: string, voice: VoiceSig | undefined, volume: number, radio: boolean): void {
    const synth = window.speechSynthesis;
    if (!synth) return;
    try {
      const u = new SpeechSynthesisUtterance(text.replace(/[…—]/g, ', '));
      u.pitch = voice?.pitch ?? 1;
      u.rate = (voice?.rate ?? 1) * (radio ? 1.05 : 0.95);
      u.volume = Math.max(0.15, Math.min(1, volume)) * (radio ? 0.8 : 0.7);
      synth.speak(u);
    } catch {
      /* speech unavailable */
    }
  }

  // ======================================================================= recipes

  private chain(vol: number, pan: number, behind: boolean): Chain {
    const ctx = this.ctx!;
    const g = ctx.createGain();
    g.gain.value = vol;
    let head: AudioNode = g;
    if (behind) {
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 1700;
      lp.connect(g);
      head = lp;
    }
    const p = ctx.createStereoPanner();
    p.pan.value = pan;
    g.connect(p).connect(this.sfx);
    return { input: head, t: ctx.currentTime + 0.005 };
  }

  private noise(c: Chain, at: number, dur: number, type: BiquadFilterType, f0: number, f1: number, q: number, vol: number, attack = 0.005): void {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.Q.value = q;
    f.frequency.setValueAtTime(f0, c.t + at);
    f.frequency.exponentialRampToValueAtTime(Math.max(20, f1), c.t + at + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, c.t + at);
    g.gain.exponentialRampToValueAtTime(vol, c.t + at + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, c.t + at + dur);
    src.connect(f).connect(g).connect(c.input);
    src.start(c.t + at, Math.random() * 1.5, dur + 0.05);
  }

  private tone(c: Chain, at: number, dur: number, type: OscillatorType, f0: number, f1: number, vol: number, attack = 0.004): void {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f0, c.t + at);
    o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), c.t + at + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, c.t + at);
    g.gain.exponentialRampToValueAtTime(vol, c.t + at + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, c.t + at + dur);
    o.connect(g).connect(c.input);
    o.start(c.t + at);
    o.stop(c.t + at + dur + 0.05);
  }

  private creak(vol: number, pan: number): void {
    const c = this.chain(vol, pan, true);
    this.tone(c, 0, 0.9, 'sawtooth', 90 + Math.random() * 40, 140, 0.4, 0.2);
    this.noise(c, 0, 0.9, 'bandpass', 500, 700, 6, 0.3, 0.2);
  }

  play(kind: SoundKind, volume: number, pan: number, behind: boolean): void {
    if (!this.ctx || volume <= 0.003) return;
    const v = Math.min(1, volume);
    const c = this.chain(v, pan, behind);
    const R = Math.random;
    switch (kind) {
      case 'step':
        this.noise(c, 0, 0.08, 'lowpass', 900, 300, 0.7, 0.35);
        break;
      case 'entityStep':
        // Heavy, uneven: a footfall and something that drags after it.
        this.tone(c, 0, 0.16, 'sine', 62, 38, 0.9);
        this.noise(c, 0, 0.05, 'bandpass', 2400, 1800, 3, 0.25);
        this.tone(c, 0.11 + R() * 0.05, 0.12, 'sine', 50, 34, 0.45);
        break;
      case 'door':
        this.tone(c, 0, 0.55, 'sawtooth', 170 + R() * 30, 250, 0.12, 0.08);
        this.noise(c, 0, 0.55, 'bandpass', 900, 1300, 7, 0.4, 0.08);
        this.noise(c, 0.5, 0.04, 'highpass', 3000, 2000, 1, 0.5);
        break;
      case 'doorBash':
        this.tone(c, 0, 0.35, 'sine', 80, 38, 1);
        this.noise(c, 0, 0.45, 'lowpass', 2500, 400, 0.8, 0.9);
        break;
      case 'locker':
        for (const f of [420, 663, 1013]) this.tone(c, 0, 0.4, 'sine', f, f * 0.98, 0.25);
        this.noise(c, 0, 0.06, 'highpass', 2000, 1500, 1, 0.5);
        break;
      case 'glass':
        this.noise(c, 0, 0.18, 'highpass', 3000, 5000, 0.7, 0.8);
        for (let i = 0; i < 6; i++) this.tone(c, R() * 0.3, 0.12, 'sine', 2000 + R() * 4000, 1800 + R() * 3000, 0.15);
        break;
      case 'whoosh':
        this.noise(c, 0, 0.25, 'bandpass', 400, 1500, 2, 0.35, 0.05);
        break;
      case 'gasp':
        this.noise(c, 0, 0.5, 'bandpass', 900, 1700, 2, 0.9, 0.02);
        break;
      case 'exhale':
        this.noise(c, 0, 0.8, 'bandpass', 900, 500, 2, 0.5, 0.1);
        break;
      case 'breath':
        this.noise(c, 0, 0.9, 'bandpass', 750, 550, 1.6, 0.35, 0.3);
        break;
      case 'tap':
        this.noise(c, 0, 0.55, 'bandpass', 2400 + R() * 400, 2600, 1.2, 0.5, 0.05);
        break;
      case 'breaker':
        this.tone(c, 0, 0.6, 'sine', 70, 40, 1);
        this.noise(c, 0, 0.3, 'lowpass', 3000, 300, 0.7, 0.8);
        this.tone(c, 0.4, 2.2, 'sawtooth', 48, 60, 0.12, 0.4);
        break;
      case 'radio':
        this.noise(c, 0, 0.7, 'bandpass', 1800, 2200, 0.7, 0.6, 0.02);
        for (let i = 0; i < 5; i++) this.noise(c, R() * 0.6, 0.03, 'highpass', 4000, 3000, 1, 0.5);
        break;
      case 'rattle':
        for (let i = 0; i < 4; i++) this.noise(c, i * 0.07, 0.05, 'bandpass', 1800, 1500, 4, 0.6);
        break;
      case 'click':
        this.noise(c, 0, 0.012, 'highpass', 5000, 4000, 1, 0.5, 0.001);
        this.noise(c, 0.03, 0.012, 'highpass', 5000, 4000, 1, 0.4, 0.001);
        break;
      case 'knock':
        // Knuckles on ductwork: the building carries it somewhere else [T].
        for (let i = 0; i < 3; i++) {
          const at = i * (0.26 + R() * 0.08);
          this.tone(c, at, 0.5, 'sine', 140, 120, 0.7);
          this.tone(c, at, 0.35, 'sine', 380, 360, 0.3);
          this.noise(c, at, 0.08, 'bandpass', 1200, 900, 2, 0.6);
          this.tone(c, at + 0.18, 0.4, 'sine', 140, 120, 0.2);
        }
        break;
      case 'tilt':
        this.noise(c, 0, 0.05, 'bandpass', 3500, 3000, 5, 0.9, 0.002);
        this.tone(c, 0.02, 0.08, 'sine', 140, 90, 0.5);
        break;
      case 'inhale':
        this.noise(c, 0, 0.95, 'bandpass', 450, 1400, 3, 0.8, 0.6);
        break;
      case 'sigh':
        this.noise(c, 0, 1.3, 'bandpass', 600, 280, 2.5, 0.6, 0.3);
        break;
      case 'snap':
        this.noise(c, 0, 0.06, 'highpass', 2500, 1500, 1, 1, 0.001);
        this.tone(c, 0, 0.25, 'sine', 90, 45, 0.9);
        break;
      case 'cough':
        this.noise(c, 0, 0.12, 'bandpass', 900, 700, 2, 0.7, 0.01);
        this.noise(c, 0.2, 0.14, 'bandpass', 850, 650, 2, 0.6, 0.01);
        break;
      case 'voice':
        // Under the words: breath and a vowel. (The words themselves are subtitles / speech.)
        this.noise(c, 0, 0.7, 'bandpass', 700, 900, 4, 0.25, 0.1);
        this.tone(c, 0, 0.6, 'triangle', 190 + R() * 60, 170, 0.08, 0.1);
        break;
      case 'lightPop':
        this.noise(c, 0, 0.04, 'highpass', 3000, 2500, 1, 0.8, 0.001);
        for (let i = 0; i < 4; i++) this.tone(c, 0.03 + R() * 0.2, 0.1, 'sine', 3000 + R() * 3000, 2500, 0.12);
        break;
      case 'pickup':
        this.noise(c, 0, 0.12, 'lowpass', 2500, 1200, 0.7, 0.3);
        break;
      case 'drag':
        this.noise(c, 0, 0.6, 'bandpass', 380, 300, 3, 0.6, 0.1);
        break;
      case 'hum':
        this.tone(c, 0, 0.55, 'sawtooth', 60, 60, 0.08, 0.1);
        break;
      case 'gate':
        for (let i = 0; i < 6; i++) this.noise(c, i * 0.06, 0.05, 'bandpass', 2000, 1700, 4, 0.5);
        this.tone(c, 0, 2.5, 'sawtooth', 42, 44, 0.3, 0.6);
        break;
      case 'scream':
        this.noise(c, 0, 1.0, 'bandpass', 1100, 1600, 3, 0.7, 0.03);
        this.tone(c, 0, 0.9, 'sawtooth', 600, 900, 0.18, 0.03);
        break;
    }
  }
}

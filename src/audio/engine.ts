import type { Level } from '../core/level';
import { cellAt } from '../core/level';
import { angleDiff, angleTo, dist, type Vec2 } from '../core/math';
import type { Player } from '../core/player';
import type { Sim } from '../core/sim';
import { skyExposure } from '../core/sky';
import type { GameEvent, SoundKind, VoiceSig } from '../core/types';
import { Ambience, bell, musicBox, paChime, phoneRing } from './ambience';
import { footstep, heartbeat, play, stinger, surfaceFor, swell, thunder, whisper } from './recipes';
import { makeImpulse, SPACES, spaceFor } from './reverb';
import { Score } from './score';
import { makeNoise, modal, noise, type NoiseBuffers, type Out, tone, voiced, VOWELS } from './synth';

export interface Volumes {
  master: number;
  music: number;
  sfx: number;
  voice: number;
}

/**
 * How loud each kind sits in the mix at full volume: target peak / the recipe's own peak
 * (measured by rendering every recipe offline — see dev/audio.ts).
 */
const LEVEL: Partial<Record<SoundKind, number>> = {
  step: 1.7,
  entityStep: 0.9,
  door: 1.3,
  doorBash: 0.46,
  locker: 0.88,
  glass: 0.53,
  whoosh: 4.2,
  gasp: 2.8,
  exhale: 3.7,
  breath: 2.2,
  tap: 1.55,
  breaker: 0.55,
  radio: 1.4,
  rattle: 1.4,
  click: 0.55,
  knock: 0.88,
  tilt: 3.1,
  inhale: 3.0,
  sigh: 4.4,
  snap: 0.73,
  cough: 3.2,
  voice: 5,
  lightPop: 0.6,
  pickup: 2.6,
  drag: 7.5,
  hum: 2.6,
  gate: 1.2,
  scream: 3.4,
  thud: 0.86,
  whisper: 1.15,
};

/** Where in the air a kind of sound comes from (height in cells). */
const HEIGHT: Partial<Record<SoundKind, number>> = {
  step: 0.02,
  entityStep: 0.02,
  glass: 0.1,
  drag: 0.15,
  knock: 1.45,
  lightPop: 1.7,
  tilt: 1.55,
  inhale: 1.55,
  sigh: 1.5,
  snap: 1.4,
  voice: 1.05,
  cough: 1.0,
  scream: 1.05,
  thud: 0.3,
};

const HRTF_OK = typeof window !== 'undefined';

/**
 * Procedural 3D audio. Sounds are placed in the world with HRTF panning at the direction
 * the simulation says they *arrive* from (around corners: from the doorway), muffled when
 * the path is bent or blocked, sent into a convolution reverb shaped like the space you are
 * standing in. Phantom sounds [S] are, by construction, the same recipes as real ones.
 */
export class AudioEngine {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private sfx!: GainNode;
  private amb!: GainNode;
  private music!: GainNode;
  private voice!: GainNode;
  private muffle!: BiquadFilterNode;
  private reverbIn!: GainNode;
  private conv: { node: ConvolverNode; gain: GainNode; space: string }[] = [];
  private activeConv = 0;
  private readonly irs = new Map<string, AudioBuffer>();
  private noiseBufs!: NoiseBuffers;
  private score!: Score;
  private ambience!: Ambience;
  private sky: Float32Array | null = null;
  private skyLevel: Level | null = null;
  private listener = { x: 0, y: 1, z: 0, yaw: 0, pitch: 0 };
  private heardAt = -99;
  private tension = 0;
  private nextHeart = 0;
  private wasHolding = false;
  private analyser: AnalyserNode | null = null;
  private meterBuf: Float32Array<ArrayBuffer> | null = null;
  tts = true;
  volumes: Volumes = { master: 0.9, music: 0.75, sfx: 1, voice: 1 };

  get started(): boolean {
    return this.ctx !== null;
  }

  /** Must be called from a user gesture. */
  start(): void {
    if (this.ctx) {
      void this.ctx.resume();
      return;
    }
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    const ctx = new AC({ latencyHint: 'interactive' });
    this.ctx = ctx;
    this.noiseBufs = makeNoise(ctx, 3);
    this.master = ctx.createGain();
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -10;
    limiter.knee.value = 6;
    limiter.ratio.value = 8;
    limiter.attack.value = 0.003;
    limiter.release.value = 0.25;
    this.master.connect(limiter).connect(ctx.destination);
    this.analyser = ctx.createAnalyser();
    this.analyser.fftSize = 2048;
    limiter.connect(this.analyser);
    this.muffle = ctx.createBiquadFilter();
    this.muffle.type = 'lowpass';
    this.muffle.frequency.value = 20000;
    this.muffle.connect(this.master);
    this.sfx = ctx.createGain();
    this.amb = ctx.createGain();
    this.music = ctx.createGain();
    this.voice = ctx.createGain();
    this.sfx.connect(this.muffle);
    this.amb.connect(this.muffle);
    this.music.connect(this.master);
    this.voice.connect(this.master);
    // two convolvers, crossfaded when you move between kinds of space
    this.reverbIn = ctx.createGain();
    for (let i = 0; i < 2; i++) {
      const node = ctx.createConvolver();
      const gain = ctx.createGain();
      gain.gain.value = i === 0 ? 1 : 0;
      this.reverbIn.connect(node).connect(gain).connect(this.muffle);
      this.conv.push({ node, gain, space: '' });
    }
    this.setSpace('corridor', true);
    this.score = new Score(ctx, this.music, this.noiseBufs);
    this.ambience = new Ambience(ctx, this.amb, this.noiseBufs, (make, angle, d, h, vol, wet) => {
      const L = this.listener;
      this.spatialAt({ x: L.x + Math.cos(angle) * d, y: h, z: L.z + Math.sin(angle) * d }, vol, wet, false, make);
    });
    this.applyVolumes();
  }

  setVolumes(v: Partial<Volumes>): void {
    Object.assign(this.volumes, v);
    this.applyVolumes();
  }

  /** Back-compat for the single volume slider. */
  setVolume(v: number): void {
    this.setVolumes({ master: v });
  }

  private applyVolumes(): void {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    this.master.gain.setTargetAtTime(this.volumes.master, now, 0.05);
    this.sfx.gain.setTargetAtTime(this.volumes.sfx, now, 0.05);
    this.amb.gain.setTargetAtTime(this.volumes.sfx, now, 0.05);
    this.music.gain.setTargetAtTime(this.volumes.music, now, 0.05);
    this.voice.gain.setTargetAtTime(this.volumes.voice, now, 0.05);
  }

  private setSpace(space: string, instant = false): void {
    const ctx = this.ctx!;
    const cur = this.conv[this.activeConv]!;
    if (cur.space === space) return;
    let ir = this.irs.get(space);
    if (!ir) {
      ir = makeImpulse(ctx, SPACES[space] ?? SPACES.corridor!);
      this.irs.set(space, ir);
    }
    const next = this.conv[1 - this.activeConv]!;
    next.node.buffer = ir;
    next.space = space;
    const now = ctx.currentTime;
    next.gain.gain.cancelScheduledValues(now);
    cur.gain.gain.cancelScheduledValues(now);
    next.gain.gain.setTargetAtTime(1, now, instant ? 0.001 : 0.35);
    cur.gain.gain.setTargetAtTime(0, now, instant ? 0.001 : 0.35);
    this.activeConv = 1 - this.activeConv;
  }

  // =================================================================== placement

  /** A sound at a point in the world (x, height, z). */
  private spatialAt(p: { x: number; y: number; z: number }, volume: number, wet: number, muffled: boolean, make: (o: Out) => void): void {
    const ctx = this.ctx!;
    if (volume <= 0.002) return;
    const g = ctx.createGain();
    g.gain.value = volume;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = muffled ? 1300 : 16000;
    const pan = ctx.createPanner();
    pan.panningModel = HRTF_OK ? 'HRTF' : 'equalpower';
    pan.distanceModel = 'inverse';
    pan.refDistance = 1;
    pan.rolloffFactor = 0;
    if (pan.positionX) {
      pan.positionX.value = p.x;
      pan.positionY.value = p.y;
      pan.positionZ.value = p.z;
    } else (pan as unknown as { setPosition(x: number, y: number, z: number): void }).setPosition(p.x, p.y, p.z);
    g.connect(lp).connect(pan).connect(this.sfx);
    const send = ctx.createGain();
    send.gain.value = wet;
    lp.connect(send).connect(this.reverbIn);
    make({ ctx, dest: g, t: ctx.currentTime + 0.004, noise: this.noiseBufs });
    // let the graph go once it has had time to finish
    setTimeout(() => {
      g.disconnect();
      lp.disconnect();
      pan.disconnect();
      send.disconnect();
    }, 7000);
  }

  /** A sound relative to your head: (right, up, forward) in cells. */
  private atHead(right: number, up: number, fwd: number, volume: number, wet: number, make: (o: Out) => void): void {
    const L = this.listener;
    const fx = Math.cos(L.yaw);
    const fz = Math.sin(L.yaw);
    const rx = -fz;
    const rz = fx;
    this.spatialAt({ x: L.x + rx * right + fx * fwd, y: L.y + up, z: L.z + rz * right + fz * fwd }, volume, wet, false, make);
  }

  /** Straight into the ears, unplaced (stingers, your heart). */
  private direct(bus: AudioNode, volume: number, make: (o: Out) => void, wet = 0): void {
    const ctx = this.ctx!;
    const g = ctx.createGain();
    g.gain.value = volume;
    g.connect(bus);
    if (wet > 0) {
      const s = ctx.createGain();
      s.gain.value = wet;
      g.connect(s).connect(this.reverbIn);
    }
    make({ ctx, dest: g, t: ctx.currentTime + 0.004, noise: this.noiseBufs });
    setTimeout(() => g.disconnect(), 8000);
  }

  // =================================================================== events

  handle(events: GameEvent[], sim: Sim, viewId = sim.localId): void {
    if (!this.ctx) return;
    const viewer = sim.players[viewId] ?? sim.player;
    for (const e of events) {
      if (e.to !== undefined && e.to !== viewId) continue;
      switch (e.type) {
        case 'sound':
          this.sound(e, sim, viewer);
          break;
        case 'subtitle':
          if (e.radio) this.direct(this.voice, 0.6, (o) => play(o, 'radio', 'tile'));
          else this.atHead(Math.sin(angleDiff(viewer.angle, e.dir ?? viewer.angle)) * 2, 0, 2, 0.5 * (e.volume ?? 1), 0.3, (o) => play(o, 'voice', 'tile'));
          if (this.tts && e.text !== '—') this.speak(e.text, e.voice, e.volume ?? 1, e.radio === true);
          break;
        case 'death':
          if (e.player === viewId) {
            this.direct(this.music, 1, (o) => stinger(o, 1));
            this.atHead(0, 0.2, 0.6, 0.9, 0.5, (o) => play(o, 'inhale', 'tile'));
            this.score.duck(6);
          } else {
            const p = sim.players[e.player];
            if (p) this.place(p.pos, 1.0, 0.8, 0.6, sim, viewer, (o) => play(o, 'scream', 'tile'));
          }
          break;
        case 'scare':
          this.scare(e, sim, viewer);
          break;
        case 'story':
          this.story(e.beat, sim, viewer);
          break;
        case 'lightning': {
          const delay = 0.25 + (1 - e.strength) * 2.6;
          const s = e.strength;
          setTimeout(() => this.ctx && this.direct(this.amb, 0.55 + 0.45 * s, (o) => thunder(o, s), 0.4), delay * 1000);
          break;
        }
        case 'power':
          // every tube in the building ticks on, one after another, all around you
          for (let i = 0; i < 16; i++) {
            const a = Math.random() * Math.PI * 2;
            const d = 2 + Math.random() * 12;
            setTimeout(() => {
              if (!this.ctx) return;
              const L = this.listener;
              this.spatialAt({ x: L.x + Math.cos(a) * d, y: 1.72, z: L.z + Math.sin(a) * d }, 0.3, 0.5, false, (o) => {
                noise(o, { type: 'highpass', f0: 3500, env: { peak: 0.5, attack: 0.001, dur: 0.02 } });
                tone(o, { at: 0.02, wave: 'sawtooth', f0: 120, env: { peak: 0.08, attack: 0.01, dur: 0.4 }, filter: { type: 'bandpass', f: 900, q: 2 } });
              });
            }, 300 + i * 120 + Math.random() * 200);
          }
          break;
        case 'runEnd':
          this.score.duck(10);
          break;
      }
    }
  }

  private sound(e: Extract<GameEvent, { type: 'sound' }>, sim: Sim, viewer: Player): void {
    const zone = this.zoneKey(sim, e.pos);
    const surface = surfaceFor(zone);
    const own = e.source === 'player' && (e.player ?? 0) === viewer.id;
    const base = LEVEL[e.kind] ?? 1;
    if (own) {
      const v = Math.min(3, e.volume * base * 1.1);
      if (e.kind === 'step') {
        const w = Math.max(0.25, Math.min(1, e.volume * 1.4));
        this.atHead(0.05, -1.0, 0.18, (0.75 * w + 0.15) * 0.72, 0.18, (o) => footstep(o, surface, w));
      } else {
        const fwd = e.kind === 'breath' || e.kind === 'gasp' || e.kind === 'exhale' ? 0.15 : 0.45;
        this.atHead(0, -0.1, fwd, v, 0.22, (o) => play(o, e.kind, surface));
      }
      return;
    }
    if (e.source === 'entity' || e.phantom) this.heardAt = this.ctx!.currentTime;
    const vol = Math.pow(Math.min(1, e.volume), 1.25) * base;
    this.place(e.pos, HEIGHT[e.kind] ?? 0.9, vol, 0, sim, viewer, (o) => play(o, e.kind, surface), e.dir);
  }

  /**
   * Place a world sound: at its true distance, in the direction it arrives from. A bent or
   * blocked path muffles it and pushes it into the room's reverb.
   */
  private place(pos: Vec2, height: number, volume: number, extraWet: number, sim: Sim, viewer: Player, make: (o: Out) => void, arriveDir?: number): void {
    const L = this.listener;
    const listener2 = { x: L.x, y: L.z };
    const d = Math.max(0.6, Math.min(16, dist(listener2, pos)));
    const trueDir = angleTo(listener2, pos);
    const dir = arriveDir ?? trueDir;
    const bent = Math.abs(angleDiff(trueDir, dir)) > 0.35;
    const blocked = bent || !sim.world.los(viewer.pos, pos);
    const wet = Math.min(0.85, 0.12 + 0.3 * Math.min(1, d / 10) + (blocked ? 0.25 : 0) + extraWet);
    this.spatialAt({ x: L.x + Math.cos(dir) * d, y: height, z: L.z + Math.sin(dir) * d }, volume, wet, blocked, make);
  }

  private scare(e: Extract<GameEvent, { type: 'scare' }>, sim: Sim, viewer: Player): void {
    const s = e.intensity;
    switch (e.kind) {
      case 'lunge':
      case 'kill':
        this.direct(this.music, 0.95, (o) => stinger(o, 1));
        this.atHead(0, 0.3, 0.5, 0.9, 0.3, (o) => play(o, 'snap', 'tile'));
        this.score.duck(3);
        break;
      case 'flicker':
        this.atHead(0.1, -0.1, 0.4, 0.5, 0.1, (o) => play(o, 'click', 'tile'));
        setTimeout(() => this.ctx && this.direct(this.music, 0.85 * s, (o) => stinger(o, s)), 160);
        this.score.duck(4);
        break;
      case 'behind':
        this.direct(this.music, 0.9 * s, (o) => stinger(o, s));
        if (e.pos) this.place(e.pos, 1.5, 0.9, 0, sim, viewer, (o) => play(o, 'inhale', 'tile'));
        this.score.duck(4);
        break;
      case 'window':
        if (e.pos)
          this.place(e.pos, 1.0, 1.0, 0.2, sim, viewer, (o) => {
            modal(o, 0, [
              [95, 0.8, 0.5],
              [180, 0.4, 0.4],
            ]);
            noise(o, { type: 'lowpass', f0: 1200, env: { peak: 0.8, attack: 0.001, dur: 0.25 } });
            play({ ...o, t: o.t + 0.02 }, 'rattle', 'tile');
          });
        this.direct(this.music, 0.8 * s, (o) => stinger(o, s));
        this.score.duck(4);
        break;
      case 'locker':
        this.atHead(0, 0.0, 0.5, 0.9, 0.05, (o) => play(o, 'inhale', 'tile'));
        setTimeout(() => this.ctx && this.direct(this.music, 0.6, (o) => stinger(o, 0.7)), 600);
        this.score.duck(4);
        break;
      case 'drop':
        this.direct(this.music, 0.5, (o) => stinger(o, 0.55));
        this.score.duck(2);
        break;
      case 'whisper': {
        const side = Math.random() < 0.5 ? -1 : 1;
        this.atHead(side * 0.35, 0.05, -0.05, 0.6, 0.05, (o) => whisper(o, 6, 0.5));
        break;
      }
    }
  }

  private story(beat: Extract<GameEvent, { type: 'story' }>['beat'], sim: Sim, viewer: Player): void {
    if (beat.kind === 'whisper') {
      const side = Math.random() < 0.5 ? -1 : 1;
      this.atHead(side * 0.4, 0.05, 0.05, 0.5, 0.08, (o) => whisper(o, Math.max(3, Math.round(beat.text.length / 4)), 0.45));
      return;
    }
    if (beat.kind === 'record') {
      this.atHead(0, -0.3, 0.4, 0.5, 0.1, (o) => play(o, 'pickup', 'tile'));
      this.direct(this.music, 0.35, (o) => swell(o, 2.2, 0.5));
      return;
    }
    // visions: the building remembers, out loud
    this.score.duck(beat.duration);
    const around = (d: number, make: (o: Out) => void, vol = 0.4, h = 1.2) => {
      const a = viewer.angle + (Math.random() - 0.5) * 2.5;
      this.place({ x: viewer.pos.x + Math.cos(a) * d, y: viewer.pos.y + Math.sin(a) * d }, h, vol, 0.5, sim, viewer, make);
    };
    this.direct(this.music, 0.45, (o) => swell(o, 1.2, 0.6), 0.3);
    switch (beat.id) {
      case 'oldwing':
        around(5, (o) => {
          const tune = [392, 440, 392, 329.6, 349.2, 392];
          tune.forEach((f, i) => voiced(o, { at: i * 0.55, f0: f, vowel: VOWELS.o, breath: 0.3, vibrato: 5, env: { peak: 0.12, attack: 0.1, dur: 0.6 } }));
        });
        break;
      case 'morgue':
        for (let k = 0; k < 4; k++) setTimeout(() => this.ctx && around(3, (o) => play(o, 'knock', 'tile'), 0.5, 0.8), 400 + k * (k === 3 ? 1400 : 500));
        break;
      case 'garden':
        around(12, (o) => bell(o, 0.5), 0.6, 3.5);
        break;
      case 'surgery':
        around(3, (o) => tone(o, { wave: 'sawtooth', f0: 70, f1: 90, env: { peak: 0.2, attack: 0.6, dur: 2.5 }, filter: { type: 'bandpass', f: 400, q: 8 }, vibrato: { rate: 0.6, depth: 8 } }), 0.5, 1.7);
        break;
      case 'security':
        this.direct(this.amb, 0.3, (o) => {
          tone(o, { f0: 15600, env: { peak: 0.05, attack: 0.05, dur: 5, shape: 'hold', release: 0.5 } });
          noise(o, { type: 'bandpass', f0: 3000, q: 0.5, env: { peak: 0.2, attack: 0.02, dur: 4, shape: 'hold', release: 1 } });
        });
        break;
      case 'maintenance':
        this.direct(this.amb, 0.5, (o) => paChime(o, 0.25), 0.6);
        setTimeout(() => this.speak('Doctor Hale to the Quiet Room. Doctor Hale to the Quiet Room.', { pitch: 0.85, rate: 0.9 }, 0.8, true), 1300);
        break;
      case 'eastward':
        around(8, (o) => musicBox(o, 0.3), 0.5, 1.0);
        break;
      case 'westward':
        around(6, (o) => phoneRing(o, 0.12), 0.6, 1.0);
        break;
      case 'nest':
        for (let k = 0; k < 5; k++) setTimeout(() => this.ctx && this.atHead((Math.random() - 0.5) * 1.2, 0.1, 0.4, 0.4, 0.2, (o) => whisper(o, 4, 0.4)), k * 900);
        break;
    }
  }

  // =================================================================== frame

  update(sim: Sim, dt: number, viewId = sim.localId): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const pl = sim.players[viewId] ?? sim.player;
    const now = ctx.currentTime;
    // the listener is your head
    const L = this.listener;
    L.x = pl.pos.x;
    L.z = pl.pos.y;
    L.y = 0.2 + (pl.eye - 0.1) * 2.2;
    L.yaw = pl.angle;
    L.pitch = pl.pitch;
    const fx = Math.cos(pl.angle) * Math.cos(pl.pitch);
    const fy = Math.sin(pl.pitch);
    const fz = Math.sin(pl.angle) * Math.cos(pl.pitch);
    const li = ctx.listener;
    if (li.positionX) {
      li.positionX.setTargetAtTime(L.x, now, 0.02);
      li.positionY.setTargetAtTime(L.y, now, 0.02);
      li.positionZ.setTargetAtTime(L.z, now, 0.02);
      li.forwardX.setTargetAtTime(fx, now, 0.02);
      li.forwardY.setTargetAtTime(fy, now, 0.02);
      li.forwardZ.setTargetAtTime(fz, now, 0.02);
      li.upX.value = 0;
      li.upY.value = 1;
      li.upZ.value = 0;
    } else {
      const old = li as unknown as { setPosition(x: number, y: number, z: number): void; setOrientation(a: number, b: number, c: number, d: number, e: number, f: number): void };
      old.setPosition(L.x, L.y, L.z);
      old.setOrientation(fx, fy, fz, 0, 1, 0);
    }
    // the space you are in
    const cell = pl.soundCell;
    const zk = this.zoneKey(sim, pl.pos);
    const region = sim.level.regionOf[cell] ?? -1;
    const rk = region >= 0 ? sim.level.regions[region]!.kind : 'room';
    const hiddenIn = pl.hidden && pl.hidden.kind !== 'bed' ? pl.hidden.kind : null;
    this.setSpace(spaceFor(zk, rk, hiddenIn));
    this.muffle.frequency.setTargetAtTime(hiddenIn ? 1500 : pl.hidden ? 6000 : 20000, now, 0.08);
    // ambience
    if (this.skyLevel !== sim.level) {
      this.sky = skyExposure(sim.level);
      this.skyLevel = sim.level;
    }
    const zone = sim.level.zoneOf[cell] ?? -1;
    const zdef = zone >= 0 ? sim.level.zones[zone]! : null;
    this.ambience.update(dt, {
      exterior: zdef?.exterior ?? false,
      sky: this.sky ? (this.sky[cell] ?? 0) : 0,
      light: Math.min(1, sim.world.lighting.lumAt(cell)),
      powerOn: sim.objectives.powerOn,
      cold: zdef?.cold ?? false,
      floor: sim.director.floor,
      alive: pl.active,
      zone: zk,
    });
    // the score follows what you perceive: what you saw, what you heard, what you think you saw
    const ent = sim.entity;
    const chased = (ent.stateKind === 'chase' || ent.stateKind === 'lunge') && ent.target === pl.id;
    const sees = sim.director.adapt.playerSeesEntity(pl);
    const heard = Math.max(0, 1 - (now - this.heardAt) / 6);
    const phantom = pl.perception.phantoms.length > 0 ? 0.55 : 0;
    const target = Math.min(1, Math.max(chased ? 1 : 0, sees ? 0.75 : 0, heard * 0.45, phantom) + sim.director.floor * 0.12);
    this.tension += (target - this.tension) * (1 - Math.exp(-dt / (target > this.tension ? 0.5 : 5)));
    this.score.update(dt, { tension: this.tension, chase: chased, floor: sim.director.floor, alive: pl.active, vision: 0 });
    // your heart: fear, exertion, holding your breath, a wound
    const holding = pl.breath.holding;
    const fear = this.tension;
    const bpm = 64 + 70 * fear + 45 * pl.exertion + (holding ? 18 : 0) + (pl.wounded ? 12 : 0);
    const vol = Math.min(0.9, 0.04 + 0.5 * fear * fear + (holding ? 0.25 + Math.min(0.3, pl.breath.held * 0.04) : 0) + (pl.hidden ? 0.12 : 0));
    if (pl.active && vol > 0.06 && now >= this.nextHeart) {
      this.nextHeart = now + 60 / bpm;
      this.direct(this.sfx, vol, (o) => heartbeat(o, 1));
    }
    if (this.wasHolding && !holding) this.nextHeart = now + 0.2;
    this.wasHolding = holding;
  }

  private zoneKey(sim: Sim, p: Vec2): string {
    const c = cellAt(sim.level, p);
    const z = c >= 0 ? sim.level.zoneOf[c]! : -1;
    return z >= 0 ? sim.level.zones[z]!.key : 'h';
  }

  // =================================================================== voices

  /** Drop queued speech, so voices from the last life don't follow you into the next. */
  silenceVoices(): void {
    try {
      window.speechSynthesis?.cancel();
    } catch {
      /* speech unavailable */
    }
  }

  speak(text: string, voice: VoiceSig | undefined, volume: number, radio: boolean): void {
    if (!this.tts) return;
    const synth = window.speechSynthesis;
    if (!synth) return;
    try {
      const u = new SpeechSynthesisUtterance(text.replace(/[…—]/g, ', '));
      u.pitch = voice?.pitch ?? 1;
      u.rate = (voice?.rate ?? 1) * (radio ? 1.02 : 0.92);
      u.volume = Math.max(0.12, Math.min(1, volume)) * (radio ? 0.75 : 0.65) * this.volumes.voice * this.volumes.master;
      synth.speak(u);
    } catch {
      /* speech unavailable */
    }
  }

  /** Menu sounds and the title's low hum. */
  ui(kind: 'hover' | 'select' | 'start'): void {
    if (!this.ctx) return;
    if (kind === 'hover') this.direct(this.music, 0.15, (o) => tone(o, { f0: 880, f1: 860, env: { peak: 0.05, attack: 0.002, dur: 0.06 } }));
    else if (kind === 'select') this.direct(this.music, 0.3, (o) => play(o, 'click', 'tile'));
    else this.direct(this.music, 0.6, (o) => swell(o, 1.8, 0.8), 0.5);
  }

  /** What is coming out right now, in dBFS (RMS over the last ~40 ms). For tests and a level meter. */
  meter(): number {
    const a = this.analyser;
    if (!a) return -Infinity;
    if (!this.meterBuf || this.meterBuf.length !== a.fftSize) this.meterBuf = new Float32Array(a.fftSize);
    a.getFloatTimeDomainData(this.meterBuf);
    let sum = 0;
    for (const v of this.meterBuf) sum += v * v;
    const rms = Math.sqrt(sum / this.meterBuf.length);
    return rms > 0 ? 20 * Math.log10(rms) : -Infinity;
  }

  /** The audio clock is running (not suspended by the browser). */
  get running(): boolean {
    return this.ctx?.state === 'running';
  }

  suspend(): void {
    void this.ctx?.suspend();
  }

  resume(): void {
    void this.ctx?.resume();
  }
}

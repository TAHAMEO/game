import { idleInput, type InputState } from '../core/input';
import { angleDiff, wrapAngle } from '../core/math';
import { type Body, moveBody, PITCH_LIMIT } from '../core/player';
import type { Sim } from '../core/sim';
import type { GameEvent } from '../core/types';
import { type NetInput, packInput, type Snap } from './protocol';
import { type InputSource, type Session, STEP, StepClock } from './session';
import { ApplyCtx, applySnapshot, type BodyState, bodyStateOf, motionIndex } from './snapshot';
import type { Link } from './transport';

/** How far behind the host's latest snapshot a guest shows the run (two snapshots' worth). */
export const INTERP_DELAY = 0.1;

/**
 * One step of your own body, as the host will play it: look first, then (if you are free to
 * move) walking, by the same rules the simulation uses.
 */
export function predictStep(b: Body & { pitch: number }, input: InputState, st: BodyState, sim: Sim): void {
  if (!st.active) return;
  const lim = st.hidden ? 0.55 : PITCH_LIMIT;
  b.pitch = Math.max(-lim, Math.min(lim, b.pitch + (input.pitch ?? 0)));
  if (st.transition) {
    b.speed = 0;
    return;
  }
  if (st.hidden) {
    const span = st.hideKind === 'bed' ? 1.4 : 0.95;
    b.angle = wrapAngle(st.hideBase + Math.max(-span, Math.min(span, angleDiff(st.hideBase, b.angle + input.turn))));
    b.speed = 0;
    return;
  }
  b.angle = wrapAngle(b.angle + input.turn);
  b.crouching = input.crouch;
  if (st.channel) {
    b.vel.x = 0;
    b.vel.y = 0;
    b.speed = 0;
    return;
  }
  moveBody(b, input, STEP, sim.level, sim.world);
}

type Pred = Body & { pitch: number };

/**
 * A guest in someone else's building. The run here is a copy: the host's snapshots keep it
 * in step, shown a tenth of a second in the past so everything that moves can be drawn
 * smoothly between them. Your own body is the exception — it moves the moment you do,
 * predicted by the simulation's own rules and quietly corrected whenever the host's word
 * on it arrives.
 */
export class ClientSession implements Session {
  readonly kind = 'client';
  readonly live = true;
  status: string | null = null;
  readonly ctx: ApplyCtx;
  private readonly clock = new StepClock();
  private seq = 0;
  private pending: (InputState & { seq: number })[] = [];
  private readonly queue: Snap[] = [];
  private readonly motion: { t: number; m: number[] }[] = [];
  private renderTime = -1;
  private latestT = 0;
  private body: Pred;
  private bodyState: BodyState | null = null;
  private myRow: unknown[] | null = null;
  private readonly offset = { x: 0, y: 0 };
  private wall = 0;
  private lastHeard = 0;
  /** Torch clicks the host has not answered yet (the beam answers at once). */
  private torchPresses: number[] = [];
  private disposed = false;
  private ended = false;
  /** Called once when the run ends (to keep the pages you found). */
  onEnded: (sim: Sim) => void = () => {};

  constructor(
    readonly sim: Sim,
    readonly localId: number,
    private readonly link: Link,
    private readonly lobby: () => void = () => {},
  ) {
    this.ctx = new ApplyCtx(sim, localId);
    sim.localId = localId;
    const p = sim.players[localId]!;
    this.body = {
      pos: { ...p.pos },
      vel: { x: 0, y: 0 },
      angle: p.angle,
      pitch: p.pitch,
      speed: 0,
      crouching: false,
      sprinting: false,
      exhausted: false,
      stamina: p.stamina,
      exertion: 0,
      wounded: false,
      bob: 0,
      eye: p.eye,
    };
    for (const d of sim.world.doors) this.ctx.doorTarget[d.index] = d.open;
  }

  // ------------------------------------------------------------------ from the host

  receive(snap: Snap): void {
    if (this.disposed) return;
    this.lastHeard = this.wall;
    this.queue.push(snap);
    this.motion.push({ t: snap.t, m: snap.m });
    if (this.motion.length > 40) this.motion.splice(0, this.motion.length - 40);
    this.latestT = snap.t;
    if (this.renderTime < 0) this.renderTime = snap.t - INTERP_DELAY;
    const mine = snap.tb.pl?.r.find((r) => r[0] === this.localId);
    if (mine) this.myRow = mine.slice(1);
    this.reconcile(snap);
  }

  /** The host has played your inputs up to `ack`: start again from there and replay the rest. */
  private reconcile(snap: Snap): void {
    if (!this.myRow) return;
    const st = bodyStateOf(this.myRow, this.ctx);
    this.bodyState = st;
    this.pending = this.pending.filter((p) => p.seq > snap.ack);
    this.torchPresses = this.torchPresses.filter((s) => s > snap.ack);
    const mi = motionIndex.player(this.localId);
    const m = snap.m;
    const old = this.body;
    const b: Pred = {
      pos: { x: m[mi]!, y: m[mi + 1]! },
      vel: { ...st.vel },
      angle: m[mi + 2]!,
      pitch: m[mi + 3]!,
      speed: old.speed,
      crouching: st.crouching,
      sprinting: old.sprinting,
      exhausted: st.exhausted,
      stamina: st.stamina,
      exertion: st.exertion,
      wounded: st.wounded,
      bob: old.bob,
      eye: old.eye,
    };
    for (const p of this.pending) predictStep(b, p, st, this.sim);
    // head bob and eye height are yours alone; replaying must not walk them twice
    b.bob = old.bob;
    b.eye = old.eye;
    const dx = old.pos.x - b.pos.x;
    const dy = old.pos.y - b.pos.y;
    if (st.active && !st.hidden && !st.transition && dx * dx + dy * dy < 1) {
      // a small disagreement: slide there rather than jump
      this.offset.x += dx;
      this.offset.y += dy;
    } else {
      this.offset.x = 0;
      this.offset.y = 0;
    }
    this.body = b;
  }

  // ------------------------------------------------------------------ per frame

  tick(dt: number, input: InputSource | null): GameEvent[] {
    if (this.disposed) return [];
    this.wall += dt;
    const n = this.clock.steps(dt);
    const frames = input ? input.frame(dt, n) : Array.from({ length: n }, idleInput);
    if (frames.length) {
      const packed: NetInput[] = [];
      for (const f of frames) {
        const s = { ...f, seq: ++this.seq };
        this.pending.push(s);
        packed.push(packInput(s.seq, s));
        if (this.bodyState) predictStep(this.body, s, this.bodyState, this.sim);
        if (s.flashlightPressed) this.torchPresses.push(s.seq);
      }
      this.link.send({ t: 'in', i: packed });
    }
    const events = this.advance(dt);
    this.placeSelf(dt);
    const quiet = this.lastHeard > 0 && this.wall - this.lastHeard > 2.5 && this.sim.phase === 'playing';
    this.status = quiet ? 'The host has gone quiet…' : this.renderTime < 0 ? 'Waiting for the host…' : null;
    if (!this.ended && this.sim.phase !== 'playing') {
      this.ended = true;
      this.onEnded(this.sim);
    }
    return events;
  }

  /** Bring the copy up to "a tenth of a second ago", releasing what happened on the way. */
  private advance(dt: number): GameEvent[] {
    if (this.renderTime < 0) return [];
    const target = this.latestT - INTERP_DELAY;
    let rt = this.renderTime + dt;
    const err = target - rt;
    if (Math.abs(err) > 0.5) rt = target;
    else rt += err * Math.min(1, dt * 2);
    rt = Math.min(rt, this.latestT);
    this.renderTime = Math.max(this.renderTime, rt);
    const out: GameEvent[] = [];
    while (this.queue.length && this.queue[0]!.t <= this.renderTime) {
      const s = this.queue.shift()!;
      applySnapshot(this.ctx, s);
      if (s.ev) for (const e of s.ev) out.push(e);
    }
    const sim = this.sim;
    sim.time = Math.max(sim.time, this.renderTime);
    this.interpolate(this.renderTime);
    // doors glide between snapshots
    const k = Math.min(1, dt * 14);
    for (const d of sim.world.doors) {
      const t = this.ctx.doorTarget[d.index];
      if (t !== undefined) d.open += (t - d.open) * k;
    }
    return out;
  }

  private interpolate(rt: number): void {
    const M = this.motion;
    while (M.length >= 2 && M[1]!.t <= rt) M.shift();
    const a = M[0];
    if (!a) return;
    const b = M[1];
    const k = b ? Math.max(0, Math.min(1, (rt - a.t) / Math.max(1e-6, b.t - a.t))) : 0;
    const sim = this.sim;
    const pos = (i: number, out: { x: number; y: number }) => {
      if (!b || Math.hypot(b.m[i]! - a.m[i]!, b.m[i + 1]! - a.m[i + 1]!) > 3) {
        out.x = (b && k > 0.5 ? b : a).m[i]!;
        out.y = (b && k > 0.5 ? b : a).m[i + 1]!;
      } else {
        out.x = a.m[i]! + (b.m[i]! - a.m[i]!) * k;
        out.y = a.m[i + 1]! + (b.m[i + 1]! - a.m[i + 1]!) * k;
      }
    };
    const ang = (i: number) => (b ? wrapAngle(a.m[i]! + angleDiff(a.m[i]!, b.m[i]!) * k) : a.m[i]!);
    const e = sim.entity;
    pos(motionIndex.entity, e.pos);
    e.angle = ang(motionIndex.entity + 2);
    for (const p of sim.players) {
      if (p.id === this.localId) continue;
      const i = motionIndex.player(p.id);
      pos(i, p.pos);
      p.angle = ang(i + 2);
      p.pitch = b ? a.m[i + 3]! + (b.m[i + 3]! - a.m[i + 3]!) * k : a.m[i + 3]!;
    }
    for (const sv of sim.survivors.list) pos(motionIndex.survivor(sim, sv.id), sv.pos);
  }

  /** Put your body where you predicted it, so the camera answers your hands at once. */
  private placeSelf(dt: number): void {
    const p = this.sim.players[this.localId];
    const st = this.bodyState;
    if (!p || !st) return;
    const decay = Math.exp(-dt * 10);
    this.offset.x *= decay;
    this.offset.y *= decay;
    if (!st.active) return;
    const b = this.body;
    if (!st.hidden && !st.transition) {
      p.pos.x = b.pos.x + this.offset.x;
      p.pos.y = b.pos.y + this.offset.y;
      p.vel.x = b.vel.x;
      p.vel.y = b.vel.y;
      p.speed = b.speed;
      p.crouching = b.crouching;
      p.sprinting = b.sprinting;
      p.bob = b.bob;
    } else if (this.myRow) {
      // tucked away: where the host says you are
      const latest = this.motion[this.motion.length - 1];
      if (latest) {
        const i = motionIndex.player(this.localId);
        p.pos.x = latest.m[i]!;
        p.pos.y = latest.m[i + 1]!;
      }
    }
    p.angle = b.angle;
    p.pitch = b.pitch;
    p.eye = b.eye;
    // the host's latest word on your torch, plus the clicks it has not heard yet
    p.flashlight.on = this.torchPresses.length % 2 === 1 ? !st.torch : st.torch;
    if (!st.hidden && !st.transition && !st.channel) p.refreshFocus();
    else p.focus = null;
  }

  forfeit(): void {
    this.link.send({ t: 'forfeit' });
  }

  toLobby(): void {
    this.lobby();
  }

  dispose(): void {
    this.disposed = true;
  }
}


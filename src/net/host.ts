import { idleInput, type InputState } from '../core/input';
import type { Sim } from '../core/sim';
import type { GameEvent } from '../core/types';
import { SNAP_EVERY, type ToHost, unpackInput } from './protocol';
import { type InputSource, type Session, STEP, StepClock } from './session';
import { SnapshotWriter } from './snapshot';
import type { Link } from './transport';

/** A guest's seat in a run the host is running. */
export interface GuestSeat {
  seat: number;
  name: string;
  link: Link;
}

interface SeatState extends GuestSeat {
  queue: (InputState & { seq: number })[];
  held: InputState;
  ack: number;
  gone: boolean;
  /** Steps in a row with nothing from them. */
  starved: number;
}

/** Inputs a guest may have waiting before the host starts folding them together. */
const MAX_BUFFER = 6;
/** A guest silent this long (a hidden tab, a dead line) stops walking. */
const STARVE_STEPS = 30;

/**
 * Hosting a shared run: the one real simulation. Every fixed step takes your input and the
 * next one each guest sent; every few steps each guest gets what changed.
 */
export class HostSession implements Session {
  readonly kind = 'host';
  readonly localId = 0;
  readonly live = true;
  status: string | null = null;
  private readonly clock = new StepClock();
  private readonly writer: SnapshotWriter;
  private readonly seats: SeatState[];
  private steps = 0;
  private outbox: GameEvent[] = [];
  private disposed = false;

  constructor(
    readonly sim: Sim,
    guests: GuestSeat[],
    private readonly lobby: () => void = () => {},
  ) {
    this.writer = new SnapshotWriter(sim);
    this.seats = guests.map((g) => ({ ...g, queue: [], held: idleInput(), ack: 0, gone: false, starved: 0 }));
    // everyone starts from a full picture of the building
    this.flush();
  }

  /** Something a guest sent during the run. */
  receive(seat: number, msg: ToHost): void {
    const s = this.seats.find((x) => x.seat === seat);
    if (!s || s.gone) return;
    if (msg.t === 'in') {
      // two seconds of steps at most in one message; anything malformed is ignored
      if (!Array.isArray(msg.i) || msg.i.length > 120) return;
      for (const n of msg.i) {
        if (!Array.isArray(n) || n.length !== 6 || !n.every((v) => typeof v === 'number' && Number.isFinite(v))) continue;
        const inp = unpackInput(n);
        if (inp.seq > (s.queue.length ? s.queue[s.queue.length - 1]!.seq : s.ack)) s.queue.push(inp);
      }
    } else if (msg.t === 'forfeit') {
      const p = this.sim.players[seat];
      if (p?.active && this.sim.phase === 'playing') p.die('You stopped.');
    }
  }

  /** A guest's connection dropped: their character is lost in the building. */
  leave(seat: number): void {
    const s = this.seats.find((x) => x.seat === seat);
    if (!s || s.gone) return;
    s.gone = true;
    const p = this.sim.players[seat];
    if (p?.active && this.sim.phase === 'playing') p.die('Their light went out somewhere in the building.');
  }

  tick(dt: number, input: InputSource | null): GameEvent[] {
    if (this.disposed) return [];
    const n = this.clock.steps(dt);
    const local = input ? input.frame(dt, n) : [];
    const out: GameEvent[] = [];
    for (let i = 0; i < n; i++) {
      const inputs: InputState[] = [local[i] ?? idleInput()];
      for (const s of this.seats) inputs[s.seat] = s.gone ? idleInput() : this.next(s);
      this.sim.step(STEP, inputs);
      const ev = this.sim.drainEvents();
      if (ev.length) {
        out.push(...ev);
        this.outbox.push(...ev);
      }
      if (++this.steps % SNAP_EVERY === 0) this.flush();
    }
    return out;
  }

  /**
   * A guest's next step. One that has fallen behind (a stall, then a burst) is caught up by
   * folding steps together, never by dropping them: every turn of the head and every key
   * press still lands. One that has gone quiet keeps walking the way it was for a moment
   * (a hiccup on the line), presses nothing new, and soon stands still.
   */
  private next(s: SeatState): InputState {
    const q = s.queue;
    while (q.length > MAX_BUFFER) {
      const a = q.shift()!;
      const b = q[0]!;
      b.turn += a.turn;
      b.pitch += a.pitch;
      b.interactPressed ||= a.interactPressed;
      b.flashlightPressed ||= a.flashlightPressed;
      b.throwPressed ||= a.throwPressed;
    }
    const inp = q.shift();
    if (inp) {
      s.held = inp;
      s.ack = inp.seq;
      s.starved = 0;
      return inp;
    }
    if (++s.starved > STARVE_STEPS) return { ...idleInput(), crouch: s.held.crouch, holdBreath: false };
    return { ...s.held, turn: 0, pitch: 0, interactPressed: false, flashlightPressed: false, throwPressed: false };
  }

  private flush(): void {
    const live = this.seats.filter((s) => !s.gone);
    if (live.length) {
      const f = this.writer.capture();
      for (const s of live) s.link.send({ t: 'snap', s: this.writer.snapshotFor(f, s.seat, s.ack, this.outbox) });
    }
    this.outbox = [];
  }

  forfeit(): void {
    const p = this.sim.players[0];
    if (p?.active && this.sim.phase === 'playing') p.die('You stopped.');
  }

  toLobby(): void {
    this.lobby();
  }

  dispose(): void {
    this.disposed = true;
  }
}

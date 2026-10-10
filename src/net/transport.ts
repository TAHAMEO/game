/**
 * How the machines in a shared run reach each other. A transport is reliable and in order
 * (WebRTC data channels in reliable mode, a WebSocket relay, or memory in tests): the
 * snapshot protocol depends on that.
 */

/** A connection to one other machine. */
export interface Link {
  send(msg: unknown): void;
  /** Replaced by whoever owns the link. */
  onMessage: (msg: unknown) => void;
  onClose: (reason: string) => void;
  close(): void;
}

/** A room you host: other machines arrive through it. */
export interface HostRoom {
  /** What your friends type in to join. */
  readonly code: string;
  onJoin: (link: Link) => void;
  /** The room itself failed (the signalling server went away). */
  onError: (reason: string) => void;
  close(): void;
}

export interface Transport {
  readonly name: string;
  host(): Promise<HostRoom>;
  join(code: string): Promise<Link>;
}

/** Room codes avoid letters and digits that read alike (0/O, 1/I). */
export const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function randomCode(length = 5): string {
  let s = '';
  const buf = new Uint32Array(length);
  globalThis.crypto?.getRandomValues?.(buf);
  for (let i = 0; i < length; i++) s += CODE_ALPHABET[(buf[i]! || Math.floor(Math.random() * 1e9)) % CODE_ALPHABET.length];
  return s;
}

/** What someone typed (or pasted, link and all) as a room code. */
export function normaliseCode(s: string): string {
  const fromLink = /[?&]join=([A-Za-z0-9-]+)/.exec(s);
  return (fromLink ? fromLink[1]! : s)
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, 8);
}

// ------------------------------------------------------------------ in memory (tests, and two seats in one tab)

const CLOSE = Symbol('close');

class MemoryLink implements Link {
  other: MemoryLink | null = null;
  /** This end is finished: it neither sends nor receives. */
  closed = false;
  private readonly inbox: unknown[] = [];
  onMessage: (msg: unknown) => void = () => {};
  onClose: (reason: string) => void = () => {};

  constructor(private readonly auto: boolean) {}

  send(msg: unknown): void {
    const o = this.other;
    if (this.closed || !o || o.closed) return;
    // a copy, as a real wire would make
    this.post(o, JSON.parse(JSON.stringify(msg)) as unknown);
  }

  /** In order, like a real connection: what was sent before a close still arrives. */
  private post(to: MemoryLink, item: unknown): void {
    if (this.auto) queueMicrotask(() => to.take(item));
    else to.inbox.push(item);
  }

  private take(item: unknown): void {
    if (this.closed) return;
    if (item === CLOSE) {
      this.closed = true;
      this.onClose('closed');
    } else this.onMessage(item);
  }

  /** Hand over what has arrived (manual delivery mode). */
  deliver(): number {
    const items = this.inbox.splice(0);
    for (const it of items) this.take(it);
    return items.length;
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    const o = this.other;
    if (o && !o.closed) this.post(o, CLOSE);
  }
}

/**
 * Two ends of a wire in the same process. With `auto` off, messages wait until `deliver()`
 * is called on the receiving end, so tests decide exactly when they arrive.
 */
export class MemoryTransport implements Transport {
  readonly name = 'memory';
  private readonly rooms = new Map<string, HostRoom>();
  /** The guest-side ends of every link made, for tests to deliver by hand. */
  readonly guestEnds: MemoryLink[] = [];
  readonly hostEnds: MemoryLink[] = [];

  constructor(private readonly auto = true) {}

  async host(): Promise<HostRoom> {
    const code = randomCode();
    const room: HostRoom = {
      code,
      onJoin: () => {},
      onError: () => {},
      close: () => this.rooms.delete(code),
    };
    this.rooms.set(code, room);
    return room;
  }

  async join(code: string): Promise<Link> {
    const room = this.rooms.get(code);
    if (!room) throw new Error('No game with that code.');
    const a = new MemoryLink(this.auto);
    const b = new MemoryLink(this.auto);
    a.other = b;
    b.other = a;
    this.guestEnds.push(a);
    this.hostEnds.push(b);
    room.onJoin(b);
    return a;
  }
}

export type { MemoryLink };

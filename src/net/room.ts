import { MAX_PLAYERS, type ScareLevel, type SimConfig } from '../core/config';
import { type KVStore, MemoryStore, Persistence, SAVE_KEY } from '../core/persistence';
import { Sim } from '../core/sim';
import { ClientSession } from './client';
import { type GuestSeat, HostSession } from './host';
import { type LobbyState, NET_VERSION, type ToGuest, type ToHost } from './protocol';
import type { HostRoom, Link } from './transport';

interface Guest {
  id: number;
  link: Link;
  name: string;
  /** Their seat in the run under way, if they are in it. */
  seat: number | null;
}

export function cleanName(s: unknown): string {
  return String(s ?? '')
    .replace(/[\u0000-\u001f<>]/g, '')
    .trim()
    .slice(0, 20);
}

/**
 * The host's side of a room: who is here, the run's options, and starting runs. Everyone
 * stays connected between runs; a run ends, the room remains.
 */
export class NetHost {
  readonly guests: Guest[] = [];
  session: HostSession | null = null;
  scares: ScareLevel;
  story: boolean;
  /** Someone arrived or left, or an option changed. */
  onChange: () => void = () => {};
  /** The run is over and everyone is back in the room. */
  onLobby: () => void = () => {};
  /** The room itself broke (lost the signalling server). */
  onError: (reason: string) => void = () => {};
  private nextId = 1;
  private closed = false;

  constructor(
    readonly room: HostRoom,
    readonly name: string,
    private readonly store: KVStore,
    opts: { scares: ScareLevel; story: boolean },
  ) {
    this.scares = opts.scares;
    this.story = opts.story;
    room.onJoin = (link) => this.arrive(link);
    room.onError = (r) => this.onError(r);
  }

  get code(): string {
    return this.room.code;
  }

  /** A run is under way. */
  get running(): boolean {
    return this.session !== null && this.session.sim.phase === 'playing';
  }

  private arrive(link: Link): void {
    const g: Guest = { id: this.nextId++, link, name: '', seat: null };
    let greeted = false;
    link.onMessage = (raw) => {
      const m = raw as ToHost;
      if (!m || typeof m !== 'object') return;
      if (!greeted) {
        if (m.t !== 'hello') return;
        if (m.v !== NET_VERSION) {
          link.send({ t: 'reject', reason: 'You and the host have different versions of the game. Both of you reload the page.' } satisfies ToGuest);
          link.close();
          return;
        }
        if (this.guests.length >= MAX_PLAYERS - 1) {
          link.send({ t: 'reject', reason: 'The building is full: four is the most it takes.' } satisfies ToGuest);
          link.close();
          return;
        }
        greeted = true;
        g.name = cleanName(m.name) || `Guest ${g.id}`;
        this.guests.push(g);
        link.send({ t: 'welcome', you: g.id, lobby: this.lobby() } satisfies ToGuest);
        this.broadcastLobby();
        this.onChange();
        return;
      }
      if (m.t === 'bye') {
        link.close();
        this.drop(g);
        return;
      }
      if (this.session && g.seat !== null) this.session.receive(g.seat, m);
    };
    link.onClose = () => this.drop(g);
  }

  private drop(g: Guest): void {
    const i = this.guests.indexOf(g);
    if (i < 0) return;
    this.guests.splice(i, 1);
    if (this.session && g.seat !== null) this.session.leave(g.seat);
    this.broadcastLobby();
    this.onChange();
  }

  lobby(): LobbyState {
    return {
      players: [{ seat: 0, name: this.name, host: true }, ...this.guests.map((g, i) => ({ seat: i + 1, name: g.name, host: false }))],
      scares: this.scares,
      story: this.story,
      running: this.running,
    };
  }

  broadcastLobby(): void {
    for (const g of this.guests) g.link.send({ t: 'lobby', you: g.id, lobby: this.lobby() } satisfies ToGuest);
  }

  setOptions(o: Partial<{ scares: ScareLevel; story: boolean }>): void {
    if (o.scares) this.scares = o.scares;
    if (o.story !== undefined) this.story = o.story;
    this.broadcastLobby();
  }

  /**
   * Everyone in. Each guest builds the same run from the same seed and the same save the
   * host's copy starts from (taken before the host's copy writes to it), so every building
   * matches from the first step; after that the host's snapshots keep them matching.
   */
  start(config: SimConfig): HostSession {
    this.session?.dispose();
    const save = this.store.get(SAVE_KEY) ?? JSON.stringify(new Persistence(new MemoryStore()).data);
    const seats: GuestSeat[] = this.guests.map((g, i) => ({ seat: i + 1, name: g.name, link: g.link }));
    this.guests.forEach((g, i) => (g.seat = i + 1));
    const cfg: SimConfig = { ...config, players: 1 + seats.length, scares: this.scares, story: this.story };
    for (const s of seats) s.link.send({ t: 'start', seat: s.seat, config: cfg, save } satisfies ToGuest);
    const sim = new Sim(cfg, this.store);
    this.session = new HostSession(sim, seats, () => this.backToLobby());
    this.broadcastLobby();
    return this.session;
  }

  backToLobby(): void {
    this.session?.dispose();
    this.session = null;
    for (const g of this.guests) g.seat = null;
    this.broadcastLobby();
    this.onLobby();
  }

  close(reason = 'The host closed the room.'): void {
    if (this.closed) return;
    this.closed = true;
    for (const g of this.guests) {
      g.link.send({ t: 'closed', reason } satisfies ToGuest);
      g.link.close();
    }
    this.guests.length = 0;
    this.session?.dispose();
    this.session = null;
    this.room.close();
  }
}

/** A guest's side of a room. */
export class NetGuest {
  lobby: LobbyState | null = null;
  /** Your id in the room (not your seat in a run). */
  you = 0;
  session: ClientSession | null = null;
  /** The room changed (someone came or went, the host changed an option). */
  onLobby: () => void = () => {};
  /** You came back to the room from a finished run. */
  onReturn: () => void = () => {};
  onStart: (s: ClientSession) => void = () => {};
  onClosed: (reason: string) => void = () => {};
  /** The run you were in has ended (to keep the pages you found). */
  onRunEnded: (sim: Sim) => void = () => {};
  private closed = false;

  constructor(
    readonly link: Link,
    name: string,
  ) {
    link.onMessage = (raw) => this.receive(raw as ToGuest);
    link.onClose = () => this.lost('The connection to the host was lost.');
    link.send({ t: 'hello', v: NET_VERSION, name: cleanName(name) } satisfies ToHost);
  }

  private receive(m: ToGuest): void {
    if (!m || typeof m !== 'object' || this.closed) return;
    switch (m.t) {
      case 'welcome':
      case 'lobby':
        this.lobby = m.lobby;
        this.you = m.you;
        this.onLobby();
        break;
      case 'reject':
        this.lost(m.reason);
        break;
      case 'start': {
        const store = new MemoryStore();
        store.set(SAVE_KEY, m.save);
        const sim = new Sim(m.config, store);
        this.session?.dispose();
        const s = new ClientSession(sim, m.seat, this.link, () => this.backToLobby());
        s.onEnded = (ended) => this.onRunEnded(ended);
        this.session = s;
        this.onStart(s);
        break;
      }
      case 'snap':
        this.session?.receive(m.s);
        break;
      case 'closed':
        this.lost(m.reason);
        break;
    }
  }

  backToLobby(): void {
    this.session?.dispose();
    this.session = null;
    this.onReturn();
  }

  private lost(reason: string): void {
    if (this.closed) return;
    this.closed = true;
    this.session?.dispose();
    this.link.close();
    this.onClosed(reason);
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.link.send({ t: 'bye' } satisfies ToHost);
    this.session?.dispose();
    this.link.close();
  }
}

/** Keep the case-file pages you found in someone else's building. */
export function keepPages(store: KVStore, from: Sim): void {
  const mine = new Persistence(store);
  const found = mine.data.story.found;
  let added = false;
  for (const id of from.memory.data.story.found) {
    if (!found.includes(id)) {
      found.push(id);
      added = true;
    }
  }
  if (added) mine.save();
}

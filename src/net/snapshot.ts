import type { Pose } from '../core/entity';
import type { Player } from '../core/player';
import type { Sim } from '../core/sim';
import type { GameEvent, HidingSpot, Item, Prop, ThermalMark } from '../core/types';
import type { Snap, TableDiff } from './protocol';

/**
 * Snapshots of a shared run. The host owns the simulation; a guest keeps a copy of it built
 * from the same seed and save (so the building, the items, the names and the case-file
 * pages are identical from the first step), and the host keeps that copy in step with what
 * changed since the last snapshot each guest received. The transports are reliable and in
 * order, so a change is sent once.
 *
 * Positions and headings travel separately, complete in every snapshot, because the guest
 * interpolates them.
 */

type Row = unknown[];

const r3 = (x: number) => Math.round(x * 1000) / 1000;
const r2 = (x: number) => Math.round(x * 100) / 100;
/** Look direction: fine enough that a guest's own camera never twitches when the host's word arrives. */
const r5 = (x: number) => Math.round(x * 1e5) / 1e5;
const bit = (v: boolean) => (v ? 1 : 0);

/** Lookups a guest's copy needs while applying rows. */
export class ApplyCtx {
  /** Where each door is going (the guest eases toward it between snapshots). */
  readonly doorTarget: number[] = [];
  lightingDirty = false;
  private spots: Map<number, HidingSpot> | null = null;

  constructor(
    readonly sim: Sim,
    readonly localId: number,
  ) {}

  spot(id: number): HidingSpot | null {
    if (id < 0) return null;
    if (!this.spots) this.spots = new Map(this.sim.world.spots.map((s) => [s.id, s]));
    return this.spots.get(id) ?? null;
  }

  item(id: number): Item | null {
    if (id < 0) return null;
    return this.sim.world.items.find((it) => it.id === id) ?? null;
  }
}

interface Table {
  rows(sim: Sim, seat: number): Row[];
  apply(ctx: ApplyCtx, i: number, row: Row): void;
  /** The table now has `n` rows. */
  size?(ctx: ApplyCtx, n: number): void;
  /** Rows differ per guest. */
  perSeat?: boolean;
}

// ------------------------------------------------------------------ players

const F_CROUCH = 1;
const F_SPRINT = 2;
const F_EXHAUSTED = 4;
const F_ALIVE = 8;
const F_ESCAPED = 16;
const F_WOUNDED = 32;
const F_HOLDING = 64;

function playerRow(p: Player): Row {
  const flags =
    (p.crouching ? F_CROUCH : 0) |
    (p.sprinting ? F_SPRINT : 0) |
    (p.exhausted ? F_EXHAUSTED : 0) |
    (p.alive ? F_ALIVE : 0) |
    (p.escaped ? F_ESCAPED : 0) |
    (p.wounded ? F_WOUNDED : 0) |
    (p.breath.holding ? F_HOLDING : 0);
  const tr = p.transition;
  const ch = p.channel;
  return [
    r3(p.vel.x),
    r3(p.vel.y),
    r2(p.speed),
    flags,
    r3(p.stamina),
    r3(p.exertion),
    r3(p.eye),
    r2(p.bob),
    p.hidden ? p.hidden.id : -1,
    r3(p.hideBase),
    r2(p.hiddenFor),
    tr ? tr.spot.id : -1,
    tr ? r3(tr.t) : 0,
    tr ? tr.dur : 0,
    tr && tr.entering ? 1 : 0,
    ch ? ch.kind : '',
    ch ? r3(ch.t) : 0,
    ch ? ch.dur : 0,
    bit(p.flashlight.on),
    r3(p.flashlight.battery),
    r2(p.flashlight.faultUntil),
    r2(p.breath.held),
    r2(p.breath.recover),
    r2(p.markedUntil),
    p.readingNote ?? -1,
    p.readingRecord ?? -1,
    r3(p.readingAt.x),
    r3(p.readingAt.y),
    r2(p.lastHurt),
    p.inv.batteries,
    p.inv.bottles,
    p.deathCause,
    r2(p.turnRate),
  ];
}

function applyPlayer(ctx: ApplyCtx, i: number, row: Row): void {
  const p = ctx.sim.players[i];
  if (!p) return;
  const n = row as number[];
  const s = row as string[];
  p.vel.x = n[0]!;
  p.vel.y = n[1]!;
  p.speed = n[2]!;
  const flags = n[3]!;
  p.crouching = (flags & F_CROUCH) !== 0;
  p.sprinting = (flags & F_SPRINT) !== 0;
  p.exhausted = (flags & F_EXHAUSTED) !== 0;
  p.alive = (flags & F_ALIVE) !== 0;
  p.escaped = (flags & F_ESCAPED) !== 0;
  p.wounded = (flags & F_WOUNDED) !== 0;
  p.breath.holding = (flags & F_HOLDING) !== 0;
  p.stamina = n[4]!;
  p.exertion = n[5]!;
  p.eye = n[6]!;
  p.bob = n[7]!;
  p.hidden = ctx.spot(n[8]!);
  p.hideBase = n[9]!;
  p.hiddenFor = n[10]!;
  const trSpot = ctx.spot(n[11]!);
  p.transition = trSpot ? { spot: trSpot, t: n[12]!, dur: n[13]!, entering: n[14] === 1 } : null;
  p.channel = s[15] ? ({ kind: s[15], t: n[16]!, dur: n[17]!, tick: 0 } as Player['channel']) : null;
  p.flashlight.on = n[18] === 1;
  p.flashlight.battery = n[19]!;
  p.flashlight.faultUntil = n[20]!;
  p.breath.held = n[21]!;
  p.breath.recover = n[22]!;
  p.markedUntil = n[23]!;
  p.readingNote = n[24]! >= 0 ? n[24]! : null;
  p.readingRecord = n[25]! >= 0 ? n[25]! : null;
  p.readingAt = { x: n[26]!, y: n[27]! };
  p.lastHurt = n[28]!;
  p.inv.batteries = n[29]!;
  p.inv.bottles = n[30]!;
  p.deathCause = s[31] ?? '';
  p.turnRate = n[32]!;
}

/** What a guest predicting their own body needs to know about it from the host. */
export interface BodyState {
  active: boolean;
  hidden: boolean;
  hideBase: number;
  hideKind: HidingSpot['kind'] | null;
  transition: boolean;
  channel: boolean;
  vel: { x: number; y: number };
  stamina: number;
  exhausted: boolean;
  exertion: number;
  crouching: boolean;
  wounded: boolean;
  torch: boolean;
}

export function bodyStateOf(row: Row, ctx: ApplyCtx): BodyState {
  const n = row as number[];
  const flags = n[3]!;
  const spot = ctx.spot(n[8]!);
  return {
    active: (flags & F_ALIVE) !== 0 && (flags & F_ESCAPED) === 0,
    hidden: spot !== null,
    hideBase: n[9]!,
    hideKind: spot ? spot.kind : null,
    transition: n[11]! >= 0,
    channel: (row[15] as string) !== '',
    vel: { x: n[0]!, y: n[1]! },
    stamina: n[4]!,
    exhausted: (flags & F_EXHAUSTED) !== 0,
    exertion: n[5]!,
    crouching: (flags & F_CROUCH) !== 0,
    wounded: (flags & F_WOUNDED) !== 0,
    torch: n[18] === 1,
  };
}

// ------------------------------------------------------------------ tables

export const TABLES: Record<string, Table> = {
  pl: {
    rows: (sim) => sim.players.map(playerRow),
    apply: applyPlayer,
  },
  en: {
    rows: (sim) => {
      const e = sim.entity;
      const s = e.state as unknown as Record<string, unknown>;
      const t = e.tell;
      return [
        [
          e.pose,
          r2(e.speedNow),
          e.state.kind,
          (s.spot as number | null | undefined) ?? null,
          (s.phase as string | undefined) ?? null,
          (s.player as number | undefined) ?? null,
          (s.survivor as number | null | undefined) ?? null,
          (s.victim as string | number | undefined) ?? null,
          e.disguise,
          t ? t.id : 0,
          t ? t.kind : '',
          t ? r2(t.t0) : 0,
          t ? r2(t.dur) : 0,
          t && t.fake ? 1 : 0,
          bit(e.moving),
          e.carryingBody,
          e.carrying ? e.carrying.id : -1,
          e.reason,
        ],
      ];
    },
    apply: (ctx, _i, row) => {
      const e = ctx.sim.entity;
      e.pose = row[0] as Pose;
      e.speedNow = row[1] as number;
      const st: Record<string, unknown> = { kind: row[2] };
      if (row[3] !== null) st.spot = row[3];
      if (row[4] !== null) st.phase = row[4];
      if (row[5] !== null) st.player = row[5];
      if (st.kind === 'chase' || st.kind === 'lunge') st.survivor = row[6];
      if (row[7] !== null) st.victim = row[7];
      e.state = st as unknown as typeof e.state;
      e.disguise = row[8] as number | null;
      e.tell = row[9] ? { id: row[9] as number, kind: row[10] as never, t0: row[11] as number, dur: row[12] as number, fake: row[13] === 1 } : null;
      e.moving = row[14] === 1;
      e.carryingBody = row[15] as number | null;
      e.carrying = ctx.item(row[16] as number);
      e.reason = row[17] as string;
    },
  },
  sv: {
    rows: (sim) => sim.survivors.list.map((sv) => [bit(sv.alive), sv.spot ? sv.spot.id : -1, bit(sv.waving), bit(sv.met), sv.attachment, sv.talkIndex, r2(sv.diedAt)]),
    apply: (ctx, i, row) => {
      const sv = ctx.sim.survivors.list[i];
      if (!sv) return;
      const n = row as number[];
      sv.alive = n[0] === 1;
      sv.spot = ctx.spot(n[1]!);
      sv.waving = n[2] === 1;
      sv.met = n[3] === 1;
      sv.attachment = n[4]!;
      sv.talkIndex = n[5]!;
      sv.diedAt = n[6]!;
    },
  },
  dr: {
    rows: (sim) => sim.world.doors.map((d) => [r3(d.open), d.target, bit(d.locked), bit(d.jammed), d.speed]),
    apply: (ctx, i, row) => {
      const d = ctx.sim.world.doors[i];
      if (!d) return;
      const n = row as number[];
      ctx.doorTarget[i] = n[0]!;
      d.target = n[1]!;
      d.locked = n[2] === 1;
      d.jammed = n[3] === 1;
      d.speed = n[4]!;
    },
  },
  sp: {
    rows: (sim) =>
      sim.world.spots.map((s) => [
        s.occupant ? (s.occupant.kind === 'player' ? 1 : 2) : 0,
        s.occupant ? (s.occupant.kind === 'player' ? (s.occupant.id ?? 0) : s.occupant.id) : -1,
        bit(s.ajar),
        bit(s.cluttered),
        bit(s.baited),
        s.body,
        r2(s.lastChecked),
      ]),
    apply: (ctx, i, row) => {
      const s = ctx.sim.world.spots[i];
      if (!s) return;
      const n = row as number[];
      s.occupant = n[0] === 1 ? { kind: 'player', id: n[1]! } : n[0] === 2 ? { kind: 'survivor', id: n[1]! } : null;
      s.ajar = n[2] === 1;
      s.cluttered = n[3] === 1;
      s.baited = n[4] === 1;
      s.body = row[5] as string | null;
      s.lastChecked = n[6]!;
    },
  },
  it: {
    rows: (sim) => sim.world.items.map((it) => [it.id, it.kind, r3(it.pos.x), r3(it.pos.y), it.state, bit(it.relocated), it.recordId ?? -1, it.noteId ?? -1]),
    apply: (ctx, i, row) => {
      const items = ctx.sim.world.items;
      const n = row as number[];
      let it = items[i];
      if (!it || it.id !== n[0]) {
        it = { id: n[0]!, kind: row[1] as Item['kind'], pos: { x: n[2]!, y: n[3]! }, origin: { x: n[2]!, y: n[3]! }, state: 'ground', relocated: false };
        items[i] = it;
      }
      it.pos.x = n[2]!;
      it.pos.y = n[3]!;
      it.state = row[4] as Item['state'];
      it.relocated = n[5] === 1;
      if (n[6]! >= 0) it.recordId = n[6]!;
      if (n[7]! >= 0) it.noteId = n[7]!;
    },
    size: (ctx, n) => {
      if (ctx.sim.world.items.length > n) ctx.sim.world.items.length = n;
    },
  },
  pr: {
    rows: (sim) => sim.world.props.map((p) => [p.id, p.kind, r3(p.pos.x), r3(p.pos.y), p.label, p.examine, p.color ?? null]),
    apply: (ctx, i, row) => {
      const props = ctx.sim.world.props;
      const n = row as number[];
      let p = props[i];
      if (!p || p.id !== n[0]) {
        p = { id: n[0]!, kind: row[1] as Prop['kind'], pos: { x: n[2]!, y: n[3]! }, label: row[4] as string, examine: row[5] as string };
        if (row[6]) p.color = row[6] as [number, number, number];
        props[i] = p;
      }
      p.pos.x = n[2]!;
      p.pos.y = n[3]!;
      p.label = row[4] as string;
      p.examine = row[5] as string;
    },
    size: (ctx, n) => {
      if (ctx.sim.world.props.length > n) ctx.sim.world.props.length = n;
    },
  },
  nt: {
    rows: (sim) => sim.world.notes.map((n) => [bit(n.read)]),
    apply: (ctx, i, row) => {
      const note = ctx.sim.world.notes[i];
      if (note) note.read = row[0] === 1;
    },
  },
  tp: {
    rows: (sim) => sim.world.taps.map((t) => [r2(t.running)]),
    apply: (ctx, i, row) => {
      const tap = ctx.sim.world.taps[i];
      if (tap) tap.running = row[0] as number;
    },
  },
  gt: {
    rows: (sim) => sim.world.gates.map((g) => [bit(g.open)]),
    apply: (ctx, i, row) => {
      const g = ctx.sim.world.gates[i];
      if (g) g.open = row[0] === 1;
    },
  },
  th: {
    rows: (sim) => sim.world.thermal.map((m) => [m.id, m.cell, r3(m.pos.x), r3(m.pos.y), r2(m.t), m.surface]),
    apply: (ctx, i, row) => {
      const n = row as number[];
      ctx.sim.world.thermal[i] = { id: n[0]!, cell: n[1]!, pos: { x: n[2]!, y: n[3]! }, t: n[4]!, surface: row[5] as ThermalMark['surface'] };
    },
    size: (ctx, n) => {
      ctx.sim.world.thermal.length = Math.min(ctx.sim.world.thermal.length, n);
    },
  },
  fg: {
    rows: (sim) => sim.world.fog.map((f) => [r3(f.pos.x), r3(f.pos.y), r2(f.t), r2(f.size), f.spot]),
    apply: (ctx, i, row) => {
      const n = row as number[];
      ctx.sim.world.fog[i] = { pos: { x: n[0]!, y: n[1]! }, t: n[2]!, size: n[3]!, spot: n[4]! };
    },
    size: (ctx, n) => {
      ctx.sim.world.fog.length = Math.min(ctx.sim.world.fog.length, n);
    },
  },
  pj: {
    rows: (sim) => sim.world.projectiles.map((p) => [r3(p.pos.x), r3(p.pos.y), r2(p.vel.x), r2(p.vel.y), r3(p.t)]),
    apply: (ctx, i, row) => {
      const n = row as number[];
      ctx.sim.world.projectiles[i] = { pos: { x: n[0]!, y: n[1]! }, vel: { x: n[2]!, y: n[3]! }, t: n[4]!, origin: { x: n[0]!, y: n[1]! } };
    },
    size: (ctx, n) => {
      ctx.sim.world.projectiles.length = Math.min(ctx.sim.world.projectiles.length, n);
    },
  },
  fx: {
    rows: (sim) => sim.world.lighting.fixtures.map((f) => [bit(f.broken), r2(f.flicker)]),
    apply: (ctx, i, row) => {
      const f = ctx.sim.world.lighting.fixtures[i];
      if (!f) return;
      const broken = row[0] === 1;
      if (broken !== f.broken) ctx.lightingDirty = true;
      f.broken = broken;
      f.flicker = row[1] as number;
    },
  },
  ca: {
    rows: (sim) => sim.objectives.calls.map((c) => [r2(c.t), c.gate, bit(c.fake), c.text]),
    apply: (ctx, i, row) => {
      ctx.sim.objectives.calls[i] = { t: row[0] as number, gate: row[1] as never, fake: row[2] === 1, text: row[3] as string };
    },
    size: (ctx, n) => {
      ctx.sim.objectives.calls.length = Math.min(ctx.sim.objectives.calls.length, n);
    },
  },
  /** What this guest's own panic is showing them [S]. */
  ph: {
    perSeat: true,
    rows: (sim, seat) => (sim.players[seat]?.perception.phantoms ?? []).map((p) => [p.id, r3(p.pos.x), r3(p.pos.y), r3(p.angle), p.pose, r2(p.born), r2(p.until)]),
    apply: (ctx, i, row) => {
      const pl = ctx.sim.players[ctx.localId];
      if (!pl) return;
      const n = row as number[];
      pl.perception.phantoms[i] = { id: n[0]!, pos: { x: n[1]!, y: n[2]! }, angle: n[3]!, pose: row[4] as 'idle', born: n[5]!, until: n[6]! };
    },
    size: (ctx, n) => {
      const pl = ctx.sim.players[ctx.localId];
      if (pl) pl.perception.phantoms.length = Math.min(pl.perception.phantoms.length, n);
    },
  },
};

const SHARED = Object.keys(TABLES).filter((k) => !TABLES[k]!.perSeat);
const PER_SEAT = Object.keys(TABLES).filter((k) => TABLES[k]!.perSeat);

// ------------------------------------------------------------------ motion

/** Positions and headings of everything that moves, in a fixed order. */
export function motionOf(sim: Sim): number[] {
  const e = sim.entity;
  const m = [r3(e.pos.x), r3(e.pos.y), r3(e.angle)];
  for (const p of sim.players) m.push(r3(p.pos.x), r3(p.pos.y), r5(p.angle), r5(p.pitch));
  for (const sv of sim.survivors.list) m.push(r3(sv.pos.x), r3(sv.pos.y));
  return m;
}

/** Offsets into the motion block. */
export const motionIndex = {
  entity: 0,
  player: (id: number) => 3 + id * 4,
  survivor: (sim: Sim, id: number) => 3 + sim.players.length * 4 + id * 2,
};

// ------------------------------------------------------------------ run-wide values

function globalsOf(sim: Sim): unknown[] {
  return [
    sim.phase,
    sim.focus.id,
    bit(sim.world.lighting.powered),
    bit(sim.objectives.powerOn),
    sim.objectives.rescueAt,
    bit(sim.objectives.arrived),
    r3(sim.director.floor),
    sim.team.fuses,
    [...sim.team.keys].join(','),
    sim.world.fusesRequired,
    sim.world.lockVersion,
  ];
}

function applyGlobals(ctx: ApplyCtx, g: unknown[]): void {
  const sim = ctx.sim;
  sim.phase = g[0] as Sim['phase'];
  sim.focus = sim.players[g[1] as number] ?? sim.focus;
  const powered = g[2] === 1;
  if (powered !== sim.world.lighting.powered) {
    sim.world.lighting.powered = powered;
    ctx.lightingDirty = true;
  }
  sim.objectives.powerOn = g[3] === 1;
  sim.objectives.rescueAt = g[4] as number | null;
  sim.objectives.arrived = g[5] === 1;
  sim.director.debt.floor = g[6] as number;
  sim.team.fuses = g[7] as number;
  sim.team.keys.clear();
  for (const k of String(g[8]).split(',')) if (k) sim.team.keys.add(k);
  sim.world.fusesRequired = g[9] as number;
  sim.world.lockVersion = g[10] as number;
}

function memoryOf(sim: Sim): { found: number[]; journal: string[]; names: string[] } {
  const d = sim.memory.data;
  return { found: [...d.story.found], journal: [...d.journal], names: [...d.story.names] };
}

// ------------------------------------------------------------------ host side

/** One capture of the run, shared by every guest's snapshot this tick. */
export interface Frame {
  t: number;
  m: number[];
  rows: Record<string, Row[]>;
  keys: Record<string, string[]>;
  g: unknown[];
  gKey: string;
  mem: { found: number[]; journal: string[]; names: string[] };
  memKey: string;
}

interface SeatMemory {
  rows: Map<string, string[]>;
  g: string;
  mem: string;
}

export class SnapshotWriter {
  private readonly seats = new Map<number, SeatMemory>();
  private k = 0;

  constructor(private readonly sim: Sim) {}

  capture(): Frame {
    const sim = this.sim;
    const rows: Record<string, Row[]> = {};
    const keys: Record<string, string[]> = {};
    for (const name of SHARED) {
      const r = TABLES[name]!.rows(sim, 0);
      rows[name] = r;
      keys[name] = r.map((x) => JSON.stringify(x));
    }
    const g = globalsOf(sim);
    const mem = memoryOf(sim);
    return { t: sim.time, m: motionOf(sim), rows, keys, g, gKey: JSON.stringify(g), mem, memKey: JSON.stringify(mem) };
  }

  /** The snapshot for one guest: only what changed since their last one. */
  snapshotFor(f: Frame, seat: number, ack: number, events: GameEvent[]): Snap {
    let mine = this.seats.get(seat);
    if (!mine) {
      mine = { rows: new Map(), g: '', mem: '' };
      this.seats.set(seat, mine);
    }
    const tb: Record<string, TableDiff> = {};
    const diff = (name: string, rows: Row[], keys: string[]) => {
      const last = mine.rows.get(name) ?? [];
      const changed: unknown[][] = [];
      for (let i = 0; i < rows.length; i++) if (keys[i] !== last[i]) changed.push([i, ...rows[i]!]);
      if (changed.length || last.length !== rows.length) tb[name] = { n: rows.length, r: changed };
      mine.rows.set(name, keys);
    };
    for (const name of SHARED) diff(name, f.rows[name]!, f.keys[name]!);
    for (const name of PER_SEAT) {
      const rows = TABLES[name]!.rows(this.sim, seat);
      diff(name, rows, rows.map((x) => JSON.stringify(x)));
    }
    const snap: Snap = { k: ++this.k, t: r3(f.t), ack, m: f.m, tb };
    if (mine.g !== f.gKey) {
      snap.g = f.g;
      mine.g = f.gKey;
    }
    if (mine.mem !== f.memKey) {
      snap.mem = f.mem;
      mine.mem = f.memKey;
    }
    if (events.length) snap.ev = events;
    return snap;
  }

  /** Start this seat over from a full snapshot (someone new in the seat). */
  forget(seat: number): void {
    this.seats.delete(seat);
  }
}

// ------------------------------------------------------------------ guest side

/** Write a snapshot's changes into a guest's copy of the run. */
export function applySnapshot(ctx: ApplyCtx, snap: Snap): void {
  const sim = ctx.sim;
  for (const name in snap.tb) {
    const table = TABLES[name];
    const d = snap.tb[name]!;
    if (!table) continue;
    for (const r of d.r) table.apply(ctx, r[0] as number, r.slice(1));
    table.size?.(ctx, d.n);
  }
  if (snap.g) applyGlobals(ctx, snap.g);
  if (snap.mem) {
    const data = sim.memory.data;
    data.story.found = [...snap.mem.found];
    data.story.names = [...snap.mem.names];
    data.journal = [...snap.mem.journal];
  }
  if (ctx.lightingDirty) {
    sim.world.lighting.recompute();
    ctx.lightingDirty = false;
  }
}

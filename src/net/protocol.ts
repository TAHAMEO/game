import type { ScareLevel, SimConfig } from '../core/config';
import type { InputState } from '../core/input';
import type { GameEvent } from '../core/types';

/** Bumped whenever the wire format or the simulation changes in a way that breaks a shared run. */
export const NET_VERSION = 1;

/** Host steps between snapshots: 60 Hz simulation, 20 Hz snapshots. */
export const SNAP_EVERY = 3;

/** One fixed step of a guest's input: [seq, forward, strafe, turn, pitch, bits]. */
export type NetInput = [number, number, number, number, number, number];

const B_SPRINT = 1;
const B_CROUCH = 2;
const B_INTERACT = 4;
const B_BREATH = 8;
const B_INTERACT_P = 16;
const B_TORCH_P = 32;
const B_THROW_P = 64;

const q = (x: number, k = 1e5) => Math.round(x * k) / k;

export function packInput(seq: number, s: InputState): NetInput {
  const bits =
    (s.sprint ? B_SPRINT : 0) |
    (s.crouch ? B_CROUCH : 0) |
    (s.interact ? B_INTERACT : 0) |
    (s.holdBreath ? B_BREATH : 0) |
    (s.interactPressed ? B_INTERACT_P : 0) |
    (s.flashlightPressed ? B_TORCH_P : 0) |
    (s.throwPressed ? B_THROW_P : 0);
  return [seq, q(s.forward, 1e3), q(s.strafe, 1e3), q(s.turn), q(s.pitch ?? 0), bits];
}

export function unpackInput(n: NetInput): InputState & { seq: number } {
  const [seq, forward, strafe, turn, pitch, bits] = n;
  const clampAxis = (v: number) => (Number.isFinite(v) ? Math.max(-1, Math.min(1, v)) : 0);
  const clampLook = (v: number) => (Number.isFinite(v) ? Math.max(-1.5, Math.min(1.5, v)) : 0);
  return {
    seq,
    forward: clampAxis(forward),
    strafe: clampAxis(strafe),
    turn: clampLook(turn),
    pitch: clampLook(pitch),
    sprint: (bits & B_SPRINT) !== 0,
    crouch: (bits & B_CROUCH) !== 0,
    interact: (bits & B_INTERACT) !== 0,
    holdBreath: (bits & B_BREATH) !== 0,
    interactPressed: (bits & B_INTERACT_P) !== 0,
    flashlightPressed: (bits & B_TORCH_P) !== 0,
    throwPressed: (bits & B_THROW_P) !== 0,
  };
}

export interface LobbyPlayer {
  seat: number;
  name: string;
  host: boolean;
}

export interface LobbyState {
  players: LobbyPlayer[];
  scares: ScareLevel;
  story: boolean;
  /** A run is under way (people who join now wait for the next one). */
  running: boolean;
}

/** A table of rows, sent as the rows that changed since the last snapshot this guest got. */
export interface TableDiff {
  /** Row count now. */
  n: number;
  /** Changed rows: [index, ...values]. */
  r: unknown[][];
}

export interface Snap {
  /** Snapshot number. */
  k: number;
  /** Host simulation time. */
  t: number;
  /** The last input of yours the host has applied. */
  ack: number;
  /** Positions and headings, always complete (they are what gets interpolated). */
  m: number[];
  /** Everything else, as changes. */
  tb: Record<string, TableDiff>;
  /** Run-wide values, when any changed. */
  g?: unknown[];
  /** The building's memory, when it changed (pages found, the notebook). */
  mem?: { found: number[]; journal: string[]; names: string[] };
  /** Presentation events since the last snapshot. */
  ev?: GameEvent[];
}

export type ToHost =
  | { t: 'hello'; v: number; name: string }
  | { t: 'in'; i: NetInput[] }
  | { t: 'forfeit' }
  | { t: 'bye' };

export type ToGuest =
  | { t: 'welcome'; you: number; lobby: LobbyState }
  | { t: 'reject'; reason: string }
  | { t: 'lobby'; you: number; lobby: LobbyState }
  | { t: 'start'; seat: number; config: SimConfig; save: string }
  | { t: 'snap'; s: Snap }
  | { t: 'closed'; reason: string };

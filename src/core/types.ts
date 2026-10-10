import type { Vec2 } from './math';

export type SoundKind =
  | 'step'
  | 'entityStep'
  | 'door'
  | 'doorBash'
  | 'locker'
  | 'glass'
  | 'whoosh'
  | 'gasp'
  | 'exhale'
  | 'breath'
  | 'tap'
  | 'breaker'
  | 'radio'
  | 'rattle'
  | 'click'
  | 'knock'
  | 'tilt'
  | 'inhale'
  | 'sigh'
  | 'snap'
  | 'cough'
  | 'voice'
  | 'lightPop'
  | 'pickup'
  | 'drag'
  | 'hum'
  | 'gate'
  | 'scream'
  | 'thud'
  | 'whisper'
  | 'thunder';

export type NoiseSource = 'player' | 'entity' | 'survivor' | 'world';

/** A real, physical sound in the world. The Entity can hear these. */
export interface Noise {
  id: number;
  kind: SoundKind;
  pos: Vec2;
  cell: number;
  loudness: number;
  source: NoiseSource;
  t: number;
  /** Where a thrown bottle left the hand. Lets the Entity learn to trace throws [Y]. */
  origin?: Vec2;
  /** Survivor index for voices / coughs. */
  speaker?: number;
  /** The player who made it (player sounds only). */
  player?: number;
  /** Loudness as it arrived at each listener when emitted (filled by the sim). */
  entityLevel?: number;
  /** At the Director's focus player (the one most of the Director's reads are about). */
  playerLevel?: number;
  /** At every player, by player id. */
  playerLevels?: number[];
  survivorLevels?: number[];
}

export interface VoiceSig {
  pitch: number;
  rate: number;
}

/** Jump scares the Director can stage for one player [scares.ts]. */
export type ScareKind = 'lunge' | 'flicker' | 'behind' | 'window' | 'drop' | 'locker' | 'whisper' | 'kill';

/** Story beats delivered to one player [story.ts]. */
export type StoryBeat =
  | { kind: 'vision'; id: string; zone: string; lines: string[]; duration: number }
  | { kind: 'whisper'; text: string }
  | { kind: 'record'; id: number; title: string };

/**
 * What the presentation layer consumes. `phantom` sounds are produced by the player's
 * own panic [S] — the audio engine plays them exactly like real ones; the flag exists
 * only for the designer overlay.
 *
 * `to` names the one player an event is for. Events without it are for everyone. The
 * single-player game has one player (id 0); in a shared run the host routes each event
 * to the client that owns that player.
 */
export type GameEvent = (
  | {
      type: 'sound';
      kind: SoundKind;
      pos: Vec2;
      /** 0..1 loudness at the listener after propagation/occlusion. */
      volume: number;
      /** World-space direction the sound appears to come from. */
      dir: number;
      phantom: boolean;
      source: NoiseSource | 'phantom';
      speaker?: number;
      /** The player who made it, for player sounds. */
      player?: number;
    }
  | {
      type: 'subtitle';
      speaker: string;
      text: string;
      duration: number;
      voice?: VoiceSig;
      radio?: boolean;
      /** For the designer overlay only: was this the Entity wearing a voice? */
      mimic?: boolean;
      volume?: number;
      dir?: number;
    }
  | { type: 'notice'; text: string; duration: number }
  | { type: 'shake'; amount: number }
  | { type: 'power'; on: boolean }
  | { type: 'scare'; kind: ScareKind; intensity: number; pos?: Vec2; phantom: boolean }
  | { type: 'story'; beat: StoryBeat }
  | { type: 'lightning'; strength: number }
  | { type: 'death'; cause: string; player: number }
  | { type: 'escape'; player: number }
  | { type: 'runEnd'; outcome: 'dead' | 'escaped' }
) & { to?: number };

export type ItemKind = 'fuse' | 'key' | 'battery' | 'bottle' | 'note' | 'record';

export interface Item {
  id: number;
  kind: ItemKind;
  pos: Vec2;
  /** Where level logic originally put it. */
  origin: Vec2;
  state: 'ground' | 'taken' | 'entity';
  /** Moved by the Entity to a trap [T]. */
  relocated: boolean;
  noteId?: number;
  /** Case-file page index [story.ts]. */
  recordId?: number;
}

export interface Note {
  id: number;
  title: string;
  text: string;
  /** Planted by level logic and points nowhere [U]. */
  falseLead: boolean;
  /** Zone the note sends you to. */
  pointsToZone: number | null;
  read: boolean;
}

export type HideKind = 'locker' | 'drawer' | 'bed';

/** Who is in a hiding place. A player occupant without an id is player 0. */
export type Occupant = { kind: 'player'; id?: number } | { kind: 'survivor'; id: number };

export const occupantPlayer = (o: Occupant | null): number | null => (o?.kind === 'player' ? (o.id ?? 0) : null);

export interface HidingSpot {
  id: number;
  kind: HideKind;
  /** Locker/drawer wall cell, or bed cell. */
  cell: number;
  /** Floor cell you enter from. */
  access: number;
  occupant: Occupant | null;
  /** Locker left conspicuously ajar [T: offered safety]. */
  ajar: boolean;
  /** Junk under the bed — can't hide here unless something clears it [T]. */
  cluttered: boolean;
  /** The Entity prepared this spot and intends to check it [T]. */
  baited: boolean;
  /** Something is already in here: your previous body [W]. */
  body: string | null;
  lastChecked: number;
}

export interface DoorState {
  index: number;
  cell: number;
  axis: 'x' | 'y';
  sides: [number, number];
  /** 0 closed .. 1 open (animated). */
  open: number;
  target: number;
  lock: 'maintenance' | 'sealed' | 'pharmacy' | null;
  locked: boolean;
  /** Barricaded by the Entity to dismantle a safe route [Y]. */
  jammed: boolean;
  /** Seconds the door takes to move; quiet opening is slow. */
  speed: number;
}

export interface Tap {
  id: number;
  cell: number;
  access: number;
  running: number;
}

export interface Vent {
  id: number;
  cell: number;
  access: number;
}

export interface Gate {
  id: 'bay' | 'garden';
  cell: number;
  access: number;
  label: string;
  open: boolean;
}

/** Heat left on a surface you touched [V]. */
export interface ThermalMark {
  id: number;
  cell: number;
  pos: Vec2;
  t: number;
  surface: 'door' | 'locker' | 'drawer' | 'bed' | 'tap' | 'fusebox' | 'radio' | 'gate' | 'vent';
}

/** A visible puff of breath in a cold zone [V]. */
export interface FogPuff {
  pos: Vec2;
  t: number;
  size: number;
  /** Hiding spot it leaked from, or -1. */
  spot: number;
}

export interface Projectile {
  pos: Vec2;
  vel: Vec2;
  t: number;
  origin: Vec2;
  /** Who threw it. */
  player?: number;
}

/** Nest dressing and other persistent props [W]. */
export interface Prop {
  id: number;
  kind: 'trophy' | 'remains' | 'survivorBody' | 'sign' | 'debris';
  pos: Vec2;
  label: string;
  examine: string;
  color?: [number, number, number];
}

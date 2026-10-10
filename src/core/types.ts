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
  | 'scream';

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
  /** Loudness as it arrived at each listener when emitted (filled by the sim). */
  entityLevel?: number;
  playerLevel?: number;
  survivorLevels?: number[];
}

export interface VoiceSig {
  pitch: number;
  rate: number;
}

/**
 * What the presentation layer consumes. `phantom` sounds are produced by the player's
 * own panic [S] — the audio engine plays them exactly like real ones; the flag exists
 * only for the designer overlay.
 */
export type GameEvent =
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
  | { type: 'death'; cause: string }
  | { type: 'escape' };

export type ItemKind = 'fuse' | 'key' | 'battery' | 'bottle' | 'note';

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

export type Occupant = { kind: 'player' } | { kind: 'survivor'; id: number };

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

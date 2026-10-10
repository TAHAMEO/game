import { BODY } from '../core/config';

/** World units are map cells (about 1.6 m). Heights come from the simulation's body table. */
export const WALL_H = BODY.wallHeight;
export const DOOR_H = 1.36;
/** A wall texture covers this many units in each direction (keeps the dado line at one height everywhere). */
export const WALL_TEX_SPAN = 2;
export const FLOOR_TEX_SPAN = 2;

export const eyeHeight = BODY.eyeHeight;

/** Exterior zones have sky instead of a ceiling. */
export const EXTERIOR_ZONES = new Set(['c', 'a']);

export interface ZoneLook {
  wall: string;
  floor: string;
  ceil: string | null;
  /** Tint applied to the wall texture (lets one recipe serve several wings). */
  wallTint?: [number, number, number];
  floorTint?: [number, number, number];
}

export const ZONE_LOOK: Record<string, ZoneLook> = {
  n: { wall: 'nest', floor: 'nestfloor', ceil: 'concrete' },
  o: { wall: 'wallpaper', floor: 'boards', ceil: 'ceiltile' },
  u: { wall: 'tile', floor: 'tilefloor', ceil: 'ceiltile' },
  h: { wall: 'plaster', floor: 'terrazzo', ceil: 'ceiltile', wallTint: [1.0, 0.98, 0.94] },
  s: { wall: 'plaster', floor: 'lino', ceil: 'ceiltile', wallTint: [1.04, 0.98, 0.88] },
  r: { wall: 'panel', floor: 'terrazzo', ceil: 'ceiltile' },
  w: { wall: 'plaster', floor: 'lino', ceil: 'ceiltile' },
  e: { wall: 'plaster', floor: 'lino', ceil: 'ceiltile', wallTint: [0.95, 0.99, 1.05] },
  c: { wall: 'brick', floor: 'grass', ceil: null },
  a: { wall: 'brick', floor: 'asphalt', ceil: null },
  m: { wall: 'block', floor: 'concrete', ceil: 'concrete' },
  g: { wall: 'tile', floor: 'tilefloor', ceil: 'concrete', wallTint: [0.9, 0.95, 0.98] },
};

export const DEFAULT_LOOK: ZoneLook = ZONE_LOOK.h!;

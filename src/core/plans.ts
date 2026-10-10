import type { Vec2 } from './math';

export type MoveMode = 'stalk' | 'roam' | 'investigate' | 'hunt' | 'chase';

/**
 * The Entity doesn't only react — it sets the board [T]. Every proactive behaviour
 * (bait, ambushes, corrupted objectives, mimicry, dismantling) is expressed as a plan:
 * a short list of physical steps the Entity must actually walk to and perform. Nothing
 * teleports; a player who sees it working can learn from it.
 */
export type PlanStep =
  | { op: 'goto'; cell: number; mode: MoveMode }
  /** Bang on the ductwork so the sound comes out of a grate somewhere else [T: herding]. */
  | { op: 'knock'; vent: number }
  | { op: 'pickup'; item: number }
  | { op: 'drop'; cell: number }
  /** Leave a locker conspicuously open [T: offered safety]. */
  | { op: 'ajar'; spot: number }
  /** Clear the junk from under a bed [T: offered safety]. */
  | { op: 'clear'; spot: number }
  | { op: 'killLight'; fixture: number }
  /** Barricade a door on your safe route [Y: strategy dismantling]. */
  | { op: 'jam'; door: number }
  | { op: 'ambush'; cell: number; facing: number; duration: number; watch: Vec2; radius: number }
  /** Wear a survivor: their shape at distance, their voice [X]. */
  | { op: 'mimic'; survivor: number; cell: number; duration: number }
  | { op: 'wait'; duration: number };

export type PlanKind =
  | 'herd'
  | 'relocate'
  | 'offer'
  | 'funnel'
  | 'jam'
  | 'routeAmbush'
  | 'breakerAmbush'
  | 'radioAmbush'
  | 'tapWatch'
  | 'mimic';

/** done: every step performed · sprung: the trap caught you in it · interrupted: something else came up · aborted: impossible. */
export type PlanOutcome = 'done' | 'sprung' | 'interrupted' | 'aborted';

export interface Plan {
  id: number;
  kind: PlanKind;
  /** Brief section that motivated it, for the designer overlay. */
  section: 'T' | 'U' | 'V' | 'X' | 'Y';
  steps: PlanStep[];
  reason: string;
  created: number;
}

/**
 * Feature flags map 1:1 onto the build brief's sections so a designer can switch
 * any layer off and feel what it contributes. Nothing here is a difficulty slider:
 * the Entity is a system, and these decide which parts of the system exist.
 */
export interface Features {
  // S. Unreliable senses
  perceptualNoise: boolean;
  flashlightTax: boolean;
  // T. Bait economy
  herding: boolean;
  objectRelocation: boolean;
  offeredSafety: boolean;
  darknessFunnels: boolean;
  // U. Corrupted objectives
  rescueMimicry: boolean;
  breakerAmbush: boolean;
  falseLeads: boolean;
  // V. Scent, heat & the mark
  thermalResidue: boolean;
  breathFog: boolean;
  theMark: boolean;
  // W. The nest
  nestTrophies: boolean;
  ownRemains: boolean;
  // X. False company
  survivors: boolean;
  mimicSurvivors: boolean;
  // Y. The learned tell / meta-adaptation
  fakedTells: boolean;
  strategyDismantling: boolean;
  movingGoalposts: boolean;
  // Z. The debt
  risingFloor: boolean;
}

export type FeatureKey = keyof Features;

export const FEATURE_SECTIONS: ReadonlyArray<{ section: string; title: string; keys: FeatureKey[] }> = [
  { section: 'S', title: 'Unreliable senses', keys: ['perceptualNoise', 'flashlightTax'] },
  { section: 'T', title: 'Bait economy', keys: ['herding', 'objectRelocation', 'offeredSafety', 'darknessFunnels'] },
  { section: 'U', title: 'Corrupted objectives', keys: ['rescueMimicry', 'breakerAmbush', 'falseLeads'] },
  { section: 'V', title: 'Scent, heat & the mark', keys: ['thermalResidue', 'breathFog', 'theMark'] },
  { section: 'W', title: 'The nest', keys: ['nestTrophies', 'ownRemains'] },
  { section: 'X', title: 'False company', keys: ['survivors', 'mimicSurvivors'] },
  { section: 'Y', title: 'Learned tell', keys: ['fakedTells', 'strategyDismantling', 'movingGoalposts'] },
  { section: 'Z', title: 'The debt', keys: ['risingFloor'] },
];

const all = (on: boolean): Features => ({
  perceptualNoise: on,
  flashlightTax: on,
  herding: on,
  objectRelocation: on,
  offeredSafety: on,
  darknessFunnels: on,
  rescueMimicry: on,
  breakerAmbush: on,
  falseLeads: on,
  thermalResidue: on,
  breathFog: on,
  theMark: on,
  nestTrophies: on,
  ownRemains: on,
  survivors: on,
  mimicSurvivors: on,
  fakedTells: on,
  strategyDismantling: on,
  movingGoalposts: on,
  risingFloor: on,
});

/**
 * Presets mirror the brief's scope notes.
 *  - core:  only the first three prototype systems (Entity senses, Director, hiding).
 *  - mvp:   "MVP-safe now" — S, T, V (heat + mark), Y, Z.
 *  - full:  every section; U/W/X still unlock through Entity Knowledge tiers.
 */
export const PRESETS: Readonly<Record<'core' | 'mvp' | 'full', Features>> = {
  core: all(false),
  mvp: {
    ...all(false),
    perceptualNoise: true,
    flashlightTax: true,
    herding: true,
    objectRelocation: true,
    offeredSafety: true,
    darknessFunnels: true,
    thermalResidue: true,
    theMark: true,
    fakedTells: true,
    strategyDismantling: true,
    movingGoalposts: true,
    risingFloor: true,
  },
  full: all(true),
};

export type PresetName = keyof typeof PRESETS;

/** How often the Director may stage a jump scare [scares.ts]. */
export type ScareLevel = 'off' | 'normal' | 'intense';

export interface SimConfig {
  seed: number;
  features: Features;
  /** Designer override for the persisted Entity Knowledge tier (null = use the save). */
  tierOverride: number | null;
  /** How many people go in together. 1 is the single-player game. */
  players: number;
  /** Jump scares staged by the Director. */
  scares: ScareLevel;
  /** The story layer: case files, visions, whispers [story.ts]. */
  story: boolean;
}

export function defaultConfig(seed = Date.now() >>> 0): SimConfig {
  return { seed, features: { ...PRESETS.full }, tierOverride: null, players: 1, scares: 'normal', story: true };
}

/** Most people a shared run supports. */
export const MAX_PLAYERS = 4;

/**
 * Vertical proportions, in cells (one cell is about 1.6 m). The simulation is flat; these
 * only matter where something is aimed up or down — a torch at a face — and to the renderer.
 */
export const BODY = {
  wallHeight: 1.75,
  /** Eye height for a `Player.eye` stance value (0.5 standing, 0.33 crouched, 0.1 under a bed). */
  eyeHeight: (eye: number): number => 0.2 + (eye - 0.1) * 2.2,
  entityHeight: 1.95,
  /** Where its chest starts: a beam above this is "in its face". */
  entityChest: 1.0,
} as const;

/** Tuning that designers are expected to touch. Units: cells, seconds, "dB-ish" loudness. */
export const TUNING = {
  player: {
    radius: 0.24,
    walkSpeed: 2.1,
    crouchSpeed: 1.05,
    sprintSpeed: 3.7,
    staminaDrain: 0.17,
    staminaRegen: 0.12,
    breathCapacity: 8.5,
    flashlightDrainPerSec: 1 / 480,
    batteryRecharge: 0.55,
    interactRange: 1.25,
  },
  entity: {
    radius: 0.3,
    roamSpeed: 1.25,
    investigateSpeed: 1.7,
    huntSpeed: 1.9,
    chaseSpeed: 3.2,
    stalkSpeed: 1.0,
    reach: 1.05,
    lungeWindup: 0.42,
    sightRange: 17,
    fovRoam: (115 * Math.PI) / 180,
    fovHunt: (160 * Math.PI) / 180,
    hearRoam: 15,
    hearHunt: 10,
    hearAmbush: 8,
  },
  sound: {
    falloffPerCell: 1.6,
    closedDoor: 14,
    openDoor: 2,
    furniture: 1.5,
  },
  loudness: {
    stepCrouch: 11,
    stepWalk: 27,
    stepSprint: 44,
    doorQuiet: 14,
    door: 30,
    doorBash: 52,
    lockerQuiet: 12,
    locker: 26,
    bottle: 62,
    throwWhoosh: 12,
    gasp: 46,
    breathCalm: 4,
    breathPanting: 15,
    tap: 34,
    breaker: 100,
    radio: 50,
    rattle: 30,
    flashlightClick: 9,
    entityStepStalk: 4,
    entityStepRoam: 21,
    entityStepHunt: 27,
    entityStepChase: 40,
    ventKnock: 58,
    survivorCough: 26,
    survivorCall: 48,
  },
} as const;

/**
 * K-lite. Permadeath with persistence: every run is a new character, but the Entity
 * keeps what it learned about you, and the nest keeps what it took [W].
 */

export type TellKindKey = 'tilt' | 'inhale' | 'turn';

export interface TellStat {
  /** Times you could perceive this tell. */
  seen: number;
  /** Times you reacted to it the "correct" way. */
  read: number;
}

export interface Trophy {
  kind: 'item' | 'debris';
  label: string;
  run: number;
}

export interface LastCharacter {
  name: string;
  run: number;
  cell: number;
  zone: string;
  cause: string;
  /** Hiding spot they died in, if any — where the body gets propped [W]. */
  spot: number | null;
}

export interface SaveData {
  v: 1;
  runs: number;
  deaths: number;
  escapes: number;
  /** Entity Knowledge experience. Tiers derive from it. */
  xp: number;
  /** What it has learned about you, by key. See KNOWLEDGE_SIGNS for the vocabulary. */
  learned: Record<string, number>;
  tellStats: Record<TellKindKey, TellStat>;
  tacticWins: Record<string, number>;
  flashlightReliance: number;
  hideKinds: Record<'locker' | 'drawer' | 'bed', number>;
  trophies: Trophy[];
  lastCharacter: LastCharacter | null;
  survivorsLost: { name: string; color: [number, number, number]; run: number }[];
  journal: string[];
}

/** Knowledge tiers by experience. A death is worth 3, an escape 3, a survived encounter 0.5. */
export const TIER_XP = [0, 4, 10, 18, 30] as const;
/** How many of the survivors it took the nest keeps on show (and the save remembers) [W]. */
export const NEST_SURVIVORS = 8;

export function emptySave(): SaveData {
  return {
    v: 1,
    runs: 0,
    deaths: 0,
    escapes: 0,
    xp: 0,
    learned: {},
    tellStats: { tilt: { seen: 0, read: 0 }, inhale: { seen: 0, read: 0 }, turn: { seen: 0, read: 0 } },
    tacticWins: {},
    flashlightReliance: 0,
    hideKinds: { locker: 0, drawer: 0, bed: 0 },
    trophies: [],
    lastCharacter: null,
    survivorsLost: [],
    journal: [],
  };
}

export function tierFor(xp: number): number {
  let t = 0;
  for (let i = 0; i < TIER_XP.length; i++) if (xp >= TIER_XP[i]!) t = i;
  return t;
}

export interface KVStore {
  get(key: string): string | null;
  set(key: string, value: string): void;
  remove(key: string): void;
}

export class MemoryStore implements KVStore {
  private m = new Map<string, string>();
  get(k: string): string | null {
    return this.m.get(k) ?? null;
  }
  set(k: string, v: string): void {
    this.m.set(k, v);
  }
  remove(k: string): void {
    this.m.delete(k);
  }
}

/** localStorage can throw (private mode, blocked storage); fall back to memory. */
export class BrowserStore implements KVStore {
  private fallback = new MemoryStore();
  get(k: string): string | null {
    try {
      return globalThis.localStorage?.getItem(k) ?? this.fallback.get(k);
    } catch {
      return this.fallback.get(k);
    }
  }
  set(k: string, v: string): void {
    try {
      globalThis.localStorage?.setItem(k, v);
    } catch {
      /* storage unavailable */
    }
    this.fallback.set(k, v);
  }
  remove(k: string): void {
    try {
      globalThis.localStorage?.removeItem(k);
    } catch {
      /* storage unavailable */
    }
    this.fallback.remove(k);
  }
}

const KEY = 'the-quiet.save.v1';

export class Persistence {
  data: SaveData;

  constructor(private readonly store: KVStore) {
    this.data = Persistence.parse(store.get(KEY));
  }

  static parse(raw: string | null): SaveData {
    if (!raw) return emptySave();
    try {
      const d = JSON.parse(raw) as Partial<SaveData>;
      if (d.v !== 1) return emptySave();
      const base = emptySave();
      return {
        ...base,
        ...d,
        learned: { ...base.learned, ...(d.learned ?? {}) },
        tellStats: { ...base.tellStats, ...(d.tellStats ?? {}) },
        hideKinds: { ...base.hideKinds, ...(d.hideKinds ?? {}) },
      };
    } catch {
      return emptySave();
    }
  }

  save(): void {
    this.store.set(KEY, JSON.stringify(this.data));
  }

  reset(): void {
    this.data = emptySave();
    this.store.remove(KEY);
  }

  get tier(): number {
    return tierFor(this.data.xp);
  }

  learned(key: string): boolean {
    return (this.data.learned[key] ?? 0) > 0;
  }

  learn(key: string, amount = 1): boolean {
    const first = !this.learned(key);
    this.data.learned[key] = (this.data.learned[key] ?? 0) + amount;
    return first;
  }

  addXp(amount: number): void {
    this.data.xp = Math.round((this.data.xp + amount) * 10) / 10;
  }
}

/**
 * Diegetic knowledge [W]: how the nest shows what it has learned. Each learned key
 * leaves something physical behind for a brave player to read.
 */
export const KNOWLEDGE_SIGNS: Readonly<Record<string, { label: string; examine: string }>> = {
  'fake:turn': {
    label: 'scratched figures',
    examine: 'Figures scratched into the plaster, all turned away. Every one has its head twisted back over its shoulder.',
  },
  'fake:tilt': {
    label: 'a ring of scratches',
    examine: 'A circle worn into the floor, as if something stood here with its head cocked for a very long time. Waiting for someone to run out of breath.',
  },
  'fake:inhale': {
    label: 'a dented locker door',
    examine: 'A locker door torn off its hinges and propped upright. Long, shallow breath-marks fog the inside. It practises the breath without the reach.',
  },
  breaker: { label: 'burnt fuses', examine: 'A neat row of burnt fuses, arranged by size. It knows where the lights come from.' },
  radio: { label: 'a radio handset', examine: 'A handset, cord chewed through. When you lift it, it is warm, and it hisses a voice you almost recognise.' },
  beam: { label: 'crushed torches', examine: 'Torches. Dozens. Every lens pressed in by a thumb.' },
  mark: { label: 'wet rags', examine: 'Rags, still wet, laid out beside a drain. It watches the water.' },
  herd: { label: 'a dented vent cover', examine: 'A vent cover beaten into a bowl shape. Knuckle-prints in the metal.' },
  relocate: { label: 'a hoard of keys', examine: 'Keys, fuses, lanyards. Things people needed, kept where they can be seen.' },
  offer: { label: 'locker doors, ajar', examine: 'Locker doors stood in a row, each opened exactly a hand’s width. Inviting.' },
  funnel: { label: 'smashed bulbs', examine: 'Fluorescent tubes, snapped in half, sorted into a pile. One is left intact.' },
  mimic: { label: 'borrowed clothes', examine: 'Clothes, folded, each in a different colour. One sleeve is still warm.' },
  'counter:hide:locker': { label: 'locker latches', examine: 'Latches pried from lockers, threaded on a cord. It knows where you go when you are afraid.' },
  'counter:hide:bed': { label: 'bed slats', examine: 'Bed slats, stacked. Something has been looking underneath things.' },
  'counter:hide:drawer': { label: 'drawer handles', examine: 'Morgue drawer handles in a neat pile. Some still cold.' },
  'counter:distract': { label: 'broken glass', examine: 'Glass, swept into a pile — and beside it, a set of boot prints traced in dust. It followed the throw back to the hand.' },
  'counter:doors': { label: 'a sprung door', examine: 'A door torn off its runners. It stopped bothering to open them.' },
  'counter:dark': { label: 'torch switches', examine: 'Torch switches, prised out. It listens for the click now.' },
};

import type { PresetName, ScareLevel } from '../core/config';
import type { KVStore } from '../core/persistence';
import type { QualityName } from '../render3d/quality';

export interface Settings {
  quality: QualityName | 'auto';
  /** Multiplier on exposure: the game is meant to be dark, not invisible. */
  brightness: number;
  /** Look speed, as a multiplier. */
  sensitivity: number;
  invertY: boolean;
  master: number;
  music: number;
  sfx: number;
  voice: number;
  /** Speak the voices aloud (speech synthesis) as well as subtitling them. */
  tts: boolean;
  scares: ScareLevel;
  story: boolean;
  preset: PresetName;
  designer: boolean;
  /** What friends see you called in a shared run's lobby. */
  nick: string;
  /** Where a self-hosted relay lives, for playing over a LAN or your own server. */
  relay: string;
}

const KEY = 'the-quiet.settings';

export function defaultSettings(): Settings {
  return {
    quality: 'auto',
    brightness: 1,
    sensitivity: 1,
    invertY: false,
    master: 0.9,
    music: 0.8,
    sfx: 1,
    voice: 1,
    tts: true,
    scares: 'normal',
    story: true,
    preset: 'full',
    designer: false,
    nick: '',
    relay: '',
  };
}

export function loadSettings(store: KVStore): Settings {
  const base = defaultSettings();
  try {
    const raw = JSON.parse(store.get(KEY) ?? '{}') as Partial<Settings> & { volume?: number };
    // the first prototype had a single volume slider
    if (typeof raw.volume === 'number' && raw.master === undefined) raw.master = raw.volume;
    delete raw.volume;
    const out = { ...base, ...raw };
    if (!['auto', 'low', 'medium', 'high', 'ultra'].includes(out.quality)) out.quality = 'auto';
    if (!['off', 'normal', 'intense'].includes(out.scares)) out.scares = 'normal';
    return out;
  } catch {
    return base;
  }
}

export function saveSettings(store: KVStore, s: Settings): void {
  store.set(KEY, JSON.stringify(s));
}

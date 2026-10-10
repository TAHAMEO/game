import type { AudioEngine } from '../audio/engine';
import type { SimConfig } from '../core/config';
import type { KVStore } from '../core/persistence';
import type { Settings } from '../ui/settings';
import type { Session } from './session';

/** What the lobby needs from the game shell. */
export interface FriendsHost {
  show(html: string, cls?: string): void;
  on(sel: string, fn: () => void): void;
  esc(s: string): string;
  settings: Settings;
  persist(): void;
  audio: AudioEngine;
  store: KVStore;
  runConfig(players: number, seed?: number): SimConfig;
  begin(s: Session): void;
  back(): void;
  setScreen(): void;
}

export function openFriends(host: FriendsHost): void {
  host.show(`<h2>Play with friends</h2><p class="lede">Coming up.</p><button class="go" data-back>Back</button>`);
  host.on('[data-back]', () => host.back());
}

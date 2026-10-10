import type { AudioEngine } from '../audio/engine';
import { MAX_PLAYERS, type ScareLevel, type SimConfig } from '../core/config';
import type { KVStore } from '../core/persistence';
import type { Settings } from '../ui/settings';
import { PeerTransport, peerServerOptions } from './peer';
import { RelayTransport, sameOriginRelay } from './relay';
import { keepPages, NetGuest, NetHost } from './room';
import type { Session } from './session';
import { normaliseCode, type Transport } from './transport';

/** What the lobby needs from the game shell. */
export interface FriendsHost {
  show(html: string, cls?: string): void;
  on(sel: string, fn: () => void): void;
  esc(s: string): string;
  settings: Settings;
  persist(): void;
  audio: AudioEngine;
  store: KVStore;
  runConfig(players: number): SimConfig;
  /** A run begins (for everyone in the room at once). */
  begin(s: Session): void;
  /** Leave whatever run is on screen, staying connected. */
  leaveRun(): void;
  /** Back to the title screen. */
  back(): void;
  setScreen(): void;
}

type Current = { kind: 'host'; net: NetHost; via: Via } | { kind: 'guest'; net: NetGuest; via: Via };

interface Via {
  kind: 'peer' | 'relay';
  relay: string;
}

let current: Current | null = null;
/** The lobby is what is on screen (so room updates may redraw it). */
let showing = false;
let servedRelay: string | null | undefined;

/** Leave the room (and close it, if it is yours). */
export function closeNetwork(): void {
  const c = current;
  current = null;
  showing = false;
  if (!c) return;
  c.net.close();
}

function params(): URLSearchParams {
  return new URLSearchParams(location.search);
}

function transportFor(via: Via): Transport {
  if (via.kind === 'relay') return new RelayTransport(via.relay);
  return new PeerTransport(peerServerOptions(params().get('peerserver')));
}

async function defaultVia(h: FriendsHost): Promise<Via> {
  const p = params();
  if (p.get('relay')) return { kind: 'relay', relay: p.get('relay')! };
  if (servedRelay === undefined) servedRelay = await sameOriginRelay();
  if (servedRelay) return { kind: 'relay', relay: servedRelay };
  return { kind: h.settings.relay ? 'relay' : 'peer', relay: h.settings.relay };
}

function inviteLink(code: string, via: Via): string | null {
  if (!/^https?:$/.test(location.protocol)) return null;
  const url = new URL(location.href);
  url.search = '';
  url.hash = '';
  url.searchParams.set('join', code);
  if (via.kind === 'relay' && via.relay !== servedRelay) url.searchParams.set('relay', via.relay);
  const ps = params().get('peerserver');
  if (via.kind === 'peer' && ps) url.searchParams.set('peerserver', ps);
  return url.toString();
}

// ====================================================================== the first screen

export async function openFriends(h: FriendsHost): Promise<void> {
  h.setScreen();
  if (current) {
    if (current.kind === 'host') hostLobby(h, current.net, current.via);
    else guestLobby(h, current.net);
    return;
  }
  showing = false;
  const via = await defaultVia(h);
  const p = params();
  const code = p.get('join') ? normaliseCode(p.get('join')!) : '';
  const esc = h.esc;
  h.show(
    `
    <h2>Play with friends</h2>
    <p class="lede">Up to four of you in the same building, and the same thing listening for all of you.</p>
    <label class="field">Your name <input data-nick maxlength="20" value="${esc(h.settings.nick)}" placeholder="what the others call you" autocomplete="nickname"/></label>
    <nav class="menu">
      <button class="go" data-host>Host a game</button>
      <div class="join"><input data-code maxlength="40" placeholder="Room code" value="${esc(code)}" autocomplete="off" spellcheck="false"/><button data-join>Join</button></div>
      <button data-back>Back</button>
    </nav>
    <details class="via" ${via.kind === 'relay' ? 'open' : ''}>
      <summary>Connection</summary>
      <label><input type="radio" name="via" value="peer" ${via.kind === 'peer' ? 'checked' : ''}/> Over the internet, peer-to-peer</label>
      <label><input type="radio" name="via" value="relay" ${via.kind === 'relay' ? 'checked' : ''}/> Through a relay server
        <input data-relay value="${esc(via.relay)}" placeholder="ws://192.168.1.20:8787/relay" spellcheck="false"/></label>
      <p class="fine">For a LAN party, or a network that blocks peer-to-peer: run <code>npm run server</code> on one machine and everyone opens its address — the relay is then picked for you.</p>
    </details>
    <p class="error" data-error hidden></p>`,
    'wide friends',
  );
  const root = document.querySelector('#screens')!;
  const nick = root.querySelector<HTMLInputElement>('[data-nick]')!;
  const codeIn = root.querySelector<HTMLInputElement>('[data-code]')!;
  const relayIn = root.querySelector<HTMLInputElement>('[data-relay]')!;
  const err = root.querySelector<HTMLElement>('[data-error]')!;
  const chosen = (): Via => {
    const r = root.querySelector<HTMLInputElement>('input[name="via"]:checked');
    return { kind: r?.value === 'relay' ? 'relay' : 'peer', relay: relayIn.value.trim() };
  };
  const remember = () => {
    h.settings.nick = nick.value.trim().slice(0, 20);
    const v = chosen();
    if (v.kind === 'relay' && v.relay !== servedRelay) h.settings.relay = v.relay;
    if (v.kind === 'peer') h.settings.relay = '';
    h.persist();
  };
  const fail = (msg: string) => {
    err.hidden = false;
    err.textContent = msg;
    root.querySelectorAll('button').forEach((b) => (b.disabled = false));
  };
  const busy = (msg: string) => {
    err.hidden = false;
    err.textContent = msg;
    root.querySelectorAll<HTMLButtonElement>('[data-host],[data-join]').forEach((b) => (b.disabled = true));
  };
  const name = () => nick.value.trim() || 'Someone';
  h.on('[data-back]', () => h.back());
  h.on('[data-host]', () => {
    remember();
    const v = chosen();
    if (v.kind === 'relay' && !v.relay) return fail('Type the relay server address first.');
    busy('Opening a room…');
    transportFor(v)
      .host()
      .then((room) => {
        const net = new NetHost(room, name(), h.store, { scares: h.settings.scares, story: h.settings.story });
        current = { kind: 'host', net, via: v };
        wireHost(h, net, v);
        hostLobby(h, net, v);
      })
      .catch((e: Error) => fail(e.message));
  });
  const join = () => {
    remember();
    const v = chosen();
    const c = normaliseCode(codeIn.value);
    if (!c) return fail('Type the room code your friend gave you.');
    if (v.kind === 'relay' && !v.relay) return fail('Type the relay server address first.');
    busy('Knocking…');
    transportFor(v)
      .join(c)
      .then((link) => {
        const net = new NetGuest(link, name());
        current = { kind: 'guest', net, via: v };
        wireGuest(h, net);
        guestLobby(h, net);
      })
      .catch((e: Error) => fail(e.message));
  };
  h.on('[data-join]', join);
  codeIn.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') join();
  });
  if (code) codeIn.focus();
}

// ====================================================================== hosting

function wireHost(h: FriendsHost, net: NetHost, via: Via): void {
  net.onChange = () => {
    if (showing) hostLobby(h, net, via);
  };
  net.onLobby = () => {
    h.leaveRun();
    hostLobby(h, net, via);
  };
  net.onError = (reason) => {
    if (showing) {
      const el = document.querySelector<HTMLElement>('#screens [data-error]');
      if (el) {
        el.hidden = false;
        el.textContent = `${reason} Friends already here can stay; new ones may not get in.`;
      }
    }
  };
}

function seatsHtml(h: FriendsHost, players: { name: string; host: boolean }[], you: string | null): string {
  const rows: string[] = [];
  for (let i = 0; i < MAX_PLAYERS; i++) {
    const p = players[i];
    rows.push(
      p
        ? `<li><span>${i + 1}</span> ${h.esc(p.name)}${p.host ? ' <i>host</i>' : ''}${you !== null && p.name === you && !p.host ? ' <i>you</i>' : ''}</li>`
        : `<li class="empty"><span>${i + 1}</span> —</li>`,
    );
  }
  return `<ol class="seats">${rows.join('')}</ol>`;
}

function hostLobby(h: FriendsHost, net: NetHost, via: Via): void {
  showing = true;
  h.setScreen();
  const lobby = net.lobby();
  const link = inviteLink(net.code, via);
  const sel = (v: ScareLevel) => `<option value="${v}" ${lobby.scares === v ? 'selected' : ''}>${v === 'off' ? 'Off' : v === 'normal' ? 'Normal' : 'Intense'}</option>`;
  h.show(
    `
    <h2>Your room</h2>
    <div class="room-code" data-code-text>${h.esc(net.code)}</div>
    <p class="fine">Friends: open the game, choose <b>Play with friends</b> and type this code${link ? ' — or send them the link' : ''}.${via.kind === 'relay' ? ` (Through ${h.esc(via.relay)}.)` : ''}</p>
    ${link ? `<button data-copy>Copy invite link</button>` : ''}
    ${seatsHtml(h, lobby.players, null)}
    <div class="options compact">
      <label>Jump scares <select data-scares>${sel('off')}${sel('normal')}${sel('intense')}</select></label>
      <label><input type="checkbox" data-story ${lobby.story ? 'checked' : ''}/> The story</label>
    </div>
    <nav class="menu">
      <button class="go" data-start>${lobby.players.length > 1 ? 'Go in together' : 'Go in (they can join next run)'}</button>
      <button data-close>Close the room</button>
    </nav>
    <p class="error" data-error hidden></p>`,
    'wide friends',
  );
  h.on('[data-copy]', () => {
    if (!link) return;
    const btn = document.querySelector<HTMLButtonElement>('#screens [data-copy]')!;
    const done = () => (btn.textContent = 'Copied');
    if (navigator.clipboard?.writeText) navigator.clipboard.writeText(link).then(done, () => prompt('Invite link', link));
    else prompt('Invite link', link);
  });
  document.querySelector<HTMLSelectElement>('#screens [data-scares]')!.addEventListener('change', (e) => {
    const v = (e.target as HTMLSelectElement).value as ScareLevel;
    h.settings.scares = v;
    h.persist();
    net.setOptions({ scares: v });
  });
  document.querySelector<HTMLInputElement>('#screens [data-story]')!.addEventListener('change', (e) => {
    const v = (e.target as HTMLInputElement).checked;
    h.settings.story = v;
    h.persist();
    net.setOptions({ story: v });
  });
  h.on('[data-start]', () => {
    h.audio.start();
    h.audio.ui('start');
    showing = false;
    const s = net.start(h.runConfig(1 + net.guests.length));
    h.begin(s);
  });
  h.on('[data-close]', () => {
    closeNetwork();
    void openFriends(h);
  });
}

// ====================================================================== joining

function wireGuest(h: FriendsHost, net: NetGuest): void {
  net.onLobby = () => {
    if (showing) guestLobby(h, net);
  };
  net.onReturn = () => {
    h.leaveRun();
    guestLobby(h, net);
  };
  net.onStart = (s) => {
    showing = false;
    h.audio.start();
    h.begin(s);
  };
  net.onRunEnded = (sim) => keepPages(h.store, sim);
  net.onClosed = (reason) => {
    current = null;
    showing = true;
    h.leaveRun();
    h.setScreen();
    h.show(`
      <h2>Disconnected</h2>
      <p class="lede">${h.esc(reason)}</p>
      <nav class="menu"><button class="go" data-again>Play with friends</button><button data-title>Title</button></nav>`);
    h.on('[data-again]', () => void openFriends(h));
    h.on('[data-title]', () => h.back());
  };
}

function guestLobby(h: FriendsHost, net: NetGuest): void {
  showing = true;
  h.setScreen();
  const lobby = net.lobby;
  const hostName = lobby?.players.find((p) => p.host)?.name ?? 'the host';
  const waiting = !lobby
    ? 'Knocking…'
    : lobby.running
      ? `A run is under way. You go in with ${h.esc(hostName)} next time.`
      : `Waiting for ${h.esc(hostName)} to go in…`;
  h.show(
    `
    <h2>${h.esc(hostName)}'s room</h2>
    ${lobby ? seatsHtml(h, lobby.players, null) : ''}
    ${lobby ? `<p class="fine">Jump scares: ${lobby.scares} · the story: ${lobby.story ? 'on' : 'off'}</p>` : ''}
    <p class="lede waiting">${waiting}</p>
    <nav class="menu"><button data-leave>Leave the room</button></nav>`,
    'wide friends',
  );
  h.on('[data-leave]', () => {
    closeNetwork();
    void openFriends(h);
  });
}

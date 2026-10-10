import './style.css';
import { AudioEngine } from './audio/engine';
import { defaultConfig, PRESETS, type Features, type PresetName, type ScareLevel, type SimConfig } from './core/config';
import { BrowserStore, Persistence, type KVStore } from './core/persistence';
import { Sim } from './core/sim';
import { CASE_FILES } from './core/storyText';
import type { GameEvent } from './core/types';
import { openFriends, type FriendsHost } from './net/lobby';
import { SoloSession, type Session } from './net/session';
import { Renderer as RetroRenderer } from './render/raycaster';
import { GameRenderer, type RenderFrame } from './render3d/GameRenderer';
import { guessQuality, type QualityName } from './render3d/quality';
import { DesignerPanel } from './ui/designer';
import { Hud } from './ui/hud';
import { InputController } from './ui/input';
import { loadSettings, saveSettings, type Settings } from './ui/settings';

type Screen = 'loading' | 'title' | 'menu' | 'intro' | 'playing' | 'paused' | 'journal' | 'over';

/** Whatever draws the world: the HD renderer, or the old raycaster where WebGL2 is missing. */
interface View {
  readonly hd: GameRenderer | null;
  handle(events: GameEvent[], sim: Sim, viewId: number, t: number): void;
  render(sim: Sim, f: RenderFrame): void;
  resize(): void;
}

/** Read-only view of the save for the title-screen preview (never writes). */
class MemoryStoreShim implements KVStore {
  private data = new Map<string, string>();
  constructor(private readonly real: KVStore) {}
  get(k: string): string | null {
    return this.data.get(k) ?? this.real.get(k);
  }
  set(k: string, v: string): void {
    this.data.set(k, v);
  }
  remove(k: string): void {
    this.data.delete(k);
  }
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

const store = new BrowserStore();
const settings: Settings = loadSettings(store);
const persist = () => saveSettings(store, settings);
const params = new URLSearchParams(location.search);
if (params.has('q')) settings.quality = params.get('q') as QualityName;

let canvas = document.querySelector<HTMLCanvasElement>('#view')!;
const screens = document.querySelector<HTMLElement>('#screens')!;
const hudRoot = document.querySelector<HTMLElement>('#hud')!;
const hud = new Hud(hudRoot);
const audio = new AudioEngine();
const features: Features = { ...PRESETS[settings.preset] };
let tierOverride: number | null = params.has('tier') ? Number(params.get('tier')) : null;

let preview = makePreviewSim();
let view!: View;
let input!: InputController;
let designer!: DesignerPanel;
let session: Session | null = null;
let screen: Screen = 'loading';
/** Whose eyes we see through: you, or (once you are out) whoever you are watching. */
let viewId = 0;
/** When whoever we are watching was last seen leaving the run (dying, getting out). */
let lostAt = -1;
let overAt = -1;
let lockWanted = false;
let wall = 0;
let nextFlash = 6;
/** Where "Back" goes from the options/case file screens. */
let menuReturn: () => void = () => titleScreen();

// ========================================================================= setup

function applySettings(): void {
  audio.tts = settings.tts;
  audio.setVolumes({ master: settings.master, music: settings.music, sfx: settings.sfx, voice: settings.voice });
  if (input) {
    input.sensitivity = 0.0024 * settings.sensitivity;
    input.invertY = settings.invertY;
  }
  if (view?.hd) view.hd.brightness = settings.brightness;
}

function seed(): number {
  return params.has('seed') ? Number(params.get('seed')) : (Date.now() ^ (Math.random() * 1e9)) >>> 0;
}

/** The run you would start with the current options. */
function runConfig(players = 1, s = seed()): SimConfig {
  const cfg = defaultConfig(s);
  cfg.features = { ...features };
  cfg.tierOverride = tierOverride;
  cfg.players = players;
  cfg.scares = settings.scares;
  cfg.story = settings.story;
  return cfg;
}

/** The title screen renders a throwaway run that must not count as a life. */
function makePreviewSim(): Sim {
  const cfg = defaultConfig(1234);
  cfg.scares = 'off';
  return new Sim(cfg, new MemoryStoreShim(store));
}

async function makeView(onProgress: (k: number) => void): Promise<View> {
  if (!params.has('retro')) {
    try {
      const gr = new GameRenderer(canvas, settings.quality);
      await gr.init(preview.level, onProgress);
      gr.brightness = settings.brightness;
      return { hd: gr, handle: (e, s, v, t) => gr.handle(e, s, v, t), render: (s, f) => gr.render(s, f), resize: () => gr.resize() };
    } catch (err) {
      console.warn('HD renderer unavailable, falling back to the raycaster:', err);
      // the failed attempt may have claimed the canvas for WebGL: start from a fresh one
      const fresh = canvas.cloneNode() as HTMLCanvasElement;
      canvas.replaceWith(fresh);
      canvas = fresh;
    }
  }
  canvas.classList.add('retro');
  const r = new RetroRenderer(canvas);
  return { hd: null, handle: () => {}, render: (s, f) => r.render(s, f.t), resize: () => {} };
}

// ========================================================================= screens

function show(html: string, cls = ''): void {
  screens.innerHTML = `<div class="screen ${cls}">${html}</div>`;
  screens.querySelectorAll('button').forEach((b) => {
    b.addEventListener('mouseenter', () => audio.ui('hover'));
    b.addEventListener('click', () => audio.ui('select'));
  });
}

function on(sel: string, fn: () => void): void {
  screens.querySelector(sel)?.addEventListener('click', fn);
}

function loadingScreen(text: string): (k: number) => void {
  screens.innerHTML = `
    <div class="loading">
      <h1>THE QUIET</h1>
      <p class="lede">${esc(text)}</p>
      <div class="load-bar"><i></i></div>
      <p class="fine">Every surface is painted on your graphics card. This takes a moment the first time.</p>
    </div>`;
  const bar = screens.querySelector<HTMLElement>('.load-bar i')!;
  return (k) => {
    bar.style.width = `${Math.round(Math.max(0, Math.min(1, k)) * 100)}%`;
  };
}

function memoryLine(): string {
  const mem = new Persistence(store).data;
  if (mem.runs === 0) return 'Nobody has gone in yet.';
  const people = `${mem.deaths} ${mem.deaths === 1 ? 'person has' : 'people have'} gone in and not come out.`;
  return `${people} ${mem.escapes ? `${mem.escapes} got out.` : ''} It remembers every one.`;
}

function titleScreen(): void {
  endSession();
  screen = 'title';
  menuReturn = titleScreen;
  const found = new Persistence(store).data.story.found.length;
  show(
    `
    <h1>THE QUIET</h1>
    <p class="lede">St. Ashgrove General, 3:12 a.m. The storm took the power. Something in the building listens with its whole head.</p>
    <p class="memory">${esc(memoryLine())}</p>
    <nav class="menu">
      <button class="go" data-go>Go in alone</button>
      <button data-friends>Play with friends</button>
      <button data-casefile>Case file <small>${found} / ${CASE_FILES.length}</small></button>
      <button data-options>Options</button>
    </nav>
    <div class="controls">
      <span><kbd>W A S D</kbd> move</span><span><kbd>Mouse</kbd> look</span><span><kbd>Shift</kbd> run</span>
      <span><kbd>C</kbd> crouch</span><span><kbd>E</kbd> use (hold)</span><span><kbd>F</kbd> torch</span>
      <span><kbd>Space</kbd> hold breath</span><span><kbd>G</kbd> / right-click throw</span><span><kbd>J</kbd> notebook</span>
      <span><kbd>Esc</kbd> pause</span>
    </div>
    <p class="fine">Headphones. Lights off. No meters, no clock, no safe room.</p>
    <p class="fine touch-note">This one needs a keyboard and a mouse or trackpad.</p>`,
    'title',
  );
  on('[data-go]', () => startSolo());
  on('[data-friends]', () => friendsScreen());
  on('[data-casefile]', () => caseFileScreen(titleScreen));
  on('[data-options]', () => optionsScreen(titleScreen, true));
}

function optionsScreen(back: () => void, runOptions: boolean): void {
  const prev = screen;
  screen = prev === 'paused' || prev === 'journal' ? prev : 'menu';
  menuReturn = back;
  const sel = <T extends string>(name: string, value: T, opts: readonly [T, string][]) =>
    `<select data-opt="${name}">${opts.map(([v, l]) => `<option value="${v}" ${v === value ? 'selected' : ''}>${l}</option>`).join('')}</select>`;
  const range = (name: keyof Settings, min: number, max: number, step: number) =>
    `<input type="range" min="${min}" max="${max}" step="${step}" value="${settings[name] as number}" data-opt="${name}"/>`;
  const check = (name: keyof Settings) => `<input type="checkbox" data-opt="${name}" ${settings[name] ? 'checked' : ''}/>`;
  show(
    `
    <h2>Options</h2>
    <div class="options">
      <section>
        <h3>Picture</h3>
        <label>Graphics ${sel('quality', settings.quality, [
          ['auto', 'Automatic'],
          ['low', 'Low'],
          ['medium', 'Medium'],
          ['high', 'High'],
          ['ultra', 'Ultra'],
        ])}</label>
        <label>Brightness ${range('brightness', 0.6, 1.8, 0.05)}</label>
        ${view.hd ? `<p class="fine">Now: ${view.hd.quality.name}. Changing it rebuilds every texture.</p>` : '<p class="fine">Your browser has no WebGL2: running the old raycaster.</p>'}
      </section>
      <section>
        <h3>Sound</h3>
        <label>Master ${range('master', 0, 1, 0.05)}</label>
        <label>Music ${range('music', 0, 1, 0.05)}</label>
        <label>Effects ${range('sfx', 0, 1, 0.05)}</label>
        <label>Voices ${range('voice', 0, 1, 0.05)}</label>
        <label>${check('tts')} Speak the voices aloud</label>
      </section>
      <section>
        <h3>Controls</h3>
        <label>Look speed ${range('sensitivity', 0.3, 2.5, 0.1)}</label>
        <label>${check('invertY')} Invert mouse up/down</label>
      </section>
      ${
        runOptions
          ? `<section>
        <h3>The next run</h3>
        <label>Jump scares ${sel<ScareLevel>('scares', settings.scares, [
          ['off', 'Off'],
          ['normal', 'Normal'],
          ['intense', 'Intense'],
        ])}</label>
        <label>${check('story')} The story (case files, visions, whispers)</label>
        <label>Layers ${sel<PresetName>('preset', settings.preset, [
          ['full', 'Everything'],
          ['mvp', 'The essentials'],
          ['core', 'Bare systems'],
        ])}</label>
      </section>`
          : ''
      }
    </div>
    <button class="go" data-back>Back</button>`,
    'wide',
  );
  screens.querySelectorAll<HTMLInputElement | HTMLSelectElement>('[data-opt]').forEach((el) => {
    el.addEventListener('input', () => {
      const key = el.dataset.opt as keyof Settings;
      const v = el instanceof HTMLInputElement && el.type === 'checkbox' ? el.checked : el instanceof HTMLInputElement && el.type === 'range' ? Number(el.value) : el.value;
      (settings as unknown as Record<string, unknown>)[key] = v;
      if (key === 'preset') {
        Object.assign(features, PRESETS[settings.preset]);
        designer.bind(session?.sim ?? preview);
      }
      if (key === 'quality') void changeQuality();
      applySettings();
      persist();
    });
  });
  on('[data-back]', () => back());
}

async function changeQuality(): Promise<void> {
  const gr = view.hd;
  if (!gr) return;
  const q = settings.quality === 'auto' ? undefined : settings.quality;
  const back = menuReturn;
  const progress = loadingScreen('Repainting the building…');
  await gr.setQuality(q ?? guessQuality(), preview.level, progress);
  gr.brightness = settings.brightness;
  back();
}

function caseFileScreen(back: () => void): void {
  screen = screen === 'paused' || screen === 'journal' ? screen : 'menu';
  const mem = new Persistence(store).data;
  const found = new Set(mem.story.found);
  const reader = session?.sim.player.name ?? mem.lastCharacter?.name ?? 'you';
  show(
    `
    <h2>Case file</h2>
    <p class="memory">${found.size ? `${found.size} of ${CASE_FILES.length} pages. They stay found, whoever you are next time.` : 'Somewhere in the building there is a file with your name in it.'}</p>
    <div class="casefile">${CASE_FILES.map((f) =>
      found.has(f.id)
        ? `<article><h3><span>${f.id + 1}</span> ${esc(f.title)}</h3><p>${esc(f.text.replace(/\{name\}/g, reader))}</p></article>`
        : `<article class="missing"><h3><span>${f.id + 1}</span> — missing —</h3></article>`,
    ).join('')}</div>
    <button class="go" data-back>Back</button>`,
    'wide',
  );
  on('[data-back]', () => back());
}

// ------------------------------------------------------------------------- shared runs

const friendsHost: FriendsHost = {
  show,
  on,
  esc,
  settings,
  persist,
  audio,
  store,
  runConfig,
  begin: (s) => beginRun(s),
  back: () => titleScreen(),
  setScreen: () => {
    screen = 'menu';
  },
};

function friendsScreen(): void {
  audio.start();
  screen = 'menu';
  openFriends(friendsHost);
}

// ------------------------------------------------------------------------- a run

function startSolo(): void {
  if (!params.has('mute')) audio.start();
  audio.ui('start');
  beginRun(new SoloSession(new Sim(runConfig(1), store)));
}

function beginRun(s: Session): void {
  endSession();
  session = s;
  const sim = s.sim;
  sim.localId = s.localId;
  viewId = s.localId;
  lostAt = -1;
  overAt = -1;
  designer.bind(sim);
  hud.reset();
  audio.silenceVoices();
  input.clear();
  input.crouchToggled = false;
  (window as unknown as { __quiet: unknown }).__quiet = { sim, session: s, view, designer, hud };
  if (params.has('autostart') || params.has('nointro')) {
    enterBuilding();
    return;
  }
  intro(sim.story.intro(), enterBuilding);
}

function enterBuilding(): void {
  if (!session) return;
  screen = 'playing';
  screens.innerHTML = '';
  input.enabled = true;
  input.clear();
  lockWanted = true;
  input.lock();
  const sim = session.sim;
  const me = sim.player;
  if (sim.players.length > 1) {
    const others = sim.players.filter((p) => p !== me).map((p) => p.name);
    hud.notice(`You are ${me.name}. With you: ${others.join(', ')}.`, 6);
  } else hud.notice(`You are ${me.name}.`, 4);
  hud.notice('The power is out. Find three fuses. Restore the breaker. Call for help.', 7);
  hud.notice('Your torch (F) is the brightest thing in the building.', 9);
}

/** Lines typed out on black, one by one. Any key or click hurries it; Esc skips. */
function intro(lines: string[], done: () => void): void {
  screen = 'intro';
  input.enabled = false;
  screens.innerHTML = `<div class="intro"><div class="intro-lines"></div><p class="intro-hint">click to hurry · Esc to skip</p></div>`;
  const box = screens.querySelector<HTMLElement>('.intro-lines')!;
  const hint = screens.querySelector<HTMLElement>('.intro-hint')!;
  let i = 0;
  let ch = 0;
  let wait = 0.8;
  let finished = false;
  let p: HTMLParagraphElement | null = null;
  const finish = () => {
    if (finished) return;
    finished = true;
    hint.textContent = 'Click to go in.';
    hint.classList.add('ready');
  };
  const go = () => {
    window.removeEventListener('keydown', key, true);
    screens.removeEventListener('pointerdown', click);
    done();
  };
  const hurry = () => {
    if (finished) return go();
    if (p && ch < lines[i]!.length) {
      ch = lines[i]!.length;
      p.textContent = lines[i]!;
    } else wait = 0;
  };
  const key = (e: KeyboardEvent) => {
    if (screen !== 'intro') return;
    e.preventDefault();
    e.stopPropagation();
    if (e.code === 'Escape') {
      finish();
      go();
    } else if (e.code === 'Space' || e.code === 'Enter') hurry();
  };
  const click = () => hurry();
  window.addEventListener('keydown', key, true);
  screens.addEventListener('pointerdown', click);
  introTick = (dt: number) => {
    if (finished || screen !== 'intro') return;
    if (wait > 0) {
      wait -= dt;
      return;
    }
    if (i >= lines.length) {
      finish();
      return;
    }
    if (!p) {
      box.querySelectorAll('p').forEach((q) => q.classList.add('old'));
      p = document.createElement('p');
      box.appendChild(p);
      ch = 0;
    }
    ch = Math.min(lines[i]!.length, ch + dt * 34);
    p.textContent = lines[i]!.slice(0, Math.floor(ch));
    if (ch >= lines[i]!.length) {
      p.textContent = lines[i]!;
      i++;
      p = null;
      wait = 1.5;
    }
  };
}
let introTick: (dt: number) => void = () => {};

function pauseScreen(): void {
  if (!session) return;
  const live = session.live;
  screen = 'paused';
  input.enabled = false;
  input.unlock();
  show(`
    <h2>Paused</h2>
    <p class="lede">${live ? 'The others are still in there. So is it.' : 'It does not wait for you. (It does, a little.)'}</p>
    <nav class="menu">
      <button class="go" data-resume>Back in</button>
      <button data-journal>Notebook</button>
      <button data-options>Options</button>
      <button data-quit>${session.sim.player.active ? 'Leave this life <small>(counts as a death)</small>' : 'Leave the run'}</button>
      <button data-title>Back to the title</button>
    </nav>`);
  on('[data-resume]', resume);
  on('[data-journal]', () => journalScreen('tonight'));
  on('[data-options]', () => optionsScreen(pauseScreen, false));
  on('[data-title]', () => {
    if (session?.kind === 'solo' && session.sim.phase === 'playing' && session.sim.player.active) session.sim.player.die('You stopped.');
    titleScreen();
  });
  on('[data-quit]', () => {
    if (!session) return;
    if (session.sim.player.active) {
      forfeit();
      resume(); // let the loop run so the death plays out and the end screen appears
    } else titleScreen();
  });
}

function forfeit(): void {
  if (!session) return;
  const s = session as Session & { forfeit?: () => void };
  if (s.forfeit) s.forfeit();
  else session.sim.player.die('You stopped.');
}

function resume(): void {
  screens.innerHTML = '';
  screen = 'playing';
  input.enabled = true;
  input.clear();
  lockWanted = true;
  input.lock();
}

function journalScreen(tab: 'tonight' | 'file' | 'hand'): void {
  if (!session) return;
  screen = 'journal';
  input.enabled = false;
  input.unlock();
  const sim = session.sim;
  const mem = sim.memory.data;
  const pl = sim.player;
  const o = sim.objectives;
  let body = '';
  if (tab === 'tonight') {
    const notes = sim.world.notes.filter((n) => n.read);
    const tasks = [
      `${pl.inv.fuses >= sim.world.fusesRequired || o.powerOn ? '✓' : '·'} Three fuses${o.powerOn ? '' : ` (${pl.inv.fuses}/3)`}`,
      `${o.powerOn ? '✓' : '·'} The breaker — Maintenance, downstairs`,
      `${o.calls.length ? '✓' : '·'} The radio — Security office`,
      o.calls.length ? `· They said: ${o.calls.map((c) => (c.gate === 'bay' ? 'the Ambulance Bay' : 'the Chapel Garden gate')).join(', then ')}` : '',
    ].filter(Boolean);
    body = `
      <section><h3>${esc(pl.name)}</h3>${tasks.map((t) => `<p>${esc(t)}</p>`).join('')}</section>
      <section><h3>Notes picked up</h3>${notes.length ? notes.map((n) => `<p><b>${esc(n.title)}.</b> ${esc(n.text)}</p>`).join('') : '<p>Nothing yet.</p>'}</section>`;
  } else if (tab === 'file') {
    const found = new Set(mem.story.found);
    body = `<div class="casefile">${CASE_FILES.map((f) => {
      if (!found.has(f.id)) return `<article class="missing"><h3><span>${f.id + 1}</span> — missing —</h3></article>`;
      const r = sim.story.recordText(f.id, pl)!;
      return `<article><h3><span>${f.id + 1}</span> ${esc(r.title)}</h3><p>${esc(r.text)}</p></article>`;
    }).join('')}</div>`;
  } else {
    body = `<section><h3>In someone else's handwriting</h3>${mem.journal.length ? mem.journal.map((j) => `<p>${esc(j)}</p>`).join('') : '<p>Blank pages. For now.</p>'}</section>`;
  }
  const tabBtn = (t: typeof tab, label: string) => `<button class="tab ${t === tab ? 'on' : ''}" data-tab="${t}">${label}</button>`;
  show(
    `
    <h2>Notebook</h2>
    <div class="tabs">${tabBtn('tonight', 'Tonight')}${tabBtn('file', `Case file <small>${mem.story.found.length}/${CASE_FILES.length}</small>`)}${tabBtn('hand', 'Handwriting')}</div>
    <div class="journal">${body}</div>
    <button class="go" data-resume>Close</button>`,
    'wide',
  );
  screens.querySelectorAll<HTMLElement>('[data-tab]').forEach((b) => b.addEventListener('click', () => journalScreen(b.dataset.tab as typeof tab)));
  on('[data-resume]', resume);
}

function overScreen(): void {
  if (!session) return;
  screen = 'over';
  input.enabled = false;
  input.unlock();
  const sim = session.sim;
  const me = sim.player;
  const ending = sim.story.ending(me);
  const others = sim.players.filter((p) => p !== me);
  const fates = others.length
    ? `<div class="fates">${others.map((p) => `<span class="${p.escaped ? 'out' : 'dead'}">${esc(p.name)} — ${p.escaped ? 'got out' : 'kept'}</span>`).join('')}</div>`
    : '';
  const pages = sim.story.enabled ? `<p class="fine">Case file: ${sim.story.pages} of ${sim.story.total} pages.</p>` : '';
  const again =
    session.kind === 'solo'
      ? '<button class="go" data-go>Someone else goes in</button>'
      : session.kind === 'host'
        ? '<button class="go" data-lobby>Back to the lobby</button>'
        : '<button class="go" data-lobby>Wait for the next run</button>';
  show(
    `
    <h1 class="${me.escaped ? '' : 'red'} ${ending.trueEnding ? 'true' : ''}">${esc(ending.title)}</h1>
    ${ending.lines.map((l, i) => `<p class="${i === 0 ? 'lede' : 'memory'}">${esc(l)}</p>`).join('')}
    ${fates}
    ${pages}
    <nav class="menu">${again}<button data-title>Title</button></nav>`,
    `over${ending.trueEnding ? ' true' : ''}`,
  );
  on('[data-go]', () => startSolo());
  on('[data-lobby]', () => {
    const s = session as Session & { toLobby?: () => void };
    s.toLobby?.();
  });
  on('[data-title]', () => titleScreen());
}

function endSession(): void {
  if (!session) return;
  session.dispose();
  session = null;
  input.enabled = false;
  input.unlock();
  hud.reset();
  audio.silenceVoices();
  designer.bind(preview);
}

// ========================================================================= input

function bindInput(): void {
  input = new InputController(canvas);
  applySettings();
  input.onKey = (code, e) => {
    if (code === 'F1' || code === 'Backquote') {
      e.preventDefault();
      designer.toggle();
      settings.designer = designer.visible;
      persist();
      if (designer.visible) designer.bind(session?.sim ?? preview);
      return;
    }
    if (!session) return;
    if (code === 'Escape') {
      if (screen === 'playing') pauseScreen();
      else if (screen === 'paused' || screen === 'journal') resume();
      return;
    }
    if (code === 'KeyJ') {
      if (screen === 'playing') journalScreen('tonight');
      else if (screen === 'journal') resume();
      return;
    }
    if (screen === 'playing' && !session.sim.player.active && (code === 'ArrowLeft' || code === 'ArrowRight')) watchNext(code === 'ArrowLeft' ? -1 : 1);
  };
  document.addEventListener('pointerlockchange', () => {
    // Losing pointer lock (Esc in most browsers) pauses the game.
    if (!document.pointerLockElement && screen === 'playing' && input.enabled && lockWanted && session?.sim.player.active) pauseScreen();
  });
  canvas.addEventListener('mousedown', () => {
    if (screen !== 'playing' || !session) return;
    lockWanted = true;
    if (!session.sim.player.active) watchNext(1);
  });
  window.addEventListener('pointerdown', () => {
    if (!params.has('mute')) audio.start();
  });
  window.addEventListener('resize', () => view.resize());
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      if (session?.kind === 'solo' && screen === 'playing') pauseScreen();
      if (!session?.live) audio.suspend();
    } else audio.resume();
  });
}

/** Once you are out (dead or through the gate), watch whoever is still inside. */
function watchNext(dir: number): void {
  if (!session) return;
  const sim = session.sim;
  const active = sim.players.filter((p) => p.active);
  if (!active.length) return;
  const i = active.findIndex((p) => p.id === viewId);
  const next = active[(i + dir + active.length) % active.length]!;
  if (next.id !== viewId) hud.notice(`You watch ${next.name}.`, 3);
  viewId = next.id;
  lostAt = -1;
}

function updateWatch(): void {
  if (!session) return;
  const sim = session.sim;
  const me = sim.player;
  if (me.active) {
    viewId = me.id;
    lostAt = -1;
    return;
  }
  const watched = sim.players[viewId];
  if (watched && watched.active) return;
  // stay with the body a moment (yours, or theirs), then go to whoever is left
  if (lostAt < 0) lostAt = wall;
  if (wall - lostAt < (viewId === me.id ? 3.2 : 2.2)) return;
  const next = sim.players.find((p) => p.active);
  if (next) {
    viewId = next.id;
    lostAt = -1;
    hud.notice(`You watch ${next.name}.`, 3);
  }
}

// ========================================================================= loop

let last = performance.now();
function frame(now: number): void {
  const dt = Math.min(0.1, Math.max(0, (now - last) / 1000));
  last = now;
  wall += dt;
  if (screen === 'loading') {
    requestAnimationFrame(frame);
    return;
  }
  const s = session;
  if (s) {
    // Alone, the building waits while you are in a menu; with friends in it, it never does.
    const running = s.live || screen === 'playing' || screen === 'over';
    const events = running ? s.tick(dt, screen === 'playing' ? input : null) : [];
    const sim = s.sim;
    updateWatch();
    view.handle(events, sim, viewId, wall);
    audio.handle(events, sim, viewId);
    hud.handle(events, sim, { viewId, localId: s.localId });
    if (sim.phase !== 'playing' && overAt < 0) overAt = wall;
    if (overAt >= 0 && wall - overAt > 3.4 && screen !== 'over' && screen !== 'menu') overScreen();
    view.render(sim, { dt, t: wall, viewId });
    hud.visible = screen === 'playing';
    hud.update(sim, dt, { viewId, localId: s.localId });
    audio.update(sim, dt, viewId);
    if (screen === 'intro') introTick(dt);
  } else {
    // Attract mode: the camera breathes in the reception while the title is up.
    const pl = preview.player;
    pl.angle = -Math.PI / 2 + Math.sin(wall * 0.045) * 0.75;
    pl.pitch = -0.06 + Math.sin(wall * 0.07) * 0.05;
    nextFlash -= dt;
    const events: GameEvent[] = [];
    if (nextFlash <= 0) {
      nextFlash = 14 + Math.random() * 22;
      events.push({ type: 'lightning', strength: 0.45 + Math.random() * 0.55 });
    }
    view.handle(events, preview, 0, wall);
    audio.handle(events, preview, 0);
    view.render(preview, { dt, t: wall, viewId: 0, attract: true });
    hud.visible = false;
    audio.update(preview, dt, 0);
  }
  designer.update(dt);
  requestAnimationFrame(frame);
}

// ========================================================================= boot

async function boot(): Promise<void> {
  const progress = loadingScreen('Building St. Ashgrove General…');
  requestAnimationFrame(frame);
  view = await makeView(progress);
  bindInput();
  designer = new DesignerPanel(document.querySelector('#designer')!, {
    newRun: () => startSolo(),
    resetMemory: () => {
      new Persistence(store).reset();
      startSolo();
    },
    setTier: (t) => {
      tierOverride = t;
    },
  });
  designer.bind(preview);
  if (settings.designer || params.has('designer')) designer.toggle(true);
  view.resize();
  if (params.has('autostart')) startSolo();
  else if (params.has('join')) friendsScreen();
  else titleScreen();
}

void boot();

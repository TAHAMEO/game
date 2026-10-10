import './style.css';
import { AudioEngine } from './audio/audio';
import { defaultConfig, PRESETS, type Features, type PresetName } from './core/config';
import { BrowserStore, Persistence } from './core/persistence';
import { Sim } from './core/sim';
import { Renderer } from './render/raycaster';
import { DesignerPanel } from './ui/designer';
import { Hud } from './ui/hud';
import { InputController } from './ui/input';

type Screen = 'title' | 'playing' | 'paused' | 'journal' | 'over';

const STEP = 1 / 60;
const store = new BrowserStore();

interface Settings {
  sensitivity: number;
  tts: boolean;
  volume: number;
  designer: boolean;
  preset: PresetName;
}

function loadSettings(): Settings {
  const base: Settings = { sensitivity: 1, tts: true, volume: 0.9, designer: false, preset: 'full' };
  try {
    return { ...base, ...(JSON.parse(store.get('the-quiet.settings') ?? '{}') as Partial<Settings>) };
  } catch {
    return base;
  }
}

/** Read-only view of the save for the title-screen preview (never writes). */
class MemoryStoreShim {
  private data = new Map<string, string>();
  constructor(private readonly real: BrowserStore) {}
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

const settings = loadSettings();
const saveSettings = () => store.set('the-quiet.settings', JSON.stringify(settings));

const canvas = document.querySelector<HTMLCanvasElement>('#view')!;
const screens = document.querySelector<HTMLElement>('#screens')!;
const renderer = new Renderer(canvas);
const audio = new AudioEngine();
audio.tts = settings.tts;
audio.setVolume(settings.volume);
const input = new InputController(canvas);
input.sensitivity = 0.0024 * settings.sensitivity;
const hud = new Hud(document.querySelector('#hud')!);

const params = new URLSearchParams(location.search);
const features: Features = { ...PRESETS[settings.preset] };
let tierOverride: number | null = params.has('tier') ? Number(params.get('tier')) : null;

let sim: Sim = makeSim(true);
let screen: Screen = 'title';
let overAt = -1;

const designer = new DesignerPanel(document.querySelector('#designer')!, {
  newRun: () => startRun(),
  resetMemory: () => {
    new Persistence(store).reset();
    startRun();
  },
  setTier: (t) => {
    tierOverride = t;
  },
});
designer.bind(sim);
if (settings.designer || params.has('designer')) designer.toggle(true);

function makeSim(preview = false): Sim {
  const seed = params.has('seed') ? Number(params.get('seed')) : (Date.now() ^ (Math.random() * 1e9)) >>> 0;
  const cfg = defaultConfig(seed);
  cfg.features = features;
  cfg.tierOverride = tierOverride;
  // The title screen renders a throwaway run that must not count as a life.
  if (preview) {
    const s = new Sim(cfg, new MemoryStoreShim(store));
    return s;
  }
  return new Sim(cfg, store);
}

function startRun(): void {
  sim = makeSim();
  designer.bind(sim);
  hud.reset();
  overAt = -1;
  screen = 'playing';
  screens.innerHTML = '';
  input.enabled = true;
  input.crouchToggled = false;
  input.clear();
  if (!params.has('mute')) audio.start();
  input.lock();
  (window as unknown as { __quiet: unknown }).__quiet = { sim, renderer, designer };
  hud.notice(`You are ${sim.player.name}.`, 4);
  hud.notice('The power is out. Find three fuses. Restore the breaker. Call for help.', 7);
}

// ========================================================================= screens

function show(html: string): void {
  screens.innerHTML = `<div class="screen">${html}</div>`;
}

function titleScreen(): void {
  const mem = new Persistence(store).data;
  const memory =
    mem.runs === 0
      ? 'Nobody has gone in yet.'
      : `${mem.deaths} ${mem.deaths === 1 ? 'person has' : 'people have'} gone in and not come out. ${mem.escapes ? `${mem.escapes} got out.` : ''} It remembers every one.`;
  show(`
    <h1>THE QUIET</h1>
    <p class="lede">St. Ashgrove General. The power is out. Something in the building listens with its whole head.</p>
    <p class="memory">${memory}</p>
    <button class="go" data-go>Go in</button>
    <div class="controls">
      <span><kbd>W A S D</kbd> move</span><span><kbd>Mouse</kbd> / <kbd>← →</kbd> look</span><span><kbd>Shift</kbd> run</span>
      <span><kbd>C</kbd> crouch</span><span><kbd>E</kbd> use (hold)</span><span><kbd>F</kbd> torch</span>
      <span><kbd>Space</kbd> hold breath</span><span><kbd>G</kbd> / right-click throw</span><span><kbd>J</kbd> notebook</span>
      <span><kbd>F1</kbd> director's view</span><span><kbd>Esc</kbd> pause</span>
    </div>
    <div class="opts">
      <label><input type="checkbox" data-opt="tts" ${settings.tts ? 'checked' : ''}/> spoken voices</label>
      <label>look speed <input type="range" min="0.3" max="2.5" step="0.1" value="${settings.sensitivity}" data-opt="sens"/></label>
      <label>volume <input type="range" min="0" max="1" step="0.05" value="${settings.volume}" data-opt="vol"/></label>
      <label>layers <select data-opt="preset">${(['full', 'mvp', 'core'] as PresetName[]).map((p) => `<option ${p === settings.preset ? 'selected' : ''}>${p}</option>`).join('')}</select></label>
    </div>
    <p class="fine">No meters. No clock. No safe room. Headphones.</p>`);
  bindOptions();
  screens.querySelector('[data-go]')!.addEventListener('click', () => startRun());
}

function bindOptions(): void {
  screens.querySelectorAll<HTMLInputElement | HTMLSelectElement>('[data-opt]').forEach((el) => {
    el.addEventListener('input', () => {
      const v = el instanceof HTMLInputElement && el.type === 'checkbox' ? el.checked : el.value;
      switch (el.dataset.opt) {
        case 'tts':
          settings.tts = v as boolean;
          audio.tts = settings.tts;
          break;
        case 'sens':
          settings.sensitivity = Number(v);
          input.sensitivity = 0.0024 * settings.sensitivity;
          break;
        case 'vol':
          settings.volume = Number(v);
          audio.setVolume(settings.volume);
          break;
        case 'preset':
          settings.preset = v as PresetName;
          Object.assign(features, PRESETS[settings.preset]);
          designer.bind(sim);
          break;
      }
      saveSettings();
    });
  });
}

function pauseScreen(): void {
  screen = 'paused';
  input.enabled = false;
  input.unlock();
  show(`
    <h2>Paused</h2>
    <p class="lede">It does not wait for you. (It does, a little.)</p>
    <button class="go" data-resume>Back in</button>
    <div class="opts">
      <label><input type="checkbox" data-opt="tts" ${settings.tts ? 'checked' : ''}/> spoken voices</label>
      <label>look speed <input type="range" min="0.3" max="2.5" step="0.1" value="${settings.sensitivity}" data-opt="sens"/></label>
      <label>volume <input type="range" min="0" max="1" step="0.05" value="${settings.volume}" data-opt="vol"/></label>
    </div>
    <button data-quit>Leave this life (counts as a death)</button>`);
  bindOptions();
  screens.querySelector('[data-resume]')!.addEventListener('click', resume);
  screens.querySelector('[data-quit]')!.addEventListener('click', () => {
    sim.player.die('You stopped.');
  });
}

function resume(): void {
  screens.innerHTML = '';
  screen = 'playing';
  input.enabled = true;
  input.clear();
  input.lock();
}

function journalScreen(): void {
  screen = 'journal';
  input.enabled = false;
  input.unlock();
  const mem = sim.memory.data;
  const notes = sim.world.notes.filter((n) => n.read);
  const o = sim.objectives;
  const pl = sim.player;
  const tasks = [
    `${pl.inv.fuses >= sim.world.fusesRequired || o.powerOn ? '✓' : '·'} Three fuses${o.powerOn ? '' : ` (${pl.inv.fuses}/3)`}`,
    `${o.powerOn ? '✓' : '·'} The breaker — Maintenance, downstairs`,
    `${o.calls.length ? '✓' : '·'} The radio — Security office`,
    `${o.calls.length ? '·' : ' '} ${o.calls.length ? `They said: ${o.calls.map((c) => (c.gate === 'bay' ? 'the Ambulance Bay' : 'the Chapel Garden gate')).join(', then ')}` : ''}`,
  ];
  show(`
    <h2>Notebook</h2>
    <div class="journal">
      <section><h3>${pl.name}</h3>${tasks.map((t) => `<p>${t}</p>`).join('')}</section>
      <section><h3>Notes picked up</h3>${notes.length ? notes.map((n) => `<p><b>${n.title}.</b> ${n.text}</p>`).join('') : '<p>Nothing yet.</p>'}</section>
      <section><h3>In someone else's handwriting</h3>${mem.journal.length ? mem.journal.map((j) => `<p>${j}</p>`).join('') : '<p>Blank pages. For now.</p>'}</section>
    </div>
    <button class="go" data-resume>Close</button>`);
  screens.querySelector('[data-resume]')!.addEventListener('click', resume);
}

function overScreen(): void {
  screen = 'over';
  input.enabled = false;
  input.unlock();
  const pl = sim.player;
  if (sim.phase === 'dead') {
    show(`
      <h1 class="red">It kept you.</h1>
      <p class="lede">${pl.name}. ${pl.deathCause}</p>
      <p class="memory">Somewhere in the Old Wing, the pile is a little higher.</p>
      <button class="go" data-go>Someone else goes in</button>`);
  } else {
    show(`
      <h1>You got out.</h1>
      <p class="lede">${pl.name} made it through the gate.</p>
      <p class="memory">It will remember how.</p>
      <button class="go" data-go>Someone else goes in</button>`);
  }
  screens.querySelector('[data-go]')!.addEventListener('click', () => startRun());
}

input.onKey = (code, e) => {
  if (code === 'F1' || code === 'Backquote') {
    e.preventDefault();
    designer.toggle();
    settings.designer = designer.visible;
    saveSettings();
    if (designer.visible) designer.bind(sim);
    return;
  }
  if (code === 'Escape') {
    if (screen === 'playing') pauseScreen();
    else if (screen === 'paused' || screen === 'journal') resume();
    return;
  }
  if (code === 'KeyJ') {
    if (screen === 'playing') journalScreen();
    else if (screen === 'journal') resume();
  }
};

document.addEventListener('pointerlockchange', () => {
  // Losing pointer lock (Esc in most browsers) pauses the game.
  if (!document.pointerLockElement && screen === 'playing' && input.enabled && sim.player.alive && lockWanted) pauseScreen();
});
let lockWanted = false;
canvas.addEventListener('mousedown', () => {
  lockWanted = true;
});

// ========================================================================= loop

let last = performance.now();
let acc = 0;
function frame(now: number): void {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  if (screen === 'playing') {
    acc += dt;
    const steps = Math.min(6, Math.floor(acc / STEP));
    acc -= steps * STEP;
    for (const inp of input.frame(dt, steps)) sim.step(STEP, inp);
    const events = sim.drainEvents();
    audio.handle(events, sim);
    hud.handle(events);
    if (sim.phase !== 'playing' && overAt < 0) overAt = now;
    if (overAt >= 0 && now - overAt > 2600) overScreen();
  } else if (screen === 'title') {
    // Attract mode: the camera breathes in the reception while the title is up.
    sim.player.angle += dt * 0.05;
  }
  renderer.render(sim, now / 1000);
  hud.update(sim, dt);
  if (screen === 'playing') audio.update(sim, dt);
  designer.update(dt);
  requestAnimationFrame(frame);
}

titleScreen();
requestAnimationFrame(frame);

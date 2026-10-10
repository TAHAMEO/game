import { FEATURE_SECTIONS, PRESETS, type FeatureKey, type PresetName } from '../core/config';
import { VIEW_FOV } from '../core/director/perception';
import { cellCenter, Tile } from '../core/level';
import type { Sim } from '../core/sim';
import { World } from '../core/world';

const CELL = 6;

const LABELS: Record<FeatureKey, string> = {
  perceptualNoise: 'Perceptual noise',
  flashlightTax: 'Flashlight tax',
  herding: 'Herding',
  objectRelocation: 'Object relocation',
  offeredSafety: 'Offered safety',
  darknessFunnels: 'Darkness funnels',
  rescueMimicry: 'Rescue-call mimicry',
  breakerAmbush: 'Breaker ambush',
  falseLeads: 'False leads*',
  thermalResidue: 'Thermal residue',
  breathFog: 'Breath fog',
  theMark: 'The mark',
  nestTrophies: 'Nest trophies*',
  ownRemains: 'Your own remains*',
  survivors: 'Survivors*',
  mimicSurvivors: 'Mimic survivor',
  fakedTells: 'Faked tells',
  strategyDismantling: 'Strategy dismantling',
  movingGoalposts: 'Moving goalposts',
  risingFloor: 'Rising floor',
};

const TAG_COLORS: Record<string, string> = {
  S: '#e07bff',
  T: '#ff9f43',
  U: '#ffd166',
  V: '#ff6b6b',
  W: '#c8a27a',
  X: '#7bdcb5',
  Y: '#6ec6ff',
  Z: '#bdbdbd',
  K: '#f0f0a0',
  director: '#9aa',
  entity: '#d88',
  run: '#fff',
};

export interface DesignerHooks {
  newRun(): void;
  resetMemory(): void;
  setTier(t: number | null): void;
}

/**
 * The designer overlay: everything the player is never shown. Live map of the systems,
 * every S–Z readout, the decision log ("why did it do that?"), and feature toggles.
 */
export class DesignerPanel {
  visible = false;
  private root: HTMLElement;
  private map: HTMLCanvasElement;
  private g: CanvasRenderingContext2D;
  private stats: HTMLElement;
  private log: HTMLElement;
  private toggles: HTMLElement;
  private textClock = 0;
  private sim: Sim | null = null;

  constructor(root: HTMLElement, private readonly hooks: DesignerHooks) {
    this.root = root;
    root.innerHTML = `
      <div class="dz-head"><b>DIRECTOR'S VIEW</b> <span>F1 / \` to hide — the player never sees any of this</span></div>
      <canvas class="dz-map"></canvas>
      <div class="dz-cols"><div class="dz-stats"></div><div class="dz-log"></div></div>
      <details class="dz-toggles" open><summary>Feature layers (brief sections S–Z) — * applies next run</summary><div class="dz-tg"></div></details>`;
    this.map = root.querySelector('.dz-map')!;
    this.g = this.map.getContext('2d')!;
    this.stats = root.querySelector('.dz-stats')!;
    this.log = root.querySelector('.dz-log')!;
    this.toggles = root.querySelector('.dz-tg')!;
    root.hidden = true;
  }

  toggle(force?: boolean): void {
    this.visible = force ?? !this.visible;
    this.root.hidden = !this.visible;
  }

  bind(sim: Sim): void {
    this.sim = sim;
    this.map.width = sim.level.w * CELL;
    this.map.height = sim.level.h * CELL;
    this.buildToggles(sim);
  }

  private buildToggles(sim: Sim): void {
    const f = sim.features;
    const rows = FEATURE_SECTIONS.map(
      (s) =>
        `<div class="dz-sec"><b style="color:${TAG_COLORS[s.section]}">${s.section}</b> <span>${s.title}</span>${s.keys
          .map((k) => `<label><input type="checkbox" data-k="${k}" ${f[k] ? 'checked' : ''}/> ${LABELS[k]}</label>`)
          .join('')}</div>`,
    ).join('');
    const tier = sim.config.tierOverride;
    this.toggles.innerHTML = `${rows}
      <div class="dz-actions">
        Preset: ${(['core', 'mvp', 'full'] as PresetName[]).map((p) => `<button data-preset="${p}">${p}</button>`).join(' ')}
        &nbsp; Knowledge tier: <select data-tier>${['auto', '0', '1', '2', '3', '4'].map((t) => `<option ${String(tier ?? 'auto') === t ? 'selected' : ''}>${t}</option>`).join('')}</select>
        <br/><button data-act="run">New run</button> <button data-act="reset">Erase Entity memory</button>
      </div>`;
    this.toggles.querySelectorAll<HTMLInputElement>('input[data-k]').forEach((el) => {
      el.addEventListener('change', () => {
        f[el.dataset.k as FeatureKey] = el.checked;
      });
    });
    this.toggles.querySelectorAll<HTMLButtonElement>('button[data-preset]').forEach((el) => {
      el.addEventListener('click', () => {
        Object.assign(f, PRESETS[el.dataset.preset as PresetName]);
        this.buildToggles(sim);
      });
    });
    this.toggles.querySelector<HTMLSelectElement>('select[data-tier]')!.addEventListener('change', (e) => {
      const v = (e.target as HTMLSelectElement).value;
      this.hooks.setTier(v === 'auto' ? null : Number(v));
    });
    this.toggles.querySelector('button[data-act="run"]')!.addEventListener('click', () => this.hooks.newRun());
    this.toggles.querySelector('button[data-act="reset"]')!.addEventListener('click', () => {
      if (confirm('Erase everything the Entity has learned about you?')) this.hooks.resetMemory();
    });
  }

  update(dt: number): void {
    const sim = this.sim;
    if (!this.visible || !sim) return;
    this.drawMap(sim);
    this.textClock -= dt;
    if (this.textClock <= 0) {
      this.textClock = 0.2;
      this.drawText(sim);
    }
  }

  // ===================================================================== map

  private drawMap(sim: Sim): void {
    const g = this.g;
    const lvl = sim.level;
    const world = sim.world;
    const L = world.lighting;
    g.fillStyle = '#050505';
    g.fillRect(0, 0, this.map.width, this.map.height);
    for (let y = 0; y < lvl.h; y++) {
      for (let x = 0; x < lvl.w; x++) {
        const c = y * lvl.w + x;
        const t = lvl.tiles[c]!;
        let col: string | null = null;
        if (t === Tile.Floor || t === Tile.Bed) {
          const lum = Math.min(1, L.lum[c]!);
          const v = 26 + lum * 120;
          const z = lvl.zoneOf[c]!;
          const cold = z >= 0 && lvl.zones[z]!.cold;
          col = `rgb(${v | 0},${v | 0},${(v + (cold ? 22 : 0)) | 0})`;
          if (t === Tile.Bed) col = '#4a4f55';
        } else if (t === Tile.Door) {
          const d = world.doorAt.get(c)!;
          col = d.jammed ? '#8b5a2b' : d.locked ? '#a33' : d.open > 0.5 ? '#3d6b3d' : '#6b6b3d';
        } else if (t === Tile.Locker || t === Tile.Drawer) col = '#3c5a50';
        else if (t === Tile.Vent) col = '#5fb3c8';
        else if (t === Tile.Tap) col = '#4a7bd0';
        else if (t === Tile.FuseBox) col = '#e8c547';
        else if (t === Tile.Radio) col = '#5fd068';
        else if (t === Tile.Gate) col = world.gateAt.get(c)!.open ? '#fff' : '#999';
        else if (t === Tile.Cabinet) col = '#2a2622';
        if (col) {
          g.fillStyle = col;
          g.fillRect(x * CELL, y * CELL, CELL, CELL);
        }
      }
    }
    const P = (v: { x: number; y: number }) => [v.x * CELL, v.y * CELL] as const;
    const dot = (v: { x: number; y: number }, r: number, col: string, stroke = false) => {
      const [x, y] = P(v);
      g.beginPath();
      g.arc(x, y, r, 0, Math.PI * 2);
      if (stroke) {
        g.strokeStyle = col;
        g.stroke();
      } else {
        g.fillStyle = col;
        g.fill();
      }
    };
    // hiding spots
    for (const s of world.spots) {
      const p = cellCenter(lvl, s.cell);
      if (s.occupant) dot(p, 2.2, s.occupant.kind === 'player' ? '#0ff' : '#7bdcb5');
      if (s.baited) dot(p, 3.5, '#ff4fd8', true);
      else if (s.ajar) dot(p, 2.5, '#ff9fe0', true);
      if (s.body) dot(p, 2.5, '#c8a27a');
    }
    // items
    const itemCol: Record<string, string> = { fuse: '#ffd166', key: '#ffb703', battery: '#fb8500', bottle: '#52b788', note: '#ddd' };
    for (const it of world.items) if (it.state === 'ground') dot(it.pos, it.relocated ? 3 : 2, itemCol[it.kind]!);
    for (const pr of world.props) dot(pr.pos, 1.6, pr.kind === 'remains' ? '#fff' : '#a0826d');
    // thermal [V] and fog
    for (const m of world.thermal) {
      const h = World.heatOf(m, sim.time);
      if (h > 0.05) dot(m.pos, 2 + h * 2, `rgba(255,120,40,${h.toFixed(2)})`);
    }
    for (const f of world.fog) dot(f.pos, 1.5, 'rgba(230,240,255,0.8)');
    // noises
    for (const n of sim.recentNoises) {
      const age = sim.time - n.t;
      const col = n.source === 'player' ? '0,255,255' : n.source === 'entity' ? '255,80,80' : n.source === 'survivor' ? '123,220,181' : '255,255,255';
      dot(n.pos, 2 + age * 18, `rgba(${col},${Math.max(0, 0.6 - age * 0.4).toFixed(2)})`, true);
    }
    // survivors
    for (const sv of sim.survivors.list) {
      const [r, gg, b] = sv.def.color;
      if (sv.alive) dot(sv.pos, 2.4, `rgb(${r},${gg},${b})`);
    }
    // phantoms [S]
    for (const ph of sim.director.perception.phantoms) dot(ph.pos, 3, '#e07bff', true);
    // plan [T]
    const plan = sim.director.bait.active;
    if (plan) {
      for (const st of plan.steps) {
        if (st.op === 'ambush') {
          const p = cellCenter(lvl, st.cell);
          g.strokeStyle = '#ff9f43';
          g.strokeRect(p.x * CELL - 4, p.y * CELL - 4, 8, 8);
          dot(st.watch, st.radius * CELL, 'rgba(255,159,67,0.4)', true);
        } else if (st.op === 'killLight') {
          const f = L.fixtures[st.fixture]!;
          dot(cellCenter(lvl, f.cell), 3, '#ffd166', true);
        } else if (st.op === 'ajar' || st.op === 'clear') dot(cellCenter(lvl, world.spots[st.spot]!.cell), 4, '#ff4fd8', true);
        else if (st.op === 'mimic') dot(cellCenter(lvl, st.cell), 4, '#7bdcb5', true);
        else if (st.op === 'jam') dot(cellCenter(lvl, world.doors[st.door]!.cell), 4, '#8b5a2b', true);
      }
    }
    // the Entity
    const e = sim.entity;
    const stateCol: Record<string, string> = { chase: '#ff2020', lunge: '#ff2020', hunt: '#ff7a3d', investigate: '#ffb03d', check: '#ff7a3d', ambush: '#ff9f43', plan: '#ff9f43', mimic: '#7bdcb5', feint: '#6ec6ff', listen: '#6ec6ff', leave: '#888', roam: '#c06060', rest: '#555', feed: '#555', retreat: '#777', kill: '#f00' };
    this.cone(e.pos, e.angle, e.fov(), 10, 'rgba(255,60,60,0.12)');
    if (e.lkp) dot(e.lkp, 2.5, '#ff2020', true);
    dot(e.pos, 3.5, stateCol[e.stateKind] ?? '#f55');
    // the player
    const pl = sim.player;
    this.cone(pl.pos, pl.angle, VIEW_FOV, 8, 'rgba(0,255,255,0.12)');
    dot(pl.pos, 3, pl.alive ? '#0ff' : '#555');
  }

  private cone(p: { x: number; y: number }, a: number, fov: number, len: number, col: string): void {
    const g = this.g;
    g.fillStyle = col;
    g.beginPath();
    g.moveTo(p.x * CELL, p.y * CELL);
    g.arc(p.x * CELL, p.y * CELL, len * CELL, a - fov / 2, a + fov / 2);
    g.closePath();
    g.fill();
  }

  // ===================================================================== text

  private drawText(sim: Sim): void {
    const d = sim.director;
    const e = sim.entity;
    const pl = sim.player;
    const mem = sim.memory.data;
    const pct = (v: number) => `${Math.round(v * 100)}%`;
    const bar = (v: number, col = '#6ec6ff') => `<span class="dz-bar"><i style="width:${Math.round(Math.min(1, Math.max(0, v)) * 100)}%;background:${col}"></i></span>`;
    const mmss = `${Math.floor(sim.time / 60)}:${String(Math.floor(sim.time % 60)).padStart(2, '0')}`;
    const tells = (['tilt', 'inhale', 'turn'] as const)
      .map((k) => {
        const s = mem.tellStats[k];
        const learned = sim.memory.learned(`fake:${k}`);
        return `${k} ${s.read}/${s.seen}${learned ? ' <b style="color:#6ec6ff">FAKING</b>' : ''}`;
      })
      .join(' · ');
    const counters = Object.keys(mem.learned).filter((k) => k.startsWith('counter:'));
    const enc = d.adapt.encounter;
    const plan = d.bait.active;
    const sv = sim.survivors.list
      .map((s) => `${s.def.name} ${s.alive ? '' : '✝'} att ${s.attachment}${s.met ? '' : ' (unmet)'}`)
      .join(' · ');
    const calls = sim.objectives.calls.map((c) => `${c.gate}${c.fake ? ' (FAKE)' : ''}`).join(', ');
    const sc = d.stress.components;
    this.stats.innerHTML = `
      <div><b>Run ${sim.runNumber}</b> ${pl.name} · ${mmss} · Knowledge tier <b>${d.tier}</b> (${mem.xp} xp, ${mem.deaths} deaths)</div>
      <div class="dz-k">Director</div>
      <div>phase <b>${d.phase}</b> · menace ${bar(d.menace, '#ff6b6b')} · ${d.lastDecision}</div>
      <div class="dz-k" style="color:${TAG_COLORS.Z}">Z · the debt</div>
      <div>floor ${bar(d.floor, '#bdbdbd')} ${pct(d.floor)} · over-hiding ${d.debt.lingering.overHiding.toFixed(0)}s · indecision ${d.debt.lingering.indecision.toFixed(0)}s · false leads ${d.debt.lingering.falseLeads.toFixed(0)}s</div>
      <div class="dz-k" style="color:${TAG_COLORS.S}">S · unreliable senses</div>
      <div>stress ${bar(d.stress.value, '#e07bff')} ${pct(d.stress.value)} <small>(look ${pct(sc.look)} sprint ${pct(sc.sprint)} threat ${pct(sc.threat)} hide ${pct(sc.hide)})</small></div>
      <div>false signals ${d.perception.emitted} · you flinched ${d.profile.ghostReactions} · torch reliance ${pct(d.profile.flashlightReliance)} · tax <b>${d.flashTax.phase}</b></div>
      <div class="dz-k" style="color:#d88">Entity</div>
      <div><b>${e.stateKind}</b> — ${e.reason}</div>
      <div>suspicion ${bar(e.suspicion, '#ff6b6b')} · hears ≥ ${e.hearingThreshold().toFixed(0)} · ${e.tell ? `tell <b>${e.tell.kind}${e.tell.fake ? ' (FAKE)' : ''}</b>` : 'no tell'}${e.disguise !== null ? ` · wearing ${sim.survivors.list[e.disguise]!.def.name}` : ''}</div>
      <div class="dz-k" style="color:${TAG_COLORS.Y}">Y · learned tell</div>
      <div>${tells} · fakes shown ${d.adapt.fakesShown}, believed ${d.adapt.fakesTaken}</div>
      <div>${enc ? `encounter: ${[...enc.tactics].join(', ') || '…'}` : 'no encounter'} · escapes ${d.adapt.escapes} · comfort ${bar(d.adapt.comfort / 45, '#6ec6ff')}</div>
      <div>dismantled: ${counters.length ? counters.map((c) => c.slice(8)).join(', ') : 'nothing yet'}</div>
      <div class="dz-k" style="color:${TAG_COLORS.T}">T · bait economy</div>
      <div>${plan ? `<b>${plan.kind}</b> — ${plan.reason}` : `no active plan (next in ${Math.max(0, d.bait.cooldownUntil - sim.time).toFixed(0)}s)`}</div>
      <div><small>${d.bait.history.slice(-6).map((h) => `${h.kind}${h.ok ? '✓' : '✗'}`).join(' ')}</small></div>
      <div class="dz-k" style="color:${TAG_COLORS.V}">V · scent, heat & the mark</div>
      <div>warm prints ${sim.world.thermal.length} · breath puffs ${sim.world.fog.length} · ${pl.isMarked ? `<b>MARKED</b> ${(pl.markedUntil - sim.time).toFixed(0)}s` : 'unmarked'}</div>
      <div class="dz-k" style="color:${TAG_COLORS.U}">U · objectives</div>
      <div>${sim.objectives.stage()} · power ${sim.objectives.powerOn ? 'on' : 'off'} · real gate: ${sim.objectives.realGate}${calls ? ` · calls: ${calls}` : ''}</div>
      <div class="dz-k" style="color:${TAG_COLORS.X}">X · company</div>
      <div>${sv || 'no survivors this run'}</div>
      <div class="dz-k" style="color:${TAG_COLORS.W}">W · the nest</div>
      <div>${sim.world.props.length} things kept · trophies saved ${mem.trophies.length}${mem.lastCharacter ? ` · last: ${mem.lastCharacter.name}` : ''}</div>`;
    this.log.innerHTML = sim.designerLog
      .slice(-18)
      .reverse()
      .map((l) => `<div><span style="color:${TAG_COLORS[l.tag] ?? '#aaa'}">[${l.tag}]</span> <i>${l.t.toFixed(0)}s</i> ${l.text.replace(/</g, '&lt;')}</div>`)
      .join('');
  }
}

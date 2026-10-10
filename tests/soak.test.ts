import { describe, expect, it } from 'vitest';
import { defaultConfig, PRESETS } from '../src/core/config';
import { cellAt, Tile } from '../src/core/level';
import { MemoryStore } from '../src/core/persistence';
import { Sim } from '../src/core/sim';
import { Bot } from './bot';

const DT = 1 / 60;

function run(seed: number, minutes: number, opts: ConstructorParameters<typeof Bot>[1] = {}, store = new MemoryStore(), preset: keyof typeof PRESETS = 'full') {
  const cfg = defaultConfig(seed);
  cfg.features = { ...PRESETS[preset] };
  const sim = new Sim(cfg, store);
  const bot = new Bot(sim, opts);
  const states = new Map<string, number>();
  const steps = Math.floor((minutes * 60) / DT);
  for (let i = 0; i < steps && sim.phase === 'playing'; i++) {
    sim.step(DT, bot.input());
    sim.drainEvents();
    states.set(sim.entity.stateKind, (states.get(sim.entity.stateKind) ?? 0) + 1);
    // Invariants: nobody inside walls.
    const ec = cellAt(sim.level, sim.entity.pos);
    const t = sim.level.tiles[ec];
    if (t !== Tile.Floor && t !== Tile.Door) throw new Error(`entity inside tile ${t} at t=${sim.time.toFixed(1)} state=${sim.entity.stateKind}`);
    if (!sim.player.hidden && !sim.player.transition) {
      const pc = cellAt(sim.level, sim.player.pos);
      const pt = sim.level.tiles[pc];
      if (pt !== Tile.Floor && pt !== Tile.Door) throw new Error(`player inside tile ${pt} at t=${sim.time.toFixed(1)}`);
    }
  }
  return { sim, states };
}

describe('soak', () => {
  it('runs several seeds for minutes of game time without breaking invariants', { timeout: 120_000 }, () => {
    for (const seed of [1, 2, 3, 4, 5, 6]) {
      const { sim, states } = run(seed, 6);
      expect(sim.time).toBeGreaterThan(5);
      expect(states.size).toBeGreaterThan(2);
    }
  });

  it('persists knowledge across permadeath runs', { timeout: 120_000 }, () => {
    const store = new MemoryStore();
    let deaths = 0;
    for (let i = 0; i < 4; i++) {
      const { sim } = run(100 + i, 8, { hides: true }, store);
      if (sim.phase === 'dead') deaths++;
    }
    const { sim } = run(200, 0.05, {}, store);
    expect(sim.runNumber).toBe(5);
    expect(sim.memory.data.deaths).toBe(deaths);
    if (deaths > 0) {
      expect(sim.memory.data.xp).toBeGreaterThan(0);
      expect(sim.memory.data.trophies.length).toBeGreaterThan(0);
    }
  });

  it('runs shared runs of up to four people, with the story and the scares on', { timeout: 180_000 }, () => {
    for (const [seed, n] of [
      [301, 2],
      [302, 3],
      [303, 4],
    ] as const) {
      const cfg = defaultConfig(seed);
      cfg.players = n;
      cfg.scares = 'intense';
      cfg.story = true;
      const sim = new Sim(cfg, new MemoryStore());
      const bots = sim.players.map((p) => new Bot(sim, { hides: true, flees: p.id % 2 === 0 }, p.id));
      const steps = Math.floor((8 * 60) / DT);
      let scares = 0;
      for (let i = 0; i < steps && sim.phase === 'playing'; i++) {
        sim.step(DT, bots.map((b) => b.input()));
        for (const e of sim.drainEvents()) if (e.type === 'scare') scares++;
        const ec = cellAt(sim.level, sim.entity.pos);
        const t = sim.level.tiles[ec];
        if (t !== Tile.Floor && t !== Tile.Door) throw new Error(`entity inside tile ${t} at t=${sim.time.toFixed(1)}`);
        for (const p of sim.players) {
          if (!p.active || p.hidden || p.transition) continue;
          const pt = sim.level.tiles[cellAt(sim.level, p.pos)];
          if (pt !== Tile.Floor && pt !== Tile.Door) throw new Error(`player ${p.id} inside tile ${pt} at t=${sim.time.toFixed(1)}`);
        }
        // a hiding place never holds two
        const occ = sim.world.spots.filter((sp) => sp.occupant?.kind === 'player').map((sp) => sp.occupant);
        expect(new Set(occ.map((o) => (o?.kind === 'player' ? o.id : -1))).size).toBe(occ.length);
      }
      expect(sim.time).toBeGreaterThan(5);
      if (sim.phase !== 'playing') expect(sim.activePlayers).toHaveLength(0);
      void scares;
    }
  });

  it('runs every preset', { timeout: 120_000 }, () => {
    for (const preset of ['core', 'mvp', 'full'] as const) {
      const { sim } = run(42, 3, {}, new MemoryStore(), preset);
      expect(sim.time).toBeGreaterThan(5);
    }
  });
});

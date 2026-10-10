import { describe, expect, it } from 'vitest';
import type { EntityState } from '../src/core/entity';
import { cellCenter } from '../src/core/level';
import { dist } from '../src/core/math';
import { World } from '../src/core/world';
import { cell, makeSim, placeEntity, placePlayer, sedateEntity, step } from './helpers';

describe('V. Thermal residue', () => {
  it('leaves heat on what you touch, fading over about a minute', () => {
    const sim = makeSim({ seed: 30 });
    sedateEntity(sim);
    // E1 door at (56,3): stand in the corridor and face east.
    const door = sim.world.doorAt.get(cell(sim, 56, 3))!;
    door.open = door.target = 0;
    placePlayer(sim, 55, 3, 0);
    step(sim, 1 / 60, { interactPressed: true });
    const mark = sim.world.thermal.find((m) => m.cell === door.cell);
    expect(mark?.surface).toBe('door');
    expect(World.heatOf(mark!, sim.time)).toBeGreaterThan(0.9);
    step(sim, 30);
    expect(World.heatOf(mark!, sim.time)).toBeLessThan(0.3);
    step(sim, 35);
    expect(sim.world.thermal.find((m) => m.cell === door.cell)).toBeUndefined();
  });

  it('a hunting Entity reads fresh prints and follows them', () => {
    const sim = makeSim({ seed: 31 });
    sim.world.addThermal(cell(sim, 56, 8), cellCenter(sim.level, cell(sim, 56, 8)), 'door', sim.time);
    placePlayer(sim, 60, 2); // out of sight in E1
    placeEntity(sim, 54, 12, -Math.PI / 2);
    sim.entity.hunt({ x: 54.5, y: 10.5 }, 4, 'test', 60);
    step(sim, 0.6);
    const st = sim.entity.state as EntityState;
    expect(st.kind).toBe('investigate');
    expect(sim.entity.reason).toMatch(/warm print/);
  });

  it('warm handprints on a latch give your hiding place away', () => {
    const sim = makeSim({ seed: 32 });
    const spot = sim.world.spots.find((s) => s.cell === cell(sim, 63, 13))!; // staff-room locker
    placePlayer(sim, 62, 13, 0);
    step(sim, 1 / 60, { interactPressed: true });
    step(sim, 1.2);
    expect(sim.player.hidden).toBe(spot);
    placeEntity(sim, 58, 13, 0);
    sim.entity.hunt({ x: 59.5, y: 13.5 }, 3, 'test', 60);
    step(sim, 0.6);
    const st = sim.entity.state as EntityState;
    expect(st.kind).toBe('check');
    if (st.kind === 'check') expect(st.spot).toBe(spot.id);
  });
});

describe('V. Breath fog', () => {
  it('fogs in cold zones only, and holding your breath stops it', () => {
    const cold = makeSim({ seed: 33 });
    sedateEntity(cold);
    placePlayer(cold, 20, 35); // morgue
    let puffs = 0;
    for (let i = 0; i < 40; i++) {
      step(cold, 0.25);
      puffs = Math.max(puffs, cold.world.fog.length);
    }
    expect(puffs).toBeGreaterThan(0);

    const warm = makeSim({ seed: 33 });
    sedateEntity(warm);
    placePlayer(warm, 31, 25); // reception
    step(warm, 10);
    expect(warm.world.fog).toHaveLength(0);

    const held = makeSim({ seed: 33 });
    sedateEntity(held);
    placePlayer(held, 20, 35);
    step(held, 3, { holdBreath: true });
    const n = held.world.fog.length;
    step(held, 3, { holdBreath: true });
    expect(held.world.fog.length).toBeLessThanOrEqual(n);
    expect(held.world.fog.filter((f) => held.time - f.t < 2.5)).toHaveLength(0);
  });

  it('breath leaking from a hiding place is a slow, silent beacon', () => {
    const sim = makeSim({ seed: 34 });
    const drawer = sim.world.spots.find((s) => s.kind === 'drawer' && s.cell === cell(sim, 14, 33))!;
    placePlayer(sim, 15, 33, Math.PI);
    sim.entity.update = () => {};
    step(sim, 1 / 60, { interactPressed: true });
    step(sim, 1.2);
    expect(sim.player.hidden).toBe(drawer);
    let leaked = false;
    for (let i = 0; i < 40 && !leaked; i++) {
      step(sim, 0.25);
      leaked = sim.world.fog.some((f) => f.spot === drawer.id);
    }
    expect(leaked).toBe(true);
    delete (sim.entity as { update?: unknown }).update;
    placeEntity(sim, 19, 33, Math.PI);
    sim.entity.state = { kind: 'roam', dest: sim.entity.cell, pauseUntil: sim.time + 99 };
    let checking = false;
    for (let i = 0; i < 40 && !checking; i++) {
      step(sim, 0.1);
      const st = sim.entity.state as EntityState;
      checking = (st.kind === 'check' && st.spot === drawer.id) || st.kind === 'kill';
    }
    expect(checking).toBe(true);
  });
});

describe('V. The mark', () => {
  it('marks you on a near miss, tracks you across zones, and water washes it off', () => {
    const sim = makeSim({ seed: 35 });
    placePlayer(sim, 1, 16, Math.PI); // W bath, facing the tap at (0,16)
    placeEntity(sim, 60, 40);
    sim.entity.state = { kind: 'roam', dest: sim.entity.cell, pauseUntil: sim.time + 999 };
    (sim.entity as unknown as { markPlayer(why: string): void }).markPlayer('near miss');
    expect(sim.player.isMarked).toBe(true);
    step(sim, 4);
    const st = sim.entity.state as EntityState;
    expect(st.kind).toBe('investigate');
    if (st.kind === 'investigate') expect(dist(st.target, sim.player.pos)).toBeLessThan(2);
    // wash: hold E at the tap
    sim.entity.update = () => {};
    let tapNoise = 0;
    const orig = sim.director.onNoise.bind(sim.director);
    sim.director.onNoise = (n) => {
      if (n.kind === 'tap') tapNoise++;
      orig(n);
    };
    step(sim, 1 / 60, { interact: true, interactPressed: true });
    step(sim, 4.5, { interact: true });
    expect(sim.player.isMarked).toBe(false);
    expect(tapNoise).toBeGreaterThan(4); // a running tap commits you to a known, noisy spot
  });

  it('a mark that lands mid-rinse takes the full wash to come off', () => {
    const sim = makeSim({ seed: 35 });
    sedateEntity(sim);
    placePlayer(sim, 1, 16, Math.PI); // W bath, facing the tap at (0,16)
    step(sim, 1 / 60, { interact: true, interactPressed: true });
    step(sim, 1, { interact: true });
    (sim.entity as unknown as { markPlayer(why: string): void }).markPlayer('near miss');
    step(sim, 1, { interact: true });
    expect(sim.player.isMarked).toBe(true); // a plain rinse would have ended at 1.5 s
    step(sim, 2.5, { interact: true });
    expect(sim.player.isMarked).toBe(false);
  });
});

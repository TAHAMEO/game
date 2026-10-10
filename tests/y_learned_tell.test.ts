import { describe, expect, it } from 'vitest';
import { TUNING } from '../src/core/config';
import type { EntityState, Tell } from '../src/core/entity';
import { cellCenter } from '../src/core/level';
import { dist } from '../src/core/math';
import { MemoryStore } from '../src/core/persistence';
import type { Sim } from '../src/core/sim';
import { makeSim, pinStress, placeEntity, placePlayer, sedateEntity, step } from './helpers';

let tellId = 1000;
function showTell(sim: Sim, kind: Tell['kind'], fake = false, dur = 1.8): void {
  sim.director.onTell({ id: tellId++, kind, t0: sim.time, dur, fake }, 12);
}

describe('Y. Faked tells', () => {
  it('learns that you read its head-tilt, then starts lying with it', () => {
    const sim = makeSim({ seed: 1 });
    sedateEntity(sim);
    placePlayer(sim, 20, 18);
    placeEntity(sim, 26, 18, Math.PI);
    expect(sim.memory.learned('fake:tilt')).toBe(false);
    for (let i = 0; i < 3; i++) {
      showTell(sim, 'tilt');
      step(sim, 2.5); // you freeze, quietly
    }
    expect(sim.memory.data.tellStats.tilt).toEqual({ seen: 3, read: 3 });
    expect(sim.memory.learned('fake:tilt')).toBe(true);
    let fakes = 0;
    for (let i = 0; i < 60; i++) if (sim.director.shouldFake('tilt', { entity: sim.entity })) fakes++;
    expect(fakes).toBeGreaterThan(15);
    expect(fakes).toBeLessThan(60);
  });

  it('learns nothing from a player who does not read it', () => {
    const sim = makeSim({ seed: 1 });
    sedateEntity(sim);
    placePlayer(sim, 20, 18);
    for (let i = 0; i < 4; i++) {
      showTell(sim, 'tilt');
      step(sim, 2.5, { forward: 1, sprint: true }); // you keep running
      placePlayer(sim, 20, 18);
    }
    expect(sim.memory.data.tellStats.tilt.read).toBe(0);
    expect(sim.memory.learned('fake:tilt')).toBe(false);
    expect(sim.director.shouldFake('tilt', { entity: sim.entity })).toBe(false);
  });

  it('does not count its lies toward how well you read the truth', () => {
    const sim = makeSim({ seed: 1 });
    sedateEntity(sim);
    placePlayer(sim, 24, 19); // a clear run of corridor
    showTell(sim, 'turn', true, 1.4);
    step(sim, 6, { forward: 1 });
    expect(sim.memory.data.tellStats.turn.seen).toBe(0);
    expect(sim.director.adapt.fakesTaken).toBe(1);
  });

  it('a faked tilt outlasts your breath', () => {
    const sim = makeSim({ seed: 2 });
    sim.director.shouldFake = () => true;
    placePlayer(sim, 20, 18);
    placeEntity(sim, 25, 18, Math.PI);
    (sim.entity as unknown as { beginListen(p: { x: number; y: number }): void }).beginListen({ x: 20.5, y: 18.5 });
    const st = sim.entity.state;
    expect(st.kind).toBe('listen');
    if (st.kind === 'listen') {
      expect(st.fake).toBe(true);
      expect(st.until - sim.time).toBeGreaterThan(TUNING.player.breathCapacity);
    }
    expect(sim.entity.tell?.kind).toBe('tilt');
  });

  it('a faked slow turn is a feint: it stops out of sight and listens behind it', () => {
    const sim = makeSim({ seed: 3 });
    sim.director.shouldFake = (k) => k === 'turn';
    sim.director.update = () => {};
    placePlayer(sim, 12, 18, Math.PI); // facing away down the hall, out of its sight
    placeEntity(sim, 20, 18, Math.PI);
    sim.entity.lkp = { x: 12.5, y: 18.5 };
    sim.entity.startLeave(true, 'test');
    expect(sim.entity.stateKind).toBe('leave');
    step(sim, 6);
    expect(sim.entity.stateKind).toBe('feint');
    expect(sim.entity.fov()).toBeCloseTo(Math.PI * 2);
    // you move too soon
    step(sim, 1.2, { forward: -1, sprint: false });
    expect(['investigate', 'chase', 'lunge']).toContain(sim.entity.stateKind);
  });
});

describe('Y. Strategy dismantling', () => {
  /** Run one encounter that you escape by hiding in `spotId`. */
  function escapeByHiding(sim: Sim, spotId: number): void {
    const spot = sim.world.spots[spotId]!;
    const acc = cellCenter(sim.level, spot.access);
    sim.player.pos = { ...acc };
    sim.entity.state = { kind: 'chase', lostAt: sim.time, survivor: null };
    sim.entity.pos = { x: acc.x + 1, y: acc.y };
    step(sim, 0.5);
    sim.player.hidden = spot;
    spot.occupant = { kind: 'player' };
    sim.entity.state = { kind: 'rest', until: 1e9 };
    placeEntity(sim, 2, 2);
    step(sim, 9);
    sim.player.hidden = null;
    spot.occupant = null;
  }

  it('takes away the hiding place that keeps saving you', () => {
    const sim = makeSim({ seed: 4 });
    sim.entity.update = () => {};
    const lockers = sim.world.spots.filter((s) => s.kind === 'locker');
    for (let i = 0; i < 3; i++) escapeByHiding(sim, lockers[i]!.id);
    expect(sim.director.adapt.escapes).toBe(3);
    expect(sim.memory.learned('counter:hide:locker')).toBe(true);
    const locker = lockers[5]!;
    const bed = sim.world.spots.find((s) => s.kind === 'bed' && !s.cluttered)!;
    expect(sim.director.checkScore(locker, 'search') - sim.director.checkScore(bed, 'search')).toBeGreaterThan(0.5);
  });

  it('stops falling for the bottle and walks to the hand that threw it', () => {
    const sim = makeSim({ seed: 5 });
    sim.memory.learn('counter:distract');
    sim.director.update = () => {};
    placePlayer(sim, 31, 25);
    placeEntity(sim, 31, 18, 0);
    sim.entity.state = { kind: 'roam', dest: sim.entity.cell, pauseUntil: 1e9 };
    const origin = { x: 31.5, y: 25.5 };
    sim.emitNoise('glass', { x: 44.5, y: 19.5 }, 62, 'world', { origin });
    step(sim, 1 / 60);
    const st = sim.entity.state as EntityState;
    expect(st.kind).toBe('investigate');
    if (st.kind === 'investigate') expect(dist(st.target, origin)).toBeLessThan(0.1);
  });

  it('barricades your safe route', () => {
    const sim = makeSim({ seed: 6 });
    sim.director.update = () => {};
    const corridor = sim.level.regions.find((r) => r.kind === 'corridor' && r.links.some((l) => l.via >= 0 && !sim.world.doorAt.get(l.via)!.locked))!;
    sim.memory.learn(`counter:route:${corridor.id}`);
    expect(sim.director.adapt.routeCounters()).toContain(corridor.id);
    const plan = sim.director.bait.buildRouteCounter(corridor.id)!;
    expect(plan.kind).toBe('jam');
    sim.entity.startPlan(plan);
    placePlayer(sim, 2, 13); // far away, in a room
    step(sim, 90);
    const step0 = plan.steps[0]!;
    const door = sim.world.doors[step0.op === 'jam' ? step0.door : -1]!;
    expect(door.jammed).toBe(true);
    expect(sim.world.humanPassable(door.cell)).toBe(false);
  });

  it('remembers what it dismantled after you die', () => {
    const store = new MemoryStore();
    const a = makeSim({ seed: 7, store });
    a.memory.learn('counter:hide:bed');
    a.player.die('test');
    const b = makeSim({ seed: 8, store });
    expect(b.director.counterActive('hide:bed')).toBe(true);
  });
});

describe('Y. The moving goalposts', () => {
  it('treats comfort as the signal to change something', () => {
    const sim = makeSim({ seed: 9 });
    pinStress(sim, 0.05);
    sim.entity.update = () => {};
    sim.entity.state = { kind: 'roam', dest: sim.entity.cell, pauseUntil: 1e9 };
    placeEntity(sim, 2, 2);
    sim.director.profile.progress();
    step(sim, 50);
    const d = sim.director;
    expect(d.adapt.shifts).toBeGreaterThanOrEqual(1);
    expect(d.bait.forceNext || d.stalkUntil > sim.time - 10 || d.adapt.fakeBoostUntil > sim.time - 10).toBe(true);
  });
});

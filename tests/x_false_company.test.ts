import { describe, expect, it } from 'vitest';
import type { EntityState } from '../src/core/entity';
import { cellCenter } from '../src/core/level';
import { dist } from '../src/core/math';
import { makeSim, placeEntity, sedateEntity, step } from './helpers';

describe('X. False company', () => {
  it('there are others: survivors hide, talk, and grow on you', () => {
    const sim = makeSim({ seed: 60 });
    sedateEntity(sim);
    expect(sim.survivors.list).toHaveLength(2);
    const sv = sim.survivors.list[0]!;
    expect(sv.spot?.occupant).toEqual({ kind: 'survivor', id: sv.id });
    sim.survivors.whisperOccupied(sv.id);
    expect(sv.met).toBe(true);
    expect(sv.spot).toBeNull();
    const before = sv.attachment;
    sim.survivors.talk(sv.id);
    expect(sv.attachment).toBeGreaterThan(before);
    const subs = sim.drainEvents().filter((e) => e.type === 'subtitle');
    expect(subs.every((e) => e.type === 'subtitle' && e.speaker === sv.def.name)).toBe(true);
  });

  it('a real survivor calls for help when it comes for them', () => {
    const sim = makeSim({ seed: 61 });
    const sv = sim.survivors.list[0]!;
    sim.entity.update = () => {};
    sim.entity.state = { kind: 'hunt', center: { ...sv.pos }, radius: 3, until: 1e9, point: -1, reason: 'test', checks: [], trail: 0 };
    sim.entity.pos = { x: sv.pos.x + 2, y: sv.pos.y };
    const voices = sim.recentNoises.length;
    const events = step(sim, 0.5);
    const call = events.find((e) => e.type === 'subtitle' && e.speaker === sv.def.name);
    expect(call && call.type === 'subtitle' && call.mimic).toBeFalsy();
    expect(sim.recentNoises.length).toBeGreaterThan(voices);
    expect(sim.recentNoises.some((n) => n.kind === 'voice' && n.source === 'survivor')).toBe(true);
  });

  it('THE MIMIC wears their name and their exact voice', () => {
    const sim = makeSim({ seed: 62 });
    sedateEntity(sim);
    const sv = sim.survivors.list[1]!;
    sim.survivors.mimicCall(sv.id, { x: 31.5, y: 18.5 });
    const ev = sim.drainEvents().find((e) => e.type === 'subtitle')!;
    expect(ev.type === 'subtitle' && ev.speaker).toBe(sv.def.name);
    expect(ev.type === 'subtitle' && ev.voice).toEqual({ pitch: sv.def.pitch, rate: sv.def.rate });
    // Only the designer can tell: the flag and the noise source.
    expect(ev.type === 'subtitle' && ev.mimic).toBe(true);
    const n = sim.recentNoises[sim.recentNoises.length - 1]!;
    expect(n.kind).toBe('voice');
    expect(n.source).toBe('entity');
  });

  it('ATTACHMENT AS A WEAPON: it prefers the voices you answer to, and the ones already gone', () => {
    const counts = [0, 0];
    for (let seed = 1; seed <= 60; seed++) {
      const sim = makeSim({ seed, tier: 3 });
      sim.survivors.list[0]!.attachment = 6;
      sim.survivors.list[0]!.met = true;
      const plan = sim.director.bait.buildMimic();
      const st = plan?.steps[0];
      if (st?.op === 'mimic') counts[st.survivor]!++;
    }
    expect(counts[0]!).toBeGreaterThan(counts[1]! * 2);

    const gone = [0, 0];
    for (let seed = 1; seed <= 60; seed++) {
      const sim = makeSim({ seed, tier: 3 });
      sim.survivors.kill(1, 'test');
      const plan = sim.director.bait.buildMimic();
      const st = plan?.steps[0];
      if (st?.op === 'mimic') gone[st.survivor]!++;
    }
    expect(gone[1]!).toBeGreaterThan(gone[0]!);
  });

  it('following it is fatal: the disguise drops when you get close', () => {
    const sim = makeSim({ seed: 63, tier: 3 });
    sim.director.update = () => {};
    const sv = sim.survivors.list[0]!;
    placeEntity(sim, 40, 18);
    sim.entity.state = { kind: 'mimic', survivor: sv.id, cell: sim.entity.cell, until: 1e9, nextCall: 0, arrived: true };
    sim.player.pos = { x: 30.5, y: 18.5 };
    step(sim, 0.2);
    expect(sim.entity.disguise).toBe(sv.id);
    sim.player.pos = { x: 38.5, y: 18.5 };
    step(sim, 0.1);
    const st = sim.entity.state as EntityState;
    expect(st.kind).toBe('lunge');
    expect(sim.entity.disguise).toBeNull();
  });

  it('ALREADY GONE: a survivor it kills is dragged home, and remembered', () => {
    const sim = makeSim({ seed: 64 });
    sedateEntity(sim);
    const sv = sim.survivors.list[0]!;
    sim.survivors.kill(sv.id, 'test');
    expect(sv.alive).toBe(false);
    expect(sim.memory.data.survivorsLost.map((s) => s.name)).toContain(sv.def.name);
    const nest = sim.level.regions.find((r) => r.kind === 'nest')!;
    sim.survivors.depositBody(sv.id, cellCenter(sim.level, nest.center));
    const body = sim.world.props.find((p) => p.kind === 'survivorBody' && p.label === sv.def.name);
    expect(body).toBeDefined();
    expect(dist(body!.pos, cellCenter(sim.level, nest.center))).toBeLessThan(1);
  });
});

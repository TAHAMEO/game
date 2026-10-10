import { describe, expect, it } from 'vitest';
import type { EntityState } from '../src/core/entity';
import { cellCenter } from '../src/core/level';
import { dist } from '../src/core/math';
import { makeSim, placeEntity, placePlayer, sedateEntity, step } from './helpers';

const press = { interactPressed: true, interact: true };

describe('U. Corrupted objectives', () => {
  it('THE BREAKER: needs three fuses, lights up the whole map, and is heard from anywhere', () => {
    const sim = makeSim({ seed: 40 });
    placePlayer(sim, 37, 41, Math.PI / 2); // facing the fuse box at (37,42)
    placeEntity(sim, 2, 3);
    sim.entity.state = { kind: 'roam', dest: sim.entity.cell, pauseUntil: 1e9 };
    const events = step(sim, 1 / 60, press);
    expect(sim.player.channel).toBeNull();
    expect(events.some((e) => e.type === 'notice' && /fuse/.test(e.text))).toBe(true);

    sim.player.inv.fuses = 3;
    step(sim, 1 / 60, press);
    expect(sim.player.channel?.kind).toBe('breaker');
    step(sim, 3.6, { interact: true });
    expect(sim.objectives.powerOn).toBe(true);
    expect(sim.world.lighting.powered).toBe(true);
    const breaker = sim.recentNoises.find((n) => n.kind === 'breaker');
    expect(breaker?.entityLevel ?? 0).toBeGreaterThanOrEqual(60);
    step(sim, 0.1);
    expect(sim.entity.stateKind).toBe('investigate');
    expect(sim.entity.reason).toMatch(/breaker/);
    expect(sim.memory.learned('breaker')).toBe(true);
  });

  it('THE BREAKER AMBUSH: once learned, it waits in the dark beside the fuse box', () => {
    const sim = makeSim({
      seed: 41,
      features: { herding: false, offeredSafety: false, darknessFunnels: false, objectRelocation: false, mimicSurvivors: false },
    });
    sim.memory.learn('breaker');
    sim.player.inv.fuses = 3;
    sim.director.bait.cooldownUntil = 0;
    const plan = sim.director.bait.choose(sim.entity);
    expect(plan?.kind).toBe('breakerAmbush');
    const amb = plan!.steps.find((s) => s.op === 'ambush');
    expect(amb).toBeDefined();
    if (amb?.op === 'ambush') {
      const d = dist(cellCenter(sim.level, amb.cell), cellCenter(sim.level, sim.world.fuseBox.access));
      expect(d).toBeGreaterThanOrEqual(2.5);
      expect(d).toBeLessThanOrEqual(5);
    }
  });

  it('THE RESCUE CALL is real — until it knows the voice', () => {
    const honest = makeSim({ seed: 42, tier: 0 });
    sedateEntity(honest);
    honest.objectives.powerOn = true;
    honest.objectives.useRadio();
    const ev = honest.drainEvents().find((e) => e.type === 'subtitle');
    expect(honest.objectives.calls[0]!.fake).toBe(false);
    expect(honest.objectives.calls[0]!.gate).toBe(honest.objectives.realGate);
    expect(ev && ev.type === 'subtitle' && ev.radio).toBe(true);

    let fakes = 0;
    for (let seed = 1; seed <= 12; seed++) {
      const sim = makeSim({ seed, tier: 4 });
      sim.objectives.powerOn = true;
      sim.objectives.useRadio();
      const call = sim.objectives.calls[0]!;
      if (!call.fake) continue;
      fakes++;
      expect(call.gate).not.toBe(sim.objectives.realGate);
      const st = sim.entity.state as EntityState;
      expect(st.kind === 'plan' && st.plan.kind === 'radioAmbush').toBe(true);
      // Nothing in the words gives it away at the top tier.
      expect(call.text).not.toMatch(/we— we|Stay… stay/);
    }
    expect(fakes).toBeGreaterThan(0);
  });

  it('only the real gate opens when rescue arrives', () => {
    const sim = makeSim({ seed: 43, tier: 0 });
    sedateEntity(sim);
    sim.objectives.powerOn = true;
    sim.objectives.useRadio();
    placePlayer(sim, 31, 25);
    step(sim, 101);
    expect(sim.objectives.arrived).toBe(true);
    const real = sim.world.gates.find((g) => g.id === sim.objectives.realGate)!;
    const other = sim.world.gates.find((g) => g.id !== sim.objectives.realGate)!;
    expect(sim.objectives.gateOpen(real)).toBe(true);
    expect(sim.objectives.gateOpen(other)).toBe(false);
    sim.objectives.escapeThrough(other);
    expect(sim.phase).toBe('playing');
    sim.objectives.escapeThrough(real);
    expect(sim.phase).toBe('escaped');
    expect(sim.memory.data.escapes).toBe(1);
  });

  it('FALSE LEADS: the hospital wastes your time; the Entity spends it', () => {
    const off = makeSim({ seed: 44, features: { falseLeads: false } });
    expect(off.world.notes.some((n) => n.falseLead)).toBe(false);

    const sim = makeSim({ seed: 44 });
    sedateEntity(sim);
    const lie = sim.world.notes.find((n) => n.falseLead && n.pointsToZone !== null && sim.world.falseLeadZones.has(n.pointsToZone))!;
    expect(lie).toBeDefined();
    lie.read = true;
    const zoneCell = sim.level.regions.find((r) => r.zone === lie.pointsToZone)!.center;
    sim.player.pos = cellCenter(sim.level, zoneCell);
    step(sim, 20);
    expect(sim.director.debt.lingering.falseLeads).toBeGreaterThan(15);

    // the pharmacy will never open
    placePlayer(sim, 42, 19, Math.PI / 2); // facing the pharmacy door to the south
    const events = step(sim, 1 / 60, press);
    expect(events.some((e) => e.type === 'notice' && /PHARMACY/.test(e.text))).toBe(true);
  });
});

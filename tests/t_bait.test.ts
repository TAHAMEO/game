import { describe, expect, it } from 'vitest';
import { cellAt, cellCenter } from '../src/core/level';
import { dist } from '../src/core/math';
import type { Plan, PlanStep } from '../src/core/plans';
import type { Sim } from '../src/core/sim';
import type { Noise } from '../src/core/types';
import { cell, makeSim, placePlayer, step } from './helpers';

/** The Director stops improvising so a single plan can be observed end to end. */
function controlled(sim: Sim, target: number): void {
  const d = sim.director as unknown as { considerPlans(): void; punishingPause(): void };
  d.considerPlans = () => {};
  d.punishingPause = () => {};
  sim.director.nextActivity = (e) => ({ kind: 'roam', cell: e.cell, reason: 'test idle' });
  sim.objectives.predictedTarget = () => target;
  // The player is a statue the Entity cannot see: these tests are about the plans, not perception.
  sim.entity.sightOfPlayer = () => ({ vis: 0, beam: false });
}

function run(sim: Sim, plan: Plan): void {
  sim.director.bait.active = plan;
  sim.entity.startPlan(plan);
}

function stepUntil(sim: Sim, max: number, done: () => boolean): boolean {
  for (let t = 0; t < max; t += 0.25) {
    step(sim, 0.25);
    if (done()) return true;
  }
  return false;
}

const find = <K extends PlanStep['op']>(plan: Plan, op: K) => plan.steps.find((s) => s.op === op) as Extract<PlanStep, { op: K }> | undefined;

describe('T. The bait economy', () => {
  it('OFFERED SAFETY: leaves a hiding place open on your route — then comes to check it', () => {
    const sim = makeSim({ seed: 21, tier: 0 });
    placePlayer(sim, 31, 25, Math.PI / 2);
    controlled(sim, cell(sim, 50, 13));
    const plan = sim.director.bait.buildOffer();
    expect(plan).not.toBeNull();
    const bait = find(plan!, 'ajar') ?? find(plan!, 'clear');
    expect(bait).toBeDefined();
    const spot = sim.world.spots[bait!.spot]!;
    run(sim, plan!);
    expect(stepUntil(sim, 90, () => spot.baited)).toBe(true);
    expect(spot.kind === 'bed' ? !spot.cluttered : spot.ajar).toBe(true);
    // you take the bait
    sim.player.pos = cellCenter(sim.level, spot.access);
    sim.player.hidden = spot;
    spot.occupant = { kind: 'player' };
    let checked = false;
    stepUntil(sim, 40, () => {
      const s = sim.entity.state;
      checked ||= (s.kind === 'check' && s.spot === spot.id) || (s.kind === 'kill' && s.spot === spot.id) || !sim.player.alive;
      return checked;
    });
    expect(checked).toBe(true);
  });

  it('HERDING: waits where you are going, then knocks on the ducts behind you', () => {
    const sim = makeSim({ seed: 22, tier: 1 });
    placePlayer(sim, 20, 18, 0);
    controlled(sim, cell(sim, 50, 13));
    const plan = sim.director.bait.buildHerd();
    expect(plan).not.toBeNull();
    const amb = find(plan!, 'ambush')!;
    let knock: Noise | null = null;
    let entityAtKnock = { x: 0, y: 0 };
    const orig = sim.director.onNoise.bind(sim.director);
    sim.director.onNoise = (n) => {
      if (n.kind === 'knock' && !knock) {
        knock = n;
        entityAtKnock = { ...sim.entity.pos };
      }
      orig(n);
    };
    run(sim, plan!);
    expect(stepUntil(sim, 120, () => knock !== null)).toBe(true);
    const k = knock as unknown as Noise;
    // It is already in position when the noise happens…
    expect(cellAt(sim.level, entityAtKnock)).toBe(amb.cell);
    // …and the noise comes from behind you, relative to where it waits.
    expect(dist(k.pos, amb.watch)).toBeGreaterThan(dist(sim.player.pos, amb.watch) + 4);
    expect(dist(k.pos, sim.entity.pos)).toBeGreaterThan(6);
    expect(sim.entity.stateKind).toBe('plan');
  });

  it('OBJECT RELOCATION: moves what you need into a dead end and camps the approach', () => {
    const sim = makeSim({ seed: 23, tier: 2 });
    placePlayer(sim, 31, 25, Math.PI / 2);
    controlled(sim, cell(sim, 50, 13));
    const plan = sim.director.bait.buildRelocate();
    expect(plan).not.toBeNull();
    const item = sim.world.items.find((i) => i.id === find(plan!, 'pickup')!.item)!;
    expect(['fuse', 'key']).toContain(item.kind);
    run(sim, plan!);
    expect(stepUntil(sim, 240, () => item.relocated && item.state === 'ground')).toBe(true);
    const region = sim.level.regions[sim.level.regionOf[cellAt(sim.level, item.pos)]!]!;
    expect(region.deadEnd).toBe(true);
    expect(stepUntil(sim, 120, () => {
      const s = sim.entity.state;
      return s.kind === 'plan' && s.plan.steps[s.step]?.op === 'ambush' && s.arrived;
    })).toBe(true);
    const amb = find(plan!, 'ambush')!;
    expect(dist(sim.entity.pos, cellCenter(sim.level, amb.cell))).toBeLessThan(0.6);
  });

  it('DARKNESS FUNNELS: kills the lights on one route and leaves the other lit', () => {
    const sim = makeSim({ seed: 24, tier: 1 });
    sim.world.lighting.setPower(true);
    placePlayer(sim, 31, 25, Math.PI / 2);
    controlled(sim, cell(sim, 50, 13));
    const plan = sim.director.bait.buildFunnel();
    expect(plan).not.toBeNull();
    const kills = plan!.steps.filter((s) => s.op === 'killLight').map((s) => (s.op === 'killLight' ? s.fixture : -1));
    expect(kills.length).toBeGreaterThan(0);
    run(sim, plan!);
    expect(stepUntil(sim, 300, () => kills.every((id) => sim.world.lighting.fixtures[id]!.broken))).toBe(true);
    const amb = find(plan!, 'ambush')!;
    // The kept route — where it waits — is still lit.
    expect(sim.world.lighting.sample(amb.watch)).toBeGreaterThan(0.05);
  });

  it('an ambush springs on its killing ground, not on noises elsewhere', () => {
    function waiting(): Sim {
      const sim = makeSim({ seed: 4, tier: 0, features: { survivors: false } });
      controlled(sim, cell(sim, 28, 18));
      placePlayer(sim, 31, 24);
      sim.player.update = () => {};
      sim.entity.pos = { x: 20.5, y: 18.5 };
      const ground = { x: 28.5, y: 18.5 };
      run(sim, { id: 77, kind: 'herd', section: 'T', steps: [{ op: 'ambush', cell: cell(sim, 20, 18), facing: 0, duration: 60, watch: ground, radius: 3 }], reason: 'test', created: 0 });
      step(sim, 1);
      expect(sim.entity.stateKind).toBe('plan');
      return sim;
    }
    // A footstep on the watched ground, eight cells in front of it: the trap springs.
    const a = waiting();
    a.emitNoise('step', { x: 28.5, y: 18.5 }, 40, 'player');
    step(a, 0.1);
    expect(a.entity.stateKind).toBe('investigate');
    // A footstep five cells behind it, far from the ground: it keeps waiting.
    const b = waiting();
    b.emitNoise('step', { x: 15.5, y: 18.5 }, 30, 'player');
    step(b, 0.1);
    expect(b.entity.stateKind).toBe('plan');
  });

  it('a head-tilt pauses a plan: it goes back to it, and the plan is reported once', () => {
    const sim = makeSim({ seed: 3, tier: 0, features: { survivors: false } });
    controlled(sim, cell(sim, 31, 18));
    placePlayer(sim, 31, 24);
    sim.player.update = () => {};
    sim.entity.pos = { x: 31.5, y: 18.5 };
    const plan: Plan = { id: 999, kind: 'offer', section: 'T', steps: [{ op: 'wait', duration: 6 }], reason: 'paused plan', created: 0 };
    run(sim, plan);
    step(sim, 1);
    sim.emitNoise('step', sim.entity.pos, sim.entity.hearingThreshold() + 3, 'player');
    let listened = false;
    for (let i = 0; i < 12 * 60; i++) {
      step(sim, 1 / 60);
      if (sim.entity.stateKind === 'listen') {
        listened = true;
        expect(sim.director.bait.active).toBe(plan);
      }
    }
    expect(listened).toBe(true);
    expect(sim.director.bait.history.filter((h) => h.reason === 'paused plan').map((h) => h.outcome)).toEqual(['done']);
  });

  it('a plan cut short by a new one is reported once', () => {
    const sim = makeSim({ seed: 3, tier: 0, features: { survivors: false } });
    controlled(sim, cell(sim, 31, 18));
    placePlayer(sim, 31, 24);
    const first: Plan = { id: 1001, kind: 'offer', section: 'T', steps: [{ op: 'wait', duration: 30 }], reason: 'first plan', created: 0 };
    const second: Plan = { id: 1002, kind: 'herd', section: 'T', steps: [{ op: 'wait', duration: 30 }], reason: 'second plan', created: 0 };
    run(sim, first);
    step(sim, 1);
    sim.director.bait.interject(second);
    expect(sim.director.bait.history.filter((h) => h.reason === 'first plan').map((h) => h.outcome)).toEqual(['interrupted']);
    expect(sim.director.bait.active).toBe(second);
  });

  it('logs every plan it tries, for the designer', () => {
    const sim = makeSim({ seed: 25, tier: 3 });
    placePlayer(sim, 31, 25);
    step(sim, 240);
    expect(sim.designerLog.some((l) => l.tag === 'T' || l.tag === 'U' || l.tag === 'X' || l.tag === 'Y')).toBe(true);
  });
});

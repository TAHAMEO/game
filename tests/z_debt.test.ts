import { describe, expect, it } from 'vitest';
import { Debt } from '../src/core/director/debt';
import { makeSim, placePlayer, sedateEntity, step } from './helpers';

const idle = { hiddenFor: 0, sinceProgress: 0, speed: 1, inFalseLead: false };

describe('Z. The debt — a rising floor', () => {
  it('rises monotonically with the clock: quiet early, relentless late', () => {
    const d = new Debt(true);
    let prev = d.floor;
    const samples: number[] = [];
    for (let t = 0; t < 1200; t++) {
      d.update(1, idle);
      expect(d.floor).toBeGreaterThanOrEqual(prev);
      prev = d.floor;
      if (t === 59 || t === 299 || t === 899) samples.push(d.floor);
    }
    expect(samples[0]).toBeLessThan(0.15); // 1 minute
    expect(samples[1]).toBeGreaterThan(0.35); // 5 minutes
    expect(samples[2]).toBeGreaterThan(0.75); // 15 minutes
  });

  it('charges extra for lingering: over-hiding, false leads, indecision', () => {
    const base = new Debt(true);
    const hiding = new Debt(true);
    const lured = new Debt(true);
    const dithering = new Debt(true);
    for (let i = 0; i < 120; i++) {
      base.update(1, idle);
      hiding.update(1, { ...idle, hiddenFor: 40 });
      lured.update(1, { ...idle, inFalseLead: true });
      dithering.update(1, { ...idle, sinceProgress: 200, speed: 0 });
    }
    expect(hiding.floor).toBeGreaterThan(base.floor);
    expect(lured.floor).toBeGreaterThan(hiding.floor);
    expect(dithering.floor).toBeGreaterThan(base.floor);
    expect(hiding.lingering.overHiding).toBe(120);
    expect(lured.lingering.falseLeads).toBe(120);
  });

  it('can be switched off', () => {
    const d = new Debt(false);
    for (let i = 0; i < 600; i++) d.update(1, idle);
    expect(d.floor).toBe(0);
  });

  it('sharpens the Entity: it hears more as the floor rises', () => {
    const sim = makeSim({ seed: 1 });
    sedateEntity(sim);
    const early = sim.entity.hearingThreshold();
    sim.director.debt.effectiveTime = 2000;
    step(sim, 1 / 60);
    expect(sim.director.floor).toBeGreaterThan(0.9);
    expect(sim.entity.hearingThreshold()).toBeLessThan(early - 5);
    expect(sim.director.sightMultiplier()).toBeGreaterThan(1.2);
  });

  it('shrinks the silences: late relax windows are a fraction of early ones', () => {
    const relaxAt = (effectiveTime: number) => {
      const sim = makeSim({ seed: 2 });
      sedateEntity(sim);
      placePlayer(sim, 31, 25);
      sim.director.debt.effectiveTime = effectiveTime;
      sim.director.phase = 'peak';
      sim.director.menace = 1;
      step(sim, 1 / 60);
      expect(sim.director.phase).toBe('relax');
      return (sim.director as unknown as { relaxDur: number }).relaxDur;
    };
    const early = relaxAt(0);
    const late = relaxAt(3000);
    expect(early).toBeGreaterThan(40);
    expect(late).toBeLessThan(12);
  });

  it('is never shown: the game sends no timer to the player', () => {
    const sim = makeSim({ seed: 3 });
    const events = step(sim, 120);
    for (const e of events) if (e.type === 'notice') expect(e.text).not.toMatch(/\d+:\d\d|seconds|minutes left/);
  });
});

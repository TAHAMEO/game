import { describe, expect, it } from 'vitest';
import { Perception, VIEW_FOV } from '../src/core/director/perception';
import { cellAt, Tile } from '../src/core/level';
import { angleDiff, angleTo, dist } from '../src/core/math';
import { makeSim, pinStress, placeEntity, placePlayer, sedateEntity, step } from './helpers';

describe('S. Unreliable senses — perceptual noise', () => {
  it('produces no false signals for a calm player, and more as stress rises', () => {
    expect(Perception.rate(0)).toBe(0);
    expect(Perception.rate(0.25)).toBe(0);
    expect(Perception.rate(0.5)).toBeGreaterThan(0);
    expect(Perception.rate(1)).toBeGreaterThan(Perception.rate(0.6));
    expect(Perception.rate(1)).toBeLessThanOrEqual(0.25);

    const calm = makeSim({ seed: 3 });
    sedateEntity(calm);
    pinStress(calm, 0.1);
    step(calm, 180);
    expect(calm.director.perception.emitted).toBe(0);

    const scared = makeSim({ seed: 3 });
    sedateEntity(scared);
    pinStress(scared, 0.95);
    placePlayer(scared, 20, 18, 0); // Main Hall, dark (power is out)
    step(scared, 180);
    expect(scared.director.perception.emitted).toBeGreaterThan(5);
  });

  it('puts shapes only at the edge of vision, in the dark, in line of sight — never centre-screen', () => {
    const sim = makeSim({ seed: 9 });
    sedateEntity(sim);
    pinStress(sim, 1);
    // An open room: in a 2-wide corridor the edge of vision is wall, so shapes (correctly)
    // never appear there — footsteps and doors do instead.
    placePlayer(sim, 25, 24, 0.15);
    let shapes = 0;
    for (let i = 0; i < 2400; i++) {
      step(sim, 1 / 60);
      for (const ph of sim.director.perception.phantoms) {
        if (ph.born !== sim.time) continue;
        shapes++;
        const off = Math.abs(angleDiff(sim.player.angle, angleTo(sim.player.pos, ph.pos)));
        expect(off).toBeGreaterThan(VIEW_FOV / 2 - 0.12);
        expect(off).toBeLessThanOrEqual(VIEW_FOV / 2);
        expect(sim.world.lighting.sample(ph.pos)).toBeLessThanOrEqual(0.12);
        expect(sim.level.tiles[cellAt(sim.level, ph.pos)]).toBe(Tile.Floor);
        expect(sim.world.los(sim.player.pos, ph.pos)).toBe(true);
        expect(dist(sim.player.pos, ph.pos)).toBeGreaterThanOrEqual(5);
      }
    }
    expect(shapes).toBeGreaterThan(0);
  });

  it('makes a shape vanish the moment you look straight at it', () => {
    const sim = makeSim({ seed: 9 });
    sedateEntity(sim);
    placePlayer(sim, 12, 18, 0);
    const pos = { x: 12.5 + Math.cos(0.5) * 6, y: 18.5 + Math.sin(0.5) * 6 };
    sim.director.perception.phantoms.push({ id: 1, pos, angle: 0, born: sim.time, until: sim.time + 99, pose: 'idle' });
    step(sim, 0.1);
    expect(sim.director.perception.phantoms).toHaveLength(1);
    sim.player.angle = angleTo(sim.player.pos, pos);
    step(sim, 0.05);
    expect(sim.director.perception.phantoms).toHaveLength(0);
  });

  it('phantom sounds reach your ears but never the Entity', () => {
    const sim = makeSim({ seed: 2 });
    sedateEntity(sim);
    placePlayer(sim, 20, 18, 0);
    placeEntity(sim, 26, 18);
    const before = sim.recentNoises.length;
    sim.emitPhantomSound('entityStep', { x: 24.5, y: 18.5 }, 27);
    const events = sim.drainEvents();
    expect(events.some((e) => e.type === 'sound' && e.phantom && e.kind === 'entityStep')).toBe(true);
    expect(sim.recentNoises.length).toBe(before);
  });

  it('a flinch at a ghost is logged and feeds the stress it came from', () => {
    const sim = makeSim({ seed: 4 });
    sedateEntity(sim);
    placePlayer(sim, 20, 18, 0);
    sim.director.stress.update = () => {};
    sim.director.stress.value = 0.5;
    const p = sim.director.perception as unknown as { record(kind: string, pos: { x: number; y: number }): void };
    p.record('steps', { x: 14.5, y: 18.5 });
    const spikeBefore = sim.director.stress.spikes;
    sim.director.perception.noteAction('threw a bottle');
    expect(sim.director.profile.ghostReactions).toBe(1);
    expect(sim.director.stress.spikes).toBeGreaterThan(spikeBefore);
  });
});

describe('S. The flashlight tax', () => {
  function relyOnTheTorch(sim: ReturnType<typeof makeSim>): void {
    sim.director.profile.update = () => {};
    sim.director.profile.flashlightReliance = 0.9;
  }

  it('lets the light feel safe first: the Entity backs away from the beam', () => {
    const sim = makeSim({ seed: 5 });
    relyOnTheTorch(sim);
    placePlayer(sim, 12, 18, 0);
    placeEntity(sim, 20, 18, Math.PI);
    sim.entity.update = () => {};
    step(sim, 75);
    expect(sim.director.flashTax.phase).toBe('lull');
    expect(sim.director.beamResponse()).toBe('respect');
  });

  it('betrays you at the moment you depend on it, then the beam is a beacon', () => {
    const sim = makeSim({ seed: 5 });
    relyOnTheTorch(sim);
    sim.director.flashTax.phase = 'lull';
    sim.director.flashTax.lullEvents = 2;
    placePlayer(sim, 12, 18, 0); // dark hall, power out
    sim.player.flashlight.on = true;
    placeEntity(sim, 20, 18, Math.PI);
    step(sim, 1 / 60);
    expect(sim.director.flashTax.phase).toBe('betray');
    expect(sim.player.flashlight.on).toBe(false);
    expect(sim.player.flashlight.faultUntil).toBeGreaterThan(sim.time + 3);
    expect(sim.entity.stateKind).toBe('investigate');
    sedateEntity(sim); // (otherwise it simply kills you here)
    step(sim, 9);
    expect(sim.director.flashTax.phase).toBe('exposed');
    expect(sim.director.beamMultiplier()).toBeGreaterThan(1.5);
    expect(sim.memory.learned('beam')).toBe(true);
  });

  it('has no meter: nothing the player is sent mentions stress', () => {
    const sim = makeSim({ seed: 6 });
    pinStress(sim, 0.9);
    const events = step(sim, 60);
    for (const e of events) {
      if (e.type === 'notice' || e.type === 'subtitle') expect(e.text.toLowerCase()).not.toMatch(/stress|sanity|panic|fear level/);
    }
  });
});

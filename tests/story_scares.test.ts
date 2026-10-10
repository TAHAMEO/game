import { describe, expect, it } from 'vitest';
import { cellAt, cellCenter } from '../src/core/level';
import { dist } from '../src/core/math';
import { MemoryStore } from '../src/core/persistence';
import { CASE_FILES, endingFor } from '../src/core/storyText';
import type { GameEvent } from '../src/core/types';
import { at, makeSim, pinStress, placeEntity, placePlayer, sedateEntity, step } from './helpers';

describe('The story', () => {
  it('hides the next two case-file pages on free item spots, and a found page stays found', () => {
    const store = new MemoryStore();
    const sim = makeSim({ seed: 21, story: true, store });
    sedateEntity(sim);
    const recs = sim.world.items.filter((i) => i.kind === 'record');
    expect(recs.map((r) => r.recordId)).toEqual([0, 1]);
    for (const r of recs) {
      const others = sim.world.items.filter((i) => i !== r && cellAt(sim.level, i.pos) === cellAt(sim.level, r.pos));
      expect(others).toHaveLength(0);
    }
    const rec = recs[0]!;
    placePlayer(sim, Math.floor(rec.pos.x), Math.floor(rec.pos.y), 0);
    sim.player.pos = { x: rec.pos.x - 0.7, y: rec.pos.y };
    sim.drainEvents();
    step(sim, 1 / 60, { interactPressed: true });
    expect(rec.state).toBe('taken');
    expect(sim.player.readingRecord).toBe(0);
    expect(sim.memory.data.story.found).toContain(0);
    const next = makeSim({ seed: 22, story: true, store });
    expect(next.world.items.filter((i) => i.kind === 'record').map((r) => r.recordId)).toEqual([1, 2]);
  });

  it('shows a vision the first time you walk into a zone that has one — the Old Wing only ever once', () => {
    const store = new MemoryStore();
    const sim = makeSim({ seed: 23, story: true, store });
    sedateEntity(sim);
    step(sim, 21);
    placePlayer(sim, 13, 4, 0); // Old Wing
    const events = step(sim, 0.5);
    const v = events.find((e): e is Extract<GameEvent, { type: 'story' }> => e.type === 'story' && e.beat.kind === 'vision');
    expect(v).toBeDefined();
    expect(v!.to).toBe(0);
    if (v!.beat.kind === 'vision') expect(v!.beat.id).toBe('oldwing');
    expect(sim.memory.data.story.visions).toContain('oldwing');
    sim.memory.save();
    const again = makeSim({ seed: 24, story: true, store });
    sedateEntity(again);
    step(again, 21);
    placePlayer(again, 13, 4, 0);
    expect(step(again, 0.5).some((e) => e.type === 'story' && e.beat.kind === 'vision')).toBe(false);
  });

  it('whispers to you when it has been quiet too long', () => {
    const sim = makeSim({ seed: 25, story: true });
    sedateEntity(sim);
    const events = step(sim, 240);
    expect(events.some((e) => e.type === 'story' && e.beat.kind === 'whisper')).toBe(true);
  });

  it('turned off, there is no story at all — and the world is the same', () => {
    const on = makeSim({ seed: 26, story: true });
    const off = makeSim({ seed: 26, story: false });
    expect(off.world.items.some((i) => i.kind === 'record')).toBe(false);
    const plain = (s: typeof on) => s.world.items.filter((i) => i.kind !== 'record').map((i) => [i.kind, i.pos]);
    expect(plain(on)).toEqual(plain(off));
    sedateEntity(off);
    expect(step(off, 200).some((e) => e.type === 'story')).toBe(false);
  });

  it('has a true ending, and only for someone who found every page', () => {
    expect(endingFor('escaped', 'X', '', CASE_FILES.length, CASE_FILES.length).trueEnding).toBe(true);
    expect(endingFor('escaped', 'X', '', CASE_FILES.length - 1, CASE_FILES.length).trueEnding).toBe(false);
    expect(endingFor('dead', 'X', 'It caught you.', CASE_FILES.length, CASE_FILES.length).title).toMatch(/kept you/);
    const sim = makeSim({ seed: 27, story: true });
    sim.memory.data.story.found = CASE_FILES.map((f) => f.id);
    sim.onEscape();
    expect(sim.story.ending(sim.player).trueEnding).toBe(true);
    expect(sim.memory.data.story.endings).toContain('true');
  });

  it('writes its own words on the walls, and the page with no number has your name on it', () => {
    const sim = makeSim({ seed: 28, story: true });
    expect(sim.story.writings.length).toBeGreaterThan(3);
    const page = sim.story.recordText(10, sim.player)!;
    expect(page.text).toContain(sim.player.name);
    expect(sim.story.intro().join(' ')).toContain(sim.player.name);
  });
});

describe('Jump scares', () => {
  it('off means off', () => {
    const sim = makeSim({ seed: 31, scares: 'off' });
    sedateEntity(sim);
    pinStress(sim, 1);
    placePlayer(sim, 20, 18, 0);
    expect(step(sim, 600).some((e) => e.type === 'scare')).toBe(false);
  });

  it('are staged by the Director: not in the first quiet stretch, and never back to back', () => {
    const sim = makeSim({ seed: 32, scares: 'normal' });
    sedateEntity(sim);
    pinStress(sim, 1);
    placePlayer(sim, 25, 24, 0.15);
    const times: number[] = [];
    for (let i = 0; i < 900 * 4; i++) {
      for (const e of step(sim, 0.25)) if (e.type === 'scare') times.push(sim.time);
    }
    expect(times.length).toBeGreaterThan(1);
    expect(times[0]!).toBeGreaterThan(75);
    for (let i = 1; i < times.length; i++) expect(times[i]! - times[i - 1]!).toBeGreaterThan(40);
  });

  it('a falling ceiling tile is a real noise: the Entity can hear it', () => {
    const sim = makeSim({ seed: 33, scares: 'normal' });
    sedateEntity(sim);
    placePlayer(sim, 20, 18, 0);
    const scares = sim.scares as unknown as { build(pl: unknown, kind: string): boolean };
    expect(scares.build(sim.player, 'drop')).toBe(true);
    const thud = sim.recentNoises.find((n) => n.kind === 'thud');
    expect(thud).toBeDefined();
    expect(sim.world.props.some((p) => p.label === 'a ceiling tile')).toBe(true);
    const ev = sim.drainEvents().find((e) => e.type === 'scare');
    expect(ev && ev.type === 'scare' && ev.phantom).toBe(false);
  });

  it('turn around after footsteps behind you, and it is there', () => {
    const sim = makeSim({ seed: 34, scares: 'normal' });
    sedateEntity(sim);
    placePlayer(sim, 30, 24, 0);
    const scares = sim.scares as unknown as { build(pl: unknown, kind: string): boolean };
    expect(scares.build(sim.player, 'behind')).toBe(true);
    sim.drainEvents();
    step(sim, 0.3);
    sim.player.angle = Math.PI;
    const ev = step(sim, 0.1).find((e): e is Extract<GameEvent, { type: 'scare' }> => e.type === 'scare');
    expect(ev?.kind).toBe('behind');
    expect(dist(ev!.pos!, sim.player.pos)).toBeLessThan(2);
  });

  it('its real strike is flagged as a scare for the one it hit', () => {
    const sim = makeSim({ seed: 35, scares: 'normal' });
    placePlayer(sim, 20, 18, 0);
    placeEntity(sim, 21, 18, Math.PI);
    sim.entity.state = { kind: 'lunge', t: 0, struck: false, recover: 0, survivor: null, player: 0 };
    const events = step(sim, 1);
    expect(events.some((e) => e.type === 'scare' && e.kind === 'lunge' && !e.phantom && e.to === 0)).toBe(true);
  });

  it('lightning comes for everyone at once', () => {
    const sim = makeSim({ seed: 36, players: 2 });
    sedateEntity(sim);
    const flashes = step(sim, 120).filter((e) => e.type === 'lightning');
    expect(flashes.length).toBeGreaterThan(0);
    expect(flashes.every((e) => e.to === undefined)).toBe(true);
    void at;
    void cellCenter;
  });
});

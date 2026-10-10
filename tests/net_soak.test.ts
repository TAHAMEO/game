import { describe, expect, it } from 'vitest';
import { defaultConfig } from '../src/core/config';
import { MemoryStore } from '../src/core/persistence';
import type { GameEvent } from '../src/core/types';
import { NetGuest, NetHost } from '../src/net/room';
import { type InputSource, STEP } from '../src/net/session';
import { MemoryTransport } from '../src/net/transport';
import { Bot } from './bot';

describe('a shared run, soaked', () => {
  it('four bots play minutes of a run over a laggy wire; every copy ends where the host did', async () => {
    const wire = new MemoryTransport(false);
    const room = await wire.host();
    const host = new NetHost(room, 'Host', new MemoryStore(), { scares: 'intense', story: true });
    const guests: NetGuest[] = [];
    for (let i = 0; i < 3; i++) guests.push(new NetGuest(await wire.join(room.code), `Guest${i + 1}`));
    const pump = () => {
      for (let r = 0; r < 10; r++) {
        let n = 0;
        for (const e of wire.hostEnds) n += e.deliver();
        for (const e of wire.guestEnds) n += e.deliver();
        if (!n) return;
      }
    };
    pump();
    const cfg = defaultConfig(20261010);
    const hs = host.start(cfg);
    pump();
    const sim = hs.sim;
    // the bots read the host's run (they are cheating; they are bots)
    const bots = [0, 1, 2, 3].map((id) => new Bot(sim, { hides: id % 2 === 0, torch: id !== 3, flees: id === 1, panicky: id === 2 }, id));
    const source = (id: number): InputSource => ({ frame: (_dt, steps) => Array.from({ length: steps }, () => bots[id]!.input()) });
    const counts = new Map<string, number>();
    const minutes = 5;
    let f = 0;
    for (; f < minutes * 3600 && sim.phase === 'playing'; f++) {
      hs.tick(STEP, source(0));
      guests.forEach((g, i) => {
        for (const e of g.session!.tick(STEP, source(i + 1)) as GameEvent[]) counts.set(e.type, (counts.get(e.type) ?? 0) + 1);
      });
      if (f % 3 === 2) pump();
    }
    // the host stops; let everything in flight land and the copies catch up
    for (let k = 0; k < 90; k++) {
      if (k < 6) hs.tick(STEP, null);
      pump();
      guests.forEach((g) => g.session!.tick(STEP, null));
    }
    for (const g of guests) {
      const b = g.session!.sim;
      expect(b.phase).toBe(sim.phase);
      expect(b.players.map((p) => [p.alive, p.escaped, p.hidden?.id ?? -1])).toEqual(sim.players.map((p) => [p.alive, p.escaped, p.hidden?.id ?? -1]));
      expect(b.world.items.map((it) => [it.id, it.state])).toEqual(sim.world.items.map((it) => [it.id, it.state]));
      expect(b.world.props.length).toBe(sim.world.props.length);
      expect(b.world.doors.map((d) => [d.target, d.locked, d.jammed])).toEqual(sim.world.doors.map((d) => [d.target, d.locked, d.jammed]));
      expect(b.world.lighting.powered).toBe(sim.world.lighting.powered);
      expect(b.world.lighting.fixtures.map((x) => x.broken)).toEqual(sim.world.lighting.fixtures.map((x) => x.broken));
      expect(b.objectives.powerOn).toBe(sim.objectives.powerOn);
      expect(b.objectives.calls.length).toBe(sim.objectives.calls.length);
      expect(b.team.fuses).toBe(sim.team.fuses);
      expect(b.entity.state.kind).toBe(sim.entity.state.kind);
      expect(b.memory.data.story.found).toEqual(sim.memory.data.story.found);
      for (const p of sim.players) {
        if (!p.alive) continue;
        expect(b.players[p.id]!.pos.x).toBeCloseTo(p.pos.x, 1);
        expect(b.players[p.id]!.pos.y).toBeCloseTo(p.pos.y, 1);
      }
    }
    // the guests heard and saw the run: footsteps, the Entity, the story, the storm
    expect(counts.get('sound') ?? 0).toBeGreaterThan(100);
    expect(f).toBeGreaterThan(600);
  }, 240_000);
});

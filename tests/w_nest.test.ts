import { describe, expect, it } from 'vitest';
import { cellCenter } from '../src/core/level';
import { emptySave, MemoryStore, NEST_SURVIVORS, type SaveData } from '../src/core/persistence';
import { makeSim, placePlayer, sedateEntity, step } from './helpers';

function storeWith(patch: Partial<SaveData>): MemoryStore {
  const store = new MemoryStore();
  store.set('the-quiet.save.v1', JSON.stringify({ ...emptySave(), ...patch }));
  return store;
}

const inNest = (sim: ReturnType<typeof makeSim>, p: { x: number; y: number }) => {
  const r = sim.level.regionOf[Math.floor(p.y) * sim.level.w + Math.floor(p.x)]!;
  return r >= 0 && sim.level.regions[r]!.kind === 'nest';
};

describe('W. The nest — what it keeps', () => {
  it('is empty the first time anyone goes in', () => {
    const sim = makeSim({ seed: 50 });
    expect(sim.world.props).toHaveLength(0);
  });

  it('grows run over run: trophies, the survivors it took, signs of what it practised', () => {
    const store = storeWith({
      runs: 6,
      deaths: 5,
      xp: 9,
      learned: { 'fake:turn': 1, herd: 1, breaker: 1, 'not-a-sign': 1 },
      trophies: [
        { kind: 'item', label: "Marsh's torch", run: 2 },
        { kind: 'item', label: 'a fuse', run: 3 },
        { kind: 'debris', label: 'torn scrubs', run: 5 },
      ],
      survivorsLost: [{ name: 'Mara', color: [70, 150, 110], run: 4 }],
    });
    const sim = makeSim({ seed: 51, store });
    const kinds = sim.world.props.map((p) => p.kind);
    expect(kinds.filter((k) => k === 'sign')).toHaveLength(3);
    expect(kinds.filter((k) => k === 'trophy')).toHaveLength(2);
    expect(kinds).toContain('debris');
    expect(kinds).toContain('survivorBody');
    for (const p of sim.world.props) expect(inNest(sim, p.pos)).toBe(true);
    const sign = sim.world.props.find((p) => p.label === 'scratched figures')!;
    expect(sign.examine).toMatch(/turned away/);
  });

  it('keeps your own remains once it knows you well enough', () => {
    const last = { name: 'Nurse A. Okafor', run: 5, cell: 0, zone: 'Main Hall', cause: 'It caught you in the open.', spot: null };
    const early = makeSim({ seed: 52, store: storeWith({ runs: 5, xp: 5, lastCharacter: last }) });
    expect(early.director.tier).toBe(1);
    expect(early.world.props.some((p) => p.kind === 'remains')).toBe(false);

    const late = makeSim({ seed: 52, store: storeWith({ runs: 5, xp: 11, lastCharacter: last }) });
    expect(late.director.tier).toBe(2);
    const remains = late.world.props.find((p) => p.kind === 'remains');
    const propped = late.world.spots.find((s) => s.body);
    expect(remains ?? propped).toBeDefined();
    expect((remains?.examine ?? propped?.body ?? '').includes('Okafor')).toBe(true);
    expect(late.player.name).not.toBe('Nurse A. Okafor');
  });

  it('an escape leaves no previous body for the next life', () => {
    const last = { name: 'Nurse A. Okafor', run: 5, cell: 0, zone: 'Main Hall', cause: 'It caught you in the open.', spot: null };
    const store = storeWith({ runs: 5, xp: 11, lastCharacter: last });
    const got = makeSim({ seed: 52, store });
    got.onEscape();
    const next = makeSim({ seed: 52, store });
    expect(next.memory.data.lastCharacter).toBeNull();
    expect(next.world.props.some((p) => p.kind === 'remains')).toBe(false);
    expect(next.world.spots.some((s) => s.body)).toBe(false);
  });

  it('remembers only as many of the survivors it took as it can show', () => {
    const lost = Array.from({ length: 12 }, (_, i) => ({ name: `S${i}`, color: [1, 1, 1] as [number, number, number], run: i }));
    const sim = makeSim({ seed: 54, store: storeWith({ survivorsLost: lost }) });
    sedateEntity(sim);
    sim.survivors.kill(sim.survivors.list[0]!.id, 'test');
    const kept = sim.memory.data.survivorsLost;
    expect(kept).toHaveLength(NEST_SURVIVORS);
    expect(kept.at(-1)!.name).toBe(sim.survivors.list[0]!.def.name);
  });

  it('props your previous body up in the locker you died in', () => {
    const base = makeSim({ seed: 53 });
    const locker = base.world.spots.find((s) => s.kind === 'locker')!;
    let found = false;
    for (let seed = 1; seed <= 12 && !found; seed++) {
      const sim = makeSim({
        seed,
        store: storeWith({ runs: 3, xp: 11, lastCharacter: { name: 'Dr. I. Vance', run: 3, cell: locker.cell, zone: 'x', cause: 'It found you in the locker.', spot: locker.id } }),
      });
      const spot = sim.world.spots[locker.id]!;
      if (spot.body) {
        found = true;
        expect(spot.body).toMatch(/Vance/);
        // You can't hide in there any more.
        placePlayer(sim, 0, 0);
        sim.player.pos = cellCenter(sim.level, spot.access);
        expect(spot.occupant).toBeNull();
      }
    }
    expect(found).toBe(true);
  });

  it('writes what you carried and where you fell into memory when you die', () => {
    const store = new MemoryStore();
    const sim = makeSim({ seed: 54, store });
    sedateEntity(sim);
    sim.player.inv.fuses = 2;
    placePlayer(sim, 31, 25);
    step(sim, 0.1);
    sim.player.die('test');
    const data = sim.memory.data;
    expect(data.deaths).toBe(1);
    expect(data.trophies.filter((t) => t.label === 'a fuse')).toHaveLength(2);
    expect(data.trophies.some((t) => /torch/.test(t.label))).toBe(true);
    expect(data.lastCharacter?.name).toBe(sim.player.name);
    expect(data.xp).toBeGreaterThanOrEqual(3);
    const again = makeSim({ seed: 55, store });
    expect(again.world.props.some((p) => p.kind === 'trophy')).toBe(true);
  });
});

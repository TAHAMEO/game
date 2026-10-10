import { describe, expect, it } from 'vitest';
import { defaultConfig } from '../src/core/config';
import type { EntityState } from '../src/core/entity';
import { idleInput } from '../src/core/input';
import { cellAt, cellCenter, Tile } from '../src/core/level';
import { dist } from '../src/core/math';
import { MemoryStore } from '../src/core/persistence';
import { Sim } from '../src/core/sim';
import type { GameEvent } from '../src/core/types';
import { at, makeSim, pinStress, placeEntity, sedateEntity, step } from './helpers';

const place = (sim: Sim, id: number, x: number, y: number, angle = 0) => {
  const p = sim.players[id]!;
  p.pos = at(x, y);
  p.angle = angle;
  p.vel = { x: 0, y: 0 };
};

describe('Shared runs — the core', () => {
  it('puts several distinct people in reception, on the floor', () => {
    const sim = makeSim({ seed: 3, players: 4 });
    expect(sim.players).toHaveLength(4);
    expect(new Set(sim.players.map((p) => p.name)).size).toBe(4);
    for (const p of sim.players) {
      expect(sim.level.tiles[cellAt(sim.level, p.pos)]).toBe(Tile.Floor);
      expect(p.active).toBe(true);
    }
    expect(sim.player).toBe(sim.players[0]);
  });

  it('a solo run is unchanged by the multiplayer machinery: same seed, same first name', () => {
    const solo = makeSim({ seed: 11 });
    const duo = makeSim({ seed: 11, players: 2 });
    expect(duo.players[0]!.name).toBe(solo.player.name);
    expect(duo.world.items.map((i) => [i.kind, i.pos.x, i.pos.y])).toEqual(solo.world.items.map((i) => [i.kind, i.pos.x, i.pos.y]));
    expect(duo.objectives.realGate).toBe(solo.objectives.realGate);
  });

  it('is deterministic: two copies built from the same seed and save agree (what a client relies on)', () => {
    const save = new MemoryStore();
    const a = new Sim({ ...defaultConfig(77), players: 3 }, save);
    const raw = save.get('the-quiet.save.v1');
    const copy = new MemoryStore();
    // the client gets the host's save as it was before the run began
    const before = JSON.parse(raw!);
    before.runs--;
    copy.set('the-quiet.save.v1', JSON.stringify(before));
    const b = new Sim({ ...defaultConfig(77), players: 3 }, copy);
    expect(b.players.map((p) => p.name)).toEqual(a.players.map((p) => p.name));
    expect(b.world.items.map((i) => [i.id, i.kind, i.pos])).toEqual(a.world.items.map((i) => [i.id, i.kind, i.pos]));
    expect(b.world.doors.map((d) => d.open)).toEqual(a.world.doors.map((d) => d.open));
    expect(b.survivors.list.map((s) => [s.def.name, s.pos])).toEqual(a.survivors.list.map((s) => [s.def.name, s.pos]));
    expect(b.world.props.map((p) => [p.kind, p.pos])).toEqual(a.world.props.map((p) => [p.kind, p.pos]));
    expect(b.story.writings).toEqual(a.story.writings);
  });

  it('shares fuses and keys: one of you carries them for everyone', () => {
    const sim = makeSim({ seed: 5, players: 2 });
    sedateEntity(sim);
    const fuse = sim.world.items.find((i) => i.kind === 'fuse')!;
    const p1 = sim.players[1]!;
    p1.pos = { x: fuse.pos.x - 0.6, y: fuse.pos.y };
    p1.angle = 0;
    const inputs = [idleInput(), { ...idleInput(), interactPressed: true }];
    sim.step(1 / 60, inputs);
    expect(fuse.state).toBe('taken');
    expect(sim.players[0]!.inv.fuses).toBe(1);
    expect(sim.team.fuses).toBe(1);
  });

  it('routes what each player hears to that player', () => {
    const sim = makeSim({ seed: 5, players: 2 });
    sedateEntity(sim);
    place(sim, 0, 20, 18, 0);
    place(sim, 1, 24, 18, Math.PI);
    sim.drainEvents();
    sim.emitNoise('door', at(22, 18), 30, 'world');
    const ev = sim.drainEvents().filter((e) => e.type === 'sound');
    expect(ev.filter((e) => e.to === 0)).toHaveLength(1);
    expect(ev.filter((e) => e.to === 1)).toHaveLength(1);
    // your own footstep is centred for you and placed in the world for the other
    sim.emitNoise('step', at(20, 18), 27, 'player', { player: 0 });
    const steps = sim.drainEvents().filter((e): e is Extract<GameEvent, { type: 'sound' }> => e.type === 'sound');
    const own = steps.find((e) => e.to === 0)!;
    const heard = steps.find((e) => e.to === 1)!;
    expect(own.player).toBe(0);
    expect(own.volume).toBeGreaterThan(heard.volume);
  });

  it('hunts whoever it can see, not just the first player', () => {
    const sim = makeSim({ seed: 8, players: 2 });
    place(sim, 0, 60, 40); // far away, in the ambulance bay
    place(sim, 1, 20, 18, Math.PI);
    placeEntity(sim, 23, 18, Math.PI);
    sim.entity.state = { kind: 'roam', dest: sim.entity.cell, pauseUntil: sim.time + 999 };
    sim.world.lighting.setPower(true);
    let chased: number | undefined;
    for (let i = 0; i < 240 && chased === undefined; i++) {
      step(sim, 1 / 60);
      const s = sim.entity.state as EntityState;
      if (s.kind === 'chase' && s.survivor === null) chased = s.player;
    }
    expect(chased).toBe(1);
    step(sim, 1 / 60);
    expect(sim.focus.id).toBe(1);
  });

  it('the run goes on when one of you dies, and ends when nobody is left inside', () => {
    const sim = makeSim({ seed: 9, players: 2 });
    sedateEntity(sim);
    sim.drainEvents();
    sim.players[1]!.die('test');
    const ev = sim.drainEvents();
    expect(ev.some((e) => e.type === 'death' && e.player === 1 && e.to === undefined)).toBe(true);
    expect(sim.phase).toBe('playing');
    expect(sim.activePlayers).toHaveLength(1);
    step(sim, 1);
    expect(sim.time).toBeGreaterThan(0.9);
    sim.onEscape(sim.players[0]!);
    expect(sim.phase).toBe('escaped');
    expect(sim.drainEvents().some((e) => e.type === 'runEnd' && e.outcome === 'escaped')).toBe(true);
    expect(sim.memory.data.deaths).toBe(1);
    expect(sim.memory.data.escapes).toBe(1);
    // somebody died, so somebody's body is waiting next time
    expect(sim.memory.data.lastCharacter?.name).toBe(sim.players[1]!.name);
  });

  it("each player's panic is their own: only the frightened one sees things", () => {
    const sim = makeSim({ seed: 12, players: 2 });
    sedateEntity(sim);
    place(sim, 0, 25, 24, 0.15);
    place(sim, 1, 12, 18, 0);
    sim.players[0]!.stress.update = () => {};
    sim.players[0]!.stress.value = 1;
    sim.players[1]!.stress.update = () => {};
    sim.players[1]!.stress.value = 0;
    const events = step(sim, 120);
    const phantoms = events.filter((e) => e.type === 'sound' && e.phantom);
    expect(phantoms.length).toBeGreaterThan(0);
    expect(phantoms.every((e) => e.to === 0)).toBe(true);
    expect(sim.players[1]!.perception.emitted).toBe(0);
  });

  it('the Director turns to whoever strays from the group', () => {
    const sim = makeSim({ seed: 14, players: 3 });
    sedateEntity(sim);
    pinStress(sim, 0.2);
    place(sim, 0, 30, 25);
    place(sim, 1, 31, 25);
    place(sim, 2, 60, 40);
    step(sim, 40);
    expect(sim.focus.id).toBe(2);
  });

  it('a dead player is out of the hunt: it will not chase a corpse', () => {
    const sim = makeSim({ seed: 16, players: 2 });
    place(sim, 0, 20, 18, 0);
    place(sim, 1, 50, 30, 0);
    placeEntity(sim, 22, 18, Math.PI);
    sim.entity.state = { kind: 'chase', lostAt: sim.time, survivor: null, player: 0 };
    sim.players[0]!.die('test');
    step(sim, 0.5);
    const s = sim.entity.state as EntityState;
    expect(s.kind === 'chase' && s.player === 0).toBe(false);
  });

  it('a hiding place holds one person', () => {
    const sim = makeSim({ seed: 18, players: 2 });
    sedateEntity(sim);
    const spot = sim.world.spots.find((s) => s.kind === 'locker' && !s.occupant)!;
    const a = cellCenter(sim.level, spot.access);
    const facing = Math.atan2(spot.cell === spot.access ? 0 : Math.floor(spot.cell / sim.level.w) - Math.floor(spot.access / sim.level.w), (spot.cell % sim.level.w) - (spot.access % sim.level.w));
    for (const p of sim.players) {
      p.pos = { ...a };
      p.angle = facing;
    }
    sim.step(1 / 60, [{ ...idleInput(), interactPressed: true }, idleInput()]);
    step(sim, 1);
    expect(sim.players[0]!.hidden).toBe(spot);
    sim.step(1 / 60, [idleInput(), { ...idleInput(), interactPressed: true }]);
    step(sim, 1);
    expect(sim.players[1]!.hidden).toBeNull();
    expect(dist(sim.players[1]!.pos, a)).toBeLessThan(0.5);
  });
});

import { describe, expect, it } from 'vitest';
import { defaultConfig } from '../src/core/config';
import { idleInput, type InputState } from '../src/core/input';
import { MemoryStore, Persistence } from '../src/core/persistence';
import type { GameEvent } from '../src/core/types';
import { NET_VERSION } from '../src/net/protocol';
import { keepPages, NetGuest, NetHost } from '../src/net/room';
import { type InputSource, STEP } from '../src/net/session';
import { MemoryTransport } from '../src/net/transport';

/** Input from a script: `fn(step)` says what is held on each fixed step. */
function scripted(fn: (step: number) => Partial<InputState>): InputSource {
  let n = 0;
  return { frame: (_dt, steps) => Array.from({ length: steps }, () => ({ ...idleInput(), ...fn(n++) })) };
}

async function room(guestCount: number) {
  const wire = new MemoryTransport(false);
  const hostRoom = await wire.host();
  const store = new MemoryStore();
  const host = new NetHost(hostRoom, 'Host', store, { scares: 'off', story: true });
  const guests: NetGuest[] = [];
  for (let i = 0; i < guestCount; i++) guests.push(new NetGuest(await wire.join(hostRoom.code), `Guest${i + 1}`));
  /** Deliver everything in flight, both ways, until the wire is quiet. */
  const pump = () => {
    for (let round = 0; round < 20; round++) {
      let n = 0;
      for (const e of wire.hostEnds) n += e.deliver();
      for (const e of wire.guestEnds) n += e.deliver();
      if (!n) return;
    }
  };
  pump();
  return { wire, host, guests, store, pump };
}

function startRun(host: NetHost, seed = 4242) {
  const cfg = defaultConfig(seed);
  cfg.scares = 'off';
  return host.start(cfg);
}

describe('shared runs over the wire', () => {
  it('guests arrive in the room and see each other', async () => {
    const { host, guests } = await room(2);
    expect(host.lobby().players.map((p) => p.name)).toEqual(['Host', 'Guest1', 'Guest2']);
    for (const g of guests) expect(g.lobby?.players.length).toBe(3);
  });

  it("a guest's copy of the building is the host's, from the first step", async () => {
    const { host, guests, pump } = await room(1);
    const hs = startRun(host);
    pump();
    const gs = guests[0]!.session!;
    expect(gs).toBeTruthy();
    expect(gs.localId).toBe(1);
    const a = hs.sim;
    const b = gs.sim;
    expect(b.players.map((p) => p.name)).toEqual(a.players.map((p) => p.name));
    expect(b.world.items.map((it) => [it.id, it.kind, it.pos.x, it.pos.y, it.recordId ?? -1])).toEqual(
      a.world.items.map((it) => [it.id, it.kind, it.pos.x, it.pos.y, it.recordId ?? -1]),
    );
    expect(b.world.props.map((p) => p.id)).toEqual(a.world.props.map((p) => p.id));
    expect(b.story.writings).toEqual(a.story.writings);
    expect(b.runNumber).toBe(a.runNumber);
  });

  it('keeps the copy in step while everyone plays, through latency', async () => {
    const { host, guests, pump } = await room(2);
    const hs = startRun(host);
    pump();
    const hostIn = scripted((s) => ({ forward: s % 240 < 160 ? 1 : 0, turn: s % 240 >= 160 ? 0.02 : 0, pitch: s < 30 ? 0.01 : 0 }));
    const guestIn = guests.map((_, gi) => scripted((s) => ({ forward: 1, strafe: gi === 0 ? 0.4 : -0.4, turn: s % 120 < 60 ? 0.015 : -0.015, crouch: s > 400 })));
    const got: GameEvent[][] = guests.map(() => []);
    for (let f = 0; f < 900; f++) {
      hs.tick(STEP, hostIn);
      guests.forEach((g, i) => got[i]!.push(...g.session!.tick(STEP, guestIn[i]!)));
      // ~66 ms each way: deliver every fourth frame
      if (f % 4 === 3) pump();
    }
    // let the guests' inputs land and their copies catch up with the last snapshot
    for (let f = 0; f < 60; f++) {
      if (f < 6) hs.tick(STEP, null);
      pump();
      guests.forEach((g, i) => got[i]!.push(...g.session!.tick(STEP, null)));
    }
    const a = hs.sim;
    for (const g of guests) {
      const b = g.session!.sim;
      expect(b.phase).toBe(a.phase);
      expect(Math.abs(b.time - a.time)).toBeLessThan(0.06);
      for (const p of a.players) {
        const q = b.players[p.id]!;
        expect(q.alive).toBe(p.alive);
        expect(q.crouching).toBe(p.crouching);
        expect(q.hidden?.id ?? -1).toBe(p.hidden?.id ?? -1);
        expect(q.pos.x).toBeCloseTo(p.pos.x, 1);
        expect(q.pos.y).toBeCloseTo(p.pos.y, 1);
        expect(Math.abs(Math.atan2(Math.sin(q.angle - p.angle), Math.cos(q.angle - p.angle)))).toBeLessThan(0.02);
      }
      expect(b.entity.state.kind).toBe(a.entity.state.kind);
      expect(b.entity.pos.x).toBeCloseTo(a.entity.pos.x, 2);
      expect(b.entity.pos.y).toBeCloseTo(a.entity.pos.y, 2);
      expect(b.world.doors.map((d) => [d.target, d.locked, d.jammed])).toEqual(a.world.doors.map((d) => [d.target, d.locked, d.jammed]));
      expect(b.world.doors.map((d) => Math.round(d.open * 10))).toEqual(a.world.doors.map((d) => Math.round(d.open * 10)));
      expect(b.world.items.map((it) => it.state)).toEqual(a.world.items.map((it) => it.state));
      expect(b.world.spots.map((s) => JSON.stringify(s.occupant))).toEqual(a.world.spots.map((s) => JSON.stringify(s.occupant)));
      expect(b.world.lighting.fixtures.map((f) => f.broken)).toEqual(a.world.lighting.fixtures.map((f) => f.broken));
      expect(b.team.fuses).toBe(a.team.fuses);
    }
    // the guests heard the building: footsteps (their own and the others') came through
    for (const evs of got) expect(evs.some((e) => e.type === 'sound' && e.kind === 'step')).toBe(true);
  });

  it("a guest's own body moves the moment they do, and agrees with the host after", async () => {
    const { host, guests, pump } = await room(1);
    const hs = startRun(host);
    pump();
    const gs = guests[0]!.session!;
    for (let f = 0; f < 6; f++) {
      hs.tick(STEP, null);
      gs.tick(STEP, null);
      pump();
    }
    const me = gs.sim.players[1]!;
    const before = { ...me.pos };
    const walk = scripted(() => ({ forward: 1 }));
    // nothing delivered yet: this is prediction alone
    for (let f = 0; f < 10; f++) gs.tick(STEP, walk);
    const moved = Math.hypot(me.pos.x - before.x, me.pos.y - before.y);
    expect(moved).toBeGreaterThan(0.1);
    // now the host plays those steps and answers
    for (let f = 0; f < 40; f++) {
      pump();
      hs.tick(STEP, null);
      gs.tick(STEP, null);
    }
    pump();
    for (let f = 0; f < 30; f++) gs.tick(STEP, null);
    const truth = hs.sim.players[1]!;
    expect(me.pos.x).toBeCloseTo(truth.pos.x, 2);
    expect(me.pos.y).toBeCloseTo(truth.pos.y, 2);
    expect(me.angle).toBeCloseTo(truth.angle, 4);
  });

  it('turning is never lost, even when inputs arrive in a burst', async () => {
    const { host, guests, pump } = await room(1);
    const hs = startRun(host);
    pump();
    const gs = guests[0]!.session!;
    const look = scripted(() => ({ turn: 0.01, pitch: 0.002 }));
    const start = hs.sim.players[1]!.angle;
    // 120 steps of turning, delivered all at once after a long stall
    for (let f = 0; f < 120; f++) gs.tick(STEP, look);
    pump();
    for (let f = 0; f < 200; f++) {
      hs.tick(STEP, null);
      gs.tick(STEP, null);
      pump();
    }
    const turned = hs.sim.players[1]!.angle - start;
    expect(Math.atan2(Math.sin(turned), Math.cos(turned))).toBeCloseTo(1.2, 3);
    expect(hs.sim.players[1]!.pitch).toBeCloseTo(0.24, 3);
  });

  it('events reach the guest they are for', async () => {
    const { host, guests, pump } = await room(1);
    const hs = startRun(host);
    pump();
    const gs = guests[0]!.session!;
    hs.sim.notice('Only for the guest.', 3, 1);
    hs.sim.notice('For everyone.', 3);
    const got: GameEvent[] = [];
    for (let f = 0; f < 30; f++) {
      hs.tick(STEP, null);
      pump();
      got.push(...gs.tick(STEP, null));
    }
    const notices = got.filter((e) => e.type === 'notice');
    expect(notices.map((e) => e.type === 'notice' && e.text)).toEqual(['Only for the guest.', 'For everyone.']);
    expect(notices[0]!.to).toBe(1);
  });

  it('a guest who leaves this life, or drops, dies in the building', async () => {
    const { host, guests, pump, wire } = await room(2);
    const hs = startRun(host);
    pump();
    guests[0]!.session!.forfeit();
    pump();
    hs.tick(STEP, null);
    expect(hs.sim.players[1]!.alive).toBe(false);
    expect(hs.sim.players[1]!.deathCause).toBe('You stopped.');
    // the second guest's wire goes dead
    wire.guestEnds[1]!.close();
    pump();
    expect(hs.sim.players[2]!.alive).toBe(false);
    expect(host.guests.length).toBe(1);
    expect(hs.sim.phase).toBe('playing');
  });

  it('people who arrive mid-run wait for the next one', async () => {
    const { host, wire, pump } = await room(1);
    startRun(host);
    pump();
    const late = new NetGuest(await wire.join(host.code), 'Late');
    pump();
    expect(late.lobby?.running).toBe(true);
    expect(late.session).toBeNull();
    host.backToLobby();
    const second = startRun(host, 99);
    pump();
    expect(second.sim.players.length).toBe(3);
    expect(late.session?.localId).toBe(2);
  });

  it('shrugs off malformed input from a guest', async () => {
    const { host, guests, pump, wire } = await room(1);
    const hs = startRun(host);
    pump();
    const end = wire.guestEnds[0]!;
    for (const junk of [{ t: 'in', i: 'nope' }, { t: 'in', i: [[1, 2]] }, { t: 'in', i: [[5, 1, 0, 'x', 0, 0]] }, { t: 'in', i: [[9, NaN, 0, 0, 0, 0]] }, { t: 'nonsense' }, null, 42]) end.send(junk);
    pump();
    expect(() => hs.tick(STEP, null)).not.toThrow();
    expect(hs.sim.players[1]!.alive).toBe(true);
    // and real input still works afterwards
    const walk = scripted(() => ({ forward: 1 }));
    const before = { ...hs.sim.players[1]!.pos };
    for (let f = 0; f < 30; f++) {
      guests[0]!.session!.tick(STEP, walk);
      pump();
      hs.tick(STEP, null);
    }
    expect(Math.hypot(hs.sim.players[1]!.pos.x - before.x, hs.sim.players[1]!.pos.y - before.y)).toBeGreaterThan(0.2);
  });

  it('turns away a different version of the game', async () => {
    const { wire, host, pump } = await room(0);
    const link = await wire.join(host.code);
    const got: unknown[] = [];
    link.onMessage = (m) => got.push(m);
    link.send({ t: 'hello', v: NET_VERSION + 1, name: 'Old' });
    pump();
    expect(got[0]).toMatchObject({ t: 'reject' });
    expect(host.guests.length).toBe(0);
  });

  it('a guest keeps the case-file pages found in a shared run', async () => {
    const { host, guests, pump } = await room(1);
    const hs = startRun(host);
    pump();
    hs.sim.memory.data.story.found.push(3, 7);
    for (let f = 0; f < 12; f++) {
      hs.tick(STEP, null);
      pump();
      guests[0]!.session!.tick(STEP, null);
    }
    const own = new MemoryStore();
    keepPages(own, guests[0]!.session!.sim);
    expect(new Persistence(own).data.story.found).toEqual([3, 7]);
  });
});

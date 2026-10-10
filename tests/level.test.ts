import { describe, expect, it } from 'vitest';
import { cellCenter, parseLevel, Tile } from '../src/core/level';
import { findPath } from '../src/core/path';
import { Rng } from '../src/core/rng';
import { SoundField } from '../src/core/sound';
import { World } from '../src/core/world';

const level = parseLevel();

describe('level', () => {
  it('parses the hospital with all the objective furniture', () => {
    expect(level.w).toBe(64);
    expect(level.h).toBe(44);
    const kinds = new Set(level.wallObjects.map((w) => w.kind));
    for (const k of ['locker', 'drawer', 'vent', 'tap', 'fusebox', 'radio', 'gate']) expect(kinds.has(k as never)).toBe(true);
    expect(level.doors.filter((d) => d.lock).map((d) => d.lock).sort()).toEqual(['maintenance', 'pharmacy', 'sealed']);
  });

  it('assigns every walkable cell to a zone and a region', () => {
    for (let c = 0; c < level.w * level.h; c++) {
      const t = level.tiles[c];
      if (t === Tile.Floor || t === Tile.Bed) {
        expect(level.zoneOf[c]).toBeGreaterThanOrEqual(0);
        expect(level.regionOf[c]).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it('finds dead-end rooms for the bait planner (morgue, nest)', () => {
    const deadZones = new Set(level.regions.filter((r) => r.deadEnd).map((r) => level.zones[r.zone]!.key));
    expect(deadZones.has('g')).toBe(true);
    expect(deadZones.has('n')).toBe(true);
  });

  it('connects spawn to the nest, breaker, radio and both gates for the Entity', () => {
    const world = new World(level, new Rng(1), { falseLeads: true });
    // Unlock everything to check raw connectivity.
    for (const d of world.doors) d.locked = false;
    for (const target of [world.fuseBox.access, world.radio.access, ...world.gates.map((g) => g.access), level.markers.nest[0]!]) {
      const p = findPath(level, level.spawn, target, { passable: world.entityPassable });
      expect(p, `path to ${target}`).not.toBeNull();
    }
  });

  it('keeps the maintenance shortcut locked but reachable the long way round', () => {
    const world = new World(level, new Rng(2), { falseLeads: true });
    const p = findPath(level, level.spawn, world.fuseBox.access, { passable: world.humanPassable });
    expect(p).not.toBeNull();
  });
});

describe('sound', () => {
  it('is quieter through a closed door than an open one', () => {
    const world = new World(level, new Rng(3), { falseLeads: false });
    const door = world.doors.find((d) => !d.locked)!;
    const field = new SoundField(level);
    const [a, b] = door.sides;
    door.open = 0;
    field.propagate(a, 40, world.doorOpenness);
    const closed = field.levelAt(b);
    door.open = 1;
    field.propagate(a, 40, world.doorOpenness);
    const open = field.levelAt(b);
    expect(open).toBeGreaterThan(closed + 8);
  });

  it('does not pass through walls', () => {
    const world = new World(level, new Rng(3), { falseLeads: false });
    for (const d of world.doors) d.open = 0;
    const field = new SoundField(level);
    // Security office radio side vs west ward room W4 are wall-adjacent but far by path.
    const radio = world.radio.access;
    field.propagate(radio, 30, world.doorOpenness);
    const w4 = level.spawn; // reception is far away through doors
    expect(field.levelAt(w4)).toBeLessThan(5);
  });
});

describe('world', () => {
  it('places three fuses, one key, notes, and hiding spots', () => {
    const world = new World(level, new Rng(4), { falseLeads: true });
    expect(world.itemsOnGround('fuse')).toHaveLength(3);
    expect(world.itemsOnGround('key')).toHaveLength(1);
    expect(world.notes.some((n) => n.falseLead)).toBe(true);
    expect(world.spots.filter((s) => s.kind === 'locker').length).toBeGreaterThan(15);
    expect(world.spots.filter((s) => s.kind === 'bed').length).toBeGreaterThan(15);
  });

  it('lights need power, except emergency lights', () => {
    const world = new World(level, new Rng(5), { falseLeads: false });
    const hall = level.regions.find((r) => level.zones[r.zone]!.key === 'h' && r.cells.length > 50)!;
    const before = Math.max(...hall.cells.map((c) => world.lighting.lumAt(c)));
    world.lighting.setPower(true);
    const after = Math.max(...hall.cells.map((c) => world.lighting.lumAt(c)));
    expect(before).toBeGreaterThan(0);
    expect(after).toBeGreaterThan(before);
    const p = cellCenter(level, hall.center);
    expect(world.lighting.sample(p)).toBeGreaterThan(0);
  });
});

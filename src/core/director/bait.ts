import type { Entity } from '../entity';
import { cellAt, cellCenter, Tile } from '../level';
import { angleDiff, angleTo, dist, lerp, type Vec2 } from '../math';
import { findPath } from '../path';
import type { Plan, PlanKind, PlanStep } from '../plans';
import type { Sim } from '../sim';
import type { Gate, HidingSpot, Item } from '../types';

interface Candidate {
  kind: PlanKind;
  weight: number;
  build: () => Plan | null;
}

/**
 * T. THE BAIT ECONOMY. The Entity sets the board and waits for you to walk onto it.
 * Plans are generated from the player's predicted route (their next objective), the
 * profile (what they trust), and Entity Knowledge (what it has practised).
 * Also hosts the proactive plans of U (breaker / radio), V (tap watch), X (mimic)
 * and Y (route barricades), since they share the same machinery.
 */
export class BaitPlanner {
  cooldownUntil = 50;
  forceNext = false;
  active: Plan | null = null;
  readonly history: { kind: PlanKind; t: number; ok: boolean; reason: string }[] = [];
  private readonly pendingChecks = new Map<number, number>();
  private readonly handledRoutes = new Set<number>();
  private seq = 1;

  constructor(private readonly sim: Sim) {}

  // ------------------------------------------------------------------ helpers

  private plan(kind: PlanKind, section: Plan['section'], steps: PlanStep[], reason: string): Plan {
    return { id: this.seq++, kind, section, steps, reason, created: this.sim.time };
  }

  /** Where the player is most likely heading next, as a walkable path. */
  predictedRoute(): number[] | null {
    const sim = this.sim;
    const target = sim.objectives.predictedTarget();
    if (target < 0) return null;
    return findPath(sim.level, sim.player.cell, target, { passable: sim.world.humanPassable, maxExpanded: 4000 });
  }

  private visibleToPlayer(p: Vec2): boolean {
    const pl = this.sim.player;
    if (dist(pl.pos, p) > 14) return false;
    if (Math.abs(angleDiff(pl.angle, angleTo(pl.pos, p))) > 0.75) return false;
    return this.sim.world.los(pl.pos, p);
  }

  private reachable(cell: number): boolean {
    const sim = this.sim;
    return findPath(sim.level, sim.entity.cell, cell, { passable: sim.world.entityPassable, maxExpanded: 4000 }) !== null;
  }

  /** Darkest floor cell near `center` that can see `watch`, avoiding `avoid`. */
  private darkCellNear(center: number, radius: number, watch: Vec2, avoid: Set<number>): number {
    const sim = this.sim;
    const { level, world } = sim;
    const cx = center % level.w;
    const cy = Math.floor(center / level.w);
    let best = -1;
    let bestScore = Infinity;
    for (let y = cy - radius; y <= cy + radius; y++) {
      for (let x = cx - radius; x <= cx + radius; x++) {
        if (x < 0 || y < 0 || x >= level.w || y >= level.h) continue;
        const c = y * level.w + x;
        if (level.tiles[c] !== Tile.Floor || avoid.has(c)) continue;
        const p = cellCenter(level, c);
        if (!world.los(p, watch)) continue;
        const score = world.lighting.lumAt(c) * 10 + dist(p, watch) * 0.15 + (this.visibleToPlayer(p) ? 5 : 0);
        if (score < bestScore) {
          bestScore = score;
          best = c;
        }
      }
    }
    return best;
  }

  // ------------------------------------------------------------------ update

  update(): void {
    const sim = this.sim;
    // Offered safety: when you take the bait, it comes to check — not instantly.
    for (const spot of sim.world.spots) {
      if (!spot.baited) continue;
      if (spot.occupant?.kind === 'player' && !this.pendingChecks.has(spot.id)) {
        this.pendingChecks.set(spot.id, sim.time + sim.rng.range(4, 9));
        sim.log('T', `you took the offered ${spot.kind}`);
      }
    }
    for (const [id, at] of this.pendingChecks) {
      const spot = sim.world.spots[id]!;
      if (spot.occupant?.kind !== 'player') {
        this.pendingChecks.delete(id);
        spot.baited = false;
        continue;
      }
      if (sim.time >= at) {
        this.pendingChecks.delete(id);
        spot.baited = false;
        sim.entity.forceCheck(spot, `[T] it left that ${spot.kind} open for you — and comes to collect`);
      }
    }
  }

  // ------------------------------------------------------------------ selection

  choose(entity: Entity): Plan | null {
    const sim = this.sim;
    if (this.active) return null;
    if (sim.time < this.cooldownUntil && !this.forceNext) return null;
    const f = sim.features;
    const tier = sim.director.tier;
    const pl = sim.player;
    const profile = sim.director.profile;
    const c: Candidate[] = [];
    const needFuses = pl.inv.fuses < sim.world.fusesRequired && !sim.objectives.powerOn;

    if (f.breakerAmbush && !sim.objectives.powerOn && pl.inv.fuses >= sim.world.fusesRequired && (sim.memory.learned('breaker') || tier >= 2))
      c.push({ kind: 'breakerAmbush', weight: 6, build: () => this.buildBreaker() });
    if (f.theMark && pl.isMarked && sim.memory.learned('mark')) c.push({ kind: 'tapWatch', weight: 3, build: () => this.buildTapWatch() });
    for (const r of sim.director.adapt.routeCounters()) {
      if (this.handledRoutes.has(r)) continue;
      c.push({ kind: 'jam', weight: 3, build: () => this.buildRouteCounter(r) });
      break;
    }
    const survivors = sim.survivors.list;
    const anyDead = survivors.some((s) => !s.alive);
    if (f.mimicSurvivors && f.survivors && survivors.length && (tier >= 2 || (anyDead && tier >= 1)))
      c.push({ kind: 'mimic', weight: 1.5 + (anyDead ? 1.5 : 0), build: () => this.buildMimic() });
    if (f.offeredSafety) {
      const hides = Object.values(profile.hideCounts).reduce((a, b) => a + b, 0);
      c.push({ kind: 'offer', weight: 1.2 + Math.min(2, hides * 0.4), build: () => this.buildOffer() });
    }
    if (f.darknessFunnels && tier >= 1) c.push({ kind: 'funnel', weight: 0.8 + profile.lightPreference * 2, build: () => this.buildFunnel() });
    if (f.herding && tier >= 1 && sim.world.vents.length) c.push({ kind: 'herd', weight: 1.5, build: () => this.buildHerd() });
    if (f.objectRelocation && (tier >= 2 || (tier >= 1 && sim.director.floor > 0.45)) && (needFuses || !pl.inv.keys.has('maintenance')))
      c.push({ kind: 'relocate', weight: 1.4, build: () => this.buildRelocate() });

    for (let attempt = 0; attempt < 4 && c.length; attempt++) {
      const pick = sim.rng.weighted(c, (x) => x.weight);
      if (!pick) break;
      c.splice(c.indexOf(pick), 1);
      const plan = pick.build();
      if (!plan) continue;
      this.active = plan;
      this.forceNext = false;
      this.cooldownUntil = sim.time + lerp(80, 28, sim.director.floor);
      sim.log(plan.section, `plan: ${plan.kind} — ${plan.reason}`);
      void entity;
      return plan;
    }
    // Nothing viable right now: try again soon.
    this.cooldownUntil = sim.time + 10;
    return null;
  }

  onFinished(plan: Plan, ok: boolean): void {
    if (this.active?.id === plan.id) this.active = null;
    this.history.push({ kind: plan.kind, t: this.sim.time, ok, reason: plan.reason });
    if (this.history.length > 40) this.history.shift();
    const practised: Partial<Record<PlanKind, string>> = { herd: 'herd', relocate: 'relocate', offer: 'offer', funnel: 'funnel', mimic: 'mimic' };
    const key = practised[plan.kind];
    if (ok && key && this.sim.memory.learn(key)) this.sim.log('K', `it has practised ${plan.kind} (the nest will show it)`);
  }

  /** Start a plan right now (used for corrupted objectives [U]). */
  interject(plan: Plan): void {
    const sim = this.sim;
    const k = sim.entity.stateKind;
    if (k === 'chase' || k === 'lunge' || k === 'kill') return;
    if (this.active) sim.director.onPlanFinished(this.active, false);
    this.active = plan;
    sim.log(plan.section, `plan: ${plan.kind} — ${plan.reason}`);
    sim.entity.startPlan(plan);
  }

  // ------------------------------------------------------------------ T builders

  buildOffer(): Plan | null {
    const sim = this.sim;
    const route = this.predictedRoute();
    if (!route || route.length < 6) return null;
    const ahead = route.slice(3, 30);
    const scored: { spot: HidingSpot; d: number }[] = [];
    for (const spot of sim.world.spots) {
      if (spot.occupant || spot.body || spot.baited) continue;
      if (spot.kind !== 'bed' && spot.ajar) continue;
      const a = cellCenter(sim.level, spot.access);
      let md = Infinity;
      for (const c of ahead) md = Math.min(md, dist(a, cellCenter(sim.level, c)));
      if (md > 4 || this.visibleToPlayer(a)) continue;
      // A cluttered bed made clear is the most inviting change; an already-clear one still works.
      const appeal = spot.kind === 'bed' && !spot.cluttered ? 1.5 : 0;
      scored.push({ spot, d: md + appeal + sim.rng.range(0, 1) });
    }
    scored.sort((x, y) => x.d - y.d);
    for (const { spot } of scored.slice(0, 4)) {
      if (!this.reachable(spot.access)) continue;
      const lurk = this.lurkCell(spot.access, new Set(route));
      const steps: PlanStep[] = [
        { op: 'goto', cell: spot.access, mode: 'stalk' },
        { op: spot.kind === 'bed' ? 'clear' : 'ajar', spot: spot.id },
      ];
      if (lurk >= 0) steps.push({ op: 'goto', cell: lurk, mode: 'stalk' }, { op: 'wait', duration: 30 });
      return this.plan('offer', 'T', steps, `leave a ${spot.kind} invitingly open on your way — and plan to check it`);
    }
    return null;
  }

  private lurkCell(near: number, avoid: Set<number>): number {
    const sim = this.sim;
    const { level } = sim;
    const p = cellCenter(level, near);
    let best = -1;
    let bestScore = Infinity;
    for (let i = 0; i < 40; i++) {
      const a = sim.rng.range(0, Math.PI * 2);
      const r = sim.rng.range(6, 10);
      const c = cellAt(level, { x: p.x + Math.cos(a) * r, y: p.y + Math.sin(a) * r });
      if (c < 0 || level.tiles[c] !== Tile.Floor || avoid.has(c)) continue;
      const score = sim.world.lighting.lumAt(c) * 10 + (this.visibleToPlayer(cellCenter(level, c)) ? 5 : 0);
      if (score < bestScore) {
        bestScore = score;
        best = c;
      }
    }
    return best;
  }

  buildFunnel(): Plan | null {
    const sim = this.sim;
    const { level, world } = sim;
    const route1 = this.predictedRoute();
    if (!route1 || route1.length < 10) return null;
    const target = route1[route1.length - 1]!;
    const avoid = new Set(route1);
    const route2 = findPath(level, sim.player.cell, target, {
      passable: world.humanPassable,
      extraCost: (c) => (avoid.has(c) ? 25 : 0),
      maxExpanded: 5000,
    });
    if (!route2) return null;
    const overlap = route2.filter((c) => avoid.has(c)).length / route2.length;
    if (overlap > 0.6) return null;
    // Lights that serve route 1 but not route 2 (by distance, not by region: one long
    // hall can serve both routes at different ends).
    const near = (route: number[], p: Vec2) => {
      let md = Infinity;
      for (const c of route) md = Math.min(md, dist(cellCenter(level, c), p));
      return md;
    };
    const kill = new Set<number>();
    for (const fx of world.lighting.fixtures) {
      if (!world.lighting.isOn(fx)) continue;
      const p = cellCenter(level, fx.cell);
      if (near(route1, p) <= 2.5 && near(route2, p) > 4) kill.add(fx.id);
    }
    if (!kill.size) return null;
    const lit2 = route2.reduce((a, c) => a + world.lighting.lumAt(c), 0) / route2.length;
    if (lit2 < 0.06) return null;
    const idx = Math.floor(route2.length * 0.55);
    const watchCell = route2[idx]!;
    const watch = cellCenter(level, watchCell);
    const amb = this.darkCellNear(watchCell, 3, watch, new Set(route2));
    const ambCell = amb >= 0 ? amb : watchCell;
    const fixtures = [...kill]
      .map((id) => world.lighting.fixtures[id]!)
      .sort((a, b) => dist(sim.entity.pos, cellCenter(level, a.cell)) - dist(sim.entity.pos, cellCenter(level, b.cell)))
      .slice(0, 4);
    const steps: PlanStep[] = fixtures.map((fx) => ({ op: 'killLight', fixture: fx.id }) as PlanStep);
    steps.push({
      op: 'ambush',
      cell: ambCell,
      facing: angleTo(cellCenter(level, ambCell), watch),
      duration: 50,
      watch,
      radius: 4,
    });
    return this.plan('funnel', 'T', steps, `kill ${fixtures.length} light(s) on one route and leave the other lit — then wait beside the lit one`);
  }

  buildHerd(): Plan | null {
    const sim = this.sim;
    const { level } = sim;
    const route = this.predictedRoute();
    if (!route || route.length < 10) return null;
    const idx = Math.min(route.length - 1, sim.rng.int(8, 16));
    const bCell = route[idx]!;
    const b = cellCenter(level, bCell);
    const amb = this.darkCellNear(bCell, 2, b, new Set(route));
    const ambCell = amb >= 0 ? amb : bCell;
    if (!this.reachable(ambCell)) return null;
    if (this.herdVent(b) < 0) return null;
    return this.plan(
      'herd',
      'T',
      [
        { op: 'goto', cell: ambCell, mode: 'stalk' },
        { op: 'knock', vent: -1 },
        { op: 'ambush', cell: ambCell, facing: angleTo(cellCenter(level, ambCell), b), duration: 40, watch: b, radius: 5 },
      ],
      'wait where you are going, then make noise behind you so you hurry toward it',
    );
  }

  /** A vent behind the player relative to the ambush, chosen at the moment of knocking. */
  herdVent(ambush: Vec2): number {
    const sim = this.sim;
    const pl = sim.player;
    const dPB = dist(pl.pos, ambush);
    let best = -1;
    let bestScore = -Infinity;
    for (const v of sim.world.vents) {
      const p = cellCenter(sim.level, v.access);
      const dPV = dist(pl.pos, p);
      if (dPV < 4 || dPV > 13) continue;
      const behind = dist(p, ambush) - dPB;
      if (behind < 4) continue;
      const score = behind - Math.abs(dPV - 7) * 0.3 + sim.rng.range(0, 1);
      if (score > bestScore) {
        bestScore = score;
        best = v.id;
      }
    }
    return best;
  }

  buildRelocate(): Plan | null {
    const sim = this.sim;
    const { level, world } = sim;
    const pl = sim.player;
    const needed: Item[] = world.items.filter((i) => {
      if (i.state !== 'ground' || i.relocated) return false;
      if (i.kind === 'fuse') return pl.inv.fuses < world.fusesRequired;
      if (i.kind === 'key') return !pl.inv.keys.has('maintenance') && world.doors.some((d) => d.lock === 'maintenance' && d.locked);
      return false;
    });
    const items = needed.filter((i) => dist(i.pos, pl.pos) >= 8 && !this.visibleToPlayer(i.pos));
    if (!items.length) return null;
    const playerRegion = world.regionAt(pl.cell);
    const rooms = level.regions.filter((r) => {
      if (!r.deadEnd || r.kind !== 'room' || r.id === playerRegion) return false;
      if (!r.links.some((l) => l.via >= 0)) return false;
      const lum = r.cells.reduce((a, c) => a + world.lighting.lumAt(c), 0) / r.cells.length;
      return lum < 0.2 && dist(cellCenter(level, r.center), pl.pos) >= 8;
    });
    if (!rooms.length) return null;
    const item = sim.rng.pick(items);
    rooms.sort((a, b) => dist(cellCenter(level, a.center), item.pos) - dist(cellCenter(level, b.center), item.pos));
    for (const room of rooms.slice(0, 3)) {
      const doorCell = room.links.find((l) => l.via >= 0)!.via;
      const door = world.doorAt.get(doorCell);
      if (!door || door.locked) continue;
      const dp = cellCenter(level, doorCell);
      let deep = room.center;
      let dd = -1;
      for (const c of room.cells) {
        if (level.tiles[c] !== Tile.Floor) continue;
        const d = dist(cellCenter(level, c), dp);
        if (d > dd) {
          dd = d;
          deep = c;
        }
      }
      const outside = door.sides.find((s) => level.regionOf[s] !== room.id)!;
      const camp = this.darkCellNear(outside, 3, dp, new Set(room.cells));
      const campCell = camp >= 0 ? camp : outside;
      if (!this.reachable(cellAt(level, item.pos))) continue;
      return this.plan(
        'relocate',
        'T',
        [
          { op: 'pickup', item: item.id },
          { op: 'drop', cell: deep },
          { op: 'ambush', cell: campCell, facing: angleTo(cellCenter(level, campCell), dp), duration: 75, watch: dp, radius: 3.5 },
        ],
        `move the ${item.kind} you need into a dead-end ${level.zones[room.zone]!.name} room and camp the approach`,
      );
    }
    return null;
  }

  // ------------------------------------------------------------------ U / V / X / Y builders

  buildBreaker(): Plan | null {
    const sim = this.sim;
    const { level } = sim;
    const acc = sim.world.fuseBox.access;
    const ap = cellCenter(level, acc);
    const region = level.regions[level.regionOf[acc]!]!;
    let best = -1;
    let bestScore = Infinity;
    for (const c of region.cells) {
      if (level.tiles[c] !== Tile.Floor) continue;
      const d = dist(cellCenter(level, c), ap);
      if (d < 2.5 || d > 5) continue;
      if (!sim.world.los(cellCenter(level, c), ap)) continue;
      const score = sim.world.lighting.lumAt(c) * 10 + Math.abs(d - 3.5) + sim.rng.range(0, 0.5);
      if (score < bestScore) {
        bestScore = score;
        best = c;
      }
    }
    if (best < 0) return null;
    return this.plan(
      'breakerAmbush',
      'U',
      [
        { op: 'goto', cell: best, mode: 'stalk' },
        { op: 'ambush', cell: best, facing: angleTo(cellCenter(level, best), ap), duration: 120, watch: ap, radius: 2.5 },
      ],
      'you have the fuses; you must stand at the breaker — it waits in the dark beside it',
    );
  }

  buildTapWatch(): Plan | null {
    const sim = this.sim;
    const { level } = sim;
    const pl = sim.player;
    const taps = [...sim.world.taps].sort((a, b) => dist(cellCenter(level, a.access), pl.pos) - dist(cellCenter(level, b.access), pl.pos));
    const tap = taps[0];
    if (!tap) return null;
    const tp = cellCenter(level, tap.access);
    const amb = this.darkCellNear(tap.access, 4, tp, new Set([tap.access]));
    if (amb < 0 || !this.reachable(amb)) return null;
    return this.plan(
      'tapWatch',
      'V',
      [
        { op: 'goto', cell: amb, mode: 'stalk' },
        { op: 'ambush', cell: amb, facing: angleTo(cellCenter(level, amb), tp), duration: 45, watch: tp, radius: 3 },
      ],
      'you are marked, and it has learned you go to water',
    );
  }

  buildMimic(): Plan | null {
    const sim = this.sim;
    const { level } = sim;
    const pl = sim.player;
    const sv = sim.rng.weighted(sim.survivors.list, (s) => 0.3 + s.attachment + (s.alive ? 0 : 2) + (s.met ? 1 : 0));
    if (!sv) return null;
    const route = this.predictedRoute() ?? [];
    const cands: number[] = [];
    for (const c of route.slice(9, 20)) cands.push(c);
    for (let i = 0; i < 30; i++) {
      const a = sim.rng.range(0, Math.PI * 2);
      const r = sim.rng.range(9, 15);
      const c = cellAt(level, { x: pl.pos.x + Math.cos(a) * r, y: pl.pos.y + Math.sin(a) * r });
      if (c >= 0) cands.push(c);
    }
    for (const c of cands) {
      if (level.tiles[c] !== Tile.Floor) continue;
      if (sim.world.lighting.lumAt(c) > 0.12) continue;
      const p = cellCenter(level, c);
      const d = dist(p, pl.pos);
      if (d < 8 || d > 16) continue;
      if (!this.reachable(c)) continue;
      return this.plan(
        'mimic',
        'X',
        [{ op: 'mimic', survivor: sv.id, cell: c, duration: 50 }],
        `wear ${sv.def.name}${sv.alive ? '' : ' (already gone)'} — it has learned you answer that voice`,
      );
    }
    return null;
  }

  buildRouteCounter(regionId: number): Plan | null {
    const sim = this.sim;
    const { level, world } = sim;
    this.handledRoutes.add(regionId);
    const region = level.regions[regionId];
    if (!region) return null;
    const doors = region.links
      .filter((l) => l.via >= 0)
      .map((l) => world.doorAt.get(l.via)!)
      .filter((d) => d && !d.locked && !d.jammed);
    if (doors.length) {
      const door = sim.rng.pick(doors);
      return this.plan('jam', 'Y', [{ op: 'jam', door: door.index }], `barricade a door on ${level.zones[region.zone]!.name}, your safe route`);
    }
    const c = region.center;
    const p = cellCenter(level, c);
    return this.plan(
      'routeAmbush',
      'Y',
      [{ op: 'ambush', cell: c, facing: sim.rng.range(-Math.PI, Math.PI), duration: 45, watch: p, radius: 5 }],
      `wait on your safe route through ${level.zones[region.zone]!.name}`,
    );
  }

  /** The Entity answered the radio and named the wrong gate [U]. It goes there to wait. */
  radioAmbush(gate: Gate): Plan | null {
    const sim = this.sim;
    const { level } = sim;
    const gp = cellCenter(level, gate.access);
    const amb = this.darkCellNear(gate.access, 4, gp, new Set([gate.access]));
    const cell = amb >= 0 ? amb : gate.access;
    return this.plan(
      'radioAmbush',
      'U',
      [
        { op: 'goto', cell, mode: 'stalk' },
        { op: 'ambush', cell, facing: angleTo(cellCenter(level, cell), gp), duration: 160, watch: gp, radius: 5 },
      ],
      `it told you to come to ${gate.label}. It is waiting there.`,
    );
  }
}

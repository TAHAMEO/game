import { idleInput, type InputState } from '../src/core/input';
import { cellAt, cellCenter, Tile } from '../src/core/level';
import { angleDiff, angleTo, dist } from '../src/core/math';
import { distanceField, findPath } from '../src/core/path';
import type { Sim } from '../src/core/sim';

/**
 * A crude scripted player for headless soak runs. It is not trying to play well —
 * it exists to drive every system (doors, items, hiding, breaker, radio, gates)
 * so the simulation can be exercised for minutes of game time without a human.
 */
export class Bot {
  private path: number[] = [];
  private goal = -1;
  private repathAt = 0;
  private hideUntil = 0;
  private stuckT = 0;
  private lastPos = { x: 0, y: 0 };
  private wander = -1;

  constructor(private readonly sim: Sim, private readonly opts: { hides?: boolean; torch?: boolean; panicky?: boolean; flees?: boolean } = {}) {}

  input(): InputState {
    const sim = this.sim;
    const pl = sim.player;
    const inp = idleInput();
    if (!pl.alive) return inp;
    const ent = sim.entity;
    const dEnt = dist(ent.pos, pl.pos);

    if (this.opts.panicky) inp.turn = Math.sin(sim.time * 7) * 0.12;

    if (pl.hidden) {
      if (sim.time > this.hideUntil && dEnt > 6) inp.interactPressed = true;
      inp.holdBreath = dEnt < 4 && pl.breath.held < 4;
      return inp;
    }
    if (pl.channel) {
      inp.interact = true;
      return inp;
    }
    // Under threat: hide in whatever is in front (if it can't see us), otherwise flee.
    const threatened = ent.stateKind === 'chase' || ent.stateKind === 'lunge' || (ent.threatening && dEnt < 6);
    const seen = sim.world.los(ent.pos, pl.pos) && dEnt < 9;
    if (this.opts.hides !== false && threatened && (!seen || dEnt > 7) && pl.focus?.kind === 'spot' && !pl.focus.spot.occupant && !pl.focus.spot.cluttered && !pl.focus.spot.body) {
      inp.interactPressed = true;
      this.hideUntil = sim.time + 10 + sim.rng.range(0, 15);
      return inp;
    }
    if (this.opts.flees) {
      // the tilt means it is listening: freeze, hold your breath
      if (ent.tell?.kind === 'tilt' && dEnt < 12 && ent.stateKind === 'listen') {
        inp.holdBreath = pl.breath.held < 6;
        return inp;
      }
      const chased = ent.stateKind === 'chase' || ent.stateKind === 'lunge';
      const searching = !chased && ent.threatening && dEnt < 11;
      if (chased || searching) {
        // the lesson every survivor learns: the torch is a beacon
        if (pl.flashlight.on) inp.flashlightPressed = true;
        const out = this.flee(inp, dEnt);
        if (searching) {
          out.sprint = false;
          out.crouch = true;
        }
        return out;
      }
    }
    if (this.opts.torch && sim.world.lighting.sample(pl.pos) < 0.1 && !pl.flashlight.on && sim.time % 7 < 0.02) inp.flashlightPressed = true;

    const target = this.targetCell();
    if (target !== this.goal || sim.time > this.repathAt || !this.path.length) {
      this.goal = target;
      this.repathAt = sim.time + 1.5;
      this.path = findPath(sim.level, pl.cell, target, { passable: (c) => sim.world.humanPassable(c) || this.isDoor(c) }) ?? [];
    }
    while (this.path.length && this.path[0] === pl.cell) this.path.shift();
    const next = this.path[0];
    // Interact with whatever we came for.
    const f = pl.focus;
    if (f) {
      if (f.kind === 'item' && f.item.kind !== 'note') inp.interactPressed = true;
      else if (f.kind === 'door' && f.door.target < 0.5 && next === f.door.cell) inp.interactPressed = true;
      else if (f.kind === 'fusebox' && pl.inv.fuses >= sim.world.fusesRequired && !sim.objectives.powerOn) inp.interactPressed = inp.interact = true;
      else if (f.kind === 'radio' && sim.objectives.powerOn && !sim.objectives.calls.length) inp.interactPressed = inp.interact = true;
      else if (f.kind === 'gate' && sim.objectives.gateOpen(f.gate)) inp.interactPressed = inp.interact = true;
      else if (f.kind === 'tap' && pl.isMarked) inp.interactPressed = inp.interact = true;
    }
    if (next === undefined) {
      // At the goal cell: face the thing we want to use.
      const lookAt = this.lookTarget();
      if (lookAt) inp.turn = Math.max(-0.2, Math.min(0.2, angleDiff(pl.angle, angleTo(pl.pos, lookAt))));
      return inp;
    }
    const np = cellCenter(sim.level, next);
    const want = angleTo(pl.pos, np);
    const da = angleDiff(pl.angle, want);
    inp.turn = Math.max(-0.25, Math.min(0.25, da)) + inp.turn;
    inp.forward = Math.abs(da) < 0.9 ? 1 : 0.1;
    inp.sprint = ent.stateKind === 'chase' && dEnt < 8;
    if (dist(this.lastPos, pl.pos) < 0.002) this.stuckT += 1 / 60;
    else this.stuckT = 0;
    this.lastPos = { ...pl.pos };
    if (this.stuckT > 1.5) {
      inp.strafe = Math.sin(sim.time * 3);
      this.repathAt = 0;
    }
    return inp;
  }

  private fleeGoal = -1;
  private fleeUntil = 0;

  /** Run for somewhere it can't reach before you can, then look for a place to hide. */
  private flee(inp: InputState, dEnt: number): InputState {
    const sim = this.sim;
    const pl = sim.player;
    if (sim.time > this.fleeUntil || this.fleeGoal < 0 || pl.cell === this.fleeGoal) {
      const pass = (c: number) => sim.world.humanPassable(c) || this.isDoor(c);
      const fromEnt = distanceField(sim.level, [sim.entity.cell], sim.world.entityPassable, 40);
      const fromMe = distanceField(sim.level, [pl.cell], pass, 18);
      let best = -1;
      let bestScore = -Infinity;
      for (let c = 0; c < fromMe.length; c++) {
        const dm = fromMe[c]!;
        if (!Number.isFinite(dm) || dm < 4) continue;
        const de = fromEnt[c]!;
        const margin = (Number.isFinite(de) ? de : 60) - dm;
        const nearSpot = sim.world.spots.some((sp) => sp.access === c && !sp.occupant && !sp.cluttered && !sp.body) ? 4 : 0;
        const score = margin + nearSpot + dm * 0.15;
        if (score > bestScore) {
          bestScore = score;
          best = c;
        }
      }
      this.fleeGoal = best;
      this.fleeUntil = sim.time + 2;
      this.repathAt = 0;
    }
    this.goal = this.fleeGoal;
    if (sim.time > this.repathAt) {
      this.repathAt = sim.time + 0.5;
      this.path = findPath(sim.level, pl.cell, this.fleeGoal, { passable: (c) => sim.world.humanPassable(c) || this.isDoor(c) }) ?? [];
    }
    while (this.path.length && this.path[0] === pl.cell) this.path.shift();
    const next = this.path[0];
    if (next === undefined) {
      // at the goal: face the nearest hiding place
      const spot = sim.world.spots.find((sp) => sp.access === pl.cell && !sp.occupant && !sp.cluttered && !sp.body);
      if (spot) inp.turn = Math.max(-0.3, Math.min(0.3, angleDiff(pl.angle, angleTo(pl.pos, cellCenter(sim.level, spot.cell)))));
      return inp;
    }
    const f = pl.focus;
    if (f && f.kind === 'door' && f.door.target < 0.5 && next === f.door.cell) inp.interactPressed = true;
    const da = angleDiff(pl.angle, angleTo(pl.pos, cellCenter(sim.level, next)));
    inp.turn = Math.max(-0.3, Math.min(0.3, da));
    inp.forward = Math.abs(da) < 1 ? 1 : 0.2;
    inp.sprint = dEnt < 10 && (this.sim.entity.stateKind === 'chase' || this.sim.entity.stateKind === 'lunge');
    return inp;
  }

  private isDoor(c: number): boolean {
    const d = this.sim.world.doorAt.get(c);
    return !!d && !d.jammed && (!d.locked || (d.lock === 'maintenance' && this.sim.player.inv.keys.has('maintenance')));
  }

  private targetCell(): number {
    const sim = this.sim;
    const pl = sim.player;
    if (pl.isMarked && sim.features.theMark) {
      const tap = [...sim.world.taps].sort((a, b) => dist(cellCenter(sim.level, a.access), pl.pos) - dist(cellCenter(sim.level, b.access), pl.pos))[0];
      if (tap) return tap.access;
    }
    const t = sim.objectives.predictedTarget();
    if (t >= 0 && findPath(sim.level, pl.cell, t, { passable: (c) => sim.world.humanPassable(c) || this.isDoor(c) })) return t;
    if (this.wander < 0 || pl.cell === this.wander) {
      const r = sim.rng.pick(sim.level.regions);
      this.wander = r.center;
    }
    return this.wander;
  }

  private lookTarget() {
    const sim = this.sim;
    const pl = sim.player;
    const t = this.goal;
    for (const wo of sim.level.wallObjects) if (wo.access === t) return cellCenter(sim.level, wo.cell);
    for (const it of sim.world.items) if (it.state === 'ground' && cellAt(sim.level, it.pos) === pl.cell) return it.pos;
    if (sim.level.tiles[t] === Tile.Floor) return cellCenter(sim.level, t);
    return null;
  }
}

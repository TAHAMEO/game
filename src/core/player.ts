import { TUNING } from './config';
import { LOCK_LABELS } from './hospital';
import type { InputState } from './input';
import { cellAt, cellCenter, isStaticOpaque, Tile } from './level';
import { angleDiff, angleTo, approach, clamp01, dist, lerp, wrapAngle, type Vec2 } from './math';
import type { Sim } from './sim';
import type { DoorState, Gate, HidingSpot, Item, Prop, Tap } from './types';

export type Focus =
  | { kind: 'door'; door: DoorState }
  | { kind: 'spot'; spot: HidingSpot }
  | { kind: 'item'; item: Item }
  | { kind: 'tap'; tap: Tap }
  | { kind: 'fusebox' }
  | { kind: 'radio' }
  | { kind: 'gate'; gate: Gate }
  | { kind: 'vent' }
  | { kind: 'survivor'; id: number }
  | { kind: 'prop'; prop: Prop };

export type ChannelKind = 'breaker' | 'radio' | 'wash' | 'gate' | 'force';

interface Channel {
  kind: ChannelKind;
  t: number;
  dur: number;
  tap?: Tap;
  gate?: Gate;
  door?: DoorState;
  tick: number;
}

const P = TUNING.player;
const L = TUNING.loudness;

export class Player {
  pos: Vec2;
  angle: number;
  vel: Vec2 = { x: 0, y: 0 };
  /** Actual speed this step, cells/s. */
  speed = 0;
  /** |turn| in rad/s this step — the raw material of the stress estimate. */
  turnRate = 0;
  crouching = false;
  sprinting = false;
  exhausted = false;
  stamina = 1;
  /** 0..1 panting after exertion. */
  exertion = 0;
  alive = true;
  wounded = false;
  deathCause = '';
  hidden: HidingSpot | null = null;
  hiddenFor = 0;
  hideBase = 0;
  transition: { spot: HidingSpot; t: number; dur: number; entering: boolean } | null = null;
  readonly breath = { holding: false, held: 0, next: 2, recover: 0 };
  /** You start with the torch lit: the brightest thing in the building, and the first habit it will tax [S]. */
  readonly flashlight = { on: true, battery: 1, faultUntil: 0 };
  readonly inv = { fuses: 0, keys: new Set<string>(), batteries: 0, bottles: 1 };
  /** Scent mark [V]. */
  markedUntil = 0;
  channel: Channel | null = null;
  focus: Focus | null = null;
  readingNote: number | null = null;
  private readingAt: Vec2 = { x: 0, y: 0 };
  bob = 0;
  eye = 0.5;
  lastHurt = -99;
  private stepAccum = 0;

  constructor(private readonly sim: Sim, readonly name: string) {
    const level = sim.level;
    this.pos = cellCenter(level, level.spawn);
    this.angle = -Math.PI / 2;
  }

  get cell(): number {
    return cellAt(this.sim.level, this.pos);
  }

  get dir(): Vec2 {
    return { x: Math.cos(this.angle), y: Math.sin(this.angle) };
  }

  get isMarked(): boolean {
    return this.sim.time < this.markedUntil;
  }

  /** Where your body actually is for sound purposes (hidden → the spot's access cell). */
  get soundCell(): number {
    return this.hidden ? this.hidden.access : this.cell;
  }

  /** In the open, visible, catchable. Transitions count as exposed. */
  get exposed(): boolean {
    return this.alive && (!this.hidden || this.transition !== null);
  }

  update(dt: number, input: InputState): void {
    if (!this.alive) return;
    // Reading holds your eyes, not your feet: walking off, hiding or starting a job puts it down.
    if (this.readingNote !== null && (this.hidden || this.transition || this.channel || dist(this.pos, this.readingAt) > 0.5)) {
      this.readingNote = null;
    }
    this.turnRate = Math.abs(input.turn) / Math.max(dt, 1e-4);

    if (input.flashlightPressed) this.toggleFlashlight();
    this.updateFlashlight(dt);
    this.updateBreath(dt, input);

    if (this.transition) {
      this.updateTransition(dt);
      this.speed = 0;
      return;
    }
    if (this.hidden) {
      this.hiddenFor += dt;
      const span = this.hidden.kind === 'bed' ? 1.4 : 0.95;
      this.angle = this.hideBase + Math.max(-span, Math.min(span, angleDiff(this.hideBase, this.angle + input.turn)));
      this.angle = wrapAngle(this.angle);
      this.speed = 0;
      this.exertion = Math.max(0, this.exertion - dt * 0.06);
      this.stamina = Math.min(1, this.stamina + dt * P.staminaRegen);
      if (input.interactPressed) this.exitHide();
      return;
    }

    this.angle = wrapAngle(this.angle + input.turn);
    this.crouching = input.crouch;
    if (this.channel) {
      // Committed: you stand still while you work. Moving away cancels.
      this.vel = { x: 0, y: 0 };
      this.speed = 0;
      this.updateChannel(dt, input);
    } else {
      this.updateMovement(dt, input);
      this.updateFocus();
      if (input.interactPressed && this.focus) this.interact(this.focus);
    }
    if (input.throwPressed) this.throwBottle();
  }

  // ------------------------------------------------------------- movement

  private updateMovement(dt: number, input: InputState): void {
    const sim = this.sim;
    if (this.stamina <= 0.01) this.exhausted = true;
    if (this.exhausted && this.stamina > 0.35) this.exhausted = false;
    const moving = Math.abs(input.forward) > 0.05 || Math.abs(input.strafe) > 0.05;
    this.sprinting = input.sprint && input.forward > 0.1 && !this.crouching && !this.exhausted && moving;
    let speed = this.crouching ? P.crouchSpeed : this.sprinting ? P.sprintSpeed : P.walkSpeed;
    if (this.wounded) speed *= 0.95;
    const f = this.dir;
    const r = { x: Math.cos(this.angle + Math.PI / 2), y: Math.sin(this.angle + Math.PI / 2) };
    let wx = f.x * input.forward + r.x * input.strafe;
    let wy = f.y * input.forward + r.y * input.strafe;
    const wl = Math.hypot(wx, wy);
    if (wl > 1) {
      wx /= wl;
      wy /= wl;
    }
    const accel = 14 * dt;
    this.vel.x = approach(this.vel.x, wx * speed, accel * Math.max(1, speed));
    this.vel.y = approach(this.vel.y, wy * speed, accel * Math.max(1, speed));
    const before = { ...this.pos };
    this.tryMove(this.vel.x * dt, 0);
    this.tryMove(0, this.vel.y * dt);
    const moved = dist(before, this.pos);
    this.speed = moved / Math.max(dt, 1e-4);

    if (this.sprinting && this.speed > 0.5) {
      this.stamina = Math.max(0, this.stamina - P.staminaDrain * dt);
      this.exertion = Math.min(1, this.exertion + dt * 0.22);
    } else {
      this.stamina = Math.min(1, this.stamina + P.staminaRegen * dt * (this.speed < 0.2 ? 1.5 : 1));
      this.exertion = Math.max(0, this.exertion - dt * 0.07);
    }

    this.stepAccum += moved;
    const stride = this.crouching ? 0.62 : this.sprinting ? 1.05 : 0.8;
    if (this.stepAccum >= stride) {
      this.stepAccum -= stride;
      const loud = this.crouching ? L.stepCrouch : this.sprinting ? L.stepSprint : L.stepWalk;
      sim.emitNoise('step', this.pos, loud + (this.wounded ? 3 : 0), 'player');
    }
    this.bob += moved * (this.sprinting ? 7 : 5.5);
    const targetEye = this.crouching ? 0.33 : 0.5;
    this.eye = approach(this.eye, targetEye, dt * 1.5);
  }

  private tryMove(dx: number, dy: number): void {
    const nx = this.pos.x + dx;
    const ny = this.pos.y + dy;
    const r = P.radius;
    const world = this.sim.world;
    const lvl = this.sim.level;
    for (const [ox, oy] of [
      [-r, -r],
      [r, -r],
      [-r, r],
      [r, r],
    ] as const) {
      const c = cellAt(lvl, { x: nx + ox, y: ny + oy });
      if (world.isSolid(c)) return;
    }
    this.pos.x = nx;
    this.pos.y = ny;
  }

  // ------------------------------------------------------------- breath [I, V]

  private updateBreath(dt: number, input: InputState): void {
    const sim = this.sim;
    const b = this.breath;
    const capacity = P.breathCapacity * (1 - 0.45 * this.exertion) * (this.wounded ? 0.85 : 1);
    b.recover = Math.max(0, b.recover - dt);
    if (input.holdBreath && b.recover <= 0) {
      if (!b.holding) {
        b.holding = true;
        b.held = 0;
      }
      b.held += dt;
      if (b.held >= capacity) {
        // The gasp. Holding too long costs more than never holding at all.
        b.holding = false;
        b.held = 0;
        b.recover = 2.5;
        this.exertion = Math.max(this.exertion, 0.7);
        sim.emitNoise('gasp', this.headPos(), L.gasp, 'player');
        this.exhale(1.6);
        sim.director.onGasp();
      }
      return;
    }
    if (b.holding) {
      b.holding = false;
      const frac = clamp01(b.held / capacity);
      if (b.held > 0.4) {
        sim.emitNoise('exhale', this.headPos(), 5 + 13 * frac * frac, 'player');
        this.exhale(0.6 + frac);
        b.recover = 0.6 + frac;
      }
      b.held = 0;
      b.next = 1.2;
      return;
    }
    b.next -= dt;
    if (b.next <= 0) {
      b.next = lerp(3.2, 0.9, this.exertion);
      const enclosed = this.hidden && this.hidden.kind !== 'bed' ? -3 : 0;
      const loud = lerp(L.breathCalm, L.breathPanting, this.exertion) + enclosed;
      sim.emitNoise('breath', this.headPos(), loud, 'player');
      this.exhale(0.5 + this.exertion * 0.7);
    }
  }

  private headPos(): Vec2 {
    if (this.hidden) return cellCenter(this.sim.level, this.hidden.access);
    return this.pos;
  }

  /** Breath fog in cold zones: a slow, silent beacon [V]. */
  private exhale(size: number): void {
    const sim = this.sim;
    if (!sim.features.breathFog) return;
    const cell = this.soundCell;
    if (!sim.world.isCold(cell)) return;
    const d = this.dir;
    const spot = this.hidden;
    const pos = spot ? this.leakPos(spot) : { x: this.pos.x + d.x * 0.35, y: this.pos.y + d.y * 0.35 };
    sim.world.fog.push({ pos, t: sim.time, size, spot: spot ? spot.id : -1 });
  }

  /** Where breath escapes a hiding spot: the slats / the gap under the bed. */
  leakPos(spot: HidingSpot): Vec2 {
    const lvl = this.sim.level;
    const s = cellCenter(lvl, spot.cell);
    const a = cellCenter(lvl, spot.access);
    return { x: lerp(s.x, a.x, 0.55), y: lerp(s.y, a.y, 0.55) };
  }

  // ------------------------------------------------------------- flashlight [S]

  private toggleFlashlight(): void {
    const sim = this.sim;
    const fl = this.flashlight;
    sim.emitNoise('click', this.headPos(), L.flashlightClick, 'player');
    if (!fl.on && sim.time < fl.faultUntil) {
      sim.director.onFlashlight(false, true);
      return;
    }
    if (!fl.on && fl.battery <= 0.01) {
      if (this.inv.batteries > 0) this.swapBattery();
      else {
        sim.notice('Dead. Nothing but the click.');
        return;
      }
    }
    fl.on = !fl.on;
    sim.director.onFlashlight(fl.on, false);
  }

  private swapBattery(): void {
    this.inv.batteries--;
    this.flashlight.battery = 1;
    this.sim.notice('You swap the battery by feel.');
  }

  private updateFlashlight(dt: number): void {
    const fl = this.flashlight;
    if (this.sim.time < fl.faultUntil) {
      fl.on = false;
      return;
    }
    if (!fl.on) return;
    fl.battery = Math.max(0, fl.battery - P.flashlightDrainPerSec * dt);
    if (fl.battery <= 0.01) {
      if (this.inv.batteries > 0) this.swapBattery();
      else {
        fl.on = false;
        this.sim.notice('The torch dies.');
      }
    }
  }

  /** The tool that calms you becomes the tool that betrays you [S]. */
  faultFlashlight(seconds: number): void {
    this.flashlight.faultUntil = this.sim.time + seconds;
    this.flashlight.on = false;
  }

  // ------------------------------------------------------------- focus & interaction

  private updateFocus(): void {
    const sim = this.sim;
    const { level, world } = sim;
    const d = this.dir;
    let best: Focus | null = null;
    let bestD = Infinity;
    const myCell = this.cell;
    for (let s = 0.15; s <= P.interactRange; s += 0.08) {
      const p = { x: this.pos.x + d.x * s, y: this.pos.y + d.y * s };
      const c = cellAt(level, p);
      if (c < 0 || c === myCell) continue;
      const t = level.tiles[c]!;
      if (t === Tile.Floor) continue;
      if (t === Tile.Door) {
        best = { kind: 'door', door: world.doorAt.get(c)! };
        bestD = s;
        break;
      }
      if (t === Tile.Bed) {
        best = { kind: 'spot', spot: world.spotAt.get(c)! };
        bestD = s;
        break;
      }
      const wo = level.wallObjectAt.get(c);
      if (wo) {
        if (wo.kind === 'locker' || wo.kind === 'drawer') best = { kind: 'spot', spot: world.spotAt.get(c)! };
        else if (wo.kind === 'tap') best = { kind: 'tap', tap: world.tapAt.get(c)! };
        else if (wo.kind === 'fusebox') best = { kind: 'fusebox' };
        else if (wo.kind === 'radio') best = { kind: 'radio' };
        else if (wo.kind === 'gate') best = { kind: 'gate', gate: world.gateAt.get(c)! };
        else best = { kind: 'vent' };
        bestD = s;
        break;
      }
      if (isStaticOpaque(t)) break;
    }
    const consider = (pos: Vec2, f: Focus) => {
      const dd = dist(this.pos, pos);
      if (dd > 1.5) return;
      const a = Math.abs(angleDiff(this.angle, angleTo(this.pos, pos)));
      if (a > 0.65) return;
      const score = dd + a * 0.8;
      if (score < bestD) {
        bestD = score;
        best = f;
      }
    };
    for (const it of world.items) if (it.state === 'ground') consider(it.pos, { kind: 'item', item: it });
    for (const sv of sim.survivors.list) if (sv.alive && !sv.spot && sim.survivors.canTalk(sv)) consider(sv.pos, { kind: 'survivor', id: sv.id });
    for (const pr of world.props) consider(pr.pos, { kind: 'prop', prop: pr });
    this.focus = best;
  }

  promptFor(f: Focus | null): string | null {
    if (!f) return null;
    const sim = this.sim;
    switch (f.kind) {
      case 'door':
        if (f.door.locked) return f.door.lock === 'maintenance' && this.inv.keys.has('maintenance') ? 'Unlock door' : 'Try door';
        if (f.door.jammed) return 'Force door (loud)';
        return f.door.target > 0.5 ? 'Close door' : this.crouching ? 'Ease door open' : 'Open door';
      case 'spot': {
        const s = f.spot;
        if (s.kind === 'bed') return s.cluttered ? 'Look under bed' : 'Hide under bed';
        return s.kind === 'drawer' ? 'Climb into drawer' : 'Hide in locker';
      }
      case 'item':
        return f.item.kind === 'note' ? 'Read note' : `Take ${f.item.kind === 'key' ? 'key' : f.item.kind}`;
      case 'tap':
        return this.isMarked ? 'Wash it off (hold)' : 'Run the tap (hold)';
      case 'fusebox':
        return sim.objectives.powerOn ? 'Breaker (live)' : `Restore power (hold) — fuses ${this.inv.fuses}/${sim.world.fusesRequired}`;
      case 'radio':
        return 'Use radio (hold)';
      case 'gate':
        return 'Open gate (hold)';
      case 'vent':
        return 'Listen at vent';
      case 'survivor':
        return `Talk to ${sim.survivors.list[f.id]!.def.name}`;
      case 'prop':
        return `Examine ${f.prop.label}`;
    }
  }

  private interact(f: Focus): void {
    const sim = this.sim;
    switch (f.kind) {
      case 'door':
        this.useDoor(f.door);
        break;
      case 'spot':
        this.enterHide(f.spot);
        break;
      case 'item':
        this.pickup(f.item);
        break;
      case 'tap':
        this.channel = { kind: 'wash', t: 0, dur: this.isMarked ? 4 : 1.5, tap: f.tap, tick: 0 };
        sim.touch(f.tap.cell, cellCenter(sim.level, f.tap.cell), 'tap');
        break;
      case 'fusebox':
        if (sim.objectives.powerOn) sim.notice('The breaker hums. Power is on.');
        else if (this.inv.fuses < sim.world.fusesRequired)
          sim.notice(`Three empty sockets. You have ${this.inv.fuses} fuse${this.inv.fuses === 1 ? '' : 's'}.`);
        else {
          this.channel = { kind: 'breaker', t: 0, dur: 3.5, tick: 0 };
          sim.touch(sim.world.fuseBox.cell, cellCenter(sim.level, sim.world.fuseBox.cell), 'fusebox');
          sim.director.onBreakerStart();
        }
        break;
      case 'radio':
        if (!sim.objectives.powerOn) sim.notice('Dead. No power to the set.');
        else {
          this.channel = { kind: 'radio', t: 0, dur: 3, tick: 0 };
          sim.touch(sim.world.radio.cell, cellCenter(sim.level, sim.world.radio.cell), 'radio');
        }
        break;
      case 'gate':
        sim.touch(f.gate.cell, cellCenter(sim.level, f.gate.cell), 'gate');
        if (sim.objectives.gateOpen(f.gate)) this.channel = { kind: 'gate', t: 0, dur: 1.2, gate: f.gate, tick: 0 };
        else {
          sim.emitNoise('rattle', this.pos, L.rattle, 'player');
          sim.notice('Chained shut from outside.');
          sim.director.onFalseLeadAttempt();
        }
        break;
      case 'vent':
        sim.notice('Cold air breathes out of the grate. The ducts run everywhere.');
        break;
      case 'survivor':
        sim.survivors.talk(f.id);
        break;
      case 'prop':
        sim.notice(f.prop.examine, 6);
        sim.director.onExamine(f.prop);
        break;
    }
  }

  private useDoor(door: DoorState): void {
    const sim = this.sim;
    const pos = cellCenter(sim.level, door.cell);
    sim.touch(door.cell, pos, 'door');
    if (door.locked) {
      if (door.lock === 'maintenance' && this.inv.keys.has('maintenance')) {
        door.locked = false;
        sim.world.lockVersion++;
        sim.emitNoise('door', pos, 18, 'player');
        sim.notice('The key turns.');
      } else {
        sim.emitNoise('rattle', pos, L.rattle, 'player');
        sim.notice(`Locked. ${door.lock ? LOCK_LABELS[door.lock] : ''}`);
        sim.director.onFalseLeadAttempt();
        return;
      }
    }
    if (door.jammed) {
      // Barricaded [Y]. Never for good: hold to shove it, which costs time and noise.
      sim.emitNoise('rattle', pos, L.rattle, 'player');
      sim.notice('It gives an inch and stops. Something heavy is holding it.');
      sim.director.onJammedDoor(door);
      this.channel = { kind: 'force', t: 0, dur: 3.5, door, tick: 0.5 };
      return;
    }
    const closing = door.target > 0.5;
    if (closing && cellAt(sim.level, this.pos) === door.cell) return;
    door.target = closing ? 0 : 1;
    door.speed = this.crouching ? 1.1 : 0.45;
    sim.emitNoise('door', pos, this.crouching ? L.doorQuiet : L.door, 'player');
    sim.director.onDoor(door, closing);
  }

  private pickup(item: Item): void {
    const sim = this.sim;
    if (item.kind === 'note') {
      const note = sim.world.notes[item.noteId!]!;
      note.read = true;
      this.readingNote = note.id;
      this.readingAt = { ...this.pos };
      sim.director.onNoteRead(note);
      return;
    }
    item.state = 'taken';
    sim.emitNoise('pickup', item.pos, 8, 'player');
    switch (item.kind) {
      case 'fuse':
        this.inv.fuses++;
        sim.notice(`Fuse (${this.inv.fuses}/${sim.world.fusesRequired}).`);
        break;
      case 'key':
        this.inv.keys.add('maintenance');
        sim.notice('A key on a lanyard: MAINTENANCE.');
        break;
      case 'battery':
        this.inv.batteries++;
        sim.notice('A battery.');
        break;
      case 'bottle':
        this.inv.bottles++;
        sim.notice('An empty bottle. Something to throw.');
        break;
    }
    sim.director.onPickup(item);
  }

  private updateChannel(dt: number, input: InputState): void {
    const sim = this.sim;
    const ch = this.channel!;
    const wantsToMove = Math.abs(input.forward) > 0.1 || Math.abs(input.strafe) > 0.1;
    if (!input.interact || wantsToMove) {
      if (ch.kind === 'wash' && ch.tap) ch.tap.running = 1.5;
      this.channel = null;
      return;
    }
    ch.t += dt;
    ch.tick -= dt;
    if (ch.tick <= 0) {
      ch.tick = 0.5;
      if (ch.kind === 'wash' && ch.tap) {
        ch.tap.running = 2;
        sim.emitNoise('tap', cellCenter(sim.level, ch.tap.access), L.tap, 'world');
      } else if (ch.kind === 'radio') {
        sim.emitNoise('radio', cellCenter(sim.level, sim.world.radio.access), L.radio, 'world');
      } else if (ch.kind === 'breaker') {
        sim.emitNoise('hum', cellCenter(sim.level, sim.world.fuseBox.access), 22, 'world');
      } else if (ch.kind === 'force' && ch.door) {
        sim.emitNoise('rattle', cellCenter(sim.level, ch.door.cell), L.rattle, 'player');
      }
    }
    if (ch.t < ch.dur) return;
    this.channel = null;
    switch (ch.kind) {
      case 'wash':
        if (this.isMarked) {
          this.markedUntil = 0;
          sim.notice('The black comes away in cold strings.');
          sim.director.onWashed();
        } else sim.notice('Cold water. Your hands stop shaking, a little.');
        break;
      case 'breaker':
        this.inv.fuses -= sim.world.fusesRequired;
        sim.objectives.restorePower();
        break;
      case 'radio':
        sim.objectives.useRadio();
        break;
      case 'gate':
        sim.objectives.escapeThrough(ch.gate!);
        break;
      case 'force': {
        const door = ch.door!;
        if (!door.jammed) break;
        door.jammed = false;
        door.target = 1;
        door.speed = 0.6;
        sim.world.lockVersion++;
        sim.emitNoise('doorBash', cellCenter(sim.level, door.cell), L.doorBash, 'player');
        sim.notice('Whatever was holding it scrapes back. The door gives.');
        break;
      }
    }
  }

  get channelProgress(): number {
    return this.channel ? clamp01(this.channel.t / this.channel.dur) : 0;
  }

  // ------------------------------------------------------------- hiding [J]

  private enterHide(spot: HidingSpot): void {
    const sim = this.sim;
    if (spot.occupant) {
      if (spot.occupant.kind === 'survivor') sim.survivors.whisperOccupied(spot.occupant.id);
      return;
    }
    if (spot.body) {
      sim.notice(spot.body, 7);
      sim.director.onFoundRemains();
      return;
    }
    if (spot.kind === 'bed' && spot.cluttered) {
      sim.notice('Boxes and a rolled mattress. No room under here.');
      return;
    }
    const quiet = this.crouching || spot.ajar;
    const dur = spot.ajar ? 0.35 : spot.kind === 'bed' ? 0.8 : 0.65;
    this.transition = { spot, t: 0, dur, entering: true };
    spot.occupant = { kind: 'player' };
    const at = cellCenter(sim.level, spot.access);
    if (spot.kind === 'bed') sim.emitNoise('drag', at, quiet ? 6 : 12, 'player');
    else if (!spot.ajar) sim.emitNoise('locker', at, quiet ? L.lockerQuiet : L.locker, 'player');
    sim.touch(spot.cell, cellCenter(sim.level, spot.cell), spot.kind);
    sim.director.onHide(spot, true);
  }

  exitHide(): void {
    const spot = this.hidden;
    if (!spot || this.transition) return;
    const sim = this.sim;
    this.transition = { spot, t: 0, dur: 0.5, entering: false };
    const at = cellCenter(sim.level, spot.access);
    if (spot.kind === 'bed') sim.emitNoise('drag', at, this.crouching ? 6 : 10, 'player');
    else sim.emitNoise('locker', at, L.lockerQuiet + 6, 'player');
    sim.touch(spot.cell, cellCenter(sim.level, spot.cell), spot.kind);
  }

  private updateTransition(dt: number): void {
    const tr = this.transition!;
    tr.t += dt;
    if (tr.t < tr.dur) return;
    const sim = this.sim;
    const spot = tr.spot;
    this.transition = null;
    const acc = cellCenter(sim.level, spot.access);
    const sc = cellCenter(sim.level, spot.cell);
    if (tr.entering) {
      this.hidden = spot;
      this.hiddenFor = 0;
      spot.ajar = false;
      this.hideBase = angleTo(sc, acc);
      this.angle = this.hideBase;
      if (spot.kind === 'bed') {
        this.pos = { ...sc };
        this.eye = 0.1;
      } else {
        this.pos = { x: lerp(acc.x, sc.x, 0.42), y: lerp(acc.y, sc.y, 0.42) };
        this.eye = 0.5;
      }
      this.vel = { x: 0, y: 0 };
    } else {
      this.hidden = null;
      spot.occupant = null;
      this.pos = { ...acc };
      this.angle = angleTo(sc, acc);
      this.eye = this.crouching ? 0.33 : 0.5;
      sim.director.onHide(spot, false);
    }
  }

  // ------------------------------------------------------------- throwing

  private throwBottle(): void {
    const sim = this.sim;
    if (this.inv.bottles <= 0 || this.hidden) return;
    this.inv.bottles--;
    const d = this.dir;
    sim.world.projectiles.push({
      pos: { x: this.pos.x + d.x * 0.3, y: this.pos.y + d.y * 0.3 },
      vel: { x: d.x * 9, y: d.y * 9 },
      t: 0,
      origin: { ...this.pos },
    });
    sim.emitNoise('whoosh', this.pos, L.throwWhoosh, 'player', { origin: { ...this.pos } });
    sim.director.onThrow();
  }

  // ------------------------------------------------------------- harm

  /** Returns true if this blow killed you. */
  hurt(cause: string): boolean {
    const sim = this.sim;
    this.lastHurt = sim.time;
    if (this.wounded) {
      this.die(cause);
      return true;
    }
    this.wounded = true;
    this.stamina = 1;
    this.exhausted = false;
    this.exertion = 1;
    sim.events.push({ type: 'shake', amount: 1 });
    sim.notice('It opened you up. You can still run.', 4);
    return false;
  }

  die(cause: string): void {
    if (!this.alive) return;
    this.alive = false;
    this.deathCause = cause;
    this.channel = null;
    this.sim.onPlayerDeath(cause);
  }
}

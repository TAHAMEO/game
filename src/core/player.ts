import { TUNING } from './config';
import { Perception } from './director/perception';
import { StressModel } from './director/stress';
import { LOCK_LABELS } from './hospital';
import type { InputState } from './input';
import { cellAt, cellCenter, isStaticOpaque, Tile, type Level } from './level';
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

/** How far you can look up or down (radians). */
export const PITCH_LIMIT = 1.3;

export interface Inventory {
  /** Fuses and keys are carried for the whole group: anyone can use them at the breaker or a door. */
  fuses: number;
  keys: Set<string>;
  batteries: number;
  bottles: number;
}

export class Player {
  pos: Vec2;
  angle: number;
  /** Vertical look, radians (positive = up). It aims the torch, too. */
  pitch = 0;
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
  /** Got out through the gate. Escaped players watch the others, like the dead do. */
  escaped = false;
  wounded = false;
  deathCause = '';
  hidden: HidingSpot | null = null;
  hiddenFor = 0;
  hideBase = 0;
  transition: { spot: HidingSpot; t: number; dur: number; entering: boolean } | null = null;
  readonly breath = { holding: false, held: 0, next: 2, recover: 0 };
  /** You start with the torch lit: the brightest thing in the building, and the first habit it will tax [S]. */
  readonly flashlight = { on: true, battery: 1, faultUntil: 0 };
  readonly inv: Inventory;
  /** Your own fear, as the Director reads it [S]. Never shown. */
  readonly stress = new StressModel();
  /** What your panic shows you and nobody else [S]. */
  readonly perception: Perception;
  /** Scent mark [V]. */
  markedUntil = 0;
  channel: Channel | null = null;
  focus: Focus | null = null;
  readingNote: number | null = null;
  /** A case-file page in your hands [story]. */
  readingRecord: number | null = null;
  readingAt: Vec2 = { x: 0, y: 0 };
  bob = 0;
  eye = 0.5;
  lastHurt = -99;
  private stepAccum = 0;

  constructor(
    private readonly sim: Sim,
    readonly name: string,
    readonly id = 0,
  ) {
    const level = sim.level;
    this.pos = cellCenter(level, level.spawn);
    this.angle = -Math.PI / 2;
    if (id > 0) {
      // Everyone comes in through reception, shoulder to shoulder.
      const offs = [
        { x: 0.6, y: 0.3 },
        { x: -0.6, y: 0.3 },
        { x: 0, y: 0.75 },
      ];
      const o = offs[(id - 1) % offs.length]!;
      const p = { x: this.pos.x + o.x, y: this.pos.y + o.y };
      if (!sim.world.isSolid(cellAt(level, p))) this.pos = p;
    }
    const team = sim.team;
    this.inv = {
      get fuses() {
        return team.fuses;
      },
      set fuses(v: number) {
        team.fuses = v;
      },
      keys: team.keys,
      batteries: 0,
      bottles: 1,
    };
    this.perception = new Perception(sim, this);
  }

  /** Still in the building and alive: someone the Entity can hunt. */
  get active(): boolean {
    return this.alive && !this.escaped;
  }

  /** First name, for the people who shout it. */
  get shortName(): string {
    return this.name.split(' ').pop() ?? this.name;
  }

  private note(text: string, duration?: number): void {
    this.sim.notice(text, duration, this.id);
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
    if (!this.active) return;
    // Reading holds your eyes, not your feet: walking off, hiding or starting a job puts it down.
    if ((this.readingNote !== null || this.readingRecord !== null) && (this.hidden || this.transition || this.channel || dist(this.pos, this.readingAt) > 0.5)) {
      this.readingNote = null;
      this.readingRecord = null;
    }
    this.turnRate = Math.abs(input.turn) / Math.max(dt, 1e-4);
    const pitchLimit = this.hidden ? 0.55 : PITCH_LIMIT;
    this.pitch = Math.max(-pitchLimit, Math.min(pitchLimit, this.pitch + (input.pitch ?? 0)));

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
      this.refreshFocus();
      if (input.interactPressed && this.focus) this.interact(this.focus);
    }
    if (input.throwPressed) this.throwBottle();
  }

  // ------------------------------------------------------------- movement

  private updateMovement(dt: number, input: InputState): void {
    const sim = this.sim;
    const moved = moveBody(this, input, dt, sim.level, sim.world);
    this.stepAccum += moved;
    const stride = this.crouching ? 0.62 : this.sprinting ? 1.05 : 0.8;
    if (this.stepAccum >= stride) {
      this.stepAccum -= stride;
      const loud = this.crouching ? L.stepCrouch : this.sprinting ? L.stepSprint : L.stepWalk;
      sim.emitNoise('step', this.pos, loud + (this.wounded ? 3 : 0), 'player', { player: this.id });
    }
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
        sim.emitNoise('gasp', this.headPos(), L.gasp, 'player', { player: this.id });
        this.exhale(1.6);
        sim.director.onGasp(this);
      }
      return;
    }
    if (b.holding) {
      b.holding = false;
      const frac = clamp01(b.held / capacity);
      if (b.held > 0.4) {
        sim.emitNoise('exhale', this.headPos(), 5 + 13 * frac * frac, 'player', { player: this.id });
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
      sim.emitNoise('breath', this.headPos(), loud, 'player', { player: this.id });
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
    sim.emitNoise('click', this.headPos(), L.flashlightClick, 'player', { player: this.id });
    if (!fl.on && sim.time < fl.faultUntil) {
      sim.director.onFlashlight(false, true, this);
      return;
    }
    if (!fl.on && fl.battery <= 0.01) {
      if (this.inv.batteries > 0) this.swapBattery();
      else {
        this.note('Dead. Nothing but the click.');
        return;
      }
    }
    fl.on = !fl.on;
    sim.director.onFlashlight(fl.on, false, this);
  }

  private swapBattery(): void {
    this.inv.batteries--;
    this.flashlight.battery = 1;
    this.note('You swap the battery by feel.');
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
        this.note('The torch dies.');
      }
    }
  }

  /** The tool that calms you becomes the tool that betrays you [S]. */
  faultFlashlight(seconds: number): void {
    this.flashlight.faultUntil = this.sim.time + seconds;
    this.flashlight.on = false;
  }

  // ------------------------------------------------------------- focus & interaction

  /** What you are looking at and could use. Public so a remote client can work it out locally. */
  refreshFocus(): void {
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
        if (f.item.kind === 'record') return 'Pick up the page';
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
        if (sim.objectives.powerOn) this.note('The breaker hums. Power is on.');
        else if (this.inv.fuses < sim.world.fusesRequired)
          this.note(`Three empty sockets. You have ${this.inv.fuses} fuse${this.inv.fuses === 1 ? '' : 's'}.`);
        else {
          this.channel = { kind: 'breaker', t: 0, dur: 3.5, tick: 0 };
          sim.touch(sim.world.fuseBox.cell, cellCenter(sim.level, sim.world.fuseBox.cell), 'fusebox');
          sim.director.onBreakerStart();
        }
        break;
      case 'radio':
        if (!sim.objectives.powerOn) this.note('Dead. No power to the set.');
        else {
          this.channel = { kind: 'radio', t: 0, dur: 3, tick: 0 };
          sim.touch(sim.world.radio.cell, cellCenter(sim.level, sim.world.radio.cell), 'radio');
        }
        break;
      case 'gate':
        sim.touch(f.gate.cell, cellCenter(sim.level, f.gate.cell), 'gate');
        if (sim.objectives.gateOpen(f.gate)) this.channel = { kind: 'gate', t: 0, dur: 1.2, gate: f.gate, tick: 0 };
        else {
          sim.emitNoise('rattle', this.pos, L.rattle, 'player', { player: this.id });
          this.note('Chained shut from outside.');
          sim.director.onFalseLeadAttempt(this);
        }
        break;
      case 'vent':
        this.note('Cold air breathes out of the grate. The ducts run everywhere.');
        break;
      case 'survivor':
        sim.survivors.talk(f.id, this);
        break;
      case 'prop':
        this.note(f.prop.examine, 6);
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
        sim.emitNoise('door', pos, 18, 'player', { player: this.id });
        this.note('The key turns.');
      } else {
        sim.emitNoise('rattle', pos, L.rattle, 'player', { player: this.id });
        this.note(`Locked. ${door.lock ? LOCK_LABELS[door.lock] : ''}`);
        sim.director.onFalseLeadAttempt(this);
        return;
      }
    }
    if (door.jammed) {
      // Barricaded [Y]. Never for good: hold to shove it, which costs time and noise.
      sim.emitNoise('rattle', pos, L.rattle, 'player', { player: this.id });
      this.note('It gives an inch and stops. Something heavy is holding it.');
      sim.director.onJammedDoor(door);
      this.channel = { kind: 'force', t: 0, dur: 3.5, door, tick: 0.5 };
      return;
    }
    const closing = door.target > 0.5;
    if (closing && sim.players.some((p) => p.active && cellAt(sim.level, p.pos) === door.cell)) return;
    door.target = closing ? 0 : 1;
    door.speed = this.crouching ? 1.1 : 0.45;
    sim.emitNoise('door', pos, this.crouching ? L.doorQuiet : L.door, 'player', { player: this.id });
    sim.director.onDoor(door, closing);
  }

  private pickup(item: Item): void {
    const sim = this.sim;
    if (item.kind === 'note') {
      const note = sim.world.notes[item.noteId!]!;
      note.read = true;
      this.readingRecord = null;
      this.readingNote = note.id;
      this.readingAt = { ...this.pos };
      sim.director.onNoteRead(note);
      return;
    }
    if (item.kind === 'record') {
      item.state = 'taken';
      sim.emitNoise('pickup', item.pos, 6, 'player', { player: this.id });
      sim.story.onRecordFound(item, this);
      return;
    }
    item.state = 'taken';
    sim.emitNoise('pickup', item.pos, 8, 'player', { player: this.id });
    const shared = sim.players.length > 1;
    switch (item.kind) {
      case 'fuse':
        this.inv.fuses++;
        if (shared) sim.notice(`${this.shortName} has a fuse (${this.inv.fuses}/${sim.world.fusesRequired}).`);
        else this.note(`Fuse (${this.inv.fuses}/${sim.world.fusesRequired}).`);
        break;
      case 'key':
        this.inv.keys.add('maintenance');
        if (shared) sim.notice(`${this.shortName} found a key on a lanyard: MAINTENANCE.`);
        else this.note('A key on a lanyard: MAINTENANCE.');
        break;
      case 'battery':
        this.inv.batteries++;
        this.note('A battery.');
        break;
      case 'bottle':
        this.inv.bottles++;
        this.note('An empty bottle. Something to throw.');
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
    // Washing off the mark takes longer than rinsing your hands, even if it lands mid-rinse [V].
    if (ch.kind === 'wash') ch.dur = this.isMarked ? 4 : 1.5;
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
        sim.emitNoise('rattle', cellCenter(sim.level, ch.door.cell), L.rattle, 'player', { player: this.id });
      }
    }
    if (ch.t < ch.dur) return;
    this.channel = null;
    switch (ch.kind) {
      case 'wash':
        if (this.isMarked) {
          this.markedUntil = 0;
          this.note('The black comes away in cold strings.');
          sim.director.onWashed();
        } else this.note('Cold water. Your hands stop shaking, a little.');
        break;
      case 'breaker':
        this.inv.fuses -= sim.world.fusesRequired;
        sim.objectives.restorePower();
        break;
      case 'radio':
        sim.objectives.useRadio();
        break;
      case 'gate':
        sim.objectives.escapeThrough(ch.gate!, this);
        break;
      case 'force': {
        const door = ch.door!;
        if (!door.jammed) break;
        door.jammed = false;
        door.target = 1;
        door.speed = 0.6;
        sim.world.lockVersion++;
        sim.emitNoise('doorBash', cellCenter(sim.level, door.cell), L.doorBash, 'player', { player: this.id });
        this.note('Whatever was holding it scrapes back. The door gives.');
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
      if (spot.occupant.kind === 'survivor') sim.survivors.whisperOccupied(spot.occupant.id, this);
      else this.note(`${sim.players[spot.occupant.id ?? 0]?.shortName ?? 'Someone'} is already in there.`);
      return;
    }
    if (spot.body) {
      this.note(spot.body, 7);
      sim.director.onFoundRemains(this);
      return;
    }
    if (spot.kind === 'bed' && spot.cluttered) {
      this.note('Boxes and a rolled mattress. No room under here.');
      return;
    }
    const quiet = this.crouching || spot.ajar;
    const dur = spot.ajar ? 0.35 : spot.kind === 'bed' ? 0.8 : 0.65;
    this.transition = { spot, t: 0, dur, entering: true };
    spot.occupant = { kind: 'player', id: this.id };
    const at = cellCenter(sim.level, spot.access);
    if (spot.kind === 'bed') sim.emitNoise('drag', at, quiet ? 6 : 12, 'player', { player: this.id });
    else if (!spot.ajar) sim.emitNoise('locker', at, quiet ? L.lockerQuiet : L.locker, 'player', { player: this.id });
    sim.touch(spot.cell, cellCenter(sim.level, spot.cell), spot.kind);
    sim.director.onHide(spot, true, this);
  }

  exitHide(): void {
    const spot = this.hidden;
    if (!spot || this.transition) return;
    const sim = this.sim;
    this.transition = { spot, t: 0, dur: 0.5, entering: false };
    const at = cellCenter(sim.level, spot.access);
    if (spot.kind === 'bed') sim.emitNoise('drag', at, this.crouching ? 6 : 10, 'player', { player: this.id });
    else sim.emitNoise('locker', at, L.lockerQuiet + 6, 'player', { player: this.id });
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
      this.pitch = 0;
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
      this.pitch = 0;
      sim.director.onHide(spot, false, this);
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
      player: this.id,
    });
    sim.emitNoise('whoosh', this.pos, L.throwWhoosh, 'player', { origin: { ...this.pos }, player: this.id });
    sim.director.onThrow(this);
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
    sim.events.push({ type: 'shake', amount: 1, to: this.id });
    this.note('It opened you up. You can still run.', 4);
    return false;
  }

  die(cause: string): void {
    if (!this.alive || this.escaped) return;
    this.alive = false;
    this.deathCause = cause;
    this.channel = null;
    this.readingNote = null;
    this.readingRecord = null;
    this.sim.onPlayerDeath(this, cause);
  }

  /** Out through the gate. */
  escape(): void {
    if (this.active) this.sim.onEscape(this);
  }
}

/** The parts of a player that walking moves. */
export interface Body {
  pos: Vec2;
  vel: Vec2;
  angle: number;
  speed: number;
  crouching: boolean;
  sprinting: boolean;
  exhausted: boolean;
  stamina: number;
  exertion: number;
  wounded: boolean;
  bob: number;
  eye: number;
}

/**
 * One step of walking: speed, stamina, collision, head bob. Shared by the simulation and by
 * a guest in a shared run predicting their own body between the host's snapshots, so both
 * move a body by exactly the same rules. Returns the distance moved.
 */
export function moveBody(b: Body, input: InputState, dt: number, level: Level, world: { isSolid(cell: number): boolean }): number {
  if (b.stamina <= 0.01) b.exhausted = true;
  if (b.exhausted && b.stamina > 0.35) b.exhausted = false;
  const moving = Math.abs(input.forward) > 0.05 || Math.abs(input.strafe) > 0.05;
  b.sprinting = input.sprint && input.forward > 0.1 && !b.crouching && !b.exhausted && moving;
  let speed = b.crouching ? P.crouchSpeed : b.sprinting ? P.sprintSpeed : P.walkSpeed;
  if (b.wounded) speed *= 0.95;
  const f = { x: Math.cos(b.angle), y: Math.sin(b.angle) };
  const r = { x: Math.cos(b.angle + Math.PI / 2), y: Math.sin(b.angle + Math.PI / 2) };
  let wx = f.x * input.forward + r.x * input.strafe;
  let wy = f.y * input.forward + r.y * input.strafe;
  const wl = Math.hypot(wx, wy);
  if (wl > 1) {
    wx /= wl;
    wy /= wl;
  }
  const accel = 14 * dt;
  b.vel.x = approach(b.vel.x, wx * speed, accel * Math.max(1, speed));
  b.vel.y = approach(b.vel.y, wy * speed, accel * Math.max(1, speed));
  const before = { ...b.pos };
  tryMove(b, b.vel.x * dt, 0, level, world);
  tryMove(b, 0, b.vel.y * dt, level, world);
  const moved = dist(before, b.pos);
  b.speed = moved / Math.max(dt, 1e-4);

  if (b.sprinting && b.speed > 0.5) {
    b.stamina = Math.max(0, b.stamina - P.staminaDrain * dt);
    b.exertion = Math.min(1, b.exertion + dt * 0.22);
  } else {
    b.stamina = Math.min(1, b.stamina + P.staminaRegen * dt * (b.speed < 0.2 ? 1.5 : 1));
    b.exertion = Math.max(0, b.exertion - dt * 0.07);
  }
  b.bob += moved * (b.sprinting ? 7 : 5.5);
  const targetEye = b.crouching ? 0.33 : 0.5;
  b.eye = approach(b.eye, targetEye, dt * 1.5);
  return moved;
}

function tryMove(b: Body, dx: number, dy: number, level: Level, world: { isSolid(cell: number): boolean }): void {
  const nx = b.pos.x + dx;
  const ny = b.pos.y + dy;
  const r = P.radius;
  for (const [ox, oy] of [
    [-r, -r],
    [r, -r],
    [-r, r],
    [r, r],
  ] as const) {
    const c = cellAt(level, { x: nx + ox, y: ny + oy });
    if (world.isSolid(c)) return;
  }
  b.pos.x = nx;
  b.pos.y = ny;
}

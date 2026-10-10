import { Lighting } from './lighting';
import { cellAt, cellCenter, isStaticOpaque, losClear, Tile, type Level } from './level';
import { distanceField } from './path';
import type { Vec2 } from './math';
import type { Rng } from './rng';
import type {
  DoorState,
  FogPuff,
  Gate,
  HidingSpot,
  Item,
  ItemKind,
  Note,
  Projectile,
  Prop,
  Tap,
  ThermalMark,
  Vent,
} from './types';

export interface WorldSetup {
  falseLeads: boolean;
}

/** Dynamic world state on top of the static level. */
export class World {
  readonly lighting: Lighting;
  readonly doors: DoorState[] = [];
  readonly doorAt = new Map<number, DoorState>();
  readonly spots: HidingSpot[] = [];
  readonly spotAt = new Map<number, HidingSpot>();
  readonly items: Item[] = [];
  readonly notes: Note[] = [];
  readonly taps: Tap[] = [];
  readonly tapAt = new Map<number, Tap>();
  readonly vents: Vent[] = [];
  readonly gates: Gate[] = [];
  readonly gateAt = new Map<number, Gate>();
  readonly fuseBox: { cell: number; access: number };
  readonly radio: { cell: number; access: number };
  readonly thermal: ThermalMark[] = [];
  readonly fog: FogPuff[] = [];
  readonly projectiles: Projectile[] = [];
  readonly props: Prop[] = [];
  /** Zones that a false note sends you to [U]. */
  readonly falseLeadZones = new Set<number>();
  fusesRequired = 3;
  /** Bumped whenever a lock changes, so reachability caches know to refresh. */
  lockVersion = 0;
  private nextId = 1;

  constructor(readonly level: Level, rng: Rng, setup: WorldSetup) {
    this.lighting = new Lighting(level, rng.fork());

    for (const [i, d] of level.doors.entries()) {
      const st: DoorState = {
        index: i,
        cell: d.cell,
        axis: d.axis,
        sides: d.sides,
        open: 0,
        target: 0,
        lock: d.lock,
        locked: d.lock !== null,
        jammed: false,
        speed: 1,
      };
      // Some doors were left open in the evacuation.
      if (!st.locked && rng.chance(0.35)) st.open = st.target = 1;
      this.doors.push(st);
      this.doorAt.set(d.cell, st);
    }

    let fuseBox: { cell: number; access: number } | null = null;
    let radio: { cell: number; access: number } | null = null;
    for (const wo of level.wallObjects) {
      switch (wo.kind) {
        case 'locker':
        case 'drawer':
          this.addSpot(wo.kind, wo.cell, wo.access, false);
          break;
        case 'tap': {
          const t: Tap = { id: this.taps.length, cell: wo.cell, access: wo.access, running: 0 };
          this.taps.push(t);
          this.tapAt.set(wo.cell, t);
          break;
        }
        case 'vent':
          this.vents.push({ id: this.vents.length, cell: wo.cell, access: wo.access });
          break;
        case 'fusebox':
          fuseBox = { cell: wo.cell, access: wo.access };
          break;
        case 'radio':
          radio = { cell: wo.cell, access: wo.access };
          break;
        case 'gate': {
          const info = level.gateInfo.get(wo.cell)!;
          const g: Gate = { id: info.id, cell: wo.cell, access: wo.access, label: info.label, open: false };
          this.gates.push(g);
          this.gateAt.set(wo.cell, g);
          break;
        }
      }
    }
    if (!fuseBox || !radio) throw new Error('map needs a fuse box and a radio');
    this.fuseBox = fuseBox;
    this.radio = radio;

    for (const bed of level.beds) {
      if (bed.access.length === 0) continue;
      this.addSpot('bed', bed.cell, bed.access[0]!, rng.chance(0.4));
    }

    this.placeItems(rng, setup);
  }

  private addSpot(kind: HidingSpot['kind'], cell: number, access: number, cluttered: boolean): void {
    const s: HidingSpot = {
      id: this.spots.length,
      kind,
      cell,
      access,
      occupant: null,
      ajar: false,
      cluttered,
      baited: false,
      body: null,
      lastChecked: -999,
    };
    this.spots.push(s);
    this.spotAt.set(cell, s);
  }

  newId(): number {
    return this.nextId++;
  }

  addItem(kind: ItemKind, cell: number, noteId?: number): Item {
    const p = cellCenter(this.level, cell);
    const it: Item = { id: this.newId(), kind, pos: { ...p }, origin: { ...p }, state: 'ground', relocated: false };
    if (noteId !== undefined) it.noteId = noteId;
    this.items.push(it);
    return it;
  }

  private placeItems(rng: Rng, setup: WorldSetup): void {
    const { level } = this;
    const m = level.markers;
    const fuseCells = rng.shuffle([...m.fuse]).slice(0, this.fusesRequired);
    for (const c of fuseCells) this.addItem('fuse', c);
    const keyCell = rng.pick(m.key);
    this.addItem('key', keyCell);
    const loose = rng.shuffle([...m.item]);
    loose.slice(0, 5).forEach((c) => this.addItem('battery', c));
    loose.slice(5, 11).forEach((c) => this.addItem('bottle', c));

    const zoneName = (c: number) => level.zones[level.zoneOf[c]!]!.name;
    const fuseZones = new Set(fuseCells.map((c) => level.zoneOf[c]!));
    const noteCells = rng.shuffle([...m.note]);
    const texts: Omit<Note, 'id' | 'read'>[] = [];
    // Honest notes: level logic tells the truth about one fuse and the key.
    texts.push({
      title: 'Shift handover',
      text: `Breaker blew again. Took the spare fuse down to ${zoneName(fuseCells[0]!)} — someone fetch it if the lights go.`,
      falseLead: false,
      pointsToZone: level.zoneOf[fuseCells[0]!]!,
    });
    texts.push({
      title: 'Security memo',
      text: `Maintenance key is no longer kept at the desk. Last seen in ${zoneName(keyCell)}.`,
      falseLead: false,
      pointsToZone: level.zoneOf[keyCell]!,
    });
    if (setup.falseLeads) {
      // A note that points nowhere [U]. The hospital wastes your time; the Entity spends it.
      const emptyZones = level.zones
        .map((_, i) => i)
        .filter((z) => !fuseZones.has(z) && level.markers.fuse.some((c) => level.zoneOf[c] === z));
      if (emptyZones.length) {
        const z = rng.pick(emptyZones);
        this.falseLeadZones.add(z);
        texts.push({
          title: 'Torn requisition',
          text: `Fuses (x2) restocked — ${level.zones[z]!.name}, bottom locker. Sign for them.`,
          falseLead: true,
          pointsToZone: z,
        });
      }
      texts.push({
        title: 'Pharmacy notice',
        text: 'Pharmacy holds a spare torch and batteries. Key with the duty manager.',
        falseLead: true,
        pointsToZone: level.zoneOf[level.doors.find((d) => d.lock === 'pharmacy')!.cell]!,
      });
    }
    texts.push({
      title: 'Scrawled on a glove box',
      text: 'it doesnt like being looked at. it likes being looked FOR',
      falseLead: false,
      pointsToZone: null,
    });
    texts.push({
      title: 'Incident form (unfinished)',
      text: 'Patient in Old Wing bed 4 reported "something that listens with its whole head." Old Wing sealed pending —',
      falseLead: false,
      pointsToZone: null,
    });
    for (let i = 0; i < Math.min(noteCells.length, texts.length); i++) {
      const note: Note = { id: i, read: false, ...texts[i]! };
      this.notes.push(note);
      this.addItem('note', noteCells[i]!, note.id);
    }
  }

  // ---------------------------------------------------------------- queries

  /** Can a body stand in this cell? */
  isSolid(cell: number): boolean {
    if (cell < 0) return true;
    const t = this.level.tiles[cell]!;
    if (t === Tile.Floor) return false;
    if (t === Tile.Door) {
      const d = this.doorAt.get(cell)!;
      return d.open < 0.85;
    }
    return true;
  }

  /** Dynamic opacity for sight lines. */
  isOpaque(cell: number): boolean {
    const t = this.level.tiles[cell]!;
    if (t === Tile.Door) return this.doorAt.get(cell)!.open < 0.5;
    return isStaticOpaque(t);
  }

  doorOpenness = (cell: number): number => this.doorAt.get(cell)?.open ?? 1;

  los(a: Vec2, b: Vec2): boolean {
    return losClear(this.level, a, b, (c) => this.isOpaque(c));
  }

  /** Cells the Entity can path through: floor and any door it can open. */
  entityPassable = (cell: number): boolean => {
    const t = this.level.tiles[cell]!;
    if (t === Tile.Floor) return true;
    if (t === Tile.Door) {
      const d = this.doorAt.get(cell)!;
      return !d.locked;
    }
    return false;
  };

  /** Cells a survivor or the player can path through (jammed doors stop them). */
  humanPassable = (cell: number): boolean => {
    const t = this.level.tiles[cell]!;
    if (t === Tile.Floor) return true;
    if (t === Tile.Door) {
      const d = this.doorAt.get(cell)!;
      return !d.locked && !d.jammed;
    }
    return false;
  };

  /**
   * Would barricading `doorCell` cut someone at `from` off from something the run needs:
   * the fuse box, the radio, either gate, or a fuse or the key still lying about?
   * Strategy dismantling [Y] may take a route away, never the way to the objective. Only
   * needs reachable now count, and the maintenance door counts as open (its key exists).
   */
  wouldStrand(doorCell: number, from: number): boolean {
    const reach = (barricade: number) =>
      distanceField(this.level, [from], (c) => {
        if (c === barricade) return false;
        const t = this.level.tiles[c]!;
        if (t === Tile.Floor) return true;
        if (t !== Tile.Door) return false;
        const d = this.doorAt.get(c)!;
        return !d.jammed && (!d.locked || d.lock === 'maintenance');
      });
    const needs = [this.fuseBox.access, this.radio.access, ...this.gates.map((g) => g.access)];
    for (const it of this.items) {
      if (it.state === 'ground' && (it.kind === 'fuse' || it.kind === 'key')) needs.push(cellAt(this.level, it.pos));
    }
    const before = reach(-1);
    const after = reach(doorCell);
    return needs.some((c) => c >= 0 && Number.isFinite(before[c]!) && !Number.isFinite(after[c]!));
  }

  isCold(cell: number): boolean {
    const z = this.level.zoneOf[cell]!;
    return z >= 0 && this.level.zones[z]!.cold;
  }

  zoneIndexAt(cell: number): number {
    return cell >= 0 ? this.level.zoneOf[cell]! : -1;
  }

  regionAt(cell: number): number {
    return cell >= 0 ? this.level.regionOf[cell]! : -1;
  }

  itemsOnGround(kind?: ItemKind): Item[] {
    return this.items.filter((i) => i.state === 'ground' && (!kind || i.kind === kind));
  }

  // ---------------------------------------------------------------- updates

  update(dt: number, time: number): void {
    for (const d of this.doors) {
      if (d.open !== d.target) {
        const step = dt / Math.max(0.05, d.speed);
        d.open = d.open < d.target ? Math.min(d.target, d.open + step) : Math.max(d.target, d.open - step);
      }
    }
    for (const t of this.taps) if (t.running > 0) t.running = Math.max(0, t.running - dt);
    // Heat fades; condensation prints fade with it [V].
    for (let i = this.thermal.length - 1; i >= 0; i--) {
      if (time - this.thermal[i]!.t > 60) this.thermal.splice(i, 1);
    }
    for (let i = this.fog.length - 1; i >= 0; i--) {
      if (time - this.fog[i]!.t > 2.6) this.fog.splice(i, 1);
    }
  }

  addThermal(cell: number, pos: Vec2, surface: ThermalMark['surface'], time: number): void {
    // Re-touching refreshes the print instead of stacking duplicates.
    const existing = this.thermal.find((m) => m.cell === cell);
    if (existing) {
      existing.t = time;
      existing.pos = { ...pos };
      return;
    }
    this.thermal.push({ id: this.newId(), cell, pos: { ...pos }, t: time, surface });
  }

  /** 1 = just touched, 0 = cold. */
  static heatOf(mark: ThermalMark, time: number): number {
    return Math.max(0, Math.exp(-(time - mark.t) / 22));
  }
}

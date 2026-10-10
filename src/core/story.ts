import { cellAt, cellCenter, Tile } from './level';
import { lerp } from './math';
import type { Player } from './player';
import { Rng } from './rng';
import type { Sim } from './sim';
import { CASE_FILES, endingFor, introLines, VISIONS, WALL_WRITINGS, WHISPERS, type Ending } from './storyText';
import type { Item } from './types';

/** Graffiti on one face of a wall cell. `face` is the direction from the wall to the floor it faces. */
export interface WallWriting {
  cell: number;
  face: 'e' | 'w' | 's' | 'n';
  text: string;
  /** 0..1 across the face and up the wall. */
  u: number;
  v: number;
  scale: number;
}

const FACES: ReadonlyArray<{ face: WallWriting['face']; dx: number; dy: number }> = [
  { face: 'e', dx: 1, dy: 0 },
  { face: 'w', dx: -1, dy: 0 },
  { face: 's', dx: 0, dy: 1 },
  { face: 'n', dx: 0, dy: -1 },
];

/**
 * The story layer. Case-file pages hidden in the building (found ones stay found across
 * every death), visions that some zones show you the first time you walk in, whispers when
 * it has been quiet too long, and words on the walls. None of it touches the Entity's
 * senses or the Director's pacing: it is what the building is remembering, not what it does.
 *
 * It rolls its own random stream, so turning it off never changes anything else.
 */
export class Story {
  readonly enabled: boolean;
  readonly writings: WallWriting[] = [];
  readonly records: Item[] = [];
  private readonly rng: Rng;
  private readonly entered = new Map<number, Set<string>>();
  private readonly visionReady = new Map<number, number>();
  private nextWhisper: number;

  constructor(private readonly sim: Sim) {
    this.enabled = sim.config.story !== false;
    this.rng = new Rng((sim.config.seed ^ 0x51a7e5) >>> 0);
    this.nextWhisper = 100 + this.rng.range(0, 60);
    if (!this.enabled) return;
    const save = sim.memory.data.story;
    for (const p of sim.players) {
      if (!save.names.includes(p.name)) save.names.push(p.name);
    }
    if (save.names.length > 60) save.names.splice(0, save.names.length - 60);
    this.placeRecords();
    this.placeWritings();
  }

  get total(): number {
    return CASE_FILES.length;
  }

  /** Pages found so far, across every life. */
  get pages(): number {
    return this.sim.memory.data.story.found.length;
  }

  // ------------------------------------------------------------------ setup

  /** The next pages you have not found, on loose-item spots nobody else is using. */
  private placeRecords(): void {
    const sim = this.sim;
    const { level, world } = sim;
    const found = new Set(sim.memory.data.story.found);
    const missing = CASE_FILES.filter((f) => !found.has(f.id)).map((f) => f.id);
    if (!missing.length) return;
    const count = Math.min(missing.length, sim.players.length > 1 ? 3 : 2);
    const used = new Set(world.items.map((it) => cellAt(level, it.origin)));
    const free = this.rng.shuffle([...level.markers.item, ...level.markers.note].filter((c) => !used.has(c)));
    for (let i = 0; i < count && i < free.length; i++) {
      const it = world.addItem('record', free[i]!);
      it.recordId = missing[i]!;
      this.records.push(it);
    }
  }

  private placeWritings(): void {
    const sim = this.sim;
    const { level } = sim;
    const pages = this.pages;
    const texts = this.rng.shuffle(WALL_WRITINGS.filter((w) => w.minPages <= pages).map((w) => w.text));
    const faces: { cell: number; face: WallWriting['face']; zone: string }[] = [];
    for (let c = 0; c < level.w * level.h; c++) {
      if (level.tiles[c] !== Tile.Wall) continue;
      const x = c % level.w;
      const y = Math.floor(c / level.w);
      for (const f of FACES) {
        const nx = x + f.dx;
        const ny = y + f.dy;
        if (nx < 0 || ny < 0 || nx >= level.w || ny >= level.h) continue;
        const n = ny * level.w + nx;
        if (level.tiles[n] !== Tile.Floor) continue;
        const z = level.zoneOf[n]!;
        if (z < 0 || level.zones[z]!.exterior) continue;
        faces.push({ cell: c, face: f.face, zone: level.zones[z]!.key });
      }
    }
    const nestFace = faces.find((f) => f.zone === 'n');
    if (nestFace) this.writings.push({ cell: nestFace.cell, face: nestFace.face, text: '@names', u: 0.5, v: 0.55, scale: 1 });
    const picked = this.rng.shuffle(faces.filter((f) => f.zone !== 'r' && f.zone !== 'n'));
    const usedCells = new Set<number>();
    for (const f of picked) {
      if (this.writings.length >= 8 || !texts.length) break;
      // Spread out: never two on the same stretch of wall.
      let near = false;
      for (const u of usedCells) if (Math.abs((u % level.w) - (f.cell % level.w)) + Math.abs(Math.floor(u / level.w) - Math.floor(f.cell / level.w)) < 6) near = true;
      if (near) continue;
      usedCells.add(f.cell);
      this.writings.push({ cell: f.cell, face: f.face, text: texts.pop()!, u: this.rng.range(0.3, 0.7), v: this.rng.range(0.42, 0.68), scale: this.rng.range(0.8, 1.25) });
    }
  }

  // ------------------------------------------------------------------ update

  update(dt: number): void {
    void dt;
    if (!this.enabled) return;
    const sim = this.sim;
    for (const pl of sim.players) {
      if (!pl.active) continue;
      const zi = sim.level.zoneOf[pl.cell] ?? -1;
      if (zi < 0) continue;
      const key = sim.level.zones[zi]!.key;
      let seen = this.entered.get(pl.id);
      if (!seen) {
        seen = new Set();
        this.entered.set(pl.id, seen);
      }
      if (seen.has(key)) continue;
      seen.add(key);
      if (sim.time > 20) this.maybeVision(pl, key, sim.level.zones[zi]!.name);
    }
    if (sim.time >= this.nextWhisper) {
      this.nextWhisper = sim.time + lerp(150, 55, sim.director.floor) + this.rng.range(0, 60);
      const quiet = sim.activePlayers.filter((p) => sim.entity.target !== p.id);
      if (quiet.length) {
        const pl = quiet[Math.floor(this.rng.next() * quiet.length)]!;
        const text = WHISPERS[Math.floor(this.rng.next() * WHISPERS.length)]!;
        sim.events.push({ type: 'story', beat: { kind: 'whisper', text }, to: pl.id });
        sim.log('story', `a whisper for ${pl.name}: "${text}"`);
      }
    }
  }

  private maybeVision(pl: Player, key: string, zoneName: string): void {
    const sim = this.sim;
    const v = VISIONS.find((x) => x.zone === key);
    if (!v) return;
    if (sim.time < (this.visionReady.get(pl.id) ?? 0)) return;
    const save = sim.memory.data.story;
    if (this.pages < v.minPages) return;
    const seenBefore = save.visions.includes(v.id);
    if (v.once && seenBefore) return;
    if (!v.once && seenBefore && !this.rng.chance(0.35)) return;
    if (sim.entity.target === pl.id) return;
    const others = save.names.filter((n) => !sim.players.some((p) => p.name === n));
    const names = others.length ? others.slice(-9).reverse().join('   ·   ') : 'Only one name, over and over. Yours.';
    const lines = v.lines.map((l) => l.replace('{names}', names));
    sim.events.push({ type: 'story', beat: { kind: 'vision', id: v.id, zone: zoneName, lines, duration: v.duration }, to: pl.id });
    if (!seenBefore) save.visions.push(v.id);
    this.visionReady.set(pl.id, sim.time + 75);
    pl.stress.spike(0.08);
    sim.log('story', `vision "${v.id}" for ${pl.name}`);
  }

  // ------------------------------------------------------------------ hooks

  onRecordFound(item: Item, pl: Player): void {
    const sim = this.sim;
    const id = item.recordId ?? -1;
    const file = CASE_FILES[id];
    if (!file) return;
    const save = sim.memory.data.story;
    if (!save.found.includes(id)) save.found.push(id);
    pl.readingRecord = id;
    pl.readingAt = { ...pl.pos };
    sim.events.push({ type: 'story', beat: { kind: 'record', id, title: file.title } });
    if (sim.players.length > 1) sim.notice(`${pl.shortName} found a page of a case file.`, 4);
    sim.log('story', `case file ${id + 1}/${CASE_FILES.length}: ${file.title}`);
    sim.memory.save();
  }

  onRunEnd(): void {
    if (!this.enabled) return;
    const save = this.sim.memory.data.story;
    for (const pl of this.sim.players) {
      const e = this.ending(pl);
      const tag = e.trueEnding ? 'true' : pl.escaped ? 'escape' : 'death';
      if (!save.endings.includes(tag)) save.endings.push(tag);
    }
  }

  // ------------------------------------------------------------------ words for the presentation layer

  recordText(id: number, reader: Player): { title: string; text: string } | null {
    const f = CASE_FILES[id];
    if (!f) return null;
    return { title: f.title, text: f.text.replace(/\{name\}/g, reader.name) };
  }

  intro(): string[] {
    const sim = this.sim;
    return introLines(
      sim.players.map((p) => p.name),
      sim.runNumber,
      this.pages,
      this.total,
    );
  }

  ending(pl: Player): Ending {
    return endingFor(pl.escaped ? 'escaped' : 'dead', pl.name, pl.deathCause || 'It caught you in the open.', this.enabled ? this.pages : 0, this.total);
  }

  /** Where a record lies, for the designer view. */
  recordCells(): number[] {
    return this.records.filter((r) => r.state === 'ground').map((r) => cellAt(this.sim.level, r.pos));
  }

  /** World position of the centre of a wall face (for the renderer). */
  faceCenter(w: WallWriting): { x: number; y: number } {
    const c = cellCenter(this.sim.level, w.cell);
    const f = FACES.find((x) => x.face === w.face)!;
    return { x: c.x + f.dx * 0.5, y: c.y + f.dy * 0.5 };
  }
}

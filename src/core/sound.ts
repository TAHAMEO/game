import { TUNING } from './config';
import { Tile, type Level } from './level';
import { CellHeap } from './path';

/**
 * Grid sound propagation. Loudness is "dB-ish": it drops by a fixed amount per cell
 * travelled, and closed doors cost a lot more than open ones. Walls block entirely —
 * sound travels the way you would walk, so it seems to come from the doorway it
 * arrives through (that is also how the player's audio is panned).
 */
export class SoundField {
  readonly field: Float32Array;
  private readonly heap = new CellHeap(512);
  private touched: number[] = [];

  constructor(private readonly level: Level) {
    this.field = new Float32Array(level.w * level.h);
  }

  /**
   * Propagate a sound from `origin`. `doorOpen(cell)` returns 0..1 openness.
   * Afterwards `levelAt(cell)` returns loudness at that cell (0 = inaudible).
   */
  propagate(origin: number, loudness: number, doorOpen: (cell: number) => number, minAudible = 1): void {
    for (const c of this.touched) this.field[c] = 0;
    this.touched = [];
    if (origin < 0 || loudness <= minAudible) return;
    const { level, field, heap } = this;
    const { tiles, w, h } = level;
    const per = TUNING.sound.falloffPerCell;
    heap.clear();
    field[origin] = loudness;
    this.touched.push(origin);
    // Priorities are read back from the Float32 field so the stale-entry check below
    // compares like with like (a Float64 key would skip cells on rounding).
    heap.push(origin, -field[origin]!);
    while (heap.size > 0) {
      const c = heap.pop();
      const lv = -heap.lastPriority;
      if (lv < field[c]!) continue;
      const x = c % w;
      const y = Math.floor(c / w);
      for (let k = 0; k < 4; k++) {
        const nx = x + (k === 0 ? 1 : k === 1 ? -1 : 0);
        const ny = y + (k === 2 ? 1 : k === 3 ? -1 : 0);
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const nc = ny * w + nx;
        const t = tiles[nc]!;
        let cost = per;
        if (t === Tile.Door) {
          const o = doorOpen(nc);
          cost += TUNING.sound.closedDoor * (1 - o) + TUNING.sound.openDoor * o;
        } else if (t === Tile.Cabinet) {
          cost += TUNING.sound.furniture;
        } else if (t !== Tile.Floor && t !== Tile.Bed) {
          continue;
        }
        // Compare in Float32 space: a value that only differs below Float32 precision is not
        // an improvement (comparing the Float64 value re-queued cells endlessly).
        const nl = Math.fround(lv - cost);
        if (nl <= minAudible || nl <= field[nc]!) continue;
        if (field[nc] === 0) this.touched.push(nc);
        field[nc] = nl;
        heap.push(nc, -nl);
      }
    }
  }

  levelAt(cell: number): number {
    return cell >= 0 ? this.field[cell]! : 0;
  }

  /**
   * Direction (radians) the sound appears to come from for a listener in `cell`:
   * climb the loudness gradient a few steps, so sound around a corner is heard
   * from the doorway, not through the wall.
   */
  apparentDirection(cell: number, steps = 4): number | null {
    const { w, h } = this.level;
    if (cell < 0 || this.field[cell]! <= 0) return null;
    let c = cell;
    for (let i = 0; i < steps; i++) {
      let best = c;
      let bestLv = this.field[c]!;
      const x = c % w;
      const y = Math.floor(c / w);
      const around = [x > 0 ? c - 1 : -1, x < w - 1 ? c + 1 : -1, y > 0 ? c - w : -1, y < h - 1 ? c + w : -1];
      for (const n of around) {
        if (n >= 0 && this.field[n]! > bestLv) {
          best = n;
          bestLv = this.field[n]!;
        }
      }
      if (best === c) break;
      c = best;
    }
    if (c === cell) return null;
    return Math.atan2(Math.floor(c / w) - Math.floor(cell / w), (c % w) - (cell % w));
  }
}

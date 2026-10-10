import type { Level } from './level';

/** Minimal binary min-heap of cell indices keyed by float priority. */
export class CellHeap {
  private cells: Int32Array;
  private prio: Float64Array;
  size = 0;

  constructor(capacity: number) {
    this.cells = new Int32Array(capacity);
    this.prio = new Float64Array(capacity);
  }

  clear(): void {
    this.size = 0;
  }

  push(cell: number, priority: number): void {
    if (this.size >= this.cells.length) {
      const nc = new Int32Array(this.cells.length * 2);
      nc.set(this.cells);
      const np = new Float64Array(this.prio.length * 2);
      np.set(this.prio);
      this.cells = nc;
      this.prio = np;
    }
    let i = this.size++;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (this.prio[parent]! <= priority) break;
      this.cells[i] = this.cells[parent]!;
      this.prio[i] = this.prio[parent]!;
      i = parent;
    }
    this.cells[i] = cell;
    this.prio[i] = priority;
  }

  /** Returns the cell with the lowest priority; `lastPriority` holds its key. */
  lastPriority = 0;
  pop(): number {
    const top = this.cells[0]!;
    this.lastPriority = this.prio[0]!;
    const n = --this.size;
    if (n > 0) {
      const cell = this.cells[n]!;
      const p = this.prio[n]!;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1;
        if (l >= n) break;
        const r = l + 1;
        const m = r < n && this.prio[r]! < this.prio[l]! ? r : l;
        if (this.prio[m]! >= p) break;
        this.cells[i] = this.cells[m]!;
        this.prio[i] = this.prio[m]!;
        i = m;
      }
      this.cells[i] = cell;
      this.prio[i] = p;
    }
    return top;
  }
}

export interface PathOptions {
  passable: (cell: number) => boolean;
  /** Extra cost for entering a cell (darkness preference, door handling, avoidance...). */
  extraCost?: (cell: number) => number;
  maxExpanded?: number;
}

const SQRT2 = Math.SQRT2;

/**
 * 8-connected A* without corner cutting. Returns the cell list from start (exclusive)
 * to goal (inclusive), or null when unreachable.
 */
export function findPath(level: Level, start: number, goal: number, opts: PathOptions): number[] | null {
  if (start === goal) return [];
  if (start < 0 || goal < 0) return null;
  const { w, h } = level;
  const n = w * h;
  const g = new Float64Array(n).fill(Infinity);
  const came = new Int32Array(n).fill(-1);
  const closed = new Uint8Array(n);
  const heap = new CellHeap(256);
  const gx = goal % w;
  const gy = Math.floor(goal / w);
  const heur = (c: number) => {
    const dx = Math.abs((c % w) - gx);
    const dy = Math.abs(Math.floor(c / w) - gy);
    return dx + dy + (SQRT2 - 2) * Math.min(dx, dy);
  };
  g[start] = 0;
  heap.push(start, heur(start));
  const maxExpanded = opts.maxExpanded ?? n;
  let expanded = 0;
  while (heap.size > 0) {
    const c = heap.pop();
    if (c === goal) break;
    if (closed[c]) continue;
    closed[c] = 1;
    if (++expanded > maxExpanded) return null;
    const cx = c % w;
    const cy = Math.floor(c / w);
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dy === 0) continue;
        const nx = cx + dx;
        const ny = cy + dy;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const nc = ny * w + nx;
        if (closed[nc] || !opts.passable(nc)) continue;
        if (dx !== 0 && dy !== 0) {
          // No corner cutting: both orthogonal neighbours must be open.
          if (!opts.passable(cy * w + nx) || !opts.passable(ny * w + cx)) continue;
        }
        const step = dx !== 0 && dy !== 0 ? SQRT2 : 1;
        const cost = g[c]! + step + (opts.extraCost ? opts.extraCost(nc) : 0);
        if (cost < g[nc]!) {
          g[nc] = cost;
          came[nc] = c;
          heap.push(nc, cost + heur(nc));
        }
      }
    }
  }
  if (came[goal] === -1) return null;
  const path: number[] = [];
  for (let c = goal; c !== start; c = came[c]!) path.push(c);
  path.reverse();
  return path;
}

/** Multi-source Dijkstra distance field over 4-connected passable cells. */
export function distanceField(
  level: Level,
  sources: readonly number[],
  passable: (cell: number) => boolean,
  maxDist = Infinity,
): Float32Array {
  const n = level.w * level.h;
  const dist = new Float32Array(n).fill(Infinity);
  const heap = new CellHeap(256);
  for (const s of sources) {
    if (s < 0) continue;
    dist[s] = 0;
    heap.push(s, 0);
  }
  const { w, h } = level;
  while (heap.size > 0) {
    const c = heap.pop();
    const d = heap.lastPriority;
    if (d > dist[c]!) continue;
    if (d > maxDist) break;
    const x = c % w;
    const y = Math.floor(c / w);
    const visit = (nc: number) => {
      if (!passable(nc)) return;
      const nd = d + 1;
      if (nd < dist[nc]!) {
        dist[nc] = nd;
        heap.push(nc, nd);
      }
    };
    if (x > 0) visit(c - 1);
    if (x < w - 1) visit(c + 1);
    if (y > 0) visit(c - w);
    if (y < h - 1) visit(c + w);
  }
  return dist;
}

import { isStaticOpaque, losClear, Tile, type Level } from './level';

/**
 * How much of the sky each cell sees: 1 outdoors, something near a window (with a clear
 * line to it), 0 deep inside. Lightning lights a place by it; rain is louder by it.
 */
export function skyExposure(level: Level): Float32Array {
  const n = level.w * level.h;
  const out = new Float32Array(n);
  const blocks = (c: number) => isStaticOpaque(level.tiles[c]!);
  const windows: { x: number; y: number }[] = [];
  for (let c = 0; c < n; c++) {
    const z = level.zoneOf[c]!;
    if (z >= 0 && level.zones[z]!.exterior) out[c] = 1;
    if (level.tiles[c] === Tile.Window) windows.push({ x: c % level.w, y: Math.floor(c / level.w) });
  }
  for (const wdw of windows) {
    for (let y = wdw.y - 6; y <= wdw.y + 6; y++) {
      for (let x = wdw.x - 6; x <= wdw.x + 6; x++) {
        if (x < 0 || y < 0 || x >= level.w || y >= level.h) continue;
        const c = y * level.w + x;
        if (isStaticOpaque(level.tiles[c]!)) continue;
        const d = Math.hypot(x - wdw.x, y - wdw.y);
        if (d > 6) continue;
        // Look from just inside the window, toward the cell.
        const from = { x: wdw.x + 0.5 + Math.sign(x - wdw.x) * 0.6, y: wdw.y + 0.5 + Math.sign(y - wdw.y) * 0.6 };
        if (!losClear(level, from, { x: x + 0.5, y: y + 0.5 }, blocks)) continue;
        out[c] = Math.max(out[c]!, 0.75 * Math.pow(1 - d / 6.5, 1.4));
      }
    }
  }
  return out;
}


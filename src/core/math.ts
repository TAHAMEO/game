export interface Vec2 {
  x: number;
  y: number;
}

export const vec = (x: number, y: number): Vec2 => ({ x, y });

export const dist = (a: Vec2, b: Vec2): number => Math.hypot(b.x - a.x, b.y - a.y);

export const dist2 = (a: Vec2, b: Vec2): number => {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  return dx * dx + dy * dy;
};

export const angleTo = (from: Vec2, to: Vec2): number => Math.atan2(to.y - from.y, to.x - from.x);

/** Wrap an angle into (-PI, PI]. */
export function wrapAngle(a: number): number {
  a = (a + Math.PI) % (Math.PI * 2);
  if (a < 0) a += Math.PI * 2;
  return a - Math.PI;
}

/** Signed smallest rotation that takes angle `a` to angle `b`. */
export const angleDiff = (a: number, b: number): number => wrapAngle(b - a);

export const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);

export const clamp01 = (v: number): number => clamp(v, 0, 1);

export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

export function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = clamp01((x - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
}

/** Move `current` toward `target` by at most `maxDelta`. */
export function approach(current: number, target: number, maxDelta: number): number {
  if (current < target) return Math.min(current + maxDelta, target);
  return Math.max(current - maxDelta, target);
}

/** Rotate angle `a` toward `b` by at most `maxDelta` radians. */
export function turnToward(a: number, b: number, maxDelta: number): number {
  const d = angleDiff(a, b);
  if (Math.abs(d) <= maxDelta) return wrapAngle(b);
  return wrapAngle(a + Math.sign(d) * maxDelta);
}

/** Exponentially-weighted moving average step with time constant `tau` seconds. */
export function ewma(prev: number, sample: number, dt: number, tau: number): number {
  const k = 1 - Math.exp(-dt / Math.max(1e-6, tau));
  return prev + (sample - prev) * k;
}

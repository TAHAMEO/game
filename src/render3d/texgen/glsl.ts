/**
 * GLSL helpers for procedural, tileable textures. Every pattern here is periodic over the
 * unit square (lattices wrap with `mod`), so the generated maps tile without seams.
 */
export const NOISE_GLSL = /* glsl */ `
float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
vec2 hash22(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973));
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.xx + p3.yz) * p3.zy);
}
vec3 hash32(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973));
  p3 += dot(p3, p3.yxz + 33.33);
  return fract((p3.xxy + p3.yzz) * p3.zyx);
}
// Periodic value noise. p in lattice units; the lattice repeats every 'per' cells.
float vnoise(vec2 p, vec2 per) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  float a = hash12(mod(i, per));
  float b = hash12(mod(i + vec2(1.0, 0.0), per));
  float c = hash12(mod(i + vec2(0.0, 1.0), per));
  float d = hash12(mod(i + vec2(1.0, 1.0), per));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}
// Periodic gradient noise, -1..1.
float gnoise(vec2 p, vec2 per) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  vec2 ga = hash22(mod(i, per)) * 2.0 - 1.0;
  vec2 gb = hash22(mod(i + vec2(1.0, 0.0), per)) * 2.0 - 1.0;
  vec2 gc = hash22(mod(i + vec2(0.0, 1.0), per)) * 2.0 - 1.0;
  vec2 gd = hash22(mod(i + vec2(1.0, 1.0), per)) * 2.0 - 1.0;
  float a = dot(ga, f);
  float b = dot(gb, f - vec2(1.0, 0.0));
  float c = dot(gc, f - vec2(0.0, 1.0));
  float d = dot(gd, f - vec2(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y) * 1.4;
}
// fbm over the unit square: 'freq' lattice cells per tile (integers), 0..1.
float fbm(vec2 uv, vec2 freq, int oct, float seed) {
  float v = 0.0;
  float a = 0.5;
  vec2 per = freq;
  vec2 off = vec2(floor(seed * 17.0), floor(seed * 31.0));
  for (int i = 0; i < 8; i++) {
    if (i >= oct) break;
    v += a * vnoise(uv * per + off, per);
    per *= 2.0;
    a *= 0.5;
    off += vec2(7.0, 3.0);
  }
  return v / (1.0 - pow(0.5, float(oct)));
}
float gfbm(vec2 uv, vec2 freq, int oct, float seed) {
  float v = 0.0;
  float a = 0.5;
  vec2 per = freq;
  vec2 off = vec2(floor(seed * 17.0), floor(seed * 31.0));
  for (int i = 0; i < 8; i++) {
    if (i >= oct) break;
    v += a * gnoise(uv * per + off, per);
    per *= 2.0;
    a *= 0.5;
    off += vec2(5.0, 11.0);
  }
  return v;
}
float ridged(vec2 uv, vec2 freq, int oct, float seed) {
  float v = 0.0;
  float a = 0.5;
  vec2 per = freq;
  vec2 off = vec2(floor(seed * 13.0), floor(seed * 29.0));
  for (int i = 0; i < 8; i++) {
    if (i >= oct) break;
    float n = 1.0 - abs(gnoise(uv * per + off, per));
    v += a * n * n;
    per *= 2.0;
    a *= 0.5;
    off += vec2(3.0, 9.0);
  }
  return v;
}
// Periodic Worley: x = F1, y = F2, z = cell id hash.
vec3 worley(vec2 p, vec2 per) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  float d1 = 8.0;
  float d2 = 8.0;
  float id = 0.0;
  for (int y = -1; y <= 1; y++) {
    for (int x = -1; x <= 1; x++) {
      vec2 g = vec2(float(x), float(y));
      vec2 cell = mod(i + g, per);
      vec2 o = hash22(cell);
      vec2 r = g + o - f;
      float d = dot(r, r);
      if (d < d1) {
        d2 = d1;
        d1 = d;
        id = hash12(cell + 0.37);
      } else if (d < d2) {
        d2 = d;
      }
    }
  }
  return vec3(sqrt(d1), sqrt(d2), id);
}
vec3 lin(vec3 c) { return pow(c, vec3(2.2)); }
float sat(float x) { return clamp(x, 0.0, 1.0); }
float band(float x, float a, float b, float w) { return smoothstep(a - w, a + w, x) * (1.0 - smoothstep(b - w, b + w, x)); }
// A grid of tiles over the unit square: returns (local uv in tile, tile id).
vec4 tiles(vec2 uv, vec2 count) {
  vec2 p = uv * count;
  vec2 id = mod(floor(p), count);
  return vec4(fract(p), id);
}
// distance to the nearest tile edge in tile-local units (0 at the edge, 0.5 at the centre)
float edgeDist(vec2 f) { vec2 d = min(f, 1.0 - f); return min(d.x, d.y); }
`;

/**
 * Procedural material recipes. Each one fills albedo (linear), height, roughness,
 * metalness and ambient occlusion for a point of the unit square; the generator derives
 * normals from the height field. Walls map v = height / 2 units, so v = 0 is the floor and
 * the wall top is v = 0.875 (dado lines and grime sit at the same height on every wall).
 */
export interface Recipe {
  /** GLSL body of `void surface(vec2 uv, out vec3 col, out float h, out float rough, out float metal, out float ao)`. */
  glsl: string;
  /** Normal strength. */
  bump: number;
  /** Primary surfaces get the biggest textures. */
  primary: boolean;
}

const R = (glsl: string, bump: number, primary = false): Recipe => ({ glsl, bump, primary });

export const RECIPES: Record<string, Recipe> = {
  plaster: R(
    `
  float v = uv.y;
  float fine = gfbm(uv, vec2(96.0), 4, 1.0);
  float big = fbm(uv, vec2(3.0), 5, 2.0);
  vec3 lower = lin(vec3(0.30, 0.43, 0.40));
  vec3 upper = lin(vec3(0.73, 0.75, 0.66));
  float dado = 0.31;
  col = mix(lower, upper, smoothstep(dado - 0.0015, dado + 0.0015, v));
  float rail = band(v, dado - 0.013, dado + 0.003, 0.0015);
  col = mix(col, lin(vec3(0.20, 0.29, 0.27)), rail);
  h = 0.5 + fine * 0.015 + rail * 0.3;
  col *= 0.86 + 0.24 * big;
  float grimeN = fbm(uv, vec2(16.0, 4.0), 5, 3.0);
  float grime = (1.0 - smoothstep(0.0, 0.10, v + grimeN * 0.03)) * (0.55 + 0.45 * grimeN);
  col *= 1.0 - 0.6 * grime;
  float streak = fbm(vec2(uv.x, uv.y * 0.12), vec2(20.0, 2.0), 6, 4.0);
  float stain = smoothstep(0.56, 0.74, streak) * smoothstep(0.15, 0.8, v);
  float tide = band(streak, 0.555, 0.575, 0.006) * smoothstep(0.15, 0.8, v);
  col = mix(col, col * lin(vec3(0.66, 0.55, 0.40)), stain * 0.85);
  col *= 1.0 - 0.25 * tide;
  float scuffN = fbm(vec2(uv.x, uv.y * 5.0), vec2(48.0, 8.0), 4, 5.0);
  float scuff = smoothstep(0.74, 0.86, scuffN) * (1.0 - smoothstep(0.06, 0.26, v));
  col *= 1.0 - 0.4 * scuff;
  float chipN = fbm(uv, vec2(8.0), 7, 6.0) + 0.05 * gnoise(uv * 200.0, vec2(200.0));
  float chip = smoothstep(0.765, 0.775, chipN);
  float rim = band(chipN, 0.75, 0.768, 0.004);
  vec3 bare = lin(vec3(0.60, 0.58, 0.54)) * (0.82 + 0.3 * fine);
  col = mix(col, bare, chip);
  col *= 1.0 - 0.35 * rim;
  h -= chip * 0.1;
  rough = mix(0.58, 0.93, chip) + stain * 0.08 + 0.06 * fine + scuff * 0.1;
  metal = 0.0;
  ao = 1.0 - 0.45 * grime - 0.3 * rim - 0.4 * rail * 0.0;
  `,
    1.6,
    true,
  ),

  tile: R(
    `
  float v = uv.y;
  vec2 count = vec2(14.0, 16.0);
  vec4 t = tiles(uv, count);
  vec2 f = t.xy;
  vec2 id = t.zw;
  float e = edgeDist(f);
  float grout = 1.0 - smoothstep(0.03, 0.05, e);
  float bevel = smoothstep(0.03, 0.14, e);
  vec3 rnd = hash32(id + 3.1);
  float glaze = gfbm(uv, vec2(28.0), 3, 2.0);
  vec3 tileCol = lin(vec3(0.85, 0.87, 0.85)) * (0.9 + 0.12 * rnd.x) * (0.97 + 0.03 * glaze);
  float g2 = fbm(uv, vec2(24.0), 4, 3.0);
  vec3 groutCol = lin(vec3(0.40, 0.39, 0.36)) * mix(0.35, 1.0, smoothstep(0.0, 0.4, v) * (0.5 + 0.5 * g2));
  col = mix(tileCol, groutCol, grout);
  h = mix(0.62 + 0.015 * glaze, 0.38, grout) * mix(0.9, 1.0, bevel);
  float cracked = step(0.86, rnd.y);
  float crack = smoothstep(0.93, 0.985, ridged(uv, vec2(10.0), 3, 7.0 + rnd.z)) * cracked * (1.0 - grout);
  col *= 1.0 - 0.6 * crack;
  h -= crack * 0.08;
  float missing = step(0.988, rnd.z);
  float comb = 0.5 + 0.5 * sin((f.x + f.y) * 60.0);
  col = mix(col, lin(vec3(0.46, 0.45, 0.42)) * (0.8 + 0.2 * comb), missing);
  h = mix(h, 0.3 + 0.03 * comb, missing);
  float drip = fbm(vec2(uv.x, uv.y * 0.08), vec2(36.0, 2.0), 5, 8.0);
  float rust = smoothstep(0.66, 0.8, drip) * smoothstep(0.1, 0.7, v);
  col = mix(col, col * lin(vec3(0.72, 0.42, 0.22)), rust * 0.75);
  float smear = smoothstep(0.73, 0.82, fbm(uv, vec2(3.0), 6, 9.0)) * (1.0 - smoothstep(0.15, 0.5, v));
  col = mix(col, lin(vec3(0.18, 0.05, 0.04)), smear * 0.75);
  rough = mix(0.16 + 0.1 * rnd.y, 0.9, max(grout, missing)) + rust * 0.35 + crack * 0.3 - smear * 0.05;
  metal = 0.0;
  ao = mix(1.0, 0.6, grout) * (1.0 - 0.3 * missing);
  `,
    2.2,
    true,
  ),

  wallpaper: R(
    `
  float v = uv.y;
  vec4 t = tiles(uv, vec2(6.0, 6.0));
  vec2 p = t.xy * 2.0 - 1.0;
  float r = length(p * vec2(1.0, 0.72));
  float a = atan(p.y, p.x);
  float petal = 0.5 + 0.5 * cos(a * 4.0);
  float motif = smoothstep(0.58, 0.53, r - 0.16 * petal) - 0.6 * smoothstep(0.32, 0.27, r - 0.08 * petal);
  float stripe = band(fract(uv.x * 12.0), 0.47, 0.53, 0.01);
  vec3 base = lin(vec3(0.56, 0.49, 0.33));
  vec3 ink = lin(vec3(0.40, 0.31, 0.21));
  col = mix(base, ink, clamp(motif * 0.85 + stripe * 0.5, 0.0, 1.0));
  float fade = fbm(uv, vec2(3.0), 5, 2.0);
  col *= 0.75 + 0.35 * fade;
  float tideN = fbm(uv, vec2(4.0), 6, 3.0) + (0.45 - v) * 0.5;
  float tide = band(tideN, 0.48, 0.5, 0.004);
  float damp = smoothstep(0.5, 0.42, tideN);
  col = mix(col, col * lin(vec3(0.55, 0.45, 0.32)), damp * 0.7);
  col *= 1.0 - 0.3 * tide;
  float peelN = fbm(uv, vec2(5.0), 7, 4.0);
  float peel = smoothstep(0.71, 0.722, peelN);
  float curl = band(peelN, 0.705, 0.72, 0.004);
  vec3 under = lin(vec3(0.66, 0.64, 0.6)) * (0.8 + 0.25 * fbm(uv, vec2(40.0), 3, 5.0));
  col = mix(col, under, peel);
  col = mix(col, col * 1.35, curl);
  float moldN = fbm(uv, vec2(6.0), 6, 6.0) + 0.12 * fbm(uv, vec2(64.0), 3, 7.0);
  float moldZone = (1.0 - smoothstep(0.05, 0.3, v)) + smoothstep(0.62, 0.86, v) * 0.8;
  float mold = smoothstep(0.58, 0.7, moldN) * moldZone;
  col = mix(col, lin(vec3(0.08, 0.10, 0.06)), mold * 0.85);
  h = 0.5 - peel * 0.06 + curl * 0.12 + 0.01 * gfbm(uv, vec2(64.0), 3, 8.0) + mold * 0.03;
  rough = 0.86 + 0.08 * mold;
  metal = 0.0;
  ao = 1.0 - 0.3 * mold - 0.2 * curl;
  `,
    1.4,
    true,
  ),

  panel: R(
    `
  float v = uv.y;
  float railV = 0.34;
  float isWood = 1.0 - smoothstep(railV - 0.001, railV + 0.001, v);
  vec4 t = tiles(vec2(uv.x, v / railV), vec2(6.0, 1.0));
  vec2 f = t.xy;
  float frame = 1.0 - smoothstep(0.06, 0.09, edgeDist(f * vec2(1.0, 1.6)));
  float grain = fbm(vec2(uv.x * 2.0, uv.y * 0.06), vec2(60.0, 2.0), 5, 2.0);
  float rings = 0.5 + 0.5 * sin((uv.x * 90.0 + grain * 12.0));
  vec3 wood = mix(lin(vec3(0.20, 0.11, 0.06)), lin(vec3(0.36, 0.21, 0.11)), 0.55 * grain + 0.45 * rings);
  wood *= mix(0.86, 1.06, frame);
  float rail = band(v, railV - 0.004, railV + 0.016, 0.002);
  vec3 plaster = lin(vec3(0.70, 0.62, 0.50)) * (0.85 + 0.25 * fbm(uv, vec2(3.0), 5, 4.0));
  float streak = fbm(vec2(uv.x, uv.y * 0.12), vec2(18.0, 2.0), 5, 5.0);
  plaster = mix(plaster, plaster * lin(vec3(0.66, 0.55, 0.42)), smoothstep(0.6, 0.78, streak) * smoothstep(0.4, 0.85, v));
  col = mix(plaster, wood, isWood);
  col = mix(col, lin(vec3(0.26, 0.15, 0.08)), rail);
  float scratch = smoothstep(0.86, 0.95, fbm(vec2(uv.x * 0.3, uv.y * 3.0), vec2(60.0, 12.0), 3, 6.0)) * isWood;
  col = mix(col, col * 1.6, scratch * 0.5);
  h = mix(0.45 + 0.01 * gfbm(uv, vec2(80.0), 3, 7.0), 0.55 + 0.12 * frame + 0.015 * rings, isWood) + rail * 0.4;
  rough = mix(0.82, 0.42 + 0.15 * grain + scratch * 0.3, isWood) - rail * 0.3;
  metal = 0.0;
  ao = 1.0 - 0.25 * (1.0 - smoothstep(0.0, 0.05, v));
  `,
    1.5,
    true,
  ),

  block: R(
    `
  float v = uv.y;
  vec2 count = vec2(8.0, 16.0);
  vec2 p = uv * count;
  float row = floor(p.y);
  p.x += mod(row, 2.0) * 0.5;
  vec2 id = vec2(mod(floor(p.x), count.x), mod(row, count.y));
  vec2 f = fract(p);
  float e = edgeDist(f * vec2(1.0, 0.5) + vec2(0.0, 0.25));
  float mortar = 1.0 - smoothstep(0.018, 0.03, min(min(f.x, 1.0 - f.x) * 0.5, min(f.y, 1.0 - f.y) * 0.25));
  vec3 rnd = hash32(id + 1.7);
  float pits = smoothstep(0.62, 0.75, fbm(uv, vec2(128.0), 2, 2.0));
  vec3 paint = lin(vec3(0.44, 0.48, 0.52)) * (0.9 + 0.12 * rnd.x) * (1.0 - 0.25 * pits);
  col = mix(paint, lin(vec3(0.36, 0.37, 0.38)), mortar);
  h = mix(0.6 - 0.05 * pits + 0.01 * gfbm(uv, vec2(48.0), 3, 3.0), 0.4, mortar);
  float hazard = 1.0 - smoothstep(0.065, 0.068, v);
  float stripe = step(0.5, fract((uv.x + uv.y) * 16.0));
  vec3 hz = mix(lin(vec3(0.78, 0.6, 0.06)), lin(vec3(0.05, 0.05, 0.05)), stripe);
  float wear = smoothstep(0.55, 0.7, fbm(uv, vec2(20.0, 4.0), 5, 4.0));
  col = mix(col, mix(hz, paint * 0.6, wear * 0.8), hazard);
  float drip = fbm(vec2(uv.x, uv.y * 0.1), vec2(24.0, 2.0), 5, 5.0);
  float rust = smoothstep(0.62, 0.78, drip) * smoothstep(0.2, 0.85, v);
  col = mix(col, col * lin(vec3(0.62, 0.40, 0.25)), rust * 0.8);
  float oil = smoothstep(0.7, 0.8, fbm(uv, vec2(4.0), 5, 6.0)) * (1.0 - smoothstep(0.0, 0.2, v));
  col *= 1.0 - 0.6 * oil;
  rough = mix(0.72, 0.95, mortar) + 0.1 * pits - 0.3 * oil;
  metal = 0.0;
  ao = mix(1.0, 0.55, mortar) * (1.0 - 0.2 * pits);
  `,
    2.0,
    true,
  ),

  brick: R(
    `
  float v = uv.y;
  vec2 count = vec2(12.0, 28.0);
  vec2 p = uv * count;
  float row = floor(p.y);
  p.x += mod(row, 2.0) * 0.5;
  vec2 id = vec2(mod(floor(p.x), count.x), mod(row, count.y));
  vec2 f = fract(p);
  float dx = min(f.x, 1.0 - f.x) * (1.0 / count.x) * count.y;
  float dy = min(f.y, 1.0 - f.y);
  float mortar = 1.0 - smoothstep(0.07, 0.11, min(dx * 0.42, dy));
  vec3 rnd = hash32(id + 5.3);
  vec3 b = mix(lin(vec3(0.36, 0.15, 0.10)), lin(vec3(0.46, 0.22, 0.15)), rnd.x) * (0.86 + 0.16 * rnd.y);
  float speck = fbm(uv, vec2(96.0), 3, 2.0);
  b *= 0.85 + 0.25 * speck;
  col = mix(b, lin(vec3(0.33, 0.32, 0.30)) * (0.7 + 0.3 * speck), mortar);
  h = mix(0.62 + 0.04 * speck - 0.05 * rnd.z, 0.38, mortar);
  // rain runs down from the sills in broad, soft stains (not shiny ribbons)
  float wet = fbm(vec2(uv.x, uv.y * 0.2), vec2(8.0, 2.0), 5, 4.0);
  float streaks = smoothstep(0.45, 0.75, wet) * (0.4 + 0.6 * v);
  col *= 1.0 - 0.3 * streaks;
  float moss = smoothstep(0.5, 0.7, fbm(uv, vec2(10.0), 5, 6.0)) * (1.0 - smoothstep(0.02, 0.22, v));
  col = mix(col, lin(vec3(0.12, 0.16, 0.06)), moss * 0.85);
  // efflorescence: a faint bloom of salt, soft across bricks and mortar alike
  float salt = smoothstep(0.6, 0.85, fbm(uv, vec2(5.0), 5, 8.0)) * (0.35 + 0.65 * mortar);
  col = mix(col, lin(vec3(0.62, 0.6, 0.56)), salt * 0.22);
  rough = mix(0.74, 0.93, mortar) - 0.18 * streaks + 0.1 * moss;
  metal = 0.0;
  ao = mix(1.0, 0.6, mortar);
  `,
    1.7,
    true,
  ),

  nest: R(
    `
  float v = uv.y;
  vec3 base = lin(vec3(0.36, 0.33, 0.30)) * (0.7 + 0.4 * fbm(uv, vec2(4.0), 5, 1.0));
  float veins = ridged(uv, vec2(6.0), 6, 2.0);
  float vein = smoothstep(0.55, 0.85, veins);
  float growthN = fbm(uv, vec2(3.0), 6, 3.0) + (0.4 - v) * 0.3;
  float growth = smoothstep(0.42, 0.62, growthN);
  vec3 flesh = mix(lin(vec3(0.16, 0.05, 0.05)), lin(vec3(0.32, 0.12, 0.10)), fbm(uv, vec2(24.0), 4, 4.0));
  col = mix(base, flesh, growth);
  col = mix(col, lin(vec3(0.05, 0.01, 0.02)), vein * growth * 0.9);
  float membrane = smoothstep(0.58, 0.75, fbm(uv, vec2(5.0), 5, 5.0)) * growth;
  col = mix(col, lin(vec3(0.42, 0.26, 0.22)), membrane * 0.4);
  vec4 t = tiles(uv, vec2(5.0, 7.0));
  vec3 rnd = hash32(t.zw + 9.0);
  vec2 q = t.xy - 0.5;
  float ang = rnd.x * 3.14159;
  vec2 rq = vec2(cos(ang) * q.x - sin(ang) * q.y, sin(ang) * q.x + cos(ang) * q.y);
  float claws = step(0.55, rnd.y) * (1.0 - smoothstep(0.32, 0.4, abs(rq.y))) * smoothstep(0.012, 0.0, abs(fract(rq.x * 9.0) - 0.5) - 0.03);
  col *= 1.0 - 0.7 * claws;
  float smear = smoothstep(0.62, 0.75, fbm(vec2(uv.x * 1.5, uv.y * 0.6), vec2(6.0, 3.0), 5, 7.0));
  col = mix(col, lin(vec3(0.12, 0.02, 0.02)), smear * 0.6 * (1.0 - growth));
  h = 0.5 + 0.2 * growth + 0.12 * vein * growth + 0.08 * membrane - 0.12 * claws;
  rough = mix(0.85, 0.18, max(membrane, growth * 0.6)) + 0.2 * claws;
  metal = 0.0;
  ao = 1.0 - 0.4 * vein * growth - 0.3 * claws;
  `,
    2.6,
    true,
  ),

  lino: R(
    `
  vec2 count = vec2(10.0, 10.0);
  vec4 t = tiles(uv, count);
  vec2 f = t.xy;
  vec2 id = t.zw;
  float checker = mod(id.x + id.y, 2.0);
  vec3 rnd = hash32(id + 7.7);
  vec3 a = lin(vec3(0.70, 0.68, 0.60));
  vec3 b = lin(vec3(0.46, 0.52, 0.47));
  col = mix(a, b, checker) * (0.94 + 0.08 * rnd.x);
  float mott = fbm(uv * 1.0 + rnd.xy, vec2(60.0), 4, 2.0);
  vec3 chips = worley(uv * 220.0, vec2(220.0));
  float chip = smoothstep(0.18, 0.1, chips.x) * step(0.6, chips.z);
  col *= 0.9 + 0.14 * mott;
  col = mix(col, col * mix(0.7, 1.25, chips.z), chip * 0.6);
  float seam = 1.0 - smoothstep(0.004, 0.012, edgeDist(f));
  col *= 1.0 - 0.5 * seam;
  float wearN = fbm(uv, vec2(2.0), 6, 3.0);
  col = mix(col, col * 1.12, smoothstep(0.55, 0.75, wearN) * 0.5);
  float dirt = smoothstep(0.55, 0.8, fbm(uv, vec2(8.0), 5, 4.0));
  col *= 1.0 - 0.35 * dirt;
  vec4 s = tiles(uv, vec2(7.0, 7.0));
  vec3 sr = hash32(s.zw + 1.3);
  vec2 sq = s.xy - sr.xy;
  float sa = sr.z * 6.283;
  vec2 rq = vec2(cos(sa) * sq.x - sin(sa) * sq.y, sin(sa) * sq.x + cos(sa) * sq.y);
  float scuff = (1.0 - smoothstep(0.0, 0.012, abs(rq.y + rq.x * rq.x * 1.5))) * (1.0 - smoothstep(0.05, 0.14, abs(rq.x))) * step(0.35, sr.x);
  col = mix(col, lin(vec3(0.08, 0.08, 0.08)), scuff * 0.7);
  h = 0.55 - seam * 0.2 + 0.01 * mott + chip * 0.01;
  rough = 0.32 + 0.18 * wearN + 0.25 * dirt + 0.3 * seam + 0.3 * scuff;
  metal = 0.0;
  ao = 1.0 - 0.4 * seam;
  `,
    1.2,
    true,
  ),

  terrazzo: R(
    `
  vec3 base = lin(vec3(0.70, 0.68, 0.62));
  float m = fbm(uv, vec2(8.0), 4, 1.0);
  col = base * (0.92 + 0.1 * m);
  vec3 w1 = worley(uv * 70.0, vec2(70.0));
  float c1 = smoothstep(0.3, 0.22, w1.x);
  vec3 chip1 = w1.z < 0.25 ? lin(vec3(0.92, 0.9, 0.86)) : w1.z < 0.5 ? lin(vec3(0.12, 0.12, 0.12)) : w1.z < 0.75 ? lin(vec3(0.5, 0.28, 0.2)) : lin(vec3(0.42, 0.46, 0.42));
  col = mix(col, chip1, c1 * 0.85);
  vec3 w2 = worley(uv * 180.0, vec2(180.0));
  float c2 = smoothstep(0.25, 0.15, w2.x) * step(0.4, w2.z);
  col = mix(col, w2.z < 0.7 ? lin(vec3(0.2, 0.2, 0.2)) : lin(vec3(0.9, 0.88, 0.84)), c2 * 0.7);
  vec2 g = abs(fract(uv * 2.0 + 0.5) - 0.5);
  float strip = 1.0 - smoothstep(0.0015, 0.004, min(g.x, g.y));
  col = mix(col, lin(vec3(0.55, 0.48, 0.32)), strip);
  float dirt = smoothstep(0.5, 0.8, fbm(uv, vec2(5.0), 6, 3.0));
  col *= 1.0 - 0.3 * dirt;
  h = 0.5 + 0.02 * c1 - 0.01 * strip;
  rough = 0.22 + 0.25 * dirt + 0.1 * c1;
  metal = strip * 0.7;
  ao = 1.0;
  `,
    0.8,
    true,
  ),

  tilefloor: R(
    `
  vec2 count = vec2(20.0, 20.0);
  vec4 t = tiles(uv, count);
  vec3 rnd = hash32(t.zw + 2.2);
  float e = edgeDist(t.xy);
  float grout = 1.0 - smoothstep(0.04, 0.07, e);
  col = lin(vec3(0.60, 0.64, 0.64)) * (0.9 + 0.12 * rnd.x);
  vec3 gc = lin(vec3(0.30, 0.30, 0.28)) * (0.7 + 0.5 * fbm(uv, vec2(30.0), 3, 2.0));
  col = mix(col, gc, grout);
  float stain = smoothstep(0.66, 0.82, fbm(uv, vec2(5.0), 6, 3.0));
  col = mix(col, col * lin(vec3(0.62, 0.5, 0.4)), stain * 0.5);
  float blood = smoothstep(0.8, 0.86, fbm(uv, vec2(3.0), 6, 8.0));
  col = mix(col, lin(vec3(0.2, 0.04, 0.04)), blood * 0.7);
  float wet = smoothstep(0.55, 0.7, fbm(uv, vec2(4.0), 5, 5.0));
  h = mix(0.6, 0.4, grout) + 0.01 * gfbm(uv, vec2(64.0), 2, 1.0);
  rough = mix(0.25 + 0.15 * rnd.y, 0.9, grout) - 0.15 * wet + 0.1 * stain - 0.1 * blood;
  metal = 0.0;
  ao = mix(1.0, 0.6, grout);
  `,
    1.8,
    true,
  ),

  boards: R(
    `
  float planks = 14.0;
  float row = floor(uv.y * planks);
  float within = fract(uv.y * planks);
  vec3 rr = hash32(vec2(row, 4.0));
  float seg = uv.x * 3.0 + rr.x;
  float segId = floor(seg);
  vec3 rnd = hash32(vec2(mod(segId, 3.0), row) + 11.0);
  float gap = 1.0 - smoothstep(0.02, 0.05, min(within, 1.0 - within));
  float endGap = 1.0 - smoothstep(0.004, 0.01, min(fract(seg), 1.0 - fract(seg)) / 3.0);
  float grain = fbm(vec2(uv.x * 1.0 + rnd.x, uv.y * planks * 0.25), vec2(40.0, 4.0), 5, 2.0);
  float lines = 0.5 + 0.5 * sin(within * 18.0 + grain * 9.0 + rnd.y * 6.0);
  vec3 wood = mix(lin(vec3(0.24, 0.15, 0.09)), lin(vec3(0.42, 0.28, 0.17)), 0.5 * grain + 0.5 * lines * 0.6);
  wood *= 0.75 + 0.35 * rnd.z;
  vec3 knotW = worley(uv * vec2(6.0, 14.0), vec2(6.0, 14.0));
  float knot = smoothstep(0.12, 0.05, knotW.x) * step(0.7, knotW.z);
  wood = mix(wood, lin(vec3(0.12, 0.07, 0.04)), knot);
  float worn = smoothstep(0.5, 0.75, fbm(uv, vec2(3.0), 5, 3.0));
  wood = mix(wood, wood * 1.35 + 0.02, worn * 0.4);
  float water = smoothstep(0.6, 0.75, fbm(uv, vec2(2.0), 6, 6.0));
  wood = mix(wood, wood * lin(vec3(0.5, 0.45, 0.4)), water * 0.7);
  col = mix(wood, lin(vec3(0.03, 0.02, 0.02)), max(gap, endGap));
  h = 0.55 - 0.3 * max(gap, endGap) + 0.02 * lines - 0.03 * knot + 0.01 * rnd.y;
  rough = 0.55 + 0.3 * worn + 0.15 * water;
  metal = 0.0;
  ao = 1.0 - 0.5 * max(gap, endGap);
  `,
    1.6,
    true,
  ),

  concrete: R(
    `
  float big = fbm(uv, vec2(3.0), 6, 1.0);
  float mid = fbm(uv, vec2(16.0), 4, 2.0);
  col = lin(vec3(0.50, 0.50, 0.48)) * (0.72 + 0.35 * big) * (0.92 + 0.1 * mid);
  vec3 ag = worley(uv * 140.0, vec2(140.0));
  float agg = smoothstep(0.25, 0.18, ag.x) * step(0.5, ag.z);
  col = mix(col, col * mix(0.7, 1.3, ag.z), agg * 0.5);
  float crackN = ridged(uv, vec2(5.0), 5, 3.0);
  float crack = smoothstep(0.86, 0.94, crackN);
  col *= 1.0 - 0.6 * crack;
  float oil = smoothstep(0.66, 0.78, fbm(uv, vec2(4.0), 6, 5.0));
  col = mix(col, col * 0.35, oil);
  float pits = smoothstep(0.72, 0.8, fbm(uv, vec2(180.0), 2, 6.0));
  h = 0.5 + 0.03 * mid - 0.15 * crack - 0.04 * pits + 0.01 * agg;
  rough = 0.82 - 0.4 * oil + 0.1 * pits;
  metal = 0.0;
  ao = 1.0 - 0.5 * crack - 0.2 * pits;
  `,
    1.8,
    true,
  ),

  grass: R(
    `
  float big = fbm(uv, vec2(4.0), 6, 1.0);
  vec3 mud = lin(vec3(0.16, 0.12, 0.08)) * (0.7 + 0.5 * fbm(uv, vec2(20.0), 4, 2.0));
  float blades = 0.0;
  for (int i = 0; i < 3; i++) {
    vec2 d = i == 0 ? vec2(1.0, 2.0) : i == 1 ? vec2(2.0, -1.0) : vec2(1.0, -3.0);
    vec2 q = vec2(dot(uv, d), dot(uv, vec2(-d.y, d.x)));
    blades += smoothstep(0.6, 0.78, fbm(q, vec2(6.0, 90.0), 3, 3.0 + float(i)));
  }
  vec3 grass = mix(lin(vec3(0.20, 0.20, 0.10)), lin(vec3(0.32, 0.30, 0.16)), fbm(uv, vec2(30.0), 3, 4.0));
  float gm = smoothstep(0.35, 0.55, big);
  col = mix(mud, grass, gm * clamp(blades, 0.0, 1.0) * 0.9 + gm * 0.25);
  vec3 st = worley(uv * 40.0, vec2(40.0));
  float stone = smoothstep(0.42, 0.32, st.x) * (1.0 - gm) * step(0.35, st.z);
  col = mix(col, lin(vec3(0.42, 0.41, 0.38)) * (0.6 + 0.6 * st.z), stone);
  float puddle = smoothstep(0.66, 0.7, fbm(uv, vec2(3.0), 6, 7.0)) * (1.0 - gm);
  col = mix(col, col * 0.4, puddle);
  h = 0.45 + 0.1 * stone * (1.0 - st.x) + 0.04 * blades * gm - 0.05 * puddle + 0.02 * big;
  rough = mix(0.85, 0.05, puddle) - 0.2 * stone * 0.0;
  metal = 0.0;
  ao = 1.0 - 0.25 * (1.0 - st.x) * stone;
  `,
    2.2,
    true,
  ),

  asphalt: R(
    `
  float big = fbm(uv, vec2(3.0), 6, 1.0);
  col = lin(vec3(0.14, 0.14, 0.14)) * (0.8 + 0.35 * big);
  vec3 ag = worley(uv * 200.0, vec2(200.0));
  float agg = smoothstep(0.3, 0.15, ag.x);
  col = mix(col, lin(vec3(0.3, 0.3, 0.29)) * (0.6 + 0.8 * ag.z), agg * 0.55);
  float crack = smoothstep(0.88, 0.95, ridged(uv, vec2(4.0), 5, 2.0));
  col *= 1.0 - 0.7 * crack;
  float patchN = fbm(uv, vec2(2.0), 5, 4.0);
  float patchM = smoothstep(0.6, 0.62, patchN);
  col = mix(col, col * 0.7, patchM);
  float puddle = smoothstep(0.64, 0.68, fbm(uv, vec2(3.0), 6, 6.0));
  col = mix(col, col * 0.5, puddle);
  float oil = smoothstep(0.7, 0.78, fbm(uv, vec2(5.0), 5, 8.0));
  col *= 1.0 - 0.4 * oil;
  h = 0.5 + 0.04 * agg - 0.15 * crack - 0.03 * puddle;
  rough = mix(0.88, 0.04, puddle) - 0.3 * oil;
  metal = 0.0;
  ao = 1.0 - 0.4 * crack;
  `,
    1.6,
    true,
  ),

  nestfloor: R(
    `
  float big = fbm(uv, vec2(3.0), 6, 1.0);
  vec3 dirt = mix(lin(vec3(0.12, 0.09, 0.07)), lin(vec3(0.26, 0.2, 0.15)), big);
  float stain = smoothstep(0.5, 0.7, fbm(uv, vec2(5.0), 6, 2.0));
  col = mix(dirt, lin(vec3(0.14, 0.03, 0.03)), stain * 0.85);
  vec3 b = worley(uv * 30.0, vec2(30.0));
  float bone = smoothstep(0.12, 0.06, b.x) * step(0.82, b.z);
  col = mix(col, lin(vec3(0.72, 0.68, 0.58)), bone);
  float wet = smoothstep(0.55, 0.7, fbm(uv, vec2(4.0), 5, 3.0));
  h = 0.5 + 0.06 * big + 0.15 * bone + 0.02 * fbm(uv, vec2(60.0), 3, 4.0);
  rough = mix(0.9, 0.1, wet * stain);
  metal = 0.0;
  ao = 1.0;
  `,
    2.0,
    true,
  ),

  ceiltile: R(
    `
  vec2 count = vec2(4.0, 4.0);
  vec4 t = tiles(uv, count);
  vec3 rnd = hash32(t.zw + 4.4);
  float e = edgeDist(t.xy);
  float grid = 1.0 - smoothstep(0.012, 0.018, e);
  float fiss = smoothstep(0.62, 0.7, abs(gnoise(uv * 150.0, vec2(150.0))) * 1.0 + 0.4 * fbm(uv, vec2(300.0), 2, 3.0));
  vec3 tile = lin(vec3(0.76, 0.75, 0.70)) * (0.94 + 0.08 * rnd.x) * (1.0 - 0.3 * fiss);
  float stainN = length(t.xy - hash22(t.zw)) + 0.15 * fbm(uv, vec2(16.0), 4, 5.0);
  float stained = step(0.72, rnd.y);
  float ring = band(stainN, 0.34 * (0.6 + rnd.z), 0.37 * (0.6 + rnd.z), 0.02);
  float inner = smoothstep(0.37 * (0.6 + rnd.z), 0.2 * (0.6 + rnd.z), stainN);
  tile = mix(tile, tile * lin(vec3(0.62, 0.5, 0.34)), stained * (inner * 0.6 + ring * 0.8));
  float missing = step(0.965, rnd.z);
  col = mix(tile, lin(vec3(0.64, 0.64, 0.62)), grid);
  col = mix(col, vec3(0.004), missing * (1.0 - grid));
  h = mix(0.5 - 0.04 * fiss, 0.62, grid) - 0.3 * missing * (1.0 - grid);
  rough = mix(0.95, 0.45, grid);
  metal = grid * 0.4;
  ao = mix(1.0, 0.0, missing * (1.0 - grid)) * (1.0 - 0.2 * fiss);
  `,
    1.3,
    true,
  ),

  metal: R(
    `
  float v = uv.y;
  float peel = gfbm(uv, vec2(120.0), 3, 1.0);
  col = lin(vec3(0.80, 0.80, 0.78)) * (0.95 + 0.06 * fbm(uv, vec2(6.0), 4, 2.0));
  float scratches = 0.0;
  for (int i = 0; i < 4; i++) {
    vec2 d = i == 0 ? vec2(1.0, 0.0) : i == 1 ? vec2(1.0, 2.0) : i == 2 ? vec2(2.0, -1.0) : vec2(3.0, 1.0);
    vec2 q = vec2(dot(uv, d), dot(uv, vec2(-d.y, d.x)));
    scratches += smoothstep(0.88, 0.95, fbm(q, vec2(3.0, 220.0), 2, 2.0 + float(i))) * smoothstep(0.4, 0.7, fbm(uv, vec2(5.0), 3, 9.0 + float(i)));
  }
  scratches = clamp(scratches, 0.0, 1.0);
  float chipN = fbm(uv, vec2(7.0), 6, 3.0);
  float chip = smoothstep(0.80, 0.81, chipN);
  float rustHalo = band(chipN, 0.77, 0.805, 0.01);
  vec3 bare = lin(vec3(0.28, 0.27, 0.26));
  vec3 rust = lin(vec3(0.42, 0.20, 0.08)) * (0.7 + 0.5 * fbm(uv, vec2(40.0), 3, 5.0));
  col = mix(col, col * 0.75, scratches * 0.6);
  col = mix(col, rust, rustHalo * 0.7);
  col = mix(col, mix(bare, rust, 0.4), chip);
  float grime = (1.0 - smoothstep(0.0, 0.15, v)) * fbm(uv, vec2(10.0), 4, 6.0);
  col *= 1.0 - 0.5 * grime;
  h = 0.5 + 0.004 * peel - 0.04 * chip - 0.02 * scratches;
  rough = 0.38 + 0.25 * scratches + 0.35 * rustHalo + 0.2 * grime;
  metal = mix(0.0, 0.85, chip * (1.0 - rustHalo)) + scratches * 0.3;
  ao = 1.0 - 0.3 * grime;
  `,
    1.0,
  ),

  steel: R(
    `
  float brush = fbm(vec2(uv.x, uv.y), vec2(3.0, 512.0), 3, 1.0);
  col = lin(vec3(0.62, 0.63, 0.65)) * (0.9 + 0.12 * brush);
  float smudge = fbm(uv, vec2(5.0), 5, 2.0);
  vec3 dents = worley(uv * 9.0, vec2(9.0));
  float dent = smoothstep(0.2, 0.0, dents.x) * step(0.85, dents.z);
  float stain = smoothstep(0.66, 0.8, fbm(uv, vec2(3.0), 5, 4.0));
  col = mix(col, col * lin(vec3(0.6, 0.5, 0.4)), stain * 0.5);
  h = 0.5 + 0.01 * brush - 0.05 * dent;
  rough = 0.22 + 0.3 * smudge + 0.08 * brush + 0.2 * stain;
  metal = 1.0 - 0.4 * stain;
  ao = 1.0;
  `,
    0.6,
  ),

  wood: R(
    `
  float grain = fbm(vec2(uv.x * 0.15, uv.y), vec2(4.0, 64.0), 5, 1.0);
  float rings = 0.5 + 0.5 * sin(uv.x * 140.0 + grain * 14.0);
  col = mix(lin(vec3(0.22, 0.13, 0.07)), lin(vec3(0.44, 0.29, 0.16)), 0.5 * grain + 0.5 * rings * 0.7);
  float wear = smoothstep(0.6, 0.8, fbm(uv, vec2(4.0), 5, 2.0));
  col = mix(col, col * 1.3, wear * 0.4);
  h = 0.5 + 0.02 * rings;
  rough = 0.5 + 0.3 * wear;
  metal = 0.0;
  ao = 1.0;
  `,
    1.0,
  ),

  fabric: R(
    `
  float weave = 0.5 + 0.25 * sin(uv.x * 900.0) + 0.25 * sin(uv.y * 900.0);
  col = lin(vec3(0.86, 0.86, 0.84)) * (0.92 + 0.08 * weave);
  float stain = smoothstep(0.68, 0.8, fbm(uv, vec2(4.0), 6, 2.0));
  col = mix(col, col * lin(vec3(0.75, 0.64, 0.42)), stain * 0.45);
  vec3 sp = worley(uv * 18.0, vec2(18.0));
  float blood = smoothstep(0.2, 0.08, sp.x) * step(0.97, sp.z) + smoothstep(0.82, 0.88, fbm(uv, vec2(3.0), 6, 7.0));
  col = mix(col, lin(vec3(0.24, 0.03, 0.03)), clamp(blood, 0.0, 1.0) * 0.85);
  float wrinkle = gfbm(vec2(uv.x * 1.0, uv.y * 0.4), vec2(8.0, 4.0), 4, 3.0);
  h = 0.5 + 0.08 * wrinkle + 0.01 * weave;
  rough = 0.93;
  metal = 0.0;
  ao = 1.0 - 0.15 * max(0.0, -wrinkle);
  `,
    1.4,
  ),

  skin: R(
    `
  vec3 base = lin(vec3(0.80, 0.76, 0.70));
  float m1 = fbm(uv, vec2(5.0), 6, 1.0);
  float m2 = fbm(uv, vec2(12.0), 5, 2.0);
  col = base * (0.82 + 0.25 * m1);
  col = mix(col, col * lin(vec3(1.0, 0.82, 0.8)), smoothstep(0.5, 0.75, m2) * 0.6);
  col = mix(col, col * lin(vec3(0.82, 0.9, 0.8)), smoothstep(0.55, 0.8, 1.0 - m2) * 0.4);
  float veins = ridged(uv, vec2(7.0), 5, 3.0);
  float vein = smoothstep(0.6, 0.86, veins);
  col = mix(col, lin(vec3(0.42, 0.40, 0.56)), vein * 0.55);
  float bruise = smoothstep(0.66, 0.8, fbm(uv, vec2(4.0), 6, 5.0));
  col = mix(col, lin(vec3(0.38, 0.26, 0.36)), bruise * 0.55);
  float pores = smoothstep(0.65, 0.8, fbm(uv, vec2(220.0), 2, 6.0));
  float wrinkles = smoothstep(0.7, 0.9, ridged(vec2(uv.x, uv.y * 0.3), vec2(40.0, 12.0), 3, 7.0));
  h = 0.5 + 0.05 * vein - 0.03 * pores - 0.05 * wrinkles + 0.03 * m1;
  rough = 0.52 + 0.15 * pores - 0.1 * smoothstep(0.6, 0.8, m2);
  metal = 0.0;
  ao = 1.0 - 0.2 * wrinkles;
  `,
    1.8,
  ),

  /** The Entity: what is left when something wears a body for forty years. */
  corpse: R(
    `
  vec3 base = lin(vec3(0.60, 0.58, 0.53));
  float m1 = fbm(uv, vec2(4.0), 6, 1.0);
  float m2 = fbm(uv, vec2(14.0), 5, 2.0);
  col = base * (0.7 + 0.38 * m1);
  col = mix(col, col * lin(vec3(0.86, 0.92, 0.84)), smoothstep(0.5, 0.8, m2) * 0.5);
  // livor: a purple-grey pooling under the skin
  float livor = smoothstep(0.45, 0.8, fbm(uv, vec2(3.0), 6, 9.0));
  col = mix(col, lin(vec3(0.36, 0.30, 0.37)), livor * 0.5);
  // veins, dark and branching
  float veins = ridged(uv, vec2(6.0), 6, 3.0);
  float vein = smoothstep(0.62, 0.9, veins);
  col = mix(col, lin(vec3(0.19, 0.21, 0.30)), vein * 0.65);
  // grime, and blood that is not its own
  float grime = smoothstep(0.55, 0.82, fbm(uv, vec2(9.0), 5, 4.0));
  col = mix(col, lin(vec3(0.15, 0.12, 0.09)), grime * 0.55);
  float blood = smoothstep(0.7, 0.83, fbm(uv, vec2(5.0), 6, 11.0));
  col = mix(col, lin(vec3(0.21, 0.035, 0.03)), blood * 0.75);
  float pores = smoothstep(0.62, 0.8, fbm(uv, vec2(240.0), 2, 6.0));
  float wrinkles = smoothstep(0.68, 0.9, ridged(vec2(uv.x, uv.y * 0.3), vec2(36.0, 10.0), 3, 7.0));
  h = 0.5 + 0.06 * vein - 0.035 * pores - 0.06 * wrinkles + 0.04 * m1 - 0.03 * blood;
  rough = 0.42 + 0.2 * pores + 0.25 * grime - 0.22 * blood;
  metal = 0.0;
  ao = 1.0 - 0.25 * wrinkles - 0.2 * grime;
  `,
    2.0,
  ),

  rust: R(
    `
  float a = fbm(uv, vec2(8.0), 6, 1.0);
  float b = fbm(uv, vec2(40.0), 4, 2.0);
  col = mix(lin(vec3(0.24, 0.10, 0.04)), lin(vec3(0.55, 0.28, 0.10)), a);
  col *= 0.8 + 0.3 * b;
  float metalPatch = smoothstep(0.62, 0.7, fbm(uv, vec2(5.0), 5, 3.0));
  col = mix(col, lin(vec3(0.3, 0.3, 0.3)), metalPatch);
  h = 0.5 + 0.08 * b + 0.05 * a;
  rough = mix(0.9, 0.45, metalPatch);
  metal = metalPatch * 0.9;
  ao = 1.0;
  `,
    2.0,
  ),
};

/** Which recipes count as big, everywhere surfaces (they get the largest textures). */
export const RECIPE_NAMES = Object.keys(RECIPES);

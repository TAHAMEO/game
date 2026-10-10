import * as THREE from 'three';
import type { Level } from '../core/level';
import { skyExposure } from '../core/sky';
import type { Sim } from '../core/sim';
import { WALL_H } from './constants';

/**
 * The building's light, as the simulation sees it — per cell, with line of sight to every
 * fixture, broken by the Entity, flickering more as the debt rises — uploaded every frame
 * as a small texture and lit into every material with real shading: a soft fill plus a
 * pseudo-directional light (toward where the field is brightest, from above) so normal maps
 * and specular highlights read. What is dark in the game is dark on screen.
 *
 * Alpha holds sky exposure (exterior cells, and cells that can see a window): how much a
 * lightning flash lights a place.
 */
export class GridLight {
  readonly texture: THREE.DataTexture;
  readonly uniforms: {
    gridLight: { value: THREE.DataTexture };
    gridInvSize: { value: THREE.Vector2 };
    gridLightning: { value: number };
    gridBoost: { value: number };
  };
  /** Live brightness multiplier per fixture id (flicker, failure) for emissive fittings. */
  fixtureMul = new Float32Array(0);
  private readonly data: Uint16Array;
  private readonly exposure: Float32Array;
  private readonly w: number;
  private readonly h: number;
  private lr = new Float32Array(0);
  private lg = new Float32Array(0);
  private lb = new Float32Array(0);

  constructor(level: Level) {
    this.w = level.w;
    this.h = level.h;
    const n = level.w * level.h;
    this.data = new Uint16Array(n * 4);
    this.exposure = skyExposure(level);
    this.texture = new THREE.DataTexture(this.data, level.w, level.h, THREE.RGBAFormat, THREE.HalfFloatType);
    this.texture.magFilter = THREE.LinearFilter;
    this.texture.minFilter = THREE.LinearFilter;
    this.texture.wrapS = THREE.ClampToEdgeWrapping;
    this.texture.wrapT = THREE.ClampToEdgeWrapping;
    this.texture.colorSpace = THREE.NoColorSpace;
    this.texture.needsUpdate = true;
    this.uniforms = {
      gridLight: { value: this.texture },
      gridInvSize: { value: new THREE.Vector2(1 / level.w, 1 / level.h) },
      gridLightning: { value: 0 },
      gridBoost: { value: 1 },
    };
  }

  /** Base light plus per-frame flicker. The debt makes everything less steady [Z]. */
  update(sim: Sim, t: number): void {
    const L = sim.world.lighting;
    const n = this.w * this.h;
    if (this.lr.length !== n) {
      this.lr = new Float32Array(n);
      this.lg = new Float32Array(n);
      this.lb = new Float32Array(n);
    }
    if (this.fixtureMul.length !== L.fixtures.length) this.fixtureMul = new Float32Array(L.fixtures.length);
    this.lr.set(L.r);
    this.lg.set(L.g);
    this.lb.set(L.b);
    const floor = sim.director.floor;
    for (const f of L.fixtures) {
      if (!L.isOn(f)) {
        this.fixtureMul[f.id] = 0;
        continue;
      }
      const level = f.flicker + floor * (f.kind === 'main' ? 0.45 : 0.25);
      let mul = 1;
      if (level > 0.02) {
        const nz = hash(Math.floor(t * 9) * 0.37 + f.id * 13.17);
        if (nz < level * 0.3) mul = 0.1 + nz;
        else mul = 1 - level * 0.12 * (0.5 + 0.5 * Math.sin(t * 47 + f.id));
      }
      this.fixtureMul[f.id] = mul;
      if (mul >= 0.999) continue;
      const k = (1 - mul) * f.intensity;
      for (let i = 0; i < f.cells.length; i++) {
        const c = f.cells[i]!;
        const wgt = f.weights[i]! * k;
        this.lr[c] = this.lr[c]! - f.color[0] * wgt;
        this.lg[c] = this.lg[c]! - f.color[1] * wgt;
        this.lb[c] = this.lb[c]! - f.color[2] * wgt;
      }
    }
    const d = this.data;
    const toHalf = THREE.DataUtils.toHalfFloat;
    for (let c = 0; c < n; c++) {
      const o = c * 4;
      d[o] = toHalf(Math.max(0, this.lr[c]!));
      d[o + 1] = toHalf(Math.max(0, this.lg[c]!));
      d[o + 2] = toHalf(Math.max(0, this.lb[c]!));
      d[o + 3] = toHalf(this.exposure[c]!);
    }
    this.texture.needsUpdate = true;
  }

  /**
   * Teach a standard/physical material to take light from the grid. `fill` is the soft,
   * directionless share; `direct` the shaded, specular share.
   */
  patch<M extends THREE.MeshStandardMaterial>(material: M, opts: { fill?: number; direct?: number } = {}): M {
    const fill = (opts.fill ?? 0.55).toFixed(3);
    const direct = (opts.direct ?? 0.85).toFixed(3);
    const uniforms = this.uniforms;
    const prev = material.onBeforeCompile;
    material.onBeforeCompile = (shader, renderer) => {
      prev.call(material, shader, renderer);
      Object.assign(shader.uniforms, uniforms);
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vGridW;\nvarying vec3 vGridN;')
        .replace(
          '#include <worldpos_vertex>',
          `#include <worldpos_vertex>
          {
            vec4 gw = vec4( transformed, 1.0 );
            #ifdef USE_INSTANCING
              gw = instanceMatrix * gw;
            #endif
            gw = modelMatrix * gw;
            vGridW = gw.xyz;
            vGridN = inverseTransformDirection( transformedNormal, viewMatrix );
          }`,
        );
      shader.fragmentShader = shader.fragmentShader
        .replace(
          '#include <common>',
          `#include <common>
          varying vec3 vGridW;
          varying vec3 vGridN;
          uniform sampler2D gridLight;
          uniform vec2 gridInvSize;
          uniform float gridLightning;
          uniform float gridBoost;`,
        )
        .replace(
          '#include <lights_fragment_maps>',
          `{
            vec3 gN = normalize( vGridN );
            vec3 sp = vGridW + gN * 0.42;
            vec2 guv = sp.xz * gridInvSize;
            vec4 g0 = texture2D( gridLight, guv );
            vec3 Lc = g0.rgb * gridBoost;
            vec2 o = gridInvSize * 0.75;
            float lx = dot( texture2D( gridLight, guv + vec2( o.x, 0.0 ) ).rgb - texture2D( gridLight, guv - vec2( o.x, 0.0 ) ).rgb, vec3( 0.3, 0.59, 0.11 ) );
            float lz = dot( texture2D( gridLight, guv + vec2( 0.0, o.y ) ).rgb - texture2D( gridLight, guv - vec2( 0.0, o.y ) ).rgb, vec3( 0.3, 0.59, 0.11 ) );
            float lum = max( 1e-3, dot( Lc, vec3( 0.3, 0.59, 0.11 ) ) );
            float up = clamp( ( ${WALL_H.toFixed(3)} - vGridW.y ) / ${WALL_H.toFixed(3)}, 0.25, 1.0 );
            vec3 ldirW = normalize( vec3( lx / lum * 1.4, up * 1.6, lz / lum * 1.4 ) );
            IncidentLight gridIL;
            gridIL.color = Lc * PI * ${direct};
            gridIL.direction = normalize( ( viewMatrix * vec4( ldirW, 0.0 ) ).xyz );
            gridIL.visible = true;
            #if defined( RE_Direct )
              RE_Direct( gridIL, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );
            #endif
            #if defined( RE_IndirectDiffuse )
              irradiance += Lc * PI * ${fill};
              irradiance += vec3( 0.55, 0.62, 0.85 ) * PI * gridLightning * g0.a * ( 0.6 + 0.4 * max( 0.0, gN.y ) );
            #endif
          }
          #include <lights_fragment_maps>`,
        );
    };
    const prevKey = material.customProgramCacheKey;
    material.customProgramCacheKey = () => `grid:${fill}:${direct}:${prevKey.call(material)}`;
    material.needsUpdate = true;
    return material;
  }
}

function hash(x: number): number {
  const s = Math.sin(x * 127.1 + 311.7) * 43758.5453;
  return s - Math.floor(s);
}

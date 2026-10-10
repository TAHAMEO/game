import * as THREE from 'three';

/** The lens pattern of a cheap reflector torch: hot centre, dark ring, bright rim, falloff. */
export function torchCookie(size = 256): THREE.DataTexture {
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = (x + 0.5) / size - 0.5;
      const v = (y + 0.5) / size - 0.5;
      const r = Math.sqrt(u * u + v * v) * 2;
      const a = Math.atan2(v, u);
      let k = 0;
      k += Math.exp(-r * r * 30) * 0.85;
      k += Math.exp(-((r - 0.3) ** 2) * 240) * 0.3;
      k += 0.5 * Math.max(0, 1 - r * 1.15) ** 1.3;
      // spill: a dim, soft halo outside the main beam
      k += 0.16 * Math.max(0, 1 - r) ** 0.6;
      k *= 0.93 + 0.07 * Math.sin(a * 7 + r * 20);
      k *= Math.min(1, Math.max(0, (1 - r) / 0.12));
      const o = (y * size + x) * 4;
      const c = Math.max(0, Math.min(255, k * 255));
      data[o] = c;
      data[o + 1] = c * 0.97;
      data[o + 2] = c * 0.9;
      data[o + 3] = 255;
    }
  }
  const t = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.needsUpdate = true;
  return t;
}

const BEAM_VERT = /* glsl */ `
varying vec3 vPos;
varying vec3 vWorld;
varying vec3 vNormalW;
void main() {
  vPos = position;
  vec4 w = modelMatrix * vec4(position, 1.0);
  vWorld = w.xyz;
  vNormalW = normalize(mat3(modelMatrix) * normal);
  gl_Position = projectionMatrix * viewMatrix * w;
}
`;

const BEAM_FRAG = /* glsl */ `
uniform float uIntensity;
uniform float uLength;
uniform float uTime;
uniform vec3 uColor;
varying vec3 vPos;
varying vec3 vWorld;
varying vec3 vNormalW;
float h(vec3 p) { return fract(sin(dot(p, vec3(12.9898, 78.233, 37.719))) * 43758.5453); }
float n3(vec3 p) {
  vec3 i = floor(p); vec3 f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(h(i), h(i + vec3(1,0,0)), f.x), mix(h(i + vec3(0,1,0)), h(i + vec3(1,1,0)), f.x), f.y),
             mix(mix(h(i + vec3(0,0,1)), h(i + vec3(1,0,1)), f.x), mix(h(i + vec3(0,1,1)), h(i + vec3(1,1,1)), f.x), f.y), f.z);
}
void main() {
  // vPos.y runs from +L/2 (apex) to -L/2 (mouth) on a three.js cone
  float t = clamp(0.5 - vPos.y / uLength, 0.0, 1.0);
  vec3 viewDir = normalize(cameraPosition - vWorld);
  float edge = pow(abs(dot(viewDir, vNormalW)), 1.6);
  float fade = (1.0 - t) * (1.0 - t) * smoothstep(0.0, 0.06, t);
  float swirl = 0.65 + 0.35 * n3(vWorld * 2.2 + vec3(0.0, uTime * 0.12, uTime * 0.07));
  float a = uIntensity * edge * fade * swirl;
  gl_FragColor = vec4(uColor * a, 1.0);
}
`;

const DUST_VERT = /* glsl */ `
uniform vec3 uOrigin;
uniform vec3 uDir;
uniform float uCos;
uniform float uIntensity;
uniform float uTime;
uniform float uScale;
attribute float aSeed;
varying float vA;
varying float vSoft;
void main() {
  // the dust box follows the torch: wrap every mote into an 8 x 8 cell column around it
  vec3 p = position;
  p.xz = uOrigin.xz + mod(position.xz - uOrigin.xz + 4.0, 8.0) - 4.0;
  p.x += sin(uTime * 0.21 + aSeed * 31.0) * 0.08;
  p.y += sin(uTime * 0.13 + aSeed * 17.0) * 0.06;
  p.z += cos(uTime * 0.17 + aSeed * 23.0) * 0.08;
  vec3 d = p - uOrigin;
  float dl = length(d);
  float c = dot(d / max(dl, 1e-3), uDir);
  float inBeam = smoothstep(uCos - 0.02, uCos + 0.05, c);
  // motes only catch the light for a moment, as they turn
  float glint = pow(0.5 + 0.5 * sin(uTime * 1.3 + aSeed * 40.0), 3.0);
  vA = uIntensity * inBeam / (1.0 + dl * dl * 0.6) * glint;
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  // a mote is a millimetre or two across: its size on screen follows the lens, not a constant
  float px = (0.0012 + 0.0016 * aSeed) * projectionMatrix[1][1] * uScale * 0.5 / max(0.15, -mv.z);
  gl_PointSize = max(1.0, px * 2.5);
  // sub-pixel motes fade rather than shimmer
  vA *= clamp(px * 2.5, 0.0, 1.0);
  vSoft = 1.0;
  gl_Position = projectionMatrix * mv;
}
`;

const DUST_FRAG = /* glsl */ `
varying float vA;
varying float vSoft;
void main() {
  vec2 q = gl_PointCoord - 0.5;
  float r = dot(q, q) * 4.0;
  if (r > 1.0) discard;
  gl_FragColor = vec4(vec3(1.0, 0.95, 0.85) * vA * exp(-r * 3.0) * vSoft, 1.0);
}
`;

export interface TorchState {
  on: boolean;
  /** 0..1 brightness (battery, faults, flicker). */
  power: number;
}

/**
 * A hand torch: shadow-casting spotlight with a lens cookie, a faint volumetric cone and the
 * dust that only shows inside it. The light hangs a little right of and below the eye, so
 * its shadows are visible, and lags the view a touch, like a hand.
 */
export class Torch {
  readonly light: THREE.SpotLight;
  readonly target = new THREE.Object3D();
  readonly beam: THREE.Mesh;
  readonly dust: THREE.Points | null;
  private readonly beamMat: THREE.ShaderMaterial;
  private readonly dustMat: THREE.ShaderMaterial | null;
  private readonly dir = new THREE.Vector3(1, 0, 0);
  private readonly tmp = new THREE.Vector3();
  baseIntensity = 34;

  constructor(
    scene: THREE.Scene,
    opts: { shadows: number; volumetric: boolean; dust: number; cookie: THREE.Texture; local: boolean },
  ) {
    const l = new THREE.SpotLight(0xfff1dd, 0, 30, 0.44, 0.45, 1.55);
    l.map = opts.cookie;
    if (opts.shadows > 0) {
      l.castShadow = true;
      l.shadow.mapSize.set(opts.shadows, opts.shadows);
      l.shadow.bias = -0.00025;
      l.shadow.normalBias = 0.025;
      l.shadow.radius = 3;
      l.shadow.camera.near = 0.08;
      l.shadow.camera.far = 30;
    }
    l.target = this.target;
    scene.add(l, this.target);
    this.light = l;
    const len = 9;
    const geo = new THREE.ConeGeometry(Math.tan(0.4) * len, len, 40, 1, true);
    this.beamMat = new THREE.ShaderMaterial({
      vertexShader: BEAM_VERT,
      fragmentShader: BEAM_FRAG,
      uniforms: { uIntensity: { value: 0 }, uLength: { value: len }, uTime: { value: 0 }, uColor: { value: new THREE.Color(1.0, 0.92, 0.8) } },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.FrontSide,
    });
    this.beam = new THREE.Mesh(geo, this.beamMat);
    this.beam.frustumCulled = false;
    this.beam.visible = opts.volumetric;
    this.beam.renderOrder = 10;
    scene.add(this.beam);
    if (opts.dust > 0 && opts.local) {
      const n = opts.dust;
      const pos = new Float32Array(n * 3);
      const seed = new Float32Array(n);
      for (let i = 0; i < n; i++) {
        pos[i * 3] = Math.random() * 8;
        pos[i * 3 + 1] = Math.random() * 1.7;
        pos[i * 3 + 2] = Math.random() * 8;
        seed[i] = Math.random();
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      g.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
      this.dustMat = new THREE.ShaderMaterial({
        vertexShader: DUST_VERT,
        fragmentShader: DUST_FRAG,
        uniforms: {
          uOrigin: { value: new THREE.Vector3() },
          uDir: { value: new THREE.Vector3(1, 0, 0) },
          uCos: { value: Math.cos(0.42) },
          uIntensity: { value: 0 },
          uTime: { value: 0 },
          uScale: { value: 1080 },
        },
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      });
      this.dust = new THREE.Points(g, this.dustMat);
      this.dust.frustumCulled = false;
      this.dust.renderOrder = 11;
      scene.add(this.dust);
    } else {
      this.dust = null;
      this.dustMat = null;
    }
  }

  /**
   * Point the torch. `reach` is how far the beam runs before the first wall (shortens the
   * visible cone so it never pokes through).
   */
  update(origin: THREE.Vector3, aim: THREE.Vector3, state: TorchState, dt: number, t: number, reach: number, lag = 14): void {
    const k = 1 - Math.exp(-dt * lag);
    this.dir.lerp(aim, k).normalize();
    this.light.position.copy(origin);
    this.target.position.copy(origin).addScaledVector(this.dir, 4);
    this.target.updateMatrixWorld();
    const power = state.on ? state.power : 0;
    this.light.intensity = this.baseIntensity * power;
    this.light.visible = power > 0.001;
    // the cone
    const len = Math.max(0.5, Math.min(9, reach));
    this.beamMat.uniforms.uIntensity!.value = 0.05 * power;
    this.beamMat.uniforms.uTime!.value = t;
    this.beamMat.uniforms.uLength!.value = 9;
    this.beam.scale.set(len / 9, len / 9, len / 9);
    // cone apex is at +y; place apex at the origin, axis along dir
    this.tmp.copy(this.dir).negate();
    this.beam.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), this.tmp);
    this.beam.position.copy(origin).addScaledVector(this.dir, (9 * this.beam.scale.y) / 2);
    if (this.dustMat && this.dust) {
      const u = this.dustMat.uniforms;
      (u.uOrigin!.value as THREE.Vector3).copy(origin);
      (u.uDir!.value as THREE.Vector3).copy(this.dir);
      u.uIntensity!.value = 0.55 * power;
      u.uTime!.value = t;
    }
  }

  /** Drawing-buffer height in pixels (mote sizes follow it). */
  setViewHeight(px: number): void {
    if (this.dustMat) this.dustMat.uniforms.uScale!.value = px;
  }

  setVolumetric(on: boolean): void {
    this.beam.visible = on;
  }

  get direction(): THREE.Vector3 {
    return this.dir;
  }

  dispose(): void {
    this.beam.geometry.dispose();
    this.beamMat.dispose();
    this.dust?.geometry.dispose();
    this.dustMat?.dispose();
    this.light.dispose();
  }
}

import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { FXAAPass } from 'three/addons/postprocessing/FXAAPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { SMAAPass } from 'three/addons/postprocessing/SMAAPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import type { Quality } from './quality';

/** The look: grade, grain, vignette, aberration, and the effects fear and harm have on sight. */
const HorrorShader = {
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    uRes: { value: new THREE.Vector2(1, 1) },
    uTime: { value: 0 },
    uGrain: { value: 0.07 },
    uVignette: { value: 0.5 },
    uAberr: { value: 0.0025 },
    uHurt: { value: 0 },
    uScare: { value: 0 },
    uVision: { value: 0 },
    uDeath: { value: 0 },
    uBreath: { value: 0 },
    uFade: { value: 0 },
    uWarp: { value: 0 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform vec2 uRes;
    uniform float uTime, uGrain, uVignette, uAberr, uHurt, uScare, uVision, uDeath, uBreath, uFade, uWarp;
    varying vec2 vUv;
    float hash(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
    void main() {
      vec2 uv = vUv;
      vec2 c = uv - 0.5;
      float r2 = dot(c, c);
      // memories and panic bend the picture a little
      float wob = uVision * 0.004 + uWarp * 0.003;
      uv += vec2(sin(uv.y * 28.0 + uTime * 2.1), cos(uv.x * 23.0 + uTime * 1.7)) * wob;
      uv = 0.5 + (uv - 0.5) * (1.0 - 0.035 * uScare);
      float ab = uAberr * (0.25 + r2 * 3.5) + 0.014 * uScare + 0.004 * uHurt + 0.003 * uVision;
      vec3 col;
      col.r = texture2D(tDiffuse, uv + c * ab).r;
      col.g = texture2D(tDiffuse, uv).g;
      col.b = texture2D(tDiffuse, uv - c * ab).b;
      float l = dot(col, vec3(0.299, 0.587, 0.114));
      // grade: a little colour drained out, cold green in the shadows, warm in the light
      col = mix(col, vec3(l), 0.16);
      col += vec3(-0.004, 0.012, 0.014) * (1.0 - smoothstep(0.0, 0.3, l));
      col *= mix(vec3(1.0), vec3(1.05, 1.0, 0.92), smoothstep(0.35, 0.9, l));
      col = (col - 0.5) * 1.06 + 0.5;
      // a remembered room: sepia, overexposed
      vec3 sep = vec3(l) * vec3(1.18, 0.98, 0.74) * 1.25 + vec3(0.05, 0.035, 0.02);
      col = mix(col, sep, uVision * 0.8);
      float vig = 1.0 - uVignette * smoothstep(0.08, 0.72, r2 * (1.0 + uBreath * 2.2 + uDeath));
      col *= vig;
      col = mix(col, col * vec3(1.35, 0.3, 0.25) + vec3(0.1, 0.0, 0.0), uHurt * smoothstep(0.0, 0.55, r2 + 0.15));
      col += vec3(0.55, 0.5, 0.45) * uScare * uScare * 0.22;
      float g = hash(uv * uRes + fract(uTime * 37.0) * 113.0) - 0.5;
      col += g * uGrain * (0.4 + 1.6 * (1.0 - smoothstep(0.0, 0.22, l)) + uVision * 1.5);
      col = mix(col, col * vec3(0.55, 0.06, 0.05), smoothstep(0.0, 0.55, uDeath));
      col *= 1.0 - smoothstep(0.45, 1.0, uDeath);
      col *= 1.0 - uFade;
      col *= 1.0 + (hash(vec2(floor(uTime * 24.0), 7.0)) - 0.5) * 0.025;
      gl_FragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
    }`,
};

export type HorrorUniforms = typeof HorrorShader.uniforms;

/** Composer: scene → AO → bloom → tone map → horror grade → anti-aliasing. */
export class Post {
  readonly composer: EffectComposer;
  readonly horror: ShaderPass;
  private readonly render: RenderPass;
  private ao: GTAOPass | null = null;
  private bloom: UnrealBloomPass | null = null;
  private aa: SMAAPass | FXAAPass | null = null;

  constructor(
    private readonly renderer: THREE.WebGLRenderer,
    scene: THREE.Scene,
    camera: THREE.PerspectiveCamera,
    quality: Quality,
  ) {
    const size = renderer.getSize(new THREE.Vector2());
    const target = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, samples: 0 });
    this.composer = new EffectComposer(renderer, target);
    this.render = new RenderPass(scene, camera);
    this.composer.addPass(this.render);
    if (quality.ao) {
      this.ao = new GTAOPass(scene, camera, size.x, size.y);
      this.ao.output = GTAOPass.OUTPUT.Default;
      this.ao.blendIntensity = 0.9;
      this.ao.updateGtaoMaterial({ radius: 0.35, distanceExponent: 1.4, thickness: 1.2, scale: 1.0, samples: 12 });
      this.ao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 6, rings: 2, samples: 12 });
      this.composer.addPass(this.ao);
    }
    if (quality.bloom) {
      this.bloom = new UnrealBloomPass(new THREE.Vector2(size.x, size.y), 0.55, 0.6, 0.92);
      this.composer.addPass(this.bloom);
    }
    this.composer.addPass(new OutputPass());
    this.horror = new ShaderPass(HorrorShader);
    this.composer.addPass(this.horror);
    if (quality.antialias === 'smaa') this.aa = new SMAAPass();
    else if (quality.antialias === 'fxaa') this.aa = new FXAAPass();
    if (this.aa) this.composer.addPass(this.aa);
  }

  get uniforms(): HorrorUniforms {
    return this.horror.uniforms as unknown as HorrorUniforms;
  }

  setSize(w: number, h: number, pixelRatio: number): void {
    this.composer.setPixelRatio(pixelRatio);
    this.composer.setSize(w, h);
    this.uniforms.uRes.value.set(w * pixelRatio, h * pixelRatio);
  }

  frame(dt: number): void {
    this.composer.render(dt);
  }

  dispose(): void {
    this.composer.dispose();
    this.ao?.dispose();
    this.bloom?.dispose();
    void this.renderer;
  }
}

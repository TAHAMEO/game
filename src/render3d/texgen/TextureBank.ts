import * as THREE from 'three';
import { NOISE_GLSL } from './glsl';
import { RECIPES, type Recipe } from './recipes';

export interface MaterialMaps {
  map: THREE.Texture;
  normalMap: THREE.Texture;
  /** R = ambient occlusion, G = roughness, B = metalness (glTF convention). */
  orm: THREE.Texture;
  size: number;
}

const VERT = /* glsl */ `
precision highp float;
in vec3 position;
in vec2 uv;
out vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

const frag = (r: Recipe) => /* glsl */ `
precision highp float;
precision highp int;
in vec2 vUv;
uniform float uSize;
uniform float uBump;
layout(location = 0) out vec4 oAlbedo;
layout(location = 1) out vec4 oNormal;
layout(location = 2) out vec4 oORM;
${NOISE_GLSL}
void surface(vec2 uv, out vec3 col, out float h, out float rough, out float metal, out float ao) {
${r.glsl}
}
void main() {
  vec3 col; float h; float rough; float metal; float ao;
  surface(vUv, col, h, rough, metal, ao);
  float e = 1.0 / uSize;
  vec3 c2; float hx; float hy; float r2; float m2; float a2;
  surface(vUv + vec2(e, 0.0), c2, hx, r2, m2, a2);
  surface(vUv + vec2(0.0, e), c2, hy, r2, m2, a2);
  // Slope per texel scaled to the texture size, so a bump looks the same at every resolution.
  vec2 slope = vec2(hx - h, hy - h) * uSize * uBump * 0.012;
  vec3 n = normalize(vec3(-slope, 1.0));
  oAlbedo = vec4(clamp(col, 0.0, 1.0), 1.0);
  oNormal = vec4(n * 0.5 + 0.5, 1.0);
  oORM = vec4(clamp(ao, 0.0, 1.0), clamp(rough, 0.04, 1.0), clamp(metal, 0.0, 1.0), 1.0);
}
`;

/**
 * Generates every material's texture set on the GPU: albedo (sRGB), normal and ORM maps,
 * three render targets written in one pass. Big textures are drawn in horizontal strips,
 * yielding between them, so neither the page nor the GPU driver stalls.
 */
export class TextureBank {
  readonly sets = new Map<string, MaterialMaps>();
  private readonly targets: THREE.WebGLRenderTarget[] = [];

  constructor(
    private readonly renderer: THREE.WebGLRenderer,
    private readonly sizeFor: (primary: boolean) => number,
  ) {}

  get(name: string): MaterialMaps {
    const s = this.sets.get(name);
    if (!s) throw new Error(`no texture set '${name}'`);
    return s;
  }

  async generate(onProgress: (done: number, total: number) => void = () => {}, yieldFn: () => Promise<void> = nextFrame): Promise<void> {
    const renderer = this.renderer;
    const scene = new THREE.Scene();
    const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2));
    quad.frustumCulled = false;
    scene.add(quad);
    const aniso = Math.min(8, renderer.capabilities.getMaxAnisotropy());
    const names = Object.keys(RECIPES);
    const prevTarget = renderer.getRenderTarget();
    const work = names.map((n) => this.sizeFor(RECIPES[n]!.primary) ** 2);
    const total = work.reduce((a, b) => a + b, 0);
    let done = 0;
    for (const name of names) {
      const recipe = RECIPES[name]!;
      const size = this.sizeFor(recipe.primary);
      const rt = new THREE.WebGLRenderTarget(size, size, {
        count: 3,
        type: THREE.UnsignedByteType,
        format: THREE.RGBAFormat,
        wrapS: THREE.RepeatWrapping,
        wrapT: THREE.RepeatWrapping,
        minFilter: THREE.LinearMipmapLinearFilter,
        magFilter: THREE.LinearFilter,
        generateMipmaps: true,
        anisotropy: aniso,
        depthBuffer: false,
      });
      rt.textures[0]!.colorSpace = THREE.SRGBColorSpace;
      const mat = new THREE.RawShaderMaterial({
        glslVersion: THREE.GLSL3,
        vertexShader: VERT,
        fragmentShader: frag(recipe),
        uniforms: { uSize: { value: size }, uBump: { value: recipe.bump } },
        depthTest: false,
        depthWrite: false,
      });
      quad.material = mat;
      const strip = Math.max(64, Math.min(size, Math.floor((256 * 1024) / size)));
      renderer.setRenderTarget(rt);
      for (let y = 0; y < size; y += strip) {
        const h = Math.min(strip, size - y);
        rt.scissor.set(0, y, size, h);
        rt.scissorTest = true;
        renderer.setRenderTarget(rt);
        renderer.render(scene, cam);
        done += size * h;
        onProgress(done, total);
        if (y + strip < size) await yieldFn();
      }
      rt.scissorTest = false;
      // One last full pass of the mip chain now that every strip is drawn.
      rt.scissor.set(0, 0, size, size);
      mat.dispose();
      this.targets.push(rt);
      this.sets.set(name, { map: rt.textures[0]!, normalMap: rt.textures[1]!, orm: rt.textures[2]!, size });
      await yieldFn();
    }
    renderer.setRenderTarget(prevTarget);
    quad.geometry.dispose();
  }

  dispose(): void {
    for (const t of this.targets) t.dispose();
    this.targets.length = 0;
    this.sets.clear();
  }
}

function nextFrame(): Promise<void> {
  return new Promise((r) => (typeof requestAnimationFrame === 'function' ? requestAnimationFrame(() => r()) : setTimeout(r, 0)));
}

import * as THREE from 'three';

const NOISE = /* glsl */ `
float h21(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float n2(vec2 p) {
  vec2 i = floor(p); vec2 f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(h21(i), h21(i + vec2(1, 0)), f.x), mix(h21(i + vec2(0, 1)), h21(i + vec2(1, 1)), f.x), f.y);
}
float fbm2(vec2 p) { float v = 0.0; float a = 0.5; for (int i = 0; i < 5; i++) { v += a * n2(p); p *= 2.03; a *= 0.5; } return v; }
`;

/** What you see through a window or the gate: the storm, a treeline, the rain on the glass. */
export function outsideMaterial(uniforms: { uTime: { value: number }; uLightning: { value: number }; uHeadlights: { value: number } }): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms,
    vertexShader: /* glsl */ `
      varying vec3 vW;
      void main() {
        vec4 w = modelMatrix * vec4(position, 1.0);
        vW = w.xyz;
        gl_Position = projectionMatrix * viewMatrix * w;
      }`,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      uniform float uLightning;
      uniform float uHeadlights;
      varying vec3 vW;
      ${NOISE}
      void main() {
        float along = vW.x * 0.71 + vW.z * 0.69;
        float y = vW.y;
        float trees = 0.92 + 0.22 * fbm2(vec2(along * 3.0, 1.7)) + 0.12 * n2(vec2(along * 11.0, 4.0));
        float clouds = fbm2(vec2(along * 0.8 + uTime * 0.02, y * 1.6));
        vec3 sky = mix(vec3(0.012, 0.015, 0.024), vec3(0.04, 0.046, 0.066), smoothstep(0.9, 1.7, y));
        sky += vec3(0.02, 0.022, 0.03) * clouds;
        sky += uLightning * (vec3(0.45, 0.5, 0.7) * (0.4 + clouds));
        float ground = 1.0 - smoothstep(trees - 0.004, trees + 0.004, y);
        vec3 col = mix(sky, vec3(0.002, 0.002, 0.003) + uLightning * 0.02, ground);
        // headlights through the gate when rescue comes
        float hl = uHeadlights * exp(-pow((y - 0.75) * 7.0, 2.0)) * (exp(-pow(fract(along * 0.5) - 0.35, 2.0) * 300.0) + exp(-pow(fract(along * 0.5) - 0.65, 2.0) * 300.0));
        col += vec3(1.0, 0.92, 0.75) * hl * 6.0;
        // rain running down the glass
        float col_id = floor(along * 70.0);
        float speed = 0.6 + h21(vec2(col_id, 3.0)) * 0.8;
        float drop = fract(y * 1.5 + uTime * speed + h21(vec2(col_id, 9.0)));
        float streak = smoothstep(0.0, 0.02, drop) * (1.0 - smoothstep(0.02, 0.25, drop)) * step(0.55, h21(vec2(col_id, 1.0)));
        col += vec3(0.06, 0.07, 0.09) * streak * (0.4 + 2.0 * uLightning);
        gl_FragColor = vec4(col, 1.0);
      }`,
    depthWrite: true,
  });
}

/** Storm clouds over the open-air parts of the hospital, lit by lightning. */
export class SkyDome {
  readonly mesh: THREE.Mesh;
  readonly uniforms = { uTime: { value: 0 }, uLightning: { value: 0 } };

  constructor() {
    const geo = new THREE.SphereGeometry(48, 32, 16);
    const mat = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      vertexShader: /* glsl */ `
        varying vec3 vDir;
        void main() {
          vDir = normalize(position);
          vec4 w = modelMatrix * vec4(position, 1.0);
          gl_Position = projectionMatrix * viewMatrix * w;
        }`,
      fragmentShader: /* glsl */ `
        uniform float uTime;
        uniform float uLightning;
        varying vec3 vDir;
        ${NOISE}
        void main() {
          vec3 d = normalize(vDir);
          vec2 p = d.xz / max(0.15, d.y + 0.2) * 1.2 + vec2(uTime * 0.015, uTime * 0.008);
          float c = fbm2(p);
          float c2 = fbm2(p * 2.7 + 5.0);
          vec3 base = mix(vec3(0.008, 0.01, 0.016), vec3(0.03, 0.035, 0.05), c);
          float moon = exp(-pow(distance(d, normalize(vec3(0.4, 0.55, -0.7))) * 4.0, 2.0));
          base += vec3(0.05, 0.055, 0.07) * moon * c2;
          base += uLightning * vec3(0.5, 0.55, 0.75) * (0.3 + c * c2 * 1.6);
          base *= smoothstep(-0.25, 0.1, d.y);
          gl_FragColor = vec4(base, 1.0);
        }`,
    });
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.renderOrder = -10;
    this.mesh.frustumCulled = false;
  }

  update(camera: THREE.Camera, t: number, lightning: number): void {
    this.mesh.position.copy(camera.position);
    this.uniforms.uTime.value = t;
    this.uniforms.uLightning.value = lightning;
  }
}

/** Rain falling only where there is sky (the grid texture's alpha = sky exposure, 1 outdoors). */
export class Rain {
  readonly mesh: THREE.LineSegments;
  private readonly mat: THREE.ShaderMaterial;

  constructor(count: number, grid: { gridLight: { value: THREE.Texture }; gridInvSize: { value: THREE.Vector2 } }) {
    const pos = new Float32Array(count * 2 * 3);
    const seed = new Float32Array(count * 2);
    const end = new Float32Array(count * 2);
    for (let i = 0; i < count; i++) {
      const x = Math.random() * 14;
      const z = Math.random() * 14;
      const s = Math.random();
      for (let k = 0; k < 2; k++) {
        pos[(i * 2 + k) * 3] = x;
        pos[(i * 2 + k) * 3 + 1] = 0;
        pos[(i * 2 + k) * 3 + 2] = z;
        seed[i * 2 + k] = s;
        end[i * 2 + k] = k;
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
    g.setAttribute('aEnd', new THREE.BufferAttribute(end, 1));
    this.mat = new THREE.ShaderMaterial({
      uniforms: { ...grid, uTime: { value: 0 }, uOrigin: { value: new THREE.Vector3() }, uLightning: { value: 0 } },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      vertexShader: /* glsl */ `
        uniform float uTime;
        uniform vec3 uOrigin;
        uniform sampler2D gridLight;
        uniform vec2 gridInvSize;
        attribute float aSeed;
        attribute float aEnd;
        varying float vA;
        void main() {
          vec3 p = position;
          p.xz = uOrigin.xz + mod(position.xz - uOrigin.xz + 7.0, 14.0) - 7.0;
          float fall = fract(aSeed * 7.31 - uTime * (0.9 + aSeed * 0.3));
          float H = 4.2;
          p.y = fall * H + aEnd * 0.16;
          p.x += aEnd * 0.02;
          float sky = texture2D(gridLight, p.xz * gridInvSize).a;
          vA = step(0.97, sky) * (0.25 + 0.4 * aSeed);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
        }`,
      fragmentShader: /* glsl */ `
        uniform float uLightning;
        varying float vA;
        void main() {
          if (vA <= 0.001) discard;
          gl_FragColor = vec4(vec3(0.32, 0.36, 0.42) * vA * (0.4 + 2.5 * uLightning), 1.0);
        }`,
    });
    this.mesh = new THREE.LineSegments(g, this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 12;
  }

  update(origin: THREE.Vector3, t: number, lightning: number): void {
    (this.mat.uniforms.uOrigin!.value as THREE.Vector3).copy(origin);
    this.mat.uniforms.uTime!.value = t;
    this.mat.uniforms.uLightning!.value = lightning;
  }
}

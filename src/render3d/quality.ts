export type QualityName = 'low' | 'medium' | 'high' | 'ultra';

export interface Quality {
  name: QualityName;
  /** Cap on device pixel ratio. */
  pixelRatio: number;
  /** Render scale relative to the canvas (dynamic resolution floor). */
  minScale: number;
  texPrimary: number;
  texOther: number;
  shadowMap: number;
  ao: boolean;
  bloom: boolean;
  antialias: 'smaa' | 'fxaa' | 'none';
  volumetric: boolean;
  dust: number;
  rain: number;
}

export const QUALITY: Record<QualityName, Quality> = {
  low: { name: 'low', pixelRatio: 1, minScale: 0.6, texPrimary: 512, texOther: 256, shadowMap: 512, ao: false, bloom: false, antialias: 'fxaa', volumetric: false, dust: 0, rain: 400 },
  medium: { name: 'medium', pixelRatio: 1.25, minScale: 0.7, texPrimary: 1024, texOther: 512, shadowMap: 1024, ao: false, bloom: true, antialias: 'smaa', volumetric: true, dust: 300, rain: 1200 },
  high: { name: 'high', pixelRatio: 1.5, minScale: 0.75, texPrimary: 1024, texOther: 1024, shadowMap: 2048, ao: true, bloom: true, antialias: 'smaa', volumetric: true, dust: 600, rain: 2500 },
  ultra: { name: 'ultra', pixelRatio: 2, minScale: 0.85, texPrimary: 2048, texOther: 1024, shadowMap: 4096, ao: true, bloom: true, antialias: 'smaa', volumetric: true, dust: 900, rain: 4000 },
};

/** A first guess from the hardware; the renderer steps down at runtime if frames run long. */
export function guessQuality(): QualityName {
  try {
    const c = document.createElement('canvas');
    const gl = c.getContext('webgl2');
    if (!gl) return 'low';
    const dbg = gl.getExtension('WEBGL_debug_renderer_info');
    const name = String(dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER)).toLowerCase();
    if (/swiftshader|llvmpipe|software|basic render/.test(name)) return 'low';
    if (/rtx|radeon rx|apple m[1-9] (pro|max|ultra)|arc a7/.test(name)) return 'ultra';
    if (/nvidia|geforce|radeon|apple m[1-9]|arc/.test(name)) return 'high';
    if (/intel|mali|adreno|powervr|apple/.test(name)) return 'medium';
    return 'high';
  } catch {
    return 'medium';
  }
}

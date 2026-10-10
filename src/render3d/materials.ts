import * as THREE from 'three';
import type { GridLight } from './gridLight';
import type { TextureBank } from './texgen/TextureBank';

export interface SurfaceOpts {
  color?: THREE.ColorRepresentation;
  roughness?: number;
  metalness?: number;
  normalScale?: number;
  emissive?: THREE.ColorRepresentation;
  emissiveIntensity?: number;
  side?: THREE.Side;
  vertexColors?: boolean;
  transparent?: boolean;
  opacity?: number;
  /** Physical extras for skin and wet things. */
  sheen?: number;
  sheenColor?: THREE.ColorRepresentation;
  clearcoat?: number;
  /** Share of grid light. */
  fill?: number;
  direct?: number;
}

/**
 * Builds and caches materials from the generated texture sets. Every surface material is
 * lit by the grid light as well as by real lights (the torches), so the world is consistent
 * whichever lights are touching it.
 */
export class MaterialKit {
  private readonly cache = new Map<string, THREE.MeshStandardMaterial>();

  constructor(
    private readonly bank: TextureBank,
    private readonly grid: GridLight,
  ) {}

  surface(recipe: string, opts: SurfaceOpts = {}): THREE.MeshStandardMaterial {
    const key = `${recipe}|${JSON.stringify(opts)}`;
    const hit = this.cache.get(key);
    if (hit) return hit;
    const maps = this.bank.get(recipe);
    const physical = opts.sheen !== undefined || opts.clearcoat !== undefined;
    const params: THREE.MeshPhysicalMaterialParameters = {
      color: opts.color ?? 0xffffff,
      roughness: opts.roughness ?? 1,
      metalness: opts.metalness ?? 1,
      map: maps.map,
      normalMap: maps.normalMap,
      roughnessMap: maps.orm,
      metalnessMap: maps.orm,
      aoMap: maps.orm,
      aoMapIntensity: 1,
      normalScale: new THREE.Vector2(opts.normalScale ?? 1, opts.normalScale ?? 1),
      side: opts.side ?? THREE.FrontSide,
      vertexColors: opts.vertexColors ?? false,
      transparent: opts.transparent ?? false,
      opacity: opts.opacity ?? 1,
    };
    if (opts.emissive !== undefined) {
      params.emissive = new THREE.Color(opts.emissive);
      params.emissiveIntensity = opts.emissiveIntensity ?? 1;
    }
    let m: THREE.MeshStandardMaterial;
    if (physical) {
      const pm = new THREE.MeshPhysicalMaterial(params);
      if (opts.sheen !== undefined) {
        pm.sheen = opts.sheen;
        pm.sheenColor = new THREE.Color(opts.sheenColor ?? 0xffffff);
        pm.sheenRoughness = 0.5;
      }
      if (opts.clearcoat !== undefined) {
        pm.clearcoat = opts.clearcoat;
        pm.clearcoatRoughness = 0.25;
      }
      m = pm;
    } else {
      m = new THREE.MeshStandardMaterial(params);
    }
    this.grid.patch(m, { fill: opts.fill, direct: opts.direct });
    this.cache.set(key, m);
    return m;
  }

  /** An untextured surface (glass, emissive fittings, plain plastics), still grid-lit. */
  plain(params: THREE.MeshStandardMaterialParameters & { fill?: number; direct?: number }, key: string): THREE.MeshStandardMaterial {
    const k = `plain|${key}`;
    const hit = this.cache.get(k);
    if (hit) return hit;
    const { fill, direct, ...rest } = params;
    const m = new THREE.MeshStandardMaterial(rest);
    this.grid.patch(m, { fill, direct });
    this.cache.set(k, m);
    return m;
  }

  dispose(): void {
    for (const m of this.cache.values()) m.dispose();
    this.cache.clear();
  }
}

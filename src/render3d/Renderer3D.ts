import * as THREE from 'three';
import { VIEW_FOV } from '../core/director/perception';
import type { Level } from '../core/level';
import type { Sim } from '../core/sim';
import { DEFAULT_LOOK, ZONE_LOOK } from './constants';
import { torchCookie } from './flashlight';
import { buildFurniture, type FurnitureAnchors } from './furniture';
import { GridLight } from './gridLight';
import { LevelGeometry } from './level3d';
import { MaterialKit } from './materials';
import { QUALITY, type Quality, type QualityName } from './quality';
import { outsideMaterial, Rain, SkyDome } from './sky';
import { TextureBank } from './texgen/TextureBank';

/** Horizontal field of view on screen, a little wider than the simulation's "edge of vision". */
export const SCREEN_HFOV = VIEW_FOV + (6 * Math.PI) / 180;

/**
 * The static half of the 3D world: generated textures, materials, the merged hospital
 * geometry and its fittings, the grid light and the storm. Everything that moves lives in
 * the scene modules that `Renderer3D` owns on top of this.
 */
export class World3D {
  readonly scene = new THREE.Scene();
  readonly grid: GridLight;
  readonly bank: TextureBank;
  kit!: MaterialKit;
  geo!: LevelGeometry;
  anchors!: FurnitureAnchors;
  readonly cookie = torchCookie(256);
  readonly sky = new SkyDome();
  rain!: Rain;
  readonly outsideUniforms = { uTime: { value: 0 }, uLightning: { value: 0 }, uHeadlights: { value: 0 } };
  private outside: THREE.ShaderMaterial | null = null;

  constructor(
    readonly renderer: THREE.WebGLRenderer,
    readonly level: Level,
    readonly quality: Quality,
  ) {
    this.grid = new GridLight(level);
    this.bank = new TextureBank(renderer, (primary) => (primary ? quality.texPrimary : quality.texOther));
    this.scene.background = new THREE.Color(0x000000);
    this.scene.fog = new THREE.FogExp2(0x020203, 0.07);
  }

  async build(onProgress: (k: number) => void): Promise<void> {
    await this.bank.generate((d, t) => onProgress(0.85 * (d / t)));
    this.kit = new MaterialKit(this.bank, this.grid);
    this.outside = outsideMaterial(this.outsideUniforms);
    const geo = new LevelGeometry(this.level, this.kit);
    this.anchors = buildFurniture(geo);
    geo.build();
    geo.finish((key) => this.materialFor(key));
    this.geo = geo;
    this.scene.add(geo.group);
    this.scene.add(this.sky.mesh);
    this.rain = new Rain(this.quality.rain, this.grid.uniforms);
    this.scene.add(this.rain.mesh);
    const hemi = new THREE.HemisphereLight(0x1c2230, 0x0a0806, 0.35);
    this.scene.add(hemi);
    onProgress(1);
  }

  materialFor(key: string): THREE.Material {
    const kit = this.kit;
    const [kind, arg] = key.split(':') as [string, string | undefined];
    if (kind === 'wall' || kind === 'floor' || kind === 'ceil') {
      const look = ZONE_LOOK[arg ?? 'h'] ?? DEFAULT_LOOK;
      if (kind === 'wall') return kit.surface(look.wall, { color: tint(look.wallTint) });
      if (kind === 'floor') return kit.surface(look.floor, { color: tint(look.floorTint) });
      return kit.surface(look.ceil ?? 'ceiltile', { fill: 0.4, direct: 0.35 });
    }
    switch (key) {
      case 'trim':
        return kit.plain({ color: 0x1b1a19, roughness: 0.55 }, 'trim');
      case 'rail':
        return kit.surface('wood', { color: 0xd8c4a8 });
      case 'steel':
        return kit.surface('steel');
      case 'steel:dark':
        return kit.surface('steel', { color: 0x6a6a6a });
      case 'frame':
        return kit.surface('metal', { color: 0x46524f });
      case 'frame:window':
        return kit.surface('metal', { color: 0xb8b2a2 });
      case 'metal:locker':
        return kit.surface('metal', { color: 0x6c8390 });
      case 'metal:lockerIn':
        return kit.surface('metal', { color: 0x44525a });
      case 'metal:vent':
        return kit.surface('metal', { color: 0x9a9a90 });
      case 'metal:grey':
        return kit.surface('metal', { color: 0x8a8c86 });
      case 'metal:radio':
        return kit.surface('metal', { color: 0x4c5040 });
      case 'metal:bed':
        return kit.surface('metal', { color: 0xd6d0bd });
      case 'metal:ambulance':
        return kit.surface('metal', { color: 0xe4e2dc });
      case 'metal:red':
        return kit.surface('metal', { color: 0xa82a1f });
      case 'black':
        return kit.plain({ color: 0x050505, roughness: 0.85 }, 'black');
      case 'ceramic':
        return kit.plain({ color: 0xdcd8cc, roughness: 0.16 }, 'ceramic');
      case 'mirror':
        return kit.plain({ color: 0x1a1d22, roughness: 0.06, metalness: 1 }, 'mirror');
      case 'wood':
        return kit.surface('wood');
      case 'wood:dark':
        return kit.surface('wood', { color: 0x3a3028 });
      case 'fabric:mattress':
        return kit.surface('fabric', { color: 0x6a7d86 });
      case 'fabric:sheet':
        return kit.surface('fabric', { color: 0xf2f0ea });
      case 'fabric:blanket':
        return kit.surface('fabric', { color: 0x8c9fae });
      case 'glass':
        return kit.plain({ color: 0x9fb0c0, roughness: 0.04, metalness: 0, transparent: true, opacity: 0.16, depthWrite: false }, 'glass');
      case 'glass:cracked':
        return kit.plain({ color: 0xa8b4c0, roughness: 0.2, metalness: 0, transparent: true, opacity: 0.28, depthWrite: false }, 'glass:cracked');
      case 'glass:dark':
        return kit.plain({ color: 0x0b0e12, roughness: 0.08, metalness: 0.2 }, 'glass:dark');
      case 'outside':
        return this.outside!;
      case 'rust':
        return kit.surface('rust');
      case 'stone':
        return kit.surface('concrete', { color: 0xbab8ae });
      case 'plastic:beige':
        return kit.plain({ color: 0xc8bea8, roughness: 0.5 }, 'plastic:beige');
      case 'plastic:orange':
        return kit.plain({ color: 0xb4602a, roughness: 0.42 }, 'plastic:orange');
      case 'cardboard':
        return kit.plain({ color: 0x8a6a45, roughness: 0.92 }, 'cardboard');
      default:
        return kit.plain({ color: 0xff00ff }, 'missing');
    }
  }

  dispose(): void {
    this.bank.dispose();
    this.kit?.dispose();
  }
}

const tint = (t?: [number, number, number]) => (t ? new THREE.Color(t[0], t[1], t[2]) : 0xffffff);

export function makeRenderer(canvas: HTMLCanvasElement, q: QualityName): THREE.WebGLRenderer {
  const r = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', alpha: false, stencil: false });
  r.outputColorSpace = THREE.SRGBColorSpace;
  r.toneMapping = THREE.ACESFilmicToneMapping;
  r.toneMappingExposure = 1.0;
  r.shadowMap.enabled = true;
  r.shadowMap.type = THREE.PCFShadowMap;
  r.setPixelRatio(Math.min(window.devicePixelRatio || 1, QUALITY[q].pixelRatio));
  return r;
}

export function horizontalToVerticalFov(hfov: number, aspect: number): number {
  return (2 * Math.atan(Math.tan(hfov / 2) / aspect) * 180) / Math.PI;
}

export type { Sim };

import * as THREE from 'three';
import { paperTexture } from './canvasTex';
import type { MaterialKit } from './materials';

/**
 * Small hand-sized models: the things you pick up and the things it keeps. Geometry and
 * materials are shared; `make*` returns a fresh Object3D that reuses them.
 */
export class Models {
  private readonly geo = new Map<string, THREE.BufferGeometry>();
  private readonly mat = new Map<string, THREE.Material>();

  constructor(private readonly kit: MaterialKit) {}

  private g(key: string, make: () => THREE.BufferGeometry): THREE.BufferGeometry {
    let v = this.geo.get(key);
    if (!v) {
      v = make();
      this.geo.set(key, v);
    }
    return v;
  }

  private m(key: string, make: () => THREE.Material): THREE.Material {
    let v = this.mat.get(key);
    if (!v) {
      v = make();
      this.mat.set(key, v);
    }
    return v;
  }

  private mesh(geo: THREE.BufferGeometry, mat: THREE.Material, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0): THREE.Mesh {
    const me = new THREE.Mesh(geo, mat);
    me.position.set(x, y, z);
    me.rotation.set(rx, ry, rz);
    me.castShadow = true;
    me.receiveShadow = true;
    return me;
  }

  private steel(): THREE.Material {
    return this.m('steel', () => this.kit.surface('steel'));
  }

  fuse(): THREE.Object3D {
    const g = new THREE.Group();
    const body = this.g('fuse', () => new THREE.CylinderGeometry(0.024, 0.024, 0.1, 16).rotateZ(Math.PI / 2));
    const cap = this.g('fusecap', () => new THREE.CylinderGeometry(0.027, 0.027, 0.022, 16).rotateZ(Math.PI / 2));
    g.add(this.mesh(body, this.m('ceramic', () => this.kit.plain({ color: 0xe8e2d0, roughness: 0.3 }, 'ceramic-item')), 0, 0.027, 0));
    g.add(this.mesh(cap, this.steel(), -0.06, 0.027, 0));
    g.add(this.mesh(cap, this.steel(), 0.06, 0.027, 0));
    return g;
  }

  key(): THREE.Object3D {
    const g = new THREE.Group();
    const blade = this.g('keyblade', () => new THREE.BoxGeometry(0.06, 0.006, 0.014));
    const ring = this.g('keyring', () => new THREE.TorusGeometry(0.016, 0.004, 6, 16).rotateX(Math.PI / 2));
    const lan = this.g('lanyard', () => new THREE.TorusGeometry(0.11, 0.008, 4, 28).rotateX(Math.PI / 2).scale(1, 1, 0.45));
    const brass = this.m('brass', () => this.kit.plain({ color: 0xb08d4a, roughness: 0.3, metalness: 1 }, 'brass'));
    g.add(this.mesh(blade, brass, 0.03, 0.004, 0));
    g.add(this.mesh(ring, brass, -0.012, 0.004, 0));
    g.add(this.mesh(lan, this.m('lanyard', () => this.kit.plain({ color: 0x8a1c1c, roughness: 0.8 }, 'lanyard')), -0.13, 0.006, 0));
    return g;
  }

  battery(): THREE.Object3D {
    const g = new THREE.Group();
    const body = this.g('bat', () => new THREE.CylinderGeometry(0.03, 0.03, 0.1, 18).rotateZ(Math.PI / 2));
    const band = this.g('batband', () => new THREE.CylinderGeometry(0.0305, 0.0305, 0.03, 18).rotateZ(Math.PI / 2));
    g.add(this.mesh(body, this.m('batbody', () => this.kit.plain({ color: 0x141414, roughness: 0.4 }, 'batbody')), 0, 0.03, 0));
    g.add(this.mesh(band, this.m('batband', () => this.kit.plain({ color: 0xc28a2a, roughness: 0.35, metalness: 0.6 }, 'batband')), 0.03, 0.03, 0));
    g.add(this.mesh(this.g('batcap', () => new THREE.CylinderGeometry(0.01, 0.01, 0.01, 10).rotateZ(Math.PI / 2)), this.steel(), 0.055, 0.03, 0));
    return g;
  }

  bottle(): THREE.Object3D {
    const geo = this.g('bottle', () =>
      new THREE.LatheGeometry(
        [
          new THREE.Vector2(0, 0),
          new THREE.Vector2(0.032, 0),
          new THREE.Vector2(0.034, 0.012),
          new THREE.Vector2(0.034, 0.12),
          new THREE.Vector2(0.026, 0.15),
          new THREE.Vector2(0.012, 0.175),
          new THREE.Vector2(0.012, 0.21),
          new THREE.Vector2(0.0, 0.21),
        ],
        16,
      ),
    );
    const mat = this.m('glassbottle', () => {
      const mm = new THREE.MeshPhysicalMaterial({ color: 0x3f6b3a, roughness: 0.08, metalness: 0, transparent: true, opacity: 0.55, clearcoat: 1 });
      return mm;
    });
    const me = this.mesh(geo, mat);
    return me;
  }

  paper(kind: 'note' | 'record', seed: number): THREE.Object3D {
    const geo = this.g(`paper:${kind}`, () => new THREE.PlaneGeometry(kind === 'record' ? 0.2 : 0.15, kind === 'record' ? 0.26 : 0.2).rotateX(-Math.PI / 2));
    const mat = this.m(`paper:${kind}:${seed % 4}`, () => {
      const m = new THREE.MeshStandardMaterial({ map: paperTexture(kind, seed % 4), roughness: 0.9, side: THREE.DoubleSide });
      return m;
    });
    const g = new THREE.Group();
    const me = this.mesh(geo, mat, 0, 0.004, 0);
    me.castShadow = false;
    g.add(me);
    if (kind === 'record') {
      // a manila folder under the page
      const folder = this.mesh(
        this.g('folder', () => new THREE.BoxGeometry(0.24, 0.006, 0.3)),
        this.m('folder', () => this.kit.plain({ color: 0xb59a62, roughness: 0.85 }, 'folder')),
        0.015,
        0.0,
        0.01,
      );
      folder.castShadow = false;
      g.add(folder);
    }
    return g;
  }

  torch(): THREE.Object3D {
    const g = new THREE.Group();
    const body = this.g('torchbody', () => new THREE.CylinderGeometry(0.022, 0.022, 0.18, 14).rotateZ(Math.PI / 2));
    const head = this.g('torchhead', () => new THREE.CylinderGeometry(0.036, 0.024, 0.05, 16).rotateZ(Math.PI / 2));
    const black = this.m('torchblack', () => this.kit.plain({ color: 0x1b1b1b, roughness: 0.5, metalness: 0.4 }, 'torchblack'));
    g.add(this.mesh(body, black, 0, 0.024, 0));
    g.add(this.mesh(head, black, 0.11, 0.036, 0));
    return g;
  }

  /** A pile of things it kept [W]: a handful of shapes, chosen by what the label names. */
  trophy(label: string, seed: number): THREE.Object3D {
    const l = label.toLowerCase();
    if (l.includes('torch')) return this.torch();
    if (l.includes('fuse')) return this.fuse();
    if (l.includes('key')) return this.key();
    if (l.includes('bottle') || l.includes('glass')) return this.bottle();
    if (l.includes('batter')) return this.battery();
    return this.cloth(seed);
  }

  cloth(seed: number): THREE.Object3D {
    const geo = this.g(`cloth:${seed % 3}`, () => {
      const g = new THREE.SphereGeometry(0.16, 12, 8);
      const p = g.getAttribute('position');
      for (let i = 0; i < p.count; i++) {
        const y = p.getY(i);
        const x = p.getX(i);
        const z = p.getZ(i);
        const n = Math.sin(x * 31 + seed) * Math.cos(z * 27 + seed) * 0.03;
        p.setXYZ(i, x * (1 + n * 3), Math.max(0, y) * 0.32 + n, z * (1 + n * 2));
      }
      g.computeVertexNormals();
      return g;
    });
    const colors = [0x5a7e8a, 0x6d6a5c, 0x7a3a34];
    return this.mesh(geo, this.m(`cloth:${seed % 3}`, () => this.kit.surface('fabric', { color: colors[seed % 3]! })), 0, 0.01, 0);
  }

  /** What the scare left on the floor: a ceiling tile and something dark that came with it. */
  ceilingTile(): THREE.Object3D {
    const g = new THREE.Group();
    const tile = this.mesh(
      this.g('ctile', () => new THREE.BoxGeometry(0.42, 0.018, 0.42)),
      this.m('ctile', () => this.kit.surface('ceiltile', { color: 0xd8d4c8 })),
      0,
      0.012,
      0,
      0.06,
      0.4,
      0.03,
    );
    g.add(tile);
    const pool = this.mesh(
      this.g('pool', () => new THREE.CircleGeometry(0.32, 20).rotateX(-Math.PI / 2)),
      this.m('pool', () => new THREE.MeshPhysicalMaterial({ color: 0x120404, roughness: 0.05, metalness: 0, clearcoat: 1, transparent: true, opacity: 0.92 })),
      0.18,
      0.002,
      0.1,
    );
    pool.castShadow = false;
    g.add(pool);
    return g;
  }

  /** The nest's arranged signs [W]: a small heap of the named things. */
  nestSign(label: string, seed: number): THREE.Object3D {
    const g = new THREE.Group();
    const l = label.toLowerCase();
    const n = 5 + (seed % 4);
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + seed;
      const r = 0.12 + (i % 3) * 0.08;
      let o: THREE.Object3D;
      if (l.includes('torch')) o = this.torch();
      else if (l.includes('fuse')) o = this.fuse();
      else if (l.includes('key')) o = this.key();
      else if (l.includes('glass') || l.includes('bulb')) o = this.bottle();
      else o = this.cloth(seed + i);
      o.position.set(Math.cos(a) * r, 0, Math.sin(a) * r);
      o.rotation.y = a * 1.7;
      g.add(o);
    }
    return g;
  }

  dispose(): void {
    for (const g of this.geo.values()) g.dispose();
    for (const m of this.mat.values()) m.dispose();
  }
}

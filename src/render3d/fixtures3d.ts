import * as THREE from 'three';
import { cellCenter, type Level } from '../core/level';
import type { Fixture, Lighting } from '../core/lighting';
import { WALL_H } from './constants';
import { GeoBuilder } from './geo';
import type { GridLight } from './gridLight';
import type { MaterialKit } from './materials';

/**
 * The light fittings of one run: fluorescent troffers, red emergency domes, sodium lamps
 * outside, the wet glow of the nest. Their glow follows the grid light's live flicker, so a
 * tube that stutters on screen is the same tube that stutters in the simulation.
 */
export class Fixtures3D {
  readonly group = new THREE.Group();
  private panels: THREE.InstancedMesh | null = null;
  private domes: THREE.InstancedMesh | null = null;
  private lamps: THREE.InstancedMesh | null = null;
  private glows: THREE.InstancedMesh | null = null;
  private readonly order: { panels: Fixture[]; domes: Fixture[]; lamps: Fixture[]; glows: Fixture[] } = { panels: [], domes: [], lamps: [], glows: [] };
  private readonly color = new THREE.Color();
  private readonly static: THREE.Mesh[] = [];

  constructor(
    private readonly level: Level,
    private readonly kit: MaterialKit,
    private readonly grid: GridLight,
  ) {
    this.group.name = 'fixtures';
  }

  bind(lighting: Lighting): void {
    this.clear();
    const level = this.level;
    const frames = new GeoBuilder();
    const posts = new GeoBuilder();
    const m = new THREE.Matrix4();
    const panelsList: Fixture[] = [];
    const domesList: Fixture[] = [];
    const lampsList: Fixture[] = [];
    const glowList: Fixture[] = [];
    for (const f of lighting.fixtures) {
      if (f.kind === 'main') panelsList.push(f);
      else if (f.kind === 'lamp') lampsList.push(f);
      else if (f.color[1] > 0.5) glowList.push(f);
      else domesList.push(f);
    }
    // fluorescent troffers: a metal frame and a diffuser that glows
    const panelGeo = new THREE.PlaneGeometry(0.62, 0.3).rotateX(Math.PI / 2);
    const panelMat = new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: true, side: THREE.DoubleSide });
    this.panels = new THREE.InstancedMesh(panelGeo, panelMat, Math.max(1, panelsList.length));
    panelsList.forEach((f, i) => {
      const c = cellCenter(level, f.cell);
      const rot = (f.cell * 7) % 2 === 0 ? 0 : Math.PI / 2;
      const hang = f.broken ? 0.35 : 0;
      m.makeRotationY(rot).multiply(new THREE.Matrix4().makeRotationX(hang)).setPosition(c.x, WALL_H - 0.012 - hang * 0.15, c.y);
      this.panels!.setMatrixAt(i, m);
      const fr = new THREE.BoxGeometry(0.68, 0.035, 0.36);
      frames.merge(fr, new THREE.Matrix4().makeRotationY(rot).multiply(new THREE.Matrix4().makeRotationX(hang)).setPosition(c.x, WALL_H - 0.03 - hang * 0.15, c.y));
      fr.dispose();
    });
    this.panels.count = panelsList.length;
    this.order.panels = panelsList;
    // emergency domes
    const domeGeo = new THREE.SphereGeometry(0.055, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2).rotateX(Math.PI);
    this.domes = new THREE.InstancedMesh(domeGeo, new THREE.MeshBasicMaterial({ color: 0xffffff }), Math.max(1, domesList.length));
    domesList.forEach((f, i) => {
      const c = cellCenter(level, f.cell);
      m.makeTranslation(c.x + 0.32, WALL_H - 0.005, c.y + 0.32);
      this.domes!.setMatrixAt(i, m);
      const base = new THREE.CylinderGeometry(0.07, 0.07, 0.02, 14);
      frames.merge(base, new THREE.Matrix4().makeTranslation(c.x + 0.32, WALL_H - 0.01, c.y + 0.32));
      base.dispose();
    });
    this.domes.count = domesList.length;
    this.order.domes = domesList;
    // sodium lamps on posts
    const headGeo = new THREE.BoxGeometry(0.28, 0.06, 0.16);
    this.lamps = new THREE.InstancedMesh(headGeo, new THREE.MeshBasicMaterial({ color: 0xffffff }), Math.max(1, lampsList.length));
    lampsList.forEach((f, i) => {
      const c = cellCenter(level, f.cell);
      m.makeTranslation(c.x, 3.02, c.y);
      this.lamps!.setMatrixAt(i, m);
      const pole = new THREE.CylinderGeometry(0.035, 0.05, 3.05, 10);
      posts.merge(pole, new THREE.Matrix4().makeTranslation(c.x, 1.52, c.y));
      pole.dispose();
      const hood = new THREE.BoxGeometry(0.34, 0.08, 0.2);
      posts.merge(hood, new THREE.Matrix4().makeTranslation(c.x, 3.08, c.y));
      hood.dispose();
    });
    this.lamps.count = lampsList.length;
    this.order.lamps = lampsList;
    // the nest's wet glow: clusters of soft blobs where its light sits
    const blob = new THREE.SphereGeometry(0.06, 10, 8);
    const glowCount = glowList.length * 14;
    this.glows = new THREE.InstancedMesh(blob, new THREE.MeshBasicMaterial({ color: 0xffffff }), Math.max(1, glowCount));
    let gi = 0;
    for (const f of glowList) {
      const c = cellCenter(level, f.cell);
      for (let k = 0; k < 14; k++) {
        const a = k * 2.399;
        const r = 0.6 + (k % 5) * 0.55;
        const s = 0.5 + ((k * 37) % 10) / 10;
        m.makeScale(s, s * 0.6, s).setPosition(c.x + Math.cos(a) * r, 0.04 + ((k * 13) % 7) * 0.2, c.y + Math.sin(a) * r);
        this.glows.setMatrixAt(gi++, m);
      }
    }
    this.glows.count = gi;
    this.order.glows = glowList;
    for (const mesh of [this.panels, this.domes, this.lamps, this.glows]) {
      mesh.instanceMatrix.needsUpdate = true;
      mesh.frustumCulled = false;
      this.group.add(mesh);
    }
    if (!frames.empty) this.addStatic(frames.build(), this.kit.surface('metal', { color: 0xc8c6be }));
    if (!posts.empty) this.addStatic(posts.build(), this.kit.surface('metal', { color: 0x3a3c3a }));
    blob.dispose();
    this.update();
  }

  private addStatic(geo: THREE.BufferGeometry, mat: THREE.Material): void {
    const mesh = new THREE.Mesh(geo, mat);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    this.static.push(mesh);
    this.group.add(mesh);
  }

  /** Glow = colour × intensity × live flicker. Bloom does the rest. */
  update(): void {
    const mul = this.grid.fixtureMul;
    const set = (mesh: THREE.InstancedMesh | null, list: Fixture[], scale: number, per = 1) => {
      if (!mesh) return;
      list.forEach((f, i) => {
        const k = (mul[f.id] ?? 0) * f.intensity * scale;
        const lit = k > 0.01;
        this.color.setRGB(lit ? f.color[0] * k : 0.03, lit ? f.color[1] * k : 0.03, lit ? f.color[2] * k : 0.032);
        for (let j = 0; j < per; j++) mesh.setColorAt(i * per + j, this.color);
      });
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    };
    set(this.panels, this.order.panels, 7.5);
    set(this.domes, this.order.domes, 9);
    set(this.lamps, this.order.lamps, 10);
    set(this.glows, this.order.glows, 2.2, 14);
  }

  private clear(): void {
    for (const mesh of [this.panels, this.domes, this.lamps, this.glows]) {
      if (!mesh) continue;
      this.group.remove(mesh);
      mesh.geometry.dispose();
      (mesh.material as THREE.Material).dispose();
      mesh.dispose();
    }
    for (const s of this.static) {
      this.group.remove(s);
      s.geometry.dispose();
    }
    this.static.length = 0;
    this.panels = this.domes = this.lamps = this.glows = null;
  }
}

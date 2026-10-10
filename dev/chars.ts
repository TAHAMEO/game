import * as THREE from 'three';
import { parseLevel } from '../src/core/level';
import { animateEntity, animateHuman, buildEntity, buildHuman, type EntityPose, type HumanPose } from '../src/render3d/characters';
import { GridLight } from '../src/render3d/gridLight';
import { MaterialKit } from '../src/render3d/materials';
import { makeRenderer } from '../src/render3d/Renderer3D';
import { TextureBank } from '../src/render3d/texgen/TextureBank';

const p = new URLSearchParams(location.search);
const canvas = document.querySelector<HTMLCanvasElement>('#c')!;
const renderer = makeRenderer(canvas, 'low');
renderer.setPixelRatio(1);
renderer.setSize(innerWidth, innerHeight, false);
const level = parseLevel();
const grid = new GridLight(level);
const bank = new TextureBank(renderer, () => 256);
await bank.generate(() => {}, async () => {});
const kit = new MaterialKit(bank, grid);
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x050506);
const floor = new THREE.Mesh(new THREE.PlaneGeometry(20, 20).rotateX(-Math.PI / 2), kit.surface('tilefloor'));
floor.receiveShadow = true;
scene.add(floor);
const key = new THREE.SpotLight(0xfff0dd, 40, 20, 0.6, 0.5, 1.6);
key.position.set(1.5, 2.2, 3.2);
key.target.position.set(0, 0.8, 0);
key.castShadow = true;
scene.add(key, key.target);
const rim = new THREE.DirectionalLight(0x8899cc, 1.2);
rim.position.set(-3, 3, -4);
scene.add(rim);
scene.add(new THREE.HemisphereLight(0x223, 0x111, 0.6));
const cam = new THREE.PerspectiveCamera(40, innerWidth / innerHeight, 0.05, 50);
const which = p.get('who') ?? 'entity';
const shots: string[] = [];
if (which === 'entity') {
  const poses: EntityPose[] = ['idle', 'walk', 'tilt', 'inhale', 'lunge', 'crouch', 'feed', 'reach'];
  for (const pose of poses) {
    const e = buildEntity(kit);
    scene.add(e.root);
    e.root.rotation.y = Number(p.get('rot') ?? 0.4);
    let ph = 0;
    for (let i = 0; i < 90; i++) ph = animateEntity(e, { pose, speed: pose === 'walk' ? 1.3 : 0, t: i / 60, dt: 1 / 60, seed: 0.3, phase: ph, tiltSide: 1 });
    const close = p.has('face');
    cam.position.set(close ? 0.35 : 1.6, close ? 1.55 : 1.0, close ? 0.6 : 3.4);
    cam.lookAt(0, close ? 1.5 : 0.85, 0);
    renderer.render(scene, cam);
    shots.push(canvas.toDataURL('image/png'));
    scene.remove(e.root);
  }
} else {
  const poses: HumanPose[] = ['idle', 'scared', 'walk', 'wave', 'torch', 'crouch', 'dead', 'propped'];
  for (const pose of poses) {
    const h = buildHuman(kit, { top: 0x46966e, bottom: 0x3d7a5c, skin: 0xc89a7c, hair: 0x2a1c14 });
    scene.add(h.root);
    h.root.rotation.y = 0.5;
    let ph = 0;
    for (let i = 0; i < 90; i++) ph = animateHuman(h, { pose, speed: pose === 'walk' ? 1.5 : 0, t: i / 60, dt: 1 / 60, seed: 0.2, phase: ph });
    cam.position.set(1.0, 0.8, 2.2);
    cam.lookAt(0, 0.5, 0);
    renderer.render(scene, cam);
    shots.push(canvas.toDataURL('image/png'));
    scene.remove(h.root);
  }
}
(window as unknown as { __shots: string[] }).__shots = shots;
(window as unknown as { __done: boolean }).__done = true;

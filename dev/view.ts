import * as THREE from 'three';
import { defaultConfig } from '../src/core/config';
import { MemoryStore } from '../src/core/persistence';
import { Sim } from '../src/core/sim';
import { eyeHeight } from '../src/render3d/constants';
import { Torch } from '../src/render3d/flashlight';
import { horizontalToVerticalFov, makeRenderer, SCREEN_HFOV, World3D } from '../src/render3d/Renderer3D';
import { QUALITY, type QualityName } from '../src/render3d/quality';

const p = new URLSearchParams(location.search);
const q = (p.get('q') ?? 'low') as QualityName;
const canvas = document.querySelector<HTMLCanvasElement>('#c')!;
const renderer = makeRenderer(canvas, q);
renderer.setPixelRatio(1);
renderer.setSize(innerWidth, innerHeight, false);
const sim = new Sim({ ...defaultConfig(Number(p.get('seed') ?? 7)) }, new MemoryStore());
if (p.has('power')) sim.world.lighting.setPower(true);
const world = new World3D(renderer, sim.level, QUALITY[q]);
await world.build(() => {});
const cam = new THREE.PerspectiveCamera(horizontalToVerticalFov(SCREEN_HFOV, innerWidth / innerHeight), innerWidth / innerHeight, 0.03, 80);
const torch = new Torch(world.scene, { shadows: QUALITY[q].shadowMap, volumetric: true, dust: 300, cookie: world.cookie, local: true });
world.grid.update(sim, 0);
const shots: string[] = [];
const views = (p.get('views') ?? '31.5,25.5,-1.57,0').split(';').map((v) => v.split(',').map(Number));
for (const [x, z, a, pitch = 0, torchOn = 1] of views) {
  cam.position.set(x!, eyeHeight(0.5), z!);
  const dir = new THREE.Vector3(Math.cos(a!) * Math.cos(pitch), Math.sin(pitch), Math.sin(a!) * Math.cos(pitch));
  cam.lookAt(cam.position.clone().add(dir));
  const origin = cam.position.clone().add(new THREE.Vector3(-Math.sin(a!) * 0.15, -0.14, Math.cos(a!) * 0.15));
  for (let i = 0; i < 40; i++) torch.update(origin, dir, { on: torchOn === 1, power: 1 }, 1 / 60, i / 60, 8);
  world.sky.update(cam, 1, 0);
  world.rain.update(cam.position, 1, 0);
  renderer.render(world.scene, cam);
  shots.push(canvas.toDataURL('image/png'));
}
(window as unknown as { __shots: string[]; __done: boolean }).__shots = shots;
(window as unknown as { __done: boolean }).__done = true;

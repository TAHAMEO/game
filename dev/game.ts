import { defaultConfig } from '../src/core/config';
import { idleInput } from '../src/core/input';
import { cellCenter } from '../src/core/level';
import { MemoryStore } from '../src/core/persistence';
import { Sim } from '../src/core/sim';
import { GameRenderer } from '../src/render3d/GameRenderer';
import type { QualityName } from '../src/render3d/quality';

const p = new URLSearchParams(location.search);
const canvas = document.querySelector<HTMLCanvasElement>('#c')!;
const gr = new GameRenderer(canvas, (p.get('q') ?? 'low') as QualityName);
const cfg = defaultConfig(Number(p.get('seed') ?? 7));
cfg.scares = 'off';
const sim = new Sim(cfg, new MemoryStore());
await gr.init(sim.level);
const shots: string[] = [];
let t = 0;
const frame = (n = 1, input = idleInput()) => {
  for (let i = 0; i < n; i++) {
    sim.step(1 / 60, input);
    t += 1 / 60;
    gr.handle(sim.drainEvents(), sim, 0, t);
    gr.render(sim, { dt: 1 / 60, t, viewId: 0 });
  }
};
const snap = () => shots.push(canvas.toDataURL('image/png'));
const ent = sim.entity;
const place = (x: number, y: number, a: number, pitch = 0) => {
  sim.player.pos = { x: x + 0.5, y: y + 0.5 };
  sim.player.angle = a;
  sim.player.pitch = pitch;
};
const scenes = (p.get('scenes') ?? 'dark,entity,tilt,locker,power').split(',');
for (const s of scenes) {
  ent.update = () => {};
  switch (s) {
    case 'dark':
      place(20, 18, 0);
      ent.pos = { x: 60.5, y: 40.5 };
      frame(20);
      break;
    case 'entity':
      place(20, 18, 0);
      ent.pos = { x: 23.4, y: 18.6 };
      ent.angle = Math.PI;
      ent.pose = 'idle';
      frame(30);
      break;
    case 'tilt':
      place(20, 18, 0, 0.12);
      ent.pos = { x: 22.6, y: 18.4 };
      ent.angle = Math.PI;
      ent.pose = 'tilt';
      frame(60);
      break;
    case 'lunge':
      place(20, 18, 0, 0.1);
      ent.pos = { x: 21.3, y: 18.5 };
      ent.angle = Math.PI;
      ent.pose = 'lunge';
      frame(30);
      break;
    case 'locker': {
      const spot = sim.world.spots.find((x) => x.kind === 'locker')!;
      const acc = cellCenter(sim.level, spot.access);
      sim.player.pos = { ...acc };
      sim.player.hidden = spot;
      spot.occupant = { kind: 'player', id: 0 };
      sim.player.angle = Math.atan2(acc.y - cellCenter(sim.level, spot.cell).y, acc.x - cellCenter(sim.level, spot.cell).x);
      ent.pos = { x: acc.x + Math.cos(sim.player.angle) * 1.6, y: acc.y + Math.sin(sim.player.angle) * 1.6 };
      ent.angle = sim.player.angle + Math.PI;
      ent.pose = 'walk';
      ent.speedNow = 1.2;
      frame(40);
      sim.player.hidden = null;
      spot.occupant = null;
      break;
    }
    case 'power':
      sim.world.lighting.setPower(true);
      place(36, 18, Math.PI);
      ent.pos = { x: 31.5, y: 18.5 };
      ent.angle = 0;
      ent.pose = 'walk';
      ent.speedNow = 1.3;
      frame(40);
      break;
    case 'ward':
      sim.world.lighting.setPower(true);
      place(46, 13, 0, -0.1);
      ent.pos = { x: 60.5, y: 40.5 };
      frame(20);
      break;
    case 'garden':
      place(6, 33, 3.14, 0.15);
      ent.pos = { x: 3.5, y: 37.5 };
      ent.angle = 0;
      frame(30);
      break;
  }
  snap();
}
(window as unknown as { __shots: string[] }).__shots = shots;
(window as unknown as { __done: boolean }).__done = true;

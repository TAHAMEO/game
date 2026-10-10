// usage: node dev/perf.mjs <url> [w] [h] — samples frame timing of the running game
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require('/opt/node22/lib/node_modules/playwright')); }
const [url, w = '640', h = '360'] = process.argv.slice(2);
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: Number(w), height: Number(h) } });
const errors = [];
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errors.push(m.type() + ': ' + m.text()); });
await page.addInitScript(() => {
  HTMLElement.prototype.requestPointerLock = function () { return Promise.resolve(); };
  const frames = [];
  window.__frames = frames;
  const raf = window.requestAnimationFrame.bind(window);
  let last = 0;
  window.requestAnimationFrame = (cb) => raf((t) => { if (last) frames.push(t - last); last = t; cb(t); });
});
await page.goto(url);
await page.waitForFunction('window.__quiet && window.__quiet.sim', null, { timeout: 600000 });
await page.waitForTimeout(3000);
const r = await page.evaluate(async () => {
  const q = window.__quiet;
  const f = window.__frames;
  f.length = 0;
  await new Promise((res) => setTimeout(res, 6000));
  const s = [...f].sort((a, b) => a - b);
  const sim = q.sim;
  // time the pieces directly
  const R = q.view.hd.renderer;
  R.info.autoReset = false;
  R.info.reset();
  const t0 = performance.now();
  q.view.render(sim, { dt: 1 / 60, t: 100, viewId: 0 });
  const tr = performance.now() - t0;
  const info = { calls: R.info.render.calls, triangles: R.info.render.triangles, textures: R.info.memory.textures, geometries: R.info.memory.geometries, programs: R.info.programs.length };
  R.info.autoReset = true;
  const t1 = performance.now();
  for (let i = 0; i < 60; i++) sim.step(1 / 60, { forward: 0, strafe: 0, turn: 0, pitch: 0, sprint: false, crouch: false, interact: false, interactPressed: false, flashlightPressed: false, throwPressed: false, holdBreath: false });
  const ts = (performance.now() - t1) / 60;
  return { frames: f.length, median: s[Math.floor(s.length / 2)], p90: s[Math.floor(s.length * 0.9)], renderMs: tr, stepMs: ts, quality: q.view.hd?.quality.name, info };
});
console.log(JSON.stringify(r));
console.log(errors.slice(0, 20).join('\n'));
await browser.close();

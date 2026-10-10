#!/usr/bin/env node
/**
 * Browser smoke test: boots the built game in headless Chromium, plays a few seconds,
 * opens the Director's view, fails on any page error, and saves screenshots.
 *
 *   npm run build && npx vite preview --port 4173 &
 *   npm run smoke                      # or: node scripts/smoke.mjs http://localhost:4173/
 *
 * Needs Playwright (`npm i -D playwright` or a global install). Not a dependency on purpose.
 */
import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';

const url = process.argv[2] ?? 'http://localhost:4173/';
const out = process.argv[3] ?? 'smoke-shots';

let chromium;
try {
  ({ chromium } = await import('playwright'));
} catch {
  try {
    ({ chromium } = createRequire(import.meta.url)('playwright'));
  } catch {
    console.error('Playwright is not installed. Try: npm i -D playwright && npx playwright install chromium');
    process.exit(2);
  }
}

mkdirSync(out, { recursive: true });
// WebGL2 in a headless browser without a GPU: SwiftShader (slow, but complete).
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
page.on('console', (m) => m.type() === 'error' && errors.push(`console: ${m.text()}`));
// Headless Chromium emulates pointer lock with a flood of synthetic mouse events that starves
// the page of frames. Real browsers don't; keyboard turning covers the test.
await page.addInitScript(() => {
  HTMLElement.prototype.requestPointerLock = function () {
    return Promise.resolve();
  };
});

await page.goto(`${url}?mute&seed=7&q=low&nointro`);
// the title appears once every texture has been painted on the GPU
await page.waitForSelector('[data-go]', { timeout: 300000 });
await page.screenshot({ path: `${out}/1-title.png`, timeout: 120000 });
await page.click('[data-go]');
await page.keyboard.down('KeyW');
await page.waitForTimeout(1200);
await page.keyboard.up('KeyW');
await page.keyboard.down('ArrowLeft');
await page.waitForTimeout(600);
await page.keyboard.up('ArrowLeft');
await page.screenshot({ path: `${out}/2-play.png`, timeout: 120000 });
await page.keyboard.press('F1');
await page.waitForTimeout(500);
await page.screenshot({ path: `${out}/3-directors-view.png`, timeout: 120000 });

const state = await page.evaluate(() => {
  const s = window.__quiet?.sim;
  return s && { time: +s.time.toFixed(2), phase: s.phase, entity: s.entity.stateKind, zone: s.playerZone, hd: !!window.__quiet.view?.hd };
});
const fps = await page.evaluate(
  () =>
    new Promise((res) => {
      let n = 0;
      const t0 = performance.now();
      const f = (now) => (++n, now - t0 < 1500 ? requestAnimationFrame(f) : res(Math.round(n / 1.5)));
      requestAnimationFrame(f);
    }),
);
await browser.close();

console.log(JSON.stringify({ state, fps, screenshots: out }));
if (!state || state.time <= 0) errors.push('simulation did not advance');
if (state && !state.hd) errors.push('fell back to the raycaster (no WebGL2?)');
if (errors.length) {
  console.error(errors.join('\n'));
  process.exit(1);
}
console.log('smoke: ok');

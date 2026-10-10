// usage: node dev/flow.mjs <url> <outDir> [w] [h]
// Boots the real game, walks through title → intro → play → notebook → pause, screenshotting each.
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require('/opt/node22/lib/node_modules/playwright')); }
const [url, out, w = '1280', h = '720'] = process.argv.slice(2);
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage({ viewport: { width: Number(w), height: Number(h) } });
const errors = [];
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errors.push(m.type() + ': ' + m.text()); });
await page.addInitScript(() => {
  HTMLElement.prototype.requestPointerLock = function () { return Promise.resolve(); };
});
const t0 = Date.now();
const log = (s) => console.log(`[${((Date.now() - t0) / 1000).toFixed(1)}s] ${s}`);
await page.goto(url);
await page.waitForSelector('[data-go]', { timeout: 600000 });
log('title up');
await page.waitForTimeout(1500);
await page.screenshot({ path: `${out}/1-title.png`, timeout: 180000 });
await page.click('[data-go]');
await page.waitForTimeout(2500);
await page.screenshot({ path: `${out}/2-intro.png`, timeout: 180000 });
await page.keyboard.press('Escape');
await page.waitForTimeout(300);
await page.mouse.click(640, 360);
await page.waitForTimeout(1500);
log('playing');
await page.screenshot({ path: `${out}/3-play.png`, timeout: 180000 });
await page.keyboard.down('KeyW');
await page.waitForTimeout(2500);
await page.keyboard.up('KeyW');
await page.keyboard.down('PageUp');
await page.waitForTimeout(400);
await page.keyboard.up('PageUp');
await page.screenshot({ path: `${out}/4-walk-lookup.png`, timeout: 180000 });
await page.keyboard.press('KeyJ');
await page.waitForTimeout(600);
await page.screenshot({ path: `${out}/5-journal.png`, timeout: 180000 });
await page.click('[data-tab="file"]');
await page.waitForTimeout(400);
await page.screenshot({ path: `${out}/6-journal-file.png`, timeout: 180000 });
await page.click('[data-resume]');
await page.waitForTimeout(500);
const state = await page.evaluate(() => {
  const s = window.__quiet?.sim;
  return s && { time: +s.time.toFixed(2), phase: s.phase, pitch: +s.player.pitch.toFixed(2), pos: s.player.pos, zone: s.playerZone };
});
log(JSON.stringify(state));
console.log(errors.slice(0, 30).join('\n'));
await browser.close();

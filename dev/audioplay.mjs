// usage: node dev/audioplay.mjs <url>
// Plays the real game with audio on and samples the output level: is there sound, does it move?
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require('/opt/node22/lib/node_modules/playwright')); }
const [url] = process.argv.slice(2);
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage({ viewport: { width: 320, height: 180 } });
const errors = [];
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
await page.addInitScript(() => { HTMLElement.prototype.requestPointerLock = function () { return Promise.resolve(); }; });
await page.goto(url);
await page.waitForSelector('[data-go]', { timeout: 600000 });
await page.click('[data-go]');
await page.waitForFunction(() => window.__quiet?.audio?.running, null, { timeout: 60000 });

await page.mouse.click(160, 90);
const sample = async (label, ms) => {
  const r = await page.evaluate(async (ms) => {
    const a = window.__quiet.audio;
    const out = [];
    const t0 = performance.now();
    while (performance.now() - t0 < ms) { out.push(a.meter()); await new Promise((r) => setTimeout(r, 50)); }
    const f = out.filter(Number.isFinite);
    return { n: out.length, silent: out.length - f.length, min: Math.min(...f), max: Math.max(...f), avg: f.reduce((s, v) => s + v, 0) / Math.max(1, f.length) };
  }, ms);
  console.log(label.padEnd(22), JSON.stringify({ ...r, min: +r.min.toFixed(1), max: +r.max.toFixed(1), avg: +r.avg.toFixed(1) }));
};
await sample('standing (ambience)', 3000);
await page.keyboard.down('KeyW');
await sample('walking', 3000);
await page.keyboard.down('ShiftLeft');
await sample('running', 3000);
await page.keyboard.up('ShiftLeft');
await page.keyboard.up('KeyW');
await page.evaluate(() => { const q = window.__quiet; q.audio.handle([{ type: 'lightning', strength: 1 }], q.sim, 0); });
await sample('thunder', 4000);
await page.evaluate(() => { const q = window.__quiet; q.audio.handle([{ type: 'scare', kind: 'behind', intensity: 1, pos: { x: q.sim.player.pos.x, y: q.sim.player.pos.y + 1 }, phantom: false }], q.sim, 0); });
await sample('jump scare', 2000);
console.log(errors.slice(0, 20).join('\n'));
await browser.close();

// usage: node dev/mp.mjs <baseUrl> <outDir> [query]
// Two browser pages play one shared run: A hosts, B joins with the room code.
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require('/opt/node22/lib/node_modules/playwright')); }
const [base, out, query = ''] = process.argv.slice(2);
const errors = [];
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--disable-features=WebRtcHideLocalIpsWithMdns'] });
process.on('exit', () => { if (errors.length) console.log(errors.slice(0, 30).join('\n')); });
const t0 = Date.now();
const log = (s) => console.log(`[${((Date.now() - t0) / 1000).toFixed(1)}s] ${s}`);
async function open(name) {
  const ctx = await browser.newContext({ viewport: { width: 480, height: 270 } });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(`${name} pageerror: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`${name} console: ${m.text()}`); });
  await page.addInitScript(() => { HTMLElement.prototype.requestPointerLock = function () { return Promise.resolve(); }; });
  await page.goto(`${base}?q=low&mute&nointro${query}`);
  await page.waitForSelector('[data-friends]', { timeout: 600000 });
  return page;
}
const A = await open('A');
const B = await open('B');
log('both pages up');
await A.click('[data-friends]');
await A.fill('[data-nick]', 'Alice');
await A.click('[data-host]');
await A.waitForSelector('.room-code', { timeout: 60000 });
const code = (await A.textContent('.room-code')).trim();
log(`room ${code}`);
await B.click('[data-friends]');
await B.fill('[data-nick]', 'Bob');
await B.fill('[data-code]', code);
await B.click('[data-join]');
await B.waitForSelector('.seats', { timeout: 60000 });
await A.waitForFunction(() => document.querySelectorAll('.seats li:not(.empty)').length === 2, null, { timeout: 60000 });
log('Bob is in the room');
await A.screenshot({ path: `${out}/mp-1-host-lobby.png`, timeout: 120000 });
await B.screenshot({ path: `${out}/mp-2-guest-lobby.png`, timeout: 120000 });
await A.click('[data-start]');
await B.waitForFunction(() => window.__quiet?.session?.kind === 'client', null, { timeout: 60000 });
log('run started on both');
await A.mouse.click(240, 135);
await B.mouse.click(240, 135);
// Bob walks forward; Alice turns right
await B.keyboard.down('KeyW');
await A.keyboard.down('ArrowRight');
await B.waitForTimeout(3000);
await B.keyboard.up('KeyW');
await A.keyboard.up('ArrowRight');
await B.waitForTimeout(1500);
const hostView = await A.evaluate(() => { const s = window.__quiet.sim; return { t: +s.time.toFixed(2), players: s.players.map((p) => ({ name: p.name, x: +p.pos.x.toFixed(2), y: +p.pos.y.toFixed(2), a: +p.angle.toFixed(2) })) }; });
const guestView = await B.evaluate(() => { const s = window.__quiet.sim; return { t: +s.time.toFixed(2), local: s.localId, players: s.players.map((p) => ({ name: p.name, x: +p.pos.x.toFixed(2), y: +p.pos.y.toFixed(2), a: +p.angle.toFixed(2) })) }; });
log('host sees  ' + JSON.stringify(hostView));
log('guest sees ' + JSON.stringify(guestView));
await A.screenshot({ path: `${out}/mp-3-host-play.png`, timeout: 120000 });
await B.screenshot({ path: `${out}/mp-4-guest-play.png`, timeout: 120000 });
await browser.close();

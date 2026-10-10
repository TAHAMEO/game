// usage: node dev/views.mjs <url> <outPrefix> [w] [h]
import { createRequire } from 'node:module';
import { writeFileSync } from 'node:fs';
const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require('/opt/node22/lib/node_modules/playwright')); }
const [url, prefix, w = '960', h = '540'] = process.argv.slice(2);
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: Number(w), height: Number(h) } });
const errors = [];
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errors.push(m.type() + ': ' + m.text()); });
await page.goto(url);
try { await page.waitForFunction('window.__done === true', null, { timeout: 600000 }); } catch { errors.push('timeout'); }
const shots = await page.evaluate(() => window.__shots || []);
shots.forEach((d, i) => writeFileSync(`${prefix}${i}.png`, Buffer.from(d.split(',')[1], 'base64')));
console.log(`${shots.length} shots`);
console.log(errors.slice(0, 20).join('\n'));
await browser.close();

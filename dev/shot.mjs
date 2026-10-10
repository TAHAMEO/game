// usage: node dev/shot.mjs <url> <out.png> [waitExpr] [w] [h]
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require('/opt/node22/lib/node_modules/playwright')); }
const [url, out, waitExpr = 'window.__done === true', w = '1280', h = '720'] = process.argv.slice(2);
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: Number(w), height: Number(h) } });
const errors = [];
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errors.push(m.type() + ': ' + m.text()); });
await page.goto(url);
try { await page.waitForFunction(waitExpr, null, { timeout: 180000 }); } catch (e) { errors.push('timeout waiting: ' + waitExpr); }
await page.screenshot({ path: out });
console.log(errors.slice(0, 20).join('\n'));
await browser.close();

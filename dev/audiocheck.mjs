import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require('/opt/node22/lib/node_modules/playwright')); }
const browser = await chromium.launch();
const page = await browser.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
await page.goto(process.argv[2]);
await page.waitForFunction('window.__done === true', null, { timeout: 300000 });
const r = await page.evaluate(() => window.__results);
for (const [k, v] of Object.entries(r)) console.log(k.padEnd(14), JSON.stringify(v));
console.log(errors.join('\n'));
await browser.close();

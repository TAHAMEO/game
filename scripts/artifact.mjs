#!/usr/bin/env node
/**
 * Wrap the artifact build (`vite build --mode artifact` → dist-artifact/) into the page that is
 * published on claude.ai: no <html>/<head>/<body> of its own (the host supplies them), the CSS
 * and the game's own code inlined, and three.js loaded from jsDelivr through an import map,
 * pinned to the exact version the game was built against.
 *
 *   npm run build:artifact                         → dist-artifact/the-quiet.page.html
 *   node scripts/artifact.mjs --local http://localhost:8899/
 *       → dist-artifact/the-quiet.local.html: the same page in a full document, with three.js
 *         from that server's node_modules (for testing where the CDN can't be reached)
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist-artifact');
const html = readFileSync(join(dist, 'index.html'), 'utf8');
const three = JSON.parse(readFileSync(join(root, 'node_modules/three/package.json'), 'utf8')).version;

const css = [...html.matchAll(/<link rel="stylesheet"[^>]*href="\.\/(assets\/[^"]+\.css)"[^>]*>/g)].map((m) => readFileSync(join(dist, m[1]), 'utf8'));
const jsMatch = html.match(/<script type="module"[^>]*src="\.\/(assets\/[^"]+\.js)"[^>]*><\/script>/);
if (!jsMatch) throw new Error('no module script in dist-artifact/index.html — run `vite build --mode artifact` first');
const js = readFileSync(join(dist, jsMatch[1]), 'utf8').replace(/<\/script/gi, '<\\/script');
if (/from\s*["']peerjs["']|new RTCPeerConnection/.test(js)) throw new Error('PeerJS ended up in the artifact build');
const fonts = [...html.matchAll(/<link rel="(?:stylesheet|preconnect)"[^>]*fonts\.(?:googleapis|gstatic)\.com[^>]*>/g)].map((m) => m[0]);
const body = (html.match(/<body>([\s\S]*?)<\/body>/)?.[1] ?? '').replace(/<script[\s\S]*?<\/script>/g, '').trim();
if (!body.includes('id="app"')) throw new Error('could not find the page markup');

const args = process.argv.slice(2);
const local = args[0] === '--local' ? (args[1] ?? 'http://localhost:8899/') : null;
const base = local ? `${local.replace(/\/$/, '')}/node_modules/three/` : `https://cdn.jsdelivr.net/npm/three@${three}/`;
const importMap = JSON.stringify({ imports: { three: `${base}build/three.module.js`, 'three/addons/': `${base}examples/jsm/` } });

const page = [
  '<title>The Quiet</title>',
  ...fonts,
  `<style>\n${css.join('\n')}\n</style>`,
  `<script type="importmap">${importMap}</script>`,
  body,
  `<script type="module">\n${js}\n</script>`,
].join('\n');

if (local) {
  const out = join(dist, 'the-quiet.local.html');
  writeFileSync(out, `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"></head><body>\n${page}\n</body></html>\n`);
  console.log(`wrote ${out} (three.js from ${base})`);
} else {
  const out = join(dist, 'the-quiet.page.html');
  writeFileSync(out, `${page}\n`);
  console.log(`wrote ${out} (${(Buffer.byteLength(page) / 1024).toFixed(0)} KB, three@${three} from jsDelivr)`);
}

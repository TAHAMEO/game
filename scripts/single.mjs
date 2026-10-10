#!/usr/bin/env node
/**
 * Bundle the built game into ONE self-contained HTML file (CSS and JS inlined), so it can
 * be shared as a single file and played by double-clicking it — no server needed.
 *
 *   npm run build:single            → dist/the-quiet.html
 *   node scripts/single.mjs --fragment out.html
 *       → the same page without the <!doctype>/<html>/<head>/<body> wrapper,
 *         for hosts that supply their own document skeleton.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist');
const html = readFileSync(join(dist, 'index.html'), 'utf8');

const css = [...html.matchAll(/<link rel="stylesheet"[^>]*href="\.\/(assets\/[^"]+\.css)"[^>]*>/g)].map((m) =>
  readFileSync(join(dist, m[1]), 'utf8'),
);
const jsMatch = html.match(/<script type="module"[^>]*src="\.\/(assets\/[^"]+\.js)"[^>]*><\/script>/);
if (!jsMatch) throw new Error('no module script found in dist/index.html — run `npm run build` first');
const js = readFileSync(join(dist, jsMatch[1]), 'utf8').replace(/<\/script/gi, '<\\/script');

const fonts = [...html.matchAll(/<link rel="(?:stylesheet|preconnect)"[^>]*fonts\.(?:googleapis|gstatic)\.com[^>]*>/g)].map((m) => m[0]);
const body = (html.match(/<body>([\s\S]*?)<\/body>/)?.[1] ?? '').replace(/<script[\s\S]*?<\/script>/g, '').trim();
if (!body.includes('id="app"')) throw new Error('could not find the page markup in dist/index.html');

const parts = {
  title: '<title>The Quiet</title>',
  fonts: fonts.join('\n'),
  style: `<style>\n${css.join('\n')}\n</style>`,
  body,
  script: `<script type="module">\n${js}\n</script>`,
};

const args = process.argv.slice(2);
if (args[0] === '--fragment') {
  const out = args[1] ?? join(dist, 'the-quiet.fragment.html');
  writeFileSync(out, [parts.title, parts.fonts, parts.style, parts.body, parts.script].join('\n'));
  console.log(`wrote ${out}`);
} else {
  const out = join(dist, 'the-quiet.html');
  writeFileSync(
    out,
    `<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8" />\n<meta name="viewport" content="width=device-width, initial-scale=1" />\n${parts.title}\n${parts.fonts}\n${parts.style}\n</head>\n<body>\n${parts.body}\n${parts.script}\n</body>\n</html>\n`,
  );
  console.log(`wrote ${out}`);
}

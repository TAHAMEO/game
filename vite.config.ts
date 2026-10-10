import { defineConfig } from 'vitest/config';

const env = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env ?? {};

/**
 * `vite build` — the game as a website (dist/), and with `build:single` one self-contained file.
 * `vite build --mode artifact` — the build published as a claude.ai page (dist-artifact/): three.js
 * loads from a CDN through an import map instead of being bundled, and PeerJS is left out (that
 * page cannot make WebRTC connections). `npm run build:artifact` wraps it into the page.
 */
export default defineConfig(({ mode }) => {
  const artifact = mode === 'artifact';
  return {
    base: './',
    define: { __ARTIFACT__: JSON.stringify(artifact) },
    resolve: artifact ? { alias: { peerjs: decodeURIComponent(new URL('./src/net/peer-stub.ts', import.meta.url).pathname) } } : {},
    build: {
      target: 'es2022',
      outDir: artifact ? 'dist-artifact' : 'dist',
      assetsInlineLimit: 0,
      // one bundle on purpose (three.js is most of it): `build:single` inlines it into one file
      chunkSizeWarningLimit: 1600,
      rollupOptions: artifact ? { external: [/^three(\/.*)?$/] } : {},
    },
    test: {
      include: env.CAMPAIGN ? ['tests/campaign.sim.ts'] : ['tests/**/*.test.ts'],
      environment: 'node',
      testTimeout: 30_000,
    },
  };
});

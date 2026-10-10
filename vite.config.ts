import { defineConfig } from 'vitest/config';

const env = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env ?? {};

export default defineConfig({
  base: './',
  build: {
    target: 'es2022',
    outDir: 'dist',
    assetsInlineLimit: 0,
  },
  test: {
    include: env.CAMPAIGN ? ['tests/campaign.sim.ts'] : ['tests/**/*.test.ts'],
    environment: 'node',
    testTimeout: 30_000,
  },
});

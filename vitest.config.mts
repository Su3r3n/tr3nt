import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.spec.ts'],
    // PGlite boots a WASM Postgres per suite; the first boot is the slow one.
    testTimeout: 60_000,
    hookTimeout: 60_000,
    pool: 'forks',
  },
});

import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts', 'src/testing/**', 'src/index.ts'],
      reporter: ['text', 'lcov'],
    },
  },
  resolve: {
    alias: {
      // Test against the package source so a stale `dist` cannot mask a failure.
      '@badminton/contracts': new URL('../contracts/src/index.ts', import.meta.url).pathname,
    },
  },
});

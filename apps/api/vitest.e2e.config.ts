import { defineConfig } from 'vitest/config';
import swc from 'unplugin-swc';

/**
 * Integration tests: boot the real application against a real PostgreSQL database.
 *
 * Runs serially in a single process because the tests truncate shared tables between
 * files — parallel workers would delete each other's fixtures mid-assertion.
 */
export default defineConfig({
  plugins: [swc.vite({ module: { type: 'es6' } })],
  test: {
    globals: false,
    environment: 'node',
    include: ['test/**/*.e2e.test.ts'],
    globalSetup: ['test/global-setup.ts'],
    setupFiles: ['test/setup.ts'],
    fileParallelism: false,
    testTimeout: 60_000,
    hookTimeout: 120_000,
  },
});

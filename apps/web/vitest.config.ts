import { defineConfig } from 'vitest/config';

/**
 * Unit tests for client-side logic.
 *
 * The Playwright specs in `e2e/` are excluded: they need a running browser, a running
 * API and a database, and are run by `npm run test:e2e` instead.
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    exclude: ['e2e/**', 'node_modules/**', '.next/**'],
  },
});

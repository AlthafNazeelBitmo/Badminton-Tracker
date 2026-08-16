import { defineConfig } from 'vitest/config';
import swc from 'unplugin-swc';

/** Unit tests: pure logic, no database, no Nest container. See vitest.e2e.config.ts. */
export default defineConfig({
  plugins: [
    // Nest's decorators need SWC's legacy decorator + metadata transform.
    swc.vite({ module: { type: 'es6' } }),
  ],
  test: {
    globals: false,
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});

import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@pharmacy/config': fileURLToPath(new URL('./packages/config/src/index.ts', import.meta.url)),
      '@pharmacy/database': fileURLToPath(
        new URL('./packages/database/src/index.ts', import.meta.url),
      ),
      '@pharmacy/shared': fileURLToPath(new URL('./packages/shared/src/index.ts', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
    exclude: ['**/dist/**', '**/node_modules/**'],
    fileParallelism: false,
    globalSetup: ['./tests/integration/global-setup.ts'],
    hookTimeout: 120_000,
    include: ['tests/integration/**/*.integration.test.ts'],
    maxWorkers: 1,
    testTimeout: 60_000,
  },
});

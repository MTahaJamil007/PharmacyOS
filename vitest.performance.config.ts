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
    fileParallelism: false,
    globalSetup: ['./tests/integration/global-setup.ts'],
    hookTimeout: 180_000,
    include: ['tests/performance/**/*.performance.test.ts'],
    maxWorkers: 1,
    testTimeout: 180_000,
  },
});

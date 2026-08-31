import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vitest/config';

const repositoryRoot = dirname(fileURLToPath(import.meta.url));
const isIntegrationRun = resolve(process.cwd()) === repositoryRoot;

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
  test: isIntegrationRun
    ? {
        environment: 'node',
        exclude: ['**/dist/**', '**/node_modules/**'],
        fileParallelism: false,
        globalSetup: ['./tests/integration/global-setup.ts'],
        hookTimeout: 120_000,
        include: ['tests/integration/**/*.integration.test.ts'],
        maxWorkers: 1,
        testTimeout: 60_000,
      }
    : {
        environment: 'node',
        exclude: ['**/dist/**', '**/node_modules/**'],
        include: ['src/**/*.{test,spec}.?(c|m)[jt]s?(x)'],
      },
});

import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['apps/api/test/**/*.test.ts', 'packages/*/test/**/*.test.ts'],
    setupFiles: ['apps/api/test/setup-env.ts'],
    globalSetup: ['apps/api/test/global-setup.ts'],
    fileParallelism: false, // integration tests share one test database
    testTimeout: 20000,
    hookTimeout: 30000,
  },
});

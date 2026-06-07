import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    alias: {
      'bun:sqlite': resolve(__dirname, '__mocks__/bun-sqlite.ts'),
    },
    include: ['tests/scheduler.test.ts'],
    testTimeout: 15000,
  },
});
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.mjs'],
    testTimeout: 180000,
    hookTimeout: 180000,
    fileParallelism: false,
  },
});

import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    setupFiles: ['./src/test-utils/vitest.setup.ts'],
    include: ['src/**/*.test.ts']
  }
});

import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    // Phase 1 covers pure domain logic only. No DOM environment is required yet.
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});

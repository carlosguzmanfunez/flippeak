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
    // Applies the integration-database guard (Patch A3) inside every test file's
    // environment, before the test module — and therefore before the database
    // client — is reached. A no-op unless a RUN_* integration flag is set.
    setupFiles: ['./src/test/integration-guard.setup.ts'],
  },
});

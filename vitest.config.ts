import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    // Mirror tsconfig "@/*" -> "./*"
    alias: { '@': fileURLToPath(new URL('.', import.meta.url)) },
  },
  test: {
    // Unit tests (pure, no DB). CR-4 adds integration projects with Testcontainers.
    include: ['test/unit/**/*.test.ts'],
    environment: 'node',
  },
});

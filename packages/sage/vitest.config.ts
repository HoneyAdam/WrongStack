import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    // Use the root setup for hermetic ~/.wrongstack (WRONGSTACK_HOME to temp dir)
    // and the SQLite ExperimentalWarning suppressor.
    setupFiles: ['../../vitest.setup.ts'],
  },
});

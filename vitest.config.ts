import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: false,
    environment: 'node',
    include: ['packages/**/tests/**/*.test.ts'],
    exclude: ['**/node_modules/**', '**/dist/**'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: ['packages/*/src/**/*.ts'],
      exclude: [
        '**/*.test.ts',
        '**/*.bench.ts',
        '**/tests/**',
        '**/dist/**',
        'packages/*/src/index.ts',
        '**/types/**',
        // Test helpers — only exist to support tests, not production code
        'packages/*/src/test-helpers/**',
        // CLI entry points — require interactive TTY, not testable in unit context
        'packages/cli/src/input-reader.ts',
        'packages/cli/src/repl.ts',
        'packages/cli/src/spinner.ts',
        // React/ink browser components — require DOM/ink-testing-library
        'packages/tui/src/app.tsx',
        'packages/tui/src/components/file-picker.tsx',
        'packages/tui/src/components/input.tsx',
        'packages/tui/src/components/slash-menu.tsx',
        'packages/tui/src/components/confirm-prompt.tsx',
        'packages/tui/src/components/model-picker.tsx',
        'packages/tui/src/components/status-bar.tsx',
        'packages/tui/src/components/history.tsx',
        // TUI entry/runtime — Ink render-tree wiring, exercised end-to-end
        'packages/tui/src/run-tui.ts',
        // Clipboard — depends on OS-level pasteboards (xsel/pbcopy/clip.exe)
        'packages/tui/src/clipboard.ts',
      ],
      // Current progress floor — locked at one point below today's measurement
      // to absorb noise without masking real regressions. Target remains 100/100/90/100;
      // raise these as more files are covered.
      thresholds: {
        lines: 85,
        functions: 85,
        branches: 70,
        statements: 82,
      },
    },
  },
});

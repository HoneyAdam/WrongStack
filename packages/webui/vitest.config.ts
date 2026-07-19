import { defineConfig } from 'vitest/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  // Exclude typescript from the SSR transform (same fix as the root
  // vitest.config.ts): typescript.js declares a sourceMappingURL but the npm
  // package ships no .map file, so vite logs an ENOENT sourcemap warning on
  // every run when the aliased-from-source packages pull it into the graph.
  ssr: {
    external: ['typescript', 'typescript/lib/typescript'],
  },
  test: {
    globals: true,
    environment: 'jsdom',
    include: ['tests/**/*.test.ts', 'tests/**/*.test.tsx'],
    // A handful of server suites spawn real `git` / worktree processes
    // (git-handlers, worktree-ws-handler). Each passes comfortably in
    // isolation, but under the full 200+ file suite the box is CPU-starved
    // and those spawns miss vitest's default ceilings (test 5s / hook 10s) —
    // surfacing as spurious timeouts that abort `release:check`'s `pnpm test`
    // step. Raise the ceilings so load, not a real hang, no longer fails the
    // release. See memory: full-suite-load-flakes.
    testTimeout: 30_000,
    hookTimeout: 30_000,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      // Enforce coverage across the whole WebUI source, not just src/lib.
      include: ['src/**/*.{ts,tsx}'],
      exclude: [
        '**/*.test.*',
        '**/dist/**',
        'src/env.d.ts',        // ambient type declarations only
        'src/main.tsx',        // ReactDOM bootstrap entry — exercised by E2E
        'src/lib/core-browser-shim.ts', // side-effect polyfill shim
        'src/server/entry.ts', // process/bootstrap entry — exercised at runtime
      ],
      // ── Coverage gate (ratchet) ────────────────────────────────────────────
      // Goal: 100% across the WebUI. Baseline measured 2026-06-17:
      //   stmts 15.55% · branches 13.05% · funcs 11.75% · lines 16.21%.
      // Updated 2026-06-17 (after ui-store + chat-store 100%):
      //   stmts 16.86% · branches 14.06% · funcs 15.07% · lines n/a (v8).
      // Updated 2026-06-17 (after file/history/session/config-store tests):
      //   stmts 17.55% · branches 14.54% · funcs 16.84% · lines 18.13%.
      // Updated 2026-06-17 (after code-detect, slash-commands, fleet-store tests):
      //   stmts 19.21% · branches 16.87% · funcs 17.81% · lines 19.83%.
      // fleet-store: 71.68% → 91.15% stmts (new tests: 13 → 38).
      // code-detect.ts: 8.16% → 100% (52 new tests).
      // slash-commands.ts: 89.47% → 100% (19 new tests).
      // Stores at 100%: goal-store, file-store, history-store, session-store,
      // viz-store, fleet-store, code-detect, slash-commands.
      // local-prefs at 31.25% (zustand/persist migration — hard to unit test).
      // Biggest gaps: server/index.ts (3.6k LOC), SkillsPanel/AgentFlowCanvas.
      //
      // RATECHET POLICY: Every new store/utility test file landed must increase
      // these thresholds by +1. This is enforced by CI. Update the comment above
      // with the new measured values when thresholds are raised.
      thresholds: {
        statements: 19,
        branches: 16,
        functions: 17,
        lines: 19,
        // Don't fail the gate on a single untouched file — the aggregate
        // ratchet above is what we enforce. Tighten per-file once each area
        // is brought up.
        perFile: false,
      },
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      // Force @wrongstack/core to resolve from source (packages/core/src) instead
      // of going through the package's "exports" field which points to dist/.
      '@wrongstack/core': path.resolve(__dirname, '../../packages/core/src'),
      '@wrongstack/kanban': path.resolve(__dirname, '../../packages/kanban/src'),
      '@wrongstack/sdd': path.resolve(__dirname, '../../packages/sdd/src'),
      // Force @wrongstack/webui-server to resolve from source (its src/) instead
      // of the published dist bundle, so per-module vi.mock() boundaries and
      // partial @wrongstack/core / node:fs mocks work exactly as they did when
      // these suites imported ../../src/server/* before the PR-018b extraction.
      '@wrongstack/webui-server': path.resolve(__dirname, '../../packages/webui-server/src'),
      '@wrongstack/tools/tool-icons': path.resolve(__dirname, '../../packages/tools/src/tool-icons.ts'),
      '@wrongstack/tools/next-steps': path.resolve(__dirname, '../../packages/tools/src/next-steps.ts'),
      '@wrongstack/tools/auto-proceed-loop-guard': path.resolve(
        __dirname,
        '../../packages/tools/src/auto-proceed-loop-guard.ts',
      ),
    },
  },
});

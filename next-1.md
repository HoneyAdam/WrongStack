# Next Steps — WrongStack Improvement Plan

> Priority-ordered list of improvements identified during the 2026-06-30 code review.

---

## Priority 1 — Quick Wins (1-2 hours each)

### 1.1 Fix Remaining Tool-Format Test Assertions
**Files:** `packages/tui/tests/tool-format.test.ts`

The `formatToolOutput` function has inconsistent formatting behavior:
- `exec` safe mode → generic JSON formatter → outputs `exit_code=0`
- `exec` destructive/caution mode → special handler → outputs `exit 0`
- `bash` → special handler → outputs `exit 0`

**Action:** Update test assertions to match actual output format, or standardize the format across all command tools.

### 1.2 Fix `@wrongstack/tools/codebase-index` Import Error
**File:** `packages/plugins/src/file-watcher/index.ts:176`

```
Cannot find module '@wrongstack/tools/codebase-index/index.js'
```

**Action:** Add proper export or subpath export in `packages/tools/package.json`, or remove the unused import.

---

## Priority 2 — Technical Debt (Half-day each)

### 2.1 Split `cli-main.ts` (3,118 lines)
**File:** `packages/cli/src/cli-main.ts`

This file handles:
- argv parsing
- boot sequence orchestration
- REPL/TUI/WebUI dispatch
- MCP server management
- Signal handlers
- Global exception handling

**Suggested splits:**
```
boot/                      — boot.ts, container-wiring.ts, etc. (already partially done)
cli-main.ts               — main() dispatcher only (~100 lines)
cli-repl.ts               — REPL mode handler
cli-eternal.ts            — Eternal/autonomy mode
cli-subcommands.ts        — subcommand dispatch
```

### 2.2 Split `webui-server.ts` (2,498 lines)
**File:** `packages/cli/src/webui-server.ts`

This file handles:
- Express server setup
- All HTTP/WebSocket routes
- WebUI + TUI + CLI integration
- Collaboration features

**Suggested splits:**
```
webui-server/
  server.ts                — Express app + middleware
  routes/
    sessions.ts            — Session CRUD
    projects.ts            — Project management
    auth.ts                — Authentication
    mcp.ts                 — MCP endpoints
    brain.ts                — Brain/decision routes
  ws-handlers/
    terminal.ts            — Terminal WebSocket
    collaboration.ts       — Collab WebSocket
    fleet.ts              — Fleet coordination
```

### 2.3 TUI App Refactor
**File:** `packages/tui/src/app.tsx` (6,749 lines)

Already has a plan at `docs/issues/2026-06-13-tui-app-refactor.md` — 8-PR plan to split into focused hooks.

**Action:** Start executing the plan.

---

## Priority 3 — Architecture Improvements (1+ day each)

### 3.1 Add GitHub Actions CI/CD
Currently no CI pipeline exists. Add:
- **PR checks:** typecheck + test + lint
- **Main branch:** build + publish
- **E2E tests:** Playwright on every PR

### 3.2 TypeDoc Documentation
No public API documentation exists. Add:
```bash
pnpm add -D @typespec/compiler typedoc
```

Generate docs for `@wrongstack/core` and `@wrongstack/tools` public APIs.

### 3.3 Bundle Size Optimization
`webui` package is 1.45 MB. Consider:
- Code splitting: separate `@wrongstack/webui-server` bundle
- Tree shaking improvements
- Lazy loading for heavy components

### 3.4 Auto-Doc Plugin Improvements
**File:** `packages/plugins/src/auto-doc/index.ts`

The auto-doc plugin generates placeholder TODOs:
```typescript
@param ${p} - TODO: describe parameter
```

**Options:**
1. Use more neutral placeholders: `@param ${p}`
2. Add AI-powered description generation (optional, gated)
3. Skip @param/@returns generation entirely

---

## Priority 4 — Known Issues (Require Investigation)

### 4.1 75 Test Files Failing
After build completes, 75 test files fail with import errors like:
```
Cannot find package '@wrongstack/tools/bash'
```

This suggests either:
- Missing subpath exports in `package.json`
- Stale dist/ files not being rebuilt
- Circular dependency issues

**Action:** Investigate the package exports map and ensure all test imports resolve.

### 4.2 E2E Test Snapshot Updates
Running `pnpm biome format --write` modified 2585 files including e2e test snapshots. This suggests tests may have been passing with stale/incorrect snapshots.

**Action:** Run full e2e suite, update snapshots as needed, add snapshot validation.

---

## Quick Reference

| Command | Purpose |
|---------|---------|
| `pnpm run typecheck` | TypeScript check all packages |
| `pnpm run build` | Build all packages (topological order) |
| `pnpm test` | Run all unit tests |
| `pnpm run lint` | Lint with Biome |
| `pnpm biome migrate --write` | Update Biome config |
| `pnpm run release:check` | Full pre-release gate |

---

## Commit History (2026-06-30)

| Commit | Description |
|--------|-------------|
| `095f6fbb` | fix: update biome schema, fix useless ternary, update tool-format tests |

---

*Last updated: 2026-06-30*

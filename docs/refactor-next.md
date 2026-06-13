# webui-server Refactor — Remaining Work (PRs 5, 7, 8)

This file captures the unfinished PRs from Issue #30 (webui-server 8-PR refactor)
and any follow-up tasks from completed PRs. Use it as a checkpoint before
switching context, handing off, or resuming later.

## Completed status

| PR | Module | Status | PR # |
|----|--------|--------|------|
| 0  | Baseline integration test | ✅ merged | #53 |
| 1  | logger-shim.ts | ✅ merged | #50 |
| 2  | cost-helpers.ts | ✅ merged | #51 |
| 3  | context-breakdown.ts | ✅ merged | #52 |
| 4  | provider-config.ts | ✅ merged | #55 |
| 5  | ws-handlers/ directory | 🔴 **NOT STARTED** | — |
| 6  | static-serve.ts | ✅ committed, **PR NOT OPENED** | — |
| 7  | lifecycle.ts | 🔴 **NOT STARTED** | — |
| 8  | Final pass | 🔴 **NOT STARTED** | — |

## PR 6 — static-serve.ts (committed, needs PR)

Branch: `refactor/webui-server-static-serve`
Commit: `ab245dc4`

**What it does:** extracts the `createRequire` + `distDir` resolution + `createHttpServer` call
into `webui-server/static-serve.ts` with a `startStaticServe()` function. Three other
cleanups: removed unused `createRequire` and `createHttpServer` imports from
`webui-server.ts`, and fixed two `httpServer.close()` → `httpServer.server.close()` call sites
because the variable type changed from `Server | null` to `StaticServeHandle | null`.

**Missing:**
- [ ] Unit tests for `startStaticServe`
- [ ] Open the PR (title: `refactor(cli): extract static-serve to webui-server/static-serve (PR 6 of #30)`)
- [ ] Squash-merge

---

## PR 5 — ws-handlers/ directory (🔥 HIGH PRIORITY)

This is the **core extraction**. The 25+ inline `handleXxx` WebSocket handlers
(in the ~500-line block after the provider-config helpers) move into
`packages/cli/src/webui-server/ws-handlers/<topic>.ts`, grouped by topic:

```
webui-server/ws-handlers/
  providers.ts      — handleProviderAdd, handleProviderKeyAdd, … (~400 lines)
  sessions.ts       — handleSessionList, handleSessionGet, …      (~300 lines)
  mailbox.ts        — handleMailboxSend, handleMailboxRead, …      (~200 lines)
  worktree.ts       — handleWorktreeList, handleWorktreeCreate, …  (~200 lines)
  memory.ts         — handleMemoryList, handleMemoryRemember, …    (~200 lines)
  index.ts          — barrel: `registerAllHandlers(wsServer, ctx)` (~50 lines)
```

**Risk:** HIGH. The handlers share closure-captured state (`providers`, `vault`,
`wpaths`, `eventBridge`, `broadcast`). A `WsHandlerContext` interface must be
created to thread all shared state explicitly — no closure captures allowed.

**Strategy:**
1. Define `WsHandlerContext` interface in `index.ts` with all shared dependencies
2. Extract one file at a time: `providers.ts` first (largest), then sessions, mailbox, etc.
3. Each handler file exports a `register*` function that takes `(wss, ctx)`
4. `registerAllHandlers(wss, ctx)` calls each register function
5. After all files extract, `webui-server.ts` just calls `registerAllHandlers`

**Blockers:** None. All preceding PRs cleaned up the imports/helpers this depends on.

---

## PR 7 — lifecycle.ts (low risk)

Extract ~100 lines of SIGINT/SIGTERM shutdown handling, instance registry
`register`/`unregister`, and the `openBrowser` orchestration into
`webui-server/lifecycle.ts`.

After this PR, `webui-server.ts` contains only the top-level `runWebUI` body:
boot static serve, boot WS server, register handlers, wait for shutdown signal.

**What moves:**
- The `process.on('SIGINT')` / `process.on('SIGTERM')` handlers (~30 lines)
- `registerInstance(process.pid, …)` call and the `unregistered` promise chain (~20 lines)
- The `openBrowser(openUrl)` call with guard (~10 lines)
- The shutdown `console.warn` / cleanup comment (~10 lines)

**Dependency:** wait for PR 6 to merge (the `httpServer` variable changes from
`Server | null` to `StaticServeHandle | null`).

---

## PR 8 — Final pass (low risk)

`webui-server.ts` should be < 200 lines after PRs 1–7: just the `runWebUI()`
function, its re-exports of the public API, and a doc comment pointing to the
seven `webui-server/*.ts` modules so contributors know where each concern lives.

The `Logger` re-export keeps its public surface; the cost/token helpers and the
WS handlers stop being importable directly from this file.

---

## Follow-up tasks from completed PRs

### PR 4 follow-up: ProviderConfigStore interface

The plan body envisioned a `ProviderConfigStore` interface to dedupe the two
import paths (`./provider-config-utils.js` for `writeKeysBack`/`normalizeKeys`,
and `./webui-server/provider-config.js` for `getVault`/`loadSavedProviders`/
`saveProviders`). Currently both paths exist. A single facade would simplify
callers and prevent silent drift.

### PR 6 follow-up: unit tests

`startStaticServe` has no unit tests. The function is small but involves
`createRequire` resolution which is hard to test without a real module tree.
Consider an integration test or a `resolveDistDir` helper extracted from
`startStaticServe` that can be unit-tested with a mock module tree.

---

## git state

Current branch: main
Unmerged branch: `refactor/webui-server-static-serve` (PR 6, needs PR+merge)
PR 5 and 7 branches not yet created.

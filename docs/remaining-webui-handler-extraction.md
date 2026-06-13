# WebUI Server Handler Extraction — COMPLETE

**Generated:** 2026-06-13
**Completed:** 2026-06-13
**Branch:** `refactor/webui-ws-handlers-prefs-clean`
**Source:** `docs/REMAINING-WORK.md` (P1 section)

---

## Status: DONE

All inline `handleMessage` handlers that carry real logic have been extracted into
focused modules under `packages/cli/src/webui-server/ws-handlers/`.
`webui-server.ts` shrank from **2,639 → 2,132 lines**.

### Extracted in this pass (2026-06-13)

| File | Handlers | Tests |
|---|---|---|
| `shutdown.ts` | `handleWebuiShutdown` | `ws-handlers-shutdown.test.ts` (2) |
| `collab.ts` | `handleCollabNoop` | `ws-handlers-collab.test.ts` (1) |
| `working-dir.ts` | `handleWorkingDirSet` | `ws-handlers-working-dir.test.ts` (4) |
| `mailbox.ts` | `handleMailboxMessages`, `handleMailboxAgents`, `handleMailboxClear` | `ws-handlers-mailbox.test.ts` (7) |
| `projects.ts` | `handleProjectsList`, `handleProjectsAdd`, `handleProjectsSelect` | `ws-handlers-projects.test.ts` (7) |
| `session.ts` | `handleSessionsList`, `handleSessionNew`, `handleSessionDelete`, `handleSessionSave`, `handleSessionResume`, `handleSessionCheckpoints`, `handleSessionRewind` | `ws-handlers-session.test.ts` (11) |
| `context.ts` | `handleContextClear`, `handleContextDebug`, `handleContextCompact`, `handleContextRepair`, `handleContextModesList`, `handleContextModeSwitch`, `handleContextModeCreate`, `handleContextModeUpdate`, `handleContextModeDelete` | `ws-handlers-context.test.ts` (10) |

**42 new unit tests, all passing.** Full webui-server suite (27 files / 159 tests)
green, including the integration tests that exercise the wired server.

---

## Design decisions that held up

1. **No closure captures.** Every handler group has its own `*Context` interface
   extending `WsCommon`. Dependencies are explicit fields, never captured.

2. **Re-rooting on project switch.** State reassigned by `projects.select`
   (`opts.sessionStore`, `opts.projectRoot`) is read **at call time**, not captured:
   - `session.*` → a per-call `makeSessionCtx()` factory in `runWebUI`.
   - `mailbox.*` / `projects.*` → context objects built inline in each `case`
     (mirroring `goal.get`), with `mailboxProjectRoot()` / `mailboxGlobalRoot()`
     helpers reading `opts` fresh.
   - `context.*` → a single `contextOpsCtx` (its `agentCtx` reference is stable;
     the underlying object is mutated in place across a switch).

3. **Host-owned seams as callbacks.** The mutation-heavy, host-specific pieces are
   injected rather than reimplemented in the handler:
   - `projects.select`: `abortActiveRun`, `setProjectRoot`, `setSessionStore`,
     `rebuildSystemPrompt` (wraps `DefaultSystemPromptBuilder` + memory/skill/mode
     stores), `buildSessionStart`.
   - `session.*`: `onSessionSwapped`, `buildSessionStart`; the rewinder
     (`DefaultSessionRewinder`) and fallback store (`DefaultSessionStore`) are
     constructed inside the handlers as before.
   - `context.*`: `resolveCompactor` (wraps `container.resolve(TOKENS.Compactor)`),
     `getModeStore` (the lazy `getCustomModeStore` closure), `listTools`,
     `buildSessionStart`.

---

## Intentionally left inline

- **`shell.open`** — already a single delegation to the shared `handleShellOpen`
  (`@wrongstack/webui/server`); wrapping it in its own context/module adds no
  testable surface. The shared handler already owns the metacharacter guard and
  cross-platform spawn chain.
- **Core loop wiring** — `user_message`, `abort`, `ping`, `tool.confirm_result`
  are part of the run/abort lifecycle, not topic handlers.
- **File / memory delegations** — `files.*` and `memory.*` already delegate to the
  shared `file-handlers.ts` / `memory-handlers.ts` modules.
- **`webui.shutdown`** is extracted, but the `shutdown()` closure itself stays in
  `runWebUI` (it closes the HTTP server and fires `opts.onExit`).

---

## Remaining (optional follow-up, not blocking)

- **PR 8 — final pass:** the `handleMessage` switch is now almost entirely
  one-liner delegations. A future pass could collapse it into a dispatch table
  (`Record<msgType, handler>`), but the explicit `switch` remains readable and is
  not a priority.
- **P1-5 — `ProviderConfigStore` facade** (dedup two import paths) is tracked
  separately in `REMAINING-WORK.md`.

---

## END OF FILE

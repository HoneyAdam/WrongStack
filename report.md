# WrongStack Monorepo — Source Code Audit Report

**Date:** 2026-06-06
**Scope:** 14 packages, ~250 source files (sampled: 24 files with deep read, 40+ via pattern grep)
**Previous audit:** 2026-05-30 → 2026-06-05 (refactor-2026-06-05.md, security-hardening-2026-06.md)
**Overall posture:** **Strong** — Zero critical security vulnerabilities, zero critical bugs. Primarily code quality and architectural improvement opportunities.

---

## Executive Summary

The WrongStack codebase demonstrates **mature security discipline**. The adversarial-LLM threat model articulated in `SECURITY.md` is implemented consistently: SSRF-guarded HTTP fetching with DNS-rebinding protection at every redirect hop, AES-256-GCM secret encryption at rest, multi-layer shell hardening (exec allowlist + regex blocklist + cwd sandbox, bash process-group kill + timeout), and a comprehensive secret-scrubbing pipeline (16 pattern types) applied at tool input/output boundaries.

The primary concern is **growth rate**: the codebase grew from 3 files >1000 lines on May 30 to 14 files >1000 lines on June 5 (+367%). The largest file — `packages/tui/src/app.tsx` at 6,408 lines — is a 4,409-line React component with a 1,020-line reducer. The project is aware (refactor-2026-06-05.md) and actively decomposing.

All 5 critical bugs + 6 security issues from the May 30 audit are resolved. The findings below are **new observations** from the June 6 scan, none blocking.

---

## Findings Summary

| Severity | Security | Bug | Code Quality | Architecture | Performance | Total |
|----------|----------|-----|-------------|-------------|------------|-------|
| HIGH     | 0        | 0   | 3           | 1           | 0          | **4** |
| MEDIUM   | 1        | 1   | 5           | 0           | 0          | **7** |
| LOW      | 2        | 3   | 4           | 0           | 2          | **11** |
| **Total**| **3**    | **4**| **12**      | **1**       | **2**      | **22** |

---

## Files Deep-Read for This Audit

| File | Lines | Security | Bug | Quality |
|------|-------|----------|-----|---------|
| `packages/tools/src/bash.ts` | 346 | ⚠️ SHELL env var | ⚠️ handler race | ⚠️ cap, manual iterator |
| `packages/tools/src/exec.ts` | 330 | — | — | ⚠️ cap constant, pattern list |
| `packages/tools/src/fetch.ts` | 499 | ⚠️ dead code | — | ⚠️ regex HTML parser |
| `packages/tools/src/write.ts` | 101 | — | — | — |
| `packages/tools/src/edit.ts` | ~200 | — | — | — |
| `packages/core/src/security/secret-vault.ts` | 317 | — | — | ⚠️ sync IO, console.warn |
| `packages/core/src/security/secret-scrubber.ts` | 128 | ✅ strong | — | — |
| `packages/core/src/security/yolo-risk.ts` | 113 | ✅ strong | — | — |
| `packages/cli/src/auth-menu.ts` | 851 | — | — | 🔴 DRY violation |
| `packages/cli/src/webui-server.ts` | 991 | — | — | 🔴 god file, DRY |
| `packages/telegram/src/bot.ts` | 376 | ⚠️ token redaction | — | ⚠️ sleep utility |
| `packages/core/src/core/streaming-response-builder.ts` | 317 | — | ⚠️ crypto import | ⚠️ no-op function |
| `packages/core/src/core/agent.ts` | 190 | — | — | — |
| `packages/core/src/core/agent-loop.ts` | 313 | — | ⚠️ silent error | — |
| `packages/core/src/core/provider-runner.ts` | 104 | ✅ retry/abort | — | — |
| `packages/core/src/coordination/director.ts` | ~400 | — | — | — |
| `packages/providers/src/anthropic.ts` | ~250 | ✅ header auth | — | — |
| `packages/providers/src/sse.ts` | 139 | — | — | ✅ O(n²) fix |
| `packages/cli/src/boot.ts` | ~300 | — | — | — |
| `packages/cli/src/mcp-serve.ts` | ~200 | ✅ yolo/restricted mode | — | — |
| `packages/core/src/execution/autonomous-runner.ts` | ~170 | — | — | — |

---

## 🛡️ Security Findings

---

### SEC-1 ⚠️ MEDIUM — `SHELL` / `COMSPEC` Env Var as Shell Binary Source

**File:** `packages/tools/src/bash.ts:109-110`
**Category:** Injection (CWE-78 adjacent)

**The code:**
```typescript
const shell = isWin
  ? (process.env['COMSPEC'] ?? 'cmd.exe')
  : (process.env['SHELL'] ?? '/bin/bash');
```

**Why it's a problem:**
`SHELL` and `COMSPEC` are user-controllable environment variables. An attacker who can set these before the process starts can redirect bash execution to an arbitrary binary. The `bash` tool already runs with the user's full privileges, but which binary it invokes should not be silently determined by the environment without documentation. This is not an injection vector through the model (the model doesn't control env vars), but it matters for defense-in-depth on shared systems.

**Remediation:**
1. Add a `WRONGSTACK_SHELL` / `WRONGSTACK_COMSPEC` override for explicit user configuration.
2. Fall back to an allowlist: `/bin/bash`, `/bin/zsh`, `/bin/sh` (POSIX); `cmd.exe`, `powershell.exe` (Windows).
3. At minimum, document this behavior in the `usageHint` and `SECURITY.md`.

**Estimated effort:** 15 minutes

---

### SEC-2 ⬇️ LOW — Dead Code: Pre-Node 22 Fallback in `combineSignals`

**File:** `packages/tools/src/fetch.ts:412-443`
**Category:** Configuration / Maintenance

**The code:**
```typescript
function combineSignals(...sigs: AbortSignal[]): AbortSignal {
  const anyFn = (AbortSignal as unknown as { any?: (...) }).any;
  if (typeof anyFn === 'function') {
    return anyFn(sigs);
  }
  // Fallback for older runtimes... (~25 lines of manual signal combining)
}
```

**Why it's a problem:**
The project requires Node.js >= 22 (`package.json` line 9). `AbortSignal.any()` shipped in Node 20. The fallback path will never execute, yet it adds 25 lines of complexity. Dead code is a maintenance burden — future readers may assume it is active, and changes to the active path may not be mirrored in the fallback.

**Remediation:**
Remove the fallback entirely. Replace `combineSignals` with a direct call to `AbortSignal.any(sigs)`. This is a ~25 line deletion.

**Estimated effort:** 5 minutes

---

### SEC-3 ⬇️ LOW — Telegram Bot Token Redaction Helper Defined but Not Used

**File:** `packages/telegram/src/bot.ts:6-9`
**Category:** Information Disclosure / Telemetry

**The code:**
```typescript
// If logging URLs that contain the bot token in the future, use:
// function redactToken(url: string, token: string): string {
//   return url.replace(token, '[REDACTED]');
// }
```
Token is embedded in URLs: `this.baseUrl = \`https://api.telegram.org/bot${opts.token}\`` (line 110).

**Why it's a problem:**
The bot token currently travels safely — `this.log.debug()` calls only log message lengths, not URLs. However, the redaction helper exists only as a comment. If a future developer adds a `log.warn()` or `log.error()` call that includes the base URL (for debugging), the token will leak to logs. The `processMessage` method (line 289) already logs chatIds but not the token itself.

**Remediation:**
Activate the `redactToken` helper. Store a redacted variant of `baseUrl` as an instance property and use it in all log calls. Remove the comment and make it real code.

**Estimated effort:** 10 minutes

---

## 🐛 Bug Findings

---

### BUG-1 ⚠️ MEDIUM — Implicit `crypto` Global Without Import

**File:** `packages/core/src/core/streaming-response-builder.ts:97`
**Category:** Type Safety / Static Analysis

**The code:**
```typescript
const id = ev.id ?? crypto.randomUUID();  // line 97
```
No `import * as crypto from 'node:crypto'` at the top of the file.

**Why it's a problem:**
Node.js 22+ makes `crypto` a global, so this runs correctly at runtime. However, the lack of an explicit import:
1. Breaks static analysis tools (TypeScript strict mode, eslint-plugin-import) that expect declared dependencies.
2. Makes the dependency opaque to code readers — there is no indication at the top of the file that `crypto` is used.
3. If the project ever drops the global `crypto` (unlikely but possible), this becomes a runtime error.

**Remediation:**
Add `import * as crypto from 'node:crypto'` at the top of the file. Since the project uses ESM, `import { randomUUID } from 'node:crypto'` is also acceptable and more precise.

**Estimated effort:** 2 minutes

---

### BUG-2 ⬇️ LOW — TOCTOU-Like Event Handler Race in `bash.ts` Background Mode

**File:** `packages/tools/src/bash.ts:130-147`
**Category:** Async / EventEmitter

**The code (simplified):**
```typescript
const child = spawn(shell, args, { detached: true, ... });  // line 130
const pid = child.pid;
if (typeof pid === 'number') {
  registry.register({ pid, child, ... });
  child.on('close', () => registry.unregister(pid));  // line 147
}
```

**Why it's a problem:**
There is a theoretical race where the spawned process starts and exits before line 147 registers the `close` handler. If the process exits between `spawn()` (line 130) and `.on('close', ...)` (line 147), the `close` event fires with no listener present, and `registry.unregister()` is never called. The `registry.register()` call at line 139 succeeds, but the unregister never happens.

In practice this is extremely unlikely — `spawn()` is async and the Node.js event loop won't deliver the `close` event until after the current synchronous block completes. However, it is a classic Node.js anti-pattern and worth fixing for correctness.

**Remediation:**
Move the `child.on('close', ...)` registration immediately after `registry.register()`, before any other synchronous code. Ideally, register the handler on the same tick where `spawn()` creates the child.

**Estimated effort:** 10 minutes

---

### BUG-3 ⬇️ LOW — Session Write Errors Silently Swallowed in Agent Loop

**File:** `packages/core/src/core/agent-loop.ts:161-165` and `302-308`
**Category:** Error Handling

**The code:**
```typescript
await a.ctx.session
  .writeInFlightMarker(`iteration ${i} / max ${a.maxIterations}`)
  .catch((err) => {
    a.logger.debug?.(
      `in-flight marker write failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  });
```
The same pattern repeats for `clearInFlightMarker` in the `finally` block.

**Why it's a problem:**
The optional chaining `a.logger.debug?.()` silently does nothing if `a.logger` does not implement a `debug` method. The `Logger` interface requires `info`, `warn`, and `error` — `debug` is optional. On loggers without `debug`, a session write failure produces zero output: no log, no warning, no error event. The agent loop continues as if nothing happened.

This is defense-in-depth — the in-flight marker is cosmetic (TUI/WebUI status bar), not critical to agent function. But the silent failure makes debugging harder.

**Remediation:**
Add a fallback: `a.logger.debug?.() ?? a.logger.warn?.()`. Or better, always use `a.logger.warn` for I/O failures (not just debug) since a failed write is a real operational concern, even if non-fatal.

**Estimated effort:** 5 minutes

---

### BUG-4 ⬇️ LOW — `child.unref()` in Background Mode Lacks Explanation

**File:** `packages/tools/src/bash.ts:170`
**Category:** Documentation / Resource

**The code:**
```typescript
if (typeof pid === 'number') child.unref();
```

**Why it's a problem:**
`unref()` detaches the child process from the event loop, allowing Node to exit even while the background process is running. This is intentional and correct for background mode. However, the surrounding comments (lines 115-121) explain `detached` but never mention `unref()`. A reader unfamiliar with Node's process model might not understand why the child lives on but the parent can exit.

**Remediation:**
Add a one-line comment: `// unref() so the event loop can exit while this background process runs.`

**Estimated effort:** 1 minute

---

## 📐 Code Quality Findings

---

### QUAL-1 🔴 HIGH — 14 Files Exceed 1000 Lines, 3 Exceed 2000 Lines

**Files:**
- `packages/tui/src/app.tsx` — **6,408 lines** (4,409-line component + 1,020-line reducer)
- `packages/cli/src/slash-commands/sdd.ts` — **3,771 lines**
- `packages/cli/src/webui-server.ts` — **991 lines** (5 distinct concerns)
- `packages/cli/src/auth-menu.ts` — **851 lines** (menu rendering + key management + catalog browsing + config I/O)
- `packages/core/src/coordination/director.ts` — **~400 lines**
- `packages/core/src/coordination/multi-agent-coordinator.ts` — large
- `packages/cli/src/multi-agent.ts` — large
- 7 more files

**Category:** Architecture / Maintainability

**Why it's a problem:**
The project's own 2026-06-05 refactor plan tracks this (✅ awareness exists). The growth rate is alarming: 3 → 14 files >1000 lines in 6 days (+367%). A single React component at 6,408 lines is untestable, unreviewable, and essentially immutable without high regression risk.

`webui-server.ts` at 991 lines alone implements: WebSocket server (400 lines), HTTP frontend server (60 lines), event forwarding (150 lines), provider/key management CRUD (160 lines), and config I/O (70 lines) — five distinct concerns in one file.

**Remediation:**
Follow the existing refactor plan:
- **Phase 1:** Split tui/app.tsx (extract reducer, keyboard handler, paste handler, file search)
- **Phase 2:** Split webui-server.ts (extract event setup, config I/O, provider handlers to separate modules)
- **Phase 3:** Split auth-menu.ts (extract config I/O helpers)
- Gate: no new code in files >500 lines without prior decomposition.

**Estimated effort:** 8-16 hours total (already planned)

---

### QUAL-2 🔴 HIGH — `expectDefined` Helper Duplicated Across Two Files

**Files:** `packages/cli/src/auth-menu.ts:25-29` and `packages/cli/src/webui-server.ts:24-29`
**Category:** DRY Violation

**The code (identical in both files):**
```typescript
function expectDefined<T>(value: T | null | undefined): T {
  if (value === null || value === undefined) {
    throw new Error('Expected value to be defined');
  }
  return value;
}
```

**Why it's a problem:**
When the same 5-line helper is copy-pasted, any future improvement (better error message with variable name, structured error) must be applied in both places. The current pattern invites further copy-pasting as new files are added.

**Remediation:**
Move to `packages/cli/src/utils.ts` and import from both files. This is a trivial 2-minute change with immediate payoff.

**Estimated effort:** 5 minutes

---

### QUAL-3 🔴 HIGH — Inconsistent Output Cap Constants Between Shell Tools

**Files:** `packages/tools/src/bash.ts:23` (`MAX_OUTPUT = 32_768`), `packages/tools/src/exec.ts:53` (`MAX_OUTPUT = 200_000`)
**Category:** Code Quality / Inconsistency

**Why it's a problem:**
Two shell tools with similar behavior use output caps that differ by 6x. The bash limit (32KB) is reasonable for arbitrary commands; the exec limit (200KB) is reasonable for build output. However, neither constant documents *why* that value was chosen. A future maintainer might "unify" them to the wrong value, breaking either context window management (bash too large) or tool usefulness (exec too small).

The timeout constants have the same issue: `DEFAULT_TIMEOUT` (bash) vs `TIMEOUT_MS` (exec) — both 30 seconds, differently named.

**Remediation:**
1. Add comments explaining the rationale for each cap value.
2. Rename `DEFAULT_TIMEOUT` and `TIMEOUT_MS` to a consistent `DEFAULT_TIMEOUT_MS`.
3. Consider a shared `COMMAND_OUTPUT_CONSTANTS` module if more tools are added, but keep different values if the rationale differs.

**Estimated effort:** 10 minutes

---

### QUAL-4 ⚠️ MEDIUM — Hand-Rolled Async Iterator Bridge in `bash.ts`

**File:** `packages/tools/src/bash.ts:258-278`
**Category:** Code Complexity

**The code:**
```typescript
const queue: Chunk[] = [];
let resolveNext: ((c: Chunk) => void) | null = null;
const push = (c: Chunk) => {
  if (resolveNext) { const r = resolveNext; resolveNext = null; r(c); }
  else { queue.push(c); }
};
const next = (): Promise<Chunk> =>
  new Promise((resolve) => {
    const c = queue.shift();
    if (c) resolve(c);
    else resolveNext = resolve;
  });
```

**Why it's a problem:**
This is a correct manual implementation of a push/pull queue for bridging EventEmitter `data` events into an async iterator. It works reliably in production. However, Node.js 22 provides built-in alternatives:
- `Readable.from()` for converting event emitters to streams
- `events.on()` for async iteration over events

The manual pattern adds 20 lines of low-level promise management that could be replaced with a 2-line standard library call. It's not buggy, but it increases the cognitive load of understanding the file.

**Remediation:**
Low priority. The current implementation is proven. If this pattern appears elsewhere, extract it into a reusable `eventEmitterToAsyncIterator()` helper in `@wrongstack/core/utils`. Consider migrating to `events.on()` in a future refactor.

**Estimated effort:** 30 minutes (if migrating)

---

### QUAL-5 ⚠️ MEDIUM — `console.warn` Instead of Logger Service in `secret-vault.ts`

**File:** `packages/core/src/security/secret-vault.ts:129-135`
**Category:** Observability / Consistency

**The code:**
```typescript
console.warn(
  `[secret-vault] Failed to decrypt "${key}":`,
  err instanceof Error ? err.message : err,
);
```

**Why it's a problem:**
The rest of the project uses the dependency-injected `Logger` service for structured logging (JSON to stdout). This `console.warn` bypasses that pipeline, emitting unstructured plain text. In environments where stdout is captured for telemetry (CI, eternal autonomy mode), this log line will be invisible or malformed.

Note: this is in the `decryptConfigSecrets` function, which is a static utility operating on config objects. It doesn't have access to the DI container. The design choice is understandable.

**Remediation:**
Add a `logger` parameter to `decryptConfigSecrets` and `encryptConfigSecrets`. The caller (config loader, auth menu) already has a logger available. Default to a no-op or `console.warn` for callers that don't provide one.

**Estimated effort:** 15 minutes

---

### QUAL-6 ⚠️ MEDIUM — `BLOCKED_ARG_PATTERNS` in `exec.ts` Growing Without Schema

**File:** `packages/tools/src/exec.ts:59-99`
**Category:** Maintainability

**Why it's a problem:**
The allowlist + per-command regex blocklist is an excellent security pattern. However, it is 40 lines of inline code with hand-written regex patterns. Each new command or block condition requires:
1. Understanding the command's CLI flags
2. Writing a precise regex
3. Testing against bypass attempts

With 15+ commands now in the allowlist, this pattern is becoming a bottleneck. A mistake in a regex (e.g., `rm: [/^\\//, ...]` — needs to match Windows paths too) could allow a bypass.

**Remediation:**
Low priority — the current implementation is secure. Consider moving patterns to a declarative JSON/YAML config in `packages/tools/data/blocked-args.json`. This would:
- Allow security audits without reading TypeScript
- Enable contributions from non-TypeScript developers
- Make it testable with a table-driven approach

**Estimated effort:** 1-2 hours (if migrating)

---

### QUAL-7 ⚠️ MEDIUM — Provider Config I/O Logic Duplicated Between Auth Menu and WebUI

**Files:** `packages/cli/src/auth-menu.ts:777-851` and `packages/cli/src/webui-server.ts:928-986`
**Category:** DRY Violation

**Why it's a problem:**
Both files implement nearly identical `loadProviders` / `saveProviders` / `mutateProviders` logic:
- Read config file (with ENOENT handling)
- Parse JSON (with corruption detection)
- Decrypt secrets via `decryptConfigSecrets`
- Mutate
- Encrypt via `encryptConfigSecrets`
- Atomic write with mode `0o600`

The WebUI version (`loadSavedProviders`, `saveProviders`) is a slightly simplified copy. Any bug fix or improvement (e.g., better corruption recovery) must be applied to both files.

**Remediation:**
Move `loadProviders` and `saveProviders` to `packages/cli/src/provider-config-utils.ts`, which already exports `maskedKey`, `normalizeKeys`, `writeKeysBack`, `activeLabel`, `nowIso`. Both `auth-menu.ts` and `webui-server.ts` would import from a single source.

**Estimated effort:** 1-2 hours

---

### QUAL-8 ⚠️ MEDIUM — `sync I/O` (`readFileSync`) in Lazy Key Loader

**File:** `packages/core/src/security/secret-vault.ts:70`
**Category:** Performance / Event Loop Blocking

**The code:**
```typescript
private loadOrCreateKey(): Buffer {
  if (this.key) return this.key;
  try {
    const buf = fs.readFileSync(this.keyFile);  // line 70
    ...
  }
}
```

**Why it's a problem:**
`readFileSync` blocks the event loop. The key is cached after first load, so this is a one-time cost per process. For CLI usage (single run, then exit), this is negligible. For server contexts (eternal autonomy mode, MCP server mode), the first encrypt/decrypt call will cause a brief event loop stall.

The method is synchronous because `encrypt()` and `decrypt()` are synchronous — the caller expects immediate results. Breaking this contract would require a larger refactor.

**Remediation:**
Preload the key during the boot phase. The `DefaultSecretVault` constructor could accept an optional `preload: true` flag, or the boot sequence could call `vault.encrypt('')` (a no-op on empty string that warms the cache). Since the key file is a few KB at most, the stall is <1ms — this is a documentation finding, not a fix-now.

**Estimated effort:** 5 minutes (add comment only) or 30 minutes (preload in boot)

---

### QUAL-9 ⬇️ LOW — No-Op `handleContentBlockStop` Function

**File:** `packages/core/src/core/streaming-response-builder.ts:112-116`
**Category:** Dead Code

**The code:**
```typescript
export function handleContentBlockStop(state: StreamingState, ev: {...}): void {
  void state;
  void ev;
}
```

**Why it's a problem:**
This function is exported and called (line 239 of the same file), but does nothing. The comment says "tracks block boundaries for providers that need it — no-op for now." A no-op that's called on every streaming event wastes CPU cycles (trivial) and confuses readers who expect it to have side effects.

**Remediation:**
Either remove the call site and the function, or add a `// TODO: implement for providers that emit content_block_stop with metadata` comment. The `void state; void ev;` pattern suppresses TypeScript unused-variable warnings but is unintuitive.

**Estimated effort:** 2 minutes

---

### QUAL-10 ⬇️ LOW — Regex-Based HTML-to-Markdown Converter Is Brittle

**File:** `packages/tools/src/fetch.ts:453-494`
**Category:** Robustness

**The code:** 41-line regex chain converting HTML to Markdown.

**Why it's a problem:**
Regex-based HTML parsing is well-known to be fragile. Nested tags, attributes containing `>`, malformed HTML, or unusual markup can produce incorrect output. The current implementation handles the common case (headings, bold, italic, links, code blocks, lists) adequately and includes XSS protection (link scheme validation — lines 467-473).

This is not a bug — the output is used for LLM context, not rendered in a browser. Incorrect Markdown is a minor annoyance, not a security risk.

**Remediation:**
Long-term: consider a lightweight Markdown converter library (`turndown`, `marked`). Short-term: the current implementation is sufficient. Add a comment noting that this is a simplified converter and linking to the correct behavior for edge cases.

**Estimated effort:** 5 minutes (add comment) or 2 hours (library migration)

---

### QUAL-11 ⬇️ LOW — Inconsistent Naming: `DEFAULT_TIMEOUT` vs `TIMEOUT_MS`

**Files:** `packages/tools/src/bash.ts:24` and `packages/tools/src/exec.ts:54`
**Category:** Naming Consistency

**Why it's a problem:**
Both constants hold the same value (30,000ms) for the same concept (default child process timeout). Different names suggest different semantics, confusing readers.

**Remediation:**
Rename both to `DEFAULT_TIMEOUT_MS` for consistency with the `timeout_ms` input field.

**Estimated effort:** 2 minutes

---

### QUAL-12 ⬇️ LOW — Generic `sleep` Utility in Telegram Plugin

**File:** `packages/telegram/src/bot.ts:352-354`
**Category:** Code Reuse

**The code:**
```typescript
function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
```

**Why it's a problem:**
This 3-line helper is likely reimplemented elsewhere in the codebase (the `provider-runner.ts` has a more complex abortable version). If the project ever needs an abortable `sleep` (e.g., for cleanup), these scattered implementations will diverge.

**Remediation:**
Search for other `sleep`/`delay` implementations in the codebase. If found, consolidate into `@wrongstack/core/utils`. Even if only one exists, moving it to a utils file signals that it's a shared pattern.

**Estimated effort:** 10 minutes

---

## 🏗️ Architectural Findings

---

### ARCH-1 🔴 HIGH — Explosive File Growth: 3 → 14 files >1000 lines in 6 days

**Status:** Already tracked in `docs/notes/refactor-2026-06-05.md`

**Why it's a problem:**
The codebase added features aggressively between May 30 and June 5. The refactor plan identifies this and has a decomposition strategy. The risk is that decomposition doesn't keep pace with feature growth — the gap between "files we know are too big" and "files we've split" is widening.

**Remediation:**
Execute the existing Phase 1-5 plan. Add a CI gate: `pnpm run lint:size` that warns when files exceed 500/1000 lines (use `wc -l` or a custom script, gated as advisory, not blocking).

**Estimated effort:** 8-16 hours (already planned)

---

## ⚡ Performance Findings

---

### PERF-1 ⬇️ LOW — Global `undici` Agent Never Destroyed

**File:** `packages/tools/src/fetch.ts:87-93`
**Category:** Resource Management

**The code:**
```typescript
let pinnedAgent: Agent | undefined;
function getPinnedDispatcher(): Agent {
  if (!pinnedAgent) {
    pinnedAgent = new Agent({ connect: { lookup: guardedLookup as never } });
  }
  return pinnedAgent;
}
```

**Why it's a problem:**
The `Agent` instance handles connection pooling for all fetch requests. It is cached at module scope and never destroyed. For CLI usage (single run, then process exits), this is fine — the OS reclaims all resources. For longer-running contexts (eternal autonomy, MCP server mode), the agent's internal connection pool and DNS cache grow unboundedly.

**Remediation:**
Add a cleanup hook: `process.on('beforeExit', () => pinnedAgent?.destroy())`. Or track the agent in the process registry so the `wstack kill` flow can tear it down.

**Estimated effort:** 10 minutes

---

### PERF-2 ⬇️ LOW — Lazy Key Loading Causes One-Time Event Loop Stall

Covered in QUAL-8. Not a recurring performance issue, but documented here for completeness.

---

## ✅ Strengths (Notable Good Practices)

1. **Excellent SSRF Protection** (`fetch.ts`): DNS-rebinding prevention via `guardedLookup` on pinned undici dispatcher, re-validation at every redirect hop, IPv4/IPv6 private address detection (including `169.254.0.0/16` for cloud metadata endpoints), `ALLOW_PRIVATE` opt-in gate.

2. **Strong Secret Management** (`secret-vault.ts`): AES-256-GCM encryption at rest, atomic writes with `mode: 0o600`, prototype pollution protection (`FORBIDDEN_PROTO_KEYS`), TOCTOU race-safe key generation (`flag: 'wx'` with EEXIST recovery), legacy plaintext migration path.

3. **Comprehensive Secret Scrubbing** (`secret-scrubber.ts`): 16 pattern types (API keys, JWT, private keys, database URIs, bearer tokens, high-entropy env vars), bounded 64KB chunk processing, `WeakSet` for circular reference protection, applied at tool input/output boundaries.

4. **Multi-Layer Shell Hardening:**
   - `exec` tool: allowlist (15 commands) + per-command regex blocklist (e.g., `git --exec`, `python -c`, `find -exec`, `rm` absolute paths) + cwd sandbox + max args cap
   - `bash` tool: process group kill on timeout (POSIX), 2-second SIGTERM→SIGKILL escalation, process registry tracking, output truncation

5. **WebUI Defense-in-Depth:** `crypto.randomBytes(16)` auth token, `crypto.timingSafeEqual` comparison, Host header validation, DNS-rebinding defense (loopback binding + hostname check), per-connection rate limiting (`WEBUI_RATE_LIMIT`), permission confirmation bridging.

6. **YOLO Risk Detection** (`yolo-risk.ts`): Destructive command pattern matching (`rm -rf`, `git clean -xdf`, `drop table`, fork bombs), path escape detection (`cd ..`, absolute paths outside project), shell operator awareness.

7. **Provider Retry with Abort Awareness:** Exponential backoff that respects `AbortSignal`, clean `removeEventListener` in finally blocks.

8. **SSE Parser O(n²) Fix** (`sse.ts`): Incremental CRLF normalization per chunk instead of full-buffer replacement, `MAX_BUFFER_BYTES` guard against unbounded lines.

9. **Edit Tool TOCTOU Protection** (`edit.ts`): Mandatory read-before-write invariant, mtime check between read and edit, Windows mtime tolerance (2s for FAT/NTFS imprecision).

10. **Consistent Permission Model:** All tools declare `permission`, `mutating`, `riskTier`, and `capabilities` metadata. The `subjectKey` field enables precise trust rules.

---

## Top 10 Quick Wins (Sorted by Impact / Effort)

| # | Severity | File | Title | Effort |
|---|----------|------|-------|--------|
| 1 | MEDIUM | `bash.ts:109` | Add allowlist for `SHELL` env var | 15 min |
| 2 | MEDIUM | `streaming-response-builder.ts:97` | Add missing `crypto` import | 2 min |
| 3 | LOW | `fetch.ts:412-443` | Remove dead combineSignals fallback | 5 min |
| 4 | HIGH | `auth-menu.ts:25` + `webui-server.ts:24` | Deduplicate `expectDefined` helper | 5 min |
| 5 | MEDIUM | `auth-menu.ts` + `webui-server.ts` | Consolidate config I/O into `provider-config-utils` | 2 hr |
| 6 | LOW | `agent-loop.ts:161,302` | Add `warn` fallback for session write errors | 5 min |
| 7 | LOW | `bash.ts:147` | Fix background mode close handler ordering | 10 min |
| 8 | MEDIUM | `secret-vault.ts:129` | Replace `console.warn` with Logger service | 15 min |
| 9 | LOW | `fetch.ts:87` | Add Agent cleanup hook | 10 min |
| 10 | LOW | `telegram/bot.ts:6-9` | Activate `redactToken` helper | 10 min |

**Total estimated effort for all quick wins:** ~3.5 hours

---

## Methodology

**Files examined:** 24 files with full `read` (lines 1→EOF), 40+ files via pattern `grep`

**Tools used:**
- `read` — full file content inspection
- `grep` — pattern matching for specific constructs (`eval`, `innerHTML`, `apiKey`, `secret`, `Bearer`, etc.)
- `tree` — project structure exploration
- `glob` — file discovery
- Manual code review against skills in scope: `bug-hunter`, `security-scanner`, `refactor-planner`, `typescript-strict`, `node-modern`, `testing`, `observability`, `api-design`
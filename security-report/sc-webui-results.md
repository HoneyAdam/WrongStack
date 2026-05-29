# WrongStack WebUI Server — Security Audit (READ-ONLY)

**Date:** 2026-05-29
**Auditor:** automated security review (no source files modified)
**Scope:** `packages/webui/src/server/*`, `packages/cli/src/webui-server.ts`, `packages/core/src/observability/prometheus.ts`

> Note: DFMT MCP tools were unavailable in this session (ToolSearch reported tool search not enabled). Native Read/Grep were used as the announced fallback.

---

## Posture summary (frames everything below)

- **Bind address:** `127.0.0.1` by default (loopback), for both the WS server and the static HTTP server. Standalone `startWebUI` defaults `wsHost = '127.0.0.1'`; when left at the v4 loopback default it ALSO opens a second listener on `::1`. The HTTP file server binds the same `wsHost`. The CLI-embedded `runWebUI` hard-binds `127.0.0.1`. Prometheus server defaults `127.0.0.1`. **No component binds `0.0.0.0` by default.**
- **Override to network:** `WS_HOST=0.0.0.0` (or a LAN IP) exposes the standalone WS + HTTP servers to the network. `runWebUI` (CLI path) cannot be re-bound — always loopback.
- **Auth posture:** A random 128-bit hex token (`wsToken`/`authToken`) is generated per process and required for **non-loopback** WS connections. **Loopback browser origins and loopback non-browser clients are accepted WITHOUT a token by design** ("for convenience"). The static HTTP server has **no authentication at all** and serves only files from `dist/`. There is **no token on any HTTP route** — but no HTTP route can drive the agent (control surface is WS-only).
- **Net:** The dangerous control surface (agent.run → tool execution → arbitrary file/shell access, plus plaintext API keys in memory) lives entirely on the **WebSocket**, and on the default loopback bind that WS accepts **any loopback-origin browser page with no token**. That is the central risk: it is reachable by cross-site WebSocket hijacking / DNS-rebinding from a malicious web page the user visits, because neither server validates the `Host` header and the WS origin check treats "loopback hostname" as trusted.

---

## Findings

### F1 — WebSocket accepts loopback-origin browsers with NO token (CSWSH / DNS-rebinding) — controls the agent
- **Severity:** HIGH
- **CWE:** CWE-1385 (Missing Origin Validation in WebSockets), CWE-352 (CSRF), CWE-350 (Reliance on reverse-DNS / host trust)
- **Location:** `packages/webui/src/server/index.ts:430-465` (`isLoopback`, `verifyClient`); control surface at `:731-789` (`user_message` → `agent.run`)
- **Evidence:**
  ```ts
  const { hostname } = new URL(origin);
  if (isLoopback(hostname)) return true;   // loopback browser origins: allow without token
  ```
  `verifyClient` returns `true` for any browser whose Origin hostname is `localhost`/`127.0.0.1`/`::1` regardless of token. The `user_message` handler then calls `agent.run(content, …)` which executes builtin tools (read/write/bash/grep/glob/git) against the project — full local code execution and filesystem read/write.
- **Scenario / exploitability:**
  - **Cross-site WebSocket hijacking:** WebSocket connections are NOT subject to the same-origin policy and CORS does not gate them. A page at `https://evil.example` can open `new WebSocket("ws://127.0.0.1:3457")`. The browser sends `Origin: https://evil.example` — that hostname is non-loopback, so this specific case is correctly rejected (token required). **However**, the design intent ("loopback origins trusted") breaks under:
  - **DNS rebinding:** attacker serves a page from a domain that re-resolves to `127.0.0.1`. The page's Origin is `http://attacker.test` (non-loopback → would be rejected)… but there is **no `Host` header allowlist** (see F2), so a rebinding attack that makes the *browser* believe it is same-origin with a `127.0.0.1`-resolved host, combined with the absence of Host validation, is the classic localhost-rebinding vector. The token is the only real defense, and it is waived for the loopback path.
  - **Any other local process / browser extension / loopback-origin app** (e.g. another tool serving from `http://localhost:NNNN`) can connect token-free and drive the agent.
  - Once connected: `user_message` runs the agent with full tools; `key.add`/`provider.add` write attacker-supplied API keys; `model.switch` repoints the provider; `files.list` enumerates the project tree.
- **Existing controls:** Non-loopback origins require the token; rate limit (60 msg/60 s); `maxPayload` 1 MiB on the CLI server (NOT set on the standalone server — see F7).
- **Remediation:** Require the token for **all** WS connections including loopback (the frontend already receives `wsToken` and reconnects with `?token=`). Additionally validate the `Origin` against an exact allowlist (`http://127.0.0.1:<httpPort>`, `http://localhost:<httpPort>`) and reject mismatches even on loopback. Do not treat "loopback hostname in Origin" as authentication.

### F2 — No `Host` header validation on WS or HTTP server (DNS-rebinding defense missing)
- **Severity:** MEDIUM (HIGH in combination with F1)
- **CWE:** CWE-350 (Reliance on Untrusted Host header / Missing host allowlisting)
- **Location:** `packages/webui/src/server/index.ts:433-465` (WS verifyClient — only Origin, never Host), `:1868-1932` (HTTP server — never reads `req.headers.host`); `packages/cli/src/webui-server.ts:216-255` (WS — Origin only); `packages/core/src/observability/prometheus.ts:148-189` (no Host check)
- **Evidence:** No reference to `headers.host` / `req.headers['host']` anywhere in the request paths (grep confirms only `headers.origin` is read). The standard localhost-server defense against DNS rebinding — rejecting requests whose `Host` is not `127.0.0.1:<port>` / `localhost:<port>` — is absent.
- **Scenario:** A victim visits `http://rebind.attacker.test` which TTL-rebinds to `127.0.0.1`. Subsequent requests carry `Host: rebind.attacker.test` and are same-origin from the browser's view, so the browser sends them without complaint and the WS Origin becomes `http://rebind.attacker.test`. Because no Host allowlist exists, the only gate is the token — which is waived on loopback (F1).
- **Existing controls:** None for Host.
- **Remediation:** Add a Host allowlist check (`127.0.0.1:<port>`, `localhost:<port>`, `[::1]:<port>`) to both the WS upgrade (`verifyClient`) and the HTTP request handler; 403 on mismatch.

### F3 — `verifyClient` token comparison is non-constant-time and parsed by ad-hoc regex
- **Severity:** LOW
- **CWE:** CWE-208 (Observable Timing Discrepancy), CWE-697 (Incorrect Comparison)
- **Location:** `packages/webui/src/server/index.ts:440-442, 459-461`; `packages/cli/src/webui-server.ts:226-227`
- **Evidence:**
  ```ts
  const tokenMatch = url.match(/[?&]token=([^&]+)/);
  const providedToken = tokenMatch ? tokenMatch[1] : undefined;
  const tokenOk = providedToken === wsToken;       // === string compare
  ```
  Plain `===` is not constant-time. The standalone server extracts the token with a hand-rolled regex on `req.url` instead of `URL.searchParams` (the CLI server uses `searchParams` correctly), so a URL like `?xtoken=…&token=…` or percent-encoding edge cases are parsed differently than a real URL parser would — low risk but inconsistent.
- **Scenario:** Token-guessing over many connections via timing is theoretically possible; realistically marginal for a 128-bit token over a network socket. Primary value is hygiene/consistency.
- **Remediation:** Use `crypto.timingSafeEqual` on equal-length buffers, and parse the token via `new URL(req.url, base).searchParams.get('token')` consistently.

### F4 — Token transmitted to clients in `session.start` payload and embedded in WS URL query
- **Severity:** LOW
- **CWE:** CWE-598 (Information Exposure Through Query Strings), CWE-522
- **Location:** `packages/webui/src/server/index.ts:402, 422-425, 650-651`; `packages/cli/src/webui-server.ts:292-300`
- **Evidence:** `wsToken` is included in every `session.start` broadcast/send; clients reconnect by putting it in `?token=` on the WS URL. The standalone server logs a masked prefix (`:425`) — good; the CLI server explicitly does NOT log it (`:66`) — good.
- **Scenario:** Tokens in URL query strings land in proxy/access logs and browser history. On loopback this is low impact, but if `WS_HOST` is widened or a reverse proxy is placed in front, the token can leak via logs. Also, any already-connected client (legitimately or via F1) receives the token and can persist it.
- **Existing controls:** Masked logging; token not persisted to disk.
- **Remediation:** Prefer `Sec-WebSocket-Protocol` or an `Authorization`-style header for the token rather than the query string; rotate the token per process (already per-process). Document that widening the bind requires a proxy that strips query strings from logs.

### F5 — Path-traversal guard present and correct on static HTTP server (NOT a finding — control noted)
- **Severity:** INFO (control verified)
- **Location:** `packages/webui/src/server/index.ts:1883-1892`
- **Evidence:**
  ```ts
  const resolvedPath = path.resolve(filePath);
  const resolvedRoot = path.resolve(DIST_DIR);
  if (!resolvedPath.startsWith(resolvedRoot + path.sep) && resolvedPath !== resolvedRoot) {
    res.writeHead(403, …); res.end('Forbidden'); return;
  }
  ```
  `new URL()` decodes `%2e%2e` before `path.join`, and the post-resolve prefix check correctly contains the result to `DIST_DIR`. The comment explicitly calls out the percent-encoding decode. **No traversal escape found.** Minor note: the `startsWith(resolvedRoot + path.sep)` check is correct and avoids the `DIST_DIR` vs `DIST_DIR-evil` sibling-prefix bug. SPA `ENOENT` fallback only ever reads `dist/index.html`, no user input.
- **Remediation:** None required. Keep as-is.

### F6 — Security headers good on HTML; CSP allows `unsafe-inline` script
- **Severity:** LOW
- **CWE:** CWE-1021 (clickjacking — mitigated), CWE-79 (XSS — weakened mitigation)
- **Location:** `packages/webui/src/server/index.ts:1896-1907` (and SPA-fallback header set `:1917-1921`)
- **Evidence:** `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy`, and a CSP are set on `.html`. The CSP is:
  ```
  default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; connect-src 'self' ws: wss:; …
  ```
  `script-src 'unsafe-inline'` largely defeats CSP's XSS protection if any reflected/stored XSS sink exists; `connect-src ws: wss:` allows the page to open WebSocket connections to **any** ws host (not just self) — broad but the page is first-party.
  **Clickjacking is mitigated** (`X-Frame-Options: DENY`; no `frame-ancestors` in CSP but XFO covers it). Note the SPA-fallback branch (`:1917`) sets XFO + nosniff but **omits the CSP header** — HTML served via the ENOENT fallback path is CSP-less.
- **Scenario:** If a future code change introduces an XSS sink in the served bundle, `unsafe-inline` makes it trivially exploitable; the CSP-less fallback path widens that.
- **Remediation:** Drop `'unsafe-inline'` from `script-src` (use nonces/hashes if inline is required by the bundler); narrow `connect-src` to the specific ws origin; emit the same CSP on the SPA-fallback HTML response.

### F7 — Standalone WS server sets no `maxPayload`; unbounded JSON parse per message
- **Severity:** LOW (DoS)
- **CWE:** CWE-400 (Uncontrolled Resource Consumption), CWE-789
- **Location:** `packages/webui/src/server/index.ts:466-476` (no `maxPayload` option) and `:669` (`JSON.parse(data.toString())`)
- **Evidence:** The CLI server sets `maxPayload: 1 * 1024 * 1024` (`packages/cli/src/webui-server.ts:63`); the standalone `WebSocketServer` config (`index.ts:466`) omits it, so it uses the `ws` default (100 MiB). Each message is fully buffered then `JSON.parse`d. The 60-msg/60-s rate limit is checked AFTER the frame is received/buffered (`:657-667`), so it does not bound per-message size, only count.
- **Scenario:** A connected client (token-free on loopback per F1) can send large frames to spike memory/CPU. Low impact on loopback; matters if bind is widened.
- **Remediation:** Set `maxPayload` (e.g. 1 MiB) on the standalone `WebSocketServer` to match the CLI server; consider a byte budget alongside the message-count rate limit.

### F8 — Provider API keys held decrypted in memory and reachable via WS; key endpoints do not return plaintext (mostly safe)
- **Severity:** INFO / LOW
- **CWE:** CWE-522 (Insufficiently Protected Credentials)
- **Location:** key handlers `packages/webui/src/server/index.ts:1129-1163, 1738-1852`; provider listing `:1022-1043`; CLI `providers.saved` `packages/cli/src/webui-server.ts:542-564`; `provider-store.ts:41-50`
- **Evidence:**
  - The standalone server's `providers.list` returns only `hasApiKey: boolean` — **no key material** (`index.ts:1038`). Good.
  - The CLI server's `providers.saved` returns `maskedKey(k.apiKey)` (e.g. `sk-1…cdef`) — masked, not plaintext (`webui-server.ts:552`, `provider-config-utils` masking). Good.
  - `key.add`/`provider.add` accept plaintext keys over the socket and persist them encrypted (`encryptConfigSecrets`, `atomicWrite(..., { mode: 0o600 })`). Good at-rest handling.
  - **However:** the in-memory config decrypts keys (`decryptConfigSecrets`, `loadSavedProviders`), and any WS client (token-free on loopback, F1) can **add/overwrite/delete** keys and **switch the active provider**. There is no endpoint that *returns* a plaintext key, but an attacker who can reach the socket can swap in their own key to exfiltrate the user's prompts/usage to an attacker-controlled `baseUrl` via `provider.add` (`:1810-1837`, accepts arbitrary `baseUrl`).
- **Scenario:** Combined with F1, a malicious loopback page calls `provider.add` with `family: 'openai-compatible', baseUrl: 'https://attacker/v1', apiKey: '…'` then `model.switch` to it — all subsequent agent traffic (including file contents the agent reads) is sent to the attacker's endpoint.
- **Existing controls:** Encryption at rest, `0o600`, masked/boolean listing, no plaintext echo.
- **Remediation:** Gate all `key.*` / `provider.*` / `model.switch` mutations behind the token (fix F1). Consider an allowlist or confirmation for non-standard `baseUrl` values.

### F9 — Error messages reflect raw exception text back over the socket (low info-leak)
- **Severity:** LOW
- **CWE:** CWE-209 (Information Exposure Through an Error Message)
- **Location:** pervasive `err instanceof Error ? err.message : String(err)` returned to clients, e.g. `index.ts:778, 952, 1119, 1205, 1249`, `webui-server.ts:448`, and the `Switch failed: …`/`Refusing to mutate <globalConfigPath>: …` messages (`webui-server.ts:717-718`).
- **Evidence:** Exception messages — which can include absolute config paths (`globalConfigPath`), filesystem errors, and provider error bodies — are forwarded verbatim to the WS client. The `saveProviders` error embeds the full config path.
- **Scenario:** A reachable client learns absolute paths / environment details. Low impact for a local tool; relevant once the surface is reachable cross-site (F1) or bind is widened.
- **Existing controls:** Secrets are scrubbed in tool-execution paths via `DefaultSecretScrubber` (wired into `ToolExecutor`), but these handler-level error strings are not scrubbed.
- **Remediation:** Return generic messages to the client and log details server-side; avoid embedding absolute paths.

### F10 — AutoPhase WS messages share the same auth gate (inherits F1) and accept arbitrary phase prompts
- **Severity:** LOW (inherits HIGH from F1)
- **CWE:** CWE-862 (Missing Authorization)
- **Location:** `packages/webui/src/server/index.ts:1664-1670` (dispatch), `autophase-ws-handler.ts:63-199`
- **Evidence:** Any `autophase.*` message is delegated to `AutoPhaseWebSocketHandler`, including `autophase.start` which builds an `AutoPhaseRunner` whose `executeTask` calls `this.agent.run(prompt, …)` (`autophase-ws-handler.ts:194-199`) with a fresh `new AbortController()` — i.e. these runs are **not** bound by the main `runLock` and cannot be aborted via the `abort` message. A connected (token-free, loopback) client can kick off long-running autonomous agent execution with attacker-chosen task titles/descriptions.
- **Scenario:** Same as F1 — cross-site/loopback page starts an autonomous multi-phase agent run that executes tools, with no abort path and no separate auth.
- **Remediation:** Fix F1 (token for all connections). Route AutoPhase agent runs through the same run lock / abort controller so they are cancellable and serialized.

---

## Controls observed (positive)
- Default bind is loopback everywhere; network exposure is explicit opt-in (`WS_HOST`).
- Per-process random 128-bit token; required for non-loopback connections.
- Path-traversal guard on the static server is correct (F5).
- Good HTTP security headers on HTML (XFO/nosniff/Referrer-Policy/CSP), clickjacking mitigated (F6 caveats).
- Secrets encrypted at rest (AES-GCM vault), `0o600` file mode, no plaintext key echoed to clients; listings are masked/boolean (F8).
- Per-connection message rate limiting (60/60 s) on both servers.
- CLI server sets `maxPayload` 1 MiB (standalone does not — F7).
- Config writes serialized via a write lock to avoid read-modify-write races.
- Prometheus metrics server defaults to loopback with a clear comment about label leakage; supports HTTPS.

## Priority remediation order
1. **F1** — require the token for all WS connections (loopback included) + strict Origin allowlist. This single change closes the CSWSH/rebinding control-surface exposure that F8/F10 inherit.
2. **F2** — add Host-header allowlist to WS upgrade and HTTP handler.
3. **F7** — set `maxPayload` on the standalone WS server.
4. **F6** — drop `script-src 'unsafe-inline'`, add CSP to SPA-fallback response.
5. **F3/F4/F9** — hygiene: constant-time token compare, token out of query string, generic client errors.

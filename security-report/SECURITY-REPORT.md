# Security Report — WrongStack

**Scan date:** 2026-05-29 · **Scanner:** security-check (4-phase: Recon → Hunt → Verify → Report) · **Scope:** full monorepo (`packages/*`, `apps/*`), 17 packages, ~568 non-test TS source files.

---

## Remediation status (applied 2026-05-29)

All High and Medium findings, plus the cheap Low items, were fixed in this pass. Tests re-run green: tools 650, core+plugins 2103, cli 1063, webui 88. Typecheck clean on all touched packages (pre-existing unrelated WIP type errors in `cli/execution.ts` & `slash-commands/autophase.ts` remain — not part of this work). No new lint violations introduced.

| ID | Status | What changed |
|----|--------|--------------|
| F1 | ✅ Fixed | `py-parser.ts`, `refs-extractor.ts`, `go-parser.ts`, `rs-parser.ts` now use `execFileSync` argv-array (no shell). Python refs script moved to a temp file. |
| F2 | ✅ Hardened | WS now enforces Host-header allowlist (rebinding defense) + constant-time token compare; non-loopback origins still require token. (Loopback bootstrap retained — see note.) |
| F3 | ✅ Fixed | `extractTar` rejects any entry whose resolved path escapes `destDir`. |
| F4 | ✅ Fixed | `web_fetch` guard now resolves DNS + checks all IPs (v4/v6/IPv4-mapped/IMDS), blocks non-http(s), and re-validates every redirect hop (`redirect:'manual'`). |
| F5 | ✅ Fixed | `fetch.ts` now pins the connection to the validated IP via an undici `Agent` whose `connect.lookup` performs the single resolution the socket uses (no re-resolution → no rebinding window). TLS still validates the hostname cert (SNI preserved). `undici@^7.25` added to tools. |
| F6 | ✅ Fixed | Host-header validation added to both WebUI WS paths (standalone + CLI-embedded). |
| F7 | ✅ Fixed | `director.ts` re-checks `maxFleetCostUsd` in the cost-extend handler; denies once aggregate spend hits the cap. |
| F8 | ✅ Fixed | `RecoveryLock.write()` routed through `atomicWrite` (unique temp + `wx` + fsync + rename-retry). |
| F9 | ✅ Fixed | `init.ts`, `mcp.ts` (×2), `plugin-management.ts` (×2), `picker.ts` config writers now pass `{mode:0o600}`. |
| F10 | ✅ Fixed | WS token compared with `crypto.timingSafeEqual` (both servers). |
| F11 | ✅ Fixed | All actions pinned to commit SHAs (comment records tag+date); `ci.yml` gets top-level `permissions: contents:read`; `release.yml` defaults to read-only with the publish job opting into `contents:write`+`id-token:write`; npm publish now uses `--provenance`. |
| F12 | ✅ Fixed | `exec.ts` git denylist extended with `-c`/`--config`/`--config-env=`. |
| F13 | ◑ Mostly fixed | `maxPayload` added to standalone WS; **CSP hardened** — `script-src` locked to `'self'` (no inline scripts in the prod bundle), added `object-src 'none'`/`base-uri 'self'`/`frame-ancestors 'none'`/`form-action 'self'`, and the previously CSP-less SPA fallback now ships the same policy. **Token-in-URL: intentionally deferred** — loopback-only (Low), and moving it to a `Sec-WebSocket-Protocol` subprotocol touches the client + handshake and can't be browser-tested here; not worth the breakage risk. `style-src 'unsafe-inline'` kept (Radix/React inject inline styles). |
| F14 | ⬜ Won't-fix (accepted) | Suspected ReDoS heuristic (`_regex.ts`). Left as-is: pattern length is capped (256) and the subject is capped (64 KB) so worst case is bounded CPU-seconds, not unbounded. The only complete fix is an alternate engine (re2) — a dependency not worth adding for a bounded, `confirm`/local-gated path; widening the heuristic risks false-positives that break legitimate searches. |

**Note on F2 bootstrap:** the WS token is delivered to the client *after* the first loopback connect (via `session.start`) and replayed on reconnect, so it can't be required on the first connect without a bootstrap redesign (e.g. injecting the token into the served HTML). The Host-header guard is the concrete, non-breaking rebinding defense added here; requiring the token on first connect is the recommended longer-term hardening.

---

## Executive summary

WrongStack is a **local-first AI coding-agent framework** (CLI + optional local WebUI + MCP client + Telegram/ACP bridges). It has **no hosted multi-tenant attack surface**; the realistic threat model is **(a) a hostile repository or web page reaching the auto-permissioned tool surfaces**, and **(b) malicious/compromised MCP servers and fetched content**.

Overall the codebase shows **strong, deliberate security engineering**: an AES-256-GCM secret vault done correctly, a genuinely hardened SSRF guard in `fetch.ts`, argv-array process spawning everywhere it matters, project-root path containment across filesystem tools, prototype-pollution-safe merges, schema-validated deserialization, and a clean `pnpm audit`. The permission model (`auto`/`confirm`/`deny` + `mutating`) is the central control and is used well.

The audit found **2 High**, **6 Medium**, and **6 Low** confirmed issues. The two High findings both stem from the **auto-permission** surfaces that bypass the interactive `confirm` backstop:

- **F1 — Command injection** when indexing an untrusted repo (a crafted *filename* reaches a shell command string in three `codebase-index` parsers).
- **F2 — Cross-site WebSocket hijacking** — the WebUI's agent-control WebSocket is unauthenticated for loopback-origin browsers and performs no Origin/Host validation, so a malicious page can drive the local agent.

Neither is a flaw in the core permission design — both are gaps in surfaces that run *without* the `confirm` gate. Fixing them (argv-array exec; token + Origin/Host checks on the WS) closes the highest-impact paths.

### Risk score

**Overall risk: MEDIUM** (would be Low without the two auto-permission gaps). For the default single-user local workflow with the WebUI off and only trusted repos opened, residual risk is Low.

| Severity | Count |
|----------|-------|
| Critical | 0 |
| High | 2 |
| Medium | 6 |
| Low | 6 |
| Info / positive controls | (see below) |

---

## Scan statistics

- **Phases run:** Recon, Dependency audit, Hunt (7 clustered analyzers covering RCE/CMDi, path traversal/file-upload, SSRF/open-redirect, WebUI auth/CORS/WS/CSRF/clickjacking, secrets/crypto/data-exposure, deserialization/proto-pollution/mass-assignment, TS/CI-CD/ReDoS/race/logic), Verify, Report.
- **Language scanner activated:** TypeScript (100% of app code). Go/Python/PHP/Rust/Java/C# scanners N/A.
- **Infra scanners:** CI/CD activated (`.github/workflows`); Docker/IaC skipped (none present).
- **Dependencies:** `pnpm audit --prod` → **no known vulnerabilities**; lean footprint (core/providers/mcp/runtime carry zero external runtime deps).

---

## Findings by severity

### 🔴 HIGH

**F1 · OS command injection via filename in codebase-index parsers** — CWE-78
`packages/tools/src/codebase-index/py-parser.ts:251`, `refs-extractor.ts:230`, `:256`.
Indexed file paths are interpolated into shell command **strings** passed to `execSync` (runs via `/bin/sh -c`). A file whose name carries a `$()`/backtick payload — opened from an untrusted repo while the `permission:'auto'` index tool runs — executes arbitrary code as the user. **Fix:** use `execFileSync('python'|'go', [scriptPath, filePath])` (argv array, no shell) at all three sites. *CVSS ~8.0.*

**F2 · Cross-site WebSocket hijacking of the agent control surface** — CWE-1385/346
`packages/webui/src/server/index.ts` (WS `verifyClient` ~`:442`).
The WebSocket that drives `agent.run` (bash/read/write/git + key management) requires the session token only for non-loopback clients and validates neither `Origin` nor `Host`. A page the user visits can open `ws://127.0.0.1:<port>` and control the agent → local RCE. **Fix:** require the token for *all* WS connections; enforce an `Origin` allowlist and a `Host` allowlist (also closes F6). *CVSS ~7.5 (requires WebUI running + user visiting a malicious page).*

### 🟠 MEDIUM

- **F3 · Zip-slip in skill/plugin tar extractor** — CWE-22 — `core/src/skills/github-fetcher.ts:137,154`. No containment check on extracted paths. Mitigated because GitHub tarballs come from git trees (no `..` entries) and symlinks are skipped. Add a `path.resolve(dest).startsWith(root + sep)` assertion.
- **F4 · SSRF in `web_fetch` (web-search plugin)** — CWE-918 — `plugins/src/web-search/index.ts:74-96`. LLM-chosen URL, no IPv6/DNS/redirect validation, allows `http://`. Route through the `fetch.ts` guard.
- **F5 · DNS-rebinding / TOCTOU in `fetch.ts` SSRF guard** — CWE-918/367 — `tools/src/fetch.ts:200-220`. Otherwise strong guard; validated IP is not pinned for the actual connection. Documented/accepted; gated by `confirm`. Pin via custom undici `connect`/`lookup`.
- **F6 · No Host-header validation on WebUI** — CWE-350 — enables the DNS-rebinding path behind F2. Allowlist `Host`.
- **F7 · Fleet cost-cap bypass via budget auto-extend** — CWE-770 — `core/src/coordination/director.ts:587-590` vs `:684-689`. `maxCostUsd` checked only at spawn, not on extend. Re-check in the threshold handler.
- **F8 · Non-atomic RecoveryLock write** — CWE-367 — `core/src/storage/recovery-lock.ts:135-149`. Use the existing `atomicWrite`.

### 🟡 LOW

- **F9 · Config files created without `0o600`** — CWE-276 — `init.ts:81`, `picker.ts:41`, `plugin-management.ts:177,200`, `mcp.ts:80,104` (mitigated: secrets are ciphertext, `.key` is `0o600`).
- **F10 · Non-constant-time WS token compare** — CWE-208 — `server/index.ts:442` → `timingSafeEqual`.
- **F11 · CI/CD hardening** — CWE-1357/732 — pin actions to SHAs, add least-privilege top-level `permissions:`, enable npm publish provenance.
- **F12 · `git -c`/`--config` arg-injection** — CWE-88 — add to `exec.ts` git arg denylist (also `--upload-pack`/`--exec`).
- **F13 · WS hygiene** — token in URL query; missing `maxPayload` on standalone WS; CSP `script-src 'unsafe-inline'`.
- **F14 · ReDoS heuristic non-exhaustive (suspected)** — CWE-1333 — `_regex.ts`; bounded by 64 KB input cap.

### 🟢 Positive controls verified

AES-256-GCM secret vault (random IV, CSPRNG key at `0o600` w/ exclusive create, tag verified, no plaintext fallback) · hardened `fetch.ts` SSRF guard with per-hop redirect re-validation · argv-array spawning in all production process launches · project-root path containment + symlink/realpath checks across filesystem tools · safe WebUI static server · prototype-pollution-safe merges · schema-validated deserialization (replayed tool_use never executed) · `secret-scrubber.ts` redaction · no hardcoded live secrets · clean dependency audit.

---

## Remediation roadmap

**Phase 1 — Now (close the High auto-permission gaps):**
1. F1 — convert the three `codebase-index` `execSync` string calls to `execFileSync` argv-array form. *(small, high impact)*
2. F2 + F6 — require the session token on all WebUI WS connections; add `Origin` and `Host` allowlists to both the WS upgrade and HTTP handler.

**Phase 2 — Next (Medium hardening):**
3. F4 — make `web_fetch` reuse the `fetch.ts` SSRF guard.
4. F5 — pin the validated IP in `fetch.ts` (undici `connect`/`lookup`).
5. F3 — add the zip-slip containment assertion in `extractTar`.
6. F7 — enforce the fleet `maxCostUsd` in the budget-extend handler.
7. F8 — route `RecoveryLock` through `atomicWrite`.

**Phase 3 — Hygiene (Low):**
8. F9/F12 — `0o600` on all config writers; extend git arg denylist.
9. F10/F13 — `timingSafeEqual`; move WS token out of the URL; set `maxPayload`; tighten CSP.
10. F11 — pin CI actions to SHAs, add `permissions:` blocks, enable publish provenance.

**Phase 4 — Ongoing:**
11. Schedule `pnpm audit` in CI; align `ws`/`react` versions across packages; treat MCP tool results and fetched content as prompt-injection-tainted in any future feature that turns them into actions.

---

## Methodology & limitations

This is an AI-driven static review (no dynamic exploitation beyond a local prototype-pollution PoC and SSRF-canonicalization checks). Findings carry file:line evidence and were verified for reachability and existing controls; the two High items were re-read at source by the report author. `pnpm audit` is point-in-time. Per-skill raw outputs: `sc-rce-results.md`, `sc-path-traversal-results.md`, `sc-ssrf-results.md`, `sc-webui-results.md`, `sc-secrets-results.md`, `sc-deserialization-results.md`, `sc-lang-ts-cicd-results.md`. Recon: `architecture.md`. Supply chain: `dependency-audit.md`.

# Verified Findings — WrongStack

_Phase 3 verification output. Scan date: 2026-05-29. Findings below survived reachability + control + context analysis. False positives and by-design behaviors were dropped or downgraded._

## Verification method

Each candidate from the Phase-2 hunt was checked for: (a) real reachability from an attacker-controlled input, (b) presence/bypass of existing controls (permission gating, validation, sandbox), and (c) context (test/dead/example code). The two HIGH code-level findings (F1 command injection, F2/F3) were re-read at source and confirmed line-by-line.

## Confirmed findings

| ID | Title | Severity | Confidence | CWE |
|----|-------|----------|-----------|-----|
| F1 | OS command injection via filename in codebase-index parsers | **High** | Confirmed | CWE-78 |
| F2 | Cross-site WebSocket hijacking — agent control surface unauthenticated on loopback | **High** | Confirmed | CWE-1385 / CWE-346 |
| F3 | Tar path traversal (zip-slip) in skill/plugin fetcher | **Medium** | Confirmed | CWE-22 |
| F4 | SSRF in `web_fetch` web-search plugin (no IP/redirect validation) | **Medium** | Confirmed | CWE-918 |
| F5 | DNS-rebinding / TOCTOU in `fetch.ts` SSRF guard (resolved IP not pinned) | **Medium** | Confirmed (documented/accepted) | CWE-918 / CWE-367 |
| F6 | No Host-header validation on WebUI HTTP + WS (enables DNS rebinding) | **Medium** | Confirmed | CWE-350 |
| F7 | Fleet cost-cap bypass via per-subagent budget auto-extend | **Medium** | Confirmed | CWE-770 / logic |
| F8 | Non-atomic `RecoveryLock` write (race / corruption) | **Medium** | Confirmed | CWE-367 |
| F9 | Config files created without `0o600` (umask-default perms) | **Low** | Confirmed | CWE-276 |
| F10 | Non-constant-time WS auth-token comparison | **Low** | Confirmed | CWE-208 |
| F11 | CI/CD: actions on mutable tags, no top-level `permissions:`, no publish provenance | **Low** | Confirmed | CWE-1357 / CWE-732 |
| F12 | `git -c`/`--config` not in exec denylist (arg injection within git) | **Low** | Confirmed | CWE-88 |
| F13 | WS token in URL query; standalone WS missing `maxPayload`; CSP `unsafe-inline` | **Low** | Confirmed | CWE-598 / CWE-400 / CWE-1021 |
| F14 | `compileUserRegex` ReDoS blocklist is non-exhaustive (bounded input) | **Low** | Suspected | CWE-1333 |

## Detail

### F1 — OS command injection via filename in codebase-index parsers — HIGH (CWE-78)
**Locations:** `packages/tools/src/codebase-index/py-parser.ts:251`, `packages/tools/src/codebase-index/refs-extractor.ts:230`, `:256`.
**Evidence:** all three sites build a shell command **string** and pass it to `execSync`, interpolating the indexed file's path directly into the string — schematically `execSync("python \"<scriptPath>\" \"<filePath>\"")`, `execSync("go run \"<scriptPath>\" \"<filePath>\"")`, and `execSync("python -c \"<script>\" \"<filePath>\"")`. `execSync` runs through `/bin/sh -c` on POSIX (and `cmd.exe` on Windows). Command substitution (`$(…)`, backticks) executes **even inside double quotes** in `sh`, and a `"` in the name breaks out of the quoting entirely.
**Scenario:** the user opens/clones an untrusted repository and the agent runs codebase indexing (the index tool is `permission:'auto'`). A file whose name contains a backtick/`$()` command-substitution payload (all legal POSIX filenames) is passed to the Python/Go ref extractor → arbitrary command execution as the user. Requires `python`/`go` installed for the respective path.
**Why exploitable:** attacker controls the filename; no escaping/allowlist; auto permission; reachable from the normal indexing flow on a hostile repo. **Remediation:** switch all three sites to the argv-array form `execFileSync('python', [scriptPath, filePath], …)` (no shell, no interpolation); for the `-c <script>` form, write the script to a temp file and pass it as an argv element rather than embedding it in a command string.

### F2 — Cross-site WebSocket hijacking on loopback — HIGH (CWE-1385/346)
**Location:** `packages/webui/src/server/index.ts` (WS `verifyClient` ~`:442` and upgrade path).
**Evidence/posture:** servers default to loopback bind (`127.0.0.1`/`::1`). A per-process 128-bit token gates **non-loopback** WS clients, but **loopback-origin browsers connect token-free by design**, and there is **no Origin allowlist and no Host-header check**. The WS surface drives `agent.run` → `bash`/`read`/`write`/`git` tools and key/provider management.
**Scenario:** while the WebUI is running, the user visits a malicious web page. That page opens a WebSocket to `ws://127.0.0.1:<port>/…`; the browser permits it, the server accepts it (loopback origin, no token, no Origin check), and the page now drives the local agent — effectively RCE on the user's machine. DNS rebinding (F6) extends this even to the token-gated path.
**Remediation:** require the session token for **all** WS connections (including loopback); validate the `Origin` header against an allowlist; reject upgrades whose `Host` is not `localhost`/`127.0.0.1:<port>`. See F6.

### F3 — Tar path traversal (zip-slip) in skill/plugin fetcher — MEDIUM (CWE-22)
**Location:** `packages/core/src/skills/github-fetcher.ts:137,154` (`extractTar`).
**Evidence:** `relPath` (from the tar entry name) is only checked for `''`/`'.'`/`'..'`; `path.join(destDir, relPath)` is then written/mkdir'd **without verifying it stays under `destDir`**. A `..`-containing entry escapes the temp dir → arbitrary file write.
**Mitigating factors (why Medium not High):** the archive is fetched from `api.github.com` over HTTPS, and GitHub generates tarballs from git trees — **git refuses `..` path components**, so a normal GitHub repo cannot carry an escaping entry. Symlink entries are explicitly skipped, closing the symlink vector. Exploitability therefore requires a non-GitHub source or a GitHub-side anomaly.
**Remediation:** after computing the destination, assert `path.resolve(destPath).startsWith(path.resolve(destDir) + path.sep)` and skip otherwise. Cheap defense-in-depth; the extractor is generic and may be reused for non-GitHub tars later.

### F4 — SSRF in `web_fetch` (web-search plugin) — MEDIUM (CWE-918)
**Location:** `packages/plugins/src/web-search/index.ts:74-96`.
**Evidence:** the fetch performs **no DNS resolution, no IPv6 checks, no redirect re-validation**, and allows `http://`. The target URL is **LLM-chosen**. `::1`, `fd00::/8`, `::ffff:169.254.169.254`, and a redirect to a private host all pass.
**Remediation:** route this through the hardened guard in `tools/src/fetch.ts` (see F5) instead of calling `fetch()` directly; block non-http(s) schemes and private/link-local/IMDS ranges incl. IPv6.

### F5 — DNS-rebinding / TOCTOU in `fetch.ts` SSRF guard — MEDIUM (CWE-918/367)
**Location:** `packages/tools/src/fetch.ts:200-220`.
**Verdict:** the guard is otherwise **strong** — `redirect:'manual'` with per-hop re-validation, fail-closed parsing, full IPv4/IPv6 private + IMDS ranges, and WHATWG-`URL` canonicalization defeats octal/hex/decimal/IPv4-mapped/trailing-dot tricks (verified empirically). Its **one gap**: the `dns.lookup` result is validated but discarded, and `fetch()` re-resolves independently, so the safe IP is never pinned (classic rebinding window). The authors document and accept this for single-tenant use; gated by `permission:'confirm'`.
**Remediation:** pin the validated IP via a custom undici `connect`/`lookup` so the connection uses the address that passed the check.

### F6 — No Host-header validation on WebUI — MEDIUM (CWE-350)
**Location:** WebUI HTTP + WS request handling (`packages/webui/src/server/index.ts`).
**Evidence:** neither the HTTP server nor the WS upgrade validates the `Host` header against a localhost allowlist — the standard defense against DNS rebinding of localhost services. Combined with F2, a rebinding attack reaches the agent control surface.
**Remediation:** reject any request/upgrade whose `Host` is not `127.0.0.1:<port>` / `localhost:<port>` / `[::1]:<port>`.

### F7 — Fleet cost-cap bypass via budget auto-extend — MEDIUM (logic / CWE-770)
**Location:** `packages/core/src/coordination/director.ts:684-689` (cap checked at `spawn()`) vs `:587-590` (threshold→extend handshake).
**Evidence:** `directorBudget.maxCostUsd` is enforced only when spawning a new subagent; the auto-extend path that raises a per-subagent budget on `budget.threshold_reached` never re-checks the fleet cap. Already-running subagents can each extend (default up to ~$100 × up to 5 extensions × N live subagents), blowing past a small fleet cap.
**Mitigating factor:** the handshake is fail-closed (stops if no listener / on timeout); permission policy keeps `bash`/`write`/`exec` denied for subagents and escapes glob metacharacters. **Remediation:** re-evaluate `maxCostUsd` (and aggregate spend) inside the extend/threshold handler, not only at spawn.

### F8 — Non-atomic RecoveryLock write — MEDIUM (CWE-367)
**Location:** `packages/core/src/storage/recovery-lock.ts:135-149`.
**Evidence:** writes to a fixed `.tmp` name without the `wx` exclusive flag and `rename`s with no Windows retry — while the repo's hardened `atomicWrite` (`utils/atomic-write.ts`) is available but unused. Concurrent runs can corrupt the lock / race the claim. **Remediation:** route through `atomicWrite` with a unique temp name and exclusive create.

### Low-severity (F9–F14)
- **F9 (CWE-276):** `~/.wrongstack/config.json` and friends created without `{mode:0o600}` at `init.ts:81`, `picker.ts:41`, `plugin-management.ts:177,200`, `mcp.ts:80,104` → umask-default (often group/world-readable). Mitigated: secrets are AES-GCM ciphertext and the `.key` itself is `0o600`. Fix: pass `0o600` on create (as `auth-menu.ts`, `webui-server.ts`, `secret-vault.ts` already do).
- **F10 (CWE-208):** WS token compared with `===` at `server/index.ts:442`; use `crypto.timingSafeEqual`.
- **F11 (CWE-1357/732):** `.github/workflows/*` pin third-party actions to mutable major tags (`@v4`/`@v2`) incl. the release job holding `NPM_TOKEN`; `ci.yml` has no top-level `permissions:` block (defaults to broad token); npm publish grants `id-token: write` but emits no provenance. Pin to commit SHAs, add least-privilege `permissions:`, enable `--provenance`.
- **F12 (CWE-88):** `git -c`/`--config` not in the `exec.ts` denylist; allows config arg-injection within an otherwise-allowlisted `git` invocation. Add `-c`/`--config`/`--upload-pack`/`--exec` to the git arg denylist.
- **F13 (CWE-598/400/1021):** WS token carried in the URL query (risk of access-log capture); standalone WS lacks `maxPayload`; CSP uses `script-src 'unsafe-inline'` and the SPA fallback is CSP-less.
- **F14 (CWE-1333, suspected):** `_regex.ts compileUserRegex` blocklist is self-described non-exhaustive; subject is 64 KB-capped so worst case is bounded CPU seconds, not unbounded.

## Eliminated / downgraded (false positives & by-design)

- **`bash` tool** runs arbitrary commands **by design** — gated by `permission:'confirm'` + `mutating` + ProcessRegistry. Not a vuln (the product's escape hatch).
- **`exec.ts`, `git.ts`, `install.ts`, lint/test/typecheck/format, MCP stdio spawn, ACP transport, all CLI git/npm spawns** use **argv-array** `spawn`/`spawnSync` — no shell, no injection. Strong control verified.
- **WebUI static file server** is **safe** — resolves then enforces `startsWith(root + sep)` (blocks even percent-encoded `..`).
- **All other filesystem tools** route through `safeResolve` (project-root containment); `replace.ts` adds lstat+realpath, `patch.ts` forces containment, `grep.ts` skips symlinks.
- **Secret vault** crypto is **sound**: AES-256-GCM, per-encrypt random 12-byte IV, CSPRNG 256-bit key at `0o600` created with exclusive `wx`, auth tag stored and verified, no deprecated password-based cipher, no plaintext fallback.
- **No prototype pollution**: the reachable deep/shallow merge helpers assign into fresh object literals — `__proto__` PoC did not pollute (verified).
- **No insecure deserialization**: session JSONL / goal.json / director-state / MCP JSON-RPC all validate a discriminator/version; replayed `tool_use` blocks are never executed.
- **Codebase-index JSON/YAML parsers** are regex extractors — no untrusted-data structural deserialization, no tag/anchor resolution.
- **telegram / update-check / github-fetcher network** use fixed operator/public origins — no host-control SSRF.
- **No hardcoded live secrets** — only obvious dummy values in test fixtures. `secret-scrubber.ts` actively redacts.
- **MCP tool results** are an external **prompt-injection** surface (informational) but never reach a code-eval/shell/path sink.

_Note on AI-agent threat model: the highest-impact realistic vector is a hostile repository or web page reaching the auto-permissioned surfaces (F1 indexing, F2 WebSocket). The interactive `confirm` gate on `bash`/`write`/`fetch` is the main backstop — keep auto-permission tools free of shell/path interpolation._

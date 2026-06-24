# 🛡️ Security Report — WrongStack

**Scan date:** 2026-06-24
**Scope:** Full repository (pnpm monorepo, ~1,900 TS/TSX files), focused on the
security-critical attack surface of a local-first agentic coding CLI.
**Method:** 4-phase pipeline (Recon → Hunt → Verify → Report), manual source audit
with direct file tools.

---

## Executive summary

WrongStack is an unusually well-secured codebase. The audit found **no exploitable
vulnerabilities** in the crown-jewel attack surfaces (command execution, secret
storage, permission/trust, config merge, network egress/ingress, HTML rendering).
The code shows the fingerprints of sustained security work — DNS-pinned SSRF
defense, constant-time auth, scrypt-wrapped key files, an untrusted-config denylist,
and prototype-pollution guards are all present and correctly implemented.

Two items are recorded as **Low / Informational** — both are defense-in-depth
hardening opportunities that were traced and confirmed **not** to be exploitable.

| Severity | Count |
|---|---|
| 🔴 Critical | 0 |
| 🟠 High | 0 |
| 🟡 Medium | 0 |
| 🔵 Low | 1 |
| ⚪ Informational | 1 |

**Risk score: 1.5 / 100 (Very Low).**

**Remediation status (2026-06-24): both items FIXED and tested.** See "Fixes applied" below.

---

## Findings

### 🔵 L-1 — IPv6 `::` bind not covered by the WS-auth LAN-deny guard
`packages/webui/src/server/ws-auth.ts:187` · CWE-1188

The `wsHost === '0.0.0.0'` early-deny for non-browser peers doesn't match a `::`
(all-IPv6) bind. **Not exploitable** — a valid constant-time token is still required
on that path. Fix: treat `::` and `0.0.0.0` identically. See `verified-findings.md#L-1`.

### ⚪ L-2 — Windows `.cmd` argument passing (`shell:true` + `windowsVerbatimArguments`)
`packages/tools/src/{exec,outdated,_spawn-stream,spawn-background}.ts` · CWE-88

CVE-2024-27980-class argument passing on the Windows `.cmd` resolution path. **Not an
escalation** — all callers are `confirm`-gated and already execution-equivalent; no
lower-trust input reaches the args. See `verified-findings.md#L-2`.

---

## What was verified sound

Secret vault (AES-256-GCM + scrypt KEK), `fetch` SSRF guard (DNS-pinned, per-hop
revalidated), permission policy (exact-match trust, subagent capability allowlist),
`deep-merge` prototype-pollution guard, in-project config strip, WebSocket auth
(timing-safe token + DNS-rebind guard + HttpOnly cookie), HQ-dashboard output
escaping, `bash`/`git`/`exec` command execution. Details in `verified-findings.md`.

---

## Fixes applied (2026-06-24)

**L-1 — IPv6 `::` bind parity.** Added `isWildcardBind(wsHost)` to
`ws-auth.ts` (matches `0.0.0.0`, `::`, `[::]`) and routed both "LAN exposure =
deny" guards through it instead of the `wsHost === '0.0.0.0'` string check. A
`::` bind is now denied for non-loopback peers exactly like `0.0.0.0`.
Tests: `packages/webui/tests/server/ws-auth.test.ts` (+7 cases, 41 pass).

**L-2 — Windows `.cmd` argument-injection guard.** Added
`assertSafeWin32ShellArgs(args)` to `_win32-resolve.ts` — rejects args containing
cmd.exe command-separator / redirection metacharacters (`& | < > \r \n \0`) and
called it on the `needsShell` (`.cmd`/`.bat` + verbatim) path in `_spawn-stream.ts`,
`exec.ts`, and `outdated.ts`. The set is false-positive-free for legitimate flags
and Windows paths. Tests: `packages/tools/tests/win32-resolve.test.ts` (+4 cases, 9 pass).

Verified: `@wrongstack/tools` + `@wrongstack/webui` typecheck clean;
ws-auth (41), win32-resolve (9), exec/outdated (34) all green.

## Remediation roadmap (remaining / ongoing)

**Maintain posture**
1. Keep `pnpm audit` in the `release:check` gate (already enforced — moderate+ fails).
2. Re-run this scan on changes to `secret-vault`, `permission-policy`, `ws-auth`,
   `fetch`, `config-loader`, and any new network-facing handler.
3. (Optional, larger refactor) Consider dropping `windowsVerbatimArguments: true`
   entirely and relying on Node ≥ 22's built-in `.cmd` arg escaping, which would
   also fix path-with-parens quoting — deferred as it changes command-line
   construction and needs broader Windows spawn validation.

---

## Notes & limitations

- Scanning relied on direct source reading rather than delegated scanner sub-agents,
  per this repo's documented constraint that spawned agents receive an unreliable
  file-read channel in this environment.
- Dependency/CVE auditing is continuously enforced by the existing `pnpm audit` gate
  in `release:check`; a separate point-in-time `dependency-audit.md` was not regenerated.
- MCP server endpoints are configured from trusted user config (stripped from the
  untrusted in-project layer); their outbound connections are by-design and out of
  scope for SSRF classification.

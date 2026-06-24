# Verified Findings — WrongStack

Scan date: 2026-06-24. Methodology: manual source audit of the security-critical
attack surface (this repo's own memory warns that delegated sub-agents get an
unreliable file-read channel here, so scanning was done with direct tools, not
fanned-out scanner agents). Each candidate below was traced to confirm
reachability and exploitability before classification.

## Summary

**0 Critical · 0 High · 0 Medium · 2 Low/Informational**

No exploitable injection, SSRF, auth-bypass, crypto, deserialization, path-traversal,
prototype-pollution, or secret-exposure vulnerability was confirmed in the audited
surface. The codebase carries extensive, well-documented prior remediation
(WS-03 passphrase KEK, WS-06 in-project strip, C-598 query-string token, SSRF DNS
pinning, prototype-pollution guard, #15/#20/#100 fixes).

---

## L-1 (Low / hardening) — WS auth `0.0.0.0` LAN-deny guard does not cover the IPv6 `::` bind

**Status: ✅ FIXED (2026-06-24).** Added `isWildcardBind()` and routed both LAN-deny
guards through it; +7 regression tests in `ws-auth.test.ts` (41 pass).

**File:** `packages/webui/src/server/ws-auth.ts:187`
**CWE:** CWE-1188 (insecure default) — defensive-depth gap, not an exploit.

```js
if (!isRemoteLoopback && wsHost === '0.0.0.0') return false; // LAN exposure = deny
```

The non-browser (no-`Origin`) branch denies non-loopback peers outright only when
`wsHost === '0.0.0.0'` (string match). An operator who binds to `::` (all IPv6
interfaces) or to a specific LAN IP skips this early deny.

**Why it is NOT a vulnerability (verified):** the fall-through return on that branch
is `urlTokenOk || cookieTokenOk || isLoopbackBind(wsHost)`. For a `::`/LAN bind,
`isLoopbackBind` is `false`, so a **valid constant-time token is still required**.
The browser branch with a loopback `Origin` is reachable token-free only when the
page is genuinely served from `localhost` on the connecting host; a cross-site
attacker page carries a non-loopback `Origin` and is forced onto the HttpOnly-cookie
path. No unauthenticated access results.

**Recommendation:** normalize the bind check, e.g. treat `::` and `0.0.0.0` identically
(`const isWildcardBind = wsHost === '0.0.0.0' || wsHost === '::';`) so the "LAN
exposure = deny" intent is consistent across address families.

---

## L-2 (Informational) — Windows `.cmd`/`.bat` argument passing via `shell:true` + `windowsVerbatimArguments`

**Status: ✅ FIXED (2026-06-24).** Added `assertSafeWin32ShellArgs()` guard
(`_win32-resolve.ts`), called on the verbatim `.cmd`/`.bat` path in `_spawn-stream.ts`,
`exec.ts`, `outdated.ts`; +4 tests in `win32-resolve.test.ts` (9 pass).
(`spawn-background.ts` was already safe — it uses `shell:true` without verbatim, so
Node ≥ 22 auto-escapes.)

**Files:** `packages/tools/src/{exec,outdated,_spawn-stream,spawn-background}.ts`
**CWE:** CWE-88 (argument injection) — the CVE-2024-27980 class on Windows.

When resolving a `.cmd`/`.bat` wrapper (npm.cmd, pnpm.cmd) Node requires `shell:true`;
combined with `windowsVerbatimArguments:true`, arguments reach `cmd.exe` unquoted.

**Why it is NOT an escalation (verified):** every tool on this path is
`permission: 'confirm'` (`exec` = `shell.restricted`, `outdated`/`spawn-background`
confirm-gated), and `outdated`'s args are fixed flags — no model- or
network-controlled package name flows into them. These tools are already
arbitrary-execution-equivalent under user confirmation, so no privilege boundary is
crossed that `bash` (also confirm-gated) doesn't already expose.

**Recommendation (defense-in-depth only):** prefer resolving the real executable and
spawning without `shell:true` where feasible, or reject shell metacharacters in args
on the `.cmd` path, to harden against future callers that might feed lower-trust input.

---

## Areas audited and found sound (no findings)

- **Secret vault** (`secret-vault.ts`) — AES-256-GCM, random IV per op, auth tags
  verified, scrypt KEK (N=2^15) for the optional passphrase wrap, key file `0o600` +
  Windows `icacls`, exclusive-create race handling, rotation aborts on undecryptable
  fields. No ECB, no static IV, no MD5/SHA1 for security.
- **`fetch` SSRF** (`fetch.ts`) — HTTPS-only by default, localhost/private-IP/metadata
  blocked, DNS-pinned undici dispatcher eliminates the rebinding TOCTOU, every redirect
  hop re-validated, binary content-type refused, output capped.
- **Permission policy** (`permission-policy.ts`) — exact-match-before-glob trust
  (closes #15), capability allowlist-by-default for subagents, dangerous-capability
  ride-along blocked, mutating tools always confirm.
- **Prototype pollution** (`deep-merge.ts`) — `FORBIDDEN_PROTO_KEYS` skipped on every
  merge; config object built with `Object.create(null)` in the vault walker.
- **In-project config** (`config-loader.ts`) — `stripUnsafeInProjectFields` removes
  `provider/apiKey/baseUrl/providers/mcpServers/hooks/plugins/sync/yolo/extensions`
  before the untrusted layer merges.
- **WS auth** (`ws-auth.ts`) — constant-time `timingSafeEqual` token compare, HttpOnly
  SameSite=Strict cookie, Host-header DNS-rebind guard on loopback binds, browser
  clients restricted to the cookie path (C-598 closed).
- **HQ dashboard XSS** (`hq-dashboard-html.ts`) — all dynamic transcript/agent/tool
  fields HTML-escaped via `escAttr` before `innerHTML`; values land in double-quoted
  attributes or escaped text nodes.
- **`bash`** — `permission: 'confirm'`, shell binary not taken from untrusted `SHELL`
  env (allowlist), kill-guard, pipe-to-shell warning, bounded output, tree-kill teardown.
- **`git`** — `spawn('git', argv)` with no shell; no string interpolation.

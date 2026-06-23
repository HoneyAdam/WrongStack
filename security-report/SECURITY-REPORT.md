# Security Report — WrongStack

**Date:** 2026-06-23
**Scope:** High-risk core (command exec, path traversal, secrets/crypto, SSRF,
deserialization, child-env, local network surface). Pure web-UI vuln classes
de-scoped per scan configuration.
**Method:** Manual source trace of every taint source→sink in scope (subagent
fan-out deliberately not used — file reads are reliable only in-process here).

---

## Executive summary

**Pre-fix risk: HIGH (one Critical). Post-fix residual: LOW.** The deep dive
turned up one genuinely serious issue — **WS-06**: a repo-committed
`.wrongstack/config.json` was merged *above* the user's own config with no field
filtering and no workspace-trust gate, giving a malicious/cloned repo
**arbitrary code execution on launch** (via an `mcpServers`/`hooks` entry, under
default settings) and **provider-API-key exfiltration** (via a `baseUrl`
override). This is now **fixed** (unsafe fields stripped from the in-project
layer + regression tests).

Apart from WS-06, WrongStack runs LLM-generated code against the developer's
machine to a high standard — clear evidence of prior deliberate hardening
(CVE-2024-27980 handling, SSRF connection pinning, constant-time token compares,
DNS-rebinding guards, child-process credential scrubbing, a properly-used AEAD
secret vault, and a model-facing `mcp_control` that cannot inject arbitrary
commands). The remaining items are Low/Info.

| Severity | Count | Notes |
|---|---|---|
| Critical | 1 | WS-06 — fixed |
| High | 0 | (WS-06's exfil variant folded into the same fix) |
| Medium | 0 | |
| Low | 2 | WS-01 — fixed; WS-05 — addressed (corrected to INFO) |
| Info | 3 | WS-02, WS-03, WS-04 — all fixed |

**All six findings are now resolved.** WS-01/02/06 landed in a prior commit on
`main`; WS-03/04/05 are in this session's follow-up branch.

---

## Findings

| ID | Sev | Title | File | Status |
|---|---|---|---|---|
| WS-06 | CRITICAL | Repo-committed `.wrongstack/config.json` merged above user config → RCE-on-launch + API-key exfil | `core/src/storage/config-loader.ts` | ✅ FIXED |
| WS-01 | LOW | Connection-string env vars (`DATABASE_URL`, `REDIS_URL`, …) bypass child-env secret scrub | `core/src/utils/child-env.ts` | ✅ FIXED |
| WS-02 | INFO | `NODE_OPTIONS` forwarded to node children (RCE channel) | `core/src/utils/child-env.ts` | ✅ FIXED |
| WS-03 | INFO | Vault key stored unencrypted alongside ciphertext (by-design) | `core/src/security/secret-vault.ts` | ✅ FIXED (opt-in KEK) |
| WS-04 | INFO | Legacy `?token=` URL WS-auth path (CWE-598) | `webui/src/server/ws-auth.ts` | ✅ FIXED |
| WS-05 | LOW→INFO | `mcp_control enable` spawns unpinned `npx -y` presets | `core/src/tools/mcp-control.ts` | ✅ ADDRESSED (already gated outside YOLO; YOLO path now gated) |

Full detail and remediation in `verified-findings.md`.

### Remediation applied (this session)

**WS-06** was fixed in `packages/core/src/storage/config-loader.ts`: a new
`stripUnsafeInProjectFields()` removes code-execution and credential fields
(`provider`, `apiKey`, `baseUrl`, `providers`, `mcpServers`, `hooks`, `plugins`,
`sync`, `yolo`, `extensions`) from the repo-committed in-project config
**before** it is merged, and logs a `config.in_project_unsafe_fields_ignored`
warning. `extensions` is included because it was confirmed to be a second RCE
vector — the LSP plugin spawns `extensions['@wrongstack/plug-lsp'].servers[].command`
(and the telegram extension holds a bot token). Benign project preferences still
merge; the user's global config, the non-committed project-local config, env,
and CLI flags are untouched. Regression tests in the config-loader suites pass
(20/20 in the extra suite incl. the LSP-via-extensions case; 633/633 across all
core storage tests); core typecheck clean. Tradeoff & follow-ups: team-shared
*plugin* config committed in-repo no longer applies (move to project-local) — a
surgical per-plugin sanitizer is the alternative if that matters; also update
`CLAUDE.md` wording and add `.wrongstack/config.json` to init `.gitignore`.

WS-01 and WS-02 were fixed in `packages/core/src/utils/child-env.ts`:

- **WS-01:** added `valueHasEmbeddedCredential()` — any env value matching
  `scheme://[user]:<password>@host` is dropped before forwarding, regardless of
  the variable name. Credential-free URLs (registries, plain endpoints) still
  forward.
- **WS-02:** added `sanitizeNodeOptions()` — `NODE_OPTIONS` is still forwarded,
  but `--require`/`-r`/`--import`/`--loader`/`--experimental-loader` directives
  (both `=` and space-separated forms) are stripped; if nothing benign remains
  the variable is dropped.
- Both guards are bypassed only in explicit `WRONGSTACK_*_ENV_PASSTHROUGH=1`
  mode (operator opt-in).

Verification: 5 new regression tests in `packages/tools/tests/_env.test.ts`
(18/18 pass); core typecheck clean; related suites (`acp/env-sanitization`,
`core/mcp-servers`) 22/22 pass.

---

## What was verified as SOLID (no action needed)

These are the controls I specifically tried to break and could not:

**Command execution / RCE**
- `bash` is `permission:'confirm'` + `riskTier:'destructive'`; shell resolved
  from an allowlist (untrusted `SHELL`/`COMSPEC` not honored); pipe-to-shell
  patterns logged.
- `exec` enforces a command allowlist **and** a per-command argument blocklist
  that blocks the real escape vectors: `git -c/-C/--exec/--upload-pack`,
  `node -r/-e`, `python -c/-m`, `npm/pnpm run|exec|dlx`, `npx <pkg>`,
  `find -exec`, `docker build|run`, dangerous `rm` targets.
- `git` tool spawns with an **argv array (no shell)** and rejects branch names
  starting with `-` (option-injection guard) and worktree paths that escape root.
- MCP stdio uses `shell:true` on Windows only, with per-token quoting, and the
  command originates from admin/config — not the model. **Verified:** the
  model-facing `mcp_control` tool (`permission:'auto'`) accepts only a server
  *name*, never `command`/`args`, and resolves it against admin config or the
  curated preset catalog — so arbitrary command injection into the spawn is not
  reachable. (The separate spawn-time supply-chain gap is tracked as WS-05.)

**Path traversal (CWE-22 / CWE-59)**
- `safeResolve` confines to project root + `~/.wrongstack`; `assertRealInsideRoot`
  re-checks via `fs.realpath` so an in-root symlink pointing out is blocked.
- Mutating single-file tools (`write`, `edit`) use the realpath-checked resolver;
  `replace`/`grep` do per-file `lstat` + `realpath` containment.

**SSRF**
- `fetch` pins the connection to the validated IP via a custom undici
  dispatcher `lookup` — no DNS-rebinding TOCTOU between check and connect.
- Every redirect hop is re-validated; HTTPS-only by default; binary
  content-types refused.
- `ip-guard` classifier covers 0/8, 10/8, 127/8, **169.254/16 (cloud IMDS)**,
  172.16/12, 192.168/16, 100.64/10 (CGNAT), multicast/reserved, IPv6
  loopback/ULA/link-local, and IPv4-mapped IPv6. Decimal/octal/hex IP tricks are
  caught because the **resolved** address is re-checked, not the literal.

**Secrets & crypto**
- Vault uses AES-256-GCM with a fresh random 12-byte IV per encryption, verifies
  the GCM auth tag, 32-byte random key, key file 0o600 (+ `icacls` on Windows),
  exclusive-create (`wx`) to win key-creation races, and aborts key rotation if
  any field can't be decrypted (prevents silent data loss).
- Config secrets auto-encrypted on write; plaintext keys transparently migrated
  on boot; `config.json` written atomically with 0o600.
- `buildChildEnv` strips `*TOKEN*/*SECRET*/*PASSWORD*/*AUTH*/*KEY*/…` before
  spawning children (the WS-01 gap is the connection-string exception).

**Local network surface (WebUI)**
- Binds `127.0.0.1` by default; `Host`-header DNS-rebinding guard rejects
  rebound attacker pages even when the TCP peer is loopback.
- Constant-time token compare (`timingSafeEqual`); `HttpOnly; SameSite=Strict`
  auth cookie; CSP restricts `connect-src` to loopback; LAN binds (`0.0.0.0`)
  require a token and reject non-loopback peers / untrusted origins.
- **Request handlers behind the gate audited too** (not just the gate):
  static-asset serving enforces `isInsideDist()` (403 on escape) before any
  `readFile` and is immune to `%2e%2e` (WHATWG URL leaves it un-decoded) and
  unencoded `..` (folded by `path.resolve`, then caught) — plus `nosniff` /
  `X-Frame-Options: DENY` / CSP headers; `shell.open` blocks cmd re-parse
  metacharacters (incl. `'`, so the `xterm -e` interpolation can't break out)
  and spawns via argv arrays; `git.info` runs `execFile('git', [fixed args])`
  with no WS-supplied arguments. No injection/traversal found in scope.

**Prototype pollution**
- `deep-merge` skips `__proto__`, `constructor`, `prototype`, and the
  `__define*Getter__/__lookup*` keys at every recursion level.

---

## Remediation roadmap

**Phase 1 — quick wins (low effort, do now)**
- WS-01: extend the child-env value/name heuristic to cover credential-bearing
  URIs (`*_URL`, `*_URI`, `*_DSN`), or redact `user:pass@` in forwarded values.
- WS-02: drop `NODE_OPTIONS` from the forwarded set unless passthrough is on.

**Phase 2 — finish in-flight migrations / harden autonomous paths**
- WS-04: complete the cookie-only WS auth migration; reject `?token=` when an
  `Origin` header is present.
- WS-05: pin MCP preset package versions and require a confirmation (or honor
  each preset's `permission`) at `mcp_control enable`/`restart` spawn time, so
  the model can't autonomously fetch+execute an unpinned npm package.

**Phase 3 — optional hardening**
- WS-03: offer opt-in passphrase-KEK or OS-keychain storage for the vault key.

**Phase 4 — keep it tight**
- Add regression tests asserting `DATABASE_URL`/`NODE_OPTIONS` are not forwarded
  once WS-01/WS-02 are fixed, so the scrub allowlist can't silently regress.

---

## Reports in this directory

- `architecture.md` — attack-surface map and trust boundaries.
- `verified-findings.md` — full per-finding detail with file:line and fixes.
- `SECURITY-REPORT.md` — this file.

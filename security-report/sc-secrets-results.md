# Security Audit — Secrets Handling, Cryptography Misuse, Sensitive-Data Exposure

Scope: WrongStack secret vault, attachment store, atomic-write, config read/write paths,
secret logging, hardcoded secrets. READ-ONLY review. No source files modified.

Auditor focus: `sc-secrets`, `sc-crypto`, `sc-data-exposure`.

---

## Verdict on vault crypto

**The vault cryptography is SOUND.** `DefaultSecretVault` uses authenticated encryption
(AES-256-GCM) with a per-encryption random IV, a CSPRNG-generated 256-bit key stored at
mode `0o600` with exclusive-create race protection, and the GCM auth tag is stored and
**verified** on decrypt. There is no deprecated `crypto.createCipher`, no
unauthenticated CBC/CTR, no nonce reuse, no plaintext fallback in the vault itself, and
no weak hashing (md5/sha1) anywhere in the codebase. The findings below are about
*file permissions on the config file written around the vault* and a couple of minor
hardening gaps — not about the vault primitive.

---

## CONFIRMED FINDINGS

### F1. Canonical config.json written without mode 0o600 on several paths
- **Severity:** Medium (mitigated to Low by encryption-at-rest)
- **CWE:** CWE-276 (Incorrect Default Permissions), CWE-732 (Incorrect Permission Assignment for Critical Resource)
- **Locations:**
  - `packages/cli/src/subcommands/handlers/init.ts:81` — `atomicWrite(deps.paths.globalConfig, JSON.stringify(encrypted, null, 2))` — **no `{ mode: 0o600 }`, no `restrictFilePermissions()`**
  - `packages/cli/src/picker.ts:41` — `atomicWrite(configPath, JSON.stringify(existing, null, 2))` — no mode
  - `packages/cli/src/plugin-management.ts:177,200` — `atomicWrite(deps.configPath, ...)` — no mode
  - `packages/cli/src/subcommands/handlers/mcp.ts:80,104` — `atomicWrite(deps.paths.globalConfig, ...)` — no mode
- **Evidence:** Compare with the paths that DO get it right:
  - `packages/cli/src/auth-menu.ts:839` — `atomicWrite(deps.globalConfigPath, ..., { mode: 0o600 })`
  - `packages/cli/src/webui-server.ts:744` — `atomicWrite(opts.globalConfigPath, ..., { mode: 0o600 })`
  - `packages/core/src/security/secret-vault.ts:200,236` (`rewriteConfigEncrypted` / `migratePlaintextSecrets`) — `{ mode: 0o600 }` + `restrictFilePermissions()` (chmod 0o600 / icacls on Windows).
- **Mechanism:** `atomicWrite` (`packages/core/src/utils/atomic-write.ts:35-43`) stats the *target*; if it already exists it preserves the target's existing mode, otherwise it applies `opts.mode`. With no `opts.mode`, a **freshly created** config file gets the process umask default (commonly `0o644`, group/world-readable).
- **Scenario:** `wstack init` (init.ts) creates `~/.wrongstack/config.json` world-readable. Secret fields are AES-GCM ciphertext (encrypted at rest), so a co-located user reading the file gets ciphertext, not the API key — the per-machine `.key` is 0o600. Real exposure is therefore the *ciphertext + metadata* (provider names, model, baseUrls), not the plaintext key, UNLESS the `.key` is also readable (it is not, by design). Severity stays Medium-trending-Low purely because of the encryption-at-rest mitigation.
- **Exploitability:** Low-to-moderate on multi-user POSIX hosts; nil for the plaintext key (encrypted). The boot-time `migratePlaintextSecrets` does re-assert 0o600 on next launch *if it finds plaintext to migrate* — but on an all-encrypted file it writes nothing (idempotent no-op), so a 0o644 file created by init.ts is **not** re-tightened on subsequent boots.
- **Remediation:** Pass `{ mode: 0o600 }` to every `atomicWrite` that targets `globalConfig`/`config.json` (init.ts, picker.ts, plugin-management.ts, mcp.ts), or route all of them through `rewriteConfigEncrypted`, which already encrypts + chmods. Best: a single `writeGlobalConfig()` helper that always encrypts and always restricts perms.

### F2. config backups (.last / .bak) written without restrictive mode
- **Severity:** Low (mitigated by encryption-at-rest)
- **CWE:** CWE-276
- **Locations:** `packages/cli/src/config-history.ts:207` (`config.json.last`), `:217` (`config.json.{ts}.bak`) — `atomicWrite(last, content)` / `atomicWrite(bakPath, content)` with no `{ mode }`.
- **Evidence:** `content` is the verbatim on-disk config (secrets in encrypted form). These are **fresh files** (new `.last` / timestamped `.bak`), so they get umask-default perms, not 0o600.
- **Scenario:** Same as F1 — ciphertext + config metadata exposed to other local users; plaintext keys are not, because they are encrypted. Note history *entry* snapshots (`appendHistory` → `maskConfigSecrets`, config-history.ts:108-121) correctly redact secrets to `[REDACTED]`, so the `config.history/entries/*.json` files are clean.
- **Remediation:** Pass `{ mode: 0o600 }` to the `.last` and `.bak` `atomicWrite` calls.

### F3. WebSocket auth token compared with non-constant-time `===`
- **Severity:** Low
- **CWE:** CWE-208 (Observable Timing Discrepancy)
- **Location:** `packages/webui/src/server/index.ts:442` — `const tokenOk = providedToken === wsToken;`
- **Evidence:** Token is generated with a CSPRNG — `randomBytes(16).toString('hex')` (index.ts:422) = 128 bits of entropy. Comparison is plain string `===`, not `crypto.timingSafeEqual`.
- **Scenario:** Theoretical remote timing oracle on token comparison. With 128-bit random tokens and network/WS-handshake jitter dwarfing per-byte compare time, this is not practically exploitable, but it is a deviation from constant-time-compare best practice for auth secrets.
- **Remediation:** Use `crypto.timingSafeEqual(Buffer.from(providedToken), Buffer.from(wsToken))` guarded by a length check. (Also note: `index.ts:451` intentionally bypasses token auth for localhost binds — a deliberate local-dev convenience, flagged here for awareness, not as a secrets defect.)

---

## SUSPECTED / INFORMATIONAL (not defects)

- **WS token log is masked — OK.** `packages/webui/src/server/index.ts:425` logs only `wsToken.slice(0,4)…slice(-4)` of a 32-hex-char token. Acceptable; 8 of 32 chars revealed is well within safety margin for a 128-bit token.
- **Provider auth headers — OK.** API keys placed in `x-api-key` / `Authorization: Bearer` at `packages/providers/src/anthropic.ts:62,69`, `openai.ts:54`, `presets/*.ts`. No header/body logging found (`console.*(headers|body|request)` grep returned 0 matches). 
- **`secret-scrubber.ts` is a positive control.** `packages/core/src/security/secret-scrubber.ts` actively redacts Anthropic/OpenAI/GitHub/AWS/GCP/Slack/Stripe/Twilio/Telegram keys, JWTs, PEM private keys, DB URIs, and `Bearer` tokens from text/objects (ReDoS-aware: bounded quantifiers, alternation instead of lookbehind, 64 KB chunking). Strength, not a finding.
- **Env-sourced secrets are stripped before persistence — OK.** `packages/core/src/storage/config-store.ts:9-23` (`stripEphemeralFields`) removes `apiKey`/`baseUrl` that came from env so `WRONGSTACK_API_KEY` is never written to disk.
- **Prototype-pollution guard — OK.** `secret-vault.ts:FORBIDDEN_PROTO_KEYS` blocks `__proto__`/`constructor`/`prototype` in `deepMerge`; walk functions use `Object.create(null)`.
- **`Math.random()` usages are all non-security.** Confirmed src uses: retry jitter (`core/src/execution/retry-policy.ts:30`), metrics reservoir sampling (`core/src/observability/metrics.ts:80`), MCP reconnect jitter (`mcp/src/registry.ts:240`), launch-hint rotation (`cli/src/launch-hints.ts:145`), toast IDs (`webui/.../Toaster.tsx:32`). None used for tokens/IDs/secrets. The security-relevant random — vault key, vault IV, atomic-write temp suffix, attachment IDs, WS token — all use `node:crypto` `randomBytes`. Not a finding.
- **No deprecated cipher / weak hash.** `createCipher(` grep = 0 matches; `createHash('md5'|'sha1')` grep = 0 matches across `packages/**`.
- **No hardcoded secrets in source.** The only `sk-ant-…` / `sk-…` / `AKIA…` style hits are in **tests/fixtures** (`packages/providers/tests/anthropic.test.ts`, `packages/tools/tests/_env.test.ts`, `packages/acp/tests/env-sanitization.test.ts`, `core/tests/security/secret-scrubber.test.ts`) and the scrubber's own regex literals. All are obvious dummy values (`sk-ant-XYZ`, `sk-ant-test-secret-123`, `sk-ant-xxx`) — **no real-looking live secrets** in fixtures. Not a finding.
- **Attachment store — OK.** `packages/core/src/storage/attachment-store.ts` spools large payloads via `atomicWrite`; spool files are not secrets by nature and are unlinked on `clear()`. IDs use `randomBytes(3)` (collision-resistance only, fine). No sensitive-data exposure.

---

## Vault strengths (explicit)

- AES-256-GCM authenticated encryption (`secret-vault.ts:16`), random 12-byte IV per encrypt (`:38`), 16-byte auth tag stored and verified (`:41,:63-64`).
- IV / tag / ciphertext stored together, base64, behind a versioned `ENCRYPTED_PREFIX` sentinel — clean wire format with length validation on decrypt (`:57-58`).
- 256-bit key from `randomBytes(32)`, written with `flag: 'wx'` (exclusive create, TOCTOU-safe) at `mode: 0o600` (`:101`); EEXIST race loser re-reads the winner's key.
- Wrong-size key file → hard error instead of silently minting a new key that would orphan all existing secrets (`:80-88`).
- Per-field decrypt failures are isolated and zeroed (never leave ciphertext in memory as if it were a key) with a warning (`decryptConfigSecrets`, `:135-149`).
- Cross-platform perm hardening: chmod 0o600 on POSIX, `icacls /inheritance:r /grant:r` on Windows (`restrictFilePermissions`, `:243-264`).
- atomic-write everywhere for config (no torn writes wiping encrypted keys), with Windows EPERM/EBUSY rename retry.

---

## Summary line

Vault crypto is **sound** (AES-256-GCM, random IV, verified tag, 0o600 CSPRNG key, no
plaintext fallback). Issues are file-permission gaps on the config file/backups
(F1/F2 — CWE-276, mitigated by encryption-at-rest) and a non-constant-time WS token
compare (F3 — CWE-208). No hardcoded live secrets, no weak hashing, no insecure
`Math.random()` for secrets, no secret logging beyond a properly-masked WS token.

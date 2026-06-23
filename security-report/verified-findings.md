# Verified Findings — high-risk-core scan

Each finding below was manually traced to source (no automated-scanner false
positives). Confidence reflects how certain the issue is *and* how reachable it
is under the real threat model.

---

## WS-06 (CRITICAL → HIGH) — Repo-committed `.wrongstack/config.json` is merged above user config with no field filter or trust gate  ✅ FIXED

- **Status:** Fixed this session via `stripUnsafeInProjectFields()` +
  regression tests. See remediation at the end of this entry.
- **CWE:** CWE-94 (Code Injection) / CWE-522 (Insufficiently Protected
  Credentials) / CWE-1188 (Insecure Default) — the "untrusted workspace" class.
- **Files:** `packages/core/src/storage/config-loader.ts:224-231,435-465`,
  `packages/core/src/utils/wstack-paths.ts:172`,
  `packages/cli/src/cli-main.ts:821-828`, `config-loader.ts:67` (`features.mcp:true`)
- **Confidence:** 95 — every link verified directly against source (the
  delegated explorer flagged the area; all line-level claims re-confirmed by
  hand per the project's "subagents may hallucinate file reads" caveat).

**The chain.** The config loader reads three JSON layers and deep-merges them in
precedence order:

```ts
// config-loader.ts:224-231
const [global, local, inProject] = await Promise.all([
  this.readJson(this.paths.globalConfig),       // ~/.wrongstack/config.json (user)
  this.readJson(this.paths.projectLocalConfig), // ~/.wrongstack/projects/<h>/config.local.json
  this.readJson(this.paths.inProjectConfig),    // <project>/.wrongstack/config.json  ← REPO-COMMITTED
]);
cfg = deepMerge(cfg, global);
cfg = deepMerge(cfg, local);
cfg = deepMerge(cfg, inProject);   // merged LAST → highest precedence, NO field filter
```

`inProjectConfig` is `<project>/.wrongstack/config.json` (`wstack-paths.ts:172`),
which lives **inside the repository** and is therefore attacker-controllable via
a PR or a repo a victim clones. `readJson` does no filtering, and there is **no
workspace-trust gate** — `trust.json`/`projectTrust` is only the tool-permission
store fed to `DefaultPermissionPolicy` (`runtime/container.ts:118`), not a gate
on config loading. The `wstack-paths.ts:62` comment claims "safe fields only"
but nothing enforced it. This directly contradicts `CLAUDE.md`'s stated
assumption that "the only repo-committed config is `.wrongstack/AGENTS.md`".

**Two exploit variants, no user prompt:**

1. **RCE on launch (Critical).** `features.mcp` defaults to `true`
   (`config-loader.ts:67`), and `cli-main.ts:821-828` starts every
   `config.mcpServers` entry at boot via `mcpRegistry.start(cfg)`. Config-sourced
   servers carry an **arbitrary `command`** (unlike `mcp_control`, which is
   restricted to curated presets). A malicious repo:
   ```json
   { "mcpServers": { "x": { "transport": "stdio", "command": "<any cmd>", "enabled": true } } }
   ```
   → arbitrary command execution the moment the victim runs the agent in that
   directory. `hooks` and `plugins` give the same outcome via different boot paths.

2. **API-key exfiltration (High).** A repo-set `baseUrl` (top-level or
   `providers.<x>.baseUrl`) merges over the user's endpoint while the user's
   *real* decrypted API key is preserved (per-key deep-merge). The provider
   adapter then sends `Authorization: Bearer <user key>` to the attacker host on
   the first model call. `apiKey`/`sync`/`yolo` are similarly abusable
   (`yolo:true` disables every confirmation prompt).

Rated Critical because the RCE variant fires under **default settings** with no
interaction beyond running the agent in a cloned repo — the canonical
"workspace-trust" threat for a coding agent.

- **Remediation applied:** added `stripUnsafeInProjectFields()` in
  `config-loader.ts`, applied to the `inProject` layer before merge. It removes
  the forbidden top-level keys `provider`, `apiKey`, `baseUrl`, `providers`,
  `mcpServers`, `hooks`, `plugins`, `sync`, `yolo`, `extensions` and emits a
  `config.in_project_unsafe_fields_ignored` warning naming what was dropped.
  Benign project prefs (model, context, tools limits, features, autonomy,
  indexing, …) still merge, so legitimate committed `.wrongstack/config.json`
  files keep working. The user's `~/.wrongstack/config.json`, env vars, and CLI
  flags are unaffected. The autonomous `mcp_control enable` flow is unaffected —
  it writes to the *global* config path, not the in-project file.
  - Tests: 2 new cases in
    `packages/core/tests/storage/config-loader-extra.test.ts` (51/51 pass).
  - **`extensions` confirmed exploitable and now stripped:** the LSP plugin
    reads `extensions['@wrongstack/plug-lsp'].servers` from the merged config and
    **spawns** each server's `command`/`args` (`plug-lsp/config.ts:86-92`,
    `autoStart` eager/lazy), and the telegram extension holds a bot token. So a
    repo's `extensions` block was a second RCE + credential vector. It is now in
    the strip list (fail-closed). **Product tradeoff:** team-shared per-project
    *plugin* config committed to the repo no longer applies — move it to the
    user-controlled, non-committed `~/.wrongstack/projects/<hash>/config.local.json`
    layer. If preserving committed plugin tuning matters more than the
    hardening, replace the blanket `extensions` strip with a surgical per-plugin
    sanitizer (drop only `servers[].command`/`env` + credential keys).
  - **Other follow-ups:** (a) align `CLAUDE.md` wording with the now-real
    behavior; (b) consider adding `.wrongstack/config.json` to the init
    `.gitignore`.

---

## WS-01 (LOW) — Connection-string env vars bypass the child-env secret scrub  ✅ FIXED

- **Status:** Fixed this session via `valueHasEmbeddedCredential()` +
  regression tests. See bottom of this section.
- **CWE:** CWE-200 / CWE-552 (Information Exposure to child process)
- **File:** `packages/core/src/utils/child-env.ts:56-84,149`
- **Confidence:** 85 (logic confirmed) / Reachability: medium

`buildChildEnv()` scrubs credentials before handing an environment to bash,
exec, and MCP child processes. The scrub matches variable **names** against
`SECRET_NAME_PARTS = [TOKEN, SECRET, PASSWORD, PASSWD, AUTH, CRED, BEARER,
COOKIE, PRIVATE]` plus `*KEY*` patterns. Connection-string variables that embed
credentials in their **value** but whose **name** contains none of those tokens
are forwarded unchanged:

```
DATABASE_URL=postgres://user:p4ss@db.internal/app   → forwarded
REDIS_URL=redis://:p4ss@cache.internal:6379         → forwarded
MONGO_URI=mongodb://user:p4ss@mongo.internal        → forwarded
AMQP_URL / CLICKHOUSE_DSN / SENTRY_DSN ...           → forwarded
```

A compromised/malicious MCP server (or a model-composed shell pipeline that the
user confirms) can read these from its own `process.env` and exfiltrate the
embedded password. The parent-env scrub is the documented control specifically
meant to stop this class ("a compromised MCP server … can leak secrets").

- **Remediation:** add a value-side check for credential-bearing URI schemes, or
  add `URL`, `URI`, `DSN`, `CONN`, `CONNECTION` to the name heuristic (accepting
  that some non-secret `*_URL` vars get dropped — the file already states the
  bias should favor false-positives). Alternatively, redact `user:pass@` inside
  forwarded values.

---

## WS-02 (INFO) — `NODE_OPTIONS` forwarded to node child processes  ✅ FIXED

- **Status:** Fixed this session via `sanitizeNodeOptions()` — preload
  directives stripped, benign flags preserved.
- **CWE:** CWE-426/CWE-94 (code injection via env), defense-in-depth
- **File:** `packages/core/src/utils/child-env.ts:153`
- **Confidence:** 70 / Reachability: low (requires parent-env control)

The `NODE_` prefix allowlist forwards `NODE_OPTIONS` to children. `NODE_OPTIONS=
--require=/tmp/evil.js` is a classic node RCE vector. This is **consistent with
the threat model** (the value must already exist in the operator's real shell
env, which already implies code execution), so it is not a new vulnerability —
but `NODE_OPTIONS` is rarely needed by child builds and is a high-value injection
channel worth closing explicitly.

- **Remediation:** strip `NODE_OPTIONS` (and `NODE_REPL_EXTERNAL_MODULE`) from
  the forwarded set unless passthrough mode is enabled.

---

## WS-03 (INFO) — Vault key stored unencrypted next to ciphertext  ✅ FIXED (opt-in)

- **Status:** Resolved this session via an opt-in passphrase KEK. With
  `WRONGSTACK_VAULT_PASSPHRASE` set, the data key is stored passphrase-wrapped
  (scrypt-derived KEK + AES-256-GCM, key-file format v3) instead of in the
  clear, so stealing `~/.wrongstack/.key` + `config.json` off disk no longer
  yields the secrets. Purely additive: unset = byte-for-byte the old behavior.
  An existing unwrapped key auto-migrates on next load (same data key → existing
  ciphertext still decrypts); a wrapped file throws a clear error if the
  passphrase is missing/wrong. `rotateKey()` preserves the wrapped format.
  `secret-vault.ts` + 7 new tests (`secret-vault-passphrase.test.ts`).

### Original analysis

- **CWE:** CWE-312 (Cleartext storage), accepted design tradeoff
- **File:** `packages/core/src/security/secret-vault.ts` + `~/.wrongstack/.key`
- **Confidence:** 95 / Impact: by-design

The AES-256-GCM data key lives in `~/.wrongstack/.key` (mode 0o600 / icacls).
This protects `config.json` against being shared, committed, or backed up with
live keys — a real and common win. It does **not** protect against an attacker
who already has read access to the user's home directory (they get both the key
and the ciphertext). This matches the documented "per-machine key" intent.

- **Remediation (optional):** offer an opt-in passphrase-derived KEK (scrypt) or
  OS keychain (Keychain / DPAPI / libsecret) for users who want at-rest
  protection against local theft.

---

## WS-04 (INFO) — Legacy URL-token path for WebSocket browser auth  ✅ FIXED

- **Status:** Resolved this session. `verifyClient` now accepts only the
  HttpOnly cookie for browser clients (those sending an `Origin` header); the
  `?token=` URL path is rejected for them, fully closing the CWE-598 query-string
  token-exposure class. Non-browser clients (no `Origin`: curl/scripts/tests)
  keep the URL-token path for ergonomics — query-string exposure is browser-only.
  The frontend already bootstraps the cookie via `ensureAuthCookie()` before its
  first connect, so this does not break browser access. `ws-auth.ts` + tests
  updated (36/36 pass).

### Original analysis

- **CWE:** CWE-598 (Information Exposure Through Query String)
- **File:** `packages/webui/src/server/ws-auth.ts:159-206`
- **Confidence:** 90 / Impact: low (already mitigated, migration pending)

The preferred WS auth path is the `HttpOnly; SameSite=Strict` cookie set by
`/ws-auth`. A legacy `?token=…` URL path is still accepted for browser clients
"for backward compat", which can leak the token into browser history / proxy
logs. The code already documents this as the C-598 class slated for removal once
the frontend migrates.

- **Remediation:** finish the frontend migration and reject URL tokens for
  requests that carry an `Origin` header (non-browser clients keep the fallback).

---

## WS-05 (LOW→INFO) — `mcp_control enable` spawns unpinned `npx -y` presets  ✅ ADDRESSED (severity corrected)

- **Status / correction:** Deeper verification showed the original write-up
  **overstated** the gap. `mcp_control` declares the `CONFIG_MUTATE` capability,
  which is in `DANGEROUS_FOR_SUBAGENTS`, so the tool-executor's post-permission
  dangerous-capability net (`tool-executor.ts:187-195`) **already forces a
  `confirm` outside YOLO** — enabling a server is *not* un-gated in normal use.
  The only un-gated path was YOLO. Fix this session: marked `mcp_control`
  `riskTier: 'destructive'` so the YOLO `confirmDestructive` safety net also
  prompts before enable/restart (the path that exists precisely to gate
  dangerous ops under YOLO), and clarified the tool description that enabling a
  stdio preset fetches+runs an npm package. Plain YOLO (accept-all-risk) still
  auto-approves by design. Version pinning was **deliberately not done** —
  pinning to guessed/stale `@modelcontextprotocol/server-*` versions would break
  presets, and the confirmation story is the robust control. `mcp-control.ts` +
  tests updated (42/42 pass).

### Original analysis

- **CWE:** CWE-494 (Download of Code Without Integrity Check) / CWE-1357
  (Reliance on insufficiently trustworthy component), supply-chain
- **Files:** `packages/core/src/tools/mcp-control.ts:92-107,217-251`,
  `packages/core/src/infrastructure/mcp-servers.ts:18-114`
- **Confidence:** 80 / Reachability: high (model-callable, `permission:'auto'`)

**Verified safe first:** `mcp_control`'s input schema accepts only `action`,
`query`, and `server` (a name) — *not* `command`/`args`/`transport`/`url`.
`runEnable` resolves the target from the admin's existing config or the built-in
preset catalog (`allServers()`). So the model **cannot inject an arbitrary
command** into the Windows `shell:true` MCP spawn. That original assumption in
this report is confirmed correct.

**The residual issue:** `mcp_control` is `permission:'auto'`, and `runEnable`
calls `registry.start({...cfg, enabled:true})` directly. The built-in presets are
defined as:

```ts
command: 'npx', args: ['-y', '@modelcontextprotocol/server-github']  // unpinned
```

So a model turn can autonomously decide to "enable github", which immediately
spawns `npx -y @modelcontextprotocol/server-github@latest` — **fetching and
executing the latest published version of that package from the npm registry
with no user confirmation at the point of execution.** Two concerns:

1. **No spawn-time gate.** Each preset carries `permission: 'confirm'`, signaling
   intent that these be user-confirmed, but the programmatic `registry.start()`
   call in `runEnable` bypasses the tool-executor confirmation path. The model
   self-extends without a human in the loop.
2. **Unpinned versions.** `npx -y <pkg>` resolves to the latest release, so a
   compromised future version of any curated preset auto-executes. There is no
   integrity pin (version or hash).

The blast radius is limited to the ~15 curated presets (not arbitrary code), so
this is LOW rather than High — but it is a genuine supply-chain + missing-
confirmation gap for an `auto`-permission, model-driven tool.

- **Remediation:**
  - Pin preset versions (`@modelcontextprotocol/server-github@<x.y.z>`), ideally
    with `npm_config_*` integrity or a lockfile-backed install.
  - Require a confirmation for `enable` (honor each preset's `permission` at
    spawn time, or set `mcp_control`'s `enable`/`restart` paths to `confirm`).
  - Consider `--no-install`/offline modes so a preset that isn't already present
    surfaces a prompt rather than silently fetching from the network.

---

## Out-of-scope note

The two uncommitted files in the working tree (`packages/cli/src/fleet/host.ts`,
`packages/core/src/coordination/mailbox.ts`) are internal coordination plumbing
with no new external taint source; no security-relevant change observed.

# Command Injection / RCE Audit — WrongStack command-execution surface

Read-only review (sc-rce / sc-cmdi). Scope: `packages/tools/src/*` exec surface, `packages/mcp` & `packages/acp` transports, and `packages/cli` spawn/exec call-sites.

**Summary:** One CONFIRMED command-injection-via-filename in the `codebase-index` parsers (auto-permission, LLM-reachable, RCE on macOS/Linux). A couple of low-severity shell-string call-sites in the Rust parser. Everything else in scope uses argv-array `spawn`/`spawnStream` with no `shell:true`, plus solid allowlist/denylist/path-sandbox controls — not findings.

---

## Finding 1 — CONFIRMED — Command injection via filename in codebase-index Python/Go parsers

- **Severity:** High
- **CWE:** CWE-78 (OS Command Injection)
- **Files / lines:**
  - `packages/tools/src/codebase-index/py-parser.ts:251` — `execSync(\`python "${scriptPath}" "${filePath}"\`, …)`
  - `packages/tools/src/codebase-index/refs-extractor.ts:230` — `execSync(\`go run "${scriptPath}" "${filePath}"\`, …)`
  - `packages/tools/src/codebase-index/refs-extractor.ts:256` — `execSync(\`python -c "${PY_REFS_SCRIPT.replace(/"/g,'\\"')}" "${filePath}"\`, …)`
  - (`go-parser.ts:278` interpolates only `scriptPath` (a temp path WrongStack controls) and feeds source via stdin — not user-influenced, so not part of this finding.)

**Evidence (py-parser.ts):**
```ts
const stdout = execSync(`python "${scriptPath}" "${filePath}"`, {
  timeout: 15_000, encoding: 'utf8', windowsHide: true,
});
```
`filePath` is interpolated into a shell command string with only double-quote wrapping and **no escaping**. `execSync` runs through `/bin/sh -c` on POSIX, where `$( )`, backticks, and a literal `"` all remain active inside double quotes.

**Trace to source / trust level:**
- `codebase-index` tool (`codebase-index/codebase-index-tool.ts`) → `runIndexer(ctx, { projectRoot })` (`indexer.ts:117`).
- `runIndexer` builds the file list with `findSourceFiles(projectRoot)` walking the project tree (or `opts.files` resolved under projectRoot), then for each file calls `parseFile(file, content, lang)` (`indexer.ts:187`).
- For `lang === 'py'` → `parsePy` → `syncPyParse(filePath …)`; for `lang === 'go'` → `parseGo`/refs path → `extractGoRefs`/`extractPyRefs`. `filePath` is the **absolute path of a file discovered in the workspace** — i.e. it embeds an attacker-controllable filename.
- Trust level: filename comes from the filesystem of whatever project the user opens/indexes (e.g. a cloned third-party repo). Tooling is also directly LLM-callable.

**Why exploitable:**
- The `codebase-index` tool is declared `permission: 'auto'` (`codebase-index-tool.ts:23`) — it runs **without a confirmation prompt** when the model calls it (e.g. autonomy/eternal mode, or any agent loop that decides to index).
- A workspace file named, on macOS/Linux, e.g. `` `a`$(touch /tmp/pwned)`.py `` or `x";id > owned;".py` is walked by `findSourceFiles`, detected as `py`/`go`, and its name is interpolated unescaped into the shell command → arbitrary command execution.
- Net effect: cloning/opening a hostile repo and letting the agent index it (a routine, auto-permission action) yields RCE.
- Caveat on reach: requires `python`/`go` to be installed (else `execSync` throws ENOENT and is swallowed by the surrounding `try/catch`). On Windows the parsers run via `cmd /c`; `cmd` quoting differs and is generally less injectable than `/bin/sh`, but `%VAR%` expansion and quote-breaking are still possible — POSIX is the clear exploit path.

**Remediation:**
- Use argv-array execution instead of a shell string: `execFileSync('python', [scriptPath, filePath], …)` / `spawnSync('go', ['run', scriptPath, filePath], …)`. This removes all shell metachar interpretation. (`go-parser.ts` already demonstrates the safe pattern by passing source via `input:` over stdin.)
- For the `python -c` ref-extractor, write the script to a temp `.py` (as the other parsers do) and pass `[scriptFile, filePath]` as argv rather than building a `-c "..."` shell string.
- Consider rejecting/skipping filenames containing shell metacharacters as defense-in-depth, even after switching to argv.

---

## Finding 2 — SUSPECTED (Low) — Shell-string `cargo metadata` in Rust parser uses cwd-derived path

- **Severity:** Low
- **CWE:** CWE-78
- **File / line:** `packages/tools/src/codebase-index/rs-parser.ts:43`

**Evidence:**
```ts
execSync(
  'cargo metadata --no-deps --format-version 1 --manifest-path ' +
    path.join(toolsDir, 'Cargo.toml'),
  { stdio: 'pipe' },
);
```
`toolsDir = path.join(process.cwd(), 'tools')`. The only interpolated value is derived from `process.cwd()`, not from a walked filename or LLM/MCP input.

**Why mostly-not-exploitable:** The injected segment is the user's own working-directory path. An attacker would need to make the user launch WrongStack from a directory whose name contains shell metacharacters — self-inflicted, not a remote/LLM vector. The companion Rust native parse (`rs-parser.ts:67`) correctly uses `spawnSync('cargo', ['run','--manifest-path', …])` (argv, safe).

**Remediation:** Switch the `cargo metadata` and `cargo run` shell-string calls to `execFileSync('cargo', ['metadata', …, '--manifest-path', join(toolsDir,'Cargo.toml')])` for consistency and defense-in-depth.

---

## Finding 3 — Info — `bash` tool runs an arbitrary shell string (by design)

- **Severity:** Info (intended escape hatch)
- **File / line:** `packages/tools/src/bash.ts:85-107,161`

**Evidence:** `bash -c <command>` / `cmd /c <command>`; `command` comes straight from LLM tool args.

**Why this is acceptable:** It is the documented arbitrary-shell tool. Controls: `permission: 'confirm'` + `mutating: true` + `subjectKey: 'command'` (`bash.ts:36-41`) so each invocation is gated by the permission/trust system; output is byte-capped and the process is registered/killable via the ProcessRegistry circuit breaker. No additional injection finding — the shell *is* the feature. (Worth confirming the deployment never auto-approves `bash`.)

---

## Solid existing controls verified (NOT findings)

- **`exec.ts` (restricted shell)** — `spawn(cmd, args)` **argv array, no `shell:true`** (`exec.ts:231`). Strong allowlist `ALLOWED_COMMANDS` + per-command `BLOCKED_ARG_PATTERNS` (blocks `git --exec=/--upload-pack=/--receive-pack=/-C`, `node -r/-e`, `python -c/-m`, `npm/pnpm run/exec/publish`, `npx <anything>`, `find -exec`, dangerous `rm` targets, `docker build/run`). cwd is resolved and confined under `projectRoot` (`exec.ts` cwd check). `permission: 'confirm'`, `MAX_ARGS=20`. Because execution is argv-array, shell metacharacters (`;`, `&&`, backticks, `$()`) in args are inert.
  - *Gap noted (defense-in-depth, not a vuln given argv):* the git denylist does **not** block `-c`/`--config-env` or `-c protocol.*`/`core.sshCommand`. With argv execution this isn't shell injection, but `git -c core.fsmonitor=… status` style arg-injection through allowlisted git is possible. Low priority; recommend adding `/^-c$/`, `/^--config-env=/` to the git pattern list.
- **`bash.ts`** — see Finding 3.
- **`git.ts`** — `spawn('git', args)` argv array (`git.ts:255`). Args built from a fixed `switch`; branch names with leading `-` rejected (`buildArgs` branch case); `--` separators used before file/branch operands; gitdir bounded under projectRoot (`findGitDir`). Minor: `worktree add` positional branch isn't `-`-guarded, but worktree-add has no RCE-grade flags — Low/none.
- **`install.ts`** — `spawnStream(pkgManager, args)` argv array (`install.ts:113`); package names validated against `PKG_NAME_RE` and rejected if they start with `-` or exceed 200 chars (blocks flag injection / `file:` specifiers). Manager auto-detected from lockfiles. `permission: 'confirm'`.
- **`lint.ts` / `test.ts` / `typecheck.ts` / `format.ts`** — all `spawnStream(cmd, args)` argv arrays via `_spawn-stream.ts` (no shell). Binary chosen from an enum/detection; user `files`/`grep`/`timeout` passed as discrete argv elements after `--`. No shell interpretation. (`typecheck.ts` uses `npx tsc` with a fixed package name — minor supply-chain note only.)
- **`outdated.ts`** — `spawn(manager, ['outdated','--json', …])` argv array, fixed args; the `check` input is not even forwarded to argv. Safe.
- **`_spawn-stream.ts`** — central `spawn(opts.cmd, opts.args, {env: buildChildEnv(), stdio:[…]})` (`_spawn-stream.ts:40`) — **no `shell` option (defaults to false)**. This is the shared safe primitive for install/lint/format/typecheck/test/audit.
- **`scaffold.ts`** — no child process at all; writes files with a `projectRoot` path-escape guard (`scaffold.ts` `rel.startsWith('..')` check) against `{{name}}` traversal. Not an exec surface.
- **`pack.ts`** — just a tool-pack export object; no process execution.
- **`process-registry.ts`** — bookkeeping/circuit-breaker only; does not itself spawn.
- **MCP `transport.ts` (in scope)** — HTTP/SSE/streamable-http only; **no process spawn**. Includes an SSRF guard (`validateTransportUrl`) blocking 169.254.x IMDS and enforcing http/https.
- **MCP stdio spawn** — actually in `packages/mcp/src/client.ts:167`: `spawn(this.opts.command, this.opts.args ?? [], {env: buildChildEnv({extra: opts.env}), stdio})` — argv array, no shell. command/args/env come from the admin-configured MCP server entry (config is the trust boundary; standard MCP behavior). Not a finding.
- **ACP `stdio-transport.ts`** — `ClientTransport.start()` `spawn(this.opts.command, this.opts.args ?? [], {env, cwd, stdio})` (`stdio-transport.ts`) — argv array, no shell; command/args from ACP agent config. Not a finding.
- **CLI** — `subcommands/handlers/update.ts`: `spawn('npm', ['install','-g','wrongstack@latest'])` fixed argv. `slash-commands/commit.ts`: all `spawn('git', args)` argv arrays; commit message passed as `['-m', message]` (value, not shell); push remotes/branch sourced from trusted `git remote`/`rev-parse` output. `index.ts:1262` `spawn('git',['status','--porcelain'])` and `pre-launch.ts:134` `spawn('git',['init'])` — fixed argv. No `shell:true` anywhere in `packages/cli/src`. (`pre-launch.ts` lives at `packages/cli/src/pre-launch.ts`; no `picker.ts` exists in the tree.)

## Out-of-scope note (flagged for completeness)
`packages/plugins/src/{git-autocommit,semver-bump}/index.ts` use `execSync(\`git ${args.join(' ')}\`)` (shell strings). Args appear plugin-internal/static, but these are shell-string git invocations outside the requested scope — worth a follow-up pass if plugin args can ever carry external data.

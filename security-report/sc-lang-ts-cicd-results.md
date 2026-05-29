# Security Audit — TS weaknesses, ReDoS, CI/CD supply-chain, TOCTOU, business-logic

Target: WrongStack @ D:\Codebox\PROJECTS\WrongStack
Scope: READ-ONLY. No source files modified.
Date: 2026-05-29

Legend: CONFIRMED = code path verified present and reachable; SUSPECTED = plausible but
depends on runtime conditions not fully proven in this pass. SHA-pinning items are
hardening recommendations (not vulnerabilities) per scope rules.

---

## PART A — CI/CD (.github/workflows/ci.yml, release.yml)

### A1. No top-level `permissions:` block in ci.yml → default GITHUB_TOKEN scope
- Severity: Low (Medium on private-action-rich repos)
- CWE: CWE-732 (Incorrect Permission Assignment for Critical Resource)
- File: `.github/workflows/ci.yml:1-45` (entire file — no `permissions:` key anywhere)
- Evidence: `ci.yml` declares `on: [push, pull_request]` and a `gate` job but never sets
  `permissions:`. The default token scope is whatever the repo/org default is
  (historically `write-all`, now often `read` for new repos — depends on org settings,
  so it is not guaranteed restricted).
- Scenario: A compromised dependency executing during `pnpm install`/`pnpm build`/`pnpm test`
  on a `pull_request` from a fork could use `GITHUB_TOKEN` for whatever the default grants.
- Exploitability: Low — CI only runs `pnpm install --frozen-lockfile` + build/test; no
  step uses the token, and `pull_request` (not `pull_request_target`) runs in the fork's
  restricted context with read-only token by default on forks.
- Remediation: Add explicit least-privilege block to ci.yml:
  ```yaml
  permissions:
    contents: read
  ```
- Status: CONFIRMED (missing block); impact bounded.

### A2. release.yml `permissions:` is appropriately scoped — informational
- Severity: Informational (no finding)
- File: `.github/workflows/release.yml:8-11`
- Evidence: `permissions: { contents: write, id-token: write }`. `contents: write` is
  needed for `softprops/action-gh-release@v2`; `id-token: write` is present for OIDC.
  Scope is reasonable for a release job. No over-broad grant.

### A3. Third-party actions pinned to mutable major tags, not commit SHAs
- Severity: Medium (supply-chain hardening)
- CWE: CWE-1357 (Reliance on Insufficiently Trustworthy Component) / CWE-494
- Files:
  - `.github/workflows/ci.yml:23` `actions/checkout@v4`
  - `.github/workflows/ci.yml:25` `pnpm/action-setup@v4`
  - `.github/workflows/ci.yml:29` `actions/setup-node@v4`
  - `.github/workflows/release.yml:18` `actions/checkout@v4`
  - `.github/workflows/release.yml:20` `pnpm/action-setup@v4`
  - `.github/workflows/release.yml:24` `actions/setup-node@v4`
  - `.github/workflows/release.yml:62` `softprops/action-gh-release@v2`
- Evidence: All third-party actions use a floating major-version tag. A tag is mutable —
  a compromised upstream action repo (or a maintainer-account takeover) can repoint `@v4`
  at malicious code that then runs in the **release** job where `NODE_AUTH_TOKEN`
  (`secrets.NPM_TOKEN`) and `id-token: write` are available.
- Scenario: Upstream `softprops/action-gh-release` is compromised → repointed `v2` tag →
  runs during release with the npm publish token already in the job env.
- Exploitability: Low day-to-day, High impact if upstream is compromised. This is the
  classic supply-chain hardening gap.
- Remediation: Pin to full 40-char commit SHAs with a trailing version comment, e.g.
  `uses: actions/checkout@<sha> # v4.2.2`. Enable Dependabot for `github-actions`.
- Status: CONFIRMED (hardening rec, Medium per scope).

### A4. npm publish without provenance / `--provenance`
- Severity: Low (supply-chain hardening)
- CWE: CWE-345 (Insufficient Verification of Data Authenticity)
- File: `.github/workflows/release.yml:56-59`
- Evidence: `pnpm -r publish --no-git-checks --access public` with
  `NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}`. The job already grants `id-token: write`
  (release.yml:10) — the prerequisite for npm provenance — but no provenance flag is set,
  so published packages carry no signed provenance attestation. (Note: pnpm provenance
  support and exact flag plumbing vary; verify pnpm version supports it.)
- Scenario: Consumers cannot cryptographically verify the package was built by this CI.
- Exploitability: N/A (integrity feature gap, not an exploit).
- Remediation: Enable provenance (e.g. `NPM_CONFIG_PROVENANCE=true` env, or
  `--provenance` if the pnpm version supports it) so the existing `id-token: write` is used.
- Status: CONFIRMED gap; Low.

### A5. Script-injection via `${{ github.event.* }}` — NOT PRESENT (negative finding)
- Severity: Informational
- Evidence: `grep` for `github.event`, `github.head_ref`, `pull_request_target` across
  `.github/` returned **0 matches**. No untrusted GitHub-context values are interpolated
  into any `run:` step. The only interpolations are `${{ matrix.os }}` (ci.yml:20),
  `${{ steps.version.outputs.VERSION }}` (release.yml:48,66 — derived from the git tag via
  `${GITHUB_REF_NAME#v}`), and `${{ secrets.NPM_TOKEN }}` (release.yml:59, passed via env
  not interpolated into a shell string). `GITHUB_REF_NAME` for a `tags: ['v*']` trigger is
  constrained to tag names the pusher controls but is not free-form attacker HTML/markdown.
- Status: CONFIRMED clean for the classic title/body/branch injection class.

### A6. No `pull_request_target` + PR-head checkout — NOT PRESENT (negative finding)
- Severity: Informational
- Evidence: ci.yml triggers on `pull_request` (not `pull_request_target`) and checks out
  the default ref. No secrets are exposed to fork PR runs. Clean.

---

## PART B — ReDoS / regex

### B1. fetch.ts htmlToMarkdown runs regexes on fully attacker-controlled HTML — LINEAR (negative finding, with caveat)
- Severity: Low (defense-in-depth note)
- CWE: CWE-1333 (Inefficient Regular Expression Complexity) — assessed NOT triggered
- File: `packages/tools/src/fetch.ts:346-388` (`htmlToMarkdown`, `stripTags`)
- Evidence: Input is the body of an arbitrary fetched URL (untrusted, attacker can host
  the page). Regexes used:
  - `:349` `/<script[\s\S]*?<\/script>/gi`, `:350` style, `:351` noscript — **lazy** `[\s\S]*?`, single quantifier, no nesting.
  - `:353` `/<h([1-6])[^>]*>([\s\S]*?)<\/h\1>/gi` — `[^>]*` then lazy `[\s\S]*?`; the two
    quantified regions are delimited by `>` / `<` so they do not overlap; no exponential path.
  - `:360` `/<a [^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi` — `[^>]* ... [^>]*` both bounded
    by `"` and `>`; `[^"]+` bounded by `"`. No nested quantifier over the same alphabet.
  - `:387` `stripTags` `/<[^>]+>/g` — single linear class.
  - The body is hard-capped at `MAX_BYTES = 131_072` (fetch.ts:18, enforced at :153),
    so subject length is bounded to 128 KB regardless.
- Assessment: No catastrophic-backtracking construct (no `(a+)+`, `(.*)*`, or overlapping
  alternation). Worst case is linear/near-linear over a 128 KB-bounded string. NOT a ReDoS.
- Note (defense-in-depth, not a vuln): these run synchronously after the 20 s fetch
  timeout fires, so a pathological-but-linear 128 KB input adds only ms. Acceptable.
- Status: CONFIRMED not exploitable as ReDoS.

### B2. Codebase-index language parsers — bounded character classes, no ReDoS (negative finding)
- Severity: Informational
- Files:
  - `packages/tools/src/codebase-index/rs-parser.ts:88-98` — patterns like
    `/fn\s+(\w+)\s*\([^)]*\)/g`, `/impl\s+(?:<[^>]+>)?(\w+)/g`. All single-quantifier
    negated classes (`[^)]*`, `[^>]+`) or `\w+`. Linear.
  - `packages/tools/src/codebase-index/yaml-parser.ts:107,132,154` —
    `/^(\s*)([^:#\s][^:#\s]*)\s*:/gm` etc. `[^:#\s][^:#\s]*` is `X X*` over the same class
    but it is **possessive-equivalent in effect** (no backtracking trigger because the
    following `\s*:` cannot also match the class chars) — linear in practice.
  - `packages/tools/src/codebase-index/json-parser.ts:100,198` — `/^\s*"([^"]+)"\s*:/gm`,
    `/"([^"]+)"/` — `[^"]+` bounded by `"`. Linear.
  - `packages/tools/src/codebase-index/ts-parser.ts` — uses the TypeScript compiler AST
    (`ts.createSourceFile`), not regex, for symbol extraction. The only regexes are
    `:70 /\s+/g` and `:92 /^[ \t]*\*[ ]?/gm` — both linear.
- Input: file contents (untrusted if the model is told to index a hostile repo) but every
  pattern is linear. NOT ReDoS.
- Status: CONFIRMED clean.

### B3. fix-classifier.ts patterns run on error text — all linear (negative finding)
- Severity: Informational
- File: `packages/cli/src/slash-commands/fix-classifier.ts:53-344`, `classifyError` :350-377
- Evidence: ~50 patterns, all alternations of literal words with `.*` at most once
  (e.g. `:63 /\btypescript\b.*\berror\b|\berror\b.*\btypescript\b/i`). Single `.*`, no
  nesting, no overlapping repetition. Input is a (bounded) error message. Linear.
- Status: CONFIRMED clean.

### B4. User-supplied regex compiler has a guard with a bypassable heuristic blocklist
- Severity: Low
- CWE: CWE-1333
- Files: `packages/tools/src/_regex.ts:24-77` (`compileUserRegex`), duplicate at
  `packages/core/src/utils/regex-guard.ts`
- Evidence: `grep`/`glob` tool patterns are LLM-supplied (untrusted-ish — model-controlled).
  The guard caps pattern length at 256 (`MAX_PATTERN_LEN`, :24) and rejects a *heuristic*
  set of dangerous constructs (`DANGEROUS_PATTERNS`, :28-38). The file's own header comment
  (:16-18, :26-27) admits the filter is "coarse" and "Not exhaustive". A crafted catastrophic
  pattern that the heuristics miss (e.g. `(\d+)*$`-style not covered by the listed forms, or
  Unicode-class nesting) would compile and then run synchronously on V8's backtracking engine.
  Subject length IS capped (`MAX_SUBJECT_LEN = 64*1024`, :84; `capSubject` :86-88) which
  bounds the blast radius, and the header notes the executor `timeoutMs` cannot interrupt a
  sync match.
- Scenario: Model emits a grep pattern that slips the blocklist; the native walker pins a
  worker for seconds on a 64 KB line before the next async boundary.
- Exploitability: Low — requires the model (not a remote attacker) to produce the pattern,
  and subject is 64 KB-capped, so worst case is seconds of CPU, not unbounded. The project
  already documents re2-wasm as the real fix.
- Remediation: Migrate `grep`/`glob` user patterns to a non-backtracking engine (re2/RE2-WASM),
  or run matches in a worker with a hard CPU deadline.
- Status: SUSPECTED (heuristic-bypassable by design; bounded impact). Documented as accepted
  risk in-code.

---

## PART C — Race conditions / TOCTOU

### C1. RecoveryLock.write() is NOT atomic and uses a fixed-name temp file (concurrent-writer corruption)
- Severity: Medium
- CWE: CWE-367 (TOCTOU) / CWE-362 (Race Condition)
- File: `packages/core/src/storage/recovery-lock.ts:135-149` (`write`)
- Evidence:
  ```js
  const tmp = `${this.file}.tmp`;                       // :146 FIXED name, no random suffix
  await fsp.writeFile(tmp, JSON.stringify(lock), { mode: 0o600 });  // :147 no 'wx' flag
  await fsp.rename(tmp, this.file);                     // :148 plain rename, no Windows retry
  ```
  Two issues vs. the project's own hardened `atomicWrite` (utils/atomic-write.ts), which the
  rest of the codebase uses:
  1. **Fixed temp name** `active.json.tmp` — if two wstack instances in the same project dir
     race `write()` (e.g. two TUIs launched near-simultaneously), they clobber the same temp
     file; the `writeFile` (no `wx`) and `rename` interleave can leave a partially-written or
     wrong-owner `active.json`. `atomicWrite` uses `randomBytes(6)` + `flag:'wx'` precisely to
     avoid this (atomic-write.ts:17,23).
  2. **Plain `fsp.rename`** on Windows — `atomicWrite` wraps rename in `renameWithRetry`
     (atomic-write.ts:70-91) because Windows rename-over-existing throws EPERM/EBUSY under AV/
     indexer contention; here a transient EPERM aborts the lock write entirely.
- Scenario: Two instances in the same repo, or AV holding `active.json` on Windows → corrupted
  or failed lock write → crash-recovery detection (`checkAbandoned`) reads a malformed lock and
  silently treats it as "no recovery" (readLock returns null on parse failure, :179).
- Exploitability: Low (requires concurrent same-dir instances or AV contention) but the data
  corruption is real and the codebase already has the correct primitive unused here.
- Remediation: Replace the hand-rolled write with the existing `atomicWrite(this.file, ...)`.
- Status: CONFIRMED.

### C2. RecoveryLock checkAbandoned → write is a check-then-act with no exclusive claim
- Severity: Low
- CWE: CWE-367 (TOCTOU)
- File: `packages/core/src/storage/recovery-lock.ts:86-128` (`checkAbandoned`) + `:135` (`write`)
- Evidence: `checkAbandoned()` reads the lock and decides "abandoned vs live" via a PID probe
  (`:102 lock.hostname === this.hostname && this.probe(lock.pid)`). `write()` then
  unconditionally **overwrites** ("Claim the lock ... Overwrites any existing lock", :130-131).
  There is no atomic compare-and-claim: between the abandonment check and the claim, another
  instance can start and write its own lock, which this instance then overwrites — both
  instances believe they own the project's session dir.
- Scenario: Two instances launch within the check→write window; the later writer wins and the
  earlier one's session is silently treated as recoverable/abandoned by a third launch.
- Exploitability: Low (narrow window, same-project-dir requirement; not attacker-driven).
- Remediation: Claim with `O_EXCL` create on the real lock path (or `flag:'wx'`), and on EEXIST
  re-run `checkAbandoned` rather than blind-overwriting.
- Status: CONFIRMED (design-level TOCTOU; low impact for the single-user model).

### C3. atomic-write.ts stat→chmod→rename window — benign (negative finding, documented)
- Severity: Informational
- File: `packages/core/src/utils/atomic-write.ts:39-49`
- Evidence: Reads target mode via `fs.stat` (:41) then `fs.chmod`s the temp file (:47) then
  renames (:49). There is a TOCTOU between stat and rename (target's mode could change), but it
  only affects which permission bits the new file inherits — it cannot escalate privilege beyond
  the target's prior mode and the temp file was created with the process umask. The random temp
  name + `wx` flag (:17,23) correctly prevent symlink/predictable-temp attacks. Acceptable.
- Status: CONFIRMED not a meaningful vuln.

### C4. fetch.ts DNS-rebinding TOCTOU between lookup and connect — KNOWN/DOCUMENTED
- Severity: Medium (SSRF-adjacent)
- CWE: CWE-367 / CWE-918 (SSRF)
- File: `packages/tools/src/fetch.ts:199-220` (`assertNotPrivate` hostname branch)
- Evidence: The code resolves the hostname via `dns.lookup(host, {all:true})` and checks every
  record (:209-215), but Node's `fetch()` then does its OWN DNS resolution when connecting — a
  hostile DNS server can return a public IP to the guard's lookup and `169.254.169.254`
  (cloud metadata) to the real connect. The code documents this exactly (:200-207, "TOCTOU:
  attacker's DNS returns public IP for our lookup, then 169.254.x.x for the real fetch ...
  remains an accepted risk for single-tenant use"). Redirects ARE re-validated each hop
  (:35-44), partially mitigating one vector.
- Scenario: SSRF to cloud IMDS / internal services in a multi-tenant or server deployment of
  the fetch tool.
- Exploitability: Medium where fetch is exposed beyond a single trusted local user; the tool is
  `permission: 'confirm'` (:72) which gates it behind user approval, lowering practical risk.
- Remediation: Pin the resolved IP via a custom undici Agent `connect` callback (resolve once,
  reuse) — the file's own comment proposes this (:205-207).
- Status: CONFIRMED (acknowledged in-code; severity depends on deployment model).

### C5. CircuitBreaker / ProcessRegistry shared mutable state — single-threaded, no data race (negative finding)
- Severity: Informational
- Files: `packages/tools/src/circuit-breaker.ts`, `packages/tools/src/process-registry.ts`
- Evidence: All mutations are synchronous JS over a `Map`/array; Node is single-threaded so
  there is no preemptive data race. State transitions (`_trip`/`_reset`/`_checkStateTransition`)
  are atomic w.r.t. the event loop. The SIGKILL backup timer (process-registry.ts:188-202)
  re-checks `this.processes.has(pid) && !p.child.killed` before sending, avoiding a kill of a
  recycled PID within the same registry. No TOCTOU of consequence.
- Status: CONFIRMED clean.

---

## PART D — Business logic / budget bypass

### D1. Per-subagent budget auto-extension can exceed the fleet-wide cost cap (directorBudget.maxCostUsd)
- Severity: Medium
- CWE: CWE-770 (Allocation of Resources Without Limits or Throttling) / CWE-840 (Business Logic)
- Files:
  - `packages/core/src/coordination/director.ts:520-597` (`budget.threshold_reached` handler)
  - cost branch `:587-590`
  - fleet cost cap enforcement only at spawn: `director.ts:684-689`
- Evidence: The fleet-wide cost cap `maxFleetCostUsd` (director.ts:338, :378) is checked
  **only inside `spawn()`** ("checked BEFORE the spawn is recorded ... refuse new spawns only",
  :132-149, enforced :684-689). The auto-extend handler grants per-subagent cost extensions
  independently:
  ```js
  case 'cost':
    newLimit = Math.min(base * 1.5, 100);   // :588  hard ceiling = $100 PER SUBAGENT, per extend
    extra.maxCostUsd = newLimit;
  ```
  An already-spawned subagent that crosses its `maxCostUsd` soft limit gets auto-granted +50%
  (up to $100) — and this is repeated up to `maxBudgetExtensions` times (default 5,
  director.ts:379, guarded at :549-557). Existing subagents continue spending past the fleet cap
  because the cap is never re-checked after spawn. With N already-spawned subagents each
  extendable to ~$100, total fleet spend can far exceed a small `directorBudget.maxCostUsd`.
- Scenario: User sets `directorBudget.maxCostUsd = $5` expecting a hard fleet ceiling. 4 workers
  are already spawned (each under the $5 check at spawn time). Each then auto-extends its own
  cost budget; the fleet burns 4 × (multiple extensions) ≫ $5 because the fleet cap gates only
  *new* spawns, not *continued* spend by existing agents.
- Exploitability: Medium — not remote, but a confused/hostile leader prompt that keeps workers
  busy defeats the intended dollar ceiling. The `maxBudgetExtensions` guard (default 5) and the
  $100 per-extend ceiling bound it, but the fleet-total invariant is not enforced.
- Remediation: In the `cost` branch of the threshold handler, before granting `extend`, compare
  `this.usage.snapshot().total.cost` against `this.maxFleetCostUsd` and `deny()` once the fleet
  total is at/over the cap. Make the fleet cost cap a live invariant, not a spawn-time gate only.
- Status: CONFIRMED (gap between documented intent at :132-149 and actual enforcement).

### D2. Budget threshold→extend handshake defaults to STOP on timeout/no-listener — enforcement preserved (negative finding)
- Severity: Informational (good design)
- File: `packages/core/src/coordination/subagent-budget.ts:216-233, 245-320`,
  `auto-extend.ts:83-108`
- Evidence: The handshake is fail-closed:
  - No `onThreshold` handler → `BudgetExceededError` thrown synchronously (subagent-budget.ts:217-219).
  - `mode==='sync'` → hard stop always (:220-222).
  - `mode==='auto'` but no EventBus listener for `budget.threshold_reached` → hard stop (:226-228).
  - `requestDecision()` with no listener → resolves `'stop'` immediately (:259-262).
  - Listener present but silent → 60 s `DECISION_TIMEOUT_MS` fallback to `'stop'` (:146, :270-273).
  - `pendingExtensions` dedup (:139, :229-230) prevents event-flood amplification.
  An attacker/looping agent cannot turn "limit reached" into "extend" without an *explicit*
  cooperating listener that calls `extend()`. The default policies cap non-timeout kinds and use
  a progress-heartbeat for timeout (auto-extend.ts:86-96; director.ts:532-548) so a wedged agent
  with no new tool calls is denied. This is sound — the handshake cannot be abused to bypass caps
  by itself.
- Status: CONFIRMED enforcement is fail-closed. (The D1 gap is specifically the *fleet-total*
  invariant, not the per-agent handshake.)

### D3. Subagent permission policy cannot be downgraded confirm→auto via untrusted input (negative finding)
- Severity: Informational (good design)
- Files: `packages/core/src/security/permission-policy.ts:256-298` (`subjectFor`),
  `:118-207` (`evaluate`), `:320-366` (`AutoApprovePermissionPolicy`)
- Evidence:
  - `subjectFor` (:263-265) escapes glob metacharacters (`* ? [ ]`) in the LLM-controlled
    subject string before matching against allow/deny patterns, so a crafted argument like `**`
    cannot widen an allow-rule match (the documented cross-tool-collision fix).
  - `subjectKey` (:270-282) prevents an unrelated field (e.g. an HTTP `path`) from being matched
    against filesystem trust rules.
  - Deny is absolute and evaluated before allow (:144-150).
  - Subagent auto-approve policy keeps `bash/write/scaffold/patch/install/exec` at DENY even for
    delegated subagents (:329-348) — inherited authorization is not blanket.
  No path lets attacker/model-controlled tool *input* flip a `confirm`/`deny` tool to `auto`.
  The only confirm→auto transitions require a real user `'yes'/'always'` via `promptDelegate`
  (:194-204) or a pre-existing user trust-file entry (:153-157).
- Status: CONFIRMED no untrusted-input permission downgrade.

### D4. Director orchestration tools are permission:'auto' by design — informational
- Severity: Informational
- File: `packages/core/src/coordination/director-tools.ts` (all tools `permission:'auto'`),
  `director.ts:1162-1192` / comment :1169-1174
- Evidence: `spawn_subagent`, `assign_task`, etc. are `auto` because "the user has already
  approved running the director". Spawn recursion is bounded by `maxSpawnDepth` (default 2,
  director.ts:373, enforced :678-680) and `maxSpawns` (:372, :681-683), and the actual tools
  the spawned workers run are still permission-checked normally. Reasonable; the only spend
  invariant gap is D1.
- Status: CONFIRMED acceptable (caveat: D1).

---

## Notes on negative findings
- No `pull_request_target`, no `${{ github.event.* }}` shell interpolation, no PR-head checkout
  with secrets (Part A clean for the high-severity injection classes).
- No catastrophic-backtracking regex confirmed on untrusted+unbounded input; fetch HTML and
  all language parsers are linear and/or length-capped (Part B).
- Single-threaded Node model removes classic data-race concerns in the registry/breaker;
  real TOCTOU surface is the non-atomic RecoveryLock write (C1) and the documented DNS-rebind
  window (C4).
- The budget handshake is fail-closed (D2); the one real business-logic gap is the fleet-total
  cost cap not being a live invariant (D1).

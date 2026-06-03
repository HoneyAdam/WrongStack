# Next Up

Carry-over work for the next session. Items are ordered by ROI
(impact-to-effort ratio, eyeballed). Each entry has a one-line "why"
and the smallest concrete next step so a future agent (or me
tomorrow) can pick it up without re-deriving context.

Last updated: 2026-06-03 (end of a 22-commit day, ~18h).

---

## 1. CLI / WebUI boot path unification — HIGH

**Why.** `packages/cli/src/boot-config.ts` and
`packages/webui/src/server/boot.ts` are near-duplicates. Both:
- resolve wpaths via `DefaultPathResolver` + `resolveWstackPaths`
- create a real `DefaultSecretVault` (AES-GCM, not XOR)
- call `migratePlaintextSecrets` over `[globalConfig, projectLocalConfig]`
- print a `[wstack]/[WebUI] Encrypted N plaintext secret(s) in FILE`
  notice (now via `writeErr` after the Phase 5 cleanup)
- load config via `DefaultConfigLoader` + build a `DefaultLogger`

The drift already shows: cli has `ensureProjectMeta(wpaths, projectRoot)`;
webui has explicit `fs.mkdir(... recursive: true)` for the same three
paths. Either copy of that logic can fall behind when a new wpath is
added.

**Effort.** 2–3h. One repo, two consumers, one canonical core helper.

**Next step.** Add `bootConfig(flags?: Record<string, string|boolean>)`
to `packages/core/src/runtime/boot.ts` (or `infrastructure/boot.ts` —
pick whichever the architectural review has fewer cycles through) that
takes the `flags?` shape cli uses and returns `{ config, vault,
globalConfigPath, projectRoot, wpaths, logger }`. Both packages then
re-export it from their own `boot.ts` for backward compatibility. Keep
the per-package `bootConfig()` signature as a thin pass-through.

**Refs.** Audit report `04-architecture-refactoring.md` §5.5 (LOW
priority there, but the duplicated surface is the actual issue);
`packages/cli/src/boot-config.ts:36-58` and
`packages/webui/src/server/boot.ts:30-63` are the two near-duplicate
implementations.

---

## 2. webui/src/server/index.ts — remaining 7 concerns

**Why.** This file is 1,622 lines. Phase-4 PR (`5200966`) extracted
the static-file HTTP server into `http-server.ts` (-75 lines), but
the refactor-planner sub-agent (read-only plan, 3m, 2k tokens) flagged
**18 distinct concerns** remaining. The cheapest three after
`http-server` are:

| # | Concern | Approx lines | Migration cost |
|---|---------|-------------:|---------------:|
| 17 (done) | `http-server.ts` — static serve, MIME, CSP, SPA fallback | -75 | LOW |
| 6  | `ws-auth.ts` — token check, time-constant compare | ~90 | LOW |
| 18 | `lifecycle.ts` — start/stop, signal handlers, graceful shutdown | ~60 | LOW |
| 11 | `error-formatter.ts` — JSON-RPC error shape, human-readable fallback | ~40 | LOW |
| 7  | `token-estimator.ts` — request body size estimate, calibrated for context | ~30 | LOW |
| 9  | `rest-routes.ts` — `/api/...` registration | ~150 | MEDIUM |
| 8  | `ws-handlers.ts` — `handleMessage` switch on `type` | ~400 | HIGH (touches shared state) |

**Effort.** 1.5–2h for the four LOW entries (6, 18, 11, 7). The
MEDIUM/HIGH ones (9, 8) are 4–6h and can wait a day.

**Next step.** Read `packages/webui/src/server/index.ts` end-to-end,
then extract `ws-auth.ts` first (pure functions, no shared state,
already has `ws-auth.test.ts` covering 15 cases — refactor will
strengthen, not weaken, the test surface). Repeat the
`http-server.ts` pattern: write the new file, update the import
in `index.ts`, run `tsc --noEmit -p packages/webui/tsconfig.json`
plus the targeted vitest file.

**Refs.** Commit `5200966` shows the exact pattern. Sub-agent plan
saved during the read-only triage pass (look for the
`webui/server/index.ts plan` invocation in the day-2 transcript).

---

## 3. Phase 6: input-reader readLine + readSecret tests

**Why.** `packages/cli/tests/input-reader.test.ts` (commit `3fe3bc8`)
covers `readKey` (4 tests). The other two methods on the same
reader are uncovered:

- `readLine` uses `readline.createInterface` and prompts a free-form
  string. Mocking requires faking the interface and a writable tty.
- `readSecret` toggles raw mode, accumulates bytes, prints bullets,
  and restores mode on Enter / Ctrl+C. The mask-then-restore dance
  is the exact kind of thing a future refactor will quietly break.

**Effort.** 1–1.5h (mostly the `readSecret` mask harness).

**Next step.** For `readLine`: stand in for stdin with the same fake
`EventEmitter`-based stream used by the readKey test, then resolve
`rl.question` directly (export a `createReadline` shim so the test
can supply its own readline). For `readSecret`: assert on
`process.stdout.write` capture (the bullets are routed through
`writeOut` after Phase 4) and verify the post-Enter raw-mode restore.

**Refs.** `packages/cli/src/input-reader.ts:140-180` (readSecret
implementation), the existing readKey test for the fake-stdin pattern.

---

## 4. `process.stdout.write(` in docs — replace with `writeOut`

**Why.** The codebase itself is now clean (Phase 5), but three
documentation files still show the old `process.stdout.write(s)`
form in their code examples, which trains contributors to copy the
old pattern.

```
packages/core/skills/node-modern/SKILL.md:144
packages/mcp/README.md:178, 184
packages/providers/README.md:52
```

These are *intentionally* simple examples, so the call-site
replacement is one word. The bigger win is the
"`writeOut` is the seam for output capture / future middleware"
comment in each, so the next contributor who reads the doc learns
the new pattern instead of re-spreading the old one.

**Effort.** 15 minutes.

**Next step.** For each of the 4 lines above, swap
`process.stdout.write(X)` for `writeOut(X)` and add the import from
`@wrongstack/core`. Re-render the markdown locally to make sure the
diffed code blocks still compile (they're illustrative, but a
broken import line would undercut the lesson).

**Refs.** Commit `90f0c80` (the writeTo primitive + the JSDoc that
explains why writeOut exists).

---

## 5. Re-run the audit-log triage sub-agent

**Why.** The last audit delegation timed out at 10 minutes. The
manual grep for the M1/M2/M3 batch (`02-bug-hunt-tools-cli.md`)
showed all three were already fixed in the current code, but that
was a quick scan — there are still 4 reports
(`03-security-audit.md`, `04-architecture-refactoring.md`,
`05-dependency-package-health.md`, `08-extensibility-configurability-audit.md`)
that may have open MEDIUM items I didn't fully triage.

**Effort.** 1h (sub-agent dispatch + review).

**Next step.** Re-dispatch the audit-log role with the same task
description as before, but give it 25 minutes (`timeoutMs: 1_500_000`)
and `maxIterations: 80` instead of the default 10-minute / 30-iter
budget. The previous attempt spent 13 iterations reading 8 files in
parallel and was about to start writing the report when it hit the
timeout. Read its findings, file the open MEDs into a follow-up
section of this `next.md`, and pick at most 2 to action this week
(rest are deferred to a planned hardening sprint).

**Refs.** `.reports/02-bug-hunt-tools-cli.md` lines 100-150 for the
M-series format that's now clean (good template for the new
findings).

---

## 6. bun.lock format diff

**Why.** Mentioned earlier in the day but not acted on — likely a
benign CRLF / ordering difference from whoever last ran `bun install`
in CI. Worth a one-line fix to keep the diff surface small.

**Effort.** 5 minutes (or zero, if it's just a regenerate).

**Next step.** Run `bun install` and commit the resulting
`bun.lock` if it changed. If the diff is the same after a
regenerate, it was a toolchain artifact — close the item.

---

## Deferred (out of scope for next session)

- Decompose `cli/src/index.ts` further — 130 lines already came out
  in commit `5d2595e`, but 1,310 lines still remain. The next
  biggest extraction candidates are the slash-command registration
  loops and the JSONL-result emit. Both are MEDIUM-risk; budget a
  half-day when there's a clear consumer for the extracted function.
- MEDIUM-severity findings in `.reports/03-security-audit.md:109`
  and `.reports/04-architecture-refactoring.md:157` — pull these
  once the audit-log sub-agent (item 5) finishes its re-triage.
- Replace `process.env['PORT']` reads with a typed `env` helper —
  sprinkled through 8+ files, no risk, ~1h, but only worth doing
  alongside item 1 (boot unification reuses the same env-reading
  pattern).

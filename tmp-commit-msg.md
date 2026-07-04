test(core): add toErrorMessage + truncate coverage (10 new cases)

`packages/core/src/utils/error.ts` and `packages/core/src/utils/string.ts`
were the two highest-impact untested utilities in the core package:

- `toErrorMessage(err)` is used in 40+ files (CLI exit paths, WS
  error responses, agent retry warnings, telemetry serialization).
  It has a one-line implementation but no unit test — any regression
  in its Error-vs-non-Error branch would silently break error
  display in production. 5 cases pin the contract:
    - returns the .message of an Error instance
    - preserves empty Error.message as an empty string (defensive —
      callers wrap "" → "unknown error" themselves)
    - preserves the .message of a subclass of Error (the custom-error
      code path)
    - coerces a non-Error value to its String form (string, number,
      null, undefined)
    - coerces an object via String(), not JSON.stringify — pin this
      explicitly so a future refactor to JSON.stringify would be a
      deliberate breaking change (callers that want JSON must opt in)

- `truncate(s, max)` is the canonical "capped string with ellipsis
  when too long" helper used in CLI status lines, log headers, and
  agent-context previews. The 1-char-buffer math (max - 1) only
  works with the 1-codepoint Unicode horizontal ellipsis (U+2026);
  a refactor to `'...'` (3 periods) would silently produce 11-char
  output for max=10, breaking fixed-width column alignment in the
  CLI. 5 cases pin:
    - returns string unchanged when it fits under max
    - truncates and appends ellipsis when input exceeds max
    - output length is exactly max chars (the column-width contract)
    - uses U+2026 (codepoint verification) — refactor guard
    - degenerate max=0 case: returns 'h…' (slice(0,-1) strips last
      char, then ellipsis appended) — degenerate but stable; pin it

Both new test files use the established one-test-file-per-source-file
convention in packages/core/tests/utils/.

Verified: 10/10 new tests pass (5 in error.test.ts + 5 in string.test.ts).
pnpm --filter @wrongstack/core typecheck clean. No source code
changes — this commit is test-only.
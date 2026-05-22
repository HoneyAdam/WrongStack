# /diag · /stats — Diagnostics and Session Stats

## /diag

Calls `opts.onDiag()` — a callback wired by the REPL/TUI that returns a runtime diagnostic snapshot. Typically shows provider status, token usage so far, registered tools count, and MCP server state.

Returns `"Diag not available in this context."` when not wired.

## /stats

Calls `opts.onStats()` — a callback wired by the REPL that returns a formatted session summary. Typically includes:
- Total tokens (input + output)
- Number of provider requests
- Tool call count
- Files read
- Estimated cost

Returns `"No session activity recorded yet."` if no activity yet, or `"Stats not available in this context."` if not wired.

## What these depend on

Both are passthrough callbacks — the actual data is produced by the REPL's state management (`SessionStats`) and wired in `packages/cli/src/index.ts` at boot time.

## Code reference

- `packages/cli/src/slash-commands/diag-stats.ts`
- `packages/cli/src/session-stats.ts` — `SessionStats` class
- `packages/cli/src/index.ts` — `onDiag` / `onStats` wiring
# `/ps` · `/kill` — TUI process control

These commands are mounted by the TUI and inspect the shared registry of active `bash` and `exec` child processes.

| Command | Effect |
|---|---|
| `/ps` | List tracked processes and the shell circuit-breaker summary. Read-only. |
| `/kill` or `/kill list` | List processes plus detailed circuit-breaker counters. |
| `/kill <pid>` | Stop one tracked process. |
| `/kill all` | Stop all tracked processes (`SIGTERM`, then forced termination if needed). |
| `/kill force` | Open the circuit breaker and immediately force-stop all tracked processes. |
| `/kill reset` | Reset the circuit breaker to closed. |

A PID not present in the registry is not targeted. These are TUI-mounted slash commands; they are not registered by `buildBuiltinSlashCommands()` for the plain REPL.

## Code reference

- `packages/tui/src/ps-slash.ts`
- `packages/tui/src/kill-slash.ts`
- `packages/tools/src/process-registry.ts`

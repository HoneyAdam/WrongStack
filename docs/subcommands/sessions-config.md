# `wstack sessions` · `wstack config` · `wstack rewind`

## `wstack sessions`

Lists saved sessions from `DefaultSessionStore`:

```
Recent sessions:
  sess_01    2026-05-22 10:00   12,450 tok  "Refactor auth module"
  sess_02    2026-05-22 09:30   8,200 tok   "Add MCP server"
  sess_03    2026-05-22 08:45   3,100 tok   "Fix bug in tool executor"

Resume one with: wstack resume <id>
```

Each entry shows: id, startedAt, token total, title. Title comes from `session.summary.json` or the first user message.

### Resume a session
```bash
wstack resume sess_01
# or
wstack sessions resume sess_01
```

### Delete a session
```bash
wstack sessions delete sess_01
```

## `wstack config`

Show current config (decrypted):

```bash
wstack config         # print current config
wstack config edit    # open in $EDITOR
```

The config is the `~/.wrongstack/config.json` file without secrets (API keys redacted in output).

## `wstack rewind`

Rewind the active session to a previous turn. Useful when the conversation went off track and you want to back up without losing earlier context.

```bash
wstack rewind           # list available rewind points
wstack rewind 5         # rewind to turn 5
wstack rewind sess_01   # rewind to a saved session
```

Rewind points are derived from `session.jsonl` turn boundaries. Each rewind creates a new session branch.

## Code reference

- `packages/cli/src/subcommands/handlers/sessions-config.ts` — sessions + config handlers
- `packages/cli/src/subcommands/handlers/rewind.ts` — rewind handler
- `packages/core/src/storage/session-store.ts` — `DefaultSessionStore`
- `packages/core/src/storage/session-reader.ts` — `DefaultSessionReader`
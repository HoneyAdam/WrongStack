# /save · /sessions · /exit — Session Management

## /save

Forces a session flush to disk by appending a `session_end` event with current token usage. WrongStack auto-saves on exit — this is useful mid-session to persist without quitting.

```typescript
await ctx.session.append({
  type: 'session_end',
  ts: new Date().toISOString(),
  usage: opts.tokenCounter.total(),
});
```

## /sessions (aliases: `/resume`, `/load`)

Lists the 10 most recent sessions from `DefaultSessionStore`. Shows id, startedAt, tokenTotal, and title. To resume a specific session:

```bash
wstack resume <session-id>
```

**Note:** The command was renamed from `/resume` to `/sessions` to match its behavior (it lists sessions, it doesn't actually resume them). The old aliases `/resume` and `/load` still work for backward compatibility.

## /exit (aliases: `/quit`, `/q`)

Exits the REPL. Before exiting, calls `opts.onBeforeExit()` — if that returns `{ abort: true, message }`, warns but still exits. Otherwise calls `opts.onExit()` and returns `{ exit: true }`.

## Session logging configuration

Persistent session logging behaviour is controlled via the top-level `session` key in your config:

```jsonc
{
  "session": {
    "auditLevel": "standard",           // minimal | standard | full
    "sampling": {
      "toolProgress": {
        "sampleRate": 8
      }
    }
  }
}
```

See [Configuration Reference](../configuration.md#session--session-logging--audit-trail) for details.

## Code reference

- `packages/cli/src/slash-commands/session.ts`
- `packages/core/src/storage/session-store.ts`
- `packages/cli/src/repl.ts` — handles the `exit: true` return value
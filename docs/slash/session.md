# /save · /sessions · /exit — Session Management

## /save

Forces the session writer's in-memory buffer to disk. WrongStack auto-saves continuously (events are buffered for at most ~500 ms) and finalizes on exit — this is useful mid-session for an explicit durability point without quitting.

```typescript
await ctx.session.flush();
```

**Note:** `/save` deliberately does **not** write a `session_end` event. The session is still running — a mid-stream end marker would corrupt outcome/`endedAt` derivation and make crash recovery treat a later crash as a clean exit. `session_end` is written exactly once, by the exit path (or by a resume that finalizes the writer being left).

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
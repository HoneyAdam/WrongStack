# /save · /resume · /exit — Session Management

## /save

Forces a session flush to disk by appending a `session_end` event with current token usage. WrongStack auto-saves on exit — this is useful mid-session to persist without quitting.

```typescript
await ctx.session.append({
  type: 'session_end',
  ts: new Date().toISOString(),
  usage: opts.tokenCounter.total(),
});
```

## /resume (aliases: `/load`, `/sessions`)

Lists the 10 most recent sessions from `DefaultSessionStore`. Shows id, startedAt, tokenTotal, and title. To resume a specific session:

```bash
wstack resume <session-id>
```

## /exit (aliases: `/quit`, `/q`)

Exits the REPL. Before exiting, calls `opts.onBeforeExit()` — if that returns `{ abort: true, message }`, warns but still exits. Otherwise calls `opts.onExit()` and returns `{ exit: true }`.

## Code reference

- `packages/cli/src/slash-commands/session.ts`
- `packages/core/src/storage/session-store.ts`
- `packages/cli/src/repl.ts` — handles the `exit: true` return value
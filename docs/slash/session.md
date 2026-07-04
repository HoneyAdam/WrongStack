# /save · /sessions · /exit — Session Management

## /save

Forces the session writer's in-memory buffer to disk. WrongStack auto-saves continuously (events are buffered for at most ~500 ms) and finalizes on exit — this is useful mid-session for an explicit durability point without quitting.

```typescript
await ctx.session.flush();
```

**Note:** `/save` deliberately does **not** write a `session_end` event. The session is still running — a mid-stream end marker would corrupt outcome/`endedAt` derivation and make crash recovery treat a later crash as a clean exit. `session_end` is written exactly once, by the exit path (or by a resume that finalizes the writer being left).

## /sessions (aliases: `/resume`, `/load`)

Lists the 10 most recent sessions from `DefaultSessionStore`. Shows id (with the user-supplied name in parentheses if set), startedAt, tokenTotal, and the auto-derived title. To resume a specific session:

```bash
wstack resume <session-id>
```

**Note:** The command was renamed from `/resume` to `/sessions` to match its behavior (it lists sessions, it doesn't actually resume them). The old aliases `/resume` and `/load` still work for backward compatibility.

### /sessions rename \<id\> [name...]

Sets a user-supplied name on a session. The name is persisted in the session's `.summary.json` sidecar and the `_index.jsonl` cache, so it survives restarts and is visible everywhere sessions are listed (the CLI, the TUI, and the WebUI sidebar). When present, the name takes precedence over the auto-derived `title`; the `title` is still derived from the first user message and kept in sync as the conversation evolves.

```bash
/sessions rename 2026-07-04/sess_01JX...   DB refactor
```

Omit the name (or pass only whitespace) to clear it — the auto-derived title takes over again:

```bash
/sessions rename 2026-07-04/sess_01JX...
```

The name is independent from the `title`: you can name a session "DB refactor" while its title still reads "fix migration seed data". Renaming a session that has no `.jsonl` on disk throws `Session not found: <id>`. Rename is **not** subject to the in-use guard (it only changes a label, never causes data loss), so you can rename even the active session.

### /sessions delete \<id\> [--force|-y]

Deletes any saved session — not just empty ones. Removes the `.jsonl` transcript, the `.summary.json`/`.plan.json`/`.tasks.json`/`.todos.json` sidecars, and the per-session directory (`fleet.json`, `shared/`, `subagents/`), then writes an index tombstone so the session disappears from listings. This is irreversible.

```bash
/sessions delete 2026-07-04/sess_01JX...
/sessions delete 2026-07-04/sess_01JX... --force   # skip confirmation
```

**In-use guard.** A session that is currently being used by any live process in this project cannot be deleted. Two checks run, in order:

1. **`active.json`** — the per-project RecoveryLock; every CLI/TUI/WebUI writes it on session start.
2. **`SessionRegistry`** — the cross-process live-session list, which catches a session held open by a *different* surface than the one you're deleting from (multiple terminals/TUIs/WebUIs can each run their own active session in the same project).

If either flags the target, the delete throws instead of dropping a session another process is still writing to. Resume or start another session first. Without `--force`/`-y`, a confirmation prompt is shown (skipped automatically in non-TTY/scripted contexts).

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
- `packages/core/src/storage/session-store.ts` — `rename`, `delete` (with the in-use guard), `SessionStoreOptions.isSessionInUse`
- `packages/cli/src/repl.ts` — handles the `exit: true` return value

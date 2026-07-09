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

File versions observed by `read`, `edit`, and `write` are journaled with a
SHA-256 hash. On resume, the latest hash for each project-local path is checked
again. Changed, deleted, unreadable, or out-of-project paths are injected as a
temporary system notice so the model re-reads stale inputs before continuing;
the notice itself is not appended to the historical transcript.

Compaction writes an exact `context_snapshot` reconstruct event and flushes it
through the durable JSONL boundary. Resume replaces earlier replay state at
the latest snapshot, then applies later events, so it reconstructs the actual
post-compaction conversation instead of reviving the un-compacted history.

### Fork a session journal

```bash
wstack sessions fork sess_01          # latest persisted boundary
wstack sessions fork sess_01 --to 3   # checkpoint prompt index 3
```

Fork creates a new append-only child journal and leaves the parent unchanged.
The result includes a SHA-256 checkpoint hash over the exact parent event
prefix. Parent file snapshots are not copied as child rewind authority:
`workspace: shared-current` means both journals still see the current project
files.

New checkpoints in a Git workspace also capture a content-addressed workspace
manifest: the checkpoint's Git `HEAD`, plus blobs for every changed or
untracked non-ignored file (including deletion and symlink records). The CLI
prints this manifest hash when it is available. A host or eval harness can use
`SessionStore.materializeWorkspaceCheckpoint()` to apply the manifest to a
**separate, clean checkout at that exact `HEAD`**; the parent working tree is
explicitly refused as a target. CAS hashes and output paths are verified before
the first mutation.

This is not retroactive: old checkpoints have no workspace manifest. Ignored
files are outside the declared `git-head-plus-dirty` coverage, and submodules or
other non-file entries are recorded as unresolved. The same applies to a file
over 64 MiB or aggregate checkpoint blobs over 512 MiB, which bounds prompt
latency and memory use. Exact materialization is refused while any unresolved
entry remains. Automatic `sessions fork` worktree handoff is intentionally not
implied by journal forking because session storage is project-root scoped.

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

Rewind points are derived from the project-scoped session JSONL turn boundaries.
By default rewind restores recorded file snapshots only. Passing `--resume`
also truncates that same session at the selected checkpoint; it does not create
a child session branch. Use `wstack sessions fork <id> --to N` for a
non-destructive journal branch.

## Code reference

- `packages/cli/src/subcommands/handlers/sessions-config.ts` — sessions + config handlers
- `packages/cli/src/subcommands/handlers/rewind.ts` — rewind handler
- `packages/core/src/storage/session-store.ts` — `DefaultSessionStore`
- `packages/core/src/storage/session-reader.ts` — `DefaultSessionReader`

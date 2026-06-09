# /prune — Delete Old Sessions

Cleans up old session files from disk. Default threshold is 30 days.

## Usage

| Usage | Effect |
|---|---|
| `/prune` | Delete sessions older than 30 days |
| `/prune 14` | Delete sessions older than 14 days |
| `/prune 7` | Delete sessions older than 7 days (min 1, max 365) |
| `/prune --dry-run` | Show what would be deleted without actually deleting |
| `/prune --rebuild-index` | Rebuild the session index from disk |

## Examples

```bash
/prune                    # Default: 30 days
/prune --dry-run          # Preview first
/prune 7                  # Aggressive: 7 days
/prune --rebuild-index    # Index repair
```

## Safe by default

`/prune` only deletes sessions whose `startedAt` timestamp is older than the
threshold. Use `--dry-run` to preview before deleting:

```
Would delete 12 sessions (dry run, maxAge=30d):
  sess_abc123  2026-05-01  Fixed the auth bug
  sess_def456  2026-04-28  Refactored core module
  ...

Run /prune without --dry-run to actually delete.
```

## Index rebuild

If the session index gets out of sync with the files on disk (e.g. after
manual file operations), `/prune --rebuild-index` rescans the session
directory and rebuilds the in-memory index.

## Code reference

- `packages/cli/src/slash-commands/prune.ts`
- `packages/core/src/storage/session-store.ts`

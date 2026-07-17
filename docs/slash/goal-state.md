# `/goal-state` — Autonomous Mission Tracker

## What it does

Sets, inspects, pauses, resumes, or clears the long-running mission used by
`/autonomy eternal`. Goals persist at
`~/.wrongstack/projects/<hash>/goal.json` across sessions, surviving process
restarts.

## Storage format

`goal.json`:
```json
{
  "version": 1,
  "goal": "string",
  "setAt": "ISO timestamp",
  "lastActivityAt": "ISO timestamp",
  "engineState": "idle | running | stopped",
  "goalState": "active | paused | completed | abandoned",
  "iterations": 0,
  "journal": [
    {
      "iteration": 1,
      "task": "what the agent attempted",
      "status": "success | failure | aborted | skipped",
      "source": "brainstorm | todo | git | manual | resume | parallel",
      "note": "optional note",
      "tokens": { "input": 0, "output": 0 },
      "costUsd": 0.00,
      "at": "ISO timestamp"
    }
  ]
}
```

### `goalState` lifecycle

| Value | Meaning |
|-------|---------|
| `active` (default) | Goal is live; engine will run iterations against it |
| `paused` | User ran `/goal-state pause`; engine exits loop gracefully after current iteration finishes. Run `/goal-state resume` to continue. |
| `completed` | Engine detected `[GOAL_COMPLETE]` + verification passed; engine refuses to restart |
| `abandoned` | User ran `/goal-state clear`; engine stops on next iteration check |

Once `goalState` is not `active`, the engine refuses to run further iterations — this protects against accidental restarts burning API quota after work is done.

### Stale goal guard

`/autonomy eternal` refuses to start if the existing goal has `iterations > 0` or `engineState === 'running'`. The user must `/goal-state clear` first to consciously start a fresh mission.

## Usage

| Usage | Effect |
|---|---|
| `/goal-state` | Show current goal + recent journal (last 25 entries) |
| `/goal-state show` | Same as above |
| `/goal-state status` | Same as above (alias) |
| `/goal-state set <text>` | Set or replace the goal |
| `/goal-state new <text>` | Alias for `/goal-state set` |
| `/goal-state clear` | Mark goal abandoned, delete goal.json, and stop eternal loop immediately |
| `/goal-state journal [N]` | Show last N journal entries (default 25) |
| `/goal-state log [N]` | Alias for `/goal-state journal` |
| `/goal-state pause` | Pause loop gracefully after current iteration finishes. State becomes `paused` until `/goal-state resume`. |
| `/goal-state resume` | Clear `paused` state and resume the loop from the next iteration. |
| `/goal-state <any text without verb>` | Treated as `/goal-state set <text>` |

## Pause / Resume

`/goal-state pause` writes `goalState: 'paused'` to goal.json. The engine finishes the current iteration then exits the loop cleanly via the existing `missionState !== 'active'` guard — no AbortController, no work lost.

`/goal-state resume` clears `goalState: 'active'` and the loop continues from the next iteration. If there is no active `/autonomy eternal` running, the state change is persisted and the next `/autonomy eternal` call picks up where it left off.

**Edge cases:**
- `/goal-state pause` when already paused → no-op, returns "Already paused."
- `/goal-state resume` when not paused → no-op, returns "Not paused."
- `/goal-state pause` when no goal exists → returns "No goal set — nothing to pause."
- `/goal-state pause` while an iteration is in-flight → loop exits after that iteration completes

## Journal entry format

Each iteration writes a journal entry with emoji status indicator:
- ✅ `success` (green checkmark)
- ✗ `failure` (red cross)
- ⊘ `aborted` (amber circle)
- · (dim dot) for unknown status

## Code reference

- `packages/cli/src/slash-commands/goal-state.ts`
- `packages/core/src/storage/goal-store.ts`
- `packages/core/src/execution/eternal-autonomy.ts`

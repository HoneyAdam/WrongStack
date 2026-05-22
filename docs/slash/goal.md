# /goal — Autonomous Mission Tracker

## What it does

Sets, inspects, or clears the long-running mission used by `/autonomy eternal`. Goals persist at `<projectRoot>/.wrongstack/goal.json` across sessions, surviving process restarts.

## Storage format

`goal.json`:
```json
{
  "goal": "string",
  "setAt": "ISO timestamp",
  "lastActivityAt": "ISO timestamp",
  "engineState": "idle | running | stopped",
  "iterations": 0,
  "journal": [
    {
      "iteration": 1,
      "task": "what the agent attempted",
      "status": "success | failure | aborted",
      "source": "brainstorm | repl | agent",
      "note": "optional note"
    }
  ]
}
```

## Usage

| Usage | Effect |
|---|---|
| `/goal` | Show current goal + recent journal (last 25 entries) |
| `/goal show` | Same as above |
| `/goal status` | Same as above |
| `/goal set <text>` | Set or replace the goal |
| `/goal clear` | Delete goal.json and stop eternal loop if running |
| `/goal journal [N]` | Show last N journal entries (default 25) |
| `/goal <any text without verb>` | Treated as `/goal set <text>` |

## Journal entry format

Each iteration writes a journal entry with emoji status indicator:
- ✅ `success` (green checkmark)
- ✗ `failure` (red cross)
- ⊘ `aborted` (amber circle)
- · (dim dot) for unknown status

## Code reference

- `packages/cli/src/slash-commands/goal.ts`
- `packages/core/src/storage/goal-store.ts`
- `packages/core/src/execution/eternal-autonomy.ts`
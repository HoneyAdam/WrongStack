# /autonomy — Agent Self-Driving Modes

## What it does

Controls how much autonomy the agent has between turns. This drives `DefaultModeStore`-backed autonomy state and, in `eternal` mode, starts the `eternal-autonomy` engine.

## Modes

| Mode | Label | Behavior |
|---|---|---|
| `off` | OFF | Normal interactive mode. Agent stops after each turn. |
| `suggest` | SUGGEST | After each turn, agent shows next-step suggestions. You pick. |
| `auto` | AUTO | After each turn, agent picks the best next step and continues. Runs until Esc or Ctrl+C. |
| `eternal` | ETERNAL | Goal-driven sense/decide/execute/reflect loop. Requires `/goal`. Forces YOLO on. Runs until `/autonomy stop` or Ctrl+C twice. |

## Usage

```
/autonomy            → show current mode + goal context + engine state
/autonomy off        → stop all autonomous modes
/autonomy suggest   → enable suggestion mode
/autonomy auto      → enable self-driving mode
/autonomy eternal   → enable eternal loop (requires /goal set first; fails if stale goal exists — run /goal clear first)
/autonomy stop      → stop eternal loop gracefully
/autonomy toggle    → cycle through: off → suggest → auto → eternal → off
```

## Eternal mode

- Requires a goal file at `<projectRoot>/.wrongstack/goal.json` (set via `/goal`)
- **Stale goal guard**: If the existing goal has `iterations > 0` or `engineState === 'running'`, `/autonomy eternal` refuses to start and tells the user to run `/goal clear` first. This prevents accidentally resuming an old mission from a previous session.
- Forces YOLO on (`opts.onYolo(true)`)
- Starts the `eternal-autonomy` engine via `opts.onEternalStart()`
- Writes a journal to `goal.json` on each iteration: task, status (success/failure/aborted), source, note
- After 3 consecutive failures, forces a "brainstorm" rotation
- `/autonomy stop` or Ctrl+C twice exits the loop and shows a usage summary

## Status output

When running `/autonomy` with no args, shows:
- Current mode with colored label
- Goal text (truncated to 80 chars)
- Engine state + iteration count + journal length
- Cost summary if any usage was recorded
- Recent failure count from last 10 iterations

## Code reference

- `packages/cli/src/slash-commands/autonomy.ts`
- `packages/core/src/execution/eternal-autonomy.ts` — the engine
- `packages/core/src/storage/goal-store.ts` — goal file format
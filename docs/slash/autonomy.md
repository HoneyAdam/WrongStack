# /autonomy — Agent Self-Driving Modes

## What it does

Controls how much autonomy the agent has between turns. This drives `DefaultModeStore`-backed autonomy state and, in `eternal` or `eternal-parallel` mode, starts the respective autonomy engine.

## Modes

| Mode | Label | Behavior |
|---|---|---|
| `off` | OFF | Normal interactive mode. Agent stops after each turn. |
| `suggest` | SUGGEST | After each turn, agent shows next-step suggestions. You pick. |
| `auto` | AUTO | After each turn, agent picks the best next step and continues. Runs until Esc or Ctrl+C. |
| `eternal` | ETERNAL | Goal-driven sense/decide/execute/reflect loop. Requires `/goal`. Forces YOLO on. Runs until `/autonomy stop` or Ctrl+C twice. |
| `eternal-parallel` | PARALLEL | Fan-out 4–8 subagents per tick. Each tick: decompose → spawn → await → aggregate → loop. Requires `/goal`. Forces YOLO on. |

## Usage

```
/autonomy            → show current mode + goal context + engine state
/autonomy off        → stop all autonomous modes
/autonomy suggest   → enable suggestion mode
/autonomy auto      → enable self-driving mode
/autonomy eternal   → enable eternal loop (requires /goal set first)
/autonomy parallel  → enable parallel fan-out mode (requires /goal set first)
/autonomy stop      → stop eternal or parallel loop gracefully
/autonomy toggle    → cycle: off → suggest → auto → eternal → parallel → off
```

## Eternal vs Parallel mode

### Eternal mode
- Single-agent loop: `sense → decide → execute → reflect → loop`
- After 3 consecutive failures, forces a "brainstorm" rotation
- Writes a journal to `goal.json` on each iteration

### Parallel mode (`/autonomy parallel`)
- Multi-agent fan-out: each tick runs N subagents simultaneously
- **Decompose**: breaks the goal into N independent sub-tasks (leader agent brainstorm, todos, or git dirty files)
- **Fan-out**: spawns N subagents, each with a directive containing the goal, recent journal, and task
- **Await**: waits for all subagents to complete (per-slot timeout, default 5 min)
- **Aggregate**: writes a journal entry showing success/failure per slot, checks for `[GOAL_COMPLETE]`
- **Loop**: continues until `/autonomy stop` or `[GOAL_COMPLETE]` detected

Both modes require a goal (`/goal set <mission>`) and fail if the goal is stale (has `iterations > 0` or `engineState === 'running'`).

## Status output

When running `/autonomy` with no args, shows:
- Current mode with colored label (OFF/SUGGEST/AUTO/ETERNAL/PARALLEL)
- Goal text (truncated to 80 chars)
- Engine state + iteration count + journal length
- Cost summary if any usage was recorded
- Recent failure count from last 10 iterations

## Code reference

- `packages/cli/src/slash-commands/autonomy.ts` — slash command
- `packages/core/src/execution/eternal-autonomy.ts` — `EternalAutonomyEngine`
- `packages/core/src/execution/parallel-eternal-engine.ts` — `ParallelEternalEngine`
- `packages/core/src/storage/goal-store.ts` — goal file format
- `packages/cli/src/slash-commands/fleet.ts` — `/fleet` slash command for fleet observability
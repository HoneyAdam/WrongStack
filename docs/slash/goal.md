# `/goal` — Autonomous Phase-Based Workflow

## What it does

Turns a free-text **goal** into a real, LLM-driven build. Goal:

1. **Plans** — a one-shot subagent decomposes the goal into a dependency-ordered
   list of **phases**, where each phase holds **many concrete todos**
   (`GoalPlanner`).
2. **Builds the graph** — the plan is materialized into a `PhaseGraph` with a
   populated `TaskGraph` per phase, persisted as per-project JSON.
3. **Runs autonomously** — the `PhaseOrchestrator` drives the graph in the
   background. Each todo is executed by a **fresh subagent with full tool
   access** (read/edit/write/bash/…). In the CLI, todos run sequentially within
   a phase to avoid concurrent writes to the same worktree. When git-worktree
   isolation is enabled, independent/parallelizable phases can run concurrently
   and are merged back sequentially.

This is "SDD logic but different": phased, persisted task-lists like SDD, but
driven by the autonomous orchestrator + concurrent subagents rather than
single-thread turn injection. Live progress is shown in the TUI PhaseMonitor.

## Usage

```
/goal                        → Show current status + progress
/goal start <goal>           → Plan + start an autonomous phase build
/goal start Build a CSV import wizard with validation
/goal pause                  → Pause (in-flight todos finish; no new ones start)
/goal resume                 → Resume a paused run
/goal stop                   → Stop and abort in-flight todos
/goal save                   → Persist the current phase graph
/goal list                   → List saved goal projects
/goal load [--resume] [title] → Load a saved project
```

## Architecture

```
┌─────────────┐     ┌───────────────┐     ┌──────────────┐
│  PhaseStore  │────▶│GoalWebSocket  │◀───▶│  WebUI Board  │
│  (JSON on   │     │   Handler     │     │  (GoalView)   │
│   disk)     │◀────│               │────▶│               │
└─────────────┘     └───────┬───────┘     └──────────────┘
                            │
                    ┌───────▼───────┐
                    │PhaseOrchestrator│
                    │                │
                    │ ┌────────────┐ │
                    │ │ Goal  │ │
                    │ │  Planner   │ │
                    │ └────────────┘ │
                    └───────┬───────┘
                            │ executes todos via
                    ┌───────▼───────┐
                    │  LLM agent    │
                    │  (subagent    │
                    │   per task)   │
                    └───────────────┘
```

## Naming

The feature was originally called **Goal** and used `autophase.*` WebSocket
events. It has been renamed to **Goal** with `goal.*` event types. The core
planner class is still `GoalPlanner` for historical reasons, but all user-
facing surfaces (slash commands, WebUI panels, docs) use "Goal".

## Subcommands

### `start <goal>`
Send your goal prompt. The CLI or WebUI plans phases and starts executing them.

### `pause`
Pause the current run. In-flight tasks finish; no new ones start.

### `resume`
Resume a paused run.

### `stop`
Stop the current run immediately — in-flight tasks are aborted.

### `save`
Persist the current phase graph to disk.

### `list`
List all saved goal projects with status and timestamps.

### `load [--resume] [title]`
Load a previously saved goal project. Use `--resume` to restart execution.

## Related

- `/plan` — Todos/tasks/plan dashboard
- `/worktree` — Git worktree isolation for phases
- The TUI shows live goal progress via `PhaseMonitor`

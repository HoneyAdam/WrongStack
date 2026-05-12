---
name: multi-agent
description: |
  Multi-agent orchestration workflow. Covers leader/worker roles,
  task delegation, done conditions, and result aggregation.
  Use for parallel task execution.
version: 1.0.0
---

# Multi-Agent Coordination

Guide for orchestrating multiple agents to work together on complex tasks.

## When to use multiple agents

- Large refactoring across multiple modules
- Parallel feature development
- Code review + implementation simultaneously
- Any task where separation of concerns speeds things up

## Agent roles

Define clear roles to avoid overlap:

- **Leader** — Coordinates, delegates, synthesizes
- **Worker** — Executes specific tasks
- **Reviewer** — Reviews and approves
- **Architect** — Makes design decisions
- **Debugger** — Root cause analysis

## Task delegation principles

1. **Atomic tasks** — Each task should be independently executable
2. **Clear boundaries** — Tasks should not overlap
3. **Dependency awareness** — Respect task dependencies
4. **Result aggregation** — Leader synthesizes worker results

## Communication

Agents communicate via structured messages:

- `task` — Assign work
- `result` — Return output
- `progress` — Status updates
- `error` — Failures
- `stop` — Cancellation

## Done conditions

Choose appropriate done condition:

- `all_tasks_done` — Wait for all tasks
- `critical_path_done` — Wait for critical path
- `first_completion` — Stop at first success
- `max_iterations` — Bounded execution

## Anti-patterns

- Over-delegation — Don't fragment work too much
- Under-delegation — Single agent bottleneck
- Role confusion — Workers doing leadership work
- Result loss — Not aggregating agent outputs
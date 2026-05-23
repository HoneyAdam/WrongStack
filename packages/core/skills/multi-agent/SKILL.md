---
name: multi-agent
description: |
  Use this skill when a task would benefit from parallel execution across
  multiple AI agents, or when orchestrating leader/worker patterns in WrongStack.
  Triggers: user says "fan out", "parallel", "delegate", "subagent", "fleet", "coordinator".
version: 1.1.0
---

# Multi-Agent Coordination — WrongStack

## When to fan out

✅ Good fits:
- "Audit these 50 files for X" — one subagent per chunk of 5-10 files
- "Run tests in all 12 packages" — parallel `pnpm test` across packages
- "Refactor 3 independent modules" — separate agents for each
- "Review this PR + check the tests + check docs" — three parallel workers

❌ Avoid:
- Single atomic task under 5 tool calls — overhead exceeds benefit
- Tasks requiring shared state — subagents have isolated contexts
- Long sequential dependencies — chain within one agent, don't fan out

## Roles

| Role | Responsibility | Tools |
|------|---------------|-------|
| **Leader** | Coordinates, delegates, synthesizes | `delegate`, `plan`, `read` |
| **Worker** | Executes a narrow subtask | Any needed tools |
| **Reviewer** | Validates worker output, approves/rejects | `grep`, `test`, `read` |
| **Architect** | Makes design decisions when workers hit ambiguity | `read`, `glob`, `grep` |

## Delegation patterns

### One-shot fan-out (all workers in one turn)

```
batch_tool_use([
  { tool: "delegate", input: { task: "Audit auth/session.ts for null-deref bugs", role: "bug-hunter" }},
  { tool: "delegate", input: { task: "Audit auth/token.ts for null-deref bugs", role: "bug-hunter" }},
  { tool: "delegate", input: { task: "Audit auth/refresh.ts for null-deref bugs", role: "bug-hunter" }},
])
```

### Fleet pattern (stateful, multiple turns)

```
delegate → spawn N subagents → assign_task per subagent → await_tasks
```

Use this when the task has dependencies — subagent 2 waits for subagent 1's artifact.

## Communication

Workers return structured results. Read `stopReason`:
- `end_turn` — clean finish, check `result`
- `budget_exhausted` — task too broad, narrow and retry
- `error` — infrastructure issue, surface it to user
- `aborted` — user cancelled, don't retry silently

## Result aggregation

Leader collects and synthesizes:

```
For each worker result:
  - Extract key findings (don't just paste raw output)
  - Deduplicate (multiple workers may find the same issue)
  - Prioritize: critical > high > medium > low
  - Present as unified report
```

## Anti-patterns

- **Over-delegation**: Firing 50 subagents in one turn — model context explodes, nothing gets done
- **Under-delegation**: One agent doing everything — defeats the purpose, burns budget
- **Role mismatch**: Using `bug-hunter` to write documentation, or `refactor-planner` for security audits
- **Result loss**: Subagents return useful data but leader doesn't aggregate — always check `result`
- **Silent failure**: `budget_exhausted` subagent output ignored — partial results are still results

## Context sharing

Subagents share **nothing** — no memory, no session state, no variable scope. If subagent B needs output from subagent A, the leader must pass it explicitly as part of the task description or pass it via a shared file the leader writes before delegating.

## Skills in scope

- `bug-hunter` — parallel file audits
- `security-scanner` — parallel security scans
- `refactor-planner` — parallel module analysis
- `audit-log` — aggregating multiple session analyses
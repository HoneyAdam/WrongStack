# Multi-Agent Coordination — WrongStack (Compact)

Coordinates parallel AI agent execution for tasks that benefit from fanning out.

## Rules

1. Subagents share nothing — no memory, no session state.
2. Leader must aggregate results.
3. Narrow task scope per subagent — broad tasks exhaust budget.
4. Role must match task — don't use bug-hunter to write docs.
5. Check `stopReason`: end_turn (clean), budget_exhausted (retry), error (surface), aborted (don't retry).
6. Don't fan out single atomic tasks under 5 tool calls.

## When to fan out

✅ Good: "Audit 50 files" — one subagent per 5-10 files. "Run tests in 12 packages" — parallel.
❌ Avoid: Single atomic task under 5 calls. Tasks requiring shared state.

## Roles

| Role | Responsibility |
|------|---------------|
| **Leader** | Coordinates, delegates, synthesizes |
| **Worker** | Executes a narrow subtask |
| **Reviewer** | Validates worker output |
| **Architect** | Design decisions when workers hit ambiguity |
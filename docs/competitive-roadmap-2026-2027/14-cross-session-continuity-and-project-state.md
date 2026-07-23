# Cross-Session Continuity and Project State

**Priority:** P1  
**Horizon:** 3–7 months  
**Status:** Proposed

## Outcome

Make long-running work resumable through explicit session handoff summaries and a structured project workflow state, rather than relying on free-form memory and mailbox messages alone.

## Scope

- End-of-session handoff candidate containing goals, decisions, completed work, open risks, and next actions.
- User-reviewable promotion of durable facts into Sage.
- A versioned project state store for plans, SDD items, worktrees, task dependencies, and external references.
- Resume previews that show what will be restored before context injection.
- Conflict handling when multiple surfaces update the same project state.

## Architecture

- Keep session JSONL immutable and canonical for conversation history.
- Store derived handoffs separately with source event ranges and schema version.
- Use optimistic revisions and the existing project-wide locking patterns.
- Link state nodes into Sage's graph without making `core` depend on `sage`.

## Delivery plan

1. Define handoff and project-state schemas.
2. Generate deterministic rule-based handoffs, then add optional LLM enrichment.
3. Add resume preview/selection in CLI and WebUI.
4. Add cross-surface revision/conflict handling.
5. Migrate SDD/worktree/plan references incrementally behind adapters.

## Acceptance criteria

- Session lifecycle recording invariants remain intact, including sharded IDs and writer finalization.
- Resuming never silently injects stale or superseded decisions.
- Every derived statement links back to its source session/events.
- Concurrent updates fail or merge predictably; last-writer-wins is not used for structured task state.


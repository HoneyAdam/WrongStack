# Split `packages/core/src/coordination/director.ts` by responsibility

**Labels**  
`refactor` `architecture` `tech-debt` `core` `hotspot`

## Summary

`packages/core/src/coordination/director.ts` is becoming the coordination-layer god module. Spawn policy, task lifecycle, budgets, collab sessions, and repair behavior are too concentrated.

## Why this matters

The multi-agent coordination layer is strategically important, but its current structure raises change risk and makes defects harder to localize.

## Scope

Refactor `director.ts` into focused modules while preserving the public `Director` API.

## Acceptance criteria

- [ ] `director.ts` is split into focused modules:
  - [ ] spawn/admission
  - [ ] task registry + waiting
  - [ ] budget enforcement
  - [ ] repair/quality loops
  - [ ] collab session handling
  - [ ] persistence/checkpoint integration
- [ ] Public `Director` API remains backward-compatible
- [ ] `packages/core/tests/coordination/*.test.ts` remain green
- [ ] At least 1 new integration-style test covers a multi-step director flow

## Suggested implementation notes

- Extract behavior by responsibility, not by arbitrary line ranges.
- Preserve invariants around task ownership, waiters, and budget accounting.
- Keep integration points explicit.

## Effort

Estimated: **5–7 days**

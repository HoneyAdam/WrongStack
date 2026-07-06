# Split `packages/tui/src/app-reducer.ts` into composed sub-reducers

**Labels**  
`refactor` `architecture` `tech-debt` `tui` `hotspot`

## Summary

`packages/tui/src/app-reducer.ts` has become a secondary hotspot. Logic extracted from `app.tsx` is accumulating here instead of being decomposed.

## Why this matters

Reducer concentration makes state transitions harder to reason about and increases the risk that UI refactors simply move complexity sideways instead of reducing it.

## Scope

Split the reducer into domain-focused sub-reducers and compose them through a typed root reducer.

## Acceptance criteria

- [ ] `app-reducer.ts` is split into sub-reducers by domain:
  - [ ] history/input
  - [ ] pickers/overlays
  - [ ] settings/statusline
  - [ ] fleet/coordinator
  - [ ] sessions/projects
- [ ] Root reducer composes sub-reducers through a single typed entrypoint
- [ ] State transitions remain behaviorally equivalent
- [ ] Existing reducer tests pass unchanged or with minimal fixture updates
- [ ] New tests exist for at least 2 extracted reducer domains

## Suggested implementation notes

- Preserve action compatibility where practical.
- Prefer small, testable state domains over one generic “utils” reducer.
- Keep cross-slice coordination explicit.

## Effort

Estimated: **3–5 days**

# Split `packages/tui/src/app.tsx` into feature-scoped modules and sub-hooks

**Labels**  
`refactor` `architecture` `tech-debt` `tui` `hotspot`

## Summary

`packages/tui/src/app.tsx` is still the largest UI hotspot in the repo and currently acts as a UI shell, event bridge, controller host, and feature router. Even after earlier extractions, it remains too large to evolve safely.

## Why this matters

Most TUI feature work still lands in this file. That increases:
- regression risk
- review difficulty
- onboarding cost
- coupling between unrelated UI concerns

This issue is about reducing architectural concentration, not changing product behavior.

## Scope

Refactor `packages/tui/src/app.tsx` into feature-scoped modules/hooks, with the initial goal of reducing the file size and isolating major concerns.

## Acceptance criteria

- [ ] `packages/tui/src/app.tsx` is reduced to **< 1500 lines** in the first pass
- [ ] Feature slices are extracted into focused modules/hooks:
  - [ ] session/history
  - [ ] overlay/picker management
  - [ ] fleet/director UI
  - [ ] settings/statusline
  - [ ] SDD/autonomy flows
- [ ] No new inline effect/callback blocks over ~30 lines remain in `app.tsx`
- [ ] `pnpm --filter @wrongstack/tui typecheck` passes
- [ ] `pnpm --filter @wrongstack/tui test` passes
- [ ] At least one new integration test covers a real interaction path

## Progress notes

Current session started the first low-risk extraction slices:
- moved restored-history computation into `packages/tui/src/app-initial-state.ts`
- moved the giant reducer bootstrap object into `createInitialState(...)`
- extracted input-history persistence into `packages/tui/src/hooks/use-input-history-persistence.ts`
- extracted prompt-picker loader/category-building into `packages/tui/src/hooks/use-prompt-picker.ts`
- extracted mode-picker opener mapping into `packages/tui/src/hooks/use-mode-picker.ts`
- extracted statusline hidden-item sync into `packages/tui/src/hooks/use-statusline-hidden-sync.ts`
- extracted stream-chip expiration logic into `packages/tui/src/hooks/use-stream-chip-expiration.ts`
- extracted working-directory chip formatting/sync into `packages/tui/src/hooks/use-working-dir-chip.ts`
- wired `packages/tui/src/app.tsx` to consume the extracted modules
- added focused tests in:
  - `packages/tui/tests/app-initial-state.test.ts`
  - `packages/tui/tests/prompt-picker-hook.test.ts`
  - `packages/tui/tests/mode-picker-opener.test.ts`
  - `packages/tui/tests/statusline-hidden-sync.test.ts`
  - `packages/tui/tests/stream-chip-expiration.test.ts`
  - `packages/tui/tests/working-dir-chip.test.ts`

This is intentionally a **state/bootstrap, persistence, and small sync/opener extraction**, not an interaction-flow extraction. It reduces `app.tsx` size and cognitive load without touching the more fragile keyboard/submit/event-bridge behavior yet.

## Suggested implementation notes

- Prefer feature boundaries over purely mechanical hook extraction.
- Avoid moving complexity wholesale into one replacement hotspot.
- Keep behavior stable; this is a refactor, not a redesign.

## Effort

Estimated: **5–8 days**

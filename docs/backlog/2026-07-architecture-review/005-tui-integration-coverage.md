# Strengthen TUI integration coverage beyond mount/no-crash behavior

**Labels**  
`testing` `tui` `quality`

## Summary

Current TUI integration tests prove mount/no-crash behavior, but they do not provide enough behavioral protection for the size and complexity of the TUI app.

## Why this matters

Large refactors in the TUI surface still lack a strong behavior net, especially around:
- keyboard handling
- picker flows
- resume/render paths
- input submit/history behavior

## Scope

Add scenario-level TUI tests that assert real interaction behavior.

## Acceptance criteria

- [ ] Add scenario tests covering:
  - [~] slash menu open/navigate/submit
  - [~] picker open/close behavior
  - [~] mode/model selection flow
  - [~] session resume rendering
  - [~] input submit + history update
- [~] Tests assert behavior, not just no-throw render
- [~] New tests run reliably in CI without flake

## Progress notes

Current progress delivered stable slices in:
- `packages/tui/tests/app-integration-submit-history.test.ts`
- `packages/tui/tests/mode-picker.test.ts`
- `packages/tui/tests/picker-keys.test.ts`
- `packages/tui/tests/app-resume-render.test.ts`

Covered behavior now includes:
- grouped slash-menu rendering
- scrolled/windowed slash-menu context retention
- slash-menu empty state guidance
- Input Enter vs Shift+Enter key-event distinction
- mode-picker rendering, active marker, and empty state
- mode-picker panel-open bridge behavior
- model-picker provider selection flow
- model-picker model search + select flow
- mode-picker Enter → `/mode <id>` submission flow
- resumed history rendering for user / assistant / tool entries

This materially improves issue 005, but does **not** yet complete the top-level `<App />` submit/history scenario. Ink's full-app mock rendering remains too shallow for a reliable real-submit assertion, so the remaining best target is a narrower seam around submit/history mutation instead of brute-forcing the app shell frame.

## Suggested implementation notes

- Favor stable, high-signal interactions over broad snapshot coverage.
- Start with the highest-risk flows used by current refactor work.
- Keep fixtures minimal and deterministic.

## Effort

Estimated: **2–4 days**

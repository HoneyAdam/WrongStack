# Expand CLI boot/dispatch integration tests

**Labels**  
`testing` `cli` `quality`

## Summary

The current CLI baseline tests characterize only a narrow part of the boot contract. Large refactors can still regress dispatch behavior without early detection.

## Why this matters

The CLI boot path is one of the highest-risk integration surfaces in the repo.

## Scope

Add integration tests that cover more of the real boot/dispatch behavior while staying reliable in CI.

## Acceptance criteria

- [ ] Add integration tests for:
  - [ ] single-shot path
  - [ ] TUI dispatch path
  - [ ] WebUI dispatch path
  - [ ] plugin-management short-circuit
  - [ ] no-TTY/no-stdin non-hanging behavior
- [ ] Tests avoid the worker-contention issue documented in current test comments
- [ ] At least one test exercises `main()` end-to-end with bounded runtime

## Suggested implementation notes

- Prefer bounded runtime and targeted stubs over importing the entire dependency graph unnecessarily.
- Preserve existing baseline tests; expand rather than replace.

## Effort

Estimated: **2–3 days**

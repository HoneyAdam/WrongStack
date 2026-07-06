# Add deeper end-to-end orchestration tests for multi-agent flows

**Labels**  
`testing` `core` `multi-agent` `quality`

## Summary

Multi-agent flows are well unit-tested, but still under-covered as realistic journeys.

## Why this matters

The coordination layer is strategically important and has high complexity. It needs stronger end-to-end protection.

## Scope

Add scenario tests for multi-step orchestration behavior.

## Acceptance criteria

- [ ] Add scenario tests covering:
  - [ ] spawn → assign → await
  - [ ] quality gate repair loop
  - [ ] collab debug flow
  - [ ] mailbox result propagation in a coordinated task
- [ ] Tests validate user-visible outcomes, not just event emission
- [ ] Flake rate remains acceptable in CI

## Suggested implementation notes

- Keep scenarios focused and deterministic.
- Start with one representative happy-path flow per subsystem.

## Effort

Estimated: **3–5 days**

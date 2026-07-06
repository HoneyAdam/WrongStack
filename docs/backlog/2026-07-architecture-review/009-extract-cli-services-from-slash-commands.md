# Move shared logic out of `packages/cli/src/slash-commands/` into service modules

**Labels**  
`refactor` `architecture` `cli` `tech-debt`

## Summary

Architecture tests currently maintain a temporary allowlist for non-command modules importing slash-command code.

## Why this matters

This leaks command-layer structure into general runtime code and makes CLI internals harder to evolve cleanly.

## Scope

Create a shared service layer for reusable logic currently living under `slash-commands/`.

## Acceptance criteria

- [ ] Introduce `packages/cli/src/services/` or equivalent shared layer
- [ ] Reduce the temporary slash-command importer allowlist
- [ ] No new non-command slash-command imports are introduced
- [ ] At least 3 existing shared logic callsites are migrated

## Suggested implementation notes

- Extract logic, not command UX.
- Keep slash-command modules thin adapters over shared services.

## Effort

Estimated: **2–4 days**

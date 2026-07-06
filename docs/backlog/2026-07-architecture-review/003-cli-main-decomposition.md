# Continue `packages/cli/src/cli-main.ts` decomposition into stable boot-phase modules

**Labels**  
`refactor` `architecture` `tech-debt` `cli` `hotspot`

## Summary

`packages/cli/src/cli-main.ts` still carries too much orchestration despite earlier extraction work. It remains a central regression surface for CLI boot, runtime wiring, and host dispatch.

## Why this matters

The CLI entrypoint is still a high-blast-radius file:
- new features tend to land here
- unrelated concerns are closure-coupled
- refactors remain expensive and risky

## Scope

Continue the existing decomposition effort, but focus on stable boot-phase APIs rather than line-moving alone.

## Acceptance criteria

- [ ] `cli-main.ts` is reduced to **< 1200 lines** in the next phase
- [ ] Boot logic is organized behind stable phase APIs:
  - [ ] config/bootstrap
  - [ ] container wiring
  - [ ] session/runtime wiring
  - [ ] host dispatch
- [ ] `main()` reads as orchestration-only, not implementation-heavy
- [ ] `packages/cli/tests/cli-main-baseline.test.ts` remains green
- [ ] At least 2 new integration tests cover real dispatch behavior

## Suggested implementation notes

- Prefer extracting named boot-phase functions with typed inputs/outputs.
- Avoid introducing new implicit shared state between phases.
- Keep behavior stable; this issue is not for changing CLI UX.

## Effort

Estimated: **4–6 days**

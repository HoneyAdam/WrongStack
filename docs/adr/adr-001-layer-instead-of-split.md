# Architecture Decision Record — 001: Layer Instead of Split

| Field | Value |
|---|---|
| **Date** | 2026-05-20 |
| **Status** | Accepted |
| **Deciders** | WrongStack core team |
| **Supersedes** | — |
| **Superseded by** | — |

## Context

`@wrongstack/core` contains 17 logical subdirectories (`kernel/`, `core/`, `execution/`, `storage/`, `security/`, `coordination/`, `observability/`, etc.) that form a natural layering hierarchy. The package exports map already reflects this (`./kernel`, `./storage`, `./coordination`, etc.). The question arose whether to physically extract the most independent subdirectory (`kernel/`) into a standalone `@wrongstack/kernel` package.

## Decision

**Rejected**: Extract `@wrongstack/kernel` as a separate package at this time.

**Accepted**: Enforce strict internal layering rules within `@wrongstack/core` through automated tests. Keep the physical package structure as-is.

## Reasons

### Why extraction was considered

`kernel/` is the only subdirectory that:
- Contains zero runtime dependencies on other core subdirectories (only type-only imports)
- Has a clean dependency direction (everything above kernel depends on it, it depends on nothing)
- Has a clear public surface (`Container`, `Pipeline`, `EventBus`, `RunController`, `TOKENS`)

### Why it was rejected

`kernel/container.ts` imports `WrongStackError` from `types/errors.js` — a **runtime** class, not a type. This single runtime dependency creates a fundamental problem:

1. If we extract `kernel/` alone, it would need `types/` as a peer dependency — but `types/` lives inside `core` alongside `kernel`
2. Moving `WrongStackError` into `kernel/` breaks every other subdirectory that imports it from `../types/errors.js`
3. Creating a minimal `core-types` package just to hold `WrongStackError` adds a package boundary with no technical benefit
4. `WrongStackError` is the framework's base error type — it's fundamentally a core concern, not a kernel primitive

In short: the extraction cost is disproportionate to the benefit. `kernel/` is conceptually independent but physically entangled through the error type.

## Consequences

### Positive
- No package boundary overhead (version negotiation, CI pipelines, publish steps)
- `WrongStackError` stays where it logically belongs (core error hierarchy)
- Internal layering is still enforced — see `docs/architecture-rules.md`

### Negative
- `kernel/` technically violates the "no runtime imports from higher layers" rule by importing `WrongStackError` from `types/`
- This is an acceptable exception documented in the rules

## Alternatives Considered

1. **Move `WrongStackError` into `kernel/errors.ts`** — Would require updating 42+ import references across core, breaking every subdirectory that currently imports from `../types/errors.js`. Not worth it.

2. **Create `@wrongstack/kernel-types` package** — A package containing only type definitions that kernel needs. Over-engineered; adds complexity without solving a real problem.

3. **Extract `@wrongstack/kernel` and accept it depends on `@wrongstack/core`** — Would create an inverted dependency (kernel depends on core), defeating the purpose of extraction.

## When to Re-evaluate

Extract `@wrongstack/kernel` (or `@wrongstack/kernel-types`) as a separate package becomes the right move when:

1. `WrongStackError` is refactored into a minimal error module that other packages can depend on without pulling in the full error hierarchy, OR
2. A concrete external need emerges (e.g., a standalone tool that only needs Container/Pipeline without the full agent runtime)

## Enforcement

See `packages/core/tests/architecture/package-boundaries.test.ts` and `docs/architecture-rules.md`.
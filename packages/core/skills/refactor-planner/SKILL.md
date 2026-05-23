---
name: refactor-planner
description: |
  Use this skill when planning a multi-file refactor, code modernization,
  or technical debt resolution in WrongStack. Triggers: user says "refactor",
  "technical debt", "modernize", "clean up", "restructure", "decompose".
version: 1.1.0
---

# Refactor Planner — WrongStack

Analyzes code structure and produces a phased refactoring plan with risk assessment, dependency ordering, and rollback strategy.

## When to use

- Multi-file refactors
- Breaking up large modules
- Changing public APIs
- Addressing technical debt
- Migration to new patterns

## Workflow

```
1. Analyze:  Build dependency graph, identify coupling
2. Score:    Rate each module by size, complexity, test coverage
3. Plan:     Order tasks by risk, dependency, payoff
4. Document: Phased markdown plan with checkpoints
```

## Risk criteria

| Factor | Low Risk | Medium Risk | High Risk |
|--------|----------|-------------|-----------|
| Cyclomatic complexity | <10 | 10-20 | >20 |
| Test coverage | >80% | 50-80% | <50% |
| Fan-out (imports) | <5 | 5-15 | >15 |
| Public API surface | unchanged | modified | removed |

## Phase structure

Good refactors have 3 phases:

```
Phase 1: Low Risk / High Payoff
  - No behavior change
  - Tests already pass
  - Quick wins

Phase 2: Medium Risk (test heavily)
  - Some behavior may change
  - Significant test coverage needed
  - May need rollback plan

Phase 3: High Risk (full regression)
  - Behavior changes expected
  - Integration tests required
  - Coordinate with team
```

## Risk assessment checklist

```json
{
  "module": "src/auth/session.ts",
  "size": 450,
  "cyclomatic": 12,
  "testCoverage": 65,
  "fanOut": 8,
  "publicAPI": true,
  "dependencies": ["core", "providers"],
  "dependents": ["cli", "tui", "webui"]
}
```

## Phased plan output

```
## Refactor Plan — <target>

### Phase 1: Low Risk / High Payoff
| # | Task | Module | Risk | Est. Time |
|---|------|--------|------|-----------|
| 1 | Extract `ToolExecutor` interface | core/tool-executor.ts | low | 2h |
| 2 | Decouple `SessionStore` from Agent | core/session-store.ts | low | 4h |

### Phase 2: Medium Risk (test heavily)
| # | Task | Module | Risk | Est. Time |
|---|------|--------|------|-----------|
| 3 | Break circular dep: Config ↔ Logger | core/config.ts | medium | 6h |

### Dependency Graph
```
config.ts → logger.ts → path-resolver.ts
     ↓           ↓
  secret-vault.ts    session-store.ts
     ↓                    ↓
     └────────→  agent.ts  ←←←
```

### Rollback Strategy
- Phase 1: `git checkout` if tests fail
- Phase 2: Feature flag, can disable
- Phase 3: Blue-green deployment

### Exit Criteria
- [ ] All Phase 1 tasks pass `pnpm test`
- [ ] No circular deps in `src/core`
- [ ] `Context` interface < 20 methods
```

## Anti-patterns

- **Don't plan without analyzing** — assumptions cause wasted work
- **Don't skip rollback strategy** — every refactor can fail
- **Don't over-phase** — if a task takes <1h, merge it
- **Don't ignore team constraints** — parallelization only works if reviewers exist
- **Don't skip the dependency graph** — the most important part

## Skills in scope

- `bug-hunter` — for finding bugs exposed by the refactor
- `git-flow` — for committing each phase properly
- `multi-agent` — for parallel analysis of multiple modules
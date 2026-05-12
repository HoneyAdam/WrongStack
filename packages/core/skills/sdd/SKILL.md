---
name: sdd
description: |
  Specification-driven development workflow. Covers spec parsing,
  task graph generation from requirements, dependency tracking, and
  done-condition execution. Use when implementing features.
version: 1.0.0
---

# Spec-Driven Development

Guide the agent through specification-first development workflow.

## Core Principle

Every non-trivial change starts with a spec. The spec is the source of truth. Tasks are derived from specs, not the other way around.

## Workflow

```
Spec → Analysis → Task Graph → Execution → Done
```

### When to use

- New feature implementation
- Bug fix with complexity
- Refactoring with scope
- Any task requiring more than 1 hour

### Spec sections

A good spec includes:

1. **Overview** — What problem does this solve?
2. **Requirements** — Functional and non-functional requirements with priorities
3. **Architecture** — High-level design if needed
4. **API Design** — If applicable
5. **Data Model** — If applicable
6. **Security** — Auth, permissions, data handling
7. **Acceptance Criteria** — How do we know it's done?

### Requirement format

```
[functional] User can authenticate with OAuth2
[security] Rate limiting: 100 req/min per user
[performance] Response time < 200ms p95
```

Priority markers: `[critical]`, `[high]`, `[medium]`, `[low]`

## Task generation

Tasks are derived from requirements:

- Each requirement → one or more tasks
- Requirements with acceptance criteria → separate test tasks
- Critical requirements → tasks marked critical
- Blocked requirements → blocked tasks

## Task states

```
pending → in_progress → review → completed
              ↓
           blocked (waiting on dependencies)
              ↓
           failed
```

## Done conditions

A feature is done when:
1. All critical and high priority tasks completed
2. Tests written and passing
3. Documentation updated
4. No blocked tasks remaining
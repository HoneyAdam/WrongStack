---
name: sdd
description: |
  Use this skill when starting a non-trivial implementation, bug fix, or refactor
  in WrongStack. Triggers: user says "/sdd", "spec", "specification", "task graph",
  "SDD", "acceptance criteria", or starts a new feature.
version: 2.1.0
---

# Spec-Driven Development — WrongStack

Every non-trivial change starts with a spec. The spec is the source of truth.

## When to use

- New feature implementation
- Bug fix with complexity
- Refactoring with scope
- Any task requiring more than 1 hour

## The SDD workflow

```
1. /sdd new [title]          → Build spec from questions
2. /sdd tasks <id>           → Generate task graph from spec
3. /sdd graph <id>           → Visualize dependencies
4. /sdd critical <id>        → Find bottlenecks
5. /sdd execute <id>         → Run tasks (or execute manually)
```

## /sdd command reference

| Command | What it does |
|---------|--------------|
| `/sdd new [title]` | Interactive spec builder |
| `/sdd from <template>` | Create from template (feature, bugfix, refactor, infra, cli-command) |
| `/sdd list` | List saved specs |
| `/sdd show <id>` | Show spec + completeness |
| `/sdd tasks <id>` | Generate task graph |
| `/sdd graph <id>` | ASCII visualization |
| `/sdd status <id>` | Task list by status |
| `/sdd critical <id>` | Critical path + bottlenecks |
| `/sdd execute <id>` | Auto-execute tasks |
| `/sdd approve <id>` | Approve pending tasks |
| `/sdd version <id>` | Version history |

## Spec templates

| Template | Best for |
|---|---|
| `feature` | New feature development |
| `bugfix` | Bug fix with root cause analysis |
| `refactor` | Code refactoring with goals |
| `infra` | Infrastructure/tooling changes |
| `integration` | External service integration |
| `cli-command` | New CLI commands/slash commands |

## Spec structure

A complete spec has:
1. **Overview** — What problem does this solve?
2. **Requirements** — `[priority] description` format
3. **Architecture** — High-level design (if needed)
4. **API Design** — Endpoints, inputs, outputs (if applicable)
5. **Acceptance Criteria** — How do we know it's done?

### Requirement format

```
[critical] Users can authenticate with OAuth2
[high] Rate limiting: 100 req/min per user  
[medium] Response time < 200ms p95
[low] Support dark mode
```

## Task graph generation

Each requirement generates one or more tasks. Tasks have states:
```
pending → in_progress → review → completed
              ↓
           blocked (waiting on dependencies)
              ↓
           failed
```

## Critical path

The critical path finds:
- **Bottleneck tasks** blocking the most downstream work
- **Parallel groups** that can run concurrently
- **Ready tasks** that can start immediately
- **Execution order** respecting all dependencies

## Anti-patterns

- **Writing code before the spec** — you'll rewrite it anyway
- **Spec that's too vague** — "improve auth" is not a spec, "Users authenticate via OAuth2 with PKCE" is
- **Tasks with no dependencies** — everything is a dependency of something
- **Spec without acceptance criteria** — how do you know when it's done?
- **Skipping /sdd for urgent tasks** — the spec is what makes "urgent" possible

## Skills in scope

- `refactor-planner` — when the spec reveals a multi-file refactor
- `bug-hunter` — when a bugfix spec needs a root cause analysis section
- `multi-agent` — for executing parallel task groups
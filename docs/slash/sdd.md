# /sdd — AI-Driven Spec-Driven Development

## What it does

`/sdd` runs a structured AI-driven workflow for building features: the AI asks clarifying questions, generates a spec, creates an implementation plan, breaks it into tasks, and executes them. Each phase transitions via `/sdd approve`.

## Phase flow

```
questioning → spec_review → implementation → task_review → executing → done
```

1. **`/sdd new [title]`** — Start a session. AI prompts you with contextual questions about the feature.
2. **Answer naturally** — The AI continues the interview.
3. **`/sdd approve`** — When the AI has gathered enough, it auto-generates the spec. `/sdd approve` moves to `spec_review`.
4. **Review spec** — Run `/sdd spec` to read it.
5. **`/sdd approve`** — Approve spec → moves to `implementation`. AI generates implementation plan + tasks.
6. **`/sdd approve`** — Approve tasks → moves to `executing`. AI executes tasks one by one.
7. **`/sdd done <N>`** — Mark a task done by number or fuzzy title match.

## Auto-detection patterns

The session can auto-detect task completion from AI output:
- `✅ Task: <title>` or `✅ <title>`
- `Task N: complete/done/finished`
- `Completed: <title>` or `Done: <title>`
- `/sdd done N`

## Key subcommands

| Usage | Effect |
|---|---|
| `/sdd new [title]` | Start new session (add `--force` to skip resume check) |
| `/sdd resume` | Resume saved session |
| `/sdd approve` | Advance to next phase |
| `/sdd spec` | Show current session's spec |
| `/sdd plan` | Show implementation plan |
| `/sdd tasks` | Show task list with progress |
| `/sdd done <N>` | Mark task done |
| `/sdd status` | Full session status |
| `/sdd cancel` | Cancel and delete session |
| `/sdd list` | List saved specs |
| `/sdd show <id>` | Show saved spec details |
| `/sdd templates` | List available templates |
| `/sdd from <template-id>` | Create draft from template |
| `/sdd version <id>` | Show version history |

## Storage

```
<projectRoot>/.wrongstack/
  sdd-session.json     ← active session (resumable)
  specs/              ← approved/archived specs
  task-graphs/        ← task graph state per spec
```

## Code reference

- `packages/cli/src/slash-commands/sdd.ts`
- `packages/core/src/sdd/` — `SpecParser`, `TaskGenerator`, `TaskTracker`, `TaskFlow`, `AISpecBuilder`
- `packages/core/src/storage/spec-store.ts`
- `packages/core/src/storage/task-graph-store.ts`
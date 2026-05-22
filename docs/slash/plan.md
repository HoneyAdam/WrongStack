# /plan — Strategic Plan Board

## What it does

`/plan` is the persistent, session-surviving counterpart to `/todos`. Plan items are atomic-written to `<session-dir>/<session-id>.plan.json` on every mutation and read on session resume so the banner can show "N open plan items".

While `/todos` is a moment-to-moment task board the LLM mutates per turn, `/plan` captures the overall approach before any work begins and survives crashes and resume.

## Subcommands

| Usage | Effect |
|---|---|
| `/plan` | Show all plan items |
| `/plan show` | Same as above |
| `/plan add <title>` | Add a new item (optionally with details via `/plan promote`) |
| `/plan start <id\|#>` | Mark item in_progress |
| `/plan done <id\|#>` | Mark item done |
| `/plan remove <id\|#>` | Remove item |
| `/plan promote <id\|#> [subtask ...]` | Convert plan item to todos, optionally splitting into subtasks |
| `/plan derive <id\|#>` | Convert plan item to todos (auto-split into logical subtasks) |
| `/plan template list` | List available plan templates |
| `/plan template use <name>` | Apply a template (creates multiple items) |
| `/plan clear` | Clear all items |

## Plan item shape

```typescript
interface PlanItem {
  id: string;
  title: string;
  details?: string;
  status: 'pending' | 'in_progress' | 'done';
  createdAt: string;  // ISO timestamp
  updatedAt: string;  // ISO timestamp
}
```

## Templates

Plan templates are predefined item sets for common workflows. Example templates:
- `bug-fix` — Reproduce → Fix → Test → Document
- `feature` — Design → Implement → Test → Review → Deploy
- `refactor` — Analyze → Plan → Execute → Verify

## `promote` vs `derive`

Both convert a plan item to todos, but:

| Command | Subtask splitting | Updates plan item status |
|---|---|---|
| `/plan promote <id> subA subB` | Manual — you specify subtask titles | Yes → in_progress |
| `/plan derive <id>` | Automatic — LLM/logic splits into logical parts | Yes → in_progress |

## Code reference

- `packages/cli/src/slash-commands/plan.ts`
- `packages/core/src/storage/plan-store.ts`
- `packages/core/src/storage/plan-store.test.ts`
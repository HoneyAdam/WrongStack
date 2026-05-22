# /todos — Session Todo List

## What it does

Manages an in-memory todo list scoped to the current session. Todos live in `ctx.todos` — they are lost on session end unless checkpointed separately. For persistent plans across sessions, see `/plan`.

## Subcommands

| Usage | Effect |
|---|---|
| `/todos` | Show all todos |
| `/todos show` | Same as above |
| `/todos list` | Same as above |
| `/todos add <text>` | Add a pending todo with auto-generated id |
| `/todos done <id\|index>` | Mark one done (matches by id, index, or fuzzy title match) |
| `/todos clear` | Clear all todos |

## Todo shape

```typescript
interface Todo {
  id: string;       // "todo_<timestamp>_<random7chars>"
  content: string;  // the task description
  status: 'pending' | 'in_progress' | 'completed';
}
```

## ID matching priority

1. Exact id match (`todo_174123456_abc1234`)
2. Index match (1-based: `todos done 3` → `ctx.todos[2]`)
3. Fuzzy title match (case-insensitive substring in either direction)

## Code reference

- `packages/cli/src/slash-commands/todos.ts`
- `packages/core/src/types/context.ts` — `Todo` type
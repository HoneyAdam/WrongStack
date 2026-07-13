# `/kanban` — Project kanban boards

`/kanban` manages persisted multi-board kanban state for the active project. Aliases: `/kb`, `/board`.

## Board commands

```text
/kanban
/kanban open
/kanban create <title>
/kanban duplicate <boardId> [title]
/kanban show <boardId>
/kanban delete <boardId>
/kanban rename <boardId> <title>
/kanban snapshot [boardId]
/kanban generate <description>
/kanban export <boardId>
```

Bare `/kanban` lists boards. `open` (also accepted as `panel` or `tui`) opens the kanban panel when the TUI callback is available; otherwise it reports that the panel is TUI-only.

## Task, column, and graph commands

```text
/kanban task <boardId>
/kanban task add <boardId> <title>
/kanban task ready [boardId]
/kanban task claim [boardId] <agent>
/kanban task release <boardId> <taskId>
/kanban task show|move|done|block|remove ...
/kanban task split|merge|chain|copy|transfer ...
/kanban task priority|assign|dispatch|depend ...
/kanban task metric add|set ...
/kanban task note ...
/kanban task check add ...
/kanban column add <boardId> <title>
/kanban column rm <boardId> <columnId>
/kanban graph export|import|sync ...
/kanban deps <boardId> <taskId>
```

Use `/help kanban` for the complete argument shapes emitted by the registered command. Board and task ids may be abbreviated where the implementation can resolve the prefix unambiguously.

## Code reference

- `packages/cli/src/slash-commands/kanban.ts` — registered command and parsing
- `packages/kanban/` — board persistence and domain operations

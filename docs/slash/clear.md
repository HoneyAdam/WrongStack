# /clear — Session Reset

## What it does

Wipes all session state — messages, todos, read-file tracking, file mtimes, and meta — then clears the terminal screen. Use this when you want a completely fresh conversation without restarting `wstack`.

## What gets wiped

| What | How |
|---|---|
| `ctx.messages` | `ctx.state.replaceMessages([])` |
| `ctx.todos` | `ctx.state.replaceTodos([])` |
| `ctx.readFiles` | `ctx.readFiles.clear()` |
| `ctx.fileMtimes` | `ctx.fileMtimes.clear()` |
| `ctx.meta` | deletes every key via `ctx.state.deleteMeta()` |
| Memory store | `await opts.memoryStore?.clear()` |
| Terminal | `opts.onClear?.()` + `opts.renderer.clear()` |

## What does NOT get wiped

- `~/.wrongstack/memory.md` (user-global memory) — only the session-scoped memory store is cleared
- `~/.wrongstack/config.json`
- `.wrongstack/AGENTS.md`
- Session history on disk (only the in-memory/REPL state is cleared)
- Git state, plugin config, provider credentials

## Code reference

- `packages/cli/src/slash-commands/clear.ts`
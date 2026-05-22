# /context — Context Window Inspector

## What it does

Shows a live snapshot of the current context window: message counts, estimated tokens, tool call stats, todo counts, read files, and active context policy. Also has subcommands for switching context modes and repairing orphan tool_use/tool_result blocks.

## Subcommands

| Usage | Output |
|---|---|
| `/context` | Summary: messages, tokens, tool calls, todos, read files, active mode |
| `/context detail` | Above + model, cwd, projectRoot, file mtimes, file list |
| `/context repair` | Scan for orphan tool_use/tool_result blocks, remove them |
| `/context mode` | List available context-window modes |
| `/context mode <id>` | Switch to a named mode (e.g. `minimal`, `balanced`, ` expansive`) |

## What "repair" does

During manual editing of the conversation history, it's possible to leave `tool_use` blocks that don't have a matching `tool_result`, or vice versa. `/context repair` runs `repairToolUseAdjacency()` to detect and remove these orphan pairs, then reports how many were removed.

## Context window modes

WrongStack ships with configurable context-window policies that control when compaction fires:

| Mode | Behavior |
|---|---|
| `minimal` | Compacts early, preserves minimal history |
| `balanced` | Default; balances context and budget |
| `expansive` | Compacts late, preserves more conversation |

Mode is stored in `ctx.meta['contextWindowMode']` and `ctx.meta['contextWindowPolicy']` as a resolved policy object.

## Code reference

- `packages/cli/src/slash-commands/context.ts`
- `packages/core/src/execution/intelligent-compactor.ts` — `repairToolUseAdjacency()`
- `packages/core/src/models/mode-store.ts` — context window modes
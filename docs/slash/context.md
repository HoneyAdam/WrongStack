# /context — Context Window Inspector

## What it does

Shows a live snapshot of the current context window: message counts, estimated tokens, effective context limit, tool call stats, todo counts, read files, and active context policy. Also has subcommands for switching context modes, setting session-local compaction limits/thresholds, and repairing orphan tool_use/tool_result blocks.

## Subcommands

| Usage | Output |
|---|---|
| `/context` | Summary: messages, tokens, tool calls, todos, read files, active mode |
| `/context detail` | Above + model, cwd, projectRoot, file mtimes, file list |
| `/context repair` | Scan for orphan tool_use/tool_result blocks, remove them |
| `/context limit` | Show the effective context window used by auto-compaction |
| `/context limit <tokens>` | Set the effective context window for this session, e.g. `220k` or `220000` |
| `/context limit <tokens> --persist` | Set the effective context window and persist it to config |
| `/context thresholds <warn> <soft> <hard>` | Set compaction thresholds for this session, e.g. `50% 70% 85%` |
| `/context thresholds <warn> <soft> <hard> --persist` | Set thresholds and persist them to config |
| `/context mode` | List available context-window modes |
| `/context mode <id>` | Switch to a named mode: `balanced`, `frugal`, `deep`, or `archival` |

## What "repair" does

During manual editing of the conversation history, it's possible to leave `tool_use` blocks that don't have a matching `tool_result`, or vice versa. `/context repair` runs `repairToolUseAdjacency()` to detect and remove these orphan pairs, then reports how many were removed.

## Context window modes

WrongStack ships with configurable context-window policies that control when compaction fires:

| Mode | Behavior |
|---|---|
| `balanced` | Default rolling compaction; recent work stays verbatim, old tool output is trimmed |
| `frugal` | Token-saver mode; compacts early and keeps a tighter verbatim tail |
| `deep` | Long-reasoning mode; delays compaction and keeps more recent turns intact |
| `archival` | Decision-preserving mode; compacts steadily while keeping summaries prominent |

Mode is stored in `ctx.meta['contextWindowMode']` and `ctx.meta['contextWindowPolicy']` as a resolved policy object.

## Effective limit and custom endpoints

`/context limit <tokens>` is session-local and updates the live auto-compaction denominator. Use it when a custom `baseUrl`, proxy, or account-gated endpoint has a smaller real context window than the catalog reports.

Example for an endpoint that starts rejecting requests around 256K tokens:

```text
/context limit 220k
/context thresholds 50% 70% 85%

# Persist for future sessions:
/context limit 220k --persist
/context thresholds 50% 70% 85% --persist
```

For a persistent config-level setting, set `context.effectiveMaxContext` and optionally `context.warnThreshold`, `context.softThreshold`, and `context.hardThreshold` in config.

## Code reference

- `packages/cli/src/slash-commands/context.ts`
- `packages/core/src/execution/intelligent-compactor.ts` — `repairToolUseAdjacency()`
- `packages/core/src/models/mode-store.ts` — context window modes
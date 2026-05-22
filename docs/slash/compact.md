# /compact — Context Window Compactor

## What it does

`/compact` runs the configured compactor to summarize older conversation turns and reclaim token budget. This is a proactive compaction — it fires before the context window hits the hard threshold automatically.

## Options

| Usage | Effect |
|---|---|
| `/compact` | Run compactor with default settings |
| `/compact aggressive` | Compact more aggressively (higher compression) |

## Compactor behavior

The compactor (typically `DefaultCompactor` or `IntelligentCompactor`) processes the conversation history:

1. **Summarizes old turns** — groups of user+assistant pairs are condensed into a brief summary
2. **Culls orphaned tool blocks** — `tool_use` without matching `tool_result` or vice versa
3. **Removes empty messages** — zero-content messages that consume tokens with no information

The compactor reports before/after token counts:

```
Compaction: 45000 -> 28000 tokens (user_turns: 8200, tool_calls: 3400, empty: 600)
```

## When to use

- Before a long session gets slow
- When you've done many tool calls and the context feels "heavy"
- After a session resume that loaded a large history

## Code reference

- `packages/cli/src/slash-commands/compact.ts`
- `packages/core/src/execution/intelligent-compactor.ts`
- `packages/core/src/execution/context-compactor.ts`
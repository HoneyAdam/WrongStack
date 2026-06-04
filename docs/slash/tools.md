# /tools — Registered Tool Catalog

## What it does

Lists all registered tools from the `ToolRegistry` with their name, owner package, mutability flag, and permission level. Risk tier is not currently rendered; use the source catalog or tool help when auditing YOLO/destructive behavior.

## Output format

```
Tools (N):
  read                            [@wrongstack/tools] ro auto
  write                           [@wrongstack/tools] mut confirm
  bash                            [@wrongstack/tools] mut confirm
  ...
```

Each line: `name [owner] mut|ro permission`

| Flag | Meaning |
|---|---|
| `mut` | Tool modifies filesystem or external state |
| `ro` | Read-only tool |
| Permission | Declared permission: `auto`, `confirm`, or `deny` |

## Tools included by default

See `packages/tools/src/builtin.ts` for the full list. Common categories:

- **Filesystem:** read, write, edit, replace, glob, grep, tree, patch, diff, json
- **Execution:** bash, exec, git
- **Network:** fetch, search
- **Project:** lint, format, typecheck, test, install, audit, outdated, logs, document, scaffold
- **Agent control:** todo, plan, tool-search, tool-use, batch-tool-use, tool-help, memory, mode

## Code reference

- `packages/cli/src/slash-commands/tools.ts`
- `packages/core/src/registry/tool-registry.ts`
- `packages/tools/src/builtin.ts`
- `packages/tools/src/index.ts`
# /tools — Registered Tool Catalog

## What it does

Lists all registered tools from the `ToolRegistry` with their name, owner package, mutability flag, and permission level.

## Output format

```
Tools (N):
  read                            [core] ro  read
  write                           [core] mut write
  bash                            [core] mut bash
  ...
```

Each line: `name [owner] mut|ro permission`

| Flag | Meaning |
|---|---|
| `mut` | Tool modifies filesystem or external state |
| `ro` | Read-only tool |
| Permission | Risk level shown in renderer color |

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
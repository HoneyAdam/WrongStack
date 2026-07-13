# `wstack usage` — Aggregate session tokens

`wstack usage` reads up to the 100 most recent saved sessions and prints two values:

```text
Sessions: <count>  total tokens: <sum>
```

The sum is the `tokenTotal` recorded in each returned session summary. Despite sharing a source file with the plugin manager handler, this command does **not** report per-plugin usage or cost breakdowns. If no session store is available, it exits successfully without output.

## Code reference

- `packages/cli/src/subcommands/handlers/plugin-usage.ts` — `usageCmd`
- `packages/cli/src/subcommands/index.ts` — `usage` registration

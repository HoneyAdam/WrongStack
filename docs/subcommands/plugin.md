# `wstack plugin` — Plugin Manager

## What it does

Manages WrongStack plugins: install, remove, enable, disable. Plugins extend WrongStack's capabilities via the plugin API.

## Subcommands

| Usage | Effect |
|---|---|
| `wstack plugin` | List configured plugins with status |
| `wstack plugins` | Alias for `wstack plugin` |
| `wstack plugin install <name\|alias>` | Install and enable a plugin |
| `wstack plugin add <name>` | Alias for install |
| `wstack plugin remove <name>` | Remove from config |
| `wstack plugin enable <name>` | Enable a configured plugin |
| `wstack plugin disable <name>` | Disable a configured plugin |

## Official plugins

| Alias | Plugin package |
|---|---|---|
| `telegram` | `@wrongstack/telegram` — Telegram bridge |
| `lsp` | `@wrongstack/plug-lsp` — LSP-backed tools |

Install with: `wstack plugin install telegram`

## Config

Plugins are stored in `config.json`:

```jsonc
{
  "plugins": [
    { "name": "@wrongstack/telegram", "enabled": true }
  ]
}
```

## Code reference

- `packages/cli/src/subcommands/handlers/plugin-usage.ts`
- `packages/cli/src/plugin-management.ts` — actual logic
- `packages/core/src/plugin/loader.ts` — plugin loading
- `docs/plugin-author-guide.md`
- `docs/plugin-management.md`
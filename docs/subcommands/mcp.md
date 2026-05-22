# `wstack mcp` — MCP Server Lifecycle

## What it does

Manages MCP server configurations in `config.json`. Servers are started automatically when WrongStack boots (REPL/TUI mode). Only `list`, `add`, `remove` are available as subcommands — `restart` is only available inside the REPL.

## Subcommands

| Usage | Effect |
|---|---|
| `wstack mcp` | List all configured servers |
| `wstack mcp list` | Same |
| `wstack mcp add <name>` | Interactive wizard to add a server |
| `wstack mcp remove <name>` | Remove a server from config |

## Config format

```jsonc
{
  "mcpServers": {
    "filesystem": {
      "enabled": true,
      "transport": "stdio",
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "/path/to/root"]
    },
    "github": {
      "enabled": true,
      "transport": "sse",
      "url": "https://api.github.com/mcp"
    }
  }
}
```

## Transport types

| Transport | Config needed | Notes |
|---|---|---|
| `stdio` | `command` (required), `args`, `env` | Child process, passed via stdin/stdout |
| `sse` | `url` (required) | Server-sent events |
| `streamable-http` | `url` (required) | NDJSON over HTTP |

## Built-in servers

`allServers()` returns the bundled server presets (e.g. `filesystem`, `github`). These can be added with `wstack mcp add <name>` without specifying the full command.

## Code reference

- `packages/cli/src/subcommands/handlers/mcp.ts`
- `packages/mcp/src/client.ts` — `MCPClient`
- `packages/mcp/src/registry.ts` — `MCPRegistry`
- `docs/plugin-management.md`
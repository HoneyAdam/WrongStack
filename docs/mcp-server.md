# Running WrongStack as an MCP server

WrongStack is both an MCP **client** (it connects to external MCP servers — see
`mcpServers` in [configuration.md](./configuration.md)) and an MCP **server**:
it can expose its own built-in tools to any MCP client — Claude Desktop, an IDE,
or another agent — over the standard stdio JSON-RPC transport.

```bash
wstack mcp serve            # safe: exposes read-only tools only
wstack mcp serve --yolo     # exposes every tool, including bash/write/edit
wstack mcp serve --tools read,grep,glob   # expose only a whitelist
```

stdout is the JSON-RPC channel; all status/log output goes to stderr.

## What gets exposed

By default the server applies the same `AutoApprovePermissionPolicy` used for
subagents: read-only tools (`read`, `glob`, `grep`, `fetch`, `search`, `tree`,
`todo`, …) are exposed, while shell/write/edit and any tool declaring a
dangerous capability are **withheld**. This is the safe default for handing your
tools to an external client.

| Flag | Effect |
|---|---|
| _(none)_ | Read-only tools only (safe default). |
| `--yolo` / `--allow-all` | Expose every built-in tool, including `bash`, `write`, `edit`, `exec`, `install`. |
| `--tools a,b,c` | Restrict to a comma-separated whitelist (intersected with the policy above). |

A withheld tool is invisible in `tools/list` **and** rejected on `tools/call`,
so a client cannot invoke it by guessing the name.

> ⚠️ `--yolo` gives the connecting client the ability to run arbitrary shell
> commands and write files in the server's working directory. Only use it with
> clients you trust, and prefer `--tools` to scope access.

## Wiring into a client

### Claude Desktop / Claude Code

Add an entry to the client's MCP config pointing at the WrongStack binary:

```jsonc
{
  "mcpServers": {
    "wrongstack": {
      "command": "wstack",
      "args": ["mcp", "serve", "--tools", "read,grep,glob,tree,search"]
    }
  }
}
```

The client launches `wstack mcp serve` as a child process and speaks JSON-RPC
over its stdio.

## Protocol

Standard MCP over stdio (protocol `2024-11-05`), newline-delimited JSON-RPC 2.0:

- `initialize` → `{ protocolVersion, capabilities: { tools: {} }, serverInfo }`
- `notifications/initialized` → (no response)
- `tools/list` → `{ tools: [{ name, description, inputSchema }] }`
- `tools/call` `{ name, arguments }` → `{ content: [{ type: "text", text }], isError }`
- `ping` → `{}`

Tool errors are returned as `isError: true` content (the connection stays up);
only protocol-level problems produce JSON-RPC `error` envelopes
(`-32700` parse, `-32600` invalid request, `-32601` method not found,
`-32603` internal).

## Internals

- Protocol core + stdio runner: `packages/mcp/src/server.ts`
  (`MCPServer`, `serveStdio`, `toContentBlocks`) — transport-agnostic and
  dependency-free, so it is unit-tested in isolation.
- CLI wiring (registry → host → server): `packages/cli/src/mcp-serve.ts`,
  routed from the `mcp serve` subcommand. Tool calls run through the standard
  `ToolExecutor` (schema validation, output capping, timeouts) against a minimal
  serve-mode `Context`.

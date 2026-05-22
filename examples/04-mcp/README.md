# 04 — MCP Integration

Adding Model Context Protocol servers from built-in presets or custom
configs.

> Built-in presets currently shipped: `filesystem`, `github`,
> `context7`, `brave-search`, `block`, `everart`, `slack`, `aws`,
> `google-maps`, `sentinel`, `zai-vision`, `minimax-vision`. Run
> `wrongstack mcp add` with no args to see the live list.

## Filesystem server

```bash
# Add and enable in one shot
wrongstack mcp add filesystem --enable

# Confirm it's wired up
wrongstack mcp

# Use it
wrongstack "list every file under packages/core/src using the MCP filesystem tool"
```

## GitHub server

```bash
# GITHUB_PERSONAL_ACCESS_TOKEN must be set in the env before launching
wrongstack mcp add github --enable
wrongstack "list open issues on this repository"
```

## Brave Search

```bash
# BRAVE_API_KEY must be set in the env
wrongstack mcp add brave-search --enable
wrongstack "search for the latest Node.js 22 changelog"
```

## Vision adapters (for text-only models)

```bash
wrongstack mcp add zai-vision --enable
wrongstack mcp add minimax-vision --enable
```

These let text-only models work with screenshots via tools like
`image_analysis`, `extract_text_from_screenshot`, and `understand_image`.

## Custom stdio server

Append to `~/.wrongstack/config.json` manually:

```jsonc
{
  "mcpServers": {
    "my-server": {
      "name": "my-server",
      "transport": "stdio",
      "command": "node",
      "args": ["./my-mcp-server.js"],
      "enabled": true,
      "allowedTools": ["tool_a", "tool_b"],
      "permission": "auto"
    }
  }
}
```

## Custom SSE / HTTP server

```jsonc
{
  "mcpServers": {
    "remote-tools": {
      "name": "remote-tools",
      "transport": "sse",
      "url": "https://mcp.example.com/sse",
      "headers": {
        "Authorization": "Bearer enc:v1:<iv>:<tag>:<ciphertext>"
      },
      "enabled": true
    }
  }
}
```

`Authorization` and similar secret-shaped header values are
auto-encrypted on first contact.

## Managing servers

```bash
wrongstack mcp                   # list configured servers + state
wrongstack mcp add <name>        # show presets + add one (use --enable to turn on)
wrongstack mcp remove <name>     # remove from config (does not uninstall any package)
```

Inside the REPL or TUI:

```
/mcp                              # live status of every connected server
```

## Permission control

MCP tools default to `confirm` (ask before each call). Override per
server in the config:

```jsonc
{
  "mcpServers": {
    "filesystem": {
      "permission": "auto",          // auto-approve calls to this server
      "allowedTools": ["read_file"]  // OR restrict to a subset
    }
  }
}
```

Or use the per-project trust file for fine-grained allow lists:

```jsonc
// ~/.wrongstack/projects/<sha256-of-project>/trust.json
{
  "mcp__filesystem__read_file": {
    "allow": ["src/**"]
  }
}
```

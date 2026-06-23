# @wrongstack/plug-lsp

Language Server Protocol (LSP) integration for WrongStack. Provides a unified
`/lsp` command to install, run, and manage LSP servers, plus 4 LSP-backed tools
for the agent (diagnostics, definition, rename, codebase search).

## Quick Start

### 1. Enable the plugin

Add to your WrongStack config (`~/.config/wrongstack/config.json` or project `.wrongstack/config.json`):

```json
{
  "features": { "plugins": true },
  "plugins": ["@wrongstack/plug-lsp"]
}
```

### 2. Install a language server

```text
/lsp install typescript
/lsp install python
/lsp install go
```

### 3. Add to config and start

After installation, add the server to your config:

```json
{
  "extensions": {
    "@wrongstack/plug-lsp": {
      "servers": {
        "typescript": {
          "command": "typescript-language-server",
          "args": ["--stdio"],
          "languages": ["typescript", "typescriptreact", "javascript", "javascriptreact"],
          "rootPatterns": ["tsconfig.json"]
        }
      }
    }
  }
}
```

Then restart your WrongStack session and run:

```text
/lsp start typescript
```

## `/lsp` Command

The primary interface for all LSP operations:

| Command | Description |
|---|---|
| `/lsp` | List all configured servers and their states |
| `/lsp list` | Same as `/lsp` |
| `/lsp status` | Detailed status with failed server errors and active file count |
| `/lsp install <lang>` | Install the LSP server for a language |
| `/lsp start [name]` | Start all servers, or a specific one |
| `/lsp stop [name]` | Stop all servers, or a specific one |
| `/lsp restart [name]` | Restart all servers, or a specific one |
| `/lsp diagnostics [file]` | Show diagnostics for a file or workspace |
| `/lsp help` | Show full help |

### Available Languages for `/lsp install`

| Language | Server | Install Method |
|---|---|---|
| `typescript` | `typescript-language-server` | npm |
| `python` | `pyright-langserver` | npm |
| `json` | `vscode-json-language-server` | npm |
| `html` | `vscode-html-language-server` | npm |
| `css` | `vscode-css-language-server` | npm |
| `yaml` | `yaml-language-server` | npm |
| `shell` | `bash-language-server` | npm |
| `go` | `gopls` | Go toolchain |
| `rust` | `rust-analyzer` | Rust toolchain |
| `ruby` | `ruby-lsp` | RubyGems |

## Registered Tools

The plugin registers 5 tools into WrongStack's tool system. These are kept because
LSP provides genuinely unique data or capability the agent cannot replicate with
basic tools (read, grep, edit) at comparable cost.

| Tool | Permission | Description |
|---|---|---|
| `lsp_diagnostics` | `auto` | Get type/lint diagnostics for a file or whole workspace |
| `lsp_definition` | `auto` | Jump to the definition of a symbol (more precise than grep) |
| `lsp_completion` | `auto` | Semantic completions for a cursor location, including live editor content when provided |
| `lsp_rename` | `confirm` | Safe semantic rename across the workspace |
| `codebase-lsp-search` | `auto` | Fast symbol search via WrongStack's index, with LSP fallback |

The following LSP tools are intentionally excluded: `lsp_references` (returns
positions the agent still has to read), `lsp_hover` (usually confirms what
reading the definition already showed), `lsp_symbols` (a symbol tree is less
useful than reading the file), and `lsp_code_actions` (high noise-to-signal in
well-maintained codebases).

**Positions use 1-based line numbers and 1-based UTF-8 byte columns** — matching
WrongStack's grep tool convention, not LSP's 0-based UTF-16 code units.

## Configuration Reference

Full configuration options under `extensions["@wrongstack/plug-lsp"]`:

```json
{
  "extensions": {
    "@wrongstack/plug-lsp": {
      "autoStart": "lazy",
      "diagnosticsAfterEdit": "background",
      "diagnosticsWaitMs": 1500,
      "severityFilter": ["error", "warning"],
      "maxDiagnosticsPerFile": 5,
      "maxDiagnosticsTotal": 50,
      "autoDiscover": true,
      "logServerOutput": false,
      "servers": {
        "typescript": {
          "command": "typescript-language-server",
          "args": ["--stdio"],
          "languages": ["typescript", "typescriptreact"],
          "rootPatterns": ["tsconfig.json"],
          "initializationOptions": {},
          "settings": {},
          "startupTimeoutMs": 15000,
          "enabled": true
        }
      }
    }
  }
}
```

### Options

| Option | Default | Description |
|---|---|---|
| `autoStart` | `"lazy"` | `"lazy"` = start on first file access; `"eager"` = all at session start; `"never"` = manual only |
| `diagnosticsAfterEdit` | `"background"` | `"background"` = fetch after edits; `"manual"` = on request only |
| `diagnosticsWaitMs` | `1500` | Milliseconds to wait after an edit before fetching diagnostics |
| `severityFilter` | `["error","warning"]` | Which diagnostic severities to return |
| `maxDiagnosticsPerFile` | `5` | Maximum diagnostics per file |
| `maxDiagnosticsTotal` | `50` | Maximum diagnostics total |
| `autoDiscover` | `true` | Auto-discover servers on PATH or `node_modules/.bin` |
| `logServerOutput` | `false` | Log server stderr to WrongStack log |

## Auto-Discovery

With `autoDiscover: true` (the default), the plugin searches for servers in:

1. **`PATH`** — any command on the system PATH is used
2. **`node_modules/.bin`** — npm-installed binaries in the project

This means a minimal config is often sufficient:

```json
{
  "features": { "plugins": true },
  "plugins": ["@wrongstack/plug-lsp"]
}
```

If `typescript-language-server` is in your project's `node_modules/.bin`, it is
automatically discovered and started on first file access.

## Server Lifecycle

Each server runs as a separate child process communicating via JSON-RPC over stdio.
The plugin handles:

- **Initialization handshake** — sends `initialize` → waits for `InitializeResult` → sends `initialized`
- **Document tracking** — sends `textDocument/didOpen` on first read, `textDocument/didChange` after edits
- **Crash recovery** — 3 restart attempts with exponential backoff (1s, 4s, 16s)
- **Graceful shutdown** — sends `shutdown` then `exit` on session end

States: `disabled` → `starting` → `initializing` → `ready` → `shutting_down` → `exited`

## Custom Server Configuration

For languages not in the preset list, add manually to your config:

```json
"servers": {
  "myserver": {
    "command": "my-language-server",
    "args": ["--stdio"],
    "languages": ["mylang"],
    "rootPatterns": ["mylang.config"],
    "startupTimeoutMs": 20000
  }
}
```

## CLI Setup Command

For CI/CD or scripted installation, use the setup CLI directly:

```sh
# Install all preset servers (npm-based only)
pnpm --filter @wrongstack/plug-lsp setup -- --cwd /path/to/project

# Install specific servers
pnpm --filter @wrongstack/plug-lsp setup -- --cwd . --languages typescript,python,go

# Dry run
pnpm --filter @wrongstack/plug-lsp setup -- --dry-run --languages typescript
```

## Troubleshooting

**Server shows as "failed"**: Check the server binary is on PATH and starts correctly.
Run `/lsp status` to see the error message from the server's stderr.

**No diagnostics**: Open the file first (LSP servers report diagnostics for open files).
Run `/lsp diagnostics <file>` after reading the file.

**Wrong language detected**: Set the `languages` array explicitly in the server config
to include the language ID for your file (e.g., `"python"` for Python files).

## Architecture

```
packages/plug-lsp/src/
├── slash-commands/
│   ├── lsp.ts          — unified /lsp command dispatcher
│   ├── install.ts       — language server installation logic
│   ├── list/start/stop/restart/diagnostics.ts — individual commands
├── server/
│   ├── lsp-server.ts   — per-server LSP client (one process per server)
│   ├── connection.ts    — JSON-RPC 2.0 over stdio transport
│   └── lifecycle.ts     — state machine for server lifecycle
├── tools/              — 5 LSP-backed agent tools (diagnostics, definition, completion, rename, codebase-search)
├── registry.ts         — manages all server instances
├── document-tracker.ts — tracks open/edited files across sessions
├── auto-discover.ts    — PATH and node_modules discovery
└── presets.ts          — built-in server configurations
```

## Plugin Command Names

The plugin registers slash commands with the `@wrongstack/plug-lsp` namespace:

- `/@wrongstack/plug-lsp:list`
- `/@wrongstack/plug-lsp:start`
- `/@wrongstack/plug-lsp:stop`
- `/@wrongstack/plug-lsp:restart`
- `/@wrongstack/plug-lsp:diagnostics`

These are also available as the short form **`/lsp`**, **`/lsp list`**, etc.

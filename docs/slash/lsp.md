# /lsp — LSP Server Management

Manages Language Server Protocol (LSP) servers for WrongStack's `@wrongstack/plug-lsp`
plugin. Install language servers, start/stop server instances, check diagnostics,
and configure servers — all from the REPL.

## Usage

| Command | Effect |
|---|---|
| `/lsp` | List all configured servers and their current states |
| `/lsp list` | Same as `/lsp` |
| `/lsp status` | Detailed status report including failed servers and active file count |
| `/lsp install <language>` | Install the language server binary for a given language |
| `/lsp start [name]` | Start all enabled servers, or a specific one by name |
| `/lsp stop [name]` | Stop all running servers, or a specific one by name |
| `/lsp restart [name]` | Restart all enabled servers, or a specific one by name |
| `/lsp diagnostics [file]` | Show LSP diagnostics for a file or the whole workspace |
| `/lsp help` | Show this help message |

## Examples

```text
/lsp                           # List servers
/lsp list
/lsp install typescript         # Install TypeScript language server
/lsp install python             # Install Pyright
/lsp install go                # Install gopls
/lsp install rust              # Install rust-analyzer
/lsp start                     # Start all enabled servers
/lsp start gopls               # Start a specific server
/lsp stop                      # Stop all servers
/lsp restart rust-analyzer     # Restart rust-analyzer
/lsp diagnostics src/index.ts   # Check diagnostics for a file
/lsp diagnostics                # Workspace-wide diagnostics
/lsp status                    # Detailed status report
```

## Supported Languages for Installation

The `/lsp install` command can automatically install these language servers:

| Language | Server Binary | Install Method |
|---|---|---|
| `typescript` | `typescript-language-server` | npm (via pnpm/npm/yarn) |
| `python` | `pyright-langserver` | npm |
| `json` | `vscode-json-language-server` | npm |
| `html` | `vscode-html-language-server` | npm |
| `css` | `vscode-css-language-server` | npm |
| `yaml` | `yaml-language-server` | npm |
| `shell` | `bash-language-server` | npm |
| `go` | `gopls` | Go toolchain (`go install`) |
| `rust` | `rust-analyzer` | Rust toolchain (`rustup`) |
| `ruby` | `ruby-lsp` | RubyGems (`gem install`) |

After installation, add the server to your WrongStack config (see Configuration below).

## Configuration

The plugin reads configuration from `extensions["@wrongstack/plug-lsp"]` in your
WrongStack config file:

```json
{
  "features": { "plugins": true },
  "plugins": ["@wrongstack/plug-lsp"],
  "extensions": {
    "@wrongstack/plug-lsp": {
      "autoStart": "lazy",
      "servers": {
        "typescript": {
          "command": "typescript-language-server",
          "args": ["--stdio"],
          "languages": ["typescript", "typescriptreact", "javascript", "javascriptreact"],
          "rootPatterns": ["tsconfig.json", "jsconfig.json", "package.json"]
        }
      }
    }
  }
}
```

### Configuration Options

| Option | Default | Description |
|---|---|---|
| `autoStart` | `"lazy"` | `"lazy"` = start on first file access; `"eager"` = start all at session start; `"never"` = manual only |
| `diagnosticsAfterEdit` | `"background"` | `"background"` = fetch diagnostics after edits; `"manual"` = only on request |
| `diagnosticsWaitMs` | `1500` | Milliseconds to wait after an edit before fetching diagnostics |
| `severityFilter` | `["error","warning"]` | Which diagnostic severities to return |
| `maxDiagnosticsPerFile` | `5` | Maximum diagnostics to return per file |
| `maxDiagnosticsTotal` | `50` | Maximum diagnostics to return per request |
| `autoDiscover` | `true` | Automatically find servers on PATH or `node_modules/.bin` |
| `logServerOutput` | `false` | Log LSP server stderr to the WrongStack log |

### Minimal Config (Auto-Discovery Enabled)

With `autoDiscover: true` (the default), servers found on `PATH` or in
`node_modules/.bin` are automatically added. A minimal config is all you need:

```json
{
  "features": { "plugins": true },
  "plugins": ["@wrongstack/plug-lsp"]
}
```

## Registered LSP Tools

When the plugin is active, these tools are available to the agent:

| Tool | Permission | Purpose |
|---|---|---|
| `lsp_diagnostics` | `auto` | Get type/lint diagnostics for a file or workspace |
| `lsp_definition` | `auto` | Go to definition of a symbol (more precise than grep) |
| `lsp_rename` | `confirm` | Semantic rename across the workspace |
| `codebase-lsp-search` | `auto` | Fast symbol search via WrongStack's index, with LSP fallback |

> **Why only 4 tools?** `lsp_references`, `lsp_hover`, `lsp_symbols`, and `lsp_code_actions`
> are intentionally excluded. They are marginal over basic read/grep — they return data the agent
> would have to read anyway, or surface cosmetic fixes in well-maintained code.
> `lsp_diagnostics`, `lsp_definition`, and `lsp_rename` are kept because they provide
> genuinely unique data or capability the agent cannot replicate at comparable cost.

All tools use **1-based line numbers** and **1-based UTF-8 byte columns** as input
— matching the convention used by grep and other WrongStack tools.

## Installing Language Servers Manually

For languages not in the auto-install list, or to use a specific server version:

### Step 1: Install the server binary

**Via npm** (for TypeScript, Python, JSON, HTML, CSS, YAML, Shell):
```sh
# Using pnpm (WrongStack default)
pnpm add -D typescript-language-server

# Using npm
npm install -D typescript-language-server
```

**Via Go toolchain**:
```sh
go install golang.org/x/tools/gopls@latest
```

**Via Rust toolchain**:
```sh
rustup component add rust-analyzer
```

**Via RubyGems**:
```sh
gem install ruby-lsp
```

### Step 2: Add to WrongStack config

```json
{
  "extensions": {
    "@wrongstack/plug-lsp": {
      "servers": {
        "typescript": {
          "command": "typescript-language-server",
          "args": ["--stdio"],
          "languages": ["typescript", "typescriptreact"],
          "rootPatterns": ["tsconfig.json"]
        }
      }
    }
  }
}
```

### Step 3: Verify

```text
/lsp
/lsp start typescript
```

## Troubleshooting

### Server shows as "failed"

Server processes can fail to start for several reasons:

1. **Binary not on PATH**: Run `which <binary>` to verify.
   - Fix: Run `/lsp install <language>` or add `node_modules/.bin` to PATH.

2. **Wrong arguments**: Some servers require specific flags.
   - Fix: Check the server's documentation for the correct `--stdio` or startup args.

3. **Startup timeout**: The server took too long to initialize.
   - Fix: Increase `startupTimeoutMs` in the server config.

4. **Missing dependency**: The server binary needs a runtime (e.g., Node.js for npm-installed servers).
   - Fix: Install the required runtime.

### No diagnostics showing

1. **File not opened**: LSP servers report diagnostics for open files.
   - Fix: Run `/lsp diagnostics <file>` after reading the file.

2. **Wrong language server**: The file's language may not match any configured server.
   - Fix: Check `languages` in your server config includes the file's language ID.

3. **Server not started**: The server is configured but not running.
   - Fix: Run `/lsp start` or set `"autoStart": "eager"` in config.

### Permission denied on server binary (Linux/macOS)

```sh
chmod +x node_modules/.bin/typescript-language-server
```

## Quick Reference: Configuration Templates

### TypeScript/JavaScript
```json
"typescript": {
  "command": "typescript-language-server",
  "args": ["--stdio"],
  "languages": ["typescript", "typescriptreact", "javascript", "javascriptreact"],
  "rootPatterns": ["tsconfig.json", "jsconfig.json", "package.json"]
}
```

### Python (Pyright)
```json
"python": {
  "command": "pyright-langserver",
  "args": ["--stdio"],
  "languages": ["python"],
  "rootPatterns": ["pyproject.toml", "pyrightconfig.json", "requirements.txt"]
}
```

### Go
```json
"gopls": {
  "command": "gopls",
  "args": ["serve"],
  "languages": ["go"],
  "rootPatterns": ["go.mod", "go.work"]
}
```

### Rust
```json
"rust-analyzer": {
  "command": "rust-analyzer",
  "languages": ["rust"],
  "rootPatterns": ["Cargo.toml"]
}
```

## Code Reference

- `packages/plug-lsp/src/slash-commands/lsp.ts` — unified `/lsp` command
- `packages/plug-lsp/src/slash-commands/install.ts` — server installation logic
- `packages/plug-lsp/src/registry.ts` — server lifecycle management
- `packages/plug-lsp/src/document-tracker.ts` — open file tracking
- `packages/plug-lsp/src/server/lsp-server.ts` — per-server LSP client
- `packages/plug-lsp/src/server/connection.ts` — JSON-RPC stdio transport
- `packages/plug-lsp/src/presets.ts` — built-in server configurations
- `packages/plug-lsp/src/auto-discover.ts` — PATH/node_modules discovery
- `packages/plug-lsp/src/setup.ts` — CLI setup command
- `docs/plugin-management.md` — WrongStack plugin system overview

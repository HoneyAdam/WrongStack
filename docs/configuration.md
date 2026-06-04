# Configuration Reference

WrongStack uses a layered configuration system. Settings are merged from multiple sources with a clear precedence order.

---

## Config file locations

| Layer | Path | Purpose |
|---|---|---|
| Global | `~/.wrongstack/config.json` | Developer-level defaults (provider, keys, features) |
| Project-local | `<project>/.wrongstack/config.local.json` | Project overrides (not committed) |
| CLI flags | `--provider`, `--model`, `--yolo`, etc. | Session-scoped overrides |

**Precedence** (highest wins): CLI flags → project-local → global → built-in defaults.

---

## Full config schema

```jsonc
{
  "version": 1,
  "provider": "anthropic",
  "model": "claude-opus-4-7",
  "apiKey": "enc:v1:<iv>:<tag>:<ciphertext>",
  "baseUrl": "https://api.anthropic.com",
  "providers": { /* ... */ },
  "context": { /* ... */ },
  "tools": { /* ... */ },
  "mcpServers": { /* ... */ },
  "plugins": [],
  "log": { /* ... */ },
  "features": { /* ... */ },
  "yolo": false,
  "cwd": ".",
  "extensions": { /* ... */ }
}
```

---

## Top-level fields

| Field | Type | Default | Description |
|---|---|---|---|
| `version` | `1` | `1` | Config schema version. Must be `1`. |
| `provider` | `string` | *(required)* | Active provider id (e.g. `anthropic`, `openai`, `groq`). |
| `model` | `string` | *(required)* | Active model id (e.g. `claude-opus-4-7`, `gpt-4.1`). |
| `apiKey` | `string` | — | API key for the active provider. Auto-encrypted on first contact. |
| `baseUrl` | `string` | — | Custom API base URL. Overrides the provider's default endpoint. |
| `yolo` | `boolean` | `false` | Auto-approve safe/standard tool calls. Destructive tools may still prompt unless `--force-all-yolo` is used. Overridden by `--yolo` CLI flag. |
| `fallbackModels` | `string[]` | — | Ordered fallback chain tried when the primary model is overloaded (429/529/5xx) and its own retries are exhausted. Each entry is `model`, `provider/model`, or `provider model`. Cross-provider. The primary is re-tried first each turn. Overridden by `--fallback-model a,b,c`. |
| `hooks` | `object` | — | Lifecycle shell hooks keyed by event. See [`hooks`](#hooks--lifecycle-hooks) below and [hooks.md](./hooks.md). |
| `cwd` | `string` | `process.cwd()` | Working directory. Overridden by `--cwd` CLI flag. |

---

## `providers` — Per-provider configuration

A map of provider id → provider config. Each entry can declare its own API key, base URL, model, and quirks.

```jsonc
{
  "providers": {
    "anthropic": {
      "type": "anthropic",
      "apiKey": "enc:v1:...",
      "model": "claude-opus-4-7"
    },
    "groq": {
      "type": "openai-compatible",
      "apiKey": "enc:v1:...",
      "baseUrl": "https://api.groq.com/openai/v1",
      "model": "llama-3.3-70b-versatile"
    },
    "ollama": {
      "type": "openai-compatible",
      "baseUrl": "http://localhost:11434/v1",
      "family": "openai-compatible"
    }
  }
}
```

### ProviderConfig fields

| Field | Type | Default | Description |
|---|---|---|---|
| `type` | `string` | — | Provider type (usually matches the wire family). |
| `apiKey` | `string` | — | API key. Auto-encrypted. Falls back to `<PROVIDER>_API_KEY` env var. |
| `apiKeys` | `ProviderApiKey[]` | — | Multiple keys with labels. Pick one with `activeKey`. |
| `activeKey` | `string` | first entry | Label of the key to use from `apiKeys`. |
| `baseUrl` | `string` | provider default | Custom API endpoint. |
| `headers` | `Record<string, string>` | — | Extra HTTP headers sent with every request. |
| `model` | `string` | — | Default model for this provider. |
| `family` | `string` | auto-detected | Wire family override (`anthropic`, `openai`, `openai-compatible`, `google`). Required for offline/custom endpoints. |
| `envVars` | `string[]` | provider default | Custom env var names to probe for API keys. |
| `models` | `string[]` | — | Restrict visible models for this provider. |
| `quirks` | `Record<string, unknown>` | — | Provider-specific behavior flags. See provider-author-guide.md. |
| `capabilities` | `Record<string, unknown>` | — | Override reported capabilities (e.g. `maxContext`, `vision`). |

---

## `context` — Context window management

Controls compaction behavior, token thresholds, and context window modes.

```jsonc
{
  "context": {
    "mode": "balanced",
    "warnThreshold": 0.6,
    "softThreshold": 0.75,
    "hardThreshold": 0.9,
    "autoCompact": true,
    "preserveK": 10,
    "eliseThreshold": 2000,
    "strategy": "hybrid",
    "llmSelector": false,
    "effectiveMaxContext": 200000,
    "maxSessionTokens": 1000000,
    "maxDailyTokens": 5000000
  }
}
```

| Field | Type | Default | Description |
|---|---|---|---|
| `mode` | `string` | `"balanced"` | Context window policy. One of: `balanced`, `frugal`, `deep`, `archival`. Switch at runtime with `/context mode`. |
| `warnThreshold` | `number` | `0.6` | Fraction of context window that triggers a warning. Runtime override: `/context thresholds`. |
| `softThreshold` | `number` | `0.75` | Fraction that triggers soft compaction. Runtime override: `/context thresholds`. |
| `hardThreshold` | `number` | `0.9` | Fraction that triggers aggressive compaction and hard-overflow protection. Runtime override: `/context thresholds`. |
| `autoCompact` | `boolean` | `true` | Automatically compact when thresholds are crossed. |
| `preserveK` | `number` | `10` | Number of recent message pairs to preserve during compaction. |
| `eliseThreshold` | `number` | `2000` | Token count below which tool results are not elided. |
| `strategy` | `string` | `"hybrid"` | Compaction strategy: `hybrid` (rules), `intelligent` (LLM), `selective` (LLM-driven selection). |
| `llmSelector` | `boolean` | `false` | Use LLM to select which messages to compact. |
| `effectiveMaxContext` | `number` | provider-reported or unknown for custom `baseUrl` | Override the effective context window size in tokens. Use this for proxies/account-gated endpoints whose real limit differs from models.dev. Runtime override: `/context limit`. |
| `maxSessionTokens` | `number` | — | Maximum tokens per session. |
| `maxDailyTokens` | `number` | — | Maximum tokens per day. |
| `summarizerModel` | `string` | active model | Model used for LLM-assisted summarization. |

### Context modes

| Mode | Behavior |
|---|---|
| `balanced` | Default rolling compaction; preserves recent tail, trims old heavy tool output. |
| `frugal` | Token-saver; compacts early, keeps a tighter verbatim tail. |
| `deep` | Long-reasoning; delays compaction, keeps more recent turns intact. |
| `archival` | Decision-preserving; compacts steadily, keeps summaries prominent. |

---

## `tools` — Tool execution settings

```jsonc
{
  "tools": {
    "defaultExecutionStrategy": "smart",
    "maxIterations": 100,
    "iterationTimeoutMs": 300000,
    "sessionTimeoutMs": 1800000,
    "perIterationOutputCapBytes": 1048576,
    "autoExtendLimit": true
  }
}
```

| Field | Type | Default | Description |
|---|---|---|---|
| `defaultExecutionStrategy` | `string` | `"smart"` | `parallel` (all at once), `sequential` (one by one), `smart` (auto). |
| `maxIterations` | `number` | `100` | Soft limit on agent loop iterations. Auto-extends when `autoExtendLimit` is true. |
| `iterationTimeoutMs` | `number` | `300000` | Per-iteration timeout (5 minutes). |
| `sessionTimeoutMs` | `number` | `1800000` | Total session timeout (30 minutes). |
| `perIterationOutputCapBytes` | `number` | `1048576` | Max output bytes per iteration (1 MB). Excess is truncated. |
| `autoExtendLimit` | `boolean` | `true` | Automatically extend iteration limit by 100 when hit. |

---

## `mcpServers` — MCP server configuration

```jsonc
{
  "mcpServers": {
    "filesystem": {
      "name": "filesystem",
      "transport": "stdio",
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "."],
      "enabled": true,
      "allowedTools": ["read_file", "write_file", "list_directory"],
      "permission": "confirm"
    },
    "github": {
      "name": "github",
      "transport": "stdio",
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-github"],
      "env": {
        "GITHUB_PERSONAL_ACCESS_TOKEN": "enc:v1:..."
      },
      "enabled": false
    }
  }
}
```

| Field | Type | Default | Description |
|---|---|---|---|
| `name` | `string` | *(required)* | Server name. Used in tool namespace: `mcp__<name>__<tool>`. |
| `transport` | `string` | *(required)* | `stdio`, `sse`, or `streamable-http`. |
| `command` | `string` | — | Command to spawn (stdio transport). |
| `args` | `string[]` | — | Arguments for the command. |
| `env` | `Record<string, string>` | — | Environment variables for the subprocess. API keys auto-encrypted. |
| `url` | `string` | — | Server URL (sse/streamable-http transport). |
| `headers` | `Record<string, string>` | — | Extra HTTP headers (sse/streamable-http transport). |
| `enabled` | `boolean` | `false` | Whether to connect at startup. |
| `allowedTools` | `string[]` | all tools | Restrict which tools are registered. |
| `permission` | `string` | `"confirm"` | Default permission for MCP tools: `auto`, `confirm`, `deny`. |
| `startupTimeoutMs` | `number` | `10000` | Timeout for initial connection. |
| `requestTimeoutMs` | `number` | `60000` | Timeout for individual tool calls. |
| `tls.ca` | `string` | — | Path to CA certificate file (HTTPS transports). |
| `tls.rejectUnauthorized` | `boolean` | `true` | Verify server certificate (set `false` for self-signed). |

### Built-in presets

```bash
wrongstack mcp add filesystem --enable
wrongstack mcp add github --enable
wrongstack mcp add context7 --enable
wrongstack mcp add brave-search --enable
```

---

## `fallbackModels` — Overload fallback chain

When the active model returns an overload error (HTTP 429/529/5xx) and its own
retry policy is exhausted, the agent switches to the next entry in this list and
retries the same turn. Entries may cross providers. The configured primary is
always tried first at the start of every new turn.

```jsonc
{
  "provider": "anthropic",
  "model": "claude-opus-4-8",
  "fallbackModels": [
    "claude-sonnet-4-6",      // same provider, bare model id
    "openai/gpt-5.4",         // cross-provider (provider must have credentials)
    "groq llama-3.3-70b-versatile"
  ]
}
```

CLI override (comma-separated): `wrongstack --fallback-model "claude-sonnet-4-6,openai/gpt-5.4"`.

A fallback entry whose provider has no resolvable credentials is skipped (with a
warning) and the chain continues. Each switch emits a `provider.fallback` event.

---

## `hooks` — Lifecycle hooks

Shell commands run at lifecycle points (`PreToolUse`, `PostToolUse`,
`UserPromptSubmit`, `SessionStart`, `Stop`). The hook payload is written to the
command's stdin as JSON; a JSON `HookOutcome` on stdout (or exit code `2`)
steers the agent. `PreToolUse`/`PostToolUse` entries take a `matcher` (a
pipe-delimited tool-name list, or `*`).

```jsonc
{
  "hooks": {
    "PreToolUse": [
      { "matcher": "bash", "command": "./scripts/guard-bash.sh", "timeoutMs": 3000 }
    ],
    "PostToolUse": [
      { "matcher": "edit|write", "command": "npm run -s lint:staged" }
    ],
    "UserPromptSubmit": [
      { "command": "./scripts/inject-context.sh" }
    ]
  }
}
```

Disable all hooks for a session with `--no-hooks`. Plugins can register
in-process hooks via `api.registerHook(...)`. See [hooks.md](./hooks.md) for the
full payload/outcome schema and the security model.

---

## `features` — Feature flags

```jsonc
{
  "features": {
    "mcp": true,
    "plugins": true,
    "memory": true,
    "modelsRegistry": true,
    "skills": true
  }
}
```

| Field | Type | Default | Description |
|---|---|---|---|
| `mcp` | `boolean` | `true` | Load MCP servers declared in `mcpServers`. |
| `plugins` | `boolean` | `true` | Load npm plugins declared in `plugins`. |
| `memory` | `boolean` | `true` | Register `remember`/`forget` tools backed by memory store. |
| `modelsRegistry` | `boolean` | `true` | Fetch models.dev catalog at startup. Set `false` for offline use. |
| `skills` | `boolean` | `true` | Discover and load skills from disk. |

All flags are independent. `--no-features` sets all to `false`.

---

## `plugins` — Plugin configuration

```jsonc
{
  "plugins": [
    "@wrongstack/telegram",
    "@wrongstack/plug-lsp",
    {
      "name": "@yourorg/custom-plugin",
      "enabled": true,
      "options": {
        "port": 9090
      }
    }
  ]
}
```

Each entry is either a string (package name, always enabled) or an object:

| Field | Type | Default | Description |
|---|---|---|---|
| `name` | `string` | *(required)* | npm package name or local path. |
| `enabled` | `boolean` | `true` | Whether to load the plugin. |
| `options` | `Record<string, unknown>` | — | Plugin-specific configuration. Validated against `configSchema` if declared. |

---

## `log` — Logging

```jsonc
{
  "log": {
    "level": "info",
    "file": "~/.wrongstack/logs/wrongstack.log"
  }
}
```

| Field | Type | Default | Description |
|---|---|---|---|
| `level` | `string` | `"info"` | Log level: `error`, `warn`, `info`, `debug`, `trace`. |
| `file` | `string` | auto | Log file path. Defaults to `~/.wrongstack/logs/wrongstack.log`. |

Override with `--verbose` (`debug`), `--trace` (`trace`), or `--log-level <level>`.

---

## `session` — Session logging & audit trail

Controls what gets persisted to the per-project session JSONL file
(`~/.wrongstack/projects/<hash>/sessions/<id>.jsonl`).

```jsonc
{
  "session": {
    "auditLevel": "standard",
    "sampling": {
      "toolProgress": {
        "sampleRate": 8
      }
    }
  }
}
```

### Fields

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `auditLevel` | `"minimal"` \| `"standard"` \| `"full"` | `"standard"` | How much detail is written to the persistent session log. |
| `sampling.toolProgress.sampleRate` | `number` | `8` | Sampling rate for high-volume `tool_progress` events (`log` / `partial_output`). `1` = no sampling. Only applies when `auditLevel` is `"full"`. |

### `auditLevel` values

- **minimal** — Only the absolute minimum required for resume, rewind and crash recovery (`user_input`, `llm_response`, `tool_result`, checkpoints, in-flight markers).
- **standard** (recommended) — Adds high-value lightweight audit events: `llm_request` (light), `tool_call_start`/`tool_call_end`, `compaction`, `error`, etc.
- **full** — Enables high-volume events such as `tool_progress` (streaming tool output). These events are heavily sampled by default to avoid log bloat.

### Sampling

When `auditLevel` is `"full"`, certain events (especially `tool_progress`) can generate thousands of lines. WrongStack applies smart sampling:

- `warning`, `metric`, `file_changed` → always recorded.
- `log` and `partial_output` → first message is kept, then every Nth message (controlled by `sampleRate`).

You can increase verbosity for debugging:

```jsonc
{
  "session": {
    "auditLevel": "full",
    "sampling": {
      "toolProgress": {
        "sampleRate": 2   // very chatty
      }
    }
  }
}
```

---

## `extensions` — Per-plugin config namespaces

```jsonc
{
  "extensions": {
    "wstack-auth": {
      "tokenUrl": "https://auth.example.com/token",
      "refreshBefore": 300
    },
    "wstack-metrics": {
      "sink": "prometheus",
      "port": 9090
    }
  }
}
```

Each key is a plugin name. The value is a free-form object validated by the plugin's `configSchema`. Plugins read their namespace via `configStore.getExtension(pluginName)`.

---

## Environment variables

| Variable | Description |
|---|---|
| `<PROVIDER>_API_KEY` | API key for the provider (e.g. `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`). |
| `WRONGSTACK_LOG_LEVEL` | Override log level (`error`, `warn`, `info`, `debug`, `trace`). |
| `WRONGSTACK_FETCH_ALLOW_PRIVATE` | Set `1` to allow localhost/private IPs in the `fetch` tool. |
| `WRONGSTACK_BASH_ENV_PASSTHROUGH` | Set `1` to disable the bash-tool env allowlist (legacy unsafe mode). |
| `WRONGSTACK_CHILD_ENV_PASSTHROUGH` | Set `1` to opt back to old child-process env behavior. |
| `METRICS_HOST` | Prometheus metrics bind address (default `127.0.0.1`). |
| `NO_COLOR` | Disable ANSI color output. |

---

## Secrets

API keys and auth tokens are encrypted with **AES-256-GCM** using a 32-byte key at `~/.wrongstack/.key` (mode `0600` on POSIX).

**Format**: `enc:v1:<iv>:<tag>:<ciphertext>`

Field detection is regex-based — any field matching `/apikey|authtoken|bearer|secret|password|refreshtoken|sessionkey|access[_-]?token|private[_-]?key/i` is auto-encrypted on write and decrypted on read. Plaintext keys in older configs are migrated transparently on boot.

### Adding a key

```bash
wrongstack auth anthropic       # interactive prompt
wrongstack auth groq            # same for any provider
```

Or set the environment variable:

```bash
export ANTHROPIC_API_KEY=sk-ant-...
```

---

## Examples

### Minimal (offline, no network)

```jsonc
{
  "version": 1,
  "provider": "anthropic",
  "model": "claude-opus-4-7",
  "providers": {
    "anthropic": {
      "apiKey": "enc:v1:...",
      "family": "anthropic"
    }
  },
  "features": {
    "mcp": false,
    "plugins": false,
    "memory": false,
    "modelsRegistry": false,
    "skills": false
  }
}
```

### Multi-provider with Groq fast lane

```jsonc
{
  "version": 1,
  "provider": "anthropic",
  "model": "claude-opus-4-7",
  "providers": {
    "anthropic": { "apiKey": "enc:v1:..." },
    "groq": {
      "type": "openai-compatible",
      "apiKey": "enc:v1:...",
      "baseUrl": "https://api.groq.com/openai/v1"
    }
  }
}
```

### Token-saver

```jsonc
{
  "version": 1,
  "provider": "anthropic",
  "model": "claude-sonnet-4-7",
  "context": {
    "mode": "frugal",
    "strategy": "intelligent"
  },
  "tools": {
    "maxIterations": 50,
    "autoExtendLimit": false
  }
}
```

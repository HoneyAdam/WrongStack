# WrongStack

> Built on the wrong stack. Shipped anyway.

A CLI AI coding agent that runs in your terminal. It reads your code, edits files, runs commands, and reasons through bugs — while you stay in control of every permission.

Provider catalog comes from [models.dev](https://models.dev) — no hardcoded provider lists, no hardcoded pricing, no hardcoded model names. API keys are encrypted at rest with a per-machine key. Every developer-level config lives under `~/.wrongstack/`; the only thing you'd ever commit to a repo is `.wrongstack/AGENTS.md`.

## Requirements

- **Node.js** ≥ 22.0.0
- **pnpm** ≥ 9.0.0 (recommended) or npm

## Install

```bash
npm install -g @wrongstack/cli
# or
pnpm add -g @wrongstack/cli
```

Installing `@wrongstack/cli` pulls in the rest of the stack as dependencies — `@wrongstack/core`, `@wrongstack/providers`, `@wrongstack/tools`, `@wrongstack/mcp`, and `@wrongstack/tui`. The TUI is shipped but lazy-loaded behind `--tui`, so plain-REPL users pay no React/Ink import cost at startup.

After install, both `wstack` and `wrongstack` are on your `PATH`.

## First-run setup

```bash
$ wstack init
WrongStack init
ℹ Loading provider catalog from models.dev (cached locally)…
Detected API keys for: Anthropic
Provider [anthropic]:
Model [claude-opus-4-7]:
ℹ Found API key in env (ANTHROPIC_API_KEY).
ℹ Wrote C:\Users\you\.wrongstack\config.json
```

`init` reads `models.dev/api.json`, detects which provider env vars you already have set, and suggests the newest model for the provider you pick. API keys land in the config encrypted with a key file the CLI generates the first time it needs to encrypt anything.

To add a key later without re-running `init`:

```bash
$ wstack auth groq
Enter GROQ_API_KEY:
ℹ Stored encrypted key for groq.
```

## Daily use

```bash
wstack "refactor src/auth.ts to async/await"   # single-shot
wstack                                          # plain readline REPL
wstack --tui                                    # Ink-based TUI (paste collapse, @-picker, Alt+V images)
wstack --resume <id>                            # continue a saved session
wstack resume <id>                              # same, sugar form
```

## Two interactive modes

**Plain REPL** (default): readline-based, multiline heredoc, slash commands, streaming text. Works everywhere a terminal works.

**TUI** (`--tui`): Ink + React frontend in `@wrongstack/tui`, lazy-loaded — non-TUI users pay no React/Ink import cost. Features wired:

- Multi-line paste collapsed to `[pasted #1] (123 lines)` via bracketed paste mode (`\x1b[?2004h`) plus a chunk-size heuristic fallback
- `@<query>` opens a fuzzy file-picker over the project root, arrow keys to navigate, Enter attaches as `[file #N]`
- `Alt+V` reads an image from the clipboard (PowerShell on Windows, `osascript` on macOS, `wl-paste`/`xclip` on Linux), attaches as `[image #N]`
- Live status bar: model · token in/out · cache hit % · cost · run state · `running: <tool> Ns (+N)` while tools execute
- Streaming text rendered live from the provider's SSE stream
- Signal-safe cleanup: `SIGINT`/`SIGTERM`/`SIGHUP`/`exit` all disable bracketed paste mode on the way out
- Non-TTY guard: refuses to start with exit code 2 when stdin or stdout is piped

## Built-in tools

**33 tools registered out of the box** — 30 from `builtinTools`, 1 context manager (always-on default), and 2 memory tools (`remember`/`forget`, gated by `features.memory`).

| Tool | What it does |
|------|--------------|
| `read` | Read file contents with offset/limit |
| `write` | Write or overwrite a file |
| `edit` | Surgical string replacement in existing files |
| `replace` | Batch regex replacement across matched files |
| `glob` | Find files matching a pattern |
| `grep` | Search file contents with regex |
| `bash` | Run shell commands |
| `exec` | Restricted shell with an allowlist (`node`, `npm`, `pnpm`, …) |
| `fetch` | HTTP fetch with HTML→markdown (localhost blocked by default) |
| `search` | Web search (DuckDuckGo / Google / Bing) |
| `patch` | Apply unified diff patches |
| `json` | Parse and query JSON with dot notation |
| `diff` | Show differences between files or commits |
| `tree` | Display directory structure as ASCII tree |
| `lint` | Run linter (Biome / ESLint / TSLint) |
| `format` | Format code with Biome / Prettier |
| `typecheck` | TypeScript type checking |
| `test` | Run tests with Vitest / Jest / Mocha |
| `install` | Install npm packages |
| `audit` | Security vulnerability audit |
| `outdated` | Check for outdated packages |
| `logs` | Stream or fetch service log files |
| `document` | Generate JSDoc/TSDoc comments |
| `scaffold` | Generate boilerplate from templates |
| `tool_search` / `tool_use` / `batch_tool_use` / `tool_help` | Meta-tooling for tool discovery and orchestration |
| `todo` | Track multi-step tasks |
| `git` | Common git operations |
| `context_manager` | Inspect / trim / compact the in-flight context window |
| `remember` / `forget` | Persist notes across sessions (project- or user-scoped) |

## CLI flags

```
--provider <id>      Override provider (e.g. anthropic, openai, groq)
--model <id>         Override model
--cwd <path>         Project root (default: process.cwd())
--resume <id>        Resume a saved session
--tui                Use the Ink TUI instead of readline REPL
--no-tui             Force-disable the TUI (overrides --tui)
--no-banner          Suppress the startup banner
--no-features        Run with everything off: no MCP, no plugins, no memory tools,
                     no models.dev fetch, no skill discovery. Minimal viable WrongStack.
--yolo               Auto-allow all tool calls (don't ask for confirmation)
--verbose / -v       Log level → debug
--trace              Log level → trace
--log-level <lvl>    Explicit log level
--help / --version   Standard
```

## Subcommands

```bash
wstack init           # First-run setup wizard
wstack auth <prov>    # Store an API key (prompted, encrypted at rest)
wstack sessions       # List saved sessions for this project
wstack resume <id>    # Continue a saved session
wstack config         # Show / edit config
wstack tools          # List registered tools
wstack skills         # List discovered skills
wstack providers      # ~110 providers grouped by wire family
wstack models [prov]  # Models for a provider (default: current)
wstack mcp            # Inspect connected MCP servers
wstack plugin         # Plugin manifest commands
wstack diag           # Diagnostics: provider, tokens, paths
wstack usage          # Token + cost totals across sessions
wstack projects       # List known project hashes → paths
wstack help           # Help text
wstack version        # Version
```

## Slash commands (in-REPL)

`/init`, `/diag`, `/stats`, `/help`, `/clear`, `/context`, `/compact`, `/usage`, `/tools`, `/skill`, `/use`, `/model`, `/save`, `/resume`, `/exit`

`/init` scaffolds `.wrongstack/AGENTS.md` for the project, detecting your build system (package.json / pyproject.toml / go.mod / Cargo.toml / Makefile) and pre-filling the build/test/lint/run commands.

## Catalog commands

```bash
wstack providers              # ~110 providers grouped by wire family
wstack providers --all        # include unsupported families (needs plugin)
wstack models                 # models for current provider
wstack models google          # models for any provider id from models.dev
wstack models refresh         # force-refresh the 24h cache
```

`●` = your env has a key for this provider · `○` = configure to use it.

## Providers (4 wire families + 1 stub)

| Family | Transport | Providers in models.dev |
|--------|-----------|------------------------|
| `anthropic` | Native Claude API + SSE | Anthropic, MiniMax, Kimi, Google Vertex (Anthropic) |
| `openai` | Native OpenAI Chat Completions + SSE | OpenAI, Perplexity Agent, Vivgrid |
| `openai-compatible` | OpenAI-spec endpoints + SSE | ~100 providers: Groq, DeepSeek, OpenRouter, Together, xAI, Cerebras, Ollama, Fireworks, Moonshot, GLM, Alibaba, … |
| `google` | Gemini `:streamGenerateContent?alt=sse` | Google AI Studio |
| `unsupported` | Needs plugin | Mistral, Cohere, Bedrock, Vertex (non-Anthropic), Azure |

All four supported families implement **real streaming** end-to-end: provider `stream()` is the source of truth, `complete()` is just `aggregateStream(stream(...))`. Mid-stream aborts preserve any partial assistant text already received.

## Configuration

### Environment variables

| Variable | Description |
|----------|-------------|
| `<PROVIDER>_API_KEY` | API key for the provider (e.g. `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`) |
| `WRONGSTACK_FETCH_ALLOW_PRIVATE` | Set to `1` to allow localhost / private IPs in the `fetch` tool |

### Config file (`~/.wrongstack/config.json`)

```jsonc
{
  "version": 1,
  "provider": "anthropic",
  "model": "claude-opus-4-7",
  "providers": {
    "anthropic": { "apiKey": "enc:v1:<iv>:<tag>:<ciphertext>" }
  },
  "features": {
    "mcp": true,
    "plugins": true,
    "memory": true,
    "modelsRegistry": true,
    "skills": true
  },
  "plugins": []
}
```

`apiKey`-like fields (matched by the regex `/apikey|authtoken|bearer|secret|password|refreshtoken|sessionkey|access[_-]?token|private[_-]?key/i`) are auto-encrypted on first contact. Plaintext keys in older config files get migrated transparently on boot — you'll see a `[wstack] Encrypted N plaintext secret(s) in …` notice if migration ran.

### Project-level (`<project>/.wrongstack/AGENTS.md`)

Commit this file to share project conventions with the agent across all developers:

```
// Conventions for this repo
- Always run tests after editing
- Use pnpm, not npm
- PR titles follow conventionalcommits.org
```

## Four contracts

**1. Minimal kernel.** `Container`, `Pipeline`, `EventBus`, `RunController`, and the token table total **505 lines**. The agent loop adds another **525 lines**. Everything else is replaceable.

**2. Zero non-overridable behavior.** 16 services bound through `Container` (Logger, TokenCounter, SessionStore, MemoryStore, PermissionPolicy, Compactor, PathResolver, ConfigLoader, Renderer, InputReader, ErrorHandler, RetryPolicy, SkillLoader, SystemPromptBuilder, SecretScrubber, ModelsRegistry). 6 pipelines as middleware chains (`request`, `response`, `toolCall`, `userInput`, `assistantOutput`, `contextWindow`). Tools, providers, MCP servers, and slash commands all live in registries.

**3. Standalone sufficiency.** Works with 33 built-in tools, 4 wire-family transports, permission policy, and a curated system prompt — no plugins required.

**4. Layered, not monolithic.** `--no-features` flips off MCP, plugins, memory tools, models.dev fetch, and skill discovery. What's left is the kernel + agent + tools + a hand-configured provider. The minimal-viable WrongStack runs offline with no network calls at startup.

## Layering with `--no-features`

```bash
# Fully offline: no MCP servers, no plugins, no memory persistence,
# no models.dev fetch, no skill discovery. Provider family must be
# declared explicitly in providers[<id>].family.
wstack --no-features --provider anthropic --model claude-opus-4-7 "..."
```

Each feature flag is independent; you can keep skills on while turning MCP off, or run a CI job with just `features.modelsRegistry: false` to avoid the startup network call.

## Mode system

Agents can operate in different modes that inject role-specific system prompts. 8 built-in modes: `default`, `code-reviewer`, `code-auditor`, `architect`, `debugger`, `tester`, `devops`, `refactorer`.

```ts
import { DefaultModeStore } from '@wrongstack/core';
import { createModeTool } from '@wrongstack/tools';

const modeStore = new DefaultModeStore({ directory: '~/.wrongstack/modes' });
const modeTool = createModeTool(modeStore);

await modeTool.execute({ action: 'set', mode: 'code-reviewer' });
```

## Multi-agent

Run multiple agents in parallel with done-condition looping:

```ts
// Autonomous — runs until done condition
const runner = new AutonomousRunner({
  agent,
  context,
  doneCondition: { type: 'iterations', maxIterations: 100 },
});

// Multi-agent coordinator — task orchestration
const coordinator = new DefaultMultiAgentCoordinator({
  coordinatorId: 'main',
  maxConcurrent: 4,
  doneCondition: { type: 'all_tasks_done' },
});

await coordinator.spawn({ id: 'w1', name: 'Worker', role: 'reviewer' });
await coordinator.assign({ id: 't1', description: 'Review auth module' });
```

## Spec-Driven Development

Full workflow: `SpecParser` → `TaskGenerator` → `TaskTracker` → `TaskFlow`

```ts
const parser = new SpecParser();
const spec = parser.parse(markdownSpec);
const analysis = parser.analyze(spec);

const tracker = new TaskTracker({ store });
const generator = new TaskGenerator({ taskTracker: tracker });
await generator.generateFromSpec(spec);

const flow = new TaskFlow({ tracker });
await flow.execute({ executeTask: async (task) => { /* ... */ } });
```

### Bundled skills

`git-flow`, `multi-agent`, `node-modern`, `prompt-engineering`, `react-modern`, `sdd`, `typescript-strict` — discovered in this order: project → user → bundled, with first-seen winning on name collisions.

## Sessions

Every run writes a `<id>.jsonl` append-only event log under `~/.wrongstack/projects/<sha256>/sessions/`. On close, a tiny `<id>.summary.json` manifest is written alongside (title, model, provider, tokenTotal) so `wstack sessions` lists hundreds of past runs without re-parsing each JSONL — listing is O(N) stats, not O(N) full parses.

Resume picks up exactly where the previous run left off, replays the events into `Context.messages`, and writes a `session_resumed` marker. Orphan `tool_result` events (where the matching `tool_use` is missing) emit a `session.damaged` event so the session can be flagged for repair instead of silently corrupting the replay.

## Encrypted secrets

API keys and MCP auth tokens are encrypted with **AES-256-GCM** using a 32-byte key kept at `~/.wrongstack/.key` (mode `0600` on POSIX). The format is `enc:v1:<iv>:<tag>:<ciphertext>`. Different invocations produce different ciphertexts for the same plaintext (random IV per encryption).

The CLI auto-migrates any plaintext keys it finds in `config.json` on every boot. Field detection is regex-based, so `refreshToken`, `sessionKey`, `client_secret`, `private_key`, `bearer`, etc. all get picked up automatically; `publicKey` is on a hard-coded override list (it's a key, but it's not a secret).

## Observability events

The `EventBus` carries 18 typed events including `tool.started` and `tool.executed` (closes the gap between "model decided to call a tool" and "tool finished" — the TUI uses these to render the live "running: <tool> Ns" indicator), `provider.text_delta` (live streaming text), `session.damaged`, `token.threshold`, `token.cost_estimate_unavailable`, `compaction.fired`, and per-MCP-server connection events.

Subscribe with `events.on(name, fn)` or `events.once(name, fn)`; listeners that throw are caught and logged, never re-thrown.

## Filesystem layout

```
~/.wrongstack/                              # everything developer-level
  config.json                               # global config (provider + encrypted keys)
  .key                                      # AES-256-GCM key (mode 0600)
  cache/models.dev.json                     # 24h TTL provider catalog
  memory.md                                 # user-global agent notes
  skills/                                   # user-global skills
  history                                   # REPL history
  logs/wrongstack.log                       # ops log
  projects/<sha256-of-project-root>/        # per-project state
    memory.md                               # project agent notes
    sessions/<id>.jsonl                     # session events (append-only)
    sessions/<id>.summary.json              # cached summary for fast listing
    trust.json                              # permission policy
    meta.json                               # links hash → path

<your-project>/.wrongstack/                # only committed artifacts
  AGENTS.md                                 # project conventions (shared via git)
  skills/                                   # project-local skills (shared via git)
```

The project tree stays clean — sessions, trust rules, logs, and caches never pollute it.

## Extending with plugins

Drop a plugin in `config.plugins`:

```jsonc
// ~/.wrongstack/config.json
{
  "version": 1,
  "provider": "anthropic",
  "model": "claude-opus-4-7",
  "plugins": ["@yourorg/wrongstack-plug-typecheck"]
}
```

A plugin declares `apiVersion: "^1.0"` and gets the full `PluginAPI`: container, pipelines, events, tool/provider/MCP registries, config, logger. See `packages/core/src/plugin/` for the contract. Optional dependencies (`optionalDeps`) are silently skipped if not loaded; required ones (`dependsOn`) throw at boot.

## Packages

| Package | Purpose |
|---------|---------|
| `@wrongstack/core` | Kernel, agent, defaults, types, registries, plugin contract |
| `@wrongstack/providers` | Anthropic/OpenAI/OpenAI-compatible/Google wire adapters + SSE |
| `@wrongstack/tools` | 33 built-in tools |
| `@wrongstack/mcp` | MCP server registry + reconnection logic |
| `@wrongstack/cli` | REPL, subcommands, slash commands, terminal renderer |
| `@wrongstack/tui` | Ink-based TUI (paste collapse, @-picker, image paste) — lazy-loaded behind `--tui` |

## Architecture

```
CLI       → REPL, renderer, slash commands, subcommands
TUI       → Ink frontend (lazy-loaded behind --tui)
Agent     → loop, context, system prompt, permission, compaction
Tools     → ToolExecutor (parallel/sequential/smart strategies, abort-safe)
Kernel    → Container · Pipeline · EventBus · RunController (the 4 primitives)
Provider  → 4 wire families, factories built from ModelsRegistry, real SSE
Models    → models.dev/api.json fetched + cached + classified
```

State lives in the agent layer only. Kernel, providers, and the models registry are stateless within a single run (the registry persists its cache).

## Status

- **535 tests passing** across 76 test files
- All 6 packages build clean with TypeScript strict + `noUncheckedIndexedAccess`
- Node 22+ only, ESM-only, no CommonJS bundles

## License

Apache-2.0

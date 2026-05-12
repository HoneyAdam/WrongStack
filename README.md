# WrongStack

> Built on the wrong stack. Shipped anyway.

A CLI AI coding agent that runs in your terminal. It reads your code, edits files, runs commands, and reasons through bugs — while you stay in control of every permission.

Provider catalog comes from [models.dev](https://models.dev) — no hardcoded provider lists, no hardcoded pricing, no hardcoded model names. Every developer-level config lives under `~/.wrongstack/`; the only thing you'd ever commit to a repo is `.wrongstack/AGENTS.md`.

## Requirements

- **Node.js** ≥ 22.0.0
- **pnpm** ≥ 9.0.0 (recommended) or npm

## Install

```bash
npm install -g wrongstack
# or
pnpm add -g wrongstack
```

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

`init` reads `models.dev/api.json`, spots which provider env vars you already have set, and suggests the newest model for the provider you pick.

## Daily use

```bash
wstack "refactor src/auth.ts to async/await"   # single-shot
wstack                                          # REPL mode
wstack resume                                   # continue last session
```

## Built-in tools

WrongStack ships with 8 core tools — no plugins required:

| Tool | What it does |
|------|--------------|
| `read` | Read file contents with offset/limit |
| `write` | Write or overwrite a file |
| `edit` | Surgical string replacement in existing files |
| `replace` | Batch regex replacement across matched files |
| `glob` | Find files matching a pattern |
| `grep` | Search file contents with regex |
| `bash` | Run shell commands |
| `exec` | Restricted shell with pre-approved commands |
| `fetch` | HTTP GET requests (localhost blocked by default) |
| `search` | Web search (DuckDuckGo, Google, Bing) |
| `patch` | Apply unified diff patches |
| `json` | Parse and query JSON with dot notation |
| `diff` | Show differences between files or commits |
| `tree` | Display directory structure as ASCII tree |
| `lint` | Run linter (Biome/ESLint/TSLint) |
| `format` | Format code with Biome/Prettier |
| `typecheck` | TypeScript type checking |
| `test` | Run tests with Vitest/Jest/Mocha |
| `install` | Install npm packages |
| `audit` | Security vulnerability audit |
| `outdated` | Check for outdated packages |
| `logs` | Stream or fetch service log files |
| `document` | Generate JSDoc/TSDoc comments |
| `scaffold` | Generate boilerplate from templates |
| `tool_search` | Search and filter available tools |
| `tool_use` | Execute a specific tool by name |
| `batch_tool_use` | Execute multiple tools in parallel |
| `tool_help` | Get help for a tool or list all tools |
| `todo` | Track multi-step tasks |
| `git` | Common git operations |
| `remember` / `forget` | Persist notes across sessions |

**31 core tools** — no plugins required.

## Catalog commands

```bash
wstack providers              # ~110 providers grouped by wire family
wstack providers --all        # include unsupported families (needs plugin)
wstack models                 # models for current provider
wstack models google          # models for any provider id from models.dev
wstack models refresh         # force-refresh the 24h cache
```

`●` = your env has a key for this provider · `○` = configure to use it.

## Providers (4 wire families)

| Family | Transport | Providers in models.dev |
|--------|-----------|------------------------|
| `anthropic` | Native Claude API | Anthropic, MiniMax, Kimi, Google Vertex (Anthropic) |
| `openai` | Native OpenAI Chat Completions | OpenAI, Perplexity Agent, Vivgrid |
| `openai-compatible` | OpenAI-spec endpoints | ~100 providers: Groq, DeepSeek, OpenRouter, Together, xAI, Cerebras, Ollama, Fireworks, Moonshot, GLM, Alibaba, … |
| `google` | Gemini `generateContent` | Google AI Studio |
| `unsupported` | Needs plugin | Mistral, Cohere, Bedrock, Vertex (non-Anthropic), Azure |

Pick anything from `wstack providers` — WrongStack picks the right transport automatically.

## Configuration

### Environment variables

| Variable | Description |
|----------|-------------|
| `<PROVIDER>_API_KEY` | API key for the provider (e.g. `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`) |
| `WRONGSTACK_FETCH_ALLOW_PRIVATE` | Set to `1` to allow localhost in fetch tool |

### Config file (`~/.wrongstack/config.json`)

```jsonc
{
  "version": 1,
  "provider": "anthropic",
  "model": "claude-opus-4-7",
  "plugins": []
}
```

### Project-level (`<project>/.wrongstack/AGENTS.md`)

Commit this file to share project conventions with the agent across all developers:

```
// Conventions for this repo
- Always run tests after editing
- Use pnpm, not npm
- PR titles follow conventionalcommits.org
```

## Three contracts

**1. Minimal kernel.** `Container`, `Pipeline`, `EventBus`, the agent loop, and `Context` total under 600 lines. Everything else is replaceable.

**2. Zero non-overridable behavior.** 16 services bound through `Container`. 8 pipelines as middleware chains. Tools, providers, MCP servers, and slash commands all live in registries.

**3. Standalone sufficiency.** Works with 31 built-in tools, 4 wire-family transports, permission policy, and a curated system prompt — no plugins required.

## Mode system

Agents can operate in different modes that inject role-specific system prompts:

```ts
const modeStore = new DefaultModeStore({ directory: '~/.wrongstack/modes' });
const modeTool = createModeTool(modeStore);

// Built-in modes: default, code-reviewer, code-auditor, architect,
// debugger, tester, devops, refactorer
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

### Built-in skills

- `sdd-SKILL.md` — Spec-driven development workflow
- `multi-agent-SKILL.md` — Multi-agent coordination

## Filesystem layout

```
~/.wrongstack/                              # everything developer-level
  config.json                               # global config (provider + key)
  cache/models.dev.json                     # 24h TTL provider catalog
  memory.md                                 # user-global agent notes
  skills/                                   # user-global skills
  history                                   # REPL history
  logs/wrongstack.log                       # ops log
  projects/<sha256-of-project-root>/        # per-project state
    memory.md                               # project agent notes
    sessions/<id>.jsonl                     # session events
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

A plugin gets the full `PluginAPI`: container, pipelines, events, tool/provider/MCP registries, config, logger. See `packages/core/src/plugin/` for the contract.

## Architecture

```
CLI       → REPL, renderer, slash commands, subcommands
Agent     → loop, context, system prompt, permission, compaction
Kernel    → Container · Pipeline · EventBus (the 3 primitives)
Provider  → 4 wire families, factories built from ModelsRegistry
Models    → models.dev/api.json fetched + cached + classified
```

State lives in the agent layer only. Kernel, providers, and the models registry are stateless within a single run (the registry persists its cache).

## License

Apache-2.0
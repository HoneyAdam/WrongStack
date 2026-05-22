# Slash Commands — Overview

WrongStack's REPL supports ~30 built-in slash commands. Each is a first-class citizen: registered into `SlashCommandRegistry`, dispatched by name, and wired with a shared `SlashCommandContext` that provides access to the runtime container, renderer, event bus, and agent state.

## Command map

| Command | File | What it does |
|---|---|---|
| `/help` | `help.ts` | List all commands; show detailed help for a named command |
| `/init` | `init.ts` | Create or update `.wrongstack/AGENTS.md` with auto-detected project facts |
| `/clear` | `clear.ts` | Wipe session state: messages, todos, read-files, file-mtimes, meta, memory, terminal |
| `/compact` | `compact.ts` | Run the context-window compactor (normal or aggressive) |
| `/context` | `context.ts` | Context window summary; repair orphan blocks; switch context mode; `/ctx` alias |
| `/diag` | `diag-stats.ts` | Runtime diagnostics: provider, tokens, tools, MCP server state |
| `/stats` | `diag-stats.ts` | Session report: tokens, requests, tool calls, files read, estimated cost |
| `/memory` | `memory.ts` | Persistent memory: show, remember, forget, clear |
| `/todos` | `todos.ts` | Session todo list: show, add, done (by id/index/fuzzy match), clear |
| `/plan` | `plan.ts` | Strategic plan board (session-persistent `.plan.json`): show, add, start, done, remove, promote, derive, template, clear |
| `/mode` | `mode.ts` | Switch or view session mode (default, brief, teach, refactorer, …) |
| `/yolo` | `yolo.ts` | Toggle or query YOLO (auto-approve all tool calls) |
| `/autonomy` | `autonomy.ts` | Set autonomy level: off, suggest, auto, eternal |
| `/goal` | `goal.ts` | Set/show/clear persistent autonomous mission (`.wrongstack/goal.json`) |
| `/save` | `session.ts` | Force-flush session to disk (append `session_end` event) |
| `/resume` | `session.ts` | List recent sessions; `/load`, `/sessions` aliases |
| `/exit` | `session.ts` | Exit REPL; `/quit`, `/q` aliases |
| `/tools` | `tools.ts` | List all registered tools: name, owner package, mut/ro, permission |
| `/skill` | `skill.ts` | List all skills or show a skill's full body |
| `/skill-gen` | `skill-generator.ts` | LLM-guided skill authoring wizard |
| `/skill-install` | `skill-install.ts` | Install a skill from URL or registry |
| `/skill-update` | `skill-update.ts` | Update installed skills |
| `/skill-uninstall` | `skill-uninstall.ts` | Remove a user-global skill |
| `/plugin` | `plugin.ts` | Manage plugins: list, official, install, enable, disable, remove |
| `/spawn` | `spawn-agents.ts` | Spawn an isolated subagent for a task |
| `/agents` | `spawn-agents.ts` | Show status of all spawned subagents |
| `/director` | `spawn-agents.ts` | Promote to director mode (fleet orchestration) |
| `/fleet` | `fleet.ts` | Fleet control: status, usage, kill, manifest, retry, log, stream |
| `/sdd` | `sdd.ts` | AI-driven spec-driven development workflow |
| `/commit` | `commit.ts` | Stage all + generate LLM commit message + commit; `--dry-run` / `--no-llm` flags |
| `/gitcheck` | `commit.ts` | Silent change check for system-prompt injection |
| `/push` | `commit.ts` | Git push to all remotes; `--force` / `--dry-run` flags |
| `/security` | `security.ts` | Security scan/audit/report; `--depth`, `--format` flags |
| `/metrics` | `metrics.ts` | Prometheus metrics snapshot (requires `--metrics` flag at startup) |
| `/health` | `health.ts` | Run health checks (requires `--metrics` flag at startup) |
| `/statusline` | `statusline.ts` | Toggle TUI status bar items at runtime |

## Dispatch flow

```
REPL input "/<command> <args>" 
  → SlashCommandRegistry.dispatch(name, args, ctx)
  → matching SlashCommand.run(args, ctx)
  → returns { message: string, runText?: string, exit?: boolean }
```

`runText` is a special field: when a slash command returns it, the REPL injects that text into the next agent turn — used by `/goal`, `/sdd`, `/autonomy` to steer the AI conversation without the user typing.

## Context wiring

`SlashCommandContext` is assembled in `packages/cli/src/index.ts` and passed to every `buildXxxCommand(opts)`. Key fields:

```typescript
interface SlashCommandContext {
  registry          // SlashCommandRegistry — list commands, dispatch
  toolRegistry      // ToolRegistry — list tools
  context           // Context — live agent state (messages, todos, meta, etc.)
  cwd / projectRoot // string — filesystem scope
  renderer          // Renderer — terminal output
  memoryStore       // MemoryStore — persistent memory
  sessionStore      // SessionStore — session listing/resume
  skillLoader       // SkillLoader — skill listing/reading
  modeStore         // ModeStore — mode switching
  compactor         // { compact() } — context window compaction
  tokenCounter      // TokenCounter — usage accounting
  llmProvider       // Provider — active provider (available pre-agent)
  llmModel          // string — active model id
  onSpawn           // (task, opts) → spawn subagent
  onAgents          // () → subagent status
  onDirector        // () → promote to director mode
  onFleet           // (action, target) → fleet control
  onFleetRetry       // (taskId?) → retry interrupted tasks
  onFleetLog        // (id, mode) → inspect subagent transcripts
  onYolo            // (setTo?) → toggle YOLO
  onAutonomy        // (setTo?) → set autonomy mode
  onEternalStart    // () → start eternal loop
  onEternalStop     // () → stop eternal loop
  onPlugin          // (args) → plugin management
  planPath          // string — session plan file path
}
```

## Adding a new slash command

1. Create `packages/cli/src/slash-commands/<name>.ts`
2. Export `buildXxxCommand(opts: SlashCommandContext): SlashCommand`
3. Import and add to `buildBuiltinSlashCommands()` in `index.ts`
4. Add tests under `packages/cli/tests/slash-<name>.test.ts`
5. Add docs under `docs/slash/<name>.md`
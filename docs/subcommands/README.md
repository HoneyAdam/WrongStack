# Subcommands — Overview

WrongStack exposes top-level subcommands via `wstack <subcommand>` (aliased to `wrongstack <subcommand>`). Unlike slash commands which run inside a REPL/TUI session, subcommands are standalone CLI entry points that can be used independently.

## Full command map

| Subcommand | Handler | What it does |
|---|---|---|
| `wstack init` | `init.ts` | Interactive provider/model setup, writes `~/.wrongstack/config.json` + `.wrongstack/AGENTS.md` |
| `wstack auth` | `auth.ts` | Interactive API key management: add, remove, list credentials |
| `wstack update` | `update.ts` | Check for WrongStack updates |
| `wstack sessions` | `sessions-config.ts` | List saved sessions; resume or delete one |
| `wstack config` | `sessions-config.ts` | Show or edit current config |
| `wstack rewind` | `rewind.ts` | Rewind active session to a previous turn |
| `wstack tools` | `tools-skills.ts` | List all registered tools |
| `wstack skills` | `tools-skills.ts` | List all available skills |
| `wstack providers` | `providers-models.ts` | List configured providers |
| `wstack models` | `providers-models.ts` | List available models for a provider |
| `wstack mcp` | `mcp.ts` | List/add/remove MCP servers (config only; no runtime control) |
| `wstack plugin` | `plugin-usage.ts` | Manage plugins (install, remove, enable, disable) |
| `wstack plugins` | `plugin-usage.ts` | Alias for `wstack plugin` |
| `wstack diag` | `diag-doctor.ts` | Full diagnostic dump |
| `wstack doctor` | `diag-doctor.ts` | Run health checks |
| `wstack export` | `export.ts` | Export session data (JSON, markdown, transcript) |
| `wstack usage` | `plugin-usage.ts` | Show per-plugin usage statistics |
| `wstack version` | `version-help.ts` | Show version info |
| `wstack help` | `version-help.ts` | Show help |
| `wstack projects` | `projects.ts` | List projects with `.wrongstack/` directories |

## Subcommand handler interface

```typescript
type SubcommandHandler = (args: string[], deps: SubcommandDeps) => Promise<number>;
// Returns exit code: 0 = success, 1 = error, 2 = config error

interface SubcommandDeps {
  config: Config;
  renderer: TerminalRenderer;
  reader: ReadlineInputReader;
  sessionStore?: SessionStore;
  skillLoader?: SkillLoader;
  toolRegistry?: ToolRegistry;
  modelsRegistry: ModelsRegistry;
  paths: WstackPaths;
  vault: SecretVault;
  cwd: string;
  projectRoot: string;
  userHome: string;
}
```

Exit code convention: `0` = success, `1` = generic error, `2` = config/user error, `130` = SIGINT.

## Adding a new subcommand

1. Create `packages/cli/src/subcommands/handlers/<name>.ts`
2. Export a `const <name>Cmd: SubcommandHandler = async (args, deps) => ...`
3. Register in `packages/cli/src/subcommands/index.ts`: import and add to the `subcommands` record
4. Update `packages/cli/src/boot.ts` to wire `parseArgs` for the new subcommand if it needs special argv handling
5. Add tests: `packages/cli/tests/<name>.test.ts`

## vs Slash Commands

| Aspect | Subcommands | Slash commands |
|---|---|---|
| Invocation | `wstack <sub>` from shell | `/<cmd>` inside REPL/TUI |
| Context | No agent context | Full `Context` (messages, todos, etc.) |
| Exit | Returns exit code | Returns `{ message, exit? }` |
| Persistence | Config/session on disk | Session state only |
| Use case | Setup, config, project management | In-session control |
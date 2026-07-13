# `wstack init` — Deprecated compatibility alias

## Status

`wstack init` is deprecated. It no longer runs a setup wizard or writes project
files. The handler exits successfully after pointing users to the current flows.

## Current setup flows

| Goal | Current entry point |
|---|---|
| Configure a provider, API key, and default model | `wstack auth` |
| Add a provider directly | `wstack auth <provider>` |
| Configure a local OpenAI-compatible runtime | `wstack auth local` |
| Let startup detect the project and offer an AGENTS.md scaffold | Run `wstack` interactively from the project root |
| Regenerate project context later | Run `/init` inside the REPL or TUI |

`/init` writes `.wrongstack/AGENTS.md`. When a file already exists, the slash
command makes a best-effort `.wrongstack/AGENTS.md.bak` copy before replacing it
with a freshly detected template.

## Exit code

The compatibility handler returns `0` after printing the migration notice.

## Code reference

- `packages/cli/src/subcommands/handlers/init.ts` — deprecated compatibility handler
- `packages/cli/src/subcommands/handlers/auth.ts` — current credential setup
- `packages/cli/src/pre-launch/project-check.ts` — automatic project detection
- `packages/cli/src/slash-commands/init.ts` — in-session project context generator

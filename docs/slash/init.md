# /init — Project Context Generator

## What it does

`/init` creates or overwrites `.wrongstack/AGENTS.md` — a file loaded into WrongStack's system prompt as persistent project context on every session start.

Every invocation re-runs project auto-detection and writes the template fresh. If you have manually edited the file, run `/init` again to update the auto-detected parts while your custom notes stay (the template tells the agent "DO NOT DELETE").

## Auto-detection

`detectProjectFacts()` probes the project root:

| File | Build | Test | Lint | Run |
|---|---|---|---|---|
| `package.json` + pnpm lock | `pnpm run build` | `pnpm test` | `pnpm run lint` | `pnpm run <dev/start/serve/preview>` |
| `package.json` + yarn lock | `yarn run build` | `yarn test` | ... | ... |
| `package.json` + bun lock | `bun run build` | `bun test` | ... | ... |
| `go.mod` | `go build ./...` | `go test ./...` | — | `go run .` |
| `Cargo.toml` | `cargo build` | `cargo test` | `cargo clippy` | `cargo run` |
| `Makefile` | `make <build\|>` | `make test` (if target exists) | `make lint` (if exists) | `make <run\|dev\|start>` |
| `pyproject.toml` | — | `pytest` | `ruff check .` | — |

First match per field wins. `package.json` is checked first, then Go, Rust, Make, Python.

## Template sections

```
## Project brief        — Purpose, users, runtime, auto-detect hints
## How to work safely  — Rules, protected files, known fragile areas
## Commands            — Build/Test/Lint/Run as table
## Key files and entry points — src/, tests/, docs/, scripts/
## Architecture notes  — Modules, layers, extension points
## Domain knowledge    — Business rules, acronyms, intentional quirks
## Verification checklist — What to run after changes, smoke tests
## Useful pointers     — Docs, dashboards, related repos
```

## REPL vs `wstack init` subcommand

| Entry | Behavior |
|---|---|
| `/init` in REPL | Writes `.wrongstack/AGENTS.md` only |
| `wstack init` subcommand | Interactive provider/model setup → `~/.wrongstack/config.json` + same AGENTS.md logic |

Both use the same `detectProjectFacts()` + `renderAgentsTemplate()` from `helpers.ts`.

## Code reference

- `packages/cli/src/slash-commands/init.ts` — slash command
- `packages/cli/src/slash-commands/helpers.ts` — `detectProjectFacts()` + `renderAgentsTemplate()`
- `packages/cli/src/subcommands/handlers/init.ts` — `wstack init` subcommand
- `packages/cli/tests/slash-init.test.ts` — tests
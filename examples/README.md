# WrongStack Examples

Examples organized by complexity. Each subdirectory shows one WrongStack
capability with commands grounded in the current CLI surface. Provider model
ids change independently of WrongStack releases, so confirm them with
`wrongstack models <provider>` before running provider-specific commands.

## Quick start

```bash
# Single-shot — type your task right into the command line
wrongstack "explain what this project does"

# Or launch the interactive REPL / TUI
wrongstack
wrongstack --tui

# Run a guided demo for any example
cd examples/01-basic && bash demo.sh       # or .\demo.ps1 on Windows
```

## Index

| # | Example | What it demonstrates |
|---|---------|---------------------|
| 01 | [Basic usage](01-basic/) | Single-shot, REPL, TUI, YOLO toggle, session resume |
| 02 | [Tool usage](02-tools/) | File editing, code search, git, tests, scaffolding |
| 03 | [Multi-provider](03-providers/) | Switching providers, custom endpoints, fallback |
| 04 | [MCP integration](04-mcp/) | Adding presets, stdio/SSE transports, permission control |
| 05 | [Multi-agent](05-multi-agent/) | Director fleet, `/spawn`, `/fleet`, `/steer` |
| 06 | [Real-world workflows](06-real-world/) | Refactor, debug, review, audit, CI scaffolding |

## Common flag combos

```bash
# TUI + YOLO + a fast provider (auto-approve normal project work)
wrongstack --tui --yolo --provider groq --model llama-3.3-70b-versatile \
  "add JSDoc to every exported function in src/"

# Director-mode single-shot — auto-spawns a fleet to tackle the task
wstack --goal "audit packages/core for security issues"

# Eternal autonomy — runs sense → decide → execute → reflect until you Ctrl+C
wrongstack --eternal "keep improving test coverage in packages/core"
```

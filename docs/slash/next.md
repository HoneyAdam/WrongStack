# /next — Next-Task Prediction

## What it does

When enabled, WrongStack runs a **lightweight, single-shot LLM call** after each
completed turn and shows the 1-3 most likely next steps:

```
  ↳ likely next:
    1. Add tests for the new parser
    2. Wire the command into the CLI
    3. Update the docs
```

Predictions are **display-only** — nothing is executed automatically. Copy or
retype one to act on it. The toggle is persisted to config, so it survives
restarts.

## How it differs from `/autonomy suggest`

| | `/autonomy suggest` | `/next` |
|---|---|---|
| Engine | full `agent.run` (all tools, context replay) | one direct `provider.complete` |
| Cost | heavy | tiny (≤160 output tokens, no tools) |
| Output | free-form suggestion turn | compact numbered list |
| Runs when | autonomy mode is `suggest` | autonomy is `off` and `/next` is on |

Because it never replays the conversation or invokes tools, prediction is cheap
enough to leave on for every turn.

## Usage

```
/next            Show whether next-task prediction is on or off
/next on         Enable — after each turn, show 1-3 predicted next steps
/next off        Disable (default)
/next toggle     Flip the current state
```

## Behavior notes

- Only runs when **autonomy mode is `off`** — `auto`/`eternal` self-drive, and
  `suggest` prints its own next steps, so prediction would just be noise there.
- **Best-effort**: any failure (provider error, 12s timeout, abort) is swallowed
  silently and the turn is unaffected.
- The prompt is built from your last request, the assistant's final summary, and
  any open todo items — kept small and clamped.
- Surfaced in **both** the plain REPL and the `--tui` interface. In the TUI the
  CLI owns the gating, so the prediction block only appears when the toggle is on
  and autonomy is `off`.

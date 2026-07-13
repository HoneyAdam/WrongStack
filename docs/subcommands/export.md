# `wstack export` — Session Export

## What it does

Exports one required session id to stdout or to a file. The command does not infer the active session and does not accept date ranges.

## Usage

```text
wstack export <session-id>
wstack export <session-id> --format markdown|json|text
wstack export <session-id> --out <file>
wstack export <session-id> --no-tools --no-diagnostics
```

`-f` aliases `--format`, and `-o` aliases `--out`. The default format is `markdown`; tool calls and diagnostics are included unless disabled. Parent directories for `--out` are created relative to the current working directory.

## Formats

| Format | Contents |
|---|---|
| `markdown` | Chat-style transcript with tool calls as code blocks |
| `json` | Structured JSON with messages, metadata, token usage |
| `text` | Plain text, no formatting |

## Code reference

- `packages/cli/src/subcommands/handlers/export.ts`
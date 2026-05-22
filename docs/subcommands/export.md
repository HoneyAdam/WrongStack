# `wstack export` — Session Export

## What it does

Exports a session or session range to various formats for sharing, archiving, or analysis.

## Usage

```bash
wstack export                    # export active session
wstack export <session-id>       # export a specific session
wstack export --format markdown # export as markdown transcript
wstack export --format json     # export as JSON
wstack export --format text     # export as plain text
wstack export --from <date>     # export sessions from date
wstack export --to <date>       # export sessions until date
```

## Formats

| Format | Contents |
|---|---|
| `markdown` | Chat-style transcript with tool calls as code blocks |
| `json` | Structured JSON with messages, metadata, token usage |
| `text` | Plain text, no formatting |

## Code reference

- `packages/cli/src/subcommands/handlers/export.ts`
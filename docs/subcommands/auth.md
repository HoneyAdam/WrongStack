# `wstack auth` — API Key Management

## What it does

Manages provider API credentials. Can run interactively (menu mode) or with flags for scripted use.

## Usage modes

### Interactive menu
```
wstack auth
```
Opens a menu listing all providers, their env vars, and key status (env / vault / missing). Allows adding, removing, or editing credentials.

### Direct (flag-based)
```
wstack auth <provider-id>
wstack auth <provider-id> --label <name> --family <family> --base-url <url> --env-vars <var1,var2>
```

## Flags

| Flag | Effect |
|---|---|
| `--label` | Human label for this credential set |
| `--family` | Provider family (e.g. `openai-compatible`) |
| `--base-url` | Custom API base URL |
| `--env-vars` | Comma-separated env vars to check (e.g. `ANTHROPIC_API_KEY`) |

## How credentials are stored

1. Prompt for API key (if not in env)
2. Encrypt with `DefaultSecretVault` using `~/.wrongstack/.key`
3. Write to `~/.wrongstack/config.json` under `providers.<id>`

## Code reference

- `packages/cli/src/subcommands/handlers/auth.ts` — handler entry
- `packages/cli/src/auth-menu.ts` — interactive menu implementation
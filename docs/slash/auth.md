# /auth — API Key Status Dashboard

Read-only view of saved API keys and provider configurations. For the
full interactive key manager (add, edit, delete), run `wstack auth`
in a separate terminal.

## Why two interfaces?

The interactive key manager (`wstack auth`) requires readline stdin which
isn't available under the Ink TUI. `/auth` provides a read-only dashboard
inside the REPL so you can check key status without leaving the session.

## Usage

| Usage | Effect |
|---|---|
| `/auth` | List all configured providers with key counts |
| `/auth status <provider>` | Show detail for one provider (type, family, keys) |
| `/auth open` | Show how to launch the interactive menu |
| `/auth help` | Show usage help |

## Examples

```bash
/auth                           # Dashboard: all providers
/auth status anthropic          # Detail for one provider
/auth open                      # "Run wstack auth to manage keys"
```

## Output

### Dashboard (`/auth`)

```
API Keys — 3 providers

  anthropic               [anthropic] → anthropic 2 keys
  openai                   [openai] → openai 1 key
  google                   [gemini] → google no keys

  /auth status <id>  Detail    /auth open  Full menu
```

### Provider detail (`/auth status <id>`)

```
anthropic [anthropic]

  type:    anthropic
  family:  anthropic
  baseUrl: https://api.anthropic.com
  models:  claude-3-5-sonnet-20241022, claude-3-opus-20240229

  Keys:
    ● default             (active — masked)  2026-01-15
    ○ work                (masked)           2026-03-22

  Manage: wstack auth → pick anthropic
```

## Security

Keys are never displayed — only labels and masked status. The `●` marker
indicates the active key, `○` marks inactive keys.

## Related

- `wstack auth` — full interactive key manager (terminal, not REPL)
- `wstack auth <provider>` — direct add
- `wstack auth <provider> --label <name>` — add with custom label

## Code reference

- `packages/cli/src/slash-commands/auth.ts`
- `packages/cli/src/auth-menu/` — interactive key manager
- `packages/cli/src/provider-config-utils.ts`

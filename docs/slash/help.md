# /help — Command Reference

## What it does

Lists all registered slash commands with their one-line descriptions, or shows detailed help for a specific command.

## Usage

```
/help              → list all commands
/help <name>       → detailed help for one command
/help /<name>      → also works (strip-leading-slash)
/help ctx          → detailed help for /ctx
```

## Output

**List view:**
```
Available slash commands:
  /help    — Show available slash commands. Pass a name for detailed help.
  /init    — Create or update .wrongstack/AGENTS.md project context for the system prompt.
  /clear   — Reset the session and start a new one.
  ...
```

**Detail view** (if the command has a `help` string):
```
/init
───────────────
Create or update .wrongstack/AGENTS.md project context for the system prompt.

Usage:
  /init
```

## How it works

- Calls `opts.registry.listWithOwner()` to get all registered commands with their owner package
- If querying a specific command, searches by name, full name, and aliases
- Falls back to the `description` field if no `help` string is defined
- Handles plugin-owned commands with `owner:` prefix (e.g. `/lsp:start`)

## Code reference

- `packages/cli/src/slash-commands/help.ts`
- `packages/core/src/registry/slash-command-registry.ts`
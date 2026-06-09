# /suggest — Generate Next-Step Suggestions

Analyzes the current project state and generates actionable next-step
suggestions. Works with `/next` — suggestions are stored and can be
selected with `/next 1`, `/next 1 2 3`, etc.

## Usage

| Usage | Effect |
|---|---|
| `/suggest` | Generate suggestions using a lightweight subagent (analyzes git status, project context) |
| `/suggest --fast` | Heuristic-only suggestions (no subagent, instant) |

## How it works

### Full mode (default)

1. Collects project context: git status, working directory, project root
2. Spawns a lightweight subagent with the context
3. Subagent generates 3-5 numbered suggestions
4. Suggestions are stored for `/next` selection

### Fast mode (`--fast`)

Heuristic-only, no subagent. Checks git status and generates suggestions
based on what's staged, modified, or untracked:

```
/git status --short →
  M  src/auth.ts     → "Commit 1 staged file(s) with a descriptive message"
  ?? new-feature.ts  → "Review 1 untracked file(s) — add to git or .gitignore"
```

Falls back to generic suggestions if not in a git repo:
- Review recent changes with a diff
- Run the test suite to verify everything passes
- Check for lint or type errors

## Integration with /next

Suggestions persist in the session and can be selected:

```bash
/suggest          # Generate suggestions
/next list        # View them
/next 1           # Execute suggestion #1
/next 1 2 3       # Execute multiple in sequence
```

## Code reference

- `packages/cli/src/slash-commands/suggest.ts`
- `packages/cli/src/slash-commands/next.ts`

# /commit · /gitcheck · /push — Git Workflow

## /commit

Stages all changes (`git add .`) and commits with an auto-generated conventional-commit message. Tries the LLM first (via `generateCommitMessage()` callback), falls back to heuristics on failure.

**Flags:**
- `--dry-run` / `-n` — show what would be committed without committing
- `--no-llm` — skip LLM, use heuristics only

Message format: `<type>(<scope>): <short description>`

**Type detection from diff stats:**
| Signal | Type |
|---|---|
| `_test.`, `.test.`, `.spec.` in filenames | `test` |
| `README`, `CHANGELOG`, `docs/`, `.md` | `docs` |
| `config`, `tsconfig`, `.json` | `chore` |
| Default | `feat` |

## /gitcheck

Silent version for system prompt integration. Returns empty string if no uncommitted changes; returns a warning message if there are changes.

```
⚠ 3 uncommitted changes — consider /commit
```

## /push

Runs `git push` to all configured remotes. **Does not auto-commit** — `/push` assumes you already committed.

**Flags:**
- `--dry-run` / `-n` — show what would be pushed
- `--force` / `-f` — force push

```
Would push to origin (main) (force)
(dry-run)
```

## Code reference

- `packages/cli/src/slash-commands/commit.ts`
- `packages/cli/src/slash-commands/commit-llm.ts` — LLM message generation
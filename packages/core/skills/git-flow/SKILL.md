---
name: git-flow
description: |
  Use this skill when proposing, reviewing, or troubleshooting git commits,
  branches, pull requests, or merge strategies in a WrongStack project session.
  Triggers: user mentions "commit", "branch", "PR", "merge", "rebase", "stash", "diff".
version: 1.1.0
---

# Git Workflow — WrongStack

## Commit messages

Format: `type: short description`

Types: `fix`, `feat`, `docs`, `refactor`, `test`, `chore`, `perf`, `ci`

Rules:
- Subject ≤ 72 chars, imperative mood, no trailing period
- Body: explain **why**, not what (the diff shows what)
- Reference issues: `Fix #123` or `Closes GH-456`

```
# Good
fix: correct race condition in token refresh
Retry logic now respects backoff multiplier. Without this,
repeated failures would hammer the provider instead of backing off.

# Bad — what, not why
fix: fixed bug
```

## Branch strategy

- One topic per branch: `feat/login`, `fix/session-leak`, `refactor/auth-layer`
- Delete branches after merge (unless shared/releasing)
- Rebase onto `main` before PR when safe (cleaner history)
- Never `git push --force` to shared branches — use `--force-with-lease`

## Safety rules

| Action | Safe? | Rule |
|--------|-------|------|
| `push --force` to own branch | ✅ | `--force-with-lease` preferred |
| `push --force` to shared branch | ❌ | Always use PR + merge |
| `reset --hard` with uncommitted work | ❌ | `git stash` first |
| `amend` a pushed commit | ❌ | It rewrites shared history |
| `merge` vs `rebase` | Context | Rebase for feature branches; merge for PRs |

## Pull requests

- Title: same format as commit messages
- Body: link to issue, describe tradeoffs, list changed files
- Keep PRs small: one reviewable concern per PR
- Self-review diff before requesting review

## Merge strategies

```
# Fast-forward merge (clean topic branch)
git checkout feature && git merge --ff-only main

# Merge commit (preserves branch history)
git merge --no-ff feature

# Rebase and fast-forward (clean linear history)
git rebase main && git merge --ff-only feature
```

## WrongStack-specific notes

- WrongStack uses `pnpm` workspaces — `git status` may show many modified files across packages
- Use `pnpm -r` for recursive commands across packages
- Check `pnpm-lock.yaml` changes — don't merge lockfile updates with unrelated changes
- When in doubt: small, frequent commits with clear messages beat large, vague ones

## Anti-patterns

- **Mega-commits**: "Update stuff" across 15 packages — split it
- **WIP commits left in main**: Use `git stash` or a feature branch, not a commit message like "WIP"
- **Committing lockfile with logic changes**: Keep them separate for easier rollbacks
- **Branching from branches**: Always branch from `main` or a stable release tag

## Skills in scope

- `refactor-planner` — when a refactor involves multiple git-managed changes
- `multi-agent` — for fleet-wide version audits across packages
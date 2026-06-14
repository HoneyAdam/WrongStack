# Git Workflow — WrongStack (Compact)

Guides commit messages, branch hygiene, PR strategy, and merge decisions. WrongStack uses pnpm workspaces.

## Rules

1. One concern per commit — never mix logic changes with lockfile updates.
2. Never force-push shared branches — use `--force-with-lease` on own branches only.
3. Always branch from `main` or a stable release tag.
4. Small, frequent commits with clear messages beat large, vague ones.
5. Rebase onto `main` before PR when safe for cleaner history.
6. Delete branches after merge unless shared or releasing.

## Commit format

`type: short description` — types: `fix`, `feat`, `docs`, `refactor`, `test`, `chore`, `perf`, `ci`

- Subject ≤ 72 chars, imperative mood, no trailing period.
- Body: explain **why**, not what (the diff shows what).
- Reference issues: `Fix #123` or `Closes GH-456`.

## Branch strategy

- One topic per branch: `feat/login`, `fix/session-leak`, `refactor/auth-layer`
- Delete after merge, rebase onto main before PR
---
name: git-flow
description: |
  Use this skill when proposing, creating, or reviewing git commits, branches,
  and PRs. Covers commit message style, branch hygiene, and safe history operations.
version: 1.0.0
---

# Git workflow

## Commits

- Subject line: imperative mood, ≤ 72 chars, no trailing period.
- Body: explain *why*, not *what* (the diff shows what).
- Group by intent, not by file.

## Branches

- One topic per branch. Rebase before merging when safe.
- Delete branches after merge.

## Safety rules

- Never `git push --force` to shared branches (use `--force-with-lease` for your own).
- Never `git reset --hard` without inspecting `git status` first.
- Don't amend already-pushed commits to shared branches.

## PRs

- Subject summarizes the change, body links the issue and lists tradeoffs.
- Keep PRs small: one reviewable change per PR.
- Self-review the diff before requesting review.

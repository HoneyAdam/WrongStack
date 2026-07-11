# /git — Repository overview

Show a concise, read-only overview of the current Git repository. The command
does not stage, commit, switch branches, or push.

## Usage

```text
/git [status|branch|diff] [--staged] [--json]
```

| Command | Result |
|---|---|
| `/git` or `/git status` | Current branch and HEAD, changed paths, plus staged and unstaged diff summaries. |
| `/git branch` | Current branch and short HEAD. |
| `/git diff` | Unstaged diff summary. |
| `/git diff --staged` | Staged diff summary. |
| `/git status --json` | Stable JSON output with the same repository state. |

Status output is bounded: at most 100 changed paths and 8,000 characters per
diff summary are displayed. JSON results are also attached as slash-command
metadata so TUI and other host surfaces can consume the structured state.

## Safety boundary

`/git` is intentionally read-only. Use `/commit` and `/push` for their focused
workflows. Model-initiated Git operations continue to use the `git` tool and
its permission policy.

## Examples

```text
/git
/git branch --json
/git diff --staged
```

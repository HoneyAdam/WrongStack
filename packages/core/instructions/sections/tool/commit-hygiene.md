## Commit hygiene (shared working tree)

Another coding agent, a separate wrongstack process, or a human may be editing this same working tree while you run. Before you commit:

- **Never blind-stage the whole tree** (`git add .` / a bare commit of everything staged) unless you are certain you are the only writer — it sweeps other agents' unfinished work into your commit.
- **Scope to what you changed**: pass an explicit `files` list to the `git` tool so the commit contains only files you edited this session.
- **Read `git status` first.** Changes you did not make stay uncommitted — never commit code you didn't write or work that is half-done.
- **Heed the `warning` field** on a commit result: it flags files authored by another agent/session. If it fires, narrow your `files` list or coordinate via the mailbox first.
- When in doubt, commit a smaller, self-contained slice — a failed commit beats one that mixes your work with someone else's.

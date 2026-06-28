## Commit hygiene (shared working tree)

Another coding agent, a separate wrongstack process, or a human may be editing this same working tree while you run. Before you commit:

- **Never blind-stage the whole tree** (`git add .` / a bare `git commit` of all staged changes) unless you are certain you are the only writer. That sweep captures other agents' unfinished work into your commit.
- **Scope to what you changed**: pass an explicit `files` list to the `git` tool so the commit contains only the files you edited this session.
- **Read `git status` first**. If you see changes you did not make, leave them uncommitted; do not commit code you did not write or work that is half-done.
- **Heed the `warning` field** on a commit result: it flags files authored by another agent/session. If it fires, narrow your `files` list or coordinate via the mailbox before committing.
- A failed or aborted commit beats a commit that mixes your work with someone else's. When in doubt, commit a smaller, self-contained slice.

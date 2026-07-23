# `wstack project` — Repository Identity

Manage the stable identity stored in `.wrongstack/project.json`. Commit this
file so clones, worktrees, forks, and machines publish to the same HQ project
and synchronize the same Kanban state.

```bash
wstack project id
wstack project init
wstack project rekey --yes
```

`rekey` is intentionally explicit: it moves future HQ telemetry and Kanban
updates into a new project namespace. Use it only when a fork has become an
independent project. Existing data remains under the previous identity. Restart
any running WrongStack sessions after rekeying.

The project ID is a `proj_<ULID>`. `hq.projectAlias` remains the display name
and a compatibility fallback when the committed identity file is absent.

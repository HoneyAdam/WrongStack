# `wstack projects` — Project Registry

## What it does

Lists all projects that have a `.wrongstack/` directory. Useful for finding old projects, auditing which directories are being tracked, and switching between project contexts.

```bash
wstack projects
  /home/user/acme-web     2026-05-20  sessions: 12  last: 2h ago
  /home/user/api-server   2026-05-18  sessions: 5   last: 2d ago
  /home/user/infra        2026-05-10  sessions: 3   last: 1w ago
```

Each entry shows: project path, last session date, session count, time since last activity.

## Code reference

- `packages/cli/src/subcommands/handlers/projects.ts`
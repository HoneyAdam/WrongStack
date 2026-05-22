# `wstack tools` · `wstack skills`

## `wstack tools`

Lists all registered tools with their metadata:

```
wstack tools
  read                            [core] ro   auto       Read a file
  write                           [core] mut  confirm    Write or overwrite a file
  bash                            [core] mut  confirm    Run a shell command
  grep                            [core] ro   auto       Search file contents
  glob                            [core] ro   auto       Find files by pattern
  ...
```

Columns: name (padded), owner package, `mut`/`ro`, permission level, description.

## `wstack skills`

Lists all available skills across all scopes:

```
wstack skills
  audit-log         (bundled)   Use when: log parsing, anomaly detection
  bug-hunter       (bundled)   Use when: systematic bug and code smell detection
  acme-conventions (project)   Use when: writing code in the acme-web repository
  my-skill          (user)     Use when: ...
```

Each entry shows: name, scope (bundled / project / user), and the trigger description.

## Code reference

- `packages/cli/src/subcommands/handlers/tools-skills.ts`
- `packages/core/src/registry/tool-registry.ts` — `ToolRegistry`
- `packages/core/src/skills/skill-loader.ts` — `SkillLoader`
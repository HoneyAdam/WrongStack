# `wstack tools` · `wstack skills`

## `wstack tools`

Lists all registered tools with their owner package and declared permission:

```
wstack tools
  read                         [@wrongstack/tools] auto
  write                        [@wrongstack/tools] confirm
  bash                         [@wrongstack/tools] confirm
  grep                         [@wrongstack/tools] auto
  glob                         [@wrongstack/tools] auto
  ...
```

Columns: name (padded), owner package, permission level. The subcommand does not currently render mutability, description, or risk tier; use `/tools` in-session for mutability and tool help/source for deeper audits.

## `wstack skills`

Lists all available skills across all scopes:

```
wstack skills
  api-design        (bundled)   Use when: REST API design, error codes, pagination
  audit-log         (bundled)   Use when: log parsing, anomaly detection
  bug-hunter       (bundled)   Use when: systematic bug and code smell detection
  docker-deploy     (bundled)   Use when: Docker containerization, multi-stage builds
  git-flow          (bundled)   Use when: commit messages, branch hygiene
 multi-agent      (bundled)   Use when: leader/worker delegation, fleet coordination
  observability    (bundled)   Use when: structured logging, traces, metrics
  acme-conventions (project)   Use when: writing code in the acme-web repository
  my-skill          (user)     Use when: ...
```

Each entry shows: name, scope (bundled / project / user), and the trigger description.

## Code reference

- `packages/cli/src/subcommands/handlers/tools-skills.ts`
- `packages/core/src/registry/tool-registry.ts` — `ToolRegistry`
- `packages/core/src/skills/skill-loader.ts` — `SkillLoader`
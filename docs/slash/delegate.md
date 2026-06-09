# /delegate — Hand a Task to a Specialist Subagent

User-facing counterpart to the AI's `delegate` tool.

## What it does

`/delegate` hands a task to a specialist subagent. With `--role`, it spawns
that specific role. Without `--role`, it uses smart dispatch (heuristic +
LLM classifier) to pick the best agent — the same engine as `/fleet dispatch`.

Requires director mode. Run `/director` first or start with `wstack --director`.

## Usage

| Usage | Effect |
|---|---|
| `/delegate` | Show usage help |
| `/delegate <task>` | Auto-dispatch to best agent (heuristic + LLM) |
| `/delegate --role=<role> <task>` | Spawn a specific role |
| `/delegate --role=<role> --name=<label> <task>` | Spawn with custom display name |
| `/delegate list` | List all available agent roles grouped by phase |
| `/delegate roles` | Alias for `list` |
| `/delegate ls` | Alias for `list` |

## Examples

```bash
/delegate "audit packages/core for null-deref bugs"
/delegate --role=bug-hunter "find the race condition in session.ts"
/delegate --role=security-scanner --name=sec-audit "scan configs for secrets"
```

## Smart dispatch

When no `--role` is given, `/delegate` uses the same `dispatchAgent` engine as
`/fleet dispatch`:

1. **Heuristic matching** — scores the task against each agent's capability
   keywords (deterministic, instant)
2. **LLM fallback** — when the heuristic is ambiguous (confidence < threshold),
   the session's LLM provider picks the best role
3. **Decision preview** — the chosen role, confidence, and alternatives are
   shown before spawning

## Role validation

When `--role` is given, the role name is validated against the agent catalog.
If the role doesn't exist, all available roles are listed:

```
Unknown role "frobber". Available roles:
  accessibility, analyst, api, architect, audit-log, auth, backend,
  browser, bug-hunter, ...

Use /delegate list to browse by phase.
```

## Related commands

| Command | Difference |
|---|---|
| `/delegate` | Smart dispatch OR explicit role, with decision preview |
| `/fleet dispatch` | Smart dispatch only, fleet must be active, shows decision + spawns |
| `/fleet spawn <role>` | Spawn N subagents of a role without a task |
| `/spawn` | Fire-and-forget subagent with custom provider/model/tools |

## Code reference

- `packages/cli/src/slash-commands/delegate.ts`
- `packages/core/src/coordination/dispatcher.ts` — `dispatchAgent`
- `packages/core/src/coordination/agents/` — agent catalog (44 roles, 9 phases)

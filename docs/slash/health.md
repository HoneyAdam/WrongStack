# /health — Health Check Runner

## What it does

Runs all registered health checks from `DefaultHealthRegistry` and reports their status. Requires `--metrics` flag at startup.

## Output format

```
● overall: healthy
  ● provider: healthy
  ● storage: healthy — /home/user/.wrongstack is writable
  ● session: degraded — 2 sessions open > 1h
```

Status icons: ● (green=healthy) ● (yellow=degraded) ● (red=unhealthy)

## Health checks registered by default

Checks are registered during boot. Typical checks include:
- Provider connectivity
- Storage writability
- Session count and age
- MCP server connectivity

## Code reference

- `packages/cli/src/slash-commands/health.ts`
- `packages/core/src/observability/health.ts` — `HealthRegistry`
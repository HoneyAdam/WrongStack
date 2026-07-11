# /health — Runtime readiness

Run the health checks registered by the current WrongStack host.

## Usage

```text
/health [--json]
```

Health collection is enabled with `--metrics` or `--metrics-port`:

```text
wstack --metrics
wstack --metrics-port 9090
```

The command reports the worst aggregate state and each registered check:

- `provider` — verifies that a provider and model are configured without
  exposing their identifiers.
- `session-store` — verifies read/write access to session storage.
- `project-storage` — verifies read/write access to project-scoped state.
- `mcp` — summarizes enabled server lifecycle states. Connected and dormant
  lazy servers are healthy; transitional states are degraded; failed servers
  are unhealthy.

Health details intentionally omit filesystem paths, MCP server names,
commands, URLs, and authentication configuration. When a metrics HTTP server
is enabled, the same registry is exposed at `/healthz`.

`/health --json` returns the aggregate status, timestamp, and checks as stable
JSON and attaches the same object as slash-command metadata. If collection is
disabled, it returns an explicit `enabled: false` payload instead of mixing a
human instruction into machine-readable output.

If health collection is disabled, `/health` explains that WrongStack must be
restarted with `--metrics`.

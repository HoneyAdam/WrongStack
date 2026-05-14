# Plugin Author Guide

How to write a WrongStack plugin: register tools, providers, slash
commands, pipeline middleware, and MCP servers. Tested end-to-end with
real plugin fixtures in `packages/core/tests/plugin/`.

---

## What a plugin is

A plugin is a default-exported `Plugin` object. The host calls
`setup(api)` during boot and `teardown(api)` on shutdown:

```ts
// my-plugin/index.ts
import type { Plugin } from '@wrongstack/core';

const plugin: Plugin = {
  name: 'my-plugin',
  version: '0.1.0',
  description: 'Adds a hello tool',
  apiVersion: '^0.1.0',      // semver range against KERNEL_API_VERSION
  capabilities: { tools: true },

  async setup(api) {
    api.tools.register({
      name: 'hello',
      description: 'Says hello to the user',
      inputSchema: { type: 'object', properties: { who: { type: 'string' } } },
      permission: 'auto',
      mutating: false,
      async execute(input) {
        return { greeting: `Hello, ${input.who ?? 'world'}!` };
      },
    });
  },

  async teardown() {
    // close handles, kill subprocesses, etc.
  },
};

export default plugin;
```

The host loads this from one of:

- `~/.wrongstack/plugins/<name>/` — user-global
- `<projectRoot>/.wrongstack/plugins/<name>/` — project-local
- A path listed in `Config.plugins[<name>].path`

---

## The `api` surface

`setup(api)` receives a scoped `PluginAPI`:

| Field | What it is |
|---|---|
| `api.container` | DI container — bind/resolve `TOKENS.*` |
| `api.pipelines` | All six core pipelines, plus any custom ones |
| `api.events` | `EventBus` for subscribing or emitting |
| `api.tools` | `register / unregister / get / list` tools |
| `api.providers` | Register provider factories |
| `api.mcp` | Start / stop / restart MCP servers |
| `api.slashCommands` | Register `/cmd` handlers |
| `api.config` | The loaded `Config` (read-only snapshot) |
| `api.log` | Scoped `Logger` — entries are tagged with `plugin=<name>` |
| `api.onEvent(name, h)` | Auto-removed-on-teardown event listener |

Use `onEvent` instead of `events.on(...)` when you want the listener to
disappear with the plugin. Use raw `events.on` only when you need to
explicitly unsubscribe yourself in `teardown`.

---

## Capabilities — declare what you touch

```ts
capabilities: {
  tools: true,
  providers: false,
  slashCommands: true,
  mcp: false,
  pipelines: ['request', 'toolCall'],
}
```

The loader uses this for diagnostics (`wstack plugins list` shows what
each plugin contributes) and for warning when a plugin calls
`api.tools.register()` without declaring `tools: true` (L0-D check).
Capabilities are advisory — they do not block at runtime — but lying is
loud and reviewers will catch it.

---

## Dependencies

```ts
dependsOn: [
  'wstack-auth',                              // string form
  { name: 'wstack-router', version: '^1.2' }, // structured form
],
optionalDeps: [{ name: 'wstack-cache', version: '^0.5' }],
conflictsWith: ['wstack-other-router'],
```

The loader topologically sorts plugins by `dependsOn`, rejects cycles
with a clear error, and surfaces version mismatches before calling
`setup`. Missing `optionalDeps` are silently skipped.

---

## Config schema

Plugin options come from `Config.plugins[<name>].options` (or
`Config.extensions[<name>]` after L0-E). Declare a `configSchema` and the
loader validates user input before calling `setup`:

```ts
configSchema: {
  type: 'object',
  properties: {
    endpoint: { type: 'string' },
    timeoutMs: { type: 'integer', minimum: 1, maximum: 60_000 },
  },
  required: ['endpoint'],
},
```

Reach validated options at runtime via `api.config.extensions[name]`. A
validation failure aborts plugin load with `error.path` pointing at the
offending field.

---

## Patterns by concern

### Register a tool

```ts
api.tools.register({
  name: 'greet',
  description: 'Greet someone',
  inputSchema: { type: 'object', properties: { name: { type: 'string' } } },
  permission: 'auto',
  mutating: false,
  async execute(input) {
    return { msg: `Hi, ${input.name}` };
  },
});
```

See [tool-author-guide.md](tool-author-guide.md) for the full Tool contract
(streaming, cleanup, permission semantics).

### Register a provider factory

```ts
api.providers.register({
  type: 'my-llm',
  family: 'openai-compatible',
  create: (cfg) => new MyProvider(cfg as MyProviderConfig),
});
```

See [provider-author-guide.md](provider-author-guide.md) for writing
`MyProvider` declaratively via `WireFormatConfig`.

### Add middleware to a pipeline

```ts
api.pipelines.request.use({
  name: 'inject-headers',
  owner: 'my-plugin',           // shown in /diag, used by host error policy
  handler: async (req, next) => {
    (req as { headers?: Record<string, string> }).headers = {
      ...(req as any).headers,
      'x-tenant': api.config.extensions?.['my-plugin']?.tenant ?? 'default',
    };
    return next(req);
  },
});
```

Throwing from a handler bubbles up unless the host installed a boundary
(`Pipeline.setErrorHandler`). The CLI installs a default boundary at boot
that surfaces the failure to `/diag` but doesn't crash the agent (L1-F).

### Subscribe to events

```ts
api.onEvent('tool.executed', (e) => {
  api.log.info(`${e.name} ran in ${e.durationMs}ms`);
});
```

The listener is removed when the plugin is unloaded. For long-lived
external state, do the cleanup in `teardown`.

### Register a slash command

```ts
api.slashCommands.register({
  name: 'tenant',
  description: 'Switch active tenant',
  async execute({ args, ctx }) {
    ctx.meta.tenant = args.join(' ') || 'default';
    return { message: `Tenant set to ${ctx.meta.tenant}` };
  },
});
```

### Start an MCP server

```ts
await api.mcp.start({
  name: 'my-mcp',
  transport: 'stdio',
  command: 'npx',
  args: ['-y', '@me/my-mcp-server'],
  enabled: true,
});
```

The registry handles reconnect-with-backoff and tools/list_changed
invalidation; you don't need to manage either yourself.

---

## Teardown contract

`teardown(api)` runs on:

- `SIGINT` from the user
- Natural process exit
- When the loader unloads the plugin individually (rare)

Inside it: stop intervals, kill subprocesses, close handles, flush
buffered writes. Errors thrown from `teardown` are logged but do not
prevent other plugins from tearing down. Make every cleanup
best-effort.

```ts
async teardown(api) {
  clearInterval(this.heartbeat);
  await this.subprocess?.kill();
  api.log.info('shut down cleanly');
},
```

For resources tied to a single agent run (not the whole plugin lifetime),
use `ctx.registerAbortHook` from inside `Tool.execute` instead. See the
JSDoc on [`Tool.cleanup`](../packages/core/src/types/tool.ts) for the rule.

---

## Testing your plugin

Plugins are plain TS modules with a default export. Test them by
constructing a real (or stub) `PluginAPI` and asserting the side
effects:

```ts
import { describe, it, expect, vi } from 'vitest';
import { Container, EventBus, ToolRegistry } from '@wrongstack/core';
import myPlugin from '../src/index.js';

describe('my-plugin', () => {
  it('registers the greet tool', async () => {
    const tools = new ToolRegistry();
    const api: any = {
      container: new Container(),
      events: new EventBus(),
      tools,
      log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
      config: {},
      onEvent: () => () => {},
      pipelines: {},
      providers: { register: vi.fn(), create: vi.fn(), list: () => [] },
      mcp: { start: vi.fn(), stop: vi.fn(), restart: vi.fn(), list: () => [] },
      slashCommands: { register: vi.fn(), unregister: vi.fn(), get: vi.fn(), list: () => [] },
    };

    await myPlugin.setup(api);
    expect(tools.get('greet')).toBeDefined();
  });
});
```

For richer integration tests, use the fixtures in
[`packages/core/tests/plugin/`](../packages/core/tests/plugin/) which
exercise the loader, capability warning, teardown, and dependency cycle
detection paths.

---

## Common pitfalls

- **`apiVersion` mismatch.** The loader compares your declared range against
  `KERNEL_API_VERSION`. Off-by-one bumps fail loud — fix the range.
- **Mutating `api.config`.** Treat it as a frozen snapshot. To react to
  config changes at runtime, subscribe via `api.container.resolve(TOKENS.ConfigStore).watch(...)`.
- **Forgetting `teardown` for sockets / timers.** The process won't exit cleanly.
- **Throwing from `setup`.** Aborts the entire CLI boot. If your plugin can't
  function with the current config, log and return early — don't throw.
- **Registering inside a pipeline handler.** Registries are not append-safe
  during iteration. Do registrations only in `setup`.

---

## Reference

- Plugin type: [`packages/core/src/types/plugin.ts`](../packages/core/src/types/plugin.ts)
- Loader: [`packages/core/src/plugin/loader.ts`](../packages/core/src/plugin/loader.ts)
- Test fixtures: [`packages/core/tests/plugin/`](../packages/core/tests/plugin/)

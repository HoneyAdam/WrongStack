# @wrongstack/runtime

Default runtime implementations and host composition types for WrongStack.

`@wrongstack/core` should stay focused on the agent kernel, public contracts,
registries, and lifecycle primitives. This package is the migration target for
concrete defaults such as storage, config, permissions, metrics, compaction,
models, skills, and host-level assembly helpers.

In the first refactor slice, runtime re-exports the existing default
implementations from `@wrongstack/core/defaults`. That lets CLI, TUI, WebUI,
and future hosts start importing defaults from `@wrongstack/runtime` while the
physical module moves happen incrementally.

```ts
import { DefaultSessionStore, DefaultPermissionPolicy } from '@wrongstack/runtime';
import { Agent, Container, EventBus } from '@wrongstack/core';
```

The `WrongStackPack` interface in `@wrongstack/runtime/pack` is the target shape
for extension packages that contribute tools, providers, slash commands, or
agent lifecycle extensions.

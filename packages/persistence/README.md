# `@wrongstack/persistence`

Dependency-free filesystem persistence primitives shared by WrongStack packages.

The package owns atomic replacement, parent-directory creation, cooperative file
locks, stale-lock recovery, watcher-assisted contention waits, bounded lock
timeouts, and transient Windows rename retries. It intentionally owns no domain
repository, serialization format, migration policy, or cloud synchronization.

```ts
import { atomicWrite, withFileLock } from '@wrongstack/persistence';

await withFileLock(file, async () => {
  await atomicWrite(file, JSON.stringify(value));
});
```

The default timeout error is `PersistenceFsError`. A host with an established
error hierarchy can call `createPersistencePrimitives` and inject only the
timeout-error factory. This keeps dependency direction toward the primitive
while preserving host compatibility contracts.

Core and Kanban retain thin adapters during migration. Their behavior is locked
to this package by one shared adversarial conformance suite.

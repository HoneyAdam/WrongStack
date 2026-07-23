# Super Memory ownership

`@wrongstack/super-memory` is the implementation owner for WrongStack memory
backends. Hosts depend on Core's `MemoryPort`; they do not construct or inspect a
concrete store.

## Supported composition

- `createSqliteMemoryPort(...)` is the production default.
- `LegacyMemoryPortAdapter` wraps third-party or historical `MemoryStore`
  implementations.
- Optional retrieval and administration features are obtained with
  `getSuperMemoryRetrieval(...)`, `getSuperMemoryService(...)`, or
  `getSuperMemorySurface(...)`.

The concrete `SqliteSuperMemoryStore` export remains for
source compatibility only. New production callers are prohibited by the Core
architecture test. Backend-specific signature conversion belongs in
`memory-port.ts`, never in a host.

## Internal boundaries

- `memory-port.ts`: host-facing lifecycle, adapters, and typed capabilities
- `jsonl.ts` and `sqlite-store.ts`: persistence and migration implementation
- `store-helpers.ts`: canonical validation, normalization, and index helpers
- `graph/`: graph storage and traversal
- `retrieval/`: ranking and rendering helpers
- `middleware/`: injection, turn, and tool-call policies
- `anchors/`, `embeddings/`, and `tools/`: focused feature adapters

Shared text normalization is owned by `store-helpers.ts`. Middleware may depend
on it directly; it must not import another middleware merely to reuse helpers.

## Verification

`tests/memory-port.test.ts` runs the same lifecycle and query contract against
SQLite, JSONL, and the legacy adapter. Consumer-boundary rules live in
`packages/core/tests/architecture/memory-port-boundary.test.ts`.

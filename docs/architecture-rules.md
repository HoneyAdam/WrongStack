# WrongStack Architecture Rules

> **Status**: Active — adopted 2026-05-20
> **Supersedes**: Nothing (new document)
> **Reason**: Previous plan to extract `@wrongstack/kernel` was abandoned after discovering `WrongStackError` (runtime class) is used everywhere in core, making extraction disproportionately expensive. This document captures the agreed-upon alternative: strict internal layering with automated enforcement.

---

## Decision: Layer Instead of Split

The original plan was to extract `packages/core/src/kernel/` as a standalone `@wrongstack/kernel` package. Analysis revealed that `kernel/container.ts` imports `WrongStackError` from `types/errors.js` — a **runtime** class used by virtually every module in core. Extracting kernel as a separate package would require either (a) duplicating `WrongStackError`, (b) making kernel depend on a minimal `core-types` package, or (c) accepting a complex dependency graph. All three options cost more than the benefit.

**Agreed approach**: Keep everything in `@wrongstack/core`, but enforce strict internal layering rules through automated tests. The layering is already correct architecturally — the existing exports map (`./kernel`, `./storage`, `./coordination`, etc.) proves the intent. The gap is enforcement.

---

## Layer Definitions

The following layers exist within `packages/core/src/`. Rules below govern what each layer may and may not depend on.

### Layer 1 — Primitives (lowest level)
- `kernel/` — Container, Pipeline, EventBus, RunController, TOKENS
- `types/` — Public contracts, error hierarchy, type aliases

### Layer 2 — Infrastructure
- `infrastructure/` — Logger, TokenCounter, PathResolver, ContextManager, MCPServers presets

### Layer 3 — Domain
- `core/` — Agent, Context, ConversationState, system prompt building, streaming response, input building, provider runner
- `models/` — ModelsRegistry, ModelSelector, ModeStore
- `security/` — PermissionPolicy, SecretVault, SecretScrubber, ConfigSecrets
- `registry/` — ToolRegistry, ProviderRegistry, SlashCommandRegistry

### Layer 4 — Execution
- `execution/` — ToolExecutor, RetryPolicy, Compactor, ErrorHandler, SkillLoader, AutonomousRunner

### Layer 5 — Storage
- `storage/` — SessionStore, ConfigStore, ConfigLoader, MemoryStore, PlanStore, TodosCheckpoint, QueueStore, RecoveryLock, AttachmentStore, SessionReader, SessionRewinder, SessionAnalyzer, PlanTemplates, ConfigMigration, DirectorState

### Layer 6 — Coordination
- `coordination/` — MultiAgentCoordinator, Director, FleetManager, FleetBus, AgentBridge, AgentSubagentRunner, SubagentBudget, Transport, DelegateTool, fleet state

### Layer 7 — High-level / UI-facing
- `plugin/` — PluginAPI, PluginLoader
- `extension/` — ExtensionRegistry
- `observability/` — Metrics, Tracer, Health, Prometheus, OTLP
- `sdd/` — SpecParser, TaskGenerator, TaskFlow, SpecBuilder
- `skills/` — SkillInstaller, ManifestStore, GitHubFetcher

---

## Dependency Rules

### Rule 1 — No downward imports within a layer
A higher layer must not directly import a lower layer's implementation (runtime values). Type-only imports (`import type`) from lower layers are allowed.

### Rule 2 — kernel/ is the base
`kernel/` may import type-only contracts from `types/`. It must not import runtime values from any other subdirectory.

**Current reality** (as of 2026-05-20):
- `kernel/container.ts` → imports `WrongStackError` from `../types/errors.js` — **runtime import** (violates Rule 2)
- `kernel/events.ts` → type-only imports from `../core/context.js` and `../types/` — **compliant**
- `kernel/tokens.ts` → type-only imports from `../types/` — **compliant**

The test will flag `kernel/container.ts`'s runtime import of `WrongStackError` as a violation. Given `WrongStackError` is the framework's base error type used everywhere, the correct fix is **not** to move it into `kernel/` (that would create a circular dependency for other subdirectories), but to accept that `container.ts`'s import is an intentional exception at the framework level. The rule is relaxed below.

**Relaxed Rule 2**: `kernel/` may import `WrongStackError` (and only `WrongStackError`) from `types/` as a runtime dependency. All other imports from higher layers must be type-only.

### Rule 3 — core/ (agent loop) may not reach into execution/storage/coordination
`core/agent.ts` and `core/context.ts` must not import runtime values from `execution/`, `storage/`, or `coordination/`. They may import from `kernel/`, `types/`, `infrastructure/`, `models/`, `security/`, `registry/`, `plugin/`, `extension/`, `observability/`, `sdd/`, and `skills/`.

### Rule 4 — observability/ may not reach into execution/storage/coordination
`observability/` may import from `kernel/` (types), `types/`, and `infrastructure/`. It must not import runtime values from `core/`, `execution/`, `storage/`, or `coordination/`.

### Rule 5 — security/ is a leaf at layer 3
`security/` must not import from `execution/`, `storage/`, `coordination/`, or any layer-4+ subdirectory. It may import from `kernel/`, `types/`, and `infrastructure/`.

### Rule 6 — registries are consumers, not providers
`registry/` may import from `kernel/`, `types/`, `security/`, `infrastructure/`, and `models/`. It must not import from `execution/`, `storage/`, or `coordination/`.

### Rule 7 — infrastructure/ is a thin integration layer
`infrastructure/` must not import runtime values from `core/`, `models/`, `security/`, `registry/`, `execution/`, `storage/`, `coordination/`, `plugin/`, `extension/`, `observability/`, `sdd/`, or `skills/`. It may import from `kernel/` and `types/`.

### Rule 8 — models/ must not reach execution/storage/coordination
`models/` (ModelsRegistry, ModelSelector, ModeStore) must not import runtime values from `execution/`, `storage/`, or `coordination/`.

### Rule 9 — extension/ must not reach execution/storage/coordination
`extension/` (ExtensionRegistry) must not import runtime values from `execution/`, `storage/`, or `coordination/`.

---

## Layer Diagram

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  LAYER 7  High-level / UI-facing                                         │
│  observability/  sdd/  skills/  plugin/  extension/                         │
│         ↑          ↑         ↑        ↑          ↑                          │
│         │          │         │        │          │                          │
│  ┌──────┴──────────┴─────────┴────────┴──────────┴──────────┐              │
│  │  LAYER 6  Coordination                                       │              │
│  │  coordination/                                                │              │
│  │         ↑                                                     │              │
│  │         │                                                     │              │
│  │  ┌──────┴────────────────────────────────────────────┐     │              │
│  │  │  LAYER 5  Storage                                     │     │              │
│  │  │  storage/                                               │     │              │
│  │  │         ↑                                               │     │              │
│  │  │         │                                               │     │              │
│  │  │  ┌──────┴────────────────────────────────────────┐   │     │              │
│  │  │  │  LAYER 4  Execution                             │   │     │              │
│  │  │  │  execution/  (ToolExecutor lives here)          │   │     │              │
│  │  │  │         ↑                                       │   │     │              │
│  │  │  │         │                                       │   │     │              │
│  │  │  │  ┌──────┴──────────────────────────────────┐   │   │     │              │
│  │  │  │  │  LAYER 3  Domain                          │   │   │     │              │
│  │  │  │  │  core/  models/  security/  registry/      │   │   │     │              │
│  │  │  │  │         ↑                                   │   │   │     │              │
│  │  │  │  │         │                                   │   │   │     │              │
│  │  │  │  │  ┌──────┴──────────────────────────────┐   │   │   │     │              │
│  │  │  │  │  │  LAYER 2  Infrastructure             │   │   │   │     │              │
│  │  │  │  │  │  infrastructure/                      │   │   │   │     │              │
│  │  │  │  │  │         ↑                             │   │   │   │     │              │
│  │  │  │  │  │         │                             │   │   │   │     │              │
│  │  │  │  │  │  ┌──────┴──────────────────────┐     │   │   │     │              │
│  │  │  │  │  │  │  LAYER 1  Primitives          │     │   │   │     │              │
│  │  │  │  │  │  │  kernel/  types/              │     │   │   │     │              │
│  └──│──│──│──│──│──└──────────────────────────────┘     │   │   │     │              │
│     │  │  │  │  └───────────────────────────────────────┘   │   │              │
│     │  │  │  └───────────────────────────────────────────────┘   │              │
│     │  │  └──────────────────────────────────────────────────────┘              │
│     │  └───────────────────────────────────────────────────────────────────┘              │
│     └──────────────────────────────────────────────────────────────────────────────────┘              │
│                                                                                             │
│  ARROW = runtime (non-type-only) import.  Type-only imports are allowed in any direction.  │
└─────────────────────────────────────────────────────────────────────────────────────────────────┘
```

**Rule of thumb**: arrows always point up (toward higher layers). A layer never imports a lower layer's runtime values.

---

## Test Coverage

The following rules are enforced automatically by `packages/core/tests/architecture/package-boundaries.test.ts`:

| Rule | What it checks |
|---|---|
| Cross-package | `@wrongstack/core` must not import higher-level packages (`@wrongstack/cli`, etc.) |
| kernel/ | Only imports `WrongStackError` as runtime value from `types/` |
| core/ | No runtime imports from `execution/`, `storage/`, or `coordination/` |
| observability/ | No runtime imports from `core/`, `execution/`, `storage/`, or `coordination/` |
| security/ | No runtime imports from `execution/`, `storage/`, or `coordination/` |
| registry/ | No runtime imports from `execution/`, `storage/`, or `coordination/` |
| infrastructure/ | No runtime imports from domain/execution/storage/coordination layers |
| models/ | No runtime imports from `execution/`, `storage/`, or `coordination/` |
| extension/ | No runtime imports from `execution/`, `storage/`, or `coordination/` |
| Bidirectional | No two non-barrel layers have mutual runtime dependencies |
| Cycle | No directed cycle exists in the runtime dependency graph |

As of 2026-05-20: **12 tests, all passing**.

---

## When to Revisit This Decision

Extract `@wrongstack/kernel` (or `@wrongstack/kernel-types`) as a separate package becomes the right move when:

1. `WrongStackError` is refactored into a minimal core error module that other packages can depend on without pulling in the full error hierarchy, OR
2. A concrete need emerges (e.g., external tooling that only needs the Container/Pipeline primitives without the full agent runtime)

Until then, the layering rules keep the internal structure clean without the overhead of physical package splits.

---

## Consistency with Package Exports

The `package.json` exports map already reflects the intended layering:

```json
{
  "./kernel":         { "types": "./dist/kernel/index.d.ts" },
  "./types":          { "types": "./dist/types/index.d.ts" },
  "./infrastructure": { "types": "./dist/infrastructure/index.d.ts" },
  "./storage":        { "types": "./dist/storage/index.d.ts" },
  "./security":       { "types": "./dist/security/index.d.ts" },
  "./coordination":   { "types": "./dist/coordination/index.d.ts" },
  "./observability":  { "types": "./dist/observability/index.d.ts" },
  ...
}
```

Every subpath export maps to one layer. External consumers (CLI, other packages) import what they need. The internal layering rules ensure that the physical source organization stays consistent with the declared public API surface.
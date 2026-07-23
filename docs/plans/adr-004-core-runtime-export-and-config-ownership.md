# ADR-004: Core, Runtime, Export, and Configuration Ownership

- **Status:** Accepted for R1
- **Date:** 2026-07-22
- **Scope:** Production packages and applications except `website/`
- **Decision owners:** Architecture refactor program (`R1`, followed by `R2–R8`)

## Context

`@wrongstack/core` currently exposes a broad compatibility barrel and 19 additional package export keys. Its `src/` tree contains 28 top-level domains spanning kernel contracts, coordination, concrete defaults, repositories, product plugins, host tools, and compatibility facades. `@wrongstack/runtime` contains useful concrete subsystems, but its root still re-exports Core defaults and infrastructure while depending on Core, SAGE, and Tools.

R1 must establish ownership before physical moves. Export removal is not driven by a target number: consumer evidence, replacement paths, compatibility windows, and package DAG direction are authoritative.

## Recorded evidence

The reproducible command below checks the committed evidence and fails on drift:

```text
node scripts/snapshot-core-public-api.mjs
```

Regenerate intentionally with `--write`. `pnpm check:architecture` runs the check form before the architecture scanner.

- [`architecture/core-public-api-snapshot.json`](../../architecture/core-public-api-snapshot.json) records package subpaths, source export declarations, and the ownership classification of all 28 Core source directories.
- [`architecture/core-public-api-usage.json`](../../architecture/core-public-api-usage.json) records every in-scope package specifier occurrence by file and distinguishes type-only from runtime/mixed use.

Baseline findings:

- 20 package export keys, including assets and `package.json`;
- 481 source export declarations across code-bearing public entries;
- 1,061 files mention the root `@wrongstack/core` specifier;
- 28 classified Core source directories;
- undeclared deep imports exist (`models`, `plugin`, `worktree`, and individual internal files), so removing root exports before adding declared replacements would increase unsupported coupling;
- `@wrongstack/core/types` still has runtime/mixed consumers, so it cannot yet be asserted as a pure type-only boundary.

## Decision 1: Public export policy

1. The root `@wrongstack/core` entry is a compatibility surface. New production code uses a declared, owned domain subpath.
2. A supported code subpath must exist in `packages/core/package.json#exports`, have one source entry, an owner classification, and a compatibility expectation.
3. Undeclared deep package imports are internal defects. A supported subpath is added before consumers migrate; deep imports are never legitimized silently.
4. `@wrongstack/core/types` may export only erased contracts. Runtime values currently reachable through it are migrated to owned implementation subpaths before the barrel is ratcheted type-only.
5. Wildcard exports are restricted to data/assets (`skills`, `design-kits`, `instructions`, and `data`); code receives explicit entries.
6. Root exports are retired only after repository usage reaches zero, external compatibility is evaluated, a deprecation release is published, and R8 records migration notes.
7. The committed usage snapshot, not an arbitrary export count, determines sequence and safety.

## Decision 2: Core directory ownership

The generated inventory uses these authoritative categories:

- `kernel primitive` and `agent-domain contract` remain in Core;
- `concrete runtime default` is eligible for a complete Runtime pilot;
- `storage/repository implementation` moves behind the R2 persistence primitive and domain repository ports;
- `coordination implementation` remains a focused Core subpath until its internal graph is one-way;
- `product feature` moves to its feature/plugin owner;
- `host/application concern` moves to a host or application service package;
- `compatibility-only` receives a removal gate and no new consumers.

Every new Core top-level directory must be added to the generator's ownership map. An unclassified directory makes the snapshot command fail.

## Decision 3: Configuration contract domains

The 1,800+ line aggregate `Config` remains a compatibility composition type while contracts move additively into these domains:

| Domain | Contract owner | Concrete defaults/loader owner |
|---|---|---|
| Agent loop, context, tools, autonomy, fleet, Brain | Core agent-domain subpaths | Runtime composition |
| Provider credentials, model runtime, model matrix | Providers-compatible neutral contracts | Providers + Runtime composition |
| Plugin manifests and extension configuration | Core plugin contract | `@wrongstack/plugins` implementation |
| Security/capabilities/exec danger | Core security contract | Runtime security defaults |
| Persistence, session logging, history, sync | Repository/persistence contracts | R2 primitive + repository adapters; sync is a plugin feature |
| Memory and indexing | `MemoryPort` plus capability/admin contracts | R3 adapters and `@wrongstack/sage` |
| MCP server/health | MCP-compatible neutral contract | MCP/host composition |
| TUI/HQ/launch menu/presentation | Surface/host contracts | owning UI or host package |
| Skills and prompt content | data/manifest contracts | plugin or skills implementation owner |

Rules:

- Core may retain the compatibility `Config` intersection and loader interface during migration, but it does not gain new concrete feature defaults.
- Defaults are constructed at the composition root; contract modules do not import loaders, filesystem adapters, UI state, or provider factories.
- Untrusted config decoding and migrations live with the concrete loader, not in a type barrel.
- A domain migration adds a canonical contract first, adapts `Config`, migrates consumers, and only then removes the compatibility field/export in R8.

## Decision 4: Runtime complete-vs-fold pilot

R4 will pilot the **metrics and health implementation subsystem** after R2 and R3 establish the low-level persistence and MemoryPort boundaries. The subsystem is bounded to metrics sinks, health checks, event-to-metric bridging, Prometheus rendering, and OTLP metrics export. Tracing and process/network instrumentation are separate consumers and must use injected contracts rather than reverse imports.

The pilot must record before/after:

- workspace edges and cycles;
- concrete implementation LOC remaining in Core;
- direct host imports and test fixture imports;
- Runtime root exports that are pure pass-through;
- number of consumers coupled to concrete classes;
- build output and package-contract results;
- compatibility surface and its scheduled removal.

### Pass branch

Continue to R6 only when the complete subsystem has one concrete authority, Core loses its implementation, no Runtime-to-Core-to-Runtime cycle appears, host composition becomes no more complex, concrete coupling decreases, and less than half of the pilot's Runtime surface is pass-through.

### Kill branch

Continue to R7 when any of these holds:

- a Core compatibility re-export would require `core → runtime → core`;
- more than 50% of the pilot surface is pass-through;
- host imports or test setup increase;
- a reverse workspace edge or new SCC appears;
- Core retains a second concrete implementation after migration;
- the complete subsystem cannot move without splitting ownership arbitrarily.

On the kill branch, contracts remain in Core or a neutral contracts package, while concrete features stay in focused packages. Runtime's useful independent features (`vision`, clipboard, local-model probe, and host composition) receive truthful owners/names instead of preserving a misleading umbrella facade.

## Compatibility and rollback

- R1 changes no runtime behavior or public export.
- Generated snapshots are evidence and ratchets, not release artifacts.
- Each later move retains the old contract until its migration gate is satisfied.
- A failed pilot rolls consumers back to the previous canonical implementation without data migration; the evidence remains and R7 removes the transitional claim.

## Consequences

- Export reduction becomes slower but measurable and safe.
- Config ownership can be migrated domain-by-domain without rewriting the aggregate type in one change.
- Runtime is required to prove concrete ownership; being a re-export convenience is explicitly insufficient.
- Deep imports and unclassified Core directories become visible drift rather than undocumented convention.

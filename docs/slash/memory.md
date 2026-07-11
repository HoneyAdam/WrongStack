# `/memory` — Structured Project Memory

`/memory` manages the configured `MemoryStore`. Super Memory is enabled by default and stores structured, revisioned project knowledge under the gitignored `.wrongstack/memories/` directory. Setting `superMemory.enabled: false` falls back to the legacy markdown store.

## Subcommands

| Usage | Effect |
|---|---|
| `/memory [show|list]` | Show active memory through the compatibility view |
| `/memory search <query>` | Search text, tags, paths, symbols, and command anchors |
| `/memory file <path>` | Show memory attached directly to a file |
| `/memory path <path>` | Include attached ancestor-directory memory |
| `/memory graph <id|path|query>` | Traverse memory/file/symbol/command relationships |
| `/memory remember <text>` | Store a project memory |
| `/memory forget <query> [--exact]` | Delete matching entries; exact mode guards broad deletion |
| `/memory verify [memory-id]` | Verify file, directory, symbol, content-hash, and git anchors |
| `/memory hygiene` | Deduplicate, supersede, stale, archive, and rebuild derived state |
| `/memory candidates [list|all]` | List session-consolidation candidates |
| `/memory candidates accept <id>` | Accept a pending candidate |
| `/memory candidates reject <id> [reason]` | Reject a pending candidate |
| `/memory audit` | Show recent mutation and automated-decision records |
| `/memory import-legacy` | Import legacy project/user `memory.md` files idempotently |
| `/memory stats` | Show status, kind, and graph-edge totals |
| `/memory compact` | Ask the active LLM to curate legacy-compatible project entries |
| `/memory clear` | Delete entries in all compatibility scopes |

## Automatic retrieval and hygiene

Relevant memory is injected into ordinary turn context and into read/tree/search/command/edit tool results. Cooldowns, score thresholds, and output caps prevent repeated hints. Write/edit/patch calls re-verify affected anchors; session shutdown runs hygiene unless disabled.

Rich read-only and maintenance tools are also registered: `memory_for_file`, `memory_for_path`, `memory_search`, `memory_graph`, `memory_verify`, `memory_hygiene`, and `memory_candidates`.

Configuration lives under `superMemory.storage`, `superMemory.inject`, and `superMemory.hygiene`; these are benign project-config fields. Providers, endpoints, and executable verification commands cannot be configured from in-project config.

## Storage

- Canonical revisions: `.wrongstack/memories/memories.jsonl`
- Candidates and audit: `candidates.jsonl`, `audit.jsonl`
- Graph: `graph/edges.jsonl`
- Rebuildable indexes: `indexes/*.json`
- Recovery snapshot: `snapshots/latest.json`
- Hygiene history: `hygiene/runs.jsonl`

Code: `packages/super-memory/`, `packages/cli/src/slash-commands/memory.ts`.

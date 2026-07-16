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
| `/memory audience list [--role <r>] [--task-type <t>] [--mode <m>]` | View role-scoped memories, optionally filtered by role/task/mode |
| `/memory audience remember --role <r> [--task-type <t>] [--mode <m>] <text>` | Store a memory targeted at specific agent types (at least one selector required) |
| `/memory audience search <query>` | Search scoped memories by partial text/role/mode match |
| `/memory audience transfer <from-role> <to-role>` | Bulk re-scope all memories from one role to another |
| `/memory audience clear <memory-id>` | Remove the audience scope from a memory (it becomes general project memory) |

## Audience-scoped memory

Memories can carry an optional **audience** selector (`roles`, `taskTypes`, `modes`) that targets them to specific agent types. When a subagent is spawned, the host queries `retrieveForAudience` with the agent's stable roster role and optional task-type/mode, then injects matching memories into the system prompt **before** the per-spawn override.

Selector semantics: **OR** within a dimension (a memory with `roles: ['reviewer', 'refactor-planner']` matches either), **AND** across dimensions (if both roles and taskTypes are set, both must match). Values are case-insensitive and trimmed.

Audience-scoped memories are **excluded** from ordinary `searchSuper` / `retrieveForPath` by default, so role-specific guidance never leaks into the leader's general turn/tool hints. Explicit search still finds them when `includeAudienceScoped` is set.

The leader's active mode is propagated to spawned subagents as `memoryContext.mode`, so a subagent spawned without its own mode setting inherits the leader's mode for audience matching.

The WebUI Memory view includes an **Audience-Scoped Memory** sidebar panel for browsing, filtering by role, creating, and clearing scope.

## Automatic retrieval and hygiene

Relevant memory is injected into ordinary turn context and into read/tree/search/command/edit tool results. Cooldowns, score thresholds, and output caps prevent repeated hints. Write/edit/patch calls re-verify affected anchors; session shutdown runs hygiene unless disabled.

CLI, TUI, WebUI, SimpleUI, and Desktop use the same Super Memory backend and injection rules. Relative tool paths are resolved from the active working directory before file/directory anchors are matched.

Rich read-only and maintenance tools are also registered: `memory_for_file`, `memory_for_path`, `memory_search`, `memory_graph`, `memory_verify`, `memory_hygiene`, and `memory_candidates`.

Configuration lives under `superMemory.storage`, `superMemory.inject`, and `superMemory.hygiene`; these are benign project-config fields. Providers, endpoints, and executable verification commands cannot be configured from in-project config.

## Storage

- Canonical revisions: `.wrongstack/memories/memories.jsonl`
- Candidates and audit: `candidates.jsonl`, `audit.jsonl`
- Graph: `graph/edges.jsonl`
- Rebuildable indexes: `indexes/*.json`
- Recovery snapshot: `snapshots/latest.json`
- Hygiene history: `hygiene/runs.jsonl`

Writes are deduplicated and metadata-merged before append. A project-wide mutation lock keeps concurrent surfaces from creating competing revisions, while readers refresh their cache when another process appends to the canonical log. Graph nodes connect memories to symbols, files, parent directories, sessions, tools, and source records.

Code: `packages/super-memory/`, `packages/cli/src/slash-commands/memory.ts`.

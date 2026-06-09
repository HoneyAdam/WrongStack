# WrongStack — Ideas & Improvement Report

**Generated:** 2026-06-09
**Baseline version:** 0.148.2
**Scope:** Full monorepo — 14 packages, ~110K SLOC source, 3091+ tests
**Sources:** Architecture docs, changelog, prior audits (May–June 2026), security reports, codebase scans, TODO/FIXME inventory

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [New Feature Ideas](#2-new-feature-ideas)
3. [Improvements to Existing Features](#3-improvements-to-existing-features)
4. [Architecture & Code Quality](#4-architecture--code-quality)
5. [Developer Experience](#5-developer-experience)
6. [Testing & Quality Assurance](#6-testing--quality-assurance)
7. [Security & Hardening](#7-security--hardening)
8. [Documentation & Community](#8-documentation--community)
9. [Quick-Win Checklist](#9-quick-win-checklist)
10. [Prioritization Matrix](#10-priorization-matrix)

---

## 1. Executive Summary

WrongStack is a mature, well-architected AI coding agent platform with:
- **14 packages** in a pnpm monorepo with strict layering
- **3,091+ tests** across all packages
- **0 open security vulnerabilities** (all 15 prior findings resolved)
- **47 agent roles** in the fleet roster
- **17 bundled skills** and **45+ slash commands**
- **4 execution surfaces**: CLI REPL, TUI (Ink/React), WebUI (Vite/React), ACP (editor integration)

The codebase is in excellent health. The items below are opportunities for growth, not remediation of problems. They're organized as **new feature ideas** (things that don't exist yet) and **improvements** (things that exist but could be better).

---

## 2. New Feature Ideas

### N-1: Agent Replay & Time-Travel Debugging

**What:** A `wstack replay <session-id>` command that reconstructs a past session step-by-step, allowing the user to step forward/backward through iterations, inspect the agent's state at each point, and even branch off from a historical decision point.

**Why:** Session JSONL files already capture every event. The `SessionReader` and `ReplayProviderRunner` exist in core. This would turn passive session logs into an interactive debugging experience — users could ask "why did the agent choose X at iteration 12?" and get a concrete answer.

**Building blocks that exist:**
- `packages/core/src/replay/` — replay-provider-runner and hash-based session lookup
- `packages/core/src/storage/session-reader.ts` — structured event replay
- `packages/core/src/storage/session-rewinder.ts` — snapshot-based state rewind
- `SessionEvent` JSONL format — full event-level audit trail

**Estimated effort:** 5–7 days for a working CLI/TUI replay mode.

---

### N-2: Collaborative Sessions (Multi-User)

**What:** Allow multiple users to connect to the same WrongStack session simultaneously via the WebUI, with real-time awareness of each other's actions (like Google Docs for coding agents).

**Why:** Teams frequently need to pair-program with AI assistance. Currently only one user drives the REPL at a time. The WebUI already has WebSocket infrastructure, auth tokens, and event streaming.

**Building blocks that exist:**
- WebUI WebSocket backend with typed message routing
- `EventBus` pub/sub with ~50 event types
- Per-session state isolation
- Cookie-based auth with `HttpOnly; SameSite=Strict`

**What's needed:**
- User identity layer (display names, cursor positions)
- Conflict resolution for simultaneous edits
- Operational transform or CRDT for shared state
- Permission scoping (who can approve tool calls)

**Estimated effort:** 10–15 days for MVP (2 users, same session).

---

### N-3: Agent Skill Marketplace / Registry

**What:** A public registry where community members can publish WrongStack skills (SKILL.md files), similar to npm but for AI agent behaviors. Users would `wstack skill install @user/skill-name` to pull skills from GitHub repos.

**Why:** The skill system (`packages/core/skills/`) already supports three scopes (project, user-global, bundled). Skills are just Markdown + YAML frontmatter — lightweight and easy to create. A marketplace would grow the ecosystem.

**Building blocks that exist:**
- `DefaultSkillLoader` with priority-based loading
- `SkillInstaller`, `ManifestStore`, `GitHubFetcher` in core
- `/skill-install`, `/skill-update`, `/skill-uninstall` slash commands
- `/skill-gen` for LLM-guided skill authoring

**What's needed:**
- A curated index (JSON manifest on a static site or GitHub repo)
- Quality scoring (test coverage, downloads, reviews)
- Skill validation CI pipeline
- Skill template generator (already scaffolded in `skill-creator`)

**Estimated effort:** 5–7 days for a GitHub-backed MVP (index repo + install from URL).

---

### N-4: Context-Aware Auto-Compaction Preview

**What:** Before the compactor runs, show the user a preview of what will be kept vs. collapsed, and let them pin specific exchanges as "do not compact." A `/compact preview` command that renders the compaction plan before executing it.

**Why:** Compaction is currently invisible. Users sometimes lose important context without understanding why. A preview mode would build trust and give users control.

**Building blocks that exist:**
- Three compaction strategies: `hybrid` (lossless), `intelligent` (LLM), `selective` (LLM keep/collapse)
- `AutoCompactionMiddleware` fires automatically on token thresholds
- Session events record compaction decisions

**What's needed:**
- A "compaction plan" output format (what's kept, what's summarized, what's dropped)
- Pinning mechanism (per-message flag or annotation)
- TUI/WebUI rendering of the compaction plan

**Estimated effort:** 3–5 days.

---

### N-5: Semantic Code Search via Embeddings

**What:** Augment the existing codebase index (`codebase-index`, `codebase-search`) with vector embeddings for semantic search. Instead of BM25 keyword matching, users could search for "where does authentication happen" and get relevant results even if the code says `verifyIdentity`.

**Why:** BM25 is fast but keyword-limited. Semantic search would dramatically improve codebase understanding for large or unfamiliar codebases.

**Building blocks that exist:**
- SQLite-based symbol index in `packages/tools/src/codebase-index/`
- `codebase-search` tool with BM25 ranking
- `codebase-stats` for index health monitoring
- Provider infrastructure (could use OpenAI embeddings or local model)

**What's needed:**
- Embedding generation pipeline (batch on index, incremental on change)
- Vector storage layer (SQLite with vector extension, or separate store)
- Hybrid search (BM25 + embedding similarity fusion)
- Configurable embedding provider

**Estimated effort:** 7–10 days for a working prototype.

---

### N-6: Goal Progress Dashboard (TUI & WebUI)

**What:** A rich, persistent dashboard that tracks autonomous goal progress over time — showing phase completion, task graphs, cost trends, and iteration velocity. The F9 goal panel in the TUI is a start; this would be a full-screen experience.

**Why:** Autonomous mode (`/goal`, `/autonomy`, `/autophase`) runs for hours. Users need visibility into what's happening without scrolling through thousands of lines of chat history.

**Building blocks that exist:**
- Goal store (`~/.wrongstack/projects/<hash>/goal.json`)
- AutoPhase planner with phase dependencies and checkpoints
- FleetBus for real-time subagent events
- Prometheus metrics and OTLP traces

**What's needed:**
- Phase graph visualization (could use Mermaid rendering)
- Cost/velocity trend charts (WebUI with chart library)
- Goal history and comparison across sessions
- Export goal report (markdown, HTML)

**Estimated effort:** 5–7 days for TUI full-screen + WebUI dashboard tab.

---

### N-7: Built-in Benchmarking Suite

**What:** A `wstack bench` command that runs a standardized set of coding tasks against the current model configuration and reports quality metrics (edit accuracy, test pass rate, task completion time, token efficiency).

**Why:** Users currently have no objective way to compare models or configurations. "Is GPT-5 better than Claude 4 for refactoring?" is an empirical question.

**Building blocks that exist:**
- `vitest.bench.config.ts` — benchmark infrastructure already configured
- Session JSONL event logs — full execution traces
- Cost tracking per session
- `SessionAnalyzer` for extracting metrics from sessions

**What's needed:**
- Standardized task definitions (10–20 coding tasks of varying difficulty)
- Scoring rubric (correctness, speed, cost, context efficiency)
- Baseline scores for popular models
- CI integration for regression testing model performance

**Estimated effort:** 7–10 days for a working suite with 10 tasks.

---

### N-8: Plugin Hot-Reload

**What:** When a plugin's source files change on disk, automatically reload the plugin without restarting WrongStack. Combined with `--watch` mode for plugin development.

**Why:** Plugin development currently requires restarting WrongStack on every change. This creates a slow feedback loop, especially for complex plugins.

**Building blocks that exist:**
- `file-watcher` plugin in `@wrongstack/plugins` — already watches files
- Plugin loader with `teardown()` lifecycle — clean unloading
- `loadPlugins` / `unloadPlugins` in core

**What's needed:**
- File watcher on plugin directories
- Debounced reload trigger
- State migration between plugin versions
- Error boundary (failed reload shouldn't crash the session)

**Estimated effort:** 3–4 days.

---

### N-9: Smart Context Budgeting

**What:** Instead of a single context-window compaction threshold, allocate a "context budget" per category (tools, conversation, memory, system prompt) and dynamically adjust allocations based on task phase. E.g., during planning, give more budget to conversation; during execution, give more to tool output.

**Why:** Current compaction is reactive (fire when threshold crossed). Proactive budget management would use the context window more efficiently and reduce information loss.

**Building blocks that exist:**
- `HybridCompactor` with lossless and lossy strategies
- Context modes (`balanced`, `frugal`, `deep`, `archival`)
- AutoPhase system with phase awareness
- Token estimation per message

**What's needed:**
- Budget allocator with configurable category weights
- Phase-aware budget profiles (planning vs. execution vs. review)
- Telemetry on budget utilization per category
- User-facing budget visualization

**Estimated effort:** 5–7 days for a working allocator.

---

### N-10: WrongStack as an MCP Server (Enhanced)

**What:** Expand the existing `wstack mcp serve` mode to expose not just tools but also the full agent lifecycle (session creation, multi-turn conversations, fleet management) as MCP resources and prompts. This would let any MCP-compatible editor (VS Code, Zed, Cursor) use WrongStack as a first-class coding agent backend.

**Why:** The MCP server mode currently exposes tools in read-only mode. Full agent lifecycle exposure would make WrongStack a drop-in backend for any MCP-compatible tool.

**Building blocks that exist:**
- `MCPServer` + `serveStdio` in `packages/mcp/src/server.ts`
- Tool registry with namespace prefixes
- Permission policy with read-only and YOLO modes

**What's needed:**
- MCP resources for session state, memory, plans
- MCP prompts for common workflows (refactor, debug, review)
- Streaming support via MCP transport
- Configuration for which tools/resources to expose

**Estimated effort:** 5–7 days for a working enhanced server.

---

## 3. Improvements to Existing Features

### E-1: Complete the 7 Unimplemented Slash Commands

**What:** The docs reference 7 slash commands (`/git`, `/health`, `/metrics`, `/plan`, `/security`, `/skill-gen`, `/skills`) with `docs/slash/*.md` files but no `buildXxxCommand` registered. Implement or remove the orphan docs.

**Why:** Orphan documentation creates confusion. Users try commands that don't work. The AGENTS.md explicitly calls this out as "H13 in the 2026-06-03 audit."

**Status:** Some are partially implemented as plugin commands (`/metrics`, `/health`, `/security`, `/skill-gen`, `/plan`) but not registered as core slash commands.

**Fix:**
1. Audit which commands exist as plugin commands vs. core commands
2. Update `docs/slash/README.md` to reflect actual registration status
3. Remove docs for commands that won't be implemented
4. Register remaining commands

**Estimated effort:** 1–2 days.

---

### E-2: WebUI Test Coverage (Currently 0%)

**What:** The `@wrongstack/webui` package has **0% test coverage**. The server handles WebSocket routing, API endpoints, file serving, authentication, and SSE streaming — all untested.

**Why:** The WebUI server is ~2,000 lines of HTTP/WS handling. Any refactoring is high-risk without tests. The planned file splits in the refactoring roadmap make tests a prerequisite.

**Fix:** Start with API endpoint tests:
1. Config API (get/set/providers)
2. Session API (list/get/resume/delete)
3. Auth flow (token generation, cookie, validation)
4. SSE streaming
5. File serving (path traversal guards, Range header)

**Estimated effort:** 5–7 days to reach 50% coverage.

---

### E-3: CLI Test Coverage (Currently 21%)

**What:** `@wrongstack/cli` is at 21% coverage despite being the main entry point. Critical paths like boot, wiring, subcommand dispatch, and REPL are undertested.

**Why:** The CLI is the most user-facing package. Regressions here directly impact users.

**Fix:** Prioritize:
1. Boot flow (argument parsing, config loading)
2. Subcommand dispatch (all 15+ subcommands)
3. REPL lifecycle (start, command, exit)
4. Error recovery paths
5. Session creation/resume

**Estimated effort:** 5–7 days to reach 50% coverage.

---

### E-4: Resolve the `expectDefined` Duplication (80 Copies)

**What:** The helper `expectDefined<T>()` is defined locally in **80 files** across 11 packages, despite a canonical implementation at `packages/core/src/utils/expect-defined.ts`.

**Why:** Every copy is a maintenance hazard. If the error message or behavior changes, 80 files need updating.

**Fix:**
1. Replace all local definitions with `import { expectDefined } from '@wrongstack/core'`
2. Add an explicit re-export in the core barrel
3. Add a unit test for the canonical implementation
4. Add an optional `label` parameter for better error messages
5. Add an ESLint/Biome rule to prevent local re-definitions

**Estimated effort:** 1–2 days (mostly automated).

---

### E-5: Translate Turkish Comments in Autophase Package

**What:** 8 files in `packages/core/src/autophase/` contain 146+ Turkish-language comments mixed with English.

**Why:** WrongStack is an international open-source project. Mixed-language comments create barriers for non-Turkish-speaking contributors.

**Fix:** Translate all Turkish comments to English. Can be done mechanically with AI assistance.

**Estimated effort:** 0.5–1 day.

---

### E-6: Complete the ACP Agent Implementation

**What:** The ACP agent (`packages/acp/src/agent/wrongstack-acp-agent.ts`) has a stubbed `/* TODO: load WrongStack Context */ {}`. The integration with editors (Zed, JetBrains, VS Code) is incomplete.

**Why:** ACP is the pathway to first-class editor integration. The protocol handler and transport layer exist but the agent itself isn't functional.

**Fix:**
1. Implement the WrongStack Context loading
2. Wire the ACP agent to the core Agent/Context/ToolExecutor pipeline
3. Test with at least one editor (VS Code via ACP extension)
4. Document the setup process

**Estimated effort:** 3–5 days.

---

### E-7: Enhanced Director Dashboard (WebUI)

**What:** The WebUI currently has no dedicated fleet/director visualization. The TUI has Ctrl+F (fleet monitor) and Ctrl+G (agents monitor). The WebUI needs equivalent functionality.

**Why:** Director mode is a flagship feature. Users running multi-agent workflows need real-time visibility into subagent status, task progress, budget usage, and fleet events.

**Building blocks that exist:**
- FleetBus event streaming (subagent events over WebSocket)
- Fleet store in `packages/webui/src/stores/`
- TUI fleet-monitor and fleet-panel as design references

**What's needed:**
- Fleet dashboard component (status table, health indicators, usage charts)
- Real-time event timeline
- Per-subagent detail view with transcript access
- Budget pressure visualization

**Estimated effort:** 5–7 days.

---

### E-8: Better Error Messages for Tool Failures

**What:** Tool execution errors are sometimes cryptic. The `EDITING.md` doc exists specifically because the `edit` tool fails silently with "arguments that were not a valid JSON object" — the real issue is payload size/encoding limits in streaming.

**Why:** Poor error messages waste user and agent time. The agent retries with the same approach, burning tokens.

**Fix:**
1. Add actionable error messages for common failure modes:
   - Edit tool: "Content too large for edit. Use `write` instead for files >2KB."
   - Bash tool: "Command timed out after Xs. Use AbortSignal.timeout() for longer commands."
   - Read tool: "File not found: <path>. Did you mean <suggestion>?"
2. Include recovery suggestions in tool error responses
3. Make the error messages model-actionable (the LLM should know what to do differently)

**Estimated effort:** 2–3 days.

---

### E-9: Smarter Tool Execution Strategy

**What:** The `ToolExecutor` has three strategies: `parallel`, `sequential`, and `smart`. The "smart" strategy currently distinguishes mutating vs. non-mutating. It could be enhanced with:
- Dependency awareness (tool B needs tool A's output)
- Resource awareness (don't run 10 file reads simultaneously if the OS limits FDs)
- Priority ordering (urgent tools first)

**Why:** Smarter tool batching would reduce iteration count and improve reliability on resource-constrained systems.

**Estimated effort:** 3–5 days for dependency awareness.

---

### E-10: Session Export to More Formats

**What:** Currently supports markdown, JSON, and text export. Add:
- HTML export with syntax highlighting
- PDF export (via headless browser or library)
- JUnit XML (for CI integration of test-related sessions)
- ChatGPT conversation format (for sharing with other AI tools)

**Why:** Users want to share sessions in different contexts — in PRs, in documentation, with other AI tools, or as permanent records.

**Estimated effort:** 2–3 days per format.

---

## 4. Architecture & Code Quality

### A-1: File Size Decomposition (14 Files >1000 Lines)

**What:** The refactoring plan identifies 14 files over 1,000 lines, with the largest (`tui/src/app.tsx`) at 6,408 lines. The plan in `docs/notes/refactor-2026-06-05.md` is comprehensive but not yet executed.

**Priority files:**
| File | Lines | Risk |
|------|-------|------|
| `tui/src/app.tsx` | 6,408 | High |
| `webui/src/server/index.ts` | 1,961 | Medium-High |
| `cli/src/slash-commands/sdd.ts` | 1,809 | Medium |
| `cli/src/index.ts` | 1,786 | High |
| `core/src/coordination/director.ts` | 1,743 | Medium |
| `tui/src/components/history.tsx` | 1,632 | Medium |

**Why:** Large files are hard to review, test, and maintain. They also make merge conflicts more likely in team environments.

**Recommended approach:** Follow the phased plan in the refactoring doc. Phase 1 (Big Three) is highest priority.

**Estimated effort:** 11–13 days total (as estimated in the existing plan).

---

### A-2: Typed Plugin Config Accessor

**What:** Plugins currently access their config through unsafe casts like `(api.config.extensions?.['cost-tracker'] as Record<string, unknown>)?.['budgetLimit'] as number`. Add a typed accessor to the PluginAPI.

**Why:** The plugin already declares `configSchema` and `defaultConfig`. The API should expose typed config without requiring `as` casts that bypass type checking.

**Fix:**
```typescript
// Add to PluginAPI
getPluginConfig<T extends PluginConfig>(): T;
```

**Estimated effort:** 1–2 days.

---

### A-3: Event Map Consistency Check

**What:** The EventBus has ~50 typed events. The `cost-tracker` plugin uses `'session.close' as any` because the event doesn't exist in the typed map. Add a build-time or test-time check that all event names used in `api.onEvent()` calls exist in `EventMap`.

**Why:** `as any` event subscriptions bypass the type system and silently break when event names change.

**Fix:**
1. Add `'session.close'` to EventMap if it's legitimate, or use `session.ended`
2. Add a lint rule or test that greps for `as any` in event subscriptions

**Estimated effort:** 0.5–1 day.

---

### A-4: Remove `as any` from Source Code

**What:** The codebase analysis report says "zero `as any` in core source" but the cost-tracker plugin and some provider code still use it. Audit and eliminate remaining instances.

**Why:** The project's TypeScript strict mode policy explicitly forbids `as any`.

**Estimated effort:** 1–2 days.

---

### A-5: Architecture Boundary Test Coverage

**What:** 12 boundary tests exist in `packages/core/tests/architecture/package-boundaries.test.ts`. Consider adding:
- Cross-package import checks for ALL packages (not just core)
- Runtime dependency cycle detection across the full monorepo
- Barrel export completeness checks

**Why:** The current tests only cover `@wrongstack/core`'s internal layering. Other packages could develop circular dependencies.

**Estimated effort:** 1–2 days.

---

## 5. Developer Experience

### D-1: `wstack doctor` Command

**What:** A comprehensive health check command that validates:
- Configuration validity and completeness
- API key presence and validity (test call)
- MCP server connectivity
- Plugin compatibility with current kernel version
- File system permissions
- PATH availability (pnpm, node, git)
- Session storage health (corrupted JSONL files)

**Why:** Users currently troubleshoot by reading error messages and searching docs. A single diagnostic command would solve most "it doesn't work" problems.

**Building blocks that exist:**
- `wstack diag-doctor` subcommand (partially)
- Config validation
- MCP server health checks
- Health registry

**Estimated effort:** 2–3 days to make comprehensive.

---

### D-2: Interactive Onboarding Wizard

**What:** A `wstack init` command that guides new users through:
1. API key setup (provider selection, key entry)
2. Model selection (with cost/quality trade-offs explained)
3. Project configuration (AGENTS.md, skills, hooks)
4. MCP server setup (recommended servers for project type)
5. Permission mode selection (conservative, normal, YOLO)

**Why:** WrongStack has a lot of configuration surface area. New users are overwhelmed. A wizard would reduce time-to-first-success.

**Estimated effort:** 3–5 days.

---

### D-3: Better Windows Support

**What:** The test run failed with `'C:\\Program' is not recognized as an internal or external command` — a classic Windows PATH space issue. Audit and fix Windows-specific issues:
- PATH handling with spaces
- Shell command escaping (cmd.exe vs. PowerShell vs. bash)
- File path normalization
- Terminal color support
- Process signal handling (SIGINT, SIGTERM)

**Why:** Windows is a first-class platform but some tools and scripts assume Unix.

**Estimated effort:** 2–3 days for a thorough audit and fix pass.

---

### D-4: VS Code Extension

**What:** A VS Code extension that integrates WrongStack as an ACP agent, providing:
- Inline code suggestions from the agent
- Chat panel in the sidebar
- Tool call approval UI
- Session management

**Why:** Many developers prefer staying in their editor. The ACP infrastructure provides the protocol; the extension provides the surface.

**Estimated effort:** 10–15 days for a working extension.

---

### D-5: Configuration Migration Tooling

**What:** When breaking config changes happen, provide automatic migration:
- Detect old config format version
- Apply migration scripts
- Back up old config
- Report what changed

**Why:** Config format changes between versions can break existing setups silently.

**Building blocks that exist:**
- `ConfigMigration` in `packages/core/src/storage/`
- Config history with backup/restore

**Estimated effort:** 2–3 days.

---

## 6. Testing & Quality Assurance

### T-1: Integration Test Suite

**What:** A suite of end-to-end integration tests that exercise full workflows:
- Start agent → send prompt → receive response → verify file changes
- Multi-agent workflow: spawn → assign → await → verify results
- MCP server lifecycle: start → use tools → stop
- WebUI: start → connect WS → send message → verify response

**Why:** Unit tests verify individual components but not that they work together. The complex wiring in `packages/cli/src/index.ts` has minimal integration coverage.

**Estimated effort:** 7–10 days for a working CI-integrated suite.

---

### T-2: Property-Based Testing for Core Primitives

**What:** Add property-based tests (using `fast-check` or similar) for:
- Container DI: bind, resolve, override, decorate with arbitrary factories
- Pipeline: middleware ordering with arbitrary middleware counts
- EventBus: event delivery with arbitrary subscriber counts
- SessionWriter: JSONL serialization roundtrip with arbitrary events

**Why:** The kernel primitives are foundational. Property-based testing can find edge cases that hand-written tests miss.

**Estimated effort:** 3–5 days.

---

### T-3: Mutation Testing

**What:** Run a mutation testing tool (Stryker) on critical packages to measure test effectiveness.

**Why:** 3,091 tests sounds like a lot, but how many actually catch bugs? Mutation testing would reveal gaps.

**Estimated effort:** 2–3 days to set up and analyze results.

---

### T-4: Performance Regression Benchmarks

**What:** Establish performance baselines for:
- Agent iteration latency (prompt → response)
- Tool execution latency (per tool type)
- Compaction time vs. context size
- Session startup time
- Memory usage during long sessions

**Why:** WrongStack runs for hours. Performance regressions compound over time. Without baselines, regressions go undetected.

**Estimated effort:** 3–4 days to establish baselines.

---

## 7. Security & Hardening

### S-1: Complete Capability-Based Authorization Migration

**What:** The capability model is partially implemented. Complete migration by:
1. Adding capabilities to ALL remaining tools (long tail)
2. Making `DefaultPermissionPolicy` fully capability-aware
3. Adding capability enforcement for plugin tool mutations
4. Documenting capabilities in tool-author-guide

**Why:** The security hardening plan (P1) identified this as the primary architectural improvement. Name-based denylists are fragile; capabilities are auditable.

**Status:** Core tools done. Long tail + policy integration remaining.

**Estimated effort:** 3–5 days.

---

### S-2: Secret Rotation Helpers

**What:** Add a `wstack auth rotate` command that:
1. Generates a new encryption key
2. Re-encrypts all secrets in config with the new key
3. Verifies the new key works
4. Backs up the old key

**Why:** The current encryption key is per-machine and never rotated. If compromised, there's no recovery path.

**Estimated effort:** 1–2 days.

---

### S-3: MCP Server Sandboxing

**What:** Add sandboxing options for MCP servers:
- Filesystem access restrictions (only project directory)
- Network restrictions (block outbound except to specific hosts)
- Process spawning restrictions
- Resource limits (memory, CPU, time)

**Why:** MCP servers run arbitrary code. A compromised or misbehaving server could access files outside the project, make network calls, or consume resources.

**Estimated effort:** 5–7 days for a working sandbox (using OS-level mechanisms).

---

### S-4: Audit Log Integrity

**What:** Add tamper detection for session JSONL files:
- Hash chain (each event includes a hash of the previous event)
- Signed session footer on session close
- Verification tool (`wstack audit verify <session-id>`)

**Why:** Session logs are the audit trail for everything WrongStack does. If logs can be tampered with, the audit trail is unreliable.

**Estimated effort:** 2–3 days.

---

## 8. Documentation & Community

### C-1: Interactive API Documentation

**What:** Generate API documentation from TypeScript types using TypeDoc or similar. Host at `docs.wrongstack.dev/api`.

**Why:** Plugin and tool authors need to understand the public API surface. Currently they must read source code.

**Estimated effort:** 2–3 days for initial generation + CI integration.

---

### C-2: Architecture Decision Records (ADR) Expansion

**What:** The `docs/adr/` directory has only 1 ADR (layer-instead-of-split). Key decisions that should be documented:
- Why ULIDs instead of UUIDs
- Why JSONL for session storage
- Why 7-layer architecture in core
- Why capability-based authorization
- Why Cookie-based WS auth
- Why the skill Markdown format

**Why:** ADRs help new contributors understand the "why" behind architectural choices, preventing well-intentioned changes that violate established patterns.

**Estimated effort:** 1–2 days.

---

### C-3: Contributing Guide

**What:** A comprehensive `CONTRIBUTING.md` covering:
- Development setup (prerequisites, build, test, lint)
- Code style and conventions
- PR process (branching, review, merge)
- Security checklist for new tools/plugins/MCP
- How to add slash commands, tools, providers, plugins, skills
- Architecture overview with diagrams

**Why:** The project has excellent technical docs but no single onboarding document for contributors.

**Estimated effort:** 2–3 days.

---

### C-4: Video/Interactive Tutorials

**What:** Create guided tutorials for common workflows:
- "Your first WrongStack session"
- "Building a custom plugin"
- "Multi-agent debugging with /collab"
- "Spec-driven development with /sdd"
- "Autonomous mode with /goal"

**Why:** Text docs are great for reference. Tutorials are better for learning. The marketing site (`website/`) is the natural host.

**Estimated effort:** 3–5 days per tutorial.

---

### C-5: Changelog Automation

**What:** Automate changelog generation from conventional commits. Currently the changelog is hand-written (see the "consolidated release" notes in v0.148.0).

**Why:** The changelog is excellent but manually intensive. Automation would ensure no changes are missed.

**Building blocks that exist:**
- `semver_bump` and `semver_changelog` plugins in `@wrongstack/plugins`
- Conventional commit format used in practice
- Git integration

**Estimated effort:** 1–2 days to wire into release process.

---

## 9. Quick-Win Checklist

These items can be completed in **1 day or less** each:

| # | Item | Impact |
|---|------|--------|
| 1 | Translate Turkish comments in autophase (8 files) | Code quality |
| 2 | Add `'session.close'` to EventMap or remove `as any` workaround | Type safety |
| 3 | Set `mutating: true` on `cost_reset` tool | Permission correctness |
| 4 | Add explicit re-export of `expectDefined` in core barrel | Discoverability |
| 5 | Add unit test for canonical `expectDefined` | Test coverage |
| 6 | Remove orphan docs for unimplemented slash commands (or implement them) | Doc accuracy |
| 7 | Add ADRs for 5 key architectural decisions | Documentation |
| 8 | Add `wstack audit verify` for session JSONL hash checking | Security |
| 9 | Add security comment to `pnpm-workspace.yaml` explaining allowlists | Process |
| 10 | Fix Windows PATH space issue in test execution | Windows support |

---

## 10. Prioritization Matrix

### Impact vs. Effort

```
                    HIGH IMPACT
                        │
           E-2 WebUI   │  N-2 Collab
           Tests (0%)   │  Sessions
           E-3 CLI      │
           Tests (21%)  │
                        │
   E-4 expectDefined ───┼─── E-7 Director
   E-5 Turkish comments │    Dashboard
   A-3 Event map fix    │
                        │  N-1 Replay &
   D-1 Doctor cmd      │    Time-Travel
   D-5 Config migration│
                        │
   LOW EFFORT ──────────┼────────── HIGH EFFORT
                        │
   E-1 Slash commands   │  N-5 Semantic
   A-2 Plugin config    │    Search
   S-2 Secret rotation  │
                        │  D-4 VS Code
   E-8 Better errors    │    Extension
   E-10 Session export  │
                        │  N-7 Benchmark
   C-2 ADRs             │    Suite
   C-5 Changelog auto   │
                        │
                    LOW IMPACT
```

### Recommended Execution Order

1. **Quick wins** (1 day each) → build momentum, reduce tech debt
2. **E-2 + E-3** (test coverage) → prerequisite for safe refactoring
3. **A-1** (file decomposition) → follow the existing phased plan
4. **S-1** (capability migration) → complete the security hardening
5. **N-1** (replay/time-travel) → high-impact, leverages existing infrastructure
6. **E-7** (director dashboard) → flagship feature needs flagship visualization
7. **D-1 + D-2** (doctor + onboarding) → reduce support burden
8. **Remaining features** → prioritize based on user demand

---

*End of report.*

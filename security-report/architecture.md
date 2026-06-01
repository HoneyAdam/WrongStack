# Architecture Map — WrongStack (security-check Recon Phase 1)

**Target:** WrongStack monorepo (terminal AI coding agent + TUI + WebUI)
**Scan date:** 2026-06 (full rescan)
**Primary language:** TypeScript (911 .ts + 58 .tsx source files in packages/apps, ~97%)
**Monorepo packages:** 13 (packages/* + apps/*)
**Node:** >=22, ESM-only, pnpm 11

---

## 1. Technology Stack Detection

**Languages:**
- TypeScript (dominant): 911 .ts + 58 .tsx
- Minimal JavaScript: 3 .js (mostly bin shims and small scripts)
- Markdown, JSON, YAML for docs/config

**Frameworks & Runtimes:**
- CLI: custom REPL (packages/cli/src/repl.ts), no yargs/commander heavy framework
- TUI: React + Ink (packages/tui/)
- Web UI: Vite  + React (packages/webui/, served by CLI)
- LLM providers: Anthropic, OpenAI, Google, OpenAI-compatible (packages/providers/)
- MCP client: custom JSON-RPC 2.0 over stdio / SSE / streamable-http (packages/mcp/)
- LSP bridge: plug-lsp package

**Build / Package:**
- pnpm workspaces + tsup for bundling most packages
- Biome for lint/format
- Vitest for tests (3000+ tests)
- Root scripts delegate to `pnpm -r`

**Key Config Files:**
- `pnpm-workspace.yaml`
- `tsconfig.base.json`
- `biome.json`
- Per-package `tsup.config.ts`, `vitest.config.ts`

**Databases / Persistence (local only):**
- better-sqlite3 (explicitly allowed in pnpm-workspace.yaml) for `DefaultSessionStore`, `DefaultMemoryStore`, `PlanStore`
- JSONL session logs under `<project>/.wrongstack/sessions/`
- No remote DB drivers in core agent

---

## 2. Application Type Classification

- **Primary:** CLI Tool (REPL + optional TUI)
  - Entry: `wrongstack` / `wstack` binaries
  - Interactive REPL with slash commands (`/goal`, `/autonomy`, `/fleet`, `/security`, etc.)
  - Tool-calling agent loop in `@wrongstack/core`

- **Secondary:** Published library packages (`@wrongstack/core`, `@wrongstack/cli`, `@wrongstack/tools`, etc.)
- **Optional runtime:** WebUI (Vite/React SPA served on localhost by the CLI when `--webui`)
- **Multi-agent / orchestration:** First-class support via `DefaultMultiAgentCoordinator`, Collab Debug sessions, FleetBus
- **Not:** Web server, microservice, desktop app, serverless

**Monorepo boundaries:** Clear package separation (core has zero internal WS deps; providers/tools/mcp → core; cli/tui → everything).

---

## 3. Entry Points Mapping

**CLI / REPL:**
- `apps/wrongstack/src/index.js` (shim) → `@wrongstack/cli/dist/index.js`
- `packages/cli/src/index.ts`: argv parsing, container wiring, REPL or TUI launch
- `packages/cli/src/repl.ts`: main read-eval-print loop, slash command dispatch

**Slash Commands (high-privilege surface):**
- All in `packages/cli/src/slash-commands/`
- Examples with side effects: `/goal`, `/autonomy eternal`, `/collab`, `/fleet spawn`, `/yolo`, `/plugin`

**Tools (the primary "action surface" for LLM):**
- `packages/tools/src/builtin.ts` + individual impls (bash, exec, read, write, edit, git, grep, glob, fetch, mcp__*, diff, etc.)
- Many are `permission: 'auto'` (read, grep) or `'confirm'` (write, bash, exec by default)

**MCP:**
- Client spawns stdio child processes or connects to SSE/streamable-http servers
- Tools are dynamically namespaced: `mcp__<server>__<tool>`

**WebUI (secondary):**
- `packages/webui/src/` — Vite dev server + React
- Exposed via CLI when enabled; serves local control plane

**Subagents:**
- Spawned via `Agent.run` with separate `RunController` + budget
- Communication via `AgentBridge` + `FleetBus`

**No traditional HTTP routes** in the core agent (WebUI is the only HTTP surface, development-oriented).

---

## 4. Data Flow Map

**Sources (untrusted → adversarial per threat model):**
- User keyboard input (high trust)
- LLM `tool_use` blocks / text (zero trust — prompt injection)
- File contents read via tools (low trust)
- MCP server responses (low trust)
- Network responses from `fetch` tool or provider SDKs (zero trust)

**Processing:**
- `normalizeAndEmitUserInput` → `userInput` pipeline
- `Agent.run` iteration: build request → `request` pipeline → provider call (with retry) → `response` pipeline
- `ToolExecutor.executeBatch` (parallel/sequential/smart): permission check → `tool.started` → execute (or `executeStream`) → `toolCall` pipeline → `ctx.state.appendMessage`
- `HybridCompactor` + `AutoCompactionMiddleware` on `contextWindow` pipeline
- `repairToolUseAdjacency()` after context surgery

**Sinks (security-sensitive):**
- `child_process` (bash/exec tools) — full local shell
- `fs` operations (read/write/edit tools, git)
- Outbound HTTP (fetch tool, provider SDKs, MCP transports)
- Session JSONL writes (with secret scrubbing)
- Plugin registration / tool wrapping (via plugin API)
- Subagent spawning and task dispatch

**Critical invariant (documented in SECURITY.md):** LLM output is treated as fully adversarial. All tool inputs from the model must be validated or permission-gated.

---

## 5. Trust Boundaries

**Authentication / Identity:**
- None (local CLI tool). The "user" is the local operator.
- Plugin "officiality" and ownership checks (see F-02 previous finding, now fixed in some paths).

**Authorization (core control):**
- `PermissionPolicy` (DefaultPermissionPolicy + prompt delegate in TUI/CLI)
- `AutoApprovePermissionPolicy` for subagents (fail-closed on dangerous tools per previous fixes)
- Tool `permission: 'auto' | 'confirm' | 'deny'`
- `mutating: boolean` flag

**Input Validation & Containment:**
- `safeResolve` / `safeResolveReal` in tools (CWE-59 symlink + traversal defense) — verified fixed post previous scan
- Leading-dash rejection in git/diff tools (F-01 fix verified present)
- `validateTransportUrl` in MCP (IPv4 + IPv6 private range blocking, verified improved)
- `guardedFetch` / `search` SSRF hardening (previous F-05)

**Rate Limiting / DoS:**
- Per-subagent `SubagentBudget` (iterations, tool calls, tokens, cost USD, timeout)
- Budget self-extension handshake via events (no silent infinite spend)

**Secrets:**
- `DefaultSecretVault` — encrypted at rest in `~/.wrongstack/config.json` using per-machine key from `~/.wrongstack/.key`
- `SecretScrubber` in session persistence (F-06 fix)

**Plugin / Extension:**
- Capability declaration required
- Scoped `api` object (tools.register, etc.)
- Ownership checks on mutating registry ops (improved post F-02)

---

## 6. External Integrations

- **LLM Providers:** Anthropic, OpenAI, Google, compatible (API keys via secret vault)
- **MCP Servers:** Arbitrary stdio/SSE/HTTP servers (user-configured, namespaced tools)
- **Git:** Full shell access via `git` + `bash` tools (user's own git config/credentials)
- **Shell:** User's default shell (bash/zsh/pwsh) via `bash` tool — env sanitized (secret stripping)
- **No hardcoded cloud SDKs** in core (users can install via MCP or run via bash)

---

## 7. Authentication Architecture

**Local-only, no remote auth:**
- Relies on OS user context + explicit permission prompts.
- No JWT/session in the agent itself (except user-managed via tools).
- Subagent isolation is budget + signal + permission-policy based, not cryptographic.

**Token handling (user secrets):**
- Never logged in plaintext (scrubbing)
- Passed to child processes only via explicit passthrough opt-in (`WRONGSTACK_BASH_ENV_PASSTHROUGH`)

---

## 8. File Structure Analysis

**Security-sensitive paths (at runtime):**
- `<cwd>/.wrongstack/` — sessions, memory, plans, skills, config (user data)
- `~/.wrongstack/` — global config (encrypted secrets), skills, hooks
- `.githooks/` (set by postinstall)
- `node_modules/` (never to be written by agent tools without explicit user intent)

**Config:**
- `~/.wrongstack/config.json` (encrypted)
- Per-project `.wrongstack/` overrides

**Deployment / CI:**
- `.github/workflows/` (ci.yml, pages, release) — 3 workflows
- No Dockerfiles, k8s, Terraform in repo (users may have them in scanned projects)

**Source layout (security-relevant):**
- `packages/core/src/kernel/` — Container, Pipeline, EventBus, RunController (≤600 LOC total)
- `packages/core/src/agent.ts` — main loop
- `packages/core/src/execution/tool-executor.ts`, `permission-policy.ts`
- `packages/tools/src/` — all builtin tools (highest privilege surface)
- `packages/mcp/src/client.ts` + transports
- `packages/cli/src/slash-commands/` + plugin loader
- `packages/tui/src/components/` (FleetMonitor, etc.)

---

## 9. Detected Security Controls (Mature)

**Implemented & Verified in Place:**
- Explicit adversarial-LLM threat model (SECURITY.md)
- Permission prompts before mutating/destructive ops (unless yolo/autonomy policy)
- Path containment (`safeResolveReal`)
- Flag-injection guards on git/diff args (leading `-` rejection)
- SSRF guard with private-IP + redirect revalidation (`guardedFetch`)
- Secret encryption at rest + scrubbing before session log
- Subagent budgets + fail-closed permission policy for children
- MCP transport URL validation (IPv6 parity added post previous scan)
- Plugin capability + ownership enforcement (improved)
- `onlyBuiltDependencies` + limited allowBuilds in pnpm-workspace
- Comprehensive test suite (typecheck + 3000+ tests as release gate)
- Session JSONL with sidecar summaries

**Intentional Design Trade-offs (documented):**
- `bash` tool gives full user shell (feature, not bug) — mitigated by env sanitization + permission + process-group killing
- `exec` has strict allowlist
- Many tools are `permission: 'auto'` for UX (read, grep, glob) — acceptable because non-mutating

---

## 10. Language Detection Summary

```
## Detected Languages
- TypeScript (≈97% of source, 969 files in packages+apps) → **activates sc-lang-typescript** (full)
- JavaScript (shim/entry only) → covered by TS scanner
- No Go, Python, PHP, Rust, Java, C# in the agent codebase itself
```

**Implication for Phase 2:** Full TypeScript deep scan + universal skills relevant to CLI/agent/MCP/FS/shell/HTTP surfaces. Injection families that require a SQL DB, GraphQL server, LDAP, etc. (sqli, nosqli, graphql, ldap, ssti in most cases) have **very low applicability** and can be deprioritized or noted as N/A.

**Next:** Phase 2 hunting focused on:
- child_process / shell injection vectors in tools
- path traversal / symlink in FS tools
- SSRF in fetch + provider/MCP paths
- secrets & crypto (vault)
- authz / permission model & subagent guards
- plugin trust boundaries
- ReDoS, prototype pollution, unsafe any in critical paths
- CI/CD workflow hardening
- WebUI surface (if enabled)

---

*This architecture map was produced by sc-recon as part of the security-check 4-phase pipeline. It is used to scope and contextualize all subsequent vulnerability hunting.*

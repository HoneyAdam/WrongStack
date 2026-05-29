# Architecture Map — WrongStack

_Phase 1 reconnaissance output. Scan date: 2026-05-29._

## 1. Technology Stack

- **Language:** TypeScript (primary, ~568 non-test source files), ESM, Node ≥ 22. No Go/Python/PHP/Rust/Java/C# application code.
- **Package manager / build:** pnpm workspaces, monorepo (17 packages). Biome (lint/format), Vitest (tests).
- **Runtime libs:** Node built-ins (`node:child_process`, `node:http(s)`, `node:fs`, `node:crypto`), Ink/React (TUI), Vite/React (webui).
- **Databases:** none server-side. Local persistence is JSONL files (`.wrongstack/sessions/`) + JSON config (`~/.wrongstack/config.json`). Optional `node-sqlite` shim for codebase index.

## 2. Application Type

**CLI tool + local agent framework** (`wrongstack` / `wstack` bin). Not a hosted web service. Secondary surfaces:
- **Local web UI** (`packages/webui` — separate `webui` binary; `http.createServer` at `packages/webui/src/server/index.ts:1868`, plus a WebSocket handler).
- **MCP client** (`packages/mcp`) — connects out to MCP servers over stdio / SSE / streamable-http.
- **Telegram bridge** (`packages/telegram`) — long-poll bot.
- **ACP agent** (`packages/acp`) — stdio JSON-RPC transport.

## 3. Entry Points (where external/untrusted input enters)

| Entry | Location | Trust level |
|---|---|---|
| CLI args / stdin / REPL prompt | `packages/cli/src/index.ts` | user-controlled (local) |
| **LLM tool-call arguments** | `packages/tools/src/*` | **semi-trusted — model output drives tool inputs** |
| WebUI HTTP routes | `packages/webui/src/server/index.ts:1868` | local network |
| WebUI WebSocket | `packages/webui/src/server/autophase-ws-handler.ts` | local network |
| MCP server responses | `packages/mcp/src/transport.ts` | **external (remote MCP servers)** |
| Telegram updates | `packages/telegram/src/bot.ts` | **external (Telegram API → arbitrary chat input)** |
| Fetched web content | `packages/tools/src/fetch.ts`, `search.ts`, `plugins/web-search` | **external (arbitrary URLs)** |
| Skill/plugin packages | `packages/core/src/skills/github-fetcher.ts`, plugin host | **external (GitHub downloads)** |
| Session/goal/config files on disk | `packages/core/src/storage/*` | local, but parsed/deserialized |

## 4. Data Flow — security-sensitive sinks

- **Command execution:** `packages/tools/src/bash.ts`, `exec.ts`, `_spawn-stream.ts`, `install.ts`, `git.ts`, `scaffold.ts`; `packages/acp/src/agent/stdio-transport.ts:171`; MCP stdio launch; `cli/.../update.ts` (`npm install -g`), `commit.ts`, `pre-launch.ts` (git). **No `shell:true` found** (good signal).
- **Filesystem read/write:** `packages/tools/src/{read,write,edit,replace,patch,glob,grep,memory,document}.ts` (75 path/fs call sites in tools+webui). Path-traversal relevant.
- **Outbound HTTP (SSRF surface):** `tools/src/fetch.ts` (has DNS-rebinding comment → existing SSRF guard to verify), `search.ts`, `mcp/src/transport.ts` (5 fetch calls), `telegram/src/bot.ts`, `plugins/web-search`, `core/skills/github-fetcher.ts`, `cli/update-check.ts`.
- **Crypto / secrets:** `packages/core/src/security/secret-vault.ts` (encrypts API keys with per-machine key), `storage/attachment-store.ts`, `utils/atomic-write.ts`.
- **Deserialization:** JSONL session load (`storage/session-store.ts`), goal.json, MCP JSON-RPC parsing, codebase-index parsers, plugin manifests.
- **Dynamic code:** `require(...)` used in a few spots (`cli/execution.ts:403/407`, `picker.ts`, `director-state.ts`, `rs-parser.ts`). No `eval` or dynamic-function construction in application code (only referenced in `fleet.ts` doc strings).
- **HTTP server (createServer):** `webui/src/server/index.ts:1868`, `core/observability/prometheus.ts`.

## 5. Trust Boundaries

- **Tool permission model** (`auto`/`confirm`/`deny`, `mutating` flag) gates tool execution — the primary control. Bash/exec are the highest-impact tools.
- **WebUI**: bind address, auth, CORS, origin checks on WS — to verify.
- **MCP**: responses from remote servers are parsed and surfaced; transport reconnect/backoff.
- **Secret vault**: per-machine key at `~/.wrongstack/.key`; config encryption.

## 6. External Integrations

LLM providers (Anthropic/OpenAI/Google/OpenAI-compatible — API keys), MCP servers, Telegram Bot API, npm registry (update check), GitHub (skills/plugins fetch).

## 7. Authentication Architecture

No app user-auth system (local-first tool). Relevant secrets: provider API keys (vault-encrypted), Telegram bot token, MCP server credentials. WebUI auth model to be verified.

## 8. Security-sensitive Files

- `~/.wrongstack/config.json` (encrypted secrets), `~/.wrongstack/.key` (key material).
- `<projectRoot>/.wrongstack/` (sessions, goal.json, state).
- `.github/workflows/ci.yml`, `release.yml` (CI/CD — supply-chain surface; **no Dockerfile/IaC present**).

## 9. Detected Security Controls (to verify in Hunt)

- Tool permission gating (`permission`/`mutating`).
- SSRF guard in `tools/src/fetch.ts` (DNS-rebinding aware).
- Secret encryption via `DefaultSecretVault`.
- Tool-output truncation before session-log write.

## 10. Detected Languages → Phase-2 language scanners

- **TypeScript / JavaScript (100% of application code)** → activates **sc-lang-typescript**.
- No other language scanners apply.

## Infrastructure scanners

- **sc-ci-cd**: ACTIVATE (`.github/workflows/` present).
- **sc-docker / sc-iac**: SKIP (no Dockerfile, compose, Terraform, or K8s manifests).

# Architecture Map — WrongStack

**Scan date:** 2026-06-24
**Type:** Local-first agentic coding CLI (multi-surface: CLI / TUI / WebUI / MCP server / Telegram)
**Languages:** TypeScript (1741 `.ts`, 158 `.tsx`), minimal JS. Node ≥ 22, pnpm monorepo.
**Infra:** No Dockerfiles / Terraform. One GitHub workflow (`.github/workflows/pages.yml`).

## Trust boundaries (where untrusted input crosses into the process)

| Boundary | Source | Control |
|---|---|---|
| LLM tool calls | Model output | Permission policy (`auto`/`confirm`/`deny`) + capability allowlist |
| In-project config | `<project>/.wrongstack/config.json` (repo-committed, attacker-controllable) | `stripUnsafeInProjectFields` denylist strips exec/credential/endpoint fields |
| WebUI WebSocket / HTTP | Network (loopback default, optional LAN/0.0.0.0) | `verifyClient`: Host-header DNS-rebind guard + constant-time token + origin check |
| `fetch` tool target | Model-supplied URL | SSRF guard: HTTPS-only, private-IP block, DNS-pinned dispatcher, per-hop revalidation |
| MCP servers | User config (trusted; stripped from in-project) | stdio/SSE/streamable-http |
| Secrets at rest | `~/.wrongstack/config.json` + `.key` | AES-256-GCM, optional scrypt KEK passphrase wrap (v3) |

## Primary attack surface (audited)

- **Command execution** — `packages/tools/src/{bash,exec,outdated,_spawn-stream,spawn-background}.ts`
- **Crypto / secrets** — `packages/core/src/security/secret-vault.ts`
- **Permission / trust** — `packages/core/src/security/permission-policy.ts`, `capabilities.ts`
- **Config merge** — `packages/core/src/storage/config-loader.ts`, `utils/deep-merge.ts`
- **Network egress** — `packages/tools/src/fetch.ts`
- **Network ingress** — `packages/webui/src/server/{index,ws-auth}.ts`, `packages/cli/src/webui-server.ts`
- **HTML rendering** — `packages/cli/src/hq-dashboard-html.ts`, `packages/webui` React app

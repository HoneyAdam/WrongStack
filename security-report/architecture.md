# Architecture Map — WrongStack (high-risk-core scan)

**Scan date:** 2026-06-23
**Scope:** High-risk attackable surface of an agent framework. Web-only vuln
classes (XSS/CSRF/clickjacking outside the loopback WebUI) were de-scoped.

## What this is

WrongStack is a multi-package TypeScript/Node ≥22 agent framework (CLI + TUI +
local WebUI). It executes LLM-generated tool calls against the developer's
machine. The dominant threat model is therefore:

1. **Confused-deputy / prompt-injection RCE** — a model (possibly steered by
   malicious content it reads) tries to run code or read/write outside scope.
2. **Secret exfiltration** — provider API keys / VCS tokens leaking to child
   processes, MCP servers, or the network.
3. **SSRF** — the model fetching internal/cloud-metadata endpoints.
4. **Local network exposure** — the WebUI server becoming a remote RCE.

## Tech stack / languages

- **Language:** TypeScript (ESM), Node ≥ 22, pnpm workspace.
- **Network:** `undici` (global fetch), `ws` (WebUI), MCP over stdio/SSE/HTTP.
- **Crypto:** `node:crypto` (AES-256-GCM secret vault).
- **Process:** `node:child_process` spawn (bash/exec/git/MCP/browser).

## Trust boundaries & entry points reviewed

| Boundary | Module | Control |
|---|---|---|
| Model → shell | `packages/tools/src/bash.ts` | `permission:'confirm'`, `riskTier:'destructive'`, shell allowlist |
| Model → restricted shell | `packages/tools/src/exec.ts` | command allowlist + per-command arg blocklist |
| Model → git | `packages/tools/src/git.ts` | argv array (no shell) + branch/path validation |
| Model → filesystem | `read/write/edit/replace/glob/grep` | `safeResolve` + realpath confinement (CWE-59) |
| Model → network | `packages/tools/src/fetch.ts` | SSRF guard, DNS-pinned dispatcher |
| Secrets at rest | `packages/core/src/security/secret-vault.ts` | AES-256-GCM, per-machine key 0o600 |
| Child env | `packages/core/src/utils/child-env.ts` | credential scrub allowlist |
| MCP servers | `packages/mcp/src/client.ts` | config-controlled command (trusted) |
| Local network | `packages/webui/src/server/{http-server,ws-auth}.ts` | loopback bind + Host-guard + token |
| Config merge | `packages/core/src/utils/deep-merge.ts` | prototype-pollution guard |
| IP classification | `packages/core/src/utils/ip-guard.ts` | private/IMDS/CGNAT/IPv6 ranges |

## Overall posture

Strong. The codebase shows evidence of prior, deliberate security hardening
(references to CVE-2024-27980, internal finding IDs C-2 / C-598, constant-time
comparisons, DNS-rebinding guards, SSRF connection pinning, secret scrubbing).
No Critical or High issues were found in scope. Findings are Low/Info
defense-in-depth items.

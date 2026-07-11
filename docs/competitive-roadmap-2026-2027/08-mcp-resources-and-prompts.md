# MCP Resources and Prompts

**Priority:** P0  
**Horizon:** 0–3 months  
**Status:** Implemented

## Outcome

Complete the high-value MCP client capability surface by supporting resources and prompts alongside tools.

## Scope

- Capability negotiation and typed server metadata.
- `resources/list`, pagination, `resources/read`, and resource templates.
- Optional resource subscriptions and list-change notifications where supported.
- `prompts/list`, pagination, `prompts/get`, and argument validation.
- Cross-surface discovery and explicit insertion of selected content into a conversation.
- Lazy-server manifest caching extended beyond tools with correct invalidation.

## Architecture

- Keep transport request primitives generic; expose typed methods from `MCPClient`.
- Represent remote resources as untrusted content with origin, MIME type, size, and server identity.
- Do not inject prompts or resources automatically. User or agent selection must pass through a visible trust boundary.
- Preserve resource links and embedded content without flattening all output to text.

## Delivery plan

1. Add protocol types and handshake capability storage.
2. Implement stdio methods and tests, then achieve SSE/streamable HTTP parity.
3. Extend registry lifecycle, lazy cache, and notifications.
4. Add CLI/WebUI discovery and read/get flows.
5. Add WrongStack MCP server exposure only for deliberately selected local resources/prompts.

## Implementation progress

### 2026-07-11 — Protocol contract and stdio client slice

- Added typed initialize metadata and strict response parsing for resources, resource templates,
  resource contents, prompts, and rich prompt messages.
- `MCPClient` now retains handshake capabilities across stdio, SSE, and streamable HTTP, and
  exposes typed, capability-gated methods
  for `resources/list`, `resources/templates/list`, `resources/read`, `prompts/list`, and
  `prompts/get`.
- Added cursor propagation, prompt argument validation, bounded protocol inputs, abort-signal
  forwarding, JSON-RPC error handling, and malformed-response rejection.
- Preserved tools-only server behavior and verified that unsupported resource/prompt calls do not
  reach the transport.
- Generic HTTP requests now preserve external abort signals, emit best-effort MCP cancellation
  notifications, and use the same typed response validation as stdio.
- Added capability-gated `resources/subscribe` and `resources/unsubscribe`, plus removable resource
  and prompt list-change listeners. Stdio and SSE list-change notifications now reach the client
  listener surface without forcing automatic content injection.
- Verification: all `@wrongstack/mcp` tests and MCP package typecheck pass; topological workspace
  build and repo-wide typecheck also pass.

Remaining work: registry-level list-change cache invalidation and streamable HTTP notification
ingestion, lazy manifest caching for resources/prompts, cross-surface discovery/insertion,
insertion-time URI and content-size policy, and provenance in session/audit records.

### 2026-07-12 — Registry, lazy cache, trust boundary, and surfaces

- Extended the lazy manifest to a backwards-compatible v2 format containing server metadata,
  resources, resource templates, and prompts alongside tools. Legacy tools-only cache files still
  load unchanged.
- Added bounded full-catalog discovery (100 pages / 10,000 items), repeated-cursor protection,
  dormant cache reads without spawning, serialized manifest replacement, and registry cache
  invalidation for resource/prompt list-change notifications.
- Streamable HTTP now preserves and dispatches notifications embedded beside JSON-RPC results;
  stdio, SSE, and streamable HTTP therefore share list-change behavior.
- Added an explicit insertion trust boundary: selected content is marked untrusted, carries MCP
  server/capability provenance, enforces a 256 KiB default limit, validates base64, restricts URI
  schemes, rejects credential-bearing HTTP URLs, and preserves rich prompt/resource blocks.
- CLI supports `/mcp resources`, `/mcp prompts`, `/mcp read`, and `/mcp get`. WebUI exposes the
  equivalent WebSocket flows and chat slash commands; listing never injects content, while an
  explicit read/get selection enters the normal user-message/session recording path with its
  provenance envelope visible.

- Completed `wstack mcp serve` exposure through explicit `--resources` and `--prompts`
  comma-separated file allowlists. No project scanning or prompt-library auto-exposure occurs;
  directories and files above 256 KiB are rejected, binary resources are base64 encoded, and
  prompt `{{argument}}` placeholders become required MCP arguments.

All delivery-plan items and acceptance criteria are now implemented.

Final verification: topological workspace build and repo-wide typecheck pass; the root suite passes
1,013 test files / 14,777 tests (3 files and 65 tests skipped), the complete WebUI suite passes 153
files / 2,092 tests, and the MCP package passes 14 files / 286 tests.

## Acceptance criteria

- Pagination, cancellation, timeouts, and malformed server responses are covered.
- Content size and URI scheme limits are enforced before context insertion.
- A tools-only MCP server behaves exactly as before.
- Resource/prompt provenance remains visible in session and audit records.

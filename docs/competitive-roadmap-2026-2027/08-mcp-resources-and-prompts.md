# MCP Resources and Prompts

**Priority:** P0  
**Horizon:** 0–3 months  
**Status:** Proposed

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

## Acceptance criteria

- Pagination, cancellation, timeouts, and malformed server responses are covered.
- Content size and URI scheme limits are enforced before context insertion.
- A tools-only MCP server behaves exactly as before.
- Resource/prompt provenance remains visible in session and audit records.


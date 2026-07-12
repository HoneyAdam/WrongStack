# MCP Authentication and Legacy Sampling Compatibility

**Priority:** P1  
**Horizon:** 3–6 months  
**Status:** In progress

## Outcome

Support authenticated remote MCP servers while retaining safe default-deny compatibility for the
now-deprecated server-initiated sampling protocol.

## Standards correction — 2026-07-13

MCP SEP-2577, accepted in April 2026, deprecated `sampling/createMessage`. WrongStack will not build
a new provider/Brain/cost execution pipeline for a deprecated client capability. Legacy sampling
requests remain unadvertised, strictly separated from responses, and denied by default. The active
investment in this plan is OAuth authorization for HTTP transports.

## Scope

- Standards-aligned OAuth discovery, authorization, refresh, revocation, and token storage for HTTP transports.
- Per-server authentication state and actionable reauthentication events.
- Protocol-correct default denial for legacy `sampling/createMessage` requests without advertising
  the capability.

## Security model

- Tokens live in the secret vault, never project config or MCP manifest caches.
- Redirect listeners bind loopback only and validate state, issuer, and redirect URI.
- Deprecated sampling content is never sent to a provider.

## Delivery plan

1. Persist server capabilities and authentication metadata.
2. Implement OAuth for streamable HTTP with a headless/manual fallback.
3. Retain strict request/response separation and a default-deny legacy sampling handler.
4. Add WebUI/Desktop auth UX and full transport/security tests.

## Implementation progress

### 2026-07-12 — Protocol boundary and default-deny stdio slice

- Stdio response handling now validates response envelopes before consulting the pending-request
  map. A server request whose ID collides with a client request can no longer complete that client
  request.
- Server-initiated `sampling/createMessage` requests over stdio receive a protocol-correct
  JSON-RPC `-32601` response explaining that sampling is disabled by policy. Other unsupported
  server requests receive method-not-found with their original numeric or string ID.
- Streamable HTTP response extraction now separates responses from notifications and server
  requests, including when multiple envelopes share an ID in NDJSON or SSE-framed bodies.
- Added stdio collision, default-deny sampling, unknown-method, strict-response, extraction, and
  streamable HTTP collision regression coverage.

### 2026-07-13 — Vault bridge, challenge/retry, and automatic rotation foundation

- Added a host-owned authorization-provider contract so HTTP transports request access tokens at
  send time. Persistence is instantiated by the host with its SecretVault and project-state path;
  access or refresh tokens never enter MCP server config or capability manifests.
- Tokens are bound to the exact canonical MCP resource URI, limited to Bearer semantics, checked
  for expiry and header injection, and cannot be replayed to a different MCP server.
- Added bounded `WWW-Authenticate: Bearer` challenge parsing for protected-resource metadata and
  authoritative scopes. A host may refresh/discover/reauthorize and request exactly one retry;
  repeated 401 responses never loop.
- Added RFC 9728 protected-resource and RFC 8414/OIDC discovery candidate generation plus strict
  metadata validation: exact resource/issuer binding, bounded authorization-server and scope lists,
  HTTPS-only endpoints outside loopback development, and mandatory PKCE `S256` advertisement.
- Added guarded discovery orchestration across those candidates. DNS is resolved once per request,
  every returned address is validated, and the HTTP(S) socket connects directly to the selected IP
  while preserving TLS SNI/Host. Private or mixed DNS answers, redirects, non-JSON responses,
  oversized bodies, timeouts, and aborts fail closed; only exact loopback development resources may
  use loopback discovery endpoints.
- Added the public-client PKCE S256 lifecycle: cryptographically random verifier/state generation,
  authorization URL construction, exact redirect and constant-time state verification, guarded
  authorization-code exchange, and guarded refresh-token rotation. RFC 8707 `resource` is mandatory
  in the authorization URL, code exchange, and refresh exchange; returned access tokens are bound
  locally to that same canonical resource. Token responses are bounded and reject unsupported token
  types, invalid expiry, malformed scopes, injection characters, redirects, and private DNS.
- Registry hosts can inject a per-server provider factory, enabling SecretVault-backed state
  without adding secret fields to `MCPServerConfig`. Static stdio credential handling is unchanged.
- Added a versioned, bounded, file-locked token store under the non-repository project state. Both
  access and refresh tokens must be SecretVault ciphertext at rest; plaintext and no-op vaults fail
  closed. Entries are keyed by server plus exact canonical resource so concurrent CLI/WebUI hosts
  cannot overwrite unrelated credentials.
- Added a shared refresh provider that proactively rotates near-expiry tokens, single-flights
  concurrent refresh attempts, preserves rotated refresh tokens atomically, and revalidates the
  resource/token/authorization-server binding after reload. CLI and standalone WebUI now install
  this provider factory; Desktop inherits the standalone backend path.
- Added a surface-neutral authorization manager with a bounded ten-minute in-memory PKCE session,
  one-shot callback/code consumption, safe status projection, and exact-binding logout. The registry
  exposes these operations only for configured HTTP servers. REPL/TUI users can now run `/mcp auth
  start|complete|status|logout`; status and completion output never includes access or refresh
  tokens.
- HTTP requests after initialize now carry the negotiated `MCP-Protocol-Version` header.

Remaining work: client-metadata/DCR identity selection beyond explicit preregistered client IDs, a
managed loopback callback listener, revocation and invalid-grant recovery, public per-server auth
state/events, SecretVault key-rotation migration for the token file, and dedicated WebUI/Desktop
controls.

## Acceptance criteria

- Expired credentials recover without exposing refresh tokens.
- Deprecated sampling never consumes provider tokens or cost.
- Denied or unsupported sampling returns a protocol-correct error.
- Authentication and sampling can be disabled independently per server.

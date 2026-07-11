# MCP Authentication and Sampling

**Priority:** P1  
**Horizon:** 3–6 months  
**Status:** Proposed

## Outcome

Support authenticated remote MCP servers and controlled server-initiated sampling without bypassing WrongStack's provider, permission, cost, or Brain governance.

## Scope

- Standards-aligned OAuth discovery, authorization, refresh, revocation, and token storage for HTTP transports.
- Per-server authentication state and actionable reauthentication events.
- `sampling/createMessage` handling routed through the active provider abstraction.
- Model, token, cost, and tool-use ceilings for sampling requests.
- Optional human/Brain approval based on server trust and requested risk.

## Security model

- Tokens live in the secret vault, never project config or MCP manifest caches.
- Redirect listeners bind loopback only and validate state, issuer, and redirect URI.
- A server cannot select unrestricted credentials, tools, or a more expensive model than policy permits.
- Sampling content is labeled with server provenance and treated as untrusted input.

## Delivery plan

1. Persist server capabilities and authentication metadata.
2. Implement OAuth for streamable HTTP with a headless/manual fallback.
3. Add sampling request validation and a default-deny handler.
4. Route approved sampling through provider accounting and Brain decisions.
5. Add WebUI/Desktop auth UX and full transport/security tests.

## Acceptance criteria

- Expired credentials recover without exposing refresh tokens.
- Sampling usage appears in normal token/cost telemetry.
- Denied or unsupported sampling returns a protocol-correct error.
- Authentication and sampling can be disabled independently per server.


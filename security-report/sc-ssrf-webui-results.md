# sc-ssrf + sc-websocket Results — WrongStack

**Skill:** sc-ssrf, sc-websocket
**Date:** 2026-06

## Summary
SSRF guard in place and improved. WebUI is local-only development surface; no WebSocket server in core agent.

## Details
- `guardedFetch` + redirect + private-IP revalidation exported and used by search/fetch paths (F-05 verified).
- MCP transport validation includes IPv6 link-local + AWS IMDS ranges (F-07 parity added).
- No user-controlled outbound fetch in the agent loop itself except through the gated `fetch` tool.
- WebUI (Vite) is localhost-only when enabled; not exposed.
- No WebSocket server implementation in the WrongStack runtime (only client usage via MCP or user tools).

**Verdict:** LOW risk. Good network boundary controls for an agent that must talk to arbitrary LLM and MCP endpoints.
**Confidence:** 85
**Findings:** 0

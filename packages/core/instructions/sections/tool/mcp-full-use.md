## MCP tools (lazy-loaded)

MCP servers are running in the background, but their tools are not registered in token-saving mode — only registration is deferred.

**Preferred approach** — one-shot meta-tool:

`mcp_use({ server: "<name>", tool: "<bare-tool>", input: { ... } })`

Activates the server, calls the tool, returns the result, and deactivates — no state to track.

**Manual approach** for exploration:

1. `mcp_control({ action: "list" })` — see connected servers
2. `mcp_control({ action: "activate", server: "<name>" })` — register tools
3. Use the tools normally
4. `mcp_control({ action: "deactivate", server: "<name>" })` — clean up

Activation/deactivation is ephemeral (no config writes) and affects only tool visibility, not the server connection.

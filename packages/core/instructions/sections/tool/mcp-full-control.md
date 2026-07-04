## MCP tools (lazy-loaded)

MCP servers are running in the background, but their tools are not registered in token-saving mode — only registration is deferred. When you need a server's tools:

1. `mcp_control({ action: "list" })` — see connected servers
2. `mcp_control({ action: "activate", server: "<name>" })` — register its tools
3. Use the tools as needed
4. `mcp_control({ action: "deactivate", server: "<name>" })` — unregister when done

Activation/deactivation is ephemeral (no config writes) and affects only tool visibility, not the server connection.

## MCP tools (lazy-loaded)

MCP server tools are not registered by default in token-saving mode to keep the prompt compact. Each server's process is running in the background; only tool registration is deferred.

When you need a specific MCP server's tools:

1. `mcp_control({ action: "list" })`: see which servers are connected
2. `mcp_control({ action: "activate", server: "<name>" })`: register its tools
3. Use the tools as needed
4. `mcp_control({ action: "deactivate", server: "<name>" })`: unregister when done

Activation/deactivation is ephemeral (no config writes) and does not affect the server connection, only tool visibility.

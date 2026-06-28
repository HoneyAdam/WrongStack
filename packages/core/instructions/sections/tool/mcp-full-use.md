## MCP tools (lazy-loaded)

MCP server tools are not registered by default in token-saving mode to keep the prompt compact. Each server's process is running in the background; only tool registration is deferred.

**Preferred approach**: one-shot meta-tool:

`mcp_use({ server: "<name>", tool: "<bare-tool>", input: { ... } })`

This activates the server, calls the tool, returns the result, and deactivates, all in one call. No need to track activate/deactivate state.

**Manual approach** for exploration:

1. `mcp_control({ action: "list" })`: see which servers are connected
2. `mcp_control({ action: "activate", server: "<name>" })`: register tools
3. Use the tools normally
4. `mcp_control({ action: "deactivate", server: "<name>" })`: clean up

Activation/deactivation is ephemeral (no config writes) and does not affect the server connection, only tool visibility.

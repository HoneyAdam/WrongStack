#!/usr/bin/env bash
# 04 — MCP Integration Demo
# Demonstrates adding and using MCP servers.
set -euo pipefail

echo "=== MCP Integration Demo ==="

echo "--- List configured MCP servers ---"
wrongstack mcp

echo "--- Show available presets ---"
echo "(run: wrongstack mcp add <name> --enable)"
echo ""

echo "--- Add filesystem server ---"
wrongstack mcp add filesystem --enable

echo "--- Use it ---"
wrongstack "list the top-level files in this project using the MCP filesystem tool"

echo "=== Demo complete ==="

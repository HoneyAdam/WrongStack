#!/usr/bin/env bash
# 01 — Basic Usage Demo
# Run this script from the examples/01-basic/ directory.
# Prerequisites: wrongstack must be installed and a provider configured.
#   wrongstack init        # first-time setup
#   wrongstack auth <id>   # add API key
set -euo pipefail

echo "=== WrongStack Basic Usage Demo ==="
echo ""

# --------------------------------------------------
# Single-shot: one question, one answer, exit
# --------------------------------------------------
echo "--- Single-shot ---"
wrongstack "what Node.js version does this project require?"
echo ""

# --------------------------------------------------
# REPL: interactive session (exit with Ctrl+D or /exit)
# --------------------------------------------------
echo "--- Interactive REPL ---"
echo "Launching REPL… type '/exit' to continue this demo."
wrongstack
echo ""

# --------------------------------------------------
# TUI mode: rich terminal UI
# --------------------------------------------------
echo "--- TUI mode ---"
echo "Press Esc to exit the TUI when done."
wrongstack --tui
echo ""

# --------------------------------------------------
# YOLO mode: auto-approve normal project work
# --------------------------------------------------
echo "--- YOLO mode ---"
wrongstack --yolo "count the number of TypeScript files in this project"
echo ""

echo "=== Demo complete ==="

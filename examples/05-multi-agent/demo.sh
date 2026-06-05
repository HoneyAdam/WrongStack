#!/usr/bin/env bash
# 05 — Multi-Agent Demo
# Director fleet orchestration.
set -euo pipefail

echo "=== Multi-Agent Demo ==="

echo "--- Director single-shot ---"
wrongstack --director "list the key modules in packages/core/src and summarize each"

echo "--- Spawn a custom subagent ---"
echo "(from TUI: /spawn -p groq -m llama-3.3-70b-versatile \"review auth module\")"

echo "--- Fleet management ---"
echo "(from TUI: /fleet status, /fleet usage, /fleet kill <id>)"

echo "=== Demo complete ==="

#!/usr/bin/env bash
# 03 — Multi-Provider Demo
# Shows how to switch providers and models.
set -euo pipefail

echo "=== Multi-Provider Demo ==="

echo "--- List available providers ---"
wrongstack providers

echo "--- Show models for Anthropic ---"
wrongstack models anthropic

echo "--- Switch provider at launch ---"
wrongstack --provider groq --model llama-3.3-70b-versatile "hello from groq"

echo "=== Demo complete ==="

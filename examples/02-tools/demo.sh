#!/usr/bin/env bash
# 02 — Tool Usage Demo
# Demonstrates WrongStack's built-in tools in action.
set -euo pipefail

echo "=== Tool Usage Demo ==="

# File editing
echo "--- File editing ---"
wrongstack "read the file package.json and tell me the project version"

# Code search
echo "--- Code search ---"
wrongstack "search for TODO comments across the src/ directory"

# Git operations
echo "--- Git operations ---"
wrongstack "summarize the last 3 commits"

# Tests
echo "--- Running tests ---"
wrongstack --yolo "run the test suite for a single package"

echo "=== Demo complete ==="

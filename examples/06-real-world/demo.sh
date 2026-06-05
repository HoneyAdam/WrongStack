#!/usr/bin/env bash
# 06 — Real-World Workflows
# Practical recipes for daily development.
set -euo pipefail

echo "=== Real-World Workflows Demo ==="

echo "--- Refactor with YOLO ---"
wrongstack --yolo "add a comment header to the main entry point explaining the module"

echo "--- Security scan ---"
wrongstack "scan packages/core/src for hardcoded secrets"

echo "--- Dependency hygiene ---"
wrongstack "check for outdated packages"

echo "--- Generate commit ---"
wrongstack "stage all changes and create a conventional-commit message"

echo "=== Demo complete ==="

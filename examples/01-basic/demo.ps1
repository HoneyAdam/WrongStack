# 01 — Basic Usage Demo (PowerShell)
# Run from examples/01-basic/ directory.
# Prerequisites: wrongstack --version

Write-Host "=== WrongStack Basic Usage Demo ===" -ForegroundColor Cyan

# --------------------------------------------------
# Single-shot
# --------------------------------------------------
Write-Host "`n--- Single-shot ---" -ForegroundColor Yellow
wrongstack "what Node.js version does this project require?"

# --------------------------------------------------
# YOLO mode
# --------------------------------------------------
Write-Host "`n--- YOLO mode ---" -ForegroundColor Yellow
wrongstack --yolo "count the number of TypeScript files in this project"

Write-Host "`n=== Demo complete ===" -ForegroundColor Cyan

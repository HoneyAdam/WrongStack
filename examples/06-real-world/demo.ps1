# 06 — Real-World Workflows Demo (PowerShell)

Write-Host "=== Real-World Workflows Demo ===" -ForegroundColor Cyan

Write-Host "`n--- Security scan ---" -ForegroundColor Yellow
wrongstack "scan packages/core/src for hardcoded secrets"

Write-Host "`n--- Dependency hygiene ---" -ForegroundColor Yellow
wrongstack "check for outdated packages"

Write-Host "`n=== Demo complete ===" -ForegroundColor Cyan

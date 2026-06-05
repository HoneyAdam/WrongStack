# 05 — Multi-Agent Demo (PowerShell)

Write-Host "=== Multi-Agent Demo ===" -ForegroundColor Cyan

Write-Host "`n--- Director single-shot ---" -ForegroundColor Yellow
wrongstack --director "list the key modules in packages/core/src and summarize each"

Write-Host "`n=== Demo complete ===" -ForegroundColor Cyan

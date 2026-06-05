# 04 — MCP Integration Demo (PowerShell)

Write-Host "=== MCP Integration Demo ===" -ForegroundColor Cyan

Write-Host "`n--- List configured MCP servers ---" -ForegroundColor Yellow
wrongstack mcp

Write-Host "`n--- Available presets ---" -ForegroundColor Yellow
Write-Host "Run: wrongstack mcp add <name> --enable"
Write-Host ""

Write-Host "`n--- Add filesystem server ---" -ForegroundColor Yellow
wrongstack mcp add filesystem --enable

Write-Host "`n=== Demo complete ===" -ForegroundColor Cyan

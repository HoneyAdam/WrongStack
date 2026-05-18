# WrongStack installer for Windows (PowerShell)
# Usage: irm https://wrongstack.com/install.ps1 | iex
#
# Installs WrongStack globally via npm. Requires Node.js >= 22.
#
# Options:
#   $env:WRONGSTACK_VERSION  Install a specific version (default: latest)
#   $env:WRONGSTACK_MANAGER  Force package manager: npm | pnpm (default: auto-detect)

$ErrorActionPreference = 'Stop'

Write-Host ""
Write-Host "WrongStack installer" -ForegroundColor Cyan
Write-Host "Built on the wrong stack. Shipped anyway." -ForegroundColor DarkGray
Write-Host ""

# ---- Check Node.js ----
try {
    $nodeVersion = (node -v) -replace 'v', '' -split '\.' | Select-Object -First 1
    if ([int]$nodeVersion -lt 22) {
        Write-Host "✗ Node.js v$nodeVersion found, but WrongStack requires >= 22" -ForegroundColor Red
        Write-Host "  Install: https://nodejs.org/" -ForegroundColor DarkGray
        exit 1
    }
    Write-Host "✓ Node.js $(node -v)" -ForegroundColor Green
} catch {
    Write-Host "✗ Node.js not found. WrongStack requires Node.js >= 22" -ForegroundColor Red
    Write-Host "  Install: https://nodejs.org/" -ForegroundColor DarkGray
    exit 1
}

# ---- Detect package manager ----
if ($env:WRONGSTACK_MANAGER) {
    $manager = $env:WRONGSTACK_MANAGER
} elseif (Get-Command pnpm -ErrorAction SilentlyContinue) {
    $manager = "pnpm"
} elseif (Get-Command npm -ErrorAction SilentlyContinue) {
    $manager = "npm"
} else {
    Write-Host "✗ Neither pnpm nor npm found" -ForegroundColor Red
    exit 1
}
Write-Host "✓ Package manager: $manager" -ForegroundColor Green

# ---- Install ----
$versionFlag = ""
if ($env:WRONGSTACK_VERSION) {
    $versionFlag = "@$env:WRONGSTACK_VERSION"
    Write-Host "ℹ Installing wrongstack@$env:WRONGSTACK_VERSION…" -ForegroundColor Cyan
} else {
    Write-Host "ℹ Installing wrongstack (latest)…" -ForegroundColor Cyan
}

if ($manager -eq "pnpm") {
    pnpm install -g "wrongstack$versionFlag"
} else {
    npm install -g "wrongstack$versionFlag"
}

# ---- Verify ----
if (Get-Command wrongstack -ErrorAction SilentlyContinue) {
    Write-Host ""
    Write-Host "✓ WrongStack installed successfully!" -ForegroundColor Green
    Write-Host ""
    Write-Host "  wrongstack version   # show version" -ForegroundColor DarkGray
    Write-Host "  wrongstack init      # first-run setup" -ForegroundColor DarkGray
    Write-Host "  wrongstack --tui     # rich terminal UI" -ForegroundColor DarkGray
    Write-Host ""
    Write-Host "  alias: wstack" -ForegroundColor DarkGray
    Write-Host ""
    Write-Host "  Get started: wrongstack init" -ForegroundColor DarkGray
    Write-Host ""
} else {
    Write-Host "⚠ wrongstack not found on PATH after install." -ForegroundColor Yellow
    Write-Host "  You may need to restart your terminal." -ForegroundColor DarkGray
}

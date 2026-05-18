#!/usr/bin/env bash
# WrongStack installer — curl -fsSL https://wrongstack.com/install.sh | bash
#
# Installs WrongStack globally via npm. Requires Node.js >= 22.
# For pnpm users: pnpm install -g wrongstack
#
# Options:
#   WRONGSTACK_VERSION  Install a specific version (default: latest)
#   WRONGSTACK_MANAGER  Force package manager: npm | pnpm (default: auto-detect)

set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
DIM='\033[2m'
BOLD='\033[1m'
NC='\033[0m'

info()  { echo -e "${CYAN}ℹ${NC} $*"; }
ok()    { echo -e "${GREEN}✓${NC} $*"; }
warn()  { echo -e "${YELLOW}⚠${NC} $*"; }
fail()  { echo -e "${RED}✗${NC} $*"; exit 1; }

echo ""
echo -e "${BOLD}${CYAN}WrongStack${NC} installer"
echo -e "${DIM}Built on the wrong stack. Shipped anyway.${NC}"
echo ""

# ---- Check Node.js ----
if ! command -v node &>/dev/null; then
  fail "Node.js not found. WrongStack requires Node.js >= 22.\n  Install: https://nodejs.org/"
fi

NODE_VERSION=$(node -v | sed 's/v//' | cut -d. -f1)
if [ "$NODE_VERSION" -lt 22 ]; then
  fail "Node.js $NODE_VERSION found, but WrongStack requires >= 22.\n  Upgrade: https://nodejs.org/"
fi
ok "Node.js $(node -v)"

# ---- Detect package manager ----
if [ -n "${WRONGSTACK_MANAGER:-}" ]; then
  MANAGER="$WRONGSTACK_MANAGER"
elif command -v pnpm &>/dev/null; then
  MANAGER="pnpm"
elif command -v npm &>/dev/null; then
  MANAGER="npm"
else
  fail "Neither pnpm nor npm found. Install one and retry."
fi
ok "Package manager: $MANAGER"

# ---- Install ----
VERSION_FLAG=""
if [ -n "${WRONGSTACK_VERSION:-}" ]; then
  VERSION_FLAG="@$WRONGSTACK_VERSION"
  info "Installing wrongstack@$WRONGSTACK_VERSION…"
else
  info "Installing wrongstack (latest)…"
fi

if [ "$MANAGER" = "pnpm" ]; then
  pnpm install -g "wrongstack${VERSION_FLAG}"
else
  npm install -g "wrongstack${VERSION_FLAG}"
fi

# ---- Verify ----
if command -v wrongstack &>/dev/null; then
  echo ""
  ok "WrongStack installed successfully!"
  echo ""
  echo -e "  ${BOLD}wrongstack${NC} version   ${DIM}# show version${NC}"
  echo -e "  ${BOLD}wrongstack${NC} init      ${DIM}# first-run setup${NC}"
  echo -e "  ${BOLD}wrongstack${NC} --tui     ${DIM}# rich terminal UI${NC}"
  echo ""
  echo -e "  ${DIM}alias: wstack${NC}"
  echo ""
  echo -e "  ${DIM}Get started: wrongstack init${NC}"
  echo ""
else
  warn "wrongstack not found on PATH after install."
  echo -e "  ${DIM}You may need to restart your terminal or add the npm global bin to PATH.${NC}"
  echo -e "  ${DIM}Try: export PATH=\"\$(npm config get prefix)/bin:\$PATH\"${NC}"
fi

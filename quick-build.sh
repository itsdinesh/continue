#!/bin/bash

# Quick Build Script for Development
# This script does a minimal rebuild without reinstalling all dependencies
# Use this for faster iteration during development

set -e

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

echo -e "${BLUE}╔════════════════════════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║  Continue Extension - Quick Build (Development)           ║${NC}"
echo -e "${BLUE}╚════════════════════════════════════════════════════════════╝${NC}"
echo ""

WORKSPACE_ROOT="$(pwd)"

# Detect platform
OS=$(uname -s | tr '[:upper:]' '[:lower:]')
ARCH=$(uname -m)

case "$OS" in
  linux*) PLATFORM="linux" ;;
  darwin*) PLATFORM="darwin" ;;
  mingw*|msys*|cygwin*) PLATFORM="win32" ;;
  *) echo "Unsupported OS: $OS"; exit 1 ;;
esac

case "$ARCH" in
  x86_64|amd64) ARCH="x64" ;;
  aarch64|arm64) ARCH="arm64" ;;
  armv7l) ARCH="armhf" ;;
  *) echo "Unsupported architecture: $ARCH"; exit 1 ;;
esac

TARGET="${PLATFORM}-${ARCH}"

echo -e "${GREEN}Target: ${YELLOW}${TARGET}${NC}"
echo ""

# Quick rebuild of packages (only if source changed)
echo -e "${GREEN}▶ Rebuilding packages...${NC}"
node "$WORKSPACE_ROOT/scripts/build-packages.js"

# Rebuild GUI
echo -e "${GREEN}▶ Rebuilding GUI...${NC}"
cd "$WORKSPACE_ROOT/gui"
npm run build

# Prepackage extension
echo -e "${GREEN}▶ Prepackaging extension...${NC}"
cd "$WORKSPACE_ROOT/extensions/vscode"
npm run prepackage -- --target "$TARGET"

# Package extension
echo -e "${GREEN}▶ Creating .vsix package...${NC}"
npx vsce package --no-dependencies --target "$TARGET"

# Find the generated .vsix file
VSIX_FILE=$(ls -t *.vsix 2>/dev/null | head -1)

if [ -n "$VSIX_FILE" ]; then
  echo ""
  echo -e "${GREEN}✅ Build complete!${NC}"
  echo -e "   ${YELLOW}${VSIX_FILE}${NC}"
  echo ""
  echo -e "${GREEN}Install with:${NC}"
  echo -e "   ${YELLOW}code --install-extension \"$WORKSPACE_ROOT/extensions/vscode/${VSIX_FILE}\"${NC}"
  echo ""
else
  echo -e "${RED}Error: No .vsix file generated${NC}"
  exit 1
fi

#!/bin/bash

# Local VS Code Extension Build Script
# Based on .github/workflows/build-extension.yaml and .github/actions/build-vscode-extension/action.yml
#
# Usage:
#   ./build-extension-local.sh [OPTIONS]
#
# Options:
#   --target <platform-arch>  Target platform (e.g., linux-x64, darwin-arm64, win32-x64)
#   --pre-release            Build as pre-release version
#   --clean                  Clean node_modules before building
#   --skip-tests             Skip running tests
#   --help                   Show this help message
#
# Examples:
#   ./build-extension-local.sh                           # Build for current platform
#   ./build-extension-local.sh --target linux-x64        # Build for Linux x64
#   ./build-extension-local.sh --pre-release --clean     # Clean build as pre-release

set -e  # Exit on error

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Default options
TARGET=""
PRE_RELEASE=false
CLEAN=false
SKIP_TESTS=false

# Parse command line arguments
while [[ $# -gt 0 ]]; do
  case $1 in
    --target)
      TARGET="$2"
      shift 2
      ;;
    --pre-release)
      PRE_RELEASE=true
      shift
      ;;
    --clean)
      CLEAN=true
      shift
      ;;
    --skip-tests)
      SKIP_TESTS=true
      shift
      ;;
    --help)
      grep '^#' "$0" | sed 's/^# //' | sed 's/^#//'
      exit 0
      ;;
    *)
      echo -e "${RED}Unknown option: $1${NC}"
      echo "Use --help for usage information"
      exit 1
      ;;
  esac
done

# Detect current platform if not specified
if [ -z "$TARGET" ]; then
  OS=$(uname -s | tr '[:upper:]' '[:lower:]')
  ARCH=$(uname -m)
  
  case "$OS" in
    linux*)
      PLATFORM="linux"
      ;;
    darwin*)
      PLATFORM="darwin"
      ;;
    mingw*|msys*|cygwin*)
      PLATFORM="win32"
      ;;
    *)
      echo -e "${RED}Unsupported OS: $OS${NC}"
      exit 1
      ;;
  esac
  
  case "$ARCH" in
    x86_64|amd64)
      ARCH="x64"
      ;;
    aarch64|arm64)
      ARCH="arm64"
      ;;
    armv7l)
      ARCH="armhf"
      ;;
    *)
      echo -e "${RED}Unsupported architecture: $ARCH${NC}"
      exit 1
      ;;
  esac
  
  TARGET="${PLATFORM}-${ARCH}"
fi

echo -e "${BLUE}╔════════════════════════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║  Continue VS Code Extension - Local Build Script          ║${NC}"
echo -e "${BLUE}╚════════════════════════════════════════════════════════════╝${NC}"
echo ""
echo -e "${GREEN}Build Configuration:${NC}"
echo -e "  Target:       ${YELLOW}${TARGET}${NC}"
echo -e "  Pre-release:  ${YELLOW}${PRE_RELEASE}${NC}"
echo -e "  Clean build:  ${YELLOW}${CLEAN}${NC}"
echo -e "  Skip tests:   ${YELLOW}${SKIP_TESTS}${NC}"
echo ""

# Get the workspace root (script should be run from repo root)
WORKSPACE_ROOT="$(pwd)"

# Function to print step header
print_step() {
  echo ""
  echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
  echo -e "${GREEN}▶ $1${NC}"
  echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
}

# Function to clean node_modules
clean_node_modules() {
  local dir=$1
  if [ -d "$dir/node_modules" ]; then
    echo -e "${YELLOW}  Cleaning node_modules in $dir${NC}"
    rm -rf "$dir/node_modules"
  fi
}

# Check if Node.js is installed
if ! command -v node &> /dev/null; then
  echo -e "${RED}Error: Node.js is not installed${NC}"
  exit 1
fi

# Check if npm is installed
if ! command -v npm &> /dev/null; then
  echo -e "${RED}Error: npm is not installed${NC}"
  exit 1
fi

echo -e "${GREEN}Node version: $(node --version)${NC}"
echo -e "${GREEN}npm version: $(npm --version)${NC}"

# Clean node_modules if requested
if [ "$CLEAN" = true ]; then
  print_step "Cleaning node_modules directories"
  clean_node_modules "$WORKSPACE_ROOT/packages/config-types"
  clean_node_modules "$WORKSPACE_ROOT/packages/llm-info"
  clean_node_modules "$WORKSPACE_ROOT/packages/fetch"
  clean_node_modules "$WORKSPACE_ROOT/packages/config-yaml"
  clean_node_modules "$WORKSPACE_ROOT/packages/openai-adapters"
  clean_node_modules "$WORKSPACE_ROOT/packages/terminal-security"
  clean_node_modules "$WORKSPACE_ROOT/packages/continue-sdk"
  clean_node_modules "$WORKSPACE_ROOT/core"
  clean_node_modules "$WORKSPACE_ROOT/gui"
  clean_node_modules "$WORKSPACE_ROOT/extensions/vscode"
fi

# Build packages using the build-packages.js script
print_step "Building packages (config-types, llm-info, fetch, config-yaml, openai-adapters, terminal-security, continue-sdk)"
node "$WORKSPACE_ROOT/scripts/build-packages.js"

# Install core dependencies
print_step "Installing core dependencies"
cd "$WORKSPACE_ROOT/core"
npm ci
# Install vectordb as mentioned in the action
npm i vectordb

# Install GUI dependencies
print_step "Installing GUI dependencies"
cd "$WORKSPACE_ROOT/gui"
npm ci

# Install extension dependencies
print_step "Installing extension dependencies"
cd "$WORKSPACE_ROOT/extensions/vscode"
npm ci

# Build GUI
print_step "Building GUI"
cd "$WORKSPACE_ROOT/gui"
export NODE_OPTIONS="--max-old-space-size=4096"
npm run build

# Run tests (unless skipped)
if [ "$SKIP_TESTS" = false ]; then
  print_step "Running tests"
  cd "$WORKSPACE_ROOT/extensions/vscode"
  npm test || {
    echo -e "${YELLOW}Warning: Some tests failed, but continuing with build${NC}"
  }
fi

# Prepackage the extension
print_step "Prepackaging the extension"
cd "$WORKSPACE_ROOT/extensions/vscode"
npm run prepackage -- --target "$TARGET"

# Re-install esbuild (force reinstall to ensure correct binary)
print_step "Re-installing esbuild"
cd "$WORKSPACE_ROOT/extensions/vscode"
npm install -f esbuild

# Package extension (build artifacts)
print_step "Packaging extension (build artifacts)"
cd "$WORKSPACE_ROOT/extensions/vscode"
npm run package

# Package extension (.vsix file)
print_step "Creating .vsix package"
cd "$WORKSPACE_ROOT/extensions/vscode"

if [ "$PRE_RELEASE" = true ]; then
  echo -e "${YELLOW}Building as pre-release${NC}"
  npx vsce package --pre-release --no-dependencies --target "$TARGET"
else
  npx vsce package --no-dependencies --target "$TARGET"
fi

# Find the generated .vsix file
VSIX_FILE=$(ls -t *.vsix 2>/dev/null | head -1)

if [ -n "$VSIX_FILE" ]; then
  VSIX_PATH="$WORKSPACE_ROOT/extensions/vscode/$VSIX_FILE"
  VSIX_SIZE=$(du -h "$VSIX_FILE" | cut -f1)
  
  echo ""
  echo -e "${GREEN}╔════════════════════════════════════════════════════════════╗${NC}"
  echo -e "${GREEN}║  Build Completed Successfully! 🎉                          ║${NC}"
  echo -e "${GREEN}╚════════════════════════════════════════════════════════════╝${NC}"
  echo ""
  echo -e "${GREEN}VSIX Package:${NC}"
  echo -e "  File:   ${YELLOW}${VSIX_FILE}${NC}"
  echo -e "  Size:   ${YELLOW}${VSIX_SIZE}${NC}"
  echo -e "  Path:   ${YELLOW}${VSIX_PATH}${NC}"
  echo ""
  echo -e "${GREEN}To install the extension:${NC}"
  echo -e "  ${YELLOW}code --install-extension \"${VSIX_PATH}\"${NC}"
  echo ""
  echo -e "${GREEN}Or install via VS Code:${NC}"
  echo -e "  1. Open VS Code"
  echo -e "  2. Go to Extensions (Ctrl+Shift+X)"
  echo -e "  3. Click '...' menu → Install from VSIX"
  echo -e "  4. Select: ${YELLOW}${VSIX_PATH}${NC}"
  echo ""
else
  echo -e "${RED}Error: No .vsix file was generated${NC}"
  exit 1
fi

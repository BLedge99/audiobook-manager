#!/usr/bin/env bash
# Idempotent WSL setup for running the Playwright E2E suite.
#
# Installs a self-contained Linux Node under $HOME (no sudo, no apt) and makes
# the root Playwright dependency runnable from bash. Safe to source or execute;
# it exports PATH when sourced so the caller picks it up.
#
# Why this is needed at all: WSL ships no Linux Node, so `npm` resolves to the
# Windows interop binary. That installs .cmd/.ps1 wrappers into node_modules/.bin
# which bash cannot execute, so a Windows-installed Playwright is unusable from
# WSL even though `node_modules` looks correct.
set -uo pipefail

NODE_VERSION="v24.22.1"
INSTALL_DIR="$HOME/.local/node-${NODE_VERSION}"

install_node() {
  case "$(uname -m)" in
    x86_64) NODE_ARCH="linux-x64" ;;
    aarch64) NODE_ARCH="linux-arm64" ;;
    *) echo "unsupported architecture: $(uname -m)"; return 1 ;;
  esac

  if [ ! -x "$INSTALL_DIR/bin/node" ]; then
    echo "=== installing Node ${NODE_VERSION} (${NODE_ARCH}) ==="
    mkdir -p "$INSTALL_DIR"
    local url="https://nodejs.org/dist/${NODE_VERSION}/node-${NODE_VERSION}-${NODE_ARCH}.tar.xz"
    if ! curl -fsSL "$url" | tar -xJ --strip-components=1 -C "$INSTALL_DIR"; then
      echo "download failed: $url"
      return 1
    fi
  fi
  export PATH="$INSTALL_DIR/bin:$PATH"
}

install_node || return 1 2>/dev/null || exit 1

REPO="/mnt/c/Users/benle/Documents/Projects/TechNative/audiobook-manager"
cd "$REPO" || exit 1

# A Windows-installed .bin cannot run here, so reinstall if only wrappers exist.
if ! ls node_modules/.bin/playwright >/dev/null 2>&1 || \
   [ ! -f node_modules/.bin/playwright ] || \
   head -c 2 node_modules/.bin/playwright 2>/dev/null | grep -q 'MZ'; then
  echo "=== reinstalling root dependencies with the Linux npm ==="
  rm -rf node_modules
  npm ci 2>&1 | tail -3
fi

# Playwright pins an exact browser build; a cache from another version fails
# with "Executable doesn't exist at .../chromium_headless_shell-<build>".
if [ ! -d "$HOME/.cache/ms-playwright" ] || \
   ! ls "$HOME/.cache/ms-playwright" | grep -q chromium; then
  echo "=== installing chromium ==="
  npx playwright install chromium 2>&1 | tail -3
fi

echo "ready: node $(node --version), playwright $(npx playwright --version)"

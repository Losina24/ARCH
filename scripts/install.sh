#!/usr/bin/env bash
# One-line installer for ARCH end users.
#
#   curl -fsSL https://raw.githubusercontent.com/Losina24/ARCH/main/scripts/install.sh | sh
#
# Clones ARCH into a dedicated directory, builds it, and links the `archctl`
# and `arch-terminal` executables onto your PATH. Safe to re-run to update.
set -euo pipefail

REPO_URL="https://github.com/Losina24/ARCH.git"
INSTALL_DIR="${ARCH_INSTALL_DIR:-$HOME/.local/share/arch-cli}"

info() { printf '\033[1;34m==>\033[0m %s\n' "$1"; }
fail() { printf '\033[1;31mError:\033[0m %s\n' "$1" >&2; exit 1; }

command -v git >/dev/null 2>&1 || fail "git is required but was not found on PATH."
command -v node >/dev/null 2>&1 || fail "Node.js >= 20 is required but was not found on PATH. Install it from https://nodejs.org/ and re-run this script."

node_major="$(node -e 'console.log(process.versions.node.split(".")[0])')"
if [ "$node_major" -lt 20 ]; then
  fail "Node.js >= 20 is required (found $(node -v))."
fi

if ! command -v pnpm >/dev/null 2>&1; then
  info "pnpm not found, enabling it via Corepack..."
  corepack enable
  corepack prepare pnpm@10 --activate
fi

if [ -d "$INSTALL_DIR/.git" ]; then
  info "Updating existing installation at $INSTALL_DIR..."
  git -C "$INSTALL_DIR" fetch --depth 1 origin
  git -C "$INSTALL_DIR" reset --hard origin/HEAD
else
  info "Cloning ARCH into $INSTALL_DIR..."
  mkdir -p "$(dirname "$INSTALL_DIR")"
  git clone --depth 1 "$REPO_URL" "$INSTALL_DIR"
fi

cd "$INSTALL_DIR"

info "Installing dependencies..."
pnpm install --frozen-lockfile

info "Building ARCH..."
pnpm build

info "Ensuring pnpm's global bin directory is configured..."
pnpm setup >/dev/null 2>&1 || true

info "Linking archctl and arch-terminal globally..."
if ! pnpm run link:global; then
  fail "Could not link archctl/arch-terminal globally. If pnpm just configured its global bin directory for the first time, restart your shell and re-run this script."
fi

echo ""
printf '\033[1;32mDone.\033[0m Restart your shell (so the updated PATH takes effect), then run:\n'
echo "    archctl --help"
echo "    arch-terminal"

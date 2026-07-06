#!/usr/bin/env bash
# install.sh — build Homer, install it to /Applications, and put a global `dv`
# on your PATH so you can run `dv <pr-url>` from inside any repo.
#
# Idempotent: re-run any time to reinstall over a previous install.
# Uninstall with scripts/uninstall.sh.
set -euo pipefail

REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
APP_NAME="Homer.app"
DEST_APP="/Applications/$APP_NAME"
SHIM_SRC="$REPO_DIR/bin/dv-global"

if [ "$(uname)" != "Darwin" ]; then
  echo "error: this installer supports macOS only." >&2
  exit 1
fi

if ! command -v bun >/dev/null 2>&1; then
  echo "error: 'bun' is required to build Homer (https://bun.sh)." >&2
  exit 1
fi

echo "==> Building Homer (bun run dist) — this can take a minute…"
( cd "$REPO_DIR" && bun run dist )

# electron-builder writes the .app under dist/mac* (dist/mac-arm64 on Apple
# Silicon, dist/mac on Intel). Find it rather than hard-coding the arch.
BUILT_APP="$(find "$REPO_DIR/dist" -maxdepth 2 -name "$APP_NAME" -type d 2>/dev/null | head -n1)"
if [ -z "$BUILT_APP" ]; then
  echo "error: could not find $APP_NAME under $REPO_DIR/dist after build." >&2
  exit 1
fi

echo "==> Installing $APP_NAME → $DEST_APP"
rm -rf "$DEST_APP"
cp -R "$BUILT_APP" "$DEST_APP"
# The build is unsigned/un-notarized. Clearing the quarantine flag on the copy
# we just built locally avoids Gatekeeper hard-blocking the first launch.
xattr -dr com.apple.quarantine "$DEST_APP" 2>/dev/null || true

# --- Install the `dv` shim on PATH -----------------------------------------
install_to() {
  # $1 = target bin dir. Uses sudo only if the dir isn't writable.
  local dir="$1"
  if [ -w "$dir" ] || { [ ! -e "$dir" ] && mkdir -p "$dir" 2>/dev/null; }; then
    install -m 0755 "$SHIM_SRC" "$dir/dv"
  else
    echo "==> $dir needs elevated permissions; using sudo…"
    sudo install -m 0755 "$SHIM_SRC" "$dir/dv"
  fi
  SHIM_PATH="$dir/dv"
}

SHIM_PATH=""
if [ -d /usr/local/bin ]; then
  install_to /usr/local/bin
else
  # Homebrew-on-Apple-Silicon and clean systems may not have /usr/local/bin.
  install_to "$HOME/.local/bin"
fi
echo "==> Installed dv → $SHIM_PATH"

# --- Next steps -------------------------------------------------------------
echo
echo "Done. Homer is in /Applications and \`dv\` is at $SHIM_PATH."
echo

SHIM_DIR="$(dirname "$SHIM_PATH")"
case ":$PATH:" in
  *":$SHIM_DIR:"*) : ;;
  *)
    echo "NOTE: $SHIM_DIR is not on your PATH. Add it, e.g.:"
    echo "    echo 'export PATH=\"$SHIM_DIR:\$PATH\"' >> ~/.zshrc && source ~/.zshrc"
    echo
    ;;
esac

echo "First launch (unsigned app): if macOS blocks it, either"
echo "  • right-click /Applications/Homer.app → Open (once), or"
echo "  • run: xattr -dr com.apple.quarantine /Applications/Homer.app"
echo
echo "Prerequisites: 'gh' authenticated (gh auth login) and the 'claude' CLI"
echo "signed in on your subscription."
echo
echo "Use it:  cd <the repo the PR belongs to>  &&  dv <github-pr-url>"

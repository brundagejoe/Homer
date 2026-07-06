#!/usr/bin/env bash
# uninstall.sh — remove the Homer app and the global `homer` shim.
set -euo pipefail

DEST_APP="/Applications/Homer.app"

if [ -d "$DEST_APP" ]; then
  echo "==> Removing $DEST_APP"
  rm -rf "$DEST_APP"
else
  echo "==> $DEST_APP not present, skipping"
fi

# Remove `homer` shims we installed. Guard on our marker so we never delete an
# unrelated `homer` a user may have on PATH.
removed=0
for dir in /usr/local/bin "$HOME/.local/bin"; do
  shim="$dir/homer"
  if [ -f "$shim" ] && grep -q "homer-shim" "$shim" 2>/dev/null; then
    echo "==> Removing $shim"
    if [ -w "$dir" ]; then rm -f "$shim"; else sudo rm -f "$shim"; fi
    removed=1
  fi
done
[ "$removed" -eq 1 ] || echo "==> No Homer 'homer' shim found on PATH, skipping"

echo
echo "Done. (Cached PR Worktrees / Guides live under ~/Library/Application Support/Homer"
echo "and are safe to delete manually if you want to reclaim that space.)"

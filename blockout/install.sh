#!/usr/bin/env bash
# Blockout macOS installer
#
# Downloads the latest release and installs it to /Applications, bypassing
# the Gatekeeper "app is damaged" false alarm that macOS shows for
# browser-downloaded unsigned apps (terminal downloads aren't quarantined).
#
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/wassermanproductions/blockout/main/install.sh | bash
set -euo pipefail

REPO="wassermanproductions/blockout"

if [ "$(uname -m)" != "arm64" ]; then
  echo "Blockout for macOS currently ships for Apple Silicon (M1–M4) only." >&2
  echo "On Intel Macs, build from source — see the README." >&2
  exit 1
fi

echo "Finding the latest Blockout release..."
URL="$(curl -fsSL "https://api.github.com/repos/$REPO/releases?per_page=20" \
  | grep -o 'https://[^"]*mac-arm64\.dmg' | head -1)"
if [ -z "$URL" ]; then
  echo "Could not find a macOS download — see https://github.com/$REPO/releases" >&2
  exit 1
fi

DEST="/Applications"
if [ ! -w "$DEST" ]; then
  DEST="$HOME/Applications"
  mkdir -p "$DEST"
fi

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

echo "Downloading Blockout..."
curl -fL --progress-bar "$URL" -o "$TMP/blockout.dmg"

echo "Installing to $DEST..."
MNT="$(hdiutil attach "$TMP/blockout.dmg" -nobrowse | awk -F'\t' '/\/Volumes\//{print $3; exit}')"
rm -rf "$DEST/Blockout.app"
ditto "$MNT/Blockout.app" "$DEST/Blockout.app"
hdiutil detach "$MNT" -quiet
xattr -cr "$DEST/Blockout.app" 2>/dev/null || true

echo "✓ Blockout installed — launching."
open "$DEST/Blockout.app"

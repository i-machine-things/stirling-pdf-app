#!/bin/bash
# Downloads the Stirling-PDF no-login/single-user release jar into backend/.
# Not committed to git (see .gitignore) — re-downloadable, ~300MB.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_DIR="$SCRIPT_DIR/../backend"
mkdir -p "$BACKEND_DIR"
cd "$BACKEND_DIR"

echo "Fetching latest Stirling-PDF release info..."
RELEASE_JSON="$(mktemp)"
trap 'rm -f "$RELEASE_JSON"' EXIT
curl -fsSL https://api.github.com/repos/Stirling-Tools/Stirling-PDF/releases/latest -o "$RELEASE_JSON"

URL=$(grep -o '"browser_download_url": *"[^"]*Stirling-PDF\.jar"' "$RELEASE_JSON" | sed -E 's/.*"(https[^"]+)"/\1/')

if [ -z "$URL" ]; then
  echo "ERROR: could not find Stirling-PDF.jar asset in the latest release" >&2
  exit 1
fi

echo "Downloading $URL"
curl -fL -o Stirling-PDF.jar "$URL"
echo "Saved to $BACKEND_DIR/Stirling-PDF.jar"

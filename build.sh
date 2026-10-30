#!/usr/bin/env bash
# Génère le paquet Chrome dans dist/.
# Usage : ./build.sh
set -euo pipefail
cd "$(dirname "$0")"

mkdir -p dist

zip -j dist/easystream-chrome.zip manifest.json background.js popup.html popup.js

echo "OK :"
echo "  dist/easystream-chrome.zip  -> Chrome / Edge / Brave"

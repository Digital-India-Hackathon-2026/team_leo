#!/usr/bin/env sh
set -eu

if ! command -v node >/dev/null 2>&1; then
  echo "Personacode requires Node.js 22 or newer: https://nodejs.org" >&2
  exit 1
fi

major="$(node -p 'process.versions.node.split(".")[0]')"
if [ "$major" -lt 22 ]; then
  echo "Personacode requires Node.js 22 or newer (found $(node -v))." >&2
  exit 1
fi

npm install --global personacode
echo "Installed Personacode. Run: pcode"

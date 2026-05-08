#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
TOKEN="${NPM_TOKEN:-${1:-}}"

if [ -z "$TOKEN" ]; then
  echo "usage: NPM_TOKEN=<token> ./scripts/publish-with-token.sh"
  echo "or: ./scripts/publish-with-token.sh <token>"
  exit 1
fi

NPMRC_PATH="$(mktemp)"
trap 'rm -f "$NPMRC_PATH"' EXIT

printf "//registry.npmjs.org/:_authToken=%s\n" "$TOKEN" > "$NPMRC_PATH"

cd "$ROOT_DIR"
npm whoami --userconfig "$NPMRC_PATH"
npm test
npm publish --access public --userconfig "$NPMRC_PATH"

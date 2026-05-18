#!/usr/bin/env bash
# Install postcraftstudio agent + commands into the user-level OpenCode config.
set -euo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
oc_home="${OPENCODE_CONFIG:-$HOME/.config/opencode}"
mkdir -p "$oc_home/agent" "$oc_home/command"

ln -sf "$here/agent/postcraftstudio.md" "$oc_home/agent/postcraftstudio.md"
echo "linked agent/postcraftstudio.md"

for f in "$here"/command/postcraft-*.md; do
  ln -sf "$f" "$oc_home/command/$(basename "$f")"
  echo "linked command/$(basename "$f")"
done

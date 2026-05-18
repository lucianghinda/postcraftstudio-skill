#!/usr/bin/env bash
# Install postcraftstudio prompts + AGENTS.md fragment into ~/.codex.
# Idempotent: re-running just refreshes symlinks.
set -euo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
codex_home="${CODEX_HOME:-$HOME/.codex}"
mkdir -p "$codex_home/prompts"

for f in "$here"/prompts/postcraft-*.md; do
  ln -sf "$f" "$codex_home/prompts/$(basename "$f")"
  echo "linked $(basename "$f")"
done

agents_target="$codex_home/AGENTS.md"
marker="<!-- postcraftstudio:begin -->"
if [ -f "$agents_target" ] && grep -qF "$marker" "$agents_target"; then
  echo "AGENTS.md already references postcraftstudio — skipping"
else
  {
    [ -f "$agents_target" ] && echo
    echo "$marker"
    echo "See $here/AGENTS.md for the full Postcraftstudio agent instructions."
    echo "<!-- postcraftstudio:end -->"
  } >> "$agents_target"
  echo "appended pointer to $agents_target"
fi

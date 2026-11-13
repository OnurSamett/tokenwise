#!/usr/bin/env bash
# Installs model-router globally into ~/.claude (skills + agents).
set -euo pipefail
SRC="$(cd "$(dirname "$0")" && pwd)"
DEST="${CLAUDE_HOME:-$HOME/.claude}"
mkdir -p "$DEST/skills" "$DEST/agents"
rm -rf "$DEST/skills/model-router"
cp -R "$SRC/skills/model-router" "$DEST/skills/model-router"
for f in "$SRC"/agents/*.md; do cp "$f" "$DEST/agents/"; done
echo "model-router installed to $DEST (skill + 3 agents). Restart Claude Code sessions to pick it up."

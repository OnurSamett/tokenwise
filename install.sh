#!/usr/bin/env bash
# Installs tokenwise globally into ~/.claude (skill + agents).
set -euo pipefail
SRC="$(cd "$(dirname "$0")" && pwd)"
DEST="${CLAUDE_HOME:-$HOME/.claude}"
mkdir -p "$DEST/skills" "$DEST/agents"
# Remove files from the earlier "model-router" name, if present.
rm -rf "$DEST/skills/model-router"
rm -f "$DEST/agents/router-scout.md" "$DEST/agents/router-builder.md" "$DEST/agents/router-architect.md"
rm -rf "$DEST/skills/tokenwise"
cp -R "$SRC/skills/tokenwise" "$DEST/skills/tokenwise"
for f in "$SRC"/agents/*.md; do cp "$f" "$DEST/agents/"; done
echo "tokenwise installed to $DEST (skill + 3 agents). Start a new Claude Code session to use it."

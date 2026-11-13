#!/usr/bin/env bash
# Installs tokenwise for every supported agent found on this machine:
#   Claude Code (~/.claude), OpenAI Codex CLI (~/.codex/skills), Google Gemini CLI (gemini skills link).
# Usage: ./install.sh [claude|codex|gemini ...]   (default: all that are installed)
set -euo pipefail
SRC="$(cd "$(dirname "$0")" && pwd)"
TARGETS=("$@"); [ ${#TARGETS[@]} -eq 0 ] && TARGETS=(claude codex gemini)
has() { command -v "$1" >/dev/null 2>&1; }

# Build the portable (Codex/Gemini) skill folder: host SKILL.md + shared scripts/references.
build_portable() {
  local out="$1"
  rm -rf "$out"; mkdir -p "$out"
  cp "$SRC/hosts/agents/SKILL.md" "$out/SKILL.md"
  cp -R "$SRC/skills/tokenwise/scripts" "$out/scripts"
  mkdir -p "$out/references"
  cp "$SRC/skills/tokenwise/references/effort-guide.md" "$out/references/"
}

for t in "${TARGETS[@]}"; do
  case "$t" in
    claude)
      DEST="${CLAUDE_HOME:-$HOME/.claude}"
      mkdir -p "$DEST/skills" "$DEST/agents"
      rm -rf "$DEST/skills/model-router"
      rm -f "$DEST/agents/router-scout.md" "$DEST/agents/router-builder.md" "$DEST/agents/router-architect.md"
      rm -rf "$DEST/skills/tokenwise"
      cp -R "$SRC/skills/tokenwise" "$DEST/skills/tokenwise"
      for f in "$SRC"/agents/*.md; do cp "$f" "$DEST/agents/"; done
      echo "claude: installed to $DEST (skill + 3 agents)"
      ;;
    codex)
      if [ -d "${CODEX_HOME:-$HOME/.codex}" ] || has codex; then
        build_portable "${CODEX_HOME:-$HOME/.codex}/skills/tokenwise"
        echo "codex: installed to ${CODEX_HOME:-$HOME/.codex}/skills/tokenwise"
      else echo "codex: not found, skipped"; fi
      ;;
    gemini)
      if has gemini; then
        G="$HOME/.tokenwise/gemini/tokenwise"; build_portable "$G"
        gemini skills uninstall tokenwise >/dev/null 2>&1 || true
        if gemini skills link "$G" --consent </dev/null >/dev/null 2>&1; then echo "gemini: linked $G"
        else echo "gemini: could not link automatically; run: gemini skills link \"$G\" --consent"; fi
      else echo "gemini: not found, skipped"; fi
      ;;
    *) echo "unknown target: $t" ;;
  esac
done
echo "Start a new session in each tool to pick it up."

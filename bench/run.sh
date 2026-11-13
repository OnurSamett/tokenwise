#!/usr/bin/env bash
# tokenwise benchmark: same task, with and without tokenwise, headless Claude Code.
# Usage: bench/run.sh [runs-per-condition=1] [model=opus] [suite=small|large]
# Needs: `claude` CLI signed in (claude auth login). Uses your Claude usage.
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
RUNS="${1:-1}"; MODEL="${2:-opus}"; SUITE="${3:-small}"
OUT="$HERE/results/$(date +%Y%m%d-%H%M%S)-$SUITE"; mkdir -p "$OUT"
if [ "$SUITE" = large ]; then
  TASK="$(cat "$HERE/large/task.md")"; VERIFY="$HERE/large/verify.py"
else
  TASK="$(cat "$HERE/task.md")"; VERIFY="$HERE/verify.py"
fi
CH="${CLAUDE_HOME:-$HOME/.claude}"
STASH="$(mktemp -d)"

# Files that make up an installed tokenwise (hidden during baseline runs).
TW_PATHS=("$CH/skills/tokenwise" "$CH/agents/tokenwise-scout.md" "$CH/agents/tokenwise-builder.md" "$CH/agents/tokenwise-architect.md")

hide_tokenwise() { for p in "${TW_PATHS[@]}"; do [ -e "$p" ] && mv "$p" "$STASH/"; done; }
restore_tokenwise() { for p in "${TW_PATHS[@]}"; do b="$STASH/$(basename "$p")"; [ -e "$b" ] && mv "$b" "$p"; done; }
trap restore_tokenwise EXIT INT TERM

[ -d "$CH/skills/tokenwise" ] || { echo "tokenwise is not installed in $CH — run ./install.sh first"; exit 1; }
claude auth status 2>/dev/null | grep -q '"loggedIn": true' || { echo "claude CLI not signed in — run: claude auth login"; exit 1; }

ALLOWED='Read Edit Write Glob Grep Agent Task Skill Bash(python3:*) Bash(ls:*) Bash(cat:*) Bash(grep:*) Bash(find:*) Bash(wc:*)'

run_one() {  # $1 = condition (baseline|tokenwise), $2 = index
  local cond="$1" i="$2" work; work="$(mktemp -d)/repo"
  if [ "$SUITE" = large ]; then python3 "$HERE/large/make_fixture.py" "$work" >/dev/null
  else cp -R "$HERE/fixture" "$work"; fi
  [ "$cond" = baseline ] && hide_tokenwise
  local t0=$SECONDS
  ( cd "$work" && claude -p "$TASK" --model "$MODEL" --output-format json \
      --permission-mode acceptEdits --allowedTools $ALLOWED ) > "$OUT/$cond-$i.json" 2> "$OUT/$cond-$i.err"
  local dt=$((SECONDS - t0))
  [ "$cond" = baseline ] && restore_tokenwise
  python3 "$VERIFY" "$work" > "$OUT/$cond-$i.verify.json" 2>/dev/null || echo '{}' > "$OUT/$cond-$i.verify.json"
  echo "$dt" > "$OUT/$cond-$i.secs"
  echo "  $cond #$i done in ${dt}s: $(cat "$OUT/$cond-$i.verify.json")"
}

echo "results -> $OUT"
for i in $(seq 1 "$RUNS"); do
  # Alternate order so neither condition always runs first.
  if (( i % 2 )); then run_one baseline "$i"; run_one tokenwise "$i"
  else run_one tokenwise "$i"; run_one baseline "$i"; fi
done
python3 "$HERE/summarize.py" "$OUT" | tee "$OUT/summary.md"

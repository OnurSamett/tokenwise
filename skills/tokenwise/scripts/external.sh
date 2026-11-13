#!/usr/bin/env bash
# tokenwise external workers: hand work to other AI CLIs (OpenAI Codex, Google Gemini)
# so it doesn't consume Claude usage — and to do things Claude can't (image generation).
#
# Usage:
#   external.sh check
#   external.sh image <out.png> "<prompt>"              [-m luna|terra|sol] [-e low|medium|high]
#   external.sh ask <codex|gemini|claude> "<prompt>"    [-m MODEL] [-e low|medium|high|xhigh]
#     codex models: luna|terra|sol|astra   claude models: haiku|sonnet|opus   gemini: any -m name
#
# Codex model families, cheapest first: luna < terra < sol < astra.
#   Defaults: ask -> sol/medium, image -> terra/medium.
#   Override: TOKENWISE_CODEX_MODEL / TOKENWISE_CODEX_IMAGE_MODEL / TOKENWISE_CODEX_EFFORT.
#   astra burns ChatGPT limits very fast; it is BLOCKED unless TOKENWISE_CODEX_ASTRA=1
#   (set it only if you are on a high-limit plan, e.g. Pro).
#
# Uses the user's own Codex (ChatGPT plan) / Gemini (Google account) sign-in.
# This script never prints or stores API keys.
set -uo pipefail

has() { command -v "$1" >/dev/null 2>&1; }

codex_ready() { has codex && codex login status 2>&1 | grep -qi "logged in"; }
gemini_ready() {
  has gemini || return 1
  [ -n "${GEMINI_API_KEY:-}" ] || [ -n "${GOOGLE_API_KEY:-}" ] || [ -f "$HOME/.gemini/oauth_creds.json" ]
}

# Resolve a family alias (luna/terra/sol/astra) to the newest listed Codex model slug.
codex_slug() {
  local fam="$1"
  case "$fam" in
    luna|terra|sol|astra) ;;
    *) echo "$fam"; return ;;   # already a full slug
  esac
  codex debug models 2>/dev/null | python3 -c '
import json, sys
fam = sys.argv[1]
d = json.load(sys.stdin)
ms = d.get("models", d) if isinstance(d, dict) else d
ms = [m for m in ms if isinstance(m, dict) and m.get("visibility") == "list"
      and str(m.get("slug", "")).endswith("-" + fam)]
ms.sort(key=lambda m: m.get("priority", 999))
print(ms[0]["slug"] if ms else "")
' "$fam"
}

# Parse trailing -m/-e options.
MODEL=""; EFFORT=""
parse_opts() {
  while [ $# -gt 0 ]; do
    case "$1" in
      -m) MODEL="${2:-}"; shift 2 ;;
      -e) EFFORT="${2:-}"; shift 2 ;;
      *) echo "unknown option: $1" >&2; exit 2 ;;
    esac
  done
}

codex_model_args() {
  local default_fam="${1:-${TOKENWISE_CODEX_MODEL:-sol}}"
  local fam="${MODEL:-$default_fam}" eff="${EFFORT:-${TOKENWISE_CODEX_EFFORT:-medium}}"
  if [[ "$fam" == *astra* ]] && [ "${TOKENWISE_CODEX_ASTRA:-0}" != "1" ]; then
    echo "ERROR: astra is blocked (it uses ChatGPT limits very fast). Use sol, or set TOKENWISE_CODEX_ASTRA=1 if your plan allows it." >&2
    exit 3
  fi
  if [ "$eff" = "max" ] || [ "$eff" = "ultra" ]; then
    echo "ERROR: effort '$eff' is not allowed from tokenwise; use up to xhigh." >&2; exit 3
  fi
  local slug; slug="$(codex_slug "$fam")"
  [ -n "$slug" ] || { echo "ERROR: no Codex model found for '$fam'." >&2; exit 2; }
  CODEX_ARGS=(-m "$slug" -c "model_reasoning_effort=\"$eff\"")
  echo "codex model: $slug / $eff" >&2
}

claude_ready() { has claude && claude auth status 2>/dev/null | grep -q '"loggedIn": true'; }

cmd="${1:-}"; shift || true

case "$cmd" in
  check)
    if codex_ready; then
      echo "codex: ready (images: yes) — models: luna=$(codex_slug luna) terra=$(codex_slug terra) sol=$(codex_slug sol) astra=$(codex_slug astra) [astra $( [ "${TOKENWISE_CODEX_ASTRA:-0}" = 1 ] && echo allowed || echo blocked )]"
    elif has codex; then echo "codex: installed, NOT signed in -> user runs: codex login";
    else echo "codex: not installed -> npm install -g @openai/codex"; fi
    if gemini_ready; then echo "gemini: ready (images: no)";
    elif has gemini; then echo "gemini: installed, NOT signed in -> user runs: gemini (choose 'Sign in with Google')";
    else echo "gemini: not installed -> npm install -g @google/gemini-cli"; fi
    if claude_ready; then echo "claude: ready (models: haiku, sonnet, opus)";
    elif has claude; then echo "claude: installed, NOT signed in -> user runs: claude auth login";
    else echo "claude: not installed -> npm install -g @anthropic-ai/claude-code"; fi
    ;;

  image)
    out="${1:?output path required}"; prompt="${2:?prompt required}"; shift 2
    parse_opts "$@"
    codex_ready || { echo "ERROR: codex not ready. Run: $0 check" >&2; exit 2; }
    codex_model_args "${TOKENWISE_CODEX_IMAGE_MODEL:-terra}"
    work="$(mktemp -d)"
    ( cd "$work" && codex exec --skip-git-repo-check --sandbox workspace-write "${CODEX_ARGS[@]}" \
        "Use your image generation tool to create ONE image and save it in the current directory as image.png. Image description: ${prompt}. After saving, reply only with: image.png" \
        >"$work/log.txt" 2>&1 )
    if [ -f "$work/image.png" ]; then
      mkdir -p "$(dirname "$out")" && mv "$work/image.png" "$out" && echo "saved: $out"
      rm -rf "$work"
    else
      echo "ERROR: no image produced. Last log lines:" >&2; tail -20 "$work/log.txt" >&2; exit 1
    fi
    ;;

  ask)
    who="${1:?codex|gemini}"; prompt="${2:?prompt required}"; shift 2
    parse_opts "$@"
    case "$who" in
      codex)
        codex_ready || { echo "ERROR: codex not ready. Run: $0 check" >&2; exit 2; }
        codex_model_args
        last="$(mktemp)"
        codex exec --skip-git-repo-check --sandbox read-only "${CODEX_ARGS[@]}" --output-last-message "$last" "$prompt" >/dev/null 2>&1
        cat "$last"; rm -f "$last"
        ;;
      gemini)
        gemini_ready || { echo "ERROR: gemini not ready. Run: $0 check" >&2; exit 2; }
        if [ -n "$MODEL" ]; then gemini -m "$MODEL" -p "$prompt" 2>/dev/null; else gemini -p "$prompt" 2>/dev/null; fi
        ;;
      claude)
        claude_ready || { echo "ERROR: claude not ready. Run: $0 check" >&2; exit 2; }
        m="${MODEL:-${TOKENWISE_CLAUDE_MODEL:-haiku}}"; e="${EFFORT:-${TOKENWISE_CLAUDE_EFFORT:-low}}"
        if [ "$e" = "max" ]; then echo "ERROR: effort 'max' is not allowed from tokenwise; use up to xhigh." >&2; exit 3; fi
        echo "claude model: $m / $e" >&2
        claude -p "$prompt" --model "$m" --effort "$e" --permission-mode plan --output-format text 2>/dev/null
        ;;
      *) echo "unknown worker: $who" >&2; exit 2 ;;
    esac
    ;;

  *)
    sed -n '2,18p' "$0"; exit 2 ;;
esac

#!/usr/bin/env bash
# tokenwise external workers: hand work to other AI CLIs (OpenAI Codex, Google Gemini)
# so it doesn't consume Claude usage — and to do things Claude can't (image generation).
#
# Usage:
#   external.sh check
#   external.sh image <out.png> "<prompt>"              [-m luna|terra|sol] [-e low|medium|high]
#   external.sh ask <codex|gemini|claude> "<prompt>"    [-m MODEL] [-e low|medium|high|xhigh]
#   external.sh ask local "<prompt>"                    [-m MODEL]   # Ollama via Codex CLI --oss (default gpt-oss:20b, TOKENWISE_LOCAL_MODEL); free, unlimited, full agent
#   external.sh ask free  "<prompt>"                    [-m MODEL]   # NVIDIA / OpenRouter :free / Groq / Mistral (first key set); read-only text,
#                                                                    # opt-in: TOKENWISE_ALLOW_FREE=1 (free tiers may train on prompts); TOKENWISE_FREE_MODEL
#     codex models: luna|terra|sol|astra   claude models: haiku|sonnet|opus
#     gemini (via Antigravity): hydrogen (default) | argon (frontier) | flash (older), or any -m name with Gemini CLI + API key
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
# Google-account sign-in no longer works for individuals in Gemini CLI (IneligibleTierError),
# so only an API key (or Vertex AI via GOOGLE_API_KEY / GOOGLE_CLOUD_PROJECT) counts as ready.
# Google Antigravity CLI: runs Gemini with a personal Google account (ships inside Gemini.app on macOS).
agy_bin() {
  for p in "${TOKENWISE_AGY:-}" /Applications/Gemini.app/Contents/Helpers/agy /Applications/Antigravity.app/Contents/Helpers/agy; do
    [ -n "$p" ] && [ -x "$p" ] && { echo "$p"; return 0; }
  done
  command -v agy 2>/dev/null
}
agy_ready() { local a; a="$(agy_bin)" && [ -n "$a" ] && "$a" models >/dev/null 2>&1; }
# Pick an Antigravity model id: family (flash|argon|hydrogen) + effort, e.g. gemini-3.8-flash-low.
agy_model() {
  local fam="${1:-hydrogen}" eff="${2:-medium}" a; a="$(agy_bin)"
  "$a" models 2>/dev/null | cut -f1 | grep "^gemini.*-${fam}-" | grep -m1 -- "-${eff}\$" \
    || "$a" models 2>/dev/null | cut -f1 | grep -m1 "^gemini.*-${fam}-"
}

gemini_ready() {
  agy_ready && return 0
  has gemini || return 1
  [ -n "${GEMINI_API_KEY:-}" ] || [ -n "${GOOGLE_API_KEY:-}" ] || [ -n "${GOOGLE_GENAI_USE_VERTEXAI:-}" ]
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

# Local fallback: Ollama driven through Codex CLI's --oss mode.
local_model() { echo "${MODEL:-${TOKENWISE_LOCAL_MODEL:-gpt-oss:20b}}"; }
local_problem() {  # prints what is missing (empty if ready)
  local m; m="$(local_model)"
  has ollama || { echo "ollama not installed -> brew install ollama"; return; }
  has codex || { echo "codex not installed -> npm install -g @openai/codex"; return; }
  ollama list >/dev/null 2>&1 || { echo "Ollama server not running -> ollama serve (or: brew services start ollama)"; return; }
  ollama list 2>/dev/null | awk 'NR>1{print $1}' | grep -qx "$m" || echo "model $m not pulled -> ollama pull $m"
}

# Free-tier API fallback (OpenAI-compatible). Sets FREE_NAME / FREE_BASE / FREE_KEY.
free_provider() {
  # First configured provider wins: NVIDIA (build.nvidia.com), OpenRouter :free, Groq, Mistral, or a custom endpoint.
  if [ -n "${NVIDIA_API_KEY:-}" ]; then FREE_NAME=nvidia; FREE_BASE="https://integrate.api.nvidia.com/v1"; FREE_KEY="$NVIDIA_API_KEY"
  elif [ -n "${OPENROUTER_API_KEY:-}" ]; then FREE_NAME=openrouter; FREE_BASE="https://openrouter.ai/api/v1"; FREE_KEY="$OPENROUTER_API_KEY"
  elif [ -n "${GROQ_API_KEY:-}" ]; then FREE_NAME=groq; FREE_BASE="https://api.groq.com/openai/v1"; FREE_KEY="$GROQ_API_KEY"
  elif [ -n "${MISTRAL_API_KEY:-}" ]; then FREE_NAME=mistral; FREE_BASE="https://api.mistral.ai/v1"; FREE_KEY="$MISTRAL_API_KEY"
  elif [ -n "${TOKENWISE_FREE_BASE:-}" ] && [ -n "${TOKENWISE_FREE_KEY:-}" ]; then FREE_NAME=custom; FREE_BASE="${TOKENWISE_FREE_BASE%/}"; FREE_KEY="$TOKENWISE_FREE_KEY"
  else return 1; fi
}

claude_ready() { has claude && claude auth status 2>/dev/null | grep -q '"loggedIn": true'; }

cmd="${1:-}"; shift || true

case "$cmd" in
  check)
    if codex_ready; then
      echo "codex: ready (images: yes) — models: luna=$(codex_slug luna) terra=$(codex_slug terra) sol=$(codex_slug sol) astra=$(codex_slug astra) [astra $( [ "${TOKENWISE_CODEX_ASTRA:-0}" = 1 ] && echo allowed || echo blocked )]"
    elif has codex; then echo "codex: installed, NOT signed in -> user runs: codex login";
    else echo "codex: not installed -> npm install -g @openai/codex"; fi
    if agy_ready; then echo "gemini: ready via Antigravity (models: hydrogen = fast default, argon = frontier)";
    elif gemini_ready; then echo "gemini: ready via Gemini CLI + API key";
    elif has gemini; then echo "gemini: installed, needs an API key -> get one at aistudio.google.com, then: export GEMINI_API_KEY=... (Google sign-in no longer works for individuals)";
    else echo "gemini: not installed -> npm install -g @google/gemini-cli"; fi
    if claude_ready; then echo "claude: ready (models: haiku, sonnet, opus)";
    elif has claude; then echo "claude: installed, NOT signed in -> user runs: claude auth login";
    else echo "claude: not installed -> npm install -g @anthropic-ai/claude-code"; fi
    lp="$(local_problem)"
    if [ -z "$lp" ]; then echo "local: ready (ollama, model $(local_model))"; else echo "local: $lp"; fi
    if free_provider; then echo "free: ready via $FREE_NAME (opt-in: $( [ "${TOKENWISE_ALLOW_FREE:-0}" = 1 ] && echo on || echo off ))";
    else echo "free: not configured -> export NVIDIA_API_KEY=... (build.nvidia.com) or OPENROUTER_API_KEY / GROQ_API_KEY / MISTRAL_API_KEY, plus TOKENWISE_ALLOW_FREE=1 to opt in"; fi
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
    who="${1:?codex|gemini|claude|local|free}"; prompt="${2:?prompt required}"; shift 2
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
        if agy_ready; then
          m="$(agy_model "${MODEL:-${TOKENWISE_GEMINI_MODEL:-hydrogen}}" "${EFFORT:-medium}")"
          [ -n "$m" ] || { echo "ERROR: no Antigravity Gemini model for '${MODEL:-hydrogen}'" >&2; exit 2; }
          echo "gemini model: $m (Antigravity)" >&2
          "$(agy_bin)" -p "$prompt" --model "$m" --mode plan --print-timeout 0s 2>/dev/null
          exit $?
        fi
        gemini_ready || { echo "ERROR: gemini not ready. Run: $0 check" >&2; exit 2; }
        if [ -n "$MODEL" ]; then gemini --skip-trust --approval-mode plan -m "$MODEL" -p "$prompt" 2>/dev/null; else gemini --skip-trust --approval-mode plan -p "$prompt" 2>/dev/null; fi
        ;;
      claude)
        claude_ready || { echo "ERROR: claude not ready. Run: $0 check" >&2; exit 2; }
        m="${MODEL:-${TOKENWISE_CLAUDE_MODEL:-haiku}}"; e="${EFFORT:-${TOKENWISE_CLAUDE_EFFORT:-low}}"
        if [ "$e" = "max" ]; then echo "ERROR: effort 'max' is not allowed from tokenwise; use up to xhigh." >&2; exit 3; fi
        echo "claude model: $m / $e" >&2
        claude -p "$prompt" --model "$m" --effort "$e" --permission-mode plan --output-format text 2>/dev/null
        ;;
      local)
        lp="$(local_problem)"
        [ -z "$lp" ] || { echo "ERROR: local worker not ready: $lp" >&2; exit 2; }
        m="$(local_model)"; echo "local model: $m (Ollama)" >&2
        last="$(mktemp)"
        codex exec --oss --local-provider ollama -m "$m" --skip-git-repo-check --sandbox read-only --output-last-message "$last" "$prompt" >/dev/null 2>&1
        cat "$last"; rm -f "$last"
        ;;
      free)
        [ "${TOKENWISE_ALLOW_FREE:-0}" = "1" ] || { echo "ERROR: free providers may use prompts for training; opt in with TOKENWISE_ALLOW_FREE=1" >&2; exit 3; }
        free_provider || { echo "ERROR: no free provider: set NVIDIA_API_KEY, OPENROUTER_API_KEY, GROQ_API_KEY or MISTRAL_API_KEY" >&2; exit 2; }
        has node || { echo "ERROR: node not found (needed for the free agent)" >&2; exit 2; }
        # Read-only tool loop (list/read/search files in the current folder) on free hosted models.
        [ -n "$MODEL" ] && export TOKENWISE_FREE_MODEL="$MODEL"
        node "$(dirname "$0")/freeagent.js" "$prompt" | python3 -c '
import json, sys
ans, err = None, None
for line in sys.stdin:
    try: e = json.loads(line)
    except Exception: continue
    t = e.get("type")
    if t == "free.init": print("free model: %s (%s)" % (e.get("model"), e.get("provider")), file=sys.stderr)
    elif t == "free.message": ans = e.get("text", "")
    elif t == "free.error": err = e.get("message", "error")
if ans is not None: print(ans)
else: print("ERROR: " + (err or "no answer"), file=sys.stderr); sys.exit(1)
'
        exit $?
        ;;
      *) echo "unknown worker: $who" >&2; exit 2 ;;
    esac
    ;;

  *)
    sed -n '2,22p' "$0"; exit 2 ;;
esac

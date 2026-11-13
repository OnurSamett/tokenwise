#!/usr/bin/env bash
# tokenwise external workers: hand work to other AI CLIs (OpenAI Codex, Google Gemini)
# so it doesn't consume Claude usage — and to do things Claude can't (image generation).
#
# Usage:
#   external.sh check                         # which workers are installed + signed in
#   external.sh image <out.png> "<prompt>"    # generate an image (Codex) and save it
#   external.sh ask <codex|gemini> "<prompt>" # read-only question/task, prints the answer
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

cmd="${1:-}"; shift || true

case "$cmd" in
  check)
    if codex_ready; then echo "codex: ready (images: yes)";
    elif has codex; then echo "codex: installed, NOT signed in -> user runs: codex login";
    else echo "codex: not installed -> npm install -g @openai/codex"; fi
    if gemini_ready; then echo "gemini: ready (images: no)";
    elif has gemini; then echo "gemini: installed, NOT signed in -> user runs: gemini (choose 'Sign in with Google')";
    else echo "gemini: not installed -> npm install -g @google/gemini-cli"; fi
    ;;

  image)
    out="${1:?output path required}"; prompt="${2:?prompt required}"
    codex_ready || { echo "ERROR: codex not ready. Run: $0 check" >&2; exit 2; }
    work="$(mktemp -d)"
    ( cd "$work" && codex exec --skip-git-repo-check --sandbox workspace-write \
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
    who="${1:?codex|gemini}"; prompt="${2:?prompt required}"
    case "$who" in
      codex)
        codex_ready || { echo "ERROR: codex not ready. Run: $0 check" >&2; exit 2; }
        last="$(mktemp)"
        codex exec --skip-git-repo-check --sandbox read-only --output-last-message "$last" "$prompt" >/dev/null 2>&1
        cat "$last"; rm -f "$last"
        ;;
      gemini)
        gemini_ready || { echo "ERROR: gemini not ready. Run: $0 check" >&2; exit 2; }
        gemini -p "$prompt" 2>/dev/null
        ;;
      *) echo "unknown worker: $who" >&2; exit 2 ;;
    esac
    ;;

  *)
    sed -n '2,12p' "$0"; exit 2 ;;
esac

#!/usr/bin/env bash
# Load MiniMax settings from /workspace/.env without echoing secrets.
set -euo pipefail

ENV_FILE="${MINIMAX_ENV_FILE:-/workspace/.env}"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "Missing $ENV_FILE. MiniMax is not configured." >&2
  exit 1
fi

set -a
# shellcheck disable=SC1090
source "$ENV_FILE"
set +a

if [[ -z "${MINIMAX_API_KEY:-}" && -z "${OPENAI_API_KEY:-}" ]]; then
  echo "Set MINIMAX_API_KEY or OPENAI_API_KEY in $ENV_FILE." >&2
  exit 1
fi

# MiniMax OpenAI-compatible API can be used through OPENAI_* variables.
export OPENAI_API_KEY="${OPENAI_API_KEY:-$MINIMAX_API_KEY}"
export OPENAI_BASE_URL="${OPENAI_BASE_URL:-https://api.minimax.io/v1}"

echo "MiniMax environment loaded (model=${MINIMAX_MODEL:-MiniMax-M3})."

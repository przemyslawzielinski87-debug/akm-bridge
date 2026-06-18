#!/usr/bin/env bash
# Ładuje MiniMax z /workspace/.env (bez drukowania sekretów)
set -euo pipefail
ENV_FILE="${MINIMAX_ENV_FILE:-/workspace/.env}"
if [[ ! -f "$ENV_FILE" ]]; then
  echo "Brak $ENV_FILE — MiniMax nie skonfigurowany." >&2
  exit 1
fi
set -a
# shellcheck disable=SC1090
source "$ENV_FILE"
set +a
if [[ -z "${MINIMAX_API_KEY:-}" ]]; then
  echo "MINIMAX_API_KEY pusty w $ENV_FILE" >&2
  exit 1
fi
export OPENAI_API_KEY="${OPENAI_API_KEY:-$MINIMAX_API_KEY}"
export OPENAI_BASE_URL="${OPENAI_BASE_URL:-https://api.minimax.io/v1}"
echo "MiniMax env OK (model=${MINIMAX_MODEL:-MiniMax-M3})"

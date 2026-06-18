#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
ENV_FILE="$ROOT/.env"
MARKER="$ROOT/minimax-dual-setup/cloud-agent/.installed"

echo "=== Status: URZĄDZENIE A (Cloud Agent) ==="
echo "hostname: $(hostname)"
echo "pwd: $ROOT"
echo ""

if [[ -f "$ENV_FILE" ]]; then
  echo "✓ .env: $ENV_FILE"
  # shellcheck disable=SC1090
  set -a; source "$ENV_FILE"; set +a
  echo "  MINIMAX_MODEL=${MINIMAX_MODEL:-brak}"
  echo "  MINIMAX_BASE_URL=${MINIMAX_BASE_URL:-brak}"
  echo "  MINIMAX_API_KEY: $([[ -n "${MINIMAX_API_KEY:-}" ]] && echo SET || echo BRAK)"
else
  echo "✗ brak .env"
fi

[[ -f "$MARKER" ]] && echo "✓ ostatni install: $(cat "$MARKER")" || echo "✗ install.sh nie uruchomiony"

if [[ -f "$ROOT/minimax-dual-setup/cloud-agent/last-api-test/model-results.tsv" ]]; then
  echo ""
  echo "Ostatni test API:"
  column -t -s'|' "$ROOT/minimax-dual-setup/cloud-agent/last-api-test/model-results.tsv" 2>/dev/null || cat "$ROOT/minimax-dual-setup/cloud-agent/last-api-test/model-results.tsv"
fi

echo ""
echo "Picker modeli Cursor (telefon/PC) → urządzenie B, osobny setup."

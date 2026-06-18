#!/usr/bin/env bash
# URZĄDZENIE A — Cloud Agent VM (/workspace)
# Konfiguruje MiniMax dla skryptów i agenta w chmurze. NIE dotyka pickera na telefonie/PC.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
ENV_FILE="$ROOT/.env"
ENV_EXAMPLE="$ROOT/.env.example"
MARKER="$ROOT/minimax-dual-setup/cloud-agent/.installed"

echo "=== MiniMax setup: URZĄDZENIE A (Cloud Agent) ==="

if [[ ! -f "$ENV_FILE" ]]; then
  if [[ -f "$ENV_EXAMPLE" ]]; then
    cp "$ENV_EXAMPLE" "$ENV_FILE"
    chmod 600 "$ENV_FILE"
    echo "Utworzono $ENV_FILE — uzupełnij MINIMAX_API_KEY i uruchom ponownie."
    exit 1
  fi
  echo "Brak $ENV_FILE" >&2
  exit 1
fi

chmod 600 "$ENV_FILE"

# Auto-load w shellach agenta (tylko to urządzenie)
BASHRC="$HOME/.bashrc"
MARKER_LINE="# minimax-cloud-agent-env"
if ! grep -qF "$MARKER_LINE" "$BASHRC" 2>/dev/null; then
  cat >> "$BASHRC" <<EOF

$MARKER_LINE
[ -f "$ENV_FILE" ] && set -a && . "$ENV_FILE" && set +a
EOF
  echo "✓ bashrc: auto-load $ENV_FILE"
fi

# Bootstrap nowych sesji cloud agent
mkdir -p "$ROOT/.cursor"
cat > "$ROOT/.cursor/environment.json" <<'EOF'
{
  "install": "bash /workspace/minimax-dual-setup/cloud-agent/install.sh --quiet || true",
  "env": {
    "MINIMAX_BASE_URL": "https://api.minimax.io/v1",
    "OPENAI_BASE_URL": "https://api.minimax.io/v1",
    "MINIMAX_MODEL": "MiniMax-M3"
  }
}
EOF
echo "✓ .cursor/environment.json (cloud agent bootstrap)"

# NIE patchujemy state.vscdb na VM — to nie jest Twój picker
if [[ -f "$HOME/.config/Cursor/User/globalStorage/state.vscdb" ]]; then
  echo "ℹ Pominięto state.vscdb na VM (to nie urządzenie B)"
fi

# Walidacja API
set -a
# shellcheck disable=SC1090
source "$ENV_FILE"
set +a
if [[ -z "${MINIMAX_API_KEY:-}" ]]; then
  echo "MINIMAX_API_KEY pusty w $ENV_FILE" >&2
  exit 1
fi

EVIDENCE="$ROOT/minimax-dual-setup/cloud-agent/last-api-test"
mkdir -p "$EVIDENCE"
if [[ -x "$ROOT/cursor-minimax-setup-evidence-20260618-115808/scripts/validate-minimax-models.sh" ]]; then
  "$ROOT/cursor-minimax-setup-evidence-20260618-115808/scripts/validate-minimax-models.sh" "$EVIDENCE" >/dev/null
  echo "✓ API MiniMax: PASS (7 modeli) — log: $EVIDENCE/"
else
  curl -fsS "${MINIMAX_BASE_URL:-https://api.minimax.io/v1}/chat/completions" \
    -H "Authorization: Bearer ${MINIMAX_API_KEY}" \
    -H "Content-Type: application/json" \
    -d '{"model":"MiniMax-M3","messages":[{"role":"user","content":"ping"}],"max_completion_tokens":8}' \
    | grep -q '"object":"chat.completion"' && echo "✓ API MiniMax-M3: PASS" || echo "⚠ test API nieudany"
fi

date -u +%Y-%m-%dT%H:%M:%SZ > "$MARKER"
echo ""
echo "GOTOWE — urządzenie A (Cloud Agent)"
echo "  env: $ENV_FILE"
echo "  model domyślny: MiniMax-M3"
echo ""
echo "Picker na telefonie/PC = urządzenie B → minimax-dual-setup/local-cursor/install.sh"

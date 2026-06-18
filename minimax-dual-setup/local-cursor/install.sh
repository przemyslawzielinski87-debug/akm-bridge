#!/usr/bin/env bash
# URZĄDZENIE B — lokalny Cursor (telefon/komputer użytkownika)
# Patchuje state.vscdb i settings.json NA TYM URZĄDZENIU.
# NIE uruchamiaj na serwerze Cloud Agent (chyba że to faktycznie Twój PC z Cursorem).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
LOCAL_ENV="${CURSOR_MINIMAX_ENV:-$HOME/.cursor-minimax/local.env}"
PATCH="$ROOT/scripts/patch-cursor-minimax-vscdb.py"
TEMPLATE="$(dirname "$0")/.env.template"

echo "=== MiniMax setup: URZĄDZENIE B (lokalny Cursor) ==="
echo "hostname: $(hostname)"
echo ""

# Ostrzeżenie jeśli wygląda na cloud agenta
if [[ "${CURSOR_AGENT:-}" == "1" ]] && [[ ! -f "$HOME/.config/Cursor/User/globalStorage/state.vscdb" ]] \
   && [[ ! -f "$HOME/Library/Application Support/Cursor/User/globalStorage/state.vscdb" ]]; then
  echo "⚠ Wygląda na serwer Cloud Agenta bez lokalnego Cursor."
  echo "  Ten skrypt musisz uruchomić na SWOIM komputerze z zainstalowanym Cursor."
  echo "  Na serwerze agenta użyj: minimax-dual-setup/cloud-agent/install.sh"
  exit 1
fi

mkdir -p "$(dirname "$LOCAL_ENV")"
chmod 700 "$(dirname "$LOCAL_ENV")" 2>/dev/null || true

if [[ ! -f "$LOCAL_ENV" ]]; then
  if [[ -f "$ROOT/.env" ]] && grep -q '^MINIMAX_API_KEY=.' "$ROOT/.env" 2>/dev/null; then
    echo "Kopiuję klucz z repo .env → $LOCAL_ENV"
    grep -E '^(MINIMAX_|OPENAI_)' "$ROOT/.env" > "$LOCAL_ENV"
    chmod 600 "$LOCAL_ENV"
  elif [[ -f "$TEMPLATE" ]]; then
    cp "$TEMPLATE" "$LOCAL_ENV"
    chmod 600 "$LOCAL_ENV"
    echo ""
    echo "Utworzono $LOCAL_ENV"
    read -r -s -p "Wklej klucz MiniMax (niewidoczny): " KEY
    echo
    if [[ -z "$KEY" ]]; then
      echo "Anulowano — brak klucza." >&2
      exit 1
    fi
    sed -i "s/^MINIMAX_API_KEY=.*/MINIMAX_API_KEY=$KEY/" "$LOCAL_ENV"
    sed -i "s/^OPENAI_API_KEY=.*/OPENAI_API_KEY=$KEY/" "$LOCAL_ENV"
  else
    echo "Brak szablonu i .env" >&2
    exit 1
  fi
fi

chmod 600 "$LOCAL_ENV"

if pgrep -fi 'cursor|Cursor' >/dev/null 2>&1; then
  echo ""
  echo "❌ Zamknij Cursor całkowicie i uruchom ponownie ten skrypt."
  exit 1
fi

export MINIMAX_ENV_FILE="$LOCAL_ENV"
set -a
# shellcheck disable=SC1090
source "$LOCAL_ENV"
set +a

if [[ -z "${MINIMAX_API_KEY:-}" ]]; then
  echo "MINIMAX_API_KEY pusty w $LOCAL_ENV" >&2
  exit 1
fi

python3 "$PATCH" apply
python3 "$PATCH" verify

echo ""
echo "GOTOWE — urządzenie B (lokalny Cursor)"
echo "  env lokalny: $LOCAL_ENV"
echo "  Uruchom Cursor → Settings → Models → włącz MiniMax-M3"
echo ""
echo "Cloud Agent (serwer) = osobny setup → minimax-dual-setup/cloud-agent/install.sh"

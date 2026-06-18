#!/usr/bin/env bash
# Instaluje konfigurację MiniMax w Cursor Desktop (Linux/macOS).
# Czyta klucz z /workspace/.env lub z MINIMAX_API_KEY w środowisku.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WORKSPACE="${WORKSPACE_ROOT:-$(cd "$SCRIPT_DIR/.." && pwd)}"
ENV_FILE="${MINIMAX_ENV_FILE:-$WORKSPACE/.env}"

if [[ -f "$ENV_FILE" ]]; then
  set -a
  # shellcheck disable=SC1090
  source "$ENV_FILE"
  set +a
fi

if [[ -z "${MINIMAX_API_KEY:-}" ]]; then
  read -r -s -p "Wklej klucz MiniMax (niewidoczny): " MINIMAX_API_KEY
  echo
fi

case "$(uname -s)" in
  Darwin) CURSOR_USER_DIR="$HOME/Library/Application Support/Cursor/User" ;;
  Linux)  CURSOR_USER_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/Cursor/User" ;;
  *) echo "Nieobsługiwany OS. Ustaw ręcznie w Cursor → Settings → Models." >&2; exit 1 ;;
esac

mkdir -p "$CURSOR_USER_DIR"
SETTINGS="$CURSOR_USER_DIR/settings.json"

python3 - "$SETTINGS" "$MINIMAX_API_KEY" <<'PY'
import json, os, sys
path, api_key = sys.argv[1], sys.argv[2]
base_url = "https://api.minimax.io/v1"
models = [
    "MiniMax-M3", "MiniMax-M2.7", "MiniMax-M2.7-highspeed",
    "MiniMax-M2.5", "MiniMax-M2.5-highspeed", "MiniMax-M2.1", "MiniMax-M2",
]
data = {}
if os.path.isfile(path):
    with open(path, encoding="utf-8") as f:
        try:
            data = json.load(f)
        except json.JSONDecodeError:
            data = {}
patch = {
    "cursor.general.openAiApiKey": api_key,
    "cursor.general.openAiBaseUrl": base_url,
    "cursor.general.enableOpenAiApiKey": True,
    "cursor.openai.baseUrl": base_url,
    "cursor.openaiApiKey": api_key,
    "openai.api.base": base_url,
    "cursor.chat.customModels": models,
}
data.update(patch)
with open(path, "w", encoding="utf-8") as f:
    json.dump(data, f, indent=2, ensure_ascii=False)
    f.write("\n")
print(f"Zapisano: {path}")
PY

chmod 600 "$SETTINGS" 2>/dev/null || true
echo "Gotowe. Uruchom ponownie Cursor i wybierz MiniMax-M3."

#!/usr/bin/env bash
# MiniMax Cursor Local Setup Script
# Run on your LOCAL machine with Cursor FULLY CLOSED.
# This script:
#   1. Creates ~/.cursor-minimax/local.env (mode 600) for your API key
#   2. Optionally patches ~/.config/Cursor/User/globalStorage/state.vscdb
#
# SECURITY: Never commit your API key. This script stores it only in local files.
#
# Usage:
#   bash install.sh
#
# Requirements:
#   - Cursor must be fully closed
#   - python3 (for DB patch, optional)
#   - sqlite3 (for DB patch, optional)

set -euo pipefail

MINIMAX_BASE_URL="https://api.minimax.io/v1"
MINIMAX_MODELS=(
  "MiniMax-M3"
  "MiniMax-M2.7-highspeed"
  "MiniMax-M2.7"
  "MiniMax-M2.5-highspeed"
  "MiniMax-M2.5"
  "MiniMax-M2.1"
  "MiniMax-M2"
)
ENV_DIR="$HOME/.cursor-minimax"
ENV_FILE="$ENV_DIR/local.env"

echo "=== MiniMax Cursor Local Setup ==="
echo ""
echo "Environment: $(uname -s) $(hostname)"
echo ""

# --- Check Cursor is not running ---
if pgrep -x "Cursor" > /dev/null 2>&1 || pgrep -x "cursor" > /dev/null 2>&1; then
  echo "ERROR: Cursor appears to be running."
  echo "Please fully close Cursor before running this script."
  exit 1
fi

# --- Prompt for API key (hidden) ---
echo "Paste your MiniMax API key (input hidden):"
read -rs MINIMAX_API_KEY
echo ""

if [ -z "$MINIMAX_API_KEY" ]; then
  echo "ERROR: API key cannot be empty."
  exit 1
fi

# --- Create secret env file ---
mkdir -p "$ENV_DIR"
chmod 700 "$ENV_DIR"

cat > "$ENV_FILE" <<EOF
# MiniMax API configuration - DO NOT COMMIT
MINIMAX_API_KEY=${MINIMAX_API_KEY}
OPENAI_API_KEY=${MINIMAX_API_KEY}
OPENAI_BASE_URL=${MINIMAX_BASE_URL}
MINIMAX_BASE_URL=${MINIMAX_BASE_URL}
EOF

chmod 600 "$ENV_FILE"
echo "✓ Created $ENV_FILE (chmod 600)"

# --- Quick API test ---
echo ""
echo "Testing API connectivity..."
TEST_RESULT=$(curl -s -w "\n%{http_code}" \
  -H "Authorization: Bearer ${MINIMAX_API_KEY}" \
  -H "Content-Type: application/json" \
  -d '{"model":"MiniMax-M3","messages":[{"role":"system","content":"Reply with exactly OK."},{"role":"user","content":"ping"}],"max_tokens":16}' \
  "${MINIMAX_BASE_URL}/chat/completions" 2>/dev/null)

HTTP_CODE=$(echo "$TEST_RESULT" | tail -1)
RESPONSE_BODY=$(echo "$TEST_RESULT" | head -n -1)

if [ "$HTTP_CODE" = "200" ]; then
  echo "✓ MiniMax-M3 API test: HTTP 200 OK"
else
  echo "⚠ MiniMax-M3 API test: HTTP ${HTTP_CODE}"
  echo "  Check your API key and internet connection."
fi

# --- Detect Cursor DB location ---
echo ""
echo "Detecting Cursor installation..."

CURSOR_DB=""
if [ -f "$HOME/.config/Cursor/User/globalStorage/state.vscdb" ]; then
  CURSOR_DB="$HOME/.config/Cursor/User/globalStorage/state.vscdb"
elif [ -f "$HOME/Library/Application Support/Cursor/User/globalStorage/state.vscdb" ]; then
  CURSOR_DB="$HOME/Library/Application Support/Cursor/User/globalStorage/state.vscdb"
fi

if [ -n "$CURSOR_DB" ]; then
  echo "✓ Cursor DB found: $CURSOR_DB"
  echo ""
  echo "Optional: patch Cursor DB automatically (EXPERIMENTAL)."
  echo "The FASTEST and SAFEST path is manual UI (see README.md)."
  echo ""
  read -rp "Patch Cursor DB automatically? [y/N] " PATCH_CHOICE
  if [[ "$PATCH_CHOICE" =~ ^[Yy]$ ]]; then
    SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
    PATCH_SCRIPT="$SCRIPT_DIR/../../scripts/patch-cursor-minimax-vscdb.py"
    if [ -f "$PATCH_SCRIPT" ]; then
      python3 "$PATCH_SCRIPT" \
        --db "$CURSOR_DB" \
        --base-url "$MINIMAX_BASE_URL" \
        --models "${MINIMAX_MODELS[@]}" \
        --env-file "$ENV_FILE"
    else
      echo "Patch script not found at: $PATCH_SCRIPT"
      echo "Skipping automatic DB patch. Use manual UI instead."
    fi
  else
    echo "Skipping automatic DB patch."
  fi
else
  echo "Cursor DB not found. Manual UI setup required."
fi

# --- Final instructions ---
echo ""
echo "=== SETUP COMPLETE ==="
echo ""
echo "Next steps in Cursor (MANUAL UI — recommended):"
echo ""
echo "  1. Open Cursor"
echo "  2. Go to Settings → Models"
echo "  3. Enable 'OpenAI API Key' → paste your MiniMax API key"
echo "  4. Enable 'Override OpenAI Base URL' → https://api.minimax.io/v1"
echo "  5. Add custom model: MiniMax-M3"
echo "  6. Enable the toggle for MiniMax-M3"
echo "  7. Select MiniMax-M3 in the model picker"
echo ""
echo "Available models to add:"
for m in "${MINIMAX_MODELS[@]}"; do
  echo "  - $m"
done
echo ""
echo "⚠ SECURITY: Rotate your MiniMax API key after any plaintext exposure."
echo "  https://platform.minimax.io/"
echo ""

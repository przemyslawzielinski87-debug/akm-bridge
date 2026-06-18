#!/usr/bin/env bash
# Instaluje MiniMax w Cursor Desktop przez patch state.vscdb (właściwa metoda).
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
exec python3 "$SCRIPT_DIR/patch-cursor-minimax-vscdb.py" apply

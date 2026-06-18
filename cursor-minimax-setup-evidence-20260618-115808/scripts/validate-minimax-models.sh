#!/usr/bin/env bash
# Validates MiniMax OpenAI-compatible models using MINIMAX_API_KEY from environment.
# Never prints or logs the API key.
set -euo pipefail

BASE_URL="${MINIMAX_BASE_URL:-https://api.minimax.io/v1}"
OUT_DIR="${1:?usage: validate-minimax-models.sh <output_dir>}"
mkdir -p "$OUT_DIR"

if [[ -z "${MINIMAX_API_KEY:-}" ]]; then
  echo "ERROR: MINIMAX_API_KEY not set" >&2
  exit 2
fi

MODELS=(
  "MiniMax-M3"
  "MiniMax-M2.7"
  "MiniMax-M2.7-highspeed"
  "MiniMax-M2.5"
  "MiniMax-M2.5-highspeed"
  "MiniMax-M2.1"
  "MiniMax-M2"
)

sanitize() {
  sed -E \
    -e 's/sk-[A-Za-z0-9_\-]{20,}/MINIMAX_API_KEY_REDACTED/g' \
    -e 's/"Authorization"[[:space:]]*:[[:space:]]*"[^"]*"/"Authorization":"Bearer MINIMAX_API_KEY_REDACTED"/g'
}

test_model() {
  local model="$1"
  local body
  body=$(cat <<EOF
{
  "model": "${model}",
  "messages": [
    {"role":"system","content":"You are a concise test responder."},
    {"role":"user","content":"Reply with exactly: MINIMAX_CURSOR_TEST_OK"}
  ],
  "max_completion_tokens": 32,
  "temperature": 0.1
}
EOF
)

  local http_code
  local response_file
  response_file="$(mktemp)"
  http_code=$(curl -sS -o "$response_file" -w '%{http_code}' \
    "${BASE_URL}/chat/completions" \
    -H "Authorization: Bearer ${MINIMAX_API_KEY}" \
    -H "Content-Type: application/json" \
    -d "$body" || echo "000")

  local sanitized
  sanitized=$(sanitize < "$response_file")
  rm -f "$response_file"

  local status="FAIL"
  local note=""
  if [[ "$http_code" == "200" ]]; then
    if echo "$sanitized" | grep -qi 'MINIMAX_CURSOR_TEST_OK\|"content"'; then
      status="PASS"
      note="HTTP 200 with completion content"
    else
      status="PARTIAL"
      note="HTTP 200 but unexpected body shape"
    fi
  else
    note="HTTP ${http_code}"
  fi

  printf '%s|%s|%s\n' "$model" "$status" "$note"
  {
    echo "### ${model}"
    echo "- status: ${status}"
    echo "- note: ${note}"
    echo '```json'
    echo "$sanitized" | head -c 4000
    echo
    echo '```'
    echo
  } >> "${OUT_DIR}/04-SANITIZED-ERRORS.md"
}

: > "${OUT_DIR}/04-SANITIZED-ERRORS.md"
echo "# 04 — Sanitized API Responses" >> "${OUT_DIR}/04-SANITIZED-ERRORS.md"
echo "" >> "${OUT_DIR}/04-SANITIZED-ERRORS.md"
echo "Endpoint: ${BASE_URL}/chat/completions" >> "${OUT_DIR}/04-SANITIZED-ERRORS.md"
echo "" >> "${OUT_DIR}/04-SANITIZED-ERRORS.md"

{
  echo "model|direct_api_status|note"
  for model in "${MODELS[@]}"; do
    IFS='|' read -r m st nt < <(test_model "$model")
    echo "${m}|${st}|${nt}"
  done
} > "${OUT_DIR}/model-results.tsv"

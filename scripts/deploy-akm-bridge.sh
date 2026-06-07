#!/usr/bin/env bash
set -euo pipefail

# deploy-akm-bridge.sh — Automated deployment for akm-bridge
# Run from the akm-bridge directory.
# Usage: bash scripts/deploy-akm-bridge.sh

SCRIPT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$SCRIPT_DIR"

echo "=== AKM Bridge Deployment ==="
echo "Directory: $(pwd)"
echo ""

# 1. Check prerequisites
echo "--- Checking prerequisites ---"

if ! command -v bun &>/dev/null; then
  echo "ERROR: bun not found in PATH"
  echo "Install: curl -fsSL https://bun.sh/install | bash"
  exit 1
fi
echo "bun: $(bun --version)"

if ! command -v akm &>/dev/null; then
  echo "ERROR: akm not found in PATH"
  echo "Install: bun global add akm-cli@0.8.1"
  echo "Or ensure /root/.bun/bin is in PATH"
  exit 1
fi
echo "akm: $(akm --version 2>&1 | head -1)"

echo ""

# 2. Install dependencies
echo "--- Installing dependencies ---"
bun install
echo ""

# 3. Type check
echo "--- Running typecheck ---"
bun run lint
echo ""

# 4. Run tests
echo "--- Running tests ---"
bun test
echo ""

# 5. Build
echo "--- Building ---"
bun run build
echo ""

# 6. AKM CLI smoke tests
echo "--- AKM CLI smoke tests ---"

echo -n "akm --version ... "
akm_version=$(akm --version 2>&1) || {
  echo "FAIL ($?)"
  echo "$akm_version"
  exit 1
}
echo "OK"

echo -n "akm health ... "
akm_health=$(akm health 2>&1) || {
  health_exit=$?
  if [ "$health_exit" -eq 4 ]; then
    # Exit code 4 is acceptable (warn status)
    if echo "$akm_health" | grep -q '"ok":true\|"status":"warn"'; then
      echo "OK (exit $health_exit, warn status)"
    else
      echo "FAIL (exit $health_exit, unexpected output)"
      echo "$akm_health"
      exit 1
    fi
  else
    echo "FAIL (exit $health_exit)"
    echo "$akm_health"
    exit 1
  fi
}

echo -n "akm info ... "
akm_info=$(akm info 2>&1) || {
  echo "FAIL ($?)"
  echo "$akm_info"
  exit 1
}
echo "OK"

echo -n "akm search ... "
akm_search=$(akm search --query deploy --limit 3 2>&1) || {
  echo "FAIL ($?)"
  echo "$akm_search"
  exit 1
}
echo "OK"

echo ""
echo "=== Deployment complete ==="
echo ""
echo "Next steps:"
echo "1. Ensure opencode.json MCP config points to:"
echo "   command: $(which bun)"
echo "   args: [\"run\", \"$SCRIPT_DIR/dist/mcp-server.js\"]"
echo "2. Restart OpenCode"
echo "3. Verify akm-bridge tools appear in agent tool list"

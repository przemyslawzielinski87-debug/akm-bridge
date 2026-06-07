#!/usr/bin/env bash
# standalone health check for systemd timer
set -euo pipefail

opencode_status() {
  if command -v opencode &>/dev/null; then
    opencode mcp list 2>/dev/null | grep -qi 'failed' && echo "degraded" || echo "pass"
  else
    echo "unreachable"
  fi
}

akm_status() {
  if command -v akm &>/dev/null; then
    akm health 2>/dev/null | python3 -c "import sys,json; d=json.load(sys.stdin); print('pass' if d.get('ok') else 'warn')" 2>/dev/null || echo "unreachable"
  else
    echo "unreachable"
  fi
}

disk_log_warn() {
  local usage
  usage=$(journalctl --disk-usage 2>/dev/null | grep -oP '[\d.]+(?=G)' || echo "0")
  if (( $(echo "$usage > 2" | bc -l 2>/dev/null || echo 0) )); then
    echo "warning: journal $usage G"
  fi
}

http_success() {
  local url="${1:-http://127.0.0.1:4097/health}"
  curl -sf -o /dev/null -w "%{http_code}" "$url" 2>/dev/null || echo "000"
}

main() {
  local oc=$(opencode_status)
  local akm=$(akm_status)
  local disk=$(disk_log_warn)
  local http=$(http_success)

  cat <<JSON
{
  "timestamp": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "component": "health-check",
  "event": "system_health",
  "opencode": "$oc",
  "akm": "$akm",
  "http_health_endpoint": $http,
  "disk_warning": "${disk:-none}"
}
JSON

  [[ "$oc" == "pass" && "$akm" == "pass" ]] && exit 0 || exit 1
}

main

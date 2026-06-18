#!/usr/bin/env bash
# VPS bootstrap: create wpagent + install agent public keys
# Run as root on the WordPress VPS from a TRUSTED admin session.
# Does NOT modify WordPress, Docker, nginx, or app code.
set -euo pipefail

AGENT_USER="wpagent"
CURSOR_PUB_COMMENT="cursor-wpagent-2026-06-18"
CURSOR_PUB_KEY="ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIGs0aisXeA/9RjsC4C4dSWiwZwDePnjz5B3BIGhW7SZC cursor-wpagent-2026-06-18"

# Optional: pass MiniMax public key as first argument (single line, ssh-ed25519 ...)
MINIMAX_PUB_KEY="${1:-}"

echo "==> Bootstrap ${AGENT_USER} on $(hostname) at $(date -u -Is)"

if ! id "${AGENT_USER}" &>/dev/null; then
  useradd -m -s /bin/bash -c "WordPress agent read/diagnostic account" "${AGENT_USER}"
  echo "Created user ${AGENT_USER}"
else
  echo "User ${AGENT_USER} already exists"
fi

# Lock password — key-only auth
passwd -l "${AGENT_USER}" 2>/dev/null || usermod -L "${AGENT_USER}"

install -d -m 700 -o "${AGENT_USER}" -g "${AGENT_USER}" "/home/${AGENT_USER}/.ssh"
AUTH_KEYS="/home/${AGENT_USER}/.ssh/authorized_keys"
touch "${AUTH_KEYS}"
chown "${AGENT_USER}:${AGENT_USER}" "${AUTH_KEYS}"
chmod 600 "${AUTH_KEYS}"

add_key() {
  local comment="$1"
  local key="$2"
  if grep -qF "${key}" "${AUTH_KEYS}" 2>/dev/null; then
    echo "Key already present: ${comment}"
    return
  fi
  printf '\n# %s\n%s\n' "${comment}" "${key}" >> "${AUTH_KEYS}"
  echo "Added key: ${comment}"
}

add_key "${CURSOR_PUB_COMMENT}" "${CURSOR_PUB_KEY}"

if [[ -n "${MINIMAX_PUB_KEY}" ]]; then
  add_key "minimax-wpagent-$(date -u +%Y-%m-%d)" "${MINIMAX_PUB_KEY}"
else
  echo "No MiniMax key provided — add later to ${AUTH_KEYS}"
fi

chown "${AGENT_USER}:${AGENT_USER}" "${AUTH_KEYS}"
chmod 600 "${AUTH_KEYS}"

# Optional: www-data group for read visibility (safe default)
if getent group www-data &>/dev/null; then
  usermod -aG www-data "${AGENT_USER}" 2>/dev/null || true
  echo "Added ${AGENT_USER} to www-data (read visibility)"
fi

echo "==> Done. Verify from agent machine:"
echo "    ssh -o BatchMode=yes wpagent@<VPS_IP> 'whoami; hostname; id'"

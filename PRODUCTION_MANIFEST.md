# Production Manifest — AKM Bridge

## Version Information

| Item | Value |
|------|-------|
| AKM version | 0.8.1 |
| AKM binary | `/root/.bun/bin/akm` |
| AKM entry count | 1866 (CLI) / 0 (API — adapter parsing issue) |
| AKM index status | ready-vec (semantic search degraded: auth failure) |
| Bridge source | `/root/projekt/akm-bridge` (uncommitted) |
| Bridge runtime | `/root/projekt/akm-bridge/dist/http-server.js` |
| Node version | 22.x |
| Bun version | 1.3.14 |

## Active Services

| Service | Status | Enabled | Port |
|---------|--------|---------|------|
| `nginx` | active | enabled | 8888, 5174, 18080 |
| `opencode.service` | active | enabled | 4096 |
| `opencode-web` | active | enabled | (internal) |
| `opencode-mcp-control` | active | enabled | 127.0.0.1:4198 |
| `akm-bridge.service` | active | enabled | 127.0.0.1:4199 |

## Port Table

| Port | Bind | Process | Public | Expected |
|------|------|---------|--------|----------|
| 22 | 0.0.0.0 | sshd | yes | SSH |
| 80 | 0.0.0.0 | docker-proxy | yes | HTTP (Coolify) |
| 443 | 0.0.0.0 | docker-proxy | yes | HTTPS (Coolify) |
| 8888 | 0.0.0.0 | nginx | yes (IP allowlist) | Strategikon WP |
| 5174 | 0.0.0.0 | nginx | yes | OpenCode Web |
| 18080 | 127.0.0.1 | nginx | no | OpenCode internal |
| 4096 | 127.0.0.1 | opencode | no | OpenCode MCP |
| 4097 | 127.0.0.1 | opencode | no | OpenCode Web |
| 4198 | 127.0.0.1 | node | no | MCP Control |
| 4199 | 127.0.0.1 | node | no | AKM Bridge |
| 3306 | 127.0.0.1 | mariadbd | no | MariaDB |
| 4444 | 127.0.0.1 | lean-ctx | no | lean-ctx |

## Configuration Paths

| Item | Path |
|------|------|
| AKM config | `/root/.config/akm/config.json` |
| AKM data | `/root/.local/share/akm/` |
| AKM state DB | `/root/.local/share/akm/state.db` |
| AKM sources | `/root/akm` (stash), `/var/www/strategikon/docs` (meridian-docs) |
| Bridge config | `/root/projekt/akm-bridge/src/config.ts` (env vars) |
| Bridge data | `/root/projekt/akm-bridge/data/` |
| Audit log | `/root/projekt/akm-bridge/data/write-audit.jsonl` |
| Notification DB | `/root/projekt/akm-bridge/data/notifications.db` |
| Notification env | `/root/projekt/akm-bridge/.env.notifications` (credentials, not in git) |
| OpenCode config | `/root/.config/opencode/opencode.json` |
| OpenCode JSONC | `/root/.config/opencode/opencode.jsonc` |
| AGENTS.md | `/root/.config/opencode/AGENTS.md` |
| Nginx sites | `/etc/nginx/sites-enabled/` |
| Systemd units | `/etc/systemd/system/akm-bridge.service` |
| | `/etc/systemd/system/opencode-mcp-control.service` |
| | `/etc/systemd/system/opencode-notification-worker.service` (template in `.systemd/`) |

## Log Paths

| Log | Path |
|-----|------|
| Nginx OpenCode access | `/var/log/nginx/opencode-web-access.log` |
| Nginx OpenCode error | `/var/log/nginx/opencode-web-error.log` |
| Nginx Strategikon access | `/var/log/nginx/strategikon-access.log` |
| Nginx Strategikon error | `/var/log/nginx/strategikon-error.log` |
| Systemd akm-bridge | `journalctl -u akm-bridge.service` |
| Systemd opencode-mcp-control | `journalctl -u opencode-mcp-control.service` |

## Panel URLs

| URL | Description | Auth |
|-----|-------------|------|
| `http://127.0.0.1:4199/` | Direct bridge access (loopback only) | None |
| `https://opencode.themeridian.com.pl/akm/` | Via Nginx proxy | Basic auth |

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/akm/health` | AKM health check |
| GET | `/api/akm/status` | Version, entry count, health |
| GET | `/api/akm/sources` | Configured sources |
| GET | `/api/akm/stats` | Index statistics |
| GET | `/api/akm/capabilities` | Supported capabilities |
| GET | `/api/akm/search?q=&type=&limit=` | Search knowledge |
| GET | `/api/akm/resource?ref=` | Resource content |
| GET | `/api/akm/activity` | Read operation history |
| GET | `/api/akm/write-activity` | Write audit entries |
| GET | `/api/akm/operations/current` | Write lock status |
| GET | `/api/akm/proposals?status=` | List proposals |
| GET | `/api/akm/proposal?id=` | Proposal detail |
| GET | `/api/akm/agent/mode` | Current agent mode |
| GET | `/api/akm/agent/runs` | Recent agent runs |
| POST | `/api/akm/agent/run/start` | Start agent run |
| POST | `/api/akm/agent/run/complete` | Complete agent run |
| POST | `/api/akm/actions/prepare` | Get confirmation token |
| POST | `/api/akm/reindex` | Rebuild index (CSRF) |
| POST | `/api/akm/sync` | Sync sources (CSRF) |
| POST | `/api/akm/feedback` | Submit feedback |
| POST | `/api/akm/proposals/accept` | Accept proposal (CSRF) |
| POST | `/api/akm/proposals/reject` | Reject proposal (CSRF) |
| POST | `/api/akm/remember` | Store knowledge (CSRF) |
| POST | `/api/akm/lesson-proposals` | Create lesson (CSRF) |

## MCP Tools

| Tool | Read-only |
|------|-----------|
| akm_health | yes |
| akm_status | yes |
| akm_sources | yes |
| akm_stats | yes |
| akm_search | yes |
| akm_show | yes |
| akm_capabilities | yes |
| akm_feedback | yes |
| akm_proposal_list | yes |
| akm_proposal_show | yes |
| akm_agent_mode | yes |
| akm_agent_run_start | yes (telemetry) |
| akm_agent_run_complete | yes (telemetry) |
| akm_agent_runs | yes |

## Agent Mode

| Setting | Value |
|---------|-------|
| Current mode | supervised |
| Config source | `AKM_AGENT_MODE` env var |
| Default | supervised |
| Fallback for invalid | supervised |

## Budget Limits

| Limit | Value |
|-------|-------|
| Max initial searches | 4 |
| Max selected resources | 5 |
| Max loaded resources | 3 |
| Max retries | 1 |
| Agent run history | 50 records |

## Write Mode

| Control | Status |
|---------|--------|
| Write enabled | configurable via `AKM_WRITE_ENABLED` (default: false) |
| CSRF tokens | required for all write operations |
| Write lock | single-operation mutex |
| Audit log | persistent JSONL |
| Secret detection | active (tokens, keys, credentials) |

## Security Controls

| Control | Status |
|---------|--------|
| CORS | loopback only (127.0.0.1, localhost) |
| Network isolation | IPAddressAllow=127.0.0.1 |
| NoNewPrivileges | true |
| ProtectSystem | strict |
| PrivateTmp | true |
| Auth (Nginx) | basic auth with htpasswd |
| Proposal accept | HTTP-only, CSRF required, not in MCP |
| No autonomous reindex/sync | enforced |

## Rollback Commands

```bash
# Rollback to manual
systemctl set-environment AKM_AGENT_MODE=manual
systemctl restart akm-bridge.service

# Rollback to off
systemctl set-environment AKM_AGENT_MODE=off
systemctl restart akm-bridge.service

# Restore supervised
systemctl set-environment AKM_AGENT_MODE=supervised
systemctl restart akm-bridge.service
```

## Known Limitations

1. **Adapter exit code handling**: AKM health with "warn" status (exit 4) causes
   the adapter to report failure despite valid JSON output. Affects health and
   status endpoints. Workaround: not critical for most use cases since search
   and other tool calls succeed independently.
2. **Semantic search degraded**: Authentication failure for NVIDIA embedding
   API (401). Semantic search is blocked; FTS search still works.
3. **Entry count mismatch**: CLI reports 1866 entries; API reports 0 due to
   adapter parsing issue for deeply nested JSON paths.
4. **No session ID**: Bridge is sessionless; custom `run_id` used for agent
   telemetry.
5. **No boot persistence test**: Full reboot was not performed; persistence
   verified only via service restarts.

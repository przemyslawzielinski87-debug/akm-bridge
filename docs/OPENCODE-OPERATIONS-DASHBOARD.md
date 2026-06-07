# OpenCode Operations Dashboard

> Real-time visibility into OpenCode agent health, AKM state, MCP connectivity, and operational readiness.

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│  Caddy Reverse Proxy (:443 → :4200)                         │
│  ┌───────────────────────────────────────────────────────┐  │
│  │  Dashboard Server (Bun, port 4200)                    │  │
│  │  ┌─────────────┐  ┌──────────────┐  ┌────────────┐  │  │
│  │  │ Status      │  │ Alert Engine │  │ Action     │  │  │
│  │  │ Aggregator  │  │              │  │ Executor   │  │  │
│  │  └──────┬──────┘  └──────┬───────┘  └─────┬──────┘  │  │
│  │         │                │                 │          │  │
│  │  ┌──────▼────────────────▼─────────────────▼──────┐  │  │
│  │  │            Data Collection Layer               │  │  │
│  │  │  (scripts, AKM MCP, filesystem, process list)  │  │  │
│  │  └────────────────────────────────────────────────┘  │  │
│  └───────────────────────────────────────────────────────┘  │
│  Static UI files (dashboard-ui/)                            │
└─────────────────────────────────────────────────────────────┘
```

The dashboard is a single-process Bun server that:
1. Collects health data from multiple local sources every 30 seconds
2. Computes a weighted status score per component
3. Fires alerts when thresholds are breached
4. Exposes a REST API consumed by the static SPA frontend

## Data Sources

| # | Source | Path | Purpose | Refresh |
|---|--------|------|---------|---------|
| 1 | `opencode.json` | `~/.config/opencode/opencode.json` | Agent/command/skill registry | On change |
| 2 | `AGENTS.md` | `~/.config/opencode/AGENTS.md` | Global agent instructions | On change |
| 3 | `akm_index.json` | `~/.config/opencode/akm_index.json` | AKM search index stats | 60s |
| 4 | `opencode-mcp.json` | `~/.config/opencode/opencode-mcp.json` | MCP server definitions | On change |
| 5 | MCP health probes | `ps`, `/proc` | Process liveness per MCP server | 30s |
| 6 | `scripts/*.sh` | `akm-bridge/scripts/` | Recovery scripts inventory | 300s |
| 7 | `package.json` | `akm-bridge/package.json` | Version, dependencies | On change |
| 8 | `dist/` | `akm-bridge/dist/` | Build artifacts freshness | 60s |
| 9 | Git status | `.git/` | Branch, dirty state, last commit | 30s |
| 10 | System timers | `systemctl list-timers` | Recovery/update check timers | 60s |
| 11 | Disk usage | `df -h` | Storage health | 120s |
| 12 | OpenCode process | `pgrep`, `/proc` | Main OpenCode process health | 30s |

### Adding a New Data Source

```typescript
// src/dashboard/collectors/my-source.ts
export async function collect(): Promise<MySourceData> {
  // Return typed data or throw on failure
}
```

Register in `src/dashboard/collectors/index.ts` with a name, refresh interval, and optional timeout.

## Status Scoring Algorithm

Each component receives a score 0–100:

```
score = (availability × 0.4) + (freshness × 0.3) + (correctness × 0.2) + (performance × 0.1)
```

| Factor | Weight | Method |
|--------|--------|--------|
| **Availability** | 40% | Process alive, endpoint responding, file exists |
| **Freshness** | 30% | Last modification vs expected interval |
| **Correctness** | 20% | Schema validation, count matches, expected values present |
| **Performance** | 10% | Response time < 500ms = 100, < 2s = 75, < 5s = 50, else 0 |

### Overall Status Mapping

| Score Range | Status |
|-------------|--------|
| 90–100 | `healthy` |
| 70–89 | `degraded` |
| 50–69 | `unstable` |
| 0–49 | `critical` |

## Alert Engine

### Critical Alerts (require immediate action)

| ID | Trigger | Action |
|----|---------|--------|
| `mcp-down` | MCP server not responding | Restart server, check logs |
| `opencode-dead` | OpenCode process not running | `systemctl restart opencode` |
| `disk-full` | `/root` > 95% | Clean logs, old backups |
| `build-stale` | `dist/` older than 24h and source newer | Run `bun run build` |

### Warning Alerts (actionable but not urgent)

| ID | Trigger | Action |
|----|---------|--------|
| `dr-clean-server` | Clean-server drill never executed | Schedule drill on isolated VM |
| `git-dirty` | Working tree has uncommitted changes | Commit or stash |
| `akm-index-stale` | AKM index older than 7 days | Run reindex |
| `timer-missed` | Recovery timer skipped 2+ cycles | Check systemd journal |

### Alert Lifecycle

```
NEW → ACKNOWLEDGED → RESOLVED
         ↓
      SUPPRESSED (within suppression window)
```

Alerts are deduplicated by `(component, title)` within a 1-hour window. Acknowledged alerts are persisted to `dashboard-cache.json`.

## Staleness Policy

| Data Type | Expected Interval | Stale After | Critical After |
|-----------|-------------------|-------------|----------------|
| MCP health | 30s | 60s | 300s |
| Process status | 30s | 60s | 300s |
| Git status | 30s | 60s | 600s |
| Build artifacts | 60s | 300s | 86400s |
| File-based config | On change | 3600s | 86400s |

## API Endpoints

Base URL: `http://127.0.0.1:4200/api/v1`

### Health & Status

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/health` | Server health (always 200) |
| `GET` | `/overview` | Overall status + summary of all components |
| `GET` | `/status` | Detailed per-component scores |
| `GET` | `/status/:component` | Single component detail |
| `GET` | `/score` | Numeric scores only (for sparklines) |

### Alerts

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/alerts` | All active alerts (filter: `?severity=critical`) |
| `POST` | `/alerts/:id/acknowledge` | Acknowledge an alert |
| `POST` | `/alerts/:id/resolve` | Mark alert resolved |
| `DELETE` | `/alerts/:id` | Dismiss alert (admin only) |

### Actions

| Method | Path | Description | Approval |
|--------|------|-------------|----------|
| `POST` | `/actions/restart-mcp/:name` | Restart MCP server | No |
| `POST` | `/actions/reindex-akm` | Rebuild AKM index | No |
| `POST` | `/actions/run-build` | Trigger `bun run build` | No |
| `POST` | `/actions/backup-config` | Snapshot config files | No |
| `POST` | `/actions/trigger-dr` | Run disaster recovery drill | **Yes** |
| `POST` | `/actions/cleanup-logs` | Remove logs older than 30d | **Yes** |
| `POST` | `/actions/force-restart` | Restart OpenCode process | **Yes** |

### Administration

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/config` | Current dashboard configuration |
| `PATCH` | `/config` | Update thresholds (admin only) |
| `GET` | `/logs` | Dashboard server logs (`?lines=100`) |
| `GET` | `/version` | Dashboard version + data source versions |

### Pagination & Filtering

All list endpoints support:
- `?page=1&limit=25` — pagination
- `?sort=severity:desc` — sorting
- `?filter=status:critical` — filtering

## Authentication

The dashboard is behind Caddy reverse proxy with basic auth:

```
# /etc/caddy/Caddyfile
opencode-dashboard.example.com {
    basicauth * {
        admin $2a$14$hashed_password
    }
    reverse_proxy 127.0.0.1:4200
}
```

### API Key (for programmatic access)

Set `DASHBOARD_API_KEY` in environment or `.env`. Send as `Authorization: Bearer <key>` header.

## Security Headers

Automatically applied by the dashboard server:

| Header | Value |
|--------|-------|
| `X-Content-Type-Options` | `nosniff` |
| `X-Frame-Options` | `DENY` |
| `X-XSS-Protection` | `1; mode=block` |
| `Referrer-Policy` | `strict-origin-when-cross-origin` |
| `Content-Security-Policy` | `default-src 'self'` |
| `Strict-Transport-Security` | `max-age=63072000; includeSubDomains` |

## Mobile-Responsive UI

The SPA dashboard is built with:
- CSS Grid layout with responsive breakpoints at 768px and 1200px
- Status cards reflow to single column on mobile
- Alert banners with swipe-to-acknowledge on touch devices
- Dark mode by default, toggleable via header button
- Polling interval adapts: 30s desktop, 60s mobile (battery optimization)

## Safe Operator Actions

These can be executed without approval:

| Action | Command | Impact |
|--------|---------|--------|
| Restart MCP server | `pm2 restart <name>` or kill + respawn | 5s downtime per server |
| Reindex AKM | `akm reindex` | CPU spike for 10-30s |
| Run build | `bun run build` | Disk I/O, ~15s |
| Backup config | `cp` to timestamped dir | Disk space only |
| View logs | Read from filesystem | Read-only |

## Actions Requiring Approval

These show a confirmation dialog and require explicit operator approval:

| Action | Risk | Mitigation |
|--------|------|------------|
| Trigger DR drill | May restart services | Only on isolated environment |
| Cleanup logs | May remove useful data | 30-day retention, dry-run first |
| Force restart OpenCode | Kills active sessions | Warns about in-progress work |

### Approval Flow

1. Operator clicks action → confirmation modal appears
2. Modal shows risk level, affected components, and estimated downtime
3. Operator must type confirmation phrase for critical actions
4. Action is logged with timestamp, operator ID, and result
5. Audit trail persisted to `dashboard-cache.json`

## Deployment

### systemd Service

```bash
# Install
sudo cp .systemd/opencode-dashboard.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now opencode-dashboard

# Verify
sudo systemctl status opencode-dashboard
curl http://127.0.0.1:4200/health
```

### Caddy Configuration

```bash
sudo cp docs/examples/Caddyfile.dashboard /etc/caddy/Caddyfile.d/opencode-dashboard.conf
sudo systemctl reload caddy
```

### Build & Deploy

```bash
bun run build
sudo systemctl restart opencode-dashboard
```

## Configuration

Environment variables (set in systemd unit or `.env`):

| Variable | Default | Description |
|----------|---------|-------------|
| `DASHBOARD_PORT` | `4200` | Server port |
| `DASHBOARD_HOST` | `127.0.0.1` | Bind address |
| `DASHBOARD_API_KEY` | (none) | API key for programmatic access |
| `DASHBOARD_POLL_INTERVAL` | `30` | Data collection interval (seconds) |
| `DASHBOARD_CACHE_TTL` | `300` | Response cache TTL (seconds) |
| `DASHBOARD_LOG_LEVEL` | `info` | `debug` / `info` / `warn` / `error` |
| `DASHBOARD_MAX_ALERTS` | `100` | Max active alerts before rotation |
| `DASHBOARD_AUTH_REALM` | `OpenCode Dashboard` | Basic auth realm |

## Troubleshooting

### Dashboard won't start

```bash
# Check logs
journalctl -u opencode-dashboard -n 50

# Check port conflict
ss -tlnp | grep 4200

# Check permissions
ls -la /root/projekt/akm-bridge/dist/
```

### Data showing stale

```bash
# Force refresh
curl -X POST http://127.0.0.1:4200/api/v1/actions/reindex-akm

# Check collector health
curl http://127.0.0.1:4200/api/v1/status | jq '.collectors[] | select(.status != "ok")'
```

### MCP servers showing down

```bash
# Check if MCP servers are running
ps aux | grep mcp

# Check OpenCode MCP config
cat ~/.config/opencode/opencode-mcp.json | jq '.mcpServers | keys'

# Restart specific MCP server
curl -X POST http://127.0.0.1:4200/api/v1/actions/restart-mcp/server-name
```

### Alerts not clearing

```bash
# Force resolve stale alerts
curl -X POST http://127.0.0.1:4200/api/v1/alerts/stale-alert-id/resolve

# Clear all resolved alerts
curl -X DELETE http://127.0.0.1:4200/api/v1/alerts?filter=status:resolved
```

## Rollback

If the dashboard causes issues:

```bash
# Stop dashboard
sudo systemctl stop opencode-dashboard
sudo systemctl disable opencode-dashboard

# Remove service file
sudo rm /etc/systemd/system/opencode-dashboard.service
sudo systemctl daemon-reload

# Remove Caddy config
sudo rm /etc/caddy/Caddyfile.d/opencode-dashboard.conf
sudo systemctl reload caddy

# Data is ephemeral (dashboard-cache.json) — safe to remove
rm /root/projekt/akm-bridge/dashboard-cache.json
```

The dashboard has no impact on OpenCode core functionality when stopped. All health data is collected on-demand; no persistent state beyond the cache file.

# OpenCode Observability

## Architecture

```
┌─────────────────────────────────────────────────┐
│  OpenCode Session (Agent + Tools + MCP)         │
│  ┌───────────┐  ┌──────────┐  ┌──────────────┐ │
│  │ TokenScope │  │   OTel   │  │  Compaction   │ │
│  │  Plugin    │  │  Plugin  │  │  + Pruning    │ │
│  └───────────┘  └──────────┘  └──────────────┘ │
└──────────────────────┬──────────────────────────┘
                       │
┌──────────────────────▼──────────────────────────┐
│  Observability Scripts                          │
│  scripts/health-check.sh         (systemd timer)│
│  scripts/check-mcp-health.ts     (MCP tests)    │
│  scripts/opencode-observability-report.ts (full)│
└──────────────────────┬──────────────────────────┘
                       │
┌──────────────────────▼──────────────────────────┐
│  Backend: JSONL logs + journald + GitHub CI      │
└─────────────────────────────────────────────────┘
```

## Components

### 1. TokenScope Plugin
- Installed: `@ramtinj95/opencode-tokenscope@1.6.5`
- Tracks: input/output/cached tokens per session
- Use: `opencode tokenscope` or `/tokenscope`

### 2. OpenTelemetry Plugin
- Installed: `@devtheops/opencode-plugin-otel@1.1.0`
- Provides spans for tool calls and MCP interactions

### 3. Health Check Script
```
scripts/health-check.sh
```
Checks: opencode status, AKM health, HTTP endpoint, journald disk usage.
Returns structured JSON. Exit code 0 = healthy, 1 = degraded.

### 4. MCP Health Check
```
scripts/check-mcp-health.ts   # tsx scripts/check-mcp-health.ts
```
Tests AKM MCP with 6 invocations: health, status, capabilities, search (hits), search (empty).
Reports per-tool duration, content length, empty responses.

### 5. Observability Report
```
scripts/opencode-observability-report.ts   # tsx scripts/opencode-observability-report.ts
```
Aggregates: git status, AKM health, CI status, journal usage, file counts.

## Structured Log Format (JSON Lines)

```json
{
  "timestamp": "2026-06-07T12:00:00Z",
  "component": "akm-bridge",
  "event": "tool_call",
  "server": "akm-bridge",
  "tool": "akm_search",
  "agent": "researcher",
  "duration_ms": 123,
  "status": "success"
}
```

## Privacy Policy

NEVER log:
- Full prompts or model responses
- API tokens, keys, passwords
- Private SSH keys
- .env contents
- WordPress user data

ALWAYS redact:
- `ghp_*`, `github_pat_*`, `nvapi-*`
- `Bearer <token>`, `Authorization:`
- `api_key`, `password`, `secret`

## CI Health Checks

CI workflow runs:
1. `test:observability` — Jest tests for health check scripts
2. `check:mcp-health` — MCP health check with fake AKM binary
3. `test:mcp-contract` — 11 protocol compliance tests
4. `validate:docs` — documentation validity checks

## Systemd Timer (optional)

```ini
# /etc/systemd/system/opencode-health-check.service
[Unit]
Description=OpenCode Health Check
[Service]
Type=oneshot
ExecStart=/root/projekt/akm-bridge/scripts/health-check.sh
```

```ini
# /etc/systemd/system/opencode-health-check.timer
[Unit]
Description=Run OpenCode health check every 10 minutes
[Timer]
OnBootSec=5min
OnUnitActiveSec=10min
[Install]
WantedBy=timers.target
```

## Alerts

| Level | Condition |
|-------|-----------|
| Critical | AKM bridge down |
| Critical | All MCP unavailable |
| Critical | Repeated JSON-RPC failures |
| Critical | Secret detected in diff |
| Warning | MCP empty response |
| Warning | Journal disk > 2GB |
| Warning | Compaction frequency spike |

## Failure Scenarios (Tested)

| Scenario | Detection | Recovery |
|----------|-----------|----------|
| AKM binary missing | `health-check.sh` exit code 1 | reinstall AKM |
| MCP empty response | `check-mcp-health.ts` exit code 1 | restart MCP server |
| Health warn (exit 4) | parsed correctly as warn | advisory only |
| Permission deny | blocked by OpenCode runtime | user approval required |

## Rollback

```bash
cp /root/.config/opencode/backup/20260607125311-context-optimization/opencode.json /root/.config/opencode/opencode.json
```

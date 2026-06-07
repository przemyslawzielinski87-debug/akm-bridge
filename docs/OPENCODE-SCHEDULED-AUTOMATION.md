# OpenCode Scheduled Automation

## Architecture

The scheduler system consists of three layers:

1. **Scheduler Engine** — Tick-based daemon that evaluates schedules and triggers executions
2. **Schedule Store** — JSON-file persistence with in-memory cache
3. **API Layer** — HTTP routes on the remote-control server for CRUD operations

```
┌─────────────────┐     ┌──────────────────┐     ┌─────────────────┐
│  Remote Control  │────▶│  Schedule API     │────▶│  Schedule Store  │
│  Server :4201    │     │  (pure functions) │     │  (JSON files)    │
└─────────────────┘     └──────────────────┘     └─────────────────┘
        │                        │
        │                  ┌─────▼──────────┐
        │                  │  Scheduler      │
        └──────────────────│  Engine :4202   │
                           │  (tick-based)   │
                           └─────────────────┘
```

## Schedule Model

```typescript
interface Schedule {
  id: string                    // UUID
  name: string                  // Human-readable name
  project: string               // Allowed project path
  agent?: string                // Agent to use
  command?: string              // Command to run
  prompt_template: string       // Prompt text
  schedule_type: 'once' | 'interval' | 'cron'
  schedule_expression: string   // Varies by type
  timezone: string              // Default: Europe/Warsaw
  read_only: boolean            // Default: true
  approval_policy: string       // never_write | per_run | preapproved_limited
  priority: string              // low | normal | high
  // Budget limits
  max_duration_seconds: number
  max_input_tokens: number
  max_output_tokens: number
  max_tool_calls: number
  max_runs_per_day: number
  max_cost_estimate: number
  // Retry
  retry_max_attempts: number
  retry_on: string[]
  // Policies
  misfire_policy: string
  concurrency_policy: string
  // Maintenance
  maintenance_window_start?: string
  maintenance_window_end?: string
  // State
  status: 'active' | 'paused' | 'deleted'
  created_by: string
  created_at: string
  updated_at: string
  last_run_at?: string
  last_run_status?: string
  next_run_at?: string
  runs_today: number
  consecutive_failures: number
}
```

## Schedule Types

### Once
Run at a specific date/time. Expression format: ISO 8601 timestamp.
```
"2026-01-15T10:00:00+01:00"
```

### Interval
Run every N minutes/hours/days. Expression format: `<value><unit>`.
```
"30m"    // every 30 minutes
"2h"     // every 2 hours
"1d"     // every day
"7d"     // every week
```

### Cron
Standard 5-field cron expression.
```
┌───── minute (0-59)
│ ┌───── hour (0-23)
│ │ ┌───── day of month (1-31)
│ │ │ ┌───── month (1-12)
│ │ │ │ ┌───── day of week (0-6, Sun=0)
│ │ │ │ │
* * * * *
```

Common patterns:
- `0 6 * * *` — Daily at 06:00
- `0 */4 * * *` — Every 4 hours
- `0 8 * * 1-5` — Weekdays at 08:00
- `30 22 * * 0` — Sundays at 22:30

## Timezone and DST

- Default timezone: `Europe/Warsaw` (CET/CEST)
- Always specify timezone explicitly in schedules
- The scheduler handles DST transitions:
  - Spring forward: skip if no valid time exists
  - Fall back: run once (not twice)
- Use IANA timezone names (e.g., `Europe/Warsaw`, `America/New_York`)

## Budget Limits

Every schedule must define budget limits. Defaults:

| Parameter | Default | Description |
|-----------|---------|-------------|
| max_duration_seconds | 300 | Maximum execution time |
| max_input_tokens | 50,000 | Maximum input tokens |
| max_output_tokens | 10,000 | Maximum output tokens |
| max_tool_calls | 20 | Maximum tool invocations |
| max_runs_per_day | 10 | Maximum executions per day |
| max_cost_estimate | 1.0 | Maximum estimated cost ($) |

When any limit is exceeded:
- Execution is terminated
- Budget exceeded error recorded
- No retry (even if retry policy allows)

## Approval Policy

### never_write (default)
Schedule can only run read-only tasks. No write operations allowed. No approval flow needed.

### per_run
Each execution that requires write operations waits for manual approval. The schedule pauses until approved or expired.

### preapproved_limited
Only for very narrow allowlists (reports, tests, fetch). Write operations within the predefined scope are auto-approved. Everything else requires approval.

## Retry Policy

```typescript
{
  maxAttempts: 0,        // 0 = no retry (default)
  retryOn: [            // Conditions that trigger retry
    'timeout',
    'temporary_network',
    'mcp_transient'
  ]
}
```

**Never retry:**
- `permission_denied` — Auth issue, retry won't help
- `approval_rejected` — Explicit human decision
- `budget_exceeded` — Resource limit hit
- `deny_operation` — Operation blocked by policy

## Misfire Policy

When a scheduled run is missed (engine was down, system was asleep):

### skip (default)
Don't run the missed execution. The next scheduled time is used.

### run_once
Run once if overdue, even if the scheduled time has passed.

### catch_up_limited
Run up to N missed executions to catch up. Prevents runaway catch-up storms.

## Concurrency Policy

When a new execution is triggered but the previous one is still running:

### skip (default for write)
Skip the new execution. The previous one continues.

### queue
Wait for the previous execution to finish, then start the new one.

### replace
Cancel the previous execution and start the new one. Only allowed for read-only schedules.

## Maintenance Windows

Block write tasks during maintenance hours:
```json
{
  "maintenance_window_start": "02:00",
  "maintenance_window_end": "04:00"
}
```

During maintenance:
- Write tasks are skipped
- Read-only tasks may still run if approval policy allows
- Tasks queued during maintenance run after the window closes (if policy is `queue`)

## Auto-Pause

After 3 consecutive failures:
1. Schedule is automatically set to `paused`
2. An alert is generated
3. Manual resume is required
4. `consecutive_failures` counter resets on resume

This prevents runaway schedules from consuming resources.

## System Templates

Pre-configured schedule templates:

### Daily Health Check
```json
{
  "name": "Daily Health Check",
  "schedule_type": "cron",
  "schedule_expression": "0 6 * * *",
  "timezone": "Europe/Warsaw",
  "read_only": true,
  "approval_policy": "never_write",
  "prompt_template": "Run a health check on all services. Report status of: dashboard, remote-control, scheduler, MCP servers, AKM."
}
```

### Weekly Update Check
```json
{
  "name": "Weekly Update Check",
  "schedule_type": "cron",
  "schedule_expression": "0 9 * * 1",
  "timezone": "Europe/Warsaw",
  "read_only": true,
  "prompt_template": "Check for available updates to OpenCode, plugins, MCP servers, and AKM. Report versions and risk levels."
}
```

### Hourly Build Monitor
```json
{
  "name": "Build Monitor",
  "schedule_type": "interval",
  "schedule_expression": "1h",
  "read_only": true,
  "prompt_template": "Check build status for Strategikon and AKM Bridge. Report any failures."
}
```

## Notification Policy

Notifications are sent via SSE (Server-Sent Events) on the remote control dashboard:

- `schedule_created` — New schedule added
- `schedule_updated` — Schedule modified
- `schedule_deleted` — Schedule removed
- `schedule_paused` — Schedule paused (manual or auto)
- `schedule_resumed` — Schedule resumed
- `schedule_run_now` — Manual trigger

Browser notifications are supported when permission is granted.

## Quiet Hours

Quiet hours suppress non-critical notifications:
- Default: 22:00 - 07:00 (Europe/Warsaw)
- Critical failures still notify
- Configurable per schedule

## API Reference

### GET /api/schedules
List schedules with optional filters.

Query params:
- `status` — Filter by status (active, paused, all)
- `project` — Filter by project path
- `limit` — Max results (default 50, max 200)
- `offset` — Pagination offset

### POST /api/schedules
Create a new schedule.

Body fields: name (required), project (required), prompt_template (required), schedule_type (required), schedule_expression (required), plus optional fields from the Schedule model.

### GET /api/schedules/:id
Get schedule details.

### PUT /api/schedules/:id
Update schedule. Send partial fields to patch.

### DELETE /api/schedules/:id
Soft-delete schedule (sets status to `deleted`).

### POST /api/schedules/:id/pause
Pause an active schedule.

### POST /api/schedules/:id/resume
Resume a paused schedule. Resets consecutive failure count.

### POST /api/schedules/:id/run-now
Trigger immediate execution. Returns `{ queued, taskId, reason }`.

### GET /api/schedules/:id/history
Get execution history for a schedule.

Query params: `limit` (default 20, max 100)

### GET /api/scheduler/status
Get scheduler engine status.

Returns: running, uptime, tick_interval, total_schedules, active, paused, next_run, recent_failures.

## Mobile UI

The remote control dashboard includes a "Schedules" tab:

- **Filter bar**: All / Active / Paused
- **Schedule cards**: Name, project, agent, type, next run, status, runs today, read-only badge
- **Tap to expand**: Full details, history, pause/resume, run-now, edit, delete
- **FAB**: "New Schedule" floating action button
- **New Schedule form**: Full configuration with collapsible advanced sections
- **Dark theme**: #0d1117 background, #161b22 cards, #58a6ff accent
- **Mobile-first**: 44px minimum touch targets

## Dashboard Integration

The schedules tab integrates with the existing remote control dashboard:

- Real-time updates via SSE
- Consistent card layout with task cards
- Shared authentication and CSRF protection
- Same rate limiting rules

## Security

### Input Validation
- All inputs validated against allowlists
- Project paths checked against allowed list
- Agent names checked against allowed list
- Command names checked against allowed list
- Prompt templates scanned for secrets

### CSRF Protection
- All write operations require CSRF token
- Tokens are single-use with replay detection
- Tokens expire after 1 hour

### Rate Limiting
- Write operations: 30 per minute per IP
- Read operations: 120 per minute per IP

### Audit Logging
- All schedule operations are audit-logged
- Includes: action, user, schedule ID, IP address, timestamp

### Secret Prevention
- Prompt templates scanned for API keys, tokens, passwords
- Secrets are rejected before schedule creation
- No secrets in schedule display or API responses

### Project Locks
- Schedules are locked to their creation project
- Cannot modify project after creation (must delete and recreate)

## Troubleshooting

### Schedule not running
1. Check scheduler status: `GET /api/scheduler/status`
2. Verify schedule is `active` (not paused or deleted)
3. Check if in maintenance window
4. Check if consecutive failures triggered auto-pause
5. Verify schedule expression syntax

### Execution failing
1. Check execution history: `GET /api/schedules/:id/history`
2. Look for error messages
3. Check budget limits
4. Check if approval is pending (per_run policy)
5. Check agent availability

### Engine not starting
1. Check systemd status: `systemctl status opencode-scheduler`
2. Check logs: `journalctl -u opencode-scheduler -f`
3. Verify bun is installed at `/root/.bun/bin/bun`
4. Check data directory permissions
5. Verify scheduler-engine.ts exists

### Timezone issues
1. Verify timezone name is IANA format
2. Check DST transitions in schedule expression
3. Use explicit timezone in schedule, not system default

## Rollback

To rollback scheduler changes:

1. Stop the scheduler: `systemctl stop opencode-scheduler`
2. Restore schedule data: `cp data/scheduler/schedules.json.bak data/scheduler/schedules.json`
3. Restart: `systemctl start opencode-scheduler`

To disable the scheduler entirely:
```bash
systemctl stop opencode-scheduler
systemctl disable opencode-scheduler
```

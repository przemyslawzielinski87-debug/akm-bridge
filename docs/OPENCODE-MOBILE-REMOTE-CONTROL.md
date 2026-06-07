# OpenCode Mobile Remote Control

## Overview

The OpenCode Mobile Remote Control system enables secure task creation, approval, and monitoring from a mobile device. It consists of a task queue, execution adapter, worker process, and SSE-based real-time updates.

## Architecture

```
Mobile Browser (PWA)
       │
       ▼
  ┌─────────────┐     SSE     ┌──────────────┐
  │  HTTP Server │◄────────────│  Task Queue   │
  └─────────────┘             └──────────────┘
       │                            │
       ▼                            ▼
  ┌─────────────┐     ┌──────────────┐
  │  CSRF Guard  │     │   Worker     │
  └─────────────┘     └──────────────┘
       │                      │
       ▼                      ▼
  ┌─────────────┐     ┌──────────────┐
  │ Audit Log   │     │  Approval    │
  └─────────────┘     │  Manager     │
                      └──────────────┘
```

### Components

1. **HTTP Server** — Bun-based HTTP server exposing REST API and SSE stream
2. **Task Queue** — SQLite-backed queue managing task lifecycle
3. **Execution Adapter** — Bridges remote tasks to OpenCode sessions
4. **Worker** — Processes queued tasks, manages execution
5. **SSE Manager** — Real-time event streaming to connected clients
6. **CSRF Guard** — Token + nonce validation for write operations
7. **Audit Log** — Append-only log of all actions
8. **Rate Limiter** — Per-IP request throttling

## Task Lifecycle

### States

```
queued
  │
  ▼
validating
  │
  ├──► waiting_for_worker
  │         │
  │         ▼
  │       running
  │         │
  │         ├──► waiting_for_approval
  │         │         │
  │         │         ├──► completed
  │         │         └──► failed
  │         │
  │         ├──► completed
  │         ├──► failed
  │         └──► cancelled
  │
  ├──► failed
  └──► cancelled
```

### Transitions

| From | To | Trigger |
|------|----|---------|
| queued | validating | Worker picks up task |
| validating | waiting_for_worker | Validation passes |
| validating | failed | Validation fails |
| waiting_for_worker | running | Worker starts execution |
| running | waiting_for_approval | Approval required |
| running | completed | Execution succeeds |
| running | failed | Execution fails |
| waiting_for_approval | completed | Approval granted |
| waiting_for_approval | failed | Approval denied or expired |
| completed | — | Terminal state |
| failed | queued | Retry requested |
| cancelled | queued | Retry requested |

### State Validation

All state transitions are validated against the allowed transition map. Invalid transitions are rejected with an error. Terminal states (`completed`, `failed`, `cancelled`) can only transition to `queued` via retry.

## Approval Model

### Principles

- **One approval per operation** — No bulk approvals
- **No global approval** — Cannot approve all future operations
- **Expiration** — Approvals expire after 10 minutes
- **Double confirmation** — High-risk operations require two approvals
- **Deny-class auto-reject** — Certain operations are automatically denied

### High-Risk Operations

Operations requiring double confirmation:
- File deletion
- Service restarts
- Configuration changes affecting production
- Database migrations

### Deny-Class Operations

These are automatically rejected without entering the approval queue:
- `rm -rf`
- `DROP TABLE`
- `FORMAT`
- `delete_all`
- `nuke`
- Any command with shell metacharacters

### Approval Flow

1. Task reaches `running` state
2. Worker determines if approval is needed
3. If yes, task moves to `waiting_for_approval`
4. Approval request sent to connected mobile clients via SSE
5. User approves or denies
6. Task proceeds or fails based on decision

## Project Locks

### Purpose

Prevent concurrent write operations on the same project to avoid conflicts.

### Rules

- **One write task per project** — Only one write task can run at a time per project
- **Read-only tasks parallel** — Multiple read-only tasks can run concurrently
- **Lock scope** — Locks are per-project, not global
- **Lock release** — Locks are released on task completion or cancellation

### Lock Lifecycle

```
Task starts (write)
  → Acquire lock (project, task_id)
  → Execute
  → Release lock
```

If lock acquisition fails:
- Task waits in `waiting_for_worker` state
- Worker periodically checks for available locks
- Task proceeds when lock becomes available

## Cancel

### Flow

1. User sends cancel request via API
2. Task enters `cancelling` state
3. Graceful abort signal sent to worker
4. Worker completes current operation
5. Lock released
6. Task state set to `cancelled`

### Constraints

- Only the specific session is cancelled
- Other tasks for the same project continue
- Cancel cannot be undone (retry creates new task)

## Retry

### Eligible States

- `failed`
- `cancelled`

### Behavior

- Creates a new task with reference to the original
- Inherits project, agent, and prompt from original
- Checks state before retrying write tasks (ensures lock is available)
- Original task remains in its final state

### Retry Limits

- Maximum 3 retries per task
- Each retry creates a new audit entry
- Retry count tracked in task metadata

## Task Store (SQLite)

### Schema

```sql
CREATE TABLE tasks (
  id TEXT PRIMARY KEY,
  project TEXT NOT NULL,
  agent TEXT NOT NULL,
  prompt TEXT NOT NULL,
  risk_level TEXT DEFAULT 'low',
  state TEXT NOT NULL DEFAULT 'queued',
  idempotency_key TEXT UNIQUE,
  original_task_id TEXT,
  retry_count INTEGER DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  started_at INTEGER,
  completed_at INTEGER,
  error TEXT,
  result TEXT
);

CREATE TABLE approvals (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL,
  operation TEXT NOT NULL,
  description TEXT,
  risk_level TEXT DEFAULT 'low',
  status TEXT DEFAULT 'pending',
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  approved_at INTEGER,
  FOREIGN KEY (task_id) REFERENCES tasks(id)
);

CREATE TABLE audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  action TEXT NOT NULL,
  task_id TEXT,
  user TEXT,
  details TEXT,
  timestamp INTEGER NOT NULL
);

CREATE TABLE project_locks (
  project TEXT PRIMARY KEY,
  task_id TEXT NOT NULL,
  acquired_at INTEGER NOT NULL,
  FOREIGN KEY (task_id) REFERENCES tasks(id)
);
```

### Indexes

```sql
CREATE INDEX idx_tasks_state ON tasks(state);
CREATE INDEX idx_tasks_project ON tasks(project);
CREATE INDEX idx_tasks_created ON tasks(created_at);
CREATE INDEX idx_approvals_task ON approvals(task_id);
CREATE INDEX idx_approvals_status ON approvals(status);
CREATE INDEX idx_audit_timestamp ON audit_log(timestamp);
```

## Notifications

### Browser Notifications

- **Approvals** — New approval request received
- **Completions** — Task completed successfully
- **Failures** — Task failed

### Badge Count

- Shows count of pending approvals
- Updates in real-time via SSE
- No notification for routine status changes

### Security

- No secrets in notification body
- No prompt content in notifications
- Only task ID and operation name

## PWA (Progressive Web App)

### Manifest

```json
{
  "name": "OpenCode Remote Control",
  "short_name": "OC Remote",
  "display": "standalone",
  "background_color": "#0d1117",
  "theme_color": "#58a6ff",
  "start_url": "/",
  "icons": []
}
```

### Features

- Installable on mobile devices
- Standalone display mode
- Dark theme matching OpenCode UI
- Works offline (cached static assets)

## Security

### CSRF Protection

All write operations require:
1. CSRF token in request header
2. One-time nonce in request body
3. Token validated against session
4. Nonce consumed after use (replay prevention)

### Rate Limiting

- **Window**: 60 seconds
- **Max requests**: 60 per window per IP
- **Key**: IP address + session ID
- **Response**: 429 Too Many Requests

### Authentication

- Session-based authentication
- Token expiry: 24 hours
- No API keys in client-side code

### Allowlists

#### Projects
Only configured projects can receive tasks. Unknown project names are rejected.

#### Agents
Only whitelisted agents can be invoked remotely:
- `infra-ops`
- `reviewer`
- `release-manager`
- `meridian-dev`
- `akm-build`

#### Commands
Only approved commands can be executed. Shell metacharacters are always rejected.

### No Shell Execution

The remote control server does NOT expose:
- Shell execution endpoints
- `exec()` or `spawn()` with shell: true
- `/bin/sh` or `/bin/bash` invocation
- Arbitrary command injection vectors

All operations are handled through the task queue and worker system, which uses typed operation handlers.

### Audit Trail

Every action is logged:
- Task creation, approval, execution, completion
- Approval grant/denial
- Cancel/retry operations
- Connection/disconnection events

Log is append-only. Entries cannot be modified or deleted.

## Retention Policy

### Task Data

- **Full prompts**: Retained for 7 days
- **Prompt summaries**: Retained for 30 days
- **Task metadata**: Retained for 90 days

### Audit Log

- **Entries**: Retained for 90 days
- **Maximum**: 10,000 entries
- **Cleanup**: Automatic daily at 03:00 UTC

### Approvals

- **Expired approvals**: Deleted after 24 hours
- **Completed approvals**: Deleted after 7 days

## API Reference

### POST /api/tasks

Create a new task.

**Headers:**
- `X-CSRF-Token`: CSRF token
- `Content-Type`: application/json

**Body:**
```json
{
  "project": "project-name",
  "agent": "infra-ops",
  "prompt": "Run system check",
  "risk_level": "low",
  "idempotency_key": "unique-key"
}
```

**Response:**
```json
{
  "id": "task-123",
  "state": "queued",
  "created_at": 1700000000000
}
```

### GET /api/tasks/:id

Get task details.

### GET /api/tasks

List all tasks with optional filters.

### POST /api/tasks/:id/cancel

Cancel a task.

### POST /api/tasks/:id/retry

Retry a failed/cancelled task.

### POST /api/approvals/:id/approve

Approve a pending approval.

### POST /api/approvals/:id/deny

Deny a pending approval.

### GET /api/status

Get system status.

### GET /api/events

SSE endpoint for real-time events.

### GET /api/health

Health check endpoint.

## Deployment

### Prerequisites

- Bun runtime
- SQLite
- Port 4201 available

### Installation

1. Copy systemd service file:
   ```bash
   cp .systemd/opencode-remote-control.service /etc/systemd/system/
   ```

2. Enable and start:
   ```bash
   systemctl daemon-reload
   systemctl enable opencode-remote-control
   systemctl start opencode-remote-control
   ```

3. Verify:
   ```bash
   systemctl status opencode-remote-control
   curl http://127.0.0.1:4201/api/health
   ```

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `REMOTE_PORT` | 4201 | Server port |
| `REMOTE_HOST` | 127.0.0.1 | Bind address |
| `OPENCODE_ATTACH_URL` | http://127.0.0.1:4097 | OpenCode attach URL |

### Reverse Proxy (Nginx)

```nginx
location /remote/ {
    proxy_pass http://127.0.0.1:4201/;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_read_timeout 86400;
}
```

## Troubleshooting

### Task stuck in queued

- Check worker process is running: `systemctl status opencode-remote-control`
- Check project lock: query `project_locks` table
- Check worker logs: `journalctl -u opencode-remote-control`

### Approval not received

- Verify SSE connection: check browser DevTools Network tab
- Check notification permissions in browser
- Verify CSRF token is valid

### Server won't start

- Check port availability: `ss -tlnp | grep 4201`
- Check Bun version: `bun --version`
- Check file permissions on database directory

### Rate limiting active

- Wait 60 seconds for window reset
- Check if multiple devices are hitting the same endpoint
- Review rate limiter configuration

## Rollback

### Steps

1. Stop the service:
   ```bash
   systemctl stop opencode-remote-control
   ```

2. Disable autostart:
   ```bash
   systemctl disable opencode-remote-control
   ```

3. Remove service file:
   ```bash
   rm /etc/systemd/system/opencode-remote-control.service
   systemctl daemon-reload
   ```

4. Database remains in place for audit trail

5. Verify OpenCode core functionality is unaffected:
   ```bash
   curl http://127.0.0.1:4097/health
   ```

# OpenCode Secure Notifications

Secure external notification system for OpenCode with multi-channel delivery, persistent queue, and full security controls.

## Architecture

```
┌──────────────┐     ┌──────────────────┐     ┌─────────────┐
│ Event Source  │────▶│ NotificationManager│────▶│   Queue     │
│ (tasks, sched,│     │                  │     │  (SQLite)   │
│  recovery,    │     │ - emit()         │     │             │
│  approvals)   │     │ - dispatch()     │     │  dedup key  │
└──────────────┘     │ - dispatchQueued()│     │  channel    │
                      └──────────────────┘     │  status     │
                               │                └─────────────┘
                    ┌──────────┴──────────┐
                    ▼                      ▼
            ┌──────────┐          ┌──────────┐
            │ Adapters  │          │ Worker   │
            │ email     │          │ (loop)   │
            │ telegram  │          │ 30s poll │
            │ webhook   │          │ retry    │
            │ dashboard │          └──────────┘
            │ pwa       │
            └──────────┘
```

### Core Components

- **NotificationManager** (`src/notifications/notification-manager.ts`): Central orchestrator. Routes events to adapters, manages queue, handles retry logic.
- **NotificationStore** (`src/notifications/notification-store.ts`): SQLite WAL-backed persistent queue. Schema version 1.
- **NotificationAPI** (`src/notifications/notification-api.ts`): HTTP routes for PWA and external consumers.
- **Worker** (`src/notifications/worker.ts`): Standalone dispatch loop process. Polls queue every 30 seconds.
- **Adapters**: Channel-specific delivery implementations.

### File Structure

```
src/notifications/
├── notification-types.ts      # Type definitions
├── notification-store.ts      # SQLite queue + DI
├── notification-manager.ts    # Core orchestrator
├── notification-api.ts        # HTTP routes
├── notification-formatter.ts  # Message formatting
├── notification-redactor.ts   # Secret redaction
├── notification-digest.ts     # Daily/weekly digests
├── notification-utils.ts      # Shared utilities
├── notification-adapter.ts    # Adapter interface
├── email-adapter.ts           # SMTP delivery
├── telegram-adapter.ts        # Bot API delivery
├── webhook-adapter.ts         # HMAC webhook delivery
├── internal-adapters.ts       # Dashboard + PWA
└── worker.ts                  # Dispatch loop entrypoint
```

## Channels

### Dashboard
- In-app notification display
- Always configured when remote-control is active
- No external delivery required

### PWA
- Browser push notifications via Service Worker
- Requires Notification permission
- Always configured when PWA is served

### Email (SMTP)
- TLS-encrypted delivery
- Header injection protection (rejects `\r\n` in subject/headers)
- Recipient allowlist (only pre-configured recipients)
- Credentials via environment variables, never in code

Configuration:
```bash
SMTP_HOST=smtp.example.com
SMTP_PORT=587
SMTP_USERNAME=alerts@example.com
SMTP_PASSWORD=<secret>
SMTP_FROM=alerts@example.com
SMTP_RECIPIENT_ALLOWLIST=user1@example.com,user2@example.com
```

### Telegram
- Bot API with chat ID verification
- HTML parse mode for formatting
- Credentials via environment variables

Configuration:
```bash
TELEGRAM_BOT_TOKEN=<secret>
TELEGRAM_CHAT_ID=<chat_id>
```

### Webhook
- HMAC-SHA256 signatures for payload integrity
- Replay protection (timestamp window)
- Private IP blocking (SSRF prevention)
- Custom headers support

Configuration:
```bash
WEBHOOK_URL=https://example.com/webhook
WEBHOOK_HMAC_SECRET=<secret>
WEBHOOK_CUSTOM_HEADERS={"X-Custom": "value"}
```

## SQLite Queue

The notification queue uses SQLite with WAL mode for concurrent reads:

- **notifications** table: queued/dispatched/failed/suppressed/expired notifications
- **deliveries** table: per-channel delivery attempts with status and error tracking
- **preferences** table: per-user notification preferences

Schema auto-migrates on startup. DB path:
```
process.env.NOTIFICATION_DB_PATH || data/notifications.db
```

### Deduplication

Notifications are deduplicated by `(dedup_key, channel)` UNIQUE constraint within a configurable time window (default: 1 hour). Duplicate events are silently dropped.

## Adapter Interface

All adapters implement the `NotificationAdapter` interface:

```typescript
interface NotificationAdapter {
  readonly channel: string;
  configure(config: Record<string, unknown>): void;
  isConfigured(): boolean;
  isHealthy(): Promise<HealthStatus>;
  send(notification: Notification): Promise<DeliveryResult>;
}
```

### DeliveryResult
```typescript
interface DeliveryResult {
  ok: boolean;
  latencyMs?: number;
  error?: string;
  errorCategory?: string; // 'auth' | 'rate_limit' | 'network' | 'config' | 'unknown'
  retryable?: boolean;
}
```

## Retry Policy

- **maxAttempts**: 3 (configurable)
- **backoffMultiplier**: 2 (exponential)
- **Initial delay**: 5 seconds
- **Fatal errors**: auth failures, invalid config (no retry)
- **Retryable errors**: network timeouts, rate limits, transient failures

## Approval Deep Links

Approval notifications include a deep link URL:
- Format: `https://{host}/api/approvals/{id}/resolve?decision={decision}&token={token}`
- Token is HMAC-signed, short-lived, single-use
- **No one-click approval**: deep links navigate to the approval page, user must confirm
- Token is never exposed in logs, API responses, or frontend

## Quiet Hours

Notifications can be suppressed during configured quiet hours:
- Configurable start/end times per timezone
- Uses `Intl.DateTimeFormat` for timezone-aware comparison
- Approval notifications bypass quiet hours (safety-critical)

## Preferences

User-configurable notification preferences:
- `enabled_channels`: which channels to deliver to
- `severity_threshold`: minimum severity (info/warning/error)
- `quiet_hours_start` / `quiet_hours_end`: suppression window
- `timezone`: for quiet hours calculation
- `daily_digest` / `weekly_digest`: digest delivery
- `approval_notifications`: approval request delivery
- `task_completion` / `task_failure_notifications`: task events
- `recovery_notifications` / `scheduler_notifications`: system events

PUT `/api/notifications/preferences` requires CSRF token and only allows whitelisted keys.

## Digests

### Daily Digest
- Summary of all notifications from the past 24 hours
- Grouped by channel and severity
- Delivered at configured time

### Weekly Digest
- Summary of all notifications from the past 7 days
- Includes statistics and trend data

## PWA UI

The Notifications tab in the PWA remote control interface provides:

### Sub-tabs

1. **Overview**: Queue stats (queued, sent, failed, suppressed, expired, deduplicated, unread, approvals, last delivery)
2. **Channels**: Per-channel status (configured, healthy/degraded/failed, latency, last success/failure)
3. **Preferences**: Toggle channels, set severity threshold, quiet hours, event types, digests
4. **Recent**: Notification history with severity, summary, channels, status, deep links
5. **Deliveries**: Delivery log per channel with status and error details
6. **Failed**: Filtered view of failed deliveries
7. **Digests**: Digest preview (when enabled)
8. **Test**: Send safe test notification (fixed payload, CSRF required, rate-limited to 3/min)

### Mobile Support

- Responsive grid at 360/390/412px viewports
- Touch targets minimum 44px
- Single-column layout on small screens
- Collapsible sections
- Status text + icon, not color-only indicators

## systemd / Runtime

### Worker Process

The notification worker (`src/notifications/worker.ts`) runs as a standalone process:
- Creates NotificationManager from environment
- Executes initial `dispatchQueued()`
- Polls queue every 30 seconds via `setInterval`
- Handles SIGTERM/SIGINT with 2-second grace period
- Logs safe metadata only (no secrets)

### systemd Template

`.systemd/opencode-notification-worker.service`:
```ini
[Unit]
Description=OpenCode Notification Worker
After=network.target
StartLimitIntervalSec=300
StartLimitBurst=5

[Service]
Type=simple
User=root
WorkingDirectory=/root/projekt/akm-bridge
ExecStart=/root/.bun/bin/bun run src/notifications/worker.ts
Restart=on-failure
RestartSec=10
EnvironmentFile=-/root/projekt/akm-bridge/.env.notifications
NoNewPrivileges=true
PrivateTmp=true
UMask=0077

[Install]
WantedBy=multi-user.target
```

### Deployment
```bash
cp .systemd/opencode-notification-worker.service /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now opencode-notification-worker
systemctl status opencode-notification-worker
journalctl -u opencode-notification-worker -f
```

### Activation Decision

The notification worker runs as a **dedicated process** separate from the main OpenCode server. This provides:
- Independent restart without affecting the main server
- Isolated failure domain
- Separate resource limits
- Clean lifecycle management

## Observability

- `/api/notifications/status`: counts + health + channels + preferences
- `/api/notifications/channels`: per-channel configured/healthy status
- Delivery success/failure tracked in SQLite deliveries table
- Error categories: auth, rate_limit, network, config, unknown
- Worker logs dispatch cycles and errors

## Security Model

### Credentials
- All credentials via environment variables (never in code or config files committed to git)
- `.env.notifications` loaded by systemd EnvironmentFile
- Credentials never exposed in API responses, logs, or frontend bundle

### Transport
- SMTP: TLS encryption
- Webhook: HMAC-SHA256 signatures
- Dashboard/PWA: HTTPS (via existing remote-control TLS)

### Input Validation
- SMTP header injection: rejects `\r\n` in subject and custom headers
- Recipient injection: only pre-configured allowlist recipients
- Webhook SSRF: blocks private/loopback IPs
- XSS: all notification summaries HTML-escaped in PWA

### CSRF
- All state-changing operations (PUT preferences, POST test, POST acknowledge) require CSRF token
- Token rotated on login

### Rate Limiting
- Test notification endpoint: 3 requests per minute per IP
- Delivery retries respect per-channel rate limits

### Redaction
The `notification-redactor.ts` module automatically redacts:
- GitHub PATs (`ghp_`, `github_pat_`)
- AWS keys (`AKIA`, `ASIA`)
- OpenAI API keys (`sk-`)
- Bearer tokens
- Private keys (`BEGIN RSA PRIVATE KEY`, `BEGIN OPENSSH PRIVATE KEY`)
- Telegram bot tokens in URLs
- SMTP header injection attempts

### Deep Link Security
- Approval tokens are HMAC-signed, single-use, time-limited
- Tokens never appear in logs, API responses, or frontend code
- Deep links navigate to confirmation page (no one-click approval)

## Tests

### Standalone (47 tests)
```bash
bun test tests/notifications.test.ts
```
Covers: delivery workflows, error handling, retry, dedup, quiet hours, redaction, approval links, preferences, health, digest.

### Cross-file Isolation
Previous cross-file test failures were caused by `vi.mock('bun:sqlite')` in `tests/remote-control.test.ts` polluting the global module cache. Fixed by removing the unnecessary mock (the test doesn't import notification modules).

## Troubleshooting

### Notifications not delivering
1. Check channel configuration: `GET /api/notifications/channels`
2. Verify credentials in environment
3. Check worker logs: `journalctl -u opencode-notification-worker`
4. Verify queue: `GET /api/notifications/status`

### Duplicate notifications
Check deduplication window in store. Default is 1 hour per `(dedup_key, channel)`.

### Quiet hours blocking approvals
Quiet hours do NOT block approval notifications by design (safety-critical). Verify `approval_notifications` is enabled in preferences.

### Worker not starting
1. Verify `.env.notifications` exists and is readable
2. Check `systemd-analyze verify .systemd/opencode-notification-worker.service`
3. Check `systemctl status opencode-notification-worker`

## Rollback

1. Stop the worker: `systemctl stop opencode-notification-worker`
2. Disable: `systemctl disable opencode-notification-worker`
3. Restore from backup: `/root/.config/opencode/backup/{timestamp}-notifications-finalization/`
4. Restart main OpenCode server if needed
5. Notification queue (SQLite) is preserved independently

## Disaster Recovery

### Manifest Entries
- `src/notifications/worker.ts` — worker entrypoint
- `.systemd/opencode-notification-worker.service` — systemd template
- `data/notifications.db` — queue database (ephemeral, rebuildable)
- `docs/OPENCODE-SECURE-NOTIFICATIONS.md` — this documentation

### Bootstrap Restore
Bootstrap restores: code, schema, unit template, config placeholders.
Bootstrap does NOT restore: credentials, runtime database, logs.

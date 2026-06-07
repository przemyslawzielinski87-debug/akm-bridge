# OpenCode Secure Notifications

## Architecture

- **Notification Manager**: Central orchestrator
- **Adapters**: Email, Telegram, Webhook, Dashboard, PWA
- **SQLite WAL**: Persistent queue with deduplication
- **Deep Links**: Secure approval URLs

## Channels

### Email
- SMTP with TLS
- Header injection protection
- Recipient allowlist

### Telegram
- Bot API
- Chat ID verification
- Parse modes (HTML/Markdown)

### Webhook
- HMAC signatures
- Replay protection
- Private IP blocking

## Security

- No credentials in code/repo
- Redaction for secrets in logs
- CSRF protection for UI
- Rate limiting

## Testing

47 standalone tests covering:
- Delivery workflows
- Error handling
- Security controls
- Deduplication

## Deployment

1. Copy `.systemd/opencode-notification-worker.service` to `/etc/systemd/system/`
2. `systemctl daemon-reload`
3. `systemctl enable --now opencode-notification-worker`

## Rollback

1. `systemctl stop opencode-notification-worker`
2. Restore from `/root/.config/opencode/backup/`
3. Restart existing services
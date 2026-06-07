# OpenCode Safe Recovery

Guarded self-healing for OpenCode, AKM bridge, and MCP servers.

## Architecture

```
                    ┌──────────────────────────────────┐
                    │    opencode-recovery-controller   │
                    │    (state machine + health check) │
                    └──────────┬───────────────────────┘
                               │
          ┌────────────────────┼────────────────────┐
          ▼                    ▼                    ▼
   opencode.service    akm-bridge.service     MCP servers
   (systemd)           (systemd)              (stdio children)
                     + akm-cli (bun)
```

## State Machine

```
HEALTHY ──(failure)──► DEGRADED ──(2nd)──► FAILURE_SUSPECTED
                                                    │
                                          (3rd failure)│
                                                    ▼
                                              RECOVERY_PENDING
                                                    │
                                          (rate check)│
                                               ┌──────┴──────┐
                                               ▼              ▼
                                        (allowed)       (cooldown)
                                            │              COOLDOWN
                                            ▼
                                      RECOVERY_RUNNING
                                            │
                                   ┌────────┴────────┐
                                   ▼                  ▼
                              (all tests)       (any fail)
                                   │                  │
                              RECOVERED         RECOVERY_FAILED
                                   │                  │
                              COOLDOWN    (max tries?) │
                                                     │
                                            ESCALATION_REQUIRED
```

### Allowed States
- **HEALTHY** — all checks pass
- **DEGRADED** — class 1 functional issues (e.g. semantic search blocked but FTS works)
- **FAILURE_SUSPECTED** — 2 consecutive failures, monitoring
- **RECOVERY_PENDING** — 3+ consecutive failures, about to act
- **RECOVERY_RUNNING** — recovery actions in progress
- **RECOVERED** — recovery succeeded, functional tests pass
- **RECOVERY_FAILED** — recovery actions completed but tests failed
- **COOLDOWN** — waiting period after recovery
- **ESCALATION_REQUIRED** — human intervention needed

## Failure Classification

| Class | Type | Examples | Automatic Action |
|-------|------|----------|-----------------|
| 0 | Transient | Single timeout, HTTP 5xx | None — log only |
| 1 | Functional | Empty content, one tool broken | Fallback mode (CLI, FTS) |
| 2 | MCP Failure | Initialize fail, process exit | Restart MCP/service |
| 3 | OpenCode Failure | Process crash, config parse error | Restart service |
| 4 | Human Required | Bad config, auth failure, disk full | Escalate immediately |

## Thresholds

| Parameter | Value |
|-----------|-------|
| WARNING_AFTER | 2 consecutive failures |
| RECOVERY_AFTER | 3 consecutive failures |
| ESCALATE_AFTER | 3 failed recovery attempts |
| SUCCESS_RESET_AFTER | 2 consecutive successes |
| RECOVERY_COOLDOWN_SECONDS | 120 |
| MAX_RECOVERY_ATTEMPTS | 3 |
| ATTEMPT_WINDOW_MINUTES | 30 |
| MAX_RESTARTS_PER_HOUR | 2 |

## Components

| Component | Start Method | Systemd Service | Restart Individually |
|-----------|-------------|-----------------|---------------------|
| opencode | systemd | opencode.service | Yes |
| opencode-web | systemd | opencode-web.service | Yes |
| akm-bridge | systemd | akm-bridge.service | Yes |
| akm-cli | stdio-child | (managed by opencode) | No (fallback via CLI path) |

## Allowed Actions

### Automatic (no approval needed)
- Re-run health check
- CLI fallback (use explicit bun path)
- FTS fallback when semantic search is blocked
- Single systemd restart after threshold met
- Functional test after recovery
- Diagnostic logging

### Requires `ask`
- Editing configuration files
- Restarting OpenCode main process
- Modifying permissions
- Changing service entrypoint
- Environment variable changes

### Forbidden
- Reboot, shutdown
- Force push, hard reset
- `docker system prune` or similar cleanup
- Secret/key regeneration
- Mass package reinstallation
- DNS/Cloudflare changes

## AKM Fallback Chain

1. **AKM MCP** (stdlib child) — health check via opencode
2. **AKM CLI** (`/root/.bun/bin/bun /root/.bun/bin/akm`) — direct invocation
3. **FTS** (full-text search instead of semantic) — degraded mode
4. **Escalation** — if all fallbacks fail

### Degraded Mode Reporting
```json
{
  "AKM_MCP": "healthy",
  "AKM_CLI": "healthy",
  "AKM_SEMANTIC": "blocked",
  "AKM_FTS": "healthy",
  "AKM_OVERALL": "degraded"
}
```

## Systemd Integration

Timer and service templates in `.systemd/`:

| File | Purpose |
|------|---------|
| `opencode-recovery-check.service` | Oneshot recovery evaluation |
| `opencode-recovery-check.timer` | Runs every 5 minutes |

Manual install:
```bash
cp .systemd/*.service .systemd/*.timer /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now opencode-recovery-check.timer
```

## Recovery History

Tracked in `/tmp/opencode-recovery-state.json`:
- Per-component state machine state
- Consecutive failure/success counts
- Recovery attempt counters
- Cooldown timers
- Escalation flags

Retention: state file is overwritten on each check (no history accumulation).

Extended history (for observability report):
- `RECOVERY_ATTEMPTS_24H`
- `RECOVERY_SUCCESSES_24H`
- `RECOVERY_FAILURES_24H`
- `COMPONENTS_IN_COOLDOWN`
- `ESCALATIONS_24H`

## Post-Task Learning Guard

- After successful non-trivial recovery → evaluate learning value
- Duplicate search before saving lesson
- Confidence gate: high/medium/low
- `learning_triggered_by_recovery=true`
- `do_not_trigger_recovery_from_learning=true`
- Prevents infinite loop between recovery and learning

## Commands

### `/recover`

| Mode | Action |
|------|--------|
| `/recover` | Read-only status display |
| `/recover --dry-run` | Evaluate + show plan, no actions |
| `/recover akm-bridge` | Recover specific component |
| `/recover --status` | Show current state from file |

Agent: `infra-ops`. Default is read-only.

## Skill

`safe-recovery` — available to `akm-build` and `infra-ops`.

Enforces: classification → gate → rate limit → execute → verify → report → escalate.

Not available to read-only agents (reviewer, researcher, security-auditor).

## Safe Recovery Tests

### Test A — Single Timeout
- No restart expected
- State: DEGRADED or HEALTHY (warning only)

### Test B — Three Consecutive Timeouts (MCP)
- Recovery proposal or safe respawn
- Cooldown after recovery

### Test C — Empty Content
- Detected as functional error
- Not treated as success

### Test D — AKM MCP Down, CLI Working
- Degraded mode
- CLI fallback
- No functionality loss

### Test E — Semantic Search 401, FTS Working
- Degraded (not failed)
- No restart needed

### Test F — Bad Configuration
- Validation fails before restart
- Escalation immediately

### Test G — Process Crash
- Confirm missing PID
- Single recovery attempt
- Functional test after restart

### Test H — Restart Loop Protection
- Max attempts enforced
- Cooldown applied
- Escalation after limit

### Test I — Permission Denial
- No bypass
- Action proposal (requires ask)

### Test J — Recovery Success
- RECOVERED only after functional tool call

## Rollback

Restore from backup:
```bash
cp /root/.config/opencode/backup/20260607134004-recovery/opencode.json /root/.config/opencode/opencode.json
```

Stop recovery timer:
```bash
systemctl stop opencode-recovery-check.timer
systemctl disable opencode-recovery-check.timer
```

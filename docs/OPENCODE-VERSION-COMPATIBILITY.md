# OpenCode Version Compatibility System

## Architecture Overview

The version compatibility system manages OpenCode updates safely through a multi-stage pipeline: check → canary → promote → rollback. Every change is snapshotted, every update is gated, and every action is logged.

```
┌─────────────┐    ┌─────────────┐    ┌─────────────┐    ┌─────────────┐
│  Update      │───▶│  Canary      │───▶│  Promotion  │───▶│  Monitoring │
│  Check       │    │  Test        │    │  Gate       │    │             │
└─────────────┘    └─────────────┘    └─────────────┘    └─────────────┘
       │                  │                  │                  │
       ▼                  ▼                  ▼                  ▼
  version-lock.json  snapshots/       update-state.json   observability
  matrix.json        canary-profile   approval.log        metrics
```

## Component Inventory

| Component | Source | Version Tracking |
|-----------|--------|-----------------|
| OpenCode | npm/binary | opencode-version-lock.json → opencode.version |
| Plugins | npm | opencode-version-lock.json → plugins.* |
| MCP Servers | npm/config | opencode-version-lock.json → mcpServers.* |
| AKM | git/build | opencode-version-lock.json → akm.version |
| AKM Bridge | git | opencode-version-lock.json → akmBridge.commit |
| Bun | system | opencode-version-lock.json → runtime.bun |
| Node | system | opencode-version-lock.json → runtime.node |

## Version Lock File

Location: `compatibility/opencode-version-lock.json`

Tracks all component versions in a single source of truth. Schema version increments on structural changes. Updated only after successful promotion or manual validation.

```json
{
  "opencode": { "version": "1.16.0", "installMethod": "binary" },
  "runtime": { "bun": "1.3.14", "node": "v22.22.2" },
  "akm": { "version": "0.8.1" },
  "akmBridge": { "commit": "332e462", "version": "0.1.0" },
  "plugins": { "tokenscope": "1.6.5", ... },
  "mcpServers": { "lean-ctx": "enabled", ... },
  "schemaVersion": 1,
  "validatedAt": "2026-06-07T12:00:00Z"
}
```

## Compatibility Matrix

Location: `compatibility/matrix.json`

Records validated version combinations. Each entry proves that a specific set of component versions passed E2E testing together.

```json
{
  "validatedCombinations": [
    {
      "opencode": "1.16.0",
      "bun": "1.3.14",
      "node": "v22.22.2",
      "plugins": { ... },
      "status": "validated",
      "validatedAt": "2026-06-07T12:00:00Z"
    }
  ],
  "blockedVersions": []
}
```

## Update Classes

### Patch (e.g., 1.16.0 → 1.16.1)
- **Risk**: LOW
- **Required tests**: Static analysis, smoke test, critical MCP tests
- **Canary**: Optional
- **Approval**: Auto-approve if CI green
- **Timeline**: Immediate

### Minor (e.g., 1.16.x → 1.17.0)
- **Risk**: MEDIUM
- **Required tests**: Full canary, schema diff, plugin tests, MCP tests, E2E
- **Canary**: Required
- **Approval**: Automated gate
- **Timeline**: 24h soak

### Major (e.g., 1.x → 2.0)
- **Risk**: HIGH
- **Required tests**: Branch, audit, migration plan, full E2E, performance
- **Canary**: Required + extended soak
- **Approval**: Manual explicit approval required
- **Timeline**: 72h soak + monitoring

### Runtime (Bun/Node)
- **Risk**: HIGH
- **Required tests**: Full E2E, plugin compatibility, MCP compatibility
- **Canary**: Required
- **Approval**: Manual
- **Note**: Never update runtime and OpenCode simultaneously

### Plugin
- **Risk**: LOW-MEDIUM (depends on plugin)
- **Required tests**: Plugin-specific tests, integration smoke
- **Canary**: Optional for patch, required for major
- **Approval**: Auto for patch, gate for major

## Autoupdate Policy

OpenCode autoupdate is set to **notify only**. The system:
1. Checks npm registry periodically
2. Reports available updates via journal logs
3. Never auto-installs
4. All updates go through the canary → promote pipeline

## Snapshot System

Location: `/root/.config/opencode/snapshots/`

Each snapshot contains:
- `manifest.json` — version metadata, hashes, agent/command/skill counts
- `opencode.json` — config at snapshot time
- `opencode-version-lock.json` — version lock at snapshot time
- `matrix.json` — compatibility matrix at snapshot time
- `checksums.sha256` — integrity checksums
- `restore.sh` — restoration script (defaults to dry-run)
- `README.txt` — human-readable snapshot info

### Snapshot Naming
```
<ISO-timestamp>-v<version>       (e.g., 2026-06-07T12-19-58-v1.16.0)
snapshot-<version>-<timestamp>   (alternative format)
```

### Snapshot Creation Triggers
- Before any canary test
- Before promotion
- Before rollback
- Manual via `opencode-snapshot.ts --dry-run` or `--execute`

### Restore Script Safety
- Default is `--dry-run` (shows what would change)
- Requires `--execute` to actually restore
- Never restores secrets, tokens, or private keys
- Never restarts the opencode server
- Never modifies binary files

## Canary Profile

An isolated environment for testing a target version without affecting production:

1. **Snapshot** current state
2. **Create** canary directory with target version
3. **Run** test suite:
   - Schema compatibility test
   - Tool schema diff
   - Plugin compatibility tests
   - MCP server tests
   - Full E2E tests
   - Performance comparison
4. **Report** results — nothing promoted automatically
5. **Cleanup** canary after reporting

## Promotion Gate

All 12 conditions must pass before promotion:

| # | Condition | Check |
|---|-----------|-------|
| 1 | Snapshot exists | Snapshot dir with valid manifest |
| 2 | Config validation passed | opencode.json parses correctly |
| 3 | Schema diff accepted | No breaking schema changes |
| 4 | Plugin tests passed | All plugin tests green |
| 5 | MCP tests passed | All MCP server tests green |
| 6 | E2E passed | Full E2E suite green |
| 7 | Performance acceptable | <30% regression from baseline |
| 8 | Rollback tested | Snapshot restore verified |
| 9 | CI passed | GitHub Actions green |
| 10 | Secret scan passed | No secrets in diff |
| 11 | No active incident | Incident system clear |
| 12 | Not in recovery cooldown | Recovery window elapsed |

## Rollback Procedure

1. List available snapshots
2. User selects target snapshot
3. Validate snapshot checksums
4. Require explicit approval
5. Create snapshot of current state (for potential re-rollback)
6. Restore from target snapshot
7. Validate restored config
8. Run smoke test
9. Block the failed version in matrix.json
10. Log rollback event

## Commands

### /update-check
Read-only check for available updates across all components. Reports risk level and recommendation.

```
/update-check              # Check all components
/update-check --opencode   # Check OpenCode only
/update-check --plugins    # Check plugins only
/update-check --runtime    # Check Bun/Node only
```

### /update-canary
Create isolated canary profile and test target version.

```
/update-canary opencode latest      # Test latest OpenCode
/update-canary opencode 1.16.1      # Test specific version
/update-canary plugin tokenscope    # Test plugin update
/update-canary --status             # Show canary status
```

### /update-promote
Promote validated canary to production after all gates pass.

```
/update-promote            # Promote latest validated canary
/update-promote 1.16.1     # Promote specific version
```

### /update-rollback
Rollback to previous version from snapshot.

```
/update-rollback           # Show available snapshots
/update-rollback SNAPSHOT  # Restore from specific snapshot
```

## Version-Compatibility Skill

Located at `/root/.config/opencode/skills/version-compatibility/SKILL.md`. Provides the agent with:
- Decision framework for update classification
- Workflow steps for each phase
- Promotion gate checklist
- Safety rules and file locations

## Recovery Integration

The version system integrates with the recovery system:
- `isIncidentActive()` — blocks promotion during incidents
- `isInRecoveryCooldown()` — blocks promotion during recovery windows
- Recovery check service runs before any production change
- Failed updates trigger recovery procedures

## Learning Loop Integration

After every update cycle, the system evaluates:
- Were there unexpected failures?
- Did performance regress more than expected?
- Were there compatibility issues not caught by tests?
- Should the promotion gate be tightened?

Findings are persisted to AKM for future update decisions.

## Observability

### Metrics Tracked
- Update check duration
- Canary test duration and pass rate
- Promotion success/failure rate
- Rollback frequency and reasons
- Time from check to production
- Performance regression per update

### Logging
All actions logged to:
- `update-state.json` — current state machine
- `opencode-update-controller.ts` — action log
- systemd journal — update check results

### Dashboards
- Update timeline view
- Component version matrix
- Promotion gate status
- Rollback history

## systemd Timer

Weekly update check runs automatically:

```bash
# Install
sudo cp .systemd/opencode-update-check.{service,timer} /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now opencode-update-check.timer

# Check status
systemctl list-timers | grep opencode
journalctl -u opencode-update-check
```

## Troubleshooting

### Update check fails
- Check network connectivity
- Verify npm registry access
- Check GitHub API rate limits
- Review journal logs: `journalctl -u opencode-update-check -n 50`

### Canary test fails
- Check snapshot creation succeeded
- Verify canary profile is isolated
- Review test output for specific failures
- Check plugin compatibility

### Promotion blocked
- Review all 12 gate conditions
- Check `update-state.json` for current state
- Verify no active incidents
- Check recovery cooldown status

### Rollback fails
- Verify snapshot checksums
- Check disk space
- Review restore.sh output
- Manually restore from snapshot directory

## Examples

### Safe patch update flow
```bash
/update-check --opencode          # See 1.16.1 available (patch)
/update-canary opencode 1.16.1    # Test in canary
# ... canary passes ...
/update-promote 1.16.1            # Promote to production
```

### Major version with manual approval
```bash
/update-check --opencode          # See 2.0.0 available (major)
# Review changelog, plan migration
/update-canary opencode 2.0.0     # Extended canary test
# ... 72h soak period ...
# Manual review and approval
/update-promote 2.0.0             # Promote after approval
```

### Emergency rollback
```bash
/update-rollback                  # List snapshots
/update-rollback 2026-06-07T12-19-58-v1.16.0  # Restore
```

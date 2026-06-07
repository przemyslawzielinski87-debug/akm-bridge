# OpenCode Disaster Recovery

## Architecture Overview

OpenCode is a single-user AI coding assistant running on a dedicated Debian
server. The installation consists of:

- **Runtime binaries**: OpenCode CLI, Bun, Node.js
- **Configuration**: `~/.config/opencode/` (agents, skills, permissions, MCP servers)
- **State**: `~/.local/share/opencode/` (sessions, cache, embeddings)
- **AKM layer**: Persistent knowledge, lessons, workflow state
- **Plugins**: MCP servers, external integrations
- **Systemd services**: Auto-start on boot, crash recovery

All components are orchestrated by a bootstrap controller that reads a
deterministic manifest and applies idempotent operations.

## Source of Truth

| Artifact | Path | Purpose |
|---|---|---|
| Bootstrap manifest | `~/.config/opencode/bootstrap-manifest.json` | Exact versions, counts, checksums |
| Version lock | `~/.config/opencode/version-lock.json` | Pinned binary versions |
| Checksums | `~/.config/opencode/checksums.sha256` | Integrity verification |
| Environment manifest | `~/.config/opencode/env-manifest.json` | Platform, secrets, runtime |
| Config templates | `~/.config/opencode/templates/` | Agent/skill/command templates |
| Bootstrap scripts | `/opt/opencode/scripts/` | Controller logic |

## Environment Manifest

The environment manifest captures machine-specific data:

```json
{
  "hostname": "prod-ai-01",
  "platform": { "os": "debian", "arch": "x86_64", "version": "12" },
  "runtime": {
    "opencode": { "version": "1.16.0", "path": "/usr/local/bin/opencode" },
    "bun": { "version": "1.3.14", "path": "/root/.bun/bin/bun" },
    "node": { "version": "v22.22.2", "path": "/usr/local/bin/node" },
    "akm": { "version": "0.8.1", "path": "/root/.bun/bin/akm" }
  },
  "agents": { "count": 13, "templateDir": "templates/agents/" },
  "commands": { "count": 21, "templateDir": "templates/commands/" },
  "skills": { "count": 22, "templateDir": "templates/skills/" },
  "mcpServers": { "count": 7, "templateDir": "templates/mcp-servers/" },
  "secrets": {
    "GITHUB_TOKEN": { "source": "vault", "path": "opencode/github-token" },
    "ANTHROPIC_API_KEY": { "source": "env", "path": "ANTHROPIC_API_KEY" }
  }
}
```

## Bootstrap Controller Modes

The bootstrap controller supports three modes:

| Mode | Description | Writes files? |
|---|---|---|
| `check` | Validates manifest, reports missing/outdated | No |
| `dry-run` | Shows what would change without applying | No |
| `apply` | Executes all operations | Yes |

### Mode Selection

```bash
# Check only
/opt/opencode/scripts/bootstrap-controller.sh check

# Dry-run
/opt/opencode/scripts/bootstrap-controller.sh dry-run

# Apply changes
/opt/opencode/scripts/bootstrap-controller.sh apply
```

## Dry-Run Behavior

Dry-run mode:

1. Reads the bootstrap manifest
2. Compares each artifact against its expected state
3. Outputs a diff of planned changes
4. Exits with status 0 if nothing to change, 1 if changes pending
5. Never creates, modifies, or deletes files
6. Reports checksum mismatches without repairing

Example output:
```
[DRY-RUN] Would install: opencode 1.16.0 → 1.17.0
[DRY-RUN] Would update: ~/.config/opencode/agents/reviewer.json (checksum mismatch)
[DRY-RUN] Would create: ~/.config/opencode/skills/new-skill/SKILL.md
[DRY-RUN] Summary: 3 installs, 1 update, 1 creation
```

## Install Flow

The install flow on a clean server:

1. **Validate prerequisites** — checks for root, internet, disk space
2. **Install runtime** — Bun, Node.js, OpenCode CLI via official installers
3. **Create directories** — config, state, data, logs
4. **Apply templates** — agents, skills, commands, MCP servers from templates
5. **Configure permissions** — file ownership, systemd unit files
6. **Secret provisioning** — validates secrets exist, never writes them
7. **Start services** — enables and starts systemd units
8. **Health check** — verifies all components are responding
9. **Write checksums** — generates integrity baseline

## Restore Flow

For disaster recovery on a replacement server:

```bash
# 1. Clone the akm-bridge repository
git clone https://github.com/<org>/akm-bridge.git /opt/akm-bridge

# 2. Run bootstrap in check mode first
/opt/opencode/scripts/bootstrap-controller.sh check

# 3. Restore secrets from backup
/opt/opencode/scripts/restore-secrets.sh /backup/secrets/

# 4. Apply the full bootstrap
/opt/opencode/scripts/bootstrap-controller.sh apply

# 5. Restore AKM state (if available)
cp -r /backup/akm-state/ ~/.local/share/opencode/akm/

# 6. Validate
opencode doctor
```

## Secret Provisioning

Secrets are **never** stored in the repository. They are provisioned via:

1. **Environment variables** — set in systemd unit files or `.env`
2. **HashiCorp Vault** — fetched at startup by the bootstrap controller
3. **Manual placement** — user copies secrets to known paths

The bootstrap controller validates that all required secrets exist but
never reads, logs, or stores their values.

## Upgrade-Existing

Upgrading an existing installation:

```bash
# Check what will change
/opt/opencode/scripts/bootstrap-controller.sh check

# Preview changes
/opt/opencode/scripts/bootstrap-controller.sh dry-run

# Apply upgrade
/opt/opencode/scripts/bootstrap-controller.sh apply

# Verify
opencode --version
opencode doctor
```

The controller automatically handles:
- Binary version updates
- Config template regeneration (with backup of old configs)
- Checksum recalculation
- Service restart if needed

## Uninstall

```bash
/opt/opencode/scripts/bootstrap-controller.sh uninstall
```

This removes:
- OpenCode binaries and config
- Systemd service files
- AKM state (prompts for confirmation)
- Does **not** remove secrets or backups

## Idempotency

All bootstrap operations are idempotent:

- Running `apply` twice produces the same result
- Files are only written if content differs (checked via checksum)
- Services are only restarted if configuration changed
- Templates are regenerated from source of truth, not accumulated

## Clean-Server Drill

To practice disaster recovery:

1. Provision a fresh Debian 12 VM
2. Clone the akm-bridge repo
3. Run the bootstrap
4. Validate with `opencode doctor`
5. Record RTO (target: <15 minutes)
6. Document any issues in the drill log

## RTO/RPO

| Metric | Target | Current |
|---|---|---|
| RTO (Recovery Time Objective) | < 15 minutes | ~12 minutes |
| RPO (Recovery Point Objective) | < 1 hour | ~30 minutes |

RTO assumes a clean Debian 12 server with internet access.
RPO assumes hourly backups of config and AKM state.

## Data Requiring External Backup

| Data | Backup Method | Frequency |
|---|---|---|
| Secrets | Encrypted vault export | On change |
| AKM knowledge base | `tar czf` + upload | Hourly |
| Config templates | Git repository | On change |
| Session history | Encrypted backup | Daily |
| Custom agents/skills | Git repository | On change |

## Commands

### `/bootstrap-check`

Checks the current system against the bootstrap manifest without making
changes. Reports missing components, version mismatches, and checksum
failures.

### `/disaster-restore`

Interactive guided recovery flow:
1. Detects current system state
2. Identifies what needs restoring
3. Prompts for backup location
4. Executes restore in order
5. Validates each step
6. Reports final health status

## Skill: disaster-recovery

The `disaster-recovery` skill provides:

- Pre-flight checklist
- Automated backup verification
- Restore orchestration
- Post-restore validation
- Drill templates

## Troubleshooting

| Problem | Solution |
|---|---|
| Bootstrap fails at runtime install | Check internet, try manual install |
| Secrets not found | Verify env vars or vault access |
| Service won't start | Check `journalctl -u opencode` |
| Checksum mismatch | Run `bootstrap-controller.sh apply` to repair |
| AKM state corrupted | Restore from latest backup |

## Rollback

If a bootstrap upgrade fails:

1. Stop services: `systemctl stop opencode`
2. Restore from backup: `cp -r /backup/config/ ~/.config/opencode/`
3. Reinstall previous binary version
4. Restart services: `systemctl start opencode`
5. Validate: `opencode doctor`

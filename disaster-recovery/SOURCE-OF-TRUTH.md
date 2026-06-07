# Source of Truth — OpenCode Environment

## Repository "akm-bridge" Stores

| Category | Examples |
|----------|----------|
| Bootstrap scripts | scripts/bootstrap-opencode-environment.ts |
| Restore scripts | disaster-recovery/restore.sh |
| Config templates | templates/opencode.json.template |
| Agent templates | templates/agents/*.md |
| Command templates | templates/commands/*.md |
| Skill templates | templates/skills/*/SKILL.md |
| MCP templates | templates/mcp/*.json |
| Permissions templates | templates/permissions/*.yaml |
| systemd templates | .systemd/*.service, .systemd/*.timer |
| Observability templates | templates/observability/*.json |
| Recovery templates | templates/recovery/*.json |
| Compatibility matrix | compatibility/matrix.json |
| Version lock | compatibility/opencode-version-lock.json |
| Test manifests | tests/e2e/opencode-contract.json |
| E2E fixtures | tests/e2e/fixtures/ |
| Documentation | docs/ |
| Checksums | disaster-recovery/checksums.sha256 |

## Repository NEVER Stores

| Category | Why |
|----------|-----|
| Real secrets | Security |
| Private SSH keys | Security |
| Provider tokens | Security |
| Production session data | Privacy |
| Production logs | Size/privacy |
| WordPress credentials | Security |
| Real .env files | Security |
| Active recovery state | Runtime |
| PID files | Runtime |
| Snapshots with secrets | Security |
| Install manifests | Local state |
| Backup archives | Size |

## Secrets Are Delivered Via

- Environment variables
- systemd credentials
- Interactive prompt during bootstrap
- External secrets file (user-provided path)

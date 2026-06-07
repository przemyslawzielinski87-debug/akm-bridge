# OpenCode Clean-Server Bootstrap Guide

Step-by-step instructions for bootstrapping OpenCode on a fresh Debian server.

## Prerequisites

- **OS**: Debian 12 (Bookworm) or Ubuntu 22.04+
- **Disk**: 20GB minimum, 50GB recommended
- **RAM**: 2GB minimum, 4GB recommended
- **Network**: Internet access for package downloads
- **Access**: Root or sudo privileges
- **Git**: Required to clone the akm-bridge repository

## One-Command Bootstrap

```bash
# Clone and run bootstrap
git clone https://github.com/<org>/akm-bridge.git /opt/akm-bridge && \
cd /opt/akm-bridge && \
sudo ./scripts/bootstrap-controller.sh apply
```

This single command handles the entire installation. For a safe preview
first, use dry-run mode:

```bash
sudo ./scripts/bootstrap-controller.sh dry-run
```

## What Gets Installed

### Runtime Components

| Component | Version | Purpose |
|---|---|---|
| Bun | 1.3.14 | JavaScript runtime |
| Node.js | v22.22.2 | JavaScript runtime |
| OpenCode CLI | 1.16.0 | AI coding assistant |
| AKM | 0.8.1 | Knowledge management |

### Configuration Files

| Path | Contents |
|---|---|
| `~/.config/opencode/` | Agents, skills, permissions |
| `~/.config/opencode/agents/` | 13 agent definitions |
| `~/.config/opencode/skills/` | 22 skill definitions |
| `~/.config/opencode/commands/` | 21 command definitions |
| `~/.config/opencode/mcp-servers/` | 7 MCP server configs |

### Systemd Services

| Service | Purpose |
|---|---|
| `opencode.service` | Main OpenCode process |
| `opencode-health.timer` | Periodic health checks |
| `opencode-backup.timer` | Hourly AKM state backup |

### System Packages

- `git`, `curl`, `wget` — utilities
- `build-essential` — compilation tools
- `jq` — JSON processing
- `tree-sitter-cli` — code analysis

## What You Need to Provide (Secrets)

Secrets are **never** included in the repository. You must provide:

### Required Secrets

| Secret | Source | Purpose |
|---|---|---|
| `ANTHROPIC_API_KEY` | Anthropic dashboard | LLM API access |
| `GITHUB_TOKEN` | GitHub settings | Repository access |

### Optional Secrets

| Secret | Source | Purpose |
|---|---|---|
| `OPENAI_API_KEY` | OpenAI dashboard | Alternative LLM |
| `VAULT_TOKEN` | HashiCorp Vault | Secret management |

### Setting Secrets

**Option A: Environment variables**
```bash
export ANTHROPIC_API_KEY="sk-ant-..."
export GITHUB_TOKEN="ghp_..."
```

**Option B: Systemd environment file**
```bash
cat > /etc/opencode/secrets.env << 'EOF'
ANTHROPIC_API_KEY=sk-ant-...
GITHUB_TOKEN=ghp_...
EOF
chmod 600 /etc/opencode/secrets.env
```

**Option C: Vault (production)**
Configure the vault provider in `env-manifest.json`.

## Post-Bootstrap Validation

```bash
# Check installation
opencode --version
opencode doctor

# Verify agents
opencode agents list

# Verify skills
opencode skills list

# Check services
systemctl status opencode
systemctl status opencode-health.timer

# Run bootstrap check
/opt/akm-bridge/scripts/bootstrap-controller.sh check
```

Expected output from `opencode doctor`:
```
✓ OpenCode CLI: 1.16.0
✓ Bun: 1.3.14
✓ Node.js: v22.22.2
✓ AKM: 0.8.1
✓ Config: valid
✓ Secrets: configured
✓ Services: running
```

## Common Issues

### Bootstrap fails at "Install Bun"

**Cause**: Network issues or missing curl.

**Fix**:
```bash
apt-get install -y curl
curl -fsSL https://bun.sh/install | bash
export PATH="$HOME/.bun/bin:$PATH"
```

### "Permission denied" during install

**Cause**: Not running as root.

**Fix**:
```bash
sudo ./scripts/bootstrap-controller.sh apply
```

### Services won't start

**Cause**: Missing secrets or config errors.

**Fix**:
```bash
# Check logs
journalctl -u opencode -n 50

# Validate config
opencode doctor

# Check secrets
env | grep -E 'ANTHROPIC|GITHUB'
```

### Checksum mismatch after restore

**Cause**: Files modified outside the bootstrap controller.

**Fix**:
```bash
# Regenerate checksums
/opt/akm-bridge/scripts/bootstrap-controller.sh apply

# Or force recalculate
sha256sum -c ~/.config/opencode/checksums.sha256
```

### AKM not indexing

**Cause**: Missing embeddings or corrupted index.

**Fix**:
```bash
akm reindex
akm status
```

## Full Recovery Procedure

For complete disaster recovery on a new server:

1. Install Debian 12 (minimal)
2. Update system: `apt update && apt upgrade -y`
3. Install git: `apt install -y git`
4. Clone repository: `git clone <repo> /opt/akm-bridge`
5. Run bootstrap: `cd /opt/akm-bridge && sudo ./scripts/bootstrap-controller.sh apply`
6. Provide secrets (see above)
7. Restore AKM state from backup (if available)
8. Validate: `opencode doctor`
9. Test: `opencode "hello world"`

Target time: under 15 minutes.

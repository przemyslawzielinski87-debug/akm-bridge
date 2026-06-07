# OpenCode Specialized Agents

## Overview

Six specialized agents extending the default `akm-build` agent for the Meridian project.
Each agent has a focused domain, appropriate tool permissions, and read-only boundaries.

## Agent Reference

### meridian-dev

| Property | Value |
|----------|-------|
| Role | WordPress/PHP/frontend development |
| Mode | subagent |
| Assigned Commands | `/meridian-fix` |
| Read-Only | No (edits project files) |
| AKM | Always for non-trivial tasks |
| Delegates | infra-ops (infrastructure concerns) |

**Domain**: WordPress theme, PHP, CSS, JS, Gutenberg, REST API, MU-plugins, tests.

**Denied**: Nginx, systemd, Cloudflare, Docker changes; secret access; production deploy.

### infra-ops

| Property | Value |
|----------|-------|
| Role | Infrastructure operations |
| Mode | subagent |
| Assigned Commands | `/production-check`, `/mcp-check` |
| Read-Only | Yes (default); changes require --fix |
| AKM | Always — production-safety, Nginx, Docker, Cloudflare, Coolify |

**Domain**: Nginx, PHP-FPM, Docker, Coolify, Cloudflare, systemd, ports, TLS, health checks.

**Denied**: docker prune, rm -rf, secret reading, force push.

### reviewer

| Property | Value |
|----------|-------|
| Role | Code review |
| Mode | subagent |
| Assigned Commands | `/meridian-audit`, `/review` |
| Read-Only | Yes — never edits |
| AKM | Conditional — review patterns |

**Domain**: Git diff analysis, bug detection, security, regressions, test quality.

**Denied**: edit, write, commit, push, deploy, service restart.

### security-auditor

| Property | Value |
|----------|-------|
| Role | Security auditing |
| Mode | subagent |
| Assigned Commands | (called as needed) |
| Read-Only | Yes |
| AKM | Always — WordPress security, CVE patterns |

**Domain**: Secrets, tokens, permissions, auth config, WordPress security, headers, dependencies.

**Denied**: edit, write, commit, push, service restart, exposing credential values.

### release-manager

| Property | Value |
|----------|-------|
| Role | Release preparation |
| Mode | subagent |
| Assigned Commands | `/commit-safe` |
| Read-Only | No (stages and commits) |
| AKM | Conditional — commit conventions |

**Domain**: Tests, lint, build, stage, commit, push, changelog.

**Denied**: force push, git add ., automatic deploy, push without consent.

### researcher

| Property | Value |
|----------|-------|
| Role | Research and analysis |
| Mode | subagent |
| Assigned Commands | (called as needed) |
| Read-Only | Yes |
| AKM | Always — primary knowledge source |

**Domain**: AKM search, documentation, architecture analysis, solution comparison, planning.

**Denied**: edit, write, commit, push, deploy, service restart.

## Delegation Flow

```
User → akm-build (default primary)
         ├── Meridian code → meridian-dev
         ├── Infrastructure → infra-ops
         ├── Code review → reviewer
         ├── Security audit → security-auditor
         ├── Release/commit → release-manager
         └── Research/planning → researcher
```

## Tool Access Summary

| Agent | Edit | Shell | AKM | Git Commit | Push | System Restart |
|-------|------|-------|-----|------------|------|----------------|
| meridian-dev | Allow (project) | Allow | Allow | Deny | Deny | Deny |
| infra-ops | Ask | Allow | Allow | Deny | Deny | Ask |
| reviewer | Deny | Safe tests | Allow | Deny | Deny | Deny |
| security-auditor | Deny | Read-only | Allow | Deny | Deny | Deny |
| release-manager | Limited | Test/build | Allow | Ask | Ask | Deny |
| researcher | Deny | Read-only | Allow | Deny | Deny | Deny |

## Configuration Location

- Agent files: `~/.config/opencode/agents/<name>.md`
- Command config: `~/.config/opencode/opencode.json` (command section)
- Command markdown: `~/.config/opencode/commands/<name>.md`
- Global policy: `~/.config/opencode/AGENTS.md`

## Rollback

```bash
# Restore from backup
cp ~/.config/opencode/backup/20260607123341-agents/*.md ~/.config/opencode/agents/
cp ~/.config/opencode/backup/20260607123341-agents/opencode.json ~/.config/opencode/opencode.json
cp ~/.config/opencode/backup/20260607123341-agents/AGENTS.md ~/.config/opencode/AGENTS.md
cp -r ~/.config/opencode/backup/20260607123341-agents/commands/* ~/.config/opencode/commands/
```

## Examples

```bash
# Run meridian-fix with the meridian-dev agent
opencode --agent meridian-dev "fix featured images on homepage"

# Run production-check with infra-ops agent
opencode run --command production-check

# Dry-run commit-safe with release-manager
opencode run --command commit-safe
```

## Test Commands

```bash
# Verify agent exists
opencode agent list | grep <agent-name>

# Run agent directly
opencode --agent <agent-name> "quick test query"
```

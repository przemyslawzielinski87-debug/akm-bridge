# OpenCode Permissions Hardening

## Overview

Permission hardening for all 7 operational agents and 12 custom commands. Uses OpenCode v1.16.0 YAML frontmatter `permission:` blocks with `allow`, `ask`, `deny` levels.

## Permission Architecture

OpenCode v1.16.0 supports per-agent permissions in agent YAML frontmatter:

```yaml
---
description: ...
mode: subagent
permission:
  edit: allow|ask|deny
  bash: allow|ask|deny
  webfetch: allow|ask|deny
  doom_loop: allow|ask|deny
  external_directory: allow|ask|deny
---
```

### Levels
- **allow** — operation proceeds without prompting
- **ask** — user is prompted for approval
- **deny** — operation is blocked

### bash Patterns
The `bash` field supports an object pattern for fine-grained control:
```yaml
permission:
  bash:
    "nginx -t": allow
    "systemctl restart": ask
    "rm -rf": deny
```

## Operation Classification

### Class A — Safe Read (allow by default)
- File read, git status/diff/log, lint, tests, typecheck, build (no deploy)
- Health checks, log reading (no secrets), process listing, port listing
- AKM search/info/health/status/capabilities/stats
- Safe MCP read tools

### Class B — Local Reversible Changes (allow/ask per agent)
- Code editing in repository, test file creation, documentation updates
- Local build, selective staging, local commit

### Class C — Production or External Changes (ask by default)
- git push, deploy, nginx reload, php-fpm restart, docker compose up
- systemd changes, DNS/Cloudflare/firewall changes
- Production WordPress updates, DB migrations

### Class D — Destructive (deny by default)
- rm -rf /, docker system prune, docker volume prune
- git push --force, git reset --hard (without explicit flag)
- DROP DATABASE, TRUNCATE, mass data deletion
- Secret exposure, .env commits, token in remote URL
- Server restart, backup deletion before validation

## Agent Permission Matrix

| Agent | edit | bash | webfetch | doom_loop | ext_dir | Read-only |
|-------|------|------|----------|-----------|---------|-----------|
| akm-build | allow | allow | allow | ask | allow | No |
| meridian-dev | allow | allow | ask | ask | ask | No |
| infra-ops | ask | ask | allow | deny | ask | No (default) |
| reviewer | deny | allow | ask | deny | deny | Yes |
| security-auditor | deny | allow | allow | deny | ask | Yes |
| release-manager | ask | allow | ask | deny | deny | No |
| researcher | deny | allow | allow | deny | deny | Yes |

## Custom Command Inheritance

Commands inherit permissions from their assigned agent. No override possible at command level.

| Command | Agent | read-only? | edit | push |
|---------|-------|------------|------|------|
| /meridian-audit | reviewer | Yes | deny | deny |
| /meridian-fix | meridian-dev | No | allow | deny |
| /production-check | infra-ops | Yes (default) | ask | deny |
| /review | reviewer | Yes | deny | deny |
| /commit-safe | release-manager | No | ask | ask |
| /mcp-check | infra-ops | Yes | ask | deny |

## Secret Protection

Agents with `edit: deny` cannot modify files containing secrets.
Agent instructions explicitly forbid:
- Reading private SSH key values (metadata only)
- Committing .env files
- Exposing credential values (must be masked)

Protected patterns (via agent instructions):
- .env, .env.*, *.pem, *.key
- id_rsa, id_ed25519, credentials*, secrets*
- auth*, token* (in config/credential contexts)

Exceptions: .env.example (readable), *.crt (public certs), metadata (allowed).

## MCP Tool Classification

MCP tools inherit agent-level permissions. No per-MCP-server permissions exist in v1.16.0.

| MCP Server | Tools | Risk | Protection |
|------------|-------|------|------------|
| akm-bridge | akm_health, akm_search, etc. | Low (all read) | Agent edit=deny protects |
| lean-ctx | ctx_read, ctx_search, etc. | Low (all read) | Agent edit=deny protects |
| filesystem-project | read, write, search | Medium | Only in /var/www/strategikon |
| github | get_me, search_code | Low | OAuth scoped |
| context7 | query-docs, resolve | Low | API key only |
| playwright | browser_* | Low | Sandboxed |
| sequential-thinking | sequentialthinking | Low | No side effects |

## Known Limitations (OpenCode v1.16.0)

1. **No global permissions** — must be set per-agent in YAML frontmatter
2. **No MCP-level permissions** — cannot restrict individual MCP tools by server
3. **No command-level permissions** — commands inherit agent settings
4. **bash pattern objects** — syntax exists in SDK types, verify enforcement in your version
5. **Permission inheritance in subtasks** — subtask agents inherit parent's permission block

## Rollback Procedure

```bash
# Restore from backup
RESTORE="/root/.config/opencode/backup/20260607123904-permissions-hardening"
cp "$RESTORE/opencode.json" /root/.config/opencode/opencode.json
cp -r "$RESTORE/agents/"* /root/.config/opencode/agents/
cp -r "$RESTORE/commands/"* /root/.config/opencode/commands/
cp "$RESTORE/AGENTS.md" /root/.config/opencode/AGENTS.md
```

## Test Results

### Permission Verification (all 7 agents)

| Agent | edit | Status |
|-------|------|--------|
| akm-build | allow | PASS |
| meridian-dev | allow | PASS |
| infra-ops | ask | PASS |
| reviewer | deny | PASS |
| security-auditor | deny | PASS |
| release-manager | ask | PASS |
| researcher | deny | PASS |

### Secret Protection
- security-auditor: masking policy present ✓
- reviewer: read-only language enforced ✓
- All agents with edit=deny: 3 (reviewer, security-auditor, researcher)

### Regression
- default_agent: akm-build (unchanged) ✓
- 7 MCP servers enabled ✓
- 12 command .md files ✓
- 6 commands in opencode.json ✓
- model/provider/plugin: preserved ✓

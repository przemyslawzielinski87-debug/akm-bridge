# OpenCode Agent Skills Reference

## Overview

18 Agent Skills installed globally at `~/.config/opencode/skills/`. Skills are loaded on-demand by the `skill` tool when a task matches their trigger keywords.

## Skills Created/Updated (10)

### production-safety (updated)
- **Trigger**: production, deploy, restart, nginx, database, wp-cli
- **Assigned agents**: akm-build, meridian-dev, infra-ops, security-auditor
- **Classification**: Class A-D operations
- **AKM**: Yes — searches for previous incidents

### mcp-diagnostics (updated)
- **Trigger**: MCP, connection, timeout, failed, disconnected, entrypoint
- **Assigned agents**: akm-build, infra-ops
- **AKM**: Yes — searches for MCP incidents

### meridian-wordpress-development
- **Trigger**: wordpress, php, theme, gutenberg, cpt, rest api, mu-plugin
- **Assigned agents**: meridian-dev
- **AKM**: Yes — searches for development patterns

### meridian-visual-regression
- **Trigger**: ui, css, layout, mobile, responsive, visual, screenshot
- **Assigned agents**: meridian-dev, reviewer
- **AKM**: Yes — searches for UI fixes

### nginx-incident-response
- **Trigger**: 502, 504, 403, nginx, ssl, reverse proxy, upstream
- **Assigned agents**: infra-ops
- **AKM**: Yes — searches for nginx incidents

### cloudflare-coolify-routing
- **Trigger**: cloudflare, dns, proxy, tls, coolify, traefik, origin
- **Assigned agents**: infra-ops
- **AKM**: Yes — searches for routing patterns

### safe-git-release
- **Trigger**: commit, release, push, changelog, pr, staging
- **Assigned agents**: akm-build, release-manager
- **AKM**: Conditional — git workflows

### wordpress-safe-content-update
- **Trigger**: content, post, page, media, menu, acf, import, bulk update
- **Assigned agents**: meridian-dev
- **AKM**: Conditional — content patterns

### secret-safe-audit
- **Trigger**: secret, token, api key, credential, auth, password, .env, ssh
- **Assigned agents**: reviewer, security-auditor, release-manager, akm-build
- **AKM**: Yes — security lessons

### post-task-learning
- **Trigger**: lesson learned, root cause, recurring, pattern, workflow
- **Assigned agents**: akm-build, researcher (read-only)
- **AKM**: Yes — searches for existing knowledge before saving

## Skill Format

Each skill is a directory with SKILL.md:

```
~/.config/opencode/skills/<name>/SKILL.md
```

Frontmatter:
```yaml
---
name: <skill-name>
description: <activation description with trigger keywords>
---
```

## Agent-Skill Mapping

| Agent | Skills |
|-------|--------|
| akm-build | production-safety, mcp-diagnostics, safe-git-release, post-task-learning, secret-safe-audit |
| meridian-dev | meridian-wordpress-development, meridian-visual-regression, wordpress-safe-content-update, production-safety |
| infra-ops | production-safety, nginx-incident-response, cloudflare-coolify-routing, mcp-diagnostics |
| reviewer | secret-safe-audit, meridian-visual-regression |
| security-auditor | secret-safe-audit, production-safety |
| release-manager | safe-git-release, secret-safe-audit |
| researcher | post-task-learning (read-only) |

## Safety

- Skills do not override agent permissions
- Skills cannot execute destructive operations
- Skills respect allow/ask/deny permissions
- Skills do not auto-deploy or auto-push
- Secrets are masked in all skill output

## Rollback

```bash
cp -r ~/.config/opencode/backup/20260607124300-skills/skills/* ~/.config/opencode/skills/
```

# OpenCode Custom Commands for The Meridian

## Overview

Six custom OpenCode commands for the Meridian project. Global, agent-assigned, with AKM integration.

## Command Reference

### `/meridian-audit`

| Property | Value |
|----------|-------|
| Purpose | Full read-only audit of The Meridian |
| Agent | `reviewer` (subtask) |
| Read-only | Yes |
| Uses AKM | Yes -- audit lessons, safety procedures, regressions |
| Arguments | None |
| Can commit | No |
| Can push | No |
| Example | `/meridian-audit` |

### `/meridian-fix`

| Property | Value |
|----------|-------|
| Purpose | Fix a specific problem |
| Agent | `akm-build` (primary context) |
| Read-only | No -- makes edits |
| Uses AKM | Yes -- similar problems, known fixes |
| Arguments | Free-form problem description |
| Can commit | No (manual approval) |
| Can push | No |
| Example | `/meridian-fix images not loading on homepage` |

### `/production-check`

| Property | Value |
|----------|-------|
| Purpose | Pre-deployment or production readiness audit |
| Agent | `infrastructure` (subtask) |
| Read-only | Yes (default); `--fix` flag enables fixes |
| Uses AKM | Yes -- production-safety, Nginx, Cloudflare, Coolify |
| Arguments | `--fix` (optional) |
| Can commit | No |
| Can push | No |
| Example | `/production-check` or `/production-check --fix` |

### `/review`

| Property | Value |
|----------|-------|
| Purpose | Read-only code review of current git changes |
| Agent | `reviewer` (subtask) |
| Read-only | Yes |
| Uses AKM | Conditional -- review patterns |
| Arguments | None |
| Can commit | No |
| Can push | No |
| Example | `/review` |

### `/commit-safe`

| Property | Value |
|----------|-------|
| Purpose | Safe, review-first commit with optional push |
| Agent | `akm-build` (primary context) |
| Read-only | No -- stages and commits |
| Uses AKM | Conditional |
| Arguments | `--push` or custom commit message |
| Can commit | Yes (after review) |
| Can push | Only with `--push` or explicit consent |
| Example | `/commit-safe` or `/commit-safe --push` or `/commit-safe "feat(auth): add login"` |

### `/mcp-check`

| Property | Value |
|----------|-------|
| Purpose | Real MCP server functionality test |
| Agent | `infrastructure` (subtask) |
| Read-only | Yes |
| Uses AKM | Yes -- comprehensive AKM MCP testing (6 calls) |
| Arguments | None |
| Can commit | No |
| Can push | No |
| Example | `/mcp-check` |

## How to Run

```bash
opencode run --command <command-name> [arguments]
# or in-session:
/<command-name> [arguments]
```

## Prerequisites

- OpenCode v1.16.0+
- AKM MCP bridge configured
- lean-ctx MCP server installed
- Required agents registered: `reviewer`, `akm-build`, `infrastructure`

## Configuration Rollback

```bash
# Restore from timestamped backup
cp /root/.config/opencode/backup/20260607122222/opencode.json /root/.config/opencode/opencode.json
cp -r /root/.config/opencode/backup/20260607122222/commands/* /root/.config/opencode/commands/
```

## Safety Summary

| Command | Read-Only | AKM | Edits | Commits | Pushes |
|---------|-----------|-----|-------|---------|--------|
| /meridian-audit | yes | yes | no | no | no |
| /meridian-fix | no | yes | yes | no | no |
| /production-check | yes (default) | yes | no (default) | no | no |
| /review | yes | cond | no | no | no |
| /commit-safe | no | cond | yes | yes | cond |
| /mcp-check | yes | yes | no | no | no |

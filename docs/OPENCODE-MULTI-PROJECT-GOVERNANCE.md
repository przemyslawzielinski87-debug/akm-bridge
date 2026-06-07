# Multi-Project Governance for OpenCode

## Overview

This system provides isolated, scoped profiles for each project managed by OpenCode. Each profile defines agents, commands, skills, MCP servers, AKM namespaces, budgets, locks, and environments — ensuring tasks never leak between repositories or environments.

## Why Not a Single Global Config

Multiple projects (The Meridian WordPress site, akm-bridge infrastructure) have fundamentally different:
- Repository roots and branches
- Agent assignments (WordPress dev vs infra ops)
- Write permissions (production vs staging vs local)
- MCP tool access (infra tools vs WordPress tools)
- Budget constraints (different token limits per project)

## When Projects Are Used

- New feature requiring repository context
- Architecture change within a project
- Task creation that targets a specific project
- Schedule that targets a specific project/environment
- Dashboard filtering by project

## When Projects Are Not Needed

- Simple single-repo tasks
- Global OpenCode configuration
- Read-only queries across projects
- Emergency recovery (unclassified project)

## Profile Structure

Each project is defined in `config/projects/<id>.json` with:
- Identity: name, description, repository path
- Environments: local, staging, production
- Allowed agents
- Allowed commands
- Allowed skills
- Allowed MCP servers/tools
- AKM namespace
- Permissions (read/write/deploy/admin/shell)
- Budgets (daily/weekly token limits)
- Concurrency limits
- Git policy (allowed branches)
- Environment isolation settings

## Local Path Mapping

Active repository paths are stored in `config/projects.local.json` (not committed to git). This maps profile IDs to actual filesystem paths:

```json
{
  "the-meridian": "/var/www/strategikon",
  "akm-bridge": "/root/projekt/akm-bridge"
}
```

## Environments

| Feature | Local | Staging | Production |
|---------|-------|---------|------------|
| Write policy | Allowed | Allowed | Approval required |
| Deploy policy | Allowed | Approval | Double approval |
| Backup required | No | Yes | Yes |
| Rollback required | No | Yes | Yes |
| Health checks | Optional | Required | Required before/after |
| Maintenance window | None | Off-peak | Scheduled |

## Permission Resolution

1. Global deny always wins
2. Agent permissions
3. Project profile permissions
4. Environment permissions
5. Command constraints

Most restrictive rule wins. A profile cannot override a global deny.

## Filesystem Isolation

Every task:
1. Resolves realpath of the project repository
2. Checks against the registry allowlist
3. Detects symlink escape attempts (`../`, symlinks outside root)
4. Blocks path traversal
5. Sets working directory to project root
6. Controls artifact and temp file locations

Blocked: `../`, symlink escape, mount escape, arbitrary absolute paths.

## Agent Scoping

Each profile defines `allowedAgents` and `taskTypeRouting`. Example routing for The Meridian:
- WordPress/code → meridian-dev
- Infrastructure → infra-ops
- Review → reviewer
- Security → security-auditor
- Release → release-manager
- Research/brainstorm → researcher/explore

## Command Scoping

Each profile defines allowed commands. Backend enforces allowlist — frontend filtering is secondary.

The Meridian example: `/brainstorm`, `/meridian-audit`, `/meridian-fix`, `/production-check`, `/review`, `/commit-safe`, `/system-check`, `/learn`

## Skill Scoping

Each profile defines allowed skills. A skill cannot extend the project's profile permissions. Agent must also have access.

## MCP Scoping

Each profile defines `allowedMcpServers` and `allowedMcpTools`. Example:
- Meridian dev: restricted to WordPress-relevant tools
- Reviewer: no write tools
- akm-bridge: full diagnostic MCP scope

## AKM Namespaces

AKM searches are scoped by project. Example:
- `project=the-meridian`
- `project=akm-bridge`

Agent searches current project first, then optionally global. Lessons from one project are not stored as lessons of another.

## Budgets

Per-profile:
- Daily/weekly token limits (read and write separately)
- Max tokens per task
- Max tool calls
- Max duration
- Max concurrent tasks
- Max scheduled runs

Soft warning at 80%. Hard block at limit. Budgets per environment (staging/production separate).

## Locks

- Multiple read-only tasks can run in parallel
- One write task per project
- One production-changing task per environment
- Disaster restore or update promotion blocks all write tasks for the project

## Database Migration

Task store schema v2 adds:
- `environment TEXT` column
- `project_id TEXT` column
- `project_profiles` table

Each task, schedule, approval, notification, and artifact has `project_id` and `environment_id`.

## Migration

Existing tasks are mapped:
- Tasks created for The Meridian → `the-meridian` (with evidence)
- Tasks created for akm-bridge → `akm-bridge` (with evidence)
- Unclear → `unclassified`

## API

- `GET /api/projects` — list all projects
- `GET /api/projects/:id` — project detail
- `GET /api/projects/:id/status` — health + budget + locks
- `GET /api/projects/:id/budget` — budget status
- `GET /api/projects/:id/agents` — allowed agents
- `GET /api/projects/:id/commands` — allowed commands
- `GET /api/projects/:id/skills` — allowed skills
- `GET /api/projects/:id/mcp` — allowed MCP servers/tools
- `GET /api/projects/:id/tasks` — tasks in project
- `GET /api/projects/:id/schedules` — schedules in project
- `GET /api/project-locks` — current locks

Profile modification requires fresh session, CSRF, double confirmation, security audit.

## UI

All dashboards (Operations Dashboard, Remote Control, Scheduler, Notifications, Tasks, Approvals, Reports) include a project switcher. All lists are backend-filtered on project change.

## Recovery

Recovery classifies problems:
- Global (restart OpenCode)
- Project (restart project services)
- Environment (redeploy environment)
- MCP (restart MCP bridge)

Does not restart global OpenCode for a single project issue.

## Command: /projects

```
/projects
/projects --list
/projects --status
/projects --show the-meridian
/projects --budget the-meridian
/projects --locks
```

Read-only by default.

## Skill: multi-project-governance

Covers profiles, routing, permissions, budgets, locks, environments, migration, DR. Available to: akm-build, infra-ops, release-manager, security-auditor, reviewer (read-only).

## Bootstrap & DR

Bootstrap auto-discovers profiles from `config/projects/`. DR manifest tracks profiles, validation checks include profile discovery, scoping, and isolation.

## Troubleshooting

- Task blocked by lock: check `/projects --locks`
- Agent not allowed: verify profile's `allowedAgents`
- Command not found: verify profile's allowed commands
- Budget exceeded: check `/projects --budget <id>`
- Wrong environment: verify task's `environment` parameter

## Rollback

1. `git revert` the commit
2. Restore database from backup
3. Revert DR manifest and checksums
4. Re-apply bootstrap
5. Verify via E2E tests
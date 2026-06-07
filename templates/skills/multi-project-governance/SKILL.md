---
name: multi-project-governance
description: Skill for managing multi-project profiles, permissions, budgets, locks, environments, and project isolation. Use when configuring or troubleshooting project scoping, agent routing, or environment separation.
---

# Multi-Project Governance

Profile-based project isolation for OpenCode. Each project has its own agents, commands, skills, MCP scope, AKM namespace, budgets, locks, and environments.

## Project Profiles

Each profile defines:

| Field | Description |
|-------|-------------|
| `id` | Unique project identifier |
| `name` | Human-readable name |
| `repositoryPath` | Resolved filesystem path |
| `repositoryRemote` | Git remote URL |
| `defaultBranch` | Default git branch |
| `allowedBranches` | Branches permitted for write |
| `projectType` | Classification (wordpress, infrastructure, etc.) |
| `enabled` | Whether the profile is active |
| `environments` | Environment configs (local, staging, production) |
| `agents` | Allowed agent IDs |
| `commands` | Allowed command names |
| `skills` | Allowed skill names |
| `mcpServers` | Allowed MCP servers |
| `mcpTools` | Allowed MCP tools |
| `akm` | AKM namespace scoping |
| `permissions` | Read/write/deploy/admin/shell levels |
| `budgets` | Token and task limits |
| `concurrency` | Parallelism and queue policy |
| `gitPolicy` | Branch rules, PR requirement, signing |
| `deploymentPolicy` | Approval, canary, rollback rules |
| `observability` | Metrics retention, alerting, digests |
| `backupPolicy` | RTO, RPO, retention |

## Permission Resolution

Most restrictive rule wins:

```
global permissions
→ agent permissions
→ project profile permissions
→ environment permissions
→ command constraints
```

A profile cannot override a global `deny`.

## Environment Isolation

Each environment has independent:

- `writePolicy`: allow | ask | deny
- `approvalPolicy`: none | single | double
- Health check, backup, and rollback requirements
- Maintenance windows

Production write actions always require approval.

## Filesystem Isolation

Before each task:

1. Resolve realpath of repository
2. Check against project allowlist
3. Detect symlinks and block traversal
4. Set working directory
5. Control artifact and temp file output

## Agent Routing

Profiles define: `defaultAgent`, `allowedAgents`, `taskTypeRouting`.

Example Meridian routing:
- WordPress/code → meridian-dev
- Infrastructure → infra-ops
- Review → reviewer
- Security → security-auditor
- Release → release-manager

## AKM Namespaces

Agent searches project namespace first, then falls back to global if configured.

Cross-project lesson contamination is prevented.

## Budget Enforcement

- Soft warning at 80% of limit
- Hard block at 100%
- Read and write budgets are tracked separately
- Staging and production budgets are independent
- Budget reset daily and weekly

## Locking

- Multiple read tasks can run concurrently
- One write task per project at a time
- One production-changing task per environment
- Disaster restore blocks all write tasks

## Handoff

When transitioning to implementation or troubleshooting:

```
PROJECT_ID=
ENVIRONMENT=
ISSUE_TYPE=profile_config|scope_violation|budget_exceeded|lock_conflict|environment_misconfig
PROFILE_CHANGES=
RESOLUTION=
VERIFICATION_STEPS=
ROLLBACK_PLAN=
```

## Prohibitions

- Never create a profile with an arbitrary filesystem path
- Never grant write permissions to an unclassified project
- Never bypass lock or budget checks
- Never allow force push unless explicitly configured
- Never copy secrets between projects
- Never allow staging tasks to execute production writes

## When to Use

- Setting up a new project
- Configuring project environments
- Troubleshooting scope violations
- Auditing budget usage
- Investigating lock conflicts
- Reviewing environment isolation

## When to Skip

- Single-project operations
- Simple edits within an already-configured project
- Read-only information requests
- Tasks with an already-approved plan
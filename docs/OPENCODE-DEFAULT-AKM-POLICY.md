# OpenCode — Default AKM Policy

## Architecture

OpenCode uses AKM (Agent Kit Manager) as the default knowledge, workflow, memory,
lesson, and reusable-resource layer for all non-trivial tasks.

```
OpenCode session
├── Agent: akm-build (default primary)
├── MCP: akm-bridge (14 tools, preferred path)
├── AGENTS.md (AKM — Default Knowledge and Workflow Policy)
└── CLI: /root/.bun/bin/bun run /root/.bun/bin/akm (fallback)
```

## When to use AKM

**Automatic for:**
- repository setup, project bootstrapping, infrastructure work
- deployments, server configuration, debugging, recurring incidents
- MCP/plugin configuration, security-sensitive tasks
- authentication issues, Nginx, Docker, systemd, WordPress, Node, Bun, CI/CD
- tasks spanning multiple files, multi-step implementations
- tasks similar to previously completed work
- recovery/rollback procedures, production changes
- complex audits, troubleshooting repeated errors

**Skip for:**
- trivial text edits, simple file reads, obvious one-line corrections
- short explanations, formatting-only work
- tasks where the user explicitly asks not to use AKM
- tasks where AKM cannot add useful information

## Tool preference order

1. `akm-bridge` MCP tools (akm_search, akm_show, akm_health, etc.)
2. Normal OpenCode tools (read, edit, bash, etc.)
3. Direct `akm` CLI via `/root/.bun/bin/bun run /root/.bun/bin/akm` (fallback)

## Configuration files

| File | Location | Purpose |
|------|----------|---------|
| AGENTS.md | `/root/.config/opencode/AGENTS.md` | AKM default policy (Section `AKM — Default Knowledge and Workflow Policy`) |
| Agent definition | `/root/.config/opencode/agents/akm-build.md` | Default primary agent with AKM-first behavior |
| opencode.json | `/root/.config/opencode/opencode.json` | Sets `default_agent: akm-build`, MCP config with PATH |

## Agent: akm-build

- Mode: primary (default)
- For non-trivial tasks: search AKM → review result → validate → reuse/adapt
- Prefers MCP tools over CLI
- Reports which AKM tool was called and what was found

## Tests completed

| Test | Prompt | Expected behavior | Result |
|------|--------|-------------------|--------|
| A | Complex Nginx diagnostic | Agent auto-searches AKM | PASS |
| B | Read git branch name | Agent skips AKM, direct git | PASS |
| C | Find deploy workflow in AKM | Agent finds existing resource | PASS |
| D | Caddy audit (no match) | Agent searches, finds nothing, proceeds | PASS |
| E | MCP failure fallback to CLI | Agent detects MCP issue, uses CLI | PASS |

## Rollback

1. Restore `/root/.config/opencode/AGENTS.md` from backup
2. Restore `/root/.config/opencode/opencode.json` from backup
3. Delete `/root/.config/opencode/agents/akm-build.md`
4. Restart OpenCode session
5. Verify existing plugins and MCP still work

# Recovery Time & Recovery Point Objectives

## RTO — Recovery Time Objective

| Scenario | Target RTO |
|----------|-----------|
| Full environment rebuild (clean server) | < 30 minutes |
| Config restore from backup | < 5 minutes |
| Component restart (single MCP) | < 1 minute |
| OpenCode process recovery | < 2 minutes |

## RPO — Recovery Point Objective

| Dataset | RPO | Backup Method |
|---------|-----|---------------|
| OpenCode config | Last commit | Git |
| Agents | Last commit | Git |
| Commands | Last commit | Git |
| Skills | Last commit | Git |
| systemd templates | Last commit | Git |
| Recovery state | Last timer run | Local file |
| Compatibility matrix | Last commit | Git |
| Version lock | Last commit | Git |
| AKM index/data | Last AKM sync | AKM export |
| OpenCode sessions | Runtime only | Not recoverable |
| Secrets | Manual | External backup |
| WordPress DB | Depends on WP backup | Separate system |
| WordPress uploads | Depends on WP backup | Separate system |
| Production project data | Manual | User backup |

## What Git DOES NOT Recover

- Secrets (must be re-provisioned)
- AKM learned knowledge (must be re-learned or restored from AKM export)
- OpenCode session history
- Observability historical data
- Recovery cooldown state
- Active session context
- WordPress database and uploads
